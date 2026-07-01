# 16 — The Trainer: A Personalized Training Page

*A design document for a new top-level surface — **Train** — that turns Vesper from a place you **play** into a place you **improve**. Where the Coach ([13](13-the-coach.md)) is a live, per-move sensor that helps you during a single game, the Trainer is the **memory and the curriculum**: it persists every game you play, mines your recurring mistakes, and drills the specific patterns you actually get wrong. It is the largest scope expansion in the project, and it is grounded in the cognitive-science and coaching literature summarized in §0.*

*Status: **implemented — T0 → T3.** Built phase by phase against this plan: the shared pure-logic module (`app/shared/coachcore.mjs`, §A.6) with SEE + the reliable motif detectors; the persistent, analyzed, tagged mistake ledger (T0, §13); the WeaknessProfile roll-up + Train page Dashboard + Socratic guided review (T1); own-mistake drills on an SM-2 scheduler with a self-calibrating puzzle rating (T2); and motif-sibling puzzles from a bundled, filtered Lichess slice (T3, built via `server/scripts/build-puzzles.mjs`). Purely additive behind the new `/train` route; the only new write into existing flow is saving finished Play games. This doc remains the plan of record. Every architectural claim about the current app is verified against the code (§2); every pedagogical claim is sourced (§0, Sources); every technical method (mistake tagging, spaced repetition) is grounded in a primary source and honestly labelled where it is heuristic or uncertain. Nothing here is invented.*

---

## 0. Why this exists — the research verdict

Before a line of this is built, the question "does a training page actually help someone get better, and how?" was researched across the cognitive-science literature on chess expertise and the working methods of titled coaches. The findings (full citations in Sources) are consistent and they *dictate the design*:

1. **Chess skill is stored patterns, not raw calculation.** de Groot (1946) and Chase & Simon (1973) established, and a 2011 think-aloud replication (Connors, Burns & Campitelli) confirmed, that strong and weak players search to *similar depth*; the master's edge is a large library of recognized "chunks" (estimated 10,000–100,000; ~50,000 often cited — Gobet & Simon 1998). **→ Improvement means acquiring patterns through active solving.**
   - **Honest nuance (fact-checked, do not overstate):** the "it's all patterns, calculation doesn't matter" claim is an *overreach* and was refuted in verification — Campitelli & Gobet (2004) found stronger players *do* search more and deeper. Patterns give you the candidate moves; calculation confirms them. The Trainer must train *both*, and must never tell a user "don't bother calculating."

2. **What correlates with rating is serious study connected to your own play.** Charness et al. (2005): "serious study alone" was the single strongest predictor of rating across two large samples — but the whole basket of chess activities explained only ~40% of the variance (so much is talent, starting age, and unmeasured factors). Time-to-master varies ~8× between individuals (Gobet & Campitelli). **→ No honest coach promises a rating or a timeline. The Trainer must not either.**

3. **The stagnation trap is real and specific:** study *disconnected from your own games* produces an *illusion of progress* while the knowledge never becomes usable at the board. **→ Every drill the Trainer serves must trace back to a mistake the user actually made, or a pattern they actually miss.** This is the single most important design constraint, and it is the thing generic tools (Chess.com/Lichess review, generic puzzle sets) do worst.

4. **Analyzing your own games is *the* primary improvement method** (Yusupov/Dvoretsky) — and it works *because you were there* (you can find the *thinking* error, not just the move error). Reviewing games you played raises rating faster than just playing more. The evidence also says **engine-first review skips the learning** — the value is in *you trying first*. **→ The review tool must be Socratic: make the user guess before it reveals.**

5. **Heisman's definition of improvement** (verified verbatim): you improve when you either (1) learn a new pattern/principle, or (2) identify a mistake and stop repeating it. Rating is a *downstream effect*, not the target. **→ The Trainer's core loop is: detect a repeated mistake → make it conscious → drill until it stops.** This is exactly the Aimchess thesis, and it is what a *personalized* engine can do that a generic one cannot.

The Coach ([13](13-the-coach.md)) already implements the *in-game thinking-process* half of the research (blunder-check, threat awareness, CCT). But the Coach **has no memory** — it resets every game. Points 2–5 above are all *cross-game, longitudinal* activities. That is the gap the Trainer fills, and it is why it needs to be its own surface, not an extension of the Play page.

> **The candid promise.** The Trainer cannot make anyone a master (≥60% of rating variance is unexplained by *any* trackable activity). Its realistic, evidence-backed promise is narrow but genuine: **it removes the stagnation trap** by guaranteeing every study minute is connected to a mistake you actually make. That is the mechanism the literature supports, and it is the only promise this feature should make.

---

## 1. Governing principles

Carried over from the Coach doc ([13](13-the-coach.md) §1.5), because they are what keep this buildable:

- **Purely additive.** The Trainer is a new page plus new backend surfaces. It must not change how Play, Arena, Leaderboard, or Library behave. The only new *write* into existing flows is: when a human-vs-bot game on the Play page ends, it gets **saved** (today it is discarded — §2). Everything else is new files and new routes.
- **Grounded, never invented.** Every classification comes from the full-strength engine; every motif tag comes from a checkable geometric rule; anything heuristic is labelled as such in the UI with a confidence indicator. The app already honors this for the live coach and must continue to (§6).
- **Spine first.** The hard, valuable part is not the page — it is the **persistent, analyzed, tagged record of your games**. The UI is assembly over that data. Build the spine first (§13).
- **Single-user now, multi-user-shaped.** The app has no accounts; it is a local tool for one player. Model every record with a `userId` (default `"me"`) so a future multi-user version is a data migration, not a rewrite.

