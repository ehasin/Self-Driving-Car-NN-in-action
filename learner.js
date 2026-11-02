"use strict";

// Learning by driving, for the page and Node (no DOM). Two methods:
// Copycat (imitation learning, behavioural cloning): your move at every decision is the right answer for what the car saw;
// one output, Move! (a sigmoid, as the Flashcard network).
// Atari (reinforcement learning, Deep Q-learning): the car tries moves (some at random), gets points and penalties
// (game.js REWARD), remembers what happened and replays it; two outputs, a score per move: Stay, Move!.
import { makeRandom } from "./random.js";
import { createNet, forward, backward, cloneNet, PARAMS } from "./net.js";

const zeros = (net) => Object.fromEntries(PARAMS.map((p) => [p, new Float64Array(net[p].length)]));

// Adam: a step per weight from running averages of the gradient and its square.
function adam(L, g, lr) {
  const a = L.adam, c1 = 1 - 0.9 ** ++a.t, c2 = 1 - 0.999 ** a.t;
  for (const p of PARAMS) {
    const w = L.net[p], m = a.m[p], v = a.v[p], d = g[p];
    for (let i = 0; i < w.length; i++) {
      m[i] = 0.9 * m[i] + 0.1 * d[i];
      v[i] = 0.999 * v[i] + 0.001 * d[i] * d[i];
      w[i] -= lr * (m[i] / c1) / (Math.sqrt(v[i] / c2) + 1e-8);
    }
  }
}

// ---------------------------------------------------------------- Copycat
export const COPY = { lr: 0.02, batch: 16, updates: 30 };   // dev sims: the best of lr 0.01-0.1, 12-60 updates per decision

// A new network: random hidden layer, its output at 0 ("no opinion yet"), as the tour's.
export function createCopycat(seed) {
  const net = createNet(seed, { inputs: 2, hidden: 3, outputs: 1 });
  net.W2.fill(0);
  return { net, start: cloneNet(net), rand: makeRandom((seed ^ 0x5eed1e55) >>> 0), adam: { m: zeros(net), v: zeros(net), t: 0 }, examples: [] };
}

// One of your decisions, learned: x = what the radar saw, a = your move (0 Stay, 1 Move!). A few minibatches of
// everything so far nudge the output towards your moves (cross-entropy on the sigmoid: dq = p - a). Returns the
// change of every weight (for the page's backpropagation colours).
export function imitate(C, x, a) {
  C.examples.push({ x: Float64Array.from(x), a });
  const before = cloneNet(C.net), g = zeros(C.net);
  for (let u = 0; u < COPY.updates; u++) {
    const n = Math.min(COPY.batch, C.examples.length);
    for (const p of PARAMS) g[p].fill(0);
    for (let b = 0; b < n; b++) {
      const ex = C.examples[n === C.examples.length ? b : C.rand.int(C.examples.length)], f = forward(C.net, ex.x);
      const gr = backward(C.net, f, Float64Array.of((1 / (1 + Math.exp(-f.q[0])) - ex.a) / n));
      for (const p of PARAMS) for (let i = 0; i < g[p].length; i++) g[p][i] += gr[p][i];
    }
    adam(C, g, COPY.lr);
  }
  return Object.fromEntries(PARAMS.map((p) => [p, Float64Array.from(C.net[p], (w, i) => w - before[p][i])]));
}

// ---------------------------------------------------------------- Atari (Deep Q-learning)
export const DQN = {
  gamma: 0.7,            // how much the next situation's score counts (short-sighted: dodging is about the next rows)
  lr: 0.01, batch: 16, updates: 16,
  memory: 2000,          // the oldest memories drop out
  epsStart: 0.5, epsEnd: 0.02, epsTurns: 400,   // the share of random moves falls over the first decisions
  sync: 10,              // decisions between copies of the network into the target network
};

export function createAtari(seed) {
  const net = createNet(seed, { inputs: 2, hidden: 3, outputs: 2 });
  return { net, target: cloneNet(net), rand: makeRandom((seed ^ 0x5eed1e55) >>> 0), adam: { m: zeros(net), v: zeros(net), t: 0 },
           memory: [], turns: 0 };
}

export function epsilon(A) {
  const { epsStart, epsEnd, epsTurns } = DQN;
  return A.turns >= epsTurns ? epsEnd : epsStart + (epsEnd - epsStart) * A.turns / epsTurns;
}

// Its move: sometimes a random one (to find out), otherwise the higher score. Returns { action, explored }.
export function atariMove(A, x) {
  const explored = A.rand() < epsilon(A), q = forward(A.net, x).q;
  return { action: explored ? A.rand.int(2) : +(q[1] > q[0]), explored };
}

// What happened, remembered (x, the move, its reward, what it saw next, crashed); then minibatches of memories nudge
// the score of the move made towards "reward now + gamma × the best score of the next situation" (just the reward
// after a crash). Returns the change of every weight.
export function remember(A, x, action, reward, next, crashed) {
  const m = { x: Float64Array.from(x), action, reward, next: Float64Array.from(next), done: crashed };
  if (A.memory.length < DQN.memory) A.memory.push(m); else A.memory[A.turns % DQN.memory] = m;
  A.turns++;
  const before = cloneNet(A.net), g = zeros(A.net);
  for (let u = 0; u < DQN.updates; u++) {
    const n = Math.min(DQN.batch, A.memory.length);
    for (const p of PARAMS) g[p].fill(0);
    for (let b = 0; b < n; b++) {
      const mm = A.memory[A.rand.int(A.memory.length)], f = forward(A.net, mm.x);
      const y = mm.done ? mm.reward : mm.reward + DQN.gamma * Math.max(...forward(A.target, mm.next).q);
      const dq = new Float64Array(2); dq[mm.action] = (f.q[mm.action] - y) / n;
      const gr = backward(A.net, f, dq);
      for (const p of PARAMS) for (let i = 0; i < g[p].length; i++) g[p][i] += gr[p][i];
    }
    adam(A, g, DQN.lr);
  }
  if (A.turns % DQN.sync === 0) A.target = cloneNet(A.net);
  return Object.fromEntries(PARAMS.map((p) => [p, Float64Array.from(A.net[p], (w, i) => w - before[p][i])]));
}
