// Guided game review — Socratic self-analysis (docs/16 §8.2). Steps through a saved,
// analyzed game; at each of YOUR mistakes it pauses and makes you find a better move BEFORE
// it reveals the engine's line (the research says engine-first review skips the learning,
// §0.4). Reuses Board + autoShapes + CLASS_META, and the persisted per-ply analysis.
import { useEffect, useMemo, useRef, useState } from "react";
import { Chess, type Square } from "chess.js";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, SkipForward, ArrowLeft, Lightbulb } from "lucide-react";
import type { DrawShape } from "chessground/draw";
import Board from "../Board";
import EvalGraph from "./EvalGraph";
import { Button, Badge } from "../ui";
import { CLASS_META, winPct } from "../../lib/coach";
import { train, type SavedGame, type PlyAnalysis, type Mistake } from "../../lib/train";

const MOTIF_LABEL: Record<string, string> = {
  hangingPiece: "Hung a piece",
  fork: "Fork",
  backRankMate: "Back-rank mate",
  mate: "Forced mate",
};

export default function ReviewBoard({ gameId, initialPly, onBack }: { gameId: string; initialPly?: number; onBack: () => void }) {
  const [game, setGame] = useState<(SavedGame & { mistakes: Mistake[] }) | null>(null);
  const [plies, setPlies] = useState<PlyAnalysis[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cursor, setCursor] = useState(0); // moves played from start (0..N)
  const [revealed, setRevealed] = useState(false);
  const [guess, setGuess] = useState<{ uci: string; san: string; correct: boolean } | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    Promise.all([train.getGame(gameId), train.getAnalysis(gameId)])
      .then(([g, a]) => {
        if (!alive) return;
        setGame(g);
        setPlies(a.plies);
        // Deep-link: open at a specific mistake's solve position (before the mistaken move).
        if (initialPly && initialPly > 0) setCursor(Math.max(0, initialPly - 1));
        setLoading(false);
      })
      .catch((e) => {
        if (!alive) return;
        setError(String(e));
        setLoading(false);
      });
    return () => { alive = false; };
  }, [gameId]);

  const youColor = game?.youColor ?? "white";

  // Reconstruct every position from the ply UCIs (fens[i] = position after i moves).
  const positions = useMemo(() => {
    const c = new Chess();
    const fens: string[] = [c.fen()];
    const lastMoves: (([string, string]) | undefined)[] = [undefined];
    for (const p of plies) {
      try {
        c.move({ from: p.uci.slice(0, 2), to: p.uci.slice(2, 4), promotion: p.uci[4] as any });
      } catch { break; }
      fens.push(c.fen());
      lastMoves.push([p.uci.slice(0, 2), p.uci.slice(2, 4)]);
    }
    return { fens, lastMoves };
  }, [plies]);

  const N = plies.length;
  const mistakeByPly = useMemo(() => {
    const m = new Map<number, Mistake>();
    for (const mk of game?.mistakes ?? []) m.set(mk.ply, mk);
    return m;
  }, [game]);
  const mistakePlies = useMemo(() => new Set(mistakeByPly.keys()), [mistakeByPly]);

  // A "solve" position: it's your turn and the move you actually played next was a mistake.
  const solveMistake = !revealed ? mistakeByPly.get(cursor + 1) : undefined;
  const isSolving = !!solveMistake;

  const fen = positions.fens[cursor] ?? new Chess().fen();
  const lastMove = positions.lastMoves[cursor];
  const board = useMemo(() => new Chess(fen), [fen]);

  // reset the solve state whenever the shown position changes
  useEffect(() => { setRevealed(false); setGuess(null); }, [cursor]);

  function goto(c: number) { setCursor(Math.max(0, Math.min(N, c))); }
  function nextMistake() {
    const next = [...mistakePlies].filter((p) => p - 1 > cursor).sort((a, b) => a - b)[0];
    if (next != null) goto(next - 1);
  }
  function prevMistake() {
    const prev = [...mistakePlies].filter((p) => p - 1 < cursor).sort((a, b) => b - a)[0];
    if (prev != null) goto(prev - 1);
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
      if (e.key === "ArrowLeft") { e.preventDefault(); goto(cursor - 1); }
      else if (e.key === "ArrowRight") { e.preventDefault(); goto(cursor + 1); }
      else if (e.key === "ArrowUp") { e.preventDefault(); goto(0); }
      else if (e.key === "ArrowDown") { e.preventDefault(); goto(N); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cursor, N]);

  // Board interactivity: only when solving, and only your legal moves.
  const dests = useMemo(() => {
    if (!isSolving) return new Map<string, string[]>();
    const d = new Map<string, string[]>();
    for (const m of board.moves({ verbose: true }) as any[]) {
      if (!d.has(m.from)) d.set(m.from, []);
      d.get(m.from)!.push(m.to);
    }
    return d;
  }, [isSolving, board]);

  function onGuess(from: string, to: string) {
    if (!solveMistake) return;
    let san = `${from}${to}`;
    try {
      const c = new Chess(fen);
      const piece = c.get(from as Square);
      const promo = piece?.type === "p" && (to[1] === "8" || to[1] === "1") ? "q" : undefined;
      const mv = c.move({ from, to, promotion: promo as any });
      if (mv) san = mv.san;
    } catch { /* keep raw */ }
    const correct = solveMistake.bestUci === `${from}${to}` || (solveMistake.bestSan && san === solveMistake.bestSan);
    setGuess({ uci: `${from}${to}`, san, correct: !!correct });
    if (correct) setTimeout(() => setRevealed(true), 650);
  }

  // Arrow layer: while solving show nothing (make them think); once revealed show the best
  // move (green) and the move actually played (red glyph) — CLASS_META brushes, like the coach.
  const shapes = useMemo<DrawShape[]>(() => {
    const s: DrawShape[] = [];
    const mk = mistakeByPly.get(cursor + 1);
    if (revealed && mk) {
      if (mk.bestUci) s.push({ orig: mk.bestUci.slice(0, 2) as any, dest: mk.bestUci.slice(2, 4) as any, brush: "green" });
      if (mk.playedUci) {
        const meta = CLASS_META[mk.cls as keyof typeof CLASS_META];
        s.push({ orig: mk.playedUci.slice(2, 4) as any, brush: meta?.brush || "red", label: meta?.glyph ? { text: meta.glyph } : undefined });
      }
    }
    // Non-solve positions: mark the last move's classification glyph.
    if (!isSolving && cursor > 0) {
      const p = plies[cursor - 1];
      const meta = CLASS_META[p.cls as keyof typeof CLASS_META];
      if (p && meta?.glyph && lastMove) s.push({ orig: lastMove[1] as any, brush: meta.brush, label: { text: meta.glyph } });
    }
    return s;
  }, [revealed, cursor, mistakeByPly, isSolving, plies, lastMove]);

  if (loading) return <div className="panel p-6 text-mist text-[13px]">Loading review…</div>;
  if (error) return <div className="panel p-6 text-ember text-[13px]">{error}</div>;
  if (!game) return null;

  const curPly = cursor > 0 ? plies[cursor - 1] : null;
  const evalStr = curPly
    ? curPly.mate != null
      ? `#${Math.abs(curPly.mate)}`
      : `${curPly.evalCpWhite > 0 ? "+" : ""}${(curPly.evalCpWhite / 100).toFixed(2)}`
    : "0.00";

  return (
    <div className="grid grid-cols-[auto_1fr] gap-7 items-start">
      <div className="w-[min(56vh,540px)]">
        <Board
          fen={fen}
          orientation={youColor}
          turnColor={board.turn() === "w" ? "white" : "black"}
          lastMove={lastMove}
          check={board.inCheck()}
          dests={dests}
          movableColor={isSolving ? youColor : undefined}
          viewOnly={!isSolving}
          onMove={onGuess}
          autoShapes={shapes}
        />
        <div className="mt-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <NavBtn onClick={() => goto(0)} disabled={cursor === 0} title="Start (↑)"><ChevronsLeft size={15} /></NavBtn>
            <NavBtn onClick={() => goto(cursor - 1)} disabled={cursor === 0} title="Back (←)"><ChevronLeft size={15} /></NavBtn>
            <NavBtn onClick={() => goto(cursor + 1)} disabled={cursor >= N} title="Forward (→)"><ChevronRight size={15} /></NavBtn>
            <NavBtn onClick={() => goto(N)} disabled={cursor >= N} title="End (↓)"><ChevronsRight size={15} /></NavBtn>
            <NavBtn onClick={nextMistake} disabled={![...mistakePlies].some((p) => p - 1 > cursor)} title="Next mistake">
              <SkipForward size={14} />
            </NavBtn>
          </div>
          <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-taupe">
            {cursor === 0 ? "Start" : `Move ${Math.ceil(cursor / 2)} · ${curPly?.color === "white" ? "W" : "B"} ${curPly?.san ?? ""}`} · eval {evalStr}
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-4 max-w-[400px]">
        <div className="flex items-center justify-between">
          <button onClick={onBack} className="focusable inline-flex items-center gap-1.5 text-mist hover:text-ivory text-[13px]">
            <ArrowLeft size={14} /> All games
          </button>
          <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-taupe">
            vs {game.botName} · you {youColor}
          </div>
        </div>

        {/* Socratic panel */}
        <AnimatePresence mode="wait">
          {isSolving ? (
            <motion.div key="solve" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
              className="panel p-5" style={{ borderColor: "rgba(200,163,91,0.35)" }}>
              <div className="flex items-center gap-2 mb-2">
                <Lightbulb size={16} className="text-brass" />
                <span className="text-ivory text-[14.5px]">You went wrong here.</span>
              </div>
              <p className="text-mist text-[13px] leading-relaxed mb-3">
                You played <span className="font-mono text-ember">{solveMistake!.playedSan}</span> — a{" "}
                {solveMistake!.cls}. Before you look: <b>find a stronger move for {youColor}</b> on the board.
              </p>
              {guess && !guess.correct && (
                <div className="text-[12.5px] text-taupe mb-3">
                  <span className="font-mono text-mist">{guess.san}</span> isn't the engine's pick — try again, or reveal.
                </div>
              )}
              <div className="flex gap-2">
                <Button size="sm" onClick={() => setRevealed(true)}>Reveal the answer</Button>
              </div>
            </motion.div>
          ) : (
            <motion.div key="reveal" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
              className="panel p-5">
              {revealed && mistakeByPly.get(cursor + 1) ? (
                <RevealCard mk={mistakeByPly.get(cursor + 1)!} youColor={youColor} solvedRight={guess?.correct} />
              ) : curPly ? (
                <MoveCard ply={curPly} />
              ) : (
                <div className="text-mist text-[13px]">Step through the game with ← → , or jump to your next mistake. At each of your mistakes the review will pause and ask you to find the better move first.</div>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        <EvalGraphCard plies={plies} cursor={cursor} mistakePlies={mistakePlies} onJump={goto} />
        <MistakeStrip mistakes={game.mistakes} onJump={(ply) => goto(ply - 1)} cursorPly={cursor + 1} />
      </div>
    </div>
  );
}

function RevealCard({ mk, youColor, solvedRight }: { mk: Mistake; youColor: string; solvedRight?: boolean }) {
  const meta = CLASS_META[mk.cls as keyof typeof CLASS_META];
  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <span className="font-mono text-[15px]" style={{ color: meta?.color }}>{meta?.glyph}</span>
        <span className="text-ivory text-[14.5px]">{meta?.label ?? mk.cls}</span>
        <span className="text-taupe text-[12px]">· −{mk.winLoss}% win chance</span>
      </div>
      {solvedRight && <div className="text-sage text-[12.5px] mb-2">✓ You found it — {mk.bestSan}.</div>}
      <p className="text-mist text-[13px] leading-relaxed mb-3">
        You played <span className="font-mono text-ember">{mk.playedSan}</span>. The engine prefers{" "}
        <span className="font-mono text-sage">{mk.bestSan}</span> (green arrow).
      </p>
      <div className="flex flex-wrap gap-1.5">
        <Badge tone="neutral">{mk.phase}</Badge>
        {(mk.motifs ?? []).map((t) => (
          <span key={t.tag} className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.12em] px-2 py-1 rounded-md border"
            style={{ color: t.confidence === "high" ? "var(--color-sage)" : "var(--color-brass)", borderColor: "var(--color-line-2)" }}
            title={t.confidence === "high" ? "High confidence (engine/geometry)" : "Heuristic — may occasionally over/under-fire"}>
            {MOTIF_LABEL[t.tag] || t.tag}{t.confidence === "heuristic" ? " ?" : ""}
          </span>
        ))}
      </div>
    </div>
  );
}

function MoveCard({ ply }: { ply: PlyAnalysis }) {
  const meta = CLASS_META[ply.cls as keyof typeof CLASS_META];
  const wp = Math.round(winPct(ply.evalCpWhite));
  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        <span className="font-mono text-[14px]" style={{ color: meta?.color }}>{meta?.glyph || "·"}</span>
        <span className="text-ivory text-[14px]">{ply.color === "white" ? "White" : "Black"} played <span className="font-mono">{ply.san}</span></span>
      </div>
      <div className="text-taupe text-[12.5px] mb-2">{meta?.label} · white win {wp}%</div>
      {ply.bestSan && ply.bestSan !== ply.san && (
        <div className="text-mist text-[12.5px]">Engine's pick was <span className="font-mono text-sage">{ply.bestSan}</span>.</div>
      )}
      {ply.pv && <div className="font-mono text-[11px] text-taupe mt-2 leading-snug line-clamp-2 break-words">line: {ply.pv}</div>}
    </div>
  );
}

