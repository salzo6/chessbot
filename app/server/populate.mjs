import { runRoundRobin } from "./match.mjs";
import { store } from "./store.mjs";
import { writeFileSync, appendFileSync } from "node:fs";
const ids = store.bots().filter(b => b.kind === "engine" && b.installed).map(b => b.id);
const GP = 4, MT = 100;     // 4 games/pair, 100ms/move  → 45 pairs × 4 = 180 games
const t0 = Date.now();
let games = 0;
writeFileSync("/tmp/populate.log", "");
const log = (s) => { const l = `[${((Date.now()-t0)/1000).toFixed(0)}s] ${s}`; console.log(l); appendFileSync("/tmp/populate.log", l+"\n"); };
log(`START: ${ids.length} engines, ${GP} games/pair, ${MT}ms — ${ids.length*(ids.length-1)/2*GP} games total`);
await runRoundRobin({
  botIds: ids, gamesPerPair: GP, movetime: MT,
  onPairStart: (p) => log(`pair ${p.index+1}/${p.total}: ${p.aName} vs ${p.bName}`),
  onGame: () => { games++; },
  onPairEnd: (p) => {
    const top = store.ratings().slice(0,4).map(r => `${store.bot(r.botId)?.name} ${Math.round(r.elo)}`).join(" · ");
    log(`   ${p.scoreA}-${p.scoreB} | ${games} games done | leaders: ${top}`);
  },
});
log("=== DONE — FINAL STANDINGS ===");
store.ratings().forEach(r => log(`  ${String(r.rank).padStart(2)}. ${(store.bot(r.botId)?.name||r.botId).padEnd(16)} ${String(Math.round(r.elo)).padStart(4)} ±${String(r.error).padStart(3)} (${r.games}g ${r.wins}/${r.draws}/${r.losses})`));
process.exit(0);
