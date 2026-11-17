// gta6-twitch-ccu-forecast-01: forecast Grand Theft Auto VI's launch-day Twitch
// viewers, hour by hour, from the first hour's print.
//
// The idea, in one paragraph. A launch day on Twitch has a shape, not a level:
// hour 1 is the midnight unlock in the UK and Europe, the small hours sag, the
// US unlocks lift the morning, and the evening peaks when Europe is watching
// after dinner and America is watching in the afternoon. That shape is not the
// same for every launch: a game whose first hour is already enormous (its
// midnight spike) stays near it all day, while a game whose first hour is
// small next to its usual audience can multiply tenfold by evening. So this
// program does not guess one curve. It takes the 38 to 42 past big launches
// the case file carries, turns each of their release days into a curve of
// log-ratios against its own first hour, and, for every hour to forecast,
// reads off the weighted quantiles of those curves. A past launch counts
// more the closer it is to this one on two things that decide the shape:
// how big its first hour was next to its pre-release audience, and how big
// its first hour was in absolute viewers. Console-only launches count
// double, because this game is console-only and their unlocks roll at
// midnight the same way. The spread between the quantiles is the spread
// between past launches, so it widens where launches disagree most.
//
// Everything is deterministic: fixed weights, sorted values, no clock, no
// randomness. Node 22, standard library only, no network.

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const INPUT_DIR = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUTPUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

// The five quantile levels, in the order each output row lists them.
const LEVELS = [0.05, 0.25, 0.5, 0.75, 0.95];
// The standard normal's quantile at each level, used only by the fallback.
const Z = [-1.645, -0.674, 0, 0.674, 1.645];

// How alike two launches must be to count alike: the weight of a past
// launch falls off as a Gaussian in log space, with these widths, on
// (a) log(first hour / pre-release baseline) and (b) log(first hour).
const BANDWIDTH_LIFT = 1.2;
const BANDWIDTH_LEVEL = 1.0;
// Every past launch keeps at least this much weight, so no hour is ever
// decided by one or two launches alone.
const WEIGHT_FLOOR = 0.02;
// A console-only launch counts this many times more: its midnight rolling
// unlock is the shape this game will follow.
const CONSOLE_ONLY_BOOST = 2;
// The baseline is the median hourly audience over this many days before
// the release day.
const BASELINE_DAYS = 7;
// The fallback spread, in log units per square-root hour, when a past
// launch gives an hour no data at all (the house baseline's number).
const FALLBACK_SIGMA = 0.15;

interface HourlyPoint {
  from: string;
  viewers: number | null;
  channels?: number | null;
}

interface Comparable {
  name: string;
  day_start: string;
  platforms?: string;
  hourly: HourlyPoint[];
}

interface CaseFile {
  id: string;
  day_start: string;
  levels: number[];
  known: Array<{ hour: number; viewers: number }>;
  forecast: Array<{ hour: number }>;
  history_hourly?: HourlyPoint[];
  comparables?: Comparable[];
}

interface LaunchShape {
  firstHour: number;
  lift: number;
  boost: number;
  // log(viewers at hour h / viewers at hour 1), h = 0..23; null where unknown.
  logRatios: Array<number | null>;
}

/** The median of the positive numbers in `xs`, or null when there are none. */
function medianPositive(xs: number[]): number | null {
  const vals = xs.filter((x) => Number.isFinite(x) && x > 0).sort((a, b) => a - b);
  if (vals.length === 0) return null;
  return vals[Math.floor(vals.length / 2)];
}

/** The release day's hourly viewers, slot 0..23, from a launch's points. */
function releaseDayViewers(points: HourlyPoint[], dayStartMs: number): Array<number | null> {
  const slots: Array<number | null> = new Array(24).fill(null);
  for (const p of points) {
    const slot = Math.floor((Date.parse(p.from) - dayStartMs) / 3_600_000);
    if (slot < 0 || slot > 23) continue;
    if (p.viewers === null || !Number.isFinite(p.viewers) || p.viewers < 0) continue;
    slots[slot] = p.viewers;
  }
  return slots;
}

/**
 * A launch's usual audience: the median hourly viewers over the week
 * before its release day. A launch with no usable pre-release points
 * reports null, and its caller decides what that means.
 */
function usualAudience(points: HourlyPoint[], dayStartMs: number): number | null {
  const weekMs = BASELINE_DAYS * 24 * 3_600_000;
  const before: number[] = [];
  for (const p of points) {
    const t = Date.parse(p.from);
    if (t >= dayStartMs - weekMs && t < dayStartMs && p.viewers !== null) before.push(p.viewers);
  }
  return medianPositive(before);
}

/** Turn one past launch into the shape this forecaster learns from. */
function shapeOf(comp: Comparable): LaunchShape | null {
  const dayStartMs = Date.parse(comp.day_start);
  const day = releaseDayViewers(comp.hourly, dayStartMs);
  const first = day[0];
  if (first === null || first <= 0) return null;
  const base = usualAudience(comp.hourly, dayStartMs);
  if (base === null) return null;
  const logRatios = day.map((v) => (v === null || v <= 0 ? null : Math.log(v / first)));
  const consoleOnly = !(comp.platforms ?? '').includes('PC');
  return {
    firstHour: first,
    lift: first / base,
    boost: consoleOnly ? CONSOLE_ONLY_BOOST : 1,
    logRatios,
  };
}

