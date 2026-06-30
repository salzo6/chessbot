# Vesper

**Vesper 1.0** — a chess engine written from scratch for this project. It is the
first real engine on the climb described in the [`docs/`](../../docs) knowledge
base: not a wrapper around Stockfish or chess.js, but its own move generator,
search, and evaluation, speaking [UCI](https://www.chessprogramming.org/UCI) so
it plugs straight into the [platform](../README.md) (Play, Arena, Leaderboard).

> No NNUE yet. Vesper v1 is a strong *classical* engine — alpha-beta + a
> hand-crafted evaluation. It is deliberately the simplest thing that is also as
> strong as a clean classical engine gets, so later versions have a clear,
> measurable baseline to beat.

## Architecture

| Layer | File | What it does |
|------|------|--------------|
| Board | `board.mjs` | 0x88 board, incremental Zobrist hashing, attack detection, full legal move generation (castling, en passant, promotions), make/unmake, null move |
| Eval | `eval.mjs` | Tapered hand-crafted eval: material, piece-square tables, bishop pair, doubled/isolated/passed pawns, rook on open/semi-open files, pawn-shield king safety, tempo |
| Search | `search.mjs` | Iterative deepening, PVS alpha-beta, transposition table, quiescence (with check evasions), null-move pruning, late-move reductions, check extensions, MVV-LVA + killer + history ordering, aspiration windows, mate-distance pruning, time/node/depth management |
| UCI | `vesper.mjs` | The UCI front-end (the executable). `#!/usr/bin/env node`, so the platform spawns it like any other engine binary |

Scores are side-to-move POV (negamax convention); the host normalizes to White's
POV for display.

## Run it

```bash
# interactive UCI
node vesper.mjs
# then type:  uci / position startpos / go movetime 1000 / quit

# or as the executable the platform uses
./vesper.mjs
```

It's registered in [`../engines/manifest.json`](../engines/manifest.json) as the
bot `vesper`, so it already appears everywhere in the app.

## Tests

```bash
node perft.mjs        # move-generator correctness gate (must be green)
node selftest.mjs     # legality under real search + self-play + tactics
```

- **perft** matches published node counts exactly for startpos, Kiwipete, and
  four other standard positions (through depth 4–5) — the move generator is
  provably correct, so Vesper never plays an illegal move.
- **selftest** drives the real UCI binary: it confirms every move is legal
  (validated by chess.js, the same library the platform adjudicates with),
  plays full self-play games without hangs, and solves known tactics.

## Strength (honest)

Measured locally at fast time controls through the platform's match runner:

| Opponent | Result |
|---|---|
| Sunfish (~1300, real searcher) | **+2 −0** — dominant |
| Throttled Stockfish 1600 / 2000 / 2500 | **+8 −0** — but see caveat |
| Fruit 2.1 (~2700, full strength) | −2, long fought games (~120 plies) |
| GNU Chess (~2660, full strength) | −2, long fought games |

**Caveat:** Stockfish's `UCI_LimitStrength` is unreliable at blitz, so the 8–0
sweep of the throttled rungs *overstates* Vesper's Elo — do not read it as
"2500-strength." The trustworthy bounds are the full-strength engines: clearly
above ~1300, clearly below ~2660. Best honest estimate **~2000–2300** on this
hardware. A real number needs an [SPRT](../../docs/08-testing-elo-iteration.md)
at a longer time control. The leaderboard prior is seeded at 2000 and refined by
real arena games.

## What's next

The point of a clean classical v1 is a baseline. Likely v2 directions, in rough
order of Elo-per-effort: search tuning (better LMR/pruning, SEE-based capture
ordering, aspiration tuning), a tuned PeSTO-style eval, then the big jump —
an **NNUE** evaluation (see [`docs/04`](../../docs/04-evaluation-hce-and-nnue.md)
and [`docs/05`](../../docs/05-neural-and-rl-engines.md)). Each step should be
gated by an SPRT regression vs. this build.
