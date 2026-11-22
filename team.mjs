// ── team.mjs — read the player's team from a paste ─────────────────────────
// Accepts a Showdown export (only the species matter for the Dome's 2-of-3
// pick — battle_dome.c:2679-2733 reads nothing else of your party) or plain
// species names, one per line. Pure; no DOM.
import { SPECIES } from "./data/dome_data.mjs";

const norm = (s) => s.toUpperCase().replace(/♂/g, "M").replace(/♀/g, "F").replace(/[^A-Z0-9]/g, "");
const BY_NAME = new Map();
for (const [c, s] of Object.entries(SPECIES)) { BY_NAME.set(norm(s.name), c); BY_NAME.set(norm(c.slice(8)), c); }

// Lines of a Showdown set that are not the header line.
const SET_LINE = /^(-|ability:|evs:|ivs:|level:|shiny:|happiness:|tera type:|hidden power:)|\bnature\s*$/i;

/** The species named on one header / plain line, or null. Handles
 *  "Nick (Species) (M) @ Item", "Species (F) @ Item", "Species". */
export function speciesFromLine(line) {
  let s = line.replace(/@.*$/, "").trim();
  s = s.replace(/\((M|F)\)\s*$/i, "").trim();
  const paren = s.match(/\(([^()]+)\)\s*$/);
  const name = paren ? paren[1] : s;
  return BY_NAME.get(norm(name)) ?? null;
}

/** -> { species: [3 SPECIES_*] } or { error: "..." } */
export function parseTeam(text) {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !SET_LINE.test(l));
  if (!lines.length) return { error: "Paste your team or type your 3 Pokémon, one per line." };
  const species = [];
  for (const l of lines) {
    const sp = speciesFromLine(l);
    if (!sp) return { error: `Couldn't read a Pokémon from "${l}".` };
    species.push(sp);
  }
  if (species.length !== 3) return { error: `Found ${species.length} Pokémon — the Dome needs exactly 3.` };
  if (new Set(species).size !== 3) return { error: "The same species is in the team twice." };
  return { species };
}
