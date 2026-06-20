# 02 — Engine Architecture & Core Engineering

*The data structures and algorithms you must implement to have a fast, correct engine. This is the "cake" — pure algorithm, no machine learning. A correct, fast core like this, with even a simple evaluation, already plays strong chess.*

Primary source throughout: the **[Chess Programming Wiki](https://www.chessprogramming.org)** (CPW), the field's encyclopedia, plus the Stockfish source.

---

## 1. Board representation — bitboards

A **bitboard** is a 64-bit integer, one bit per square — a set of squares in one machine word. A position uses **one bitboard per (color, piece-type)** (12 boards) + aggregate occupancy boards.

- **Indexing — LERF (Little-Endian Rank-File):** a1=0, h8=63. `square = 8*rank + file`; `file = sq & 7`; `rank = sq >> 3`. Direction offsets: N=+8, S=−8, E=+1, W=−1, NE=+9, NW=+7, SE=−7, SW=−9.
- **Why bitboards win:** one bitwise op acts on all 64 squares at once (SWAR parallelism); set algebra (`&` `|` `~`) directly expresses legality/occupancy; `popcount` counts material/mobility in one instruction; `bitscan` (`bb & -bb` to isolate LS1B, then `tzcnt`/De Bruijn) enumerates squares to drive move loops.
- **The hybrid (Stockfish `Position`):** keep **redundant** bitboards + a 64-entry **mailbox** array (`board[sq] → piece`) + `pieceCount[]`. Bitboards give fast set ops; the mailbox gives O(1) "what's on square s?" used constantly in make/unmake and SEE.
- Square-centric alternatives (mailbox 10×12 with sentinel border, 0x88 with one-AND off-board test) are simpler but slower; bitboards are the standard for strong engines.

---

## 2. Move generation

- **Pseudo-legal vs legal:** a legal move is a pseudo-legal move that doesn't leave your king in check. Filtering strategies: make-test-unmake (simplest, slowest), pin-aware generation, or check-specialized generation.
- **Modern direct legal generation** (Peter Ellis Jones / "surge" pattern):
  1. **King-danger squares:** opponent attacks computed *with the friendly king removed from occupancy* (so sliders x-ray through the king square — otherwise the king could illegally step back along a check ray).
  2. **Checkers** bitboard; branch on count: **double check** → king moves only; **single check** → all other moves must land in `capture_mask | push_mask` (checker square + interposition squares); **no check** → normal.
  3. **Pins** via x-ray from the king; pinned pieces may move only along the pin ray.
  4. **En-passant edge cases:** the horizontal EP pin (EP removes two pawns from one rank, can expose the king) must be tested explicitly; castling needs path squares free of attack.
- **Magic bitboards (sliding pieces):** a multiply-shift perfect hash. `index = (occupied & MASK[sq]) * MAGIC[sq] >> (64 - bits)`, then `ATTACK_TABLE[sq][index]`. Blocker mask excludes edges (rook a1 → 12 relevant bits). Stockfish: rook table 102,400 + bishop 5,248 entries ≈ **~840 KiB**. Build magics by trial-and-error with the Carry-Rippler subset enumeration; accept constructive collisions.
- **PEXT bitboards (BMI2):** replace the magic multiply with `_pext_u64(occ, mask)` — dense, collision-free. Fast on Intel Haswell+ and **AMD Zen 3+**, but **very slow on AMD Zen 1/2** (microcoded) — ship both a PEXT and a magic build.
- Non-sliders (knight/king/pawn) use precomputed attack tables.

---

## 3. Make/unmake, state, copy-make vs make-unmake

- **Reversible state** (piece placement) updates via XOR, which is self-inverse: `pieceBB ^= (fromBB|toBB)` applied twice restores it.
- **Irreversible state** must be saved on a stack: castling rights, en-passant square, halfmove (50-move) clock, captured piece, cached Zobrist key. Stored in a `StateInfo` record (LIFO stack, or array indexed by ply for repetition/50-move checks).
- **Copy-make vs make-unmake:** copy-make memcpys state into a fresh per-ply slot (simpler, no undo bugs, easy threading) but burns memory bandwidth (~5% single-thread, ~25% on 8 cores). Make-unmake mutates one hot struct (lower traffic, more code). Make-unmake usually wins for large state; copy-make is fine when little changes.

---

## 4. Zobrist hashing

Generate one random 64-bit number per independent feature — **781 keys**: 768 (12 piece-types × 64 squares) + 1 side-to-move + 4 castling (often a 16-entry table) + 8 en-passant *file*.

- **Why XOR:** associative, commutative, self-inverse (`a^a=0`), so make/unmake update the key with a handful of XORs. On unmake, restore the cached key from the stack (avoids drift).
- **Quality** depends on linear independence over GF(2), not Hamming distance; a decent 64-bit PRNG suffices.
- **64-bit is enough:** birthday-paradox collisions appear after ~4 billion positions; Hyatt & Cozzie (2005) showed 64-bit signatures are "more than sufficient" — nobody uses 128-bit.
- **Polyglot standard** (for opening books) fixes the 781 constants; note the EP key is XORed *only if a pawn can actually capture en passant* — a common incompatibility source.

---

## 5. Transposition table

- **Entry:** partial key, best move (ordering — ~75% of cutoffs with a hash move come from it), depth, score, **bound flag** (EXACT / LOWER / UPPER), age, often static-eval cache + PV flag.
- **Stockfish layout:** 10-byte `TTEntry` (key16, depth8, packed genBound8 = gen:5|bound:2|pv:1, move16, value16, eval16); 3-entry clusters padded to 32 bytes (2 per cache line). Indexed by `mul_hi64(key, clusterCount)` — uniform for any size, no modulo.
- **Replacement:** depth-preferred with generation aging; victim minimizes `depth - 8*relative_age`.
- **Cutoff** requires stored depth ≥ remaining depth AND a usable bound (EXACT, or LOWER ≥ β, or UPPER ≤ α). Suppress cutoffs in PV nodes.
- **Mate scores** are stored ply-relative (`MATE - ply`): add ply on store, subtract on probe, or "mate in N" is wrong at a different ply.
- **Multithreading:** Hyatt's lockless XOR trick (`store key^data`; accept if `storedKey^storedData == key`) detects torn writes. **Prefetch** the cluster as soon as the child key is known (a TT probe is a near-guaranteed cache miss).

---

## 6. Perft — the correctness gate (do this before any search work)

**Perft** recursively counts legal leaf nodes to a fixed depth, validating movegen + make/unmake + legality together. A correct engine reproduces published counts **exactly**; any deviation is a bug. **Perft divide** lists each root move's subtree count to localize bugs.

Known values from the startpos: d1=20, d2=400, d3=8,902, d4=197,281, d5=4,865,609, **d6=119,060,324**, d7=3,195,901,860. Plus the five standard test positions (Kiwipete `r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq -` → d1=48, d5=193,690,690, etc.) that exercise castling, EP, promotions, pins, discovered checks. **Passing all six positions to full depth is the single highest-leverage correctness milestone.**

---

## 7. Performance

- **NPS magnitudes:** movegen-only perft (bulk-counted) reaches hundreds of MN/s (Stockfish `go perft` ~233 MN/s AVX2); full search (eval + ordering + pruning) is 1–2 orders of magnitude lower (~5 MN/s on 4 desktop cores). NPS is only meaningful for comparing *versions of the same engine* — counter placement differs across engines.
- **Compiler:** `-O3 -march=native`, **LTO** (`-flto`), **PGO** (`make profile-build` runs a bench then recompiles with branch data), explicit `popcnt`/`pext`. PGO targets the unpredictable move-loop branches.
- **Profiling:** `perf` (sampling — cycles, cache misses, branch mispredicts) first; then VTune / Callgrind. Typical hotspots: sliding-attack generation, make/unmake, legality/check detection.
- **SIMD** matters mostly in NNUE eval (see Doc 04), less in movegen. Keep attack tables L1/L2-resident.

---

## 8. Where to learn this (canonical references)

- **Chess Programming Wiki** (chessprogramming.org) — the encyclopedia, ~4,200 articles. **TalkChess** forum — the community hub.
- **Video build-from-scratch:** Bluefever's **VICE** (C, ~87 videos); Code Monkey King's **BBC** (bitboard chess engine, C, beginner-friendly, later adds NNUE).
- **Didactic engines:** **TSCP** (C, ~2,258 lines, classic), **CPW-Engine** (public domain, companion to the wiki), **Sunfish** (Python, ~111 lines), **Sebastian Lague's "Coding Adventure: Chess"** (C#, visual).
- **Modern Rust references:** **Rustic** (with a full written tutorial book at rustic-chess.org), **akimbo** (Rust, capped at 1,000 lines — minimalist masterclass), **Viridithas** (Cosmo Bobak; strongest Rust engine, MIT-licensed), **Carp** (didactic, NNUE), **Pleco** (Rust port of Stockfish).
- **Production references:** **Stockfish** (C++, the reference, not a tutorial), **Ethereal** (clean modern C), **Crafty** (the pre-Stockfish open bitboard reference).

See [06-engine-landscape.md](06-engine-landscape.md) for licensing — copy *code* only from permissive (MIT) engines unless you intend to be GPLv3.

---

## Suggested implementation order

1. Bitboard board + LERF + redundant mailbox.
2. Knight/king/pawn attack tables; magic (or PEXT) sliders.
3. Make/unmake with a StateInfo stack; incremental Zobrist.
4. Legal move generation (king-danger, check masks, pin rays, EP edge cases).
5. **Perft to exact counts on all six test positions** — the correctness gate.
6. Transposition table (mul_hi64 index, 3-way buckets, aging, mate-score adjustment, prefetch).
7. Performance pass (`-O3 -march=native`, LTO, PGO; profile with perf).
8. *Then* search ([03](03-search-techniques.md)) and evaluation ([04](04-evaluation-hce-and-nnue.md)).

---

### Confidence notes
- **Firm:** all six perft tables (verified verbatim vs CPW); algorithmic structure; the LERF/magic/Zobrist/TT designs.
- **Version-dependent:** Stockfish struct sizes (TTEntry 10 bytes, Cluster 32 bytes, table sizes) — SF18 snapshot.
- **Hardware-dependent community figures:** copy-make percentages (~5%/~25%), NPS magnitudes.
- Engine authorship verified: Viridithas = Cosmo Bobak; akimbo = jw1912.