---

## 2. The core insight: nothing is persisted today

This is the architectural fact that defines the whole feature. Verified against the code:

- On the Play page, the game lives **only** in a `chess.js` ref (`game.current` in `web/src/pages/Play.tsx`). `startGame()` calls `game.current.reset()` and `setJudgments(new Map())` — **the finished game and all its move classifications are thrown away.** There is no save.
- The coach's per-move classifications (`judgments: Map<ply, MoveJudgment>`) are computed client-side in `useCoach` and held in React state only. They are never sent anywhere.
- `store.recordGame(...)` and the append-only `server/data/games.pgn` exist, but are called **only** from the Arena/match runner (`server/match.mjs`) for *bot-vs-bot* games. Human games never reach them.
- There is **no clock** on the Play page (no time tracking anywhere in `Play.tsx`). This has a hard consequence for the weakness model: **time-management analytics are out of scope** until clocks are added (§7).

So the literal first task of the Trainer is: **start saving the user's games and their analysis.** Everything else is built on that.

---

## 3. Architecture overview

```
┌──────────────── Play page (existing, one new write) ─────────────────┐
│  game ends  ─────────────►  POST /api/games  { pgn, youColor, botId } │
└──────────────────────────────────────┬───────────────────────────────┘
                                        ▼
┌──────────────────────── Server (new surfaces) ───────────────────────┐
│  gamesStore  ── persists PGN + metadata (games/<id>.json)             │
│       │                                                               │
│       ▼   (background job, off the live-play clock)                   │
│  Analysis worker  ── walks every ply with full-strength Stockfish     │
│       │             (reuses the coach Engine + analyze(), depth ~18)  │
│       ▼                                                               │
│  analysisStore  ── per-ply {evalCp, best, pv} + eval graph            │
│       │                                                               │
│       ▼   (pure functions, shared module — §5.3)                      │
│  classify + tag  ── MoveJudgment × motif tag  →  mistakeStore         │
│       │                                                               │
│       ▼                                                               │
│  weaknessStore  ── rolled-up aggregates per user (phase, motif, …)    │
│  drillStore     ── SR items (SM-2 state) sourced from mistakes        │
│  puzzleDB       ── bundled Lichess puzzles, indexed by theme+rating   │
└──────────────────────────────────────┬───────────────────────────────┘
                                        ▼
┌────────────────────────── Train page (new) ──────────────────────────┐
│  Dashboard (weaknesses+trends) · Review (Socratic) · Drill (SR)       │
│  reuses: Board+autoShapes, Sparkline, CLASS_META, useCoach analysis   │
└──────────────────────────────────────────────────────────────────────┘
```

Two design decisions worth stating up front:

- **Analysis runs server-side as a background job, not client-side through `/ws/coach`.** The live coach is a client-orchestrated oracle (correct for one live position). But full-game analysis is *heavy* (dozens of plies at review depth), must *persist regardless of the browser*, and must be *schedulable off the live-play CPU*. That belongs on the server. This is a deliberate, limited departure from the "server is a dumb oracle" ethos ([12](12-the-platform.md) §2), justified by persistence + batch weight. The server still runs plain Stockfish via the existing `Engine` class — no new engine logic.
- **The classification/tagging math is pure and must be shared, not duplicated.** Today it lives in TypeScript (`web/src/lib/coach.ts`). The server (`.mjs`) cannot import TS. See §5.3 for the recommended shared-module fix rather than a fork.

---

## 4. Data model

Following the existing store conventions (`server/store.mjs`: `load(name, fallback)` / `save(name, data)` over JSON files in `server/data/`, plus append-only PGN). All new stores are additive.

