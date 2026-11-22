// opponentPick() (exact distribution) against a literal, randomly-driven port
// of GetDomeTrainerSelectedMons -> SelectOpponentMons_Good/_Bad ->
// SelectOpponentMonsFromParty -> GetTypeEffectivenessPoints, and the lead from
// CreateDomeOpponentMons (src/battle_dome.c:2615-2933). The port below is
// written separately from engine.mjs, switch statements as in the C.
import { MONS, MOVES, SPECIES, TYPE_CHART } from "../data/dome_data.mjs";
import { opponentPick, effectivenessPoints, pickPoints } from "../engine.mjs";
import { mulberry32, check, finish, randomTeam, LATE_TRAINERS } from "./util.mjs";

// ── hand-checked ──
const L = (l) => MONS.findIndex((m) => m.label === l);
const ex = opponentPick(["SNORLAX 2", "GENGAR 4", "GARDEVOIR 8"].map(L), ["SPECIES_SALAMENCE", "SPECIES_METAGROSS"]);
check(ex.points.GOOD.join() === "12,20,6" && ex.points.BAD.join() === "6,2,10", `example points ${JSON.stringify(ex.points)}`);
check(Math.abs(ex.pairs.get(0b011) - 0.5) < 1e-12 && Math.abs(ex.pairs.get(0b101) - 0.5) < 1e-12, "example pairs 50/50");
check(ex.lead.map((x) => x.toFixed(2)).join() === "0.40,0.30,0.30", `example lead ${ex.lead}`);
// quirks
check(effectivenessPoints("MOVE_EARTHQUAKE", "SPECIES_GENGAR", "GOOD") === 2, "Levitate vs Ground, GOOD = neutral");
check(effectivenessPoints("MOVE_EARTHQUAKE", "SPECIES_GENGAR", "BAD") === 0, "Levitate vs Ground, BAD = 0 (missing return)");
check(effectivenessPoints("MOVE_FLAMETHROWER", "SPECIES_SHEDINJA", "GOOD") === 2, "Wonder Guard: even SE counts neutral");
check(effectivenessPoints("MOVE_BRICK_BREAK", null, "GOOD") === 4, "empty slot is Normal: Fighting SE");
check(effectivenessPoints("MOVE_SHADOW_BALL", null, "BAD") === 8, "empty slot is Normal: Ghost immune");
check(effectivenessPoints("MOVE_TOXIC", "SPECIES_SNORLAX", "GOOD") === 0, "status moves score 0");
check(effectivenessPoints("MOVE_ICE_BEAM", "SPECIES_SALAMENCE", "GOOD") === 8 && effectivenessPoints("MOVE_ICE_BEAM", "SPECIES_SALAMENCE", "BAD") === -4, "4x");

