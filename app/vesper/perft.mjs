// Perft — the move-generator correctness gate. Counts leaf nodes of the legal
// move tree to a fixed depth and compares against published reference values.
// A single mismatch means the generator is wrong (illegal-move loss waiting to
// happen), so this must be green before search/eval matter.

import { Board } from "./board.mjs";

const moveBuffers = [];
function buffer(depth) { return moveBuffers[depth] || (moveBuffers[depth] = []); }

export function perft(board, depth) {
  if (depth === 0) return 1;
  const moves = buffer(depth);
  board.generateMoves(moves);
  let nodes = 0;
  const list = moves.slice(); // snapshot — recursion reuses the shared buffer
  for (const m of list) {
    const mover = board.side;
    board.makeMove(m);
    // legal iff the side that just moved is not left in check
    if (!board.isAttacked(board.kingSq[mover], mover ^ 1)) {
      nodes += depth === 1 ? 1 : perft(board, depth - 1);
    }
    board.unmakeMove();
  }
  return nodes;
}

const SUITE = [
  { name: "startpos", fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
    expect: [1, 20, 400, 8902, 197281, 4865609] },
  { name: "kiwipete", fen: "r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1",
    expect: [1, 48, 2039, 97862, 4085603] },
  { name: "position-3", fen: "8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1",
    expect: [1, 14, 191, 2812, 43238, 674624] },
  { name: "position-4", fen: "r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1",
    expect: [1, 6, 264, 9467, 422333] },
  { name: "position-5", fen: "rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8",
    expect: [1, 44, 1486, 62379] },
  { name: "position-6", fen: "r4rk1/1pp1qppp/p1np1n2/2b1p1B1/2B1P1b1/P1NP1N2/1PP1QPPP/R4RK1 w - - 0 10",
    expect: [1, 46, 2079, 89890] },
];

function run(maxDepth = 5) {
  const board = new Board();
  let allOk = true;
  for (const t of SUITE) {
    board.setFen(t.fen);
    for (let d = 1; d < t.expect.length && d <= maxDepth; d++) {
      const t0 = Date.now();
      const got = perft(board, d);
      const ms = Date.now() - t0;
      const ok = got === t.expect[d];
      allOk &&= ok;
      const nps = ms > 0 ? Math.round(got / ms / 1000) : "—";
      console.log(`${ok ? "ok  " : "FAIL"} ${t.name} d${d}: ${got}` +
        (ok ? `  (${ms}ms, ${nps}k nps)` : `  expected ${t.expect[d]}`));
    }
  }
  console.log(allOk ? "\nALL PERFT OK ✓" : "\nPERFT FAILURES ✗");
  return allOk;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const maxDepth = process.argv[2] ? +process.argv[2] : 5;
  process.exit(run(maxDepth) ? 0 : 1);
}