```ts
// A saved human game (one file per game keeps individual games small & appendable).
interface SavedGame {
  id: string;              // e.g. `${date}-${rand}`
  userId: string;          // "me" for now
  pgn: string;             // full movetext
  youColor: "white" | "black";
  botId: string;           // opponent (from the registry)
  botName: string;
  result: "1-0" | "0-1" | "1/2-1/2" | "*";
  reason: string;          // "checkmate" | "resign" | "stalemate" | …
  createdAt: string;       // ISO; convert relative → absolute at write time
  analysisStatus: "pending" | "running" | "done" | "error";
}

// Per-ply engine analysis of a game (the eval graph + best-move source).
interface PlyAnalysis {
  ply: number;             // 1-based
  fen: string;             // position BEFORE this ply's move
  san: string; uci: string;
  color: "white" | "black";
  evalCpWhite: number;     // white-POV cp of the position AFTER the move (mate folded to ±10000)
  bestUci: string; bestSan: string;
  pv: string;              // engine PV from the BEFORE position (for review narration)
  winLoss: number;         // win% lost vs best, mover POV (from classifyMove)
  cls: MoveClass;          // best|brilliant|…|blunder (reuse existing type)
}

// A tagged mistake — the ledger the whole feature is built on.
interface Mistake {
  id: string;
  userId: string;
  gameId: string; ply: number;
  fenBefore: string;       // the position where you should have found the move
  playedUci: string; bestUci: string; bestSan: string;
  cls: MoveClass;          // mistake | miss | blunder (we only ledger these)
  winLoss: number;
  phase: "opening" | "middlegame" | "endgame";
  motifs: MotifTag[];      // reliable tags only, each with confidence (§6)
  createdAt: string;
}

interface MotifTag { tag: string; confidence: "high" | "heuristic"; }

// Rolled-up weakness profile (recomputed from the mistake ledger; cheap to rebuild).
interface WeaknessProfile {
  userId: string; updatedAt: string; gamesAnalyzed: number;
  phaseAccuracy: Record<"opening"|"middlegame"|"endgame", number>;     // accuracy% per phase
  motifMissRate: Record<string, { seen: number; missed: number }>;    // fork/hangingPiece/backRankMate/…
  advantageCapitalization: number;   // % of "winning" positions (≥80% win%) actually converted
  blunderRatePer100: number;         // blunders per 100 of your moves
  hangingPer100: number;             // pieces hung per 100 moves
  trend: number[];                   // recent per-game accuracy, for a Sparkline
}

// A spaced-repetition drill item (SM-2 core; see §9).
interface DrillItem {
  id: string; userId: string;
  motif: string;           // the SR "card" is the motif, not the exact position (§9)
  sourceMistakeId?: string;
  fen: string; bestUci: string;  // the served puzzle (own-mistake or a motif sibling)
  origin: "own-game" | "lichess";
  // SM-2 state
  repetitions: number; easeFactor: number; intervalDays: number; dueDate: string;
  lapses: number; isLeech: boolean;
  state: "new" | "learning" | "review" | "relearning";
  lastReviewed?: string; createdAt: string;
}
```

**Storage & scaling (honest).** JSON files match the current app and are fine for a single local user (hundreds–low-thousands of games). One `SavedGame`/`PlyAnalysis` file per game avoids rewriting a giant blob. The mistake ledger and drill store are hot and will grow — when they get large (thousands of mistakes, daily SR queries over due-dates), migrate those two to **SQLite** (`better-sqlite3`, synchronous, zero-config, one file). Flagged as the known migration, not a day-one need.

---

## 5. The analysis pipeline

### 5.1 When it runs
On `POST /api/games`, the game is persisted with `analysisStatus: "pending"` and enqueued. A single-worker queue analyzes one game at a time. It should run **when the live-play engine is idle** (no active `/ws/play` search) so the two Stockfish processes don't contend for CPU on the M1 Pro — the same scheduling discipline the coach uses ([13](13-the-coach.md) §8). The user can also trigger "analyze now" from the Train page.

### 5.2 What it does, per ply
Reuse the existing `Engine.analyze(fen, { multipv: 3, depth })` (`server/engine.mjs`) — no new engine code. For a game of *P* plies it runs *P* analyses. Crucially, **`analyze(after move N)` is `analyze(before move N+1)`** (same insight as the live coach, [13](13-the-coach.md) §5.2), so a game costs ~*P* analyses, not 2*P*, with a FEN-keyed cache. At review depth (~depth 18 / ~600–1000ms/ply) a 40-move game (~80 plies) is ~1–1.5 min of background work — acceptable for a job that runs once per game and persists forever. Depth is a setting; live coaching stays shallow, review goes deep.

### 5.3 The shared-logic problem (a real decision, not a detail)
`winPct`, `classifyMove`, `accuracy`, and `CLASS_META` are pure functions that today live in **`web/src/lib/coach.ts`** (TypeScript). The analysis worker needs the *same* math server-side. Three options:

1. **Duplicate** the functions in a `server/analysis.mjs`. Simplest, but two copies drift — the classification thresholds are the product's ground truth and must not diverge.
2. **Extract** the pure core into a plain-JS module (`app/shared/coachcore.mjs`, no React, no TS-only syntax) that *both* the server imports directly and the web bundles (Vite handles `.mjs`). Recommended. It is a mechanical extraction of already-pure code.
3. Compile the TS to JS as a build step. Heaviest; unnecessary for a handful of pure functions.

**Recommendation: option 2.** Move `winPct`, `lineCpWhite`, `classifyMove`, `accuracy`, the SEE helper, and the new motif detectors (§6) into `app/shared/coachcore.mjs`; have `web/src/lib/coach.ts` re-export from it (or import) so the live coach and the batch worker are provably the same logic. This is the one non-trivial refactor the Trainer requires of existing code, and it *improves* the coach too (single source of truth).

---

## 6. The mistake taxonomy & tagging engine

A mistake is described by two orthogonal axes:

- **Severity** — *how bad*, from the win%-loss buckets already implemented in `classifyMove` (`inaccuracy | mistake | miss | blunder`). The Trainer ledgers only `mistake`, `miss`, and `blunder`. This axis is exact.
- **Motif** — *what kind*, e.g. "hung a piece", "missed a fork", "back-rank mate". This axis is the hard part and is **partly heuristic**. It is exactly what Lichess does when it theme-tags puzzles, and Lichess's tagger (`ornicar/lichess-puzzler/tagger/cook.py`) is open source and portable.

The combination is the teaching signal: *"blunder — hung a knight (high confidence)"* or *"miss — missed a fork (heuristic)."*

