import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { CircleDot, Swords, Trophy, Cpu, ArrowUpRight } from "lucide-react";
import { api } from "../lib/api";
import type { Bot, Rating, MatchResult } from "../lib/types";
import { Avatar } from "../components/ui";

export default function Dashboard() {
  const [bots, setBots] = useState<Bot[]>([]);
  const [ratings, setRatings] = useState<Rating[]>([]);
  const [matches, setMatches] = useState<MatchResult[]>([]);

  useEffect(() => {
    api.bots().then(setBots).catch(() => {});
    api.ratings().then((r) => setRatings([...r].sort((a, z) => z.elo - a.elo))).catch(() => {});
    api.matches().then(setMatches).catch(() => {});
  }, []);

  const engines = bots.filter((b) => b.kind === "engine");
  const installed = engines.filter((b) => b.installed).length;
  const totalGames = ratings.reduce((s, r) => s + r.games, 0);
  const top = ratings[0];
  const topBot = bots.find((b) => b.id === top?.botId);

  return (
    <div>
      {/* hero */}
      <motion.div
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
        className="panel p-9 mb-6 relative overflow-hidden"
      >
        <div className="absolute -top-24 -right-16 w-80 h-80 rounded-full opacity-30"
          style={{ background: "radial-gradient(circle, var(--color-brass), transparent 65%)", filter: "blur(50px)" }} />
        <div className="relative max-w-[620px]">
          <div className="font-mono text-[10px] uppercase tracking-[0.32em] text-brass mb-5">
            A local atelier for chess engines
          </div>
          <h1 className="text-[52px] leading-[1.0] text-ivory">
            Play them. <span className="brass-text">Pit them.</span> Rank them.
          </h1>
          <p className="text-mist text-[15px] mt-5 leading-relaxed">
            Download real engines, play them on a beautiful board, watch two of them fight move by move,
            and see them ranked on an anchored Elo leaderboard — all running on your Mac. The instrument
            for the work to come.
          </p>
          <div className="flex gap-3 mt-7">
            <Link to="/play"
              className="focusable inline-flex items-center gap-2 rounded-[10px] text-[14px] font-medium px-5 py-3 text-[#1a1407]"
              style={{ background: "linear-gradient(180deg,var(--color-brass-bright),var(--color-brass))" }}>
              <CircleDot size={16} /> Play a bot
            </Link>
            <Link to="/arena"
              className="focusable inline-flex items-center gap-2 rounded-[10px] text-[14px] font-medium px-5 py-3 text-ivory border border-line-2 hover:border-brass/50 transition-colors">
              <Swords size={16} /> Open the arena
            </Link>
          </div>
        </div>
      </motion.div>

      {/* stat row */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        <Stat i={0} label="Engines" value={String(engines.length)} sub={`${installed} online`} icon={Cpu} />
        <Stat i={1} label="Bots ranked" value={String(ratings.length)} sub="on the ladder" icon={Trophy} />
        <Stat i={2} label="Games rated" value={totalGames.toLocaleString()} sub="controlled matches" icon={Swords} />
        <Stat i={3} label="Top rating" value={top ? String(Math.round(top.elo)) : "—"} sub={topBot?.name ?? "—"} icon={Trophy} accent />
      </div>

      <div className="grid grid-cols-[1.3fr_1fr] gap-4">
        {/* mini standings */}
        <motion.div
          initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2, duration: 0.5 }}
          className="panel p-5"
        >
          <div className="flex items-center justify-between mb-4">
            <div className="font-display text-[19px] text-ivory">Standings</div>
            <Link to="/leaderboard" className="focusable text-taupe hover:text-brass text-[12px] flex items-center gap-1 transition-colors">
              full board <ArrowUpRight size={13} />
            </Link>
          </div>
          {ratings.slice(0, 5).map((r, i) => {
            const bot = bots.find((b) => b.id === r.botId);
            if (!bot) return null;
            return (
              <div key={r.botId} className="flex items-center gap-3 py-2.5 border-b border-line/50 last:border-0">
                <span className="font-mono text-[13px] w-5 tnum" style={{ color: i < 3 ? "var(--color-brass)" : "var(--color-taupe)" }}>
                  {i + 1}
                </span>
                <Avatar name={bot.name} accent={bot.accent} size={32} />
                <span className="text-ivory text-[13.5px] flex-1 truncate">{bot.name}</span>
                <span className="font-mono text-[15px] text-ivory tnum">{Math.round(r.elo)}</span>
                <span className="font-mono text-[11px] text-taupe">±{r.error}</span>
              </div>
            );
          })}
          {ratings.length === 0 && <div className="text-taupe text-[13px] py-6 text-center">No ratings yet.</div>}
        </motion.div>

        {/* recent activity */}
        <motion.div
          initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.28, duration: 0.5 }}
          className="panel p-5"
        >
          <div className="font-display text-[19px] text-ivory mb-4">Recent games</div>
          {matches.slice(0, 6).map((m) => {
            const w = m.whiteName ?? bots.find((b) => b.id === m.white)?.name ?? m.white;
            const b = m.blackName ?? bots.find((x) => x.id === m.black)?.name ?? m.black;
            return (
              <div key={m.id} className="flex items-center gap-2 py-2 border-b border-line/50 last:border-0 text-[12.5px]">
                <span className="text-mist flex-1 truncate text-right">{w}</span>
                <span className="font-mono text-brass tnum px-1">{m.result}</span>
                <span className="text-mist flex-1 truncate">{b}</span>
              </div>
            );
          })}
          {matches.length === 0 && <div className="text-taupe text-[13px] py-6 text-center">No matches played yet.</div>}
        </motion.div>
      </div>
    </div>
  );
}

function Stat({
  i, label, value, sub, icon: Icon, accent,
}: {
  i: number; label: string; value: string; sub: string; icon: any; accent?: boolean;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.06 * i + 0.1, duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
      className="panel p-5"
    >
      <div className="flex items-center justify-between mb-4">
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-taupe">{label}</span>
        <Icon size={15} className={accent ? "text-brass" : "text-taupe"} strokeWidth={1.75} />
      </div>
      <div className={`font-mono text-[30px] tnum leading-none ${accent ? "text-brass" : "text-ivory"}`}>{value}</div>
      <div className="text-taupe text-[11.5px] mt-2 truncate">{sub}</div>
    </motion.div>
  );
}
