import { shareBar } from "./share.js";
// First-visit intro and onboarding. Takes over the middle section (tabs, guide text and Back/Next hidden) until done.
// The explainer bubbles appear one by one under the intro, each with arrows to the parts it explains; older ones stay.
const css = document.createElement("style");
css.textContent = `
  .onboard #track, .onboard #tour-body, .onboard .tour-foot { display: none !important; }
  #ob { font: 15px/1.5 system-ui, sans-serif; padding: 4px 2px; }
  #ob ul { padding-left: 20px; margin: 8px 0; } #ob li { margin: 4px 0; }
  #ob button { font: inherit; padding: 6px 12px; cursor: pointer; margin-top: 8px; }
  .bubble { position: relative; background: #fff; color: #222; border: 2px solid #1fa463; border-radius: 8px; padding: 10px 12px;
            margin-top: 12px; animation: ob-in 0.2s ease-out; }
  .bubble p { margin: 0 0 6px; } .bubble p:last-child { margin: 0; }
  @keyframes ob-in { from { opacity: 0; transform: translateY(8px); } }
  .arr { position: absolute; top: 50%; height: 2px; background: #1fa463; }
  .arr::after { content: ""; position: absolute; top: -6px; border: 7px solid transparent; }
  .arr.left { right: calc(100% + 2px); } .arr.left::after { left: -12px; border-right-color: #1fa463; }
  .arr.right { left: calc(100% + 2px); } .arr.right::after { right: -12px; border-left-color: #1fa463; }`;
document.querySelector("link[href='desktop.css']").before(css);   // before desktop.css and mobile.css: their layouts win

const $ = (id) => document.getElementById(id);
const tour = document.querySelector(".tour"), ob = document.createElement("div");
ob.id = "ob";
tour.append(ob);
tour.classList.add("onboard");
const ROAD = document.querySelector(".stage"), NET = $("netbox");
const later = (s, fn) => setTimeout(fn, s * 1000);
let lit = [];

// Stretches every arrow to the edge of its part.
function reach() {
  for (const a of ob.querySelectorAll(".arr")) {
    const br = a.parentElement.getBoundingClientRect(), tr = a.target.getBoundingClientRect();
    a.style.width = Math.max(0, a.classList.contains("left") ? br.left - tr.right : tr.left - br.right) - 4 + "px";
  }
}
addEventListener("resize", reach);

// Adds a bubble under the others, with an arrow to each target (left or right of the middle section); lights them up.
function bubble(html, targets) {
  const b = document.createElement("div");
  b.className = "bubble";
  b.innerHTML = html;
  for (const t of targets) {
    const a = document.createElement("span");
    a.className = `arr ${t === ROAD ? "left" : "right"}`; a.target = t;
    b.append(a);
  }
  ob.append(b);
  lit.forEach((e) => e.classList.remove("ob-hi")); lit = targets; lit.forEach((e) => e.classList.add("ob-hi"));
  reach();
}


// A 100 m drive by the user; the result goes under the button.
function tryIt(b) {
  const btn = b.querySelector(".ob-try"), out = b.querySelector(".ob-out");
  btn.onclick = () => {
    btn.disabled = true; btn.textContent = "Driving…"; out.textContent = "";
    window.tryIt((r) => {
      btn.disabled = false; btn.textContent = "Try again";
      out.textContent = `${r.stopped ? "Stopped" : "Done"} at ${r.m} m. Collisions: ${r.crashes}.`;
    });
  };
}

