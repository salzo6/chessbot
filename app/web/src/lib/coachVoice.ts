// The coach's "personality": turns raw analysis state into something Marcus
// would actually say, with a mood that drives his avatar's expression. Pure
// functions — the panel renders whatever beat this produces.
import type { Color, MoveJudgment } from "./types";
import type { ThreatInfo } from "./coach";

export type Mood = "neutral" | "thinking" | "happy" | "proud" | "worried" | "alarmed";

export const COACH_NAME = "Marcus";

// ring = avatar border + bubble accent; label = status word under the name.
export const MOODS: Record<Mood, { ring: string; tint: string; label: string }> = {
  neutral: { ring: "#8a8172", tint: "#8a8172", label: "watching" },
  thinking: { ring: "#c8a35b", tint: "#c8a35b", label: "thinking" },
  happy: { ring: "#93a972", tint: "#93a972", label: "pleased" },
  proud: { ring: "#26c2a3", tint: "#26c2a3", label: "impressed" },
  worried: { ring: "#e08b4c", tint: "#e08b4c", label: "concerned" },
  alarmed: { ring: "#c05b5b", tint: "#c05b5b", label: "alarmed" },
};

export interface Beat {
  key: string; // identity — same key = same coaching beat (updates in place)
  mood: Mood;
  text: string;
  fromYou?: boolean; // a reaction to YOUR move (right-aligned in the feed)
}

export interface BeatCtx {
  fen: string;
  gameOver: boolean;
  pacing: boolean;
  yourTurn: boolean;
  threats: ThreatInfo | null;
  judgment: MoveJudgment | null;
  myColor: Color;
  yourWinPct: number | null; // objective win% from your POV — keeps the spoken line eval-consistent
}

export function currentBeat(c: BeatCtx): Beat | null {
  const { fen, gameOver, pacing, yourTurn, threats, judgment, myColor, yourWinPct } = c;
  if (!fen) return null;

  if (gameOver) {
    return {
      key: fen + "|over",
      mood: "neutral",
      text: "Good game. Let's review it together — step back through with ← → and I'll walk you through the turning points.",
    };
  }

  // You've moved; the bot's reply is held while I weigh in.
  if (pacing) {
    if (judgment && judgment.color === myColor) {
      const r = reactToYour(judgment);
      return { key: fen + "|react", mood: r.mood, text: r.text, fromYou: true };
    }
    return { key: fen + "|react", mood: "thinking", text: "Let me take a look at that…", fromYou: true };
  }

  // Your turn — the opponent just moved.
  if (yourTurn) {
    const oppBad =
      judgment &&
      judgment.color !== myColor &&
      (judgment.cls === "blunder" || judgment.cls === "mistake" || judgment.cls === "miss");
    if (oppBad) {
      return {
        key: fen + "|turn",
        mood: "happy",
        text: `Your opponent slipped with ${judgment!.san} — there's a way to make them pay. Can you find it?`,
      };
    }

    const lead: string[] = [];
    if (judgment && judgment.color !== myColor && judgment.explanation?.length) {
      lead.push(opponentLine(judgment));
    }
    let mood: Mood = "neutral";
    if (threats === null) {
      // The threat search is still running — don't assert "no threats" yet (that would flicker
      // to a warning a beat later). Acknowledge and let the bubble morph in place once it lands.
      if (lead.length === 0) lead.push("Your move. Let me see what they're up to…");
    } else if (threats.kind !== "none") {
      // Mood tracks the THREAT'S magnitude (severity), not merely that a check exists — so a
      // harmless check never reads as danger, and a real one reads as real.
      mood = threats.severity === "alarm" ? "alarmed" : threats.severity === "warn" ? "worried" : "neutral";
      lead.push(threatLead(threats));
    } else {
      // Confirmed: no real threat. Keep the spoken line consistent with the objective eval —
      // never "quiet, make a plan" when you're actually winning or being crushed.
      lead.push(quietLine(fen, yourWinPct));
    }
    return { key: fen + "|turn", mood, text: lead.join(" ") };
  }

  // Opponent is thinking — say nothing (no stale "thinking" bubble piling up in
  // the feed); the avatar simply keeps its last expression.
  return null;
}

// Persona wrapper for a grounded threat. The severity (a win% swing) sets the urgency word;
// the factual body comes from the engine, so the urgency can never contradict the eval.
function threatLead(t: ThreatInfo): string {
  const prefix = t.severity === "alarm" ? "Careful: " : t.severity === "warn" ? "Watch out: " : "Heads up: ";
  return prefix + t.text;
}

// The "no threat" line, calibrated to the objective eval so it stays consistent with the
// eval chip beside it (winning / worse / balanced).
function quietLine(fen: string, wp: number | null): string {
  if (wp != null && wp >= 66) {
    return pick(fen, [
      "You're clearly better here — no need to force it. Improve your position and convert.",
      "You hold the edge. Coordinate your pieces and the win will come on its own.",
    ]);
  }
  if (wp != null && wp <= 34) {
    return pick(fen, [
      "You're under pressure here — look for activity and counterplay, not just defence.",
      "You're worse, so make it hard for them: the most resilient move, and create problems.",
    ]);
  }
  return pick(fen, [
    "Nothing forcing here — make a plan. What's your worst-placed piece?",
    "Quiet position. Improve a piece or claim some space.",
    "No immediate threats. Where do you want your pieces three moves from now?",
  ]);
}

function reactToYour(j: MoveJudgment): { mood: Mood; text: string } {
  const expl = j.explanation?.length ? " " + j.explanation.join(" ") : "";
  switch (j.cls) {
    case "brilliant": return { mood: "proud", text: `${j.san} — brilliant!!${expl}` };
    case "great": return { mood: "proud", text: `${j.san} — a great find.${expl}` };
    case "best": return { mood: "happy", text: `${j.san} — the best move.${expl}` };
    case "excellent": return { mood: "happy", text: `${j.san} — excellent.${expl}` };
    case "good": return { mood: "happy", text: `${j.san} looks solid.${expl}` };
    case "inaccuracy": return { mood: "neutral", text: `${j.san} is a touch loose.${expl}` };
    case "mistake": return { mood: "worried", text: `${j.san} isn't quite right.${expl}` };
    case "miss": return { mood: "worried", text: `There was more on offer there.${expl}` };
    case "blunder": return { mood: "alarmed", text: `Ouch — ${j.san} is a blunder.${expl}` };
    default: return { mood: "neutral", text: `${j.san}.${expl}` };
  }
}

function opponentLine(j: MoveJudgment): string {
  const who = j.color === "white" ? "White" : "Black";
  const e = j.explanation?.length ? j.explanation[0] : "";
  return e ? `${who} played ${j.san}. ${e}` : `${who} played ${j.san}.`;
}

// Deterministic variety so quiet-position lines don't feel robotic — keyed off
// the FEN, so the same position always reads the same (no flicker on re-render).
function pick(seed: string, arr: string[]): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return arr[Math.abs(h) % arr.length];
}
