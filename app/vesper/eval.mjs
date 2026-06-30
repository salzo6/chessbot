// Vesper — evaluation. A tapered hand-crafted eval returned from the
// side-to-move's point of view (negamax convention: positive = good for the
// side to move).
//
// Terms: material + piece-square tables (Michniewski "simplified" set, with a
// separate king middlegame/endgame table interpolated by game phase), bishop
// pair, doubled / isolated / passed pawns, rooks on open & semi-open files, a
// pawn-shield king-safety proxy, and a tempo bonus.
//
// PST orientation: tables are written a8-first (index 0 = a8 … 63 = h1). For a
// white piece on a 0x88 square: idx = (7 - rank) * 8 + file. For black (mirror
// vertically): idx = rank * 8 + file. Black contributions are negated.

import { VALID, WHITE, BLACK, PAWN, KNIGHT, BISHOP, ROOK, QUEEN, KING, colorOf } from "./board.mjs";

export const MATE = 30000;        // mate score base
export const MATE_BOUND = 29000;  // |score| above this is a forced mate

const VAL = { [PAWN]: 100, [KNIGHT]: 320, [BISHOP]: 330, [ROOK]: 500, [QUEEN]: 900, [KING]: 0 };
const PHASE_W = { [KNIGHT]: 1, [BISHOP]: 1, [ROOK]: 2, [QUEEN]: 4 };
const PHASE_MAX = 24;
const TEMPO = 10;

const PST_PAWN = [
   0,  0,  0,  0,  0,  0,  0,  0,
  50, 50, 50, 50, 50, 50, 50, 50,
  10, 10, 20, 30, 30, 20, 10, 10,
   5,  5, 10, 25, 25, 10,  5,  5,
   0,  0,  0, 20, 20,  0,  0,  0,
   5, -5,-10,  0,  0,-10, -5,  5,
   5, 10, 10,-20,-20, 10, 10,  5,
   0,  0,  0,  0,  0,  0,  0,  0,
];
const PST_KNIGHT = [
  -50,-40,-30,-30,-30,-30,-40,-50,
  -40,-20,  0,  0,  0,  0,-20,-40,
  -30,  0, 10, 15, 15, 10,  0,-30,
  -30,  5, 15, 20, 20, 15,  5,-30,
  -30,  0, 15, 20, 20, 15,  0,-30,
  -30,  5, 10, 15, 15, 10,  5,-30,
  -40,-20,  0,  5,  5,  0,-20,-40,
  -50,-40,-30,-30,-30,-30,-40,-50,
];
const PST_BISHOP = [
  -20,-10,-10,-10,-10,-10,-10,-20,
  -10,  0,  0,  0,  0,  0,  0,-10,
  -10,  0,  5, 10, 10,  5,  0,-10,
  -10,  5,  5, 10, 10,  5,  5,-10,
  -10,  0, 10, 10, 10, 10,  0,-10,
  -10, 10, 10, 10, 10, 10, 10,-10,
  -10,  5,  0,  0,  0,  0,  5,-10,
  -20,-10,-10,-10,-10,-10,-10,-20,
];
const PST_ROOK = [
   0,  0,  0,  0,  0,  0,  0,  0,
   5, 10, 10, 10, 10, 10, 10,  5,
  -5,  0,  0,  0,  0,  0,  0, -5,
  -5,  0,  0,  0,  0,  0,  0, -5,
  -5,  0,  0,  0,  0,  0,  0, -5,
  -5,  0,  0,  0,  0,  0,  0, -5,
  -5,  0,  0,  0,  0,  0,  0, -5,
   0,  0,  0,  5,  5,  0,  0,  0,
];
const PST_QUEEN = [
  -20,-10,-10, -5, -5,-10,-10,-20,
  -10,  0,  0,  0,  0,  0,  0,-10,
  -10,  0,  5,  5,  5,  5,  0,-10,
   -5,  0,  5,  5,  5,  5,  0, -5,
    0,  0,  5,  5,  5,  5,  0, -5,
  -10,  5,  5,  5,  5,  5,  0,-10,
  -10,  0,  5,  0,  0,  0,  0,-10,
  -20,-10,-10, -5, -5,-10,-10,-20,
];
const PST_KING_MG = [
  -30,-40,-40,-50,-50,-40,-40,-30,
  -30,-40,-40,-50,-50,-40,-40,-30,
  -30,-40,-40,-50,-50,-40,-40,-30,
  -30,-40,-40,-50,-50,-40,-40,-30,
  -20,-30,-30,-40,-40,-30,-30,-20,
  -10,-20,-20,-20,-20,-20,-20,-10,
   20, 20,  0,  0,  0,  0, 20, 20,
   20, 30, 10,  0,  0, 10, 30, 20,
];
const PST_KING_EG = [
  -50,-40,-30,-20,-20,-30,-40,-50,
  -30,-20,-10,  0,  0,-10,-20,-30,
  -30,-10, 20, 30, 30, 20,-10,-30,
  -30,-10, 30, 40, 40, 30,-10,-30,
  -30,-10, 30, 40, 40, 30,-10,-30,
  -30,-10, 20, 30, 30, 20,-10,-30,
  -30,-30,  0,  0,  0,  0,-30,-30,
  -50,-30,-30,-30,-30,-30,-30,-50,
];
const PST = { [PAWN]: PST_PAWN, [KNIGHT]: PST_KNIGHT, [BISHOP]: PST_BISHOP, [ROOK]: PST_ROOK, [QUEEN]: PST_QUEEN };

