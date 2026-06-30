// The coaching brain: pure functions over engine analysis. No I/O, no React.
// Evals from the server are always WHITE point-of-view; we convert to the
// mover's POV where needed so the same logic works for both colors.
import { Chess } from "chess.js";
import type { AnalysisLine, PositionAnalysis, MoveClass } from "./types";

const PIECE_VAL: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

/** Centipawns → win probability (0..100), chess.com-style logistic. Tunable. */
export function winPct(cp: number): number {
  return 100 / (1 + Math.exp(-0.00368208 * cp));
}

/** White-POV centipawns for a line (mate folded to a large cp). */
export function lineCpWhite(line: AnalysisLine | null | undefined): number {
  if (!line) return 0;
  if (line.mate != null) return line.mate > 0 ? 10000 : -10000;
  return line.scoreCp ?? 0;
}

/** Pretty eval string from white-POV cp/mate, shown from white's POV (+ = white better). */
export function formatEvalWhite(line: AnalysisLine | null | undefined): string {
  if (!line) return "—";
  if (line.mate != null) return `#${line.mate > 0 ? "" : "-"}${Math.abs(line.mate)}`;
  const cp = line.scoreCp ?? 0;
  return `${cp > 0 ? "+" : ""}${(cp / 100).toFixed(2)}`;
}

// Display metadata for each classification (colors tuned to the app palette).
export const CLASS_META: Record<
  MoveClass,
  { label: string; glyph: string; color: string; brush: string }
> = {
  brilliant: { label: "Brilliant", glyph: "!!", color: "#26c2a3", brush: "green" },
  great: { label: "Great", glyph: "!", color: "#5b8baf", brush: "green" },
  best: { label: "Best", glyph: "★", color: "#9bbd6b", brush: "green" },
  excellent: { label: "Excellent", glyph: "", color: "#9bbd6b", brush: "green" },
  good: { label: "Good", glyph: "", color: "#93a972", brush: "green" },
  book: { label: "Book", glyph: "", color: "#a89a7c", brush: "blue" },
  inaccuracy: { label: "Inaccuracy", glyph: "?!", color: "#e6a23c", brush: "yellow" },
  mistake: { label: "Mistake", glyph: "?", color: "#e08b4c", brush: "yellow" },
  miss: { label: "Miss", glyph: "✗", color: "#d08770", brush: "red" },
  blunder: { label: "Blunder", glyph: "??", color: "#c05b5b", brush: "red" },
};

/**
 * Does the just-played move leave material hanging (a sacrifice/offer)?
 * `boardAfter` is positioned with the OPPONENT to move. Heuristic: the opponent
 * can grab a real piece (≥ minor) with a lesser piece or a pawn. Catches the
 * common "give up a piece for an attack/mate" brilliancy; not a full SEE.
 */
function isSacrifice(boardAfter: Chess): boolean {
  for (const m of boardAfter.moves({ verbose: true }) as any[]) {
    if (!m.captured) continue;
    const victim = PIECE_VAL[m.captured];
    const attacker = PIECE_VAL[m.piece];
    if (victim >= 3 && (victim > attacker || attacker === 1)) return true;
  }
  return false;
}

export interface ClassifyInput {
  prev: PositionAnalysis | undefined; // analysis of the position BEFORE the move
  post: PositionAnalysis | undefined; // analysis of the position AFTER the move
  moveUci: string;
  moverWhite: boolean;
  boardAfter: Chess; // position after the move (opponent to move)
  ply: number; // 1-based
}

export interface ClassifyResult {
  cls: MoveClass;
  winLoss: number; // win% lost vs the best move (0..100)
  bestUci?: string;
}

