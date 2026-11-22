// ── tools/check_ui.mjs — headless check of the page ───────────────────────
//   node tools/check_ui.mjs [--shots <dir>]
// Not in run_suite.mjs (needs a browser). playwright-core is borrowed read-only
// from the Arena tree, as the Tower site does; the server is node's http.
//
// Checks: no console errors; a generated tournament entered THROUGH THE UI
// gives the same count as engine.narrow() and lists the true team's sets; the
// "contradiction" message appears for an impossible clue; reset clears; the
// Speed column and Tucker's Silver/Gold table match the data at both levels; no
// horizontal page scroll at 375px.
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { MONS, TRAINERS, SPECIES, STYLE_TEXTS, STAT_TEXTS, MOVES, DOME_BRAIN } from "../data/dome_data.mjs";
import { narrow, battleStyle, statLine, teamMoves, canShow, opponentPick, trainerSpecies } from "../engine.mjs";
import { mulberry32, randomTeam, LATE_TRAINERS } from "../tests/util.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const ARENA = fileURLToPath(new URL("../../battle_arena_assistant/battle_arena_sim/noop.js", import.meta.url));
const { chromium } = createRequire(ARENA)("playwright-core");
const shotsDir = process.argv.includes("--shots") ? process.argv[process.argv.indexOf("--shots") + 1] : null;

const TYPES = { ".html": "text/html", ".mjs": "text/javascript", ".js": "text/javascript", ".css": "text/css" };
const server = createServer(async (req, res) => {
  try {
    const p = normalize(join(ROOT, decodeURIComponent(req.url.split("?")[0]) === "/" ? "index.html" : decodeURIComponent(req.url.split("?")[0])));
    if (!p.startsWith(ROOT)) throw new Error("outside");
    res.writeHead(200, { "content-type": TYPES[extname(p)] ?? "application/octet-stream" });
    res.end(await readFile(p));
  } catch { res.writeHead(404); res.end(); }
}).listen(0);
const url = `http://127.0.0.1:${server.address().port}/`;

let fails = 0;
const check = (c, m) => { if (!c) { fails++; console.log("FAIL:", m); } };

