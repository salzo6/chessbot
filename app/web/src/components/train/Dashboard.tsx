// Train dashboard — "what to work on" (docs/16 §8.1). Reads the WeaknessProfile: a ranked
// list of your recurring mistakes, phase-accuracy bars, the accuracy trend, and the saved-
// games list (with live analysis progress). Every item traces back to a real mistake you made
// — the antidote to the stagnation trap (§0.3). No rating promises anywhere (§14).
import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { GraduationCap, ChevronRight, Loader2, AlertCircle } from "lucide-react";
import { Sparkline, Button, Badge } from "../ui";
import { train, type WeaknessProfile, type SavedGame, type Mistake } from "../../lib/train";

export default function Dashboard({
  onReview,
  onDrills,
}: {
  onReview: (gameId: string, ply?: number) => void;
  onDrills: () => void;
}) {
  const [profile, setProfile] = useState<WeaknessProfile | null>(null);
  const [games, setGames] = useState<SavedGame[]>([]);
  const [mistakes, setMistakes] = useState<Mistake[]>([]);
  const [drillDue, setDrillDue] = useState<number | null>(null);

  async function refresh() {
    try {
      const [w, g, m] = await Promise.all([train.weakness(), train.listGames(), train.mistakes()]);
      setProfile(w); setGames(g); setMistakes(m);
    } catch { /* server may be booting */ }
    try { const s = await train.drillStats(); setDrillDue(s.due); } catch { /* T2 not wired yet */ }
  }

  useEffect(() => {
    refresh();
    // poll while any game is still analyzing so progress + rollups update live
    const t = setInterval(refresh, 2500);
    return () => clearInterval(t);
  }, []);

  const analyzing = games.some((g) => g.analysisStatus === "pending" || g.analysisStatus === "running");
  useEffect(() => {
    if (!analyzing) return; // (interval already running; effect kept for clarity)
  }, [analyzing]);

  if (!profile) {
    return <div className="panel p-6 text-mist text-[13px]">Loading your training data…</div>;
  }

  const noGames = games.length === 0;

  return (
    <div className="grid grid-cols-[1fr_360px] gap-6 items-start">
      {/* left column */}
      <div className="flex flex-col gap-5">
        {noGames ? (
          <EmptyState />
        ) : (
          <>
            <RecurringMistakes profile={profile} mistakes={mistakes} onReview={onReview} />
            <PhaseAccuracy profile={profile} />
          </>
        )}

        {/* Saved games */}
        <div className="panel p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-taupe">Your games ({games.length})</div>
            {analyzing && (
              <span className="flex items-center gap-1.5 text-brass text-[10px] font-mono uppercase tracking-[0.14em]">
                <Loader2 size={11} className="animate-spin" /> analyzing
              </span>
            )}
          </div>
          {noGames ? (
            <div className="text-taupe text-[12.5px]">Finished Play games appear here automatically, then get analyzed.</div>
          ) : (
            <div className="flex flex-col gap-1.5">
              {games.map((g) => <GameRow key={g.id} g={g} onReview={onReview} />)}
            </div>
          )}
        </div>
      </div>

      {/* right column */}
      <div className="flex flex-col gap-5">
        <DrillsCard due={drillDue} onDrills={onDrills} />
        <TrendCard profile={profile} />
        <StatsCard profile={profile} />
        <HonestNote />
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="panel p-8 text-center">
      <div className="mx-auto mb-4 w-12 h-12 rounded-[12px] grid place-items-center" style={{ background: "linear-gradient(150deg,#1f1a12,#0e0c08)", border: "1px solid var(--color-line-2)" }}>
        <GraduationCap size={22} className="text-brass" />
      </div>
      <div className="text-ivory text-[16px] mb-2">No games yet</div>
      <p className="text-mist text-[13px] leading-relaxed max-w-[420px] mx-auto">
        Go to <b>Play</b> and finish a game against a bot. It'll be saved and analyzed automatically — then your
        recurring mistakes, weak phases, and drills show up here. Every drill traces back to a mistake you actually made.
      </p>
    </motion.div>
  );
}

