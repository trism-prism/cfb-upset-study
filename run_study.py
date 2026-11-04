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
    ax.legend()


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
    }
    RESULTS_DIR.mkdir(exist_ok=True)
    (RESULTS_DIR / "results.json").write_text(json.dumps(results, indent=2, sort_keys=True), encoding="utf-8")
    make_figures(df, results)
    print(f"wrote results/results.json and figures for {len(df)} games")


if __name__ == "__main__":
    main()
