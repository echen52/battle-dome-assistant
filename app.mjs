// ── app.mjs — page wiring. All rules live in engine.mjs. ───────────────────
import { MONS, TRAINERS, MOVES, SPECIES, ITEM_NAMES, STYLE_TEXTS, STAT_TEXTS, DOME_BRAIN } from "./data/dome_data.mjs";
import {
  trainerSets, trainerSpecies, candidateTeams, battleStyle, statLine, winsConsistent, setBreakdown, teamMoves, opponentPick,
} from "./engine.mjs";
import { parseTeam } from "./team.mjs";

const LEVEL = 50;
// Styles a card can actually show: 0-27 minus the two the threshold order makes
// unreachable (18 ENFEEBLE_HIGH, 24 DEF_OVER_ATK — battle_dome.c:549, 555);
// 28-31 are past BALANCED, which always matches.
const SHOWN_STYLES = [...Array(28).keys()].filter((s) => s !== 18 && s !== 24);
// GILLIAN is the only repeated trainer name. The early one (id 16, Lady) is
// only drawn in the first tournament (challenge 0 range, battle_tower.c:857),
// so it's left out and every trainer is picked by name alone.
const PICKABLE_TRAINERS = TRAINERS.filter((t) => t.id !== 16);

const $ = (id) => document.getElementById(id);
const el = (tag, props = {}, ...kids) => {
  const e = Object.assign(document.createElement(tag), props);
  for (const k of kids) e.append(k);
  return e;
};

// ── labels ──
const titleCase = (s) => s.toLowerCase().replace(/(^|[\s\-.])([a-z])/g, (_, p, c) => p + c.toUpperCase());
const trainerName = (t) => titleCase(t.name);
const speciesName = (c) => SPECIES[c]?.name ?? c;
const natureName = (c) => titleCase(c.replace("NATURE_", ""));
const itemName = (c) => ITEM_NAMES[c] ?? c;
const moveName = (c) => MOVES[c]?.name ?? c;
const setLabel = (i) => `${speciesName(MONS[i].species)} ${MONS[i].ord}`;
const byLabel = (a, b) => a.label.localeCompare(b.label);

const ALL_SPECIES = [...new Set(TRAINERS.flatMap((t) => trainerSets(t.id, LEVEL)).map((i) => MONS[i].species))];

// ── filtering combobox ─────────────────────────────────────────────────────
// Same behaviour as the Arena / Palace / Tower pickers: type to narrow
// (starts-with matches first, then contains), arrow keys + Enter, mousedown
// to pick, and the text snaps back to the real value on blur. Enter with
// nothing highlighted takes the top match, so typing a few letters + Enter
// is enough.
function combo({ id, ariaLabel, placeholder, options, value, onPick }) {
  const wrap = el("div", { className: "combo-wrap" });
  const input = el("input", { type: "text", id: id ?? "", className: "combo-input", autocomplete: "off", spellcheck: false, placeholder });
  input.setAttribute("role", "combobox");
  input.setAttribute("aria-expanded", "false");
  if (ariaLabel) input.setAttribute("aria-label", ariaLabel);
  const list = el("div", { className: "combo-list", role: "listbox" });
  wrap.append(input, list);
  let opts = options, current = value ?? null, hi = -1, shown = [];

  const labelOf = (v) => opts.find((o) => o.value === v)?.label ?? "";
  const close = () => { list.classList.remove("open"); list.replaceChildren(); input.setAttribute("aria-expanded", "false"); hi = -1; shown = []; };
  const pick = (v) => { current = v; input.value = labelOf(v); close(); onPick(v); };
  const highlight = () => {
    [...list.children].forEach((c, i) => c.classList.toggle("hi", i === hi));
    if (hi >= 0) list.children[hi]?.scrollIntoView({ block: "nearest" });
  };
  function render() {
    const q = input.value.trim().toLowerCase();
    const showAll = !q || q === labelOf(current).toLowerCase();
    const lower = (o) => o.label.toLowerCase();
    shown = showAll ? opts : [
      ...opts.filter((o) => lower(o) === q),
      ...opts.filter((o) => lower(o) !== q && lower(o).startsWith(q)),
      ...opts.filter((o) => !lower(o).startsWith(q) && lower(o).includes(q)),
    ];
    shown = shown.slice(0, 60);
    hi = -1;
    list.replaceChildren(...(shown.length ? shown.map((o) => {
      const item = el("div", { className: "combo-item", textContent: o.label, role: "option" });
      item.dataset.value = o.value;
      item.addEventListener("mousedown", (e) => { e.preventDefault(); pick(o.value); });
      return item;
    }) : [el("div", { className: "combo-empty", textContent: "No matches" })]));
    list.classList.add("open");
    input.setAttribute("aria-expanded", "true");
  }
  input.addEventListener("input", render);
  input.addEventListener("focus", () => { input.select(); render(); });
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); if (!list.classList.contains("open")) render(); hi = Math.min(hi + 1, shown.length - 1); highlight(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); hi = Math.max(hi - 1, -1); highlight(); }
    else if (e.key === "Enter") {
      const target = shown[hi >= 0 ? hi : 0];
      if (target && list.classList.contains("open")) { e.preventDefault(); pick(target.value); }
    } else if (e.key === "Escape") { close(); input.value = labelOf(current); }
  });
  input.addEventListener("blur", () => setTimeout(() => {
    close();
    if (input.value.trim() === "" && current != null) { current = null; onPick(null); }
    else input.value = labelOf(current);
  }, 120));
  input.value = labelOf(current);
  return {
    el: wrap, input,
    set(next, v) {           // new options and/or value, without firing onPick
      opts = next;
      current = v ?? null;
      if (document.activeElement !== input) input.value = labelOf(current);
      input.disabled = opts.length === 0;
    },
  };
}

