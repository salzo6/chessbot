# 08 — Testing, Elo & Iteration

*The scientific instrument. You cannot tell whether a change helped without this — and "I think it's stronger" is worthless in chess engine development. **Build the measuring apparatus before/alongside the engine.** The field's iron law: "Elo is the only thing that counts; intuition is nothing, statistics are everything."*

---

## 1. UCI — the protocol engines speak

UCI (Universal Chess Interface, Huber & Meyer-Kahlen, 2000) is a plain-text line protocol over **stdin/stdout**. The **GUI/manager owns all state** (board, history, clocks); the engine is stateless and receives the full position + timing with every search. Canonical spec: [backscattering.de/chess/uci](https://backscattering.de/chess/uci/).

Handshake / flow:
```
uci            → id name…, id author…, option name… , uciok
isready        → readyok
setoption name <id> [value <x>]
ucinewgame
position startpos moves e2e4 e7e5     (or: position fen <FEN> moves …)
go wtime 300000 btime 300000 winc 0 binc 0   → info … (streamed) → bestmove g1f3 ponder b8c6
stop / ponderhit / quit
```
`go` params (your strength throttles): `wtime/btime/winc/binc`, `movestogo`, `depth`, **`nodes`**, `mate`, `movetime`, `infinite`, `searchmoves`. Moves are long algebraic (`e2e4`, `e7e8q`, null `0000`). **XBoard/CECP** is the older, stateful alternative (engine keeps state); largely superseded — bridge legacy engines with PolyGlot/UCI2WB.

---

## 2. Match runners (engine vs engine)

All three output PGN and implement SPRT with the same `elo0/elo1/alpha/beta` vocabulary.

- **cutechess-cli** — the long-time standard (C++/Qt, GPLv3). No `brew` formula — build from source or use release binaries.
- **fastchess** (Disservin/fastchess) — the **modern drop-in replacement**, faster, tested to 250 threads, native **pentanomial** SPRT. **Recommended.** Used by OpenBench. Build `make -j`.
- **c-chess-cli** (lucasart) — minimalist pure C, dependency-free, has a position-sampling feature for generating training data.

Example SPRT regression (fastchess; new patch vs baseline):
```bash
fastchess \
  -engine cmd=./engine_new name=New option.Threads=1 \
  -engine cmd=./engine_base name=Base option.Threads=1 \
  -each tc=10+0.1 option.Hash=64 \
  -openings file=UHO_4060_v3.epd format=epd order=random \
  -repeat -rounds 25000 -concurrency 8 \
  -sprt elo0=0 elo1=5 alpha=0.05 beta=0.05 \
  -pgnout notation=san file=sprt.pgn
```
Key flags: `tc=40/60` or `10+0.1` or `st=N` or `depth=N` or `nodes=N`; `-repeat` (play each opening both colors — **essential** to cancel color bias); `-concurrency N` (= core count); `-tournament gauntlet|round-robin`; `-pgnout`; `-resign`/`-draw` adjudication. Use **`-repeat` always.**

---

## 3. Elo computation & SPRT

### Rating tools (consume the PGN)
- **Ordo** (Ballicora) — used by CCRL/CEGT/SP-CC. Global logistic fit, error bars by Monte-Carlo replay, anchor with `-a`/`-A`. `ordo -a 2800 -A "MyBot" -W -D -s 1000 -p games.pgn -o ratings.txt`.
- **Bayeselo** (Coulom) — Bayesian Bradley-Terry; emits an **LOS (Likelihood of Superiority) matrix**. CCRL uses it (compresses ratings ~10% vs Ordo).

Key formulas: score→Elo `ΔElo = −400·log₁₀(1/score − 1)`; error bar shrinks as `1/√N` and with more draws.

### SPRT — the method that decides if a change is real
Wald's Sequential Probability Ratio Test: **keep playing and stop the moment the evidence is conclusive.** Don't fix N in advance.
- **Elo₀** = null (usually 0, "no gain"); **Elo₁** = the gain you care about; **α = β = 0.05** standard.
- Track cumulative **LLR**; continue while `−2.94 < LLR < 2.94`; **pass** at ≥2.94, **fail** at ≤−2.94.
- **The critical practical fact:** expected duration scales as **(Elo₁ − Elo₀)⁻²** — halving the effect size you want to detect **quadruples** the games. Detecting a 1–5 Elo gain reliably takes **tens of thousands of games**. This is why frontier work needs distributed farms (Fishtest, OpenBench) and why a small player **cannot out-test Stockfish**.
- **Pentanomial** (pair games by reversed-color opening into 5 outcomes) converges faster than trinomial — use it (fastchess supports it).
- **Normalized Elo (nElo)** bounds (Fishtest): STC gainer [0, 2.0], LTC [0, 1.0], non-regression [−1.75, 0.25].
- Tools: Fishtest SPRT calculator (tests.stockfishchess.org/sprt_calc); **OpenBench** (AndyGrant) for your own distributed instance.

---

## 4. Opening suites (for *testing*, not playing)

Strong engines draw most equal positions, making Elo slow/noisy. Start from slightly-unbalanced positions **played from both sides** to raise the decisive rate (target ~45–60% draws):
- **UHO (Unbalanced Human Openings)** by Stefan Pohl — the Fishtest standard family (`UHO_4060_v3.epd`, current `UHO_Lichess_4852_v1`).
- **8moves_v3.pgn** — the older balanced book (good for weaker engines).
- Source: [github.com/official-stockfish/books](https://github.com/official-stockfish/books) (CC0).

(Books an engine *uses to play stronger* — Polyglot, Cerebellum — are a different topic, in [10-supporting-systems.md](10-supporting-systems.md).)

---

## 5. Public rating lists (for calibration context)
**CCRL** (40/15 + Blitz; i7-4770k baseline, Bayeselo), **CEGT** (40/4, 40/20, 40/120; Ordo), **SP-CC** (UHO-Top15, Ordo). All are **relative, self-anchored — comparable only *within* one list**, and run hot vs FIDE (a "3500 CCRL" is not a "3500 FIDE"). You generally don't self-submit; testers pick up popular/open engines, or you request inclusion.

---

## 6. A calibration ladder (measure your bot as it improves)

Use throttled Stockfish + a ladder of real engines so you always know your bot's strength:

**Throttle Stockfish 3 ways:**
1. `setoption name Skill Level value N` (0–20; coarse, randomized; Level 0 ≈ 1350).
2. `UCI_LimitStrength=true` + `UCI_Elo` (1320–3190; calibrated, recommended for a target Elo).
3. **Fixed budget — `go nodes 10000` or `go depth 6`** (deterministic, hardware-independent; pin `Threads 1`). Best for a *reproducible* sub-1320 ladder.

**Reference engine ladder** (≈Elo, all UCI-runnable):
| Engine | ≈Elo | Note |
|---|---|---|
| Sunfish | ~1300 | Python, ships a wrapper |
| CT800 / Mister Queen | ~2000 | C |
| GNU Chess 6.2 | ~2660 | |
| Glaurung 2.2 | ~2845 | Stockfish's ancestor |
| **Stash v5→v36** | ~2000→3500 | **best single-codebase ladder** (many rungs) |
| Berserk / Igel | ~3500+ | strong open NNUE engines |

**Maia** (maia1/5/9 ≈ 1100/1500/1900) gives *human-like* graded opponents (no random blunders) — better than Skill-Level Stockfish for a believable ladder.

---

## 7. Recommended workflow
1. Wrap your bot as a UCI engine (or prototype via **python-chess** `chess.engine`, which drives any UCI engine for matches/analysis).
2. Install **fastchess** + grab UHO books + Stockfish.
3. Build a calibration ladder (throttled SF via `UCI_Elo` + fixed-`nodes`, plus Stash versions, plus Maia).
4. Run gauntlets at your core count; save PGN; rate with **Ordo** (anchor a known engine).
5. A/B every change with **SPRT** (`elo0=0 elo1=2/5`, α=β=0.05, pentanomial).
6. **Remember 1/Elo²:** small gains need tens of thousands of games — use SPRT to stop early, and consider an OpenBench instance if you scale up.

---

### Confidence notes
- **Firm:** UCI/SPRT mechanics, the runner tools, Ordo/Bayeselo, the 1/Elo² scaling, opening-book sources, throttling methods. Heavily cross-corroborated.
- **Approximate:** reference-engine Elo numbers (verify on the live CCRL list); Skill-Level→Elo conversions are community estimates; the "+3 Elo ≈ 55,600 games" illustration is from a forum post, not a spec.
