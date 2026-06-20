# 01 — How Stockfish Works

*The benchmark to beat. To beat Stockfish you must understand exactly what it does and why it is so strong on so little compute. Current as of **Stockfish 18** (released 31 Jan 2026).*

Stockfish is a **CPU-based alpha-beta searcher** exploring tens of millions of positions/second, guided by a small, integer-quantized **NNUE** neural network for evaluation. This combination — exhaustive heuristic search + a cheap, incrementally-updatable net — is fundamentally different from the AlphaZero/Leela approach (a large GPU net steering Monte-Carlo tree search), and it currently wins. Source root: [github.com/official-stockfish/Stockfish](https://github.com/official-stockfish/Stockfish) (GPL-3.0).

> **The headline facts that surprise people:** the classical hand-crafted evaluation was **fully removed** in Stockfish 16 (June 2023) — it's now 100% NNUE. **Killer moves were removed** in 2024. **Contempt was removed** in 2021. Stockfish continuously deletes "classic" techniques once they test Elo-neutral. Treat textbook descriptions of Stockfish as out of date.

---

## 1. Search

A multi-threaded **negamax alpha-beta** built as **Principal Variation Search (PVS)**, driven by **iterative deepening** with **aspiration windows**, backed by a **transposition table**, terminated by **quiescence search**. (`src/search.cpp`.)

- **PVS:** search the first (best-ordered) move with a full window; search every later move with a cheap **zero-window** scout `[-α-1, -α]` that merely proves "not better than what we have." Only a scout that beats α triggers a full re-search. With good ordering (first move best ~90% of the time), this saves ~10% over plain alpha-beta.
- **Iterative deepening:** search depth 1, 2, 3, … Each shallow pass is cheap and produces (a) good move ordering for the next pass (via the TT) and (b) a score to seed the aspiration window. This is what makes every other heuristic work.
- **Aspiration windows:** search the root in a narrow band around the previous score (start half-width ~5–20 cp); far more cutoffs. On a fail, widen only the failing bound, growing ~⅓ each time.
- **Transposition table:** Zobrist-keyed, clusters of **3 entries** padded to **32 bytes** (cache-line friendly); each `TTEntry` is **10 bytes**. Indexed by `mul_hi64` (no modulo, works for any table size). Depth-preferred replacement with generation aging (each stale generation ≈ 8 depth-points). Non-PV nodes can take an immediate **TT cutoff**.
- **Quiescence search:** at depth ≤ 0, resolve only tactical moves (captures, promotions, check evasions) until quiet, using a **stand-pat** bound, before handing the position to NNUE. Defeats the horizon effect.

Full catalogue of these techniques in [03-search-techniques.md](03-search-techniques.md).

---

## 2. Pruning, reductions, move ordering — why it searches so deep on so little

These drive the effective branching factor from ~35 down toward ~2, letting Stockfish reach 30–40+ plies where naive alpha-beta stalls at 8–10.

- **Null-move pruning:** give the opponent two moves in a row; if a reduced search still beats β, cut. Reduction `R = 7 + depth/3` (large). Disabled when the side has only pawns (zugzwang guard).
- **Late Move Reductions (LMR):** search late-ordered moves at reduced depth (`r ∝ ln(depth)·ln(moveNumber)`), modulated by node type and **history** (`r -= statScore·445/4096`). The flagship selectivity technique.
- **Reverse futility / razoring / move-count pruning:** skip or shortcut nodes whose static eval is hopelessly above/below the window.
- **History heuristics:** self-decaying "gravity" tables — ButterflyHistory, CaptureHistory, ContinuationHistory (1/2/3/4/6-ply), PawnHistory — so every cutoff sharpens the next search's ordering.
- **Move ordering pipeline (`MovePicker`):** TT move → good captures (MVV + capture history, split by **SEE**) → good quiets (by history) → bad captures → bad quiets. **No killer moves** since 2024.

**The positive-feedback loop:** good ordering → first move cuts off immediately → pruning collapses whole subtrees → history tables feed back into ordering. Compute is spent on a thin, deep spike along the principal variation, not a bushy tree.

---

## 3. Evaluation: NNUE (the whole eval since SF16)

NNUE ("Efficiently Updatable Neural Network") was invented by Yu Nasu (2018, for Shogi), ported to Stockfish in 2019, shipped in **SF12 (Sept 2020)** for ~+130 Elo. The classical eval was deleted in **SF16 (2023)** — its removal cost only ~2 Elo.

- **Inputs:** sparse, **king-relative** piece features (HalfKP → HalfKAv2_hm, king-bucketed + horizontally mirrored; SF18's SFNNv10 adds **threat inputs**).
- **Architecture:** sparse input → huge **feature transformer** (the accumulator, ~1024 wide, >99% of params) → squared-clipped-ReLU → two tiny dense layers → scalar, with **8 output buckets** by piece count. Since SF16.1 a **dual net** (big net + tiny 128-wide small net for lopsided positions).
- **Size:** ~10M params dominate the first layer; net files tens of MB.
- **Why fast on CPU ("efficiently updatable"):** the expensive first layer is **never recomputed** during search — a move flips only a few input features, so the accumulator is updated by adding/subtracting weight columns. Weights are **integer-quantized** (int16/int8) and run on **AVX2/AVX-512/VNNI** (and **NEON `sdot`** on Apple Silicon). One CPU core evaluates tens of millions of positions/sec, no GPU, no batching latency. **This is precisely why Stockfish beats GPU-net engines on equal hardware.**
- **Training:** PyTorch trainer (nnue-pytorch); modern nets trained on **100B+ positions, mostly Leela-generated data** converted to binpack. Deep dive in [04-evaluation-hce-and-nnue.md](04-evaluation-hce-and-nnue.md).

---

## 4. Hardware use

- **Lazy SMP** (since SF7, 2016): every thread searches the same root independently, coordinating *only* through the shared TT. No central scheduler. Thread **voting** picks the final move; NUMA-aware since 2024.
- **Scaling:** raw NPS ≈ linear with cores (~1 MNPS/core on AVX-512); *strength* scaling diminishes (8-thread ≈ 82% efficient; +179 Elo at 8 threads vs 1, LTC). Big gains 1→4 cores, small beyond ~16–32.
- **Hash:** UCI `Hash`, default 16 MB. Keep `hashfull` < ~30%; undersized hash costs real Elo (1 MB ≈ −48 Elo at LTC). Set `Hash` *after* `Threads`.
- **NPS:** ~1 MNPS/core; ~5 MN/s a typical 4-core desktop; ~16 MN/s on an M1 Max; 100M–1B+ on many-core servers. (NNUE roughly halves raw NPS vs old HCE but is far stronger — NPS alone ≠ strength.)
- **Syzygy tablebases:** WDL probed during search, DTZ at the root. Elo value has shrunk to ~0 with strong NNUE endgame play; now mainly for analysis correctness.

---

## 5. Current strength

- **#1 on every list.** There is **no single "Stockfish rating"** — it depends on the list, time control, and hardware, so always cite the list:
  - **CCRL 40/15, single-CPU ≈ 3650** (a common "general strength" figure)
  - **CCRL Blitz, single-CPU ≈ 3800** — *this is where numbers like "3807" come from*
  - **SP-CC (UHO) ≈ 3870**
  - **Multi-core / Chess960 (FRC) lists ≈ 4000–4060+**
  - On CCRL 40/15 it leads Torch (~3636), Komodo Dragon (~3627), Obsidian (~3618), Berserk (~3616), Caissa (~3610). Leela sits far down on CCRL *only because CCRL is CPU-only* and Leela is GPU-oriented. **For this project the only number that matters is Stockfish on the *same local machine*, head-to-head — not any list figure.**
- **TCEC dominance:** Stockfish has won **every Superfinal from Season 18 (2020) through Season 28 (Sept 2025)** — 11 consecutive, its 18th title. S28 vs Leela: **57.5–42.5**. At comparable TCEC conditions (May 2025) the SF–Leela gap was ~**34 Elo** (3733 vs 3699); at fast time controls it widens to ~**200 Elo**.

---

## 6. Known weaknesses (where it *can* be beaten)

These are relative — no engine reliably beats Stockfish in a match today — but they're where any edge lives:

- **Closed / positional play vs Leela.** In locked, maneuvering positions (Hedgehog, Closed Ruy Lopez) Stockfish's search edge shrinks and pattern-based NN eval does relatively better.
- **Fortress / dead-draw recognition.** Alpha-beta cannot evaluate a fortress by search alone; Stockfish could shuffle for hundreds of moves. **SF18 explicitly shipped "enhanced stalemate and fortress detection"** (Correction History) — materially reduced, not eliminated.
- **Long-term planning horizon.** NNUE eval is static; very slow, counter-intuitive plans paying off ~15 moves later can be missed in favor of what's calculable now.
- **Shortest-mate / composed endgames** without tablebases.
- **Non-determinism.** Lazy SMP makes multi-threaded move choice non-deterministic run-to-run.

The strategic reading: Stockfish's strength is **search**, not a single forward-pass policy net, so it lacks the failure mode that adversarial attacks exploited in Go's KataGo. Its weaknesses are *evaluation* errors that mostly yield *draws*, not exploitable *losses* — and they are being actively patched. See [07-frontier-and-novel-approaches.md](07-frontier-and-novel-approaches.md) for whether any of this is exploitable for *consistent* wins.

---

## 7. Build & configuration (practical)

- **License:** GPL-3.0-or-later. Code, networks, and the nnue-pytorch trainer are all open. **Copying Stockfish code makes your engine GPLv3** (enforced — see the ChessBase/Fat Fritz 2 settlement in [06-engine-landscape.md](06-engine-landscape.md)).
- **Build:** `make -j profile-build ARCH=native` (PGO recommended). On Apple Silicon use `ARCH=apple-silicon` (enables NEON + dotprod) — **not** the generic Homebrew binary, which is ~2× slower. See [09-local-compute-apple-silicon.md](09-local-compute-apple-silicon.md).
- **Key UCI options:** `Hash` (16 MB default), `Threads` (1), `MultiPV` (1 — raising it costs strength), `SyzygyPath`, `UCI_LimitStrength`+`UCI_Elo` (1320–3190, for calibration), `Move Overhead` (10 ms). **No Contempt** option exists anymore.

---

### Confidence notes
- **High confidence (source + primary docs):** all algorithmic structure, the NNUE efficiency story, removal of HCE/killers/contempt, SF18 release facts, TCEC results, build/UCI options.
- **Approximate / drifting:** exact tuning constants (re-read from `master` per release — `R = 7 + depth/3`, the `445/4096` LMR term, etc. change commit-to-commit); CCRL Elo digits (rankings firm, exact numbers move as lists regenerate); net L1 width per version.
- Some "high-4000 CCRL" figures circulating in early 2026 are actually **Fischer-Random (FRC)** list numbers, not standard chess.
