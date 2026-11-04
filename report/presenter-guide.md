# Presenter Guide: Predicting College Football Upsets

**Tristan Morton** · November 2026

Everything needed to deliver the talk:
- what is in the kit, and how the format was chosen;
- a timing plan;
- delivery notes;
- prepared answers to the questions most likely to come up.

The slides themselves carry a full speaker script in their notes.

# 1. The presentation kit

| File | What it is | When to use it |
|---|---|---|
| `presentation/cfb-upset-study.pptx` | The slide deck: 26 slides for the talk plus an appendix divider and 7 backup slides (34 in all), with speaker notes on every slide | The talk itself |
| `report/report.pdf` | The full written study | Hand out or link before or after the talk; it answers detailed questions |
| `report/pipeline-walkthrough.pdf` | How the pipeline was built, tool by tool and stage by stage | Technical audiences and interviews; questions about how it was built |
| `report/presenter-guide.pdf` | This guide | Preparation |
| `RESUME_BULLETS.md` | The resume bullets, with each number traced to its source | Interviews |

To present from PowerPoint, open the deck and use Presenter View (Slide Show → Use Presenter View). The notes then appear on your screen only.

# 2. How the format was chosen

The deck's structure and language follow how comparable quantitative work is presented and reported. Comparable here means similar in field, scope and purpose, not in topic.

| Convention | Source | How the deck applies it |
|---|---|---|
| Introduction → Methods → Results → Conclusion, with results that are actual findings and an emphasis on reproducibility and impact | MIT Sloan Sports Analytics Conference research paper competition criteria (sloansportsconference.com/research-paper-competition) | The deck's sections follow this arc. A reproducibility slide and the repository are shown. |
| **Assertion-evidence slides:** a full-sentence headline stating the takeaway, supported by visual evidence instead of bullet lists | Michael Alley's assertion-evidence research, Penn State (writing.engr.psu.edu/research.html) | Every content slide's title is its conclusion. Read the deck's titles alone and you have the argument. |
| Explicit data sources and dates; a train/evaluation split that is separate and described; calibration and discrimination reported separately; confidence intervals on performance estimates | TRIPOD+AI reporting guideline for prediction models (Collins et al., BMJ 2024; pmc.ncbi.nlm.nih.gov/articles/PMC11019967) | Data and provenance slide, temporal-holdout slide, separate calibration (reliability diagram, slope) and discrimination (AUC) results, a CI on every headline number |
| Leakage named precisely; uncertainty quantified | Kapoor & Narayanan, "Leakage and the reproducibility crisis in machine-learning-based science", *Patterns* 2023 (pmc.ncbi.nlm.nih.gov/articles/PMC10499856) | The SP+ issue is named look-ahead bias, i.e. temporal leakage from features not available at prediction time, and its effect is measured by a controlled rerun |
| The outcome relative to the spread is roughly normal with a standard deviation near 14 points | Stern (1991), on NFL games | The margin-model null hypothesis; this study measures 15.4 points for college football |
| The spread is a market price, not the bookmaker's forecast | Levitt (2004), *Economic Journal* | Frames "the market" accurately on the prior-work slide |

**Talk length.** Conference contributed talks typically run 15–20 minutes. The main deck is timed at about 22 minutes. For a 15-minute slot, use the short path in section 3.

# 3. Timing plan

Slide numbers match the deck, including its section-divider slides (5, 10, 13, 18 and 27), which take only a few seconds each. Times are taken from the time cue at the top of each slide's notes.

| Section | Slides | Time | Running total |
|---|---|---|---|
| Introduction: the answer, the problem, prior work | 1–4 | 3.5 min | 3.5 |
| Data and pipeline: design, provenance, ETL funnel, tools | 5–9 | 4 min | 7.5 |
| Methods: hypotheses, evaluation design | 10–12 | 2 min | 9.5 |
| Results: H1/H4, H2, H3, upsets by spread | 13–17 | 4 min | 13.5 |
| Validation: Monte Carlo, look-ahead rerun, filter defect, safeguards | 18–23 | 6 min | 19.5 |
| Conclusion: limitations, takeaways, questions | 24–26 | 2.75 min | about 22 |
| Appendix (backup only, for questions) | 27–34 | — | — |

**15-minute version.** Skip slide 9 (tools) and slide 17 (upsets by spread), and fold slide 22 into slide 21 by saying "and a second, smaller data defect…". Keep slide 2 (the answer up front) and slide 21 (the look-ahead rerun): they are the two slides people remember.

**10-minute version (interview walkthrough).** Use slides 2, 6, 8, 15, 16, 20, 21 and 25.

# 4. Delivery notes

