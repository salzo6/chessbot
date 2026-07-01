// coachcore — the ONE source of truth for the pure coaching/analysis math.
//
// Plain JS (no React, no TS-only syntax) so BOTH the browser (Vite bundles it,
// via web/src/lib/coach.ts) and the Node server (server/analysis.mjs imports it
// directly) run provably-identical logic. The live coach is the regression test
// for the classification/threat half; the trainer's batch worker reuses the same
// functions plus the motif/SEE detectors added at the bottom.
//
// Evals from the engine are always WHITE point-of-view; we convert to the mover's
// POV where needed so the same logic serves both colors.
import { Chess } from "chess.js";

const PIECE_VAL = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
// For SEE ordering/recapture only: the king is "most valuable" so it recaptures
// last (matching "a king may only recapture when nothing cheaper can").
const SEE_VAL = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 100 };
const NAME_FULL = { p: "pawn", n: "knight", b: "bishop", r: "rook", q: "queen", k: "king" };

/** Centipawns → win probability (0..100), chess.com-style logistic. Tunable. */
export function winPct(cp) {
  return 100 / (1 + Math.exp(-0.00368208 * cp));
}

/** White-POV centipawns for a line (mate folded to a large cp). */
export function lineCpWhite(line) {
  if (!line) return 0;
  if (line.mate != null) return line.mate > 0 ? 10000 : -10000;
  return line.scoreCp ?? 0;
}

/** Pretty eval string from white-POV cp/mate, shown from white's POV (+ = white better). */
export function formatEvalWhite(line) {
  if (!line) return "—";
  if (line.mate != null) return `#${line.mate > 0 ? "" : "-"}${Math.abs(line.mate)}`;
  const cp = line.scoreCp ?? 0;
  return `${cp > 0 ? "+" : ""}${(cp / 100).toFixed(2)}`;
}

// Display metadata for each classification (colors tuned to the app palette).
export const CLASS_META = {
  brilliant: { label: "Brilliant", glyph: "!!", color: "#26c2a3", brush: "green" },
  great: { label: "Great", glyph: "!", color: "#5b8baf", brush: "green" },
  best: { label: "Best", glyph: "★", color: "#9bbd6b", brush: "green" },
  excellent: { label: "Excellent", glyph: "", color: "#9bbd6b", brush: "green" },
  good: { label: "Good", glyph: "", color: "#93a972", brush: "green" },
  book: { label: "Book", glyph: "", color: "#a89a7c", brush: "blue" },
  inaccuracy: { label: "Inaccuracy", glyph: "?!", color: "#e6a23c", brush: "yellow" },
  mistake: { label: "Mistake", glyph: "?", color: "#e08b4c", brush: "yellow" },
  miss: { label: "Miss", glyph: "✗", color: "#d08770", brush: "red" },
  blunder: { label: "Blunder", glyph: "??", color: "#c05b5b", brush: "red" },
};

/**
 * Does the just-played move leave material hanging (a sacrifice/offer)?
 * `boardAfter` is positioned with the OPPONENT to move. Heuristic: the opponent
 * can grab a real piece (≥ minor) with a lesser piece or a pawn. Catches the
 * common "give up a piece for an attack/mate" brilliancy; not a full SEE.
 */
function isSacrifice(boardAfter) {
  for (const m of boardAfter.moves({ verbose: true })) {
    if (!m.captured) continue;
    const victim = PIECE_VAL[m.captured];
    const attacker = PIECE_VAL[m.piece];
    if (victim >= 3 && (victim > attacker || attacker === 1)) return true;
  }
  return false;
}