### 6.1 The library reality (verified)
The installed **`chess.js@1.4.0`** (the `^1.0.0-beta.8` caret in `package.json` resolves up to 1.4.0 in the lockfile — verified in `node_modules`) exposes **`attackers(square, color?)`** and `isAttacked(square, color)`. These are the primitives the geometric detectors need. **Action item:** bump `web/package.json` and `server/package.json` to `"chess.js": "^1.4.0"` so a future clean install can't regress to a beta build lacking `attackers()` (a real footgun — `attackers()` first shipped in 1.0.0). Neither chess.js nor python-chess ships SEE; you build it on `attackers()` (§6.3).

### 6.2 Tags we can detect reliably (build these)
Each is gated on the move's win%-loss (so a tag only fires on an actual mistake) and, where noted, on the engine PV. Rules distilled from `cook.py` and `scalachess/Divider.scala`:

| Tag | Confidence | Rule |
|---|---|---|
| **mateInN** (missed/allowed mate) | **high** | Read `score mate N` straight from the engine PV of the best line. No heuristics. |
| **promotion / underPromotion** | **high** | `move.promotion` / verbose flags. Deterministic. |
| **gamePhase** (opening/middlegame/endgame) | **high** | Count non-king/non-pawn pieces: ≤6 → endgame, ≤10 → middlegame, else opening (portable form of scalachess `Divider`). Boundaries are conventional but standard. |
| **hangingPiece** (you left a piece takeable) | **high** | After the played move, run a **SEE swap** (§6.3) on each of your pieces the opponent can capture; if net material for them is > 0, you hung it. This is *the* most common sub-1800 mistake per Heisman, so it is the highest-value tag. |
| **fork** (you missed one, or walked into one) | **heuristic** | From a candidate piece's landing square, iterate `attackers`/attacks over enemy pieces; count a prong when target value > forker value **or** target is hanging; require ≥2 prongs **and** the forking piece isn't itself capturable for free. Value-gating (from `cook.py`) is what stops "attacks two pieces" from over-firing. Reliable for the clean case; degrades when targets are defended. |
| **backRankMate** | **heuristic** | `isCheckmate()` (or forced mate from PV) **and** enemy king on its back rank **and** a checker on that rank **and** the king's forward escapes blocked by its own pieces. Gate on real mate/mate-threat from the engine. |

### 6.3 Static Exchange Evaluation (SEE) — spelled out, since we implement it
Neither library provides it. The swap loop on a target square `sq`:

```
see(board, sq, side):
  attackers = board.attackers(sq, side) sorted by piece value ascending
  if none: return 0
  take the least-valuable attacker; gain = value(piece currently on sq)
  simulate the capture (remove attacker from its square, place on sq, mask it out of occupancy
     so x-ray attackers behind it are revealed — chess.js: re-query attackers on the updated board)
  return max(0, gain - see(board', sq, other_side))   // either side may "stand pat"
```

The `max(0, …)` is the stand-pat option (a side won't recapture into a loss). Least-valuable-attacker-first and x-ray unmasking are the two things a naïve "is it defended?" check gets wrong, and they are the source of false positives on `hangingPiece` (pins and skewers, which chess.js won't surface, are the residual failure mode — accept and label as high-but-not-perfect).

### 6.4 Tags we deliberately do NOT auto-assign (honest exclusions)
These encode *why a move works* (a search/counterfactual property), not *what is attacked now* (a static property), so they have high false-positive risk and are excluded from the confident ledger. They may appear later only as *engine-verified* tags (replaying the PV and re-evaluating), never as geometry guesses:

- **pin / skewer / discoveredAttack** — geometry is hand-computable by ray-walking, but distinguishing a *relevant* pin from an irrelevant alignment needs value/legality context and over-tags badly. `chess.js` `isPinned` covers *only* absolute pins to the king.
- **deflection / decoy / interference / overloading / zwischenzug** — defined by a move's role in a forcing sequence. Even Lichess's own `overloading` detector is a no-op stub. Omit.
- **"which motif was the missed tactic"** — detecting *that* you missed a tactic (win% drop) is easy; reliably *naming* the motif of the line you didn't play is not.

Every tag carries a `confidence` field; the UI shows heuristic tags with a small "?" the way the coach labels Brilliant/Great/Miss ([13](13-the-coach.md) §5.4). We are not claiming parity with a commercial product; we are building a transparent, honest classifier.

---

## 7. The weakness model (analytics)

The `WeaknessProfile` is a cheap roll-up of the mistake ledger, rebuilt whenever a game finishes analyzing. It answers "what do I actually get wrong?" — the thing generic tools don't personalize.

**What we can compute (grounded):**
- **Phase accuracy** — reuse the existing `accuracy(losses[])` (Lichess curve, already in `coach.ts`) partitioned by `gamePhase`. Surfaces "your endgames are your weak phase."
- **Motif miss-rate** — for the *reliable* motifs only (fork, hangingPiece, backRankMate, mateInN): how often the pattern appeared vs how often you got it wrong. This mirrors Chess.com Insights' documented "Forks/Pins/Mates found vs missed" bucketing, restricted to what we can detect honestly.
- **Advantage capitalization** — from the persisted eval graph: of positions where you reached ≥80% win%, what fraction did you convert? This is Aimchess's "Advantage Capitalization" metric, computed transparently from our own evals.
- **Blunder / hanging rate per 100 moves** — straight counts from the ledger.
- **Trend** — per-game accuracy over time (feeds the existing `Sparkline`).

