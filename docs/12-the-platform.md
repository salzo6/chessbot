# 12 — The Platform: Arena, Playboard, Leaderboard & Bot Library

*The interactive layer that sits on top of the testing harness ([08](08-testing-elo-iteration.md)). Where [08](08-testing-elo-iteration.md) is the scientific instrument (CLI, SPRT, Ordo) and [10](10-supporting-systems.md) is deployment plumbing, this document specifies the **product**: a local app where you can **download bots**, **play against them**, **pit two bots against each other**, and see them **ranked on a leaderboard**. It also records a deliberate **sequencing decision** for this project.*

---

## 1. Why this exists (and the honest caveat)

The goal of the platform is to make the testing loop **tangible and fun before any engine is built**: download real bots, play them on a board, watch two of them fight, and see an Elo leaderboard update. The bet is that *experiencing* the build→measure→matchmake→iterate loop end-to-end — with engines that already exist — makes you fluent in the system, so that when your own engines arrive there is zero friction measuring them.

**The honest caveat (acknowledged and accepted):** building this platform is *not* on the critical path to beating Stockfish. The critical path is the engine ([11](11-roadmap-and-strategy.md) Phases 1–4). Infrastructure is the *fun, easy* part; the search/eval work is the *hard* part, and polished infra can masquerade as progress. The match-running + Elo machinery is also a **solved problem** — the chess world already built it (fastchess, Ordo, Cute Chess, En Croissant). So the discipline here is: **build thin, reuse everything off-the-shelf, and don't let the platform outrun the engines that give it a reason to exist.** This document is written to honor the decision to build it first *while keeping that caveat in view.*

> **Sequencing decision (this project):** the platform (Sections 3–6) is built **first**, populated with downloaded bots, *before* the first self-made engine. This deliberately re-orders [11](11-roadmap-and-strategy.md)'s "engine-first" default. Rationale: de-risk and internalize the measurement loop on known-good engines; confirm "I can load a bot and play it" works before investing weeks in a Rust core. The roadmap's Phase 1 (the engine) still follows — this is a prepend, not a replacement.

---

## 2. Build vs. buy — what to actually write

Almost none of this needs to be written from scratch. The split:

