// ── engine.mjs — Battle Dome opponent-team narrowing ───────────────────────
// Pure functions, no DOM. Every rule is a port of pokeemerald a3c551fe; the
// file:line next to each function is the code it follows.

import {
  MONS, TRAINERS, MOVES, SPECIES, TYPE_CHART, NATURE_STAT_TABLE,
  STYLE_THRESHOLDS, STAT_TEXT_OFFSETS, DOME_TEXT, FRONTIER_MONS_HIGH_TIER,
} from "./data/dome_data.mjs";

const NUM_STATS = 6, NUM_NATURE_STATS = 5, FRONTIER_PARTY_SIZE = 3, MAX_MON_MOVES = 4;
const MAX_TOTAL_EVS = 510;                                   // include/constants/pokemon.h
const NUM_MOVE_POINT_TYPES = 16;                             // include/constants/battle_dome.h:125
const ALLOC_ARRAY_SIZE = Math.max(NUM_STATS * FRONTIER_PARTY_SIZE, NUM_MOVE_POINT_TYPES); // battle_dome.c:4314

// ── candidate teams ────────────────────────────────────────────────────────

/** Sets a trainer can field. At Level 50, ids above FRONTIER_MONS_HIGH_TIER are
 *  rerolled (GetRandomFrontierMonFromSet, src/battle_tower.c:1805-1810). */
export function trainerSets(trainerId, level = 50) {
  const pool = TRAINERS[trainerId].pool;
  return level === 50 ? pool.filter((i) => i <= FRONTIER_MONS_HIGH_TIER) : pool.slice();
}

/** Species a trainer can show (in first-seen pool order). */
export function trainerSpecies(trainerId, level = 50) {
  return [...new Set(trainerSets(trainerId, level).map((i) => MONS[i].species))];
}

/** Every team the game could have built with these three species. Party
 *  generation rejects a repeated set, a repeated species, or a repeated held
 *  item (itemTableId) — src/battle_dome.c:2368-2384. Order does not matter to
 *  any clue, so teams are unordered (sorted by set index). */
export function candidateTeams(trainerId, speciesList, level = 50) {
  const [s1, s2, s3] = speciesList;
  if (new Set(speciesList).size !== 3) return [];
  const sets = trainerSets(trainerId, level);
  const of = (sp) => sets.filter((i) => MONS[i].species === sp);
  const teams = [];
  for (const a of of(s1)) for (const b of of(s2)) for (const c of of(s3)) {
    const it = [a, b, c].map((i) => MONS[i].itemTableId);
    if (it[0] === it[1] || it[1] === it[2] || it[0] === it[2]) continue;
    teams.push([a, b, c].sort((x, y) => x - y));
  }
  return teams;
}

// ── battle style (2nd line of the card) ────────────────────────────────────

/** DisplayTrainerInfoOnCard, src/battle_dome.c:4479-4513. Returns the style
 *  index into sBattleDomeOpponentStyleTexts. */
export function battleStyle(team) {
  const allocatedArray = new Int16Array(ALLOC_ARRAY_SIZE);
  for (let i = 0; i < FRONTIER_PARTY_SIZE; i++)
    for (let j = 0; j < MAX_MON_MOVES; j++)
      for (let k = 0; k < NUM_MOVE_POINT_TYPES; k++)
        allocatedArray[k] += MOVES[MONS[team[i]].moves[j]].stylePoints[k];
  let i;
  for (i = 0; i < STYLE_THRESHOLDS.length; i++) {
    let thresholdStatCount = 0, k = 0;
    for (let j = 0; j < NUM_MOVE_POINT_TYPES; j++) {
      if (STYLE_THRESHOLDS[i][j] !== 0) {
        thresholdStatCount++;
        if (allocatedArray[j] !== 0 && allocatedArray[j] >= STYLE_THRESHOLDS[i][j]) k++;
      }
    }
    if (thresholdStatCount === k) break;
  }
  return i;
}

// ── stat line (3rd line of the card) ───────────────────────────────────────

const cdiv = (a, b) => Math.trunc(a / b);    // C integer division

