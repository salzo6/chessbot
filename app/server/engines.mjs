import { spawn, execSync } from "node:child_process";
import { copyFileSync, mkdirSync, chmodSync, realpathSync, existsSync } from "node:fs";
import { join } from "node:path";
import { ENGINES_DIR, upsertEngine, loadManifest } from "./store.mjs";

function whichBin(name) {
  try {
    const p = execSync(`command -v ${name}`, { encoding: "utf8" }).trim();
    return p && existsSync(p) ? p : null;
  } catch {
    return null;
  }
}

/** Read "id name <...>" from a UCI engine to capture its version. */
function probeName(bin, args = []) {
  return new Promise((resolve) => {
    let out = "";
    const p = spawn(bin, args, { stdio: ["pipe", "pipe", "ignore"] });
    const done = (v) => {
      try { p.kill("SIGKILL"); } catch {}
      resolve(v);
    };
    const t = setTimeout(() => done(null), 4000);
    p.stdout.on("data", (d) => {
      out += d.toString();
      const m = out.match(/id name (.+)/);
      if (m) { clearTimeout(t); done(m[1].trim()); }
    });
    p.on("error", () => { clearTimeout(t); done(null); });
    p.stdin.write("uci\n");
  });
}

/**
 * Copy a system-installed UCI engine into the managed engines/ folder and
 * register it in the bank. After this the app references the copied binary,
 * not the original system path.
 *
 * spec: { id, name, family?, bin?, systemPath?, args?, accent?, blurb?,
 *         source?, license?, anchor?, elo?, rungs?, options? }
 */
export async function registerSystemEngine(spec) {
  const sys = spec.systemPath || whichBin(spec.bin || spec.id);
  if (!sys) {
    return { ok: false, error: `${spec.name} not found on this system (looked for "${spec.bin || spec.id}").` };
  }
  const src = realpathSync(sys);
  const dir = join(ENGINES_DIR, spec.id);
  mkdirSync(dir, { recursive: true });
  const dest = join(dir, spec.id);
  copyFileSync(src, dest);
  chmodSync(dest, 0o755);

  const args = spec.args || [];
  const probed = await probeName(dest, args);
  const version =
    spec.version ||
    (probed ? probed.replace(new RegExp(`^${spec.name}\\s*`, "i"), "").trim() : "") ||
    "latest";

  const entry = {
    id: spec.id,
    name: spec.name,
    family: spec.family || spec.name,
    version,
    binary: `${spec.id}/${spec.id}`,
    args,
    source: spec.source || "",
    license: spec.license || "—",
    accent: spec.accent || "#7fa6b8",
    blurb: spec.blurb || "",
    anchor: !!spec.anchor,
    elo: spec.elo ?? 1500,
    rungs: spec.rungs || [],
    options: spec.options || {},
    nodes: spec.nodes,
    movetime: spec.movetime,
  };
  upsertEngine(entry);
  return { ok: true, name: probed || spec.name, version, path: dest, installed: existsSync(dest) };
}

/* ---- Known engines this build can register from a Homebrew install ---- */
export const KNOWN_ENGINES = {
  stockfish: {
    id: "stockfish", name: "Stockfish", family: "Stockfish", bin: "stockfish",
    accent: "#7fa6b8", source: "https://github.com/official-stockfish/Stockfish",
    license: "GPL-3.0", anchor: true, elo: 3600, rungs: [2800, 2500, 2000, 1600],
    options: { Threads: 1, Hash: 64 },
    blurb: "The benchmark to beat — alpha-beta + NNUE, the strongest engine in the world. Registered full-strength as the rating anchor, plus throttled rungs for a calibration ladder.",
  },
  "fairy-stockfish": {
    id: "fairy-stockfish", name: "Fairy-Stockfish", family: "Fairy-Stockfish", bin: "fairy-stockfish",
    accent: "#b48ec9", source: "https://github.com/fairy-stockfish/Fairy-Stockfish",
    license: "GPL-3.0", elo: 3450, rungs: [2600, 2000],
    options: { Threads: 1, Hash: 64 },
    blurb: "A Stockfish derivative (UCI-native) built to play many chess variants. Near-SF strength on standard chess — a strong, distinct sparring partner.",
  },
  gnuchess: {
    id: "gnuchess", name: "GNU Chess", family: "GNU Chess", bin: "gnuchess", args: ["--uci"],
    accent: "#93a972", source: "https://www.gnu.org/software/chess/",
    license: "GPL-3.0", elo: 2660, rungs: [],
    options: {},
    blurb: "The classic free engine (~2660 Elo). A genuinely weaker, differently-flavoured opponent — a good mid rung for the ladder.",
  },
};

export async function registerKnown(id) {
  const spec = KNOWN_ENGINES[id];
  if (!spec) return { ok: false, error: `Unknown engine "${id}".` };
  return registerSystemEngine(spec);
}

export async function registerStockfishFromSystem() {
  return registerKnown("stockfish");
}

export function manifestSummary() {
  return (loadManifest().engines || []).map((e) => ({ id: e.id, name: e.name, version: e.version }));
}
