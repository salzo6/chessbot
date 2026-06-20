# 00 — The Honest Reality

*What is physically possible, what "solving" vs "beating" chess means, and the precise framing of this project's goal. Read this first — it prevents chasing impossibilities.*

---

## 1. "Perfect play" / "solving chess" is physically impossible — forever

The dream of "a bot that always knows the exact right move to win in the fewest moves" means **solving chess**. This is not merely expensive; it is ruled out by physics.

- **Game-tree size (Shannon number):** ~**10¹²⁰** possible games (Shannon 1950, lower bound; Allis refined to ≥10¹²³ using branching factor ~35 over ~80 plies).
- **State space (legal positions):** **(4.82 ± 0.03) × 10⁴⁴** — the Tromp/Österlund count (2021), via legality-verified statistical sampling. This supersedes Shannon's obsolete ~10⁴³ estimate.
- **For scale:** the observable universe has ~**10⁸⁰ atoms**. You cannot even store one bit per position.
- **Shannon's own estimate:** a machine evaluating one variation per microsecond needs >**10⁹⁰ years** just to compute its first move (universe age ≈ 1.38×10¹⁰ years).
- **Seth Lloyd's "computational capacity of the universe"** (Phys. Rev. Lett. 88:237901, 2002): the *entire observable universe* could have performed at most ~**10¹²⁰ elementary operations on ~10⁹⁰ bits since the Big Bang**. Brute-forcing chess would consume essentially that entire budget.

### Quantum computing does not rescue this
Grover's algorithm — the relevant quantum primitive for unstructured search — gives only a **quadratic (square-root) speedup**, and that is *provably optimal* (Bennett–Bernstein–Brassard–Vazirani Ω(√N) lower bound). √(10¹²⁰) = **10⁶⁰**, still astronomically impossible. As Wikipedia puts it: *"the square root of an exponential function is still an exponential, not a polynomial."* Thermodynamic limits (Landauer's principle, Bremermann's bound) independently forbid even *counting* to 10¹²⁰.

**Conclusion:** No conceivable hardware — classical or quantum, now or ever — can solve chess by enumeration. This is settled, not speculative.

---

## 2. What *is* solved: endgame tablebases (≤7 pieces)

The one region of chess that is perfectly solved is small endgames, via **retrograde analysis** (backward induction from checkmates), not forward search.

| Tablebase | Metric | Pieces | Size |
|---|---|---|---|
| Nalimov | DTM (depth-to-mate) | 3–6 | ~1.2 TB |
| Lomonosov | DTM | 7 | ~140 TB |
| **Syzygy** (de Man, 2013) | WDL + DTZ | **7 complete** (2018) | 6-man ≈ 149 GiB; **7-man ≈ 18.4 TB** |

- 7-piece set covers **423,836,835,667,331** positions (~424 trillion, symmetry-reduced).
- **8-piece is only ~1.3% done** as of Feb 2026 (Lichess "op1" subset, 63 TiB, covers ~5×10¹⁴ positions); a complete 8-piece set is estimated at **~2 PB**. Each added piece multiplies positions by roughly **50–100×** (the 7→8 transition is ~90×) — close to two orders of magnitude per piece.
- **Metrics matter:** DTM ignores the 50-move rule; **DTZ** (distance-to-zeroing) respects it, hence Syzygy's "cursed wins"/"blessed losses." See [10-supporting-systems.md](10-supporting-systems.md) for how engines probe these.

Tablebases give *perfect play* only inside this ≤7-piece bubble — i.e. essentially never in the opening/middlegame. Everywhere else, all engines guess.

---

## 3. Is chess "solved" in any weaker sense? No.

Standard taxonomy (Allis 1994):
- **Ultra-weakly solved** — game value of the start position known (even non-constructively). *Chess: no.*
- **Weakly solved** — a strategy achieving that value from the start, with reasonable resources. *Chess: no.*
- **Strongly solved** — optimal play computable from every position. *Chess: only ≤7-piece endgames.*