/** DisplayTrainerInfoOnCard, regular-trainer branch, src/battle_dome.c:4518-4700.
 *  Returns the index into sBattleDomeOpponentStatsTexts. A line-by-line port on
 *  an s16 array, including its quirks (see tests/test_stat_line.mjs). */
export function statLine(team) {
  const allocatedArray = new Int16Array(ALLOC_ARRAY_SIZE);
  for (let i = 0; i < FRONTIER_PARTY_SIZE; i++) {
    const mon = MONS[team[i]];
    let evBits = mon.evSpread, k, j;
    for (k = 0, j = 0; j < NUM_STATS; j++) {
      allocatedArray[j] = 0;
      if (evBits & 1) k++;
      evBits >>= 1;
    }
    k = cdiv(MAX_TOTAL_EVS, k);
    evBits = mon.evSpread;
    for (j = 0; j < NUM_STATS; j++) {
      if (evBits & 1) allocatedArray[j] = k;
      evBits >>= 1;
    }
    allocatedArray[NUM_STATS] += allocatedArray[0];
    const row = NATURE_STAT_TABLE[mon.nature];
    for (j = 0; j < NUM_NATURE_STATS; j++) {
      if (row[j] > 0) {
        allocatedArray[j + NUM_STATS + 1] += cdiv(allocatedArray[j + 1] * 110, 100);
      } else if (row[j] < 0) {
        allocatedArray[j + NUM_STATS + 1] += cdiv(allocatedArray[j + 1] * 90, 100);
        allocatedArray[j + NUM_STATS + NUM_NATURE_STATS + 2]++;
      } else {
        allocatedArray[j + NUM_STATS + 1] += allocatedArray[j + 1];
      }
    }
  }
  let i, j, k;
  for (j = 0, i = 0; i < NUM_STATS; i++) j += allocatedArray[i + NUM_STATS];
  for (i = 0; i < NUM_STATS; i++) allocatedArray[i] = cdiv(allocatedArray[NUM_STATS + i] * 100, j);

  for (i = 0, j = 0, k = 0; k < NUM_STATS; k++) {
    if (allocatedArray[k] > 29) {
      if (i === 2) {
        if (allocatedArray[6] < allocatedArray[k]) {
          if (allocatedArray[7] < allocatedArray[k]) {
            if (allocatedArray[6] < allocatedArray[7]) {
              allocatedArray[6] = allocatedArray[7];
              allocatedArray[7] = k;
            } else {
              allocatedArray[7] = k;
            }
          } else {
            allocatedArray[6] = allocatedArray[7];
            allocatedArray[7] = k;
          }
        } else {
          if (allocatedArray[7] < allocatedArray[k]) allocatedArray[7] = k;
        }
      } else {
        allocatedArray[i + 6] = k;
        i++;
      }
    }
    if (allocatedArray[k] === 0) {
      if (j === 2) {
        if (allocatedArray[k + 12] >= 2
          || (allocatedArray[k + 12] === 1 && allocatedArray[12 + allocatedArray[8]] === 0 && allocatedArray[12 + allocatedArray[9]] === 0)) {
          allocatedArray[8] = allocatedArray[9];
          allocatedArray[9] = k;
        } else if (allocatedArray[k + 12] === 1 && allocatedArray[12 + allocatedArray[8]] === 0) {
          allocatedArray[8] = allocatedArray[9];
          allocatedArray[9] = k;
        } else if (allocatedArray[k + 12] === 1 && allocatedArray[12 + allocatedArray[9]] === 0) {
          allocatedArray[9] = k;
        }
      } else {
        allocatedArray[j + 8] = k;
        j++;
      }
    }
  }
  if (i === 2) return STAT_TEXT_OFFSETS[allocatedArray[6]] + (allocatedArray[7] - (allocatedArray[6] + 1)) + DOME_TEXT.DOME_TEXT_TWO_GOOD_STATS;
  if (i === 1) return allocatedArray[6] + DOME_TEXT.DOME_TEXT_ONE_GOOD_STAT;
  if (j === 2) return STAT_TEXT_OFFSETS[allocatedArray[8]] + (allocatedArray[9] - (allocatedArray[8] + 1)) + DOME_TEXT.DOME_TEXT_TWO_BAD_STATS;
  if (j === 1) return allocatedArray[8] + DOME_TEXT.DOME_TEXT_ONE_BAD_STAT;
  return DOME_TEXT.DOME_TEXT_WELL_BALANCED;
}

