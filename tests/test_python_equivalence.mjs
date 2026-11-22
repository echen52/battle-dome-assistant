// The JS engine against the Python Dome Assistant (tools/make_python_fixture.py):
//   * battle style: identical index on 1,500 random teams
//   * stat line: the JS text is one Python accepts (Python is looser on
//     2-good / 2-bad ties by design, so "in", not "equal")
//   * winning move: identical canShow verdicts
import { readFileSync } from "node:fs";
import { battleStyle, statLine, canShow, teamMoves } from "../engine.mjs";
import { check, finish } from "./util.mjs";

const fx = JSON.parse(readFileSync(new URL("./fixtures/python_cases.json", import.meta.url), "utf8"));

let stricter = 0;
for (const t of fx.teams) {
  check(battleStyle(t.entries) === t.style, `style ${t.entries}: js ${battleStyle(t.entries)} py ${t.style}`);
  const s = statLine(t.entries);
  check(t.statAccept.includes(s), `stat ${t.entries}: js ${s} not in py ${t.statAccept}`);
  if (t.statAccept.length > 1) stricter++;
}
for (const w of fx.wins) {
  const got = canShow(teamMoves(w.entries), w.loser, w.shown, new Set(w.excluded));
  check(got === w.canShow, `canShow ${w.entries} ${w.shown} excl ${w.excluded}: js ${got} py ${w.canShow}`);
}
console.log(`${fx.teams.length} teams (${stricter} where Python accepts more than one stat text), ${fx.wins.length} winning-move cases`);
finish("python equivalence");
