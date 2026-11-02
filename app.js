"use strict";

// A guided tour in 7 steps. The road on the left, the tour in the middle, the network on the right.
// 1 the road (try it: 200 m with Move!), 2 the network and what each input sees on the road, 3 initialize it and let it
// drive untrained, 4 the three learning methods,
// 5 the flashcards (8 situations on the road), 6 training (learn and validate sets, 10 epochs, validation loss),
// 7 the test: 500 m of new road. Training: flash.js.
import { makeDeck, createTrainer, gradients, corrections, apply, probs, choice, stalled, best as bestEpoch, MIN_GAIN, TYPES, EPOCHS, RATE, TEST_ROWS } from "./flash.js";
import { makeRoad, rowAt, newRun, observe, step, clearRows, closeness, DENSITY, AHEAD, meters } from "./game.js";
import { createNet, forward, argmax, cloneNet } from "./net.js";
import { createCopycat, imitate, createAtari, atariMove, remember, epsilon } from "./learner.js";
import { drawRoad } from "./render.js";

const $ = (id) => document.getElementById(id);
const anySeed = () => Math.floor(Math.random() * 2 ** 31);
const SVG = "http://www.w3.org/2000/svg";
function el(tag, attrs, parent) {
  const e = document.createElementNS(SVG, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(e);
  return e;
}
const POS = "rgb(52,199,140)", NEG = "rgb(220,64,200)", INK = "#16150f", MUTED = "#6f6b61", RULE = "#e2ded2", PAPER = "#fbfaf6", SUNK = "#f4f2ea";
const sgn = (v, d = 2) => (v < 0 ? "−" : "+") + Math.abs(v).toFixed(d);
const pct = (p) => `${Math.round(p * 100)}%`;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const ANSWERS = ["Stay", "Move!"], STEPS = ["Road", "Network", "Start", "Methods", "Cards", "Training", "Test"];

// ---------------------------------------------------------------- state
let stepNo = 1, reached = 1;
let net0 = null, netSeed = 0;        // the network as it starts (step 3): random hidden layer, outputs at 0; null = no weights yet
let cards = makeDeck(anySeed()), current = 0;
let roadSeed = anySeed();            // the test road: new to the network
let T = null, sub = 0, pending = null, shown = 0;   // training; sub: 0 between epochs, 1 answered, 2 backpropagation, 3 updated
let playing = false, stopPlay = false, played = false, busy = false, playSpeed = 1, switched = false;
const SPEEDS = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.75, 1, 1.5, 2.5, 4,   // the road's speed slider, labelled 0 (stopped) to 10; 5 = 0.5× in the middle
  ...Array.from({ length: 20 }, (_, i) => 4 * (30 / 4) ** ((i + 1) / 20))];   // Trial & Error's practice: on to 30 = 30×
let speed = 0.1;                                             // every drive, yours and the network's
let firstDrive = null, testResult = null;          // the drives' results: { crashed, m, last: { x, action }, moves, crashes, stopped }
let trySeed = anySeed(), tryRun = null;            // step 1: your drive's road, and its result
let best = 0;                                      // the sign's best distance with no collision (any drive); Reset sets it to 0
const TRY_ROWS = 20;                               // your drive, and the untrained network's: 200 m
const SCENE = { mine: 3, other: 6, lane: 0 };      // steps 2-4: the road standing still, a car in each lane

const allAnswered = () => cards.every((c) => c.answer >= 0);
const trained = () => !!T && sub === 0 && (T.epoch >= EPOCHS || stalled(T));   // the last epoch, or stopped early
const allowed = (n) => n <= reached && (n < 6 || allAnswered()) && (n < 7 || trained());
const wrongCards = () => cards.filter((c) => c.answer !== c.right).length;

// ---------------------------------------------------------------- the road
const roadCanvas = $("road"), moveBtn = $("move"), resetBtn = $("reset"), board = $("board");
const view = { road: null, pos: 0, lane: 0, crashed: false, crashAge: -1, dist: 0, best: 0, phone: false, noSign: false, tags: false };
const PACE = 2.5, DEC = 0.15, SLIDE = 0.4, HIT_AT = 0.6, CRASH_PAUSE = 1.6, SMOKE = 3.5;   // rows per second at 1×; parts of a row
let drive = null, raf = 0, last = 0;

function fit(canvas) {
  const r = canvas.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
  const w = Math.max(1, Math.round(r.width * dpr)), h = Math.max(1, Math.round(r.height * dpr));
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, r.width, r.height);
  return { ctx, box: { x: 0, y: 0, w: r.width, h: r.height } };
}
function drawView() {
  if (!view.road || roadCanvas.hidden) return;
  view.phone = innerWidth <= 720;
  if (drive) best = Math.max(best, Math.floor(view.dist || 0));
  view.best = best; view.noSign = true;   // no road sign: the dashboard shows the distance
  const f = fit(roadCanvas), { wheel, reset } = drawRoad(f.ctx, f.box, view);
  // the dashboard at the car's height, centred on the road (placeNet puts the output neuron under Move!)
  $("safe-m").textContent = `${Math.floor(view.dist || 0).toLocaleString("en-US")} m`;
  $("dash").style.top = wheel.y + "px";
  resetBtn.hidden = !reset;                                                   // Reset sits in the sign, after the best distance
  if (reset) Object.assign(resetBtn.style, { left: reset.x + "px", top: reset.y + "px", fontSize: reset.size + "px" });
  drawLink();
}
// The arrow from the output neuron (network, under the road) straight up to Move! (on the road): placeNet keeps the output
// under the button.
function drawLink() {
  const line = $("link-line"), off = $("dash").hidden || $("netbox").hidden || !autopilot;   // no Autopilot, no link
  line.style.display = off ? "none" : "";
  if (off) return;
  const d = document.querySelector(".demo").getBoundingClientRect(), m = moveBtn.getBoundingClientRect(), o = $("out-box").getBoundingClientRect();
  const x = Math.min(Math.max(o.left + o.width / 2, m.left + 12), m.right - 12) - d.left;
  Object.entries({ x1: x, y1: o.top - d.top - 4, x2: x, y2: m.bottom - d.top + 4 })
    .forEach(([k, v]) => line.setAttribute(k, v));
}
resetBtn.addEventListener("click", () => { best = 0; drawView(); });
$("speed").addEventListener("dblclick", () => { const s = $("speed-in"); s.value = 5; s.dispatchEvent(new Event("input")); });   // back to 5
$("speed-in").addEventListener("input", (e) => {
  speed = SPEEDS[Number(e.target.value)];
  $("speed-out").textContent = e.target.value;
});
window.speedMax = (n) => {                             // 10, or 30 for Trial & Error's practice
  const s = $("speed-in"); s.max = n;
  if (+s.value > n) { s.value = n; s.dispatchEvent(new Event("input")); }
};
const smooth = (t) => { t = Math.min(1, Math.max(0, t)); return t * t * (3 - 2 * t); };

const watching = () => !!drive && !drive.user && drive.age < 0;   // a network is driving (not yet crashed)
const driving = () => !!drive && drive.age < 0;                   // anyone is driving

function stopDrive() { cancelAnimationFrame(raf); raf = 0; drive = null; moving(false); $("net").classList.remove("quick"); }

// Every road starts the same: our car in the right lane, cars 70 m (my lane) and 30 m (other lane) ahead.
function startRoad(seed, soon = false) {   // soon: a car 20 m ahead in our lane, the other lane free there (the tour's untrained drive)
  const road = makeRoad(seed, { density: DENSITY.train });
  rowAt(road, 7); road.rows.slice(0, 8).forEach((row) => row.fill(0));
  road.startLane = 1;
  if (soon) { road.rows[2][1] = 1; road.rows[6][0] = 1; } else { road.rows[7][1] = 1; road.rows[3][0] = 1; }
  return road;
}

// A drive: yours (Move!; a collision is cleared away and the drive goes on), or a network's on its own (it ends at a
// collision). Both end after `rows` rows, or at Stop. The car decides once per row, DEC into it; the network panel
// shows that decision. tags: the radar's targets are tagged on the road.
// policy(x): a network's move made some other way (Atari practice: some at random; your Move! is ignored); learn(x, move,
// result, drive): after every decision; watch: the network shown on your drive; pause: the stop after a collision, s.
function startDrive({ net = null, seed = anySeed(), rows = Infinity, tags = false, auto = 0, keepOn = false, soon = false, onEnd = null,
                      policy = null, learn = null, watch = null, pause = CRASH_PAUSE } = {}) {   // keepOn: a network's drive that, like yours, goes on after a collision
  stopDrive();
  const road = startRoad(seed, soon), run = newRun(road, { maxRows: rows, continueOnCrash: !net || keepOn });
  drive = { run, net, user: !net, keepOn, base: 0, f: 0, a: run.lane, b: run.lane, decided: false, crashNext: false, pause: 0, age: -1, zero: 0, wish: 0, last: null, auto, onEnd, policy, learn, watch, pauseLen: pause };
  Object.assign(view, { road, pos: 0, lane: run.lane, crashed: false, crashAge: -1, dist: 0, noSign: false, tags });
  $("net").classList.toggle("quick", !!net);   // a network's drive: the panel keeps up with every turn
  last = 0; raf = requestAnimationFrame(tick);
}

function decide(d) {
  const x = observe(d.run), from = d.run.lane;
  // the demo: for each car ahead in our lane, Move! is pressed for you (`auto` of the time) 1 to 4 rows before it,
  // when the other lane is free next to us
  const road = d.run.road, pos = d.run.pos, k = d.auto ? [...Array(AHEAD)].findIndex((_, i) => rowAt(road, pos + i + 1)[from]) + 1 : 0;
  if (k && d.plan?.car !== pos + k) d.plan = { car: pos + k, at: 1 + Math.floor(Math.random() * 4), go: Math.random() < d.auto };
  if (d.wish) d.handsOn = pos + 2;                     // you pressed Move!: your move counts; the autopilot waits 20 m
  if (k && d.plan.go && k <= d.plan.at && !(pos < d.handsOn) && !rowAt(road, pos + 1)[1 - from]) {
    d.wish = 1; d.plan.go = false; moveBtn.classList.add("press"); setTimeout(() => moveBtn.classList.remove("press"), 350);
  }
  const nets = d.user ? 0 : d.policy ? d.policy(x) : netMove(d.net, x);   // a 50/50 tie stays
  const action = d.policy ? nets : d.user || d.wish || !autopilot ? d.wish : nets;   // your Move! wins for this turn; then the network drives on (Autopilot on)
  if (!d.user && !d.wish && action) { moveBtn.classList.add("press"); setTimeout(() => moveBtn.classList.remove("press"), 350); }   // the network presses Move!
  if (d.wish && moveBtn.classList.contains("moving")) d.movedAt = d.base;   // your click: this is its lane change
  d.wish = 0; d.last = { x, action };
  const r = step(d.run, action);
  d.a = from; d.b = d.run.lane; d.decided = true; d.crashNext = r.crashed;
  d.learn?.(x, action, r, d);
  if (d.user) showNet(d.watch || net0, x, undefined, d.watch ? 0 : panel.upto); else if (!d.blind) showNet(d.net, x, action);   // blind: the panel shows something else (the tour's strip)
}

function tick(now) {
  const d = drive; if (!d) return;
  const dt = last ? Math.min(100, now - last) / 1000 : 0; last = now;
  raf = requestAnimationFrame(tick);
  if (d.age >= 0) {                                    // a network's collision: smoke, then the drive is over
    view.crashAge = d.age += dt; drawView();
    if (d.age > SMOKE) { cancelAnimationFrame(raf); raf = 0; drive = null; render(); ui(); }
    return;
  }
  if (d.pause > 0) {                                   // your collision: a pause, then the wreck is cleared away
    d.pause -= dt; view.crashAge += dt;
    if (d.pause <= 0) { clearRows(d.run.road, d.run.pos, d.run.pos + 2); view.crashed = false; view.crashAge = -1; d.zero = d.base + d.f; }
    drawView(); return;
  }
  d.f += dt * PACE * speed;
  for (;;) {
    if (!d.decided && d.f >= DEC) decide(d);
    if (d.crashNext && d.f >= HIT_AT) {
      d.crashNext = false; d.f = HIT_AT; view.crashed = true; view.crashAge = 0; view.dist = meters(d.base - d.zero);
      if (d.user || d.keepOn) d.pause = d.pauseLen * Math.min(1, 4 / speed);   // above 4× (Trial & Error's practice): shorter
      else { d.age = 0; d.onEnd?.({ crashed: true, m: meters(d.base), last: d.last, moves: d.run.moves }); }
      break;
    }
    if (d.f < 1) break;
    d.f -= 1; d.base++; d.decided = false; d.a = d.b = d.run.lane;
    if (d.run.done) {                                  // the whole road (yours: after any collisions)
      Object.assign(view, { pos: d.base, lane: d.run.lane, dist: meters(d.base - d.zero) }); drawView();
      stopDrive();
      d.onEnd?.({ crashed: false, m: meters(d.base), last: d.last, moves: d.run.moves, crashes: d.run.crashes });
      return;
    }
  }
  view.pos = d.base + d.f; view.lane = d.a + (d.b - d.a) * smooth((d.f - DEC) / SLIDE);
  if (d.movedAt != null && (d.base > d.movedAt || d.f >= DEC + SLIDE)) {   // the lane change is done; a click made meanwhile: the next
    d.movedAt = null; moving(false);
    if (d.again) { d.again = false; d.wish = 1; moving(true); }
  }
  if (!view.crashed) view.dist = meters(view.pos - d.zero);
  drawView();
}
// Your Move!: until the lane change is done, the button is a grey "Moving..." (a click waits for the next decision point).
// A click while it is grey is kept, and is the next lane change once this one is done (one, however many clicks).
function moving(on) { moveBtn.classList.toggle("moving", on); moveBtn.textContent = on ? "Moving..." : "Move!"; }
function press() {                                     // yours, or a network's drive (it overrides one turn)
  if (!drive || drive.age >= 0 || drive.policy) return;
  if (moveBtn.classList.contains("moving")) drive.again = true;
  else if (!drive.wish) { drive.wish = 1; moving(true); }
}
// It counts as the button goes down: on release, the pressed button (5px lower, smaller) is no longer under a press near its
// edge, and the click was lost. The keyboard's Enter and Space: a click with no press.
moveBtn.addEventListener("pointerdown", (e) => { if (e.button === 0) press(); });
moveBtn.addEventListener("click", (e) => { if (e.detail === 0) press(); });