// a case with real ambiguity left after style+stat, and one win with a loser
const rng = mulberry32(99);
let cas;
for (;;) {
  const tid = rng.pick(LATE_TRAINERS);
  const team = randomTeam(rng, tid);
  const species = team.map((i) => MONS[i].species);
  const loser = randomTeam(rng, rng.pick(LATE_TRAINERS)).map((i) => MONS[i].species);
  const shown = teamMoves(team).find((m) => canShow(teamMoves(team), loser, m));
  const clues = { trainerId: tid, species, style: battleStyle(team), stat: statLine(team), wins: [{ move: shown, loser }] };
  const r = narrow(clues);
  if (r.steps[0].left >= 6 && r.teams.length >= 2) { cas = { team, clues, r }; break; }
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
page.on("pageerror", (e) => errors.push(String(e)));
await page.goto(url);

const t = TRAINERS[cas.clues.trainerId];
const titleCase = (x) => x.toLowerCase().replace(/(^|[\s\-.])([a-z])/g, (_, p, c) => p + c.toUpperCase());
// type into a combobox like a user (lower-case, as typed) and press Enter
async function pick(sel, text) {
  await page.click(sel);
  await page.fill(sel, text.toLowerCase());
  await page.keyboard.press("Enter");
}
const speciesSel = (k) => `#speciesCombos input[aria-label="Pokémon ${k + 1}"]`;
const enterTeam = async () => {
  await pick("#trainerInput", t.name);
  for (let k = 0; k < 3; k++) await pick(speciesSel(k), SPECIES[cas.clues.species[k]].name);
};
await enterTeam();
check((await page.inputValue("#trainerInput")) === titleCase(t.name), "trainer autofill");
await pick("#styleInput", STYLE_TEXTS[cas.clues.style]);
await pick("#statInput", STAT_TEXTS[cas.clues.stat]);
await page.click('.seg label:has(input[value="1"])');
const w = cas.clues.wins[0];
await pick('#winRows input[aria-label="Round 1 move shown"]', MOVES[w.move].name);
for (let k = 0; k < 3; k++) await pick(`#winRows input[aria-label="Round 1 beaten Pokémon ${k + 1}"]`, SPECIES[w.loser[k]].name);

const stepNums = await page.$$eval("#steps .step b", (bs) => bs.map((b) => +b.textContent));
check(stepNums.join() === cas.r.steps.map((s) => s.left).join(), `steps ui ${stepNums} vs engine ${cas.r.steps.map((s) => s.left)}`);
const summary = await page.textContent("#teamListSummary");
check(summary.includes(String(cas.r.teams.length)), `summary "${summary}" vs ${cas.r.teams.length}`);
const setNames = await page.$$eval("#breakdown .set-name", (tds) => tds.map((td) => td.textContent));
for (const i of cas.team) check(setNames.includes(`${SPECIES[MONS[i].species].name} ${MONS[i].ord}`), `true set ${MONS[i].label} not listed`);
check((await page.inputValue("#styleInput")).startsWith(STYLE_TEXTS[cas.clues.style]), "style text shown");
// Speed column: every listed set shows its precomputed IV-3 Speed for the level
const setSpeeds = () => page.$$eval("#breakdown tbody tr", (trs) => trs.map((tr) => [tr.querySelector(".set-name").textContent, tr.querySelector(".spe").textContent]));
const speedsOk = async (key) => {
  const got = await setSpeeds();
  const want = Object.fromEntries(MONS.map((m) => [`${SPECIES[m.species].name} ${m.ord}`, String(m[key])]));
  return got.length > 0 && got.every(([n, v]) => want[n] === v);
};
check(await speedsOk("spe50"), "L50 speed cells");
// Tucker panel: Silver by default, Gold on click
const tuckerRows = () => page.$$eval("#tuckerTable tbody tr", (trs) => trs.map((tr) => `${tr.querySelector(".set-name").textContent} ${tr.querySelector(".spe").textContent}`).join());
const want = (k, key = "spe50") => DOME_BRAIN[k].map((m) => `${SPECIES[m.species].name} ${m[key]}`).join();
check((await tuckerRows()) === want("silver"), `tucker silver: ${await tuckerRows()}`);
await page.click('.seg label:has(input[value="gold"])');
check((await tuckerRows()) === want("gold"), `tucker gold: ${await tuckerRows()}`);
// Level 100: Speeds switch, the narrowing matches engine.narrow at 100, then back
await page.click('.level-seg label:has(input[value="100"])');
check(await speedsOk("spe100"), "L100 speed cells");
check((await tuckerRows()) === want("gold", "spe100"), `tucker gold L100: ${await tuckerRows()}`);
const r100 = narrow(cas.clues, 100);
const steps100 = await page.$$eval("#steps .step b", (bs) => bs.map((b) => +b.textContent));
check(steps100.join() === r100.steps.map((x) => x.left).join(), `L100 steps ui ${steps100} vs engine ${r100.steps.map((x) => x.left)}`);
// species offered for the trainer follow the level (Open adds the high-tier sets)
const openOnly = trainerSpecies(t.id, 100).filter((x) => !trainerSpecies(t.id, 50).includes(x)).map((x) => SPECIES[x].name);
const offered = async () => { await page.click(speciesSel(0)); await page.fill(speciesSel(0), ""); const o = await page.$$eval("#speciesCombos .combo-list.open .combo-item", (els) => els.map((x) => x.textContent)); await page.keyboard.press("Escape"); return o; };
check(openOnly.length > 0, "case trainer has Open-only species");
const at100 = await offered();
await page.click('.level-seg label:has(input[value="50"])');
const at50 = await offered();
check(openOnly.every((n) => at100.includes(n) && !at50.includes(n)), `Open-only ${openOnly} offered at 100 only`);
check(await speedsOk("spe50"), "back to L50 speed cells");
if (shotsDir) await page.screenshot({ path: join(shotsDir, "desktop.png"), fullPage: true });

// ── your team: paste -> "Who they bring" matches the engine ──
const TEAM_A = "Salamence @ Choice Band\nAbility: Intimidate\n- Earthquake\n\nSuicune @ Leftovers\n- Surf\n\nSnorlax @ Chesto Berry\n- Body Slam";
const TEAM_B = "Metagross\nLatios\nSwampert";
const sp = (t) => t.split(/\n/).filter((l) => l && !l.startsWith("-") && !l.includes(":")).map((l) => l.replace(/ @.*/, "").toUpperCase());
function expectedRows(yourNames) {
  const you = yourNames.map((n) => Object.keys(SPECIES).find((k) => SPECIES[k].name.toUpperCase() === n));
  const n = cas.r.teams.length;
  return [[0, 1], [0, 2], [1, 2]].map(([a, b]) => {
    const pair = [you[a], you[b]];
    const agg = new Map(), lead = [0, 0, 0];
    for (const tm of cas.r.teams) {
      const order = cas.clues.species.map((s) => tm.find((i) => MONS[i].species === s));
      const r = opponentPick(order, pair);
      for (const [k, p] of r.pairs) agg.set(k, (agg.get(k) ?? 0) + p / n);
      r.lead.forEach((p, s) => { lead[s] += p / n; });
    }
    const top = [...agg.entries()].sort((x, y) => y[1] - x[1])[0];
    return { you: pair.map((s) => SPECIES[s].name).join(" + "), topPct: Math.round(top[1] * 100) };
  });
}
async function pageRows() {
  return page.$$eval("#pickTable tbody tr", (trs) => trs.map((tr) => ({
    you: tr.children[0].textContent, topPct: parseInt(tr.children[1].querySelector("b").textContent, 10) })));
}
await page.fill("#teamText", TEAM_A);
check((await page.textContent("#teamMsg")).includes("Salamence · Suicune · Snorlax"), "team A parsed");
let rows = await pageRows();
check(JSON.stringify(rows) === JSON.stringify(expectedRows(sp(TEAM_A))), `pick rows A ${JSON.stringify(rows)} vs ${JSON.stringify(expectedRows(sp(TEAM_A)))}`);
await page.fill("#teamName", "Team A"); await page.click("#saveTeam");
await page.fill("#teamText", TEAM_B);
await page.fill("#teamName", "Team B"); await page.click("#saveTeam");
rows = await pageRows();
check(JSON.stringify(rows) === JSON.stringify(expectedRows(sp(TEAM_B))), "pick rows B");
// toggle saved teams
await page.selectOption("#savedTeams", "Team A");
check((await page.inputValue("#teamText")) === TEAM_A, "saved team A loads its text");
check(JSON.stringify(await pageRows()) === JSON.stringify(expectedRows(sp(TEAM_A))), "toggling back to A updates the table");
const savedNames = await page.$$eval("#savedTeams option", (os) => os.map((o) => o.value).filter(Boolean));
check(savedNames.join() === "Team A,Team B", `saved list ${savedNames}`);
// Reset keeps your team
await page.click("#resetBtn");
check((await page.inputValue("#teamText")) === TEAM_A && (await page.inputValue("#savedTeams")) === "Team A", "Reset keeps your team");
// a reload restores the team in use and the saved list
await page.reload();
check((await page.inputValue("#teamText")) === TEAM_A && (await page.inputValue("#savedTeams")) === "Team A", "reload restores the team in use");
await page.selectOption("#savedTeams", "Team B");
await page.click("#deleteTeam");
check((await page.$$eval("#savedTeams option", (os) => os.map((o) => o.value).filter(Boolean))).join() === "Team A", "delete removes Team B");
await page.selectOption("#savedTeams", "Team A");
// re-enter the case for the checks below
await enterTeam();
await pick("#styleInput", STYLE_TEXTS[cas.clues.style]);
await pick("#statInput", STAT_TEXTS[cas.clues.stat]);
if (shotsDir) await page.screenshot({ path: join(shotsDir, "desktop_team.png"), fullPage: true });

// partial typing narrows the list (starts-with first)
await page.click("#trainerInput");
await page.fill("#trainerInput", t.name.slice(0, 3).toLowerCase());
const items = await page.$$eval("#trainerCombo .combo-item", (els) => els.map((e) => e.textContent));
check(items.length > 0 && items.every((x) => x.toLowerCase().includes(t.name.slice(0, 3).toLowerCase())), `filter list ${items.slice(0, 5)}`);
check(items[0].toLowerCase().startsWith(t.name.slice(0, 3).toLowerCase()), "starts-with matches first");
check(!items.some((x) => x.includes("(")), "trainer labels carry no class");
await page.keyboard.press("Escape");
check((await page.inputValue("#trainerInput")) === titleCase(t.name), "Escape restores the value");
await page.click("h1");

// an impossible stat clue -> contradiction message
const otherStat = [...Array(43).keys()].find((s) => !cas.r.teams.some((tm) => statLine(tm) === s) && s !== cas.clues.stat);
await pick("#statInput", STAT_TEXTS[otherStat]);
check(await page.isVisible("#message.bad"), "contradiction message not shown");

// reset
await page.click("#resetBtn");
check((await page.inputValue("#trainerInput")) === "" && (await page.$$("#breakdown .species-block")).length === 0, "reset did not clear");

// mobile width
await page.setViewportSize({ width: 375, height: 800 });
await enterTeam();
const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
check(overflow <= 0, `horizontal scroll at 375px: ${overflow}px`);
if (shotsDir) await page.screenshot({ path: join(shotsDir, "mobile.png"), fullPage: true });

check(errors.length === 0, `console errors: ${errors.join(" | ")}`);
await browser.close();
server.close();
console.log(`case: ${t.name} ${cas.clues.species.map((s) => SPECIES[s].name).join("/")} steps ${cas.r.steps.map((s) => s.left).join("→")}`);
console.log(fails ? `check_ui: ${fails} FAILURES` : "check_ui: ALL PASS");
process.exit(fails ? 1 : 0);
