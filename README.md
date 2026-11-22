# battle-dome-assistant

Battle Dome (Emerald) opponent-team predictor. Before each round the tourney
tree shows every trainer's three Pokémon, a battle-style line, a stat line, and
for matches already played, the move the winner "won using". This narrows the
opponent's team down to the sets that fit all of it.

Level 50. Static ES modules, no build step, no npm tree.

## Using it

Serve the folder over HTTP and open `index.html` (ES modules don't load from `file://`):

```
python -m http.server 8140 --directory battle-dome-assistant
```

Every picker is a type-to-search box, like the other Frontier sites: type a few
letters, then Enter (or arrow keys / click).

1. **Trainer.** By name. GILLIAN is the only repeated name in the game; the
   early one (Lady, id 16) is only drawn in the first tournament, so the site
   leaves it out and "Gillian" is the late-game Cooltrainer (id 227).
2. **Pokémon on the card.** Any order.
3. **Battle style / Stats.** Pick the text exactly as the card shows it. The
   number after each option is how many teams would remain if you picked it.
4. **Matches they've won.** For each, the move on the match card and, if you
   can, the beaten trainer's three Pokémon. With the beaten team the move is a
   strong clue: the game shows the winner's *highest-scoring* move against
   that team, so any team holding a better-scoring move is ruled out. Without
   it, the clue only means "the team has this move".

The result shows the count after each clue, and for each species which sets are
still possible and in how many teams.

## Where the rules come from

All from pokeemerald `a3c551f`, ported line by line (file:line comments in `engine.mjs`):

| Clue | Game code |
|---|---|
| Team generation (distinct set, species, held item; Lv 50 tier cut) | `src/battle_dome.c:2368-2384`, `src/battle_tower.c:1805-1810` |
| Battle style | `src/battle_dome.c:4479-4513` (thresholds `:530`, move points `:170`) |
| Stat line | `src/battle_dome.c:4518-4700` |
| Winning move | `src/battle_dome.c:5221-5331` (`GetWinningMove`), `AI_TypeCalc` in `src/battle_script_commands.c:1594` |

Quirks it keeps, because the game has them:

- Two styles can never appear ("Skilled at using upsetting attacks",
  "Emphasizes defense over offense"), so they aren't offered.
- With three or more emphasised stats, the card names the **last two** in
  stat order (HP, Atk, Def, Speed, SpAtk, SpDef), not the biggest two.
- The winning move ignores repeats from earlier rounds only partly: a
  second-round win can repeat the first-round move; a semifinal win avoids the
  first-round move only.
- The loser's ability is drawn at random for every move and target, so
  Levitate / Wonder Guard targets count both ways.

Not used: the "potential" (seed) line. Its score ignores EVs
(`CalcDomeMonStats` bug) and sees only species and nature, so it almost never
separates sets. Dome opponents fight with IVs of 3 (`battle_dome.c:2591`).

## Tests

```
node run_suite.mjs          # 6 guards, ~3 s
node tools/check_ui.mjs     # headless browser check (borrows playwright-core from ../battle_arena_assistant)
node tools/gen_data.mjs     # regenerate data/dome_data.mjs from ../pokeemerald + ../tower_extract
```

`tests/fixtures/python_cases.json` comes from the original Python tool
(`../Dome Assistant`, now frozen) via `tools/make_python_fixture.py`.
