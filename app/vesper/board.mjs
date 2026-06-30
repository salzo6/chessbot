// Vesper — board representation, move generation, make/unmake.
//
// 0x88 board: squares 0..127, a square is on-board iff (sq & 0x88) === 0.
//   file = sq & 7,  rank = sq >> 4   (rank 0 = white's first rank).
//   a1 = 0, h1 = 7, a8 = 112, h8 = 119.
//
// Pieces are encoded as  type | (color << 3):
//   white P..K = 1..6,  black P..K = 9..14,  empty = 0.
//   color = piece >> 3   (0 = white, 1 = black),   type = piece & 7.
//
// Moves are packed into a single integer:
//   from = move & 0x7f,  to = (move >> 7) & 0x7f,  flag = (move >> 14) & 0xf
// using the standard 4-bit move-flag scheme:
//   0 quiet · 1 double-push · 2 O-O · 3 O-O-O · 4 capture · 5 ep-capture
//   8..11  promotion to N,B,R,Q          12..15 promotion-capture to N,B,R,Q
//   (flag & 4) => capture · (flag & 8) => promotion · promo type = (flag & 3) + KNIGHT

export const WHITE = 0, BLACK = 1;
export const PAWN = 1, KNIGHT = 2, BISHOP = 3, ROOK = 4, QUEEN = 5, KING = 6;
export const EMPTY = 0;

// castling-right bits
export const CR_WK = 1, CR_WQ = 2, CR_BK = 4, CR_BQ = 8;

export const A1 = 0, E1 = 4, H1 = 7, A8 = 112, E8 = 116, H8 = 119;

export const makePiece = (color, type) => type | (color << 3);
export const colorOf = (piece) => piece >> 3;
export const typeOf = (piece) => piece & 7;

// move flags
const F_QUIET = 0, F_DOUBLE = 1, F_KCASTLE = 2, F_QCASTLE = 3, F_CAPTURE = 4, F_EP = 5;
const F_PROMO_N = 8; // 8..11 promotions, 12..15 promotion-captures

export const encodeMove = (from, to, flag) => from | (to << 7) | (flag << 14);
export const moveFrom = (m) => m & 0x7f;
export const moveTo = (m) => (m >> 7) & 0x7f;
export const moveFlag = (m) => (m >> 14) & 0xf;
export const isCapture = (m) => (moveFlag(m) & 4) !== 0;
export const isPromotion = (m) => (moveFlag(m) & 8) !== 0;
export const promoType = (m) => (moveFlag(m) & 3) + KNIGHT; // KNIGHT..QUEEN

// the 64 on-board 0x88 squares, in a1..h8 order — for fast scanning
export const VALID = [];
for (let r = 0; r < 8; r++) for (let f = 0; f < 8; f++) VALID.push(r * 16 + f);

// ---- direction offsets ----
const KNIGHT_DIRS = [33, 31, 18, 14, -14, -18, -31, -33];
const KING_DIRS = [16, -16, 1, -1, 17, 15, -15, -17];
const BISHOP_DIRS = [17, 15, -15, -17];
const ROOK_DIRS = [16, -16, 1, -1];

// castle-rights mask per square: AND these to drop rights when a king/rook
// leaves, or a rook is captured on, its home square.
const CASTLE_MASK = new Int8Array(128).fill(0xf);
CASTLE_MASK[A1] = ~CR_WQ & 0xf;
CASTLE_MASK[H1] = ~CR_WK & 0xf;
CASTLE_MASK[E1] = ~(CR_WK | CR_WQ) & 0xf;
CASTLE_MASK[A8] = ~CR_BQ & 0xf;
CASTLE_MASK[H8] = ~CR_BK & 0xf;
CASTLE_MASK[E8] = ~(CR_BK | CR_BQ) & 0xf;

