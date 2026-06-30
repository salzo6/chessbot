// Vesper — search. Iterative-deepening, fail-soft negamax with:
//   · principal-variation search (PVS)        · transposition table
//   · quiescence search (with check evasions)  · null-move pruning
//   · late-move reductions (LMR)               · check extensions
//   · MVV-LVA + killer + history move ordering  · mate-distance pruning
//   · aspiration windows                        · time / node / depth limits
//
// Scores are side-to-move POV (negamax). The caller prints them straight to
// UCI; the host normalizes to White's POV.

import {
  WHITE, PAWN, KNIGHT, BISHOP, ROOK, QUEEN, KING,
  moveFrom, moveTo, moveFlag, isCapture, isPromotion, moveToUci, typeOf, colorOf,
} from "./board.mjs";
import { evaluate, MATE, MATE_BOUND } from "./eval.mjs";

const INF = 32000;
const MAX_PLY = 64;
const ORDER_VAL = [0, 100, 320, 330, 500, 900, 20000]; // by piece type, for MVV-LVA

// TT entry flags
const TT_NONE = 0, TT_EXACT = 1, TT_LOWER = 2, TT_UPPER = 3;

export class Searcher {
  constructor(board, ttBits = 22) {
    this.board = board;
    this.size = 1 << ttBits;
    this.mask = this.size - 1;
    this.ttKey = new Int32Array(this.size);   // verification = hashHi
    this.ttMove = new Int32Array(this.size);
    this.ttScore = new Int32Array(this.size);
    this.ttData = new Int32Array(this.size);   // depth | flag<<8  (flag 0 = empty)
    this.killers = Array.from({ length: MAX_PLY + 8 }, () => [0, 0]);
    this.history = [new Int32Array(128 * 128), new Int32Array(128 * 128)];
    this.moveStack = [];
    this.scoreStack = [];
    this.onInfo = null; // optional callback({depth,score,mate,nodes,nps,time,pv})
    this._reset();
  }

  _reset() {
    this.nodes = 0;
    this.stop = false;
    this.startTime = 0;
    this.hardTime = Infinity;
    this.softTime = Infinity;
    this.maxNodes = Infinity;
    this.rootBestMove = 0;
  }

  clearHash() {
    this.ttKey.fill(0); this.ttMove.fill(0); this.ttScore.fill(0); this.ttData.fill(0);
  }

  // ---- transposition table ----
  _ttIndex() { return this.board.hashLo & this.mask; }

  _ttProbe() {
    const i = this._ttIndex();
    if (this.ttKey[i] !== this.board.hashHi || (this.ttData[i] & 0xff00) === 0) return null;
    const data = this.ttData[i];
    return { move: this.ttMove[i], score: this.ttScore[i], depth: data & 0xff, flag: (data >> 8) & 0xff };
  }

  _ttStore(depth, flag, score, move) {
    const i = this._ttIndex();
    const same = this.ttKey[i] === this.board.hashHi;
    const storedDepth = this.ttData[i] & 0xff;
    // depth-preferred, but always overwrite a different position or an empty slot
    if (!same || depth >= storedDepth || (this.ttData[i] & 0xff00) === 0) {
      this.ttKey[i] = this.board.hashHi;
      this.ttMove[i] = move || (same ? this.ttMove[i] : 0);
      this.ttScore[i] = score;
      this.ttData[i] = (depth & 0xff) | (flag << 8);
    }
  }

  _timeUp() {
    if (this.nodes >= this.maxNodes) return true;
    return Date.now() >= this.hardTime;
  }

  _hasNonPawnMaterial(color) {
    const b = this.board.board;
    for (let r = 0; r < 8; r++) for (let f = 0; f < 8; f++) {
      const p = b[r * 16 + f];
      if (p && colorOf(p) === color) { const t = p & 7; if (t !== PAWN && t !== KING) return true; }
    }
    return false;
  }

