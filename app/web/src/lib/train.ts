// Client API for the Trainer surfaces (docs/16 §11) — mirrors lib/api.ts. All additive;
// none of it runs unless the Play save fires or the Train page is open.
const API = "/api";

async function j<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, { headers: { "Content-Type": "application/json" }, ...init });
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  return r.json() as Promise<T>;
}

export interface SavedGame {
  id: string;
  userId: string;
  pgn: string;
  youColor: "white" | "black";
  botId: string;
  botName: string;
  result: string;
  reason: string;
  createdAt: string;
  analysisStatus: "pending" | "running" | "done" | "error";
  analyzedAt?: string;
  mistakeCount?: number;
  progress?: { ply: number; total: number } | null;
}

export interface PlyAnalysis {
  ply: number;
  fen: string;
  san: string;
  uci: string;
  color: "white" | "black";
  evalCpWhite: number;
  mate: number | null;
  bestUci: string | null;
  bestSan: string | null;
  pv: string;
  winLoss: number;
  cls: string;
}

export interface Mistake {
  id: string;
  userId: string;
  gameId: string;
  ply: number;
  fenBefore: string;
  playedUci: string;
  playedSan?: string;
  bestUci: string | null;
  bestSan: string | null;
  cls: string;
  winLoss: number;
  phase: "opening" | "middlegame" | "endgame";
  motifs: { tag: string; confidence: "high" | "heuristic" }[];
  createdAt: string;
}

export interface WeaknessProfile {
  userId: string;
  updatedAt: string;
  gamesAnalyzed: number;
  movesAnalyzed: number;
  totalMistakes: number;
  phaseAccuracy: Record<"opening" | "middlegame" | "endgame", number | null>;
  phaseMoves: Record<"opening" | "middlegame" | "endgame", number>;
  motifCounts: Record<string, number>;
  recurring: { key: string; label: string; count: number; kind: string }[];
  droppedWinning: number;
  advantageCapitalization: number | null;
  advantageReached: number;
  blunderRatePer100: number;
  hangingPer100: number;
  trend: number[];
}

export interface DrillItem {
  id: string;
  userId: string;
  motif: string;
  motifLabel?: string;
  sourceMistakeId?: string;
  gameId?: string;
  fen: string;
  bestUci: string;
  bestSan?: string;
  solutionSans?: string[];
  origin: "own-game" | "lichess";
  repetitions: number;
  easeFactor: number;
  intervalDays: number;
  dueDate: string;
  lapses: number;
  isLeech: boolean;
  state: "new" | "learning" | "review" | "relearning";
  lastReviewed?: string;
  createdAt: string;
  sideToMove: "white" | "black";
  playedSan?: string;
}

export const train = {
  // The one additive write into the existing Play flow.
  saveGame: (payload: {
    pgn: string;
    youColor: "white" | "black";
    botId: string;
    botName?: string;
    result: string;
    reason: string;
  }) => j<{ ok: boolean; gameId: string }>(`${API}/games`, { method: "POST", body: JSON.stringify(payload) }),

  listGames: () => j<SavedGame[]>(`${API}/games`),
  getGame: (id: string) => j<SavedGame & { mistakes: Mistake[] }>(`${API}/games/${id}`),
  getAnalysis: (id: string) => j<{ gameId: string; plies: PlyAnalysis[]; analyzedAt: string; depth: number }>(`${API}/games/${id}/analysis`),
  reanalyze: (id: string) => j<{ ok: boolean }>(`${API}/games/${id}/analyze`, { method: "POST" }),
  weakness: () => j<WeaknessProfile>(`${API}/train/weakness`),
  mistakes: (motif?: string) => j<Mistake[]>(`${API}/train/mistakes${motif ? `?motif=${motif}` : ""}`),

  // Drilling (T2)
  dueDrills: () => j<{ items: DrillItem[]; puzzleRating: number; newlyBuilt: number }>(`${API}/train/drills/due`),
  reviewDrill: (id: string, grade: "again" | "hard" | "good" | "easy") =>
    j<{ ok: boolean; item: DrillItem; puzzleRating: number }>(`${API}/train/drills/${id}/review`, {
      method: "POST",
      body: JSON.stringify({ grade }),
    }),
  drillStats: () => j<{ total: number; due: number; leeches: number; puzzleRating: number }>(`${API}/train/drills/stats`),
};