// ── winning move (match card: "X won using MOVE") ──────────────────────────

// include/constants/battle.h:219-227
const MOVE_RESULT_MISSED = 1 << 0, MOVE_RESULT_SUPER_EFFECTIVE = 1 << 1, MOVE_RESULT_NOT_VERY_EFFECTIVE = 1 << 2;
const MOVE_RESULT_DOESNT_AFFECT_FOE = 1 << 3, MOVE_RESULT_FAILED = 1 << 5;
const MOVE_RESULT_NO_EFFECT = MOVE_RESULT_MISSED | MOVE_RESULT_DOESNT_AFFECT_FOE | MOVE_RESULT_FAILED;
export const RESULT_FLAGS = { MOVE_RESULT_MISSED, MOVE_RESULT_SUPER_EFFECTIVE, MOVE_RESULT_NOT_VERY_EFFECTIVE, MOVE_RESULT_DOESNT_AFFECT_FOE, MOVE_RESULT_NO_EFFECT };
const TYPE_MUL_NO_EFFECT = 0, TYPE_MUL_NOT_EFFECTIVE = 5, TYPE_MUL_SUPER_EFFECTIVE = 20; // include/battle_main.h:31-34

/** ModulateDmgByType2 flag logic, src/battle_script_commands.c:1502-1532. */
function modulate(multiplier, move, flags) {
  const power = MOVES[move].power;
  if (multiplier === TYPE_MUL_NO_EFFECT) {
    flags |= MOVE_RESULT_DOESNT_AFFECT_FOE;
    flags &= ~MOVE_RESULT_NOT_VERY_EFFECTIVE;
    flags &= ~MOVE_RESULT_SUPER_EFFECTIVE;
  } else if (multiplier === TYPE_MUL_NOT_EFFECTIVE) {
    if (power && !(flags & MOVE_RESULT_NO_EFFECT)) {
      if (flags & MOVE_RESULT_SUPER_EFFECTIVE) flags &= ~MOVE_RESULT_SUPER_EFFECTIVE;
      else flags |= MOVE_RESULT_NOT_VERY_EFFECTIVE;
    }
  } else if (multiplier === TYPE_MUL_SUPER_EFFECTIVE) {
    if (power && !(flags & MOVE_RESULT_NO_EFFECT)) {
      if (flags & MOVE_RESULT_NOT_VERY_EFFECTIVE) flags &= ~MOVE_RESULT_NOT_VERY_EFFECTIVE;
      else flags |= MOVE_RESULT_SUPER_EFFECTIVE;
    }
  }
  return flags;
}

/** AI_TypeCalc, src/battle_script_commands.c:1594-1636. */
export function aiTypeCalc(move, targetSpecies, targetAbility) {
  if (move === "MOVE_STRUGGLE") return 0;
  let flags = 0;
  const [type1, type2] = SPECIES[targetSpecies].types;
  const moveType = MOVES[move].type;
  if (targetAbility === "ABILITY_LEVITATE" && moveType === "TYPE_GROUND") {
    flags = MOVE_RESULT_MISSED | MOVE_RESULT_DOESNT_AFFECT_FOE;
  } else {
    for (const [atk, def, mul] of TYPE_CHART) {
      if (atk === "TYPE_ENDTABLE") break;
      if (atk === "TYPE_FORESIGHT") continue;
      if (atk === moveType) {
        if (def === type1) flags = modulate(mul, move, flags);
        if (def === type2 && type1 !== type2) flags = modulate(mul, move, flags);
      }
    }
  }
  const both = MOVE_RESULT_SUPER_EFFECTIVE | MOVE_RESULT_NOT_VERY_EFFECTIVE;
  if (targetAbility === "ABILITY_WONDER_GUARD"
    && (!(flags & MOVE_RESULT_SUPER_EFFECTIVE) || (flags & both) === both)
    && MOVES[move].power)
    flags |= MOVE_RESULT_DOESNT_AFFECT_FOE;
  return flags;
}