  // ---- move ordering ----
  _scoreMoves(moves, scores, ply, ttMove) {
    const b = this.board.board;
    const stm = this.board.side;
    const k0 = this.killers[ply][0], k1 = this.killers[ply][1];
    const hist = this.history[stm];
    for (let i = 0; i < moves.length; i++) {
      const m = moves[i];
      if (m === ttMove) { scores[i] = 30_000_000; continue; }
      if (isCapture(m) || isPromotion(m)) {
        const flag = moveFlag(m);
        const victim = flag === 5 ? PAWN : (b[moveTo(m)] & 7) || PAWN;
        const attacker = b[moveFrom(m)] & 7;
        let s = 20_000_000 + ORDER_VAL[victim] * 16 - ORDER_VAL[attacker];
        if (isPromotion(m)) s += 2_000_000 + ORDER_VAL[(flag & 3) + KNIGHT];
        scores[i] = s;
      } else if (m === k0) scores[i] = 19_000_000;
      else if (m === k1) scores[i] = 18_000_000;
      else scores[i] = hist[moveFrom(m) * 128 + moveTo(m)];
    }
  }

  // pick the highest-scored remaining move (selection sort, lazy)
  _pickMove(moves, scores, start) {
    let best = start;
    for (let i = start + 1; i < moves.length; i++) if (scores[i] > scores[best]) best = i;
    if (best !== start) {
      const tm = moves[best]; moves[best] = moves[start]; moves[start] = tm;
      const ts = scores[best]; scores[best] = scores[start]; scores[start] = ts;
    }
    return moves[start];
  }

  // ---- quiescence ----
  _qsearch(alpha, beta, ply) {
    this.nodes++;
    if ((this.nodes & 2047) === 0 && this._timeUp()) { this.stop = true; return 0; }
    if (ply >= MAX_PLY) return evaluate(this.board);

    const board = this.board;
    const inCheck = board.inCheck();
    let best;
    if (inCheck) {
      best = -MATE + ply;
    } else {
      best = evaluate(board);
      if (best >= beta) return best;
      if (best > alpha) alpha = best;
    }

    const moves = (this.moveStack[ply] ||= []);
    board.generateMoves(moves, !inCheck); // in check: all evasions; else captures+promos
    const scores = (this.scoreStack[ply] ||= []);
    scores.length = moves.length;
    this._scoreMoves(moves, scores, ply, 0);

    const b = board.board;
    let legal = 0;
    for (let i = 0; i < moves.length; i++) {
      const m = this._pickMove(moves, scores, i);
      if (!inCheck && !isPromotion(m)) {
        // delta pruning
        const victim = moveFlag(m) === 5 ? PAWN : (b[moveTo(m)] & 7) || PAWN;
        if (best + ORDER_VAL[victim] + 150 < alpha) continue;
      }
      const mover = board.side;
      board.makeMove(m);
      if (board.isAttacked(board.kingSq[mover], mover ^ 1)) { board.unmakeMove(); continue; }
      legal++;
      const score = -this._qsearch(-beta, -alpha, ply + 1);
      board.unmakeMove();
      if (this.stop) return 0;
      if (score > best) {
        best = score;
        if (score > alpha) { alpha = score; if (score >= beta) return score; }
      }
    }
    if (inCheck && legal === 0) return -MATE + ply; // checkmated
    return best;
  }