// The road standing still: a parked car in each lane, `mine` and `other` rows ahead. Returns the radar's values.
function showScene(mine, other, lane, tags = false) {
  stopDrive();
  const rows = Array.from({ length: 14 }, () => new Uint8Array(2));
  rows[mine][lane] = 1; rows[other][1 - lane] = 1;
  Object.assign(view, { road: { seed: 0, lanes: 2, startLane: lane, rows, density: 0 }, pos: 0, lane, crashed: false, crashAge: -1, dist: 0, noSign: true, tags });
  drawView();
  return Float64Array.of(closeness(mine), closeness(other));
}
// A flashcard's situation on the road.
function showSituation(c) { showNet(net0, showScene(c.mine, c.other, c.lane)); }

// Step 1: the road before your drive, standing at the start.
function showStart() {
  stopDrive();
  const road = makeRoad(trySeed, { density: DENSITY.train });
  Object.assign(view, { road, pos: 0, lane: road.startLane, crashed: false, crashAge: -1, dist: 0, noSign: false, tags: false });
  drawView();
}

// ---------------------------------------------------------------- the network, in SVG
// Outputs on top (ink rises with the certainty), the hidden layer on a sunk panel, the two radar squares at the bottom.
// Two checkboxes, on together or apart. Neuron values: each neuron's number, and a line shows what it passes on right
// now (weight × value); off, a line shows its weight. Weights: each line's weight as a number.
// Backpropagation: moving dashes run from the answers down every line, coloured by the direction of its change.
// Horizontal, symmetrical: the hidden layer at x 0, the inputs at -D, the output at +D (placeNet sets D and the viewBox);
// captions under each column, lane names left of the inputs, the output value right of it.
let D = 320, OUTC, HIDC, INC, outs = 1;   // outs: output neurons, 1 (Move!) or 2 (Stay under Move!: the Atari network)
const OS = 100, HS = 70.4, IS = 100;
const N = { edges: [], out: [], hid: [], inp: [] };
let show = { values: true, weights: true }, panel = { net: null, x: null, act: undefined }, flowD = null;
let distEdit = false;                 // the tour's card step: the input distances as drop-downs (onDist)
function buildNet() {
  OUTC = outs === 2 ? [[D, 255], [D, 105]] : [[D, 175]]; HIDC = [[0, 50], [0, 175], [0, 300]]; INC = [[-D, 105], [-D, 255]];   // two outputs: level with the inputs, Move! on top
  const svg = $("net"); svg.replaceChildren(); N.edges = []; N.out = []; N.hid = []; N.inp = [];
  const lines = el("g", {}, svg), labels = el("g", {}, svg);
  const add = (p, idx, [x1, y1], [x2, y2], t) => {     // (x1, y1) = the upper end; the number sits on the line at t, along it
    const base = el("line", { class: "base", x1, y1, x2, y2 }, lines);   // grey, under the colour while it fills in (sweep)
    const w = el("line", { class: `w L edges ${p}`, x1, y1, x2, y2 }, lines);
    const f = el("line", { class: "flow", x1, y1, x2, y2 }, lines);
    const lx = x1 + (x2 - x1) * t, ly = y1 + (y2 - y1) * t;
    let a = Math.atan2(y2 - y1, x2 - x1) * 180 / Math.PI; if (a > 90) a -= 180; if (a < -90) a += 180;   // never upside down
    const wl = el("text", { class: `wl L edges ${p}`, x: lx, y: ly + 5, "text-anchor": "middle" }, el("g", { transform: `rotate(${a.toFixed(1)} ${lx} ${ly})` }, labels));
    N.edges.push({ p, idx, w, f, wl, base, len: Math.hypot(x2 - x1, y2 - y1), layer: p === "W2" ? 2 : 1 });
  };
  HIDC.forEach(([hx, hy], j) => OUTC.forEach(([ox, oy], k) => add("W2", k * 3 + j, [ox - OS / 2, oy], [hx + HS / 2, hy], 0.8)));
  HIDC.forEach(([hx, hy], j) => INC.forEach(([ix, iy], i) => add("W1", j * 2 + i, [hx - HS / 2, hy], [ix + IS / 2, iy], 0.3)));   // 0.3: the two lines into a hidden neuron far enough apart
  OUTC.forEach(([cx, cy], k) => {
    const x = cx - OS / 2, y = cy - OS / 2, g = el("g", { class: "L out" }, svg), q = outs === 2;
    const err = el("rect", { class: "errr", x: x - 9, y: y - 9, width: OS + 18, height: OS + 18, rx: 14 }, g);
    el("rect", { x, y, width: OS, height: OS, rx: 8, fill: "#fff" }, g);
    const fill = el("rect", { class: "fillr", x: x + 5, y: y + OS - 5, width: OS - 10, height: 0, rx: 4, fill: INK }, g);
    el("rect", { ...(k === OUTC.length - 1 ? { id: "out-box" } : {}), x, y, width: OS, height: OS, rx: 8, fill: "none", stroke: INK, "stroke-width": 2.5 }, g);   // out-box: Move!, the arrow's start
    if (q) el("text", { class: "oname", x: cx, y: cy + 8, "text-anchor": "middle", fill: INK }, g).textContent = ["Stay", "Move!"][k];   // the Atari network: each output scores one move
    const ring = el("rect", { class: "ring", x: x - 6, y: y - 6, width: OS + 12, height: OS + 12, rx: 12 }, g);
    const val = el("text", { class: "oval", x: cx + OS / 2 + 16, y: cy + 11, "text-anchor": "start", "font-size": 20, "font-weight": 600, fill: MUTED }, g);
    const bias = el("text", q ? { class: "bl", x: cx + OS / 2 + 16, y: cy + 8, "text-anchor": "start" } : { class: "bl", x: cx, y: cy + OS / 2 + 25, "text-anchor": "middle" }, g);   // its bias, under it (Weights view); two outputs: right of it
    const dec = el("g", { class: "dec", style: "display: none" }, g);   // its decision, under it (the tour's card step): Stay / Move!
    const decBox = el("rect", { x: cx - 48, y: cy + OS / 2 + 10, width: 96, height: 32, rx: 7 }, dec);
    const decText = el("text", { x: cx, y: cy + OS / 2 + 33, "text-anchor": "middle" }, dec);
    N.out.push({ fill, ring, val, err, y, bias, dec, decBox, decText });
  });
  HIDC.forEach(([cx, cy]) => {
    const x = cx - HS / 2, y = cy - HS / 2, g = el("g", { class: "L hid" }, svg);
    el("rect", { x, y, width: HS, height: HS, rx: 8, fill: "#fff" }, g);
    const tint = el("rect", { class: "hidr", x, y, width: HS, height: HS, rx: 8, fill: "transparent" }, g);
    el("rect", { x, y, width: HS, height: HS, rx: 8, fill: "none", stroke: INK, "stroke-width": 2.5 }, g);
    const val = el("text", { class: "hval", x: cx, y: cy + 8, "text-anchor": "middle", "font-size": 17, "font-weight": 600, fill: INK }, g);
    const bias = el("text", { class: "bl", x: cx, y: cy + HS / 2 + 23, "text-anchor": "middle" }, g);   // its bias, under it (Weights view)
    N.hid.push({ tint, val, bias });
  });
  [["Input layer", -D, "in"], ["Hidden layer", 0, "hid"], ["Output layer", D, "out"]].forEach(([s, x, c]) => {
    el("text", { class: `L ${c}`, x, y: 408, "text-anchor": "middle", "font-size": 19, "font-weight": 600, fill: INK }, svg).textContent = s;
  });

  INC.forEach(([cx, cy], i) => {
    const x = cx - IS / 2, y = cy - IS / 2, g = el("g", { class: "L in" }, svg);
    el("rect", { x, y, width: IS, height: IS, rx: 8, fill: "rgba(213,225,246,0.8)" }, g);
    const icon = el("g", {}, g);
    el("rect", { x, y, width: IS, height: IS, rx: 8, fill: "none", stroke: INK, "stroke-width": 2 }, g);
    const val = el("text", { class: "inval", x: cx - IS / 2 - 185, y: cy + 25, "text-anchor": "start", "font-size": 17, fill: MUTED }, g);
    el("text", { x: cx - IS / 2 - 185, y: cy - 9, "text-anchor": "start", "font-size": 19, "font-weight": 600, fill: INK }, g).textContent = ["My lane", "Other lane"][i];
    // the distance, as a drop-down (distEdit): after the value, 10–80 m
    const fo = el("foreignObject", { class: "dist", x: cx - IS / 2 - 105, y: cy - 2, width: 105, height: 36 }, g);
    const sel = fo.appendChild(document.createElementNS("http://www.w3.org/1999/xhtml", "select"));
    sel.innerHTML = Array.from({ length: AHEAD }, (_, k) => `<option value="${k + 1}">${(k + 1) * 10} m</option>`).join("");
    sel.setAttribute("aria-label", `${["My lane", "Other lane"][i]}: distance`); sel.onchange = onDist;
    N.inp.push({ icon, val, cx, y, fo, sel });
  });
}
buildNet();

// The network under the dashboard: the dashboard is 80% of the road, in 3 equal sections, Move! centred in the last; the
// output goes straight under Move!, the inputs as far left as the corners allow (the lane names right of the Weights /
// Impact switch, the Input layer caption clear of the legend), the hidden layer half-way. As tall as the box.
const LANES = 235, CAP = 78, NH = 420;   // LANES: the lane names left of an input's centre; CAP: half the Input layer caption; NH: the network's height, captions included
const PHONE = matchMedia("(max-width: 720px)");   // mobile.css's layout: the network the whole width, its switches and legend under it
function placeNet() {
  const svg = $("net"), r = svg.getBoundingClientRect(), st = document.querySelector(".stage").getBoundingClientRect();
  if (!r.width || !r.height) return;
  const pad = parseFloat(getComputedStyle($("dash")).paddingLeft), s = r.height / NH;
  let out = st.left + st.width / 2 + ((PHONE.matches ? 0.96 : 0.8) * st.width - 2 * pad) * (PHONE.matches ? 3 / 8 : 1 / 3) - r.left;   // Move!, px from the network's left (#dash: 80% of the road in thirds; 96% on phones, 25-50-25)
  if (PHONE.matches) out = Math.min(out, r.width + 6 - (OS / 2 + 16 + 120) * s);   // room for the labels right of the output (into the box's padding: the Atari biases are long), the same for every network, so the layers stay put; the output still under Move!
  const inp = PHONE.matches ? 4 + LANES * s
    : Math.max($("view").getBoundingClientRect().right - r.left + 12 + LANES * s, $("legend").getBoundingClientRect().right - r.left + 12 + CAP * s);
  const d = (out - inp) / 2 / s;
  if (!(d > 0)) return;
  if (Math.abs(d - D) > 0.5) { D = d; buildNet(); drawNet(); }
  const w = r.width / s, h = r.height / s;
  svg.setAttribute("viewBox", `${D - out / s} ${(NH - h) / 2} ${w} ${h}`);
}

