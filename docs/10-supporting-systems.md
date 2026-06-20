# 10 — Supporting Systems

*Opening books, endgame tablebases, time management, multithreading, and deployment — the systems around the engine that add (or, with modern NNUE, increasingly fail to add) real Elo. Includes a consolidated Elo cheat-sheet.*

---

## 1. Opening books (books an engine USES to play stronger)

- **Polyglot `.bin` format:** a flat array of 16-byte entries (`key`, `move`, `weight`, `learn`), big-endian, sorted by Zobrist key → binary search. Engine-independent because the 781 Zobrist constants are standardized. Consulted **before search** — play instantly (0 nodes) while in book, then hand off to search (eliminates ~first 10 moves of calculation).
- **`OwnBook` UCI option** governs engine-internal vs GUI-provided books. **Stockfish has no built-in book and no `OwnBook`** — relies entirely on GUI/CLI-supplied books. (This is why Brainfish exists.)
- **Building:** `polyglot make-book` (with `-min-game`, `-min-score`, `-max-ply`) on PGN cleaned by `pgn-extract`; or on engine self-play PGN for an engine-tuned repertoire.
- **Cerebellum / Brainfish** (Thomas Zipproth): not statistical — a tree of **minimaxed, Stockfish-analyzed** positions, so stored moves are theory-correct best play. Worth ~**+40–51 Elo** vs the matching plain Stockfish.
- **How much Elo:** best-vs-worst book ≈ 90 Elo; book-vs-no-book ≈ 110 Elo — **but largest in *asymmetric* matches**. In top-engine self-play, deep search defends inferior openings so well that book-vs-no-book approaches zero. (Hence testing uses *balanced* suites, not strong theory books — see [08](08-testing-elo-iteration.md).)

---

## 2. Endgame tablebases in practice

- **Syzygy** (the standard): two file sets per endgame — **WDL** (`.rtbw`, 5-valued, 50-move-aware, probed *inside search* at leaves) and **DTZ** (`.rtbz`, distance-to-zeroing, probed *at the root* to convert). 5-valued WDL: Win / **Cursed Win** (needs >50 moves) / Draw / **Blessed Loss** / Loss. Covers ≤7 pieces.
- **UCI options:** `SyzygyPath`, `SyzygyProbeDepth` (1), `Syzygy50MoveRule` (true), `SyzygyProbeLimit` (7). Keep tables on **SSD**; 7-man needs `ulimit -n` raised (1511 open files).
- **Storage:** 3–5 man ≈ 939 MiB; 6-man ≈ 149 GiB; **7-man ≈ 16.7 TiB (≈18.4 TB)**. Downloads: tablebase.sesse.net, Lichess mirror. **Lichess online API** (`tablebase.lichess.ovh/standard?fen=…`, ≤7 pieces, no auth) for light use.
- **Elo value has collapsed with NNUE:** classical eval gained ~10–17 Elo from 6-man (~14.5–16.5 in the SF6–11 era); modern NNUE Stockfish gains **~0** (one SF17.1 test: −1.26 ± 1.46). The real value today is **analysis/adjudication correctness**, not playing strength.
- **Integrate via Fathom** (MIT, jdart1/Fathom): `tb_probe_wdl` at leaves (gated by depth + piece limit), `tb_probe_root_dtz` at the root. The probing code is effectively public domain — why every engine bundles Syzygy freely.
- **Gaviota** (DTM, ≤5, MIT) and **Nalimov** (DTM, ≤6, restrictive, legacy) are alternatives.

---

## 3. Time management

