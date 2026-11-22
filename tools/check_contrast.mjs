// ── tools/check_contrast.mjs — WCAG 2.1 contrast over styles.css tokens ───
//   node tools/check_contrast.mjs
// Each pair is declared with what it is, so the threshold isn't chosen to fit:
// 4.5:1 normal text, 3:1 non-text (borders that identify a control).
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
const root = css.slice(css.indexOf(":root"), css.indexOf("}", css.indexOf(":root")));
const T = Object.fromEntries([...root.matchAll(/--([\w-]+)\s*:\s*(#[0-9a-fA-F]{3,8})/g)].map((m) => [m[1], m[2]]));
const rgb = (h) => { h = h.replace("#", ""); if (h.length === 3) h = [...h].map((c) => c + c).join(""); return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255); };
const lum = (h) => { const [r, g, b] = rgb(h).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const ratio = (a, b) => { const [x, y] = [lum(T[a]), lum(T[b])].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

const PAIRS = [
  ["ink", "bg", 4.5, "body text"], ["ink", "panel", 4.5, "panel text"], ["ink", "panel-2", 4.5, "inputs / steps"],
  ["ink-dim", "bg", 4.5, "footer 12px"], ["ink-dim", "panel", 4.5, "notes, table headers"], ["ink-dim", "panel-2", 4.5, "scope tag / badge 11px"],
  ["accent", "panel", 4.5, "section headings, summary"], ["accent-ink", "accent", 4.5, "selected win count"],
  ["good", "good-bg", 4.5, "'known' badge / success message"], ["bad", "bad-bg", 4.5, "contradiction message"],
  ["line", "panel", 3, "control borders on panel"], ["line", "panel-2", 3, "input border vs its fill"], ["accent", "panel-2", 3, "focus ring"],
];
let fails = 0;
for (const [fg, bg, min, what] of PAIRS) {
  const r = ratio(fg, bg);
  const ok = r >= min;
  if (!ok) fails++;
  console.log(`${ok ? "ok  " : "FAIL"} ${r.toFixed(2).padStart(5)} >= ${min}  ${fg} on ${bg}  (${what})`);
}
console.log(fails ? `contrast: ${fails} FAILURES` : `contrast: ALL PASS (${PAIRS.length} pairs)`);
process.exit(fails ? 1 : 0);
