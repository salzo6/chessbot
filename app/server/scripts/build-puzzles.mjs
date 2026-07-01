// Build a compact, filtered slice of the Lichess puzzle database (docs/16 §9.3 / §A.4).
//
// The full DB (lichess_db_puzzle.csv, CC0, ~5M rows) is far too large to bundle. This tool
// reads the CSV on stdin, keeps ONLY the themes our mistake tagger emits, across a sensible
// rating range, caps each theme, and writes a small indexed slice to server/data/puzzles.json
// — { theme: [ { fen, moves:[uci...], rating }, ... ] }. It exits as soon as every bucket is
// full, so piping the compressed stream in means only a fraction is ever downloaded.
//
// Usage (only a fraction of the 302MB file is pulled thanks to early-exit):
//   curl -s https://database.lichess.org/lichess_db_puzzle.csv.zst | zstd -d | \
//     node server/scripts/build-puzzles.mjs
//
// Columns: PuzzleId,FEN,Moves,Rating,RatingDeviation,Popularity,NbPlays,Themes,GameUrl,OpeningTags
import { createInterface } from "node:readline";
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA = join(__dirname, "..", "data");
if (!existsSync(DATA)) mkdirSync(DATA, { recursive: true });
const OUT = join(DATA, "puzzles.json");

// The themes our tagger emits (§6.2). Identity map to Lichess theme strings.
const THEMES = ["fork", "hangingPiece", "backRankMate", "mate"];
const PER_THEME = Number(process.env.PER_THEME) || 500; // compact but plenty for sibling variety
const MIN_RATING = 500;
const MAX_RATING = 2400;

const index = Object.fromEntries(THEMES.map((t) => [t, []]));
const full = new Set();

const rl = createInterface({ input: process.stdin });
let lines = 0;
rl.on("line", (line) => {
  lines++;
  if (lines === 1 && line.startsWith("PuzzleId")) return; // header
  const cols = line.split(",");
  if (cols.length < 8) return;
  const fen = cols[1];
  const moves = cols[2].split(" ").filter(Boolean);
  const rating = parseInt(cols[3], 10);
  const themes = cols[7].split(" ");
  if (!fen || moves.length < 2 || !Number.isFinite(rating)) return;
  if (rating < MIN_RATING || rating > MAX_RATING) return;

  for (const t of THEMES) {
    if (full.has(t)) continue;
    if (themes.includes(t)) {
      index[t].push({ fen, moves, rating });
      if (index[t].length >= PER_THEME) full.add(t);
    }
  }
  if (full.size === THEMES.length) { rl.close(); }
});

rl.on("close", () => {
  // sort each theme by rating so the sibling picker's closest-match scan is cheap
  for (const t of THEMES) index[t].sort((a, b) => a.rating - b.rating);
  writeFileSync(OUT, JSON.stringify(index));
  const counts = THEMES.map((t) => `${t}:${index[t].length}`).join("  ");
  console.error(`✓ read ${lines} rows → ${OUT}\n  ${counts}`);
  process.exit(0);
});
