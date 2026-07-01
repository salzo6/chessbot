// The Trainer spine (docs/16 §5) — the background per-ply analysis worker.
//
// On POST /api/games a game is persisted `pending` and enqueued here. A single-worker queue
// analyzes one game at a time with a dedicated full-strength Stockfish (reusing the existing
// Engine.analyze — no new engine logic), walks every ply, classifies each move, tags the
// user's mistakes with the reliable motifs, and persists the eval graph + the mistake ledger.
// It yields the CPU to live play (§5.1 idle discipline) so the two engines don't contend.
import { Chess } from "chess.js";
import { Engine } from "./engine.mjs";
import { store, gamesStore, analysisStore, mistakeStore } from "./store.mjs";
import { classifyMove, lineCpWhite, gamePhase, tagMistake } from "../shared/coachcore.mjs";
import { rebuildWeakness } from "./weakness.mjs";

// Review depth: quality matters more than latency here (§12). Configurable; live coaching
// stays shallow, review goes deep. Default 16 is a sound M1-Pro balance for whole games.
const DEPTH = Number(process.env.TRAIN_DEPTH) || 16;
const MULTIPV = 3;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const nowISO = () => new Date().toISOString();

/* --- idle gate: pause analysis while a live /ws/play search is running (§5.1) --- */
let playBusy = 0;
export function notePlayStart() { playBusy++; }
export function notePlayEnd() { playBusy = Math.max(0, playBusy - 1); }
async function waitForIdle() {
  let guard = 0;
  while (playBusy > 0 && guard < 600) { await sleep(200); guard++; } // cap ~2min so we never wedge
}

/* --- dedicated analysis engine (lazy, long-lived, reused across games) --- */
let engine = null;
async function getEngine() {
  if (engine) return engine;
  const sf = store.bot("stockfish") || store.bots().find((b) => b.kind === "engine" && b.installed);
  if (!sf?.path) throw new Error("no analysis engine installed (need Stockfish)");
  engine = new Engine(sf.path, sf.args, { options: { Threads: 2, Hash: 128 } });
  await engine.init();
  return engine;
}

/* --- the queue --- */
const queue = [];
let running = false;
const progress = new Map(); // gameId -> { ply, total }
export function getProgress(gameId) { return progress.get(gameId) || null; }

export function enqueueGame(gameId) {
  if (!queue.includes(gameId)) queue.push(gameId);
  pump();
}

async function pump() {
  if (running) return;
  running = true;
  try {
    while (queue.length) {
      const gameId = queue.shift();
      try {
        await analyzeGame(gameId);
      } catch (e) {
        gamesStore.update(gameId, { analysisStatus: "error", analysisError: String(e) });
        progress.delete(gameId);
      }
    }
  } finally {
    running = false;
  }
}

/** A terminal position has no engine eval — synthesize one so the mating/stalemating move
 *  isn't misclassified (a delivered checkmate must read as winning, not a 50% blunder). */
function terminalAnalysis(fen) {
  let c;
  try { c = new Chess(fen); } catch { return null; }
  if (!c.isGameOver()) return null;
  let best;
  if (c.isCheckmate()) {
    const whiteToMove = c.turn() === "w"; // the side to move is the one checkmated (lost)
    best = { multipv: 1, scoreCp: whiteToMove ? -10000 : 10000, pv: "", uci: undefined };
  } else {
    best = { multipv: 1, scoreCp: 0, pv: "", uci: undefined }; // stalemate / draw
  }
  return { fen, lines: [best], best };
}

