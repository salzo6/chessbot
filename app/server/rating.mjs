import { store } from "./store.mjs";

const SCALE = 400;
const LN10_OVER_400 = Math.log(10) / SCALE;
// Bayesian regularization: each bot gets PRIOR_GAMES virtual draws against an
// opponent at its own prior rating. Keeps ratings finite on sweeps / isolated
// pools and anchors them near the prior until real games earn a shift. Its
// influence fades as ~1/N, so it's a starting estimate, not a thumb on the scale.
const PRIOR_GAMES = 2;

/** Expected score of a player rated ra against one rated rb. */
function expected(ra, rb) {
  return 1 / (1 + 10 ** ((rb - ra) / SCALE));
}

/**
 * Record a finished game into the permanent matrix + PGN archive, then
 * recompute every rating from scratch. Order-independent and anchored.
 */
export function recordResult({ whiteId, blackId, result, pgn }) {
  store.recordGame(whiteId, blackId, result, pgn);
  recomputeRatings();
}

/**
 * Maximum-likelihood Elo over the full pairwise results matrix (the method
 * Ordo/Bayeselo use). Anchored bots (e.g. full Stockfish) are held fixed to
 * pin the absolute scale; everyone else is solved by Gauss–Seidel. Error bars
 * come from Fisher information, so games against far-off opponents — which
 * carry little information — widen the bar correctly.
 */
export function recomputeRatings() {
  const matrix = store.results();
  const entries = Object.values(matrix);

  // adjacency: player -> opponent -> { n, s } (n games, s = player's points)
  // and per-player W/D/L, both derived purely from the matrix.
  const adj = new Map();
  const wld = new Map();
  const ensure = (id) => {
    if (!adj.has(id)) adj.set(id, new Map());
    return adj.get(id);
  };

  for (const e of entries) {
    const n = e.loWins + e.draws + e.hiWins;
    if (!n) continue;
    ensure(e.lo).set(e.hi, { n, s: e.loWins + 0.5 * e.draws });
    ensure(e.hi).set(e.lo, { n, s: e.hiWins + 0.5 * e.draws });
    wld.set(e.lo, mergeWld(wld.get(e.lo), { w: e.loWins, d: e.draws, l: e.hiWins }));
    wld.set(e.hi, mergeWld(wld.get(e.hi), { w: e.hiWins, d: e.draws, l: e.loWins }));
  }
  const cleanWld = wld;

  const players = [...adj.keys()];
  const R = new Map();
  const prior = new Map();
  const anchored = new Set();
  for (const id of players) {
    const bot = store.bot(id) || {};
    const existing = store.rawRatings().find((r) => r.botId === id);
    prior.set(id, bot.prior ?? 1500);
    R.set(id, existing?.elo ?? bot.prior ?? 1500);
    if (bot.anchored) {
      anchored.add(id);
      R.set(id, bot.prior ?? existing?.elo ?? 1500);
    }
  }

  // Gauss–Seidel: for each non-anchored player, solve Ri so its expected
  // total score (real games + prior regularization) equals the actual total.
  for (let pass = 0; pass < 80; pass++) {
    for (const id of players) {
      if (anchored.has(id)) continue;
      const opps = adj.get(id);
      let actual = 0;
      for (const { s } of opps.values()) actual += s;
      R.set(id, solveRating(opps, R, actual, prior.get(id)));
    }
  }

  // Fisher-information error bars (95%), including the prior's contribution.
  const next = [];
  for (const id of players) {
    const opps = adj.get(id);
    let info = 0;
    let games = 0;
    for (const [oppId, { n }] of opps) {
      const e = expected(R.get(id), R.get(oppId));
      info += n * e * (1 - e);
      games += n;
    }
    const ep = expected(R.get(id), prior.get(id));
    info += PRIOR_GAMES * ep * (1 - ep);
    info *= LN10_OVER_400 * LN10_OVER_400;
    const se = info > 0 ? 1 / Math.sqrt(info) : 400;
    const error = Math.max(6, Math.min(600, Math.round(1.96 * se)));
    const w = cleanWld.get(id) || { w: 0, d: 0, l: 0 };

    const prev = store.rawRatings().find((r) => r.botId === id);
    const elo = Math.round(R.get(id) * 10) / 10;
    const history = [...(prev?.history || [store.bot(id)?.prior ?? 1500]), Math.round(elo)].slice(-40);
    next.push({
      botId: id,
      elo,
      error,
      games,
      wins: w.w,
      draws: w.d,
      losses: w.l,
      anchored: anchored.has(id),
      provisional: games < 30,
      history,
    });
  }
  store.setRatings(next);
  return next;
}

function solveRating(opps, R, actualScore, priorElo) {
  // f(r) = sum n·E(r,Rj) + PRIOR_GAMES·E(r,prior) is increasing in r.
  // Target adds the prior's virtual half-point. Bisect for f = target.
  const target = actualScore + PRIOR_GAMES * 0.5;
  let lo = -1000;
  let hi = 6000;
  for (let i = 0; i < 48; i++) {
    const mid = (lo + hi) / 2;
    let f = PRIOR_GAMES * expected(mid, priorElo);
    for (const [oppId, { n }] of opps) f += n * expected(mid, R.get(oppId));
    if (f < target) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

function mergeWld(a, b) {
  a = a || { w: 0, d: 0, l: 0 };
  return { w: a.w + b.w, d: a.d + b.d, l: a.l + b.l };
}
