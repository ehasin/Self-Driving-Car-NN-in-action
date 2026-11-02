"use strict";

import { makeRandom } from "./random.js";

// The car's brain: inputs (road cells + lane lights) -> tanh hidden layer -> one score
// per action (left / stay / right). The scores estimate future reward (Q-values), so
// the last layer is linear: they are not probabilities.
// Weights are plain named arrays so the page can draw every one of them.
// Row-major: W1[j * inputs + i] links input i to hidden j, W2[k * hidden + j] hidden j to output k.

export const PARAMS = ["W1", "b1", "W2", "b2"];   // the trainable arrays, in a fixed order

// Glorot/Xavier uniform: keeps tanh away from saturation at the start, so it can learn.
// Biases start at 0; seeded, so the same seed always gives the same starting brain.
export function createNet(seed, { inputs = 9, hidden = 6, outputs = 3 } = {}) {
  const rand = makeRandom(seed);
  const init = (n, fanIn, fanOut) => {
    const limit = Math.sqrt(6 / (fanIn + fanOut));
    return Float64Array.from({ length: n }, () => (2 * rand() - 1) * limit);
  };
  return {
    inputs, hidden, outputs,
    W1: init(hidden * inputs, inputs, hidden), b1: new Float64Array(hidden),
    W2: init(outputs * hidden, hidden, outputs), b2: new Float64Array(outputs),
  };
}

// Returns every intermediate value (fresh arrays) so backward and the page can use them.
export function forward(net, x) {
  const { inputs, hidden, outputs, W1, b1, W2, b2 } = net;
  const z1 = new Float64Array(hidden), h = new Float64Array(hidden), q = new Float64Array(outputs);
  for (let j = 0; j < hidden; j++) {
    let s = b1[j];
    for (let i = 0; i < inputs; i++) s += W1[j * inputs + i] * x[i];
    z1[j] = s;
    h[j] = Math.tanh(s);
  }
  for (let k = 0; k < outputs; k++) {
    let s = b2[k];
    for (let j = 0; j < hidden; j++) s += W2[k * hidden + j] * h[j];
    q[k] = s;
  }
  return { x: Float64Array.from(x), z1, h, q };
}

// dq = how the loss changes with each action score. Walks it back through the layers
// (chain rule) and returns the gradient of every parameter; the net is not changed.
export function backward(net, fwd, dq) {
  const { inputs, hidden, outputs, W2 } = net, { x, h } = fwd;
  const g = { W1: new Float64Array(hidden * inputs), b1: new Float64Array(hidden),
              W2: new Float64Array(outputs * hidden), b2: Float64Array.from(dq),
              dh: new Float64Array(hidden), dz1: new Float64Array(hidden) };
  for (let k = 0; k < outputs; k++) {
    for (let j = 0; j < hidden; j++) {
      g.W2[k * hidden + j] = dq[k] * h[j];
      g.dh[j] += dq[k] * W2[k * hidden + j];
    }
  }
  for (let j = 0; j < hidden; j++) {
    g.dz1[j] = g.dh[j] * (1 - h[j] * h[j]);   // tanh' = 1 - tanh^2
    g.b1[j] = g.dz1[j];
    for (let i = 0; i < inputs; i++) g.W1[j * inputs + i] = g.dz1[j] * x[i];
  }
  return g;
}

// net.P += scale * grads.P for every parameter (plain SGD step: scale = -learningRate).
export function addScaled(net, grads, scale) {
  for (const p of PARAMS) {
    const a = net[p], d = grads[p];
    for (let n = 0; n < a.length; n++) a[n] += scale * d[n];
  }
}

export function cloneNet(net) {
  const copy = { inputs: net.inputs, hidden: net.hidden, outputs: net.outputs };
  for (const p of PARAMS) copy[p] = Float64Array.from(net[p]);
  return copy;
}

// Copies the weights in place (target-network sync); buffers stay separate.
export function copyNet(dst, src) {
  for (const p of PARAMS) dst[p].set(src[p]);
}

// The chosen action; ties go to the lowest index.
export function argmax(q) {
  let best = 0;
  for (let k = 1; k < q.length; k++) if (q[k] > q[best]) best = k;
  return best;
}