- **Lead with the answer.** Slide 2 gives the conclusion before the evidence. Technical audiences appreciate knowing where the talk is going, and it protects you if you run out of time.
- **Read the headline, then point at the evidence.** Each title is a claim. Say it, then show where on the chart it is true: "the bars are the same height", or "the red line is in the middle of the histogram".
- **Say each key number once, slowly, with its comparison.** "0.177, against 0.244 for a naive guess." A number without its baseline means nothing to a listener.
- **Name the uncertainty.** When you say "no improvement", add "the confidence interval includes zero". It is the difference between a finding and an opinion.
- **Use "consistent with randomness", not "proved random".** A simulation can fail to find a departure from chance; it cannot prove chance. Saying it precisely signals rigor.
- **Tell the leakage story as it happened.** You identified at design time that end-of-season ratings would leak the outcomes, built the pipeline to avoid it, and later measured the damage it would have done with a controlled rerun. Do not present it as caught after the fact; the honest version is the stronger one.
- **Define terms the first time:**
  - **Brier score:** the average squared gap between the forecast probability and what happened. Lower is better; 0.25 is a coin flip.
  - **Calibration:** when the forecast says 70%, it happens about 70% of the time.
  - **Out-of-sample:** scored on seasons the model never saw.

# 5. Anticipated questions and prepared answers

**"Isn't p = 0.048 for the extra features a significant result?"**
In-sample it is marginal, just under 0.05, and it comes from a single test. The real check is out of sample. On the 2023–24 seasons the full model is slightly *worse*, by 0.001 Brier, and the 95% interval [−0.001, +0.003] includes zero. A marginal in-sample effect that disappears on new data is what fitting noise looks like. (Appendix: anticipated questions; full coefficients.)

**"Why use the betting spread as the benchmark and not your own model?"**
The spread is the strongest public forecast available. It aggregates bookmakers' models and bettors' money. The question is whether outcomes are predictable *beyond* what is already known, so the right comparison is against the best existing forecast, not against a straw man. The naive baseline shows how much the spread itself contributes: 27% lower Brier.

**"Why exclude 2020?"**
COVID shortened it to 534 games, and many were played without fans, which changes home-field advantage. Including it would mix in a different data-generating process. The five remaining seasons still give 3,900 games.

**"How do you know the SP+ issue was really leakage?"**
SP+ ratings for a season are computed after the season from its own games. When we used them, the extra-features test went from LR = 11 to LR = 314, and the model suddenly "beat" the market: its Brier score was 0.025 lower (about 14% less error), with a confidence interval well below zero. Information from the future produces exactly that pattern. With prior-season ratings, the edge disappears.

**"Is two seasons of test data enough?"**
It is 1,587 games, but only 31 independent weeks, which is why the bootstrap resamples weeks and the intervals are wide. The 95% interval [−0.001, +0.003] rules out gains larger than about 0.003 Brier; smaller effects cannot be ruled out. That is stated as a limitation.

**"Are these really closing lines?"**
The API reports `spread` separately from `spreadOpen`, and we use `spread` as the closing line. We could not verify timestamps, and this is listed as a limitation. If some lines were earlier ones, they would be easier to beat, and the extra features still did not beat them. So the "no edge" conclusion is, if anything, conservative. Calibration, though, is measured against whatever line the API reports.

**"Could injuries, weather or line movement add signal?"**
Possibly; they were not in the data. But the room is small. If outcomes were the line plus random noise, even a forecaster that knew the true probabilities would expect a Brier of about 0.182 (95% range 0.174–0.191), and the market's 0.177 already sits inside that range.

**"How did you make sure the results are reproducible?"**
- Raw API responses are cached.
- Seeds are fixed, and two runs produce byte-identical results.
- Library versions and a SHA-256 checksum of the dataset are recorded.
- 20 automated tests pin the cleaning rules and statistics.
- Independent code reviews were done before merging.

**"What would you do next?"**
1. Add timestamped line-movement data to test whether the *opening* line is beatable even if the closing line is not.
2. Extend the study to earlier seasons.
3. Test specific upset theories (rivalry games, letdown spots) as pre-registered hypotheses.

**"What was the hardest part?"**
Data validity, not modeling. The two biggest threats came from the data. The look-ahead leak would have reversed the central conclusion, and the API filter defect would have produced a false miscalibration finding. The defenses were asking when each feature was knowable, and auditing every build against an independent source of truth.

# 6. Before you present: checklist

- Open the deck in PowerPoint and click through once. Fonts are Cambria and Calibri, which ship with Office.
- Check Presenter View shows the notes.
- Have `report.pdf` ready to share, and know the repository name (trism-dev/cfb-upset-study, private; grant access if asked).
- Rehearse once aloud with a timer; the main deck targets about 22 minutes.
- Resume bullet 4 says you "presented results". Use that bullet once this talk has been given.
