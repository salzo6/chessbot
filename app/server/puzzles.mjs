// Bundled Lichess puzzle DB access (docs/16 §9.3, T3). The Lichess puzzle database is open
// (CC0) and theme-tagged with the SAME taxonomy the mistake tagger emits, so a mistake tagged
// `fork` maps straight to `fork`-themed sibling puzzles. We bundle a small FILTERED slice
// (never the whole 5M-row file) indexed by (theme, ratingBand) into server/data/puzzles.json.
//
// Until that slice is built (run scripts/build-puzzles.mjs against lichess_db_puzzle.csv),
// this degrades gracefully to "no siblings" and the drills stay own-game only.
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUZZLE_FILE = join(__dirname, "data", "puzzles.json");

// Map our internal motif tags → Lichess theme strings (same taxonomy; identity for most).
const MOTIF_TO_THEME = {
  hangingPiece: "hangingPiece",
  fork: "fork",
  backRankMate: "backRankMate",
  mate: "mate",
};

let index = null; // { theme: [ {fen, moves:[uci...], rating}, ... sorted by rating ] }
function load() {
  if (index) return index;
  if (!existsSync(PUZZLE_FILE)) { index = {}; return index; }
  try { index = JSON.parse(readFileSync(PUZZLE_FILE, "utf8")); }
  catch { index = {}; }
  return index;
}

export function puzzleThemeForMotif(motif) {
  return MOTIF_TO_THEME[motif] || null;
}

export function hasPuzzleDB() {
  const idx = load();
  return Object.keys(idx).length > 0;
}

/**
 * A theme-matched sibling puzzle near `rating`, excluding any FEN in `excludeFens`. Lichess
 * convention (verified against the DB page): the FIRST move of `Moves` is applied to `FEN` to
 * reach the puzzle's start position; the player then solves from there. So the served FEN is
 * FEN-after-first-move, and the solution is the remaining moves (first of which is bestUci).
 * Returns { fen, bestUci, bestSan, solutionSans, sideToMove, rating } or null.
 */
export function getSiblingPuzzle(theme, rating, excludeFens = []) {
  const idx = load();
  const pool = idx[theme];
  if (!pool || !pool.length) return null;
  const exclude = new Set(excludeFens);

  // pick the puzzle whose rating is closest to the user's, skipping excluded start FENs
  let best = null, bestDelta = Infinity;
  for (const p of pool) {
    const setupFen = applyFirstMove(p.fen, p.moves?.[0]);
    if (!setupFen || exclude.has(setupFen)) continue;
    const delta = Math.abs((p.rating || 1500) - rating);
    if (delta < bestDelta) { bestDelta = delta; best = { p, setupFen }; }
  }
  if (!best) return null;

  const { p, setupFen } = best;
  const solution = (p.moves || []).slice(1); // the moves the solver must find
  const bestUci = solution[0];
  if (!bestUci) return null;
  const sideToMove = setupFen.split(" ")[1] === "w" ? "white" : "black";
  return {
    fen: setupFen,
    bestUci,
    bestSan: uciToSan(setupFen, bestUci),
    solutionSans: solutionToSans(setupFen, solution),
    sideToMove,
    rating: p.rating,
  };
}

// --- helpers (chess.js kept out of the hot path unless a sibling is actually served) ---
import { Chess } from "chess.js";
function applyFirstMove(fen, uci) {
  if (!fen || !uci) return null;
  try {
    const c = new Chess(fen);
    c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
    return c.fen();
  } catch { return null; }
}
function uciToSan(fen, uci) {
  try {
    return new Chess(fen).move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] })?.san;
  } catch { return undefined; }
}
function solutionToSans(fen, ucis) {
  const c = new Chess(fen);
  const out = [];
  for (const u of ucis) {
    try {
      const m = c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] });
      if (!m) break;
      out.push(m.san);
    } catch { break; }
  }
  return out;
}
