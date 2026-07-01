// Spaced-repetition drilling (docs/16 §9). Drills are sourced from your OWN mistakes (T2);
// motif-sibling puzzles from the Lichess DB come in T3. Scheduler is the verified 4-button
// SM-2 core (§9.1) — three stored numbers + a due date. Documented decision (§9.1): EF is
// updated on EVERY grade (including failures), per the Wikipedia formalization.
import { mistakeStore, drillStore, trainMetaStore } from "./store.mjs";
import { getSiblingPuzzle, puzzleThemeForMotif, hasPuzzleDB } from "./puzzles.mjs";

const DAY = 86400000;
const todayStart = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
const addDays = (n) => new Date(todayStart().getTime() + n * DAY).toISOString();
const nowISO = () => new Date().toISOString();

const MOTIF_LABEL = {
  hangingPiece: "Hung a piece",
  fork: "Fork",
  backRankMate: "Back-rank mate",
  mate: "Forced mate",
};

// Grade → SM-2 quality (§9.1): again→0, hard→3, good→4, easy→5.
const GRADE_Q = { again: 0, hard: 3, good: 4, easy: 5 };

/** The verified SM-2 update. Mutates and returns a shallow-updated drill item. */
export function sm2(item, grade) {
  const q = GRADE_Q[grade] ?? 4;
  let { repetitions = 0, easeFactor = 2.5, intervalDays = 0, lapses = 0, state = "new", isLeech = false } = item;

  if (q >= 3) {
    intervalDays = repetitions === 0 ? 1 : repetitions === 1 ? 6 : Math.round(intervalDays * easeFactor);
    repetitions += 1;
    state = "review";
  } else {
    if (state === "review") lapses += 1;
    repetitions = 0;
    intervalDays = 1;
    state = "relearning";
    if (lapses >= 8) isLeech = true; // Anki default leech threshold (§9.2)
  }

  // EF updated on every grade (recorded decision, §9.1).
  easeFactor = easeFactor + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02));
  if (easeFactor < 1.3) easeFactor = 1.3;

  // Leeches: once a motif keeps failing, stop hammering the identical card — push it out and
  // flag it so the UI can route to an easier sibling / add scaffolding (full diversion in T3).
  if (isLeech && q < 3) intervalDays = Math.max(intervalDays, 4);

  return {
    ...item,
    repetitions,
    easeFactor: Math.round(easeFactor * 1000) / 1000,
    intervalDays,
    lapses,
    isLeech,
    state,
    dueDate: addDays(intervalDays),
    lastReviewed: nowISO(),
  };
}

/** Turn newly-ledgered mistakes into drill cards (idempotent — one card per mistake with a
 *  clear best move). New cards are due immediately. */
export function buildDrillsFromMistakes(userId = "me") {
  const existing = new Set(drillStore.all(userId).map((d) => d.sourceMistakeId).filter(Boolean));
  let built = 0;
  for (const m of mistakeStore.all(userId)) {
    if (!m.bestUci) continue; // no unambiguous answer → not a good puzzle
    if (existing.has(m.id)) continue;
    const motif = (m.motifs && m.motifs[0]?.tag) || "tactic";
    // side to move at the puzzle position = the side who made the mistake (you)
    const sideToMove = m.fenBefore.split(" ")[1] === "w" ? "white" : "black";
    drillStore.upsert({
      id: `drill-${m.id}`,
      userId,
      motif,
      motifLabel: MOTIF_LABEL[motif] || motif,
      sourceMistakeId: m.id,
      gameId: m.gameId,
      fen: m.fenBefore,
      bestUci: m.bestUci,
      bestSan: m.bestSan || undefined,
      playedSan: m.playedSan || undefined,
      origin: "own-game",
      sideToMove,
      repetitions: 0,
      easeFactor: 2.5,
      intervalDays: 0,
      dueDate: addDays(0), // due today
      lapses: 0,
      isLeech: false,
      state: "new",
      createdAt: nowISO(),
    });
    built++;
  }
  return built;
}

/** The motifs the user actually gets wrong, most-frequent first — so siblings are personalized
 *  to real weaknesses (§0.3), never generic puzzle spam. */
function userWeakMotifs(userId = "me") {
  const counts = {};
  for (const m of mistakeStore.all(userId)) for (const t of m.motifs || []) counts[t.tag] = (counts[t.tag] || 0) + 1;
  return Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([k]) => k);
}

function hashFen(fen) {
  let h = 0;
  for (let i = 0; i < fen.length; i++) { h = (h * 31 + fen.charCodeAt(i)) | 0; }
  return (h >>> 0).toString(36);
}

/**
 * Top up motif-sibling drills (§8.3 source 2): for each motif the user is weak in, keep a few
 * DIFFERENT positions with the same theme, at the user's puzzle rating, due for practice. This
 * is the chess-specific twist (§9.2): the SR card is the MOTIF, so we drill the transferable
 * pattern on fresh positions, not the identical blundered one. Idempotent + bounded.
 */