**What we cannot compute yet (honest gaps):**
- **Time management** — Aimchess and Chess.com surface this, but the Play page has **no clock** (§2). Out of scope until clocks are added. Do not fake it.
- **Opening naming / repertoire performance** — needs an ECO dataset (name ⇄ FEN/position-hash), which the app doesn't bundle — the same deferral as the coach's "Book" label ([13](13-the-coach.md) §5.5). Until then, phase-accuracy for the opening phase is a coarse stand-in; true "your Sicilian scores 38%" waits on an ECO table (a bounded, later add — the Lichess opening dataset is openly available).
- **Peer comparison ("vs players your rating").** Aimchess/Chess.com compare you to a cohort; we have no cohort database and shouldn't pretend to. The honest substitutes: compare you **against your own past** (trend), and calibrate puzzle difficulty against **Lichess puzzle ratings** (§9), which are real population data. State this plainly in the UI.

---

## 8. Training page surfaces

Route `/train`; a new nav entry in `components/Layout.tsx` (`{ to: "/train", label: "Train", icon: GraduationCap, hint: "Improve your game" }` — a stylized label like "Dojo" is optional to match the "Atelier/Standings" voice). Four surfaces, phased (§13):

### 8.1 Dashboard — "what to work on"
The landing view. Reads `WeaknessProfile`:
- A ranked **"your recurring mistakes"** list (e.g. *"Hung a piece — 14× in 20 games"*, *"Missed a fork — 9×"*, *"Dropped a winning position — 6×"*), each linking to the games/positions where it happened and to a drill.
- Phase-accuracy bars and the accuracy **trend Sparkline**.
- A **"start today's drills"** button (N due, §9).
This is the antidote to the stagnation trap (§0.3): it points every study session at a real, personal weakness.

### 8.2 Guided game review — Socratic self-analysis
Built on machinery that already exists: arrow-key move navigation and position reconstruction are in `Play.tsx` today; the eval graph is a `Sparkline`; per-ply best-move/PV/classification come from `analysisStore`. What's new is the **pedagogy**, driven by the research (§0.4 — engine-first review skips the learning):
- Step through the game; at each of *your* mistakes the tool **pauses and asks you to find the better move first** (guess-before-reveal), then shows the engine's line and the motif tag. This is the DecodeChess/coach voice, but for your own finished game.
- **"Jump to next mistake"** for a fast review pass.
- Eval graph with your mistakes marked; click to jump.
The board reuses `Board` + `autoShapes` (best-move arrow, classification glyph via `CLASS_META`) exactly as the live coach does.

### 8.3 Personalized drilling — puzzles from *your* mistakes
The Aimchess core loop, done honestly. Two puzzle sources:
1. **Your own mistakes** — a `Mistake` *is* a puzzle: "here is the position where you missed the best move; find it." Highest personal relevance.
2. **Motif siblings from the Lichess puzzle DB** — for a weak motif, serve *different* positions with the *same theme* at your difficulty (§9). This is the interleaving/desirable-difficulty principle: re-showing the identical position trains rote recall of one answer, not the transferable pattern (§9.2).
Scheduling is spaced repetition (§9).

### 8.4 (Later) Curriculum — level-gated lessons
Silman's model (verified): teach only what the player needs at their current level and build up, rather than dumping everything. Gate lesson content on the detected weaknesses + estimated level, so a beginner who hangs queens isn't shown rook-endgame theory. Content-heavy; a later phase.

### 8.5 (Later) Maia sparring as a diagnostic
The manifest already registers Maia 1100/1500/1900 (human-like nets, no random blunders). Playing a human-like bot *at your level* surfaces the mistakes you'll actually face far better than getting crushed by full Stockfish — and those games feed the same analysis pipeline. A natural bridge between Play and Train.

---

## 9. Spaced-repetition drilling (the scheduler)

The scheduler choice matters *less* than the item-selection policy (§9.2), but it must be concrete.

### 9.1 Scheduler: SM-2 core (4-button), FSRS-ready
Start with a 4-button **SM-2** variant — ~20 lines, three stored numbers + a due date, captures ~90% of the value for a from-scratch app. The `DrillItem` fields (§4) are a **strict subset of the FSRS `Card`**, so migrating to **`ts-fsrs`** (npm, implements FSRS v6, works with default weights, no training required) later is additive, not a rewrite. Choose SM-2 now for simplicity; adopt `ts-fsrs` from day one instead if you'd rather write no scheduler math — both are defensible.

The verified SM-2 update (grades mapped `again→0, hard→3, good→4, easy→5`):

```
q = grade
if q >= 3:                         // correct
  interval = reps==0 ? 1 : reps==1 ? 6 : round(interval * EF)
  reps += 1
else:                              // failed
  if state == "review": lapses += 1
  reps = 0; interval = 1; state = "relearning"
  if lapses >= 8: isLeech = true   // Anki default
EF = EF + (0.1 - (5-q)*(0.08 + (5-q)*0.02))   // applied every grade
if EF < 1.3: EF = 1.3
dueDate = today + interval days
```

