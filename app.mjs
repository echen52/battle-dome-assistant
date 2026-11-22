// ── app.mjs — page wiring. All rules live in engine.mjs. ───────────────────
import { MONS, TRAINERS, MOVES, SPECIES, ITEM_NAMES, STYLE_TEXTS, STAT_TEXTS } from "./data/dome_data.mjs";
import {
  trainerSets, trainerSpecies, candidateTeams, battleStyle, statLine, winsConsistent, setBreakdown, teamMoves,
} from "./engine.mjs";

const LEVEL = 50;
// Styles a card can actually show: 0-27 minus the two the threshold order makes
// unreachable (18 ENFEEBLE_HIGH, 24 DEF_OVER_ATK — battle_dome.c:549, 555);
// 28-31 are past BALANCED, which always matches.
const SHOWN_STYLES = [...Array(28).keys()].filter((s) => s !== 18 && s !== 24);

const $ = (id) => document.getElementById(id);
const el = (tag, props = {}, ...kids) => {
  const e = Object.assign(document.createElement(tag), props);
  for (const k of kids) e.append(k);
  return e;
};

// ── labels ──
function prettyClass(constant) {
  const words = constant.replace(/^FACILITY_CLASS_/, "").split("_");
  const suffix = ["M", "F"].includes(words.at(-1)) ? ` (${words.pop()})` : "";
  return words.map((w) => w[0] + w.slice(1).toLowerCase()).join(" ") + suffix;
}
const trainerLabel = (t) => `${t.name} (${prettyClass(t.cls)})`;
const speciesName = (c) => SPECIES[c]?.name ?? c;
const natureName = (c) => c.replace("NATURE_", "")[0] + c.replace("NATURE_", "").slice(1).toLowerCase();
const itemName = (c) => ITEM_NAMES[c] ?? c;
const moveName = (c) => MOVES[c]?.name ?? c;
const setLabel = (i) => `${speciesName(MONS[i].species)} ${MONS[i].ord}`;

const TRAINER_BY_LABEL = new Map(TRAINERS.map((t) => [trainerLabel(t).toUpperCase(), t.id]));
const ALL_SPECIES = [...new Set(TRAINERS.flatMap((t) => trainerSets(t.id, LEVEL)).map((i) => MONS[i].species))]
  .sort((a, b) => speciesName(a).localeCompare(speciesName(b)));

// ── state ──
const blank = () => ({ trainerId: null, species: [null, null, null], style: null, stat: null, wins: [] });
let state = blank();

function readTrainer() {
  const v = $("trainerFilter").value.trim().toUpperCase();
  if (TRAINER_BY_LABEL.has(v)) return TRAINER_BY_LABEL.get(v);
  const byName = TRAINERS.filter((t) => t.name === v);
  return byName.length === 1 ? byName[0].id : null;
}

// ── the narrowing, with "what if" counts for each dropdown ──
function compute() {
  const { trainerId, species } = state;
  if (trainerId == null || species.some((s) => !s)) return null;
  const base = candidateTeams(trainerId, species, LEVEL);
  const winsUpTo = (r) => state.wins.slice(0, r);
  const passWins = (t, upTo = state.wins.length) => winsConsistent(t, winsUpTo(upTo));
  const styleOf = new Map(base.map((t) => [t, battleStyle(t)]));
  const statOf = new Map(base.map((t) => [t, statLine(t)]));
  const okStyle = (t) => state.style == null || styleOf.get(t) === state.style;
  const okStat = (t) => state.stat == null || statOf.get(t) === state.stat;

  const steps = [{ label: "Species", left: base.length }];
  let teams = base;
  if (state.style != null) { teams = teams.filter(okStyle); steps.push({ label: "Style", left: teams.length }); }
  if (state.stat != null) { teams = teams.filter(okStat); steps.push({ label: "Stats", left: teams.length }); }
  const roundMoves = [];
  for (let r = 0; r < state.wins.length; r++) {
    roundMoves.push([...new Set(teams.flatMap(teamMoves))]);
    if (!state.wins[r].move) continue;
    teams = teams.filter((t) => passWins(t, r + 1));
    steps.push({ label: `Win ${r + 1}`, left: teams.length });
  }
  // dropdown counts: how many teams would remain if you picked this option,
  // given every OTHER clue already entered
  const styleCounts = new Map(), statCounts = new Map();
  for (const t of base) {
    if (!passWins(t)) continue;
    if (okStat(t)) styleCounts.set(styleOf.get(t), (styleCounts.get(styleOf.get(t)) ?? 0) + 1);
    if (okStyle(t)) statCounts.set(statOf.get(t), (statCounts.get(statOf.get(t)) ?? 0) + 1);
  }
  return { base, teams, steps, styleCounts, statCounts, roundMoves };
}