export function buildSiblingDrills(userId = "me") {
  if (!hasPuzzleDB()) return 0;
  const rating = trainMetaStore.get(userId).puzzleRating;
  const all = drillStore.all(userId);
  const TARGET_DUE = 3; // keep ~3 due siblings per weak motif so drilling never runs dry
  const now = Date.now();
  let built = 0;

  for (const motif of userWeakMotifs(userId)) {
    const theme = puzzleThemeForMotif(motif);
    if (!theme) continue;
    const existing = all.filter((d) => d.origin === "lichess" && d.motif === motif);
    const existingFens = new Set(existing.map((d) => d.fen));
    let need = TARGET_DUE - existing.filter((d) => new Date(d.dueDate).getTime() <= now).length;
    let guard = 0;
    while (need > 0 && guard < 25) {
      guard++;
      const sib = getSiblingPuzzle(theme, rating, [...existingFens]);
      if (!sib) break;
      existingFens.add(sib.fen);
      const id = `sib-${theme}-${hashFen(sib.fen)}`;
      if (drillStore.get(id)) continue;
      drillStore.upsert({
        id, userId, motif, motifLabel: MOTIF_LABEL[motif] || motif,
        fen: sib.fen, bestUci: sib.bestUci, bestSan: sib.bestSan, solutionSans: sib.solutionSans,
        origin: "lichess", sideToMove: sib.sideToMove, puzzleRating: sib.rating,
        repetitions: 0, easeFactor: 2.5, intervalDays: 0, dueDate: addDays(0),
        lapses: 0, isLeech: false, state: "new", createdAt: nowISO(),
      });
      built++; need--;
    }
  }
  return built;
}

/** Interleave a due list across motifs (desirable difficulty, §9.2) rather than blocking one
 *  type: round-robin by motif. */
function interleave(items) {
  const byMotif = new Map();
  for (const it of items) {
    if (!byMotif.has(it.motif)) byMotif.set(it.motif, []);
    byMotif.get(it.motif).push(it);
  }
  const buckets = [...byMotif.values()];
  const out = [];
  let added = true;
  while (added) {
    added = false;
    for (const b of buckets) {
      const next = b.shift();
      if (next) { out.push(next); added = true; }
    }
  }
  return out;
}

export function dueDrills(userId = "me") {
  const newlyBuilt = buildDrillsFromMistakes(userId);
  buildSiblingDrills(userId); // top up motif-sibling puzzles for weak motifs (T3)
  const now = Date.now();
  const due = drillStore
    .all(userId)
    .filter((d) => new Date(d.dueDate).getTime() <= now)
    // leeches get a chance to be swapped for an easier sibling of the same theme (T3)
    .map((d) => (d.isLeech ? withSiblingIfAvailable(d) : d));
  const items = interleave(due);
  return { items, puzzleRating: trainMetaStore.get(userId).puzzleRating, newlyBuilt };
}

// If a Lichess sibling exists for a leech's motif at the user's rating, serve THAT position
// instead of hammering the identical one (§9.2 leech rule). No-op until the puzzle DB is
// bundled (T3) — falls back to the own-game position.
function withSiblingIfAvailable(d, userId = "me") {
  const theme = puzzleThemeForMotif(d.motif);
  const rating = trainMetaStore.get(userId).puzzleRating;
  const sib = theme ? getSiblingPuzzle(theme, rating, [d.fen]) : null;
  if (!sib) return d;
  return {
    ...d,
    fen: sib.fen,
    bestUci: sib.bestUci,
    bestSan: sib.bestSan,
    solutionSans: sib.solutionSans,
    origin: "lichess",
    servedSibling: true,
    sideToMove: sib.sideToMove,
  };
}

export function gradeDrill(id, grade, userId = "me") {
  const item = drillStore.get(id);
  if (!item) return null;
  const updated = sm2(item, grade);
  drillStore.upsert(updated);

  // Self-calibrating puzzle rating (Glicko-lite / Elo update, §9.4). Own-game puzzles have no
  // Lichess rating, so we use a nominal difficulty; Lichess siblings (T3) carry a real one.
  const meta = trainMetaStore.get(userId);
  const userR = meta.puzzleRating ?? 1000;
  const puzzleR = item.puzzleRating ?? nominalDifficulty(item);
  const expected = 1 / (1 + Math.pow(10, (puzzleR - userR) / 400));
  const score = grade === "again" ? 0 : 1;
  const K = 24;
  const nextR = Math.round(userR + K * (score - expected));
  trainMetaStore.set(userId, { puzzleRating: Math.max(400, nextR) });

  return { item: updated, puzzleRating: trainMetaStore.get(userId).puzzleRating };
}

function nominalDifficulty(item) {
  // Mate/back-rank patterns skew a touch easier to spot; a bare hung piece easier still.
  if (item.motif === "hangingPiece") return 1100;
  if (item.motif === "mate" || item.motif === "backRankMate") return 1250;
  return 1300;
}

export function drillStats(userId = "me") {
  buildDrillsFromMistakes(userId);
  buildSiblingDrills(userId);
  const all = drillStore.all(userId);
  const now = Date.now();
  return {
    total: all.length,
    due: all.filter((d) => new Date(d.dueDate).getTime() <= now).length,
    leeches: all.filter((d) => d.isLeech).length,
    puzzleRating: trainMetaStore.get(userId).puzzleRating,
  };
}

export function getPuzzleRating(userId = "me") {
  return trainMetaStore.get(userId).puzzleRating;
}