// A parked car seen from behind (render.js's shapes): solid at 10 m, a smaller outline the farther it is.
const WIRE = { 2: 0.9, 3: 0.78, 4: 0.68, 5: 0.58, 6: 0.48, 7: 0.38, 8: 0.28 };
function radarIcon(o, v) {
  o.icon.innerHTML = "";
  if (!(v > 0.01)) return;
  const d = Math.round(AHEAD + 1 - v * AHEAD), solid = d === 1, W = IS * 0.66 * (solid ? 1 : WIRE[d]), cx = o.cx, base = o.y + IS * 0.53 + W * 0.39, g = o.icon;
  const pts = (a) => a.map(([px, py]) => `${px},${py}`).join(" "), st = { stroke: INK, "stroke-width": solid ? 1.5 : 2, "stroke-linejoin": "round" };
  for (const sx of [-1, 1]) el("rect", { x: cx + sx * W * 0.5 - W * 0.07, y: base - W * 0.22, width: W * 0.14, height: W * 0.24, rx: W * 0.04, fill: solid ? INK : "none", ...st }, g);
  el("polygon", { points: pts([[cx - W * 0.4, base - W * 0.46], [cx - W * 0.29, base - W * 0.8], [cx + W * 0.29, base - W * 0.8], [cx + W * 0.4, base - W * 0.46]]), fill: solid ? "#c3bfb3" : "none", ...st }, g);
  if (solid) el("polygon", { points: pts([[cx - W * 0.3, base - W * 0.5], [cx - W * 0.22, base - W * 0.73], [cx + W * 0.22, base - W * 0.73], [cx + W * 0.3, base - W * 0.5]]), fill: "rgba(22,21,15,0.55)" }, g);
  el("rect", { x: cx - W / 2, y: base - W * 0.5, width: W, height: W * 0.38, rx: W * 0.09, fill: solid ? "#a7a398" : "#d5e1f6", ...st }, g);
  if (solid) for (const sx of [-1, 1]) el("rect", { x: cx + sx * W * 0.36 - W * 0.07, y: base - W * 0.42, width: W * 0.14, height: W * 0.07, rx: W * 0.02, fill: "#e0453a" }, g);
}

const tint = (v) => `rgba(${v >= 0 ? "52,199,140" : "220,64,200"},${0.15 + 0.8 * Math.min(1, Math.abs(v))})`;
const signFill = (v) => (Math.abs(v) < 0.005 ? MUTED : v > 0 ? "#1f8a5f" : "#b0309c");

// Shows `net` (null = no weights yet); with x, one situation going through it; act = the move the car made (else its choice).
// upto: in the Impact view, how much is live, left to right (0 = all): 1 none (thin grey lines), 2 the impacts into the
// hidden layer, 3 + the hidden values, 4 + the impacts into the output; the output's value only with all of it.
function showNet(net, x = null, act, upto = 0) {
  if (net && net.outputs !== outs) { outs = net.outputs; buildNet(); placeNet(); }   // the Atari network has two outputs (on phones, placed for their labels)
  panel = { net, x, act, upto }; drawNet();
}
// A network's move: one output, over 50% = Move!; two (Atari), the higher score.
const netMove = (net, x) => { const q = forward(net, x).q; return net.outputs === 2 ? +(q[1] > q[0]) : +(q[0] > 0); };

// The view switch: "weights" = each line's weight (green positive, magenta negative, thicker = stronger) with its number, no neuron values;
// "impact" = each line's weight × the value it carries right now (green up, magenta down), the neuron values, no numbers.
// Every change of view turns the network over (flip), whoever asks: a click, the tour, a method, a test drive; the same
// view just redraws. swap: done while the network is edge-on.
let mode = "impact", want = mode;                     // want: the view on its way (the switch already there)
function setView(m, swap) {
  if (m === want) { if (m === mode) { swap?.(); drawNet(); } return; }
  want = m; $("view").dataset.i = +(m === "impact");
  for (const b of $("view").children) b.setAttribute("aria-pressed", b.dataset.v === m);
  flip(() => { swap?.(); mode = want; drawNet(); });
}
// A Weights / Impact change: the whole network turns half a rotation about its horizontal axis, like a card: fn (the new
// view) runs as it is edge-on, and the new view comes round the right way up. Reduced motion: no turn.
const FLIP = 400;
function flip(fn) {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return fn();
  const r = (d) => `perspective(1200px) rotateX(${d}deg)`;
  $("net").animate([{ transform: r(0), easing: "ease-in" }, { transform: r(90), offset: 0.5 },
    { transform: r(-90), offset: 0.5, easing: "ease-out" }, { transform: r(0) }], { duration: FLIP });
  setTimeout(fn, FLIP / 2);                          // edge-on: the swap unseen
}
$("view").addEventListener("click", (e) => {
  const b = e.target.closest("button"), v = b?.dataset.v;
  if (v) setView(v);
});
// Autopilot: on, the network drives (your Move! overrides one turn) and the arrow links its output to Move!; off, it still
// decides and shows it, but only you press Move!.
let autopilot = true;
function setAuto(on) {
  autopilot = on; $("auto").dataset.i = +!on;   // On on the left, Off on the right
  for (const b of $("auto").children) b.setAttribute("aria-pressed", (b.dataset.v === "on") === on);
  drawLink();
}
$("auto").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) setAuto(b.dataset.v === "on"); });
// The network switch (Flashcards, Copycat, Trial & Error): which method's network is on show and drives: the one you trained
// by it, else a pretrained one (modelNet). Clicked: onboard.js ends what is on (window.onModel), and that network drives on.
let model = "flash";
function setModel(k) {
  const p = $("model"), b = p.querySelector(`[data-v="${k}"]`);
  model = k;
  for (const c of p.children) c.setAttribute("aria-pressed", c === b);
  p.style.setProperty("--y", b.offsetTop - 2 + "px"); p.style.setProperty("--h", b.offsetHeight + "px");   // the knob: under the chosen one
  p.style.setProperty("--x", b.offsetLeft - 2 + "px"); p.style.setProperty("--w", b.offsetWidth + "px");   // phones: the buttons side by side
}
PHONE.addEventListener("change", () => setModel(model));
$("model").addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; setModel(b.dataset.v); (window.onModel ?? window.explore)(); });
addEventListener("resize", () => setModel(model));
requestAnimationFrame(() => setModel(model));

function drawNet() {
  const { net, x, act, upto } = panel, lv = upto || 9, wv = mode === "weights", q2 = net?.outputs === 2;
  // a network with other outputs than the panel's (Trial & Error's still on show as Copycat's panel is built): no values, till
  // the method shows its own (it crashed here, and the method's bubble stayed empty)
  const fits = !net || (q2 ? 2 : 1) === outs;
  const fp = net && x && fits ? (q2 ? { fwd: forward(net, x), p: null } : probs(net, x)) : null;
  const out = !wv && lv > 4 && fp, nums = show.values && !wv;
  const live = (e) => !wv && show.values && fp && lv > (e.layer === 1 ? 1 : 3);   // the line shows its impact
  const part = (e) => (e.p === "W1" ? x[e.idx % 2] : fp.fwd.h[e.idx % 3]);   // the value the line carries from below
  const max = [0, 0.3, 0.5];
  for (const e of N.edges) if (live(e)) max[e.layer] = Math.max(max[e.layer], Math.abs(net[e.p][e.idx] * part(e)));
  const big = [0, 1.6, 1.6];                         // the Weights view: thickness relative to the layer's strongest weight
  if (net) for (const e of N.edges) big[e.layer] = Math.max(big[e.layer], Math.abs(net[e.p][e.idx]));
  for (const e of N.edges) {
    if (!net || (!wv && !live(e))) {                  // no weights yet, or no impact shown yet: a thin grey line
      Object.assign(e.w.style, { stroke: "#cfcabd", strokeWidth: 1.5, strokeDasharray: net ? "none" : "4 5", opacity: 1 });
      e.wl.textContent = ""; e.wl.style.fill = MUTED;
      continue;
    }
    const on = live(e), w = net[e.p][e.idx], c = on ? w * part(e) : w, zero = Math.abs(w) < 0.005;
    const s = Math.pow(Math.abs(c) / (on ? max[e.layer] : big[e.layer]), 0.7), sw = zero ? 1.5 : 1.5 + 7 * s;
    Object.assign(e.w.style, { stroke: zero ? "#cfcabd" : c >= 0 ? POS : NEG, strokeWidth: sw, strokeDasharray: zero ? "4 5" : "none",
                               opacity: zero ? 1 : on ? 0.25 + 0.75 * s : 0.9 });
    e.w.style.setProperty("--sw", `${sw}px`);         // for the tour's highlight
    const v = flowD ? flowD[e.p][e.idx] : wv && show.weights ? w : on ? c : null;   // Weights: the weight; Impact: weight × value
    if (!e.spin) { e.wl.textContent = v == null ? "" : sgn(v); e.wl.style.fill = v == null ? MUTED : signFill(v); }   // spin: the tour's slot machine
  }
  const ed = distEdit && nums && x && x[0] > 0.01 && x[1] > 0.01;   // the distances as drop-downs
  const rows = x ? [...x].map((v) => Math.round(AHEAD + 1 - v * AHEAD)) : [];
  N.inp.forEach((o, i) => {
    const v = x ? x[i] : 0;
    radarIcon(o, wv ? 0 : v);
    o.val.textContent = !nums ? "" : !x ? "–" : ed ? v.toFixed(2) : v > 0.01 ? `${v.toFixed(2)} · ${rows[i] * 10} m` : "0.00 · clear";
    o.fo.style.display = ed ? "" : "none";
    if (ed) { o.sel.value = rows[i]; for (const op of o.sel.options) op.disabled = Number(op.value) === rows[1 - i]; }   // never both the same
  });
  N.hid.forEach((o, j) => {
    const v = fp && nums && lv > 2 ? fp.fwd.h[j] : null;
    o.val.textContent = v == null ? (net || !nums || upto ? "" : "?") : sgn(v); o.tint.style.fill = v == null ? "transparent" : tint(v);
  });
  [[N.hid, "b1"], [N.out, "b2"]].forEach(([ns, p]) => ns.forEach((o, j) => {   // the biases: Weights view only
    const b = wv && net ? net[p][j] : null;
    o.bias.textContent = b == null ? "" : `bias ${sgn(b)}`; o.bias.style.fill = b == null ? MUTED : signFill(b);
  }));
  const inner = OS - 10;
  N.out.forEach((o, k) => {
    if (outs === 2) {                                  // scores, not chances: each its number, the higher one framed
      const q = q2 && out ? fp.fwd.q : null;
      o.fill.style.height = "0px"; o.dec.style.display = "none";
      o.val.textContent = !nums ? "" : q ? sgn(q[k], 1) : net || upto ? "" : "–";
      o.ring.classList.toggle("on", !!q && +(q[1] > q[0]) === k);
      return;
    }
    const h = out ? inner * fp.p[1] : 0;
    o.fill.style.y = `${o.y + 5 + inner - h}px`; o.fill.style.height = `${h}px`;
    o.val.textContent = !nums ? "" : out ? fp.p[1].toFixed(2) : net || upto ? "" : "–";
    o.ring.classList.toggle("on", !!out && fp.p[1] > 0.5);   // only when the output is over 50%
    const move = !!out && fp.p[1] > 0.5;
    o.dec.style.display = distEdit && out ? "" : "none";
    o.decBox.style.fill = move ? "#2a64cc" : "#d6d1c3"; o.decText.style.fill = move ? "#fff" : INK; o.decText.textContent = move ? "Move!" : "Stay";
  });
  $("net-sub").textContent = !net ? "no weights yet" : stepNo <= 5 ? "initialized, untrained" : stepNo === 6 ? (sub ? `training epoch ${T.epoch + (sub === 3 ? 0 : 1)}` : `after epoch ${shown}`) : `trained, ${EPOCHS} epochs`;
  legend();
}

// Backpropagation on the network: d = each weight's change; null = off.
function showFlow(d) {
  flowD = d;
  const max = d ? Math.max(1e-9, ...N.edges.map((e) => Math.abs(d[e.p][e.idx]))) : 1;
  for (const e of N.edges) {
    const v = d ? d[e.p][e.idx] : 0, on = !!d && Math.abs(v) > 1e-4;
    e.f.classList.remove("on"); e.f.getBoundingClientRect();   // restart the animation
    Object.assign(e.f.style, { stroke: v > 0 ? POS : NEG, strokeWidth: 3 + 6 * Math.abs(v) / max,   // the training speed scales it
                               animationDuration: `${0.7 / playSpeed}s, 0.3s`, animationDelay: e.layer === 2 ? "0s" : `${0.8 / playSpeed}s` });
    e.f.classList.toggle("on", on);
  }
  drawNet();
}
const showErr = (on) => N.out.forEach((o) => o.err.classList.toggle("on", on));
// Training: which way information flows at this stage. Every line's colour fills in along it, one layer after the other:
// dir 1 = forward (inputs → output: an answer), -1 = backwards (output → inputs: backpropagation). ms: one layer's fill
// at normal speed; the training speed scales it. Every line's upper end (x1) is its right end.
function sweep(dir, ms = 400, scaled = true) {   // scaled: by the training speed (the drives pass their own)
  if (scaled) ms /= playSpeed;
  for (const e of N.edges) {
    const L = e.len, delay = (dir > 0 ? e.layer === 2 : e.layer === 1) ? ms : 0;
    e.sweep?.forEach((a) => a.cancel());
    e.sweep = [e.w.animate([{ strokeDasharray: `${L} ${L}`, strokeDashoffset: dir > 0 ? -L : L }, { strokeDasharray: `${L} ${L}`, strokeDashoffset: 0 }],
                           { duration: ms, delay, easing: "ease-in-out", fill: "backwards" }),
               e.base.animate([{ opacity: 1 }, { opacity: 1 }], { duration: 2 * ms })];
  }
}

