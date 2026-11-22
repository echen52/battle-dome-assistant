// team.mjs: Showdown exports and plain names -> 3 species.
import { readFileSync, existsSync } from "node:fs";
import { parseTeam, speciesFromLine } from "../team.mjs";
import { check, finish } from "./util.mjs";

const j = (r) => (r.species ?? []).join();
const showdown = `Bolt (Salamence) (M) @ Choice Band
Ability: Intimidate
Level: 50
EVs: 252 Atk / 4 Def / 252 Spe
Adamant Nature
- Dragon Claw
- Earthquake

Suicune @ Leftovers
Ability: Pressure
Modest Nature
- Surf

Snorlax (F) @ Chesto Berry
- Body Slam`;
check(j(parseTeam(showdown)) === "SPECIES_SALAMENCE,SPECIES_SUICUNE,SPECIES_SNORLAX", "showdown export");
check(j(parseTeam("salamence\n suicune \nSNORLAX")) === "SPECIES_SALAMENCE,SPECIES_SUICUNE,SPECIES_SNORLAX", "plain names, any case");
check(speciesFromLine("Mr. Mime @ Leftovers") === "SPECIES_MR_MIME", "Mr. Mime");
check(speciesFromLine("Farfetch'd") === "SPECIES_FARFETCHD", "Farfetch'd");
check(speciesFromLine("Nidoran♂ (M)") === "SPECIES_NIDORAN_M", "Nidoran♂");
check(speciesFromLine("Ho-Oh") === "SPECIES_HO_OH", "Ho-Oh");
check(parseTeam("Snorlax\nSuicune").error?.includes("exactly 3"), "two mons -> error");
check(parseTeam("Snorlax\nSnorlax\nMew").error?.includes("twice"), "duplicate -> error");
check(parseTeam("Snorlax\nNotamon\nMew").error?.includes("Notamon"), "unknown name -> error names it");
check(!!parseTeam("").error, "empty -> error");
// the user's real Palace team files, when present
const real = new URL("../../palace-solver/teams/user-test-team.txt", import.meta.url);
if (existsSync(real)) check(j(parseTeam(readFileSync(real, "utf8"))) === "SPECIES_METAGROSS,SPECIES_LATIOS,SPECIES_SWAMPERT", "palace-solver team file");
finish("team paste");
