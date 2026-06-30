# chessbot — Research Foundation

> **Mission:** lay the complete research groundwork for an attempt at something that has **never been done** — a chess engine that **beats Stockfish while running on a single local computer** (a MacBook Pro), on equal hardware.

This repository is **not** an engine (yet). It is a **knowledge base**: an exhaustive, heavily-sourced map of how the strongest chess engines work, every known approach to building one, the frontier of where a genuine breakthrough could come from, and the infrastructure needed to build, test, rate, and iterate on a bot. It is written so that a future, more capable model (or a human team) can pick it up cold and start building from a solid, honest foundation.

It was compiled from a large fan-out of dedicated research agents (June 2026), each of which adversarially verified its own claims against primary sources (the Stockfish source, the Chess Programming Wiki, arXiv, TCEC/CCRL data, engine repos). Source URLs are preserved throughout, and every document ends with explicit **confidence/caveat notes** flagging which numbers are firm and which are approximate or community-sourced.

---

## The one-paragraph honest truth

A bot that "always plays the perfect move" is **physically impossible** — chess has ~4.8×10⁴⁴ legal positions and ~10¹²⁰ possible games; brute force would consume the entire computational budget of the universe, and quantum computing only square-roots that (still impossible). Chess is **solved only for ≤7-piece endgames** (tablebases). Every engine, Stockfish included, plays *extremely strong heuristic guesses*, never provably perfect moves. **Beating Stockfish** is the real, frontier-level goal — and on **equal hardware** it has essentially never been done by a small player: every top engine clusters within ~50 Elo using the *same* paradigm (alpha-beta + NNUE), and Leela (the one different approach) loses to Stockfish on equal terms. This is a genuine open problem. The value of this repo is to map exactly where, if anywhere, an edge could be found — and to be candid about the odds. See **[docs/00-the-honest-reality.md](docs/00-the-honest-reality.md)** first.

---

## How to navigate

Read in order for a full grounding, or jump to what you need.

| # | Document | What it covers |
|---|----------|----------------|
| 00 | [The Honest Reality](docs/00-the-honest-reality.md) | Theoretical limits, what "solving" vs "beating" means, what is and isn't achievable, the precise framing of the goal |
| 01 | [How Stockfish Works](docs/01-how-stockfish-works.md) | The benchmark to beat: search, NNUE, Lazy SMP, hardware, current strength, known weaknesses |
| 02 | [Engine Architecture & Core Engineering](docs/02-engine-architecture.md) | Bitboards, magic move generation, make/unmake, Zobrist, transposition tables, perft, performance |
| 03 | [Search Techniques](docs/03-search-techniques.md) | The full catalogue: alpha-beta, PVS, pruning, reductions, extensions, quiescence, tuning |
| 04 | [Evaluation: Hand-Crafted & NNUE](docs/04-evaluation-hce-and-nnue.md) | How an engine judges a position; classical eval; NNUE architecture, training, quantization, inference |
| 05 | [Neural & Reinforcement-Learning Engines](docs/05-neural-and-rl-engines.md) | AlphaZero, Leela, MCTS/PUCT, self-play pipelines, MuZero family, KataGo efficiency, distillation |
| 06 | [The Engine Landscape](docs/06-engine-landscape.md) | Every strong engine besides Stockfish, what's open source, what's reusable, licensing landmines |
| 07 | [Frontier & Novel Approaches](docs/07-frontier-and-novel-approaches.md) | **The key document:** where a genuine strength-per-compute breakthrough could come from |
| 08 | [Testing, Elo & Iteration](docs/08-testing-elo-iteration.md) | UCI, match runners, SPRT, Elo computation, opening suites, rating lists, calibration ladders |
| 09 | [Local Compute & Apple Silicon](docs/09-local-compute-apple-silicon.md) | Running/optimizing on a MacBook Pro; CPU/GPU/ANE/AMX; what actually determines strength on one machine |
| 10 | [Supporting Systems](docs/10-supporting-systems.md) | Opening books, endgame tablebases, time management, multithreading, deployment, Lichess bots |
| 11 | [Roadmap & Strategy](docs/11-roadmap-and-strategy.md) | The synthesis: concrete phased plans, decision points, and how a future builder should approach this |
| 12 | [The Platform](docs/12-the-platform.md) | The interactive layer: download bots, play against them, pit bot-vs-bot, anchored Elo leaderboard — and the decision to build it *first* |
| — | [References](docs/references.md) | Consolidated bibliography of primary sources |

---

## The central question this repo exists to answer

> On a fixed local machine, virtually all top engines are within ~50 Elo of each other because they all run **alpha-beta + NNUE**, and that paradigm is mature and exhaustively tuned. Beating Stockfish on equal hardware therefore requires a genuinely **better strength-per-compute** — a different algorithm, a different use of the idle GPU/Neural Engine, or a learned component that does more per node. **Does such an edge exist, and if so, where?**

Document 07 is the map of candidate answers. Document 11 turns it into a plan. Everything else is the grounding needed to evaluate those answers competently.

---

## Status

- [x] Research foundation compiled (13 deep-research reports, June 2026) and fact-checked against primary sources
- [x] All documents written (00–11 + references) and corrected
- [ ] No engine code written yet — this is intentional; the foundation comes first

## Build approach (decided)

**Step 0 — build the platform first ([docs/12](docs/12-the-platform.md)).** Before any self-made engine, stand up the interactive layer: download real bots (Stockfish + a ladder), play against them on a board, pit two bots against each other, and rank them on an anchored Elo leaderboard. This deliberately *prepends* the engine-first sequence below — the rationale is to internalize and de-risk the build→measure→matchmake→iterate loop on known-good engines before investing weeks in a core. (Honest caveat, accepted: the platform is off the critical path to beating Stockfish, and the match/Elo machinery is a solved problem — so build it thin and reuse off-the-shelf tools.)

Then the engine sequence is fixed (see [docs/11](docs/11-roadmap-and-strategy.md)):
1. **Build an algorithm-only engine first** — pure search + hand-crafted evaluation, zero machine learning, ~3000–3400 Elo. Runs entirely on the local MacBook.
2. **Master the full loop end-to-end** — play it against Stockfish and a ladder of other bots, compute its Elo, watch it play, iterate. Get fluent at *building → measuring → matchmaking → iterating* before adding any complexity.
3. **Only then, training** — an NNUE net trained on a rented RunPod GPU (existing credit), deliberately gated behind a working, *measured* algorithm-only engine. Training is pointless until you can reliably measure whether it helped.

The honest moonshot (beating full Stockfish on equal local hardware) is a later, low-odds research bet ([docs/07](docs/07-frontier-and-novel-approaches.md)) — pursued only after the fundamentals above are solid.

## A note on sources and dates

All strength numbers, version facts (e.g. **Stockfish 18**, released 31 Jan 2026), and architectural details are current as of mid-2026 and cite primary sources. Engine development moves fast and tuning constants drift commit-to-commit; treat exact constants as starting points to re-verify, and the *structure/ideas* as the durable content. Each document flags its own uncertainties.