// Values and weights are always shown; callers from the checkbox days just redraw.
function setShow() { drawNet(); }

// Follows the view switch.
function legend() {
  const sw = (c) => `<i style="background:${c}"></i>`, w = mode === "weights";
  $("legend").innerHTML = [`${sw("var(--positive)")}${w ? "positive" : "pushes up"}`, `${sw("var(--negative)")}${w ? "negative" : "pushes down"}`, "thicker = stronger"]
    .map((p) => `<span class="lg">${p}</span>`).join("");
}

// ---------------------------------------------------------------- cards
// A card seen from above: two lanes, our blue car at the bottom, the parked car in each lane with its distance.
function cardSvg(c, { labels = true } = {}) {
  const lx = (l) => 41 + l * 38, ry = (d) => 163 - d * 17.5;
  let s = `<svg class="cardsvg" viewBox="0 0 120 190" aria-hidden="true">
    <rect x="15" y="2" width="90" height="186" rx="6" fill="#bdbab1"/>
    <rect x="22" y="2" width="76" height="186" fill="#e8e5db"/>
    <line x1="23.5" y1="2" x2="23.5" y2="188" stroke="#fff" stroke-width="2"/><line x1="96.5" y1="2" x2="96.5" y2="188" stroke="#fff" stroke-width="2"/>
    <line x1="60" y1="2" x2="60" y2="188" stroke="#fbfaf6" stroke-width="2" stroke-dasharray="8 9"/>`;
  for (const [l, d] of [[c.lane, c.mine], [1 - c.lane, c.other]]) {
    s += `<rect x="${lx(l) - 14}" y="${ry(d) - 9}" width="28" height="18" rx="3.5" fill="#98948a" stroke="#16150f" stroke-width="1"/>`;
    if (labels) s += `<text x="${lx(l)}" y="${ry(d) + 3.6}" text-anchor="middle" font-size="9.5" font-weight="700" fill="#fff" font-family="ui-sans-serif, system-ui, sans-serif">${d * 10} m</text>`;
  }
  const x = lx(c.lane);
  s += `<rect x="${x - 12}" y="158" width="24" height="26" rx="5" fill="#2f6bd6" stroke="#16150f" stroke-width="1"/>
    <rect x="${x - 8}" y="164" width="16" height="9" rx="2" fill="#6f95e6"/></svg>`;
  return s;
}

// What a wrong answer likely leads to.
function hintFor(c) {
  const m = c.mine * 10, o = c.other * 10;
  return "This is a wrong answer. " + (c.right === 1
    ? `The car in your lane is ${m} m ahead, the other lane is free for ${o} m. Staying means you reach the nearer car first.`
    : `Your lane is free for ${m} m, but the other lane is blocked ${o} m ahead. Move! puts you behind the nearer car.`) +
    " It's your call: the network will learn it either way.";
}

function answer(a) {
  const c = cards[current], fresh = c.answer < 0;
  if (c.answer !== a && T) { T = null; sub = 0; played = false; testResult = null; }   // new answers: train again
  c.answer = a;
  render(fresh ? current : -1); ui();
}

function nextUnanswered() {
  const after = cards.findIndex((c, i) => i > current && c.answer < 0);
  return after >= 0 ? after : cards.findIndex((c) => c.answer < 0);
}

// ---------------------------------------------------------------- the training board
function renderPiles() {
  for (const set of ["learn", "check"]) {
    $("pile-" + set).innerHTML = TYPES.map((_, t) => cards.find((c) => c.type === t && c.set === set)).map((c, i) => {
      const off = c.answer !== c.right ? ` <span class="warn" title="This answer breaks the rule: Move! when the car in my lane is nearer">⚠</span>` : "";
      return `<div class="card deal" id="card-${c.id}" data-id="${c.id}" style="animation-delay:${(set === "check" ? 0.45 : 0) + i * 0.12}s">
        ${cardSvg(c)}
        <div class="you"><span class="muted">You:</span> ${ANSWERS[c.answer]}${off}</div>
        <div class="pbar"><span class="ps"></span><span class="pc"></span></div>
        <div class="pl"><span class="ls">Stay 50%</span><span class="lc">50% Move!</span></div>
        <div class="mark" hidden></div>
      </div>`;
    }).join("");
  }
}

// One epoch's network on the cards: its certainty bar, and ✓ / ✗ against your answer.
function showCards(net, { learn = true, check = true } = {}) {
  for (const c of cards) {
    const card = $("card-" + c.id); if (!card) continue;
    const on = c.set === "learn" ? learn : check, mark = card.querySelector(".mark");
    if (!on) { mark.hidden = true; continue; }
    const { p } = probs(net, c.x), ch = choice(net, c.x);
    card.querySelector(".ps").style.width = pct(p[0]); card.querySelector(".pc").style.width = pct(p[1]);
    card.querySelector(".ls").textContent = `Stay ${pct(p[0])}`; card.querySelector(".lc").textContent = `${pct(p[1])} Move!`;
    mark.hidden = false;
    mark.className = "mark " + (ch < 0 ? "tie" : ch === c.answer ? "ok" : "bad");
    mark.textContent = ch < 0 ? "?" : ch === c.answer ? "✓" : "✗";
    mark.title = ch < 0 ? "50/50: no opinion" : ch === c.answer ? "Same as your answer" : "Differs from your answer";
  }
}
const hot = (c) => document.querySelectorAll(".card").forEach((e) => e.classList.toggle("hot", !!c && e.dataset.id == c.id));

// A card clicked (a click, not a hover: phones have none): its situation goes through the network on show.
board.addEventListener("click", (e) => {
  const card = e.target.closest(".card"); if (!card || !T || playing || busy || sub) return;
  pickCard(cards[Number(card.dataset.id)]);
});
// The card picked: outlined, and it grows a little and back (.pick).
const pickCard = (c) => {
  hot(c); showNet(T.history[shown].net, c.x);
  const e = $("card-" + c.id); if (!e) return;
  e.classList.remove("deal", "pick"); e.getBoundingClientRect(); e.classList.add("pick");   // deal off: it would play again after
  e.addEventListener("animationend", () => e.classList.remove("pick"), { once: true });
};
// The tour's card step: the input distances can be changed too (drop-downs on the network); a card with the same
// distances is outlined.
function onDist() {
  const r = N.inp.map((o) => Number(o.sel.value));
  if (r[0] === r[1] || !T) return;
  hot(cards.find((c) => c.mine === r[0] && c.other === r[1]) ?? null);
  showNet(T.history[shown].net, Float64Array.of(closeness(r[0]), closeness(r[1])));
}
// For the onboarding: the trained network and its cards, after training (anything skipped filled in first); click a card
// to see its decision. pickCard(): the first training card, as if clicked.
window.tryCards = () => {
  trainToEnd(); stopDrive(); stepNo = 6; distEdit = true;
  board.hidden = false; roadCanvas.hidden = resetBtn.hidden = $("speed").hidden = $("dash").hidden = true; drawLink();
  if (!$("pile-learn").childElementCount) renderPiles();   // no deal again when they're there
  document.querySelectorAll(".card.deal").forEach((e) => {   // dealt (here or as training ended): twice as fast as in training
    if (!e.style.animationDuration) { e.style.animationDelay = parseFloat(e.style.animationDelay) / 2 + "s"; e.style.animationDuration = "0.25s"; }
  });
  document.querySelectorAll(".card").forEach((e) => e.classList.remove("dim", "err"));
  showCards(T.net); renderChart(); showNet(T.net);
};
window.pickCard = () => pickCard(cards.find((c) => c.type === 0 && c.set === "learn"));   // the first in the pile

// Validation loss per epoch, beside its number: a column per epoch (0 = untrained, then 1–10), a grey stub for those still
// to come; the epoch on show in full blue. Click a column: training goes on from there.
function renderChart() {
  const H = T ? T.history : [], top = Math.max(0.8, ...H.map((s) => s.checkLoss));
  const v = H[shown] ?? H.at(-1);                       // the big number: the epoch on show
  $("vloss").textContent = v ? v.checkLoss.toFixed(2) : "";
  const sp = $("vspark"), W = 110 / (EPOCHS + 1), h = (l) => Math.max(1.5, 22 * Math.min(l, top) / top);
  sp.replaceChildren();
  for (let e = 0; e <= EPOCHS; e++) {
    const s = H[e], x = e * W + 1, g = el("g", s ? { style: "cursor: pointer" } : {}, sp);
    el("rect", { x, y: s ? 24 - h(s.checkLoss) : 22, width: W - 2, height: s ? h(s.checkLoss) : 2, rx: 1, fill: s ? "#2f6bd6" : "#cfcabd", opacity: !s || e === shown ? 1 : 0.5 }, g);
    if (!s) continue;
    el("rect", { x: e * W, y: 0, width: W, height: 24, fill: "transparent" }, g);   // the whole slot clicks
    g.addEventListener("click", () => { if (!busy) seek(4 * e); });
    g.appendChild(el("title", {})).textContent = `Epoch ${e}: validation loss ${s.checkLoss.toFixed(2)}, validation cards right ${s.checkRight}/4`;
  }
}

// ---------------------------------------------------------------- training, one stage at a time
async function stage(fast = false) {
  if (sub === 0) {                                        // 1: the network answers the learn cards
    if (trained()) return;
    sub = 1; shown = T.epoch; showFlow(null); showErr(false); $("net").classList.remove("slow");
    showCards(T.net, { learn: true, check: false });
    document.querySelectorAll(".card").forEach((e) => {
      const c = cards[e.dataset.id];
      e.classList.toggle("dim", c.set !== "learn"); e.classList.toggle("err", c.set === "learn" && choice(T.net, c.x) !== c.answer);
    });
    renderChart(); render(); ui();
    if (!fast) {                                          // each card goes through the network
      busy = true; ui();
      for (const c of T.learn) { if (stepNo !== 6) break; hot(c); showNet(T.net, c.x); sweep(1, 220); await wait(550); }
      busy = false; hot(null);
    }
    if (stepNo === 6) { showNet(T.net); if (fast) sweep(1); }
  } else if (sub === 1) {                                 // 2: backpropagation
    sub = 2;
    const { g, loss } = gradients(T);
    pending = { corr: corrections(T, g), loss };
    if (!show.weights) { switched = true; setShow("weights", true); }
    showNet(T.net); showErr(true); showFlow(pending.corr.d); sweep(-1);
  } else if (sub === 2) {                                 // 3: update
    sub = 3; showErr(false); showFlow(null); $("net").classList.add("slow");
    apply(T, pending.corr, pending.loss);
    showNet(T.net); sweep(-1);                            // the backwards pass continues: the weights change, output to inputs
  } else {                                                // 4: check on the validate set
    sub = 0; pending = null; shown = T.epoch; $("net").classList.remove("slow");
    if (trained()) { shown = bestEpoch(T); T.net = cloneNet(T.history[shown].net); }   // done: back to its best epoch
    const end = trained();                                // done: every card back in full colour
    document.querySelectorAll(".card").forEach((e) => { e.classList.remove("err"); e.classList.toggle("dim", !end && cards[e.dataset.id].set === "learn"); });
    showCards(T.net); renderChart(); showNet(T.net); sweep(1);   // the validation cards go through; the training cards grey
  }
  render(); ui();
}

// Plays the remaining epochs, every stage, at the chosen pace.
async function play() {
  playing = true; played = true; stopPlay = false; render(); ui();
  const PAUSE = [700, 800, 1300, 900];                    // ms after the stage that leaves sub at 0 (check), 1, 2, 3
  while (!stopPlay && stepNo === 6 && !trained()) {
    await stage(true);
    await wait(PAUSE[sub] / playSpeed);
  }
  playing = false;
  if (stepNo === 6) render();
  ui();
}

// Where training is: 4 stages per epoch (0 = before epoch 1). After the update (sub 3), T.epoch already counts it.
const pos = () => (sub === 3 ? 4 * T.epoch - 1 : 4 * T.epoch + sub);
// Goes to stage p: from the untrained network, replayed to there at once (training is deterministic: the same every
// time). seek(0): back to the start; seek(pos() - 1): one stage back.
async function seek(p) {
  stopPlay = true; while (playing) await wait(50);
  T = createTrainer(cards, { netSeed, roadSeed, start: untrained() }); sub = 0; shown = 0; pending = null; played = false;
  showFlow(null); showErr(false); hot(null); $("net").classList.remove("slow");
  document.querySelectorAll(".card").forEach((e) => e.classList.remove("dim", "err"));
  showCards(T.net); renderChart(); showNet(T.net);
  while (pos() < p && !trained()) await stage(true);
  render(); ui();
}
// Whatever the tour skipped, filled in: open cards get the right answer, training runs to its end (back to its best epoch).
function trainToEnd() {
  cards.forEach((c) => { if (c.answer < 0) c.answer = c.right; });
  stopPlay = true;
  if (!T) { T = createTrainer(cards, { netSeed, roadSeed, start: untrained() }); sub = 0; pending = null; played = false; }
  if (sub === 1) { const { g, loss } = gradients(T); pending = { corr: corrections(T, g), loss }; }   // the epoch under way, finished
  if (sub === 1 || sub === 2) apply(T, pending.corr, pending.loss);
  sub = 0; pending = null;
  while (!trained()) { const { g, loss } = gradients(T); apply(T, corrections(T, g), loss); }
  shown = bestEpoch(T); T.net = cloneNet(T.history[shown].net);
}

