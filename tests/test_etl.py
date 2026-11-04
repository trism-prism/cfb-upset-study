import math

import pytest

from cfb import etl

FBS = {2023: {"A", "B", "C", "D"}}
SP = {2022: {"A": 10.0, "B": 4.0}}


def game(game_id, home, away, home_points=28, away_points=14, **extra):
    row = {
        "id": game_id, "season": 2023, "week": 3, "seasonType": "regular", "neutralSite": False,
        "conferenceGame": True, "homeTeam": home, "awayTeam": away, "homeConference": "X",
        "awayConference": "Y", "homePoints": home_points, "awayPoints": away_points, "completed": True,
    }
    row.update(extra)
    return row


def lines(game_id, *spreads, providers=None):
    names = providers or [f"book{i}" for i in range(len(spreads))]
    return {"id": game_id, "lines": [
        {"provider": name, "spread": spread, "overUnder": 50.0} for name, spread in zip(names, spreads)
    ]}


def run(games, line_list):
    frame, audit = etl.clean(games, line_list, FBS, SP)
    return frame.set_index("game_id"), audit


def test_spread_sign_home_favored():
    frame, audit = run([game(1, "A", "B")], [lines(1, -7)])
    row = frame.loc[1]
    assert row.spread_home == -7
    assert row.fav_is_home
    assert row.home_implied_margin == 7
    assert row.underdog_win == 0  # favorite (home) won
    assert row.sp_diff == 6.0  # 10 - 4, prior-season ratings
    assert audit["favorite_win_share"] == 1.0  # one game, favorite won


def test_sign_check_ok_in_normal_range():
    games = [game(i, "A", "B", home_points=28 if i <= 3 else 10, away_points=14 if i <= 3 else 20) for i in range(1, 5)]
    _, audit = run(games, [lines(i, -7) for i in range(1, 5)])
    assert audit["favorite_win_share"] == 0.75
    assert audit["sign_check"] == "ok"


def test_build_raises_on_suspect_sign_but_writes_audit(tmp_path, monkeypatch):
    flipped = [game(i, "A", "B", home_points=10, away_points=20) for i in range(1, 4)]  # favorite always loses
    raw = (flipped, [lines(i, -7) for i in range(1, 4)], FBS, SP)
    monkeypatch.setattr(etl, "fetch_raw", lambda seasons, with_sp=True: raw)
    monkeypatch.setattr(etl, "CLEAN_PATH", tmp_path / "games.parquet")
    monkeypatch.setattr(etl, "AUDIT_PATH", tmp_path / "audit.json")
    with pytest.raises(RuntimeError, match="SUSPECT"):
        etl.build([2023])
    assert (tmp_path / "audit.json").exists()


def test_upset_when_underdog_wins():
    frame, _ = run([game(1, "A", "B", home_points=10, away_points=20)], [lines(1, -7)])
    assert frame.loc[1].underdog_win == 1


def test_median_consensus_and_string_spread():
    frame, _ = run([game(1, "A", "B")], [lines(1, -3, "-7.0", -10)])
    assert frame.loc[1].spread_home == -7
    assert frame.loc[1].n_providers == 3
    assert frame.loc[1].total == 50.0


def test_duplicate_provider_lines_counted_and_deduped():
    raw = lines(1, -7, -3, -9, providers=["p1", "p1", "p2"])
    frame, audit = run([game(1, "A", "B")], [raw])
    assert audit["duplicate_game_provider_lines_removed"] == 1
    assert frame.loc[1].n_providers == 2
    assert frame.loc[1].spread_home == -8  # median of -7 and -9


def test_non_fbs_dropped_and_counted():
    frame, audit = run([game(1, "A", "B"), game(2, "A", "Tiny U")], [lines(1, -7), lines(2, -20)])
    assert list(frame.index) == [1]
    assert audit["non_fbs_leakage_removed"] == 1


def test_pickem_excluded():
    frame, audit = run([game(1, "A", "B"), game(2, "C", "D")], [lines(1, 0), lines(2, -3)])
    assert list(frame.index) == [2]
    assert audit["pickem_excluded"] == 1


def test_incomplete_dropped():
    games = [game(1, "A", "B", completed=False), game(2, "C", "D", home_points=None), game(3, "A", "C")]
    frame, audit = run(games, [lines(1, -7), lines(2, -7), lines(3, -7)])
    assert list(frame.index) == [3]
    assert audit["incomplete_or_missing_scores_removed"] == 2


def test_bad_spreads_and_unmatched_ids_audited():
    games = [game(1, "A", "B"), game(2, "C", "D"), game(3, "A", "D")]
    raw = [lines(1, 80), lines(2, None, "abc"), lines(99, -3)]
    frame, audit = run(games, raw)
    assert len(frame) == 0
    assert audit["lines_abs_spread_over_70"] == 1
    assert audit["lines_null_spread"] == 1
    assert audit["lines_nonnumeric_spread"] == 1
    assert audit["lines_games_without_game"] == 1
    assert audit["games_without_line_entry"] == 1
    assert audit["no_valid_line_removed"] == 3


def test_missing_sp_is_nan_and_duplicate_game_ids_counted():
    frame, audit = run([game(1, "C", "D"), game(1, "C", "D")], [lines(1, -7)])
    assert math.isnan(frame.loc[1].sp_diff)
    assert audit["duplicate_game_ids_removed"] == 1
    assert audit["final_games"] == 1
