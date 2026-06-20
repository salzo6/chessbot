# 05 — Neural & Reinforcement-Learning Engines

*The other paradigm: a large neural net (policy + value) guiding Monte-Carlo Tree Search, trained by self-play. This is the only approach that has ever beaten Stockfish — and understanding exactly when, how, and at what cost is essential to judging whether it (or a descendant) could do so on local hardware.*

---

## 1. AlphaZero (DeepMind, 2017–2018)

### Architecture
One network `f_θ(s) = (p, v)` outputs a move-probability vector `p` (**policy**) and a scalar position value `v ∈ [−1, +1]`.
- **Body:** a conv stem + **19 residual blocks, 256 filters** each (ResNet; AlphaGo Zero used a larger 40-block net — the chess AlphaZero net is the 19-block one).
- **Chess input:** an **8×8×119** plane stack (piece positions, 7 plies of history, repetition, castling, move count, side to move).
- **Policy head:** chess **8×8×73 = 4,672** move logits (illegal masked). **Value head:** → tanh scalar.

### Search — MCTS with PUCT
Each edge stores `{N, W, Q, P}`. Selection maximizes `Q(s,a) + U(s,a)` where
`U = c_puct · P(s,a) · √(Σ_b N(s,b)) / (1 + N(s,a))`.
- `c_puct ≈ 1.25` effectively (AlphaZero's log-growing form `log((ΣN + c_base + 1)/c_base) + c_init`, `c_base=19652`, `c_init=1.25`).
- **800 simulations/move** during training. Leaf eval = the net (no rollouts). Backup `N+=1; W+=v; Q=W/N`. **Virtual loss** desynchronizes parallel threads.
- **Dirichlet root noise** for exploration (training only): `P = (1−ε)p + ε·η`, `η ~ Dir(α)`, `ε=0.25`, **chess α=0.3**.
- **Temperature:** `τ=1` (sample ∝ visit counts) for the first 30 moves → opening diversity; `τ→0` (greedy) after. Match play always `τ→0`.

### Training (self-play RL from random init)
Policy target = MCTS visit distribution `π` (stronger than raw `p` — MCTS is the policy-improvement operator); value target = game outcome `z`. Loss `l = (z−v)² − πᵀlog p + c‖θ‖²`. **AlphaZero (vs AlphaGo Zero) drops the gating match** — one continuously-updated net, higher throughput.

### Results vs Stockfish — and the criticisms
- **2017:** vs **Stockfish 8**, 28 W / 0 L / 72 D. But Stockfish ran with **1 GB hash, 64 threads, no opening book, no tablebases, fixed 1 min/move** — conditions its authors (Tord Romstad) called "apples to orangutans."
- **2018 (Science):** vs ~SF9-dev with 32 GB hash + tablebases + 3h+15s; AlphaZero +155 −6 =839, and still won giving Stockfish up to **10:1 time odds**.
- **Compute:** training used **5,000 first-gen TPUs** (self-play) + 64 TPUs (training); play used **4 TPUs**. AlphaZero evaluated ~80k positions/sec vs Stockfish's ~70M — ~1,500× fewer, compensated by net-guided selectivity.
- **What it proved:** a general self-play RL algorithm reaches top-engine-beating strength via MCTS over a learned net. **What it did NOT settle:** superiority over a *fully optimized* Stockfish on *equal* hardware. Never reproduced or released.

---

## 2. Leela Chess Zero (Lc0)

Open-source AlphaZero reproduction (started Jan 2018). **Distributed self-play:** volunteers donate GPU time to generate games; a central server trains and redistributes nets. MCTS + PUCT with enhancements: WDL value head, First Play Urgency, a **moves-left head**, batched leaf evaluation.

### TCEC record vs Stockfish (the real scoreboard)
| Season | Winner | Note |
|---|---|---|
| S14 (2018) | **Stockfish** | 50.5–49.5, closest ever |
| **S15 (2019)** | **Leela** | first NN engine to win a Superfinal |
| S16 | Stockfish | Leela missed the final |
| **S17 (2020)** | **Leela** | |
| **S18 → S28 (2020–2025)** | **Stockfish, 11 straight** | S28: 57.5–42.5 |

**The arc:** Leela briefly dethroned a *pre-NNUE* Stockfish (S15, S17). Once Stockfish adopted NNUE (SF12, 2020), the classical paradigm reasserted dominance and has held it since. Leela remains the clear #2 and only fundamentally-different top engine.

### Network evolution (CNN → transformer)
ResNet/SE-CNNs (peak T78, ~194M params) → **transformer "BT" series** treating the board as 64 tokens:

| Net | Params | Policy Elo vs T78 | Note |
|---|---|---|---|
| BT2 (2023) | 82M | +123 | introduced **smolgen** |
| BT3 | 105M | +179 | |
| BT4 (2024) | 191M | +270 | strongest; "Chessformer," ICLR 2026 |

**Smolgen** compresses 64 squares into a global vector to generate position-dependent attention — "plays as if 50% larger for ~10% throughput cost." Modern BT nets are increasingly trained by **supervised distillation** on accumulated self-play data, not pure RL.

### Hardware
Needs an Nvidia GPU for full strength (RTX 4090 ≈ 50 knps on a 512×20 net; CPU-only ≈ 1,000 nps, uncompetitive). On a Mac, runs via the **Metal** backend at superhuman strength (M4 Pro + BT4 ≈ 3692 CElo) but trails high-end Nvidia by ~an order of magnitude. See [09](09-local-compute-apple-silicon.md).

---

## 3. MCTS+NN vs alpha-beta+NNUE — the core comparison

| | Leela (MCTS + deep net) | Stockfish (alpha-beta + NNUE) |
|---|---|---|
| Nodes/sec | tens of thousands (GPU) | tens of millions (CPU) |
| Per-node quality | very high (deep net) | lower (shallow net) |
| Strong at | closed/strategic/long-term positional play, fortresses *they build* | sharp tactics, deep forced lines, exact calculation |
| Weak at | sharp deep tactics, fortresses *they must break* | very long-horizon quiet plans; *was* positional judgment (NNUE largely fixed this) |

The decisive fact for **equal/local hardware**: alpha-beta's raw node throughput currently outweighs MCTS's richer per-node eval. Beating Stockfish locally with an MCTS+NN engine requires either a much better net-per-FLOP or exploiting hardware Stockfish ignores (the idle GPU/Neural Engine). See [07](07-frontier-and-novel-approaches.md) and [09](09-local-compute-apple-silicon.md).

---

## 4. Self-play pipeline design (if you build an RL engine)

The AlphaZero loop is **policy iteration**: MCTS improves the policy; self-play evaluates it. Concretely:
1. **Self-play:** run MCTS (e.g. 800 sims) per move, store `(s, π, z)`; sample moves with temperature; resign below a tuned threshold (disable in 10% of games to bound false resigns).
2. **Train:** replay buffer (~1M positions / 500k games window), batch ~4096, SGD momentum 0.9, ~700k steps, LR `0.2→0.02→0.002→0.0002`.
3. **(Optionally) gate** a new net by a 55%-winrate match (AlphaGo Zero) — AlphaZero skips this.

### Leela's concrete pipeline (to build on or fine-tune)
Three repos: `lczero-client` (Go, self-play worker), `lczero-server` (distributes games/nets), **`lczero-training`** (Python/TF). Training data = fixed-length packed chunks (V6 = 8356 B/record; policy target = 1858 floats; 112 input planes). Config in `configs/example.yaml` (filters/blocks, LR boundaries, sliding window).

**The budget paths (do NOT cold-start):**
- **Warm-start / fine-tune** an existing Lc0 net: `tf/net_to_model.py weights.pb.gz` → checkpoint → resume `train.py`. Config must match the net's architecture.
- **Supervised / distillation from PGN:** `DanielUranga/trainingdata-tool` converts PGN (with Stockfish evals) → Lc0 chunks. (Historically flagged "may be broken" — verify against current lc0 submodules.)
- **Rescorer:** rewrite endgame results using Syzygy tablebases (distillation toward perfect endgames).

---

## 5. KataGo's efficiency innovations — the small-player playbook

KataGo matched/surpassed ELF OpenGo with ~**50× less compute** (~**1.4 GPU-years**: 27 V100s × 19 days). Its tricks, and which transfer to chess:

**Transfer directly to chess (highest value):**
- **Playout cap randomization:** do a *full* search (e.g. 600–1000 sims) on only ~25% of turns; a *fast* search (100–200) otherwise. Only full-search turns become policy targets. Decouples expensive policy targets from cheap value targets.
- **Forced playouts + policy-target pruning:** force a minimum visit count per root child for exploration, then prune those forced visits before forming the policy target so noise doesn't pollute it.
- **Global pooling:** inject whole-board summary statistics (king safety, passed pawns are global concepts CNNs miss).
- **Auxiliary heads:** opponent-move prediction, short-term value prediction (extra gradient signal per game → fewer games needed).
- **Opening randomization** for diversity; later: variance-scaled cPUCT, uncertainty-weighted playouts.

**Go-only (don't transfer):** ownership, score-distribution, komi, liberties/ladders. (Speculative chess analogs — per-square attack/control maps, centipawn-distribution heads — would be new designs.)

---

## 6. The MuZero family — learned models & low-sim search

- **MuZero (2019):** learns a *value-equivalent* model (representation + dynamics + prediction nets) and plans in latent space — no rules needed. Matches AlphaZero on chess/Go/shogi.
- **EfficientZero (2021):** self-supervised temporal consistency + value-prefix + off-policy correction → human-level Atari from ~2h of data (~500× more sample-efficient). The sample-efficiency reference.
- **Sampled MuZero:** samples K actions for huge/continuous action spaces.
- **Stochastic MuZero:** afterstates + chance nodes for random environments.
- **Gumbel MuZero / AlphaZero (2022) — the single most important low-compute lever:** Gumbel-Top-k sampling + Sequential Halving gives a **provable policy improvement with very few simulations** (even n=2 helps; no Dirichlet noise needed). Standard MCTS gives *no* improvement guarantee at tiny budgets. Implemented in DeepMind's **`mctx`** (JAX). *(Caveat: the "n=2 works" claim is contested — the independent MiniZero reproduction found very-low-simulation Gumbel slow to converge and often weakest, though competitive in some settings.)*

---

## 7. Distillation to a small CPU-runnable net — the proven budget result

- **Stockfish NNUE is itself distillation:** a small CPU net trained to predict a strong teacher's evals (now Leela's). ~+80–100 Elo, fully CPU-only. The most reliable budget path to a strong *local* engine.
- **Distilled Maia** (small net from maia1900): ~2200 Elo *with search*, but only ~1200 *searchless* — most positional *knowledge* transfers, but the student's ceiling still scales with its search budget.
- **General lesson:** distillation pays most when the teacher is much stronger/slower than the student; match the full action distribution, not just argmax.

---

## 8. Compute & cost reality

| System | Hardware | Volume | Note |
|---|---|---|---|
| AlphaZero | thousands of TPUs (5,000 gen-1 + 64 gen-2) | ~44M chess games | not retail-reproducible (no credible public $ figure) |
| KataGo | ~1.4 GPU-years | ~4.2M games | ~50× cheaper; "few thousand $" |
| Lc0 | distributed volunteers | >2.5B games cumulatively | now largely supervised on prior RL data |

**Cheapest routes to a strong (sub-Stockfish) net on a few rented GPUs:** warm-start/fine-tune an Lc0 net → Gumbel small-sim self-play polish (`mctx`) → add transferable KataGo tricks → **distill to NNUE** for the CPU-deployable artifact. Realistic single/few-GPU target: ~1500–2200 Elo from supervised/distillation; *from-scratch to Stockfish strength on one machine is not realistic.* Cloud GPU (2026): RTX 4090 ~$0.20–0.69/hr, A100 ~$1.07/hr, H100 ~$2–3.3/hr. For vectorized self-play on one GPU, **pgx + mctx (both JAX)** crush CPU-bound Python.

**Key open-source to build on:** `lc0` + `lczero-training`, `KataGo`, `mctx` (Gumbel/MuZero), `pgx` (GPU-vectorized envs), `LightZero` (unified MuZero variants), `alpha-zero-general` (clean learning start), `Zeta36/chess-alpha-zero`.

---

### Confidence notes
- **Firm:** the AlphaZero/Leela architectures and algorithms; the TCEC record; the KataGo/MuZero/Gumbel mechanisms; the distillation results; the warm-start tooling.
- **Approximate / secondary:** all AlphaZero Elo estimates (DeepMind published a curve, not a number); the 2018 Science figures (paywalled, via Chess.com/CPW); "~200 Elo / ~1,500×" Stockfish-vs-Leela multipliers; cloud prices (volatile spot snapshots).
- **Contested:** Gumbel "n=2 works" (paper yes, MiniZero no). The trainingdata-tool PGN path may need fixing against current lc0.