export function classifyMove(inp: ClassifyInput): ClassifyResult {
  const { prev, post, moveUci, moverWhite, boardAfter, ply } = inp;
  const bestLine = prev?.best ?? undefined;
  const bestUci = bestLine?.uci;

  // Both evals to the MOVER's POV.
  const toMover = (cpWhite: number) => (moverWhite ? cpWhite : -cpWhite);
  const bestMover = toMover(lineCpWhite(bestLine));
  const playedMover = toMover(lineCpWhite(post?.best)); // resulting position, opponent baked in
  const winLoss = Math.max(0, winPct(bestMover) - winPct(playedMover));

  const second = prev?.lines?.[1];
  const secondMover = second ? toMover(lineCpWhite(second)) : null;
  const onlyMove = secondMover != null && winPct(bestMover) - winPct(secondMover) >= 12;

  const isBest = !!bestUci && moveUci === bestUci;
  const sac = isSacrifice(boardAfter);
  const winningBefore = (bestLine?.mate != null && bestLine.mate > 0) || winPct(bestMover) >= 80;
  const stillOkAfter = winPct(playedMover) >= 45;
  const earlySoften = ply <= 6; // §5.5: don't punish normal opening moves

  let cls: MoveClass;
  if (winLoss <= 5) {
    if ((isBest || winLoss <= 2) && sac && winPct(playedMover) >= 45) cls = "brilliant";
    else if ((isBest || winLoss <= 2) && onlyMove) cls = "great";
    else if (isBest) cls = "best";
    else if (winLoss <= 2) cls = "excellent";
    else cls = "good";
  } else if (winLoss <= 10) {
    cls = earlySoften ? "good" : "inaccuracy";
  } else if (winLoss <= 20) {
    cls = earlySoften ? "good" : "mistake";
  } else {
    cls = winningBefore && stillOkAfter ? "miss" : "blunder";
  }

  return { cls, winLoss, bestUci };
}

/* ---------------- Proactive coaching: engine-grounded threat detection ----------------
   Studer Step 1 — "what did that move threaten?" — grounded in the SAME full-strength
   Stockfish the coach already runs, NOT a chess.js guess. We hand the opponent the move
   (a null move: flip the side-to-move) and analyze it. A threat is real ONLY if that free
   tempo swings the evaluation meaningfully in the opponent's favour; a bare check or a
   recapturable grab re-evaluates back to ~even and is correctly silent. The move we name
   is the opponent's ENGINE-BEST reply — against full-strength Stockfish, exactly what they
   will play if you let them. (Method: lichess "show threat" + the lichess-puzzler
   play-it-out-and-re-evaluate filter; severity measured on the same win% scale we grade
   moves on, so the spoken danger can never contradict the objective eval.)

   The previous synchronous SEE-lite heuristic — which fired "X would check your king" on
   every harmless check and missed every multi-move tactic — is gone. */

export type ThreatSeverity = "none" | "minor" | "warn" | "alarm";

export interface ThreatInfo {
  kind: "none" | "check" | "capture" | "mate" | "threat";
  severity: ThreatSeverity;
  magnitude: number; // win% points the opponent gains from a free tempo (the eval swing)
  text: string; // grounded one-liner for the alert ("" when none)
  square?: string; // target square of the threatening move (for a board marker)
  from?: string; // origin of the threatening move
  san?: string; // the threatening move in SAN
}

// Severity thresholds in win% points — deliberately mirror the move-classification buckets
// (§5.3: inaccuracy 5 / mistake 10 / blunder 20), so "a threat worth flagging" means
// "letting it happen would cost you a mistake-or-worse swing." Tunable config, not gospel.
export const THREAT_BANDS = { minor: 6, warn: 10, alarm: 20 };

/** Give the opponent the move: flip side-to-move, drop en-passant (illegal after the flip),
 *  reset the half-move clock; castling rights preserved. Returns null on a malformed FEN.
 *  This is the position the coach sends to the engine for null-move threat detection. */
export function flipSideToMove(fen: string): string | null {
  const p = fen.split(" ");
  if (p.length < 4) return null;
  p[1] = p[1] === "w" ? "b" : "w";
  p[3] = "-";
  p[4] = "0";
  return p.join(" ");
}

export interface ThreatInput {
  fen: string; // YOUR-move position
  youWhite: boolean; // is the side to move (you) White?
  current: PositionAnalysis | null; // analysis of `fen` — your best move (gives e0)
  nullAnalysis: PositionAnalysis | null; // analysis of flipSideToMove(fen) — opponent's free move (e1)
}

/**
 * Engine-grounded threat. Returns:
 *   - `null`                    → analyses not both in yet (still thinking); voice shows nothing
 *   - `{ kind: "none", … }`     → confirmed: no real threat (suppress)
 *   - `{ kind, severity, … }`   → a real, eval-backed threat to voice
 */
