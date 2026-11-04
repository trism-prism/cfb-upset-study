# Resume bullets

Every number below comes from the committed study output. The table after the bullets traces each number to its source.

**Predicting College Football Upsets: A Statistical Research Study** · Python, Pandas, scikit-learn, statsmodels, REST APIs

1. Designed and executed an independent statistical research study analyzing ~3,900 NCAA FBS football games to test whether outcomes are predictable or governed by irreducible randomness.
2. Built a full ETL pipeline integrating a third-party REST API, including identifying and eliminating a look-ahead data leak (end-of-season team ratings posing as pregame features); a controlled rerun showed it would have inflated out-of-sample Brier skill from 27% to 38% and falsely shown the model beating the betting market.

   Alternative bullet 2, using the filter bug instead: Built a full ETL pipeline integrating a third-party REST API, including diagnosing and resolving a server-side data filtering bug that leaked non-FBS games into 13% of ingested records, which had inflated the model's measured predictive skill by 4.7 percentage points and produced a false finding of market miscalibration.

   Why the leak is the primary choice: it would have reversed the study's main conclusion. The filter bug changed one of four tests.
3. Applied hypothesis testing, multivariate regression, and calibration-based evaluation, achieving a Brier score of 0.177 versus 0.244 for a naive baseline (27% improvement). The market spread alone captured nearly all predictive signal; five additional features added no out-of-sample improvement.
4. Validated findings via a 10,000-trial Monte Carlo simulation confirming that observed upset counts and residual variance are consistent with irreducible randomness around the market line (p = 0.77 and p = 0.63). Authored an 18-page report and presented results.

## Where each number comes from

| Claim | Value | Source |
|---|---|---|
| Games analyzed | 3,900 | `results.json` → `config.n_games_total` |
| Leak: Brier skill, full model | 37.8% leaky vs 27.0% clean | `leakage_impact.leaky_same_season_sp.brier_skill_full_vs_naive`, `leakage_impact.clean_prior_season_sp.brier_skill_full_vs_naive` |
| Leak: false "beats the market" | Δ Brier −0.025, CI [−0.032, −0.019] with the leak; +0.001, CI [−0.001, +0.003] clean | `leakage_impact.*.brier_diff_full_minus_spread`, `leakage_impact.*.brier_diff_ci95`, `leakage_impact.*.full_beats_spread_out_of_sample` |
| Records the bug corrupted | 590 / 4,501 = 13.1% | `bug_impact.leaked_rows`, `bug_impact.api_filter_rows`, `bug_impact.leaked_share` |
| Skill inflation | 32.07% − 27.38% = 4.7 pts | `bug_impact.buggy.brier_skill_spread_vs_naive`, `bug_impact.fixed.brier_skill_spread_vs_naive` |
| False miscalibration | HL p = 0.029 with the bug, 0.062 after the fix | `bug_impact.buggy.hosmer_lemeshow_p`, `bug_impact.fixed.hosmer_lemeshow_p` |
| Brier, spread model | 0.1768 | `models.evaluation.spread_only.brier` |
| Brier, naive baseline | 0.2435 | `models.evaluation.naive.brier` |
| Improvement | 27.4% | `models.evaluation.brier_skill_spread_vs_naive` |
| No gain from extra features | Δ Brier +0.0010, 95% CI [−0.0010, +0.0028] | `models.evaluation.brier_diff_full_minus_spread`, `models.evaluation.brier_diff_ci95` |
| Monte Carlo trials | 10,000 | `simulation.n_trials` |
| Upset count p | 0.77 | `simulation.bernoulli.upsets.p_value` |
| Residual SD p | 0.63 | `simulation.normal_margin.resid_sd.p_value` |
| Report length | 18 pages | `report/report.pdf`, printed by `report/build_pdf.py` |

"Presented results" is true only once you have actually presented the report, for example to a class, a club or a recruiter, or as a recorded talk.

## Talking points
- **How the leak was caught: by asking when each feature was knowable.** End-of-season SP+ is computed from the games being predicted. The pipeline used prior-season ratings from the start, and a controlled rerun later measured what the leak would have done. Tell it that way; the order of events is the point of the story.
- **The bug corrupted the evaluation, not the model.** On the same 1,587 FBS test games, models trained with and without the leaked rows score identically (Brier difference −0.00003, CI [−0.00017, +0.00013]). What changed was the dataset being scored, and with it the conclusions.
- **The market's Brier of 0.177 sits at the simulated "oracle" floor** (mean 0.183, range 0.174–0.191), the score a forecaster would get if it knew the true probabilities.
