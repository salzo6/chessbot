# 14 — The Name: **Vesper**

*The bot has a name. This document locks it in and records why — the naming convention it follows, the candidates considered, and the availability checks that cleared it. As of this decision (June 2026), the engine/bot built from this knowledge base is called **Vesper**.*

---

## The decision

> **The bot is named `Vesper`.**

*Vesper* — the evening star (Venus at dusk); also "evening" in Latin. Celestial, polished, distinctive. It carries no chess cliché, reads like a finished product, and — critically — has **zero collision** anywhere in the chess-engine or bot world.

---

## Why this name (the convention it follows)

Almost no strong engine or notable bot is named *about* chess. The established pattern is **one evocative word** drawn from minerals, animals, fire, or myth, carrying a connotation of intelligence or quiet menace — and deliberately *not* announcing "chess":

| Lane | Real examples |
|---|---|
| Minerals / dark stone | Obsidian, Caissa, Halogen |
| Clever / predatory animals | Stockfish, Komodo → Dragon, Igel (hedgehog), Rybka ("little fish") |
| Fire / force | Torch, Berserk, Reckless |
| Names / myth | Leela, Maia, Allie, Houdini, Alexandria |

This is the same lane as Anthropic's Claude model line (Opus, Sonnet, Haiku, Fable) — an evocative single word, just leaning more mineral/celestial than literary. **Vesper** sits squarely in it.

---

## Candidates considered

The shortlist was driven toward "short, brandable, doesn't scream chess, simple like the Claude model names." Finalists and outcomes:

| Candidate | Outcome | Reason |
|---|---|---|
| **Vesper** | ✅ **Chosen** | Evening star. No chess-world collision *or* adjacency — the cleanest of every name checked. Polished, distinctive, wholly ownable. |
| Onyx | Clear, runner-up | Black gemstone. No direct collision, but sits *adjacent* to the real top-10 engine **Obsidian** (also a black stone) — slight derivative risk to engine-literate eyes. |
| Raven | ❌ Rejected | Taken hard: existing **Raven Chess Engine** (C, UCI, ~2552 CCRL), a Lichess bot **`RavenEngine`**, *and* a second `ravenchess/ravenchess` repo. |
| Corvus | ❌ Rejected | Taken: Lichess bot **`Corvus-1`**, active since 2020. |
| Kestrel | Clear, unused | No collision; strong "small raptor punches above its weight" fit, but passed over for Vesper's cleaner brand. |
| Caissa | ❌ Dropped early | The chess muse — but it *is* a known engine name, hard to pronounce, and screams chess. |
| Gambit / Caro | ❌ Dropped early | Too chess-traditional / too close to the Caro-Kann opening. |

### Availability checks (June 2026)
- **Vesper** — no chess engine or bot found by this name. **Clear.**
- **Onyx** — no chess engine or bot found by this name. Clear, but adjacent to *Obsidian*.
- **Raven**, **Corvus** — both occupied (see table). Avoided.

*Method: web search across Lichess bot directory, GitHub, and engine rating-list references. This reflects the state as of June 2026 and is not a trademark search.*

---

## Usage

- Project / engine / bot display name: **Vesper**
- Lowercase identifier (repos, UCI `id name`, bot username, code): `vesper`
- The repository itself stays `chessbot` (the research foundation); **Vesper** is the engine built *from* it, starting with v1.
