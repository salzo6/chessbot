# 04 — Evaluation: Hand-Crafted & NNUE

*How an engine judges "who's winning?" in a non-terminal position. Search ([03](03-search-techniques.md)) explores the tree; evaluation scores the leaves. There's no clean formula for "who's winning in chess" — you either hand-write the rules or learn them. **Both are valid, and the hand-crafted path needs zero machine learning.***

---

## Part 1 — Hand-Crafted Evaluation (HCE): the zero-ML path

A human writes the scoring rules. This is how *every* engine worked until 2020, and **Stockfish 11 — the last fully hand-crafted Stockfish — was ~3400+ Elo** (superhuman; Magnus Carlsen ≈ 2882). A correct fast search + a decent HCE is a complete, strong engine with no data, no GPU, no training.

Typical HCE terms (each a tunable weight):
- **Material** — piece values (P=100, N≈320, B≈330, R≈500, Q≈900 as a starting point; bishop pair bonus).
- **Piece-square tables (PST)** — per-piece positional bonuses by square (knights love the center, etc.).
- **Pawn structure** — doubled/isolated/backward pawn penalties, passed-pawn bonuses (scaled by rank).
- **King safety** — pawn shield, attacker counts near the king, open files toward the king.
- **Mobility** — number of legal moves per piece.
- **Tapered eval** — interpolate between a *midgame* and *endgame* score by remaining material (a knight on the rim matters less in the endgame; the king becomes active).

**Tuning HCE:** **Texel's method** — logistic regression fitting the weights to game outcomes (minimize MSE between `σ(eval)` and result over millions of labeled quiet positions). Fast, deterministic, single-machine, no stronger engine needed. See [03](03-search-techniques.md) §H. This alone produces a genuinely strong engine.

**The recommended first build is exactly this:** bitboard core ([02](02-engine-architecture.md)) + the search suite ([03](03-search-techniques.md)) + a Texel-tuned HCE. Realistically ~2800–3400 Elo depending on search quality. NNUE is the *optional* next increment.

---

## Part 2 — NNUE (the learned eval that adds the last ~80–130 Elo)

NNUE ("Efficiently Updatable Neural Network," ƎUИИ) replaces the hand-written eval with a **small, integer-quantized net evaluated on CPU**, whose expensive first layer is **incrementally updated** as moves are made/unmade. It is **not an LLM** — no transformer, no text, no "reasoning"; it's a fitted scoring function with ~10M weights. Invented by Yu Nasu (2018, Shogi), ported to chess by Hisayori Noda ("Nodchip") in 2019, and shipped officially in Stockfish 12 (Sept 2020) for ~+80–130 Elo.

### The core idea — the accumulator
The input is an extremely **sparse** binary feature vector; a move changes only a few features. So the first layer's output (the **accumulator**) is stored as part of the position state and *edited* per move:
- Feature turned **off** → **subtract** that feature's weight column from the accumulator.
- Feature turned **on** → **add** that column.

A quiet move changes ~2 features, a capture ~3, castling ~4 — so instead of an M×N matrix-vector product you do ~2·M additions. **A king move forces a full refresh** (every feature is king-relative), cached via a "finny table." This is the literal meaning of "efficiently updatable," and why NNUE runs tens of millions of evals/sec on a CPU with no GPU.

### Feature sets (input encoding)
"**Half**" = features from one king's perspective at a time (the full input concatenates both kings' halves, board flipped for Black). "**K**" = king-relative (every feature conditioned on a king square, so king safety falls out).

| Set | Per-side dim | King encoding | Era |
|---|---|---|---|
| HalfKP | 40960/41024 | 64 king sq, non-king pieces | SF12 |
| HalfKA | 49152 | kings included | — |
| HalfKAv2 | 45056 | kings merged (11 piece states) | SF14 |
| **HalfKAv2_hm** | **22528** | **32** king buckets (horizontal mirror) | modern SF |
| + **Threat inputs** | (augmented) | piece-attacks-piece features | SFNNv10, SF18 |

**King-bucketing** reduces first-layer weights by treating king squares the net rarely needs to distinguish as equivalent; the cost is that king moves crossing a bucket boundary force a refresh. The horizontal-mirror "/2" roughly doubles effective training data.

### Architecture
- **Feature transformer** (the big first layer, ~1024 wide in modern SF, up to 3072 in some engines) — >99% of parameters.
- **Activations:** **Squared Clipped ReLU (SCReLU)** on the first-layer output (worth ~a 50% size increase vs plain ClippedReLU), ClippedReLU after later layers.
- **Two tiny dense layers** (≈16→32→1), replicated into **8 output buckets** selected by piece count.
- **Perspective nets:** two accumulators (White's and Black's), concatenated *side-to-move first* — lets the net learn tempo.
- **Dual net (modern SF):** a 1024-wide **big net** (+ threat inputs) for balanced positions, a 128-wide **small net** for lopsided-material positions, routed by a cheap material check.

