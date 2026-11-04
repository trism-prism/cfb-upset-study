"""Fetch, clean and audit FBS-vs-FBS games with closing lines.

Clean output columns (one row per game):
    game_id, season, week, season_type, neutral, conference_game,
    home_team, away_team, home_conf, away_conf, home_points, away_points,
    margin (home - away), home_win,
    spread_home (median closing spread over providers, negative = home favored),
    n_providers, total (median over/under),
    sp_diff (prior-season SP+ home minus away, NaN if missing),
    fav_is_home, underdog_win (upset), home_implied_margin (= -spread_home).

clean() is a pure function of raw lists; fetch_raw() and build() do the network and disk work.
"""
import json
import math

import pandas as pd

from cfb import api

ROOT = api.ROOT
CLEAN_PATH = ROOT / "data" / "clean" / "games.parquet"
AUDIT_PATH = ROOT / "results" / "audit.json"
SEASON_TYPES = ("regular", "postseason")
MAX_ABS_SPREAD = 70
SIGN_OK_RANGE = (0.6, 0.9)


def pick(row, *names):
    """First non-null value among several possible field names (API field names vary)."""
    for name in names:
        if row.get(name) is not None:
            return row[name]
    return None


def to_float(value):
    """Coerce to float; None, junk strings and non-finite values become NaN."""
    try:
        number = float(value)
    except (TypeError, ValueError):
        return math.nan
    return number if math.isfinite(number) else math.nan


def game_row(raw):
    return {
        "game_id": pick(raw, "id", "gameId"),
        "season": pick(raw, "season"),
        "week": pick(raw, "week"),
        "season_type": pick(raw, "seasonType", "season_type"),
        "neutral": bool(pick(raw, "neutralSite", "neutral_site") or False),
        "conference_game": bool(pick(raw, "conferenceGame", "conference_game") or False),
        "home_team": pick(raw, "homeTeam", "home_team"),
        "away_team": pick(raw, "awayTeam", "away_team"),
        "home_conf": pick(raw, "homeConference", "home_conference"),
        "away_conf": pick(raw, "awayConference", "away_conference"),
        "home_points": to_float(pick(raw, "homePoints", "home_points")),
        "away_points": to_float(pick(raw, "awayPoints", "away_points")),
        "completed": pick(raw, "completed"),
    }


def line_rows(lines_raw):
    """Flatten /lines (game -> lines list) into one row per (game, provider)."""
    rows, line_game_ids = [], set()
    for game in lines_raw:
        game_id = pick(game, "id", "gameId")
        line_game_ids.add(game_id)
        for line in game.get("lines") or []:
            rows.append({
                "game_id": game_id,
                "provider": line.get("provider"),
                "spread_raw": line.get("spread"),
                "spread": to_float(line.get("spread")),
                "total": to_float(pick(line, "overUnder", "over_under")),
            })
    frame = pd.DataFrame(rows, columns=["game_id", "provider", "spread_raw", "spread", "total"])
    return frame, line_game_ids


