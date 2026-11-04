"""Run the study: python run_study.py --seasons 2014-2019,2021-2024 --seed 42 --trials 10000"""
import argparse
import hashlib
import json
from importlib.metadata import version

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402

from cfb import etl, models, simulate  # noqa: E402

RESULTS_DIR = etl.ROOT / "results"
FIGURES_DIR = RESULTS_DIR / "figures"


def parse_seasons(text):
    seasons = []
    for part in text.split(","):
        first, _, last = part.strip().partition("-")
        seasons += range(int(first), int(last or first) + 1)
    return sorted(set(seasons))


def save(fig, name):
    fig.tight_layout()
    fig.savefig(FIGURES_DIR / name, dpi=130)
    plt.close(fig)


def plot_hist(ax, hist, observed, title, xlabel, hist_label="simulated"):
    ax.stairs(hist["counts"], hist["edges"], fill=True, alpha=0.6, label=hist_label)
    ax.axvline(observed, color="red", label=f"observed = {observed:.4g}")
    ax.set_title(title)
    ax.set_xlabel(xlabel)
    ax.set_ylabel("trials")
    ax.legend(loc="upper center", bbox_to_anchor=(0.5, -0.17), ncol=2)  # below the axes, clear of the bars


def make_figures(df, results):
    FIGURES_DIR.mkdir(parents=True, exist_ok=True)
    mod, sim = results["models"], results["simulation"]

    fig, ax = plt.subplots(figsize=(5.5, 5.5))
    ax.plot([0, 1], [0, 1], "k--", label="perfect")
    for name, label in (("spread_only", "spread only"), ("full", "full model")):
        curve = mod["reliability"][name]
        ax.plot(curve["prob_pred"], curve["prob_true"], "o-", label=label)
    ax.set_xlabel("predicted home-win probability")
    ax.set_ylabel("observed home-win frequency")
    ax.set_title("Reliability diagram (test seasons)")
    ax.legend()
    save(fig, "reliability_diagram.png")

    buckets = pd.DataFrame(mod["upset_by_spread_bucket"])
    positions = np.arange(len(buckets))
    fig, ax = plt.subplots(figsize=(7, 4.5))
    ax.bar(positions - 0.2, buckets["observed_upset_rate"], 0.4, label="observed")
    ax.bar(positions + 0.2, buckets["mean_predicted_upset_rate"], 0.4, label="mean predicted")
    ax.set_xticks(positions, [f"{row.bucket}\n(n={row.n})" for row in buckets.itertuples()])
    ax.set_xlabel("|closing spread|")
    ax.set_ylabel("upset rate")
    ax.set_title("Upset rate by spread size (test seasons)")
    ax.legend()
    save(fig, "upset_rate_by_spread.png")

    fig, axes = plt.subplots(1, 2, figsize=(11, 4.2))
    plot_hist(axes[0], sim["hist"]["bernoulli_upsets"], sim["bernoulli"]["upsets"]["observed"],
              "Upset count: outcomes redrawn from spread model", "upsets in test seasons")
    plot_hist(axes[1], sim["hist"]["normal_upsets"], sim["normal_margin"]["upsets"]["observed"],
              "Upset count: margins redrawn (normal)", "upsets in test seasons")
    save(fig, "mc_upsets.png")

    fig, axes = plt.subplots(1, 2, figsize=(11, 4.2))
    plot_hist(axes[0], sim["hist"]["bernoulli_brier"], sim["bernoulli"]["brier"]["observed"],
              "Brier: outcomes redrawn from spread model", "Brier score")
    plot_hist(axes[1], sim["hist"]["oracle_brier"], sim["bernoulli"]["brier"]["observed"],
              "oracle Brier (normal-margin model) vs observed", "Brier score",
              hist_label="oracle Brier (normal-margin model)")
    save(fig, "mc_brier.png")

    _, test, _ = models.split(df, mod["test_seasons"])
    resid = test["margin"] + test["spread_home"]
    fig, axes = plt.subplots(1, 2, figsize=(11, 4.5))
    axes[0].hist(resid, bins=40)
    axes[0].set_title(f"Margin residual (actual - market), SD = {resid.std():.2f}")
    axes[0].set_xlabel("margin + spread_home")
    axes[1].scatter(-test["spread_home"], test["margin"], s=6, alpha=0.4)
    lims = [-test["spread_home"].abs().max(), test["spread_home"].abs().max()]
    axes[1].plot(lims, lims, "r--", label="market-implied margin")
    axes[1].set_xlabel("market-implied home margin (-spread)")
    axes[1].set_ylabel("actual home margin")
    axes[1].legend()
    save(fig, "residuals.png")


