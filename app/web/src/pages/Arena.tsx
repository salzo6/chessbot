import { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Swords, Play as PlayIcon, Square as Stop, Clock, Layers, Trophy, Users } from "lucide-react";
import { api, wsURL } from "../lib/api";
import type { Bot, MatchResult, Rating } from "../lib/types";
import Board from "../components/Board";
import { PageHeader, Button, Avatar } from "../components/ui";

interface LiveMove { san: string; scoreCp?: number; mate?: number }
interface GameOutcome { index: number; result: string; reason: string }
interface Pair { a: string; b: string; aName: string; bName: string; index: number; total: number }

const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const GAME_COUNTS = [1, 6, 10, 20, 0];
const PER_PAIR = [1, 2, 4, 10];

export default function Arena() {
  const [bots, setBots] = useState<Bot[]>([]);
  const [mode, setMode] = useState<"match" | "roundrobin">("match");

  // shared board
  const [fen, setFen] = useState(START_FEN);
  const [lastMove, setLastMove] = useState<[string, string] | undefined>();
  const [moves, setMoves] = useState<LiveMove[]>([]);
  const [turn, setTurn] = useState<"white" | "black">("white");
  const [running, setRunning] = useState(false);

  // match mode
  const [white, setWhite] = useState("");
  const [black, setBlack] = useState("");
  const [movetime, setMovetime] = useState(400);
  const [games, setGames] = useState(10);
  const [score, setScore] = useState({ a: 0, b: 0, played: 0 });
  const [outcomes, setOutcomes] = useState<GameOutcome[]>([]);
  const [summary, setSummary] = useState<{ a: number; b: number; played: number } | null>(null);

  // round-robin mode
  const [gamesPerPair, setGamesPerPair] = useState(2);
  const [pair, setPair] = useState<Pair | null>(null);
  const [pairScore, setPairScore] = useState({ a: 0, b: 0 });
  const [done, setDone] = useState(0);
  const [liveRatings, setLiveRatings] = useState<Rating[]>([]);
  const [rrSummary, setRrSummary] = useState<{ pairs: number; games: number } | null>(null);

  const [recent, setRecent] = useState<MatchResult[]>([]);
  const ws = useRef<WebSocket | null>(null);
  const poll = useRef<ReturnType<typeof setInterval> | null>(null);

  const wBot = bots.find((b) => b.id === white);
  const bBot = bots.find((b) => b.id === black);
  const lastInfo = moves[moves.length - 1];
  const engineCount = bots.filter((b) => b.kind === "engine").length;
  const rrTotalGames = (engineCount * (engineCount - 1) / 2) * gamesPerPair;

  useEffect(() => {
    api.bots().then((bs) => {
      const inst = bs.filter((b) => b.installed);
      setBots(inst);
      if (inst[0]) setWhite(inst[0].id);
      setBlack((inst[1] ?? inst[0])?.id ?? "");
    });
    api.matches().then(setRecent).catch(() => {});
    return () => { if (poll.current) clearInterval(poll.current); };
  }, []);

  function resetBoard() {
    setFen(START_FEN); setLastMove(undefined); setMoves([]); setTurn("white");
  }
  function onBoardMsg(m: any) {
    if (m.type === "gameStart") { setFen(m.fen); setLastMove(undefined); setMoves([]); setTurn("white"); }
    else if (m.type === "move") {
      setFen(m.fen);
      setLastMove([m.uci.slice(0, 2), m.uci.slice(2, 4)]);
      setTurn(m.turn);
      setMoves((x) => [...x, { san: m.san, scoreCp: m.book ? undefined : m.scoreCp, mate: m.book ? undefined : m.mate }]);
    }
  }

  /* ---- match mode ---- */
  function startMatch() {
    if (!wBot || !bBot) return;
    resetBoard(); setOutcomes([]); setSummary(null);
    setScore({ a: 0, b: 0, played: 0 }); setRunning(true);

    const s = new WebSocket(wsURL("/ws/arena"));
    ws.current = s;
    s.onopen = () => s.send(JSON.stringify({ type: "start", white, black, movetime, games }));
    s.onmessage = (e) => {
      const m = JSON.parse(e.data);
      onBoardMsg(m);
      if (m.type === "gameEnd") {
        setScore({ a: m.scoreA, b: m.scoreB, played: m.played });
        setOutcomes((o) => [...o, { index: m.index, result: m.result, reason: m.reason }]);
      } else if (m.type === "matchEnd") {
        setSummary({ a: m.scoreA, b: m.scoreB, played: m.played });
        setRunning(false);
        api.matches().then(setRecent).catch(() => {});
        s.close();
      }
    };
    s.onclose = () => setRunning(false);
  }

  /* ---- round-robin mode ---- */
  function startRR() {
    resetBoard(); setRrSummary(null); setPair(null);
    setPairScore({ a: 0, b: 0 }); setDone(0); setRunning(true);
    api.ratings().then(setLiveRatings).catch(() => {});

    const s = new WebSocket(wsURL("/ws/roundrobin"));
    ws.current = s;
    s.onopen = () => s.send(JSON.stringify({ type: "start", gamesPerPair, movetime }));
    poll.current = setInterval(() => api.ratings().then(setLiveRatings).catch(() => {}), 2500);
    s.onmessage = (e) => {
      const m = JSON.parse(e.data);
      onBoardMsg(m);
      if (m.type === "pairStart") { setPair(m); setPairScore({ a: 0, b: 0 }); }
      else if (m.type === "gameEnd") { setPairScore({ a: m.scoreA, b: m.scoreB }); setDone((d) => d + 1); }
      else if (m.type === "pairEnd") { api.ratings().then(setLiveRatings).catch(() => {}); }
      else if (m.type === "tournamentEnd") {
        setRrSummary({ pairs: m.pairs, games: m.games });
        setRunning(false);
        if (poll.current) clearInterval(poll.current);
        api.ratings().then(setLiveRatings).catch(() => {});
        api.matches().then(setRecent).catch(() => {});
        s.close();
      }
    };
    s.onclose = () => { setRunning(false); if (poll.current) clearInterval(poll.current); };
  }

  function stop() { ws.current?.send(JSON.stringify({ type: "stop" })); }

  const evalFrac = useMemo(() => {
    let cp = lastInfo?.scoreCp ?? 0;
    if (lastInfo?.mate != null) cp = lastInfo.mate > 0 ? 1500 : -1500;
    return Math.max(0.02, Math.min(0.98, 1 / (1 + Math.exp(-cp / 320))));
  }, [lastInfo]);

  const multi = games !== 1;

  return (
    <div>
      <PageHeader
        eyebrow="Bot vs bot"
        title="The Arena"
        desc="Run a head-to-head match, or a full round-robin where every bot plays every other. Colors alternate and reversed-color pairs share an opening. Every game is recorded and re-rates the ladder."
        right={
          <ModeToggle mode={mode} setMode={setMode} disabled={running} />
        }
      />

      <div className="grid grid-cols-[auto_1fr] gap-7 items-start">
        <div className="flex gap-3">
          <div className="w-2.5 rounded-full overflow-hidden self-stretch relative" style={{ background: "#2a2620" }}>
            <motion.div className="absolute bottom-0 left-0 right-0"
              style={{ background: "linear-gradient(180deg,#f4eee2,#cfc7b6)" }}
              animate={{ height: `${evalFrac * 100}%` }}
              transition={{ type: "spring", stiffness: 120, damping: 22 }} />
          </div>
          <div className="w-[min(58vh,560px)]">
            <Board fen={fen} orientation="white" turnColor={turn} lastMove={lastMove} viewOnly />
          </div>
        </div>

        <div className="flex flex-col gap-4 max-w-[400px]">
          {mode === "match" ? (
            <>
              <div className="panel p-5">
                <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
                  <Side bot={wBot} label="A" />
                  <Middle running={running || !!summary} a={score.a} b={score.b} />
                  <Side bot={bBot} label="B" />
                </div>
                {(running || summary) && multi && (
                  <div className="mt-3 pt-3 border-t border-line/60 flex items-center justify-between">
                    <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-taupe">
                      {running ? `Game ${score.played + 1}${games ? ` / ${games}` : ""}` : "Match complete"}
                    </span>
                    <OutcomeStrip outcomes={outcomes} />
                  </div>
                )}
              </div>

              <div className="panel p-4 flex flex-col gap-3">
                <Selector label="Bot A" bots={bots} value={white} onChange={setWhite} disabled={running} />
                <Selector label="Bot B" bots={bots} value={black} onChange={setBlack} disabled={running} />
                <Stepper label="Games" icon={Layers} value={games} options={GAME_COUNTS}
                  fmt={(v) => (v === 0 ? "∞" : String(v))} onChange={setGames} disabled={running} />
                <Stepper label="Move time" icon={Clock} value={movetime} options={[200, 400, 800, 1500]}
                  fmt={(v) => `${v}ms`} onChange={setMovetime} disabled={running} />
                {running ? (
                  <Button variant="outline" onClick={stop}><Stop size={14} /> Stop after this game</Button>
                ) : (
                  <Button onClick={startMatch} disabled={!wBot || !bBot}>
                    <PlayIcon size={14} /> {multi ? `Run ${games || "∞"} games` : "Play one game"}
                  </Button>
                )}
              </div>

              <AnimatePresence>
                {summary && (
                  <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                    className="panel p-4 flex items-center justify-between" style={{ borderColor: "rgba(200,163,91,0.35)" }}>
                    <div>
                      <div className="font-mono text-[20px] text-brass tnum">{summary.a}<span className="text-taupe mx-1">–</span>{summary.b}</div>
                      <div className="text-taupe text-[12px] mt-0.5">{summary.played} games · ladder re-rated</div>
                    </div>
                    <Button size="sm" onClick={startMatch}>Run again</Button>
                  </motion.div>
                )}
              </AnimatePresence>

              <LiveMoves moves={moves} />
            </>
          ) : (
            <>
              <div className="panel p-5">
                <div className="flex items-center justify-between mb-3">
                  <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-taupe flex items-center gap-1.5">
                    <Users size={12} /> {engineCount} engines · round-robin
                  </div>
                  {(running || rrSummary) && (
                    <div className="font-mono text-[11px] text-mist tnum">{done}{rrTotalGames ? ` / ${rrTotalGames}` : ""} games</div>
                  )}
                </div>
                {pair ? (
                  <>
                    <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
                      <Side bot={bots.find((b) => b.id === pair.a)} label="A" />
                      <Middle running a={pairScore.a} b={pairScore.b} />
                      <Side bot={bots.find((b) => b.id === pair.b)} label="B" />
                    </div>
                    <div className="mt-3 pt-3 border-t border-line/60">
                      <div className="flex items-center justify-between mb-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-taupe">
                        <span>Pairing {pair.index + 1} / {pair.total}</span>
                        <span>{gamesPerPair} games/pair</span>
                      </div>
                      <div className="h-1.5 rounded-full bg-white/[0.05] overflow-hidden">
                        <motion.div className="h-full" style={{ background: "var(--color-brass)" }}
                          animate={{ width: `${((pair.index) / Math.max(1, pair.total)) * 100}%` }} />
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="text-taupe text-[13px] py-4 text-center">
                    {rrSummary ? `Done — ${rrSummary.games} games over ${rrSummary.pairs} pairings. Ladder re-rated.` : "Every engine plays every other. Press run to begin."}
                  </div>
                )}
              </div>

              {!running && (
                <div className="panel p-4 flex flex-col gap-3">
                  <Stepper label="Games per pair" icon={Layers} value={gamesPerPair} options={PER_PAIR}
                    fmt={(v) => String(v)} onChange={setGamesPerPair} disabled={running} />
                  <Stepper label="Move time" icon={Clock} value={movetime} options={[200, 400, 800, 1500]}
                    fmt={(v) => `${v}ms`} onChange={setMovetime} disabled={running} />
                  <div className="font-mono text-[11px] text-taupe tnum text-center">
                    {engineCount * (engineCount - 1) / 2} pairings · {rrTotalGames} games total
                  </div>
                  <Button onClick={startRR}><Trophy size={14} /> Run round-robin</Button>
                </div>
              )}
              {running && (
                <Button variant="outline" onClick={stop}><Stop size={14} /> Stop after this game</Button>
              )}

              <LiveStandings ratings={liveRatings} bots={bots} />
            </>
          )}
        </div>
      </div>

      {recent.length > 0 && <RecentMatches recent={recent} bots={bots} />}
    </div>
  );
}

