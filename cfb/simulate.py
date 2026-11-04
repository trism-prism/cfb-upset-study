"""Monte Carlo: could the observed test-season results have come from the market-implied model alone?

Trials are vectorized in chunks (chunk x games arrays) to bound memory.
"""
import numpy as np
from scipy import stats

from cfb import models

CHUNK = 1000
HIST_BINS = 40


def compare(observed, sims):
    """Observed value against a simulated distribution: percentile and two-sided empirical p-value."""
    below = float(np.mean(sims <= observed))
    above = float(np.mean(sims >= observed))
    return {
        "observed": float(observed),
        "sim_mean": float(sims.mean()),
        "sim_sd": float(sims.std(ddof=1)),
        "sim_ci95": [float(np.percentile(sims, 2.5)), float(np.percentile(sims, 97.5))],
        "percentile": 100 * below,
        "p_value": min(1.0, 2 * min(below, above)),
    }


def histogram(sims, integer=False):
    if integer:
        edges = np.arange(int(sims.min()), int(sims.max()) + 2)
    else:
        edges = HIST_BINS
    counts, edges = np.histogram(sims, bins=edges)
    return {"counts": counts.tolist(), "edges": edges.astype(float).tolist()}


def simulate(df, test_seasons=None, seed=42, n_trials=10000):
    train, test, test_seasons = models.split(df, test_seasons)
    p_home = np.clip(models.predict_spread(models.fit_spread_logit(train), test), 1e-6, 1 - 1e-6)
    # The null is margin = -spread + noise, so the noise SD is the SD of (margin + spread) on train
    # (not the OLS residual SD, which centres on a fitted line).
    resid_sd = float(np.std(train["margin"].to_numpy(float) + train["spread_home"].to_numpy(float), ddof=1))
    spread = test["spread_home"].to_numpy(float)
    fav_home = test["fav_is_home"].to_numpy(bool)
    y = test["home_win"].to_numpy(float)
    n_games = len(test)
    rng = np.random.default_rng(seed)

    # (1) Redraw outcomes from the spread-only logistic probabilities.
    upsets_bern, brier_bern = [], []
    # (2) Redraw margins = -spread + Normal(0, resid_sd); oracle probability = P(margin > 0).
    p_true = stats.norm.cdf(-spread / resid_sd)
    upsets_norm, sd_norm, brier_oracle = [], [], []
    for start in range(0, n_trials, CHUNK):
        size = min(CHUNK, n_trials - start)
        home_win = rng.random((size, n_games)) < p_home
        upsets_bern.append((home_win != fav_home).sum(axis=1))
        brier_bern.append(((p_home - home_win) ** 2).mean(axis=1))

        noise = rng.normal(0.0, resid_sd, size=(size, n_games))
        home_win = (-spread + noise) > 0
        upsets_norm.append((home_win != fav_home).sum(axis=1))
        sd_norm.append(noise.std(axis=1, ddof=1))
        brier_oracle.append(((p_true - home_win) ** 2).mean(axis=1))
    upsets_bern, brier_bern = np.concatenate(upsets_bern), np.concatenate(brier_bern)
    upsets_norm, sd_norm = np.concatenate(upsets_norm), np.concatenate(sd_norm)
    brier_oracle = np.concatenate(brier_oracle)

    observed_upsets = int(test["underdog_win"].sum())
    observed_brier = float(np.mean((p_home - y) ** 2))
    observed_resid_sd = float(np.std(test["margin"].to_numpy(float) + spread, ddof=1))
    return {
        "test_seasons": test_seasons,
        "n_test_games": n_games,
        "n_trials": n_trials,
        "seed": seed,
        "note": (
            "Simulation uses ALL test games (observed_brier_all_test_rows). models.evaluation uses only "
            "complete-case test rows, so its Brier values differ from this one."
        ),
        "observed_brier_all_test_rows": observed_brier,
        "bernoulli": {
            "upsets": compare(observed_upsets, upsets_bern),
            "brier": compare(observed_brier, brier_bern),
        },
        "normal_margin": {
            "train_resid_sd": resid_sd,
            "upsets": compare(observed_upsets, upsets_norm),
            "resid_sd": compare(observed_resid_sd, sd_norm),
        },
        "oracle_brier": {
            "mean": float(brier_oracle.mean()),
            "ci95": [float(np.percentile(brier_oracle, 2.5)), float(np.percentile(brier_oracle, 97.5))],
        },
        "hist": {
            "bernoulli_upsets": histogram(upsets_bern, integer=True),
            "bernoulli_brier": histogram(brier_bern),
            "normal_upsets": histogram(upsets_norm, integer=True),
            "normal_resid_sd": histogram(sd_norm),
            "oracle_brier": histogram(brier_oracle),
        },
    }
