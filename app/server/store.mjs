import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync, readdirSync } from "node:fs";
import { dirname, join, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA = join(__dirname, "data");
const PGN_ARCHIVE = join(DATA, "games.pgn"); // append-only permanent record
export const ENGINES_DIR = join(__dirname, "..", "engines");
if (!existsSync(DATA)) mkdirSync(DATA, { recursive: true });
if (!existsSync(ENGINES_DIR)) mkdirSync(ENGINES_DIR, { recursive: true });

const file = (n) => join(DATA, n);
function load(name, fallback) {
  try {
    if (existsSync(file(name))) return JSON.parse(readFileSync(file(name), "utf8"));
  } catch {
    /* ignore */
  }
  writeFileSync(file(name), JSON.stringify(fallback, null, 2));
  return fallback;
}
function save(name, data) {
  writeFileSync(file(name), JSON.stringify(data, null, 2));
}

/* ----------------------------------------------------------------
   The "bank": engines/manifest.json. Each entry is one engine binary
   (living inside engines/, git-ignored) plus the throttle rungs it
   should expose. The whole app reads the registry from here — nothing
   is hardcoded, so dropping a new engine in the folder is all it takes.
   ---------------------------------------------------------------- */
const MANIFEST = join(ENGINES_DIR, "manifest.json");

export function loadManifest() {
  if (!existsSync(MANIFEST)) return { engines: [] };
  try {
    return JSON.parse(readFileSync(MANIFEST, "utf8"));
  } catch {
    return { engines: [] };
  }
}
export function saveManifest(m) {
  writeFileSync(MANIFEST, JSON.stringify(m, null, 2));
}
export function upsertEngine(entry) {
  const m = loadManifest();
  const i = (m.engines || []).findIndex((e) => e.id === entry.id);
  if (i >= 0) m.engines[i] = entry;
  else (m.engines ||= []).push(entry);
  saveManifest(m);
  rebuild();
}

function resolveBinary(e) {
  const b = e.binary;
  if (b) {
    const p = isAbsolute(b) ? b : join(ENGINES_DIR, b);
    if (existsSync(p)) return p;
  }
  if (e.systemPath && existsSync(e.systemPath)) return e.systemPath;
  return null;
}

function buildRegistry() {
  const bots = [];
  for (const e of loadManifest().engines || []) {
    const path = resolveBinary(e);
    const installed = !!path;
    const accent = e.accent || "#7fa6b8";
    const common = {
      family: e.family || e.name,
      source: e.source || "",
      license: e.license || "—",
      installed,
      path: path || undefined,
      args: e.args || [],
      accent,
      options: e.options || {},
      nodes: e.nodes,
      movetime: e.movetime,
    };
    bots.push({
      ...common,
      id: e.id,
      name: e.name,
      version: e.version || "full",
      kind: "engine",
      prior: e.elo ?? 1500,
      anchored: !!e.anchor,
      blurb: e.blurb || "",
    });
    for (const elo of e.rungs || []) {
      bots.push({
        ...common,
        id: `${e.id}-${elo}`,
        name: `${e.name} · ${elo}`,
        version: `${elo} Elo`,
        kind: "throttle",
        baseId: e.id,
        uciElo: elo,
        prior: elo,
        anchored: false,
        blurb: `${e.name} capped to ${elo} Elo via UCI_LimitStrength — a calibration rung.`,
      });
    }
  }
  return bots;
}

let bots = buildRegistry();
let ratings = load("ratings.json", []);
let matches = load("matches.json", []);
// Pairwise results matrix — the permanent source of truth for ratings.
// Keyed "loId|hiId" (ids sorted) → { lo, hi, loWins, draws, hiWins }.
let results = load("results.json", {});

export function rebuild() {
  bots = buildRegistry();
}

function pairKey(a, b) {
  return a < b ? [a, b, false] : [b, a, true];
}

export const store = {
  bots: () => bots,
  bot: (id) => bots.find((b) => b.id === id),
  primaryPath: () => {
    const sf = bots.find((b) => b.kind === "engine" && b.installed);
    return sf?.path || null;
  },
  installedCount: () => bots.filter((b) => b.kind === "engine" && b.installed).length,
  ratings: () => withRanks(ratings),
  matches: () => matches,
  addMatch: (m) => {
    matches.unshift(m);
    matches = matches.slice(0, 200);
    save("matches.json", matches);
  },
  setRatings: (next) => {
    ratings = next;
    save("ratings.json", ratings);
  },
  rawRatings: () => ratings,

  // ---- pairwise results matrix (permanent) ----
  results: () => results,
  recordGame: (whiteId, blackId, result, pgn) => {
    // result: "1-0" | "0-1" | "1/2-1/2"
    const wScore = result === "1-0" ? "w" : result === "0-1" ? "b" : "d";
    const [lo, hi, flipped] = pairKey(whiteId, blackId);
    const key = `${lo}|${hi}`;
    const e = (results[key] ||= { lo, hi, loWins: 0, draws: 0, hiWins: 0 });
    if (wScore === "d") e.draws++;
    else {
      // did the white player win? map white/black → lo/hi
      const whiteIsLo = !flipped;
      const whiteWon = wScore === "w";
      const loWon = whiteIsLo ? whiteWon : !whiteWon;
      if (loWon) e.loWins++;
      else e.hiWins++;
    }
    save("results.json", results);
    if (pgn) appendFileSync(PGN_ARCHIVE, pgn + "\n\n");
  },
  headToHead: (a, b) => {
    const [lo, hi] = pairKey(a, b);
    return results[`${lo}|${hi}`] || { lo, hi, loWins: 0, draws: 0, hiWins: 0 };
  },
};

function withRanks(rs) {
  return [...rs].sort((a, b) => b.elo - a.elo).map((r, i) => ({ ...r, rank: i + 1 }));
}

/* ================================================================
   Trainer stores (docs/16 §4) — purely additive. One file per saved
   game + per-game analysis (keeps individual records small); the hot
   mistake/weakness/drill stores are single JSON blobs for now (the
   flagged SQLite migration is §4, not a day-one need).
   ================================================================ */
const GAMES_DIR = join(DATA, "games");
const ANALYSIS_DIR = join(DATA, "analysis");
for (const d of [GAMES_DIR, ANALYSIS_DIR]) if (!existsSync(d)) mkdirSync(d, { recursive: true });

const readJson = (p, fb) => {
  try { return JSON.parse(readFileSync(p, "utf8")); } catch { return fb; }
};

export const gamesStore = {
  save(game) {
    writeFileSync(join(GAMES_DIR, `${game.id}.json`), JSON.stringify(game, null, 2));
    return game;
  },
  get(id) {
    const p = join(GAMES_DIR, `${id}.json`);
    return existsSync(p) ? readJson(p, null) : null;
  },
  update(id, patch) {
    const g = gamesStore.get(id);
    if (!g) return null;
    const next = { ...g, ...patch };
    return gamesStore.save(next);
  },
  list(userId = "me") {
    return readdirSync(GAMES_DIR)
      .filter((f) => f.endsWith(".json"))
      .map((f) => readJson(join(GAMES_DIR, f), null))
      .filter(Boolean)
      .filter((g) => !userId || g.userId === userId)
      .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
  },
};

export const analysisStore = {
  save(gameId, data) {
    writeFileSync(join(ANALYSIS_DIR, `${gameId}.json`), JSON.stringify(data, null, 2));
  },
  get(gameId) {
    const p = join(ANALYSIS_DIR, `${gameId}.json`);
    return existsSync(p) ? readJson(p, null) : null;
  },
};

let mistakes = load("mistakes.json", []);
export const mistakeStore = {
  all(userId = "me") { return mistakes.filter((m) => !userId || m.userId === userId); },
  forGame(gameId) { return mistakes.filter((m) => m.gameId === gameId); },
  // A game's analysis is idempotent — drop any prior rows for it before inserting fresh ones.
  replaceForGame(gameId, list) {
    mistakes = mistakes.filter((m) => m.gameId !== gameId).concat(list);
    save("mistakes.json", mistakes);
  },
};

let weakness = load("weakness.json", {});
export const weaknessStore = {
  get(userId = "me") { return weakness[userId] || null; },
  set(profile) { weakness[profile.userId] = profile; save("weakness.json", weakness); },
};

// Small per-user settings (the earned puzzle rating — explicitly NOT a chess Elo, §9.4).
let trainMeta = load("train-meta.json", {});
export const trainMetaStore = {
  get(userId = "me") { return trainMeta[userId] || { puzzleRating: 1000 }; },
  set(userId, patch) {
    trainMeta[userId] = { ...(trainMeta[userId] || { puzzleRating: 1000 }), ...patch };
    save("train-meta.json", trainMeta);
    return trainMeta[userId];
  },
};

let drills = load("drills.json", []);
export const drillStore = {
  all(userId = "me") { return drills.filter((d) => !userId || d.userId === userId); },
  get(id) { return drills.find((d) => d.id === id) || null; },
  upsert(item) {
    const i = drills.findIndex((d) => d.id === item.id);
    if (i >= 0) drills[i] = item; else drills.push(item);
    save("drills.json", drills);
    return item;
  },
  bulkUpsert(items) {
    for (const it of items) {
      const i = drills.findIndex((d) => d.id === it.id);
      if (i >= 0) drills[i] = it; else drills.push(it);
    }
    save("drills.json", drills);
  },
};
