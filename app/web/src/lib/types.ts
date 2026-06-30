export type Color = "white" | "black";

export interface Bot {
  id: string;
  name: string;
  family: string; // e.g. "Stockfish", "Maia", "House"
  version: string;
  kind: "engine" | "throttle"; // throttle = a rung of another engine
  baseId?: string; // for throttle rungs, the engine they wrap
  source: string;
  license: string;
  installed: boolean;
  path?: string;
  options?: Record<string, string | number | boolean>;
  // throttle config
  uciElo?: number;
  nodes?: number;
  movetime?: number;
  accent: string; // brand color for cards/avatars
  blurb: string;
}

export interface Rating {
  botId: string;
  elo: number;
  error: number; // ± error bar
  games: number;
  wins: number;
  draws: number;
  losses: number;
  rank: number;
  anchored: boolean;
  provisional?: boolean; // < ~30 games — rating not yet settled
  history: number[]; // recent elo trace for sparkline
}

export interface MatchResult {
  id: string;
  white: string;
  black: string;
  whiteName?: string;
  blackName?: string;
  result: "1-0" | "0-1" | "1/2-1/2" | "*";
  reason: string;
  moves: number;
  pgn: string;
  date: string;
  tc: string;
}

export interface EngineInfo {
  depth?: number;
  scoreCp?: number;
  mate?: number;
  nps?: number;
  nodes?: number;
  pv?: string;
}

/* ---------------- Coach (additive analysis layer) ---------------- */

export interface AnalysisLine {
  multipv: number;
  scoreCp?: number; // white POV
  mate?: number; // white POV
  depth?: number;
  pv?: string;
  uci?: string; // first move of the line
}

export interface PositionAnalysis {
  fen: string;
  lines: AnalysisLine[];
  best: AnalysisLine | null;
}

export type MoveClass =
  | "best"
  | "brilliant"
  | "great"
  | "excellent"
  | "good"
  | "book"
  | "inaccuracy"
  | "mistake"
  | "miss"
  | "blunder";

export interface MoveJudgment {
  ply: number; // 1-based ply this judges
  san: string;
  uci: string;
  color: Color; // who played it
  cls: MoveClass;
  winLoss: number; // win% lost vs best (0..100)
  bestUci?: string;
  bestSan?: string;
  evalCp?: number; // white POV eval after the move (best line of resulting pos)
  mate?: number; // white POV mate after the move
  explanation?: string[];
}