export function classifyMove(inp) {
  const { prev, post, moveUci, moverWhite, boardAfter, ply } = inp;
  const bestLine = prev?.best ?? undefined;
  const bestUci = bestLine?.uci;

  // Both evals to the MOVER's POV.
  const toMover = (cpWhite) => (moverWhite ? cpWhite : -cpWhite);
  const bestMover = toMover(lineCpWhite(bestLine));
  const playedMover = toMover(lineCpWhite(post?.best)); // resulting position, opponent baked in
  const winLoss = Math.max(0, winPct(bestMover) - winPct(playedMover));

  const second = prev?.lines?.[1];
  const secondMover = second ? toMover(lineCpWhite(second)) : null;
  const onlyMove = secondMover != null && winPct(bestMover) - winPct(secondMover) >= 12;

  const isBest = !!bestUci && moveUci === bestUci;
  const sac = isSacrifice(boardAfter);
  const winningBefore = (bestLine?.mate != null && bestLine.mate > 0) || winPct(bestMover) >= 80;
  const stillOkAfter = winPct(playedMover) >= 45;
  const earlySoften = ply <= 6; // §5.5: don't punish normal opening moves

  let cls;
  if (winLoss <= 5) {
    if ((isBest || winLoss <= 2) && sac && winPct(playedMover) >= 45) cls = "brilliant";
    else if ((isBest || winLoss <= 2) && onlyMove) cls = "great";
    else if (isBest) cls = "best";
    else if (winLoss <= 2) cls = "excellent";
    else cls = "good";
  } else if (winLoss <= 10) {
    cls = earlySoften ? "good" : "inaccuracy";
  } else if (winLoss <= 20) {
    cls = earlySoften ? "good" : "mistake";
  } else {
    cls = winningBefore && stillOkAfter ? "miss" : "blunder";
  }

  return { cls, winLoss, bestUci };
}

/* ---------------- Proactive coaching: engine-grounded threat detection ----------------
   Unchanged from the live coach (docs/13 §0.3). We hand the opponent a free tempo (a null
   move), analyze it with the same Stockfish, and flag a threat only if that free move swings
   the eval meaningfully in their favour — measured on the same win% scale we grade moves on,
   so the spoken danger can never contradict the objective eval. */

export const THREAT_BANDS = { minor: 6, warn: 10, alarm: 20 };

/** Give the opponent the move: flip side-to-move, drop en-passant, reset the half-move clock;
 *  castling rights preserved. Returns null on a malformed FEN. */
export function flipSideToMove(fen) {
  const p = fen.split(" ");
  if (p.length < 4) return null;
  p[1] = p[1] === "w" ? "b" : "w";
  p[3] = "-";
  p[4] = "0";
  return p.join(" ");
}

const NO_THREAT = { kind: "none", severity: "none", magnitude: 0, text: "" };

export function computeThreat(inp) {
  const { fen, youWhite, current, nullAnalysis } = inp;
  let board;
  try { board = new Chess(fen); } catch { return NO_THREAT; }
  if (board.isGameOver()) return NO_THREAT;
  if (board.inCheck()) {
    return { kind: "check", severity: "warn", magnitude: 0, text: "you're in check — deal with that first." };
  }
  if (!current?.best || !nullAnalysis?.best) return null; // need both sides of the swing

  const wpYou = (cpWhite) => winPct(youWhite ? cpWhite : -cpWhite);
  const e0 = wpYou(lineCpWhite(current.best));
  const e1 = wpYou(lineCpWhite(nullAnalysis.best));
  const T = e0 - e1;

  const nm = nullAnalysis.best.mate;
  const oppMate = nm != null && (youWhite ? nm < 0 : nm > 0);

  const flipped = flipSideToMove(fen);
  let san, toSq, fromSq;
  let captured = null, isCheck = false;
  const uci = nullAnalysis.best.uci;
  if (uci && flipped) {
    try {
      const m = new Chess(flipped).move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
      if (m) { san = m.san; toSq = m.to; fromSq = m.from; captured = m.captured ?? null; isCheck = m.san.includes("+"); }
    } catch { /* leave undescribed */ }
  }
  const forcing = !!captured || isCheck || oppMate;

  let severity;
  if (oppMate || T >= THREAT_BANDS.alarm) severity = "alarm";
  else if (T >= THREAT_BANDS.warn) severity = "warn";
  else if (T >= THREAT_BANDS.minor) severity = "minor";
  else severity = "none";
  if (!forcing && severity === "warn" && T < 16) severity = "minor";

  if (severity === "none") return { kind: "none", severity: "none", magnitude: T, text: "" };

  let kind, text;
  if (oppMate) {
    kind = "mate";
    text = san ? `${san} threatens mate.` : "there's a forced mate in the air.";
  } else if (captured) {
    kind = "capture";
    text = captured === "p"
      ? `${san} wins a pawn${toSq ? ` on ${toSq}` : ""}.`
      : `${san} wins your ${NAME_FULL[captured] || "piece"}${toSq ? ` on ${toSq}` : ""}.`;
  } else {
    kind = isCheck ? "check" : "threat";
    const payoff = pvPayoff(flipped, nullAnalysis.best.pv);
    if (san && payoff) text = `${san} — then ${payoff.san} wins your ${payoff.piece}.`;
    else if (san) text = `${san} is the real threat here.`;
    else text = "a real threat is building.";
  }
  return { kind, severity, magnitude: T, text, square: toSq, from: fromSq, san };
}

