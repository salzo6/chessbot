// Drilling surface (docs/16 §8.3 / §9) — spaced-repetition drills sourced from your own
// mistakes. Present the position, make the user find the engine's move, then grade with the
// SM-2 4-button scale. The puzzle rating (§9.4) is earned, self-calibrating, and explicitly
// NOT a chess Elo. The chess-specific twist (motif-sibling puzzles) arrives with the Lichess
// DB in T3; until then drills replay your own positions, interleaved across motifs.
import { useEffect, useMemo, useState } from "react";
import { Chess, type Square } from "chess.js";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowLeft, Check, X, HelpCircle, Trophy } from "lucide-react";
import type { DrawShape } from "chessground/draw";
import Board from "../Board";
import { Button, Badge } from "../ui";
import { train, type DrillItem } from "../../lib/train";

type Phase = "solving" | "revealed";
type Result = "correct" | "wrong" | null;

export default function DrillBoard({ onBack }: { onBack: () => void }) {
  const [queue, setQueue] = useState<DrillItem[]>([]);
  const [i, setI] = useState(0);
  const [loading, setLoading] = useState(true);
  const [phase, setPhase] = useState<Phase>("solving");
  const [result, setResult] = useState<Result>(null);
  const [attemptSan, setAttemptSan] = useState<string | null>(null);
  const [puzzleRating, setPuzzleRating] = useState<number>(1000);
  const [solved, setSolved] = useState(0);
  const [reviewed, setReviewed] = useState(0);
  const [grading, setGrading] = useState(false);

  useEffect(() => {
    let alive = true;
    train.dueDrills()
      .then((r) => { if (!alive) return; setQueue(r.items); setPuzzleRating(r.puzzleRating); setLoading(false); })
      .catch(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  const drill = queue[i];
  const board = useMemo(() => (drill ? new Chess(drill.fen) : null), [drill]);

  useEffect(() => { setPhase("solving"); setResult(null); setAttemptSan(null); }, [i, drill?.id]);

  const dests = useMemo(() => {
    if (!board || phase !== "solving") return new Map<string, string[]>();
    const d = new Map<string, string[]>();
    for (const m of board.moves({ verbose: true }) as any[]) {
      if (!d.has(m.from)) d.set(m.from, []);
      d.get(m.from)!.push(m.to);
    }
    return d;
  }, [board, phase]);

  function attempt(from: string, to: string) {
    if (!drill || !board) return;
    let san = `${from}${to}`;
    try {
      const c = new Chess(drill.fen);
      const piece = c.get(from as Square);
      const promo = piece?.type === "p" && (to[1] === "8" || to[1] === "1") ? "q" : undefined;
      const mv = c.move({ from, to, promotion: promo as any });
      if (mv) san = mv.san;
    } catch { /* keep raw */ }
    const correct = drill.bestUci === `${from}${to}` || (!!drill.bestSan && san === drill.bestSan);
    setAttemptSan(san);
    setResult(correct ? "correct" : "wrong");
    setPhase("revealed");
  }

  function giveUp() {
    setResult("wrong");
    setAttemptSan(null);
    setPhase("revealed");
  }

  async function grade(g: "again" | "hard" | "good" | "easy") {
    if (!drill || grading) return;
    setGrading(true);
    try {
      const r = await train.reviewDrill(drill.id, g);
      setPuzzleRating(r.puzzleRating);
    } catch { /* keep going even if the write fails */ }
    setGrading(false);
    setReviewed((n) => n + 1);
    if (result === "correct") setSolved((n) => n + 1);
    // "again" → retry later this session; otherwise move on.
    setQueue((q) => {
      const next = [...q];
      if (g === "again") next.push({ ...drill }); // requeue at the end
      return next;
    });
    setI((n) => n + 1);
  }

  const shapes = useMemo<DrawShape[]>(() => {
    if (phase !== "revealed" || !drill?.bestUci) return [];
    return [{ orig: drill.bestUci.slice(0, 2) as any, dest: drill.bestUci.slice(2, 4) as any, brush: "green" }];
  }, [phase, drill]);

  if (loading) return <Shell onBack={onBack}><div className="panel p-6 text-mist text-[13px]">Loading drills…</div></Shell>;

  if (!drill) {
    return (
      <Shell onBack={onBack}>
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="panel p-8 text-center max-w-[460px] mx-auto">
          <div className="mx-auto mb-4 w-12 h-12 rounded-full grid place-items-center" style={{ background: "linear-gradient(150deg,#1f1a12,#0e0c08)", border: "1px solid var(--color-line-2)" }}>
            <Trophy size={22} className="text-brass" />
          </div>
          <div className="text-ivory text-[16px] mb-2">{reviewed ? "Session complete" : "No drills due"}</div>
          <p className="text-mist text-[13px] leading-relaxed mb-4">
            {reviewed
              ? `You reviewed ${reviewed} drill${reviewed === 1 ? "" : "s"} (${solved} solved first try). They're rescheduled by spacing — come back when they're due.`
              : "Nothing due right now. Finish more Play games to feed the mistake ledger, or come back when today's cards mature."}
          </p>
          <div className="inline-flex items-center gap-2 panel-2 px-4 py-2 rounded-[10px]">
            <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-taupe">Puzzle rating</span>
            <span className="font-mono text-[18px] text-ivory tnum">{puzzleRating}</span>
          </div>
          <div className="text-taupe text-[10.5px] mt-2">Earned from drills — not a chess Elo.</div>
        </motion.div>
      </Shell>
    );
  }

  const you = drill.sideToMove;
  return (
    <Shell onBack={onBack}>
      <div className="grid grid-cols-[auto_1fr] gap-7 items-start">
        <div className="w-[min(56vh,540px)]">
          <Board
            fen={drill.fen}
            orientation={you}
            turnColor={you}
            check={board?.inCheck()}
            dests={dests}
            movableColor={phase === "solving" ? you : undefined}
            viewOnly={phase !== "solving"}
            onMove={attempt}
            autoShapes={shapes}
          />
        </div>

        <div className="flex flex-col gap-4 max-w-[380px]">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Badge tone={drill.origin === "lichess" ? "azure" : "brass"}>
                {drill.origin === "lichess" ? "Lichess sibling" : "Your game"}
              </Badge>
              {drill.isLeech && <Badge tone="ember">leech</Badge>}
            </div>
            <div className="inline-flex items-center gap-1.5 font-mono text-[11px] text-taupe">
              rating <span className="text-ivory text-[13px]">{puzzleRating}</span>
            </div>
          </div>

          <div className="panel p-5">
            <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-taupe mb-2">Find the move</div>
            <div className="text-ivory text-[15px] mb-1">{you === "white" ? "White" : "Black"} to play — {drill.motifLabel || "best move"}.</div>
            <p className="text-mist text-[12.5px] leading-relaxed">
              This is a position you got wrong before. Play the move the engine would.
            </p>

            <AnimatePresence mode="wait">
              {phase === "solving" ? (
                <motion.div key="s" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="mt-4">
                  <Button size="sm" variant="outline" onClick={giveUp}><HelpCircle size={14} /> I don't know</Button>
                </motion.div>
              ) : (
                <motion.div key="r" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="mt-4">
                  {result === "correct" ? (
                    <div className="flex items-center gap-2 text-sage text-[13.5px] mb-2"><Check size={16} /> Correct — {drill.bestSan}.</div>
                  ) : (
                    <div className="flex items-center gap-2 text-ember text-[13.5px] mb-2">
                      <X size={16} /> {attemptSan ? <>Not {attemptSan} — the move was</> : <>The move was</>} <span className="font-mono text-sage">{drill.bestSan}</span>.
                    </div>
                  )}
                  <div className="text-taupe text-[11.5px] mb-3">How did that feel? Your grade schedules the next review.</div>
                  {result === "correct" ? (
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" onClick={() => grade("hard")} disabled={grading}>Hard</Button>
                      <Button size="sm" onClick={() => grade("good")} disabled={grading}>Good</Button>
                      <Button size="sm" variant="outline" onClick={() => grade("easy")} disabled={grading}>Easy</Button>
                    </div>
                  ) : (
                    <div className="flex gap-2">
                      <Button size="sm" onClick={() => grade("again")} disabled={grading}>Again</Button>
                      <Button size="sm" variant="outline" onClick={() => grade("hard")} disabled={grading}>Got it now</Button>
                    </div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <div className="panel-2 p-3.5 flex items-center justify-between">
            <span className="text-taupe text-[11.5px]">Reviewed this session</span>
            <span className="font-mono text-[13px] text-ivory">{reviewed} · {solved} solved</span>
          </div>
        </div>
      </div>
    </Shell>
  );
}

function Shell({ children, onBack }: { children: React.ReactNode; onBack: () => void }) {
  return (
    <div>
      <button onClick={onBack} className="focusable inline-flex items-center gap-1.5 text-mist hover:text-ivory text-[13px] mb-5">
        <ArrowLeft size={14} /> Back to dashboard
      </button>
      {children}
    </div>
  );
}