- **Base allocation:** `base/20 + increment/2` per move is "very competitive." Adjust moves-to-go by time-control family (sudden death → assume ~50; increment → base + most of increment).
- **Soft vs hard limit (the key idea):** `optimumTime` (soft) is checked *between* iterative-deepening iterations (won't start a new one past it); `maximumTime` (hard, ≤ ~81% of remaining clock) is checked mid-search and can abort. **Cardinal rule: never flag.**
- **Dynamic:** spend more when the position is unstable (best move changing → `bestMoveInstability`, score dropping → `fallingEval`), less when the best move is stable across depths or a large fraction of nodes confirmed it. `nodestime` UCI option gives reproducible node-based timing for testing.
- **Pondering:** think on the opponent's clock assuming the predicted move; ponder-hit ~50%; worth **~+50 Elo** (≈ doubling think time). `Move Overhead` (default 10 ms) buffers network/GUI lag — bump to 100–1000 ms for Lichess bots.
- **Worth:** good *dynamic* management is worth tens of Elo; *broken* allocation costs hundreds (a real SF18 regression collapsed to depth 1 at 9s+0.1s).

---

## 4. Multithreading on one machine
**Lazy SMP** (Stockfish since v7): all threads search the same root, coordinating only via a lock-free shared TT; per-thread history; desynchronized by depth/ordering jitter. **Thread voting** picks the final move (`vote = (score − minScore + 14) × rootDepth`, current master; older versions used `completedDepth`). Beat YBWC by simplicity + scaling past ~8 cores. NUMA-aware via `NumaPolicy`. Set `Hash` after `Threads`. (Scaling numbers in [09](09-local-compute-apple-silicon.md).)

---

## 5. Can prep/tablebases let a *weaker* engine beat a stronger one?
**Honest verdict: almost never in a fair multi-game match.** A book covers ~10 moves; out of book the weaker engine plays the rest on its own search, and a stronger searcher claws back any edge. Balanced test books exist precisely to erase this variable. Tablebases add ~0 Elo to modern NNUE engines. **Niches** where prep can flip a *single* result: adjudication rules (a weaker engine with perfect TB access holds a draw), forced theoretical draw/fortress lines (fragile — strong searchers refute "book traps"), human-curated correspondence prep (a human amplifying an engine, not a weaker engine winning). None scales to *consistently* beating a stronger engine.

---

## 6. Deployment

- **Package as UCI** (single console exe over stdin/stdout — see [08](08-testing-elo-iteration.md)).
- **GUIs:** Arena, Cute Chess (+ cutechess-cli), BanksiaGUI (great tournament manager, first-class Lc0), En Croissant, **Nibbler** (Lc0-oriented, shows policy/value overlays).
- **Lichess bot** (`lichess-bot-devs/lichess-bot`, Python): create a BOT account (must have **zero rated games** before upgrade; upgrade is **irreversible**), token scope `bot:play`, configure engine + `uci_options` in `config.yml`, run. Lichess rates bots with **Glicko-2** (start 1500 ± ~1000), separately per time control/variant; leaderboard needs ≥50 rated games. **Not comparable to FIDE or CCRL.**
- **Rating lists** (CCRL/CEGT/SSDF): engine-vs-engine, standardized, **deflated vs FIDE**, comparable only within a list. You usually don't self-submit.

---

## 7. Elo cheat-sheet (indicative; era/opponent-dependent)

| Lever | Elo |
|---|---|
| Good opening book (asymmetric match) | +40 to +110 |
| Brainfish/Cerebellum on Stockfish | +40 to +51 |
| Syzygy 6-man, classical eval | +10 to +17 |
| Syzygy 6-man, modern NNUE | ~0 |
| Pondering | ~+50 |
| Good dynamic time management | tens (huge negative tail if broken) |
| Threads per doubling (to ~8 cores) | +66 to +91, diminishing |
| 8 threads vs 1 | +179 (LTC, wiki-verified) |
| 1 MB vs 64 MB hash | −48 |
| One extra ply of depth | +50 to +70 |
| NNUE over hand-crafted eval | +80 to +200 |
| MultiPV 2 during play | −97 |

**Reading for this project:** every "supporting system" lever is either small or shrinking against modern NNUE. None of them is a path to beating Stockfish — they're polish. The strength has to come from search + evaluation quality ([03](03-search-techniques.md), [04](04-evaluation-hce-and-nnue.md)) or a genuine strength-per-compute edge ([07](07-frontier-and-novel-approaches.md)).

---

### Confidence notes
- **Firm:** Polyglot/Syzygy formats and probing, the soft/hard time-limit design, Lazy SMP, Fathom integration, the deployment/Lichess-bot mechanics, the collapse of tablebase Elo under NNUE.
- **Approximate / test-operator-sourced:** all the cheat-sheet Elo figures (Pohl/Strangmüller/Dart SPRT data — indicative, not peer-reviewed); Stockfish time-management constants drift between versions.
