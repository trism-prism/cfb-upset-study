# Data integrity log

Each data problem found while building the dataset, with the symptom, the diagnosis, the fix, and its measured effect. The audit counts are in `results/audit.json` and are regenerated on every build. The before/after metrics are in `results/results.json["bug_impact"]`.

## 1. The `/games` classification filter lets FBS-vs-FCS games through (fixed)

**Symptom.** The first audit of the 2019 and 2021–2024 seasons showed `non_fbs_leakage_removed = 590`. That is 590 of the 4,501 rows returned by `/games?classification=fbs` (13.1%) with at least one team that is not on that season's `/teams/fbs` list.

**Diagnosis.** Every leaked row is checked against the `homeClassification` and `awayClassification` fields in the raw responses:

| home | away | rows |
|---|---|---|
| fbs | fbs | 3,911 |
| fbs | fcs | 589 |
| fcs | fbs | 1 |

The server-side filter keeps any game where *at least one* team is FBS, not games where *both* are. The leaked rows are FBS teams hosting FCS opponents. They are real games with real results, but they come from a different population. 561 of the 590 have betting lines, so a pipeline that trusted the filter would have kept almost all of them. The team names are not the problem: every leaked row with an FBS classification matches `/teams/fbs` exactly.

**Fix.** `cfb/etl.py` `clean()` keeps a game only if both teams are on `/teams/fbs` for that season. The API filter is still sent, but it is not trusted. `tests/test_etl.py` covers both paths: the normal path drops an FCS game, and the bypassed path keeps it.

**Effect.** `run_study.py` `bug_impact()` rebuilds the dataset from the same cached raw data with the membership check bypassed. It then runs the same split and the same models.

| Metric | Trusting the API filter | After the fix |
|---|---|---|
| Games | 4,461 | 3,900 |
| Test games (2023–24) | 1,808 | 1,587 |
| Upset rate | 24.4% | 27.1% |
| Favorite win share | 75.6% | 72.9% |
| Mean absolute spread | 13.4 | 11.1 |
| Spread-only Brier (test) | 0.1588 | 0.1767 |
| Brier skill vs naive | 32.1% | 27.4% |
| Calibration slope | 1.107 | 1.086 |
| Hosmer–Lemeshow p | 0.029 | 0.062 |

Leaving the FCS games in has three effects on the headline results:
- It makes the market look more predictive than it is (Brier skill up 4.7 points).
- It understates how often upsets happen (by 2.7 points).
- It flips the calibration test to "reject at α = 0.05", which would wrongly suggest the market is miscalibrated.

FBS-vs-FCS games are lopsided (the mean spread rises from 11.1 to 13.4) and easy to call, which is why they flatter the model. The upset rate and mean spread in the table above cover all seasons. For the test seasons alone, the upset rate is 24.9% with the bug and 28.0% after the fix. The bug added 106 to 117 rows in each season (`rows_added_by_season`).

On the 1,587 test games present in both datasets (`bug_impact.matched_test_rows`), the model trained on contaminated data scores a Brier of 0.176700, against 0.176726 for the clean model. The difference has a 95% CI of [−0.00017, +0.00013]. So the bug corrupts the evaluation and the base rates, not the fitted model's predictions on FBS games.

## 2. Line rows with no matching game (expected, no fix)

`lines_games_without_game = 1,726`. `/lines` has no classification filter, so it returns lines for FCS-only and other games that `/games?classification=fbs` excludes. These rows never join to a kept game. No action is needed. The count is logged so that any change in it shows up.

## 3. Null spreads (handled)

`lines_null_spread = 17` provider rows have no spread. They are left out of the per-game median. Every game still had at least one valid line (`no_valid_line_removed = 0`).

## 4. Other checks (passed)

- Duplicate game IDs: 0. Duplicate (game, provider) lines: 0.
- Spreads that are non-numeric or larger than 70 points: 0.
- Incomplete games or missing scores: 1 removed.
- Pick'em games (consensus spread exactly 0): 10 excluded, because an upset is undefined without a favorite.
- Sign convention: favorites won 72.9% of games, inside the expected 60–90% band, so the spread is read from the home team's side correctly. A flipped convention would show about 27%, and `build()` stops if the share falls outside the band.
- Prior-season SP+ missing: 43 games. These involve teams new to FBS with no rating the year before. Only the full model drops them; the drop is reported in `evaluation.complete_case`.
