// ── tools/check_ui.mjs — headless check of the page ───────────────────────
//   node tools/check_ui.mjs [--shots <dir>]
// Not in run_suite.mjs (needs a browser). playwright-core is borrowed read-only
// from the Arena tree, as the Tower site does; the server is node's http.
//
// Checks: no console errors; a generated tournament entered THROUGH THE UI
// gives the same count as engine.narrow() and lists the true team's sets; the
// "contradiction" message appears for an impossible clue; reset clears; no
// horizontal page scroll at 375px.
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { MONS, TRAINERS, SPECIES, STYLE_TEXTS, STAT_TEXTS, MOVES } from "../data/dome_data.mjs";
import { narrow, battleStyle, statLine, teamMoves, canShow } from "../engine.mjs";
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
const prettyClass = (c) => { const w = c.replace(/^FACILITY_CLASS_/, "").split("_"); const s = ["M", "F"].includes(w.at(-1)) ? ` (${w.pop()})` : ""; return w.map((x) => x[0] + x.slice(1).toLowerCase()).join(" ") + s; };

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
await page.fill("#trainerFilter", `${t.name} (${prettyClass(t.cls)})`);
for (let k = 0; k < 3; k++) await page.selectOption(`#species${k}`, cas.clues.species[k]);
await page.selectOption("#styleSelect", String(cas.clues.style));
await page.selectOption("#statSelect", String(cas.clues.stat));
await page.click('.seg label:has(input[value="1"])');
const w = cas.clues.wins[0];
await page.selectOption('#winRows select[aria-label="Round 1 move shown"]', w.move);
for (let k = 0; k < 3; k++) await page.selectOption(`#winRows select[aria-label="Round 1 beaten Pokémon ${k + 1}"]`, w.loser[k]);

const stepNums = await page.$$eval("#steps .step b", (bs) => bs.map((b) => +b.textContent));
check(stepNums.join() === cas.r.steps.map((s) => s.left).join(), `steps ui ${stepNums} vs engine ${cas.r.steps.map((s) => s.left)}`);
const summary = await page.textContent("#teamListSummary");
check(summary.includes(String(cas.r.teams.length)), `summary "${summary}" vs ${cas.r.teams.length}`);
const setNames = await page.$$eval("#breakdown .set-name", (tds) => tds.map((td) => td.textContent));
for (const i of cas.team) check(setNames.includes(`${SPECIES[MONS[i].species].name} ${MONS[i].ord}`), `true set ${MONS[i].label} not listed`);
const styleOpt = await page.$eval("#styleSelect", (s) => s.selectedOptions[0].textContent);
check(styleOpt.startsWith(STYLE_TEXTS[cas.clues.style]), `style option text "${styleOpt}"`);
if (shotsDir) await page.screenshot({ path: join(shotsDir, "desktop.png"), fullPage: true });

// an impossible stat clue -> contradiction message
const otherStat = [...Array(43).keys()].find((s) => !cas.r.teams.some((tm) => statLine(tm) === s) && s !== cas.clues.stat);
await page.selectOption("#statSelect", String(otherStat));
check(await page.isVisible("#message.bad"), "contradiction message not shown");

// reset
await page.click("#resetBtn");
check((await page.inputValue("#trainerFilter")) === "" && (await page.$$("#breakdown .species-block")).length === 0, "reset did not clear");

// mobile width
await page.setViewportSize({ width: 375, height: 800 });
await page.fill("#trainerFilter", `${t.name} (${prettyClass(t.cls)})`);
for (let k = 0; k < 3; k++) await page.selectOption(`#species${k}`, cas.clues.species[k]);
const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
check(overflow <= 0, `horizontal scroll at 375px: ${overflow}px`);
if (shotsDir) await page.screenshot({ path: join(shotsDir, "mobile.png"), fullPage: true });

check(errors.length === 0, `console errors: ${errors.join(" | ")}`);
await browser.close();
server.close();
console.log(`case: ${t.name} ${cas.clues.species.map((s) => SPECIES[s].name).join("/")} steps ${cas.r.steps.map((s) => s.left).join("→")}`);
console.log(fails ? `check_ui: ${fails} FAILURES` : "check_ui: ALL PASS");
process.exit(fails ? 1 : 0);