// ── state ──
const blank = () => ({ trainerId: null, species: [null, null, null], style: null, stat: null, wins: [] });
let state = blank();
let you = null;            // your 3 species (SPECIES_*), or null — kept across Reset

// ── your team: saved teams, as battle-palace-solver does them ──
// One localStorage key holding { name: pasted text }. Every echen52 Pages site
// shares one origin, so the key carries this site's prefix.
const STORE = "domeAssistant.savedTeams";
const LAST = "domeAssistant.lastTeam";     // the team in use, restored on the next visit
const loadSaved = () => { try { return JSON.parse(localStorage.getItem(STORE) || "{}"); } catch { return {}; } };
const storeSaved = (m) => { try { localStorage.setItem(STORE, JSON.stringify(m)); } catch { /* private mode: not kept */ } };
function refreshSaved(select = "") {
  const m = loadSaved();
  $("savedTeams").replaceChildren(el("option", { value: "", textContent: "— Select a saved team —" }),
    ...Object.keys(m).sort().map((k) => el("option", { value: k, textContent: k, selected: k === select })));
}
function useTeamText(text, { quiet = false } = {}) {
  const r = parseTeam(text);
  if (r.error) {
    you = null;
    $("teamMsg").textContent = quiet && !text.trim() ? "" : r.error;
    $("teamMsg").className = "note err";
  } else {
    you = r.species;
    $("teamMsg").textContent = you.map(speciesName).join(" · ");
    $("teamMsg").className = "note ok";
    try { localStorage.setItem(LAST, text); } catch { /* not kept */ }
  }
  update();
}

// ── the narrowing, with "what if" counts for the style / stat pickers ──
function compute() {
  const { trainerId, species } = state;
  if (trainerId == null || species.some((s) => !s)) return null;
  const base = candidateTeams(trainerId, species, LEVEL);
  const passWins = (t, upTo = state.wins.length) => winsConsistent(t, state.wins.slice(0, upTo));
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
  // how many teams would remain with each option, given every OTHER clue
  const styleCounts = new Map(), statCounts = new Map();
  for (const t of base) {
    if (!passWins(t)) continue;
    if (okStat(t)) styleCounts.set(styleOf.get(t), (styleCounts.get(styleOf.get(t)) ?? 0) + 1);
    if (okStyle(t)) statCounts.set(statOf.get(t), (statCounts.get(statOf.get(t)) ?? 0) + 1);
  }
  return { base, teams, steps, styleCounts, statCounts, roundMoves };
}

// ── persistent pickers ──
const trainerCombo = combo({
  id: "trainerInput", placeholder: "Type a trainer's name…",
  options: PICKABLE_TRAINERS.map((t) => ({ value: t.id, label: trainerName(t) })).sort(byLabel),
  onPick: (id) => {
    if (id === state.trainerId) return;
    state = { ...blank(), trainerId: id, wins: state.wins.map(() => ({ move: null, loser: null })) };
    update();
  },
});
$("trainerCombo").append(trainerCombo.el);

const speciesCombos = [0, 1, 2].map((k) => {
  const c = combo({
    ariaLabel: `Pokémon ${k + 1}`, placeholder: `Pokémon ${k + 1}`, options: [],
    onPick: (v) => { state.species[k] = v; update(); },
  });
  $("speciesCombos").append(c.el);
  return c;
});
const styleCombo = combo({
  id: "styleInput", placeholder: "Type part of the line…", options: [],
  onPick: (v) => { state.style = v; update(); },
});
$("styleCombo").append(styleCombo.el);
const statCombo = combo({
  id: "statInput", placeholder: "Type part of the line…", options: [],
  onPick: (v) => { state.stat = v; update(); },
});
$("statCombo").append(statCombo.el);