/** Walk the opponent's PV and find the follow-up capture of a real piece — the payoff. */
function pvPayoff(flippedFen, pv) {
  if (!flippedFen || !pv) return null;
  try {
    const c = new Chess(flippedFen);
    const moves = pv.split(" ").filter(Boolean);
    for (let i = 0; i < moves.length && i < 5; i++) {
      const u = moves[i];
      const m = c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] });
      if (!m) break;
      if (i >= 2 && i % 2 === 0 && m.captured && PIECE_VAL[m.captured] >= 3) {
        return { san: m.san, piece: NAME_FULL[m.captured] || "piece" };
      }
    }
  } catch { /* ignore */ }
  return null;
}

/** Accuracy% from a list of per-move win% losses (Lichess-style curve). */
export function accuracy(losses) {
  if (!losses.length) return 100;
  const avg = losses.reduce((a, b) => a + b, 0) / losses.length;
  return Math.max(0, Math.min(100, 103.1668 * Math.exp(-0.04354 * avg) - 3.1669));
}

/* ======================================================================================
   TRAINER ADDITIONS (docs/16) — game phase, Static Exchange Evaluation, and the reliable
   motif detectors. These are pure and geometric; every tag carries a confidence label.
   ====================================================================================== */

/** Portable scalachess Divider: count non-king/non-pawn pieces. ≤6 endgame, ≤10 middlegame,
 *  else opening. Boundaries are conventional but standard. High confidence. */
export function gamePhase(fen) {
  let n = 0;
  const placement = fen.split(" ")[0];
  for (const ch of placement) {
    const l = ch.toLowerCase();
    if (l === "n" || l === "b" || l === "r" || l === "q") n++;
  }
  if (n <= 6) return "endgame";
  if (n <= 10) return "middlegame";
  return "opening";
}

function seeValFor(type, square) {
  // A pawn reaching the last rank is really a queen; value it as such for SEE.
  if (type === "p" && (square[1] === "8" || square[1] === "1")) return SEE_VAL.q;
  return SEE_VAL[type] ?? 0;
}
function placeTypeFor(type, square) {
  return type === "p" && (square[1] === "8" || square[1] === "1") ? "q" : type;
}
const otherColor = (c) => (c === "w" ? "b" : "w");

/**
 * Static Exchange Evaluation on `sq`: the net material (in pawn units) that `side` wins by
 * initiating captures on `sq`, assuming best play and the stand-pat option for both sides.
 * Least-valuable-attacker-first with x-ray unmasking (re-query attackers on the mutated
 * board). Residual blind spots: absolute pins/skewers chess.js won't surface (§6.3) — so
 * hangingPiece is "high, not perfect".
 */
export function see(chess, sq, side) {
  let board;
  try { board = new Chess(chess.fen()); } catch { return 0; }
  const target = board.get(sq);
  if (!target) return 0;
  return seeCapture(board, sq, side, seeValFor(target.type, sq));
}

function seeCapture(board, sq, side, valOnSq) {
  const atkSquares = board.attackers(sq, side);
  if (!atkSquares.length) return 0;
  // pick the least-valuable attacker
  let from = null, fromVal = Infinity, fromType = null;
  for (const a of atkSquares) {
    const p = board.get(a);
    if (!p) continue;
    const v = SEE_VAL[p.type] ?? 0;
    if (v < fromVal) { fromVal = v; from = a; fromType = p.type; }
  }
  if (!from) return 0;
  const target = board.get(sq);
  const placeType = placeTypeFor(fromType, sq);
  // simulate the capture
  board.remove(from);
  board.remove(sq);
  const ok = board.put({ type: placeType, color: side }, sq);
  // value the piece now sitting on sq (what the opponent could win back next)
  const gain = valOnSq - seeCapture(board, sq, otherColor(side), SEE_VAL[placeType] ?? 0);
  // revert exactly
  board.remove(sq);
  if (target) board.put(target, sq);
  board.put({ type: fromType, color: side }, from);
  return ok ? Math.max(0, gain) : Math.max(0, valOnSq);
}

