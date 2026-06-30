import { spawn, execSync } from "node:child_process";
import { existsSync } from "node:fs";

/** Locate a Stockfish (or any UCI) binary on this machine. */
export function findStockfish() {
  if (process.env.STOCKFISH_PATH && existsSync(process.env.STOCKFISH_PATH)) {
    return process.env.STOCKFISH_PATH;
  }
  const candidates = [
    "/opt/homebrew/bin/stockfish",
    "/usr/local/bin/stockfish",
    "/usr/bin/stockfish",
  ];
  for (const c of candidates) if (existsSync(c)) return c;
  try {
    const p = execSync("command -v stockfish", { encoding: "utf8" }).trim();
    if (p && existsSync(p)) return p;
  } catch {
    /* not found */
  }
  return null;
}

function fenTurn(fen) {
  const parts = fen.split(" ");
  return parts[1] === "b" ? "black" : "white";
}

/**
 * A single long-lived UCI engine process. Reused across searches within a
 * session. Reports eval normalized to White's point of view.
 */
export class Engine {
  // config: { options, uciElo } — applied ONCE at init so weight-loading
  // engines (lc0/Maia) don't reload their net on every move.
  constructor(binPath, args = [], config = {}) {
    this.bin = binPath;
    this.args = args || [];
    this.config = config;
    this.proc = null;
    this.buf = "";
    this.listeners = [];
    this.ready = false;
  }

  async init() {
    this.proc = spawn(this.bin, this.args, { stdio: ["pipe", "pipe", "ignore"] });
    this.proc.stdout.on("data", (d) => this._onData(d.toString()));
    this.proc.on("error", () => {});
    this.send("uci");
    await this._waitFor((l) => l === "uciok");
    // Persistent options (Threads/Hash/WeightsFile/Backend + strength limit).
    const opts = { ...(this.config.options || {}) };
    if (this.config.uciElo) {
      opts.UCI_LimitStrength = "true";
      opts.UCI_Elo = this.config.uciElo;
    }
    this.setOptions(opts);
    this.send("isready");
    await this._waitFor((l) => l === "readyok");
    this.ready = true;
  }

  _onData(text) {
    this.buf += text;
    let idx;
    while ((idx = this.buf.indexOf("\n")) >= 0) {
      const line = this.buf.slice(0, idx).trim();
      this.buf = this.buf.slice(idx + 1);
      if (line) for (const fn of [...this.listeners]) fn(line);
    }
  }

  send(cmd) {
    this.proc?.stdin.write(cmd + "\n");
  }

  _waitFor(pred, timeout = 8000) {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => {
        this.listeners = this.listeners.filter((l) => l !== fn);
        reject(new Error("engine timeout"));
      }, timeout);
      const fn = (line) => {
        if (pred(line)) {
          clearTimeout(t);
          this.listeners = this.listeners.filter((l) => l !== fn);
          resolve(line);
        }
      };
      this.listeners.push(fn);
    });
  }

  setOptions(options = {}) {
    for (const [k, v] of Object.entries(options)) {
      this.send(`setoption name ${k} value ${v}`);
    }
  }

  /**
   * Run one search. opts: { options, movetime, nodes, depth, uciElo, onInfo }
   * Resolves { uci, info } where info is the last/best line (white POV).
   */
  async search(fen, opts = {}) {
    const flip = fenTurn(fen) === "black";
    this.send("ucinewgame");
    this.send("isready");
    await this._waitFor((l) => l === "readyok");
    this.send(`position fen ${fen}`);

    let go = "go";
    if (opts.depth) go += ` depth ${opts.depth}`;
    else if (opts.nodes) go += ` nodes ${opts.nodes}`;
    else go += ` movetime ${opts.movetime || 400}`;

    let last = {};
    return new Promise((resolve) => {
      const fn = (line) => {
        if (line.startsWith("info") && line.includes(" pv ")) {
          const info = parseInfo(line, flip);
          last = info;
          opts.onInfo?.(info);
        } else if (line.startsWith("bestmove")) {
          this.listeners = this.listeners.filter((l) => l !== fn);
          const uci = line.split(" ")[1];
          resolve({ uci, info: last });
        }
      };
      this.listeners.push(fn);
      this.send(go);
    });
  }

  /** Interrupt the current search early; it will emit `bestmove` shortly. */
  stop() {
    this.send("stop");
  }

  /**
   * MultiPV analysis for the coach. Returns the top-N lines (white POV),
   * sorted by rank. opts: { multipv, depth, movetime, onUpdate }.
   * Separate from search() so normal play is unaffected.
   */
  async analyze(fen, opts = {}) {
    const flip = fenTurn(fen) === "black";
    const multipv = opts.multipv || 3;
    this.setOptions({ MultiPV: multipv });
    this.send("ucinewgame");
    this.send("isready");
    await this._waitFor((l) => l === "readyok");
    this.send(`position fen ${fen}`);

    let go = "go";
    if (opts.depth) go += ` depth ${opts.depth}`;
    else go += ` movetime ${opts.movetime || 600}`;

    const lines = new Map(); // rank -> info
    return new Promise((resolve) => {
      const fn = (line) => {
        if (line.startsWith("info") && line.includes(" pv ")) {
          const info = parseInfo(line, flip);
          const rank = info.multipv || 1;
          info.uci = info.pv ? info.pv.split(" ")[0] : undefined;
          lines.set(rank, info);
          opts.onUpdate?.(ranked());
        } else if (line.startsWith("bestmove")) {
          this.listeners = this.listeners.filter((l) => l !== fn);
          const r = ranked();
          resolve({ fen, lines: r, best: r[0] || null });
        }
      };
      const ranked = () => [...lines.values()].sort((a, b) => (a.multipv || 1) - (b.multipv || 1));
      this.listeners.push(fn);
      this.send(go);
    });
  }

  quit() {
    try {
      this.send("quit");
      setTimeout(() => this.proc?.kill(), 120);
    } catch {
      this.proc?.kill();
    }
  }
}

function parseInfo(line, flip) {
  const t = line.split(/\s+/);
  const info = {};
  for (let i = 0; i < t.length; i++) {
    switch (t[i]) {
      case "depth": info.depth = +t[++i]; break;
      case "multipv": info.multipv = +t[++i]; break;
      case "nps": info.nps = +t[++i]; break;
      case "nodes": info.nodes = +t[++i]; break;
      case "score":
        if (t[i + 1] === "cp") { info.scoreCp = +t[i + 2] * (flip ? -1 : 1); i += 2; }
        else if (t[i + 1] === "mate") { info.mate = +t[i + 2] * (flip ? -1 : 1); i += 2; }
        break;
      case "pv": info.pv = t.slice(i + 1).join(" "); i = t.length; break;
    }
  }
  return info;
}
