import { NavLink, useLocation } from "react-router-dom";
import { motion } from "framer-motion";
import {
  LayoutDashboard,
  Swords,
  Trophy,
  Cpu,
  CircleDot,
  GraduationCap,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../lib/api";

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  hint: string;
}

const NAV: NavItem[] = [
  { to: "/", label: "Atelier", icon: LayoutDashboard, hint: "Overview" },
  { to: "/play", label: "Play", icon: CircleDot, hint: "You vs a bot" },
  { to: "/train", label: "Dojo", icon: GraduationCap, hint: "Improve your game" },
  { to: "/arena", label: "Arena", icon: Swords, hint: "Bot vs bot" },
  { to: "/leaderboard", label: "Standings", icon: Trophy, hint: "Anchored Elo" },
  { to: "/bots", label: "Library", icon: Cpu, hint: "Engines & rungs" },
];

export default function Layout({ children }: { children: React.ReactNode }) {
  const loc = useLocation();
  const [sf, setSf] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    api.health().then((h) => setSf(h.stockfish)).catch(() => setSf(null));
  }, []);

  return (
    <div className="grain min-h-screen relative">
      {/* atmosphere */}
      <div
        className="glow"
        style={{ width: 560, height: 560, top: -180, left: -120, background: "rgba(200,163,91,0.10)" }}
      />
      <div
        className="glow"
        style={{ width: 480, height: 480, bottom: -200, right: -120, background: "rgba(127,166,184,0.06)" }}
      />

      <div className="relative z-10 flex min-h-screen">
        {/* ---------- Sidebar ---------- */}
        <aside className="w-[248px] shrink-0 border-r border-line/60 px-5 py-7 flex flex-col sticky top-0 h-screen">
          <div className="flex items-center gap-3 px-2 mb-9">
            <Mark />
            <div className="leading-none">
              <div className="font-display text-[22px] tracking-tight brass-text">Gambit</div>
              <div className="font-mono text-[9px] uppercase tracking-[0.28em] text-taupe mt-1">
                Engine Atelier
              </div>
            </div>
          </div>

          <nav className="flex flex-col gap-1">
            {NAV.map((item) => {
              const active =
                item.to === "/" ? loc.pathname === "/" : loc.pathname.startsWith(item.to);
              return (
                <NavLink key={item.to} to={item.to} className="focusable rounded-[11px]">
                  <div className="relative group flex items-center gap-3 px-3 py-2.5 rounded-[11px] transition-colors">
                    {active && (
                      <motion.div
                        layoutId="nav-active"
                        className="absolute inset-0 rounded-[11px] border border-line-2"
                        style={{ background: "rgba(244,238,226,0.04)" }}
                        transition={{ type: "spring", stiffness: 420, damping: 34 }}
                      />
                    )}
                    <item.icon
                      size={17}
                      strokeWidth={1.75}
                      className={`relative z-10 transition-colors ${
                        active ? "text-brass" : "text-taupe group-hover:text-mist"
                      }`}
                    />
                    <div className="relative z-10 flex-1">
                      <div
                        className={`text-[13.5px] transition-colors ${
                          active ? "text-ivory" : "text-mist group-hover:text-ivory"
                        }`}
                      >
                        {item.label}
                      </div>
                    </div>
                    {active && <div className="relative z-10 w-1 h-1 rounded-full bg-brass" />}
                  </div>
                </NavLink>
              );
            })}
          </nav>

          <div className="mt-auto">
            <div className="divider mb-4" />
            <EngineStatus sf={sf} />
          </div>
        </aside>

        {/* ---------- Main ---------- */}
        <main className="flex-1 min-w-0 px-10 py-9">
          <div className="max-w-[1360px] mx-auto w-full">{children}</div>
        </main>
      </div>
    </div>
  );
}

function Mark() {
  return (
    <div className="relative w-9 h-9 rounded-[10px] grid place-items-center overflow-hidden"
      style={{ background: "linear-gradient(150deg,#1f1a12,#0e0c08)", border: "1px solid var(--color-line-2)" }}>
      <div className="absolute inset-0 opacity-40"
        style={{ background: "radial-gradient(circle at 30% 20%, rgba(230,203,141,0.5), transparent 60%)" }} />
      {/* stylized knight glyph */}
      <span className="relative font-display text-[19px] text-brass-bright leading-none" style={{ marginTop: -1 }}>
        ♞
      </span>
    </div>
  );
}

function EngineStatus({ sf }: { sf: string | null | undefined }) {
  const known = sf !== undefined;
  const ok = !!sf;
  return (
    <div className="panel-2 px-3.5 py-3">
      <div className="flex items-center gap-2.5">
        <span
          className="w-2 h-2 rounded-full shrink-0"
          style={{
            background: !known ? "var(--color-taupe)" : ok ? "var(--color-sage)" : "var(--color-ember)",
            boxShadow: ok ? "0 0 10px rgba(147,169,114,0.7)" : "none",
          }}
        />
        <div className="min-w-0">
          <div className="text-[11px] text-mist leading-tight">
            {!known ? "Checking engine…" : ok ? "Stockfish online" : "No engine"}
          </div>
          <div className="font-mono text-[9.5px] text-taupe truncate">
            {ok ? sf : known ? "brew install stockfish" : "—"}
          </div>
        </div>
      </div>
    </div>
  );
}