def spread_summary(df, test_seasons):
    """Spread-only metrics on one dataset; Brier and calibration use ALL test rows (no complete-case drop)."""
    train, test, _ = models.split(df, test_seasons)
    logit = models.fit_spread_logit(train)
    p_test = np.clip(models.predict_spread(logit, test), models.PROB_CLIP, 1 - models.PROB_CLIP)
    y_test = test["home_win"].to_numpy(float)
    naive = models.scores(y_test, np.full(len(test), train["home_win"].mean()))["brier"]
    spread = models.scores(y_test, p_test)["brier"]
    return {
        "n_games": len(df),
        "n_test": len(test),
        "upset_rate_all_seasons": float(df["underdog_win"].mean()),
        "upset_rate_test": float(test["underdog_win"].mean()),
        "favorite_win_share_all_seasons": float(1 - df["underdog_win"].mean()),
        "mean_abs_spread_all_seasons": float(df["spread_home"].abs().mean()),
        "spread_logit_coef": float(logit.params["spread_home"]),
        "spread_only_brier_all_test_rows": spread,
        "naive_brier": naive,
        "brier_skill_spread_vs_naive": 1 - spread / naive,
        "ols_spread_only_resid_sd": float(np.sqrt(models.fit_spread_ols(train).mse_resid)),
        "calibration_slope": float(models.calibration_fit(y_test, p_test).params[1]),
        "hosmer_lemeshow_p": models.hosmer_lemeshow(y_test, p_test)[2],
    }


def matched_test_rows(buggy, fixed, test_seasons, seed):
    """Score buggy-trained vs fixed-trained spread logits on the FBS-vs-FBS test games both datasets share."""
    buggy_train, _, _ = models.split(buggy, test_seasons)
    fixed_train, fixed_test, _ = models.split(fixed, test_seasons)
    y = fixed_test["home_win"].to_numpy(float)
    err = {}
    for name, train in (("buggy", buggy_train), ("fixed", fixed_train)):
        p = np.clip(models.predict_spread(models.fit_spread_logit(train), fixed_test),
                    models.PROB_CLIP, 1 - models.PROB_CLIP)
        err[name] = (p - y) ** 2
    diff = err["buggy"] - err["fixed"]
    boot, n_clusters = models.cluster_bootstrap_diff(
        diff, zip(fixed_test["season"], fixed_test["week"]), 2000, seed
    )
    return {
        "n_games": len(fixed_test),
        "brier_buggy_model": float(err["buggy"].mean()),
        "brier_fixed_model": float(err["fixed"].mean()),
        "brier_diff_buggy_minus_fixed": float(diff.mean()),
        "brier_diff_ci95": [float(np.percentile(boot, 2.5)), float(np.percentile(boot, 97.5))],
        "n_bootstrap_clusters": n_clusters,
        "bootstrap_cluster_unit": "season-week",
    }


def bug_impact(seasons, test_seasons, seed, pipeline_df):
    """Before/after of trusting the API's classification=fbs filter (cached raw data, no network)."""
    games_raw, lines_raw, fbs, sp = etl.fetch_raw(seasons)
    fixed, audit = etl.clean(games_raw, lines_raw, fbs, sp)
    assert set(fixed["game_id"]) == set(pipeline_df["game_id"]), "recomputed fixed dataset differs from pipeline data"
    buggy, _ = etl.clean(games_raw, lines_raw, etl.teams_seen(games_raw), sp)
    added = buggy.groupby("season").size().sub(fixed.groupby("season").size(), fill_value=0)
    with_lines = {row["game_id"] for row in map(etl.game_row, games_raw)} & {
        game.get("id") for game in lines_raw if game.get("lines")
    }
    leaked = sum(
        1 for row in {r["game_id"]: r for r in map(etl.game_row, games_raw)}.values()
        if not (row["home_team"] in fbs.get(row["season"], ()) and row["away_team"] in fbs.get(row["season"], ()))
        and row["game_id"] in with_lines
    )
    return {
        "api_filter_rows": audit["raw_game_rows"],
        "leaked_rows": audit["non_fbs_leakage_removed"],
        "leaked_share": audit["non_fbs_leakage_removed"] / audit["raw_game_rows"],
        "leaked_with_lines": leaked,
        "rows_added_to_dataset": len(buggy) - len(fixed),
        "rows_added_by_season": {str(season): int(count) for season, count in added.items()},
        "matched_test_rows": matched_test_rows(buggy, fixed, test_seasons, seed),
        "buggy": spread_summary(buggy, test_seasons),
        "fixed": spread_summary(fixed, test_seasons),
    }


