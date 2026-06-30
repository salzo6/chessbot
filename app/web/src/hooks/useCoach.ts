import { useEffect, useMemo, useRef, useState } from "react";
import { Chess } from "chess.js";
import type { DrawShape } from "chessground/draw";
import { wsURL } from "../lib/api";
import type { AnalysisLine, MoveJudgment, PositionAnalysis } from "../lib/types";
import { CLASS_META, classifyMove, computeThreat, flipSideToMove, lineCpWhite, winPct, type ThreatInfo } from "../lib/coach";
import { explainMove } from "../lib/explain";

// A chess.js verbose move (we lean on .lan/.before/.after from v1.4).
type VMove = any;

export interface UseCoachArgs {
  enabled: boolean;
  fen: string; // the position currently shown on the board
  lastMove: VMove | null; // verbose move that reached `fen` (null at game start)
  gameOver: boolean;
  yourTurn: boolean; // your live turn (opponent idle) — gates engine-grounded threat detection
}

export interface CoachState {
  ready: boolean;
  objectiveLine: AnalysisLine | null; // best line for `fen`, white POV
  evalFracWhite: number; // 0..1 for an advantage bar (white share)
  bestUci?: string;
  bestSan?: string;
  judgment: MoveJudgment | null; // classification of `lastMove`
  explanation: string[];
  hintLevel: number; // 0=none 1=text 2=square 3=arrow
  nextHint: () => void;
  showBest: () => void;
  resetHint: () => void;
  autoShapes: DrawShape[];
  threat: ThreatInfo | null; // engine-grounded "what the opponent threatens", null while thinking
}

const LIVE = { multipv: 3, movetime: 600 };
// The null-move (threat) search only needs the opponent's best reply + a rough eval, so it
// runs cheaper than the full eval — keeps your-turn coaching responsive (verified: a ~400ms
// search returns the same threat verdict as a 1200ms one across the scenario suite).
const THREAT = { multipv: 2, movetime: 450 };

