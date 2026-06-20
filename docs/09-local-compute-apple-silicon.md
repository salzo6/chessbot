# 09 — Local Compute & Apple Silicon

*The goal is "beats Stockfish on a single local computer" — a MacBook Pro. This document covers what actually determines strength on one machine, how Stockfish/Leela behave on Apple Silicon, and the one structural asymmetry that a MacBook offers a challenger.*

> **The strategic conclusion up front:** you will **not** out-search Stockfish with another CPU alpha-beta engine on the same laptop — its NNUE+search is years of fishtest tuning and per-core SIMD work. The only two realistic local paths are (a) **exploit hardware Stockfish ignores** — the Apple GPU (Metal) and Neural Engine sit *completely idle* while Stockfish runs CPU-only — or (b) beat a **handicapped** Stockfish. Path (a) is the genuinely interesting bet and is unique to heterogeneous hardware like Apple Silicon.

---

## 1. What determines chess strength on one machine

**Alpha-beta engines (Stockfish) are CPU-bound.** Strength tracks nodes/sec:
- **Doubling nps ≈ +50–70 Elo ≈ one extra ply**, but it **decays** at the depths a strong engine already reaches (SF depth 20 vs 19 ≈ ~45 Elo per the official wiki, down from ~170 at low depths). On a *fixed* machine you're on the flat part of the curve — brute speed alone yields little.
- **Cores help with steep diminishing returns** (Lazy SMP): per-doubling Elo ≈ +91 (1→2), +81 (2→4), +66 (4→8), +49 (8→16); efficiency ~50% by 64 threads. 8 threads vs 1 ≈ +179 Elo LTC.
- **RAM/hash** matters only when undersized: keep `hashfull` < ~30%; 1 MB vs 64 MB ≈ **−48 Elo**.
- **SIMD** drives NNUE inference (quantized int8/int16 matmuls): AVX2 (256-bit), AVX-512/VNNI (512-bit) on x86; **NEON `SDOT`** (128-bit) on Apple Silicon.

**NN engines (Leela) are GPU-bound** — GPU throughput is everything; CPU/SIMD nearly irrelevant.

---

## 2. Stockfish on Apple Silicon

- **Build:** `make -j profile-build ARCH=apple-silicon` (sets `arm64, neon, dotprod, popcnt`). **Do NOT use the Homebrew binary** — it's a generic build, ~2× slower (~4.4 vs ~9.1 MN/s on M2).
- **Realistic NPS (NNUE, full machine):** **M1 Max ≈ 16 MN/s** (all cores); M2 base ≈ 9.1–9.3 MN/s. NNUE runs ~20% slower than classical on these chips. **No authoritative M3/M4 Stockfish bench exists in primary sources** — a circulating "~25 knps M3 Max" figure is a speculative Geekbench extrapolation, treat as unverified.
- **vs x86:** M1 Max (~16 MN/s) ≈ 8% faster than a mobile Ryzen 9 4900H. Per-core, modern x86 desktop (AVX-VNNI) still leads, but Apple is competitive and far ahead on perf-per-watt.
- **Does Stockfish exploit Apple hardware well?** *Partially.* It uses NEON + `SDOT` on the CPU cores. It does **NOT** use Apple's **AMX** matrix coprocessor or the **Neural Engine** — there's no path for either, and the ARM SIMD path got far less optimization than x86 ("a single patch a single developer wrote in a couple of days" vs years for x86). **This is the gap a challenger could exploit.**

---

## 3. Leela / Lc0 on Mac

- **Backend: Metal** (default macOS GPU backend since v0.29.0, Dec 2022) — faster than OpenCL; BT3/BT4 supported since v0.31.0. Historically no first-class Neural-Engine backend (the ANE feature request was closed "not planned") — though an experimental **ONNX-CoreML backend was merged in early 2026**, so CoreML is no longer entirely absent.
- **Strength:** runs at superhuman level for play/analysis (M1 + default net ≈ 3403 Elo; M4 Pro + BT4 ≈ 3692 CElo). But Apple GPU trails high-end Nvidia by **~an order of magnitude** for the largest nets, and is weak for training/self-play. `brew install lc0`, drop a `.pb.gz` net beside the binary.

---

## 4. Custom NN inference on Apple Silicon — the crux for a challenger

A chess search does **millions of batch-1 evaluations**, so *per-evaluation latency*, not peak throughput, is what matters. The four targets:

