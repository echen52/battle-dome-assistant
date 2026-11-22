// data/dome_data.mjs re-checked against sources it was NOT generated from:
//   * gBattleFrontierMons parsed straight from the decomp header (the generator
//     used the tower_extract JSON instead)
//   * move power/type re-read line by line from src/data/battle_moves.h
//   * battle-style move points vs the user's movesdata.csv (independent
//     hand-made table): exactly one known difference, Constrict, which the
//     decomp gives a STATUS point (src/battle_dome.c:303) and no set uses
//   * trainer pools vs the user's trainers.csv (the CSV has one GILLIAN row,
//     the early Lady, id 16 — the Cooltrainer GILLIAN 227 is missing there)
// Skips cleanly (exit 0, says so) if the decomp or the CSV folder is absent.
import { readFileSync, existsSync } from "node:fs";
import { MONS, MOVES, TRAINERS, STYLE_THRESHOLDS, STYLE_TEXTS, STAT_TEXTS, MOVE_POINT_TYPES, DOME_BRAIN, NATURE_STAT_TABLE } from "../data/dome_data.mjs";
import { check, finish } from "./util.mjs";

const DECOMP = new URL("../../pokeemerald/", import.meta.url);
const CSVDIR = new URL("../../Dome Assistant/", import.meta.url);

// shape
check(MONS.length === 882 && TRAINERS.length === 300 && Object.keys(MOVES).length === 355, "table sizes");
check(STYLE_THRESHOLDS.length === 31 && STYLE_TEXTS.length === 32 && STAT_TEXTS.length === 43, "text table sizes");
check(STYLE_TEXTS[27] === "Uses a well-balanced mix of moves.", "style 27 text");
check(STAT_TEXTS[42] === "Raises POKéMON in a well-balanced way.", "balanced text");
check(STYLE_THRESHOLDS[27].every((x) => x === 0), "BALANCED has no thresholds");

// Tucker's Level 50 Speeds, worked by hand from frontier_util.c:
//   Gold Latias 110 base, IV 31, 6 EV, Modest: (220+31+1)*50/100+5 = 131
//   Gold Metagross 70, IV 31, 0 EV, Brave: (171*50/100+5)=90 -> 90*0.9 = 81
//   Silver Charizard 100, IV 20, 152 EV (38), Quiet: 258*50/100+5 = 134 -> 120
const brainSpeeds = (k) => DOME_BRAIN[k].map((m) => `${m.species.slice(8)} ${m.speed}`).join();
check(brainSpeeds("silver") === "SWAMPERT 67,SALAMENCE 127,CHARIZARD 120", `silver speeds ${brainSpeeds("silver")}`);
check(brainSpeeds("gold") === "SWAMPERT 72,METAGROSS 81,LATIAS 131", `gold speeds ${brainSpeeds("gold")}`);
check(DOME_BRAIN.silver.every((m) => m.iv === 20) && DOME_BRAIN.gold.every((m) => m.iv === 31), "brain IVs 20 / 31");
// a few regular sets by hand (IV 3)
//   Sunkern 1: base 30, no Speed EV, Relaxed: (63*50/100+5)=36 -> 32
//   Suicune 6: base 85, HP/Def/SpDef, Modest: 173*50/100+5 = 91
check(MONS[0].speed === 32 && MONS[881].speed === 91, "hand-checked set speeds");