export function useCoach({ enabled, fen, lastMove, gameOver, yourTurn }: UseCoachArgs): CoachState {
  const wsRef = useRef<WebSocket | null>(null);
  const cacheRef = useRef<Map<string, PositionAnalysis>>(new Map());
  const inflightRef = useRef<string | null>(null);
  const reqIdRef = useRef(0);
  const [tick, setTick] = useState(0); // bump to re-derive when cache changes
  const [live, setLive] = useState<{ fen: string; lines: AnalysisLine[] } | null>(null);
  const [hintLevel, setHintLevel] = useState(0);

  const prevFen: string | null = lastMove?.before ?? null;

  // The "null-move" position (give the opponent the move) for engine-grounded threat
  // detection — only on your live turn, and never while you're in check (passing is illegal
  // then, and the check itself is the concern). This is the FEN we hand the engine.
  const nullFen = useMemo<string | null>(() => {
    if (!enabled || !yourTurn || gameOver) return null;
    try { if (new Chess(fen).inCheck()) return null; } catch { return null; }
    return flipSideToMove(fen);
  }, [enabled, yourTurn, gameOver, fen]);

  // --- socket lifecycle: only while coach is enabled ---
  useEffect(() => {
    if (!enabled) return;
    const sock = new WebSocket(wsURL("/ws/coach"));
    wsRef.current = sock;
    sock.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.type === "line" && msg.fen) {
        setLive({ fen: msg.fen, lines: msg.lines });
      } else if (msg.type === "done" && msg.fen) {
        cacheRef.current.set(msg.fen, { fen: msg.fen, lines: msg.lines, best: msg.best });
        if (inflightRef.current === msg.fen) inflightRef.current = null;
        setTick((t) => t + 1);
      } else if (msg.type === "error") {
        if (inflightRef.current) inflightRef.current = null;
        setTick((t) => t + 1);
      }
    };
    sock.onclose = () => { if (wsRef.current === sock) wsRef.current = null; };
    return () => { sock.close(); cacheRef.current.clear(); inflightRef.current = null; setLive(null); };
  }, [enabled]);

  // reset hints whenever the shown position changes
  useEffect(() => { setHintLevel(0); }, [fen]);

  // --- request what we still need, in priority order ---
  // 1) current position (objective eval, best move, hints) — fills the bar first;
  // 2) prev position (to classify the move just played) — decided before the threat so we
  //    never flash a threat we'd replace with "your opponent slipped";
  // 3) null-move position (the engine-grounded threat) — a short search, a beat later.
  useEffect(() => {
    if (!enabled || gameOver) return;
    const sock = wsRef.current;
    if (!sock || sock.readyState !== WebSocket.OPEN) return;
    const want: Array<{ f: string; params: typeof LIVE }> = [];
    const push = (f: string | null, params: typeof LIVE) => {
      if (f && !cacheRef.current.has(f)) want.push({ f, params });
    };
    push(fen, LIVE);
    push(prevFen, LIVE);
    push(nullFen, THREAT);
    const next = want[0];
    if (!next || inflightRef.current === next.f) return;
    inflightRef.current = next.f;
    const reqId = ++reqIdRef.current;
    sock.send(JSON.stringify({ type: "analyze", fen: next.f, reqId, ...next.params }));
  }, [enabled, gameOver, fen, prevFen, nullFen, tick]);

  // --- derive everything from the cache (+ live stream for snappy eval) ---
  return useMemo<CoachState>(() => {
    const cached = cacheRef.current.get(fen);
    const liveForFen = live && live.fen === fen ? { fen, lines: live.lines, best: live.lines[0] ?? null } : null;
    const analysis = cached ?? liveForFen ?? null;
    const objectiveLine = analysis?.best ?? null;

    const cpW = lineCpWhite(objectiveLine);
    const evalFracWhite = analysis ? winPct(cpW) / 100 : 0.5;

    // best move (for hints/arrows) — from the CURRENT position
    let bestUci = objectiveLine?.uci;
    let bestSan: string | undefined;
    if (bestUci) {
      try {
        const c = new Chess(fen);
        const mv = c.move({ from: bestUci.slice(0, 2), to: bestUci.slice(2, 4), promotion: bestUci[4] });
        bestSan = mv?.san;
      } catch { /* position may be terminal */ }
    }

    // classify the move that reached this position (needs prev + post analyses)
    let judgment: MoveJudgment | null = null;
    let explanation: string[] = [];
    if (lastMove && prevFen) {
      const prev = cacheRef.current.get(prevFen);
      const post = analysis ?? undefined;
      if (prev && post) {
        const moverWhite = lastMove.color === "w";
        const boardAfter = new Chess(fen);
        const res = classifyMove({
          prev, post, moveUci: lastMove.lan, moverWhite, boardAfter, ply: plyOf(lastMove),
        });
        // best alt move SAN in the prior position
        let altSan: string | undefined;
        if (res.bestUci) {
          try {
            const c = new Chess(prevFen);
            altSan = c.move({ from: res.bestUci.slice(0, 2), to: res.bestUci.slice(2, 4), promotion: res.bestUci[4] })?.san;
          } catch { /* ignore */ }
        }
        explanation = explainMove({
          move: lastMove, moverWhite, boardAfter, prev, post, cls: res.cls, bestSan: altSan,
        });
        judgment = {
          ply: plyOf(lastMove),
          san: lastMove.san,
          uci: lastMove.lan,
          color: moverWhite ? "white" : "black",
          cls: res.cls,
          winLoss: res.winLoss,
          bestUci: res.bestUci,
          bestSan: altSan,
          evalCp: post?.best?.scoreCp,
          mate: post?.best?.mate,
          explanation,
        };
      }
    }

    // --- engine-grounded threat ("what does the opponent threaten?"), your live turn only ---
    let threat: ThreatInfo | null = null;
    if (yourTurn) {
      const youWhite = fen.split(" ")[1] === "w"; // on your live turn, side-to-move IS you
      const nullAnalysis = nullFen ? cacheRef.current.get(nullFen) ?? null : null;
      threat = computeThreat({ fen, youWhite, current: analysis, nullAnalysis });
    }

    // --- compose the coach's arrow layer ---
    const shapes: DrawShape[] = [];
    // classification marker on the last move's destination square
    if (judgment && lastMove?.to) {
      const meta = CLASS_META[judgment.cls];
      shapes.push({ orig: lastMove.to as any, brush: meta.brush, label: meta.glyph ? { text: meta.glyph } : undefined });
    }
    // hint/best-move arrow for the side to move now
    if (bestUci && !gameOver) {
      const from = bestUci.slice(0, 2) as any;
      const to = bestUci.slice(2, 4) as any;
      if (hintLevel >= 3) shapes.push({ orig: from, dest: to, brush: "green" });
      else if (hintLevel >= 2) shapes.push({ orig: from, brush: "yellow" });
    }

    return {
      ready: !!analysis,
      objectiveLine,
      evalFracWhite: Math.max(0.02, Math.min(0.98, evalFracWhite)),
      bestUci,
      bestSan,
      judgment,
      explanation,
      hintLevel,
      nextHint: () => setHintLevel((h) => Math.min(3, h + 1)),
      showBest: () => setHintLevel(3),
      resetHint: () => setHintLevel(0),
      autoShapes: shapes,
      threat,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, fen, lastMove, prevFen, gameOver, hintLevel, live, tick, yourTurn, nullFen]);
}

// ply number from a chess.js verbose move's "before" FEN (fullmove + side).
function plyOf(move: VMove): number {
  try {
    const parts = (move.before as string).split(" ");
    const fullmove = parseInt(parts[5], 10) || 1;
    const whiteToMove = parts[1] === "w";
    return (fullmove - 1) * 2 + (whiteToMove ? 1 : 2);
  } catch {
    return 1;
  }
}
