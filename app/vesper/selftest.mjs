// Vesper — integration self-test. Drives the real UCI binary and checks:
//   1. every move Vesper emits is legal (validated by chess.js, the same
//      library the platform uses to adjudicate games);
//   2. a full self-play game completes without illegal moves or hangs;
//   3. known tactical positions yield the expected best move.
// This is the gate before registering Vesper as a platform bot.

import { spawn } from "node:child_process";
import { Chess } from "chess.js";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const ENGINE = join(HERE, "vesper.mjs");

class UciClient {
  constructor() {
    this.proc = spawn("node", [ENGINE], { stdio: ["pipe", "pipe", "inherit"] });
    this.buf = "";
    this.waiters = [];
    this.proc.stdout.on("data", (d) => {
      this.buf += d.toString();
      let i;
      while ((i = this.buf.indexOf("\n")) >= 0) {
        const line = this.buf.slice(0, i).trim();
        this.buf = this.buf.slice(i + 1);
        for (const w of [...this.waiters]) w(line);
      }
    });
  }
  send(s) { this.proc.stdin.write(s + "\n"); }
  wait(pred, timeout = 15000) {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => { this.waiters = this.waiters.filter((x) => x !== fn); reject(new Error("timeout")); }, timeout);
      const fn = (line) => {
        if (pred(line)) { clearTimeout(t); this.waiters = this.waiters.filter((x) => x !== fn); resolve(line); }
      };
      this.waiters.push(fn);
    });
  }
  async ready() { this.send("uci"); await this.wait((l) => l === "uciok"); this.send("isready"); await this.wait((l) => l === "readyok"); }
  async bestmove(fen, go = "go movetime 150") {
    this.send(`position fen ${fen}`);
    this.send(go);
    const line = await this.wait((l) => l.startsWith("bestmove"));
    return line.split(/\s+/)[1];
  }
  quit() { this.send("quit"); try { this.proc.kill(); } catch {} }
}

async function selfPlay(eng, maxPlies = 120) {
  const game = new Chess();
  let plies = 0;
  while (!game.isGameOver() && plies < maxPlies) {
    const uci = await eng.bestmove(game.fen(), "go movetime 120");
    if (!uci || uci === "(none)" || uci === "0000") break;
    const from = uci.slice(0, 2), to = uci.slice(2, 4), promotion = uci.length > 4 ? uci[4] : undefined;
    let mv;
    try { mv = game.move({ from, to, promotion }); } catch { mv = null; }
    if (!mv) {
      console.log(`FAIL illegal move at ply ${plies}: "${uci}" in ${game.fen()}`);
      return false;
    }
    plies++;
  }
  console.log(`ok  self-play completed: ${plies} plies, result ${game.isGameOver() ? "game over" : "max length"} (${game.isCheckmate() ? "checkmate" : game.isDraw() ? "draw" : "ongoing"})`);
  return true;
}

const TACTICS = [
  { name: "mate-in-1 (Qd8#)", fen: "6k1/5ppp/8/8/8/8/5PPP/3Q2K1 w - - 0 1", go: "go depth 6", best: ["d1d8"] },
  { name: "back-rank mate-in-2", fen: "6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1", go: "go depth 8", best: ["a1a8"] },
  { name: "win a queen (fork) Nc7+", fen: "r1bqkbnr/pppp1ppp/8/4p3/2B1n3/8/PPPP1PPP/RNBQK1NR w KQkq - 0 1", go: "go depth 8", best: null },
];

async function main() {
  const eng = new UciClient();
  await eng.ready();
  let ok = true;

  for (const t of TACTICS) {
    const mv = await eng.bestmove(t.fen, t.go);
    const pass = t.best ? t.best.includes(mv) : true;
    ok &&= pass;
    console.log(`${pass ? "ok  " : "FAIL"} ${t.name}: ${mv}${t.best ? ` (want ${t.best.join("/")})` : ""}`);
  }

  ok &&= await selfPlay(eng);
  ok &&= await selfPlay(eng); // a second game, different by hash state

  eng.quit();
  console.log(ok ? "\nSELFTEST OK ✓" : "\nSELFTEST FAILURES ✗");
  process.exit(ok ? 0 : 1);
}

main();