  // ---- main negamax ----
  _negamax(depth, alpha, beta, ply, isPv) {
    if (this.stop) return 0;
    this.nodes++;
    if ((this.nodes & 2047) === 0 && this._timeUp()) { this.stop = true; return 0; }

    const board = this.board;
    const root = ply === 0;

    if (!root) {
      if (board.halfmove >= 100 || board.isRepetition()) return 0; // draw
      // mate-distance pruning
      if (alpha < -MATE + ply) alpha = -MATE + ply;
      if (beta > MATE - ply - 1) beta = MATE - ply - 1;
      if (alpha >= beta) return alpha;
    }
    if (ply >= MAX_PLY) return evaluate(board);

    const inCheck = board.inCheck();
    if (inCheck) depth++; // check extension

    if (depth <= 0) return this._qsearch(alpha, beta, ply);

    // TT probe
    const probe = this._ttProbe();
    let ttMove = 0;
    if (probe) {
      ttMove = probe.move;
      if (!root && probe.depth >= depth) {
        let s = probe.score;
        if (s >= MATE_BOUND) s -= ply; else if (s <= -MATE_BOUND) s += ply;
        if (probe.flag === TT_EXACT) return s;
        if (probe.flag === TT_LOWER && s >= beta) return s;
        if (probe.flag === TT_UPPER && s <= alpha) return s;
      }
    }

    // null-move pruning
    if (!isPv && !inCheck && depth >= 3 && beta < MATE_BOUND && this._hasNonPawnMaterial(board.side)) {
      const R = 2 + (depth >= 6 ? 1 : 0);
      board.makeNullMove();
      const score = -this._negamax(depth - 1 - R, -beta, -beta + 1, ply + 1, false);
      board.unmakeNullMove();
      if (this.stop) return 0;
      if (score >= beta) return beta;
    }

    const moves = (this.moveStack[ply] ||= []);
    board.generateMoves(moves);
    const scores = (this.scoreStack[ply] ||= []);
    scores.length = moves.length;
    this._scoreMoves(moves, scores, ply, ttMove);

    let best = -INF, bestMove = 0, flag = TT_UPPER, legalCount = 0;

    for (let i = 0; i < moves.length; i++) {
      const m = this._pickMove(moves, scores, i);
      const isQuiet = !isCapture(m) && !isPromotion(m);
      const mover = board.side;
      board.makeMove(m);
      if (board.isAttacked(board.kingSq[mover], mover ^ 1)) { board.unmakeMove(); continue; }
      legalCount++;
      const givesCheck = board.inCheck();

      let score;
      if (legalCount === 1) {
        score = -this._negamax(depth - 1, -beta, -alpha, ply + 1, isPv);
      } else {
        // late-move reduction for quiet, non-checking moves
        let reduction = 0;
        if (depth >= 3 && isQuiet && !inCheck && !givesCheck) {
          reduction = 1 + (legalCount > 6 ? 1 : 0) + (depth >= 6 ? 1 : 0);
          if (reduction > depth - 1) reduction = depth - 1;
        }
        score = -this._negamax(depth - 1 - reduction, -alpha - 1, -alpha, ply + 1, false);
        if (score > alpha && reduction > 0)
          score = -this._negamax(depth - 1, -alpha - 1, -alpha, ply + 1, false);
        if (score > alpha && score < beta)
          score = -this._negamax(depth - 1, -beta, -alpha, ply + 1, isPv);
      }

      board.unmakeMove();
      if (this.stop) return 0;

      if (score > best) {
        best = score; bestMove = m;
        if (root) this.rootBestMove = m;
        if (score > alpha) {
          alpha = score; flag = TT_EXACT;
          if (score >= beta) {
            if (isQuiet) {
              const k = this.killers[ply];
              if (k[0] !== m) { k[1] = k[0]; k[0] = m; }
              this.history[mover][moveFrom(m) * 128 + moveTo(m)] += depth * depth;
            }
            flag = TT_LOWER;
            break;
          }
        }
      }
    }

    if (legalCount === 0) return inCheck ? -MATE + ply : 0; // checkmate or stalemate

    let stored = best;
    if (stored >= MATE_BOUND) stored += ply; else if (stored <= -MATE_BOUND) stored -= ply;
    this._ttStore(depth, flag, stored, bestMove);
    return best;
  }

  _extractPV(maxLen) {
    const board = this.board;
    const pv = [];
    let made = 0;
    for (let i = 0; i < maxLen; i++) {
      const probe = this._ttProbe();
      if (!probe || !probe.move) break;
      const legal = board.findMove(moveToUci(probe.move));
      if (!legal) break;
      pv.push(moveToUci(legal));
      board.makeMove(legal); made++;
      if (board.isRepetition()) break;
    }
    for (let i = 0; i < made; i++) board.unmakeMove();
    return pv;
  }

