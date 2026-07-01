// Type declarations for the shared pure-JS coachcore module. Structurally identical to
// web/src/lib/types.ts (TS uses structural typing, so objects interop across both).
import type { Chess } from "chess.js";

export interface AnalysisLine {
  multipv: number;
  scoreCp?: number;
  mate?: number;
  depth?: number;
  pv?: string;
  uci?: string;
}
export interface PositionAnalysis {
  fen: string;
  lines: AnalysisLine[];
  best: AnalysisLine | null;
}
export type MoveClass =
  | "best" | "brilliant" | "great" | "excellent" | "good"
  | "book" | "inaccuracy" | "mistake" | "miss" | "blunder";

export type GamePhase = "opening" | "middlegame" | "endgame";
export interface MotifTag { tag: string; confidence: "high" | "heuristic"; }

export function winPct(cp: number): number;
export function lineCpWhite(line: AnalysisLine | null | undefined): number;
export function formatEvalWhite(line: AnalysisLine | null | undefined): string;

export const CLASS_META: Record<MoveClass, { label: string; glyph: string; color: string; brush: string }>;

export interface ClassifyInput {
  prev: PositionAnalysis | undefined;
  post: PositionAnalysis | undefined;
  moveUci: string;
  moverWhite: boolean;
  boardAfter: Chess;
  ply: number;
}
export interface ClassifyResult { cls: MoveClass; winLoss: number; bestUci?: string; }
export function classifyMove(inp: ClassifyInput): ClassifyResult;

export type ThreatSeverity = "none" | "minor" | "warn" | "alarm";
export interface ThreatInfo {
  kind: "none" | "check" | "capture" | "mate" | "threat";
  severity: ThreatSeverity;
  magnitude: number;
  text: string;
  square?: string;
  from?: string;
  san?: string;
}
export const THREAT_BANDS: { minor: number; warn: number; alarm: number };
export function flipSideToMove(fen: string): string | null;
export interface ThreatInput {
  fen: string;
  youWhite: boolean;
  current: PositionAnalysis | null;
  nullAnalysis: PositionAnalysis | null;
}
export function computeThreat(inp: ThreatInput): ThreatInfo | null;
export function accuracy(losses: number[]): number;

// --- trainer additions ---
export function gamePhase(fen: string): GamePhase;
export function see(chess: Chess, sq: string, side: "w" | "b"): number;
export function bestCaptureSee(board: Chess): { see: number; square: string | null; piece: string | null };
export function detectFork(fen: string, uci: string | undefined): { prongs: number; square: string } | null;
export function isBackRankMate(fen: string): boolean;
export interface TagMistakeCtx {
  fenBefore: string;
  fenAfter?: string;
  playedUci?: string;
  bestUci?: string;
  prev?: PositionAnalysis;
  post?: PositionAnalysis;
  moverColor: "white" | "black" | "w" | "b";
}
export function tagMistake(ctx: TagMistakeCtx): MotifTag[];

export const PIECE_VAL: Record<string, number>;
export const NAME_FULL: Record<string, string>;