function EvalGraphCard({ plies, cursor, mistakePlies, onJump }: any) {
  return (
    <div className="panel p-4">
      <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-taupe mb-3">Eval graph · your mistakes marked</div>
      <EvalGraph plies={plies} cursor={cursor} mistakePlies={mistakePlies} onJump={onJump} />
    </div>
  );
}

function MistakeStrip({ mistakes, onJump, cursorPly }: { mistakes: Mistake[]; onJump: (ply: number) => void; cursorPly: number }) {
  if (!mistakes.length) return (
    <div className="panel p-4 text-taupe text-[12.5px]">No mistakes ledgered in this game — clean play, or a short game.</div>
  );
  return (
    <div className="panel p-4">
      <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-taupe mb-3">Your mistakes ({mistakes.length})</div>
      <div className="flex flex-col gap-1">
        {mistakes.slice().sort((a, b) => a.ply - b.ply).map((m) => {
          const meta = CLASS_META[m.cls as keyof typeof CLASS_META];
          const active = m.ply === cursorPly;
          return (
            <button key={m.id} onClick={() => onJump(m.ply)}
              className={`focusable flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-[8px] text-[12.5px] transition-colors ${active ? "panel-2 text-ivory" : "text-mist hover:text-ivory hover:bg-white/[0.02]"}`}>
              <span className="flex items-center gap-2">
                <span className="font-mono" style={{ color: meta?.color }}>{meta?.glyph}</span>
                <span>Move {Math.ceil(m.ply / 2)} · <span className="font-mono">{m.playedSan}</span></span>
              </span>
              <span className="font-mono text-[10px] text-taupe">{(m.motifs?.[0] && (MOTIF_LABEL[m.motifs[0].tag] || m.motifs[0].tag)) || m.phase}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function NavBtn({ children, onClick, disabled, title }: { children: React.ReactNode; onClick: () => void; disabled?: boolean; title?: string }) {
  return (
    <button onClick={onClick} disabled={disabled} title={title}
      className="focusable grid place-items-center w-9 h-8 rounded-[8px] panel-2 text-mist hover:text-ivory hover:border-brass/60 transition-colors disabled:opacity-30 disabled:cursor-not-allowed">
      {children}
    </button>
  );
}
