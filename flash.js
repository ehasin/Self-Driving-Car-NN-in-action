"use strict";

// The Flashcard method (supervised learning from a labelled dataset).
// 8 cards: 2 of each of 4 types, all with an obstacle in both lanes; per type one card trains (learn set), the other
// validates. Hidden layer Glorot random, output layer 0. Adam, learning rate 0.2, full batch (one step per epoch),
// up to 10 epochs, with early stopping (stalled, best). Test: one random 500 m road, the same one after every epoch. No DOM: the page and Node share it.
import { makeRoad, newRun, observe, step, closeness, DENSITY, meters } from "./game.js";
import { createNet, forward, backward, argmax, cloneNet, PARAMS } from "./net.js";
import { makeRandom } from "./random.js";

export const EPOCHS = 10, RATE = 0.2, TEST_ROWS = 50, ANSWERS = ["Stay", "Change lane"];
export const PATIENCE = 1, MIN_GAIN = 0.03, MIN_EPOCHS = 3;   // early stopping: from epoch 3 on, all 4 validation cards right, an epoch that lowers the validation loss by less than 0.03

// Distances in rows (10 m each): [my lane, other lane]. Obstacles in the two lanes are always 30 m or 60 m apart.
export const TYPES = [
  { name: "My lane nearer, 30 m apart", pairs: [[1, 4], [2, 5], [3, 6]] },
  { name: "My lane farther, 30 m apart", pairs: [[4, 1], [5, 2], [6, 3]] },
  { name: "My lane nearer, 60 m apart", pairs: [[1, 7], [2, 8]] },
  { name: "My lane farther, 60 m apart", pairs: [[7, 1], [8, 2]] },
];

// The right answer: change lane when the obstacle in my lane is nearer, otherwise stay.
export const correct = (mine, other) => (mine < other ? 1 : 0);

// A new deck: per type two different cards, one for each set; dealt in a shuffled order for answering.
// lane = where our car is drawn (the network only sees "my lane" and "other lane", so it doesn't matter).
export function makeDeck(seed) {
  const rand = makeRandom(seed), cards = [];
  TYPES.forEach((t, type) => {
    const a = rand.int(t.pairs.length);
    let b; do b = rand.int(t.pairs.length); while (b === a);
    for (const [k, set] of [[a, "learn"], [b, "check"]]) {
      const [mine, other] = t.pairs[k];
      cards.push({ type, set, mine, other, lane: rand.int(2), x: Float64Array.of(closeness(mine), closeness(other)),
                   right: correct(mine, other), answer: -1 });
    }
  });
  for (let i = cards.length - 1; i > 0; i--) { const j = rand.int(i + 1); [cards[i], cards[j]] = [cards[j], cards[i]]; }
  cards.forEach((c, i) => { c.id = i; });
  return cards;
}

// The one output through a sigmoid: the chance of Change lane. p = [Stay, Change lane].
export function probs(net, x) {
  const f = forward(net, x), s = 1 / (1 + Math.exp(-f.q[0]));
  return { fwd: f, p: [1 - s, s] };
}

// The network's choice for a card; a 50/50 tie is no choice (-1). The road uses argmax (a tie stays).
export function choice(net, x) {
  const { p } = probs(net, x);
  return Math.abs(p[0] - p[1]) < 0.01 ? -1 : argmax(p);
}

// Drives the test road with no learning; returns the metres driven and whether it ended in a collision.
export function testDrive(net, seed) {
  const run = newRun(makeRoad(seed, { density: DENSITY.train }), { maxRows: TEST_ROWS });
  while (!run.done) step(run, +(forward(net, observe(run)).q[0] > 0));
  return { m: meters(run.crashed ? run.pos - 1 : run.pos), crashed: run.crashed };
}