// Take the tour again: your answers on the cards and the training start over (the same cards and untrained network).
window.tourReset = () => {
  stopPlay = true; cards.forEach((c) => { c.answer = -1; }); current = 0;
  T = null; sub = 0; pending = null; shown = 0; played = false; testResult = null;
};

// ---------------------------------------------------------------- the tour
const story = (cls, html) => `<div class="story ${cls}">${html}</div>`;
const radarText = (v) => (v > 0.01 ? `${v.toFixed(2)} (a car ${Math.round(AHEAD + 1 - v * AHEAD) * 10} m ahead)` : "0 (clear)");

function body() {
  const k = `<p class="kicker">Step ${stepNo} of 7</p>`;
  switch (stepNo) {
    case 1: {
      const r = tryRun, now = driving(), hits = r ? `${r.crashes || "no"} collision${r.crashes === 1 ? "" : "s"}` : "";
      const s = r ? story(r.crashes ? "" : "good", `<p><b>${r.stopped ? `Stopped at ${r.m} m` : `${r.m} m`}, ${hits}.</b> That one decision, every 10 m, is the car's whole job. Next: the network that will learn to make it.</p>`) : "";
      return `<p class="kicker">Step 1 of 7 · What you see</p><h2>An ultra-simple driving simulator</h2>
        <p><b>On the left: the road.</b> Our blue car drives on a two-lane road, past grey cars parked in both lanes.</p>
        <p>The car has a single action: <b>stay</b> in its lane, or <b>change lane</b>. No speed, no brakes, no steering. It decides once every 10 m.</p>
        <p>Soon a neural network will make that decision. First, try it yourself.</p>
        <div class="row"><button id="try" class="${r || now ? "" : "cta pulse"}" ${now ? "disabled" : ""}>${now ? "Driving…" : r ? "Try again" : "Try it"}</button></div>
        <p class="note">Press <b>Move!</b> under the car to change lane. Stop any time; the drive stops by itself after 200 m.</p>${s}`;
    }
    case 2: return `${k}<h2>The car's brain: a tiny neural network</h2>
      <p><b>On the right: the network</b> that will drive the car. Each box is a neuron, each line a connection. Point at a part to highlight it.</p>
      <ul class="parts">
        <li data-focus="in"><b>2 inputs: the radar, tied to the road</b>"My lane" sees the nearest car ahead in our lane, "Other lane" the nearest in the other lane: see the tags on the road. 1.00 = 10 m ahead, 0.13 = 80 m, 0 = clear.</li>
        <li data-focus="hid"><b>3 hidden neurons: the "brain"</b>Not tied to anything on the road. Each mixes both radar values in its own way. Learning can turn them into small detectors, such as "my lane is blocked, close ahead".</li>
        <li data-focus="out"><b>1 output: the car's one action</b>Change lane? From 0 to 100%. Over 50%, the car changes lane; otherwise it stays.</li>
        <li data-focus="edges"><b>12 connections</b>Every neuron connects to each neuron in the next layer. Each has a weight: how strongly, and which way, it pushes the next neuron (green up, magenta down). Learning means finding good weights.</li>
      </ul>
      <p><b>Type:</b> a feedforward network. Signals flow one way, from the radar up to the decision: no loops, no memory. <span class="pro">Professionals: a fully connected feedforward network (multilayer perceptron), 2-3-2.</span></p>
      <div class="row"><button id="look" ${driving() ? "disabled" : ""}>${driving() ? "Driving…" : "Drive and watch the radar"}</button></div>
      <p>Right now the connections have no weights (dashed, "?"), so it can't decide anything.</p>`;
    case 3: {
      let s = "";
      if (watching()) s = story("", "<p>Watch the network on the right: it decides every 10 m, on its own.</p>");
      else if (firstDrive) {
        const f = firstDrive, nxt = "<p>Next: we train it, then test it on a new road and see how much better it drives.</p>";
        if (f.crashed) {
          const { x } = f.last, fp = probs(net0, x);
          s = story("bad", `<p><b>Collision at ${f.m} m.</b> At its last decision the radar read ${radarText(x[0])} in my lane and ${radarText(x[1])} in the other lane.</p>
            <p>The hidden neurons reacted (${[...fp.fwd.h].map((v) => sgn(v)).join(", ")}), but every line to the output is 0, so none of it reaches it: Change lane ${pct(fp.p[1])}. Not over 50% means Stay, so it drove straight on, into the car.</p>${nxt}`);
        } else s = story("", `<p><b>${f.stopped ? `Stopped at ${f.m} m` : `${f.m} m, no collision: no car happened to block its lane`}.</b> It never changed lane: with the top lines at 0, it says 50% to everything, and not over 50% means Stay.</p>${nxt}`);
      }
      return `${k}<h2>Initialize the network</h2>
        <p>Before it can learn, every connection needs a starting weight.</p>
        <div class="row"><button id="rand" class="${net0 ? "" : "cta pulse"}" ${driving() ? "disabled" : ""}>${net0 ? "Initialize again" : "Initialize the network"}</button></div>
        ${net0 ? `<p>Done: see the network on the right, with <b>Weights</b> ticked.</p>
        <ul class="plain"><li>The 6 lower lines (radar → hidden) got small <b>random</b> weights: green +, magenta −.</li>
          <li>The 3 upper lines (hidden → Change lane?) start at <b>0</b>: dashed.</li></ul>
        <p><b>Why random?</b> If all weights started the same, the 3 hidden neurons would compute, and learn, the same thing. Random makes each one different.</p>
        <p><b>Why 0 on top?</b> So it starts with no opinion: Stay and Change lane get 50% each, whatever the radar sees.</p>
        <p>It hasn't learned anything yet. Let it drive untrained, to see where it starts. Then we'll train it and see how its driving improves.</p>
        <div class="row"><button id="watch" class="${firstDrive ? "" : "cta pulse"}" ${driving() ? "disabled" : ""}>${watching() ? "Driving…" : firstDrive ? "Drive again" : "Let it drive untrained"}</button></div>` : ""}${s}`;
    }
    case 4: return `${k}<h2>How will it learn?</h2>
      <p>There are three ways to teach it. All three change the same weights, each in its own way.</p>
      <div class="methods">
        <button class="method rec" id="m-cards"><span class="tag">Start here</span><b>Flashcards</b><br>You answer 8 road situations. The network studies your answers.<small>Professionals: supervised learning</small></button>
        <button class="method" disabled><span class="tag">Coming next</span><b>Atari</b><br>The car practises alone, by trial and error: points for driving safely, a penalty for every collision.<small>Professionals: reinforcement learning (Deep Q-learning)</small></button>
        <button class="method" disabled><span class="tag">Coming next</span><b>Copycat</b><br>You drive; the network copies your moves.<small>Professionals: imitation learning (behavioural cloning)</small></button>
      </div>
      <p>We recommend starting with the flashcards: you see every answer it learns from.</p>`;
    case 5: {
      const c = cards[current], fb = c.answer < 0 ? "" : c.answer === c.right ? `<p class="good">✓ Good call.</p>`
        : `<div class="hint">${hintFor(c)}</div>`;
      return `<p class="kicker">Step 5 of 7 · Situation ${current + 1} of 8</p>
        <h2>What should the blue car do?</h2>
        <p class="sees">Your lane: a car ${c.mine * 10} m ahead. Other lane: a car ${c.other * 10} m ahead.</p>
        <div class="ask">${ANSWERS.map((a, i) => `<button data-a="${i}" class="${c.answer === i ? "picked" : ""}">${a}</button>`).join("")}</div>
        ${fb}
        <p class="note">Your answers become its flashcards. It learns them as given, right or wrong.</p>
        <div class="deck" id="deck">${cards.map((d, i) => d.answer < 0
          ? `<div class="slot${i === current ? " cur" : ""}"><span class="n">${i + 1}</span></div>`
          : `<button class="slot full${i === current ? " cur" : ""}" data-i="${i}" title="Situation ${i + 1}: ${ANSWERS[d.answer]}">${cardSvg(d, { labels: false })}<span class="badge${d.answer ? " move" : ""}${d.answer !== d.right ? " off" : ""}">${ANSWERS[d.answer]}</span></button>`).join("")}</div>`;
    }
    case 6: return trainBody();
    case 7: {
      let s = "";
      if (watching()) s = story("", "<p>Watch the network fire on every decision: the radar at the bottom, the hidden neurons, and the winning answer on top (green frame).</p>");
      else if (testResult && !testResult.crashed) s = story("good", `<p><b>✓ 500 m, no collision.</b> On a road it had never seen, it made ${TEST_ROWS} decisions and changed lane ${testResult.moves} times.</p>
        <p>From 4 flashcards, it learned the rule: change lane when the car in my lane is nearer, otherwise stay.${firstDrive?.crashed ? ` Untrained, it crashed at ${firstDrive.m} m.` : ""}</p>`);
      else if (testResult) {
        const { x, action } = testResult.last, fp = probs(T.net, x), off = wrongCards();
        s = story("bad", `<p><b>Collision at ${testResult.m} m.</b> At its last decision the radar read ${radarText(x[0])} in my lane and ${radarText(x[1])} in the other lane. It said Change lane ${pct(fp.p[1])}, so it ${action ? "changed lane" : "stayed"}.</p>
          <p>${off ? `${off} of your cards had an answer that breaks the rule, and it learned ${off > 1 ? "them" : "it"} as given. Go back to the cards (step 5) and check them.` : "Try a new random start (step 3), or new cards."}</p>`);
      }
      return `${k}<h2>The real test: a road it has never seen</h2>
        <p>The cards were practice. The real test is 500 m of new road that the network never saw. No learning, no help: it decides alone, every 10 m.</p>
        <div class="row"><button id="go-test" class="${testResult ? "" : "cta pulse"}" ${watching() ? "disabled" : ""}>${testResult ? "Drive again" : "Start the test drive"}</button></div>
        <p class="note">Set the speed under the road.</p>
        ${s}`;
    }
  }
}

