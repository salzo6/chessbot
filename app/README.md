# Gambit — the Engine Atelier

The interactive platform from [`docs/12`](../docs/12-the-platform.md): download bots, **play** them on a
beautiful board, **pit** two of them against each other live, and rank them on an
**anchored Elo leaderboard** — all local.

- **Frontend:** Vite + React + TypeScript + Tailwind v4, [chessground](https://github.com/lichess-org/chessground) (Lichess's board), chess.js, Framer Motion.
- **Backend:** Node + Express + `ws`, driving UCI engines directly (engine manager, live play, streamed bot-vs-bot arena, anchored Elo).

## Prerequisites

```bash
brew install stockfish     # the one system binary the app needs
```

The app auto-detects Stockfish (`/opt/homebrew/bin/stockfish`, `$STOCKFISH_PATH`, or `$PATH`).
Without it the UI still runs; play/arena come online once it's installed.

## Run (development)

```bash
cd app
npm install
npm run dev        # web on :5173 (proxies /api + /ws to the server on :3001)
```

Open http://localhost:5173.

## Run (production)

```bash
cd app
npm run build      # builds web/dist
npm start          # server serves the built app + API on :3001
```

## Layout

```
app/
  web/     React frontend (pages: Atelier, Play, Arena, Standings, Library)
  server/  Node backend
    engine.mjs  UCI engine manager (speaks UCI, normalizes eval to White POV)
    arena.mjs   full bot-vs-bot match runner (streams each move)
    rating.mjs  anchored internal Elo updater
    store.mjs   bot registry + JSON persistence (ratings, matches)
    index.mjs   Express REST + WebSocket (/ws/play, /ws/arena)
    data/       generated: ratings.json, matches.json
```

## Notes on the numbers

- **Standings** ship seeded with reference engines at their nominal strength so the board is
  alive before you play; real arena matches update them via an anchored Elo (full Stockfish is the
  fixed anchor and does not move). The rating is reproducible on *this* machine — not a universal CCRL number.
- For "did one tweak make my engine stronger?", use an **SPRT** regression, not the leaderboard
  (see [`docs/08`](../docs/08-testing-elo-iteration.md)). The leaderboard ranks distinct finished bots.
- One Stockfish binary appears as several **bots** via throttle rungs (`UCI_Elo`) — the calibration
  ladder from [`docs/08 §6`](../docs/08-testing-elo-iteration.md).
