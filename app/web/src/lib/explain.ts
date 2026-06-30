// Heuristic, always-available explanations. States what a move *does*, derived
// from concrete board facts + the engine's lines — it never invents motives.
// (An optional LLM layer can replace this for richer prose; see docs/13 §6.3.)
import type { Chess } from "chess.js";
import type { AnalysisLine, MoveClass, PositionAnalysis } from "./types";
import { lineCpWhite, winPct, formatEvalWhite } from "./coach";

const NAME: Record<string, string> = {
  p: "pawn",
  n: "knight",
  b: "bishop",
  r: "rook",
  q: "queen",
  k: "king",
};

export interface ExplainInput {
  move: any; // chess.js verbose move (from the BEFORE position)
  moverWhite: boolean;
  boardAfter: Chess; // position after the move
  prev: PositionAnalysis | undefined;
  post: PositionAnalysis | undefined;
  cls: MoveClass;
  bestSan?: string;
}

function mateFor(line: AnalysisLine | undefined | null, moverWhite: boolean): number | null {
  if (!line || line.mate == null) return null;
  const m = moverWhite ? line.mate : -line.mate; // mover POV
  return m;
}

/** 1–3 short sentences explaining the move. */
export function explainMove(inp: ExplainInput): string[] {
  const { move, moverWhite, boardAfter, prev, post, cls, bestSan } = inp;
  const out: string[] = [];
  const flags: string = move.flags || "";

  // --- What the move concretely does (reliable, board-derived) ---
  if (boardAfter.isCheckmate()) {
    out.push("Checkmate — game over.");
    return out;
  }
  if (move.promotion) out.push(`Promotes to a ${NAME[move.promotion]}.`);
  else if (flags.includes("k")) out.push("Castles kingside — king to safety, rook activated.");
  else if (flags.includes("q")) out.push("Castles queenside — king tucked away, rook to the centre.");
  else if (move.captured) out.push(`Captures the ${NAME[move.captured]} on ${move.to}.`);
  else if (move.piece === "n" || move.piece === "b") {
    if (/[18]/.test(move.from[1])) out.push(`Develops the ${NAME[move.piece]} to ${move.to}.`);
  } else if (move.piece === "p" && (move.to === "e4" || move.to === "d4" || move.to === "e5" || move.to === "d5")) {
    out.push("Stakes a claim in the centre.");
  }
  if (boardAfter.inCheck() && !boardAfter.isCheckmate()) out.push("Gives check.");

  // --- Forcing lines from the engine (mover POV) ---
  const mate = mateFor(post?.best, moverWhite);
  if (mate != null && mate > 0) out.push(`Sets up forced mate in ${mate}.`);
  else if (mate != null && mate < 0) out.push(`But it allows mate in ${Math.abs(mate)}.`);

  // --- Judgment-flavoured commentary ---
  const bestLine = prev?.best;
  if ((cls === "blunder" || cls === "mistake" || cls === "miss" || cls === "inaccuracy") && bestSan) {
    const ev = formatEvalWhite(bestLine);
    if (cls === "miss") out.push(`Misses a stronger continuation — ${bestSan} (${ev}) kept the advantage.`);
    else out.push(`${bestSan} (${ev}) was stronger here.`);
  } else if (cls === "brilliant") {
    out.push("A sacrifice the engine confirms is best — the material comes back with interest.");
  } else if (cls === "great") {
    out.push("Essentially the only move that holds the position together.");
  } else if (cls === "best" && bestLine) {
    const w = winPct(moverWhite ? lineCpWhite(bestLine) : -lineCpWhite(bestLine));
    if (w >= 75) out.push("Keeps a clear, healthy advantage.");
  }

  // Trim to the most useful few.
  return dedupe(out).slice(0, 3);
}

/** A one-line "what should I look at" for the current position (hint flavour). */
export function describeBest(bestSan: string | undefined, line: AnalysisLine | undefined | null): string {
  if (!bestSan) return "Analyzing…";
  return `Strongest move: ${bestSan} (${formatEvalWhite(line)}).`;
}

function dedupe(arr: string[]): string[] {
  return [...new Set(arr)];
}