/** The most material the side-to-move can win with a single capture sequence, and where.
 *  Scans every square the side-to-move attacks that holds an enemy piece. */
export function bestCaptureSee(board) {
  const side = board.turn();
  const victim = otherColor(side);
  let best = { see: 0, square: null, piece: null };
  for (const row of board.board()) {
    for (const cell of row) {
      if (!cell || cell.color !== victim) continue;
      if (!board.attackers(cell.square, side).length) continue;
      const s = see(board, cell.square, side);
      if (s > best.see) best = { see: s, square: cell.square, piece: cell.type };
    }
  }
  return best;
}

/**
 * Did applying `uci` to `fen` create a fork? Heuristic (§6.2): the moved piece lands and
 * attacks ≥2 enemy pieces that are each either worth more than the forker OR hanging, and
 * the forker itself isn't capturable for free. Value-gating stops "attacks two pieces" from
 * over-firing. Reliable for the clean case; degrades when targets are defended.
 * Returns { prongs, square } or null.
 */
export function detectFork(fen, uci) {
  if (!uci) return null;
  let board;
  try {
    board = new Chess(fen);
    const mv = board.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
    if (!mv) return null;
  } catch { return null; }
  // board now has the opponent to move; the forking piece sits on uci dest.
  const to = uci.slice(2, 4);
  const forker = board.get(to);
  if (!forker) return null;
  const forkerVal = PIECE_VAL[forker.type];
  const forkerColor = forker.color; // the mover
  const enemy = otherColor(forkerColor);
  // The forking piece must not itself be winnable for free (SEE for the enemy on `to` ≤ 0).
  if (see(board, to, enemy) > 0) return null;

  // Which enemy pieces does the forker attack? chess.js attackers(enemySq, forkerColor)
  // includes every forkerColor attacker; we want those where the attacker IS `to`.
  let prongs = 0;
  for (const row of board.board()) {
    for (const cell of row) {
      if (!cell || cell.color !== enemy || cell.type === "k") continue;
      const attackers = board.attackers(cell.square, forkerColor);
      if (!attackers.includes(to)) continue;
      const targetVal = PIECE_VAL[cell.type];
      const hanging = see(board, cell.square, forkerColor) > 0;
      if (targetVal > forkerVal || hanging) prongs++;
    }
  }
  // Also count a check on the enemy king as a prong (royal fork), if the king is attacked.
  const kingSq = findKing(board, enemy);
  if (kingSq && board.attackers(kingSq, forkerColor).includes(to)) prongs++;

  return prongs >= 2 ? { prongs, square: to } : null;
}

/** Play an engine PV out from `fen` until checkmate (or the line ends); return the checkmate
 *  FEN, or null if the line doesn't reach mate. Used to locate the real back-rank position. */
function playOutMate(fen, pv) {
  if (!fen || !pv) return null;
  let board;
  try { board = new Chess(fen); } catch { return null; }
  for (const u of pv.split(" ").filter(Boolean)) {
    try {
      const m = board.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] });
      if (!m) return null;
    } catch { return null; }
    if (board.isCheckmate()) return board.fen();
  }
  return board.isCheckmate() ? board.fen() : null;
}

function findKing(board, color) {
  for (const row of board.board()) {
    for (const cell of row) {
      if (cell && cell.color === color && cell.type === "k") return cell.square;
    }
  }
  return null;
}

/**
 * Back-rank mate pattern on a mating position. `fen` is checkmate (or we pass a forced-mate
 * position). Heuristic (§6.2): the mated king is on its own back rank, a checker sits on that
 * rank, and the king's forward escapes are blocked by its own pieces. Returns boolean.
 * Caller must gate on a real mate/mate-threat from the engine.
 */
