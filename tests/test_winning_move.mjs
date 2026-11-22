// canShow() against a literal line-by-line port of GetWinningMove
// (src/battle_dome.c:5221-5331, including the do/while repeat loop and the
// per-(move, target) random ability). On random late-streak tournaments:
//   * soundness: the move the port produced is always accepted for the true team;
//   * exactness: a team move canShow() accepts is actually produced by the port
//     within a few thousand ability draws.
// Plus the hand-checked Gyarados / Skarmory / Swampert numbers.
import { MOVES, SPECIES, MONS } from "../data/dome_data.mjs";
import { canShow, possibleScores, excludedMoves, scoringPower, aiTypeCalc, RESULT_FLAGS as F, teamMoves } from "../engine.mjs";
import { mulberry32, check, finish, randomTeam, LATE_TRAINERS } from "./util.mjs";

// ── hand-checked ──
const loser = ["SPECIES_GYARADOS", "SPECIES_SKARMORY", "SPECIES_SWAMPERT"];
const expect = {
  MOVE_THUNDER: 480, MOVE_ZAP_CANNON: 400, MOVE_THUNDERBOLT: 380, MOVE_ICE_BEAM: 285,
  MOVE_PSYCHIC: 225, MOVE_EARTHQUAKE: 100,
  MOVE_TOXIC: 80,           // status -> 40 each, Steel immune to Poison
  MOVE_HIDDEN_POWER: 150,   // power 1 -> 60, Normal in data: 60 + 30 + 60
  MOVE_EXPLOSION: 312,      // 250 halved -> 125: 125 + 62 + 125
};
for (const [m, v] of Object.entries(expect)) {
  const s = [...possibleScores(m, loser)];
  check(s.length === 1 && s[0] === v, `${m}: expected ${v}, got ${s}`);
}
const eq = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
check(eq([...possibleScores("MOVE_EARTHQUAKE", ["SPECIES_GENGAR"])].sort((a, b) => a - b), [0, 200]), "Gengar Levitate draw");
check(eq([...possibleScores("MOVE_SURF", ["SPECIES_SHEDINJA"])].sort((a, b) => a - b), [0, 95]), "Shedinja Wonder Guard draw");
check(eq([...possibleScores("MOVE_FLAMETHROWER", ["SPECIES_SHEDINJA"])], [190]), "Shedinja super-effective");
check(excludedMoves(["A", "B", "C"], 0).size === 0 && excludedMoves(["A", "B", "C"], 1).size === 0, "rounds 0-1 skip nothing");
check([...excludedMoves(["A", "B", "C"], 2)].join() === "A", "round 2 skips round 0 only");
const t1 = ["MOVE_THUNDERBOLT", "MOVE_ICE_BEAM", "MOVE_PSYCHIC", "MOVE_EARTHQUAKE", ...Array(4).fill("MOVE_SURF"), ...Array(4).fill("MOVE_TOXIC")];
check(canShow(t1, loser, "MOVE_THUNDERBOLT"), "Thunderbolt shown");
check(!canShow(t1, loser, "MOVE_ICE_BEAM"), "Ice Beam cannot beat Thunderbolt");
const t2 = t1.slice(); t2[4] = "MOVE_THUNDER";
check(!canShow(t2, loser, "MOVE_THUNDERBOLT"), "Thunder on the team hides Thunderbolt");

// ── literal port ──
function getWinningMovePort(moves, loserSpecies, earlier, roundId, rng) {
  const n = moves.length, scores = Array(n).fill(0);
  let bestScore = 0, bestId = 0;
  for (let idx = 0; idx < n; idx++) {
    const power = scoringPower(moves[idx]);
    for (const sp of loserSpecies) {
      const ab = SPECIES[sp].abilities[rng.bit()];
      const v = aiTypeCalc(moves[idx], sp, ab);
      if (v & F.MOVE_RESULT_NOT_VERY_EFFECTIVE && v & F.MOVE_RESULT_SUPER_EFFECTIVE) scores[idx] += power;
      else if (v & F.MOVE_RESULT_NO_EFFECT) scores[idx] += 0;
      else if (v & F.MOVE_RESULT_SUPER_EFFECTIVE) scores[idx] += power * 2;
      else if (v & F.MOVE_RESULT_NOT_VERY_EFFECTIVE) scores[idx] += power >> 1;
      else scores[idx] += power;
    }
    if (bestScore < scores[idx]) { bestId = idx; bestScore = scores[idx]; }
    else if (bestScore === scores[idx] && MOVES[moves[bestId]].id < MOVES[moves[idx]].id) bestId = idx;
  }
  let j = bestId, i;
  do {
    for (i = 0; i < roundId - 1; i++) if (earlier[i] === moves[j]) break;
    if (i !== roundId - 1) {
      scores[j] = 0;
      bestScore = 0;
      j = scores.reduce((a, b) => a + b, 0);
      if (j === 0) break;
      j = 0;
      for (let k = 0; k < n; k++) {
        if (bestScore < scores[k]) { j = k; bestScore = scores[k]; }
        else if (bestScore === scores[k] && MOVES[moves[j]].id < MOVES[moves[k]].id) { j = k; bestScore = scores[k]; }
      }
    }
  } while (i !== roundId - 1);
  if (scores[j] === 0) j = bestId;
  return moves[j];
}

const rng = mulberry32(20261121);
let kept = 0, total = 0, exactChecked = 0;
for (let trial = 0; trial < 400; trial++) {
  const winner = randomTeam(rng, rng.pick(LATE_TRAINERS));
  const moves = teamMoves(winner);
  const hist = [];
  for (let r = 0; r < 3; r++) {
    const lsp = randomTeam(rng, rng.pick(LATE_TRAINERS)).map((i) => MONS[i].species);
    const shown = getWinningMovePort(moves, lsp, hist, r, rng);
    const excl = excludedMoves(hist, r);
    const ok = canShow(moves, lsp, shown, excl);
    check(ok, `trial ${trial} r${r}: true team rejected for ${shown}`);
    kept += ok; total++;
    const produced = new Set(Array.from({ length: 60 }, () => getWinningMovePort(moves, lsp, hist, r, rng)));
    for (const other of new Set(moves)) {
      if (produced.has(other) || !canShow(moves, lsp, other, excl)) continue;
      const more = new Set(Array.from({ length: 3000 }, () => getWinningMovePort(moves, lsp, hist, r, rng)));
      check(more.has(other), `trial ${trial} r${r}: ${other} accepted but never produced`);
      exactChecked++;
    }
    hist.push(shown);
  }
}
console.log(`true team kept ${kept}/${total}; ${exactChecked} rare-but-accepted moves confirmed reachable`);
finish("winning move");