/** src/battle_dome.c:5243-5250. */
export function scoringPower(move) {
  const power = MOVES[move].power;
  if (power === 0) return 40;
  if (power === 1) return 60;
  if (move === "MOVE_SELF_DESTRUCT" || move === "MOVE_EXPLOSION") return power >> 1;
  return power;
}

/** One move vs one target, src/battle_dome.c:5267-5277. */
export function movePoints(move, targetSpecies, targetAbility) {
  const power = scoringPower(move);
  const v = aiTypeCalc(move, targetSpecies, targetAbility);
  if (v & MOVE_RESULT_NOT_VERY_EFFECTIVE && v & MOVE_RESULT_SUPER_EFFECTIVE) return power;
  if (v & MOVE_RESULT_NO_EFFECT) return 0;
  if (v & MOVE_RESULT_SUPER_EFFECTIVE) return power * 2;
  if (v & MOVE_RESULT_NOT_VERY_EFFECTIVE) return power >> 1;
  return power;
}

/** All totals one move can score vs the loser's 3 species. The ability is
 *  abilities[Random32() & 1], drawn per (move, target) — :5256-5265. */
export function possibleScores(move, loserSpecies) {
  let totals = new Set([0]);
  for (const sp of loserSpecies) {
    const opts = new Set(SPECIES[sp].abilities.map((ab) => movePoints(move, sp, ab)));
    const next = new Set();
    for (const t of totals) for (const o of opts) next.add(t + o);
    totals = next;
  }
  return totals;
}

/** Moves the repeat check skips for this round: `for (i = 0; i < roundId - 1; i++)`
 *  (:5297) — rounds 0 and 1 skip nothing, round 2 skips round 0's move only. */
export function excludedMoves(shownByRound, roundId) {
  const out = new Set();
  for (let i = 0; i < roundId - 1; i++) if (shownByRound[i]) out.add(shownByRound[i]);
  return out;
}

const lexLess = (a, b) => a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]);

/** Could GetWinningMove (src/battle_dome.c:5221-5331) return `shown` for a
 *  winner with these 12 move slots? Result rule, with E = excluded moves and
 *  N = slots not in E: if some N slot scores > 0, the best N slot by
 *  (score, move id); otherwise the best of all 12 (:5328-5329). Scores are
 *  drawn independently per slot, so the shown slot takes its best score and
 *  every rival its worst. */
export function canShow(teamMoves, loserSpecies, shown, excluded = new Set()) {
  const entries = teamMoves.map((m) => {
    const s = possibleScores(m, loserSpecies);
    return { m, id: MOVES[m].id, max: Math.max(...s), min: Math.min(...s) };
  });
  const shownId = MOVES[shown].id;
  const inN = entries.filter((e) => !excluded.has(e.m));
  if (!excluded.has(shown)) {
    for (const e of inN) {
      if (e.m !== shown || e.max === 0) continue;
      const best = [e.max, shownId];
      if (inN.every((r) => r.m === shown || lexLess([r.min, r.id], best))) return true;
    }
  }
  if (inN.every((e) => e.min === 0)) {
    for (const e of entries) {
      if (e.m !== shown) continue;
      const best = [excluded.has(e.m) ? e.max : 0, shownId];
      if (entries.every((r) => r.m === shown || lexLess([excluded.has(r.m) ? r.min : 0, r.id], best))) return true;
    }
  }
  return false;
}

export const teamMoves = (team) => team.flatMap((i) => MONS[i].moves);

/** wins: [{ move: MOVE_*|null, loser: [3 SPECIES_*]|null }] in round order. */
export function winsConsistent(team, wins) {
  const moves = teamMoves(team);
  const shown = wins.map((w) => w.move);
  for (let r = 0; r < wins.length; r++) {
    const w = wins[r];
    if (!w.move) continue;
    if (!w.loser) { if (!moves.includes(w.move)) return false; continue; }
    if (!canShow(moves, w.loser, w.move, excludedMoves(shown, r))) return false;
  }
  return true;
}

// ── the whole narrowing, step by step ──────────────────────────────────────

