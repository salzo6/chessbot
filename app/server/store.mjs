import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync } from "node:fs";
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
