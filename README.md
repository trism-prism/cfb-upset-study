# Predicting College Football Upsets: A Statistical Research Study

**Question:** are NCAA FBS game outcomes predictable beyond the betting market's closing spread, or is what remains irreducible randomness?

**Answer:** the closing spread is an unbiased, well-calibrated forecast, and no public feature improves on it out of sample. What is left over is consistent with chance. The full write-up is in [report/report.pdf](report/report.pdf).

## Key results (3,900 FBS-vs-FBS games, seasons 2019 and 2021–24; tested on 2023–24)

| | Value |
|---|---|
| Brier score, spread-only model | **0.177** |
| Brier score, naive baseline | 0.244 (the spread is 27% better) |
| Full model minus spread-only, out of sample | +0.001 Brier, 95% CI [−0.001, +0.003] |
| Margin regressed on spread | slope −1.000, intercept −0.16 (p = 0.63) |
| Calibration | slope 1.09 ± 0.06, Hosmer–Lemeshow p = 0.06 |
| Monte Carlo (10,000 trials) | observed upsets p = 0.77, residual SD p = 0.63 |
| API filter bug fixed | 13.1% of records were FBS-vs-FCS games; left in, they inflate the measured skill by 4.7 points |

## Layout
- `cfb/api.py`: the CollegeFootballData REST client. It retries on errors and caches responses on disk.
- `cfb/etl.py`: cleaning plus the data-integrity audit.
- `cfb/models.py`: hypothesis tests, regressions and Brier/calibration evaluation.
- `cfb/simulate.py`: the Monte Carlo.
- `run_study.py`: runs everything end to end, including the bug-impact comparison.
- `docs/`: [methodology](docs/methodology.md), [data integrity log](docs/data-integrity.md) and [data dictionary](docs/data-dictionary.md).
- `results/`: `results.json` holds every reported number; `audit.json` and `figures/` are also here.
- `report/`: `report.md` is the source, `report.pdf` the rendered report, and `build_pdf.py` renders it with headless Edge.

## Reproduce
```
py -3.12 -m venv .venv
.venv\Scripts\python -m pip install -r requirements.txt
# create .env containing CFBD_API_KEY=<your CollegeFootballData key>
.venv\Scripts\python run_study.py --seasons 2019,2021-2024 --seed 42 --trials 10000
.venv\Scripts\python -m pytest -q
.venv\Scripts\python report\build_pdf.py
```

Two useful options:
- `--per-season-counts` prints the usable games for each season, which is how the season window was chosen.
- `--no-fetch` reuses `data/clean/games.parquet` instead of rebuilding it.

Two runs with the same seed produce a byte-identical `results.json`.