// The onboarding bubble, in the sky above the road's horizon; fades in 0.5 s after load. Continue (bottom right) swaps
// in the next text; after the last one it closes.
const intro = document.createElement("div");
intro.id = "intro";
// Each step: its parts, shown 2 s apart, each pulsing the things on screen it talks about.
const STEPS = [
  [{ html: `<p>This is a simplistic driving simulator: the blue car needs to avoid collisions by changing its lane.</p>` }],
  [{ html: `<p>Collision sensors detect the traffic ahead, and feed the <span class="c-in">INPUT LAYER</span> of the neural network.</p>`, pulse: "#net .L.in", cap: "in" },
   { html: `<p>3 "thinking" neurons in the <span class="c-hid">HIDDEN LAYER</span> use the sensor information to influence the output.</p>`, pulse: "#net .L.hid", cap: "hid" },
   { html: `<p>The <span class="c-out">OUTPUT LAYER</span> neuron decides whether to change a lane or not, and activates the "Move!" button.</p>`, pulse: "#net .L.out, #link-line, #move", cap: "out" }],
];
// Each step: its bubbles (STEPS above), the forward button's label, what it does on entering (also on Back); own = the step's
// timeline shows its bubbles; ready: the step shows Back and forward itself; btn: the forward button's label (else Continue).
const T = {
  weights: `The <b>weights</b> set how strongly each signal passes between neurons; the color shows a positive or negative influence. The <b>bias</b> is a base value, added to the signals.`,
  training: `Training a neural network means adjusting these weights and biases until it "learns" to perform its task. It's done in cycles, until the errors are minimal.`,
  backprop: `Mathematically, the output is evaluated, and small corrections are passed back through the network, layer by layer, nudging weights and biases on the way.`,
  random: `The process starts by setting the weights at random. The network below will now be reset, to illustrate <span class="ob-down">↓</span>`,
  guesses: `Let's see how the untrained network performs. It was never taught to avoid obstacles, so it will inevitably crash the car.`,
  impact: `Each neuron's value in the neural network reflects the weighted impact of the neurons in earlier layers. The <b>impact</b> is visualized with the green (positive) and magenta (negative) lines.`,
  output: `The final output neuron's value ranges between 0-1. The network "decides" to change lanes when the output is larger than 0.5.`,
};
const STEP = [
  { enter: first, ready: true }, { enter: () => window.demo() },
  { parts: [{ html: `<p>${T.impact}</p>` }], enter: explain, own: true },   // one bubble; explain() adds the output line
  { parts: [{ html: `<p>${T.weights}</p>` }, { html: `<p>${T.training}</p>` }, { html: `<p>${T.backprop}</p>` }], enter: learning, own: true },
  { parts: [{ html: `<p>${T.random}</p>` }], enter: untrained, own: true },   // one bubble; untrained() adds the lines after
  { parts: [{ html: `<p>We need some data on which the network will train: for the size of our network, a set of 8 driving scenarios (cards) with labeled answers will do. We'll split the set into 4 training cards and 4 validation cards, to check it learned the rule, not just memorized the answers.</p>` }],
    enter: cardsStep, ready: true },   // Continue: here and in the cards window, once all are answered
  { parts: [{ html: `<div class="tr"></div>` }], enter: trainStep, ready: true },
  { parts: [{ html: `<p><b>The training is done!</b> Select a card to see what decision the trained neural network makes in that scenario.</p>` }],
    enter: tryCards, own: true },
  { parts: [{ html: `<p>Your trained network takes the wheel: 500 m of road it has never seen, at top speed.</p>` }],
    enter: selfDrive, own: true, noGo: true },          // its buttons: Retrain and Other models, with the result
];
STEP.forEach((s, i) => { s.parts ||= STEPS[i]; });
const CARDS = STEP.findIndex((s) => s.enter === cardsStep);   // the Training Data step: Retrain and the methods window start there
STEP.slice(0, 5).forEach((s) => { s.speed = 1; });    // the steps on the road: speed 1 (the test drive sets its own, 10)
// A step's timeline: [seconds, what happens]. Shown again by Back, all of it at once, with no pulses.
let instant = false;
const TEMPO = 0.5;                                    // every timeline runs at this speed (the times below are at 1)
const run = (me, list) => list.forEach(([t, fn]) => (instant ? fn() : later(t * TEMPO, () => alive(me) && fn())));
// A timeline as a list of what happens and the waits between, in seconds (real time, no TEMPO).
const PULSE = 1, TEXT = 0.5, SLIDE = 0.55, FADE = 0.5;   // step 2's pace: a pulse (0.75 s) and a short gap; a text, then its animation; the switch's slide; the network's fade
function steps(me, list, k = 1) {                     // k: every wait × k
  let t = 0;
  for (const x of list) if (typeof x === "number") t += x * k; else instant ? x() : later(t, () => alive(me) && x());
}
// Step 1: the first line, our car pulses; then the second line, the network's parts pulse; then Continue.
function first(me) {
  window.demo();
  run(me, [[1, () => instant || window.pulseCar()],     // the pulses, with short pauses around them
    [3, () => say(`<p class="ob-in">Below, a simple neural network, which we will train to make decisions and "drive" on its own.</p>`)],
    [4, () => pulse("#net g.L, #net text.L")],          // every neuron, caption and weight number grows in place
    [6, () => ready(me)]]);
}
// Step 3, in the Impact view (no switching), one bubble: the impact text and the impact lines highlighted; a pause, the
// output line and the output neuron, the arrow and Move! highlighted; a pause, Back and Continue.
// The trained network drives on. The list: what happens, and the waits between (seconds, real time).
const at = (m) => { window.netUi.knob(m); pulse("#view"); };   // the switch slides over (and pulses)
function explain(me) {
  window.demo();                                                        // the trained network again, after Back
  steps(me, [() => { reveal(0); pulse("#net .w.W1, #net .w.W2", "ob-hl"); },   // the impact text, every impact line with it
    PULSE, () => { say(`<p class="ob-in">${T.output}</p>`, 0); pulse(STEPS[1][2].pulse); },   // the output line, the output, the arrow and Move!
    PULSE, () => ready(me)]);
}
// Weights and biases, in the Weights view, the trained network driving on: the weights and biases, as the switch slides and
// the network turns over, then every line and bias highlighted; a pause, training, as backpropagation runs on the network
// (the error ring blinks, corrections flow from the output down); a pause, the maths, backpropagation running on; a pause,
// Back and Continue. It stops when the step is left.
function learning(me) {
  const N = window.netUi;
  window.demo();                                                        // the trained network again, after Back
  steps(me, [() => { reveal(0); at("weights"); N.view("weights"); },   // the switch slides as the network turns over
    FADE, () => { pulse("#net .w.W1, #net .w.W2", "ob-hl"); pulse("#net text.bl"); },   // every line and bias, once turned over
    PULSE, () => { reveal(1); N.backprop(true); },
    PULSE * 1.5, () => { reveal(2); N.backprop(true); },              // on, a new round
    PULSE * 1.5, () => ready(me)]);
}
// The untrained network, one bubble, in the Weights view: the random start, as every weight is stripped to grey dots (the
// trained car drives on), and right after, the untrained network drives (and stops at its crash) as its random weights spin until set; a pause, the
// line about its guesses, with a countdown to the crash. Once it has crashed (and stopped), after a short pause: Let's
// fix that, Back and Continue.
function untrained(me) {
  const N = window.netUi, SPIN = 1.5, STRIP = 0.9;                    // the slot machine (1.2 s) and a short gap; the strip (0.8 s)
  let crashed = false, said = false, fixed = false;
  const fix = () => {
    if (fixed) return; fixed = true;
    say(`<p class="ob-in">Let's fix that. <b>Ready to train your first neural network?</b></p>`); ready(me);
  };
  const countdown = () => {                                             // whole seconds, till the crash; blank while it can't come (you moved)
    const e = alive(me) && intro.querySelector(".ob-cd"), s = window.crashIn();
    if (!e) return;
    e.textContent = !(s > 0) || crashed ? "" : s === Infinity ? "Speed 0: the car is stopped" : `Crash in ${Math.ceil(s)} s`;
    if (!crashed) later(0.2, countdown);
  };
  const drive = () => window.untrained(() => { crashed = true; if (said) later(PULSE, () => alive(me) && fix()); });
  steps(me, [() => { reveal(0); if (N.mode() !== "weights") { at("weights"); N.view("weights"); } },   // a jump here: to Weights first; the car drives on
    FADE, () => instant || N.strip(),
    STRIP, () => { drive(); instant || N.spin(); },
    SPIN + TEXT, () => {
      say(`<p class="ob-in">${T.guesses} <span class="ob-cd"></span></p>`);
      said = true; if (crashed || instant) fix(); else countdown();     // Back: at once
    }]);
}
// The flashcards: the text over the road, then (a pause) their window over the network, the whole road ahead left clear.
// The dashboard and the arrow make way: the window grows up into the dashboard's place. Back and Continue once all 8 are
// answered.
const fc = document.createElement("div"), DASH = $("dash");
fc.className = "fc";
function cardsStep(me) {
  steps(me, [0.3, () => {                                              // a very short pause
    fc.style.top = DASH.getBoundingClientRect().top - NET.getBoundingClientRect().top + "px";
    DASH.hidden = true;                                                 // the arrow goes with it
    NET.append(fc); fc.classList.toggle("ob-in", !instant); window.flashcards(fc, { done: () => ready(me), go: () => show(flow.steps.indexOf(cur) + 1) });
  }]);
}
const closeCards = () => { fc.remove(); DASH.hidden = false; document.body.classList.remove("ob-train"); window.trainingOff(); };
// Training: first the process, in a tall bubble over the whole road, with OK (no controls, no Back). Then the board in the
// road's place, under the bubble (its stage and the controls); the network under it, in the Weights view. Back and
// Continue once trained. Back from the next step: straight to the controls.
const BOARD = $("board");
new ResizeObserver(() => { BOARD.style.top = intro.offsetTop + intro.offsetHeight + 6 + "px"; }).observe(intro);
const ABOUT = `<p><span class="kicker">Training</span> The network studies the 4 training cards in cycles (<b>epochs</b>). In each epoch:</p><ul>
  <li>It goes through the 4 training cards (<b>training set</b>), and its decision to stay or move is compared to the answer on the card.</li>
  <li>A correction signal is generated and pushed backwards through the network (<b>backpropagation</b>), strengthening the connections
  and biases that lead to the right answer, and weakening the ones that lead away from it.</li>
  <li>The adjusted network is tested on the 4 validation cards (<b>validation set</b>), and a new <b>validation loss</b> is calculated for
  the epoch (the initial loss, in epoch 0, comes from the random weights).</li></ul><p>From epoch 3 on, once all 4 validation cards are right, the training process stops when an epoch lowers the validation loss by less than 0.03. It runs 10 epochs at most.</p>`;
function trainStep(me) {
  document.body.classList.add("ob-train");
  const bar = intro.querySelector(".tr"), main = document.createElement("div");
  bar.append(main);
  window.training(main, () => ready(me), () => { window.tourReset(); show(CARDS); });   // Reset: back to the cards, all open
  if (instant) return;
  document.body.classList.add("ob-about");                              // the controls, the board and the nav wait for OK
  bar.insertAdjacentHTML("afterbegin", `<div class="tr-intro">${ABOUT}<button class="cta tr-ok">OK</button></div>`);
  later(0.3, () => bar.querySelector(".tr-ok")?.classList.add("on"));   // OK a brief moment after the bubble
  bar.querySelector(".tr-ok").onclick = () => { bar.querySelector(".tr-intro").remove(); document.body.classList.remove("ob-about"); };
}
// The trained network on the cards, board as in training: the text; a pause, the switch slides to Impact and, as the
// network fades over, the first training card is picked (as if clicked); once the fade is done, the line about the test, then
// Back and Continue.
function tryCards(me) {
  const N = window.netUi;
  document.body.classList.add("ob-train");
  window.tryCards();
  steps(me, [() => reveal(0),
    1, () => { at("impact"); N.view("impact"); window.pickCard(); },   // the switch slides as the network turns over
    FADE, () => { say(`<p class="ob-in">Ready to see if your trained model can <b>pass our 500 m safe driving test</b>?</p>`, 0); ready(me); }]);
}
// Self-drive: the text, then the trained network drives 500 m at top speed; its result, then Retrain (the cards, labelled
// afresh) and Other models (the methods window).
function selfDrive(me) {
  steps(me, [() => reveal(0), TEXT, () => window.selfDrive((r) => {
    if (!alive(me)) return;
    say(r.crashed ? `<p class="ob-in"><b>Collision at ${r.m} m.</b> There were flaws in the training process: a wrong answer on a card teaches it the wrong rule.</p>`
      : `<p class="ob-in"><b>✓ 500 m, no collision.</b> It changed lane ${r.moves} times, all on its own. That concludes our tour.</p>`, 0);
    if (!r.crashed) pulse("#safe");                                     // the dashboard's 500 m, highlighted
    const nav = intro.querySelector(".ob-nav");
    nav.innerHTML = `<button class="ob-back">Retrain</button><button class="cta ob-go ob-end">Other models</button>`;
    nav.querySelector(".ob-back").onclick = () => { window.tourReset(); show(CARDS); };
    nav.querySelector(".ob-go").onclick = otherModels;
    ready(me);
  })]);
}
const otherModels = () => { finish(); openMethods(null); };   // after a test: the methods window, all folded