const PASSED = [0, 5, 10, 20, 35, 60, 100, 0]; // by rank from own side

const wIdx = (sq) => (7 - (sq >> 4)) * 8 + (sq & 7);
const bIdx = (sq) => (sq >> 4) * 8 + (sq & 7);

/** Static evaluation in centipawns, from the side-to-move's perspective. */
export function evaluate(board) {
  const b = board.board;
  let score = 0;     // white POV
  let phase = 0;

  // pawn bookkeeping
  const pawnCount = [[0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0]];
  const whiteMinRank = [8, 8, 8, 8, 8, 8, 8, 8];   // most-advanced white pawn per file
  const blackMaxRank = [-1, -1, -1, -1, -1, -1, -1, -1]; // most-advanced black pawn per file
  const pawnSq = [[], []];
  const rookSq = [[], []];
  let bishops0 = 0, bishops1 = 0;

  for (const sq of VALID) {
    const p = b[sq];
    if (!p) continue;
    const c = p >> 3, t = p & 7, f = sq & 7, r = sq >> 4;
    const idx = c === WHITE ? wIdx(sq) : bIdx(sq);
    const sign = c === WHITE ? 1 : -1;
    if (t === KING) continue; // king handled after phase is known
    if (t !== PAWN) phase += PHASE_W[t];
    score += sign * (VAL[t] + PST[t][idx]);
    if (t === PAWN) {
      pawnCount[c][f]++;
      pawnSq[c].push(sq);
      if (c === WHITE) { if (r < whiteMinRank[f]) whiteMinRank[f] = r; }
      else { if (r > blackMaxRank[f]) blackMaxRank[f] = r; }
    } else if (t === BISHOP) {
      if (c === WHITE) bishops0++; else bishops1++;
    } else if (t === ROOK) {
      rookSq[c].push(sq);
    }
  }
  if (phase > PHASE_MAX) phase = PHASE_MAX;

  // kings (tapered mg/eg)
  for (const c of [WHITE, BLACK]) {
    const ksq = board.kingSq[c];
    const idx = c === WHITE ? wIdx(ksq) : bIdx(ksq);
    const kval = ((PST_KING_MG[idx] * phase) + (PST_KING_EG[idx] * (PHASE_MAX - phase))) / PHASE_MAX;
    score += (c === WHITE ? 1 : -1) * kval;
  }

  // bishop pair
  if (bishops0 >= 2) score += 30;
  if (bishops1 >= 2) score -= 30;

  // pawn structure: doubled, isolated, passed
  for (const c of [WHITE, BLACK]) {
    const sign = c === WHITE ? 1 : -1;
    const mine = pawnCount[c];
    for (let f = 0; f < 8; f++) {
      const cnt = mine[f];
      if (cnt === 0) continue;
      if (cnt > 1) score += sign * -8 * (cnt - 1);        // doubled
      const leftEmpty = f === 0 || mine[f - 1] === 0;
      const rightEmpty = f === 7 || mine[f + 1] === 0;
      if (leftEmpty && rightEmpty) score += sign * -15 * cnt; // isolated
    }
    for (const sq of pawnSq[c]) {
      const f = sq & 7, r = sq >> 4;
      let passed = true;
      for (let g = f - 1; g <= f + 1; g++) {
        if (g < 0 || g > 7) continue;
        if (c === WHITE) { if (blackMaxRank[g] > r) { passed = false; break; } }
        else { if (whiteMinRank[g] < r) { passed = false; break; } }
      }
      if (passed) {
        const relRank = c === WHITE ? r : 7 - r;
        score += sign * PASSED[relRank];
      }
    }
  }

  // rooks on open / semi-open files
  for (const c of [WHITE, BLACK]) {
    const sign = c === WHITE ? 1 : -1;
    const them = c ^ 1;
    for (const rsq of rookSq[c]) {
      const f = rsq & 7;
      if (pawnCount[c][f] === 0) score += sign * (pawnCount[them][f] === 0 ? 20 : 10);
    }
  }

  // king pawn shield (middlegame-weighted)
  for (const c of [WHITE, BLACK]) {
    const kf = board.kingSq[c] & 7;
    let missing = 0;
    for (let g = kf - 1; g <= kf + 1; g++) {
      if (g < 0 || g > 7) continue;
      if (pawnCount[c][g] === 0) missing++;
    }
    const pen = (missing * 12 * phase) / PHASE_MAX;
    score += (c === WHITE ? -1 : 1) * pen;
  }

  const stm = board.side === WHITE ? score : -score;
  return Math.round(stm) + TEMPO;
}