/** clues: { trainerId, species: [3], style: idx|null, stat: idx|null, wins: [...] }
 *  Returns the surviving teams and the count after each clue. */
export function narrow(clues, level = 50) {
  const steps = [];
  let teams = candidateTeams(clues.trainerId, clues.species, level);
  steps.push({ clue: "species", left: teams.length });
  if (clues.style != null) {
    teams = teams.filter((t) => battleStyle(t) === clues.style);
    steps.push({ clue: "style", left: teams.length });
  }
  if (clues.stat != null) {
    teams = teams.filter((t) => statLine(t) === clues.stat);
    steps.push({ clue: "stat", left: teams.length });
  }
  const wins = clues.wins ?? [];
  for (let r = 0; r < wins.length; r++) {
    if (!wins[r].move) continue;
    const upTo = wins.slice(0, r + 1);
    teams = teams.filter((t) => winsConsistent(t, upTo));
    steps.push({ clue: `win${r}`, left: teams.length });
  }
  return { teams, steps };
}

/** For each species: which of its sets survive, and in how many teams. */
export function setBreakdown(teams, species) {
  return species.map((sp) => {
    const counts = new Map();
    for (const t of teams) for (const i of t) if (MONS[i].species === sp) counts.set(i, (counts.get(i) ?? 0) + 1);
    return { species: sp, sets: [...counts.entries()].sort((a, b) => a[0] - b[0]).map(([i, n]) => ({ i, teams: n })) };
  });
}

// ── which 2 of the 3 they bring, and who leads ─────────────────────────────
// Decided when the battle starts, after you picked your 2 (the pre-battle
// script runs dome_reduceparty before the battle room's dome_initopponentparty,
// data/maps/BattleFrontier_BattleDome{PreBattleRoom,BattleRoom}/scripts.inc).
// ReducePlayerPartyToSelectedMons (src/script_pokemon_util.c:209) zeroes the
// rest of the party, so the opponent's scoring loop over gPlayerParty[0..2]
// also scores an EMPTY slot 3: SPECIES_NONE, whose gSpeciesInfo entry is {0}
// = Normal/Normal, ability 0 (src/data/pokemon/species_info.h:37).

const TYPE_x0 = 0, TYPE_x0_25 = 5, TYPE_x0_50 = 10, TYPE_x1 = 20, TYPE_x2 = 40, TYPE_x4 = 80; // battle_dome.c:2936-2941
const EMPTY_SLOT = { types: ["TYPE_NORMAL", "TYPE_NORMAL"], abilities: ["ABILITY_NONE", "ABILITY_NONE"] };
export const PICK_MODES = ["GOOD", "BAD"];

/** GetTypeEffectivenessPoints, src/battle_dome.c:2801-2933, modes GOOD / BAD.
 *  targetSpecies null = the empty party slot. Bugs kept: Levitate vs Ground
 *  sets 8 but doesn't return (GOOD: stays x1 -> 2; BAD: 8 hits the default
 *  -> 0); Wonder Guard compares against TYPE_x2 (40), which the chart never
 *  holds, so every multiplier is skipped. */
export function effectivenessPoints(move, targetSpecies, mode) {
  if (move === "MOVE_NONE" || MOVES[move].power === 0) return 0;
  const info = targetSpecies ? SPECIES[targetSpecies] : EMPTY_SLOT;
  const [defType1, defType2] = info.types;
  const defAbility = info.abilities[0];
  const moveType = MOVES[move].type;
  let typePower = TYPE_x1;
  if (defAbility === "ABILITY_LEVITATE" && moveType === "TYPE_GROUND") {
    if (mode === "BAD") typePower = 8;
  } else {
    for (const [atk, def, mul] of TYPE_CHART) {
      if (atk === "TYPE_ENDTABLE") break;
      if (atk === "TYPE_FORESIGHT") continue;
      if (atk === moveType) {
        const ok = defAbility !== "ABILITY_WONDER_GUARD" || mul === TYPE_x2;
        if (def === defType1 && ok) typePower = Math.trunc((typePower * mul) / 10);
        if (def === defType2 && defType1 !== defType2 && ok) typePower = Math.trunc((typePower * mul) / 10);
      }
    }
  }
  if (mode === "GOOD") return { [TYPE_x1]: 2, [TYPE_x2]: 4, [TYPE_x4]: 8 }[typePower] ?? 0;
  return { [TYPE_x0]: 8, [TYPE_x0_25]: 4, [TYPE_x0_50]: 2, [TYPE_x2]: -2, [TYPE_x4]: -4 }[typePower] ?? 0;
}