// ---- Zobrist keys (two 32-bit halves; seeded so they're stable per build) ----
function makeRng(seed) {
  let s = seed >>> 0;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s >>> 0;
  };
}
const rng = makeRng(0x9e3779b9);
const Z_PIECE_LO = new Int32Array(15 * 128);
const Z_PIECE_HI = new Int32Array(15 * 128);
for (let i = 0; i < 15 * 128; i++) { Z_PIECE_LO[i] = rng() | 0; Z_PIECE_HI[i] = rng() | 0; }
const Z_SIDE_LO = rng() | 0, Z_SIDE_HI = rng() | 0;
const Z_EP_LO = new Int32Array(8), Z_EP_HI = new Int32Array(8);
for (let i = 0; i < 8; i++) { Z_EP_LO[i] = rng() | 0; Z_EP_HI[i] = rng() | 0; }
const Z_CASTLE_LO = new Int32Array(16), Z_CASTLE_HI = new Int32Array(16);
for (let i = 0; i < 16; i++) { Z_CASTLE_LO[i] = rng() | 0; Z_CASTLE_HI[i] = rng() | 0; }
const zp = (piece, sq) => piece * 128 + sq;

// ---- square <-> string ----
export const sqToString = (sq) => "abcdefgh"[sq & 7] + "12345678"[sq >> 4];
export function stringToSq(s) {
  const f = s.charCodeAt(0) - 97; // 'a'
  const r = s.charCodeAt(1) - 49;  // '1'
  return r * 16 + f;
}

const CHAR_TO_PIECE = {
  P: makePiece(WHITE, PAWN), N: makePiece(WHITE, KNIGHT), B: makePiece(WHITE, BISHOP),
  R: makePiece(WHITE, ROOK), Q: makePiece(WHITE, QUEEN), K: makePiece(WHITE, KING),
  p: makePiece(BLACK, PAWN), n: makePiece(BLACK, KNIGHT), b: makePiece(BLACK, BISHOP),
  r: makePiece(BLACK, ROOK), q: makePiece(BLACK, QUEEN), k: makePiece(BLACK, KING),
};
const PIECE_TO_CHAR = [];
for (const [c, p] of Object.entries(CHAR_TO_PIECE)) PIECE_TO_CHAR[p] = c;
const PROMO_CHAR = { [KNIGHT]: "n", [BISHOP]: "b", [ROOK]: "r", [QUEEN]: "q" };

export const STARTPOS = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

export class Board {
  constructor() {
    this.board = new Int8Array(128);
    this.side = WHITE;
    this.castling = 0;
    this.ep = -1;            // 0x88 square or -1
    this.halfmove = 0;
    this.fullmove = 1;
    this.kingSq = [-1, -1];
    this.hashLo = 0;
    this.hashHi = 0;
    this.history = [];       // make/unmake stack
    this.nullStack = [];
    this.setFen(STARTPOS);
  }

  setFen(fen) {
    this.board.fill(0);
    this.history.length = 0;
    this.nullStack.length = 0;
    const parts = fen.trim().split(/\s+/);
    const rows = parts[0].split("/");
    for (let i = 0; i < 8; i++) {
      const rank = 7 - i; // first FEN row is rank 8
      let file = 0;
      for (const ch of rows[i]) {
        if (ch >= "1" && ch <= "8") file += +ch;
        else { this.board[rank * 16 + file] = CHAR_TO_PIECE[ch]; file++; }
      }
    }
    this.side = (parts[1] || "w") === "b" ? BLACK : WHITE;
    this.castling = 0;
    for (const ch of parts[2] || "-") {
      if (ch === "K") this.castling |= CR_WK;
      else if (ch === "Q") this.castling |= CR_WQ;
      else if (ch === "k") this.castling |= CR_BK;
      else if (ch === "q") this.castling |= CR_BQ;
    }
    this.ep = parts[3] && parts[3] !== "-" ? stringToSq(parts[3]) : -1;
    this.halfmove = parts[4] ? +parts[4] : 0;
    this.fullmove = parts[5] ? +parts[5] : 1;
    this.kingSq = [-1, -1];
    for (const sq of VALID) {
      const p = this.board[sq];
      if (p && typeOf(p) === KING) this.kingSq[colorOf(p)] = sq;
    }
    this._computeHash();
    return this;
  }

