import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Anchor, Info } from "lucide-react";
import { api } from "../lib/api";
import type { Bot, Rating } from "../lib/types";
import { PageHeader, Badge, Sparkline, Avatar } from "../components/ui";

export default function Leaderboard() {
  const [ratings, setRatings] = useState<Rating[]>([]);
  const [bots, setBots] = useState<Record<string, Bot>>({});

  useEffect(() => {
    Promise.all([api.ratings(), api.bots()]).then(([r, b]) => {
      setRatings([...r].sort((a, z) => z.elo - a.elo));
      setBots(Object.fromEntries(b.map((x) => [x.id, x])));
    });
  }, []);

  const leader = ratings[0];
  const totalGames = useMemo(
    () => ratings.reduce((s, r) => s + r.games, 0),
    [ratings]
  );

  return (
    <div>
      <PageHeader
        eyebrow="Anchored Elo · CCRL scale"
        title="Standings"
        desc="Every rating is anchored to a fixed reference and computed from controlled matches. Reproducible on this machine — not a universal number."
        right={
          <div className="text-right">
            <div className="font-mono text-[34px] text-ivory tnum leading-none">
              {totalGames.toLocaleString()}
            </div>
            <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-taupe mt-2">
              games rated
            </div>
          </div>
        }
      />

      {leader && bots[leader.botId] && <Podium ratings={ratings.slice(0, 3)} bots={bots} />}

      <div className="panel overflow-hidden">
        <div className="grid grid-cols-[56px_1fr_140px_120px_150px_110px] gap-4 px-6 py-3.5 border-b border-line text-taupe font-mono text-[10px] uppercase tracking-[0.18em]">
          <div>Rank</div>
          <div>Engine</div>
          <div className="text-right">Elo ± 95%</div>
          <div className="text-right">Games</div>
          <div>Record</div>
          <div className="text-right">Settling</div>
        </div>

        {ratings.map((r, i) => {
          const bot = bots[r.botId];
          if (!bot) return null;
          return (
            <motion.div
              key={r.botId}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.04 * i, duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
              className="grid grid-cols-[56px_1fr_140px_120px_150px_110px] gap-4 px-6 py-4 items-center border-b border-line/60 hover:bg-white/[0.018] transition-colors group"
            >
              <Rank n={i + 1} />

              <div className="flex items-center gap-3.5 min-w-0">
                <Avatar name={bot.name} accent={bot.accent} />
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-ivory text-[14.5px] truncate">{bot.name}</span>
                    {r.anchored && (
                      <span title="Rating anchor" className="text-brass">
                        <Anchor size={12} strokeWidth={2} />
                      </span>
                    )}
                  </div>
                  <div className="text-taupe text-[11.5px] mt-0.5">
                    {bot.family} · {bot.version}
                  </div>
                </div>
              </div>

              <div className="text-right">
                <span className="font-mono text-[19px] text-ivory tnum">{Math.round(r.elo)}</span>
                <span className="font-mono text-[11px] text-taupe ml-1.5">±{r.error}</span>
              </div>

              <div className="text-right font-mono text-[13px] text-mist tnum">
                {r.games.toLocaleString()}
              </div>

              <Record r={r} />

              <div className="flex items-center justify-end gap-2.5">
                <Settle provisional={r.provisional} anchored={r.anchored} />
                <Sparkline data={r.history} />
              </div>
            </motion.div>
          );
        })}

        {ratings.length === 0 && (
          <div className="px-6 py-16 text-center text-taupe text-[13.5px]">
            No rated games yet. Run a match in the Arena to populate the standings.
          </div>
        )}
      </div>

      <div className="flex items-start gap-2.5 mt-5 text-taupe text-[12px] leading-relaxed max-w-[640px]">
        <Info size={14} className="mt-0.5 shrink-0" />
        <p>
          Ratings are a maximum-likelihood fit over the full pairwise results matrix, pinned to the
          anchor (⚓). The dot shows whether a rating has <span className="text-sage">settled</span> or is
          still <span className="text-mist">provisional</span> — for a fixed-strength bot the trend
          converging <em>is</em> the signal, not the bot changing. To decide whether one tweak made an
          engine stronger, use an <span className="text-mist">SPRT</span> regression, not this board.
          Elo is anchored and reproducible, but tied to this hardware and time control.
        </p>
      </div>
    </div>
  );
}