if (existsSync(DECOMP)) {
  const src = readFileSync(new URL("src/data/battle_frontier/battle_frontier_mons.h", DECOMP), "utf8");
  const entries = src.split(/\n\s*\[FRONTIER_MON_\w+\]\s*=\s*\{/).slice(1);
  check(entries.length === 882, `decomp header has ${entries.length} mons`);
  const EVB = { HP: 0, ATTACK: 1, DEFENSE: 2, SPEED: 3, SP_ATTACK: 4, SP_DEFENSE: 5 };
  entries.forEach((e, i) => {
    const m = MONS[i];
    check(e.includes(`.species = ${m.species},`), `mon ${i} species`);
    const mv = e.match(/\.moves\s*=\s*\{([^}]*)\}/)[1].split(",").map((s) => s.trim());
    check(mv.join() === m.moves.join(), `mon ${i} moves`);
    check(e.includes(`.itemTableId = ${m.itemTableId},`), `mon ${i} item`);
    check(new RegExp(`\\.nature\\s*=\\s*${m.nature}\\b`).test(e), `mon ${i} nature`);
    const bits = [...e.matchAll(/F_EV_SPREAD_(\w+)/g)].reduce((a, x) => a | (1 << EVB[x[1]]), 0);
    check(bits === m.evSpread, `mon ${i} EVs`);
  });
  // battle_moves.h, line state machine
  let cur = null;
  const seen = {};
  for (const line of readFileSync(new URL("src/data/battle_moves.h", DECOMP), "utf8").split("\n")) {
    const h = line.match(/^\s*\[(MOVE_\w+)\]\s*=/);
    if (h) { cur = h[1]; seen[cur] = {}; continue; }
    const p = line.match(/\.power\s*=\s*(\d+)/); if (p && cur) seen[cur].power = +p[1];
    const t = line.match(/\.type\s*=\s*(TYPE_\w+)/); if (t && cur) seen[cur].type = t[1];
  }
  for (const [c, m] of Object.entries(MOVES)) check(seen[c]?.power === m.power && seen[c]?.type === m.type, `move ${c}`);

  // Speed: base Speed re-read line by line, recomputed with a plain restatement.
  // The IV-3 premise is the unfixed call in CreateDomeOpponentMon.
  const domeC = readFileSync(new URL("src/battle_dome.c", DECOMP), "utf8");
  check(/#else\s*\n\s*u8 fixedIv = GetDomeTrainerMonIvs\(tournamentTrainerId\);/.test(domeC), "IV-3 bug call present");
  const baseSpe = {};
  let sp = null;
  for (const line of readFileSync(new URL("src/data/pokemon/species_info.h", DECOMP), "utf8").split("\n")) {
    const h = line.match(/^\s*\[(SPECIES_\w+)\]\s*=/);
    if (h) { sp = h[1]; continue; }
    const b = line.match(/\.baseSpeed\s*=\s*(\d+)/); if (b && sp && baseSpe[sp] == null) baseSpe[sp] = +b[1];
  }
  const spe = (species, iv, ev, nature) => {
    const raw = Math.trunc((2 * baseSpe[species] + iv + Math.trunc(ev / 4)) / 2) + 5;   // level 50: *50/100
    const f = NATURE_STAT_TABLE[nature][2];
    return f === 0 ? raw : Math.trunc(raw * (100 + 10 * f) / 100);
  };
  MONS.forEach((m) => {
    const n = [0, 1, 2, 3, 4, 5].filter((b) => m.evSpread & (1 << b)).length;
    const ev = m.evSpread & 8 ? Math.min(255, Math.trunc(510 / n)) : 0;   // n is 2 or 3 in this data
    check(spe(m.species, 3, ev, m.nature) === m.speed, `mon ${m.i} speed ${m.speed}`);
  });
  for (const m of [...DOME_BRAIN.silver, ...DOME_BRAIN.gold])
    check(spe(m.species, m.iv, m.evs[3], m.nature) === m.speed, `brain ${m.species} speed`);
} else console.log("(decomp not found — decomp re-parse skipped)");

if (existsSync(CSVDIR)) {
  const csv = (name) => readFileSync(new URL(name, CSVDIR), "utf8").replace(/^﻿/, "").trim().split(/\r?\n/).map((l) => l.split(","));
  const norm = (s) => s.toUpperCase().replace(/♂/g, "M").replace(/♀/g, "F").replace(/[^A-Z0-9]/g, "");
  const byNorm = {};
  for (const [c, m] of Object.entries(MOVES)) { byNorm[norm(m.name)] = c; byNorm[norm(c.slice(5))] = c; }
  const [head, ...rows] = csv("movesdata.csv");
  const col = { DMG: "DMG", ACCURATE: "ACCURATE", RARE: "RARE", EFFECT: "EFFECT", LOWPP: "LOW_PP", COMBO: "COMBO", POPULAR: "POPULAR", STATLOWER: "STAT_LOWER", POWERFUL: "POWERFUL", STRONG: "STRONG", LUCK: "LUCK", STATRAISE: "STAT_RAISE", HEAL: "HEAL", STATUS: "STATUS", RISKY: "RISKY", DEF: "DEF" };
  const diffs = [];
  for (const r of rows) {
    const c = byNorm[norm(r[0])];
    if (!c) continue;       // "Confusion Hit" — not a move constant
    for (const [k, v] of Object.entries(col)) {
      const csvv = +(r[head.indexOf(k)] || 0);
      if (csvv !== MOVES[c].stylePoints[MOVE_POINT_TYPES[`MOVE_POINTS_${v}`]]) diffs.push(`${c}.${v}`);
    }
  }
  check(diffs.join() === "MOVE_CONSTRICT.STATUS", `style points vs movesdata.csv: ${diffs}`);
  // pools vs trainers.csv (labels "Species N")
  const labelIdx = Object.fromEntries(MONS.map((m) => [norm(m.label), m.i]));
  const [, ...trows] = csv("trainers.csv");
  let compared = 0;
  for (const r of trows) {
    const ts = TRAINERS.filter((t) => t.name === r[0]);
    const pool = r.slice(2).filter((x) => x).map((x) => labelIdx[norm(x)]).sort((a, b) => a - b).join();
    check(ts.some((t) => [...t.pool].sort((a, b) => a - b).join() === pool), `pool ${r[0]}`);
    compared++;
  }
  check(compared === 299, "299 CSV trainers compared");
} else console.log("(Dome Assistant CSVs not found — CSV cross-check skipped)");
finish("data integrity");
