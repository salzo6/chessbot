# 07 — Frontier & Novel Approaches

> **This is the key document.** Everything else describes the known, mature world. This maps where a genuine **strength-per-compute** breakthrough — the only thing that could beat Stockfish on equal/local hardware — might come from. It is deliberately candid about low odds, because false hope wastes the effort of whoever builds from this foundation.

---

## 0. The problem, framed precisely

On a single consumer machine, the picture is stark:

- **The NNUE + alpha-beta cluster is tight.** On CCRL/CEGT (2024–2026) the top 5 engines fall within ~25–65 Elo, the top 8–10 within ~90 Elo, and #1 vs #2 (Stockfish vs Torch) is **single digits**. They all run the *same* paradigm: PV alpha-beta + aggressive pruning + a small, CPU-friendly, incrementally-updatable NNUE eval.
- **Leela (MCTS + deep net) is the lone different top approach — and it loses on equal terms.** Even at TCEC, where Leela is *given dedicated flagship GPUs Stockfish lacks* (S28: 8× RTX 5090 vs CPU), Stockfish won S28 **57.5–42.5**.

**The crux is strength-per-compute, not knowledge.** NNUE's incremental accumulator lets Stockfish evaluate ~1,500× more positions/sec on a CPU than a full forward pass of Leela's ~190M-param net, and deep alpha-beta doesn't miss long forced tactical lines where MCTS's averaging backups can. **So a local-hardware win requires genuinely better strength-per-FLOP — not "more chess knowledge."** That single sentence is the lens for everything below.

---

## 1. Transformer-based / searchless chess

