"""Hypothesis tests and out-of-sample evaluation. All returned values are plain Python floats/ints/lists.

H1 spread predicts outcome (Logit), H2 other features add information (likelihood ratio),
H3 spread-only probabilities are calibrated, H4 OLS margin model.
Full-model comparisons use only rows where every feature is present (complete rows).
"""
import numpy as np
import pandas as pd
import statsmodels.api as sm
from scipy import stats
from sklearn.calibration import calibration_curve
from sklearn.metrics import brier_score_loss, log_loss, roc_auc_score

EXTRA_FEATURES = ["sp_diff", "neutral", "conference_game", "week", "total"]
ALL_FEATURES = ["spread_home"] + EXTRA_FEATURES
SPREAD_BUCKETS = [0, 3, 7, 10, 14, 21, np.inf]
SPREAD_LABELS = ["0-3", "3-7", "7-10", "10-14", "14-21", "21+"]
PROB_CLIP = 1e-6


def design(frame, columns):
    return sm.add_constant(frame[columns].astype(float), has_constant="add")


def split(df, test_seasons=None):
    seasons = sorted(df["season"].unique())
    test_seasons = list(test_seasons) if test_seasons else seasons[-2:]
    is_test = df["season"].isin(test_seasons)
    train = df[~is_test]
    if len(train) and min(test_seasons) < train["season"].max():
        raise ValueError(
            f"test seasons {test_seasons} include a season earlier than the latest train season "
            f"{int(train['season'].max())}: no training on the future"
        )
    return train, df[is_test], [int(s) for s in test_seasons]


def fit_logit(y, X, label):
    result = sm.Logit(y, X).fit(disp=0)
    assert result.mle_retvals["converged"], f"Logit did not converge: {label}"
    return result


def fit_spread_logit(train):
    return fit_logit(train["home_win"].astype(float), design(train, ["spread_home"]), "spread-only")


def cluster_bootstrap_diff(diff, cluster_ids, n_boot, seed):
    """Bootstrap mean of per-game diff, resampling whole clusters. Returns (draws, n_clusters)."""
    codes, uniques = pd.factorize(pd.Series(list(cluster_ids)))
    n_clusters = len(uniques)
    sums = np.bincount(codes, weights=np.asarray(diff, float), minlength=n_clusters)
    counts = np.bincount(codes, minlength=n_clusters)
    idx = np.random.default_rng(seed).integers(0, n_clusters, size=(n_boot, n_clusters))
    return sums[idx].sum(axis=1) / counts[idx].sum(axis=1), int(n_clusters)


def fit_spread_ols(train):
    return sm.OLS(train["margin"].astype(float), design(train, ["spread_home"])).fit()


def predict_spread(model, frame):
    return model.predict(design(frame, ["spread_home"])).to_numpy()


def hosmer_lemeshow(y, p, bins=10):
    """Hosmer-Lemeshow statistic over equal-count bins of predicted probability; df = bins - 2."""
    y, p = np.asarray(y, float), np.asarray(p, float)
    group = pd.qcut(pd.Series(p).rank(method="first"), bins, labels=False).to_numpy()
    stat = 0.0
    for index in range(bins):
        mask = group == index
        count, observed, mean_p = mask.sum(), y[mask].sum(), p[mask].mean()
        stat += (observed - count * mean_p) ** 2 / (count * mean_p * (1 - mean_p))
    df = bins - 2
    return float(stat), df, float(stats.chi2.sf(stat, df))


def scores(y, p):
    y, p = np.asarray(y, float), np.asarray(p, float)
    return {
        "brier": float(brier_score_loss(y, p)),
        "log_loss": float(log_loss(y, p, labels=[0, 1])),
        "auc": float(roc_auc_score(y, p)),
    }


def coef_table(result):
    return {
        name: {"coef": float(result.params[name]), "se": float(result.bse[name]), "p": float(result.pvalues[name])}
        for name in result.params.index
    }


