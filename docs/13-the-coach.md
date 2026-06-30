# 13 — The Coach: Live Coaching, Move Classification & Engine Explanations

*A design document for adding a coaching layer to the Playboard ([12](12-the-platform.md)). Where [12](12-the-platform.md) lets you **play** a bot, this specifies a system that **teaches you while you play**: an objective eval, move classification (blunder/mistake/best/brilliant/…), tiered hints, takebacks, board arrows, the strongest move on demand, and — the ambitious end — human explanations of *why* a move (yours or the engine's) is good or bad.*

*Status: **implemented** — Phases A–E (engine/classification substrate) + **v2** (§0: active coaching loop — threats, blunder guard, pacing) + **v3** (§0.2: "Marcus" persona — emotive avatar + conversational feed) + **v4** (§0.3: engine-grounded threats — replacing the heuristic threat detector so advice can't contradict the eval). Purely additive behind a "Coach" toggle. This doc remains the reference for how it works and what's heuristic vs. exact.*

---

## 0. v2 — From commentator to coach (the turn loop)

**The v1 failure (real user feedback):** "it just comments on moves that were made, doesn't really act like a coach." Correct. v1 graded finished moves and showed an eval — useful, but a *commentator*, not a *coach*. Two concrete problems:

1. **No engagement on *your* turn.** A real coach works hardest *before* you move — narrowing candidates, flagging threats, asking questions — not after.
2. **No room to read it.** With the coach on, the bot still replied instantly, so its take on your move flashed by before you could read it.

**What real coaches actually do.** The literature is consistent: coaching is teaching a *thinking process*, turn by turn, Socratically — give the student the tools to find the move, don't just hand it over. GM Noël Studer's widely-taught loop is the template:

- **Step 1 — opponent moved:** *"Whenever your opponent moves a piece, look out for the threats that piece creates."*
- **Step 2 — your candidates:** scan in order — **Checks, Captures, Threats** (CCT).
- **Step 3 — before you move:** *"What is my opponent doing if I play this?"* — the blunder-check.
- Guiding principle: *"Right Process + Wrong Move is better than Wrong Process + Right Move."*

This reframes the whole feature. The coach's job is to run **that loop with you, every turn** — not to wait for a move and grade it. The redesign adds three behaviors (all gated behind the coach toggle, still purely additive):

| v2 behavior | Maps to | What it does |
|---|---|---|
| **Threat alert** (proactive, on *your* turn) | Studer Step 1 | When it becomes your move, the coach leads with *what the opponent's move threatens* ("⚠ Bg5 pins your knight — Nxe4 is in the air"). It engages before you touch a piece. |
| **Socratic prompt + tiered hints** | Step 2 (CCT) | Instead of dumping the best move, it nudges: "Any checks or captures? What's your worst-placed piece?" Hints stay tiered/on-demand (nudge → piece → square → move). |
| **Blunder guard** (intercept before commit) | Step 3 | When you play a move the coach judges a **blunder** (not every imperfection — that would nag), it **pauses before the opponent replies**: "Wait — that drops the knight to Bxf6. Sure?" → *[Play anyway] / [Take it back]*. It teaches the blunder-check; it never overrides you. Toggleable in the panel. |
| **Pacing** | — | With the coach on, the opponent's reply waits until the coach has assessed your move **plus a ~1.5s reading beat** (with a 3.5s safety fallback), so you always see the comment. Fixes "I can't see what the coach is saying." |

**Threat detection** is heuristic and synchronous (no extra engine round-trip): from your side-to-move position, generate the opponent's replies (flip side-to-move, guard for checks/en-passant), and surface the most dangerous — a capture of an under-defended or higher-value piece (SEE-lite recapture check), a check, or mate. Engine-backed null-move threats are a later upgrade. **— Superseded in v4 (§0.3): this heuristic cried wolf on harmless checks, gave a queen-winning fork the same line as a nothing-check, and missed every multi-move tactic. Threats are now derived from a real engine null-move search.**

**Pacing + blunder guard reuse the existing analysis.** The position *before* your move was already analyzed for the threat alert/hints, so when you move, the coach already has the "before" side of the classification; it only needs the "after." That same judgment drives both the blunder-guard decision and the comment you read during the pace. So the loop costs roughly one analysis per turn, not three.

The sections below (§1–§10) describe the v1 engine/classification/UI substrate, all of which v2 builds on unchanged. v2 is implemented in `lib/coach.ts` (`detectThreats`), `hooks/useCoach.ts` (threats + turn phase), and `Play.tsx` (pacing + guard flow + warning overlay).

### 0.1 Practicality decisions (what shipped, and why)

These are deliberate choices to keep the coach *useful* rather than *annoying* — the failure mode of most coaching UIs:

- **Guard fires on blunders only.** Classification is win%-loss vs. the best move, so when you're already losing, ordinary moves score small losses and *don't* trip the guard — it stays quiet exactly when nagging would be pointless, and speaks up when you hang material from a fine position. Verified end-to-end: from `1.e4 e5 2.Nf3`, playing `Qh4??` yields a 38.6% win-loss → BLUNDER → guard fires. Threshold lives in one place and is easy to widen to mistakes if wanted.
- **No auto-arrows for threats.** The threat alert is *text only* ("Watch out: Nxh4 wins your queen"). Drawing an arrow every turn is visual noise and over-hand-holding; the best-move arrow stays gated behind Hint/Show. You can still draw your own arrows (right-drag).
- **Pacing is judgment-gated, not a fixed sleep.** The bot waits for the *actual* assessment of your move (so the comment is guaranteed on screen) plus a short beat — with a 3.5s fallback so a slow/again-unavailable engine never deadlocks the game. Coupling the bot's wait to the coach's analysis also keeps the two engines off each other's CPU (coach thinks on your clock, bot on its own).
- **One analysis per turn, reused.** The position before your move (analyzed for the threat alert/hints) is the "before" side of the classification; only the "after" side is new. Same result drives the guard decision *and* the comment.
- **Everything is still gated behind the toggle.** Coach off ⇒ instant bot replies, no guard, no threats — byte-for-byte today's play page. The pace/guard path is skipped when your move ends the game.

**Known heuristic limits (honest):** threat detection is synchronous and catches hanging pieces (SEE-lite recapture test), big captures, and mate-in-1 — it can miss multi-move tactics and purely positional threats (it says "no immediate threats — make a plan" then). Engine-backed null-move threats **shipped in v4 (§0.3)**, replacing this heuristic entirely. Brilliant/Great/Miss remain approximations (§5.4).

*Sources:* [GM Noël Studer — How to Think During a Chess Game](https://nextlevelchess.com/how-to-think-during-a-chess-game/), [Dan Heisman — Types of Chess Thought Process Errors](https://www.chess.com/blog/danheisman/types-of-chess-thought-process-errors), [What Makes a Good Chess Teacher (chess.com forum)](https://www.chess.com/forum/view/for-beginners/what-makes-a-good-chess-teacher).

### 0.2 v3 — the coach as a *presence* (UI/UX)

v2 made the coaching *behaviour* right but it still read as "text on a screen." v3 gives it a face and a voice so it feels like someone is sitting next to you. Key idea (the user's own framing): **the presentation should depend on the advice**. A quiet position, a hanging queen, and a brilliancy should not look the same.

- **A named coach — "Marcus" — with an emotive avatar.** A monogram avatar whose **ring colour, status word, and mood icon change with the situation**: watching (taupe/eye), thinking (brass/spinner, pulsing), pleased (sage/smile), impressed (teal/sparkle), concerned (amber/triangle), alarmed (red/shield). The mood is derived from the live state — threat kind, your move's classification, whose turn it is.
- **A conversational feed, not a status line.** Coach lines arrive as **chat bubbles** (newest auto-scrolled into view), tinted by mood. Your-move reactions are right-aligned (like your side of a conversation); Marcus's observations left-aligned. While he's assessing your move the bubble shows a **typing indicator**, then morphs in place into the verdict — so the pacing beat *looks* like he's thinking.
- **Adaptive voice.** One module (`lib/coachVoice.ts`) turns analysis state into what Marcus would actually *say*: praises a brilliancy, winces at a blunder, flags the opponent's threat as a question ("can you find it?"), nudges with the CCT checklist in a quiet position, and spots when the *opponent* blundered ("they slipped — make them pay"). Quiet-position lines are chosen deterministically from a small pool (keyed off the FEN) so they vary without flickering.
- **Anchored to the board.** A faint marker sits on a threatened square so the spoken warning ("Nxh4 wins your queen") is tied to a place; the blunder guard is now Marcus himself (shaking avatar) interjecting *"Hold on — that hangs material."*
- **Still clean.** The eval shrinks to a chip in the header; strongest-move, hint, best, undo and the guard toggle live in a compact footer. Coach off ⇒ none of this renders; the panel and play page are exactly as before.

Implementation: `lib/coachVoice.ts` (persona + moods + `currentBeat`), rewritten `components/CoachPanel.tsx` (avatar + feed + footer), `Play.tsx` (board threat-marker, persona blunder overlay, feed reset on new game). All additive, all behind the toggle.

### 0.3 v4 — engine-grounded threats (correcting the coach's biggest lie)

**The failure (real user feedback, playing full-strength Stockfish):** Marcus warned *"Qa5+ would check your king — keep it safe"* while the coach's own objective eval was a calm **+0.17**. The check was deliberately ignored; it never came and cost nothing. The warning was noise — and worse, it **contradicted the eval the coach was showing at the same time.**

**Root cause.** v2's `detectThreats` (§0) was a synchronous `chess.js` heuristic that *never consulted the full-strength Stockfish the coach already runs*. After failing to find a naively-hanging capture or a mate-in-1, it flagged **any** check as a threat ("…would check your king — keep it safe"), with no test of whether the check accomplished anything and no reference to the eval. Reproduced against the engine, the heuristic:

- **cried wolf** on harmless checks — `Bxf2+` in the Italian and the reported `Qa5+` both carry a ~2–3% real swing;
- **gave a queen-winning fork the identical dismissive line** as a nothing-check — `…Nd3+` forking K+Q ⇒ *"would check your king — keep it safe"* (it's a 50% swing);
- **missed the actual threat while doing so** — in the `Qa5+` position the real concern was `…cxd4`, which the heuristic's `victim < 3` filter (ignore pawn captures) threw away;
- missed every multi-move tactic — it looks exactly one ply deep.

**The fix — derive threats from the engine, the way lichess does.** On your turn the coach hands the opponent the move (a **null move**: `flipSideToMove` swaps the side-to-move and drops en-passant) and analyzes that position with the same Stockfish over `/ws/coach`. A threat is real **only if that free tempo swings the evaluation meaningfully in the opponent's favour**, measured on the **same win% scale we grade moves on** — so the spoken danger can never contradict the eval. The move it names is the opponent's **engine-best reply**: against a full-strength opponent, exactly what they will play if you let them (lichess "show threat" + the lichess-puzzler's *play-it-out-and-re-evaluate* filter).

```
e0 = your win% with the move          // analyze(fen).best, your POV
e1 = your win% if the opponent moved  // analyze(flipSideToMove(fen)).best, your POV
T  = e0 − e1                          // the swing a free tempo is worth to them
```

**Severity bands (win% points, mirroring the §5.3 classification buckets; tunable in `THREAT_BANDS`):**

| swing `T` | severity | Marcus | mood |
|---|---|---|---|
| opponent has forced mate, or `T ≥ 20` | **alarm** | "Careful: …" | alarmed |
| `10 ≤ T < 20` | **warn** | "Watch out: …" | worried |
| `6 ≤ T < ~16` (non-forcing pressure softened to here) | **minor** | "Heads up: …" | neutral |
| `T < 6` | **none** | *silent* — an eval-aware "no threat" line instead | neutral |

The threatening move is named in SAN; when its payoff lands later in the line the coach narrates the follow-up straight from the engine PV (`"…Nd3+ — then Nxf4 wins your queen"` — DecodeChess-style before/after framing). A faint marker still anchors the warned square (warn/alarm only). **Verified end-to-end against Stockfish at the production budget:** the `Qa5+` position is now silent about the check and correctly flags `…cxd4 (10%)`; the hanging knight is an alarm naming `Nxe5 (32%)`; the fork is an alarm narrating `Nd3+ → Nxf4 wins the queen (50%)`; quiet and already-winning positions are silent.

**Eval-consistency (the other half).** `currentBeat` now receives the objective win%, so (a) mood tracks the **threat's magnitude**, not merely "a check exists," and (b) the "no threat" line is calibrated to the eval — *"you're clearly better — convert"* / *"you're under pressure — find counterplay"* / *"quiet — make a plan"* — instead of a blanket "make a plan" while you are in fact winning or losing.

**Cost & honest limits.** This adds **one extra engine search per your-turn** (the null-move position), sequenced *after* the objective eval and run on a shorter budget. Verified that a ~400ms search returns the same verdict as 1200ms across the scenario suite, so the threat bubble lands a natural beat after the eval ("Marcus looks, then warns") and your-turn coaching stays responsive; it is cancelled the moment you move. So the per-turn coach cost is now ~eval + classify + a short threat search, not the "one analysis, reused" of §8 — still comfortably within budget on the M1 Pro because the two engines think on different clocks. Genuinely approximable: **zugzwang** can under-report (null-move's known blind spot, mostly K+P endings); a very deep tactical threat could need more than the short budget (still strictly better than the old one-ply heuristic, which missed *all* multi-move tactics). Against a **weak** opponent the coach — always full-strength — shows what a strong player *would* punish, which may not match the weak bot's actual move; against full-strength Stockfish the prediction matches reality by construction (same engine).

Implementation (all additive, client-orchestrated — the server stays a dumb MultiPV oracle, no server change): `lib/coach.ts` (`computeThreat`, exported `flipSideToMove`, `THREAT_BANDS`; the old `detectThreats` is deleted), `hooks/useCoach.ts` (requests the null-move position on your turn, exposes `threat`), `lib/coachVoice.ts` (severity→mood, eval-aware lines, pending handling), `pages/Play.tsx` + `components/CoachPanel.tsx` (consume `coach.threat`, feed the objective win% to the voice). Coach off ⇒ byte-for-byte unchanged.

---

## 1. What the coach is — and the one correction that drives the whole design

The single most important architectural fact: **the eval bar on the Play page today is not an objective assessment.** It is fed by the *opponent bot's own search*, streamed over `/ws/play` (`server/index.mjs` → `onInfo`). If you are playing Maia-1100 or Sunfish, the bar shows *that weak engine's* (often wrong) opinion of the position. It is "what my opponent thinks," not "the truth."

A coach needs **ground truth**, which means a **second, independent, full-strength analysis engine** (Stockfish 18, already installed) running in parallel with whatever you are playing. Everything below follows from that separation:

- The opponent engine plays the moves (can be weak, human-like, characterful).
- The **coach engine** (full-strength Stockfish, `MultiPV ≥ 3`, deeper time) judges every position objectively and is the source for the coach's own objective eval, classifications, hints, best-move arrows, and explanations.

This also means coach mode runs **two engine processes at once**. That is fine on the M1 Pro (see §8) because in a turn-based game the two rarely think simultaneously — the coach analyzes on *your* clock, the opponent on *its* clock.

---

## 1.5 The governing principle: purely additive

**The coach is an overlay, not a rewrite.** It observes the live game and comments on it. It must not change a single thing about how play works today — not the opponent's eval bar, not the play flow, not the telemetry, not the move legality, nothing. The *only* action that mutates game state is the **takeback (undo)** button. Everything else — eval, classification, talking, arrows, hints, best move, explanations — is layered *on top* and is read-only with respect to the game.

Concretely, this is the contract between the existing Play page and the new coach:

- **Down (read-only):** the Play page hands the coach the current position (`fen`), the move history, and whose turn it is. The coach never writes back to `game`.
- **Up (two narrow channels only):**
  1. `autoShapes: DrawShape[]` — coach-drawn arrows/labels, rendered by chessground as a **separate layer** (see §7.1) that does not touch the board's existing last-move/check highlights or the user's own arrows.
  2. `onTakeback()` — the single mutating callback, invoked by the undo button.
- **Self-contained UI:** the coach renders its **own** panel and its **own** objective eval readout. It does **not** repurpose the existing left-hand eval bar (which stays exactly as it is — the opponent's view). Two clearly-labeled, separate things.

If coach mode is toggled off, the Play page is byte-for-byte the experience it is today. This is the acceptance test for "additive."

---

## 2. Feature inventory (what was asked for, mapped to difficulty)

| Feature | What it means | Difficulty | Notes |
|---|---|---|---|
| Eval-bar toggle | Show/hide the bar | ✅ **done** | Persisted in `localStorage` |
| Arrow-key navigation | ←/→ to step through moves | ✅ **done** | Foundation for review mode |
| Objective eval bar | Bar reflects full-strength SF, not the opponent | Low | New analysis stream |
| Strongest move | "The best move here is Nf5 (+0.8)" | Low | Falls out of MultiPV |
| Tiered hints | Nudge → piece → square → full move | Low–Med | Driven by MultiPV + heuristics |
| Takeback / undo | Roll back your move (+ engine reply) | Low | Pure client state |
| Board arrows | Coach draws; you draw (right-drag) | Low | chessground `drawable` |
| Move classification | blunder / mistake / inaccuracy / good / great / brilliant / best / miss / book | **Medium** | Standard but the fancy labels are heuristic |
| Post-game review | Eval graph + accuracy% + classified movelist | Medium | Built on nav we shipped |
| Heuristic explanations | "Nf5 attacks the e7 bishop and the d6 outpost" | Med–**High** | Template NL from features + engine PV |
| Engine "thought process" | "It played this because…" in human terms | **High** | Best served by an optional LLM layer |

**Honest framing (consistent with [00](00-the-honest-reality.md) and [12](12-the-platform.md)):** items down to *move classification* are well-trodden — Lichess and chess.com both ship them and the math is public-ish. The two *explanation* rows are where ambition outruns determinism. Engines do not "have reasons" in human language; they have a search tree and a number. Translating that into "the idea behind the move" is genuinely hard, partly heuristic, and the richest version needs an LLM. The design isolates that hard part as an optional, pluggable layer so the rest can ship without it.

---

## 3. Architecture overview

```
┌─────────────────────────────── Browser (Play.tsx) ───────────────────────────────┐
│  game state (chess.js)   board (chessground + drawable)   CoachPanel               │
│        │                         ▲  arrows/hints                ▲                    │
│        │ fen after each ply      │                              │ classification,    │
│        ▼                         │                              │ best move, eval,   │
│   coach client ──── analyze(fen) │                              │ explanation        │
│        │  (lib/coach.ts: orchestrate, classify, explain-heuristic)                  │
└────────┼────────────────────────────────────────────────────────────────────────┘
         │ WS  /ws/coach                                  │ REST (optional) /api/coach/explain
         ▼                                                ▼
┌──────────────────────────┐                   ┌──────────────────────────────┐
│ Coach analysis service   │                   │  LLM explanation service      │
│ full-strength Stockfish  │                   │  (Claude API, off by default) │
│ MultiPV=3, depth/movetime│                   │  consumes engine facts → prose│
│ (engine.mjs, extended)   │                   └──────────────────────────────┘
└──────────────────────────┘
```

Two new backend surfaces, three extended/new frontend pieces. Detailed below.

---

## 4. Backend

### 4.1 Extend `Engine` for MultiPV (the keystone)

`engine.mjs` currently parses a single `pv` line (`parseInfo`) and `search()` returns one `{uci, info}`. To classify moves and offer "the best move + alternatives," the coach needs the **top N moves with evals**. Stockfish exposes this via `setoption name MultiPV value N`; each `info` line then carries a `multipv 1|2|3` rank.

Add an `analyze()` method (leave `search()` untouched so play is unaffected):

```js
// engine.mjs
async analyze(fen, { multipv = 3, depth, movetime = 500, onUpdate } = {}) {
  const flip = fenTurn(fen) === "black";
  this.setOptions({ MultiPV: multipv });
  this.send("ucinewgame"); this.send("isready");
  await this._waitFor((l) => l === "readyok");
  this.send(`position fen ${fen}`);
  const lines = new Map(); // rank -> { scoreCp|mate, depth, pv, uci }
  const go = depth ? `go depth ${depth}` : `go movetime ${movetime}`;
  return new Promise((resolve) => {
    const fn = (line) => {
      if (line.startsWith("info") && line.includes(" pv ")) {
        const info = parseInfo(line, flip);          // extend parseInfo to read `multipv`
        const rank = info.multipv || 1;
        info.uci = info.pv?.split(" ")[0];
        lines.set(rank, info);
        onUpdate?.([...lines.values()].sort((a, b) => a.multipv - b.multipv));
      } else if (line.startsWith("bestmove")) {
        this.listeners = this.listeners.filter((l) => l !== fn);
        const ranked = [...lines.values()].sort((a, b) => a.multipv - b.multipv);
        resolve({ fen, lines: ranked, best: ranked[0] });
      }
    };
    this.listeners.push(fn);
    this.send(go);
  });
}
```

`parseInfo` gains one case: `case "multipv": info.multipv = +t[++i]; break;`. Evals stay **white-POV** (the existing `flip` logic already handles this) — important, because it makes cross-position comparison sign-consistent.

> Note: `MultiPV` is a persistent option, so the coach engine should be a **dedicated instance** kept at `MultiPV=3`; never set it on the play engine.

### 4.2 New WS endpoint: `/ws/coach`

A streaming analysis channel parallel to `/ws/play`. One long-lived full-strength Stockfish per connection (via `store.primaryPath()` / `store.bot("stockfish")`).

**Protocol**

```
client → { type: "analyze", fen, multipv?: 3, movetime?: 500, depth?: 18, reqId }
server → { type: "line",  reqId, lines: [{ multipv, scoreCp?, mate?, depth, pv, uci }] }   // streamed
server → { type: "done",  reqId, fen, lines: [...], best: {...} }
client → { type: "cancel", reqId }     // user moved on; stop wasting compute
```

Why streaming WS rather than a REST call: the eval bar should fill in live as depth increases (same UX as today), and a position can be **superseded** before analysis finishes (user takes back, navigates, or moves quickly) — cancellation matters. The handler mirrors `handlePlay`: a `busy` guard, reuse the engine across requests, kill the search on `cancel` (send `stop` to the UCI process) or when a newer `analyze` arrives.

**Scheduling discipline (important for §8):** the client should request coach analysis primarily when it is **the user's turn** (opponent idle) and **cancel** in-flight analysis the moment the user commits a move. This keeps the two engines off each other's CPU most of the time.

### 4.3 Where classification lives: the client

Move classification is pure arithmetic over evals the client already collects. Per the repo's "build thin, keep the server a dumb engine driver" ethos ([12](12-the-platform.md) §2), put it in **`web/src/lib/coach.ts`**, not the server. The server stays a MultiPV oracle; the client orchestrates which positions to analyze and computes labels.

### 4.4 Optional LLM explanation service (Phase E, off by default)

A thin REST endpoint `POST /api/coach/explain` that takes **engine-derived facts** (FEN, played move, eval before/after, top-3 PVs, detected motifs) and returns prose. Backed by the Claude API. Gated behind `ANTHROPIC_API_KEY`; when the key is absent the UI silently falls back to heuristic explanations (§6.3). This keeps the local-first default intact and makes the dependency explicit and optional.

---

## 5. Move classification

This is the marquee feature. The approach is the public Lichess/chess.com method: convert centipawns to a **win probability**, then bucket the **drop** in win probability caused by the move.

### 5.1 Win-probability model

Raw centipawns are non-linear in importance (a 100cp swing near 0.0 changes the game; near +9 it does not). Convert first:

```
winPct(cp) = 100 / (1 + exp(-0.00368208 * cp))     // 0..100, from the mover's POV
```

(`mate` is treated as a large cp, e.g. ±10000 → ~0/100%.) The constant is the commonly used chess.com-style coefficient; it is **tunable** and the design treats all thresholds below as configuration, not gospel.

### 5.2 The core delta

For a move played by the side to move:

- `evalBest` = white-POV eval of the **best** move (from the *before* position's MultiPV rank 1).
- `evalPlayed` = white-POV eval of the position **after** the move (which is `analyze(after)` rank 1 — the opponent's best reply already baked in).
- Convert both to the **mover's POV** (negate for Black), then to win%:
  `loss = winPct(evalBest_moverPOV) − winPct(evalPlayed_moverPOV)` (≥ 0).

Crucially, `analyze(after move N)` **is** `analyze(before move N+1)`. So steady-state cost is **one analysis per position**, cached and reused.

### 5.3 Buckets (working model — tunable)

| Label | Glyph | Condition (approx.) |
|---|---|---|
| **Best** | ★ | Played engine's rank-1 move |
| **Brilliant** | !! | A *good* move (`loss` small) that **sacrifices material** and the position stays winning/equal — see §5.4 |
| **Great** | ! | The move is far better than the 2nd-best option (only-move in a sharp spot), or it's the sole move avoiding a big drop |
| **Excellent** | — | `loss` ≤ ~2% |
| **Good** | — | `loss` ≤ ~5% |
| **Book** | 📖 | *(deferred, §5.5)* known opening theory |
| **Inaccuracy** | ?! | ~5% < `loss` ≤ ~10% |
| **Mistake** | ? | ~10% < `loss` ≤ ~20% |
| **Miss** | ✗ | You had a **clearly winning** move available (mate or large gain) and didn't play it, but your move wasn't itself a blunder — see §5.4 |
| **Blunder** | ?? | `loss` > ~20% |

### 5.4 The heuristic labels (Brilliant / Great / Miss) — and the honest caveat

These three are **not** pure eval-delta; chess.com's exact formulas are proprietary and unpublished. We build transparent approximations:

- **Brilliant (!!):** the move is best-or-near-best **and** it gives up material that the opponent can immediately win (the moved piece is en prise, or a higher-value piece is hung) **and** the resulting eval is still ≥ roughly equal for the mover. Detect the sacrifice by comparing material before/after the best line, or by checking if the destination/another piece is capturable for less compensation. *This will not perfectly match chess.com — it will flag most real sacrifices and occasionally over/under-fire.* That's acceptable and we label it honestly in the UI tooltip.
- **Great (!):** `evalBest − evalSecondBest` is large (e.g. the only move that holds; rank-2 drops you into a mistake/blunder). Computable directly from MultiPV.
- **Miss (✗):** `analyze(before)` showed a **winning** resource (mate-in-N, or win% ≥ ~80%, or wins material) and the played move's win% is materially lower while not itself crossing the blunder line. It's the "you had them and let them off" label.

We will document these as approximations in-product (a small "?" tooltip explaining the heuristic) rather than implying parity with a commercial product.

### 5.5 Book / opening detection (deferred — honest correction)

My first draft claimed `server/openings.mjs` could drive a "Book" label. **It can't:** that file is a 20-line *match-pairing suite* (fixed UCI sequences to balance bot-vs-bot games), not an opening book. Real book detection needs an ECO/opening dataset (thousands of lines) bundled and looked up by FEN.

So **Book is deferred to a nice-to-have.** Two honest options when we want it:
1. Embed a compact ECO table (name + FEN/position-hash) and label moves that match.
2. Skip the label entirely and instead simply **suppress harsh classifications for the first few moves** (don't flag a normal developing move as a "Mistake" just because SF prefers a 0.1cp-better theory move). This is cheaper and avoids shipping a dataset.

For the initial build we do option 2 (a `ply < N` softening), and leave true book naming for later.

### 5.6 Accuracy score (review mode)

For a finished/in-progress game, aggregate per-side: average win% loss → an **accuracy %** (Lichess uses `103.1668·exp(−0.04354·avgLoss) − 3.1669`, clamped 0–100). Plus counts per label. This is the headline number of the post-game review.

---

## 6. Hints, the best move, and explanations

### 6.1 The strongest move

Trivial once MultiPV exists: rank-1 of `analyze(currentFen)`. Show as SAN + eval ("**Nf5** +0.8") and, on request, an arrow (§7).

### 6.2 Tiered hints

Reveal progressively so the user does the work:

1. **Nudge** — *"There's a strong move here. Look at your knights."* (piece type of best move's origin)
2. **Region** — highlight the **from** square / piece to move.
3. **Direction** — draw the from-square with a faint arrow toward the target region.
4. **Full move** — best move arrow + SAN.

Levels 1–2 are heuristic text from the best move's features; 3–4 use board shapes.

### 6.3 Explanations — layered, honest

Two implementations behind one interface `explain(context) → string[]`:

**(A) Heuristic (always available, Phase D).** Generate bullet ideas from concrete, checkable features of the move and the engine's PV:

- *Tactical (reliable):* it's a check / capture / promotion; it wins material (material delta along the PV); it creates a fork/pin/discovered attack (detectable by mini-search: does it attack two pieces; is a higher piece behind); it threatens mate (PV ends in mate).
- *Positional (shallower):* develops a piece, castles, occupies an outpost, opens/controls a file, improves the worst-placed piece, creates a passed pawn.
- *From the engine's PV:* "the line continues 2…Bxf5 3.exf5 — White expects the bishop pair / a strong pawn on f5." Narrating the PV in SAN is honest and surprisingly illuminating.

This layer is bounded and transparent: it states *what the move does*, derived from search facts, never invents motives.

**(B) LLM commentary (optional, Phase E).** Feed the same structured facts (FEN, move, eval swing, top-3 PVs in SAN, detected motifs, phase of game) to Claude and ask for 1–2 sentences of human explanation, including *why the engine's move works* and *what plan it serves*. This is where "explain the engine's thought process" actually becomes good — the engine supplies ground truth (which move, how much better, the forcing line), and the LLM translates it into ideas and plans. Constraints we accept and surface:

- Requires `ANTHROPIC_API_KEY`, network, per-call latency (~1–3s) and cost.
- The LLM must be **anchored to engine facts** (pass the PV and evals; instruct it not to contradict them) to avoid confident chess nonsense — LLMs are weak at raw calculation but strong at narrating a line they're handed.
- Off by default; absence degrades gracefully to (A).

**Explaining the opponent's move** (your specific ask): when the opponent plays, run the same pipeline on *its* move from the *prior* position — classify it, and explain it with (A)/(B). Note the honest subtlety: a *weak* opponent's move may be objectively bad; the coach explains it against ground truth ("Maia played Bg4, a natural developing move, but it walks into h3–g4 winning the bishop"), which is itself a great teaching signal.

---

## 7. Frontend changes (all additive)

### 7.1 Board: arrows via `setAutoShapes` (verified API)

chessground supports arrows natively and — crucially — exposes them as a **separate layer** so the coach never collides with the board's own highlights. Verified against the installed package (`chessground/dist/draw.d.ts`, `api.d.ts`):

- `api.setAutoShapes(shapes: DrawShape[])` — **app-managed** shapes (our coach arrows). Replaced wholesale on each call, drawn *on top of* the existing last-move/check highlighting, and **independent** of the user's own arrows.
- `api.setShapes(...)` — the *user's* manual arrows (right-click drag). We leave these to the user.
- Enabling user drawing is one line in the initial config: `drawable: { enabled: true }`.

`DrawShape` shape (verified): `{ orig: Key, dest?: Key, brush?: string, label?: { text, fill? }, customSvg?, modifiers? }`.

- **Arrows:** `{ orig: "g1", dest: "f3", brush: "green" }`.
- **Square glyph:** `{ orig: "f3", label: { text: "!!" } }` — stamps the classification mark **directly on the move's destination square**, exactly like Lichess/chess.com. This is why classification needs no custom SVG to start.

Default brushes (verified in `state.js`): `green`, `red`, `blue`, `yellow`, plus pale variants `paleGreen`, `paleBlue`, `paleRed`, `paleGrey`. Our mapping:

| Use | Brush |
|---|---|
| Best move / good arrow | `green` |
| Threat against you / blunder mark | `red` |
| Alternative line / plan | `blue` |
| Hint nudge | `yellow` |
| Faint "region" hint | `paleBlue` |

Board prop change is minimal and additive: add `autoShapes?: DrawShape[]`, and in the existing update effect call `api.current?.setAutoShapes(autoShapes ?? [])`. Nothing else in `Board.tsx` changes; when the coach is off we pass `[]`.

### 7.2 Coach mode toggle + `CoachPanel` (self-contained)

A header toggle ("Coach") mirroring the eval-bar toggle, persisted in `localStorage` (`coach.enabled`). When **off**, the page is identical to today. When **on**, a `CoachPanel` appears as an *additional* card in the existing side column — it adds, it does not replace:

```
┌─ COACH ───────────────────────────────┐
│  Objective eval        +0.8  ▕███▏     │   ← coach's OWN eval (SF), with a
│                                         │     thin in-panel advantage bar.
│  ┌───────────────────────────────────┐ │     The left opponent eval bar is
│  │  ●!  Nf5  was Brilliant           │ │     untouched and stays as-is.
│  │  You sacrificed the knight but it │ │   ← last move: glyph + label +
│  │  forces mate in 4.                │ │     one-line explanation (heuristic
│  └───────────────────────────────────┘ │     or LLM).
│                                         │
│  Best move    Nf5  (+0.8)   [ Show ▸ ] │   ← reveals best-move arrow on board
│                                         │
│  [ 💡 Hint ]  [ ↶ Take back ]          │   ← Hint cycles tiers; Take back is
│                                         │     the ONLY mutating control.
└─────────────────────────────────────────┘
```

- **Classification colors** (panel chip + movelist glyph + on-board label): Brilliant `#26c2a3` teal, Great/Best `#5b8baf` blue, Excellent/Good `#9bbd6b` green, Inaccuracy `#e6a23c` amber, Mistake `#e08b4c` orange, Miss `#d08770` salmon, Blunder `#c05b5b` red. (Tuned to the existing palette in `index.css`.)
- **Talking:** the explanation line is the coach "talking." It updates each ply for the move just played — yours *or* the opponent's (so you get "Maia played Bg4 — natural, but it drops the bishop to h3-g4").
- **MoveList glyphs:** the existing `MoveList` gains an optional per-ply glyph (color-coded `??`, `?!`, `!`, `!!`, `★`). Additive prop; renders nothing when coach is off.

### 7.3 Takeback (the one mutation)

The single state-changing control. In `Play.tsx`, a `takeback()` that pops the engine reply + your move (`game.current.undo()` twice when it's your turn after an engine reply; once if mid-turn), resets `lastMove`, `info`, `pending`, and resyncs `fen`. Guard against taking back into the opponent's think or before move 1. No server involvement. The coach observes the resulting position like any other.

### 7.4 Review mode (post-game)

Reuses the arrow-key navigation already shipped. Adds: an **eval graph** (sparkline of win% over plies — `Sparkline` already in `ui.tsx`), per-move glyphs, accuracy% per side, and "jump to next mistake." Each ply's cached `analyze` result powers the per-position best-move arrow and explanation as you step. Fully additive — it's the coach data rendered over the existing nav.

### 7.5 Coach data flow (hook)

A `useCoach(fen, history, enabled)` hook owns the `/ws/coach` socket and an `analysisCache: Map<fen, PositionAnalysis>`. It returns `{ objectiveEval, bestMove, lastJudgment, judgments, hintLevel, nextHint(), autoShapes, explanation }`. `Play.tsx` stays thin: it renders `<CoachPanel {...coach} onTakeback={takeback} />` and passes `coach.autoShapes` to `<Board>`. All coach logic is isolated in the hook + `lib/coach.ts` (classification) + `lib/explain.ts` (heuristics) — none of it is entangled with the play/opponent code path.

### 7.6 New types

```ts
// lib/types.ts
export interface AnalysisLine { multipv: number; scoreCp?: number; mate?: number; depth: number; pv: string; uci: string; }
export interface PositionAnalysis { fen: string; lines: AnalysisLine[]; best: AnalysisLine; }
export type MoveClass = "best"|"brilliant"|"great"|"excellent"|"good"|"book"|"inaccuracy"|"mistake"|"miss"|"blunder";
export interface MoveJudgment { ply: number; san: string; uci: string; class: MoveClass; winLoss: number; bestUci: string; bestSan: string; explanation?: string[]; }
```

---

## 8. Feasibility, performance, and honest limits

- **Two engines at once.** Coach mode runs full-strength Stockfish *and* the opponent. On the M1 Pro this is fine *if scheduled*: analyze on the user's turn, cancel on commit (§4.2). Worst case (deep live analysis while opponent thinks) causes CPU contention and slower NPS for both — mitigated by capping coach live analysis to `movetime ~400–600ms` / `depth ~16–18`, and reserving deep `depth 20+` for on-demand review.
- **Latency vs. quality.** Live coaching wants snappy (sub-second) shallow-ish MultiPV; review can afford deep. Make depth/time a setting.
- **Caching.** One `analyze` per position, reused as both "after move N" and "before move N+1." A `Map<fen, PositionAnalysis>` keyed by FEN avoids recompute on takeback/navigation.
- **Brilliant/Great/Miss are approximations.** Stated plainly in §5.4 and surfaced in-product. We are not reverse-engineering a commercial product; we're building a transparent, tunable classifier on top of an objective engine.
- **LLM explanations are optional and bounded.** They need a key, network, and money, and must be anchored to engine facts to stay correct. The product is fully functional without them.
- **Scope discipline (the [12](12-the-platform.md) caveat, restated).** None of this is on the critical path to *beating* Stockfish — it's product polish on the playboard. Worth building because it makes the app genuinely useful and teaches chess, but it should be **built thin**: the server stays a MultiPV oracle, the client does the orchestration and labeling, and the hard NL layer is optional.

---

## 9. Phasing (recommended build order)

| Phase | Deliverable | Depends on |
|---|---|---|
| **A — Foundation** | MultiPV `analyze()` in `engine.mjs`; `/ws/coach` streaming service; objective eval-bar source toggle; "strongest move" display | — |
| **B — Core coaching** | Live move classification (best→blunder), MoveList glyphs, best-move + threat arrows, tiered hints, takeback, user-drawn arrows | A |
| **C — Review mode** | Post-game: eval graph, accuracy%, per-move glyphs, "next mistake," navigable with the existing arrow keys | A, B |
| **D — Heuristic explanations** | `explain()` heuristic layer: tactical (reliable) + positional (shallow) + PV narration, for your moves and the opponent's | A, B |
| **E — LLM explanations (optional)** | `/api/coach/explain` Claude layer behind `ANTHROPIC_API_KEY`; graceful fallback to D | D |

Phases A+B deliver the bulk of the requested coach (objective eval, classification, hints, best move, arrows, takeback). C is mostly UI over what A produces. D and E are the explanation ambition, isolated so they can slip without blocking the rest.

---

## 10. Files touched (and the proof it's additive)

| File | Change | Additive? |
|---|---|---|
| `server/engine.mjs` | **Add** `analyze()` + `multipv` case in `parseInfo` | Yes — `search()` untouched |
| `server/index.mjs` | **Add** `handleCoach(ws)` + route `/ws/coach` | Yes — `handlePlay` untouched |
| `web/src/components/Board.tsx` | **Add** `autoShapes?` prop + `drawable:{enabled:true}` | Yes — defaults to `[]`/no-op |
| `web/src/lib/types.ts` | **Add** analysis/judgment types | Yes — additions only |
| `web/src/lib/coach.ts` | **New** — win% + classification | New file |
| `web/src/lib/explain.ts` | **New** — heuristic explanations | New file |
| `web/src/hooks/useCoach.ts` | **New** — `/ws/coach` socket + cache | New file |
| `web/src/components/CoachPanel.tsx` | **New** — the panel UI | New file |
| `web/src/pages/Play.tsx` | **Add** coach toggle, render `<CoachPanel>`, pass `autoShapes` to Board, add `takeback()` | The only edited play file — gated entirely behind the toggle |
| `server/index.mjs` (LLM, Phase E) | **Add** `POST /api/coach/explain`, gated on `ANTHROPIC_API_KEY` | Yes — optional |

The acceptance test for "additive": with the coach toggle **off**, `Play.tsx` behaves byte-for-byte as it does today — same eval bar (opponent's), same flow, no extra engine process spawned, no arrows. Everything the coach does is gated behind the toggle and confined to new files plus the one narrow `autoShapes`/`onTakeback` contract.

Phase A is the unblocker and is low-risk: `engine.mjs` (`analyze`, `parseInfo`), `server/index.mjs` (`handleCoach`), the `useCoach` socket, and the coach's own objective-eval + strongest-move readout. Once that's visible, classification (B) is a small, self-contained module on top.
