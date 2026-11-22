// Shared test helpers: a seeded PRNG (tests must be reproducible) and a
// failure counter that prints and sets the exit code.
import { MONS, TRAINERS } from "../data/dome_data.mjs";
import { trainerSets } from "../engine.mjs";

export function mulberry32(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (n) => Math.floor(next() * n),
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    bit: () => (next() < 0.5 ? 0 : 1),
  };
}

let fails = 0, checks = 0;
export function check(cond, msg) {
  checks++;
  if (!cond) { fails++; if (fails <= 25) console.log("FAIL:", msg); }
}
export function finish(name) {
  console.log(fails ? `${name}: ${fails} FAILURES of ${checks} checks` : `${name}: ALL PASS (${checks} checks)`);
  process.exit(fails ? 1 : 0);
}

/** A team the way the game builds one (src/battle_dome.c:2368-2384): sets drawn
 *  from the trainer's pool, rejecting a repeated set, species or held item. */
export function randomTeam(rng, trainerId, level = 50) {
  const sets = trainerSets(trainerId, level);
  const team = [];
  while (team.length < 3) {
    const i = rng.pick(sets);
    if (team.some((j) => j === i || MONS[j].species === MONS[i].species || MONS[j].itemTableId === MONS[i].itemTableId)) continue;
    team.push(i);
  }
  return team;
}

export const LATE_TRAINERS = TRAINERS.filter((t) => t.id >= 200).map((t) => t.id);  // challenge 8+ range, battle_tower.c:864
