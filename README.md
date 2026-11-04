# Predicting College Football Upsets: A Statistical Research Study

Question: are NCAA FBS outcomes predictable beyond the betting market's closing spread, or is the remainder irreducible randomness?

## Setup

```
py -3.12 -m venv .venv
.venv\Scripts\python -m pip install -r requirements.txt
```

Create `.env` with `CFBD_API_KEY=<your CollegeFootballData key>` (see `.env.example`).

## Run

```
.venv\Scripts\python run_study.py --per-season-counts --seasons 2014-2024
.venv\Scripts\python run_study.py --seasons 2014-2019,2021-2024 --seed 42 --trials 10000
.venv\Scripts\python run_study.py --no-fetch   # reuse data/clean/games.parquet
```

Output goes to `results/` (`results.json`, `audit.json`, `figures/`).

## Test

```
.venv\Scripts\python -m pytest -q
```

Full documentation to come.
