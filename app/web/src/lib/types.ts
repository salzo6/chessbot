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