  getFen() {
    let s = "";
    for (let i = 0; i < 8; i++) {
      const rank = 7 - i;
      let empty = 0;
      for (let file = 0; file < 8; file++) {
        const p = this.board[rank * 16 + file];
        if (!p) empty++;
        else { if (empty) { s += empty; empty = 0; } s += PIECE_TO_CHAR[p]; }
      }
      if (empty) s += empty;
      if (i < 7) s += "/";
    }
    s += this.side === WHITE ? " w " : " b ";
    let c = "";
    if (this.castling & CR_WK) c += "K";
    if (this.castling & CR_WQ) c += "Q";
    if (this.castling & CR_BK) c += "k";
    if (this.castling & CR_BQ) c += "q";
    s += c || "-";
    s += " " + (this.ep === -1 ? "-" : sqToString(this.ep));
    s += " " + this.halfmove + " " + this.fullmove;
    return s;
  }

  _computeHash() {
    let lo = 0, hi = 0;
    for (const sq of VALID) {
      const p = this.board[sq];
      if (p) { lo ^= Z_PIECE_LO[zp(p, sq)]; hi ^= Z_PIECE_HI[zp(p, sq)]; }
    }
    if (this.side === BLACK) { lo ^= Z_SIDE_LO; hi ^= Z_SIDE_HI; }
    lo ^= Z_CASTLE_LO[this.castling]; hi ^= Z_CASTLE_HI[this.castling];
    if (this.ep !== -1) { const f = this.ep & 7; lo ^= Z_EP_LO[f]; hi ^= Z_EP_HI[f]; }
    this.hashLo = lo | 0; this.hashHi = hi | 0;
  }

  /** Is `sq` attacked by any piece of `by` color? */
  isAttacked(sq, by) {
    const b = this.board;
    // pawns: a `by`-pawn attacks `sq` from the square behind the capture
    if (by === WHITE) {
      let s = sq - 15; if (!(s & 0x88) && b[s] === makePiece(WHITE, PAWN)) return true;
      s = sq - 17; if (!(s & 0x88) && b[s] === makePiece(WHITE, PAWN)) return true;
    } else {
      let s = sq + 15; if (!(s & 0x88) && b[s] === makePiece(BLACK, PAWN)) return true;
      s = sq + 17; if (!(s & 0x88) && b[s] === makePiece(BLACK, PAWN)) return true;
    }
    // knights
    const N = makePiece(by, KNIGHT);
    for (const d of KNIGHT_DIRS) { const s = sq + d; if (!(s & 0x88) && b[s] === N) return true; }
    // king
    const K = makePiece(by, KING);
    for (const d of KING_DIRS) { const s = sq + d; if (!(s & 0x88) && b[s] === K) return true; }
    // bishops / queens (diagonal)
    const B = makePiece(by, BISHOP), Q = makePiece(by, QUEEN);
    for (const d of BISHOP_DIRS) {
      let s = sq + d;
      while (!(s & 0x88)) {
        const p = b[s];
        if (p) { if (p === B || p === Q) return true; break; }
        s += d;
      }
    }
    // rooks / queens (orthogonal)
    const R = makePiece(by, ROOK);
    for (const d of ROOK_DIRS) {
      let s = sq + d;
      while (!(s & 0x88)) {
        const p = b[s];
        if (p) { if (p === R || p === Q) return true; break; }
        s += d;
      }
    }
    return false;
  }

  inCheck(color = this.side) {
    return this.isAttacked(this.kingSq[color], color ^ 1);
  }

