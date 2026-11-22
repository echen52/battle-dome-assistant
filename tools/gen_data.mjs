// ── tools/gen_data.mjs ─────────────────────────────────────────────────────
// GENERATOR for data/dome_data.mjs — every table the site uses, read from the
// pokeemerald decomp (pinned below) plus the earlier frontier extraction in
// ../tower_extract (gBattleFrontierMons + trainer pools, macro-expanded).
//
//   node tools/gen_data.mjs [path/to/pokeemerald]
//
// Not run by the suite. tests/test_data_integrity.mjs re-parses the decomp
// independently and compares, so a hand-edit to the data module fails.

import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";

const DECOMP = process.argv[2] ?? new URL("../../pokeemerald/", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const EXTRACT = new URL("../../tower_extract/", import.meta.url);
const PIN = "a3c551fe21a6a4d4beb89a82404cf776a6dae635";

const commit = execSync("git rev-parse HEAD", { cwd: DECOMP }).toString().trim();
if (commit !== PIN) throw new Error(`decomp at ${commit}, expected ${PIN}`);

const read = (rel) => readFileSync(`${DECOMP}/${rel}`, "utf8");
const readJson = (name) => JSON.parse(readFileSync(new URL(name, EXTRACT), "utf8"));

export function defines(text, prefix) {
  const out = {};
  for (const m of text.matchAll(new RegExp(`^#define\\s+(${prefix}\\w*)\\s+(\\d+)\\b`, "gm"))) out[m[1]] = +m[2];
  return out;
}
export function blocks(text, prefix) {
  const heads = [...text.matchAll(new RegExp(`^\\s*\\[(${prefix}\\w+)\\]\\s*=`, "gm"))];
  return heads.map((m, i) => [m[1], text.slice(m.index + m[0].length, i + 1 < heads.length ? heads[i + 1].index : text.length)]);
}
const textTable = (text, prefix) =>
  Object.fromEntries([...text.matchAll(new RegExp(`\\[(${prefix}\\w+)\\]\\s*=\\s*_\\("([^"]*)"\\)`, "g"))].map((m) => [m[1], m[2]]));
const arrayBody = (text, name) => {
  const start = text.indexOf(name);
  if (start < 0) throw new Error(`missing ${name}`);
  const open = text.indexOf("{", start);
  return text.slice(open + 1, text.indexOf("\n};", open));
};

// "THUNDERBOLT" -> "Thunderbolt", "DOUBLE-EDGE" -> "Double-Edge", "MR. MIME" -> "Mr. Mime"
const titleCase = (s) => s.toLowerCase().replace(/(^|[\s\-.(])([a-z])/g, (_, p, c) => p + c.toUpperCase());

// ── moves ──
const moveIds = defines(read("include/constants/moves.h"), "MOVE_");
delete moveIds.MOVES_COUNT;
const moveNames = textTable(read("src/data/text/move_names.h"), "MOVE_");
const MOVES = {};
for (const [c, body] of blocks(read("src/data/battle_moves.h"), "MOVE_")) {
  MOVES[c] = {
    id: moveIds[c],
    name: c === "MOVE_NONE" ? "(empty slot)" : titleCase(moveNames[c]),
    power: +body.match(/\.power\s*=\s*(\d+)/)[1],
    type: body.match(/\.type\s*=\s*(TYPE_\w+)/)[1],
  };
}
if (Object.keys(MOVES).length !== 355) throw new Error("expected 355 moves");

// battle style move points: sBattleStyleMovePoints (src/battle_dome.c:170)
const dome = read("src/battle_dome.c");
const domeH = read("include/constants/battle_dome.h");
const POINT_TYPES = defines(domeH, "MOVE_POINTS_");
const NUM_POINT_TYPES = Object.keys(POINT_TYPES).length;
const parsePoints = (body) => {
  const arr = Array(NUM_POINT_TYPES).fill(0);
  for (const m of body.matchAll(/\[(MOVE_POINTS_\w+)\]\s*=\s*(\d+)/g)) arr[POINT_TYPES[m[1]]] = +m[2];
  return arr;
};
const pointsBody = arrayBody(dome, "sBattleStyleMovePoints[MOVES_COUNT]");
let pointsCount = 0;
for (const [c, body] of blocks(pointsBody, "MOVE_")) { MOVES[c].stylePoints = parsePoints(body); pointsCount++; }
if (pointsCount !== 355) throw new Error(`style points for ${pointsCount} moves`);

// ── battle styles ──
const STYLE_IDS = defines(domeH, "DOME_BATTLE_STYLE_");
const thrBody = arrayBody(dome, "sBattleStyleThresholds[NUM_BATTLE_STYLES - 1]");
const STYLE_THRESHOLDS = [];
for (const [c, body] of blocks(thrBody, "DOME_BATTLE_STYLE_")) STYLE_THRESHOLDS[STYLE_IDS[c]] = parsePoints(body);
const NUM_BATTLE_STYLES = STYLE_IDS.NUM_BATTLE_STYLES ?? Math.max(...Object.values(STYLE_IDS)) + 1;
if (STYLE_THRESHOLDS.length !== NUM_BATTLE_STYLES - 1 || STYLE_THRESHOLDS.includes(undefined))
  throw new Error("thresholds table shape");

// texts from data/text/battle_dome.inc
const inc = read("data/text/battle_dome.inc");
const STRINGS = {};
for (const m of inc.matchAll(/^(\w+)::\s*\n((?:\s*\.string\s+"[^"]*"\s*\n)+)/gm))
  STRINGS[m[1]] = [...m[2].matchAll(/"([^"]*)"/g)].map((x) => x[1]).join("").replace(/\$$/, "").replace(/\\n|\\l|\\p/g, " ");
const styleTextBody = arrayBody(dome, "sBattleDomeOpponentStyleTexts[NUM_BATTLE_STYLES]");
const STYLE_TEXTS = [];
for (const [c, body] of blocks(styleTextBody, "DOME_BATTLE_STYLE_")) STYLE_TEXTS[STYLE_IDS[c]] = STRINGS[body.match(/(\w+)/)[1]];
const statTextBody = arrayBody(dome, "sBattleDomeOpponentStatsTexts[]");
const STAT_TEXTS = [];
for (const line of statTextBody.split("\n")) {
  const sym = line.match(/(BattleDome_Text_\w+)/);
  if (!sym) continue;
  const idx = line.match(/\[(DOME_TEXT_\w+)\]/);
  const at = idx ? defines(domeH, "DOME_TEXT_")[idx[1]] : STAT_TEXTS.length;
  STAT_TEXTS[at] = STRINGS[sym[1]];
}
const DOME_TEXT = defines(domeH, "DOME_TEXT_");
const statOffsetsBody = arrayBody(dome, "sStatTextOffsets[NUM_STATS - 1]");
const STAT_TEXT_OFFSETS = [...statOffsetsBody.matchAll(/(DOME_TEXT_\w+)/g)].map((m) => DOME_TEXT[m[1]]);
if (STAT_TEXTS.length !== 43 || STAT_TEXTS.includes(undefined)) throw new Error("stat texts shape");

// ── species ──
const speciesIds = defines(read("include/constants/species.h"), "SPECIES_");
const speciesNames = textTable(read("src/data/text/species_names.h"), "SPECIES_");
const SPECIES = {};
for (const [c, body] of blocks(read("src/data/pokemon/species_info.h"), "SPECIES_")) {
  const t = body.match(/\.types\s*=\s*\{\s*(TYPE_\w+)\s*,\s*(TYPE_\w+)\s*\}/);
  const a = body.match(/\.abilities\s*=\s*\{\s*(ABILITY_\w+)\s*,\s*(ABILITY_\w+)\s*\}/);
  if (!t || !a) continue;
  SPECIES[c] = { id: speciesIds[c], name: titleCase(speciesNames[c]), types: [t[1], t[2]], abilities: [a[1], a[2]] };
}

// ── type chart, table order kept (src/battle_main.c gTypeEffectiveness) ──
const MUL = defines(read("include/battle_main.h"), "TYPE_MUL_");
const chartToks = [...arrayBody(read("src/battle_main.c"), "gTypeEffectiveness[").matchAll(/TYPE_\w+/g)].map((m) => m[0]);
const TYPE_CHART = [];
for (let i = 0; i < chartToks.length; i += 3) TYPE_CHART.push([chartToks[i], chartToks[i + 1], MUL[chartToks[i + 2]]]);
if (TYPE_CHART.at(-1)[0] !== "TYPE_ENDTABLE") throw new Error("type chart end");

// ── natures: gNatureStatTable (src/pokemon.c:1365), columns Atk Def Speed SpAtk SpDef ──
const natureIds = defines(read("include/constants/pokemon.h"), "NATURE_");
const NATURE_STAT_TABLE = {};
for (const m of arrayBody(read("src/pokemon.c"), "gNatureStatTable[NUM_NATURES]").matchAll(/\[(NATURE_\w+)\]\s*=\s*\{([^}]*)\}/g))
  NATURE_STAT_TABLE[m[1]] = m[2].split(",").map((x) => parseInt(x.trim(), 10));
if (Object.keys(NATURE_STAT_TABLE).length !== 25) throw new Error("nature table");

// ── items (display names) ──
const ITEM_NAMES = {};
for (const [c, body] of blocks(read("src/data/items.h"), "ITEM_")) {
  const n = body.match(/\.name\s*=\s*_\("([^"]*)"\)/);
  if (n) ITEM_NAMES[c] = titleCase(n[1]);
}

// ── frontier mons + trainers (tower_extract, same pinned commit) ──
const monsRaw = readJson("frontier_mons.json");
const trainersRaw = readJson("trainers.json");
if (trainersRaw.source.repoCommit !== PIN) throw new Error("extraction commit mismatch");
const EV_BIT = { F_EV_SPREAD_HP: 0, F_EV_SPREAD_ATTACK: 1, F_EV_SPREAD_DEFENSE: 2, F_EV_SPREAD_SPEED: 3, F_EV_SPREAD_SP_ATTACK: 4, F_EV_SPREAD_SP_DEFENSE: 5 };
const evConsts = defines(read("include/constants/battle_frontier.h").replace(/\(1 << (\d)\)/g, (_, b) => String(1 << +b)), "F_EV_SPREAD_");
for (const [k, b] of Object.entries(EV_BIT)) if (evConsts[k] !== 1 << b) throw new Error(`EV bit ${k}`);
const MONS = monsRaw.mons.map((m, i) => {
  if (m.index !== i) throw new Error("mon index");
  for (const mv of m.moves) if (!MOVES[mv]) throw new Error(`unknown move ${mv}`);
  return {
    i, species: m.species, label: m.speciesLabel, ord: m.speciesOrdinal, moves: m.moves,
    itemTableId: m.itemTableId, item: m.heldItem,
    nature: m.nature, evSpread: m.evSpreadFlags.reduce((acc, f) => acc | (1 << EV_BIT[f]), 0),
    openOnly: m.aboveHighTier,
  };
});
const monIndex = Object.fromEntries(monsRaw.mons.map((m) => [m.constant, m.index]));
const TRAINERS = trainersRaw.trainers.map((t) => ({
  id: t.id, name: t.name, cls: t.facilityClass, pool: t.pool.map((c) => monIndex[c]),
}));
if (TRAINERS.length !== 300) throw new Error("trainers");

const HIGH_TIER = defines(read("include/constants/battle_frontier_mons.h"), "FRONTIER_MONS_HIGH_TIER").FRONTIER_MONS_HIGH_TIER;
if (HIGH_TIER !== 849) throw new Error(`FRONTIER_MONS_HIGH_TIER = ${HIGH_TIER}`);

// ── emit ──
const J = (v) => JSON.stringify(v);
let out = `// ── data/dome_data.mjs ─────────────────────────────────────────────────────
// GENERATED by tools/gen_data.mjs — do not hand-edit.
// pokeemerald ${PIN}
//   moves:     include/constants/moves.h, src/data/battle_moves.h, src/data/text/move_names.h
//   style:     src/battle_dome.c sBattleStyleMovePoints, sBattleStyleThresholds,
//              sBattleDomeOpponentStyleTexts, sBattleDomeOpponentStatsTexts, sStatTextOffsets;
//              data/text/battle_dome.inc (strings)
//   species:   include/constants/species.h, src/data/pokemon/species_info.h, src/data/text/species_names.h
//   chart:     src/battle_main.c gTypeEffectiveness (table order, TYPE_MUL_* values)
//   natures:   src/pokemon.c gNatureStatTable (Atk, Def, Speed, SpAtk, SpDef)
//   items:     src/data/items.h (names)
//   sets/pools: ../tower_extract/frontier_mons.json, trainers.json (same commit)
// Re-verified by tests/test_data_integrity.mjs.

export const DECOMP_COMMIT = ${J(PIN)};
export const FRONTIER_MONS_HIGH_TIER = ${HIGH_TIER};
export const MOVE_POINT_TYPES = ${J(POINT_TYPES)};
export const STYLE_THRESHOLDS = ${J(STYLE_THRESHOLDS)};
export const STYLE_TEXTS = ${J(STYLE_TEXTS)};
export const STAT_TEXTS = ${J(STAT_TEXTS)};
export const STAT_TEXT_OFFSETS = ${J(STAT_TEXT_OFFSETS)};
export const DOME_TEXT = ${J(DOME_TEXT)};
export const NATURE_STAT_TABLE = ${J(NATURE_STAT_TABLE)};
export const TYPE_CHART = ${J(TYPE_CHART)};
export const ITEM_NAMES = ${J(ITEM_NAMES)};
export const SPECIES = {\n${Object.entries(SPECIES).map(([k, v]) => `  ${k}: ${J(v)},`).join("\n")}\n};
export const MOVES = {\n${Object.entries(MOVES).map(([k, v]) => `  ${k}: ${J(v)},`).join("\n")}\n};
// evSpread: bit 0 HP, 1 Atk, 2 Def, 3 Speed, 4 SpAtk, 5 SpDef (include/constants/battle_frontier.h:119-124)
export const MONS = [\n${MONS.map((m) => `  ${J(m)},`).join("\n")}\n];
export const TRAINERS = [\n${TRAINERS.map((t) => `  ${J(t)},`).join("\n")}\n];
`;
writeFileSync(new URL("../data/dome_data.mjs", import.meta.url), out);
console.log(`dome_data.mjs: ${Object.keys(MOVES).length} moves, ${Object.keys(SPECIES).length} species, ${MONS.length} sets, ${TRAINERS.length} trainers, ${STYLE_THRESHOLDS.length} thresholds, ${STAT_TEXTS.length} stat texts`);
