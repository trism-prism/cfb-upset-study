import json

import numpy as np
import pandas as pd
import pytest
from scipy import stats

from cfb import models, simulate


def test_brier_and_log_loss_by_hand():
    result = models.scores([1, 0, 1], [0.8, 0.3, 0.5])
    assert abs(result["brier"] - (0.04 + 0.09 + 0.25) / 3) < 1e-12
    assert abs(result["log_loss"] - -(np.log(0.8) + np.log(0.7) + np.log(0.5)) / 3) < 1e-12


def test_hosmer_lemeshow_by_hand():
    # 20 games, 2 per bin. Low bins (p=0.1) have observed 1,0,0,0,0; high bins (p=0.9) have 2,2,2,2,0.
    # Low: (0.8^2 + 4*0.2^2)/0.18 = 4.4444 ; high: (4*0.2^2 + 1.8^2)/0.18 = 18.8889 ; total 70/3.
    p = [0.1] * 10 + [0.9] * 10
    y = [1, 0, 0, 0, 0, 0, 0, 0, 0, 0] + [1, 1, 1, 1, 1, 1, 1, 1, 0, 0]
    stat, df, p_value = models.hosmer_lemeshow(y, p)
    assert abs(stat - 70 / 3) < 1e-9
    assert df == 8
    assert abs(p_value - stats.chi2.sf(70 / 3, 8)) < 1e-12


def test_split_rejects_training_on_the_future():
    df = pd.DataFrame({"season": [2019, 2020, 2021, 2022]})
    with pytest.raises(ValueError, match="future"):
        models.split(df, [2019, 2020])
    train, test, _ = models.split(df, [2021, 2022])
    assert len(train) == 2 and len(test) == 2


def test_cluster_bootstrap_reports_clusters_and_resamples_whole_clusters():
    diff = np.array([1.0, 1.0, 0.0, 0.0, 5.0])
    clusters = [(2023, 1), (2023, 1), (2023, 2), (2023, 2), (2024, 1)]
    draws, n_clusters = models.cluster_bootstrap_diff(diff, clusters, n_boot=200, seed=3)
    assert n_clusters == 3
    assert draws.shape == (200,)
    assert draws.min() >= 0 and draws.max() <= 5  # means of the per-game diffs


def test_calibration_slope_near_one_for_true_probabilities():
    rng = np.random.default_rng(11)
    p = rng.uniform(0.05, 0.95, 5000)
    y = (rng.random(5000) < p).astype(float)
    fit = models.calibration_fit(y, p)
    assert abs(fit.params[1] - 1) < 0.1
    assert abs(fit.params[0]) < 0.1


def synthetic(n=2000, seed=7):
    rng = np.random.default_rng(seed)
    spread = np.round(rng.normal(0, 10, n) * 2) / 2
    spread[spread == 0] = 3.5
    margin = -spread + rng.normal(0, 16, n)
    margin[margin == 0] = 1.0
    return pd.DataFrame({
        "season": np.repeat([2020, 2021, 2022, 2023, 2024], n // 5),
        "spread_home": spread,
        "margin": margin,
        "home_win": (margin > 0).astype(int),
        "fav_is_home": spread < 0,
        "underdog_win": ((spread < 0) != (margin > 0)).astype(int),
        "sp_diff": rng.normal(0, 10, n),
        "neutral": rng.random(n) < 0.05,
        "conference_game": rng.random(n) < 0.5,
        "week": rng.integers(1, 14, n),
        "total": rng.normal(55, 8, n),
    })


def test_end_to_end_on_synthetic_data():
    df = synthetic()
    results = models.run_models(df, seed=1)
    for key in ("h1", "h2", "h3", "h4", "evaluation", "upset_base_rate", "reliability", "upset_by_spread_bucket"):
        assert key in results
    assert results["test_seasons"] == [2023, 2024]
    assert results["h1"]["coef"] < 0 and results["h1"]["p"] < 0.001
    assert results["h2"]["df"] == 5
    assert results["h3"]["hosmer_lemeshow_df"] == 8
    assert len(results["evaluation"]["brier_diff_ci95"]) == 2
    assert results["evaluation"]["n_bootstrap_clusters"] == 26  # 2 seasons x 13 weeks
    assert results["evaluation"]["complete_case"]["n_test_all"] == 800
    assert [row["bucket"] for row in results["upset_by_spread_bucket"]] == models.SPREAD_LABELS

    sim = simulate.simulate(df, results["test_seasons"], seed=1, n_trials=500)
    for key in ("bernoulli", "normal_margin", "oracle_brier", "hist"):
        assert key in sim
    assert sim["bernoulli"]["upsets"]["p_value"] > 0.01
    json.dumps({"models": results, "simulation": sim})  # everything is JSON-serializable