function ModeToggle({ mode, setMode, disabled }: { mode: string; setMode: (m: "match" | "roundrobin") => void; disabled?: boolean }) {
  return (
    <div className="panel-2 p-1 flex gap-1">
      {([["match", "Match", Swords], ["roundrobin", "Round-robin", Trophy]] as const).map(([id, label, Icon]) => (
        <button key={id} onClick={() => !disabled && setMode(id)} disabled={disabled}
          className={`focusable flex items-center gap-2 px-3.5 py-2 rounded-[9px] text-[12.5px] transition-colors disabled:opacity-50 ${
            mode === id ? "text-ivory bg-white/[0.05]" : "text-taupe hover:text-mist"
          }`}>
          <Icon size={13} className={mode === id ? "text-brass" : ""} /> {label}
        </button>
      ))}
    </div>
  );
}

function Middle({ running, a, b }: { running: boolean; a: number; b: number }) {
  return running ? (
    <div className="font-mono text-[22px] text-ivory tnum leading-none text-center">
      {a}<span className="text-taupe mx-0.5">–</span>{b}
    </div>
  ) : (
    <div className="w-9 h-9 rounded-full grid place-items-center panel-2"><Swords size={15} className="text-brass" /></div>
  );
}

function Side({ bot, label }: { bot?: Bot; label: string }) {
  return (
    <div className="flex flex-col items-center text-center">
      <Avatar name={bot?.name ?? "—"} accent={bot?.accent ?? "#8c8068"} size={46} />
      <div className="text-ivory text-[13.5px] mt-2 truncate max-w-[140px]">{bot?.name ?? "Select"}</div>
      <div className="font-mono text-[9px] uppercase tracking-[0.18em] text-taupe mt-0.5">side {label}</div>
    </div>
  );
}

