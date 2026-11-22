"""Reference answers from the Python Dome Assistant (../Dome Assistant), for
tests/test_python_equivalence.mjs.

For random teams drawn from every trainer's Level 50 pool (game rules: distinct
species and items):
  * style      - the battle-style index Python's BattleStyleCheck accepts
  * statAccept - every stat-line text index Python's EVStylesCheck accepts
                 (Python is known to be looser on 2-good / 2-bad ties, so the
                 JS answer must be IN this set, not equal to it)
  * winning-move cases - can_show() verdicts for the shown move, a random
                 other team move, with and without an excluded move

Run:  python -I tools/make_python_fixture.py   (writes tests/fixtures/python_cases.json)
"""
import json
import os
import random
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
DA = os.path.join(HERE, "..", "..", "Dome Assistant")
sys.path.insert(0, DA)
import DomeAssistant as da  # noqa: E402
import winning_move as wm  # noqa: E402

GAME_ORDER = ["HP", "Atk", "Def", "Spe", "SpA", "SpD"]       # STAT_HP..STAT_SPDEF
OFFS = [0, 5, 9, 12, 14]                                      # sStatTextOffsets


def text_index(kind, a, b):
	if kind == "B":
		return 42
	ia = GAME_ORDER.index(a)
	if b == "none":
		return (15 if kind == "E" else 36) + ia
	ib = GAME_ORDER.index(b)
	lo, hi = min(ia, ib), max(ia, ib)
	return OFFS[lo] + (hi - (lo + 1)) + (0 if kind == "E" else 21)


def stat_accept(team):
	out = set()
	if da.EVStylesCheck(team, "B", "none", "none"):
		out.add(42)
	for kind in "EN":
		for a in GAME_ORDER:
			for b in ["none"] + GAME_ORDER:
				if a == b or (b != "none" and GAME_ORDER.index(b) < GAME_ORDER.index(a)):
					continue
				if da.EVStylesCheck(team, kind, a, b):
					out.add(text_index(kind, a, b))
	return sorted(out)


rng = random.Random(1121)
pools = {}
for name in da.TrainerData.index.unique():
	sets = [x for x in list(da.TrainerData.loc[[name]].values[0])[1:] if x == x]
	pools[name] = [da.PokemonSet(x) for x in sets if da.PokemonSet(x).Entry <= 850]
names = sorted(pools)
all_species = sorted({wm.species_const(p.Species) for ps in pools.values() for p in ps})


def random_team(pool):
	team = []
	while len(team) < 3:
		mon = rng.choice(pool)
		if any(m.Name == mon.Name or m.Species == mon.Species or m.Item == mon.Item for m in team):
			continue
		team.append(mon)
	return team


teams, wins = [], []
for _ in range(1500):
	team = random_team(pools[rng.choice(names)])
	style = [s for s in range(28) if da.BattleStyleCheck(team, s)]
	assert len(style) == 1
	teams.append({"entries": [p.Entry - 1 for p in team], "style": style[0], "statAccept": stat_accept(team)})
	moves = [m for p in team for m in p.MoveConsts]
	loser = rng.sample(all_species, 3)
	for shown in {rng.choice(moves), rng.choice(moves)}:
		excl = rng.choice([[], [rng.choice(moves)]])
		wins.append({"entries": [p.Entry - 1 for p in team], "loser": loser, "shown": shown, "excluded": excl,
					 "canShow": wm.can_show(moves, loser, shown, set(excl))})

out = os.path.join(HERE, "..", "tests", "fixtures", "python_cases.json")
os.makedirs(os.path.dirname(out), exist_ok=True)
with open(out, "w", encoding="utf-8") as f:
	json.dump({"source": "Dome Assistant (Python) via tools/make_python_fixture.py", "teams": teams, "wins": wins}, f)
print(f"wrote {len(teams)} teams, {len(wins)} winning-move cases; canShow true in {sum(w['canShow'] for w in wins)}")
