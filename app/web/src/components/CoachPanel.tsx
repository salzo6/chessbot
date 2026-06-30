import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Lightbulb, Undo2, Target, Sparkles, ShieldAlert, ShieldCheck, Eye, Loader2, Smile, AlertTriangle } from "lucide-react";
import type { CoachState } from "../hooks/useCoach";
import type { ThreatInfo } from "../lib/coach";
import type { Color } from "../lib/types";
import { api } from "../lib/api";
import { formatEvalWhite, lineCpWhite, winPct } from "../lib/coach";
import { COACH_NAME, MOODS, currentBeat, type Beat, type Mood } from "../lib/coachVoice";
import { Button } from "./ui";

export default function CoachPanel({
  coach,
  fen,
  myColor,
  onTakeback,
  canTakeback,
  gameOver,
  yourTurn,
  pacing,
  threats,
  guardOn,
  onToggleGuard,
}: {
  coach: CoachState;
  fen: string;
  myColor: Color;
  onTakeback: () => void;
  canTakeback: boolean;
  gameOver: boolean;
  yourTurn: boolean;
  pacing: boolean;
  threats: ThreatInfo | null;
  guardOn: boolean;
  onToggleGuard: () => void;
}) {
  const { objectiveLine, evalFracWhite, judgment, bestSan, hintLevel } = coach;

  // --- the running conversation ---
  const [feed, setFeed] = useState<Beat[]>([]);
  // Objective eval from your POV, so Marcus's words stay consistent with the eval chip.
  const yourWinPct = objectiveLine ? winPct((myColor === "white" ? 1 : -1) * lineCpWhite(objectiveLine)) : null;
  const beat = currentBeat({ fen, gameOver, pacing, yourTurn, threats, judgment: judgment ?? null, myColor, yourWinPct });
  useEffect(() => {
    if (!beat) return;
    setFeed((prev) => {
      const last = prev[prev.length - 1];
      if (last && last.key === beat.key) {
        if (last.text === beat.text && last.mood === beat.mood) return prev;
        const next = prev.slice();
        next[next.length - 1] = beat;
        return next;
      }
      return [...prev, beat].slice(-6);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [beat?.key, beat?.text, beat?.mood]);

  const mood: Mood = feed.length ? feed[feed.length - 1].mood : "neutral";

  // auto-scroll the feed to the newest line
  const feedRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight, behavior: "smooth" });
  }, [feed]);

  // --- optional AI elaboration on your last move ---
  const [aiAvailable, setAiAvailable] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  useEffect(() => { api.health().then((h) => setAiAvailable(!!h.aiCoach)).catch(() => {}); }, []);
  async function askAI() {
    if (!judgment) return;
    setAiLoading(true);
    try {
      const r = await api.coachExplain({
        fen, san: judgment.san, evalText: formatEvalWhite(objectiveLine),
        bestSan: judgment.bestSan, pv: objectiveLine?.pv, cls: judgment.cls,
      });
      if (r.ok && r.text) {
        setFeed((prev) => [...prev, { key: fen + "|ai|" + prev.length, mood, text: r.text! }].slice(-6));
      }
    } catch { /* silent */ }
    setAiLoading(false);
  }

  return (
    <div className="panel p-0 overflow-hidden flex flex-col" style={{ minHeight: 320 }}>
      {/* header: Marcus + live mood + eval */}
      <div className="flex items-center gap-3 px-4 pt-4 pb-3">
        <CoachAvatar mood={mood} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-ivory text-[14px] font-medium">{COACH_NAME}</span>
            <span className="font-mono text-[9px] uppercase tracking-[0.16em]" style={{ color: MOODS[mood].ring }}>
              {coach.ready || feed.length ? MOODS[mood].label : "warming up"}
            </span>
          </div>
          <div className="text-taupe text-[11px]">your coach · plays to teach</div>
        </div>
        <EvalChip line={objectiveLine} frac={evalFracWhite} />
      </div>

      {/* the conversation */}
      <div ref={feedRef} className="flex-1 overflow-y-auto px-4 py-2 flex flex-col gap-2" style={{ maxHeight: 230 }}>
        {feed.length === 0 ? (
          <div className="text-taupe text-[12.5px] my-auto text-center px-3">
            {gameOver ? "Step through the game with ← → and I'll review it." : "Make a move and I'll coach you through the game."}
          </div>
        ) : (
          <AnimatePresence initial={false}>
            {feed.map((m, i) => (
              <Bubble key={m.key + ":" + i} beat={m} latest={i === feed.length - 1} />
            ))}
          </AnimatePresence>
        )}
      </div>

      {/* strongest move, when there's one to suggest */}
      {!gameOver && (
        <div className="px-4 pt-1 pb-2 flex items-center justify-between gap-2">
          <div className="min-w-0">
            <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-taupe">Strongest</span>{" "}
            <span className="text-ivory text-[12.5px] font-mono">
              {bestSan ? `${bestSan} (${formatEvalWhite(objectiveLine)})` : "…"}
            </span>
          </div>
          {aiAvailable && judgment && (
            <button onClick={askAI} disabled={aiLoading}
              className="focusable inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.14em] text-brass hover:brightness-110 disabled:opacity-40">
              <Sparkles size={10} className={aiLoading ? "animate-pulse" : ""} /> {aiLoading ? "…" : "ask"}
            </button>
          )}
        </div>
      )}

      {/* actions */}
      <div className="px-4 pb-3 pt-1 border-t border-line-2/60">
        <div className="flex gap-2 mt-3">
          <Button size="sm" variant="outline" onClick={coach.nextHint} disabled={gameOver || !coach.bestUci}>
            <Lightbulb size={13} /> {hintLevel === 0 ? "Hint" : hintLevel >= 3 ? "Show move" : "More"}
          </Button>
          <Button size="sm" variant="outline" onClick={coach.showBest} disabled={gameOver || !bestSan}>
            <Target size={13} /> Best
          </Button>
          <Button size="sm" variant="outline" onClick={onTakeback} disabled={!canTakeback}>
            <Undo2 size={13} /> Undo
          </Button>
        </div>
        <button onClick={onToggleGuard}
          className="focusable mt-2 w-full flex items-center justify-between gap-2 px-3 py-1.5 rounded-[10px] hover:bg-white/[0.02] transition-colors">
          <span className="flex items-center gap-1.5 text-[11.5px] text-mist">
            {guardOn ? <ShieldCheck size={12} className="text-sage" /> : <ShieldAlert size={12} className="text-taupe" />}
            Blunder guard
          </span>
          <span className="font-mono text-[9px] uppercase tracking-[0.14em]" style={{ color: guardOn ? "#93a972" : "#7d7464" }}>
            {guardOn ? "on" : "off"}
          </span>
        </button>
      </div>
    </div>
  );
}

