# 11 — Roadmap & Strategy

*The synthesis. Everything else is grounding; this is how a future builder should actually approach the goal — phased, measurable, honest about where the wall is and where the one real opening is.*

---

## 1. The strategic situation in three sentences

1. A correct alpha-beta engine + a trained NNUE eval reaches the **top-50 cluster** (~3500+ Elo) using a now-commoditized methodology — achievable, but it *matches* Stockfish, doesn't beat it.
2. Beating **full Stockfish on equal local hardware** requires a genuinely better **strength-per-compute**, which essentially nobody outside the frontier has — the honest near-term probability is **low**.
3. The single most defensible place to look for that edge on a **MacBook** is the structural asymmetry that **Stockfish uses only the CPU while the GPU and Neural Engine sit idle** ([09](09-local-compute-apple-silicon.md) §8, open question #6 in [07](07-frontier-and-novel-approaches.md)).

---

## 2. Phased build plan

Each phase produces a **measurable artifact** and is gated by the testing harness ([08](08-testing-elo-iteration.md)). Do not skip the harness — without SPRT/Elo you are flying blind.

> **Sequencing principle (decided for this project):** *Master the full algorithm-only loop end-to-end before touching any training.* That means: build a no-ML engine (Phases 0–2), play it against Stockfish and a ladder of other bots, get its Elo, and watch it actually play — until the entire workflow of *building → measuring → matchmaking → iterating* is second nature. **Training (Phase 3) is deliberately gated behind a working, measured, algorithm-only engine.** Rationale: training is pointless if you can't yet reliably measure whether it helped, and the algorithm-only engine is already superhuman (~3000–3400) — more than enough to learn the loop against. GPU budget is available (RunPod, existing credit), so Phase 3 is a *when-ready* step, not a *blocked* one.

### Phase 0 — The measuring instrument (days)
- Install **fastchess** + **Stockfish** (`ARCH=apple-silicon` build) + **Ordo**.
- Build a calibration ladder: throttled Stockfish (`UCI_Elo` 1320–3190; fixed `nodes`/`depth` for below 1320), **Stash** versions (~2000→3500), **Maia** (human-like 1100–1900).
- Grab **UHO** opening suites. Wire up **python-chess** to orchestrate matches.
- **Deliverable:** you can take any UCI engine and produce an Elo with error bars and an SPRT verdict.

### Phase 1 — Correct, fast core (weeks) — *pure algorithm, no ML*
- Bitboards + magic movegen + make/unmake + Zobrist + TT ([02](02-engine-architecture.md)).
- **Pass perft on all six test positions** — the correctness gate.
- Alpha-beta + iterative deepening + PVS + quiescence + TT cutoffs + MVV-LVA ([03](03-search-techniques.md)).
- A simple material + PST evaluation.
- **Deliverable:** a UCI engine that reliably beats SF@1500. **Decision point — language:** prototype in Python (python-chess) to validate design fast, but the strength-bearing core should be **Rust or C++** (Python's slow NPS caps strength ~2000). Rust is the recommended default: near-C++ speed, memory-safe, now elite-competitive (Viridithas, akimbo), MIT-friendly references to learn from.

### Phase 2 — Strong search (weeks) — *still no ML*
- Add the full pruning/reduction suite: null-move, LMR, RFP, futility, razoring, LMP, SEE pruning, singular extensions, history family ([03](03-search-techniques.md)).
- Texel-tune the hand-crafted eval ([04](04-evaluation-hce-and-nnue.md) Part 1).
- **Deliverable:** ~2800–3400 Elo (superhuman); beats SF@2000–2200. This is already a serious engine with zero machine learning.

### Phase 3 — Learned evaluation (weeks, + a rented GPU)
- Train an **NNUE** net (the **bullet** trainer on **RunPod** — existing GPU credit; an RTX 4090 for a few hours, ~$5–20) on self-play and/or distilled Leela/Stockfish data ([04](04-evaluation-hce-and-nnue.md) Part 2). Run/inference happens back on the Mac via NEON.
- Integrate incremental accumulator updates; quantize; SPRT-test.
- **Deliverable:** ~3400–3500+ Elo; challenges SF@2500. Now in the top-50 cluster — i.e. *matching* the frontier paradigm.

### Phase 4 — The actual research bet (open-ended)
This is where you stop following the known recipe and attack the open problem. Pick **one** hypothesis and test it rigorously against the Phase-3 baseline with SPRT. Candidates, in rough order of promise ([07](07-frontier-and-novel-approaches.md) §7):
1. **Cheaper/better self-play eval** — Gumbel few-sim search (`mctx`) + KataGo's domain-independent tricks to train a better-than-baseline NNUE on one GPU.
2. **Richer CPU-evaluable eval** — threat/relational-native features beyond NNUE at equal NPS (SF18's Threat Inputs prove the feature frontier is alive).
3. **The MacBook asymmetry** — run a cheap policy/eval net on the idle **Apple GPU/ANE in parallel** with the CPU alpha-beta search (better move ordering, a second eval, or an amortized-search component). Latency/coordination must be net-positive — unproven, but the one structural edge unique to local heterogeneous hardware.
4. **Amortized/learned search** — highest ceiling, lowest probability; only pursue if 1–3 stall and you have a concrete mechanism.

**Gate every Phase-4 idea the same way:** does it beat the Phase-3 engine in an SPRT match on the *same laptop*? If not, it's not progress, no matter how clever it sounds.

---

## 3. Decision points a future builder must make

| Decision | Recommendation | Why |
|---|---|---|
| Language for the core | **Rust** (prototype harness/glue in Python) | Near-C++ speed, memory-safe, elite-competitive, MIT references to copy from |
| HCE first or jump to NNUE? | **HCE first** | Validates the whole engine; ~3400 ceiling with no ML; NNUE is a clean drop-in later |
| Train locally or rent? | **Rent cloud GPU (RunPod) for training; run on Mac** | No CUDA on Mac; NNUE inference is great on NEON; training needs a few GPU-hours; RunPod credit already available |
| Copy code from Stockfish? | **No (unless you accept GPLv3)** | Copying GPL makes your engine GPL; copy *ideas* from SF, *code* only from MIT engines (Viridithas, Caissa, Fathom) |
| Target full SF or throttled SF? | **Define a bounded, measurable target** | "Beat SF@2500 >55%" is achievable and provable; "beat full SF18" is the open moonshot — pursue in Phase 4 with eyes open |
| MCTS+NN or alpha-beta+NNUE? | **Alpha-beta+NNUE** as the baseline | Wins on equal local hardware; MCTS-on-CPU loses. Reserve MCTS/NN ideas for the Phase-4 GPU-asymmetry bet |

---

## 4. What "success" should mean

Be precise, because vague goals produce motion without progress:

- **Minimum success:** an engine that *matches* the top cluster on a MacBook (top-50, ~3500 Elo) — fully achievable, a real accomplishment.
- **Defined win:** consistently beats Stockfish throttled to a fixed strength (e.g. SF@2500) by a measured margin — achievable, well-defined.
- **The moonshot (never done):** consistently beats full-strength Stockfish 18 on equal local hardware with a higher rating — the open problem this repo exists to attack. Treat it as a *research bet with low odds*, attacked in Phase 4 via a genuine strength-per-compute hypothesis, not as a checklist item.

---

## 5. Hard truths to keep in view
- **You cannot out-test Stockfish.** Proving a +1 Elo patch takes tens of thousands of games; Stockfish has ~17,000 donated cores. Compete on *ideas*, not tuning volume.
- **Every "supporting system" is small or shrinking** ([10](10-supporting-systems.md)). Books, tablebases, contempt — polish, not breakthroughs.
- **Stockfish is a moving target** — it absorbs the frontier (its eval is distilled Leela; SF18 patched the fortress weakness an exploit strategy would target). Matching *today's* version means trailing tomorrow's.
- **The honest odds of the moonshot are low** — but the search space of ideas in [07](07-frontier-and-novel-approaches.md) is real, recent, and not exhausted, and the local-hardware framing is a genuinely open research question. That is the bet this foundation is built to support.

---

## 6. Immediate next actions (when building begins)
1. Scan the target machine (CPU cores, RAM, exact M-series chip) to set thread/hash defaults.
2. Stand up Phase 0 (fastchess + Stockfish + ladder + Ordo).
3. Start the Phase 1 core in Rust; gate on perft.
4. Keep this `docs/` set as the living reference; update confidence notes as numbers are re-verified against live sources.

---

### Confidence notes
- The phase Elo targets are reasoned estimates from the strength data in Docs 01/04/08, not guarantees — actual strength depends heavily on search and tuning quality.
- The Phase-4 ranking reflects the frontier survey's reasoned promise/probability judgments ([07](07-frontier-and-novel-approaches.md)), which are *estimates, not measured facts*.