/** SelectOpponentMons_Good/_Bad points (battle_dome.c:2679-2733): each of the
 *  opponent's 3 sets, summed over its 4 moves x your 3 party slots. */
export function pickPoints(teamInCardOrder, yourTwo, mode) {
  const targets = [yourTwo[0], yourTwo[1], null];
  return teamInCardOrder.map((i) => MONS[i].moves.reduce((s, mv) =>
    s + targets.reduce((t, sp) => t + effectivenessPoints(mv, sp, mode), 0), 0));
}

/** SelectOpponentMonsFromParty (battle_dome.c:2736-2797) as a distribution:
 *  Map(bitmask -> probability). Bitmask 0 = "all three tied, not allowed to
 *  pick at random" (the caller then tries the other mode). Each coin flip
 *  (Random() & 1 on a tie) is enumerated. */
export function selectFromParty(points, allowRandom) {
  const out = new Map();
  const add = (k, p) => out.set(k, (out.get(k) ?? 0) + p);
  if (points[0] === points[1] && points[0] === points[2]) {
    if (!allowRandom) return new Map([[0, 1]]);
    // draws Random() & 3, rejecting 3 and repeats: each pair 1/3
    for (const k of [0b011, 0b101, 0b110]) add(k, 1 / 3);
    return out;
  }
  const walk = (p, pos, i, j, prob) => {
    if (i === 2) { add((1 << pos[0]) | (1 << pos[1]), prob); return; }
    const [ni, nj] = j + 1 < 3 ? [i, j + 1] : [i + 1, i + 2];
    p = p.slice(); pos = pos.slice();
    if (p[i] < p[j]) { [p[i], p[j]] = [p[j], p[i]]; [pos[i], pos[j]] = [pos[j], pos[i]]; }
    if (p[i] === p[j]) {
      const sp = p.slice(), spos = pos.slice();
      [sp[i], sp[j]] = [sp[j], sp[i]]; [spos[i], spos[j]] = [spos[j], spos[i]];
      walk(sp, spos, ni, nj, prob / 2);
      walk(p, pos, ni, nj, prob / 2);
    } else walk(p, pos, ni, nj, prob);
  };
  walk(points, [0, 1, 2], 0, 1, 1);
  return out;
}

/** GetDomeTrainerSelectedMons (battle_dome.c:2651-2668) + the lead from
 *  CreateDomeOpponentMons (:2615-2648): Random() % 10 > 5 (4 in 10) creates
 *  from the front, so the earlier card slot leads; otherwise (6 in 10) the
 *  later one does. teamInCardOrder: set indices, card top to bottom.
 *  Returns { pairs: Map(bitmask -> p), lead: [p slot0, p slot1, p slot2],
 *            byMode: { GOOD: Map, BAD: Map } } */
export function opponentPick(teamInCardOrder, yourTwo) {
  const pts = { GOOD: pickPoints(teamInCardOrder, yourTwo, "GOOD"), BAD: pickPoints(teamInCardOrder, yourTwo, "BAD") };
  const firstThen = (a, b) => {
    const first = selectFromParty(pts[a], false);
    if (!first.has(0)) return first;
    return selectFromParty(pts[b], true);
  };
  const byMode = { GOOD: firstThen("GOOD", "BAD"), BAD: firstThen("BAD", "GOOD") };
  const pairs = new Map();
  for (const m of PICK_MODES) for (const [k, p] of byMode[m]) pairs.set(k, (pairs.get(k) ?? 0) + p / 2);
  const lead = [0, 0, 0];
  for (const [k, p] of pairs) {
    const slots = [0, 1, 2].filter((s) => k & (1 << s));
    lead[slots[0]] += p * 0.4;
    lead[slots[1]] += p * 0.6;
  }
  return { pairs, lead, byMode, points: pts };
}
