# 03 — Search Techniques

*The full catalogue of techniques that let a strong engine search 30–40+ plies on a laptop. Search is where ~all the raw strength comes from — pure algorithm, no ML. Primary source: [Chess Programming Wiki](https://www.chessprogramming.org).*

**Read this caveat first:** in a modern engine all these heuristics interact tightly (LMR depends on history, which depends on ordering, which depends on the TT), so the individual Elo figures below are **approximate, era-specific, and not additive**. Treat the formulas (LMR log-log, NMP R, futility margins, history gravity) as *starting points to be re-tuned per engine via SPSA/SPRT* (Section H), not fixed constants. Several "classic essentials" — killer moves, internal iterative deepening, blanket check extensions, contempt — were **removed** from current Stockfish once they tested Elo-neutral.

---

## A. Core framework

- **Negamax alpha-beta** — the scaffold. Window `[α, β]`; a move scoring ≥ β causes a **cutoff** (the opponent avoids this line). With perfect ordering, alpha-beta searches ~√ of the minimax tree (effective branching ~35→~6), roughly doubling reachable depth. Its entire efficiency is contingent on move ordering.
- **Principal Variation Search (PVS / NegaScout)** — first move full-window, later moves a cheap **zero-window** scout; re-search fully only if a scout beats α. ~10–30% node savings with good ordering; *slower* than plain alpha-beta with bad ordering.
- **Iterative deepening** — search depth 1, 2, 3…; counterintuitively faster because cheap shallow passes vastly improve ordering for the expensive deep one, and you always have a move ready for time management.
- **Aspiration windows** — search the root in a narrow band around the last score; widen only the failing bound (exponentially) on a fail. ~20% node reduction.

## B. Transposition & move ordering

- **TT cutoffs** — return the stored score when depth and bound suffice; otherwise still use the **hash move** first (the single most valuable ordering signal). See [02](02-engine-architecture.md) §5.
- **Move ordering** — the lever that governs alpha-beta efficiency. Typical order: hash move → winning captures/promotions → equal captures → quiets by history → losing captures. Use a lazy **selection sort** (most nodes cut after 1–2 moves).
- **MVV-LVA** — order captures by Most Valuable Victim / Least Valuable Aggressor; cheap, blind to defenders.
- **SEE (Static Exchange Evaluation)** — net material result of a full capture sequence on a square (swap algorithm with bitboard attack sets). Used to split captures winning/losing and to **prune** moves below a depth-scaled threshold. Static — misses tactical compensation.
- **History family** — position-independent cutoff statistics, updated with a self-decaying "gravity" rule (`h += bonus − h·|bonus|/MAX`) plus a malus to quiets that failed. Variants: ButterflyHistory, **Counter-Move** (conditioned on the previous move), **Continuation** (1/2/4/6-ply), **Capture** history (increasingly replaces MVV-LVA). Ordering quiet moves well is among the highest-leverage areas in a modern engine.
- **Killer moves** — quiet moves that caused a sibling cutoff, tried early. **Removed from Stockfish in 2024** (Elo-neutral — subsumed by continuation history).

## C. Selectivity / forward pruning

- **Null-move pruning (NMP)** — give the opponent a free move; if a reduced search still beats β, prune. Adaptive `R` scales with depth and eval margin. **Zugzwang guard:** disable with only king+pawns; verification search / double null move to detect it. One of the largest forward-pruning gains.
- **Reverse futility / static null move** — at low depth, if `static_eval − margin·depth ≥ β`, return early. Large savings.
- **Futility pruning** — near the horizon, skip quiet non-checking moves when `static_eval + margin ≤ α`. Never in check / near mate / for captures-promotions-checks.
- **Razoring** — at low depth, if eval is hopelessly below α, drop straight to quiescence. Most aggressive; some engines have merged it into RFP.
- **Late Move Pruning (LMP)** — after a depth-growing move count, skip remaining quiets at low depth. Relies on good ordering.
- **ProbCut** — a shallow search at `β + margin` predicts a deep cutoff (margin from a fitted `deep = a·shallow + b + N(0,σ)` model). Works in Stockfish; overlaps NMP.
- **Multi-Cut** — if ≥ C of the first M moves fail high at reduced depth, prune the node (inverse of singular extensions).
- **SEE pruning / history pruning** — skip moves that statically lose material, or quiets with very negative history, at low depth.

## D. Reductions — Late Move Reductions (LMR)

The flagship selectivity technique (~+100 Elo when introduced, ~2005, continually retuned). Search late-ordered moves at **reduced depth** `depth − R`; if a reduced search beats α, **re-search at full depth**.

- **Base formula:** `R ∝ ln(depth)·ln(moveNumber)`, precomputed into a 2D table (e.g. Obsidian `0.99 + ln(d)·ln(m)/3.14`; Ethereal `0.78 + ln(d)·ln(m)/2.47` for quiets).
- **Reduce less:** PV nodes, "improving" positions, good history, checks, killers/counters, captures/promotions, TT move, passed-pawn pushes.
- **Reduce more:** expected cut-nodes, bad history, quiets, when the TT move is a capture.
- Stockfish refines re-search depth by *how much* the reduced search beat α, and can even **extend** (double extensions). R is clamped.

## E. Extensions

- **Check extensions** — extend when in check. (Blanket check extensions became Elo-neutral and were **removed/folded** in modern Stockfish.)
- **Singular extensions** — detect a move much better than all alternatives (search all *other* moves at reduced depth vs `ttValue − margin`; if all fail low, the TT move is singular → extend, sometimes double). Spends depth exactly where one critical move decides the game. Also yields **negative extensions** (reduce when not singular) and multi-cut behavior. Significant in top engines.
- **Recapture / passed-pawn extensions** — target the move types most prone to horizon misjudgment.

## F. Quiescence search

At the leaf, continue searching only **forcing** moves (captures, promotions, optionally checks; all evasions when in check) until quiet — defeats the horizon effect.

- **Stand-pat:** static eval is a lower bound (you may decline to capture); if `stand_pat ≥ β` return immediately. **Forbidden when in check** (search all evasions).
- **Delta pruning:** skip a capture if `stand_pat + captured_value + margin ≤ α`. Big savings; disable in endgames.
- **SEE pruning:** skip captures with SEE < 0. Without these, qsearch explodes (it's a large fraction of all nodes).

## G. Other

- **Internal Iterative Reduction (IIR)** — when a node has no TT move, just reduce its depth by 1 (cheaper modern replacement for classic Internal Iterative Deepening, which Stockfish dropped).
- **Multi-PV** — report the best K lines; **costs strength**, so play in single-PV.
- **Pondering** — think on the opponent's clock assuming the predicted move; ponder-hit ≈ 50%, worth ~+50 Elo. See [10](10-supporting-systems.md).
- **Time management** — soft limit (between ID iterations) + hard limit (mid-search abort); spend more on unstable positions (best move changing, score dropping), less when the best move is stable. Mismanagement loses games outright. See [10](10-supporting-systems.md).
- **Draw / repetition handling** — detect threefold + 50-move along the search path; a 2-fold within search is often treated as a draw. Subtle bugs here directly throw away points.
- **Contempt** — score draws as slightly non-zero to avoid them vs weaker opponents. **Removed from Stockfish** (Elo-neutral with strong NNUE; helps mainly vs much weaker opponents, which Fishtest self-play doesn't reward — a relevant nuance if your goal is beating a *weaker* throttled Stockfish).

## H. Tuning — how the dozens of magic constants get set

This is what actually extracts the Elo from every heuristic above. **You cannot skip it.**

- **SPSA (Simultaneous Perturbation Stochastic Approximation)** — perturb *all* N parameters at once by ±c, play a game of θ+ vs θ−, use the single result to estimate the gradient for every parameter. The standard way to tune **search constants** (LMR coefficients, margins, NMP R, history bonuses) by playing millions of games. Sample-hungry; can settle in local optima.
- **Texel tuning** — logistic-regression tuning of **evaluation** weights against game outcomes: minimize MSE between `σ(eval)` and result over millions of labeled quiet positions. Fast, deterministic, no stronger reference engine needed; optimizes a proxy (fit-to-results).
- **In practice (Fishtest / OpenBench + SPRT):** every change is gated by a Sequential Probability Ratio Test on a distributed game farm. "Elo is the only thing that counts" — this is *why* killers/IID/check-extensions/contempt were removed. See [08-testing-elo-iteration.md](08-testing-elo-iteration.md) for SPRT mechanics.

---

## Approximate Elo impact (rough, non-additive)

| Technique | Impact |
|---|---|
| Alpha-beta over minimax | ~doubles depth (foundational) |
| Transposition table | Large; ~75% of cutoffs from the hash move when present |
| Move-ordering quality | Can change node count ~10×; foundational |
| PVS + ID + aspiration | ~10–30% node savings each |
| Null-move pruning | Large (biggest forward-pruning gain) |
| LMR | ~+100 Elo introduced; still major |
| RFP / futility / razoring / LMP | Each meaningful; collectively large |
| Singular extensions | Significant in top engines |
| Quiescence + delta/SEE pruning | Foundational + large savings |
| Pondering | ~+50 Elo |
| Time management | Tens of Elo; huge negative tail if broken |
| Killers / classic IID / check ext / contempt (modern SF) | ~0 (removed) |
| SPSA / Texel / SPRT tuning | Indirect but huge — extracts the rest |

---

### Confidence notes
- **Firm:** the existence, mechanism, and rough role of every technique (CPW + Stockfish source); the removals (killers 2024, contempt 2021, IID/blanket-check-extensions).
- **Approximate / drifting:** all Elo figures and all formula constants — re-tune per engine. The LMR divisors quoted are real engine values but engine- and version-specific.
