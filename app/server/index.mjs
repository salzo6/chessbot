import express from "express";
import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { findStockfish, Engine } from "./engine.mjs";
import { store, gamesStore, analysisStore, mistakeStore, weaknessStore } from "./store.mjs";
import { registerStockfishFromSystem } from "./engines.mjs";
import { runMultiGame, runRoundRobin } from "./match.mjs";
import { enqueueGame, getProgress, resumePending, notePlayStart, notePlayEnd } from "./analysis.mjs";
import { rebuildWeakness } from "./weakness.mjs";
import { dueDrills, gradeDrill, drillStats } from "./drills.mjs";

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
  res.json({
    ok: true,
    stockfish: store.primaryPath(),
    engines: store.installedCount(),
    aiCoach: !!process.env.ANTHROPIC_API_KEY,
  })
);

// Optional, on-demand rich commentary. Off unless ANTHROPIC_API_KEY is set;
// callers fall back to the always-available heuristic explanations. The LLM is
// anchored to engine facts (eval, PV) so it narrates rather than calculates.
app.post("/api/coach/explain", async (req, res) => {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return res.status(503).json({ ok: false, error: "AI coach not configured" });
  try {
    const { fen, san, evalText, bestSan, pv, cls } = req.body || {};
    const prompt =
      `You are a concise chess coach. A move was just played; explain the idea in 1-2 short sentences ` +
      `for a club player. Do NOT contradict the engine facts.\n\n` +
      `FEN (after move): ${fen}\nMove played: ${san} (classified "${cls}")\n` +
      `Engine eval (white POV): ${evalText}\nEngine's preferred line: ${bestSan} — ${pv}\n\n` +
      `Explain plainly what the move does and why it's good or bad. No move lists, no preamble.`;
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 160,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    const data = await r.json();
    const text = data?.content?.[0]?.text?.trim();
    if (!text) return res.status(502).json({ ok: false, error: "no response" });
    res.json({ ok: true, text });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});
/* ---------------- Trainer (docs/16) — all additive, new surfaces ---------------- */
const rand = () => Math.random().toString(36).slice(2, 8);
function newGameId() {
  const d = new Date().toISOString().slice(0, 10);
  return `${d}-${rand()}`;
}

// Persist a finished human game and enqueue background analysis. Returns { gameId }.
app.post("/api/games", (req, res) => {
  try {
    const { pgn, youColor, botId, botName, result, reason, userId } = req.body || {};
    if (!pgn || (youColor !== "white" && youColor !== "black")) {
      return res.status(400).json({ ok: false, error: "pgn and youColor required" });
    }
    const bot = botId ? store.bot(botId) : null;
    const game = {
      id: newGameId(),
      userId: userId || "me",
      pgn: String(pgn),
      youColor,
      botId: botId || "",
      botName: botName || bot?.name || botId || "Opponent",
      result: result || "*",
      reason: reason || "",
      createdAt: new Date().toISOString(),
      analysisStatus: "pending",
    };
    gamesStore.save(game);
    enqueueGame(game.id);
    res.json({ ok: true, gameId: game.id });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

app.get("/api/games", (req, res) => {
  const userId = req.query.userId || "me";
  const list = gamesStore.list(userId).map((g) => ({ ...g, progress: getProgress(g.id) }));
  res.json(list);
});

app.get("/api/games/:id", (req, res) => {
  const g = gamesStore.get(req.params.id);
  if (!g) return res.status(404).json({ ok: false, error: "not found" });
  res.json({ ...g, progress: getProgress(g.id), mistakes: mistakeStore.forGame(g.id) });
});

app.get("/api/games/:id/analysis", (req, res) => {
  const a = analysisStore.get(req.params.id);
  if (!a) return res.status(404).json({ ok: false, error: "no analysis yet" });
  res.json(a);
});

// Re-run analysis for a game (e.g. after a depth change or a failed run).
app.post("/api/games/:id/analyze", (req, res) => {
  const g = gamesStore.get(req.params.id);
  if (!g) return res.status(404).json({ ok: false, error: "not found" });
  gamesStore.update(g.id, { analysisStatus: "pending" });
  enqueueGame(g.id);
  res.json({ ok: true });
});

app.get("/api/train/weakness", (req, res) => {
  const userId = req.query.userId || "me";
  let profile = weaknessStore.get(userId);
  if (!profile) profile = rebuildWeakness(userId);
  res.json(profile);
});

app.get("/api/train/mistakes", (req, res) => {
  const userId = req.query.userId || "me";
  let list = mistakeStore.all(userId);
  if (req.query.motif) list = list.filter((m) => (m.motifs || []).some((t) => t.tag === req.query.motif));
  // newest first, but keep it a flat ledger the dashboard/review can index
  list = [...list].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  res.json(list);
});

// Drilling (T2): due drills, grading (SM-2), stats.
app.get("/api/train/drills/due", (req, res) => {
  const userId = req.query.userId || "me";
  res.json(dueDrills(userId));
});
app.get("/api/train/drills/stats", (req, res) => {
  const userId = req.query.userId || "me";
  res.json(drillStats(userId));
});
app.post("/api/train/drills/:id/review", (req, res) => {
  const userId = req.query.userId || "me";
  const grade = req.body?.grade;
  if (!["again", "hard", "good", "easy"].includes(grade)) {
    return res.status(400).json({ ok: false, error: "grade must be again|hard|good|easy" });
  }
  const r = gradeDrill(req.params.id, grade, userId);
  if (!r) return res.status(404).json({ ok: false, error: "drill not found" });
  res.json({ ok: true, ...r });
});

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
  else if (path === "/ws/coach") handleCoach(ws);
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
    notePlayStart(); // pause any background trainer analysis so the two engines don't contend
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
      notePlayEnd();
    }
  });

  ws.on("close", () => {
    for (const e of engines.values()) e.quit();
    engines.clear();
  });
}