// ── rendering ──
function fillSelect(sel, options, value, placeholder) {
  sel.replaceChildren(el("option", { value: "", textContent: placeholder }));
  for (const o of options) sel.append(el("option", { value: o.value, textContent: o.label, disabled: !!o.disabled }));
  sel.value = value ?? "";
}

function renderSpecies() {
  const list = state.trainerId == null ? [] : trainerSpecies(state.trainerId, LEVEL)
    .sort((a, b) => speciesName(a).localeCompare(speciesName(b)));
  for (let k = 0; k < 3; k++) {
    const taken = state.species.filter((s, j) => j !== k && s);
    fillSelect($(`species${k}`), list.map((c) => ({ value: c, label: speciesName(c), disabled: taken.includes(c) })),
      state.species[k], state.trainerId == null ? "Pick a trainer first" : `Pokémon ${k + 1}`);
    $(`species${k}`).disabled = state.trainerId == null;
  }
}

function renderClueSelects(res) {
  const count = (m, k) => (res ? ` (${m.get(k) ?? 0})` : "");
  fillSelect($("styleSelect"), SHOWN_STYLES.map((s) => ({
    value: s, label: STYLE_TEXTS[s] + count(res?.styleCounts ?? new Map(), s),
  })), state.style, "Not entered");
  fillSelect($("statSelect"), STAT_TEXTS.map((txt, s) => ({
    value: s, label: txt + count(res?.statCounts ?? new Map(), s),
  })), state.stat, "Not entered");
}

function renderWins(res) {
  const rows = $("winRows");
  rows.replaceChildren();
  state.wins.forEach((w, r) => {
    const box = el("fieldset", { className: "win-row" }, el("legend", { textContent: ["First round", "Second round", "Semifinal"][r] + " win" }));
    const moves = (res?.roundMoves[r] ?? []).slice().sort((a, b) => moveName(a).localeCompare(moveName(b)));
    if (w.move && !moves.includes(w.move)) moves.unshift(w.move);
    const mv = el("select", { ariaLabel: `Round ${r + 1} move shown` });
    fillSelect(mv, [
      ...moves.filter((m) => m !== "MOVE_NONE").map((m) => ({ value: m, label: moveName(m) })),
      { value: "MOVE_NONE", label: "Won without using a move" },
    ], w.move, "Move on the card…");
    mv.addEventListener("change", () => { w.move = mv.value || null; update(); });
    box.append(el("label", { className: "mini", textContent: "Move shown" }), mv,
      el("label", { className: "mini", textContent: "Beaten trainer's Pokémon (optional, makes this much stronger)" }));
    const three = el("div", { className: "three" });
    for (let k = 0; k < 3; k++) {
      const s = el("select", { ariaLabel: `Round ${r + 1} beaten Pokémon ${k + 1}` });
      const taken = (w.loser ?? []).filter((x, j) => j !== k && x);
      fillSelect(s, ALL_SPECIES.map((c) => ({ value: c, label: speciesName(c), disabled: taken.includes(c) })),
        w.loser?.[k], "—");
      s.addEventListener("change", () => {
        w.loserDraft = w.loserDraft ?? [null, null, null];
        w.loserDraft[k] = s.value || null;
        w.loser = w.loserDraft.every(Boolean) ? w.loserDraft.slice() : null;
        update();
      });
      if (w.loserDraft) s.value = w.loserDraft[k] ?? "";
      three.append(s);
    }
    box.append(three);
    rows.append(box);
  });
}

function setRow(i, teams) {
  const m = MONS[i];
  return el("tr", {},
    el("td", { className: "set-name", textContent: setLabel(i) }),
    el("td", { textContent: itemName(m.item) }),
    el("td", { textContent: natureName(m.nature) }),
    el("td", { className: "moves", textContent: m.moves.filter((x) => x !== "MOVE_NONE").map(moveName).join(" · ") }),
    el("td", { className: "num", textContent: String(teams) }));
}