function trainBody() {
  const H = T.history, s = H[T.epoch], k = (t) => `<p class="kicker">Step 6 of 7 · ${t}</p>`;
  const off = wrongCards(), warn = off ? `<p class="warn">⚠ ${off} of your answers ${off > 1 ? "break" : "breaks"} the rule. The network will learn ${off > 1 ? "them" : "it"} as given.</p>` : "";
  if (playing || (played && !trained())) {
    const e = sub ? T.epoch + (sub === 3 ? 0 : 1) : T.epoch, names = ["checked", "answering", "backpropagation", "update"];
    return `${k(`Epoch ${e} of ${EPOCHS}`)}<h2>Epochs 2 to ${EPOCHS}</h2>
      <p>Each epoch runs the same 4 stages: answer, backpropagation, update, check. Watch the weights settle, the certainty bars grow, and the validation loss fall.</p>
      <div class="row"><button id="pause">${playing ? "Pause" : "Paused"}</button>
        <label>Speed <select id="pspd">${[[0.5, "Slow"], [1, "Normal"], [3, "Fast"]].map(([v, n]) => `<option value="${v}"${v === playSpeed ? " selected" : ""}>${n}</option>`).join("")}</select></label></div>
      ${story("", `<p>Epoch ${e}: ${names[sub]}. Validation loss ${s.checkLoss.toFixed(2)}, validate cards right ${s.checkRight}/4.</p>`)}`;
  }
  if (trained()) return `${k("Done")}<h2>Training completed</h2>
    <p>Validation loss: ${H[0].checkLoss.toFixed(2)} → ${s.checkLoss.toFixed(2)}. Validate cards right: ${s.checkRight}/4, without ever studying them.</p>
    ${s.checkLoss > H[0].checkLoss ? "<p>The validation loss went <b>up</b>: what it learned from the learn cards doesn't hold on the validate cards. That is the warning sign professionals watch for.</p>" : ""}${warn}<p class="note">Click any epoch under the cards to see the network as it was then.</p>
    <p>The cards are only practice, though. Next: the real test.</p>`;
  if (T.epoch === 0 && sub === 0) return `${k("Split")}<h2>Training</h2>
    <p>Your 8 cards are split in two. <b>Learn set</b>: 4 cards the network studies. <b>Validate set</b>: 4 similar cards, kept aside. It never studies them; they check whether it learned the rule, not just 4 answers.</p>
    <p>Training runs in <b>epochs</b>. In each, the network answers the learn cards, finds its errors, and corrects every weight a little. ${EPOCHS} epochs in all.</p>
    <p>After each epoch, the <b>validation loss</b> shows its error on the validate cards. Right now it is ${s.checkLoss.toFixed(2)}: a pure 50/50 guess.</p>${warn}`;
  const ep = sub === 3 ? T.epoch : T.epoch + 1;
  if (sub === 1) {
    const wrong = T.learn.filter((c) => choice(T.net, c.x) !== c.answer).length, ties = T.learn.filter((c) => choice(T.net, c.x) < 0).length;
    return `${k(`Epoch ${ep} of ${EPOCHS} · stage 1 of 4`)}<h2>Answer</h2>
      <p>The network answers the 4 learn cards. ${ties === 4 ? "It has no opinion yet: 50/50 on every card." : wrong ? `${wrong} of 4 differ from your answers.` : "All 4 match your answers, but not with full certainty yet."}</p>
      <p>The gap between its answers and yours is its <b>error</b>. Now it finds where that error comes from.</p>`;
  }
  if (sub === 2) return `${k(`Epoch ${ep} of ${EPOCHS} · stage 2 of 4`)}<h2>Backpropagation</h2>
    <p>The error flows backwards, from the answers through every connection. Each connection gets its share of the blame, and a correction: green = its weight goes up, magenta = down. The numbers on the network are the changes.</p>
    ${T.epoch === 0 ? "<p>The lower connections get no correction yet: the lines above them are still 0, so no blame passes through.</p>" : ""}
    ${switched ? `<p class="note"><b>Weights</b> is now ticked on the network, so after the update you see the new weights. Untick it any time.</p>` : ""}`;
  if (sub === 3) return `${k(`Epoch ${ep} of ${EPOCHS} · stage 3 of 4`)}<h2>Update</h2>
    <p>Every weight moves by its correction: one small step (learning rate ${RATE}). Watch the lines change.</p>`;
  const prev = H[T.epoch - 1];
  return `${k(`Epoch ${T.epoch} of ${EPOCHS} · stage 4 of 4`)}<h2>Check</h2>
    <p>Now the validate cards, which it never studied. Validation loss: ${prev.checkLoss.toFixed(2)} → ${s.checkLoss.toFixed(2)}. Validate cards right: ${s.checkRight}/4.</p>
    <p>That was epoch ${T.epoch} of ${EPOCHS}. The other ${EPOCHS - T.epoch} run the same way.</p>`;
}

// Rebuilds the tour text and wires its controls; pop = the deck slot that just got its card.
// For the onboarding (onboard.js): the demo drive, Move! pressed for you before 80% of the collisions; stopped, back to the start.
window.demoDrive = () => startDrive({ auto: 0.8 });
window.stopDemo = () => showNet(net0, showScene(7, 3, 1));
// Our car grows to 1.3× and back, over 0.75 s.
window.pulseCar = () => {
  const t0 = performance.now();
  const f = (now) => {
    const k = Math.min(1, (now - t0) / 750);
    view.carScale = 1 + 0.3 * Math.sin(Math.PI * k); drawView();
    if (k < 1) requestAnimationFrame(f);
  };
  requestAnimationFrame(f);
};
// The demo: a trained network drives, for real, from the start (trained offline on every radar pair: change lane when
// the car in my lane is 30 m or closer and closer than the other lane's; 0 collisions on 3,000 roads of 10 km).
const DEMO_NET = { inputs: 2, hidden: 3, outputs: 1,
  W1: Float64Array.of(5.644, -2.024, 14.165, 1.625, 10.071, -10.203), b1: Float64Array.of(-4.128, -10.272, -0.02),
  W2: Float64Array.of(6.692, 10.441, 9.008), b2: Float64Array.of(-4.037) };
// The demo, unless it's already on; the Impact view.
window.demo = () => {
  show.values = show.weights = true; $("net").classList.remove("slow"); setView("impact"); setAuto(true);
  if (drive?.net !== DEMO_NET) { startDrive({ net: DEMO_NET, keepOn: true }); showNet(DEMO_NET, observe(drive.run)); }   // values from the first frame
  $("net").classList.remove("quick");                // its panel eases from decision to decision
};
// For the onboarding (onboard.js): the Weights / Impact switch, the network spinning over (the same view: fading over).
window.netUi = {
  view(m, swap) {                                                   // swap: done while the network is edge-on / faded out
    if (m !== want) return setView(m, swap);
    const net = $("net"); net.style.transition = "opacity .25s"; net.style.opacity = 0;
    setTimeout(() => { swap?.(); setView(m); net.style.opacity = 1; }, 250);
  },
  knob: (m) => { $("view").dataset.i = +(m === "impact"); },        // the switch alone slides; view() then changes the network
  outputs(n) { if (n !== outs) { outs = n; buildNet(); placeNet(); } drawNet(); },
  auto: (on) => setAuto(on),                                       // the Autopilot switch, set by a flow
  model: (k) => setModel(k),                                      // the network switch, set by a flow (it drives nothing)   // 1 or 2 output neurons (Atari: Stay under Move!)
  mode: () => mode,                                                // the view on show: "weights" or "impact"
  // Backpropagation as in training, on the network on show: the output's error ring blinks, and corrections (made up, a
  // little each way) flow from the output down every line, its number showing it. Again: a new round. Off: all gone.
  backprop(on) {
    if (!on) { if (flowD) { showErr(false); showFlow(null); } return; }
    const d = Object.fromEntries([["W1", 6], ["W2", 3 * outs]].map(([p, n]) =>
      [p, Float64Array.from({ length: n }, () => (Math.random() < 0.5 ? -1 : 1) * (0.02 + 0.1 * Math.random()))]));
    showErr(true); showFlow(d); sweep(-1, 400, false);
  },
  // Every weight let go in turn, right to left (the slot machine's reverse): its line thins to grey dots, its number goes;
  // then no network at all (dotted lines, no biases). A drive goes on, its network no longer shown.
  strip(ms = 800) {
    if (drive) drive.blind = true;
    const es = [...N.edges.filter((e) => e.p === "W2"), ...N.edges.filter((e) => e.p === "W1")];
    es.forEach((e, i) => setTimeout(() => {
      Object.assign(e.w.style, { stroke: "#cfcabd", strokeWidth: 1.5, strokeDasharray: "4 5", opacity: 1 }); e.wl.textContent = "";
      if (i === 0 || e.p !== es[i - 1].p) for (const o of e.p === "W2" ? N.out : N.hid) o.bias.textContent = "";   // a layer's biases go with its first line
    }, ms * i / (es.length - 1)));
    setTimeout(() => showNet(null), ms + 50);
  },
  // Every weight spins like a slot machine, slowing down; each lands on its value in turn, left to right.
  spin(ms = 1200) {
    const es = [...N.edges.filter((e) => e.p === "W1"), ...N.edges.filter((e) => e.p === "W2")], t0 = performance.now();
    es.forEach((e, i) => { e.spin = t0 + ms * (0.55 + 0.45 * i / (es.length - 1)); });
    const f = () => {
      const now = performance.now();
      for (const e of es) {
        if (!e.spin) continue;
        if (now >= e.spin) { e.spin = 0; drawNet(); continue; }
        const v = (2 * Math.random() - 1) * 1.1; e.wl.textContent = sgn(v); e.wl.style.fill = signFill(v);
      }
      if (es.some((e) => e.spin)) setTimeout(f, 40 + 80 * Math.min(1, (now - t0) / ms));
    };
    f();
  },
};
// The tour's untrained network: all weights random; one that stays in its lane and hits the car 20 m ahead on the tour's
// road (it never moved out of the way: no lucky escape), so the crash comes right after its weights are set.
let crashSeed = anySeed();
const crashes = (net) => {
  const run = newRun(startRoad(crashSeed, true), { maxRows: 4 });   // the other lane is free for 50 m: any move escapes
  let stays = true;                                                   // never out of its lane: the countdown runs straight to the crash
  while (!run.done) { step(run, +(probs(net, observe(run)).p[1] > 0.5)); stays &&= run.lane === run.road.startLane; }
  return run.crashed && stays;
};
const untrained = () => {
  if (!net0) do { netSeed = anySeed(); net0 = createNet(netSeed, { inputs: 2, hidden: 3, outputs: 1 }); } while (!crashes(net0));
  return net0;
};
// It takes over the driving, unless it already has, on the tour's road: the crash 20 m on, and there it stops; done() then.
// rows 6: if you dodge it with Move!, it ends at 60 m.
window.untrained = (done) => {
  if (drive?.net !== untrained()) { startDrive({ net: net0, seed: crashSeed, soon: true, rows: 6, onEnd: done }); showNet(net0, observe(drive.run)); }
};
// The tour's countdown: seconds until that crash, at the speed set now; null once it can't come (no such drive, or you moved).
// It comes as the car drives into row 2 (rows 2 of startRoad's soon road), HIT_AT into the row before.
window.crashIn = () => {
  const d = drive;
  if (!d || d.net !== net0 || d.age >= 0 || d.run.lane !== d.run.road.startLane) return null;
  return Math.max(0, (1 + HIT_AT - (d.base + d.f)) / (PACE * speed));
};
// For the onboarding (onboard.js): the flashcards, in a window over the network. Each situation parked on the road; you
// answer Stay or Move!: a good call moves on to the next open card, a wrong one gets a hint and waits (change it,
// or keep it). The deck, a card per answer (click one to see it again); the open one on show: its cars already, the
// answer added once you choose. Between ‹ Previous and Next ›; Auto-complete
// answers the open ones right. Once all 8 are answered: done(), and Continue under the deck, on the right (go()).
window.flashcards = (box, { done, go }) => {
  untrained();
  let tm = 0;
  const see = (i) => { clearTimeout(tm); if (!box.isConnected) return; current = i; showSituation(cards[i]); draw(); };
  const finish = () => { if (allAnswered()) done(); };
  const draw = (pop = -1) => {
    const c = cards[current], fb = c.answer < 0 ? "" : c.answer === c.right ? `<p class="good">✓ Good call.</p>`
      : `<div class="hint">${hintFor(c)}</div>`;
    // The green, one way forward: an open card, its right answer; an answered one, › (on the last card, the next open
    // card in the deck); all answered, Continue
    const on = c.answer >= 0 && !allAnswered() ? (current < 7 ? "next" : nextUnanswered()) : null;
    box.innerHTML = `<div class="fc-q">
        <div class="fc-head"><button class="fc-prev" ${current ? "" : "disabled"} title="Previous situation">‹</button>
          <span class="kicker">Situation ${current + 1} of 8</span><button class="fc-next${on === "next" ? " go" : ""}" ${current < 7 ? "" : "disabled"} title="Next situation">›</button></div>
        <h3>What should the blue car do?</h3>
        <p class="sees">Your lane: a car ${c.mine * 10} m ahead.<br>Other lane: a car ${c.other * 10} m ahead.</p>
        <div class="ask">${ANSWERS.map((a, i) => `<button data-a="${i}" class="${c.answer === i ? "picked" : ""}${i === c.right && c.answer < 0 ? " cta" : ""}">${a}</button>`).join("")}</div>
        <div class="fc-fb">${fb}</div></div>
      <div class="fc-set">
        <div class="fc-head"><span class="kicker">Labeled cards</span><span class="fc-count">${cards.filter((d) => d.answer >= 0).length} of 8</span></div>
        <div class="fc-deck">${cards.map((d, i) => d.answer < 0
          ? i === current ? `<button class="slot cur" data-i="${i}" title="Situation ${i + 1}: your call">${cardSvg(d, { labels: false })}</button>`   // its cars, no answer yet
            : `<button class="slot${i === on ? " go" : ""}" data-i="${i}"><span class="n">${i + 1}</span></button>`
          : `<button class="slot full${i === current ? " cur" : ""}${pop === 8 ? " pop" : i === pop ? " pop-b" : ""}" data-i="${i}" title="Situation ${i + 1}: ${ANSWERS[d.answer]}">${cardSvg(d, { labels: false })}<span class="badge${d.answer ? " move" : ""}${d.answer !== d.right ? " off" : ""}">${ANSWERS[d.answer]}</span></button>`).join("")}</div>
        <div class="fc-foot">${allAnswered() ? `<button class="fc-go">Continue</button>` : `<button class="fc-auto">Auto-complete</button>`}</div></div>`;
    box.querySelectorAll(".ask button").forEach((b) => b.onclick = () => {
      const fresh = c.answer < 0; c.answer = Number(b.dataset.a); T = null; sub = 0; played = false; testResult = null;
      draw(fresh ? current : -1); finish();
      clearTimeout(tm);
      if (c.answer === c.right && !allAnswered()) tm = setTimeout(() => see(nextUnanswered()), 700);   // a beat to see the ✓
    });
    box.querySelector(".fc-go")?.addEventListener("click", go);
    box.querySelector(".fc-prev").onclick = () => see(current - 1);
    box.querySelector(".fc-next").onclick = () => see(current + 1);
    box.querySelector(".fc-auto")?.addEventListener("click", () => {
      clearTimeout(tm); cards.forEach((d) => { if (d.answer < 0) d.answer = d.right; }); T = null; sub = 0; played = false; testResult = null;
      draw(8); finish();
    });
    box.querySelectorAll(".fc-deck .slot").forEach((b) => b.onclick = () => see(Number(b.dataset.i)));
  };
  see(cards[current].answer < 0 || allAnswered() ? current : nextUnanswered());
  finish();
};
// For the onboarding (onboard.js): the training, on the board in the road's place, the network under it (Weights view),
// from the tour's untrained network (the one that crashed). bar: the bubble's box for the stage's text and the controls
// (tape-recorder style: ⏮ back to the start, ⏪ a stage back, play / pause, ⏩ a stage on, ⏭ to the end; the speed, a double
// click back to normal; once trained, a slider over the epochs, between the tour's Back and Continue),
// built once and updated on every change (ui()), so a slider keeps working while it plays; done() once trained.
const PLAY_SPEEDS = [0.25, 0.5, 1, 2, 3, 5];
const ICON = (d) => `<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="${d}"/></svg>`;   // black, not the emoji's blue
const TAPE = { start: ICON("M3 3h2v10H3zM13 3v10L6 8z"), back: ICON("M8 3v10L2 8zM15 3v10L9 8z"), play: ICON("M4 3v10l9-5z"),
               pause: ICON("M4 3h3v10H4zM9 3h3v10H9z"), fwd: ICON("M1 3v10l6-5zM8 3v10l6-5z"), end: ICON("M3 3v10l7-5zM11 3h2v10h-2z") };