/**
 * The weighted empirical quantile of (value, weight) pairs at `tau`.
 * Values are sorted, each value sits at the middle of its own weight,
 * and the answer is linearly interpolated between neighbours.
 */
function weightedQuantile(pairs: Array<[number, number]>, tau: number): number {
  const sorted = pairs.slice().sort((a, b) => a[0] - b[0]);
  const total = sorted.reduce((s, [, w]) => s + w, 0);
  let seen = 0;
  const marks: Array<[number, number]> = [];
  for (const [x, w] of sorted) {
    seen += w;
    marks.push([(seen - 0.5 * w) / total, x]);
  }
  if (tau <= marks[0][0]) return marks[0][1];
  const last = marks[marks.length - 1];
  if (tau >= last[0]) return last[1];
  for (let i = 0; i + 1 < marks.length; i++) {
    const [p0, x0] = marks[i];
    const [p1, x1] = marks[i + 1];
    if (tau >= p0 && tau <= p1) {
      const f = p1 > p0 ? (tau - p0) / (p1 - p0) : 0;
      return x0 + f * (x1 - x0);
    }
  }
  return last[1];
}

/** A number rounded to 2 decimals, half up (all our numbers are positive). */
function round2(x: number): number {
  return Math.round(x * 100) / 100;
}

/** The fallback row for an hour no past launch speaks to: flat, widening. */
function fallbackRow(p1: number, hour: number): number[] {
  return Z.map((z) => round2(p1 * Math.exp(z * FALLBACK_SIGMA * Math.sqrt(hour - 1))));
}

/**
 * Forecast one case. `p1` is hour 1's print; `baseline` the case's own
 * usual audience; `shapes` the past launches' curves.
 */
function forecastCase(c: CaseFile): { hours: Array<{ hour: number; q: number[] }> } {
  const first = c.known.find((k) => k.hour === 1);
  let p1 = first !== undefined && Number.isFinite(first.viewers) ? Math.max(1, first.viewers) : 1;
  if (first === undefined && c.history_hourly !== undefined && c.history_hourly.length > 0) {
    const last = c.history_hourly[c.history_hourly.length - 1];
    if (last.viewers !== null && last.viewers > 0) p1 = last.viewers;
  }
  const dayStartMs = Date.parse(c.day_start);
  const baseline =
    c.history_hourly !== undefined && Number.isFinite(dayStartMs)
      ? usualAudience(c.history_hourly, dayStartMs)
      : null;
  const lift = baseline === null ? 1e9 : Math.max(p1 / baseline, 1e-9);
  const logLift = Math.log(lift);
  const logLevel = Math.log(p1);

  const shapes: LaunchShape[] = [];
  for (const comp of c.comparables ?? []) {
    const s = shapeOf(comp);
    if (s !== null) shapes.push(s);
  }

  const hours = c.forecast.map(({ hour }) => {
    const slot = hour - 1; // hour 2 lives in slot 1, hour 24 in slot 23.
    const pairs: Array<[number, number]> = [];
    for (const s of shapes) {
      const lr = s.logRatios[slot];
      if (lr === null) continue;
      const dLift = Math.log(Math.max(s.lift, 1e-9)) - logLift;
      const dLevel = Math.log(s.firstHour) - logLevel;
      const w =
        Math.exp(-(dLift * dLift) / (2 * BANDWIDTH_LIFT * BANDWIDTH_LIFT)) *
          Math.exp(-(dLevel * dLevel) / (2 * BANDWIDTH_LEVEL * BANDWIDTH_LEVEL)) *
          s.boost +
        WEIGHT_FLOOR;
      pairs.push([lr, w]);
    }
    let q: number[];
    if (pairs.length === 0) {
      q = fallbackRow(p1, hour);
    } else {
      q = LEVELS.map((tau) => p1 * Math.exp(weightedQuantile(pairs, tau)));
      q = q.map((x) => round2(Math.min(1e9, Math.max(0.01, x))));
      for (let i = 1; i < q.length; i++) if (q[i] < q[i - 1]) q[i] = q[i - 1];
    }
    return { hour, q };
  });
  return { hours };
}

mkdirSync(OUTPUT_DIR, { recursive: true });
// Every case file, in name order, so two runs write the same bytes.
const inputs = readdirSync(INPUT_DIR).filter((f) => f.endsWith('.in')).sort();
for (const file of inputs) {
  const id = file.slice(0, -'.in'.length);
  const parsed = JSON.parse(readFileSync(join(INPUT_DIR, file), 'utf8')) as CaseFile;
  if (parsed.levels.length !== LEVELS.length || parsed.levels.some((t, j) => t !== LEVELS[j])) {
    throw new Error(`${file} asks for levels ${JSON.stringify(parsed.levels)}, not ${JSON.stringify(LEVELS)}`);
  }
  if (parsed.forecast.length !== 23) {
    throw new Error(`${file} asks for ${parsed.forecast.length} hours, not 23`);
  }
  const out = forecastCase(parsed);
  writeFileSync(join(OUTPUT_DIR, `${id}.out`), `${JSON.stringify({ hours: out.hours })}\n`);
}