def leakage_summary(df, test_seasons, seed):
    result = models.run_models(df, test_seasons, seed)
    evaluation, sp_coef = result["evaluation"], result["h2"]["full_coefs"]["sp_diff"]
    ci_low, ci_high = evaluation["brier_diff_ci95"]
    return {
        "n_games": len(df),
        "n_train": result["n_train"],
        "n_test": result["n_test"],
        "h2_lr_stat": result["h2"]["lr_stat"],
        "h2_df": result["h2"]["df"],
        "h2_p": result["h2"]["p"],
        "sp_diff_logit_coef": sp_coef["coef"],
        "sp_diff_logit_p": sp_coef["p"],
        "full_brier": evaluation["full"]["brier"],
        "full_log_loss": evaluation["full"]["log_loss"],
        "full_auc": evaluation["full"]["auc"],
        "spread_only_brier": evaluation["spread_only"]["brier"],
        "brier_diff_full_minus_spread": evaluation["brier_diff_full_minus_spread"],
        "brier_diff_ci95": [ci_low, ci_high],
        "n_bootstrap_clusters": evaluation["n_bootstrap_clusters"],
        "brier_skill_full_vs_naive": evaluation["brier_skill_full_vs_naive"],
        "h4_full_r2": result["h4"]["full_r2"],
        "h4_spread_only_r2": result["h4"]["spread_only_r2"],
        "n_test_complete": evaluation["n_test_complete"],
        "full_beats_spread_out_of_sample": bool(ci_high < 0),
    }


def leakage_impact(seasons, test_seasons, seed, pipeline_df):
    """Before/after of using same-season (end-of-season, outcome-contaminated) SP+ instead of prior-season."""
    games_raw, lines_raw, fbs, sp_same = etl.fetch_raw(seasons, sp_lag=0)
    leaky, leaky_audit = etl.clean(games_raw, lines_raw, fbs, sp_same, sp_lag=0)
    # The two datasets must differ only in sp_diff (dtype-insensitive: parquet round-trip).
    pd.testing.assert_frame_equal(
        leaky.drop(columns="sp_diff").sort_values("game_id").reset_index(drop=True),
        pipeline_df.drop(columns="sp_diff").sort_values("game_id").reset_index(drop=True),
        check_dtype=False,
    )
    # Like-for-like: keep only games with sp_diff present in BOTH arms.
    both = set(leaky.loc[leaky["sp_diff"].notna(), "game_id"]) & set(
        pipeline_df.loc[pipeline_df["sp_diff"].notna(), "game_id"]
    )
    clean_arm = pipeline_df[pipeline_df["game_id"].isin(both)]
    leaky_arm = leaky[leaky["game_id"].isin(both)]
    return {
        "n_games_before_matching": len(pipeline_df),
        "n_games_dropped_by_matching": len(pipeline_df) - len(both),
        "clean_sp_diff_missing": int(pipeline_df["sp_diff"].isna().sum()),
        "leaky_sp_diff_missing": leaky_audit["sp_diff_missing"],
        "clean_prior_season_sp": leakage_summary(clean_arm, test_seasons, seed),
        "leaky_same_season_sp": leakage_summary(leaky_arm, test_seasons, seed),
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--seasons", default="2014-2019,2021-2024")
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--trials", type=int, default=10000)
    parser.add_argument("--no-fetch", action="store_true", help="load data/clean/games.parquet instead of building")
    parser.add_argument("--per-season-counts", action="store_true",
                        help="fetch games+lines only and print usable games per season")
    args = parser.parse_args()
    seasons = parse_seasons(args.seasons)

    if args.per_season_counts:
        _, audit = etl.clean(*etl.fetch_raw(seasons, with_sp=False))
        total = audit["final_games"]
        print(json.dumps(audit["final_games_by_season"], indent=2))
        print(f"total usable games: {total}")
        return

    df = pd.read_parquet(etl.CLEAN_PATH) if args.no_fetch else etl.build(seasons)
    audit = json.loads(etl.AUDIT_PATH.read_text(encoding="utf-8")) if etl.AUDIT_PATH.exists() else None
    model_results = models.run_models(df, seed=args.seed)
    sim_results = simulate.simulate(df, model_results["test_seasons"], args.seed, args.trials)
    results = {
        "config": {
            "seasons": seasons,
            "seed": args.seed,
            "trials": args.trials,
            "test_seasons": model_results["test_seasons"],
            "n_games_total": len(df),
            "n_games_train": model_results["n_train"],
            "n_games_test": model_results["n_test"],
            "library_versions": {
                name: version(name) for name in ("pandas", "numpy", "scikit-learn", "statsmodels", "scipy")
            },
            "games_parquet_sha256": hashlib.sha256(etl.CLEAN_PATH.read_bytes()).hexdigest(),
        },
        "audit": audit,
        "models": model_results,
        "simulation": sim_results,
        "bug_impact": bug_impact(seasons, model_results["test_seasons"], args.seed, df),
        "leakage_impact": leakage_impact(seasons, model_results["test_seasons"], args.seed, df),
    }
    RESULTS_DIR.mkdir(exist_ok=True)
    (RESULTS_DIR / "results.json").write_text(json.dumps(results, indent=2, sort_keys=True), encoding="utf-8")
    make_figures(df, results)
    print(f"wrote results/results.json and figures for {len(df)} games")


if __name__ == "__main__":
    main()
