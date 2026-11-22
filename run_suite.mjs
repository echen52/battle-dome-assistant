// ── run_suite.mjs — every engine/data guard, each in its own process ──────
//   node run_suite.mjs
// The browser check (tools/check_ui.mjs) is separate because it needs Chromium.
import { spawnSync } from "node:child_process";

const SUITE = [
  ["data integrity", "tests/test_data_integrity.mjs", "generated tables vs a separate decomp parse and the Python CSVs"],
  ["engine", "tests/test_engine.mjs", "team generation rules, true team survives its own clues"],
  ["stat line", "tests/test_stat_line.mjs", "literal port vs a plain restatement, incl. the 3-good-stats quirk"],
  ["winning move", "tests/test_winning_move.mjs", "canShow vs a literal GetWinningMove port: sound and exact"],
  ["python equivalence", "tests/test_python_equivalence.mjs", "same answers as the frozen Python Dome Assistant"],
  ["contrast", "tools/check_contrast.mjs", "WCAG pairs in styles.css"],
];
let passed = 0;
for (const [name, file, what] of SUITE) {
  const r = spawnSync(process.execPath, [file], { encoding: "utf8" });
  const ok = r.status === 0;
  passed += ok;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name.padEnd(20)} ${what}`);
  if (!ok) console.log((r.stdout + r.stderr).split("\n").slice(-15).join("\n"));
}
console.log(`\n${passed}/${SUITE.length} passed`);
process.exit(passed === SUITE.length ? 0 : 1);