| Capability | Reuse (don't build) | Build (thin glue only) |
|---|---|---|
| Run bot-vs-bot matches | **fastchess** (or cutechess-cli) | a wrapper that takes two bot IDs + conditions and shells out |
| Compute Elo | **Ordo** (or Bayeselo) | a step that feeds accumulated PGN in and reads ratings out |
| Drive a UCI engine from code | **python-chess** (`chess.engine`) | the playboard backend |
| Board UI | **chessground** (Lichess's board widget) or an existing GUI (En Croissant, Nibbler, Cute Chess) | the web page that embeds it |
| Bot strength throttling | Stockfish's built-in `UCI_Elo` / fixed `nodes` | config in the bot registry |

**Recommended first step before any custom code:** validate the whole idea with a stock GUI — install **En Croissant** or **Cute Chess**, drop in two Stockfish binaries, and play/watch a game. If that already scratches the itch, the custom platform can stay minimal. Build custom UI only where the off-the-shelf tools genuinely don't show you what you want (a unified leaderboard + one-click "play this ranked bot" is the part worth owning).

---

## 3. The bot library (downloading & registering bots)

A **bot** = a UCI binary + metadata. The registry is the heart of the platform; everything else (arena, playboard, leaderboard) references bots by ID.

### 3.1 Registry shape
Each bot entry records: `id`, `name`, `version`, `path` to binary, `source`/license, default `uci_options` (Threads, Hash, net path), and optional throttle (`UCI_Elo` or fixed `nodes`/`depth`). One physical engine can appear as **multiple bots** by varying the throttle — e.g. `sf18-full`, `sf18-elo2500`, `sf18-nodes10k` all point at the same binary. This is exactly how you manufacture a calibration ladder ([08](08-testing-elo-iteration.md) §6) without downloading many engines.

### 3.2 Downloading Stockfish (and multiple versions)
Stockfish is free and open source (GPLv3). On the M1 Pro / Apple Silicon Mac:

- **Easiest (latest):** `brew install stockfish` — working Apple-Silicon binary, net embedded.
- **Max performance (recommended):** build from source tuned for the chip —
  ```bash
  git clone https://github.com/official-stockfish/Stockfish
  cd Stockfish/src && make -j profile-build ARCH=apple-silicon && make net
  ```
  A native profile-guided build has meaningfully higher NPS (= strength) than a generic prebuilt binary.
- **Multiple/older versions:** every release is archived on the [GitHub releases page](https://github.com/official-stockfish/Stockfish/releases) and stockfishchess.org. Keep them as distinct named binaries (`~/engines/stockfish-18`, `-17`, `-16`) and register each as its own bot. The harness just points at a path.

### 3.3 What chess.com's download list actually is (mental model)
When chess.com offers "Stockfish 18 (108 MB)", "Stockfish 18 Lite", "Torch 4":
- The **108 MB** is mostly the embedded **NNUE network file**, not the code. These are browser **WASM** builds.
- **"Lite"** = a lighter build (smaller/older net) → smaller download, less RAM, slightly weaker. Same engine, net-size tradeoff.
- **"Torch"** = chess.com's *own proprietary* engine, not Stockfish.
- **"Play bot at max rating"** = Stockfish **throttled, running in a browser tab** on limited compute. **Critical:** chess.com's "max" bot is *far weaker* than full-strength Stockfish 18 on a real multicore machine. **Beating chess.com's Stockfish is not beating Stockfish** — relevant to the project's actual goal ([00](00-the-honest-reality.md), [11](11-roadmap-and-strategy.md)).

### 3.4 Other bots worth loading as opponents
Pull these to populate a believable ladder (≈Elo and details in [08](08-testing-elo-iteration.md) §6): **Maia** (maia1/5/9 ≈ 1100/1500/1900, human-like, no random blunders), **Stash** (v5→v36 spans ~2000→3500 in one codebase — the best single-codebase ladder), **Sunfish** (~1300), **GNU Chess**, **Glaurung** (~2845), and strong open NNUE engines **Berserk / Igel / Caissa / Viridithas / Obsidian / Lc0** for the top. All are UCI-runnable.

### 3.5 License note (matters only for the public future)
Running a binary as an **opponent** never touches your engine's license — GPL only bites if you copy engine *source* into your own code ([06](06-engine-landscape.md), [11](11-roadmap-and-strategy.md)). For personal testing, none of this matters. For a *public* product that redistributes binaries, GPLv3 obligations and per-engine redistribution terms apply — defer, but don't architect as if it's free.

---

## 4. The arena (pit two bots against each other)

A thin wrapper over **fastchess** ([08](08-testing-elo-iteration.md) §2). Input: two bot IDs + match conditions. Output: PGN (fed to the leaderboard) and a live result.

**For the rankings to be honest, the match conditions are not optional** — an uncontrolled match produces confidently-wrong Elo:
- **Same time control** for both (or same fixed `nodes`/`depth`).
- **Balanced opening suite, played from both colors** — use UHO with `-repeat` to cancel color bias ([08](08-testing-elo-iteration.md) §4). Never let bots pick their own openings for rating games.
- **Same hardware**, fixed `Threads`/`Hash`, set `Hash` after `Threads`.
- Optional resign/draw adjudication to speed games.

A single "watch them play one game" mode (for the fun/visual case) can relax these; **rating games cannot.** Keep the two modes distinct so casual games never pollute the leaderboard.

---

## 5. The playboard (human vs bot)

A web board (**chessground**) backed by a small server that drives the chosen bot via **python-chess** (`chess.engine.SimpleEngine` over UCI). Flow: board sends your move → backend pushes `position … moves …` + `go` to the engine → streams back `bestmove` → board animates it. Pick any registered bot, including throttled rungs, so you can play a 1500 or a 3500 from the same UI.

For "watch it actually play" ([11](11-roadmap-and-strategy.md) Phase 2 deliverable) the same board renders an arena game live. This is the one slice of custom UI with the clearest long-term payoff — once your own engine exists, watching it play is how you build intuition for *why* it's losing.

(If building this is more than you want up front, **Nibbler** or **En Croissant** already give a human-vs-UCI board for free — start there.)

---

## 6. The leaderboard (objective, anchored Elo)

This is where "how do we get an **objective** Elo?" is answered. The uncomfortable core fact: **Elo has no absolute zero.** A rating only means something *relative to an anchor whose rating is defined*, under fixed conditions. "Objective" therefore means **"placed on a recognized scale by anchoring to a known reference, with controlled conditions"** — not a universal truth. The scales that exist (FIDE-human, Lichess-Glicko, **CCRL** for engines, chess.com-internal) are each self-contained and not interchangeable ([08](08-testing-elo-iteration.md) §5, [10](10-supporting-systems.md) §6).

**Recipe (built on [08](08-testing-elo-iteration.md) §3, §6):**
1. **Pick a scale.** For engines, **CCRL** is the de-facto standard.
2. **Anchor to it.** Include reference bots whose rating on that scale is known and *fix* them in Ordo (`ordo -a 2800 -A "Anchor" …`). Practical anchors: **throttled Stockfish** (`UCI_Elo`, convenient but its calibration is approximate/human-flavored — a rough peg), **CCRL-rated open engines** run on your machine (the more rigorous anchor), and **Maia** for a human-Lichess-scale peg.
3. **Hold conditions constant** (Section 4) — change the TC, openings, or hardware and every number silently shifts.
4. **Run a gauntlet**, accumulate PGN, enough games for tight error bars.
5. **Rate with Ordo** → Elo + ± error bars on the anchored scale. The leaderboard reads this output.

**Honest caveat to display alongside the numbers:** an Elo computed on *your* M1 Pro at *your* time control is **reproducible and anchored, not universal.** It won't exactly equal published CCRL (different hardware/TC) and drifts as Stockfish versions change. That's fine — you want a *stable, anchored, controlled* number you can track over time. "Beats SF@2500 by X% ± Y" is the kind of claim this makes provable.

### 6.1 Leaderboard ≠ iteration tool — use SPRT for "did my change help?"
The single most important distinction (carried from [08](08-testing-elo-iteration.md) §3): **most of your future "bots" will be *versions* of one engine with a single tweak, not distinct engines.** To decide "is version B stronger than version A," the right tool is **SPRT** — a few hundred-to-few-thousand games with a statistical stopping rule. A leaderboard ranks *heterogeneous* players by Elo and needs **tens of thousands** of games to separate engines within 20–50 Elo (the `1/Elo²` law, [08](08-testing-elo-iteration.md) §3). **Reach for the leaderboard for *standings* of meaningfully-different finished bots; reach for SPRT for *iteration*.** Both belong in the platform; they are different screens, not the same number.

---

## 7. The community future (explicitly deferred)

The long-term vision — anyone uploads their bot and it joins the leaderboard — is real but **out of scope now**. The wall to know about: running arbitrary uploaded binaries means **executing untrusted code**, which is a genuine sandboxing/security problem (containers, resource/time limits, no network, no filesystem escape). Plus GPL/redistribution terms per engine (Section 3.5). Defer it — but don't design the registry/arena in a way that assumes untrusted execution is trivial to bolt on later. For the foreseeable future, every bot is **one *you* put on disk**, which is safe.

---

## 8. Suggested build order for the platform itself

Thin, each step usable on its own:
1. **Validate with a stock GUI** (En Croissant / Cute Chess + two Stockfish binaries) — confirm the whole idea before writing code.
2. **Bot registry + downloads** (Section 3): Stockfish (brew + source), a couple of ladder engines, registered with metadata and throttle rungs.
3. **Arena wrapper** over fastchess (Section 4) → PGN out, with the fairness controls enforced for rating games.
4. **Leaderboard** (Section 6): Ordo over accumulated PGN, anchored, with error bars + the "not universal" caveat shown.
5. **Playboard** (Section 5): chessground + python-chess, play any registered bot; reuse the board to watch arena games live.
6. Keep **SPRT** wired as a separate mode (Section 6.1) so it's ready the moment your own engine arrives — which is where [11](11-roadmap-and-strategy.md) Phase 1 picks up.

---

## 9. As built — the measurement engine (implementation notes)

The `app/` implementation diverges from the "wrap fastchess/Ordo" plan in one deliberate way: to **watch games live move-by-move**, the platform drives the engines itself (a thin built-in runner) rather than shelling out to headless fastchess. fastchess remains the right tool for large headless SPRT batches later; the built-in runner is for the interactive/visual case. What's built:

- **Every game is recorded.** Results go into a permanent **pairwise matrix** (`results.json` — tiny, the source of truth for ratings) and full move text appends to a **PGN archive** (`games.pgn`, git-ignored). The UI "recent" feed is just a capped view.
- **Ratings = maximum-likelihood Elo over the matrix** (the Ordo/Bayeselo method), recomputed after every game — order-independent, not online K-factor. The declared **anchor** (full Stockfish) is held fixed to pin the absolute scale. A small **Bayesian prior** (≈2 virtual draws vs each bot's nominal rating) keeps ratings finite on sweeps/iso­lated pools and lets real games earn shifts; its weight fades as ~1/N. Error bars are **Fisher-information** 95% intervals, so games against far-off opponents (which carry little information) correctly widen the bar.
- **Multi-game matches** with **reversed-color pairs** sharing one opening from a built-in balanced suite ([08](08-testing-elo-iteration.md) §4), plus a **continuous "pinning"** mode (run until stopped). A **smart gauntlet** pairs a new bot against the nearest-rated opponents — the most informative games, so it converges fastest.
- **"Settling" indicator**: the trend/sparkline is framed as *rating-estimate convergence*, not the (fixed) bot changing; a dot marks settled vs provisional (<~30 games). The honest signal for a fixed-strength bot is the **± shrinking**, shown prominently.
- **Engine bank**: one git-ignored `engines/` folder + `manifest.json`; engines are copied in and registered (anchor/prior/rungs/launch-args per entry), so the whole app reads the roster dynamically.

**Games-to-settle (the `1/√N` law, for expectation-setting):** ~30 games = ballpark (±70–120); **~100 = the knee** (per-game shift <1 Elo, ±40–60); ~400–500 = confident ordering (±20–30); thousands = fine distinctions; tens of thousands = SPRT territory for tuning-sized changes.

---

### Confidence notes
- **Firm:** Elo is relative/anchor-dependent; the SPRT-vs-leaderboard distinction and `1/Elo²` scaling ([08](08-testing-elo-iteration.md)); fastchess/Ordo/python-chess/chessground as the reuse stack; Stockfish being free/GPLv3, buildable `ARCH=apple-silicon`, and runnable as multiple versioned binaries; running a binary as an opponent not affecting your engine's license.
- **Approximate / external-product-sourced:** the exact internals of chess.com's "Lite"/Torch builds (download sizes and "Lite = smaller net" are reasoned from public behavior, not chess.com docs); reference-engine Elo numbers (verify on live CCRL, [08](08-testing-elo-iteration.md) §6); `UCI_Elo` calibration accuracy (community-characterized as approximate).
- **Decision, not fact:** the platform-first sequencing (Section 1) is a deliberate project choice that re-orders [11](11-roadmap-and-strategy.md)'s engine-first default; the honest caveat about it being off the critical path stands.
</content>
</invoke>