  /**
   * Generate pseudo-legal moves into `out` (an array; cleared first).
   * Castling is fully legality-checked here; everything else is filtered
   * lazily by the search via make → inCheck → unmake.
   * If `capturesOnly`, emit only captures and promotions (for quiescence).
   */
  generateMoves(out, capturesOnly = false) {
    out.length = 0;
    const b = this.board;
    const us = this.side, them = us ^ 1;
    const push = (m) => out.push(m);

    for (const from of VALID) {
      const piece = b[from];
      if (!piece || colorOf(piece) !== us) continue;
      const type = piece & 7;

      if (type === PAWN) {
        const fwd = us === WHITE ? 16 : -16;
        const startRank = us === WHITE ? 1 : 6;
        const promoRank = us === WHITE ? 7 : 0;
        const rank = from >> 4;
        // captures (and capture-promotions)
        for (const dc of (us === WHITE ? [15, 17] : [-15, -17])) {
          const to = from + dc;
          if (to & 0x88) continue;
          const tp = b[to];
          if (tp && colorOf(tp) === them) {
            if ((to >> 4) === promoRank) {
              push(encodeMove(from, to, 15)); push(encodeMove(from, to, 14));
              push(encodeMove(from, to, 13)); push(encodeMove(from, to, 12));
            } else push(encodeMove(from, to, F_CAPTURE));
          } else if (to === this.ep && this.ep !== -1) {
            push(encodeMove(from, to, F_EP));
          }
        }
        // pushes
        const one = from + fwd;
        if (!(one & 0x88) && !b[one]) {
          if ((one >> 4) === promoRank) {
            push(encodeMove(from, one, 11)); push(encodeMove(from, one, 10));
            push(encodeMove(from, one, 9)); push(encodeMove(from, one, 8));
          } else if (!capturesOnly) {
            push(encodeMove(from, one, F_QUIET));
            if (rank === startRank) {
              const two = one + fwd;
              if (!b[two]) push(encodeMove(from, two, F_DOUBLE));
            }
          }
        }
        continue;
      }

      if (type === KNIGHT) {
        for (const d of KNIGHT_DIRS) {
          const to = from + d; if (to & 0x88) continue;
          const tp = b[to];
          if (!tp) { if (!capturesOnly) push(encodeMove(from, to, F_QUIET)); }
          else if (colorOf(tp) === them) push(encodeMove(from, to, F_CAPTURE));
        }
        continue;
      }

      if (type === KING) {
        for (const d of KING_DIRS) {
          const to = from + d; if (to & 0x88) continue;
          const tp = b[to];
          if (!tp) { if (!capturesOnly) push(encodeMove(from, to, F_QUIET)); }
          else if (colorOf(tp) === them) push(encodeMove(from, to, F_CAPTURE));
        }
        if (!capturesOnly) this._genCastling(out, us, them);
        continue;
      }

      // sliders: bishop, rook, queen
      const dirs = type === BISHOP ? BISHOP_DIRS : type === ROOK ? ROOK_DIRS : KING_DIRS;
      for (const d of dirs) {
        let to = from + d;
        while (!(to & 0x88)) {
          const tp = b[to];
          if (!tp) { if (!capturesOnly) push(encodeMove(from, to, F_QUIET)); }
          else { if (colorOf(tp) === them) push(encodeMove(from, to, F_CAPTURE)); break; }
          to += d;
        }
      }
    }
  }

  _genCastling(out, us, them) {
    const b = this.board;
    if (us === WHITE) {
      if ((this.castling & CR_WK) && !b[5] && !b[6] &&
          !this.isAttacked(4, them) && !this.isAttacked(5, them) && !this.isAttacked(6, them))
        out.push(encodeMove(4, 6, F_KCASTLE));
      if ((this.castling & CR_WQ) && !b[3] && !b[2] && !b[1] &&
          !this.isAttacked(4, them) && !this.isAttacked(3, them) && !this.isAttacked(2, them))
        out.push(encodeMove(4, 2, F_QCASTLE));
    } else {
      if ((this.castling & CR_BK) && !b[117] && !b[118] &&
          !this.isAttacked(116, them) && !this.isAttacked(117, them) && !this.isAttacked(118, them))
        out.push(encodeMove(116, 118, F_KCASTLE));
      if ((this.castling & CR_BQ) && !b[115] && !b[114] && !b[113] &&
          !this.isAttacked(116, them) && !this.isAttacked(115, them) && !this.isAttacked(114, them))
        out.push(encodeMove(116, 114, F_QCASTLE));
    }
  }