function RecurringMistakes({ profile, mistakes, onReview }: { profile: WeaknessProfile; mistakes: Mistake[]; onReview: (g: string, p?: number) => void }) {
  if (!profile.recurring.length) {
    return (
      <div className="panel p-5">
        <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-taupe mb-2">Your recurring mistakes</div>
        <div className="text-taupe text-[12.5px]">None ledgered yet. Play a few games and this fills with the patterns you actually get wrong.</div>
      </div>
    );
  }
  const firstFor = (key: string): Mistake | undefined => {
    if (key === "droppedWinning") return undefined;
    return mistakes.find((m) => (m.motifs ?? []).some((t) => t.tag === key));
  };
  return (
    <div className="panel p-5">
      <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-taupe mb-4">Your recurring mistakes</div>
      <div className="flex flex-col gap-2">
        {profile.recurring.map((r, i) => {
          const target = firstFor(r.key);
          return (
            <motion.div key={r.key} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.04 }}
              className="flex items-center justify-between gap-3 panel-2 px-4 py-3 rounded-[10px]">
              <div className="flex items-center gap-3 min-w-0">
                <span className="font-mono text-[20px] tnum text-brass w-9 text-right">{r.count}×</span>
                <div className="min-w-0">
                  <div className="text-ivory text-[14px] truncate">{r.label}</div>
                  <div className="text-taupe text-[11.5px]">{r.kind === "motif" ? "tactical pattern" : "conversion"}</div>
                </div>
              </div>
              {target ? (
                <button onClick={() => onReview(target.gameId, target.ply)}
                  className="focusable shrink-0 inline-flex items-center gap-1 text-[12px] text-mist hover:text-brass transition-colors">
                  Review <ChevronRight size={13} />
                </button>
              ) : (
                <span className="shrink-0 text-taupe text-[11px]">across games</span>
              )}
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}

function PhaseAccuracy({ profile }: { profile: WeaknessProfile }) {
  const phases: ("opening" | "middlegame" | "endgame")[] = ["opening", "middlegame", "endgame"];
  const vals = phases.map((p) => profile.phaseAccuracy[p]).filter((v): v is number => v != null);
  const weakest = vals.length ? Math.min(...vals) : null;
  return (
    <div className="panel p-5">
      <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-taupe mb-4">Accuracy by phase</div>
      <div className="flex flex-col gap-3">
        {phases.map((p) => {
          const v = profile.phaseAccuracy[p];
          const isWeak = v != null && v === weakest && vals.length > 1;
          return (
            <div key={p}>
              <div className="flex items-center justify-between mb-1">
                <span className="text-[12.5px] text-mist capitalize">{p} {isWeak && <span className="text-ember text-[10px] font-mono uppercase ml-1">weakest</span>}</span>
                <span className="font-mono text-[12.5px] text-ivory tnum">{v == null ? "—" : `${v.toFixed(1)}%`} <span className="text-taupe">· {profile.phaseMoves[p]} moves</span></span>
              </div>
              <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "#2a2620" }}>
                <div className="h-full rounded-full" style={{ width: `${v ?? 0}%`, background: isWeak ? "var(--color-ember)" : "linear-gradient(90deg,var(--color-brass-deep),var(--color-brass))" }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function GameRow({ g, onReview }: { g: SavedGame; onReview: (g: string) => void }) {
  const status = g.analysisStatus;
  const canReview = status === "done";
  return (
    <button disabled={!canReview} onClick={() => canReview && onReview(g.id)}
      className={`focusable flex items-center justify-between gap-3 px-3.5 py-2.5 rounded-[10px] text-left transition-colors ${canReview ? "panel-2 hover:border-brass/60" : "opacity-70"}`}>
      <div className="min-w-0">
        <div className="text-ivory text-[13px] truncate">vs {g.botName} <span className="text-taupe">· you {g.youColor}</span></div>
        <div className="text-taupe text-[11px] font-mono">{g.result} · {g.reason || "unfinished"} · {new Date(g.createdAt).toLocaleDateString()}</div>
      </div>
      <div className="shrink-0 text-right">
        {status === "done" ? (
          <span className="text-[12px]"><span className="font-mono text-ember">{g.mistakeCount ?? 0}</span> <span className="text-taupe">mistakes</span></span>
        ) : status === "error" ? (
          <span className="flex items-center gap-1 text-ember text-[11px]"><AlertCircle size={12} /> error</span>
        ) : (
          <span className="flex items-center gap-1.5 text-brass text-[11px] font-mono">
            <Loader2 size={11} className="animate-spin" />
            {g.progress ? `${g.progress.ply}/${g.progress.total}` : "queued"}
          </span>
        )}
      </div>
    </button>
  );
}

function DrillsCard({ due, onDrills }: { due: number | null; onDrills: () => void }) {
  return (
    <div className="panel p-5" style={{ borderColor: due ? "rgba(200,163,91,0.35)" : undefined }}>
      <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-taupe mb-3">Today's drills</div>
      <div className="flex items-center justify-between">
        <div>
          <div className="text-ivory text-[26px] leading-none tnum">{due == null ? "—" : due}</div>
          <div className="text-taupe text-[11.5px] mt-1">{due == null ? "no drills yet" : due === 1 ? "drill due" : "drills due"}</div>
        </div>
        <Button size="sm" onClick={onDrills} disabled={due != null && due === 0}>Start drilling</Button>
      </div>
    </div>
  );
}

function TrendCard({ profile }: { profile: WeaknessProfile }) {
  return (
    <div className="panel p-5">
      <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-taupe mb-3">Accuracy trend</div>
      {profile.trend.length >= 2 ? (
        <div className="flex items-end justify-between gap-3">
          <Sparkline data={profile.trend} w={200} h={40} />
          <div className="text-right">
            <div className="font-mono text-[20px] text-ivory tnum">{profile.trend[profile.trend.length - 1].toFixed(0)}%</div>
            <div className="text-taupe text-[10.5px]">last game</div>
          </div>
        </div>
      ) : (
        <div className="text-taupe text-[12px]">Needs a couple of analyzed games. This tracks you vs your own past — not a rating.</div>
      )}
    </div>
  );
}

function StatsCard({ profile }: { profile: WeaknessProfile }) {
  const cells: [string, string, string?][] = [
    ["Games", String(profile.gamesAnalyzed)],
    ["Mistakes", String(profile.totalMistakes)],
    ["Blunders/100", String(profile.blunderRatePer100)],
    ["Hung/100", String(profile.hangingPer100)],
    ["Convert ≥80%", profile.advantageCapitalization == null ? "—" : `${profile.advantageCapitalization}%`, `${profile.advantageReached} chances`],
  ];
  return (
    <div className="panel p-5">
      <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-taupe mb-3">Your numbers</div>
      <div className="grid grid-cols-2 gap-2.5">
        {cells.map(([label, val, sub]) => (
          <div key={label} className="panel-2 px-3 py-2.5">
            <div className="font-mono text-[9px] uppercase tracking-[0.14em] text-taupe">{label}</div>
            <div className="font-mono text-[17px] text-ivory tnum mt-0.5">{val}</div>
            {sub && <div className="text-taupe text-[10px]">{sub}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}

function HonestNote() {
  return (
    <div className="panel-2 p-3.5">
      <div className="text-taupe text-[11px] leading-relaxed">
        Every classification comes from full-strength Stockfish; tactical tags marked <span className="font-mono">?</span> are
        heuristic. No rating is promised — the honest goal is fewer repeated mistakes and more patterns learned.
      </div>
    </div>
  );
}