### Quantization & SIMD (why it's CPU-fast)
- Feature transformer weights/accumulator: **int16** (scale 127). Dense weights: **int8** (scale 64). Biases/accumulation: **int32**. Output divisor `FV_SCALE=16`.
- Quantization error is negligible because the net is shallow. ClippedReLU keeps activations in int8 range.
- SIMD: AVX2 `maddubs+madd`, or one-instruction **VNNI** `vpdpbusd`. On **Apple Silicon, NEON `sdot`** (`vdotq_s32`, needs the dotprod extension, present on M1+). NEON registers are 128-bit (half AVX2) — ARM is somewhat slower for NNUE, but the AVX-512 width edge largely evaporates under multi-thread downclocking, so the real gap is modest. See [09](09-local-compute-apple-silicon.md).

### Training
- **Data:** records of `(position, engine_score, game_result)` from self-play at fixed depth (~depth 9), with randomized openings. Modern SF nets train largely on **Leela-generated data** converted to **`.binpack`** (delta-encoded, whole games contiguous; needs a filter to drop in-check/capture/early positions). Scale: SF datagen targets ~18B positions; SF18's net used 100B+.
- **Loss:** map centipawns to WDL via `sigmoid(cp / ~400)`; blend eval vs game result with a **lambda** (e.g. 0.75 = 75% eval / 25% result); MSE base, but SF found exponent **2.6** best.
- **Tools — two trainers:**
  - **nnue-pytorch** (official Stockfish; PyTorch + a fast C++ data loader; single NVIDIA GPU). Trains the official nets in "a couple of hours" on a GPU; nets mature ~400 epochs (competitive ~100).
  - **bullet** (Rust; the modern de-facto standard most new engines use). Backends: **`cuda`, `rocm`, and `metal` (macOS)** + CPU. MIT-licensed. A standard run is ~40 superbatches × ~100M positions.
- **End-to-end hobbyist result (documented):** ~500M self-play positions + bullet (arch `768→128×2 → 8 buckets`, SCReLU) → quantize → integrate → **+200 Elo over hand-crafted eval**. (Quantization constants commonly `QA=255`, `QB=64`.)

### Apple Silicon training note
You **can** train NNUE on a Mac without an Nvidia GPU via **`bullet --features metal`** (native, recommended) or nnue-pytorch on the PyTorch **MPS** backend (caveat: incomplete op coverage, `PYTORCH_ENABLE_MPS_FALLBACK=1`). But Metal-backend throughput vs CUDA is **unbenchmarked**, MPS is experimental, and CPU-only is impractical. For a serious training run, **rent a cloud GPU** (RunPod is the chosen provider here — existing credit; RTX 4090 ~$0.20–0.69/hr; hours, not days). *Inference* runs great on the Mac via NEON. See [09](09-local-compute-apple-silicon.md).

### NNUE vs Leela's deep nets
| | Stockfish NNUE | Leela |
|---|---|---|
| Net | shallow, ~1024-wide, int8/int16, **incremental** | deep transformer, ~100–191M params |
| Hardware | **CPU**, no batching | **GPU**, batched |
| Search | alpha-beta | MCTS |

Despite Leela's vastly larger net, Stockfish leads on equal hardware because alpha-beta evaluates far more positions/sec — **in this paradigm, raw speed beats per-node brilliance.** See [05](05-neural-and-rl-engines.md).

---

## Key takeaways for this project
1. **Build HCE first.** It's the cake (~3400 Elo ceiling), needs no ML, and is the right way to validate the whole engine before adding complexity.
2. **NNUE is the optional cherry** (~+80–200 Elo over HCE), a tiny CPU net, trainable in hours on a rented GPU. It is the proven path to "genuinely strong," and is exactly how Stockfish itself works today.
3. **Neither HCE nor NNUE will, by itself, beat full Stockfish** — Stockfish has both, better-tuned. Beating it needs a *different* source of strength ([07](07-frontier-and-novel-approaches.md)).

---

### Confidence notes
- **Firm:** the accumulator/incremental-update mechanism, feature-set evolution, quantization scheme, the two trainers (nnue-pytorch, bullet), the HCE→3400-Elo and NNUE→+80–130 Elo facts.
- **Approximate:** exact L1 widths per net version, the "+200 Elo over HCE" hobbyist figure (one documented case), per-engine king-bucket counts (check headers).
- **Unverified / community-level:** GPU training-throughput numbers (epochs/hour) live on Discord, not indexed pages; bullet's Metal-backend speed vs CUDA is unbenchmarked; SFNNv10 threat-feature exact dimensionality is in PDFs that weren't extractable.
