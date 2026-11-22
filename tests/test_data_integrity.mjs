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
import { MONS, MOVES, TRAINERS, STYLE_THRESHOLDS, STYLE_TEXTS, STAT_TEXTS, MOVE_POINT_TYPES } from "../data/dome_data.mjs";
import { check, finish } from "./util.mjs";

const DECOMP = new URL("../../pokeemerald/", import.meta.url);
const CSVDIR = new URL("../../Dome Assistant/", import.meta.url);

// shape
check(MONS.length === 882 && TRAINERS.length === 300 && Object.keys(MOVES).length === 355, "table sizes");
check(STYLE_THRESHOLDS.length === 31 && STYLE_TEXTS.length === 32 && STAT_TEXTS.length === 43, "text table sizes");
check(STYLE_TEXTS[27] === "Uses a well-balanced mix of moves.", "style 27 text");
check(STAT_TEXTS[42] === "Raises POKéMON in a well-balanced way.", "balanced text");
check(STYLE_THRESHOLDS[27].every((x) => x === 0), "BALANCED has no thresholds");

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