def run_models(df, test_seasons=None, seed=42, n_boot=2000):
    train, test, test_seasons = split(df, test_seasons)
    out = {
        "test_seasons": test_seasons,
        "n_train": len(train),
        "n_test": len(test),
    }

    # H1
    logit = fit_spread_logit(train)
    out["h1"] = {
        "intercept": float(logit.params["const"]),
        "coef": float(logit.params["spread_home"]),
        "z": float(logit.tvalues["spread_home"]),
        "p": float(logit.pvalues["spread_home"]),
    }

    # H2 (nested on the same complete rows)
    train_c = train.dropna(subset=ALL_FEATURES)
    test_c = test.dropna(subset=ALL_FEATURES)
    y_train_c = train_c["home_win"].astype(float)
    reduced = fit_logit(y_train_c, design(train_c, ["spread_home"]), "H2 reduced")
    full = fit_logit(y_train_c, design(train_c, ALL_FEATURES), "H2 full")
    lr_stat = 2 * (full.llf - reduced.llf)
    lr_df = int(full.df_model - reduced.df_model)
    out["h2"] = {
        "n_rows": len(train_c),
        "lr_stat": float(lr_stat),
        "df": lr_df,
        "p": float(stats.chi2.sf(lr_stat, lr_df)),
        "full_coefs": coef_table(full),
    }

    # H3 calibration of spread-only probabilities on test
    p_test = np.clip(predict_spread(logit, test), PROB_CLIP, 1 - PROB_CLIP)
    y_test = test["home_win"].to_numpy(float)
    link = np.log(p_test / (1 - p_test))
    calib = fit_logit(y_test, sm.add_constant(link), "H3 calibration")
    hl_stat, hl_df, hl_p = hosmer_lemeshow(y_test, p_test)
    out["h3"] = {
        "n_rows": len(test),
        "calibration_intercept": float(calib.params[0]),
        "calibration_intercept_se": float(calib.bse[0]),
        "calibration_slope": float(calib.params[1]),
        "calibration_slope_se": float(calib.bse[1]),
        "hosmer_lemeshow_stat": hl_stat,
        "hosmer_lemeshow_df": hl_df,
        "hosmer_lemeshow_p": hl_p,
    }

    # H4 OLS margin
    ols_full = sm.OLS(train_c["margin"].astype(float), design(train_c, ALL_FEATURES)).fit()
    ols_spread = fit_spread_ols(train)
    out["h4"] = {
        "full_n_rows": len(train_c),
        "full_r2": float(ols_full.rsquared),
        "full_resid_sd": float(np.sqrt(ols_full.mse_resid)),
        "full_coefs": coef_table(ols_full),
        "spread_only_r2": float(ols_spread.rsquared),
        "spread_only_resid_sd": float(np.sqrt(ols_spread.mse_resid)),
        "spread_only_coefs": coef_table(ols_spread),
    }

    # Evaluation on complete test rows (all three models on identical rows)
    y_c = test_c["home_win"].to_numpy(float)
    naive_p = np.full(len(test_c), train["home_win"].mean())
    spread_p = np.clip(predict_spread(logit, test_c), PROB_CLIP, 1 - PROB_CLIP)
    full_p = np.clip(full.predict(design(test_c, ALL_FEATURES)).to_numpy(), PROB_CLIP, 1 - PROB_CLIP)
    naive_s, spread_s, full_s = scores(y_c, naive_p), scores(y_c, spread_p), scores(y_c, full_p)
    err_spread, err_full = (spread_p - y_c) ** 2, (full_p - y_c) ** 2
    clusters = zip(test_c["season"], test_c["week"])
    boot, n_clusters = cluster_bootstrap_diff(err_full - err_spread, clusters, n_boot, seed)
    dropped = test[~test.index.isin(test_c.index)]
    out["evaluation"] = {
        "n_test_complete": len(test_c),
        "complete_case": {
            "n_test_all": len(test),
            "n_test_complete": len(test_c),
            "dropped_by_reason": {
                "sp_diff_missing": int(test["sp_diff"].isna().sum()),
                "total_missing": int(test["total"].isna().sum()),
            },
            "upset_rate_kept": float(test_c["underdog_win"].mean()),
            "upset_rate_dropped": float(dropped["underdog_win"].mean()) if len(dropped) else None,
        },
        "n_bootstrap_clusters": n_clusters,
        "bootstrap_cluster_unit": "season-week",
        "naive": naive_s,
        "spread_only": spread_s,
        "full": full_s,
        "brier_skill_spread_vs_naive": 1 - spread_s["brier"] / naive_s["brier"],
        "brier_skill_full_vs_naive": 1 - full_s["brier"] / naive_s["brier"],
        "brier_diff_full_minus_spread": float(full_s["brier"] - spread_s["brier"]),
        "brier_diff_ci95": [float(np.percentile(boot, 2.5)), float(np.percentile(boot, 97.5))],
        "n_bootstrap": n_boot,
    }
    out["upset_base_rate"] = {
        "train": float(train["underdog_win"].mean()),
        "test": float(test["underdog_win"].mean()),
    }

    def reliability(y, p):
        true_freq, mean_pred = calibration_curve(y, p, n_bins=10, strategy="quantile")
        return {"prob_true": true_freq.tolist(), "prob_pred": mean_pred.tolist()}

    out["reliability"] = {"spread_only": reliability(y_test, p_test), "full": reliability(y_c, full_p)}

    # Upset rate by |spread| bucket (spread-only model, all test rows)
    fav_win_p = np.where(test["fav_is_home"], p_test, 1 - p_test)
    bucket = pd.cut(test["spread_home"].abs(), SPREAD_BUCKETS, labels=SPREAD_LABELS, right=False)
    table = pd.DataFrame({
        "bucket": bucket.to_numpy(), "upset": test["underdog_win"].to_numpy(), "pred": 1 - fav_win_p
    })
    out["upset_by_spread_bucket"] = [
        {
            "bucket": label,
            "n": int(len(group)),
            "observed_upset_rate": float(group["upset"].mean()),
            "mean_predicted_upset_rate": float(group["pred"].mean()),
        }
        for label, group in table.groupby("bucket", observed=True)
    ]
    return out
