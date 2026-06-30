import express from "express";
import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { findStockfish, Engine } from "./engine.mjs";
import { store } from "./store.mjs";
import { registerStockfishFromSystem } from "./engines.mjs";
import { runMultiGame, runRoundRobin } from "./match.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
// Honor whatever the host/platform assigns; default for local dev.
const PORT = process.env.PORT || process.env.SERVER_PORT || 3001;

console.log(
  store.installedCount()
    ? `✓ ${store.installedCount()} engine(s) registered`
    : "· No engines registered yet — add one from the Library (needs: brew install stockfish)"
);

const app = express();
app.use(express.json());

app.get("/api/health", (_req, res) =>
  res.json({ ok: true, stockfish: store.primaryPath(), engines: store.installedCount() })
);
app.get("/api/bots", (_req, res) => res.json(store.bots()));
app.get("/api/ratings", (_req, res) => res.json(store.ratings()));
app.get("/api/matches", (_req, res) => res.json(store.matches()));
app.get("/api/results", (_req, res) => res.json(store.results()));
app.get("/api/stockfish/install", (_req, res) =>
  res.json({ command: "brew install stockfish", detected: findStockfish() })
);
// Copy the system Stockfish into the managed engines/ folder + register it.
app.post("/api/engines/register-stockfish", async (_req, res) => {
  try {
    const result = await registerStockfishFromSystem();
    res.status(result.ok ? 200 : 400).json(result);
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// Serve built frontend in production
const dist = join(__dirname, "..", "web", "dist");
if (existsSync(dist)) {
  app.use(express.static(dist));
  app.get("*", (_req, res) => res.sendFile(join(dist, "index.html")));
}

const server = createServer(app);
const wss = new WebSocketServer({ server });

wss.on("connection", (ws, req) => {
  const path = (req.url || "").split("?")[0];
  if (path === "/ws/play") handlePlay(ws);
  else if (path === "/ws/arena") handleArena(ws);
  else if (path === "/ws/roundrobin") handleRoundRobin(ws);
  else ws.close();
});

/* ---------------- Play: engine oracle per position ---------------- */
function handlePlay(ws) {
  const engines = new Map(); // key -> Engine
  let busy = false;

  async function engineFor(bot) {
    if (engines.has(bot.id)) return engines.get(bot.id);
    const e = new Engine(bot.path, bot.args, { options: bot.options, uciElo: bot.uciElo });
    await e.init();
    engines.set(bot.id, e);
    return e;
  }

  ws.on("message", async (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    if (msg.type !== "go" || busy) return;
    const bot = store.bot(msg.botId);
    if (!bot?.path) {
      ws.send(JSON.stringify({ type: "error", error: "engine not available" }));
      return;
    }
    busy = true;
    try {
      const eng = await engineFor(bot);
      const { uci } = await eng.search(msg.fen, {
        movetime: bot.movetime || 600,
        nodes: bot.nodes,
        onInfo: (info) => {
          if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: "info", ...info }));
        },
      });
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: "bestmove", uci }));
    } catch (e) {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: "error", error: String(e) }));
    } finally {
      busy = false;
    }
  });

  ws.on("close", () => {
    for (const e of engines.values()) e.quit();
    engines.clear();
  });
}

/* ---------------- Arena: single or multi-game match, streamed ---------------- */
function handleArena(ws) {
  let stopped = false;
  const send = (o) => ws.readyState === ws.OPEN && ws.send(JSON.stringify(o));

  ws.on("message", async (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }

    if (msg.type === "stop") { stopped = true; return; }
    if (msg.type !== "start") return;

    const a = store.bot(msg.white);
    const b = store.bot(msg.black);
    if (!a?.path || !b?.path) {
      send({ type: "error", error: "both engines must be installed" });
      return;
    }

    const games = Math.max(0, Math.min(1000, msg.games ?? 1)); // 0 = continuous
    const movetime = Math.max(50, Math.min(5000, msg.movetime || 400));
    const useOpenings = msg.openings !== false && games !== 1; // single game = clean start

    send({ type: "start", white: a.id, black: b.id, games });

    try {
      const summary = await runMultiGame({
        a, b, games, movetime, useOpenings,
        shouldStop: () => stopped || ws.readyState !== ws.OPEN,
        onGameStart: (g) => send({ type: "gameStart", ...g }),
        onMove: (m) => send({ type: "move", ...m }),
        onGame: (g) => send({ type: "gameEnd", ...g }),
      });
      send({ type: "matchEnd", ...summary, stopped });
    } catch (e) {
      send({ type: "error", error: String(e) });
    }
  });
}

/* ---------------- Round-robin: every bot vs every bot, streamed ---------------- */
function handleRoundRobin(ws) {
  let stopped = false;
  const send = (o) => ws.readyState === ws.OPEN && ws.send(JSON.stringify(o));

  ws.on("message", async (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    if (msg.type === "stop") { stopped = true; return; }
    if (msg.type !== "start") return;

    const botIds = msg.botIds?.length
      ? msg.botIds
      : store.bots().filter((b) => b.kind === "engine" && b.installed).map((b) => b.id);
    const gamesPerPair = Math.max(1, Math.min(50, msg.gamesPerPair || 2));
    const movetime = Math.max(50, Math.min(5000, msg.movetime || 400));

    send({ type: "tournamentStart", bots: botIds, gamesPerPair });
    try {
      const r = await runRoundRobin({
        botIds, gamesPerPair, movetime,
        shouldStop: () => stopped || ws.readyState !== ws.OPEN,
        onPairStart: (p) => send({ type: "pairStart", ...p }),
        onGameStart: (g) => send({ type: "gameStart", ...g }),
        onMove: (m) => send({ type: "move", ...m }),
        onGame: (g) => send({ type: "gameEnd", ...g }),
        onPairEnd: (p) => send({ type: "pairEnd", ...p }),
      });
      send({ type: "tournamentEnd", ...r, stopped });
    } catch (e) {
      send({ type: "error", error: String(e) });
    }
  });
}

server
  .listen(PORT, () => console.log(`◆ Gambit server on http://localhost:${PORT}`))
  .on("error", (e) => {
    if (e.code === "EADDRINUSE") {
      console.error(`✗ Port ${PORT} is already in use. Free it, or start with PORT=<free port>.`);
      process.exit(1);
    }
    throw e;
  });