let onTrain = null;
window.training = (bar, done, reset) => {   // reset(): Reset confirmed (the tour: the cards and the training start over)
  stopDrive(); stopPlay = true; stepNo = 6;
  cards.forEach((c) => { if (c.answer < 0) c.answer = c.right; });   // a jump past the cards: the open ones answered right
  if (!T) { T = createTrainer(cards, { netSeed, roadSeed, start: untrained() }); sub = 0; shown = 0; played = false; switched = false; }
  board.hidden = false; roadCanvas.hidden = resetBtn.hidden = $("speed").hidden = $("dash").hidden = true; drawLink();
  setView("weights");
  renderPiles(); showCards(T.history[shown].net); renderChart(); showNet(T.history[shown].net);
  const loss = (s) => s.checkLoss.toFixed(2);
  bar.innerHTML = `<p class="tr-text"></p>
    <div class="tr-ctl"><button class="tr-rew" title="Back to the start">${TAPE.start}</button><button class="tr-back" title="Step back">${TAPE.back}</button><button class="tr-play"></button><button class="tr-fwd" title="Step forward">${TAPE.fwd}</button><button class="tr-end" title="To the end">${TAPE.end}</button><button class="tr-reset" title="Reset the training data">Reset</button>
      <label class="tr-ep">Epoch <input type="range" min="0" step="1" aria-label="Epoch on show"> <output></output></label>
      <label class="tr-spd" title="Double-click: normal speed">Speed <input type="range" min="0" max="${PLAY_SPEEDS.length - 1}" step="1" value="${PLAY_SPEEDS.indexOf(playSpeed)}" aria-label="Training speed"></label></div>`;
  const q = (s) => bar.querySelector(s), epBox = q(".tr-ep"), epIn = q(".tr-ep input"), spdIn = q(".tr-spd input");
  const nav = bar.closest("#intro")?.querySelector(".ob-nav");
  const go = nav?.querySelector(".ob-go");
  if (nav) { nav.querySelector(".tr-ep")?.remove(); nav.insertBefore(epBox, go); nav.classList.add("on"); }   // between Back and Continue, shown from the start
  if (go && !trained()) go.hidden = true;                // Continue once trained
  q(".tr-rew").onclick = () => seek(0);
  q(".tr-back").onclick = () => seek(pos() - 1);
  q(".tr-fwd").onclick = () => stage();
  q(".tr-play").onclick = () => { if (playing) stopPlay = true; else play(); };
  q(".tr-reset").onclick = () => {                     // asks first
    if (q(".tr-confirm")) return;
    stopPlay = true;
    bar.insertAdjacentHTML("beforeend", `<div class="tr-confirm"><span>All training data will be reset.</span><button class="cta tr-yes">Continue</button><button class="tr-no">Cancel</button></div>`);
    q(".tr-no").onclick = () => q(".tr-confirm").remove();
    q(".tr-yes").onclick = () => reset?.();
  };
  q(".tr-end").onclick = async () => {
    stopPlay = true; while (playing) await wait(50);
    while (!trained() && stepNo === 6) await stage(true);
  };
  spdIn.oninput = () => { playSpeed = PLAY_SPEEDS[Number(spdIn.value)]; };
  spdIn.ondblclick = () => { spdIn.value = PLAY_SPEEDS.indexOf(1); spdIn.oninput(); };
  // The epoch slider: dragging shows where it would go; let go, and training is there (replayed or trained on to it), and
  // the steps and Play go on from that epoch.
  const epText = (e) => { const s = T.history[e], end = trained(); return `${e}${s && end && e === bestEpoch(T) ? " · best" : ""}${s ? ` · loss ${loss(s)}` : ""}`; };
  epIn.oninput = () => { epBox.querySelector("output").textContent = epText(Number(epIn.value)); };
  epIn.onchange = () => seek(4 * Number(epIn.value));
  onTrain = () => {
    if (!bar.isConnected) { onTrain = null; return; }
    const H = T.history, s = H[T.epoch], ep = sub ? T.epoch + (sub === 3 ? 0 : 1) : T.epoch, end = trained();
    const wrong = T.learn.filter((c) => choice(T.net, c.x) !== c.answer).length, b = bestEpoch(T), last = H.length - 1;
    const text = end ? (stalled(T)
        ? (b < last
          ? `<b>Training completed.</b> In epoch ${last} the validation loss rose, so training stopped and went back to epoch ${b}, its best. Training on would only memorize the training cards (overfitting).`
          : `<b>Training completed.</b> In epoch ${last} all 4 validation cards were right and the validation loss fell by less than ${MIN_GAIN}, so training stopped: more epochs would barely improve it. Validation loss ${loss(H[0])} → ${loss(H[b])}; validation cards right: ${H[b].checkRight}/4.`)
        : `<b>Training completed.</b> ${EPOCHS} epochs${b < last ? `, then back to epoch ${b}, its best` : ""}. Validation loss ${loss(H[0])} → ${loss(H[b])}; validation cards right: ${H[b].checkRight}/4.`)
      : !ep ? `Press <span class="tr-pi">${TAPE.play}</span> to begin training. Adjust the speed as you like. You can pause at any moment and go step by step, or skip to the end. Use the Epoch slider to examine the training state at the end of each epoch.`
      : sub === 1 ? `<b>Answer:</b> the network answers the 4 training cards. ${wrong ? `${wrong} of 4 differ from your answers.` : "All 4 match your answers."}`
      : sub === 2 ? "<b>Backpropagation:</b> the error flows backwards through every connection. Green: its weight goes up; magenta: down."
      : sub === 3 ? "<b>Update:</b> every weight moves a small step by its correction."
      : `<b>Check:</b> the network is tested on the 4 validation cards. Success: ${s.checkRight}/4; Validation loss ${loss(H[T.epoch - 1])} → ${loss(s)}.`;
    q(".tr-text").innerHTML = end ? text : `<span class="kicker">${!ep ? "Training" : `Epoch ${ep} · stage ${sub || 4} of 4`}</span> ${text}`;   // done: its own words, no tag
    q(".tr-rew").disabled = busy || !pos();
    q(".tr-back").disabled = busy || playing || !pos(); q(".tr-fwd").disabled = busy || playing || end;
    q(".tr-play").disabled = q(".tr-end").disabled = busy || end;
    q(".tr-reset").disabled = busy;
    q(".tr-play").innerHTML = playing ? TAPE.pause : TAPE.play; q(".tr-play").title = playing ? "Pause" : "Play";
    q(".tr-play").classList.toggle("nudge", !played && !playing && !busy && !pos());   // pulses until training first starts
    const begun = played || playing || pos() > 0;        // the green: Play until training begins, then To the end; trained, the tour's Continue
    q(".tr-play").classList.toggle("go", !begun && !end); q(".tr-end").classList.toggle("go", begun && !end);
    spdIn.disabled = end; q(".tr-spd").classList.toggle("off", end);
    const at = sub ? T.epoch - (sub === 3 ? 1 : 0) : shown;   // the last epoch done (or, once trained, the best)
    epIn.max = end ? last : EPOCHS; epIn.value = at; epIn.disabled = busy;
    epBox.querySelector("output").textContent = epText(at);
    if (end) { if (go) go.hidden = false; done(); }
  };
  onTrain();
};
// Back to the road (the tour's other steps).
window.trainingOff = () => {
  if (stepNo !== 6) return;
  stopPlay = true; busy = false; onTrain = null; stepNo = 1; hot(null); distEdit = false;
  board.hidden = true; roadCanvas.hidden = $("speed").hidden = $("dash").hidden = false;
  showFlow(null); showErr(false); $("net").classList.remove("slow"); drawView();
};
// For the onboarding (onboard.js): the self-drive. Anything the tour skipped is filled in first (trainToEnd); then the
// trained network drives 500 m of road it has never seen, at top speed (10), Impact view, Autopilot on; done(result) at
// the end or at a collision.
window.selfDrive = (done) => {
  trainToEnd();
  const s = $("speed-in"); speedBefore ??= s.value; s.value = 10; s.dispatchEvent(new Event("input"));
  show.values = show.weights = true; $("net").classList.remove("slow"); setView("impact"); setAuto(true);
  startDrive({ net: T.net, seed: roadSeed, rows: TEST_ROWS, onEnd: (r) => { testResult = r; results.flash = { ...r, net: T.net }; done(r); } });
  showNet(T.net, observe(drive.run));
};
// Leaving it for an earlier step: the speed set before.
let speedBefore = null;
window.selfDriveOff = () => {
  if (speedBefore == null) return;
  const s = $("speed-in"); s.value = speedBefore; speedBefore = null; s.dispatchEvent(new Event("input"));
};
// After the tour (or a method): a network drives on, for as long as you like (after a collision too), at speed 5: net,
// else the network switch's.
window.explore = (net = null) => {
  const s = $("speed-in"); speedBefore = null; s.value = 5; s.dispatchEvent(new Event("input"));
  net ??= window.modelNet();                         // the network switch's
  if (net === DEMO_NET) return window.demo();
  show.values = show.weights = true; $("net").classList.remove("slow"); setView("impact"); setAuto(true);
  if (drive?.net === net && drive.keepOn) return;     // already driving on
  startDrive({ net, keepOn: true }); showNet(net, observe(drive.run));
};
// For the onboarding (onboard.js): a 100 m drive by the user; done(result) when it ends.
window.tryIt = (done) => {
  startDrive({ seed: trySeed, rows: TRY_ROWS / 2, onEnd: (r) => { tryRun = r; trySeed = anySeed(); render(); ui(); done(r); } });
  ui();
};

// ---------------------------------------------------------------- Copycat and Atari (learner.js), for onboard.js
// Every method takes the same 500 m test as the flashcards (roadSeed). results: each method's last test, for the methods window,
// as long as it is still the network tested (not trained again since).
const results = {};
window.methodResults = () => Object.fromEntries(Object.entries(results).filter(([k, r]) => r.net === window.methodNet(k)));
// A network trained by a method (null: not yet): it drives on after the method's steps.
window.methodNet = (key) => (key === "flash" ? (T && trained() ? T.net : null) : key === "copy" ? (copy?.done ? copy.C.net : null)
  : key === "atari" ? (atari?.done ? atari.A.net : null) : null);
// The road standing still at its start.
function standAt(road) {
  stopDrive();
  Object.assign(view, { road, pos: 0, lane: road.startLane, crashed: false, crashAge: -1, dist: 0, noSign: false, tags: false });
  drawView();
}
const rowMs = () => (speed > 0 ? 1000 / (PACE * speed) : 1e9);   // one row's time at the speed set now
const backSweep = () => sweep(-1, Math.min(350, rowMs() * 0.4), false);   // a learning step: the colour runs output to inputs