function renderPickers(res) {
  const list = state.trainerId == null ? [] : trainerSpecies(state.trainerId, LEVEL);
  speciesCombos.forEach((c, k) => {
    const taken = state.species.filter((s, j) => j !== k && s);
    c.set(list.filter((s) => !taken.includes(s)).map((s) => ({ value: s, label: speciesName(s) })).sort(byLabel), state.species[k]);
    c.input.placeholder = state.trainerId == null ? "Pick a trainer first" : `Pokémon ${k + 1}`;
  });
  const count = (m, k) => (res ? ` (${m.get(k) ?? 0})` : "");
  styleCombo.set(SHOWN_STYLES.map((s) => ({ value: s, label: STYLE_TEXTS[s] + count(res?.styleCounts, s) })), state.style);
  statCombo.set(STAT_TEXTS.map((txt, s) => ({ value: s, label: txt + count(res?.statCounts, s) })), state.stat);
}

function renderWins(res) {
  const rows = $("winRows");
  rows.replaceChildren();
  state.wins.forEach((w, r) => {
    const box = el("fieldset", { className: "win-row" }, el("legend", { textContent: ["First round", "Second round", "Semifinal"][r] + " win" }));
    const moves = (res?.roundMoves[r] ?? []).filter((m) => m !== "MOVE_NONE");
    if (w.move && w.move !== "MOVE_NONE" && !moves.includes(w.move)) moves.push(w.move);
    const mv = combo({
      ariaLabel: `Round ${r + 1} move shown`, placeholder: "Move on the card…", value: w.move,
      options: [...moves.map((m) => ({ value: m, label: moveName(m) })).sort(byLabel), { value: "MOVE_NONE", label: "Won without using a move" }],
      onPick: (v) => { w.move = v; update(); },
    });
    box.append(el("span", { className: "mini", textContent: "Move shown" }), mv.el,
      el("span", { className: "mini", textContent: "Beaten trainer's Pokémon (optional, makes this much stronger)" }));
    const three = el("div", { className: "three" });
    w.loserDraft = w.loserDraft ?? [null, null, null];
    for (let k = 0; k < 3; k++) {
      const taken = w.loserDraft.filter((x, j) => j !== k && x);
      const c = combo({
        ariaLabel: `Round ${r + 1} beaten Pokémon ${k + 1}`, placeholder: "—", value: w.loserDraft[k],
        options: ALL_SPECIES.filter((s) => !taken.includes(s)).map((s) => ({ value: s, label: speciesName(s) })).sort(byLabel),
        onPick: (v) => {
          w.loserDraft[k] = v;
          w.loser = w.loserDraft.every(Boolean) ? w.loserDraft.slice() : null;
          update();
        },
      });
      three.append(c.el);
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
    el("td", { className: "spe", textContent: String(m.speed) }),
    el("td", { className: "moves", textContent: m.moves.filter((x) => x !== "MOVE_NONE").map(moveName).join(" · ") }),
    el("td", { className: "num", textContent: String(teams) }));
}

// Tucker's fixed teams (Level 50 Speeds precomputed in data/dome_data.mjs)
function renderTucker() {
  const symbol = document.querySelector('input[name="symbol"]:checked').value;
  $("tuckerTable").replaceChildren(
    el("thead", {}, el("tr", {}, ...["Pokémon", "Item", "Nature", "Speed", "Moves"].map((h) => el("th", { textContent: h, className: h === "Speed" ? "spe" : "" })))),
    el("tbody", {}, ...DOME_BRAIN[symbol].map((m) => el("tr", {},
      el("td", { className: "set-name", textContent: speciesName(m.species) }),
      el("td", { textContent: itemName(m.item) }),
      el("td", { textContent: natureName(m.nature) }),
      el("td", { className: "spe", textContent: String(m.speed) }),
      el("td", { className: "moves", textContent: m.moves.map(moveName).join(" · ") })))));
}
for (const r of document.querySelectorAll('input[name="symbol"]')) r.addEventListener("change", renderTucker);
renderTucker();

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
      el("thead", {}, el("tr", {}, ...["Set", "Item", "Nature", "Speed", "Moves", "Teams"].map((h) => el("th", { textContent: h, className: h === "Teams" ? "num" : h === "Speed" ? "spe" : "" })))),
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

const pct = (p) => (p > 0 && p < 0.005 ? "<1%" : `${Math.round(p * 100)}%`);

/** For each pair of yours: which 2 they bring and who leads, averaged over
 *  the teams still possible (each equally likely — the plain-list ranking). */
function renderPick(res) {
  const wrap = $("pickWrap");
  if (!res || !res.teams.length) { wrap.hidden = true; return; }
  wrap.hidden = false;
  if (!you) {
    $("pickNote").textContent = "Add your team above to see which two they bring against each pair of yours.";
    $("pickTable").replaceChildren();
    return;
  }
  const n = res.teams.length;
  $("pickNote").textContent = n === 1
    ? "For the one team that fits. The game flips a coin between picking what hits you hardest and what hits you worst."
    : `Averaged over the ${n} teams still possible. The game flips a coin between picking what hits you hardest and what hits you worst.`;
  const cardOrder = (t) => state.species.map((sp) => t.find((i) => MONS[i].species === sp));
  const myPairs = [[0, 1], [0, 2], [1, 2]].map(([a, b]) => [you[a], you[b]]);
  const head = el("thead", {}, el("tr", {}, ...["You bring", "They bring", "Leads"].map((h) => el("th", { textContent: h }))));
  const body = el("tbody");
  for (const pair of myPairs) {
    const pairP = new Map(), leadP = [0, 0, 0];
    for (const t of res.teams) {
      const r = opponentPick(cardOrder(t), pair);
      for (const [k, p] of r.pairs) pairP.set(k, (pairP.get(k) ?? 0) + p / n);
      r.lead.forEach((p, s) => { leadP[s] += p / n; });
    }
    const pairs = [...pairP.entries()].filter(([, p]) => p > 1e-12).sort((x, y) => y[1] - x[1]);
    const bring = el("td", {}, ...pairs.map(([k, p]) => el("div", { className: "pick-line" },
      el("b", { textContent: pct(p) }), " ",
      [0, 1, 2].filter((s) => k & (1 << s)).map((s) => speciesName(state.species[s])).join(" + "))));
    const leads = el("td", { className: "lead-cell" }, ...[0, 1, 2].filter((s) => leadP[s] > 1e-12)
      .sort((x, y) => leadP[y] - leadP[x])
      .map((s) => el("div", { className: "pick-line" }, el("b", { textContent: pct(leadP[s]) }), " " + speciesName(state.species[s]))));
    body.append(el("tr", {}, el("td", { className: "you-cell", textContent: pair.map(speciesName).join(" + ") }), bring, leads));
  }
  $("pickTable").replaceChildren(head, body);
}

function update() {
  const res = compute();
  trainerCombo.set(PICKABLE_TRAINERS.map((t) => ({ value: t.id, label: trainerName(t) })).sort(byLabel), state.trainerId);
  renderPickers(res);
  renderWins(res);
  renderResults(res);
  renderPick(res);
}

// ── events ──
for (const r of document.querySelectorAll('input[name="wins"]')) r.addEventListener("change", (e) => {
  const n = +e.target.value;
  state.wins = Array.from({ length: n }, (_, k) => state.wins[k] ?? { move: null, loser: null });
  update();
});
$("resetBtn").addEventListener("click", () => {   // clears the opponent; your team stays
  state = blank();
  document.querySelector('input[name="wins"][value="0"]').checked = true;
  update();
});

$("teamText").addEventListener("input", () => { $("savedTeams").value = ""; useTeamText($("teamText").value); });
$("saveTeam").addEventListener("click", () => {
  const name = $("teamName").value.trim();
  if (!name) { $("teamMsg").textContent = "Give the team a name to save it."; $("teamMsg").className = "note err"; return; }
  const r = parseTeam($("teamText").value);
  if (r.error) { $("teamMsg").textContent = r.error; $("teamMsg").className = "note err"; return; }
  const m = loadSaved(); m[name] = $("teamText").value; storeSaved(m); refreshSaved(name);
  $("teamMsg").textContent = `Saved "${name}": ${r.species.map(speciesName).join(" · ")}`;
  $("teamMsg").className = "note ok";
});
$("savedTeams").addEventListener("change", () => {
  const k = $("savedTeams").value;
  const t = loadSaved()[k];
  if (t == null) return;
  $("teamText").value = t;
  $("teamName").value = k;
  useTeamText(t);
});
$("deleteTeam").addEventListener("click", () => {
  const k = $("savedTeams").value;
  if (!k) return;
  const m = loadSaved(); delete m[k]; storeSaved(m); refreshSaved();
  $("teamMsg").textContent = `Deleted "${k}".`;
  $("teamMsg").className = "note";
});

refreshSaved();
let lastText = "";
try { lastText = localStorage.getItem(LAST) ?? ""; } catch { /* storage blocked */ }
if (lastText) {
  $("teamText").value = lastText;
  const match = Object.entries(loadSaved()).find(([, v]) => v === lastText);
  if (match) { $("savedTeams").value = match[0]; $("teamName").value = match[0]; }
  useTeamText(lastText, { quiet: true });
} else update();