function renderResults(res) {
  const msg = $("message");
  msg.hidden = true;
  $("breakdown").replaceChildren();
  $("teamListWrap").hidden = true;
  if (!res) {
    $("steps").replaceChildren(el("span", { className: "dim", textContent: "Pick the trainer and all three Pokémon to start." }));
    return;
  }
  $("steps").replaceChildren(...res.steps.flatMap((s, k) => [
    ...(k ? [el("span", { className: "arrow", textContent: "→" })] : []),
    el("span", { className: "step" }, el("span", { className: "step-label", textContent: s.label }), el("b", { textContent: String(s.left) })),
  ]));
  if (res.base.length === 0) {
    msg.textContent = "This trainer can't field those three Pokémon together. Check the trainer and species.";
    msg.className = "message bad"; msg.hidden = false; return;
  }
  if (res.teams.length === 0) {
    const killer = res.steps.find((s) => s.left === 0);
    msg.textContent = `No team fits every clue (the ${killer.label.toLowerCase()} clue removed the last ones). Re-check that clue.`;
    msg.className = "message bad"; msg.hidden = false; return;
  }
  if (res.teams.length === 1) { msg.textContent = "Only one team fits — this is it."; msg.className = "message good"; msg.hidden = false; }

  for (const b of setBreakdown(res.teams, state.species)) {
    const table = el("table", { className: "sets" },
      el("thead", {}, el("tr", {}, ...["Set", "Item", "Nature", "Moves", "Teams"].map((h) => el("th", { textContent: h, className: h === "Teams" ? "num" : "" })))),
      el("tbody", {}, ...b.sets.map((s) => setRow(s.i, s.teams))));
    const sure = b.sets.length === 1;
    $("breakdown").append(el("div", { className: "species-block" },
      el("h3", {}, speciesName(b.species), el("span", { className: sure ? "badge sure" : "badge", textContent: sure ? "known" : `${b.sets.length} sets left` })),
      el("div", { className: "table-wrap" }, table)));
  }
  $("teamListWrap").hidden = false;
  $("teamListSummary").textContent = `All ${res.teams.length} team${res.teams.length === 1 ? "" : "s"}`;
  $("teamList").replaceChildren(...res.teams.slice(0, 300).map((t) =>
    el("li", { textContent: t.map(setLabel).join(" · ") })));
}

function update() {
  const res = compute();
  renderClueSelects(res);
  renderWins(res);
  renderResults(res);
}

// ── events ──
$("trainerOptions").append(...TRAINERS.map((t) => el("option", { value: trainerLabel(t) })));
$("trainerFilter").addEventListener("input", () => {
  const id = readTrainer();
  if (id === state.trainerId) return;
  state = { ...blank(), trainerId: id, wins: state.wins.map(() => ({ move: null, loser: null })) };
  const dup = id == null ? [] : TRAINERS.filter((t) => t.name === TRAINERS[id].name);
  $("trainerNote").textContent = id == null ? "" : dup.length > 1 ? `${trainerLabel(TRAINERS[id])} — there are ${dup.length} trainers called ${TRAINERS[id].name}; check the class.` : "";
  renderSpecies();
  update();
});
for (let k = 0; k < 3; k++) $(`species${k}`).addEventListener("change", (e) => {
  state.species[k] = e.target.value || null;
  renderSpecies();
  update();
});
$("styleSelect").addEventListener("change", (e) => { state.style = e.target.value === "" ? null : +e.target.value; update(); });
$("statSelect").addEventListener("change", (e) => { state.stat = e.target.value === "" ? null : +e.target.value; update(); });
for (const r of document.querySelectorAll('input[name="wins"]')) r.addEventListener("change", (e) => {
  const n = +e.target.value;
  state.wins = Array.from({ length: n }, (_, k) => state.wins[k] ?? { move: null, loser: null });
  update();
});
$("resetBtn").addEventListener("click", () => {
  state = blank();
  $("trainerFilter").value = "";
  $("trainerNote").textContent = "";
  document.querySelector('input[name="wins"][value="0"]').checked = true;
  renderSpecies();
  update();
});

renderSpecies();
update();