function Podium({ ratings, bots }: { ratings: Rating[]; bots: Record<string, Bot> }) {
  const medals = ["var(--color-brass)", "#cdd2d6", "#c98a5a"];
  return (
    <div className="grid grid-cols-3 gap-4 mb-8">
      {ratings.map((r, i) => {
        const bot = bots[r.botId];
        if (!bot) return null;
        return (
          <motion.div
            key={r.botId}
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.08 * i, duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
            className="panel p-5 relative overflow-hidden"
            style={i === 0 ? { borderColor: "rgba(200,163,91,0.35)" } : undefined}
          >
            {i === 0 && (
              <div
                className="absolute -top-16 -right-10 w-40 h-40 rounded-full opacity-25"
                style={{ background: "radial-gradient(circle, var(--color-brass), transparent 65%)", filter: "blur(30px)" }}
              />
            )}
            <div className="flex items-center justify-between mb-4 relative">
              <span className="font-display text-[44px] leading-none tnum" style={{ color: medals[i] }}>
                {i + 1}
              </span>
              <Avatar name={bot.name} accent={bot.accent} size={44} />
            </div>
            <div className="text-ivory text-[16px] relative">{bot.name}</div>
            <div className="text-taupe text-[12px] mb-3 relative">{bot.family}</div>
            <div className="flex items-end justify-between relative">
              <div>
                <span className="font-mono text-[26px] text-ivory tnum">{Math.round(r.elo)}</span>
                <span className="font-mono text-[12px] text-taupe ml-1">±{r.error}</span>
              </div>
              <Sparkline data={r.history} w={70} h={24} />
            </div>
          </motion.div>
        );
      })}
    </div>
  );
}

function Settle({ provisional, anchored }: { provisional?: boolean; anchored: boolean }) {
  if (anchored)
    return <span title="Fixed rating anchor" className="w-1.5 h-1.5 rounded-full" style={{ background: "var(--color-brass)" }} />;
  const settled = !provisional;
  return (
    <span
      title={settled ? "Settled — enough games for a trustworthy rating" : "Provisional — rating still moving, needs more games"}
      className="w-1.5 h-1.5 rounded-full shrink-0"
      style={{ background: settled ? "var(--color-sage)" : "var(--color-taupe)" }}
    />
  );
}

function Rank({ n }: { n: number }) {
  const top = n <= 3;
  const colors = ["var(--color-brass)", "#cdd2d6", "#c98a5a"];
  return (
    <div
      className="font-mono tnum text-[15px]"
      style={{ color: top ? colors[n - 1] : "var(--color-taupe)" }}
    >
      {String(n).padStart(2, "0")}
    </div>
  );
}

function Record({ r }: { r: Rating }) {
  const total = r.wins + r.draws + r.losses || 1;
  const seg = (n: number, c: string) => (
    <div style={{ width: `${(n / total) * 100}%`, background: c }} className="h-full" />
  );
  return (
    <div>
      <div className="flex h-1.5 rounded-full overflow-hidden bg-white/[0.04]">
        {seg(r.wins, "var(--color-sage)")}
        {seg(r.draws, "var(--color-taupe)")}
        {seg(r.losses, "var(--color-ember)")}
      </div>
      <div className="flex gap-2 mt-1.5 font-mono text-[10px] text-taupe tnum">
        <span className="text-sage">{r.wins}</span>
        <span>{r.draws}</span>
        <span className="text-ember">{r.losses}</span>
      </div>
    </div>
  );
}
