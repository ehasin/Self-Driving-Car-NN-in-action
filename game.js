"use strict";

// Car game rules: turn-based, only our car moves, parked cars never do.
// No DOM, so the page, the learner and the Node tests all share it.
import { makeRandom } from "./random.js";

// Mockup: two lanes; the car either stays in its lane or changes to the other one (it can't leave the road).
export const MAX_ROWS = 30, VIEW_ROWS = 8, ACTIONS = ["stay", "change"];
// For learning only; the score is +1 per safe row. A collision costs `crash` (by far the most). Every lane change costs
// `move` (a little, so the car keeps straight unless it pays). Dodging a car late costs extra: 1 row ahead `late`
// (high), 2 rows ahead `near` (moderate), 3 or more rows ahead nothing. A safe row earns nothing (safe is 0 for now).
// Calibrated so each one counts against the next, with gamma 0.7: a last-minute dodge (-7.2) beats a crash (-20);
// dodging 2 rows ahead (-4.2) beats waiting for the last minute (0.7 x -7.2 = -5.04); 3 rows ahead (-1.2) beats
// waiting (0.7 x -4.2 = -2.94); a needless change still costs 1.2.
// Steering off the road (left in the leftmost lane, right in the rightmost) is a side collision:
// it costs `crash`, like hitting a parked car.
export const REWARD = { safe: 0, crash: -20, move: -1.2, late: -6, near: -3 };

export const METERS_PER_ROW = 10;
export const SIGN_EVERY = 100;                   // meters between distance signs (page only)
export const meters = (rows) => rows * METERS_PER_ROW;

// Practice and test roads come from disjoint seed ranges, so a test road is never seen in practice.
export const practiceSeed = (n) => 1000 + n;
export const testSeed = (n) => 900000 + n;

// The network sees two radar values: its own lane, then the other lane. Each is the nearest parked car in that lane
// within AHEAD rows, linear in distance: 1 at 10 m, 1/8 at 80 m, 0 when there is none.
export const AHEAD = VIEW_ROWS;
export const inputCount = () => 2;
export const closeness = (d) => (AHEAD + 1 - d) / AHEAD;   // d = rows ahead (1..AHEAD)

// Roads are endless: rows are made on demand, in order, from one seeded random stream, so a
// row's content depends only on the seed and its index, never on who read what first.
// The stream lives outside the road object, so a road stays plain data (seed, lanes, startLane, rows, density).
const makers = new WeakMap();

// Traffic: how often a row gets parked cars, as a multiple of CAR_ROWS. Training (Self-Train, its tests, Learn from me) always
// uses 1.2, the most there can be; Run 1.0 by default (the Run tab's Traffic slider sets it, 0.5-1.2).
// A road's density can change on the way; it applies to rows made from then on.
export const DENSITY = { train: 1.2, run: 1 };
// The chance a row may get parked cars at density 1. With the two empty rows after each, 31% of rows hold cars;
// at 1.2 the chance is 1, the cap: 33%.
const CAR_ROWS = 1 / 1.2;

// Rows 0-2 are empty, then any row may hold parked cars (with chance density x CAR_ROWS):
// 1..lanes-1 cars evenly, never every lane (never 3 cars in a row), and a row with cars is always followed by two
// empty rows. So before any row of cars the car can reach the middle lane, which in 3 lanes reaches every lane of
// that row: a road always has a way through. The two empty rows let every dodge be made 3 rows ahead. The page also clears the first 2 rows ahead after every collision and
// at every start (clearRows), which only adds ways through.
export function makeRoad(seed, { lanes = 2, density = DENSITY.run } = {}) {
  const r = makeRandom(seed);
  const road = { seed, lanes, startLane: r.int(lanes), rows: [], density };
  makers.set(road, () => {
    const i = road.rows.length, row = new Uint8Array(lanes);
    const afterCars = road.rows.slice(Math.max(0, i - 2), i).some((row) => row.some((v) => v));
    if (i >= 3 && !afterCars && r() < road.density * CAR_ROWS) {
      const cars = 1 + r.int(lanes - 1);
      for (let placed = 0; placed < cars; ) {
        const lane = r.int(lanes);
        if (!row[lane]) { row[lane] = 1; placed++; }
      }
    }
    road.rows.push(row);
  });
  rowAt(road, MAX_ROWS + VIEW_ROWS);             // the usual prefix, as before
  return road;
}

// Row i of the road (Uint8Array, 1 = parked car), made on demand. A hand-built road
// (no maker) only has the rows it was given.
export function rowAt(road, i) {
  const row = road.rows[i];
  if (row) return row;
  const make = makers.get(road);
  if (!make || !(i >= 0) || !Number.isInteger(i)) throw new RangeError(`road has no row ${i}`);
  while (road.rows.length <= i) make();
  return road.rows[i];
}

// Removes the parked cars from rows from..to of this road object (the page clears a drive's first 20 m and a
// wreck); the change stays with the object, so the network and the drawing both see empty rows.
export function clearRows(road, from, to) {
  for (let i = Math.max(0, from); i <= to; i++) rowAt(road, i).fill(0);
}

// maxRows = Infinity drives until a crash. With continueOnCrash (practice), a collision doesn't
// end the run: the car drives through the parked car (the road itself is not changed) and the
// run goes on to its full length of maxRows rows; run.crashes counts the collisions.
export function newRun(road, { maxRows = MAX_ROWS, continueOnCrash = false } = {}) {
  return { road, lanes: road.lanes, pos: 0, lane: road.startLane, score: 0, turns: 0, moves: 0, crashes: 0,
           maxRows, continueOnCrash, done: false, crashed: false };
}

// The radar in our lane, then in the other lane.
export function observe(run) {
  const obs = new Float64Array(2);
  for (const [i, l] of [[0, run.lane], [1, 1 - run.lane]]) {
    for (let d = 1; d <= AHEAD; d++) if (rowAt(run.road, run.pos + d)[l]) { obs[i] = closeness(d); break; }
  }
  return obs;
}

// Move first (instantly), then drive one row. Calling step on a finished run throws.
// run.crashed is about this step; score counts safe rows, pos every row driven.
// Off the road (offroad = -1 left, 1 right, else 0) is a side collision; the car stays in its lane
// (with continueOnCrash it drives on from there).
export function step(run, action) {
  if (run.done) throw new Error("step() called on a finished run");
  const from = run.lane, at = run.pos, offroad = 0;   // action 0 = stay, 1 = change to the other lane
  run.lane = action ? 1 - from : from;
  const moved = run.lane !== from;
  if (moved) run.moves++;
  run.pos++;
  run.turns++;
  const ahead = rowAt(run.road, run.pos);
  run.crashed = offroad !== 0 || ahead[run.lane] === 1;
  let dodged = 0;                                 // how many rows ahead the car it dodged was (0 = none in view)
  if (moved) for (let k = 1; k <= VIEW_ROWS && !dodged; k++) if (rowAt(run.road, at + k)[from]) dodged = k;
  const late = dodged === 1;                      // the car it dodged is in the row it just drove into
  if (run.crashed) run.crashes++; else run.score++;
  run.done = (run.crashed && !run.continueOnCrash) || run.pos >= run.maxRows;
  const reward = (run.crashed ? REWARD.crash : REWARD.safe) + (moved ? REWARD.move : 0) + (late ? REWARD.late : 0) + (dodged === 2 ? REWARD.near : 0);
  return { reward, done: run.done, crashed: run.crashed, offroad, late, dodged, from, to: run.lane, moved };
}
