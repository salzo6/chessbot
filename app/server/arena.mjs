import { Chess } from "chess.js";
import { Engine } from "./engine.mjs";

const MAX_PLY = 400;

/**
 * Play one full game between two bots, streaming each move.
 * white/black are bot registry entries: { path, uciElo?, name }.
 * Calls onMove({ uci, san, fen, turn, ply, scoreCp, mate, depth }) per move,
 * resolves with the finished match record.
 */
export async function runMatch({ white, black, movetime = 400, opening = [], onMove, shouldStop }) {
  const game = new Chess();
  const we = new Engine(white.path, white.args, { options: white.options, uciElo: white.uciElo });
  const be = new Engine(black.path, black.args, { options: black.options, uciElo: black.uciElo });
  await we.init();
  await be.init();

  try {
    // Play the book opening first (same line for both sides of a pair).
    for (const uci of opening) {
      const from = uci.slice(0, 2);
      const to = uci.slice(2, 4);
      const promotion = uci.length > 4 ? uci[4] : undefined;
      let m;
      try { m = game.move({ from, to, promotion }); } catch { m = null; }
      if (!m) break;
      onMove?.({
        uci, san: m.san, fen: game.fen(),
        turn: game.turn() === "w" ? "white" : "black",
        ply: game.history().length, book: true,
      });
    }

    while (!game.isGameOver() && game.history().length < MAX_PLY) {
      if (shouldStop?.()) break;
      const whiteToMove = game.turn() === "w";
      const eng = whiteToMove ? we : be;
      const bot = whiteToMove ? white : black;

      const { uci, info } = await eng.search(game.fen(), {
        movetime,
        nodes: bot.nodes,
      });

      if (!uci || uci === "(none)" || uci === "0000") break;

      const from = uci.slice(0, 2);
      const to = uci.slice(2, 4);
      const promotion = uci.length > 4 ? uci[4] : undefined;
      let move;
      try {
        move = game.move({ from, to, promotion });
      } catch {
        move = null;
      }
      if (!move) break; // engine produced an illegal move — abort

      onMove?.({
        uci,
        san: move.san,
        fen: game.fen(),
        turn: game.turn() === "w" ? "white" : "black",
        ply: game.history().length,
        scoreCp: info?.scoreCp,
        mate: info?.mate,
        depth: info?.depth,
      });
    }

    const { result, reason } = adjudicate(game);
    return {
      result,
      reason,
      moves: game.history().length,
      pgn: game.pgn(),
      fen: game.fen(),
    };
  } finally {
    we.quit();
    be.quit();
  }
}

function adjudicate(game) {
  if (game.isCheckmate()) {
    // side to move is mated → the other side won
    const whiteMated = game.turn() === "w";
    return { result: whiteMated ? "0-1" : "1-0", reason: "checkmate" };
  }
  if (game.isStalemate()) return { result: "1/2-1/2", reason: "stalemate" };
  if (game.isInsufficientMaterial()) return { result: "1/2-1/2", reason: "insufficient material" };
  if (game.isThreefoldRepetition()) return { result: "1/2-1/2", reason: "threefold repetition" };
  if (game.isDraw()) return { result: "1/2-1/2", reason: "fifty-move rule" };
  return { result: "1/2-1/2", reason: "adjudicated · max length" };
}

export function scoreFromResult(result) {
  if (result === "1-0") return 1;
  if (result === "0-1") return 0;
  return 0.5;
}
