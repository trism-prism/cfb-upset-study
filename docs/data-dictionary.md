# Data dictionary: `data/clean/games.parquet`

There is one row per FBS-vs-FBS game with a closing line: regular season plus bowls, seasons 2019 and 2021–2024. There are 3,900 rows.

| Column | Type | Meaning |
|---|---|---|
| game_id | int | CollegeFootballData game id |
| season | int | Season year |
| week | int | Week of the season (postseason games have their own week numbers) |
| season_type | str | `regular` or `postseason` |
| neutral | bool | Played at a neutral site |
| conference_game | bool | Both teams in the same conference |
| home_team, away_team | str | Team names as listed in `/teams/fbs` |
| home_conf, away_conf | str | Conferences |
| home_points, away_points | float | Final score |
| margin | float | home_points − away_points |
| home_win | int | 1 if margin > 0 (college football has no ties) |
| spread_home | float | Median closing spread across providers, from the home team's side; negative means the home team is favored |
| n_providers | int | Number of providers whose valid lines feed the median |
| total | float | Median closing over/under |
| sp_diff | float | Home team's prior-season SP+ rating minus the away team's. NaN if either is missing. The prior season is used so that no result from the game's own season feeds the feature. |
| fav_is_home | bool | spread_home < 0 |
| underdog_win | int | 1 if the closing-line underdog won outright (an upset) |
| home_implied_margin | float | −spread_home, the market's expected home margin |