// Enlarged, then back to normal size.
function pulse(sel, cls = "ob-pulse") {
  if (instant) return;
  document.querySelectorAll(sel).forEach((e) => {
    e.classList.remove(cls); e.getBoundingClientRect(); e.classList.add(cls);
    e.addEventListener("animationend", () => e.classList.remove(cls), { once: true });
  });
}
// 3… 2… 1… Go! over the road, above the car, a beat each; then fn. Gone if the step ends meanwhile. cue: a white arrow
// down to Move! blinks with each beat (Copycat: you drive next).
function countdown(me, fn, cue) {
  const el = document.createElement("div"), ar = cue && document.createElement("div");
  el.className = "ob-count"; ROAD.append(el);
  if (ar) {
    const m = $("move").getBoundingClientRect(), r = ROAD.getBoundingClientRect();
    ar.className = "ob-cue"; ar.innerHTML = `<svg viewBox="0 0 40 48" aria-hidden="true"><path d="M13 3h14v22h10L20 45 3 25h10z"/></svg>`;
    Object.assign(ar.style, { left: m.left + m.width / 2 - r.left + "px", top: m.top - r.top - 14 + "px" }); ROAD.append(ar);
  }
  ["3…", "2…", "1…", "Go!", null].forEach((t, i) => later(i * 0.8, () => {
    if (!alive(me) || t === null) { el.remove(); ar?.remove(); if (alive(me)) fn(); return; }
    for (const e of [el, ar]) if (e) { e.classList.remove("on"); e.getBoundingClientRect(); e.classList.add("on"); }
    el.textContent = t;
  }));
}
let gen = 0;                                          // bumped on every step shown; older timers then do nothing
const alive = (me) => me === gen;
const ready = (me) => alive(me) && intro.querySelector(".ob-nav").classList.add("on");
const say = (html, i = -1) => { [...intro.querySelectorAll(".ob-b")].at(i).insertAdjacentHTML("beforeend", html); };   // into bubble i (default: the last)
// Shows the current step's bubble i, pulsing what it talks about and colouring its layer's caption.
let cur = null;
function reveal(i) {
  const p = cur.parts[i];
  intro.querySelectorAll(".ob-b")[i].classList.add("on", "ob-in");
  p.at?.();                                            // what the bubble brings on screen (Atari: the 2nd output)
  if (p.pulse) pulse(p.pulse);
  if (p.cap) document.querySelector(`#net text.L.${p.cap}`).classList.add("ob-c");
}
const speedTo = (v) => { const sp = $("speed-in"); sp.value = v; sp.dispatchEvent(new Event("input")); };   // the road's speed slider

// ---------------------------------------------------------------- the other two ways to learn: one screen each, no steps
// One bubble: what the method is, what you do (drive, or let it practise), then its test, all in turn; ✕ closes.
const PANELS = {
  copy: {},                                           // Copycat: its own opening (copyPanel)
  atari: { at: () => window.atari.twoOutputs(), pulse: "#net .L.out" },   // Trial & Error: the 2nd output, Stay
};
const methodScreen = (key, enter) => ({ parts: [{ ...PANELS[key], html: `<div class="mt"></div><button class="mt-x" aria-label="Close" title="Close">✕</button>` }],
  enter, noGo: true, ready: true });
// A flow: its steps, their names on the step bar (marks: a bookmark's short name, kept when collapsed), the bar's last
// segment (it leaves the flow); model: its network on the network switch (late: the flow sets it itself); single: one
// screen, no step bar.
const FLOWS = {
  tour: { model: "flash", steps: STEP, names: ["Intro", "The network", "Impact", "Weights", "Initiation", "Training data",
                               "Learning", "Trained", "Test drive"], marks: { 0: "Intro", 5: "Train" }, leave: "Skip tour" },
  copy: { model: "copy", late: true, single: true, steps: [methodScreen("copy", copyPanel)], names: [], marks: {} },
  atari: { model: "atari", single: true, steps: [methodScreen("atari", atariPanel)], names: [], marks: {} },
};
let flow = FLOWS.tour;
const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;

