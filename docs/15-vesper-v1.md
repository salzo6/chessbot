# 15 — Vesper v1: The First Engine

*Where every document before this one is research — how the strong engines work
and where an edge might be — this one marks the moment the project stopped
reading and started building. **Vesper** ([named here](14-the-name.md)) is the
first real engine: written from scratch, playing legal chess, strong enough to
matter, and wired into the [platform](12-the-platform.md). It is the baseline
that every later version must beat.*

*Status: **built and integrated.** Source lives at [`app/vesper/`](../app/vesper);
registered as the bot `vesper`. This doc is the honest record of what it is, how
it was validated, and how strong it actually is.*

---

## 0. What Vesper v1 is (and isn't)

**Is:** a complete, from-scratch *classical* chess engine — its own move
generator, its own search, its own hand-crafted evaluation, speaking UCI. It does
not wrap Stockfish and does not use chess.js in its hot loop.

**Isn't:** an NNUE engine, and not yet a Stockfish-beater. It is deliberately the
strongest *clean classical* engine the project could write in one pass — alpha-
beta + a hand-crafted eval — so that the harder work (a trained neural eval) has
a clear, measurable baseline to improve on. This is the staged plan from
[`docs/11`](11-roadmap-and-strategy.md): get a correct, strong, well-instrumented
classical engine first; only then reach for NNUE.

## 1. Architecture

A four-layer engine (~900 lines of dependency-free Node ESM):

- **Board** (`board.mjs`) — a **0x88** board representation. Incremental
  **Zobrist** hashing (two 32-bit halves). Full *legal* move generation including
  castling (with through-check rules), en passant, and under-promotions.
  make/unmake with a state stack, plus a null move. Attack detection by the
  "superpiece" method. (See [`docs/02`](02-engine-architecture.md) for the
  techniques; v1 uses 0x88 rather than bitboards — simpler and provably correct,
  with bitboards a known future optimization.)
- **Evaluation** (`eval.mjs`) — a **tapered hand-crafted eval** (HCE, per
  [`docs/04`](04-evaluation-hce-and-nnue.md)): material + piece-square tables
  (separate king middlegame/endgame tables interpolated by game phase), bishop
  pair, doubled / isolated / passed pawns, rooks on open & semi-open files, a
  pawn-shield king-safety term, and a tempo bonus. Returned side-to-move POV.
- **Search** (`search.mjs`) — iterative-deepening **PVS** alpha-beta (per
  [`docs/03`](03-search-techniques.md)) with: a transposition table, quiescence
  search (with check evasions and delta pruning), null-move pruning, late-move
  reductions, check extensions, mate-distance pruning, aspiration windows, and
  MVV-LVA + killer + history move ordering. Time / node / depth management.
- **UCI** (`vesper.mjs`) — the protocol front-end and the executable. Because it
  carries a `#!/usr/bin/env node` shebang, the platform spawns it exactly like a
  native engine binary; it is registered in `engines/manifest.json` and so shows
  up across Play, Arena, and the Leaderboard automatically.

## 2. Correctness — the non-negotiable gate

The platform adjudicates with chess.js, so **one illegal move is an instant
loss.** Two gates guard against that:

- **perft** (`perft.mjs`) reproduces published leaf-node counts *exactly* for the
  start position, **Kiwipete**, and four other standard positions (through depth
  4–5, e.g. Kiwipete depth 4 = 4,085,603). Exact perft over positions that
  exercise pins, en passant, castling and promotions means the move generator is
  correct.
- **selftest** (`selftest.mjs`) drives the real UCI binary: every move is
  validated by chess.js, full self-play games run to completion without hangs or
  illegal moves, and known tactics (mate-in-1, back-rank mate-in-2) are solved.

Both are green. Move generation runs at ~9M nps in perft; full search reaches
**depth ~11 in ~400 ms (~1M nps)** from the opening.

## 3. Strength — the honest version

Measured locally through the platform's match runner (fast TC). The numbers that
*look* best are the least trustworthy, so read this carefully:

| Opponent | Strength | Result for Vesper |
|---|---|---|
| Sunfish | ~1300, real minimax searcher | **+2 −0** (dominant) |
| Stockfish · 1600 / 2000 / 2500 | throttled via `UCI_LimitStrength` | **+8 −0** ⚠️ |
| Fruit 2.1 | ~2700, full strength | −2 (long, fought games, ~120 plies) |
| GNU Chess | ~2660, full strength | −2 (long, fought games) |

⚠️ **The 8–0 sweep of the throttled Stockfish rungs overstates Vesper's Elo.**
Stockfish's strength limiter is unreliable at blitz time controls — it plays far
below its nominal Elo — so beating "Stockfish 2500" here is *not* evidence of
2500 strength. The honest bounds come from the **full-strength** engines: clearly
above ~1300, clearly below ~2660, in competitive (not blown-out) games.

**Best honest estimate: ~2000–2300** on this hardware and time control. Pinning a
real number requires an [SPRT](08-testing-elo-iteration.md) at a longer TC
against calibrated opponents — six smoke-test games can't do it. The leaderboard
prior is seeded at 2000 and will be refined by real arena play.

This is exactly the right place for a v1: a legitimately strong classical engine,
correct and instrumented, with a clear ceiling to climb.

## 4. What v2 should attack (Elo-per-effort)

1. **Search tuning** — SEE-based capture ordering, better LMR/pruning schedules,
   aspiration tuning, TT replacement policy. Cheap, measurable gains.
2. **Eval tuning** — a tuned PeSTO-style table set; mobility and king-safety
   terms; texel-tuned weights.
3. **Speed** — bitboards / staged movegen / incremental eval to raise nps (more
   depth = more Elo).
4. **The big jump — NNUE** ([`docs/04`](04-evaluation-hce-and-nnue.md),
   [`docs/05`](05-neural-and-rl-engines.md)): replace the hand-crafted eval with a
   trained network. This is where the path toward Stockfish actually runs.

Every step gated by an SPRT regression vs. this build. v1 is the yardstick now.

---

> **Confidence / caveats.** Architecture and correctness claims are firm (perft is
> exact; selftest is green). Strength figures are **approximate** and from a small
> number of fast games — directionally reliable (beats ~1300, loses to ~2660+) but
> not a calibrated Elo. The "~2000–2300" estimate is a candid guess, not a
> measurement; treat the throttled-Stockfish results as unreliable per §3.