export function isBackRankMate(fen) {
  let board;
  try { board = new Chess(fen); } catch { return false; }
  if (!board.isCheckmate()) return false;
  const mated = board.turn(); // side to move is the one checkmated
  const kingSq = findKing(board, mated);
  if (!kingSq) return false;
  const backRank = mated === "w" ? "1" : "8";
  if (kingSq[1] !== backRank) return false;
  const enemy = otherColor(mated);
  // a checker on the back rank
  const checkers = board.attackers(kingSq, enemy);
  const rankChecker = checkers.some((s) => s[1] === backRank);
  if (!rankChecker) return false;
  // forward escapes (one rank toward the centre) blocked by the king's OWN pieces
  const fwd = mated === "w" ? "2" : "7";
  const file = kingSq.charCodeAt(0);
  let ownBlocks = 0, forwardSquares = 0;
  for (const df of [-1, 0, 1]) {
    const f = String.fromCharCode(file + df);
    if (f < "a" || f > "h") continue;
    forwardSquares++;
    const sq = f + fwd;
    const pc = board.get(sq);
    if (pc && pc.color === mated) ownBlocks++;
  }
  return forwardSquares > 0 && ownBlocks >= 1;
}

/**
 * Tag a confirmed mistake with the reliable motifs (§6.2). Only fires the honest set:
 *   hangingPiece (high) · fork (heuristic) · backRankMate (heuristic) · mate (high).
 * Uses canonical Lichess theme strings so a tag maps straight to sibling puzzles (T3).
 *
 * ctx: { fenBefore, fenAfter, playedUci, bestUci, prev, post, moverColor }
 *   prev/post are PositionAnalysis of the before/after positions (white-POV lines).
 * Returns MotifTag[] = [{ tag, confidence }].
 */
export function tagMistake(ctx) {
  const { fenBefore, fenAfter, playedUci, bestUci, prev, post, moverColor } = ctx;
  const tags = [];
  const add = (tag, confidence) => { if (!tags.some((t) => t.tag === tag)) tags.push({ tag, confidence }); };
  const moverWhite = moverColor === "white" || moverColor === "w";

  // --- mate (high): read straight from the engine. You either allowed a forced mate against
  //     you, or missed a forced mate that was available. The back-rank sub-pattern is checked
  //     on the ACTUAL mate position (play the engine's mating PV out to checkmate). ---
  const postMate = post?.best?.mate; // white-POV mate of the position after your move
  if (postMate != null) {
    const matedIsYou = moverWhite ? postMate < 0 : postMate > 0; // negative-for-you mate
    if (matedIsYou) {
      add("mate", "high");
      const mateFen = playOutMate(fenAfter, post?.best?.pv);
      if (mateFen && isBackRankMate(mateFen)) add("backRankMate", "heuristic");
    }
  }
  const prevMate = prev?.best?.mate; // best line from before was a mate for the mover?
  if (prevMate != null) {
    const mateForYou = moverWhite ? prevMate > 0 : prevMate < 0;
    if (mateForYou && postMate == null) {
      add("mate", "high"); // you had mate and let it slip
      const mateFen = playOutMate(fenBefore, prev?.best?.pv);
      if (mateFen && isBackRankMate(mateFen)) add("backRankMate", "heuristic");
    }
  }

  // --- hangingPiece (high, via SEE): after your move (opponent to move), do you leave
  //     material (≥ an exchange, SEE ≥ 2) takeable? ---
  if (fenAfter) {
    try {
      const board = new Chess(fenAfter); // opponent to move
      const drop = bestCaptureSee(board);
      if (drop.see >= 2) add("hangingPiece", "high");
    } catch { /* ignore */ }
  }

  // --- fork (heuristic): you missed a fork (the best move forks) or walked into one
  //     (the opponent's best reply forks). Suppressed when a mate is involved — a forced mate
  //     is better described as "mate" than as an incidental fork (a mating move geometrically
  //     attacks several squares, which would over-fire the fork detector). ---
  const mateInvolved = tags.some((t) => t.tag === "mate");
  if (!mateInvolved) {
    if (bestUci && detectFork(fenBefore, bestUci)) add("fork", "heuristic");
    if (fenAfter && post?.best?.uci && detectFork(fenAfter, post.best.uci)) add("fork", "heuristic");
  }

  return tags;
}

export { PIECE_VAL, NAME_FULL };