function Bubble({ beat, latest }: { beat: Beat; latest: boolean }) {
  const accent = MOODS[beat.mood].ring;
  const thinking = beat.mood === "thinking" && latest;
  return (
    <motion.div
      initial={{ opacity: 0, y: 6, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0 }}
      transition={{ type: "spring", stiffness: 240, damping: 24 }}
      className={`max-w-[88%] rounded-[12px] px-3 py-2 text-[12.5px] leading-snug ${beat.fromYou ? "self-end" : "self-start"}`}
      style={{
        background: beat.fromYou ? "rgba(255,255,255,0.04)" : `${accent}14`,
        border: `1px solid ${beat.fromYou ? "rgba(255,255,255,0.07)" : accent + "33"}`,
        color: beat.fromYou ? "#cfc7b6" : "#e9e2d2",
        borderBottomLeftRadius: beat.fromYou ? 12 : 4,
        borderBottomRightRadius: beat.fromYou ? 4 : 12,
      }}
    >
      {thinking ? <TypingDots color={accent} /> : beat.text}
    </motion.div>
  );
}

function TypingDots({ color }: { color: string }) {
  return (
    <span className="inline-flex items-center gap-1 py-0.5">
      {[0, 1, 2].map((i) => (
        <motion.span
          key={i}
          className="inline-block w-1.5 h-1.5 rounded-full"
          style={{ background: color }}
          animate={{ opacity: [0.3, 1, 0.3], y: [0, -2, 0] }}
          transition={{ duration: 0.9, repeat: Infinity, delay: i * 0.15 }}
        />
      ))}
    </span>
  );
}

function CoachAvatar({ mood }: { mood: Mood }) {
  const ring = MOODS[mood].ring;
  const Icon = mood === "thinking" ? Loader2 : mood === "alarmed" ? ShieldAlert : mood === "worried" ? AlertTriangle : mood === "happy" || mood === "proud" ? Smile : Eye;
  return (
    <div className="relative shrink-0" style={{ width: 42, height: 42 }}>
      <motion.div
        className="rounded-full grid place-items-center font-mono text-[17px]"
        style={{ width: 42, height: 42, color: ring, background: `linear-gradient(155deg, ${ring}22, ${ring}06)`, border: `2px solid ${ring}` }}
        animate={mood === "thinking" ? { scale: [1, 1.04, 1] } : { scale: 1 }}
        transition={{ duration: 1.2, repeat: mood === "thinking" ? Infinity : 0 }}
      >
        {COACH_NAME[0]}
      </motion.div>
      <div
        className="absolute -bottom-0.5 -right-0.5 rounded-full grid place-items-center"
        style={{ width: 17, height: 17, background: "#18150f", border: `1.5px solid ${ring}` }}
      >
        <Icon size={9} className={mood === "thinking" ? "animate-spin" : ""} style={{ color: ring }} />
      </div>
    </div>
  );
}

function EvalChip({ line, frac }: { line: any; frac: number }) {
  return (
    <div className="shrink-0 text-right">
      <div className="font-mono text-[14px] tnum text-ivory leading-none">{formatEvalWhite(line)}</div>
      <div className="mt-1.5 h-1 w-14 rounded-full overflow-hidden ml-auto" style={{ background: "#2a2620" }}>
        <motion.div className="h-full" style={{ background: "linear-gradient(90deg,#cfc7b6,#f4eee2)" }}
          animate={{ width: `${frac * 100}%` }} transition={{ type: "spring", stiffness: 120, damping: 22 }} />
      </div>
    </div>
  );
}
