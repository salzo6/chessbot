import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Check, Download, Gauge, Cpu, Copy, ChevronRight } from "lucide-react";
import { api } from "../lib/api";
import type { Bot } from "../lib/types";
import { PageHeader, Badge, Avatar, Button } from "../components/ui";

export default function Bots() {
  const [bots, setBots] = useState<Bot[]>([]);
  const [install, setInstall] = useState<{ command: string; detected: string | null } | null>(null);
  const [copied, setCopied] = useState(false);
  const [registering, setRegistering] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reload() {
    api.bots().then(setBots);
    api.installCmd().then(setInstall).catch(() => {});
  }
  useEffect(reload, []);

  const engines = bots.filter((b) => b.kind === "engine");
  const rungsByBase = (id: string) => bots.filter((b) => b.kind === "throttle" && b.baseId === id);

  const copy = () => {
    if (!install) return;
    navigator.clipboard.writeText(install.command);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  async function register() {
    setRegistering(true);
    setError(null);
    try {
      const r = await api.registerStockfish();
      if (!r.ok) setError(r.error || "Could not register Stockfish");
      reload();
    } catch (e) {
      setError(String(e));
    } finally {
      setRegistering(false);
    }
  }

  return (
    <div>
      <PageHeader
        eyebrow="Bot library"
        title="The Library"
        desc="Engines registered in your local bank (engines/ — git-ignored), plus throttled rungs of each. One binary becomes many opponents: a calibration ladder without downloading a dozen engines."
      />

      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="panel p-5 mb-7"
      >
        <div className="flex items-center gap-5">
          <div className="w-10 h-10 rounded-[10px] grid place-items-center shrink-0"
            style={{ background: "rgba(200,163,91,0.1)", border: "1px solid rgba(200,163,91,0.3)" }}>
            <Download size={18} className="text-brass" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-ivory text-[14px]">Add Stockfish to your bank</div>
            <div className="text-taupe text-[12px] mt-0.5">
              {install?.detected
                ? "Found on your system — copy it into the managed engines/ folder and register it (anchor + ladder)."
                : "Not on your system yet. Install it first, then register it into your bank."}
            </div>
          </div>
          {install?.detected ? (
            <Button onClick={register} disabled={registering}>
              <Download size={14} /> {registering ? "Registering…" : "Add to library"}
            </Button>
          ) : (
            <button
              onClick={copy}
              className="focusable flex items-center gap-2.5 font-mono text-[12.5px] text-ivory panel-2 px-4 py-2.5 hover:border-brass/50 transition-colors"
            >
              <span className="text-brass">$</span> {install?.command ?? "brew install stockfish"}
              {copied ? <Check size={14} className="text-sage" /> : <Copy size={14} className="text-taupe" />}
            </button>
          )}
        </div>
        {error && <div className="text-ember text-[12px] mt-3">{error}</div>}
      </motion.div>

      {engines.length === 0 && (
        <div className="panel px-6 py-14 text-center text-taupe text-[13.5px] mb-4">
          Your bank is empty. Add an engine above to populate the library.
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        {engines.map((bot, i) => {
          const rungs = rungsByBase(bot.id);
          return (
            <motion.div
              key={bot.id}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.05 * i, duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
              className="panel p-5"
            >
              <div className="flex items-start gap-4">
                <Avatar name={bot.name} accent={bot.accent} size={46} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-ivory text-[16px]">{bot.name}</div>
                    {bot.installed ? (
                      <Badge tone="sage"><Check size={11} /> ready</Badge>
                    ) : (
                      <Badge tone="ember">offline</Badge>
                    )}
                  </div>
                  <div className="text-taupe text-[12px] mt-0.5">
                    {bot.family} · {bot.version}
                  </div>
                  <p className="text-mist text-[12.5px] mt-2.5 leading-relaxed">{bot.blurb}</p>
                </div>
              </div>

              <div className="flex items-center gap-2 mt-4 flex-wrap">
                <Badge><Cpu size={11} /> {bot.license}</Badge>
                <a href={bot.source} target="_blank" rel="noreferrer"
                   className="focusable inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.14em] text-taupe hover:text-brass px-2 py-1 rounded-md border border-line-2 transition-colors">
                  source <ChevronRight size={11} />
                </a>
              </div>

              {rungs.length > 0 && (
                <div className="mt-4 pt-4 border-t border-line/60">
                  <div className="flex items-center gap-1.5 text-taupe font-mono text-[10px] uppercase tracking-[0.18em] mb-2.5">
                    <Gauge size={12} /> throttle rungs
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {rungs.map((r) => (
                      <span key={r.id}
                        className="font-mono text-[11px] text-mist px-2.5 py-1 rounded-md panel-2 tnum">
                        {r.uciElo ? `${r.uciElo} Elo` : r.nodes ? `${r.nodes >= 1000 ? r.nodes / 1000 + "k" : r.nodes} nodes` : r.movetime ? `${r.movetime}ms` : r.version}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}
