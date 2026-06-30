import { runMatch, scoreFromResult } from "./arena.mjs";
import { pickOpening } from "./openings.mjs";
import { store } from "./store.mjs";
import { recordResult } from "./rating.mjs";

function pgnWithHeaders(white, black, rec) {
  // strip chess.js's own header tags, keep only movetext, prepend clean tags
  const movetext = (rec.pgn || "")
    .split("\n")
    .filter((l) => !l.startsWith("["))
    .join("\n")
    .trim();
  const headers =
    `[Event "Gambit Arena"]\n` +
    `[White "${white.name}"]\n` +
    `[Black "${black.name}"]\n` +
    `[Result "${rec.result}"]\n` +
    `[Termination "${rec.reason}"]\n`;
  return `${headers}\n${movetext} ${rec.result}`;
}

function matchRecord(white, black, rec, movetime) {
  return {
    id: `m_${Date.now()}_${Math.floor(performance.now())}`,
    white: white.id, black: black.id,
    whiteName: white.name, blackName: black.name,
    result: rec.result, reason: rec.reason, moves: rec.moves,
    pgn: rec.pgn, tc: `${movetime}ms/move`,
    date: new Date().toISOString(),
  };
}

function persistGame(white, black, rec, movetime) {
  store.addMatch(matchRecord(white, black, rec, movetime));
  recordResult({
    whiteId: white.id, blackId: black.id,
    result: rec.result, pgn: pgnWithHeaders(white, black, rec),
  });
}

/**
 * Run a multi-game match between two bots. Colors alternate every game, and
 * each reversed-color pair shares one opening (cancels color/opening bias).
 * games = 0 → continuous "pinning" until shouldStop. Each finished game is
 * recorded to the matrix + PGN archive and ratings are recomputed.
 */
const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

export async function runMultiGame({ a, b, games = 1, movetime = 400, useOpenings = true, onGameStart, onMove, onGame, shouldStop }) {
  let scoreA = 0, scoreB = 0, played = 0;
  const limit = !games ? Infinity : games;

  for (let g = 0; g < limit; g++) {
    if (shouldStop?.()) break;
    const aWhite = g % 2 === 0;
    const white = aWhite ? a : b;
    const black = aWhite ? b : a;
    const opening = useOpenings ? pickOpening(g >> 1) : [];

    onGameStart?.({ index: g, white: white.id, black: black.id, fen: START_FEN, total: games });
    const rec = await runMatch({ white, black, movetime, opening, onMove, shouldStop });
    if (shouldStop?.()) {
      // Don't record a game that was cut short mid-stream.
      if (rec.reason === "stopped" || rec.result === "*") break;
    }

    persistGame(white, black, rec, movetime);

    const whiteScore = scoreFromResult(rec.result);
    const aScore = aWhite ? whiteScore : 1 - whiteScore;
    scoreA += aScore;
    scoreB += 1 - aScore;
    played++;

    onGame?.({
      index: g, result: rec.result, reason: rec.reason, moves: rec.moves,
      white: white.id, black: black.id, scoreA, scoreB, played,
    });
  }
  return { scoreA, scoreB, played };
}

/**
 * Round-robin: every selected bot plays every other, gamesPerPair games each
 * (colors alternate, openings shared per pair). Streams pair + game progress;
 * ratings recompute live after each game.
 */
export async function runRoundRobin({ botIds, gamesPerPair = 2, movetime = 400, onPairStart, onGameStart, onMove, onGame, onPairEnd, shouldStop }) {
  const bots = botIds.map((id) => store.bot(id)).filter((b) => b?.installed);
  const pairs = [];
  for (let i = 0; i < bots.length; i++)
    for (let j = i + 1; j < bots.length; j++) pairs.push([bots[i], bots[j]]);

  let index = 0;
  for (const [a, b] of pairs) {
    if (shouldStop?.()) break;
    onPairStart?.({ a: a.id, b: b.id, aName: a.name, bName: b.name, index, total: pairs.length });
    const sum = await runMultiGame({
      a, b, games: gamesPerPair, movetime,
      onGameStart: (g) => onGameStart?.({ ...g, pairIndex: index }),
      onMove, onGame: (g) => onGame?.({ ...g, pairIndex: index }),
      shouldStop,
    });
    onPairEnd?.({ a: a.id, b: b.id, scoreA: sum.scoreA, scoreB: sum.scoreB, index, total: pairs.length });
    index++;
  }
  return { pairs: pairs.length, games: pairs.length * gamesPerPair };
}

function currentElo(id) {
  const r = store.rawRatings().find((x) => x.botId === id);
  return r?.elo ?? store.bot(id)?.prior ?? 1500;
}

/**
 * Gauntlet for a (usually new) bot: play it against the field members closest
 * to its current rating — the most informative games, so it converges fastest.
 */
export async function runGauntlet({ targetId, gamesPerOpponent = 4, movetime = 400, fieldSize = 4, onMove, onGame, onOpponent, shouldStop }) {
  const target = store.bot(targetId);
  if (!target) return { ok: false, error: "unknown bot" };
  const targetElo = currentElo(targetId);

  const field = store.bots()
    .filter((b) => b.id !== targetId && b.installed && (b.kind === "engine" || b.kind === "throttle"))
    .map((b) => ({ b, d: Math.abs(currentElo(b.id) - targetElo) }))
    .sort((x, y) => x.d - y.d)
    .slice(0, fieldSize)
    .map((x) => x.b);

  for (const opp of field) {
    if (shouldStop?.()) break;
    onOpponent?.({ opponent: opp.id, name: opp.name });
    await runMultiGame({ a: target, b: opp, games: gamesPerOpponent, movetime, onMove, onGame, shouldStop });
  }
  return { ok: true, field: field.map((b) => b.id) };
}