// The box under the explainers: its text, then a row of buttons (wired by class); ✕ ends the method.
function actions(box, html, on) {
  box.insertAdjacentHTML("beforeend", `<p class="mt-row">${html}</p>`);
  for (const [cls, fn] of Object.entries(on)) box.querySelector(`.${cls}`)?.addEventListener("click", fn);
}
// A method's test result.
function verdict(key, r) {
  const late = key === "copy" && window.copycat.state()?.late;
  if (!r.crashed) pulse("#safe");                     // the dashboard's 500 m, highlighted
  return r.crashed ? `<b>Collision at ${r.m} m.</b> There were flaws in the training process: ${key === "atari" ? "it didn't practise enough to learn every situation."
      : late ? `you changed lane at the last second ${plural(late, "time")}, and it copied that timing too. Move earlier.`
      : "your drive never showed it this situation."}`
    : `<b>✓ 500 m, no collision.</b> It changed lane ${r.moves} times, all on its own. ${key === "atari"
      ? "Nobody ever showed it a right move: it learned from points and penalties alone." : "It learned to drive by copying you."}`;
}
// Copycat: 3… 2… 1… Go! and the drive starts; while you drive, what it has learned so far; then the summary, Drive again and
// Test drive; after the test, its result, Retrain and Other models.
function copyPanel(me) {
  const box = intro.querySelector(".mt"), C = window.copycat;
  intro.querySelector(".mt-x").onclick = () => finish();
  const stat = (c) => `<span>Decisions learned: <b>${c.n}</b> of 20 · lane changes: ${c.moves} · collisions: ${c.crashes}</span>`;
  const idle = (c, said) => {
    if (!c?.done) {
      box.innerHTML = `<p><b>Copycat:</b> you drive 200 m, the network copies every decision you make. Press <b>Move!</b> to change lane, about 30 m before the car ahead: a late driver teaches a late network.</p>`;
      return;
    }
    const tip = c.late ? `You changed lane at the last second ${plural(c.late, "time")}: it learns that timing too.`
      : c.crashes ? "Each collision is learned as its opposite move." : "Clean driving: a good example to copy.";
    box.innerHTML = `<p>${said ?? `<b>Done: ${c.n} decisions learned</b>, ${plural(c.moves, "lane change")}, ${plural(c.crashes, "collision")}. ${tip}`}</p>`;
    // after the test: Retrain (a new drive) or Other models
    actions(box, said ? `<button class="mt-go">Retrain</button><button class="cta mt-other">Other models</button>`
      : `<button class="mt-go">Drive again</button><button class="cta mt-test nudge">Test drive</button>`,
      { "mt-go": start, "mt-test": test, "mt-other": otherModels });
  };
  const start = () => { window.selfDriveOff(); box.querySelector(".mt-row")?.remove(); countdown(me, drive, true); };
  const drive = () => {
    speedTo(5);
    box.innerHTML = `<p class="mt-stat">${stat({ n: 0, moves: 0, crashes: 0 })}</p>`;
    C.drive((c) => { if (alive(me)) box.querySelector(".mt-stat").innerHTML = stat(c); }, (c) => { if (alive(me)) idle(c); });
    pulse("#move");
  };
  const test = () => {
    box.innerHTML = `<p>Test drive: your copycat network takes the wheel, 500 m of road it has never seen, at top speed.</p>`;
    window.methodTest("copy", (r) => { if (alive(me)) idle(C.state(), verdict("copy", r)); });
  };
  C.scene();
  const c = C.state(), N = window.netUi;
  if (c?.done) return idle(c);
  // The opening: the switches set all at once (Weights, Copycat, Autopilot off), growing and back together; random
  // weights spin into place; then the countdown, and the drive starts (Move! grows and back).
  idle(null);
  [[0.5, () => { N.knob("weights"); N.view("weights"); N.model("copy"); N.auto(false); pulse("#view, #model, #auto"); }],
   [1.5, () => { C.init(); N.spin(); }],
   [3.3, start]].forEach(([t, f]) => later(t, () => alive(me) && f()));
}
// Trial & Error: Train; random starting weights (they spin into place), then 3 km of practice: how far, its collisions
// per 200 m (a column each), and how many of its moves are still random; then the summary, 1 km more, Start over and Test
// drive; after the test, its result, Retrain and Other models.
function atariPanel(me) {
  const box = intro.querySelector(".mt"), km = (rows) => (rows / 100).toFixed(1);
  intro.querySelector(".mt-x").onclick = () => finish();
  const spark = (st) => {                               // collisions per 200 m: a column each, the ones to come as stubs
    const n = Math.max(15, st.segs.length), top = Math.max(4, ...st.segs);
    return `<svg class="mt-spark" viewBox="0 0 ${n * 11} 26" aria-label="Collisions per 200 m">${Array.from({ length: n }, (_, i) => {
      const v = st.segs[i], h = v == null ? 2 : Math.max(2, 24 * v / top);
      return `<rect x="${i * 11 + 1}" y="${26 - h}" width="9" height="${h}" rx="1" fill="${v == null ? "#cfcabd" : "#d33a2c"}"><title>${v == null ? "" : `${i * 200}–${i * 200 + 200} m: ${plural(v, "collision")}`}</title></rect>`;
    }).join("")}</svg>`;
  };
  const stat = (st) => `<span>Practised <b>${km(st.rows)} km</b> · collisions: ${st.crashes} · random moves: ${Math.round(st.eps * 100)}%</span>
    <span class="mt-cap">collisions per 200 m ${spark(st)}</span>`;
  const idle = (st, said) => {
    if (!st?.done) {
      box.innerHTML = `<p><b>Trial &amp; Error:</b> nobody shows it the right move; it practises 3 km alone, scored on every move. Its 2nd output, <b>Stay</b>, scores staying: the car takes the higher score.</p>`;
      return actions(box, `<button class="cta mt-go nudge">Train</button>`, { "mt-go": fresh });
    }
    const a = st.segs[0], b = st.segs.at(-1);
    box.innerHTML = `<p>${said ?? `<b>Practice complete: ${km(st.rows)} km.</b> Collisions per 200 m: ${a} at first, ${b} at the end${b ? ": the last ones come from random moves it still tries now and then" : ""}.`}</p>
      <p class="mt-stat">${stat(st)}</p>`;
    // after the test, as Copycat's: Retrain (from new random weights) or Other models
    actions(box, said ? `<button class="mt-new">Retrain</button><button class="cta mt-other">Other models</button>`
      : `<button class="mt-more">Practise 1 km more</button><button class="mt-new">Start over</button><button class="cta mt-test nudge">Test drive</button>`,
      { "mt-more": practise, "mt-new": fresh, "mt-test": test, "mt-other": otherModels });
  };
  const practise = () => {
    window.selfDriveOff(); speedTo(30);
    box.innerHTML = `<p class="mt-stat"></p>`;
    const live = (st) => { if (alive(me)) box.querySelector(".mt-stat").innerHTML = stat(st); };
    window.atari.practise(live, (st) => { if (alive(me)) idle(st); });
    live(window.atari.state());
  };
  const fresh = () => { window.atari.init(); practise(); };   // new random weights, quietly, and straight to practice
  const test = () => {
    box.innerHTML = `<p>Test drive: your Trial &amp; Error network takes the wheel, 500 m of road it has never seen, at top speed.</p>`;
    window.methodTest("atari", (r) => { if (alive(me)) idle(window.atari.state(), verdict("atari", r)); });
  };
  window.atari.scene(); window.speedMax(30);           // the slider: on to 30× while here
  const st = window.atari.state();
  if (st?.done) window.atari.twoOutputs();
  idle(st?.done ? st : null);
}

// After the tour: Train a model, top left: a button per method; each opens the methods window at its own section.
const trainBox = document.createElement("div");
trainBox.className = "ob-post";
trainBox.innerHTML = `<p class="ob-post-h">Train a model</p><div class="ob-post-row">${[["flash", "Flashcard Method"], ["copy", "Copycat Method"], ["atari", "Trial &amp; Error"]]
  .map(([k, t]) => `<button data-k="${k}">${t}</button>`).join("")}</div>`;
trainBox.querySelectorAll("button").forEach((b) => { b.onclick = () => openMethods(b.dataset.k); });
// Take the tour: top right, in Skip tour's place, while Train a model shows; it starts the tour over.
const again = document.createElement("button");
again.className = "ob-again"; again.textContent = "Take the tour";
again.onclick = () => startFlow("flash");
function startFlow(key, at = 0) {                     // at: the step to open with
  closeMethods(); trainBox.remove(); again.remove(); window.speedMax(10);
  if (key === "flash") { window.tourReset(); key = "tour"; }   // the Flashcard method: the guided tour, untrained, from step `at`
  flow = FLOWS[key]; if (!flow.late) window.netUi.model(flow.model);
  if (key === "tour" && at) flow = { ...flow, leave: "Close" };   // from the methods window: training, not the tour
  stepBar.hidden = !!flow.single; buildBar(); ROAD.append(intro); show(at);
}
const modelSwitch = (on) => {
  const p = document.getElementById("model");
  p.classList.toggle("ob-lock", !on); p.querySelectorAll("button").forEach((b) => { b.disabled = !on; });
};
// The end of a flow (skipped, closed, or its last Continue): nothing left half-animated; Train a model comes back, and the
// network switch's network drives on, at speed 5.
function finish() {
  const me = ++gen;
  document.querySelectorAll("#net .ob-c, .ob-pulse, .ob-hl").forEach((e) => e.classList.remove("ob-c", "ob-pulse", "ob-hl"));
  closeCards(); window.selfDriveOff(); window.netUi.backprop(false); document.body.classList.remove("ob-about"); intro.remove(); ROAD.append(trainBox, again); window.speedMax(10); modelSwitch(true);
  window.explore(); later(0.3, () => alive(me) && window.explore());   // again after any Weights / Impact fade still under way
}
// The network switch, clicked: whatever is on ends, and its network drives on.
window.onModel = () => (intro.isConnected ? finish() : window.explore());

// The methods window, the app's width: one section per method, folded; the one you picked open (one at a time). Each:
// its nickname and professional name, its teacher, how it learns, what you do here, where it is used, its catch, how it
// did on the test, and its start button.
const ICONS = {
  flash: `<rect x="4" y="7" width="13" height="17" rx="2"/><rect x="11" y="4" width="13" height="17" rx="2" fill="#fff"/>`,
  copy: `<circle cx="14" cy="14" r="10"/><circle cx="14" cy="14" r="2.5"/><path d="M4.5 12.5h7M16.5 12.5h7M14 16.5v7"/>`,
  atari: `<rect x="3" y="9" width="22" height="12" rx="6"/><path d="M8.5 13v4M6.5 15h4"/><circle cx="18" cy="13.5" r="1.2"/><circle cx="20.5" cy="16.5" r="1.2"/>`,
};
const METHODS = [
  { k: "flash", nick: "Flashcard", pro: "Supervised learning", teacher: "You label examples",
    how: "You give it examples with the right answers: here, 8 road situations, each with the move you choose. It studies them in cycles (epochs), and after each cycle corrects its weights a little, until its answers match yours.",
    here: "A guided tour: meet the network, label 8 situations, watch it train epoch by epoch, then its test. About 5 minutes.",
    uses: ["Spam filters, trained on emails people marked as spam", "Medical imaging: spotting disease on scans that doctors labelled", "Photo apps that recognise faces and objects"],
    catch: "It needs labelled data, and learns the labels as given: wrong answers teach wrong moves.", go: "Teach it with flashcards" },
  { k: "copy", nick: "Copycat", pro: "Imitation learning (behavioural cloning)", teacher: "You drive",
    how: "It watches someone do the task, and learns to do the same. Every 10 m, what its sensors see becomes a question, and your move its answer. It learns while you drive.",
    here: "Drive 200 m, changing lane with Move!; it learns from every decision. Then its test. About 2 minutes.",
    uses: ["NVIDIA's 2016 test car learned to steer by watching people drive", "Robots that learn a task from a person guiding their arm", "Racing games whose opponents learn to drive like you"],
    catch: "It copies your mistakes and habits too, and knows only the situations you showed it.", go: "Teach it by driving yourself" },
  { k: "atari", nick: "Trial &amp; Error", pro: "Reinforcement learning (Deep Q-learning)", teacher: "Points and penalties",
    how: "Nobody shows it the right move. It tries moves, at first many at random, and gets points or penalties. It remembers what happened, and learns which move scores best in each situation.",
    here: "Press Train, and watch it practise 3 km alone, as fast as you like. Then its test. About 1 minute.",
    uses: ["DeepMind's DQN (2015) learned 49 Atari games from the screen and the score alone", "AlphaGo Zero mastered Go by playing millions of games against itself", "Chatbots are fine-tuned with rewards from human feedback"],
    catch: "It needs a lot of practice, and a well-chosen reward: it does whatever earns points.", go: "Let it learn by trial &amp; error" },
];
const mw = document.createElement("div");
mw.className = "mw";
function openMethods(open) {
  const res = window.methodResults();
  const badge = (k) => { const r = res[k]; return r ? (r.crashed ? `<span class="mw-badge bad">Test: collision at ${r.m} m</span>` : `<span class="mw-badge ok">✓ Passed the 500 m test</span>`)
    : window.methodNet(k) ? `<span class="mw-badge">Trained</span>` : ""; };
  mw.innerHTML = `<div class="mw-in" role="dialog" aria-modal="true" aria-labelledby="mw-h">
    <div class="mw-head"><div><h2 id="mw-h">How should the network learn?</h2>
      <p>Three ways to teach the same network the same skill. Each ends with weights that make it drive; only the teacher differs.</p></div>
      <button class="mw-x" aria-label="Close">✕</button></div>
    ${METHODS.map((m) => `<section class="mw-m${m.k === open ? " open" : ""}${res[m.k] || window.methodNet(m.k) ? "" : " new"}">
      <button class="mw-top" aria-expanded="${m.k === open}"><svg class="mw-ic" viewBox="0 0 28 28" aria-hidden="true">${ICONS[m.k]}</svg>
        <span class="mw-t"><b>The ${m.nick} method</b><span class="mw-pro">${m.pro} · Teacher: ${m.teacher}</span></span>${badge(m.k)}<span class="mw-chev" aria-hidden="true"></span></button>
      <div class="mw-body"><div class="mw-fold"><div class="mw-cols">
        <div><p class="mw-k">How it learns</p><p>${m.how}</p><p class="mw-k">Here</p><p>${m.here}</p></div>
        <div><p class="mw-k">In the real world</p><ul>${m.uses.map((u) => `<li>${u}</li>`).join("")}</ul><p class="mw-k">The catch</p><p>${m.catch}</p></div></div>
        <button class="cta mw-go" data-k="${m.k}">${m.go}</button></div></div></section>`).join("")}<div class="mw-share"></div></div>`;
  shareBar(mw.querySelector(".mw-share"));                // under the methods
  mw.querySelector(".mw-x").onclick = closeMethods;
  mw.querySelectorAll(".mw-top").forEach((b) => {
    b.onclick = () => {                                // open this one (or fold it), fold the others
      const me = b.parentElement, on = !me.classList.contains("open");
      mw.querySelectorAll(".mw-m").forEach((s) => { s.classList.toggle("open", s === me && on); s.querySelector(".mw-top").setAttribute("aria-expanded", s === me && on); });
    };
  });
  // Flashcards here: straight to the tour's Training Data step, the cards to label
  mw.querySelectorAll(".mw-go").forEach((b) => { b.onclick = () => startFlow(b.dataset.k, b.dataset.k === "flash" ? CARDS : 0); });
  document.body.append(mw);
  mw.querySelector(".mw-x").focus({ preventScroll: true });   // Esc or Enter closes; no jump down the window on phones
}
function closeMethods() { mw.remove(); }
mw.addEventListener("click", (e) => { if (e.target === mw) closeMethods(); });   // a click beside the window
addEventListener("keydown", (e) => { if (e.key === "Escape" && mw.isConnected) closeMethods(); });

// The step bar over the bubbles: one tab per step, numbered; the step on show widens to its name, the bookmarks keep
// theirs (marks: the name collapsed; the tour's Train opens to Training Data); the flow's way out is its last segment.
// Built per flow, so within one the tabs slide as they widen. A jump skips the steps between: each step sets up what it
// needs on entering (the untrained network; past the cards, open cards answered; Atari's test, its practice).
const stepBar = document.createElement("div"), stepBody = document.createElement("div");
stepBar.className = "ob-top"; stepBody.className = "ob-body";
function buildBar() {
  const { names, marks } = flow;
  stepBar.innerHTML = `<nav class="ob-tabs">${names.map((name, i) => `<button class="ob-tab${marks[i] ? " ob-mark" : ""}" data-at="${i}" title="${name}"><b>${i + 1}</b><span class="nm">${name}</span>${marks[i] && marks[i] !== name ? `<span class="nm bk">${marks[i]}</span>` : ""}</button>`).join("")}<button class="ob-tab ob-skip">${flow.leave}</button></nav>`;
  stepBar.querySelectorAll(".ob-tab[data-at]").forEach((b) => { b.onclick = () => show(Number(b.dataset.at)); });
  stepBar.querySelector(".ob-skip").onclick = () => { if (flow.leave === "Skip tour") markSeen(); finish(true); };
}
// A visitor who skipped the tour, or reached its last step, gets the app without it on the next load (this browser only;
// with storage blocked, every load is a first visit). Take the tour still starts it.
const SEEN = "car-tour-seen";
const seen = () => { try { return localStorage.getItem(SEEN) === "1"; } catch { return false; } };
const markSeen = () => { try { localStorage.setItem(SEEN, "1"); } catch {} };
buildBar();
intro.append(stepBar, stepBody);
// One bubble per part, side by side; each shows on its turn (its place kept from the start). Under them: Back on the left
// (not on the first step), forward on the right, both shown once the bubbles are done. A part's layer name is coloured in the
// network's caption too, until the step is left. back: the step shown again as it ended, all at once.
function show(n, back = false) {
  if (n >= flow.steps.length) return finish();        // the last Continue: the flow is done
  const me = ++gen, s = flow.steps[n];
  if (flow.leave === "Skip tour" && n === flow.steps.length - 1) markSeen();   // the tour's last step: seen
  modelSwitch(false);                                // the network switch: greyed out, on the flow's method, till it ends
  window.netUi.backprop(false);                       // step 4's backpropagation: only on its step
  closeCards(); window.selfDriveOff();                // the flashcards window: only on its step; the speed: back as it was
  document.body.classList.remove("ob-about");         // the training intro: only on its step
  if (s.speed) speedTo(s.speed);
  document.querySelectorAll("#net .ob-c").forEach((e) => e.classList.remove("ob-c"));
  const rows = [1, 2].map((r) => s.parts.filter((p) => (p.row || 1) === r)).filter((r) => r.length);   // row 2: under the others
  stepBar.querySelectorAll(".ob-tab[data-at]").forEach((b, i) => b.classList.toggle("on", i === n));
  stepBody.innerHTML = rows.map((r) => `<div class="ob-row">${r.map((p) => `<div class="ob-b">${p.html}</div>`).join("")}</div>`).join("") +
    `<div class="ob-nav">${n ? `<button class="ob-back">Back</button>` : ""}${s.noGo ? "" : `<button class="cta ob-go${n === flow.steps.length - 1 ? " ob-end" : ""}">${s.btn || "Continue"}</button>`}</div>`;
  if (n) intro.querySelector(".ob-back").onclick = () => show(n - 1, true);
  intro.querySelector(".ob-go")?.addEventListener("click", () => show(n + 1));
  const net = document.getElementById("net");
  instant = back;
  cur = s;
  if (!s.own) run(me, [...s.parts.map((p, i) => [i * 2, () => reveal(i)]),   // own: the step's timeline shows its bubbles
    ...(s.ready ? [] : [[s.parts.length * 2, () => ready(me)]])]);   // after the last pulse, and a short pause
  s.enter?.(me);
  instant = false;
  if (back) {                                          // the lines jump to their weights, the text shows without fading in
    net.classList.add("quick");
    intro.querySelectorAll(".ob-in").forEach((e) => e.classList.remove("ob-in"));
    requestAnimationFrame(() => requestAnimationFrame(() => net.classList.remove("quick")));
  }
}
css.textContent += `
  #intro { position: absolute; z-index: 3; top: 0.6rem; left: 0.8rem; right: 0.8rem; display: flex; flex-direction: column; gap: 0.4rem;
           font: 0.85rem/1.4 system-ui, sans-serif; color: #1c2430; opacity: 0; transition: opacity 0.5s ease-out; }
  #intro.on { opacity: 1; }
  #intro .ob-row { display: flex; gap: 0.45rem; }
  #intro .ob-nav { display: flex; }
  #intro .ob-body { display: contents; }
  /* the step bar: one continuous strip of grey tabs, 2px apart; the step on show white and wide */
  #intro .ob-tabs { display: flex; gap: 2px; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.12); }
  #intro .ob-tab { flex: 0 0 auto; min-width: 1.8rem; height: 1.6rem; padding: 0 0.55rem; border: 0; border-radius: 0; margin: 0;
           font: 0.78rem/1 system-ui, sans-serif; color: #1c2430; background: rgba(228, 224, 212, 0.9); cursor: pointer; white-space: nowrap;
           transition: flex-grow 0.4s ease-in-out, background 0.4s; }
  #intro .ob-tab:hover { background: rgba(239, 236, 227, 0.9); }
  #intro .ob-tab b { font-weight: 600; }
  #intro .ob-tab .nm { display: inline-block; vertical-align: bottom; overflow: hidden; max-width: 0; opacity: 0; transition: max-width 0.4s ease-in-out, opacity 0.4s; }
  #intro .ob-tab.on .nm:not(.bk), #intro .ob-tab.ob-mark:not(.on) .nm:last-child { max-width: 16em; opacity: 1; margin-left: 0.35em; }   /* open: the full name; a bookmark collapsed: its short one */
  #intro .ob-tab.on { flex-grow: 1; background: rgba(255, 255, 255, 0.9); text-align: left; font-weight: 600; cursor: default; }   /* the step on show */
  #intro .ob-skip { margin-left: 4px; color: #5b6472; }   /* the strip's end: leaves the tour */
  /* after the tour: Train a model, top left, as a bubble */
  .ob-post { position: absolute; z-index: 3; top: 0.6rem; left: 0.8rem; padding: 0.45rem 0.75rem 0.6rem; font: 0.85rem/1.4 system-ui, sans-serif; color: #1c2430;
             background: rgba(255, 255, 255, 0.9); border: 2px solid #1fa463; border-radius: 10px; box-shadow: 0 4px 14px rgba(0,0,0,0.18); animation: ob-in 0.2s ease-out; }
  .ob-post-h { margin: 0 0 0.4rem; font-size: 0.95rem; font-weight: 700; }
  .ob-post-row { display: flex; gap: 0.4rem; }
  .ob-post button { font: inherit; padding: 3px 10px; border: 1.5px solid #1fa463; border-radius: 8px; background: #fff; color: #1c2430; cursor: pointer; }
  .ob-post button:hover { background: #eef8f2; }
  /* Take the tour: Skip tour's place and shape, the way forward's green */
  .ob-again { position: absolute; z-index: 3; top: 0.6rem; right: 0.8rem; height: 1.6rem; padding: 0 0.55rem; border: 0; border-radius: 8px;
              font: 600 0.78rem/1 system-ui, sans-serif; color: #fff; background: rgba(31, 164, 99, 0.9); cursor: pointer; white-space: nowrap;
              box-shadow: 0 0 0 2px #fff, 0 1px 4px rgba(0, 0, 0, 0.25); }   /* the white ring, as Continue's */
  .ob-again:hover { background: rgba(23, 140, 84, 0.9); }
  /* the methods' steps: a button row, the live numbers, the Atari collisions chart */
  #intro .mt p { margin: 0 0 0.35rem; } #intro .mt p:last-child { margin: 0; }
  #intro .mt-row { display: flex; gap: 0.5rem; margin-top: 0.35rem !important; margin-right: calc(0.4rem - 0.75rem - 1.6rem) !important; }   /* the right edge in line with ✕'s (0.4rem in; the bubble pads 0.75rem, the box 1.6rem) */
  #intro .mt-row button { border: 1.5px solid #1fa463; border-radius: 8px; background: rgba(255, 255, 255, 0.9); color: #1c2430; }
  #intro .mt-row button:hover { background: rgba(238, 248, 242, 0.9); }
  #intro .mt-row button.cta { margin-left: auto; background: rgba(31, 164, 99, 0.9); color: #fff; font-weight: 600; }   /* the main action: on the right */
  #intro .mt-row button.cta:hover { background: rgba(23, 140, 84, 0.9); }
  #intro .mt-row button.nudge { animation: tr-hint 1.8s ease-in-out infinite; }
  #intro .mt-stat { display: flex; align-items: center; gap: 1.2rem; flex-wrap: wrap; color: #4a5361; font-variant-numeric: tabular-nums; }
  #intro .mt-cap { display: inline-flex; align-items: center; gap: 0.5rem; font-size: 0.78rem; color: #6f6b61; }
  #intro .mt-spark { width: 9rem; height: 1.5rem; }
  #intro .ob-b { position: relative; } #intro .mt { padding-right: 1.6rem; }   /* room for ✕ */
  #intro .mt-x { position: absolute; top: 0.35rem; right: 0.4rem; width: 1.5rem; height: 1.5rem; padding: 0; border: 1.5px solid #d6d1c3; border-radius: 50%;
                 background: #fff; color: #1c2430; font: 600 0.75rem/1 system-ui, sans-serif; cursor: pointer; }
  #intro .mt-x:hover { border-color: #1fa463; background: #eef8f2; }
  /* the methods window: the app's width, a folding section per method */
  .mw { position: fixed; inset: 0; z-index: 50; background: rgba(22, 26, 34, 0.45); font: 0.9rem/1.4 system-ui, sans-serif; color: #1c2430;
        animation: mw-in 0.25s ease-out; }
  @keyframes mw-in { from { opacity: 0; } }
  .mw-in { position: absolute; left: 50%; top: max(0.5rem, 2vh); transform: translateX(-50%); width: min(44.75rem, calc(100% - 2rem)); max-height: calc(100% - 2 * max(0.5rem, 2vh));   /* high up, compact: no scrolling */
           display: flex; flex-direction: column; gap: 0.45rem; overflow: auto;
           box-sizing: border-box; padding: 0.8rem 1.2rem 0.9rem; background: #fff; border: 2px solid #1fa463; border-radius: 14px;
           box-shadow: 0 10px 40px rgba(0,0,0,0.3); }
  .mw-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 1rem; margin-bottom: 0.2rem; }
  .mw-head h2 { margin: 0 0 0.1rem; font-size: 1.25rem; letter-spacing: -0.01em; }
  .mw-head p { margin: 0; color: #4a5361; }
  .mw-x { flex: none; width: 2rem; height: 2rem; padding: 0; border: 1.5px solid #d6d1c3; border-radius: 50%; background: #fff; color: #1c2430;
          font: 600 1rem/1 system-ui, sans-serif; cursor: pointer; }
  .mw-x:hover { border-color: #1fa463; background: #eef8f2; }
  .mw-m { border: 1.5px solid #e6e2d6; border-radius: 12px; background: #fbfaf6; }
  .mw-m.open, .mw-m.new { border-color: #1fa463; }   /* a method not tried yet: green, waiting */
  .mw-top { display: flex; align-items: center; gap: 0.75rem; width: 100%; padding: 0.4rem 0.9rem; border: 0; background: none; font: inherit; color: inherit;
            text-align: left; cursor: pointer; border-radius: 12px; }
  .mw-top:hover { background: #f3f1ea; }
  .mw-t { flex: 1; display: flex; flex-direction: column; }
  .mw-t b { font-size: 1.02rem; line-height: 1.25; }
  .mw-ic { flex: none; width: 1.6rem; height: 1.6rem; fill: none; stroke: #1c2430; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
  .mw-pro { color: #6f6b61; font-size: 0.8rem; }
  .mw-badge { flex: none; padding: 0.1rem 0.5rem; border-radius: 6px; background: #e4e0d4; font-size: 0.72rem; font-weight: 700; white-space: nowrap; }
  .mw-badge.ok { background: #f2c230; color: #3d2c00; }   /* passed: gold, not the way-forward green */ .mw-badge.bad { background: #fde3df; color: #b0302a; }
  .mw-chev { flex: none; width: 0.55rem; height: 0.55rem; margin: 0 0.3rem 0.25rem; border: solid #6f6b61; border-width: 0 2px 2px 0; transform: rotate(45deg); transition: transform 0.3s; }
  .mw-m.open .mw-chev { transform: rotate(-135deg); margin-bottom: -0.25rem; }   /* down when folded, up when open */
  .mw-body { display: grid; grid-template-rows: 0fr; transition: grid-template-rows 0.3s ease; }   /* folds to nothing, smoothly */
  .mw-m.open .mw-body { grid-template-rows: 1fr; }
  .mw-fold { min-height: 0; overflow: hidden; display: flex; flex-direction: column; gap: 0.4rem; padding: 0 0.9rem; }
  .mw-m.open .mw-fold { padding-bottom: 0.7rem; }
  .mw-share { margin-top: 0.35rem; padding-top: 0.6rem; border-top: 1px solid #e6e2d6; }
  .mw-cols { display: grid; grid-template-columns: 1fr 1fr; gap: 1.2rem; }
  .mw-cols p, .mw-cols ul { margin: 0 0 0.4rem; } .mw-cols > div > :last-child { margin-bottom: 0; }
  .mw-cols ul { padding-left: 1.1rem; } .mw-cols li { margin: 0.05rem 0; }
  .mw-k { font-size: 0.7rem; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: #6f6b61; margin-bottom: 0.05rem !important; }
  .mw-go { align-self: flex-end; padding: 0.4rem 1.3rem; border: 0; border-radius: 8px; font: 600 0.95rem system-ui, sans-serif; cursor: pointer; }
  #intro .ob-go { margin-left: auto; } #intro .ob-nav { visibility: hidden; } #intro .ob-nav.on { visibility: visible; }
  #intro .ob-nav button { background: rgba(255, 255, 255, 0.9); border: 1.5px solid #1fa463; border-radius: 8px; color: #1c2430; }   /* the bubbles' white */
  #intro .ob-nav button:hover { background: rgba(238, 248, 242, 0.9); }
  #intro .ob-nav button.cta { background: rgba(31, 164, 99, 0.9); border-color: #1a8f56; color: #fff; font-weight: 600;
                              box-shadow: 0 0 0 2px #fff, 0 1px 4px rgba(0, 0, 0, 0.25); }   /* a white ring: clear of the grass */ #intro .ob-nav button.cta:hover { background: rgba(23, 140, 84, 0.9); }   /* the way forward: green, on every screen */
  #intro p.gap { margin: 0; height: 1em; }
  #intro .ob-cd { font-weight: 700; color: #d33a2c; font-variant-numeric: tabular-nums; white-space: nowrap; }   /* the countdown to the crash */
  /* the flashcards: a bubble-style window over the network */
  /* two columns: left, the situation (‹ kicker ›, the question, what the car sees, the answers, their feedback); right,
     the set (the 8 cards, 4 x 2), Auto-complete, then Continue, in its bottom-right corner */
  .fc { position: absolute; z-index: 6; inset: 0.4rem; overflow: hidden; box-sizing: border-box; padding: 0.9rem 1.3rem;
        display: grid; grid-template-columns: minmax(0, 1.15fr) minmax(0, 1fr);
        font: 0.85rem/1.4 system-ui, sans-serif; color: #1c2430; background: #fff; border: 2px solid #1fa463; border-radius: 10px;
        box-shadow: 0 4px 14px rgba(0,0,0,0.18); }
  .fc > div { display: flex; flex-direction: column; gap: 0.6rem; min-height: 0; }
  .fc-q { padding-right: 1.4rem; } .fc-set { padding-left: 1.4rem; border-left: 1px solid #e6e2d6; }
  .fc p { margin: 0; }
  .fc-head { display: flex; align-items: center; gap: 0.5rem; min-height: 1.7rem; }
  .fc .kicker { font-size: 0.75em; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: var(--muted); }
  .fc-head button { width: 1.7rem; height: 1.7rem; padding: 0; border: 1.5px solid #d6d1c3; border-radius: 50%; background: #fff; color: #1c2430;
                    font: 600 1.05rem/1 system-ui, sans-serif; cursor: pointer; }
  .fc-head button:hover:not(:disabled) { border-color: #1fa463; background: #eef8f2; } .fc-head button:disabled { opacity: 0.3; cursor: default; }
  .fc-head button.go { border-color: #1fa463; background: #1fa463; color: #fff; } .fc-head button.go:hover { background: #1a8f56; }   /* ›, the way forward (app.js) */
  .fc-deck .slot.go { border: 1.5px solid #1fa463; background: #1fa463; } .fc-deck .slot.go .n { color: #fff; }   /* on the last card: the next open one */
  .fc h3 { margin: 0; font-size: 1.35em; line-height: 1.25; }
  .fc .sees { margin: 0; font-size: 1em; }
  .fc .ask { margin: 0.15rem 0 0; max-width: 22rem; } .fc .ask button { font-size: 1em; padding: 0.45rem 0.6rem; }
  .fc .hint { margin: 0; padding: 0.45rem 0.7rem; font-size: 0.9em; line-height: 1.4; } .fc .good { margin: 0; }
  .fc-count { margin-left: auto; color: var(--muted); font-size: 0.85em; font-variant-numeric: tabular-nums; }
  .fc-deck { display: grid; grid-template-columns: repeat(4, 3rem); gap: 1rem 0.8rem; justify-content: start; padding-bottom: 0.5rem; }
  .fc-deck .slot { cursor: pointer; }
  .fc-foot { margin-top: auto; display: flex; justify-content: flex-end; align-items: center; }
  .fc-foot .fc-go { font: inherit; font-weight: 600; padding: 4px 16px; background: #1fa463; border: 1.5px solid #1fa463; border-radius: 8px; color: #fff; cursor: pointer; }   /* the way forward, green */
  .fc-foot .fc-go:hover { background: #1a8f56; }
  .fc-foot .fc-auto { font: inherit; font-size: 0.9em; padding: 0; border: 0; background: none; color: #1c2430; opacity: 0.6; cursor: pointer; }   /* as Skip tour */
  .fc-foot .fc-auto:hover { opacity: 1; text-decoration: underline; background: none; }
  /* training: the stage's text and the controls in the bubble; the board under it, the two piles side by side, the
     validation loss across the bottom */
  #intro .tr .kicker { margin-right: 0.4rem; font-size: 0.75em; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: var(--muted); }
  #intro .tr-text { min-height: 2.8em; }   /* always room for two lines: the bubble keeps its height from stage to stage */
  /* the training intro: over the whole road, OK at the bottom right; the controls, the board, Back and the epoch slider wait for it */
  .ob-about #board, .ob-about #intro .ob-nav { visibility: hidden !important; } .ob-about #intro .tr > :not(.tr-intro) { display: none; }
  #intro .tr-intro { display: flex; flex-direction: column; } #intro .tr-intro p, #intro .tr-intro ul { margin: 0 0 0.45rem; }
  #intro .tr-intro ul { padding-left: 1.3rem; } #intro .tr-intro li { margin-bottom: 0.2rem; }
  #intro .tr-intro .tr-ok { align-self: flex-end; padding: 3px 22px; border-radius: 8px; visibility: hidden; opacity: 0; transition: opacity 0.4s; }
  #intro .tr-intro .tr-ok.on { visibility: visible; opacity: 1; }
  #intro .tr-pi { display: inline-flex; vertical-align: -0.15em; color: #1c2430; }   /* Play, in the text: a plain black sign, not a button to press */
  #intro .ob-down { display: inline-block; font-size: 1.2em; line-height: 1; font-weight: 700; animation: ob-down 1.6s ease-in-out infinite; }   /* points down to the network */
  @keyframes ob-down { 50% { transform: translateY(0.25em); } }
  @media (prefers-reduced-motion: reduce) { #intro .ob-down { animation: none; } }
  #intro .tr-ctl { display: flex; align-items: center; gap: 0.4rem; margin-top: 0.35rem; }
  #intro .tr-ctl button { width: 2.2rem; background: rgba(255, 255, 255, 0.9); border: 1.5px solid #1fa463; border-radius: 8px; color: #1c2430; padding: 2px 0; display: inline-flex; align-items: center; justify-content: center; height: 1.55rem; }
  #intro .tr-ctl button:hover:not(:disabled) { background: rgba(238, 248, 242, 0.9); } #intro .tr-ctl button:disabled { opacity: 0.45; cursor: default; }
  #intro .tr-ctl .go { background: rgba(31, 164, 99, 0.9); color: #fff; } #intro .tr-ctl .go:hover:not(:disabled) { background: rgba(23, 140, 84, 0.9); }   /* the one to press: Play, then To the end (app.js) */
  #intro .tr-ctl .tr-play.nudge { animation: tr-hint 1.8s ease-in-out infinite; }   /* until training first starts: a soft glow, no growing (it would overlap its neighbours) */
  @keyframes tr-hint { 50% { box-shadow: 0 0 0 3px rgba(31, 164, 99, 0.3); } }
  #intro .tr-ctl label { display: flex; align-items: center; gap: 0.4rem; color: var(--muted); white-space: nowrap; }
  #intro .tr-spd { margin-left: auto; } #intro .tr-spd.off { opacity: 0.4; }
  /* drawn by hand: the switches' light blue on a white bubble (an accent colour this light gets a near-black track) */
  #intro .tr-spd input { width: 6rem; appearance: none; height: 4px; border-radius: 2px; background: #d6d1c3; }
  #intro .tr-spd input::-webkit-slider-thumb { appearance: none; width: 14px; height: 14px; border-radius: 50%; background: #1fa463; border: 1.5px solid #1a8f56; }
  #intro .tr-spd input::-moz-range-thumb { width: 14px; height: 14px; border-radius: 50%; background: #1fa463; border: 1.5px solid #1a8f56; }
  /* the epoch slider, once trained: between Back and Continue, quiet (small, grey) */
  #intro .tr-ep { flex: 0.85 1 0; display: flex; align-items: center; gap: 0.4rem; margin: 0 1rem; font-size: 0.8rem; color: var(--muted); white-space: nowrap; }
  #intro .tr-ep[hidden] { display: none; }
  #intro .tr-ep input { flex: 1; min-width: 4rem; accent-color: #9a968a; opacity: 0.8; }
  #intro .tr-ep output { min-width: 10.5em; font-variant-numeric: tabular-nums; }   /* room for " · best": the slider never jumps */
  /* the validation loss row always whole; the cards take what's left, their pictures shrinking to fit */
  .ob-train #board { bottom: 0; display: grid; grid-template-columns: 1fr 1fr; grid-template-rows: auto minmax(0, 1fr) auto;
                     column-gap: 1.6rem; row-gap: 0.3rem; padding: 0.2rem 1.2rem 0.5rem; overflow: hidden; }
  .ob-train #board > :nth-child(1) { grid-area: 1 / 1; } .ob-train #board > :nth-child(2) { grid-area: 2 / 1; }
  .ob-train #board > :nth-child(3) { grid-area: 1 / 2; } .ob-train #board > :nth-child(4) { grid-area: 2 / 2; }
  .ob-train #board > .epochs { grid-area: 3 / 1 / 4 / 3; margin-top: 0.2rem; }
  .ob-train .pile { min-height: 0; grid-template-rows: minmax(0, 1fr); }
  .ob-train .card { display: flex; flex-direction: column; min-height: 0; }
  .ob-train .cardsvg { flex: 0 1 auto; min-height: 0; max-height: 4.8rem; } .fc-deck .slot .badge { font-size: 0.8rem; }
  /* Reset: in the middle of the controls' row; its confirmation over the bubble's content */
  #intro .tr { position: relative; } #intro .tr-ctl { position: relative; }
  #intro .tr-ctl .tr-reset { position: absolute; left: 50%; transform: translateX(-50%); width: auto; padding: 2px 12px; }
  #intro .tr-ctl .tr-reset { display: none; }   /* off for now */
  #intro .tr-confirm { position: absolute; inset: -0.2rem; z-index: 2; display: flex; align-items: center; justify-content: center; gap: 0.6rem;
                       background: rgba(255, 255, 255, 0.97); border-radius: 8px; font-weight: 600; }
  #intro .tr-confirm button { border: 1.5px solid #1fa463; border-radius: 8px; background: #fff; color: #1c2430; }
  #intro .tr-confirm button.cta { background: #1fa463; color: #fff; }
  #intro .ob-b { flex: 1 1 0; display: flex; flex-direction: column; box-sizing: border-box; padding: 0.45rem 0.75rem; visibility: hidden;
                 background: rgba(255, 255, 255, 0.9); border: 2px solid #1fa463; border-radius: 10px; box-shadow: 0 4px 14px rgba(0,0,0,0.18); }
  #intro .ob-b.on { visibility: visible; }
  #intro .ob-b { min-height: calc(2.8em + 0.9rem + 8px); }   /* room for two lines from the start: no growing as they appear */
  #intro p { margin: 0 0 4px; } #intro ul { margin: 0 0 4px; padding-left: 20px; }
  #intro button { font: inherit; padding: 3px 10px; cursor: pointer; }
  #intro .ob-foot { text-align: right; margin-top: auto; }
  #intro .ob-in { animation: ob-in 0.2s ease-out; }
  .c-in { color: #2a6fd6; } .c-hid { color: #e07b00; } .c-out { color: #d33a2c; }   /* the layers' colours, in the bubbles */
  #net text.L.in.ob-c { fill: #2a6fd6; } #net text.L.hid.ob-c { fill: #e07b00; } #net text.L.out.ob-c { fill: #d33a2c; }
  @keyframes ob-pulse { 50% { transform: scale(1.25); } }
  @keyframes ob-line { 50% { stroke-width: 6px; } }
  #net .ob-pulse { transform-box: fill-box; transform-origin: center; animation: ob-pulse 0.75s ease-in-out; }
  #move.ob-pulse, #view.ob-pulse, #model.ob-pulse, #auto.ob-pulse { animation: ob-pulse 0.75s ease-in-out; }
  #model.ob-lock { opacity: 0.6; filter: grayscale(1); }   /* during a tour or training: shows the method, not clickable */
  #model.ob-lock::before { background: #d6d1c3; }   /* its choice in grey, not the active switches' blue */
  #model.ob-lock button { opacity: 1; cursor: default; }   /* not site.css's disabled fade on top */
  #safe.ob-pulse { animation: ob-pulse 0.75s ease-in-out; }
  .ob-count { position: absolute; z-index: 3; left: 50%; top: 55%; transform: translate(-50%, -50%); pointer-events: none;   /* the road's middle, above the car */
              font: 800 4rem system-ui, sans-serif; color: #fff; text-shadow: 0 3px 0 #1c4590, 0 6px 16px rgba(0, 0, 0, 0.45); }
  .ob-count.on { animation: ob-count 0.8s ease-out; }
  @keyframes ob-count { from { transform: translate(-50%, -50%) scale(1.6); opacity: 0; } 25% { transform: translate(-50%, -50%) scale(1); opacity: 1; } }   /* the test passed: Safely driven grows a little and back */
  .ob-cue { position: absolute; z-index: 3; transform: translate(-50%, -100%); opacity: 0; pointer-events: none; }   /* Copycat's countdown: the arrow down to Move!, white as the count */
  .ob-cue svg { display: block; width: 2.6rem; fill: #1fa463; stroke: #fff; stroke-width: 2.5; stroke-linejoin: round; paint-order: stroke;
                filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.3)); }   /* the way forward's green, with the white ring */
  .ob-cue.on { animation: ob-cue 0.8s ease-out; }
  @keyframes ob-cue { 0% { opacity: 0; transform: translate(-50%, -125%); } 25%, 75% { opacity: 1; transform: translate(-50%, -100%); } 100% { opacity: 0; transform: translate(-50%, -100%); } }   /* in with each number, as it lands (ob-count: 25%); out just before the next */
  @keyframes ob-hl { 50% { stroke-width: calc(var(--sw) * 2.2); opacity: 1; } }
  #net .w.ob-hl { animation: ob-hl 0.75s ease-in-out; }   /* a line, thicker and back */
  #link-line.ob-pulse { animation: ob-line 0.75s ease-in-out; }`;
if (seen()) { intro.classList.add("on"); finish(); }   // as if Skip tour was clicked at once
else { ROAD.append(intro); modelSwitch(false); later(0.5, () => { intro.classList.add("on"); show(0); }); }
const explainer = () => {   // the explainer bubbles, not shown for now

later(2, () => {
  bubble(`<p>This is our super-simple driving simulator. The blue car goes faster than the traffic, and needs to avoid
    collisions by changing its lane.</p>`, [ROAD]);
  later(2, () => {
    bubble(`<p>This is our simple neural network (NN). It has:</p>
      <ul>
        <li>2 input neurons, connected to the car's distance sensors: one for each lane.</li>
        <li>3 "thinking" neurons in the middle layer (the "hidden" layer in ML jargon).</li>
        <li>1 output neuron: the network's decision to change lanes or not, connected to the Move! control.</li>
      </ul>
      <button class="ob-try cta">Try it</button> <span class="ob-out"></span>`, [NET]);
    tryIt(ob.lastElementChild);
  });
});
};