export async function analyzeGame(gameId, opts = {}) {
  const game = gamesStore.get(gameId);
  if (!game) return;
  gamesStore.update(gameId, { analysisStatus: "running" });

  let chess;
  try { chess = new Chess(); chess.loadPgn(game.pgn); }
  catch { gamesStore.update(gameId, { analysisStatus: "error", analysisError: "unparseable pgn" }); return; }

  const moves = chess.history({ verbose: true });
  const total = moves.length;
  if (!total) {
    analysisStore.save(gameId, { gameId, plies: [], analyzedAt: nowISO(), depth: DEPTH });
    gamesStore.update(gameId, { analysisStatus: "done", analyzedAt: nowISO(), mistakeCount: 0 });
    rebuildWeakness(game.userId);
    return;
  }

  const eng = await getEngine();
  const cache = new Map(); // fen -> PositionAnalysis (analyze(after N) === analyze(before N+1))

  async function analyzeFen(fen) {
    if (cache.has(fen)) return cache.get(fen);
    const term = terminalAnalysis(fen);
    if (term) { cache.set(fen, term); return term; }
    await waitForIdle();
    const res = await eng.analyze(fen, { multipv: MULTIPV, depth: DEPTH });
    cache.set(fen, res);
    return res;
  }

  const youColorLetter = game.youColor === "white" ? "w" : "b";
  const plies = [];
  const mistakes = [];

  for (let i = 0; i < moves.length; i++) {
    const mv = moves[i];
    const prev = await analyzeFen(mv.before);
    const post = await analyzeFen(mv.after);
    const ply = i + 1;
    progress.set(gameId, { ply, total });
    opts.onProgress?.({ gameId, ply, total });

    const moverWhite = mv.color === "w";
    let boardAfter;
    try { boardAfter = new Chess(mv.after); } catch { boardAfter = new Chess(); }
    const cr = classifyMove({ prev, post, moveUci: mv.lan, moverWhite, boardAfter, ply });

    const bestUci = prev?.best?.uci;
    let bestSan;
    if (bestUci) {
      try {
        bestSan = new Chess(mv.before).move({ from: bestUci.slice(0, 2), to: bestUci.slice(2, 4), promotion: bestUci[4] })?.san;
      } catch { /* terminal or malformed */ }
    }

    plies.push({
      ply,
      fen: mv.before,
      san: mv.san,
      uci: mv.lan,
      color: moverWhite ? "white" : "black",
      evalCpWhite: lineCpWhite(post?.best),
      mate: post?.best?.mate ?? null,
      bestUci: bestUci || null,
      bestSan: bestSan || null,
      pv: prev?.best?.pv || "",
      winLoss: Math.round(cr.winLoss * 10) / 10,
      cls: cr.cls,
    });

    // Ledger only YOUR mistake/miss/blunder (the axis is exact; motifs carry confidence).
    if (mv.color === youColorLetter && (cr.cls === "mistake" || cr.cls === "miss" || cr.cls === "blunder")) {
      const motifs = tagMistake({
        fenBefore: mv.before, fenAfter: mv.after, playedUci: mv.lan, bestUci,
        prev, post, moverColor: game.youColor,
      });
      mistakes.push({
        id: `${gameId}-${ply}`,
        userId: game.userId,
        gameId,
        ply,
        fenBefore: mv.before,
        playedUci: mv.lan,
        playedSan: mv.san,
        bestUci: bestUci || null,
        bestSan: bestSan || null,
        cls: cr.cls,
        winLoss: Math.round(cr.winLoss * 10) / 10,
        phase: gamePhase(mv.before),
        motifs,
        createdAt: nowISO(),
      });
    }
  }

  analysisStore.save(gameId, { gameId, plies, analyzedAt: nowISO(), depth: DEPTH });
  mistakeStore.replaceForGame(gameId, mistakes);
  gamesStore.update(gameId, { analysisStatus: "done", analyzedAt: nowISO(), mistakeCount: mistakes.length });
  rebuildWeakness(game.userId);
  progress.delete(gameId);
  return { gameId, plies: plies.length, mistakes: mistakes.length };
}

/** On boot, re-enqueue anything left mid-flight (a crash/restart during analysis). */
export function resumePending() {
  for (const g of gamesStore.list(undefined)) {
    if (g.analysisStatus === "pending" || g.analysisStatus === "running") enqueueGame(g.id);
  }
}