> **Documented ambiguity (decide and record):** the SM-2 primary source is internally contradictory about whether EF updates on a *failure*. Wikipedia's formalization updates it unconditionally (the reading above); some implementations leave EF untouched on a fail. **This design chooses: update EF on every grade.** Noted so it's a decision, not an accident.

### 9.2 The chess-specific twist (where the real value is)
Do **not** loop the identical blundered position — that trains recall of one answer, not the pattern. Instead:
- **The SR "card" is the *motif*, not the position.** When a drill comes due, serve a *different* puzzle sharing the failed motif.
- **Interleave** motifs across a session rather than blocking one type (desirable difficulty). The strongest evidence here is from math, not chess — Rohrer et al.'s classroom RCT found interleaved practice beat blocked **61% vs 38% (d=0.83)** on a delayed test — so applying it to tactics is a reasoned extrapolation, not a proven chess result. Stated honestly.
- **Exact-position mode** is kept *only* where the specific line is the point (opening/endgame prep, à la Chessable MoveTrainer / Listudy). An opt-in **Woodpecker mode** (deliberately re-solving a fixed set to build automaticity — Smith & Tikkanen) can be a distinct, clearly-labelled feature: it is the *opposite* philosophy and shouldn't be the default.
- **Leech rule** (Anki default, documented): after **8 lapses** on a motif, stop hammering the same thing — route to an easier sibling of the same theme or add hint scaffolding, rather than burning the user out on a pattern they keep failing.

### 9.3 The puzzle source: bundled Lichess DB
The **Lichess puzzle database is open (CC0)** and theme-tagged (~4M puzzles; the `Lichess/puzzle-themes` mapping and the puzzle CSV carry `Rating` + `Themes` per puzzle). Bundle a filtered slice locally, indexed by `(theme, ratingBand)`, so motif-sibling serving (§9.2) is a lookup. This is the same taxonomy the tagger (§6) uses, so a mistake tagged `fork` maps directly to `fork`-themed sibling puzzles.

### 9.4 Difficulty targeting without a rating
The app doesn't rate the human player. Give drilling a **self-calibrating puzzle rating** (Glicko-lite: puzzle solved → rating up, failed → down, scaled by the puzzle's own Lichess rating) so served difficulty converges to the user's level — the same mechanism Lichess puzzles use. Optionally let the user set a starting rating. This also gives the Dashboard an honest, *earned* progress number that is **not** a chess Elo and is labelled as a puzzle rating.

---

## 10. Backend changes (all additive)

| Surface | Change |
|---|---|
| `POST /api/games` | **New.** Persist a finished human game (`{ pgn, youColor, botId, result, reason }`), enqueue analysis. Returns `gameId`. |
| `GET /api/games` / `GET /api/games/:id` | **New.** List / fetch saved games + analysis status. |
| `WS /ws/review` *or* internal worker | **New.** Runs the per-ply batch analysis (§5), streams progress (`{ ply, total }`) so the UI can show "analyzing 34/80", persists `PlyAnalysis` + `Mistake` rows on completion. Reuses the existing `Engine`/`analyze`. |
| `GET /api/train/weakness` | **New.** The rolled-up `WeaknessProfile`. |
| `GET /api/train/drills/due` | **New.** Due `DrillItem`s (+ served puzzle positions). |
| `POST /api/train/drills/:id/review` | **New.** Grade a drill (`again/hard/good/easy`); runs the SM-2 update (§9.1). |
| `server/store.mjs` | **Add** `gamesStore`, `analysisStore`, `mistakeStore`, `weaknessStore`, `drillStore` using the existing `load`/`save` helpers (or `better-sqlite3` for the two hot stores — §4). |
| `app/shared/coachcore.mjs` | **New.** Extracted pure logic (§5.3) imported by both server and web. |
| `web/src/pages/Play.tsx` | **One additive write:** on game over, `POST /api/games`. Gated so it never affects the existing flow; a failed save is silent. |

No change to `/ws/play`, `/ws/coach`, `/ws/arena`, the engine's `search()`, or any existing store call.

---

## 11. Frontend changes (all additive)

| File | Change |
|---|---|
| `web/src/pages/Train.tsx` | **New.** The page shell + the four surfaces (§8), phased. |
| `web/src/App.tsx` | **Add** one route `<Route path="/train" element={<Train/>} />`. |
| `web/src/components/Layout.tsx` | **Add** one `NAV` entry. |
| `web/src/lib/train.ts` | **New.** Client API for the `/api/train/*` + `/api/games` endpoints (mirrors `lib/api.ts`). |
| `web/src/components/train/*` | **New.** `Dashboard`, `ReviewBoard` (reuses `Board`, arrow-nav, `Sparkline`, `CLASS_META`), `DrillBoard`. |
| `web/src/lib/coach.ts` | **Refactor only:** re-export the pure core from `app/shared/coachcore.mjs` (§5.3). Behavior identical. |
| `web/package.json` / `server/package.json` | Bump `chess.js` to `^1.4.0` (§6.1); add `ts-fsrs` if/when adopted (§9.1). |

The acceptance test for "additive," same as the coach: with no code touching `/train`, the existing four pages behave byte-for-byte as today, except that finished Play games now get saved (a pure write with no UI effect).

---

## 12. Analysis cost & performance (honest)