export function computeThreat(inp: ThreatInput): ThreatInfo | null {
  const { fen, youWhite, current, nullAnalysis } = inp;
  let board: Chess;
  try { board = new Chess(fen); } catch { return NO_THREAT; }
  if (board.isGameOver()) return NO_THREAT;
  // In check, a null move is illegal and the check itself is the concern — say so at once.
  if (board.inCheck()) {
    return { kind: "check", severity: "warn", magnitude: 0, text: "you're in check — deal with that first." };
  }
  if (!current?.best || !nullAnalysis?.best) return null; // need both sides of the swing

  const wpYou = (cpWhite: number) => winPct(youWhite ? cpWhite : -cpWhite);
  const e0 = wpYou(lineCpWhite(current.best)); // your win% when YOU have the move
  const e1 = wpYou(lineCpWhite(nullAnalysis.best)); // your win% if the OPPONENT had the move
  const T = e0 - e1; // the swing: how much a free tempo is worth to them

  // Does the opponent threaten forced mate? (nullAnalysis is white-POV.)
  const nm = nullAnalysis.best.mate;
  const oppMate = nm != null && (youWhite ? nm < 0 : nm > 0);

  // Name the threatening move (the opponent's engine-best reply) and read what it does.
  const flipped = flipSideToMove(fen);
  let san: string | undefined, toSq: string | undefined, fromSq: string | undefined;
  let captured: string | null = null, isCheck = false;
  const uci = nullAnalysis.best.uci;
  if (uci && flipped) {
    try {
      const m = new Chess(flipped).move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
      if (m) { san = m.san; toSq = m.to; fromSq = m.from; captured = m.captured ?? null; isCheck = m.san.includes("+"); }
    } catch { /* leave undescribed */ }
  }
  const forcing = !!captured || isCheck || oppMate;

  // Severity from the swing (mirrors the classification bands). Soften non-forcing
  // positional pressure so mere tension/tempo doesn't read as an alarm.
  let severity: ThreatSeverity;
  if (oppMate || T >= THREAT_BANDS.alarm) severity = "alarm";
  else if (T >= THREAT_BANDS.warn) severity = "warn";
  else if (T >= THREAT_BANDS.minor) severity = "minor";
  else severity = "none";
  if (!forcing && severity === "warn" && T < 16) severity = "minor";

  if (severity === "none") return { kind: "none", severity: "none", magnitude: T, text: "" };

  let kind: ThreatInfo["kind"];
  let text: string;
  if (oppMate) {
    kind = "mate";
    text = san ? `${san} threatens mate.` : "there's a forced mate in the air.";
  } else if (captured) {
    kind = "capture";
    text = captured === "p"
      ? `${san} wins a pawn${toSq ? ` on ${toSq}` : ""}.`
      : `${san} wins your ${NAME_FULL[captured] || "piece"}${toSq ? ` on ${toSq}` : ""}.`;
  } else {
    // A check or quiet move whose payoff lands later in the line — narrate the follow-up
    // (DecodeChess-style "and then …") straight from the engine PV so it stays grounded.
    kind = isCheck ? "check" : "threat";
    const payoff = pvPayoff(flipped, nullAnalysis.best.pv);
    if (san && payoff) text = `${san} — then ${payoff.san} wins your ${payoff.piece}.`;
    else if (san) text = `${san} is the real threat here.`;
    else text = "a real threat is building.";
  }
  return { kind, severity, magnitude: T, text, square: toSq, from: fromSq, san };
}

const NO_THREAT: ThreatInfo = { kind: "none", severity: "none", magnitude: 0, text: "" };

/** Walk the opponent's PV (they move first in the flipped position, so their moves are at
 *  even indices) and find the follow-up capture of a real piece — the threat's payoff. */
function pvPayoff(flippedFen: string | null, pv: string | undefined): { san: string; piece: string } | null {
  if (!flippedFen || !pv) return null;
  try {
    const c = new Chess(flippedFen);
    const moves = pv.split(" ").filter(Boolean);
    for (let i = 0; i < moves.length && i < 5; i++) {
      const u = moves[i];
      const m = c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] });
      if (!m) break;
      if (i >= 2 && i % 2 === 0 && m.captured && PIECE_VAL[m.captured] >= 3) {
        return { san: m.san, piece: NAME_FULL[m.captured] || "piece" };
      }
    }
  } catch { /* ignore */ }
  return null;
}

const NAME_FULL: Record<string, string> = { p: "pawn", n: "knight", b: "bishop", r: "rook", q: "queen", k: "king" };

/** Accuracy% from a list of per-move win% losses (Lichess-style curve). */
export function accuracy(losses: number[]): number {
  if (!losses.length) return 100;
  const avg = losses.reduce((a, b) => a + b, 0) / losses.length;
  return Math.max(0, Math.min(100, 103.1668 * Math.exp(-0.04354 * avg) - 3.1669));
}