function LiveStandings({ ratings, bots }: { ratings: Rating[]; bots: Bot[] }) {
  const sorted = [...ratings].sort((a, b) => b.elo - a.elo);
  return (
    <div className="panel p-4">
      <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-taupe mb-3">Live standings</div>
      {sorted.length === 0 ? (
        <div className="text-taupe text-[12.5px]">Ratings appear as games complete.</div>
      ) : (
        <div className="flex flex-col gap-0.5 max-h-[260px] overflow-y-auto pr-1">
          {sorted.map((r, i) => {
            const bot = bots.find((b) => b.id === r.botId);
            return (
              <div key={r.botId} className="flex items-center gap-2.5 py-1.5">
                <span className="font-mono text-[11px] w-4 tnum" style={{ color: i < 3 ? "var(--color-brass)" : "var(--color-taupe)" }}>{i + 1}</span>
                <Avatar name={bot?.name ?? r.botId} accent={bot?.accent ?? "#8c8068"} size={24} />
                <span className="text-ivory text-[12.5px] flex-1 truncate">{bot?.name ?? r.botId}</span>
                <span className="font-mono text-[13px] text-ivory tnum">{Math.round(r.elo)}</span>
                <span className="font-mono text-[10px] text-taupe">±{r.error}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function OutcomeStrip({ outcomes }: { outcomes: GameOutcome[] }) {
  return (
    <div className="flex gap-1">
      {outcomes.slice(-12).map((o, i) => {
        const c = o.result === "1-0" ? "var(--color-ivory)" : o.result === "0-1" ? "var(--color-taupe)" : "var(--color-brass)";
        return <span key={i} className="w-1.5 h-1.5 rounded-full" style={{ background: c }} title={`${o.result} ${o.reason}`} />;
      })}
    </div>
  );
}

function Selector({ label, bots, value, onChange, disabled }: { label: string; bots: Bot[]; value: string; onChange: (v: string) => void; disabled?: boolean }) {
  return (
    <div>
      <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-taupe mb-1.5">{label}</div>
      <select value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled}
        className="focusable w-full panel-2 text-ivory text-[13px] px-3 py-2.5 rounded-[10px] appearance-none cursor-pointer outline-none disabled:opacity-50">
        {bots.map((b) => <option key={b.id} value={b.id} style={{ background: "#18150f" }}>{b.name}</option>)}
      </select>
    </div>
  );
}

function Stepper({ label, icon: Icon, value, options, fmt, onChange, disabled }: {
  label: string; icon: any; value: number; options: number[]; fmt: (v: number) => string; onChange: (v: number) => void; disabled?: boolean;
}) {
  return (
    <div>
      <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-taupe mb-1.5 flex items-center gap-1.5"><Icon size={11} /> {label}</div>
      <div className="flex gap-1.5">
        {options.map((o) => (
          <button key={o} onClick={() => onChange(o)} disabled={disabled}
            className={`focusable flex-1 font-mono text-[12px] py-2 rounded-[9px] border transition-colors tnum disabled:opacity-50 ${
              value === o ? "border-brass/60 text-brass bg-white/[0.03]" : "border-line-2 text-mist hover:text-ivory"
            }`}>{fmt(o)}</button>
        ))}
      </div>
    </div>
  );
}

function LiveMoves({ moves }: { moves: LiveMove[] }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { ref.current?.scrollTo({ top: ref.current.scrollHeight }); }, [moves.length]);
  const pairs: [LiveMove, LiveMove?][] = [];
  for (let i = 0; i < moves.length; i += 2) pairs.push([moves[i], moves[i + 1]]);
  return (
    <div className="panel p-4">
      <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-taupe mb-3">Current game</div>
      <div ref={ref} className="max-h-[180px] overflow-y-auto pr-1">
        {pairs.length === 0 ? (
          <div className="text-taupe text-[12.5px]">Press start to begin.</div>
        ) : (
          <div className="grid grid-cols-[28px_1fr_1fr] gap-x-2 gap-y-0.5 font-mono text-[12.5px]">
            {pairs.map((p, i) => (
              <div key={i} className="contents">
                <span className="text-taupe tnum">{i + 1}.</span>
                <span className="text-ivory">{p[0].san}</span>
                <span className="text-mist">{p[1]?.san ?? ""}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function RecentMatches({ recent, bots }: { recent: MatchResult[]; bots: Bot[] }) {
  const name = (id: string, snap?: string) => snap ?? bots.find((b) => b.id === id)?.name ?? id;
  return (
    <div className="mt-8">
      <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-taupe mb-3">Recent games</div>
      <div className="panel divide-y divide-line/60">
        {recent.slice(0, 8).map((m) => (
          <div key={m.id} className="grid grid-cols-[1fr_auto_1fr_90px_70px] items-center gap-3 px-5 py-3 text-[13px]">
            <span className="text-ivory text-right truncate">{name(m.white, m.whiteName)}</span>
            <span className="font-mono text-brass tnum">{m.result}</span>
            <span className="text-ivory truncate">{name(m.black, m.blackName)}</span>
            <span className="text-taupe text-[11.5px] truncate">{m.reason}</span>
            <span className="font-mono text-taupe text-[11.5px] tnum text-right">{m.moves} ply</span>
          </div>
        ))}
      </div>
    </div>
  );
}
