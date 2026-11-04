# Methodology

Every analytic choice, and the reason for it. The numbers are in `results/results.json`. The code is in `cfb/` and `run_study.py`.

## Question
Are NCAA FBS game outcomes, and upsets in particular, predictable beyond what the betting market's closing spread already prices in? Or is the variation left after the spread consistent with irreducible randomness?

## Data
- **Source.** The CollegeFootballData.com REST API: `/games`, `/lines`, `/teams/fbs` and `/ratings/sp`. Raw responses are cached under `data/raw/`, so a rerun reads the cache and makes no API calls.
- **Seasons.** 2019 and 2021–2024. 2020 is excluded because COVID cut the schedule to 534 games and many were played with no crowd, which changes home-field advantage. The five seasons give 3,900 games, close to the target of 4,000, and they are the most recent ones, so the results describe the current market.
- **Population.** FBS against FBS only, regular season and bowls, completed games that have a line. Membership is checked against `/teams/fbs`, not the API's classification filter; see `docs/data-integrity.md`.
- **Spread.** The consensus closing spread is the median across providers, which is robust to a single stale or bad line. It is taken from the home team's side, so negative means the home team is favored.
- **Upset.** The closing underdog wins outright. Games with a spread of exactly 0 (10 games) have no underdog and are excluded.
- **Team strength.** The difference in prior-season SP+ ratings. The current season's SP+ is computed after the season, from the very games being predicted, so it would leak the outcome.

## Split
- **Train:** 2019, 2021 and 2022 (2,313 games).
- **Test:** 2023 and 2024 (1,587 games).

Splitting by season keeps future games out of the training data; `models.split()` raises an error otherwise. All out-of-sample metrics are computed on the test seasons only.

## Hypotheses (α = 0.05)

| | Null hypothesis | Test |
|---|---|---|
| H1 | The spread has no relationship to who wins. | Logistic regression of home_win on spread_home (train); Wald z on the slope. |
| H2 | Other information adds nothing once the spread is known. | Likelihood-ratio test of the spread-only logit nested in a full logit that adds sp_diff, neutral, conference_game, week and total (train, rows with complete data, df = 5). |
| H3 | The spread-implied probabilities are calibrated. | On the test seasons: calibration intercept and slope (logit of the outcome on the logit of the prediction; ideal is 0 and 1), and Hosmer–Lemeshow with 10 bins and df = 8. |
| H4 | The spread is an unbiased forecast of the margin. | OLS of margin on spread_home (train); ideal is intercept 0 and slope −1. A full OLS adds the H2 features and compares R². |

## Evaluation
- **Brier score** is the mean squared error of the probability forecast; lower is better. It is computed for three forecasts: a naive baseline that gives every game the training home-win rate, the spread-only logit, and the full logit.
- **Brier skill score** is 1 − Brier(model) / Brier(naive).
- **Log loss and AUC** are reported alongside.
- **Paired difference.** Brier(full) − Brier(spread) on the same test rows, with a 95% CI from a cluster bootstrap. The bootstrap uses 2,000 resamples over the 31 season-weeks, because games in the same week share conditions and are not independent.
- **Complete-case rows.** The full model needs SP+ data, so the comparison uses the 1,554 test games that have it. The 33 dropped games, and the upset rate among them, are reported under `evaluation.complete_case`.

## Monte Carlo (10,000 trials, seed 42)
Two null models, both fit on the training seasons only:
1. **Outcome model.** Each test game's winner is drawn as a coin flip weighted by the spread-only logit probability.
2. **Margin model.** Each game's margin is drawn as −spread plus Normal(0, σ), where σ = 15.43 is the SD of margin + spread in training.

For each trial the simulation records the number of upsets, the Brier score, and the residual SD. The observed test-season values are placed in those distributions, with two-sided empirical p-values. The "oracle" Brier, computed with the true probabilities from the margin model, is the lowest score any forecaster could expect if outcomes were the market line plus pure noise.

## Reproducibility
- `run_study.py` fixes every seed, and two runs give a byte-identical `results.json`.
- `results.json["config"]` records the library versions and the SHA-256 of the clean dataset.
- `requirements.txt` is pinned.

## Limitations
- **Closing lines are not verified.** `/lines` reports a `spread` field and a separate `spreadOpen` field, and we take `spread` to be the closing line. We do not check timestamps.
- **Few test clusters.** The test set has only 31 season-weeks, so the bootstrap CI is wide.
- **Tested in-sample only.** H2 is a single in-sample test; the out-of-sample Brier comparison is the stricter check.
- **Few features.** The full model uses a small set of public features. Richer data (injuries, weather, line movement) could still carry some signal; this study cannot rule that out.