**Checkers** was *weakly* solved (Chinook, Schaeffer et al., Science 2007 — it's a draw), after ~18 years. Checkers has ~5×10²⁰ positions; chess has ~10⁴⁴ — a gap of ~**10²⁴** (a trillion trillion times more). The checkers proof tree (~10¹⁴ positions) scales hopelessly to chess. Chess will not be solved in any sense "in the near future (if ever)" (Wikipedia, *Solving chess*).

---

## 4. So what is actually achievable?

The best achievable — now and for the foreseeable future — is **extremely strong heuristic play**: smart search + a learned or hand-crafted evaluation, pruning and estimating, never searching to completion. This is *not* a compromise; it **is** the frontier. The two paradigms:

- **Stockfish** — alpha-beta search (tens of millions of nodes/sec on CPU) + a small integer NNUE evaluation. Currently #1.
- **AlphaZero / Leela** — a large neural net (policy + value) guiding Monte-Carlo Tree Search, trained by self-play. Strong, but loses to Stockfish on equal terms today.

There is **no secret algorithm** that escapes the search-vs-evaluation tradeoff or reaches perfect play. Anyone claiming otherwise is mistaken or selling something.

---

## 5. "Beat Stockfish" — the goal, made precise

This is the achievable-but-unsolved problem. It splits into very different sub-goals, and being precise about which one matters enormously:

| Goal | Difficulty | Notes |
|---|---|---|
| Beat **full-strength Stockfish 18** on equal hardware, consistently, higher rating | **Open problem / never done by a small player** | Requires a genuinely better strength-per-compute. This is the repo's north star. |
| **Match / contribute to** the frontier | Hard but open | You can train an NNUE net as good as the official one in *hours* on one GPU — but proving a +1 Elo patch takes ~tens of thousands of games (SPRT scales as 1/Elo²); Stockfish validates on ~17,000 donated cores. You can't out-test them. |
| Beat a **weakened/limited** Stockfish at a defined strength (UCI_Elo, fixed nodes/depth, Skill Level) | **Fully achievable** | A well-defined, measurable engineering target. A strong hand-crafted engine beats SF@1500–2000; a good NNUE engine challenges SF@2500. |
| Beat every **human** | **Already trivial for any competent engine** | Stockfish 11 (last hand-crafted, zero-ML eval) was ~3400+ Elo; Magnus Carlsen ~2882. |

### Why "equal/local hardware" is the *sharp* version of the question
On the TCEC supercomputer, "beat Stockfish" is partly a hardware-budget question. On **one laptop**, both engines run on the same chip, so the question becomes purely algorithmic: **can you extract more playing strength per FLOP than Stockfish's alpha-beta+NNUE?** That is the genuinely interesting, genuinely open problem this repo is built to attack. See [07-frontier-and-novel-approaches.md](07-frontier-and-novel-approaches.md).

---

## 6. Why the field clusters within ~50 Elo (the core obstacle)

On equal hardware, the entire top of the rating lists — Stockfish, Torch, Komodo Dragon, Berserk, Obsidian, Caissa, Viridithas — runs the **same paradigm** (alpha-beta + NNUE) and sits within ~50 Elo of each other. That paradigm is **mature and exhaustively SPSA/SPRT-tuned** over millions of games. Leela (MCTS + deep GPU net) is the only fundamentally different top engine, and on equal terms it loses (~34 Elo behind at TCEC conditions, ~200 Elo behind at fast time controls where Stockfish's node-count advantage dominates).

So beating Stockfish locally is **not** a matter of "implement the known techniques slightly better" — that race is won by whoever has the biggest testing farm, which is Stockfish. It requires a **different source of strength**. The honest probability that a small player finds one is low — but the search space of ideas (Document 07) is real, recent (transformers, MuZero-family, learned search, exploiting the idle Apple GPU/Neural Engine), and not yet exhausted. That is the bet.

---

## 7. What this means for how to proceed

1. **Drop "perfect play" entirely.** It is impossible. The goal is "beats Stockfish," not "solves chess."
2. **A pure-algorithm engine (no ML) gets you to ~3400 Elo** — superhuman, beats throttled Stockfish far up the ladder, and is 100% the right *first build*. Training is optional and only buys the last ~80–130 Elo (the NNUE increment). It is **not** an LLM; it's a tiny specialized scoring net. See [04-evaluation-hce-and-nnue.md](04-evaluation-hce-and-nnue.md).
3. **The only path to actually beating full Stockfish is a strength-per-compute edge.** Everything in Documents 05, 07, and 09 exists to evaluate whether such an edge is reachable on a MacBook.
4. **Measure everything.** You cannot tell if you're winning without the SPRT/Elo infrastructure in [08-testing-elo-iteration.md](08-testing-elo-iteration.md). Build the measuring instrument before/alongside the engine.

---

### Confidence notes
- **Firm (primary sources, settled science):** all theoretical limits (Shannon/Tromp counts, Lloyd's bound, Grover optimality), the tablebase facts, the solved-game taxonomy, the "chess is unsolved" status.
- **Firm:** Stockfish #1 and the ~50-Elo cluster (CCRL/TCEC data, 2025–2026).
- **Approximate:** the "~34 Elo / ~200 Elo" Stockfish-vs-Leela gaps (hardware- and time-control-dependent); the "~80–130 Elo" NNUE increment (era-dependent); the "~3400 Elo" hand-crafted-eval figure (Stockfish 11, list-dependent).
- Two unit conventions appear in the literature for the same data: Shannon number 10¹²⁰ (Shannon) vs ~10¹²³ (Allis); Syzygy 7-man 16.7 TiB (binary) vs 18.4 TB (decimal).