def clean(games_raw, lines_raw, fbs_by_season, sp_by_season):
    """Pure cleaning. fbs_by_season: {season: set(team)}; sp_by_season: {season: {team: rating}}.

    Returns (DataFrame, audit dict). Only the explicit rules below remove rows.
    """
    audit = {}
    games = pd.DataFrame([game_row(raw) for raw in games_raw])
    audit["raw_game_rows"] = len(games)
    all_game_ids = set(games["game_id"])

    dup = games.duplicated("game_id", keep="first")
    audit["duplicate_game_ids_removed"] = int(dup.sum())
    games = games[~dup]

    lines, line_game_ids = line_rows(lines_raw)
    audit["raw_line_rows"] = len(lines)
    audit["lines_games_without_game"] = len(line_game_ids - all_game_ids)
    audit["games_without_line_entry"] = len(all_game_ids - line_game_ids)
    dup_lines = lines.duplicated(["game_id", "provider"], keep="first")
    audit["duplicate_game_provider_lines_removed"] = int(dup_lines.sum())
    lines = lines[~dup_lines]
    audit["lines_null_spread"] = int(lines["spread_raw"].isna().sum())
    audit["lines_nonnumeric_spread"] = int((lines["spread"].isna() & lines["spread_raw"].notna()).sum())
    too_big = lines["spread"].abs() > MAX_ABS_SPREAD
    audit["lines_abs_spread_over_70"] = int(too_big.sum())
    lines = lines[lines["spread"].notna() & ~too_big]
    audit["valid_line_rows"] = len(lines)

    # FBS check: both teams must be in /teams/fbs for that season.
    in_fbs = [
        row.home_team in fbs_by_season.get(row.season, ()) and row.away_team in fbs_by_season.get(row.season, ())
        for row in games.itertuples()
    ]
    audit["non_fbs_leakage_removed"] = int(len(games) - sum(in_fbs))
    games = games[in_fbs]

    incomplete = (games["completed"] == False) | games["home_points"].isna() | games["away_points"].isna()  # noqa: E712
    audit["incomplete_or_missing_scores_removed"] = int(incomplete.sum())
    games = games[~incomplete].drop(columns="completed")

    consensus = lines.groupby("game_id").agg(
        spread_home=("spread", "median"), n_providers=("spread", "size"), total=("total", "median")
    )
    games = games.merge(consensus, left_on="game_id", right_index=True, how="left")
    no_line = games["spread_home"].isna()
    audit["no_valid_line_removed"] = int(no_line.sum())
    games = games[~no_line]

    pickem = games["spread_home"] == 0
    audit["pickem_excluded"] = int(pickem.sum())
    games = games[~pickem].copy()

    games["margin"] = games["home_points"] - games["away_points"]
    games["home_win"] = (games["margin"] > 0).astype(int)
    games["fav_is_home"] = games["spread_home"] < 0
    games["underdog_win"] = (games["fav_is_home"] != (games["margin"] > 0)).astype(int)
    games["home_implied_margin"] = -games["spread_home"]
    games["n_providers"] = games["n_providers"].astype(int)

    def prior_rating(row, side):
        return sp_by_season.get(row.season - 1, {}).get(getattr(row, side), math.nan)

    games["sp_diff"] = [
        prior_rating(row, "home_team") - prior_rating(row, "away_team") for row in games.itertuples()
    ]

    games = games.sort_values(["season", "game_id"]).reset_index(drop=True)
    audit["final_games"] = len(games)
    audit["final_games_by_season"] = {str(k): int(v) for k, v in games.groupby("season").size().items()}
    audit["neutral_site_games"] = int(games["neutral"].sum())
    audit["sp_diff_missing"] = int(games["sp_diff"].isna().sum())
    share = 1 - float(games["underdog_win"].mean()) if len(games) else math.nan
    audit["favorite_win_share"] = share
    audit["sign_check"] = (
        "ok" if SIGN_OK_RANGE[0] <= share <= SIGN_OK_RANGE[1]
        else "SUSPECT: favorite win share outside 0.6-0.9, sign convention may be flipped (~0.2-0.3 means flipped)"
    )
    return games[OUTPUT_COLUMNS], audit


OUTPUT_COLUMNS = [
    "game_id", "season", "week", "season_type", "neutral", "conference_game",
    "home_team", "away_team", "home_conf", "away_conf", "home_points", "away_points",
    "margin", "home_win", "spread_home", "n_providers", "total", "sp_diff",
    "fav_is_home", "underdog_win", "home_implied_margin",
]


def team_name(row):
    return pick(row, "school", "team", "name")


def fetch_raw(seasons, with_sp=True):
    """Pull raw lists from the API (or disk cache). SP+ is fetched for season-1 of each season."""
    games_raw, lines_raw, fbs, sp = [], [], {}, {}
    for year in seasons:
        for season_type in SEASON_TYPES:
            games_raw += api.get("/games", year=year, seasonType=season_type, classification="fbs")
            lines_raw += api.get("/lines", year=year, seasonType=season_type)
        fbs[year] = {team_name(team) for team in api.get("/teams/fbs", year=year)}
    if with_sp:
        for year in {season - 1 for season in seasons}:
            sp[year] = {
                row.get("team"): to_float(row.get("rating"))
                for row in api.get("/ratings/sp", year=year)
                if row.get("team")
            }
    return games_raw, lines_raw, fbs, sp


def build(seasons, with_sp=True):
    """Fetch, clean, audit. Saves data/clean/games.parquet and results/audit.json; returns the DataFrame."""
    games, audit = clean(*fetch_raw(seasons, with_sp))
    # audit goes to disk only; build() returns just the DataFrame
    CLEAN_PATH.parent.mkdir(parents=True, exist_ok=True)
    AUDIT_PATH.parent.mkdir(parents=True, exist_ok=True)
    games.to_parquet(CLEAN_PATH)
    AUDIT_PATH.write_text(json.dumps(audit, indent=2, sort_keys=True), encoding="utf-8")
    if audit["sign_check"].startswith("SUSPECT"):
        raise RuntimeError(f"Audit failed, inspect {AUDIT_PATH}: {audit['sign_check']}")
    return games
