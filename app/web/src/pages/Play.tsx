import { useEffect, useMemo, useRef, useState } from "react";
import { Chess, type Square } from "chess.js";
import { motion, AnimatePresence } from "framer-motion";
import { RotateCcw, Flag, Sparkles, Eye, EyeOff, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, GraduationCap } from "lucide-react";
import { api, wsURL } from "../lib/api";
import type { Bot, EngineInfo, MoveJudgment } from "../lib/types";
import Board from "../components/Board";
import CoachPanel from "../components/CoachPanel";
import { useCoach } from "../hooks/useCoach";
import { CLASS_META } from "../lib/coach";
import { PageHeader, Button, Avatar, Badge } from "../components/ui";

// How long to linger on the coach's take after it's ready, before the bot replies.
const READ_MS = 1500;

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
  const [coachOn, setCoachOn] = useState(() => localStorage.getItem("coach.enabled") === "1");
  // null = following the live position; a number = browsing the position after that many plies
  const [viewPly, setViewPly] = useState<number | null>(null);
  // accumulated per-ply classifications, for movelist glyphs (fills in as you play/browse)
  const [judgments, setJudgments] = useState<Map<number, MoveJudgment>>(new Map());
  // coaching pace + blunder guard
  const [guardOn, setGuardOn] = useState(() => localStorage.getItem("coach.guard") !== "0");
  const [guardWarn, setGuardWarn] = useState<MoveJudgment | null>(null);
  const [pacing, setPacing] = useState(false); // bot reply is held while the coach weighs in
  const [gameKey, setGameKey] = useState(0); // bump on new game to reset the coach conversation
  const pendingPlyRef = useRef<number | null>(null);
  const paceTimer = useRef<number | undefined>(undefined);
  const ws = useRef<WebSocket | null>(null);

  function clearPace() {
    if (paceTimer.current) { clearTimeout(paceTimer.current); paceTimer.current = undefined; }
  }
  function releaseEngine() {
    setPacing(false);
    requestEngine();
  }
  function scheduleEngine(ms: number) {
    clearPace();
    paceTimer.current = window.setTimeout(() => { paceTimer.current = undefined; releaseEngine(); }, ms);
  }
  function toggleGuard() {
    setGuardOn((v) => { localStorage.setItem("coach.guard", v ? "0" : "1"); return !v; });
  }

  function toggleEval() {
    setShowEval((v) => {
      localStorage.setItem("coach.showEval", v ? "0" : "1");
      return !v;
    });
  }
  function toggleCoach() {
    setCoachOn((v) => {
      localStorage.setItem("coach.enabled", v ? "0" : "1");
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
    if (coachOn && game.current.isGameOver()) {
      // your move ended the game — nothing for the bot to reply to
      setPacing(false);
    } else if (coachOn) {
      // Hold the bot's reply until the coach has judged this move (then a reading
      // beat). Also lets the blunder guard intercept before the opponent moves.
      pendingPlyRef.current = game.current.history().length;
      setPacing(true);
      clearPace();
      paceTimer.current = window.setTimeout(() => {
        // fallback: judgment never arrived (engine slow/unavailable) — don't stall
        if (pendingPlyRef.current != null) { pendingPlyRef.current = null; releaseEngine(); }
      }, 3500);
    } else {
      setTimeout(requestEngine, 180);
    }
  }

  function startGame(color: "white" | "black") {
    game.current.reset();
    setMyColor(color);
    setLastMove(undefined);
    setViewPly(null);
    setJudgments(new Map());
    setInfo(null);
    setStatus("");
    setThinking(false);
    pendingPlyRef.current = null;
    clearPace();
    setGuardWarn(null);
    setPacing(false);
    setGameKey((k) => k + 1);
    setFen(game.current.fen());
    // if you're Black, the engine (White) makes the first move
    if (color === "black") setTimeout(requestEngine, 400);
  }

  // The ONE coach action that mutates game state: roll back to your previous turn.
  // Pops the engine's reply + your move (or a single ply if it's mid-turn).
  function takeback() {
    const g = game.current;
    const justMovedColor = g.turn() === "w" ? "black" : "white"; // who moved last
    g.undo(); // remove last ply
    // if that last ply was the engine's reply, also undo your move so it's your turn again
    if (justMovedColor !== myColor && !g.isGameOver()) g.undo();
    setLastMove(undefined);
    setViewPly(null);
    setInfo(null);
    setStatus("");
    setThinking(false);
    setPending(null);
    pendingPlyRef.current = null;
    clearPace();
    setGuardWarn(null);
    setPacing(false);
    setFen(g.fen());
    // If we landed on the engine's turn (e.g. took back your only move as Black),
    // let it move again so the game doesn't stall.
    const t = g.turn() === "w" ? "white" : "black";
    if (t !== myColor && !g.isGameOver()) setTimeout(requestEngine, 250);
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

  // ---- Coach (additive overlay) ----
  const displayedPly = atLive ? totalPlies : viewPly!;
  const displayedMove = displayedPly > 0 ? verbose[displayedPly - 1] : null;
  const displayedGameOver = atLive ? game.current.isGameOver() : false;
  const coach = useCoach({
    enabled: coachOn,
    fen: view.fen,
    lastMove: displayedMove,
    gameOver: displayedGameOver,
    yourTurn: canMove,
  });
  // Record classifications by ply for movelist glyphs (idempotent).
  useEffect(() => {
    const j = coach.judgment;
    if (!j) return;
    setJudgments((prev) => {
      if (prev.get(j.ply)?.cls === j.cls) return prev;
      const next = new Map(prev);
      next.set(j.ply, j);
      return next;
    });
  }, [coach.judgment]);

  // Pacing + blunder guard: once the coach has judged the move we just played,
  // either intercept a blunder, or linger a beat then let the bot reply.
  useEffect(() => {
    if (!coachOn || pendingPlyRef.current == null) return;
    const j = coach.judgment;
    if (!j || j.ply !== pendingPlyRef.current) return;
    pendingPlyRef.current = null;
    clearPace();
    if (guardOn && j.cls === "blunder") {
      setPacing(false);
      setGuardWarn(j); // hold the bot; ask the user to reconsider
    } else {
      scheduleEngine(READ_MS);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coach.judgment, coachOn, guardOn]);

  // If the coach is switched off mid-pace, don't leave the bot hanging.
  useEffect(() => {
    if (!coachOn && pendingPlyRef.current != null) {
      pendingPlyRef.current = null;
      clearPace();
      setGuardWarn(null);
      setPacing(false);
      requestEngine();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coachOn]);

  // Don't leave a pending engine timer running if we navigate away.
  useEffect(() => () => clearPace(), []);

  // Proactive "what does the opponent threaten?" — now engine-grounded, computed in the coach
  // hook from a null-move search (only on your live turn). null = still analyzing.
  const threats = coach.threat;

  // Board overlay: coach's badges/arrows + a faint marker on a threatened square,
  // so Marcus's spoken warning is anchored to the board (only for real, eval-backed threats).
  const boardShapes = useMemo(() => {
    if (!coachOn) return [] as any[];
    const shapes: any[] = [...coach.autoShapes];
    if (threats?.square && (threats.severity === "warn" || threats.severity === "alarm")) {
      shapes.push({ orig: threats.square, brush: "paleRed" });
    }
    return shapes;
  }, [coachOn, coach.autoShapes, threats]);

  function guardPlayAnyway() {
    setGuardWarn(null);
    scheduleEngine(400);
  }
  function guardTakeback() {
    setGuardWarn(null);
    game.current.undo(); // retract just the blundering move — it's your turn again
    const h = game.current.history({ verbose: true }) as any[];
    const last = h[h.length - 1];
    setLastMove(last ? [last.from, last.to] : undefined);
    setViewPly(null);
    pendingPlyRef.current = null;
    clearPace();
    setPacing(false);
    sync();
  }

  const canTakeback = coachOn && atLive && totalPlies > 0 && !thinking && !pacing && !guardWarn;

  return (
    <div>
      <PageHeader
        eyebrow="You vs a bot"
        title="Play"
        desc="Pick an opponent from the library and play it on the board. Watch its search think in real time."
        right={
          <div className="flex gap-2">
            <Button variant={coachOn ? "primary" : "outline"} size="sm" onClick={toggleCoach}>
              <GraduationCap size={14} /> Coach
            </Button>
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
              autoShapes={boardShapes}
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
            <AnimatePresence>
              {guardWarn && (
                <GuardOverlay
                  judgment={guardWarn}
                  onPlay={guardPlayAnyway}
                  onTakeback={guardTakeback}
                />
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* side panel */}
        <div className="flex flex-col gap-4 max-w-[380px]">
          <OpponentCard bots={bots} botId={botId} setBotId={setBotId} bot={bot} />
          {coachOn && (
            <CoachPanel
              key={gameKey}
              coach={coach}
              fen={view.fen}
              myColor={myColor}
              onTakeback={takeback}
              canTakeback={canTakeback}
              gameOver={displayedGameOver}
              yourTurn={canMove}
              pacing={pacing}
              threats={threats}
              guardOn={guardOn}
              onToggleGuard={toggleGuard}
            />
          )}
          <TelemetryCard info={info} thinking={thinking} />
          <MoveList moves={moves} judgments={coachOn ? judgments : undefined} />
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

function GuardOverlay({
  judgment,
  onPlay,
  onTakeback,
}: {
  judgment: MoveJudgment;
  onPlay: () => void;
  onTakeback: () => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="absolute inset-0 z-20 grid place-items-center p-5"
      style={{ background: "rgba(8,7,5,0.78)", backdropFilter: "blur(3px)", borderRadius: 10 }}
    >
      <motion.div
        initial={{ scale: 0.92, y: 10 }}
        animate={{ scale: 1, y: 0 }}
        className="panel p-5 max-w-[330px] text-center"
        style={{ borderColor: "rgba(192,91,91,0.5)" }}
      >
        <motion.div
          className="mx-auto mb-3 rounded-full grid place-items-center font-mono text-[18px]"
          style={{ width: 46, height: 46, color: "#c05b5b", background: "linear-gradient(155deg,#c05b5b22,#c05b5b06)", border: "2px solid #c05b5b" }}
          animate={{ x: [0, -3, 3, -2, 2, 0] }}
          transition={{ duration: 0.5 }}
        >
          M
        </motion.div>
        <div className="text-ivory text-[14.5px] mb-1">
          Hold on — <span className="font-mono">{judgment.san}</span> hangs material.
        </div>
        <div className="text-mist text-[12.5px] leading-snug mb-4">
          {judgment.explanation?.length
            ? judgment.explanation.join(" ")
            : judgment.bestSan
            ? `Take another look — ${judgment.bestSan} was much stronger.`
            : "There's a much better move here. Take another look."}
        </div>
        <div className="flex gap-2 justify-center">
          <Button size="sm" onClick={onTakeback}>Let me rethink</Button>
          <Button size="sm" variant="outline" onClick={onPlay}>Play it anyway</Button>
        </div>
      </motion.div>
    </motion.div>
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

function MoveList({ moves, judgments }: { moves: string[]; judgments?: Map<number, MoveJudgment> }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.scrollTo({ top: ref.current.scrollHeight });
  }, [moves.length]);
  const pairs: [string, string?][] = [];
  for (let i = 0; i < moves.length; i += 2) pairs.push([moves[i], moves[i + 1]]);
  // ply numbers: white move of pair i is ply 2i+1, black is 2i+2
  const glyph = (ply: number) => {
    const j = judgments?.get(ply);
    if (!j) return null;
    const m = CLASS_META[j.cls];
    if (!m.glyph) return null;
    return <span style={{ color: m.color }} className="ml-0.5">{m.glyph}</span>;
  };
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
                <span className="text-ivory">{p[0]}{glyph(2 * i + 1)}</span>
                <span className="text-mist">{p[1] ?? ""}{p[1] && glyph(2 * i + 2)}</span>
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