| Target | Access | Dispatch latency | Verdict for chess search |
|---|---|---|---|
| **CPU SIMD (NEON+dotprod)** | direct C/C++ | ~zero | **Best for NNUE-style small nets** (Stockfish's proven path) |
| **AMX coprocessor** | only via Accelerate (BLAS/BNNS) | near-zero (rides CPU instruction stream) | **Best Apple "accelerator" for small dense matmuls** (~2–3× NEON); underexploited |
| **GPU (Metal / MLX)** | Metal, MLX | ~1 ms/kernel launch | Only wins with **batched/fused** forward passes (e.g. MCTS leaf batching) |
| **Neural Engine (ANE)** | **CoreML only** | high per-dispatch | **Probably a trap** for batch-1 search |

- **The ANE is likely the wrong target:** reachable only via CoreML (you ship a `.mlpackage`; runtime decides ANE/GPU/CPU placement, "sometimes very random"; FP16-only; many ops force CPU fallback; high per-dispatch overhead kills batch-1 latency). TOPS: M1=11, M2/M3≈16–18, **M4=38**. Built for *batched* convolutional/vision throughput, not low-latency search.
- **AMX** (undocumented 32×32 MAC grid, Accelerate-only) has **near-zero dispatch latency** — the best Apple accelerator for tiny batch-1 matmuls, and genuinely underexploited by chess engines.
- **MLX** (Apple's array framework): true unified memory, op fusion; runs on CPU/GPU but **not ANE**; ~2× PyTorch-MPS on linear ops but an RTX 4090 is still ~3× an M2 Ultra.

**Recommendation for a custom net:** NNUE-style → **quantized CPU SIMD (NEON/dotprod)**, optionally **AMX via Accelerate** for larger dense layers — *not* the ANE. A larger policy/value net evaluated in **batches** (MCTS leaf batching) → the **Metal/MLX GPU path**, but you must fuse the whole forward pass into ~1 dispatch to amortize launch cost.

---

## 5. Training on Apple Silicon

- **PyTorch MPS** is officially "experimental" (2025–2026): incomplete op coverage (`PYTORCH_ENABLE_MPS_FALLBACK=1`), immature `torch.compile`, occasional silent correctness bugs.
- **Speed:** ResNet-50 training ~3× slower on M3/M4 Max than an RTX 4090. NNUE's `nnue-pytorch` is CUDA/ROCm-accelerated ("a couple of hours" on a GPU vs ~3 days/epoch CPU-only) — **GPU effectively mandatory**; no published M-series NNUE training time exists.
- **bullet** supports a native **`--features metal`** backend (recommended Mac route) but its throughput vs CUDA is **unbenchmarked**.
- **When to rent cloud GPU:** for any serious training run. **RunPod is the chosen provider for this project (existing credit).** 2026 prices: RTX 4090 ~$0.20–0.69/hr, A100 80GB ~$1.07/hr (~$0.60 spot), H100 ~$2–3.3/hr. **Use the Mac for prototyping/inference; rent for the training run.**

---

## 6. Strength-per-watt / strength-per-compute

- **Elo per compute-doubling ≈ 50–70, badly decaying** — on a fixed machine, brute speed barely moves the needle. The lever is **a better algorithm/eval**, not more nodes.
- **Apple wins decisively on perf-per-watt** (M3/M4 Max ~40–80 W vs ~450 W for a 4090) — relevant for always-on / long-match scenarios, not raw speed.
- **What squeezes max Elo from one laptop (priority order):** (1) better evaluation/search algorithm — the only real route to beating Stockfish locally; (2) maximize sustained nps (pin to performance cores, size hash right, avoid throttling); (3) more time/nodes per move (diminishing); (4) **never use MultiPV during play** (MultiPV 2 ≈ −97 Elo).

---

## 7. Practical settings on a MacBook Pro

- **Threads** = number of **performance cores** (e.g. 8 on M-Max), not the total including E-cores; macOS may mis-schedule onto slow E-cores. Don't over-thread (sublinear scaling).
- **Hash** set *after* Threads; keep `hashfull` < 30% (heuristic ~64 MB × threads × seconds-of-TC; 1–8 GB for long single-position analysis).
- **Thermal throttling is significant**, especially on the **14"** (measured ~24% sustained drop over 30 min on an M5 Max 14"; the 16" throttles less; the fanless Air throttles hard). For long matches: enable **High Power mode**, keep plugged in and cool, **prefer the 16"**, and budget for *sustained* (not burst) nps.

---

## 8. The structural asymmetry to exploit

Stockfish on a MacBook uses **only the CPU cores**. The **GPU (via Metal/MLX) and the Neural Engine sit idle.** A challenger that runs a CPU alpha-beta search *and simultaneously* uses the idle GPU/ANE — for a policy net to improve move ordering, a second evaluation, or an amortized-search component — would be using hardware Stockfish leaves on the table. This is the one concrete, local-hardware-specific edge a MacBook offers, and it connects directly to open question #6 in [07-frontier-and-novel-approaches.md](07-frontier-and-novel-approaches.md). Whether the latency/coordination cost can be made net-positive is unproven — but it is the most defensible place to look.

---

### Confidence notes
- **Highest-confidence anchor:** the official Stockfish "Useful data" wiki — the 8-threads-vs-1 (+179), hash (−48), MultiPV (−97), and depth-gain figures are wiki-verified. **Note:** the per-doubling thread figures (+91/+81/+66/+49) are forum-sourced (TalkChess, Stockfish 11 on a Threadripper 3990X), *not* the official wiki.
- **Firm:** the CPU-bound vs GPU-bound split; Stockfish not using AMX/ANE; Metal as Lc0's Mac backend; the ANE-via-CoreML constraints; MPS being experimental; cloud GPU as the training answer.
- **Forum/blog-sourced (indicative):** M1 Max ~16 MN/s, M2 ~9 MN/s, Homebrew ~2× slower, thermal-throttle percentages — user-submitted, hardware/version-specific.
- **Genuine data gaps:** no authoritative M3/M4 Stockfish bench; no clean Mac-vs-Nvidia Lc0 nps table on the same BT4 net; bullet Metal throughput unbenchmarked. One ANE-characterization source had a future-dated arXiv ID (flagged unverified).
