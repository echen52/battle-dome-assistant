// Candidate-team rules and the narrowing pipeline.
import { MONS, TRAINERS, MOVES } from "../data/dome_data.mjs";
import { trainerSets, trainerSpecies, candidateTeams, narrow, setBreakdown, battleStyle, statLine, teamMoves } from "../engine.mjs";
import { mulberry32, check, finish, randomTeam, LATE_TRAINERS } from "./util.mjs";

// Level 50 drops ids above FRONTIER_MONS_HIGH_TIER (849); Open keeps them.
for (const t of TRAINERS) {
  check(trainerSets(t.id, 50).every((i) => i <= 849), `${t.name}: high-tier set at Lv50`);
  check(trainerSets(t.id, 100).length === t.pool.length, `${t.name}: Open must keep the whole pool`);
  check(trainerSets(t.id, 50).length >= 3, `${t.name}: Lv50 pool too small`);
}
// Both GILLIANs exist, with different pools.
const gillians = TRAINERS.filter((t) => t.name === "GILLIAN");
check(gillians.length === 2 && gillians.map((t) => t.id).join() === "16,227", "two GILLIANs (16, 227)");
check(gillians[0].pool.join() !== gillians[1].pool.join(), "GILLIAN pools differ");

const rng = mulberry32(7);
for (let n = 0; n < 2000; n++) {
  const tid = rng.pick(LATE_TRAINERS);
  const team = randomTeam(rng, tid);
  const species = team.map((i) => MONS[i].species);
  const cands = candidateTeams(tid, species);
  const key = (t) => [...t].sort((a, b) => a - b).join();
  // the true team is always a candidate, in any species order
  check(cands.some((t) => key(t) === key(team)), `true team missing ${team}`);
  const rev = candidateTeams(tid, [...species].reverse());
  check(rev.length === cands.length, "species order must not matter");
  // every candidate obeys the generation rules
  for (const t of cands) {
    check(new Set(t.map((i) => MONS[i].species)).size === 3, "repeated species");
    check(new Set(t.map((i) => MONS[i].itemTableId)).size === 3, "repeated item");
    check(t.every((i) => TRAINERS[tid].pool.includes(i) && i <= 849), "set outside pool / tier");
  }
  // with every clue from the true team, it survives the whole pipeline
  const { teams, steps } = narrow({ trainerId: tid, species, style: battleStyle(team), stat: statLine(team), wins: [] });
  check(teams.some((t) => key(t) === key(team)), "true team filtered by its own style/stat");
  check(steps.every((s, i) => i === 0 || s.left <= steps[i - 1].left), "counts must not grow");
  const bd = setBreakdown(teams, species);
  check(bd.every((b, k) => b.sets.reduce((a, s) => a + s.teams, 0) === teams.length && b.species === species[k]), "breakdown sums");
}
check(candidateTeams(LATE_TRAINERS[0], ["SPECIES_PIKACHU", "SPECIES_PIKACHU", "SPECIES_ONIX"]).length === 0, "repeated species input -> no teams");
// a win with no loser info degrades to "the team has this move"
const tid = LATE_TRAINERS[3];
const team = randomTeam(rng, tid);
const sp = team.map((i) => MONS[i].species);
const mv = teamMoves(team)[5];
const withMove = narrow({ trainerId: tid, species: sp, wins: [{ move: mv, loser: null }] }).teams;
check(withMove.every((t) => teamMoves(t).includes(mv)), "move-only clue keeps only teams with the move");
check(trainerSpecies(tid).length === new Set(trainerSets(tid).map((i) => MONS[i].species)).size, "trainerSpecies");
finish("engine");