// Early stopping: the last PATIENCE epochs didn't beat the best validation loss before them by MIN_GAIN. More epochs
// would barely help (or, if it rose, only fit the training cards closer, not the rule: overfitting); the network goes
// back to its best epoch. Never before MIN_EPOCHS, and never while its best epoch still gets a validation card wrong: from a
// random start the loss often flattens for an epoch or two, then falls again (it stopped half-trained, and crashed on the test).
export function stalled(T) {
  const H = T.history, n = H.length - PATIENCE;
  if (n < 1 || H.length - 1 < MIN_EPOCHS || H[best(T)].checkRight < T.check.length) return false;
  const before = Math.min(...H.slice(0, n).map((s) => s.checkLoss));
  return H.slice(n).every((s) => s.checkLoss > before - MIN_GAIN);
}
// The epoch with the lowest validation loss.
export const best = (T) => T.history.reduce((b, s, e, H) => (s.checkLoss < H[b].checkLoss ? e : b), 0);

const zeros = (net) => Object.fromEntries(PARAMS.map((p) => [p, new Float64Array(net[p].length)]));

// One training session for the answered cards. history[e] = the network after e epochs, with its results.
export function createTrainer(cards, { netSeed, roadSeed, start = null }) {   // start: a network to train from (a copy)
  const net = start ? cloneNet(start) : createNet(netSeed, { inputs: 2, hidden: 3, outputs: 1 });
  if (!start) net.W2.fill(0);                     // the output layer starts at 0: "the network starts with no opinion"
  const T = { net, cards, roadSeed, learn: cards.filter((c) => c.set === "learn"), check: cards.filter((c) => c.set === "check"),
              m: zeros(net), v: zeros(net), epoch: 0, history: [] };
  T.history.push(snapshot(T, null));
  return T;
}

// The mean error (softmax cross-entropy) on these cards against the answers they were given: 0 = sure and right,
// 0.69 = a 50/50 guess. On the validate set, this is the validation loss.
export const lossOn = (net, cs) => cs.reduce((s, c) => s - Math.log(Math.max(1e-12, probs(net, c.x).p[c.answer])), 0) / cs.length;

function snapshot(T, step) {
  const net = cloneNet(T.net), score = (cs) => cs.filter((c) => choice(net, c.x) === c.answer).length;
  return { net, step, learnRight: score(T.learn), checkRight: score(T.check), learnLoss: lossOn(net, T.learn), checkLoss: lossOn(net, T.check),
           test: testDrive(net, T.roadSeed) };
}

// Backpropagation for the whole learn set: the error of every card (softmax cross-entropy against the answer
// it was given) traced back to every weight. Returns the gradients (summed over the cards) and the mean error.
export function gradients(T) {
  const g = zeros(T.net), n = T.learn.length;
  let loss = 0;
  for (const c of T.learn) {
    const { fwd, p } = probs(T.net, c.x);
    loss -= Math.log(Math.max(1e-12, p[c.answer])) / n;
    const gr = backward(T.net, fwd, Float64Array.of((p[1] - c.answer) / n));
    for (const k of PARAMS) for (let j = 0; j < g[k].length; j++) g[k][j] += gr[k][j];
  }
  return { g, loss };
}

// The Adam step these gradients give (the change of every weight), without applying it.
export function corrections(T, g) {
  const t = T.epoch + 1, d = zeros(T.net), m = {}, v = {};
  for (const p of PARAMS) {
    m[p] = Float64Array.from(T.m[p], (x, j) => 0.9 * x + 0.1 * g[p][j]);
    v[p] = Float64Array.from(T.v[p], (x, j) => 0.999 * x + 0.001 * g[p][j] ** 2);
    for (let j = 0; j < d[p].length; j++) d[p][j] = -RATE * (m[p][j] / (1 - 0.9 ** t)) / (Math.sqrt(v[p][j] / (1 - 0.999 ** t)) + 1e-8);
  }
  return { d, m, v };
}

// Applies one epoch's corrections and records the result.
export function apply(T, { d, m, v }, loss) {
  for (const p of PARAMS) { for (let j = 0; j < d[p].length; j++) T.net[p][j] += d[p][j]; T.m[p] = m[p]; T.v[p] = v[p]; }
  T.epoch++;
  T.history.push(snapshot(T, { d, loss }));
}
