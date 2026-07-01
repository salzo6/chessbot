// Weakness roll-up (docs/16 §7) — a cheap, honest aggregate over the mistake ledger + the
// persisted eval graphs. Rebuilt whenever a game finishes analyzing. Everything here is
// computed transparently from our own data; we surface only what we can defend (§7's
// "honest gaps": no time analytics, no ECO naming, no peer comparison).
import { gamesStore, analysisStore, mistakeStore, weaknessStore } from "./store.mjs";
import { winPct, accuracy, gamePhase } from "../shared/coachcore.mjs";

const MOTIF_LABEL = {
  hangingPiece: "Hung a piece",
  fork: "Missed / allowed a fork",
  mate: "Missed or allowed a mate",
  backRankMate: "Back-rank mate pattern",
};

const PHASES = ["opening", "middlegame", "endgame"];

export function rebuildWeakness(userId = "me") {
  const games = gamesStore.list(userId).filter((g) => g.analysisStatus === "done");
  const mistakes = mistakeStore.all(userId);

  const phaseLosses = { opening: [], middlegame: [], endgame: [] };
  const phaseMoves = { opening: 0, middlegame: 0, endgame: 0 };
  let movesAnalyzed = 0;
  let blunders = 0;
  let advTotal = 0, advConverted = 0, droppedWinning = 0;
  const trendPairs = []; // { createdAt, acc } → chronological accuracy trend

  for (const g of games) {
    const a = analysisStore.get(g.id);
    if (!a?.plies?.length) continue;
    const youW = g.youColor === "white";
    const yourPlies = a.plies.filter((p) => p.color === g.youColor);
    if (!yourPlies.length) continue;

    const yourLosses = yourPlies.map((p) => p.winLoss);
    trendPairs.push({ createdAt: g.createdAt || "", acc: accuracy(yourLosses) });

    for (const p of yourPlies) {
      const phase = gamePhase(p.fen);
      phaseLosses[phase].push(p.winLoss);
      phaseMoves[phase]++;
      if (p.cls === "blunder") blunders++;
    }
    movesAnalyzed += yourPlies.length;

    // advantage capitalization: reached ≥80% win% (your POV) and did you go on to win?
    const reached80 = yourPlies.some((p) => winPct(youW ? p.evalCpWhite : -p.evalCpWhite) >= 80);
    const won = (g.result === "1-0" && youW) || (g.result === "0-1" && !youW);
    if (reached80) { advTotal++; if (won) advConverted++; else droppedWinning++; }
  }

  // motif occurrence counts among YOUR ledgered mistakes (honest: occurrences, not a
  // found-vs-missed rate — true "availability" scanning is a later add, §7).
  const motifCounts = {};
  let hangingCount = 0;
  for (const m of mistakes) {
    for (const tag of m.motifs || []) {
      motifCounts[tag.tag] = (motifCounts[tag.tag] || 0) + 1;
      if (tag.tag === "hangingPiece") hangingCount++;
    }
  }

  const phaseAccuracy = {};
  for (const ph of PHASES) phaseAccuracy[ph] = phaseLosses[ph].length ? accuracy(phaseLosses[ph]) : null;

  // ranked "your recurring mistakes" — the antidote to the stagnation trap (§8.1).
  const recurring = [];
  for (const [tag, count] of Object.entries(motifCounts)) {
    recurring.push({ key: tag, label: MOTIF_LABEL[tag] || tag, count, kind: "motif" });
  }
  if (droppedWinning > 0)
    recurring.push({ key: "droppedWinning", label: "Dropped a winning position", count: droppedWinning, kind: "conversion" });
  recurring.sort((a, b) => b.count - a.count);

  trendPairs.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  const trend = trendPairs.map((t) => Math.round(t.acc * 10) / 10).slice(-20);

  const profile = {
    userId,
    updatedAt: new Date().toISOString(),
    gamesAnalyzed: games.length,
    movesAnalyzed,
    totalMistakes: mistakes.length,
    phaseAccuracy,
    phaseMoves,
    motifCounts,
    recurring,
    droppedWinning,
    advantageCapitalization: advTotal ? Math.round((advConverted / advTotal) * 100) : null,
    advantageReached: advTotal,
    blunderRatePer100: movesAnalyzed ? Math.round((blunders / movesAnalyzed) * 1000) / 10 : 0,
    hangingPer100: movesAnalyzed ? Math.round((hangingCount / movesAnalyzed) * 1000) / 10 : 0,
    trend,
  };
  weaknessStore.set(profile);
  return profile;
}
