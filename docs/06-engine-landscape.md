# 06 — The Engine Landscape

*Every strong engine besides Stockfish, what's open source, what's reusable, and the licensing landmines. The recurring lesson: the entire top of the field runs **alpha-beta + NNUE** within ~50 Elo of each other — which is exactly why beating Stockfish locally needs a different idea, not a better copy.*

Up-front corrections to common misconceptions: **Torch ≠ Stoofvlees** (Torch is Chess.com's closed engine; Stoofvlees is a separate MCTS/NN program). **Seer is C++, not Rust.** **Stockfish forked from Glaurung, not Fruit.**

---

## 1. Top alpha-beta + NNUE engines (the ~50-Elo cluster)

CCRL 40/15, 4CPU, late 2024 — approximate; ordering reliable, decimals not.

| Engine | ~Elo | Lang | License | Distinctive | Repo |
|---|---|---|---|---|---|
| **Torch** | ~3636 | C/C++ | **Closed** (Chess.com) | "superteam" of open-source authors | — |
| **Komodo Dragon** | ~3627 | C++ | **Closed** | has an MCTS mode | — |
| **Obsidian** | ~3618 | C++ | GPL-3.0 | nets trained on Lc0 data via bullet | gab8192/Obsidian |
| **Berserk** | ~3616 | C | GPL-3.0 | clean HCE→NNUE migration | jhonnold/berserk |
| **PlentyChess** | ~3611 | C++ | GPL-3.0 | first A/B engine with **threat-input NNUE** | Yoshie2000/PlentyChess |
| **Caissa** | ~3610 | C++20 | **MIT** | king-bucketed dual-perspective net, self-play only | Witek902/Caissa |
| **Alexandria** | ~3602 | C++ | GPL-3.0 | **among the most readable** strong engines | PGG106/Alexandria |
| **RubiChess** | ~3602 | C++ | GPL-3.0 | long-running, stable | Matthies/RubiChess |
| **Viridithas** | ~3602 | **Rust** | **MIT** | strongest UK engine, detailed dev blog | cosmobobak/viridithas |
| **Ethereal** | ~3600 | C | GPL-3.0 (engine); **nets proprietary/commercial** | hugely influential; author wrote OpenBench | AndyGrant/Ethereal |
| **Seer** | ~3585 | C++ | GPL-3.0 | **WDL output + retrograde learning from Syzygy** | connormcmonigle/seer-nnue |
| **Clover** | ~3597 | C++ | GPL-3.0 | nets trained with bullet | lucametehau/CloverEngine |
| **Stash** | ~3396 | C | GPL-3.0 | famous readable **HCE** reference; long version ladder | gitlab mhouppin/stash-bot |

**Newcomer to track:** **Reckless** (Rust, codedeliveryservice/Reckless) surged into the CCRL Blitz top-3 in 2025.

**Most original eval ideas worth studying** (not just copying Stockfish's recipe):
- **Seer** — outputs Win/Draw/Loss probabilities (not centipawns), bootstrapped from 6-man Syzygy and backed up by search. The cleanest architectural alternative.
- **PlentyChess** — explicit threat/interaction inputs, incrementally updated (now also in Stockfish's newest nets).
- **Caissa** — king-bucketed dual-perspective accumulators + pawn/non-pawn correction history.

---

## 2. Leela Chess Zero & ecosystem
Covered in depth in [05-neural-and-rl-engines.md](05-neural-and-rl-engines.md). For builders: the policy+value→PUCT design and the smolgen transformer are well-documented and reusable (GPL-3). The decisive choice is the **hardware paradigm** — Lc0 buys AlphaZero positional understanding but needs GPUs for *both* training and play; alpha-beta+NNUE is cheaper, portable, CPU-only, and holds the absolute top of CCRL.

---

## 3. Historical / educational engines

| Engine | Lang | License | Teaches |
|---|---|---|---|
| **Sunfish** | Python (~111 lines) | GPLv3 | best absolute-beginner read |
| **TSCP** | C | open, not GPL | classic first engine, 10×12 mailbox |
| **micro-Max** | C (~133 lines) | verify | smallest non-trivial engine |
| **VICE** / **BBC** | C | ~public | the two famous video tutorial series |
| **CPW-Engine** | C/C++ | **public domain** | wiki companion, safe to fork |
| **Crafty** | C | open, restricted | made bitboards mainstream |
| **Fruit 2.1** | C | GPLv2 | most influential readable competitive code |
| **Glaurung** | C/C++ | GPLv3 | **direct ancestor of Stockfish** |
| **GNU Chess 6** | C/C++ | GPL | built on Fruit 2.1 |

---

## 4. The OpenBench community (how open engines test)

**OpenBench** (AndyGrant/OpenBench, Python/Django, GPL) is the distributed **SPRT** testing framework nearly all open non-Stockfish engines share — Andrew Grant's generalization of Stockfish's **Fishtest** to *any* engine. Workers pull engine source from GitHub, compile, play games, report; patches gated by SPRT. Uses **fastchess** as the game manager. There's a large public instance (chess.grantnet.us) plus many private ones.

Integration requires: a makefile producing `Engine-<sha>`, a deterministic `./binary bench` (node count = build checksum), UCI `Hash`/`Threads`, and `EVALFILE=` net embedding.

**The "Engine Programming" Discord** is the real-time hub where authors trade search heuristics, SPSA tables, and NNUE architectures (hosts the `#bullet` channel). Ethos: "Intuition is nothing, statistics are everything" — every patch SPRT-validated, every constant SPSA-tuned. This grassroots network — not academia — diffused NNUE across every open engine within months of Stockfish's 2020 port.

**Shared tooling:** **bullet** (NNUE trainer, MIT — see [04](04-evaluation-hce-and-nnue.md)), earlier Marlinflow, nnue-pytorch; training increasingly on Leela self-play data.

---

## 5. Best codebases to learn from (in progression)
1. **Sunfish** (read the whole engine at once) → 2. **Sebastian Lague's "Coding Adventure: Chess"** (visual) → 3. **BBC / VICE** (step-by-step C) → 4. **Carp** (Rust, didactic), **Weiss** (clean C), **Blunder** (Go, MIT) → 5. **Alexandria** & **Viridithas** (competitive *and* documented) → 6. **Fruit 2.1 → Glaurung → Stockfish** (the lineage).

---

## 6. Low-hardware / single-machine engines
**Almost every strong alpha-beta+NNUE engine already runs on one CPU with no GPU** — NNUE nets are small and run on CPU SIMD without batching. Only **Lc0 needs a GPU**. For human-like low-compute play: **Maia** (CSSLab/maia-chess, GPL-3.0) — 9 models at Elo ~1100–1900, trained on ~100M+ Lichess games, **no search** (one forward pass), matches the human move ~53% of the time. Useful as a graded, human-like sparring opponent (see [08](08-testing-elo-iteration.md)).

---

## 7. Licensing — the load-bearing decision

**GPLv3 is strong copyleft:** if you copy GPL code (Stockfish's movegen, its NNUE inference, a GPL Syzygy wrapper), **your whole engine becomes GPLv3** — full source, no closed distribution. This is *enforced*:
- **Stockfish v. ChessBase (2022)** — settlement forced a recall of **Fat Fritz 2** and halted Houdini 6 sales.
- **ICGA Rybka ruling (2011)** — disqualified Rybka and lifetime-banned its author for plagiarizing Fruit and Crafty.

**To keep your engine non-GPL, copy code only from permissive sources:**
- **Engines (MIT):** **Viridithas**, **Caissa** — the standout strong permissively-licensed references.
- **Syzygy probing:** **Fathom** (MIT, jdart1/Fathom).
- **Net embedding:** **incbin** (public domain).
- **NNUE trainer:** **bullet** (MIT) — train and ship nets however you like.

Study GPL engines (Stockfish, Ethereal, Lc0) for *ideas*; copy *code* only from permissive ones unless you're happy being GPLv3. Note "open engine" ≠ "open weights" — **Ethereal's** nets are proprietary/commercial even though the engine is GPLv3.

---

## The recommended modern workflow (what produced every engine above)
Build an alpha-beta searcher with NNUE eval → train nets with **bullet** (self-play and/or Leela data) → test every patch via **SPRT on OpenBench** → get help in the Engine Programming Discord. This is the well-trodden path to a top-50-cluster engine. **It does not, by itself, beat Stockfish** — that's the whole problem ([07](07-frontier-and-novel-approaches.md)).

---

### Confidence notes
- **Firm:** architectures, paradigms, the OpenBench/Fishtest/bullet toolchain, the licensing cases (ChessBase settlement, Rybka ruling), the permissive-vs-GPL list (file-level verified: Viridithas, Caissa, Carp, Blunder, bullet, Fathom, incbin).
- **Approximate:** all Elo decimals (list/date/CPU-count dependent; ordering reliable). Koivisto "dormant" inferred from inactivity. Some GPLv3 labels from CPW, not file-opened.