// Copycat: you drive 200 m of road 5 (a slalom: a parked car every 20-30 m, in turns), the network learns every decision
// as you make it (your move is the answer; at a collision, the other move). copy: { C, n, moves, crashes, late, done }.
// Sims (dev): a driver who moves 30 m ahead teaches a network that passes every test road; 20 m ahead, 95%; at the last
// second (10 m), none: it learns to wait, a little too long.
const COPY_SEED = 5, COPY_ROWS = 20;
let copy = null;
window.copycat = {
  scene() {                                            // the road at its start; the network as it last learned (none yet: no weights, the switches left to onboard.js)
    standAt(startRoad(COPY_SEED)); window.netUi.outputs(1);
    if (copy?.done) { setView("weights"); setAuto(false); }
    showNet(copy?.done ? copy.C.net : null);
  },
  init() {                                             // random starting weights, for the drive to come
    copy = { C: createCopycat(anySeed()), n: 0, moves: 0, crashes: 0, late: 0, done: false };
    show.values = show.weights = true; showNet(copy.C.net);
  },
  drive(onStep, onEnd) {
    if (!copy || copy.done || copy.n) window.copycat.init();   // Drive again: new random weights
    show.values = show.weights = true; setView("weights"); setAuto(false);
    startDrive({ seed: COPY_SEED, rows: COPY_ROWS, watch: copy.C.net,
      learn: (x, a, r) => {
        imitate(copy.C, x, r.crashed ? 1 - a : a);
        copy.n++; copy.moves += a; copy.crashes += +r.crashed; copy.late += +(r.late && !r.crashed);
        backSweep(); onStep({ ...copy });
      },
      onEnd: () => { copy.done = true; onEnd({ ...copy }); } });
    showNet(copy.C.net, observe(drive.run));
  },
  state: () => copy && { ...copy },
};

// Atari: the car practises alone, 3 km (then 99.7% of test roads passed in dev sims; after 2 km, 98%), 1 km more on request. Weights view, the
// colour running back from the outputs after every decision. atari: { A, rows, crashes, random, segs (collisions per
// 200 m), done }.
const PRACTICE = 300, MORE = 100, SEG = 20;
let atari = null;
const atariState = () => atari && { rows: atari.rows, crashes: atari.crashes, segs: [...atari.segs], done: atari.done, eps: epsilon(atari.A),
  random: atari.random };
window.atari = {
  scene() {                                            // the road at its start; one output (Move!), no weights yet; after Back: its network
    standAt(startRoad(anySeed())); setView("weights"); setAuto(true); window.netUi.outputs(atari ? 2 : 1); showNet(atari?.A.net ?? null);
  },
  twoOutputs() { window.netUi.outputs(2); showNet(atari?.A.net ?? null); },
  init() {                                             // random starting weights
    atari = { A: createAtari(anySeed()), rows: 0, crashes: 0, random: 0, segs: [], done: false };
    show.values = show.weights = true; setView("weights"); stopDrive(); showNet(atari.A.net);
  },
  practise(onStep, onEnd) {                            // 3 km; again: 1 km more
    const A = atari.A, more = atari.done;
    atari.done = false;
    setView("weights"); setAuto(true);
    startDrive({ net: A.net, rows: more ? MORE : PRACTICE, keepOn: true, pause: 0.5,
      policy: (x) => { const m = atariMove(A, x); atari.random += m.explored; return m.action; },
      learn: (x, a, r, d) => {
        remember(A, x, a, r.reward, observe(d.run), r.crashed);
        const s = Math.floor(atari.rows++ / SEG); atari.segs[s] = (atari.segs[s] ?? 0) + +r.crashed; atari.crashes += +r.crashed;
        backSweep(); onStep(atariState());
      },
      onEnd: () => { atari.done = true; onEnd(atariState()); } });
    showNet(A.net, observe(drive.run));
  },
  trainNow() { atari = practiseOffline(anySeed()); },  // a test before any practice: the 3 km at once, off screen
  state: atariState,
};
// 3 km of practice at once, off screen, from a new network.
function practiseOffline(seed) {
  const s = { A: createAtari(seed), rows: 0, crashes: 0, random: 0, segs: [], done: true };
  const run = newRun(startRoad(seed), { maxRows: PRACTICE, continueOnCrash: true });
  while (!run.done) {
    const x = observe(run), { action } = atariMove(s.A, x), r = step(run, action);
    remember(s.A, x, action, r.reward, observe(run), r.crashed);
    const g = Math.floor(s.rows++ / SEG); s.segs[g] = (s.segs[g] ?? 0) + +r.crashed; s.crashes += +r.crashed;
    if (r.crashed) clearRows(run.road, run.pos, run.pos + 2);
  }
  return s;
}
// Copycat's 200 m, driven by a driver who moves 30 m ahead (when the other lane is farther): in dev sims, its network
// passes every test road.
function copyOffline(seed) {
  const C = createCopycat(seed), run = newRun(startRoad(COPY_SEED), { maxRows: COPY_ROWS, continueOnCrash: true });
  const dist = (v) => (v > 0.01 ? Math.round(AHEAD + 1 - v * AHEAD) : 99);   // rows to the car ahead
  while (!run.done) {
    const x = observe(run), a = +(dist(x[0]) <= 3 && dist(x[1]) > dist(x[0])), r = step(run, a);
    if (r.crashed) clearRows(run.road, run.pos, run.pos + 2);
    imitate(C, x, a);
  }
  return C.net;
}
// The network switch's networks: the one you trained by that method, else a pretrained one, made on first use (the
// flashcards': the demo's).
const PRE_SEED = 11, pre = {};
window.modelNet = (k = model) => window.methodNet(k) ?? (k === "flash" ? DEMO_NET
  : (pre[k] ??= k === "copy" ? copyOffline(PRE_SEED) : practiseOffline(PRE_SEED).A.net));

// A method's test: its network drives the 500 m test road, at top speed, Impact view, Autopilot on; done(result). Atari
// untrained (a jump): it practises off screen first. false: nothing to test (Copycat: you haven't driven yet).
window.methodTest = (key, done) => {
  if (key === "atari" && !atari?.done) window.atari.trainNow();
  const net = window.methodNet(key);
  if (!net) return false;
  const s = $("speed-in"); speedBefore ??= s.value; s.value = 10; s.dispatchEvent(new Event("input"));
  show.values = show.weights = true; $("net").classList.remove("slow"); setView("impact"); setAuto(true);
  startDrive({ net, seed: roadSeed, rows: TEST_ROWS, onEnd: (r) => { results[key] = { ...r, net }; done(r); } });
  showNet(net, observe(drive.run));
  return true;
};

function render(pop = -1) {
  $("tour-body").innerHTML = body();
  const on = (id, ev, fn) => { const e = $(id); if (e) e.addEventListener(ev, fn); };
  if (stepNo === 2) document.querySelectorAll(".parts li").forEach((li) => {
    li.addEventListener("mouseenter", () => { $("net").dataset.focus = li.dataset.focus; });
    li.addEventListener("mouseleave", () => { delete $("net").dataset.focus; });
  });
  on("try", "click", () => {
    tryRun = null;
    startDrive({ seed: trySeed, rows: TRY_ROWS, onEnd: (r) => { tryRun = r; trySeed = anySeed(); render(); ui(); } });
    render(); ui();
  });
  on("look", "click", () => { startDrive({ rows: TRY_ROWS, tags: true, onEnd: () => { render(); ui(); } }); render(); ui(); });
  on("rand", "click", randomize);
  on("watch", "click", () => {
    firstDrive = null; setShow("values", true);
    startDrive({ net: net0, rows: TRY_ROWS, tags: true, onEnd: (r) => { firstDrive = r; render(); ui(); } });
    render(); ui();
  });
  on("m-cards", "click", () => go(5));
  document.querySelectorAll(".ask button").forEach((b) => b.addEventListener("click", () => answer(Number(b.dataset.a))));
  on("deck", "click", (e) => {
    const b = e.target.closest("button.slot"); if (!b) return;
    current = Number(b.dataset.i); showSituation(cards[current]); render(); ui();
  });
  if (pop >= 0) document.querySelectorAll("#deck .slot")[pop].classList.add("pop");
  on("pause", "click", () => { if (playing) stopPlay = true; else play(); });
  on("pspd", "change", (e) => { playSpeed = Number(e.target.value); });
  on("go-test", "click", () => {
    testResult = null; setShow("values", true);
    startDrive({ net: T.net, seed: roadSeed, rows: TEST_ROWS, onEnd: (r) => { testResult = r.stopped ? null : r; render(); ui(); } });
    render(); ui();
  });
}

function randomize() {
  netSeed = anySeed();
  net0 = createNet(netSeed, { inputs: 2, hidden: 3, outputs: 1 });
  net0.W2.fill(0);                                  // the outputs start at 0: no opinion yet
  T = null; sub = 0; played = false; firstDrive = null; testResult = null;
  const x = showScene(SCENE.mine, SCENE.other, SCENE.lane, true);
  $("net").classList.add("slow");                   // the lines grow into their new weights
  setShow("weights", true); showNet(net0, x); render(); ui();
}

// The Next button: its label, whether it's enabled, and whether it pulses (by default: when enabled).
function nextState() {
  switch (stepNo) {
    case 1: return ["Meet the network ›", !driving(), !!tryRun];
    case 2: return ["Initialize it ›", !driving()];
    case 3: return ["Choose how it learns ›", !!net0 && !driving(), !!firstDrive];
    case 4: return ["Start with flashcards ›", true];
    case 5: return allAnswered() ? ["Train the network ›", true] : ["Next situation ›", cards[current].answer >= 0];
    case 6:
      if (playing) return ["Playing…", false];
      if (trained()) return ["The real test ›", true];
      if (T.epoch === 0 && sub === 0) return ["Start epoch 1 ›", true];
      if (sub === 1) return ["Next: backpropagation ›", !busy];
      if (sub === 2) return ["Next: update the weights ›", true];
      if (sub === 3) return ["Next: check ›", true];
      return [played ? "Resume ›" : `Play epochs 2–${EPOCHS} ›`, true];
    case 7: return ["Start over ›", !!testResult];
  }
}
function next() {
  if (stepNo === 5 && !allAnswered()) { current = nextUnanswered(); showSituation(cards[current]); render(); ui(); return; }
  if (stepNo === 6) {
    if (trained()) return go(7);
    if (T.epoch === 0 || sub === 3) return stage();
    return play();
  }
  if (stepNo === 7) return startOver();
  go(stepNo + 1);
}
$("next").addEventListener("click", next);
$("back").addEventListener("click", () => go(stepNo - 1));
$("track").addEventListener("click", (e) => { const b = e.target.closest("button[data-step]"); if (b && !b.disabled) go(Number(b.dataset.step)); });

function ui() {
  $("track").querySelectorAll("button").forEach((b) => {
    const n = Number(b.dataset.step);
    b.classList.toggle("on", n === stepNo); b.classList.toggle("done", n < reached && n !== stepNo);
    b.disabled = !allowed(n) || playing || busy;
  });
  $("back").disabled = stepNo === 1 || playing || busy;
  const [label, ok, pulse = true] = nextState();
  $("next").textContent = label; $("next").disabled = !ok; $("next").classList.toggle("pulse", pulse);
  $("dash").hidden = roadCanvas.hidden;
  onTrain?.();                                       // the tour's training controls
}

// Enters a step: what the road and the network show.
function go(n) {
  stopPlay = true; busy = false;
  stepNo = n; reached = Math.max(reached, n);
  delete $("net").dataset.focus; $("net").classList.remove("slow");
  showFlow(null); showErr(false);
  board.hidden = n !== 6; roadCanvas.hidden = resetBtn.hidden = $("speed").hidden = n === 6;
  $("net").style.opacity = 1; $("net-empty").hidden = true; $("netbox").classList.remove("off");
  stopDrive();
  if (n === 1) showNet(net0, showScene(7, 3, 1));   // the start: our car in the right lane, cars 70 m (my lane) and 30 m (other lane) ahead
  if (n >= 2 && n <= 4) showNet(net0, showScene(SCENE.mine, SCENE.other, SCENE.lane, n <= 3));
  if (n === 5) showSituation(cards[current]);
  if (n === 6) {
    if (!T) { T = createTrainer(cards, { netSeed, roadSeed }); sub = 0; shown = 0; played = false; switched = false; }
    renderPiles(); showCards(T.history[shown].net); renderChart(); showNet(T.history[shown].net);
  }
  if (n === 7) {
    const road = makeRoad(roadSeed, { density: DENSITY.train });
    Object.assign(view, { road, pos: 0, lane: road.startLane, crashed: false, crashAge: -1, dist: 0, noSign: false, tags: false });
    drawView(); showNet(T.net);
  }
  render(); ui();
}

function startOver() {
  stopPlay = true; net0 = null; cards = makeDeck(anySeed()); current = 0; roadSeed = anySeed();
  T = null; sub = 0; pending = null; shown = 0; played = false; firstDrive = null; testResult = null; reached = 1;
  tryRun = null; trySeed = anySeed();
  showNet(null); go(1);
}

$("track").innerHTML = STEPS.map((s, i) => `<li><button data-step="${i + 1}" title="Step ${i + 1}: ${s}">${i + 1} ${s}</button></li>`).join("");
addEventListener("resize", drawView);
new ResizeObserver(drawView).observe(roadCanvas);
const placer = new ResizeObserver(() => { placeNet(); drawLink(); }); placer.observe($("net")); placer.observe(document.querySelector(".stage"));
setInterval(() => { if (!drive && !document.hidden) drawView(); }, 100);   // idle: the clouds keep drifting
go(1);
window.demo();                                       // the trained network drives from the first frame, its values shown