/* ---------------- Coach: independent full-strength MultiPV oracle ---------------- */
// Purely additive: a separate Stockfish instance that judges positions objectively,
// regardless of which (possibly weak) bot the user is actually playing. Never touches
// the play path. Latest-request-wins: a new analyze supersedes the in-flight one.
function handleCoach(ws) {
  const send = (o) => ws.readyState === ws.OPEN && ws.send(JSON.stringify(o));
  let engine = null;
  let inflight = null; // the msg currently being analyzed
  let queued = null; // the latest pending msg (only the newest matters)

  async function getEngine() {
    if (engine) return engine;
    // Always the strongest installed engine — the coach must be objective.
    const sf = store.bot("stockfish") || store.bots().find((b) => b.kind === "engine" && b.installed);
    if (!sf?.path) throw new Error("no analysis engine installed (need Stockfish)");
    engine = new Engine(sf.path, sf.args, { options: { Threads: 2, Hash: 128 } });
    await engine.init();
    return engine;
  }

  async function pump() {
    if (inflight) return; // a pump loop is already draining the queue
    while (queued) {
      const msg = queued;
      queued = null;
      inflight = msg;
      try {
        const eng = await getEngine();
        // A newer request may have arrived during init (when `stop` is a no-op
        // because no search is running yet) — skip straight to the latest.
        if (queued) continue;
        const res = await eng.analyze(msg.fen, {
          multipv: msg.multipv || 3,
          movetime: msg.movetime || 600,
          depth: msg.depth,
          onUpdate: (lines) => send({ type: "line", reqId: msg.reqId, fen: msg.fen, lines }),
        });
        send({ type: "done", reqId: msg.reqId, ...res });
      } catch (e) {
        send({ type: "error", reqId: msg.reqId, error: String(e) });
      } finally {
        inflight = null;
      }
    }
  }

  ws.on("message", (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    if (msg.type === "analyze") {
      queued = msg; // newest wins
      if (inflight) engine?.stop(); // interrupt the stale search; pump() restarts with `queued`
      else pump();
    } else if (msg.type === "cancel") {
      queued = null;
      if (inflight) engine?.stop();
    }
  });

  ws.on("close", () => {
    queued = null;
    engine?.quit();
    engine = null;
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

// Resume any game left mid-analysis by a prior crash/restart (§ resume).
resumePending();

server
  .listen(PORT, () => console.log(`◆ Gambit server on http://localhost:${PORT}`))
  .on("error", (e) => {
    if (e.code === "EADDRINUSE") {
      console.error(`✗ Port ${PORT} is already in use. Free it, or start with PORT=<free port>.`);
      process.exit(1);
    }
    throw e;
  });