- **Two engines again.** Like the coach, the Trainer's analysis worker and the live-play engine can run at once. Mitigation is the same: schedule analysis when `/ws/play` is idle; it's a background job with no latency requirement.
- **Batch weight.** ~*P* analyses per game at review depth (~1–1.5 min/40-move game). Fine as a one-time, persisted job; unacceptable to redo on every page view — hence persistence and FEN-caching.
- **Depth is a setting.** Live coach stays shallow (~depth 16, movetime 600ms); review analysis goes deep (~depth 18–20) because quality matters more than latency here.
- **Storage grows.** Per-game analysis files + a growing mistake/drill ledger. JSON is fine for a single user; SQLite is the flagged migration for the two hot stores (§4).

---

## 13. Phasing (build order)

| Phase | Deliverable | Depends on |
|---|---|---|
| **T0 — The spine** | Persist Play games (`POST /api/games`); background per-ply analysis; `classify` + reliable-motif tagging into the mistake ledger; the shared `coachcore.mjs` extraction. **No UI yet** — verify via stored data. | — |
| **T1 — Dashboard + Review** | `WeaknessProfile` roll-up; the Train page shell; the weakness dashboard; Socratic guided review over saved games (reusing arrow-nav + eval graph). | T0 |
| **T2 — Drilling + SR** | `DrillItem`s sourced from own mistakes; SM-2 scheduler; drill UI; puzzle rating (§9.4). | T0, T1 |
| **T3 — Motif siblings** | Bundle the Lichess puzzle DB; serve theme-matched sibling puzzles + interleaving + leech rule. | T2 |
| **T4 — Curriculum / Maia (optional)** | Level-gated lessons; Maia-sparring diagnostic; ECO opening naming; `ts-fsrs` swap. | T1–T3 |

T0 is the real project — everything downstream is assembly and UI over the record it produces. Ship T0 headless and confirm the ledger is accurate before building any page on top of it.

---

## 14. Honest limits & the strategic caveat