**DeepMind, "Grandmaster-Level Chess Without Search" (2024)** — arXiv:2402.04494; NeurIPS 2024 ("Amortized Planning with Large-Scale Transformers"); [code](https://github.com/google-deepmind/searchless_chess).
- Encoder-only transformer, **supervised only, no search at inference**, up to **270M params**, trained on **ChessBench** (10M Lichess games annotated by Stockfish 16 → ~15B action-values).
- The famous **~2895 Lichess blitz Elo** is real but flattering (humans blunder under time pressure); its **vs-bot tournament Elo is only ~2299**.
- **It does NOT beat Stockfish.** A throttled Stockfish 16 oracle is ~400 Elo above it. It is fundamentally a *distillation of Stockfish* and cannot exceed its teacher. Fails on threefold repetition (no history in FEN) and is indecisive in won positions.
- **Scaling is monotonic but does not close the gap.** "Tracking vs. Deciding: The Dual-Capability Bottleneck in Searchless Chess Transformers" (arXiv:2603.29761, 2026) shows performance is bounded by `min(Tracking, Quality)` — naively filtering to only strong games *doubles* the illegal-move rate.

**Leela's transformers & Chessformer (ICLR 2026)** — Lc0 moved CNN→transformer (BT3/BT4) with the **smolgen** learned-attention module. "Chessformer" (arXiv:2605.19091) adds squares-as-tokens + a Geometric Attention Bias; claims **+100 Elo to Leela**, 57.1% human-move-match at <¼ the params, and "tournament victories over Stockfish."
- **Critical caveat (verified):** those Stockfish wins are the Chessformer net *running inside Lc0's MCTS on GPU-allocated competition hardware* — **not searchless, not equal local hardware**. As a *pure policy net* it does not beat Stockfish. A genuine net-quality advance; **not** a counterexample to the local-hardware problem.

**Do these nets implicitly "search"? Partly yes (in Leela's RL net).** "Evidence of Learned Look-Ahead in a Chess-Playing Neural Network" (Jenner et al., NeurIPS 2024, arXiv:2406.00877): a linear probe predicts the optimal move 2 turns ahead at 92%. Follow-ups (arXiv:2505.21552, 2508.21380) find context-dependent look-ahead up to ~7 moves. **Counterpoint:** "Transformers Struggle to Learn to Search" (arXiv:2412.04703) — they don't robustly learn *general* search. Tempers the hype.

---

## 2. Better self-play / RL (cheaper AlphaZero)

- **Gumbel AlphaZero** (Danihelka et al., ICLR 2022) — **the single most relevant technique for cutting MCTS cost.** Gumbel-Top-k + Sequential Halving *guarantees* policy improvement with very few simulations (robust sweet spot **n≈4–32** vs AlphaZero's 800). Implemented in `mctx`. *Caveat: literal n=2 is contested (MiniZero, arXiv:2310.11305, found low-simulation Gumbel often slowest to converge, though competitive in some settings).*
- **KataGo** (Wu, arXiv:1902.10565) — a *real, reproduced* ~50× compute reduction. Domain-independent tricks plausibly transfer to chess: **playout cap randomization, forced playouts + policy-target pruning, opponent-move auxiliary head, global pooling.** *Caveat: its single biggest speedup (ownership/score targets) is Go-specific — don't assume the full 50× transfers.*
- **MuZero** (arXiv:1911.08265) — learned model, matched AlphaZero in chess. A *capability* milestone, **not** a cheap-training method (same TPU scale).
- **EfficientZero / V2** (arXiv:2111.00210, 2403.00564) — extreme sample efficiency on Atari-100k. **But chess self-play isn't sample-limited the way Atari-100k is**, and neither was tested on chess. Transferable seed: the self-supervised temporal-consistency loss + off-policy value correction (plausible, unproven for chess).
- **Sampled / Stochastic MuZero** — solve huge/continuous action spaces and stochastic dynamics; **largely irrelevant to deterministic, small-action-space chess.**
- **"Search-contempt"** (Joshi, arXiv:2504.07757, 2025) — the most on-point recent paper: a hybrid MCTS that biases self-play toward *harder* positions, claiming an AlphaZero-like engine trainable for hundreds of thousands of games / tens of thousands of dollars, possibly on one consumer GPU. **Makes no direct Stockfish-beating claim; unverified preprint.**
- **Empirical floor:** a top Lc0 historically needed ~60M self-play games / ~$15k of GPU time — far above one local GPU for top strength.

---

## 3. Search innovations

- **Searchformer / Dualformer** (Meta, arXiv:2402.14083, 2410.09918) — a transformer that imitates then *improves on* A*'s search trace. **But: single-agent A* (mazes/Sokoban), not adversarial minimax, no chess.** Conceptual seed only.
- **DeepMind, "Mastering Board Games by External and Internal Planning with Language Models"** (arXiv:2412.12119) — **the most chess-relevant learned-search result:** an LM guides MCTS or generates a linearized search tree *in-context*, reaching grandmaster level at near-human search budget. Improves strength-*per-budget*; does **not** claim to beat Stockfish absolutely; MCTS-flavored, not alpha-beta.
- **Policy-guided alpha-beta — the specific "fuse Leela's policy net into alpha-beta" question.** Long lineage (Neural MoveMap, Kocsis et al. 2003; paradigm comparison, Maharaj et al., arXiv:2109.11602 — a Stockfish-vs-Leela study, not a general survey), but **no recognized engine uses a deep policy net inside alpha-beta to beat Stockfish-NNUE on equal hardware.** Structural reason: a heavyweight policy net per node is too slow for alpha-beta's NPS-hungry regime — which is *why* top engines reserve nets for cheap *evaluation*. A public Leela+Stockfish hybrid (`lc0-stockfish-hybrid`) that pruned Leela's MCTS with Stockfish **lost ~99/100 vs plain Leela** — naive fusion hurts.
- **MCTS ↔ minimax hybrids** (MCαβ, Baier & Winands 2014 — a non-arXiv paper; plus recent unbounded-minimax work, Cohen-Solal & Cazenave, arXiv:2505.04525) reliably *patch MCTS's tactical blind spots* but have **not surpassed top alpha-beta+NNUE.**

---

## 4. Better evaluation (NNUE and beyond)

- Current Stockfish NNUE: feature-transformer L1 grew 256→512→1024→2560→**3072** (SFNNv9); int16/int8, ClippedReLU, 8 buckets; **dual big/small net** since SF16.1; **SF18 (SFNNv10) added Threat Inputs** (+up to 46 Elo).
- **Modern Stockfish eval is essentially distilled Leela** — trained on billions of Lc0-evaluated positions since SF14; SF18 used 100B+. The GPU-trained Leela teacher feeds the CPU NNUE student.
- **Diminishing returns:** each L1 width increase yields smaller Elo and needs heavier SPSA tuning. **No source claims a fundamentally better *CPU-evaluable* architecture than NNUE exists today.** Transformer evals (arXiv:2409.12272) run well only on GPU and haven't beaten NNUE inside a CPU alpha-beta engine.
- **Where the residual frontier is alive:** richer relational/threat-native features (SF18's Threat Inputs prove this isn't exhausted), better distillation, smarter big/small-net switching.

---

## 5. The bitter lesson, read correctly for a small player

Sutton's "Bitter Lesson" (2019) says general methods leveraging **search + learning + compute** beat hand-coded knowledge. The honest chess-specific reading is **not "scale is all you need."** What actually wins on *local* hardware — Stockfish's NNUE — is **cleverness poured into making a scalable method run faster** (incremental, CPU-quantized, algorithm-aware design). That is the only defensible edge for a small player: **not** hand-written positional rules (wrong cleverness), **not** a giant slow net (loses strength-per-compute), but **better strength-per-FLOP.**

---

## 6. Exotic / unproven ideas (2024–2026)

- **DiffuSearch — "Implicit Search via Discrete Diffusion"** (Ye et al., ICLR 2025, arXiv:2502.19805) — **the most architecturally novel idea here:** a diffusion model plans *implicitly*, replacing explicit MCTS; claims +540 Elo over a one-step policy, +14% over MCTS. **But** benchmarked vs *neural* baselines, not as a Stockfish-killer; absolute strength far below engines. Promising, unproven.
- **LLMs + emergent world models:** the gpt-3.5-turbo-instruct ~1800-Elo anomaly; Othello-GPT; Karvonen's Chess-GPT (~1300 Elo, 99.2% board-probe). Interesting for *interpretability*; **none is close to engine strength.**
- **Neuro-symbolic** (Caïssa AI, 2025) — targets *explainability*, not strength.
- **Retrieval-augmented chess:** the only deployed, effective form is **Syzygy tablebases + opening books**, which Stockfish already uses. RL analogs unported. Speculative.
- **State-space models (Mamba):** theoretically handicapped for chess by the "illusion of state" (sequential state-tracking is exactly their weakness). Unpromising.

---

## 7. Honest assessment — where to actually aim

**Most promising (rough order):**
1. **Cheaper, better self-play to grow a custom NNUE/eval** — Gumbel few-sim search + KataGo's domain-independent tricks (+ maybe search-contempt). Attacks the real bottleneck (strength-per-compute + training cost) and stays on the winning paradigm. Plausible to **match** the cluster; **beating** a 100B-position-distilled, fishtest-tuned SF18 from a small base is the hard part.
2. **Squeezing more from NNUE-class eval** — richer threat/relational features, better distillation, smarter net switching. Incremental, but it's where Stockfish's own recent Elo comes from.
3. **Learned / amortized search** (DeepMind internal-planning LM, DiffuSearch, Searchformer lineage) — **highest ceiling, lowest probability.** If a model could amortize *more* search into a still-CPU-cheap forward pass, that would change strength-per-compute. Nothing today does this competitively, and "Transformers Struggle to Learn to Search" is a real warning.

**Likely dead ends for *local-hardware-beats-Stockfish*:** pure searchless transformers (distillation ceiling, ~400 Elo below SF); MCTS-on-CPU (Leela's paradigm loses on equal hardware); LLM/neuro-symbolic/Mamba strength engines; Stochastic/Sampled MuZero (wrong problem); deep-policy-net-per-node inside alpha-beta (too slow — the structural reason nobody's done it).

**Realistic probability:**
- *Matching* the top NNUE cluster on local hardware — **quite achievable** (methodology is commoditized).
- *Clearly, reproducibly beating current Stockfish on equal local hardware* — **candidly, low probability in the near term.** Stockfish is a fast-moving target backed by enormous distributed tuning and 100B+ positions of distilled Leela knowledge. The honest path to even a *chance* is an **algorithmic strength-per-compute edge**, not more knowledge or raw scale.

**Genuinely open research questions (the real targets):**
1. Can amortized/learned search (in-context tree search, diffusion planning) ever exceed alpha-beta+NNUE in **strength-per-CPU-second**, or is explicit search strictly more efficient on a CPU?
2. Is there a CPU-evaluable architecture **beyond NNUE** (relational/threat-native, sparse-attention) that beats it at equal NPS? (SF18's Threat Inputs suggest the feature frontier is alive.)
3. Do KataGo's efficiency gains + EfficientZero's consistency/value-correction losses actually cut chess self-play cost enough to train a top eval on **one consumer GPU**?
4. Can a deep policy net be made **cheap enough** (distilled/quantized) to improve alpha-beta move ordering net-positive on a CPU — the one fusion nobody has made work?
5. Why is MCTS so much weaker per-node than alpha-beta in tactical positions, and can a hybrid backup close that gap without paying MCTS's per-node cost?
6. **The local-hardware-specific bet:** can the idle Apple GPU / Neural Engine run a net (policy, eval, or amortized-search) *in parallel* with a CPU alpha-beta search, adding strength Stockfish leaves on the table because it uses only the CPU? (See [09](09-local-compute-apple-silicon.md) — this is the one structural asymmetry uniquely available on a MacBook.)

---

### Confidence notes
- **Firm:** the paradigm-cluster framing; the searchless-transformer ceiling vs Stockfish; the Chessformer "beats Stockfish = inside MCTS on GPU, not searchless/equal-hardware" clarification (explicitly verified); that no deep-policy-in-alpha-beta engine beats SF-NNUE; the NNUE-is-distilled-Leela fact.
- **Unverified / preprint:** search-contempt (2504.07757), DiffuSearch's Elo claims, the 2026-dated arXiv IDs (2603.29761, 2605.19091, 2604.05134) — recent, lightly reviewed; treat as directional.
- **Untraceable:** the "81,000 vs 4.1M PVS nodes to match 400 MCTS nodes" figure circulates without a primary source — illustrative only.
- **The probability judgments are the agents' and the author's reasoned estimates, not measured facts.**