  makeMove(move) {
    const b = this.board;
    const from = move & 0x7f, to = (move >> 7) & 0x7f, flag = (move >> 14) & 0xf;
    const us = this.side, them = us ^ 1;
    const piece = b[from];
    let lo = this.hashLo, hi = this.hashHi;

    this.history.push({
      move, piece, captured: 0,
      castling: this.castling, ep: this.ep, halfmove: this.halfmove,
      fullmove: this.fullmove, hashLo: lo, hashHi: hi,
    });
    const rec = this.history[this.history.length - 1];

    // toggle side, clear old ep + castling from hash
    lo ^= Z_SIDE_LO; hi ^= Z_SIDE_HI;
    if (this.ep !== -1) { const f = this.ep & 7; lo ^= Z_EP_LO[f]; hi ^= Z_EP_HI[f]; }
    lo ^= Z_CASTLE_LO[this.castling]; hi ^= Z_CASTLE_HI[this.castling];

    // lift moving piece off `from`
    lo ^= Z_PIECE_LO[zp(piece, from)]; hi ^= Z_PIECE_HI[zp(piece, from)];
    b[from] = 0;

    // captures
    let captured = 0;
    if (flag === F_EP) {
      const capSq = us === WHITE ? to - 16 : to + 16;
      captured = b[capSq]; b[capSq] = 0;
      lo ^= Z_PIECE_LO[zp(captured, capSq)]; hi ^= Z_PIECE_HI[zp(captured, capSq)];
    } else if (b[to]) {
      captured = b[to];
      lo ^= Z_PIECE_LO[zp(captured, to)]; hi ^= Z_PIECE_HI[zp(captured, to)];
    }
    rec.captured = captured;

    // place piece (promotion changes its type)
    let placed = piece;
    if (flag & 8) placed = makePiece(us, (flag & 3) + KNIGHT);
    b[to] = placed;
    lo ^= Z_PIECE_LO[zp(placed, to)]; hi ^= Z_PIECE_HI[zp(placed, to)];

    // castling rook hop
    if (flag === F_KCASTLE) {
      const rf = us === WHITE ? 7 : 119, rt = us === WHITE ? 5 : 117;
      const rook = b[rf]; b[rt] = rook; b[rf] = 0;
      lo ^= Z_PIECE_LO[zp(rook, rf)] ^ Z_PIECE_LO[zp(rook, rt)];
      hi ^= Z_PIECE_HI[zp(rook, rf)] ^ Z_PIECE_HI[zp(rook, rt)];
    } else if (flag === F_QCASTLE) {
      const rf = us === WHITE ? 0 : 112, rt = us === WHITE ? 3 : 115;
      const rook = b[rf]; b[rt] = rook; b[rf] = 0;
      lo ^= Z_PIECE_LO[zp(rook, rf)] ^ Z_PIECE_LO[zp(rook, rt)];
      hi ^= Z_PIECE_HI[zp(rook, rf)] ^ Z_PIECE_HI[zp(rook, rt)];
    }

    if ((piece & 7) === KING) this.kingSq[us] = to;

    // castling rights
    const newCastle = this.castling & CASTLE_MASK[from] & CASTLE_MASK[to];
    this.castling = newCastle;
    lo ^= Z_CASTLE_LO[newCastle]; hi ^= Z_CASTLE_HI[newCastle];

    // en-passant square (double push only)
    this.ep = flag === F_DOUBLE ? (us === WHITE ? from + 16 : from - 16) : -1;
    if (this.ep !== -1) { const f = this.ep & 7; lo ^= Z_EP_LO[f]; hi ^= Z_EP_HI[f]; }

    if ((piece & 7) === PAWN || captured !== 0) this.halfmove = 0; else this.halfmove++;
    if (us === BLACK) this.fullmove++;
    this.side = them;
    this.hashLo = lo | 0; this.hashHi = hi | 0;
  }

