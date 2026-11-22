// statLine() — a literal port — against a plain restatement of what it computes:
// per-stat EV share (510 split evenly over a set's EV stats, nature x1.1 / x0.9,
// integer math), "good" = share > 29, "bad" = share == 0. Checked on every
// distinct team shape we can reach cheaply:
//   * 0, 1 or 2 good stats  -> exactly those
//   * 3+ good stats         -> the LAST two in stat order (the comparison at
//     src/battle_dome.c:4619 compares a stat index with a percentage, so it is
//     always true and the newest stat always displaces the oldest)
//   * no good, 1-2 bad      -> exactly those
//   * no good, 3+ bad       -> a two-bad text naming two of the zero stats
// Also: every team in every pool lands on a valid text (0..42).
import { MONS, NATURE_STAT_TABLE, STAT_TEXTS, TRAINERS } from "../data/dome_data.mjs";
import { statLine } from "../engine.mjs";
import { mulberry32, check, finish, randomTeam } from "./util.mjs";

const OFFS = [0, 5, 9, 12, 14];
const two = (a, b, base) => OFFS[a] + (b - (a + 1)) + base;

function shares(team) {
  const tot = Array(6).fill(0);
  for (const i of team) {
    const m = MONS[i];
    const n = [0, 1, 2, 3, 4, 5].filter((b) => m.evSpread & (1 << b)).length;
    const ev = Math.trunc(510 / n);
    for (let s = 0; s < 6; s++) {
      const e = m.evSpread & (1 << s) ? ev : 0;
      const mod = s === 0 ? 0 : NATURE_STAT_TABLE[m.nature][s - 1];
      tot[s] += mod > 0 ? Math.trunc(e * 110 / 100) : mod < 0 ? Math.trunc(e * 90 / 100) : e;
    }
  }
  const sum = tot.reduce((a, b) => a + b, 0);
  return tot.map((t) => Math.trunc(t * 100 / sum));
}

const rng = mulberry32(42);
const seen = { good0: 0, good1: 0, good2: 0, good3: 0, bad1: 0, bad2: 0, bad3: 0, balanced: 0 };
for (let n = 0; n < 20000; n++) {
  const team = randomTeam(rng, rng.int(300));
  const got = statLine(team);
  check(got >= 0 && got <= 42 && STAT_TEXTS[got], `invalid text ${got}`);
  const p = shares(team);
  const good = [0, 1, 2, 3, 4, 5].filter((s) => p[s] > 29);
  const bad = [0, 1, 2, 3, 4, 5].filter((s) => p[s] === 0);
  if (good.length >= 3) {
    seen.good3++;
    check(got === two(good.at(-2), good.at(-1), 0), `3+ good ${team}: got ${got}`);
  } else if (good.length === 2) {
    seen.good2++; check(got === two(good[0], good[1], 0), `2 good ${team}`);
  } else if (good.length === 1) {
    seen.good1++; check(got === 15 + good[0], `1 good ${team}`);
  } else if (bad.length === 0) {
    seen.balanced++; check(got === 42, `balanced ${team}`);
  } else if (bad.length === 1) {
    seen.bad1++; check(got === 36 + bad[0], `1 bad ${team}`);
  } else if (bad.length === 2) {
    seen.bad2++; check(got === two(bad[0], bad[1], 21), `2 bad ${team}`);
  } else {
    seen.bad3++;
    const ok = bad.some((a) => bad.some((b) => a < b && got === two(a, b, 21)));
    check(ok, `3+ bad ${team}: got ${got}`);
  }
}
console.log("cases:", JSON.stringify(seen));
check(seen.good3 > 0, "no 3-good team reached — the quirk is untested");
finish("stat line");
