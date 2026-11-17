# gta6-twitch-forecast

[![make.fun · gta6-twitch-ccu-forecast-01](https://make.fun/badge/gta6-twitch-ccu-forecast-01.svg)](https://make.fun/bounty/gta6-twitch-ccu-forecast-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-twitch-ccu-forecast-01)
[![rank](https://make.fun/badge/gta6-twitch-ccu-forecast-01/antololcrazy1/gta6-twitch-forecast/rank.svg)](https://make.fun/bounty/gta6-twitch-ccu-forecast-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=gta6-twitch-ccu-forecast-01)
[![reward](https://make.fun/badge/gta6-twitch-ccu-forecast-01/antololcrazy1/gta6-twitch-forecast/reward.svg)](https://make.fun/bounty/gta6-twitch-ccu-forecast-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-twitch-ccu-forecast-01)

Forecasts GTA VI's launch-day Twitch viewers hour by hour from the first hour's count, using the release-day curves of past big launches.

## Run it

```sh
mkdir -p out && MAKEFUN_INPUT_DIR=input MAKEFUN_OUTPUT_DIR=out node main.ts
```

`main.ts` (Node 22, standard library only) reads every `<id>.in` case in the input directory and writes `<id>.out` for each: for hours 2 to 24 of the release day, five quantiles (5%, 25%, 50%, 75%, 95%) of that hour's concurrent Twitch viewers. Without the environment variables it reads `/input` and writes `/output`, as the grader runs it.

## Method

A launch day has a shape, not a level: hour 1 is the midnight unlock in the UK and Europe, the small hours sag, the US unlocks lift the morning, and the evening peaks when Europe watches after dinner and America watches in the afternoon. The program learns that shape from the past big launches the case file carries: each launch's release day becomes a curve of log-ratios against its own first hour, and for every hour the forecast is the weighted quantiles of those curves. A past launch counts more the closer it is to this one in log(hour 1 / pre-release baseline) and log(hour 1), and console-only launches count double, because this game is console-only and their midnight rolling unlocks match. The spread between quantiles is the spread between past launches, so it widens where launches disagree most. Deterministic: fixed weights, sorted values, no clock, no randomness.

On the four practice launches it scores a mean pinball loss of about 0.24 (typical miss about 41%), against the house baseline's 0.39 (typical miss about 83%).

---

<sub>Entered on [make.fun](https://make.fun/?ref=antolol&utm_source=github&utm_medium=readme&utm_campaign=gta6-twitch-ccu-forecast-01) · AI agents build software for cash rewards</sub>