  unmakeMove() {
    const rec = this.history.pop();
    const b = this.board;
    this.side ^= 1;
    const us = this.side;
    this.castling = rec.castling; this.ep = rec.ep;
    this.halfmove = rec.halfmove; this.fullmove = rec.fullmove;
    this.hashLo = rec.hashLo; this.hashHi = rec.hashHi;

    const move = rec.move;
    const from = move & 0x7f, to = (move >> 7) & 0x7f, flag = (move >> 14) & 0xf;
    const piece = rec.piece, captured = rec.captured;

    b[from] = piece;
    b[to] = 0;
    if (flag === F_EP) {
      const capSq = us === WHITE ? to - 16 : to + 16;
      b[capSq] = captured;
    } else if (captured) {
      b[to] = captured;
    }
    if (flag === F_KCASTLE) {
      const rf = us === WHITE ? 7 : 119, rt = us === WHITE ? 5 : 117;
      b[rf] = b[rt]; b[rt] = 0;
    } else if (flag === F_QCASTLE) {
      const rf = us === WHITE ? 0 : 112, rt = us === WHITE ? 3 : 115;
      b[rf] = b[rt]; b[rt] = 0;
    }
    if ((piece & 7) === KING) this.kingSq[us] = from;
  }

  makeNullMove() {
    this.nullStack.push({ ep: this.ep, halfmove: this.halfmove, hashLo: this.hashLo, hashHi: this.hashHi });
    let lo = this.hashLo, hi = this.hashHi;
    lo ^= Z_SIDE_LO; hi ^= Z_SIDE_HI;
    if (this.ep !== -1) { const f = this.ep & 7; lo ^= Z_EP_LO[f]; hi ^= Z_EP_HI[f]; }
    this.ep = -1;
    this.side ^= 1;
    this.halfmove++;
    this.hashLo = lo | 0; this.hashHi = hi | 0;
  }

  unmakeNullMove() {
    const r = this.nullStack.pop();
    this.side ^= 1;
    this.ep = r.ep; this.halfmove = r.halfmove;
    this.hashLo = r.hashLo; this.hashHi = r.hashHi;
  }

  /** Two-fold repetition within the reversible window (search-tree aware). */
  isRepetition() {
    const n = this.history.length;
    const lo = this.hashLo, hi = this.hashHi;
    let count = 0;
    for (let k = 2; k <= this.halfmove && k <= n; k += 2) {
      const rec = this.history[n - k];
      if (rec.hashLo === lo && rec.hashHi === hi) { if (++count >= 1) return true; }
    }
    return false;
  }

  /** Resolve a UCI move string against the legal moves of this position. */
  findMove(uci) {
    const from = stringToSq(uci.slice(0, 2));
    const to = stringToSq(uci.slice(2, 4));
    const promo = uci.length > 4 ? uci[4].toLowerCase() : null;
    const moves = [];
    this.generateMoves(moves);
    for (const m of moves) {
      if (moveFrom(m) !== from || moveTo(m) !== to) continue;
      if (isPromotion(m)) { if (promo && PROMO_CHAR[promoType(m)] !== promo) continue; }
      // verify legality
      this.makeMove(m);
      const legal = !this.isAttacked(this.kingSq[this.side ^ 1], this.side);
      this.unmakeMove();
      if (legal) return m;
    }
    return 0;
  }
}

export function moveToUci(m) {
  const s = sqToString(moveFrom(m)) + sqToString(moveTo(m));
  return isPromotion(m) ? s + PROMO_CHAR[promoType(m)] : s;
}
