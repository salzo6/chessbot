import { useEffect, useMemo, useRef, useState } from "react";
import { Chess, type Square } from "chess.js";
import { motion, AnimatePresence } from "framer-motion";
import { RotateCcw, Flag, Sparkles, Eye, EyeOff, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";
import { api, wsURL } from "../lib/api";
import type { Bot, EngineInfo } from "../lib/types";
import Board from "../components/Board";
import { PageHeader, Button, Avatar, Badge } from "../components/ui";

function toDests(chess: Chess): Map<string, string[]> {
  const dests = new Map<string, string[]>();
  for (const m of chess.moves({ verbose: true }) as any[]) {
    if (!dests.has(m.from)) dests.set(m.from, []);
    dests.get(m.from)!.push(m.to);
  }
  return dests;
}

export default function Play() {
  const [bots, setBots] = useState<Bot[]>([]);
  const [botId, setBotId] = useState<string>("");
  const [myColor, setMyColor] = useState<"white" | "black">("white");
  const game = useRef(new Chess());
  const [fen, setFen] = useState(game.current.fen());
  const [lastMove, setLastMove] = useState<[string, string] | undefined>();
  const [info, setInfo] = useState<EngineInfo | null>(null);
  const [thinking, setThinking] = useState(false);
  const [status, setStatus] = useState<string>("");
  const [pending, setPending] = useState<{ from: string; to: string } | null>(null);
  const [showEval, setShowEval] = useState(() => localStorage.getItem("coach.showEval") !== "0");
  // null = following the live position; a number = browsing the position after that many plies
  const [viewPly, setViewPly] = useState<number | null>(null);
  const ws = useRef<WebSocket | null>(null);

  function toggleEval() {
    setShowEval((v) => {
      localStorage.setItem("coach.showEval", v ? "0" : "1");
      return !v;
    });
  }

  const bot = bots.find((b) => b.id === botId);
  const turn = game.current.turn() === "w" ? "white" : "black";
  const myTurn = turn === myColor && !game.current.isGameOver();

  useEffect(() => {
    api.bots().then((bs) => {
      const playable = bs.filter((b) => b.installed);
      setBots(playable);
      if (playable[0]) setBotId(playable[0].id);
    });
  }, []);

  useEffect(() => {
    const socket = new WebSocket(wsURL("/ws/play"));
    ws.current = socket;
    socket.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.type === "info") setInfo(msg);
      if (msg.type === "bestmove") {
        applyEngineMove(msg.uci);
        setThinking(false);
      }
    };
    return () => socket.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function sync() {
    setFen(game.current.fen());
    checkEnd();
  }

  function checkEnd() {
    const g = game.current;
    if (g.isCheckmate()) setStatus(`Checkmate — ${g.turn() === "w" ? "Black" : "White"} wins`);
    else if (g.isStalemate()) setStatus("Draw — stalemate");
    else if (g.isInsufficientMaterial()) setStatus("Draw — insufficient material");
    else if (g.isThreefoldRepetition()) setStatus("Draw — threefold repetition");
    else if (g.isDraw()) setStatus("Draw — 50-move rule");
    else setStatus("");
  }

  function requestEngine() {
    const g = game.current;
    if (g.isGameOver() || !bot) return;
    setThinking(true);
    setInfo(null);
    ws.current?.send(
      JSON.stringify({
        type: "go",
        botId: bot.id,
        fen: g.fen(),
      })
    );
  }

  function applyEngineMove(uci: string) {
    const from = uci.slice(0, 2);
    const to = uci.slice(2, 4);
    const promotion = uci.length > 4 ? uci[4] : undefined;
    const m = game.current.move({ from, to, promotion } as any);
    if (m) {
      setLastMove([from, to]);
      setViewPly(null);
      sync();
    }
  }

  function onUserMove(from: string, to: string) {
    const piece = game.current.get(from as Square);
    const isPromo =
      piece?.type === "p" && (to[1] === "8" || to[1] === "1");
    if (isPromo) {
      setPending({ from, to });
      return;
    }
    doMove(from, to);
  }

  function doMove(from: string, to: string, promotion?: string) {
    const m = game.current.move({ from, to, promotion } as any);
    if (!m) {
      setFen(game.current.fen()); // revert illegal
      return;
    }
    setLastMove([from, to]);
    setViewPly(null);
    sync();
    setTimeout(requestEngine, 180);
  }

  function startGame(color: "white" | "black") {
    game.current.reset();
    setMyColor(color);
    setLastMove(undefined);
    setViewPly(null);
    setInfo(null);
    setStatus("");
    setThinking(false);
    setFen(game.current.fen());
    // if you're Black, the engine (White) makes the first move
    if (color === "black") setTimeout(requestEngine, 400);
  }

  // Full move history (verbose) at the live position — recomputed whenever a move lands.
  const verbose = useMemo(() => game.current.history({ verbose: true }) as any[], [fen]);
  const totalPlies = verbose.length;
  const atLive = viewPly === null;

  // What the board actually shows: live position, or a reconstructed past position.
  const view = useMemo(() => {
    if (atLive) {
      return { fen, lastMove, check: game.current.inCheck(), turn: turn as "white" | "black" };
    }
    const tmp = new Chess();
    for (let i = 0; i < viewPly!; i++) tmp.move(verbose[i].san);
    const lm =
      viewPly! > 0
        ? ([verbose[viewPly! - 1].from, verbose[viewPly! - 1].to] as [string, string])
        : undefined;
    return {
      fen: tmp.fen(),
      lastMove: lm,
      check: tmp.inCheck(),
      turn: (tmp.turn() === "w" ? "white" : "black") as "white" | "black",
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [atLive, viewPly, fen, lastMove, turn]);

  // You can only move when caught up to the live position and it's your turn.
  const canMove = atLive && myTurn;

  function goTo(target: number | null) {
    if (totalPlies === 0) return;
    if (target === null || target >= totalPlies) setViewPly(null);
    else setViewPly(Math.max(0, target));
  }
  function stepBack() {
    if (totalPlies === 0) return;
    const cur = viewPly === null ? totalPlies : viewPly;
    setViewPly(Math.max(0, cur - 1));
  }
  function stepFwd() {
    if (viewPly === null) return;
    setViewPly(viewPly + 1 >= totalPlies ? null : viewPly + 1);
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
      if (e.key === "ArrowLeft") { e.preventDefault(); stepBack(); }
      else if (e.key === "ArrowRight") { e.preventDefault(); stepFwd(); }
      else if (e.key === "ArrowUp") { e.preventDefault(); goTo(0); }
      else if (e.key === "ArrowDown") { e.preventDefault(); goTo(null); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  });

  const dests = useMemo(() => (canMove ? toDests(game.current) : new Map()), [fen, canMove]);
  const evalFrac = useEvalFrac(info, turn);
  const moves = game.current.history();
  const browsing = !atLive;

  return (
    <div>
      <PageHeader
        eyebrow="You vs a bot"
        title="Play"
        desc="Pick an opponent from the library and play it on the board. Watch its search think in real time."
        right={
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={toggleEval}>
              {showEval ? <EyeOff size={14} /> : <Eye size={14} />} Eval bar
            </Button>
            <Button variant="outline" size="sm" onClick={() => startGame(myColor === "white" ? "black" : "white")}>
              <RotateCcw size={14} /> Play as {myColor === "white" ? "Black" : "White"}
            </Button>
            <Button size="sm" onClick={() => startGame(myColor)}>New game</Button>
          </div>
        }
      />

      <div className="grid grid-cols-[auto_1fr] gap-7 items-start">
        {/* board + eval bar */}
        <div className="flex gap-3">
          {showEval && <EvalBar frac={evalFrac} flipped={myColor === "black"} />}
          <div className="w-[min(58vh,560px)] relative">
            <Board
              fen={view.fen}
              orientation={myColor}
              turnColor={view.turn}
              lastMove={view.lastMove}
              check={view.check}
              dests={dests}
              movableColor={canMove ? myColor : undefined}
              viewOnly={!canMove}
              onMove={onUserMove}
            />
            <MoveNav
              browsing={browsing}
              ply={atLive ? totalPlies : viewPly!}
              total={totalPlies}
              onFirst={() => goTo(0)}
              onPrev={stepBack}
              onNext={stepFwd}
              onLast={() => goTo(null)}
            />
            <AnimatePresence>
              {pending && (
                <PromotionPicker
                  color={myColor}
                  onPick={(p) => {
                    doMove(pending.from, pending.to, p);
                    setPending(null);
                  }}
                  onCancel={() => {
                    setPending(null);
                    setFen(game.current.fen());
                  }}
                />
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* side panel */}
        <div className="flex flex-col gap-4 max-w-[380px]">
          <OpponentCard bots={bots} botId={botId} setBotId={setBotId} bot={bot} />
          <TelemetryCard info={info} thinking={thinking} />
          <MoveList moves={moves} />
          <AnimatePresence>
            {status && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className="panel p-4 flex items-center justify-between"
                style={{ borderColor: "rgba(200,163,91,0.35)" }}
              >
                <span className="text-ivory text-[14px]">{status}</span>
                <Button size="sm" variant="outline" onClick={() => startGame(myColor)}>
                  <Flag size={13} /> Rematch
                </Button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}

function useEvalFrac(info: EngineInfo | null, turn: string): number {
  if (!info) return 0.5;
  let cp = info.scoreCp ?? 0;
  if (info.mate != null) cp = info.mate > 0 ? 1500 : -1500;
  // server already reports white-POV; clamp via logistic
  const frac = 1 / (1 + Math.exp(-cp / 320));
  return Math.max(0.02, Math.min(0.98, frac));
}

function MoveNav({
  browsing,
  ply,
  total,
  onFirst,
  onPrev,
  onNext,
  onLast,
}: {
  browsing: boolean;
  ply: number;
  total: number;
  onFirst: () => void;
  onPrev: () => void;
  onNext: () => void;
  onLast: () => void;
}) {
  const btn =
    "focusable grid place-items-center w-9 h-8 rounded-[8px] panel-2 text-mist hover:text-ivory hover:border-brass/60 transition-colors disabled:opacity-30 disabled:cursor-not-allowed";
  return (
    <div className="mt-3 flex items-center justify-between gap-2">
      <div className="flex items-center gap-1.5">
        <button className={btn} onClick={onFirst} disabled={total === 0 || ply === 0} title="Start (↑)">
          <ChevronsLeft size={15} />
        </button>
        <button className={btn} onClick={onPrev} disabled={total === 0 || ply === 0} title="Back (←)">
          <ChevronLeft size={15} />
        </button>
        <button className={btn} onClick={onNext} disabled={!browsing} title="Forward (→)">
          <ChevronRight size={15} />
        </button>
        <button className={btn} onClick={onLast} disabled={!browsing} title="Live (↓)">
          <ChevronsRight size={15} />
        </button>
      </div>
      <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-taupe">
        {browsing ? `Move ${ply} / ${total} · browsing` : total > 0 ? "Live" : "Use ← → to review"}
      </div>
    </div>
  );
}

function EvalBar({ frac, flipped }: { frac: number; flipped: boolean }) {
  const whiteH = flipped ? 1 - frac : frac;
  return (
    <div className="w-2.5 rounded-full overflow-hidden self-stretch relative" style={{ background: "#2a2620" }}>
      <motion.div
        className="absolute bottom-0 left-0 right-0"
        style={{ background: "linear-gradient(180deg,#f4eee2,#cfc7b6)" }}
        animate={{ height: `${whiteH * 100}%` }}
        transition={{ type: "spring", stiffness: 120, damping: 22 }}
      />
    </div>
  );
}

function OpponentCard({
  bots,
  botId,
  setBotId,
  bot,
}: {
  bots: Bot[];
  botId: string;
  setBotId: (id: string) => void;
  bot?: Bot;
}) {
  return (
    <div className="panel p-4">
      <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-taupe mb-3">Opponent</div>
      {bots.length === 0 ? (
        <div className="text-taupe text-[12.5px]">No installed engines. Install Stockfish from the Library.</div>
      ) : (
        <>
          <div className="flex items-center gap-3 mb-3">
            {bot && <Avatar name={bot.name} accent={bot.accent} size={42} />}
            <div className="min-w-0">
              <div className="text-ivory text-[15px] truncate">{bot?.name}</div>
              <div className="text-taupe text-[12px]">{bot?.family} · {bot?.version}</div>
            </div>
          </div>
          <div className="relative">
            <select
              value={botId}
              onChange={(e) => setBotId(e.target.value)}
              className="focusable w-full panel-2 text-ivory text-[13px] px-3 py-2.5 rounded-[10px] appearance-none cursor-pointer outline-none"
            >
              {bots.map((b) => (
                <option key={b.id} value={b.id} style={{ background: "#18150f" }}>
                  {b.name}
                </option>
              ))}
            </select>
          </div>
        </>
      )}
    </div>
  );
}

function TelemetryCard({ info, thinking }: { info: EngineInfo | null; thinking: boolean }) {
  const evalStr = info?.mate != null
    ? `#${Math.abs(info.mate)}`
    : info?.scoreCp != null
    ? `${info.scoreCp > 0 ? "+" : ""}${(info.scoreCp / 100).toFixed(2)}`
    : "—";
  return (
    <div className="panel p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-taupe">Engine search</div>
        {thinking && (
          <div className="flex items-center gap-1.5 text-brass text-[10px] font-mono uppercase tracking-[0.14em]">
            <Sparkles size={11} className="animate-pulse" /> thinking
          </div>
        )}
      </div>
      <div className="grid grid-cols-3 gap-3 mb-3">
        <Metric label="Eval" value={evalStr} accent />
        <Metric label="Depth" value={info?.depth ? String(info.depth) : "—"} />
        <Metric label="kN/s" value={info?.nps ? Math.round(info.nps / 1000).toLocaleString() : "—"} />
      </div>
      <div className="panel-2 px-3 py-2 min-h-[42px]">
        <div className="font-mono text-[9px] uppercase tracking-[0.18em] text-taupe mb-1">Principal variation</div>
        <div className="font-mono text-[11.5px] text-mist leading-snug line-clamp-2 break-words">
          {info?.pv || "—"}
        </div>
      </div>
    </div>
  );
}

function Metric({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="panel-2 px-3 py-2.5">
      <div className="font-mono text-[9px] uppercase tracking-[0.16em] text-taupe">{label}</div>
      <div className={`font-mono text-[18px] tnum mt-0.5 ${accent ? "text-brass" : "text-ivory"}`}>{value}</div>
    </div>
  );
}

function MoveList({ moves }: { moves: string[] }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.scrollTo({ top: ref.current.scrollHeight });
  }, [moves.length]);
  const pairs: [string, string?][] = [];
  for (let i = 0; i < moves.length; i += 2) pairs.push([moves[i], moves[i + 1]]);
  return (
    <div className="panel p-4">
      <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-taupe mb-3">Moves</div>
      <div ref={ref} className="max-h-[190px] overflow-y-auto pr-1">
        {pairs.length === 0 ? (
          <div className="text-taupe text-[12.5px]">No moves yet.</div>
        ) : (
          <div className="grid grid-cols-[28px_1fr_1fr] gap-x-2 gap-y-0.5 font-mono text-[12.5px]">
            {pairs.map((p, i) => (
              <div key={i} className="contents">
                <span className="text-taupe tnum">{i + 1}.</span>
                <span className="text-ivory">{p[0]}</span>
                <span className="text-mist">{p[1] ?? ""}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function PromotionPicker({
  color,
  onPick,
  onCancel,
}: {
  color: "white" | "black";
  onPick: (p: string) => void;
  onCancel: () => void;
}) {
  const pieces = ["q", "r", "b", "n"];
  const glyphs: Record<string, string> = color === "white"
    ? { q: "♕", r: "♖", b: "♗", n: "♘" }
    : { q: "♛", r: "♜", b: "♝", n: "♞" };
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onCancel}
      className="absolute inset-0 z-20 grid place-items-center"
      style={{ background: "rgba(8,7,5,0.72)", backdropFilter: "blur(3px)", borderRadius: 10 }}
    >
      <motion.div
        initial={{ scale: 0.9, y: 8 }}
        animate={{ scale: 1, y: 0 }}
        onClick={(e) => e.stopPropagation()}
        className="panel p-3 flex gap-2"
      >
        {pieces.map((p) => (
          <button
            key={p}
            onClick={() => onPick(p)}
            className="focusable w-16 h-16 grid place-items-center rounded-[10px] panel-2 hover:border-brass/60 transition-colors text-[40px] leading-none text-ivory"
          >
            {glyphs[p]}
          </button>
        ))}
      </motion.div>
    </motion.div>
  );
}