- **This is the biggest scope expansion in the repo**, and it deliberately steps away from [12](12-the-platform.md)'s "build thin, don't outrun the engine" ethos. That is a legitimate choice — the Trainer is the part of the product that actually *helps the user* — but it should be made consciously: it will consume more time than the Coach did, and none of it is on the critical path to beating Stockfish ([00](00-the-honest-reality.md), [11](11-roadmap-and-strategy.md)).
- **No rating promises.** The literature forbids them (§0.2); the UI must speak in terms of "mistakes reduced" and "patterns learned" (Heisman's real definition of improvement), with the puzzle rating clearly *not* a chess Elo.
- **Motif tags are partly heuristic** and labelled as such; SEE has residual false positives on pins/skewers (§6.3); the excluded motifs (§6.4) are excluded *because* honest detection isn't tractable statically.
- **No clocks → no time analytics; no ECO table → no opening naming**, until those are added (§7). We surface what we can compute and say nothing about what we can't.
- **Single-user, local.** Peer comparison is out; self-comparison-over-time and Lichess-population puzzle ratings are the honest substitutes (§7, §9.4).
- **The scheduler is the easy 10%.** The value is in (a) the accurate, tagged mistake ledger (T0) and (b) serving *similar-motif* puzzles instead of the identical position (§9.2) — the one place generic flashcard SR gets chess wrong.

---

## Appendix A — Implementation kickoff (cold-start build guide)

*Everything a fresh session needs to start building without re-deriving context. Read [13](13-the-coach.md) (the live coach it extends) and this doc in full first.*

### A.1 Repo & run setup (verified)
- Monorepo at `app/` (npm workspaces: `web`, `server`). `type: module` throughout.
- **Run dev:** `cd app && npm install && npm run dev` → web on **:5173** (Vite), server on **:3001**. Vite proxies `/api` and `/ws` to :3001 (`web/vite.config.ts`), so the frontend calls same-origin paths.
- **Prod:** `npm run build` (→ `web/dist`) then `npm start` (server serves the built app + API on :3001).
- **Engine:** needs a system Stockfish (`brew install stockfish`); auto-detected via `engines/manifest.json` (`id: "stockfish"`). Also present: Maia 1100/1500/1900 (lc0), Vesper, others.
- Server persistence is JSON files in `server/data/` via `store.mjs` `load(name, fallback)` / `save(name, data)`, plus append-only `games.pgn`. Follow that pattern for the new stores (or `better-sqlite3` for the hot ones — §4).

### A.2 First commit (do this before anything else)
Bump `chess.js` from `^1.0.0-beta.8` to `^1.4.0` in **both** `web/package.json` and `server/package.json`, reinstall, and confirm `new Chess().attackers("e4","w")` works. `attackers()` is the primitive the whole tagger stands on (§6.1); the beta build lacks it. This is the one change that must not be skipped.

### A.3 The Play → save integration point (exact)
In `web/src/pages/Play.tsx`, a game reaches a terminal state through `game.current.isGameOver()` (detected in `checkEnd()`, which sets `status`). Add a single fire-once-per-game effect: when the game transitions to over (and there were moves, and it wasn't a takeback), `POST /api/games` with `{ pgn: game.current.pgn(), youColor: myColor, botId: bot.id, result, reason }`. chess.js exposes `.pgn()`. Keep it a pure write — wrap in try/catch, never block or alter the existing flow; a failed save is silent. Note: **resignation is not currently a modeled outcome** on the Play page (the "Flag" button is a rematch), so only natural game-ends (mate/stalemate/draw) are captured until a resign action is added — acceptable for v1.

### A.4 Lichess puzzle DB (for Phase T3) — concrete source
Published at **https://database.lichess.org/#puzzles** → `lichess_db_puzzle.csv.zst` (CC0; ~300MB compressed, ~5M puzzles). Columns: `PuzzleId, FEN, Moves, Rating, RatingDeviation, Popularity, NbPlays, Themes, GameUrl, OpeningTags`. `Themes` is a space-separated list using the *same* taxonomy the tagger emits (§6), so a mistake tagged `fork` maps directly to `Themes` containing `fork`. **Do not bundle the whole file** — decompress, filter to the motifs we detect × a sensible rating range, and write a compact indexed slice (`(theme, ratingBand) → puzzles`) into `server/data/`. **Verify the move-application convention** from the DB page before building the solver (Lichess puzzles apply the first move of `Moves` to `FEN` to reach the start, then the player solves the rest — confirm against the current docs).

### A.5 Per-phase acceptance criteria (testable "done")
- **T0 (spine):** play a full game vs a bot on the Play page → a `SavedGame` file appears; background analysis fills `PlyAnalysis` for every ply; the `Mistake` ledger contains your blunders/mistakes/misses, each with a correct `phase` and (where applicable) a reliable motif tag. Manually verify 3–4 tagged mistakes against the board (especially `hangingPiece` via SEE) to confirm no gross false positives. **No UI required to pass T0.**
- **T1:** the Train page lists your saved games; the dashboard shows phase-accuracy + a real "recurring mistakes" ranking derived from the ledger; guided review steps a game, marks your mistakes on the eval graph, and makes you guess before revealing the engine line.
- **T2:** due drills are generated from your own mistakes; grading (again/hard/good/easy) reschedules them via SM-2; a leech (8 lapses) is diverted; the puzzle rating moves with performance.
- **T3:** a mistake tagged `fork` produces *different* fork puzzles at your rating from the bundled Lichess slice; motifs interleave within a session.

### A.6 The one refactor of existing code
Extract the pure functions (`winPct`, `lineCpWhite`, `classifyMove`, `accuracy`, `CLASS_META`, the SEE helper, the new motif detectors) into `app/shared/coachcore.mjs` (plain JS, no React/TS-only syntax); have `web/src/lib/coach.ts` import/re-export from it, and the server analysis worker import it directly. This gives the live coach and the batch worker one provable source of truth (§5.3). It must not change live-coach behavior — the existing coach is the regression test.

---

## Sources

**Improvement science (from the research pass, adversarially verified):** de Groot (1946/1965); Chase & Simon (1973, *Perception in Chess*); Gobet & Simon (1998, chunking/templates); Connors, Burns & Campitelli (2011, de Groot replication); Campitelli & Gobet (2004, *Skilled Chess Players Search More and Deeper* — the calculation-matters counter-nuance); Charness et al. (2005, *The role of deliberate practice in chess expertise*); Gobet & Campitelli (2007/2008, practice variability); Dan Heisman (*The Improving Chess Thinker*; "Real Chess vs Hope Chess"; definition of improvement); Yusupov/Dvoretsky (self-analysis as primary method); Silman (*Complete Endgame Course*, level-gated). McIlroy-Young et al. (2020, Maia, KDD).

**Mistake tagging:** `ornicar/lichess-puzzler` — `generator/generator.py`, `generator/util.py`, `tagger/cook.py` (motif detectors); `lichess-org/lila` `PuzzleTheme.scala` (theme enum); `lichess-org/scalachess` `Divider.scala` (game phase); Lichess accuracy/win% page (win% coefficient `0.00368208`, matching the app's existing `coach.ts`); Chessprogramming Wiki (SEE); `chess.js@1.4.0` (`attackers()`, verified in `node_modules`); Chess.com Insights & Game Review support articles (Forks/Pins/Mates found-vs-missed; expected-points classifications); Aimchess (six category names: Tactics, Endgame, Advantage Capitalization, Resourcefulness, Time Management, Opening Performance — internal formulas undisclosed).

**Spaced repetition:** SM-2 (Woźniak 1990; Wikipedia formalization; Anki FAQ/manual for the ease floor + leech default = 8 lapses); FSRS (`open-spaced-repetition/fsrs4anki`, `free-spaced-repetition-scheduler`, `ts-fsrs`; Anki 23.10 changelog; DSR memory model); Chessable MoveTrainer (documented 8-level interval ladder via Chess.com support; algorithm undisclosed); interleaving evidence (Rohrer & Taylor 2007; Rohrer, Dedrick et al. classroom RCT — 61% vs 38%, d=0.83; Bjork "desirable difficulties"); Woodpecker Method (Smith & Tikkanen, Quality Chess 2018); Lichess puzzle database (CC0, theme-tagged).

*Flags carried from research (do not overstate): SM-2's on-failure EF behavior is ambiguous in the primary source (§9.1 decision recorded); FSRS-vs-SM-2 accuracy figures and parameter counts are secondary-verified; Aimchess/CAPS2/Chessable internal formulas are undisclosed; all interleaving RCT evidence is from math, extrapolated to chess; Chess.com per-move motif tagging is undocumented.*