  _legalRootMoves() {
    const board = this.board;
    const pseudo = [];
    board.generateMoves(pseudo);
    const legal = [];
    for (const m of pseudo) {
      const mover = board.side;
      board.makeMove(m);
      if (!board.isAttacked(board.kingSq[mover], mover ^ 1)) legal.push(m);
      board.unmakeMove();
    }
    return legal;
  }

  /**
   * Search the current position. limits: { movetime, depth, nodes, infinite,
   * wtime, btime, winc, binc, movestogo }. Returns { bestMove(uci), score, ... }.
   */
  search(limits = {}) {
    this._reset();
    const board = this.board;
    this.startTime = Date.now();

    // time budget
    let alloc = null;
    if (limits.movetime) alloc = limits.movetime;
    else if (limits.wtime != null || limits.btime != null) {
      const remaining = (board.side === WHITE ? limits.wtime : limits.btime) || 1000;
      const inc = (board.side === WHITE ? limits.winc : limits.binc) || 0;
      const mtg = limits.movestogo || 30;
      alloc = Math.min(remaining * 0.9, remaining / mtg + inc * 0.8);
    }
    if (limits.nodes) this.maxNodes = limits.nodes;
    const maxDepth = limits.depth || (limits.infinite ? MAX_PLY : MAX_PLY);
    if (alloc != null) {
      alloc = Math.max(5, alloc);
      this.hardTime = this.startTime + Math.max(alloc - 20, alloc * 0.85);
      this.softTime = this.startTime + alloc * 0.6;
    } else if (!limits.depth && !limits.nodes && !limits.infinite) {
      // nothing specified — a safe default
      this.hardTime = this.startTime + 980;
      this.softTime = this.startTime + 600;
    }

    const rootMoves = this._legalRootMoves();
    if (rootMoves.length === 0) return { bestMove: "(none)", score: 0 };
    let bestMove = rootMoves[0];          // legal fallback
    this.rootBestMove = bestMove;
    let bestScore = 0, completedDepth = 0;

    if (rootMoves.length === 1 && alloc != null && !limits.depth) {
      // only one legal move — don't waste the clock
      return { bestMove: moveToUci(bestMove), score: 0, depth: 1, onlyMove: true };
    }

    for (let d = 1; d <= maxDepth; d++) {
      let alpha = -INF, beta = INF;
      if (d >= 4) { alpha = bestScore - 40; beta = bestScore + 40; }
      let score = this._negamax(d, alpha, beta, 0, true);
      if (!this.stop && (score <= alpha || score >= beta))
        score = this._negamax(d, -INF, INF, 0, true); // aspiration fail → re-search

      if (this.stop && d > 1) break; // discard incomplete depth

      bestMove = this.rootBestMove || bestMove;
      bestScore = score;
      completedDepth = d;

      const time = Date.now() - this.startTime;
      const pv = this._extractPV(d + 2);
      if (this.onInfo) {
        const info = { depth: d, nodes: this.nodes, time, nps: time > 0 ? Math.round(this.nodes / time * 1000) : 0, pv };
        if (Math.abs(score) >= MATE_BOUND) {
          const plies = MATE - Math.abs(score);
          info.mate = (score > 0 ? 1 : -1) * Math.ceil(plies / 2);
        } else info.score = score;
        this.onInfo(info);
      }

      if (Math.abs(score) >= MATE_BOUND) break;       // mate found
      if (this.stop) break;
      if (Date.now() >= this.softTime && !limits.infinite && !limits.depth && !limits.nodes) break;
    }

    const out = { bestMove: moveToUci(bestMove), score: bestScore, depth: completedDepth, nodes: this.nodes };
    if (Math.abs(bestScore) >= MATE_BOUND) {
      const plies = MATE - Math.abs(bestScore);
      out.mate = (bestScore > 0 ? 1 : -1) * Math.ceil(plies / 2);
    }
    return out;
  }
}