// ── literal port ──
function getTypeEffectivenessPoints(move, targetSpecies, mode) {
  let typePower = 20;
  if (move === "MOVE_NONE" || MOVES[move].power === 0) return 0;
  const info = targetSpecies ? SPECIES[targetSpecies] : { types: ["TYPE_NORMAL", "TYPE_NORMAL"], abilities: ["ABILITY_NONE"] };
  const defType1 = info.types[0], defType2 = info.types[1], defAbility = info.abilities[0], moveType = MOVES[move].type;
  if (defAbility === "ABILITY_LEVITATE" && moveType === "TYPE_GROUND") {
    if (mode === 1) typePower = 8;
  } else {
    let i = 0;
    while (TYPE_CHART[i][0] !== "TYPE_ENDTABLE") {
      if (TYPE_CHART[i][0] === "TYPE_FORESIGHT") { i++; continue; }
      if (TYPE_CHART[i][0] === moveType) {
        if (TYPE_CHART[i][1] === defType1)
          if ((defAbility === "ABILITY_WONDER_GUARD" && TYPE_CHART[i][2] === 40) || defAbility !== "ABILITY_WONDER_GUARD")
            typePower = Math.trunc((typePower * TYPE_CHART[i][2]) / 10);
        if (TYPE_CHART[i][1] === defType2 && defType1 !== defType2)
          if ((defAbility === "ABILITY_WONDER_GUARD" && TYPE_CHART[i][2] === 40) || defAbility !== "ABILITY_WONDER_GUARD")
            typePower = Math.trunc((typePower * TYPE_CHART[i][2]) / 10);
      }
      i++;
    }
  }
  if (mode === 0) {
    switch (typePower) { case 20: return 2; case 40: return 4; case 80: return 8; default: return 0; }
  }
  switch (typePower) { case 0: return 8; case 5: return 4; case 10: return 2; case 40: return -2; case 80: return -4; default: return 0; }
}
function selectOpponentMons(team, playerParty, mode, allowRandom, rng) {
  const partyMovePoints = [0, 1, 2].map((i) => {
    let s = 0;
    for (let m = 0; m < 4; m++) for (let p = 0; p < 3; p++) s += getTypeEffectivenessPoints(MONS[team[i]].moves[m], playerParty[p], mode);
    return s;
  });
  let selectedMonBits = 0;
  const partyPositions = [0, 1, 2];
  if (partyMovePoints[0] === partyMovePoints[1] && partyMovePoints[0] === partyMovePoints[2]) {
    if (allowRandom) {
      let i = 0;
      while (i !== 2) {
        const rand = rng.int(65536) & 3;
        if (rand !== 3 && !(selectedMonBits & (1 << rand))) { selectedMonBits |= 1 << rand; i++; }
      }
    }
  } else {
    for (let i = 0; i < 2; i++) for (let j = i + 1; j < 3; j++) {
      if (partyMovePoints[i] < partyMovePoints[j]) {
        [partyMovePoints[i], partyMovePoints[j]] = [partyMovePoints[j], partyMovePoints[i]];
        [partyPositions[i], partyPositions[j]] = [partyPositions[j], partyPositions[i]];
      }
      if (partyMovePoints[i] === partyMovePoints[j] && (rng.int(65536) & 1)) {
        [partyMovePoints[i], partyMovePoints[j]] = [partyMovePoints[j], partyMovePoints[i]];
        [partyPositions[i], partyPositions[j]] = [partyPositions[j], partyPositions[i]];
      }
    }
    for (let i = 0; i < 2; i++) selectedMonBits |= 1 << partyPositions[i];
  }
  return selectedMonBits;
}
function battleStart(team, yourTwo, rng) {
  const party = [yourTwo[0], yourTwo[1], null];
  let bits;
  if (rng.int(65536) & 1) {
    bits = selectOpponentMons(team, party, 0, false, rng);
    if (bits === 0) bits = selectOpponentMons(team, party, 1, true, rng);
  } else {
    bits = selectOpponentMons(team, party, 1, false, rng);
    if (bits === 0) bits = selectOpponentMons(team, party, 0, true, rng);
  }
  const slots = [0, 1, 2].filter((s) => bits & (1 << s));
  const lead = rng.int(65536) % 10 > 5 ? slots[0] : slots[1];
  return { bits, lead };
}

const rng = mulberry32(2611);
const allSpecies = Object.keys(SPECIES).filter((s) => s !== "SPECIES_NONE");
const N = 4000;
let cases = 0, tiedAll = 0;
for (let c = 0; c < 150; c++) {
  const team = randomTeam(rng, rng.pick(LATE_TRAINERS));
  const yourTwo = [rng.pick(allSpecies), rng.pick(allSpecies)];
  for (const mode of ["GOOD", "BAD"]) {
    const a = pickPoints(team, yourTwo, mode);
    const b = [0, 1, 2].map((i) => [0, 1, 2, 3].reduce((s, m) => s + [yourTwo[0], yourTwo[1], null].reduce((t, sp) => t + getTypeEffectivenessPoints(MONS[team[i]].moves[m], sp, mode === "GOOD" ? 0 : 1), 0), 0));
    check(a.join() === b.join(), `points ${mode} ${a} vs ${b}`);
  }
  const exact = opponentPick(team, yourTwo);
  if (new Set(exact.points.GOOD).size === 1) tiedAll++;
  const freq = new Map(), leadF = [0, 0, 0];
  for (let n = 0; n < N; n++) {
    const r = battleStart(team, yourTwo, rng);
    freq.set(r.bits, (freq.get(r.bits) ?? 0) + 1);
    leadF[r.lead]++;
  }
  for (const k of [0b011, 0b101, 0b110]) {
    const p = exact.pairs.get(k) ?? 0, f = (freq.get(k) ?? 0) / N;
    const sd = Math.sqrt(Math.max(p * (1 - p), 1e-9) / N);
    check(Math.abs(f - p) <= 4.5 * sd + 1e-9, `case ${c} pair ${k}: sim ${f.toFixed(3)} exact ${p.toFixed(3)}`);
    if (p === 0) check(f === 0, `case ${c} pair ${k}: exact 0 but simulated`);
  }
  for (let s = 0; s < 3; s++) {
    const p = exact.lead[s], f = leadF[s] / N, sd = Math.sqrt(Math.max(p * (1 - p), 1e-9) / N);
    check(Math.abs(f - p) <= 4.5 * sd + 1e-9, `case ${c} lead ${s}: sim ${f.toFixed(3)} exact ${p.toFixed(3)}`);
  }
  check(Math.abs([...exact.pairs.values()].reduce((x, y) => x + y, 0) - 1) < 1e-12, "pairs sum to 1");
  cases++;
}
console.log(`${cases} random cases x ${N} simulated battle starts (${tiedAll} with a 3-way GOOD tie)`);
finish("2-of-3 pick");
