"use strict";

// Drawing for the car page. Pure canvas code: no DOM, no state. Colours, fonts, line widths and
// radii follow the digit demo so both pages read as one site.
//
// API
//   drawRoad(ctx, box, view)
//     box  = { x, y, w, h } in css px (the caller applies devicePixelRatio to ctx first)
//     view = { road, pos, lane, crashed }
//       road    from makeRoad()
//       pos     row scroll, may be fractional (the car's row is always pos); 0 = start line
//       lane    the car's x in lane units, may be fractional (0 = left lane)
//       crashed true: both cars are drawn dented; crashAge adds the bang (first ~1.2 s) and smoke
//       dist metres driven, shown big in the sky
//       crashAge seconds since a collision (>= 0): smoke rises from both cars; -1 = none
//       steer   angle in radians of the steering wheel at the bottom centre (negative = left); 0 = straight
//       carScale our car's size (1 = normal; a pulse)
//       tags    true: a tag over the nearest car ahead in each lane ("My lane · 30 m"), what the radar inputs see
//       best    the best distance so far, shown in the sign
//       bottom  css px kept free under the Move! button's space (the page's speed slider)
//     returns { wheel: { x, y, r }, reset: { x, y, size } or null } in css px, for the page's buttons: under our car,
//     and in the sign after the best distance (null: no sign)
//   drawPanel(ctx, box, net, fwd, { action, explored })
//     net     from createNet(); fwd = forward(net, obs); action = chosen index (0 left, 1 stay, 2 right)
//     explored true: the chosen move was random, not the network's own choice
//     stats    a line of text under the legend (the page's training stats); null = none
//     after    css px kept free at the end of the stats line; returns { x, y } there (left edge, vertical middle), or null
//     icons = { road, pos, lane, crashed } (the road view): our car's icon slides through the lane squares with it
//     The panel is laid out in a 760 x 800 design space and scaled to fit the box (top, centred).
//   COLORS the shared palette (same values as the digit demo).
import { VIEW_ROWS, AHEAD, rowAt, SIGN_EVERY, METERS_PER_ROW } from "./game.js";

export const COLORS = {
  paper: "#fbfaf6", sunk: "#f4f2ea", rule: "#e2ded2", ink: "#16150f", muted: "#6f6b61",
  cellEmpty: [232, 229, 219], cellInk: [22, 21, 15],
  positive: [52, 199, 140],   // green: pushes the next layer up
  negative: [220, 64, 200],   // magenta: pushes the next layer down
  answer: "#1fa463",          // outline around the chosen answer
};
const CELL_EMPTY = `rgb(${COLORS.cellEmpty})`, CELL_INK = `rgb(${COLORS.cellInk})`;

const FONT = 'ui-sans-serif, -apple-system, "Segoe UI", Inter, Roboto, Helvetica, Arial, sans-serif';
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const rgba = ([r, g, b], a) => `rgba(${r},${g},${b},${a})`;
const sgn = (v, d = 2) => (v < 0 ? "−" : "+") + Math.abs(v).toFixed(d);

function poly(ctx, pts) {
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath();
}

function rrect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

// ---------------------------------------------------------------- road

// Perspective: depth t is rows ahead of the car (t = 0 at the car). Scale s = exp(-FALL t) shrinks everything
// (road markings, posts, signs, trees, cars) toward a vanishing point on the horizon, faster with distance than plain
// perspective: 10 m 70%, 40 m 25%, 80 m 6% of our car's size. A car comes into view small, close to the horizon, its
// lane hard to tell, as weak as the radar's far signal. Screen speed is FALL x s, so everything speeds up steadily
// as it nears, and on past the car (t < 0).
// The road goes over a crest FAR rows ahead (just past the radar's 80 m): it ends on the horizon line as a narrow
// strip, not a point; the vanishing point sits just above the horizon and is never reached.
const FALL = 0.35, FAR = VIEW_ROWS + 1;

function projector(box, lanes, carY = box.y + box.h * 0.84) {
  const yh = box.y + box.h * 0.3, cx = box.x + box.w / 2;
  const laneW = box.w * 0.76 / (lanes + 0.6);      // 0.3 lane of shoulder on each side
  const s = (t) => Math.exp(-FALL * t), sf = s(FAR), yv = (yh - sf * carY) / (1 - sf);   // yv: the vanishing point's height
  return {
    yh, carY, cx, laneW, s,
    y: (t) => yv + (carY - yv) * s(t),             // y(FAR) = yh
    x: (u, t) => cx + u * laneW * s(t),            // u = lateral offset in lanes from the road centre
  };
}

// Flat rectangle on the ground: rows t0..t1, lateral u0..u1.
function strip(ctx, P, t0, t1, u0, u1) {
  poly(ctx, [[P.x(u0, t0), P.y(t0)], [P.x(u1, t0), P.y(t0)], [P.x(u1, t1), P.y(t1)], [P.x(u0, t1), P.y(t1)]]);
}

// Road-specific colours (not part of the shared site palette)
const ROAD = { shoulder: "#bdbab1", reflector: "#f0a030", ours: "#2f6bd6", oursCabin: "#6f95e6", tail: "#e0453a", burst: "#f5c230", burstEdge: "#a8680a", sight: "47,107,214" };
// What the network sees: the radar beam on the road (beam[0])
const ZONE = { rgb: "47,107,214", beam: 0.10, line: 0.2 };
const PARKED = [["#a7a398", "#c3bfb3"], ["#b4b0a4", "#d0ccc0"], ["#989488", "#b6b2a6"]];   // neutral greys

// A lean sketch of a car seen from behind: wheels, body, cabin with rear window, tail lights.
// dent = 0 for an intact car, else the tilt (radians, sign = side): squashed, skewed, with a crumpled body edge.
function drawCar(ctx, x, base, W, body, cabin, dent, alpha) {
  ctx.save();
  ctx.globalAlpha = alpha;
  if (dent) {
    ctx.translate(x, base); ctx.rotate(dent); ctx.transform(1, 0, -dent * 1.5, 0.93, 0, 0); ctx.translate(-x, -base);
  }
  ctx.lineJoin = "round";
  ctx.lineWidth = Math.max(1, W * 0.035);
  ctx.strokeStyle = COLORS.ink;
  ctx.fillStyle = "rgba(22,21,15,0.14)";           // ground shadow
  ctx.beginPath(); ctx.ellipse(x, base, W * 0.58, W * 0.1, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = COLORS.ink;                      // wheels
  for (const sx of [-1, 1]) { rrect(ctx, x + sx * W * 0.5 - W * 0.07, base - W * 0.22, W * 0.14, W * 0.24, W * 0.04); ctx.fill(); }
  ctx.fillStyle = cabin;                           // cabin
  poly(ctx, [[x - W * 0.4, base - W * 0.46], [x - W * 0.29, base - W * 0.8], [x + W * 0.29, base - W * 0.8], [x + W * 0.4, base - W * 0.46]]);
  ctx.fill(); ctx.stroke();
  ctx.fillStyle = "rgba(22,21,15,0.55)";          // rear window
  poly(ctx, [[x - W * 0.3, base - W * 0.5], [x - W * 0.22, base - W * 0.73], [x + W * 0.22, base - W * 0.73], [x + W * 0.3, base - W * 0.5]]);
  ctx.fill();
  ctx.fillStyle = body;                            // body
  rrect(ctx, x - W / 2, base - W * 0.5, W, W * 0.38, W * 0.09);
  ctx.fill(); ctx.stroke();
  ctx.fillStyle = ROAD.tail;                       // tail lights
  for (const sx of [-1, 1]) { rrect(ctx, x + sx * W * 0.36 - W * 0.07, base - W * 0.42, W * 0.14, W * 0.07, W * 0.02); ctx.fill(); }
  if (dent) {                                      // crumpled edge: a dark zigzag band across the body
    const y0 = base - W * 0.5, side = Math.sign(dent), pts = [];
    for (let i = 0; i <= 8; i++) pts.push([x - W / 2 + (W * i) / 8, y0 + (i % 2 ? 0.1 : -0.02) * W + side * (i - 4) * W * 0.01]);
    for (let i = 8; i >= 0; i--) pts.push([x - W / 2 + (W * i) / 8, y0 + 0.2 * W + (i % 2 ? 0 : 0.05) * W]);
    ctx.fillStyle = "rgba(22,21,15,0.28)"; poly(ctx, pts); ctx.fill();
    ctx.beginPath(); for (let i = 0; i <= 8; i++) ctx[i ? "lineTo" : "moveTo"](pts[i][0], pts[i][1]); ctx.stroke();
  }
  ctx.restore();
}

// Reflector posts at the outer edge of both shoulders, one every 20 m (at the start of every 2nd row), far to near:
// a white post with a black band holding an amber reflector, about 1 m tall.
function drawPosts(ctx, P, pos, edge) {
  for (let r = Math.ceil(pos + 40); r >= Math.floor(pos - 2); r--) {
    const t = r - pos - 0.5;
    if (t < -1.5 || t > FAR || r % 2) continue;
    const u = P.laneW * P.s(t), h = u * 0.3, w = Math.max(1.5, u * 0.05), y = P.y(t);
    if (h < 2) continue;
    for (const sx of [-1, 1]) {
      const x = P.x(sx * edge, t) - w / 2;
      ctx.fillStyle = "#ffffff"; ctx.fillRect(x, y - h, w, h);
      ctx.fillStyle = COLORS.ink; ctx.fillRect(x, y - h * 0.82, w, h * 0.26);
      ctx.fillStyle = ROAD.reflector; ctx.fillRect(x + w * 0.25, y - h * 0.78, w * 0.5, h * 0.18);
      if (h >= 6) { ctx.strokeStyle = COLORS.ink; ctx.lineWidth = Math.max(0.75, u * 0.008); ctx.strokeRect(x, y - h, w, h); }
    }
  }
}

// Distance signs on the right shoulder: a small white plate with a dark border on a post, one every
// SIGN_EVERY metres, at the depth where the car's distance counter reaches that number.
// The distance counter as a motorway-style sign floating in the middle of the sky, centred on the vanishing point: green plate, white border, soft shadow.
// phone: one line, caption and number the same size (15 px, less if the road is too narrow); the number has room up to
// "99,999 km", so the sign keeps its width as the distance grows.
// The floating sign: distance with no collision, then the best so far. Returns where the page's Reset button goes:
// { x, y, size } in css px (its left edge, vertical middle, font size), right after the best distance.
function drawCounter(ctx, box, P, dist, fullH, phone, best) {
  const cap = "Distance driven with no collisions", num = `${Math.floor(dist).toLocaleString("en-US")} m`;
  const bestStr = `Best: ${Math.floor(best).toLocaleString("en-US")} m`;
  const width = (s, weight, size) => { ctx.font = `${weight} ${size}px ${FONT}`; return ctx.measureText(s).width; };
  let big, small, sw, sh;
  if (phone) {
    const line = (fs) => width(cap + ":", 600, fs) + fs * 0.4 + width("99,999 km", 700, fs) + fs * 1.6;
    big = small = Math.min(15, 15 * (box.w - 16) / line(15));
    sw = line(big); sh = big * 3.9;
  } else {
    big = clamp(fullH * 0.095, 30, 92); small = Math.max(14, fullH * 0.021);
    sw = Math.max(width("8,888 m", 700, big), width(cap, 600, small)) + big * 0.7; sh = small * 1.3 + big * 1.05 + big * 0.45 + small * 1.9;
  }
  const sx = clamp(P.cx - sw / 2, box.x + 8, box.x + box.w - 8 - sw), sy = box.y + (P.yh - box.y - sh) / 2;   // floats in the middle of the sky
  const gy = sy + sh + big * 0.3, sg = ctx.createRadialGradient(P.cx, gy, 0, P.cx, gy, sw * 0.5);   // soft shadow below the floating sign
  sg.addColorStop(0, "rgba(22,40,30,0.30)"); sg.addColorStop(1, "rgba(22,40,30,0)");
  ctx.save(); ctx.translate(0, gy); ctx.scale(1, 0.16); ctx.translate(0, -gy);
  ctx.fillStyle = sg; ctx.fillRect(P.cx - sw * 0.5, gy - sw * 0.5, sw, sw); ctx.restore();
  ctx.save();
  ctx.shadowColor = "rgba(22,40,30,0.35)"; ctx.shadowBlur = big * 0.3; ctx.shadowOffsetY = big * 0.1;
  ctx.fillStyle = "#1e6b4c"; ctx.strokeStyle = "#124432"; ctx.lineWidth = 2;
  rrect(ctx, sx, sy, sw, sh, big * 0.16); ctx.fill(); ctx.stroke();
  ctx.restore();
  ctx.strokeStyle = "#ffffff"; ctx.lineWidth = Math.max(2, big * 0.035);
  rrect(ctx, sx + big * 0.08, sy + big * 0.08, sw - big * 0.16, sh - big * 0.16, big * 0.1); ctx.stroke();
  if (phone) {                                   // caption, then the number left-aligned after it; the best on a second line
    const x = sx + big * 0.8, y = sy + big * 1.75, y2 = y + big * 1.4;
    text(ctx, cap + ":", x, y, 600, big, "#ffffff");
    text(ctx, num, x + width(cap + ":", 600, big) + big * 0.4, y, 700, big, "#ffffff");
    text(ctx, bestStr, x, y2, 600, big, "#d6eadf");
    return { x: x + width(bestStr, 600, big) + big * 0.6, y: y2 - big * 0.35, size: big * 0.8 };
  }
  text(ctx, cap, P.cx, sy + big * 0.2 + small, 600, small, "#ffffff", "center");
  text(ctx, num, P.cx, sy + small * 1.3 + big * 1.22, 700, big, "#ffffff", "center");
  const by = sy + sh - small * 1.05;              // the best, right-aligned before the middle; Reset after it
  text(ctx, bestStr, P.cx + small * 0.1, by, 600, small, "#d6eadf", "right");
  return { x: P.cx + small * 0.6, y: by - small * 0.35, size: small * 0.8 };
}

// Seeded trees along both sides, scrolling with the road: broadleaf (a shaded crown of clustered leaf
// blobs) or conifer (stacked needle tiers). Lit from the upper left, with a soft ground shadow, no outlines.
const LEAF = [["#5d8a48", "#466d36", "#7da862"], ["#6a9650", "#50783c", "#8db86e"], ["#557f43", "#3e6430", "#739e59"]];   // base, shade, light
const PINE = ["#3f6a3c", "#2c5130", "#58864f"];
const TRUNK = ["#6b4f36", "#4e3926"];                                     // lit, shaded
function drawTrees(ctx, P, pos, half, curb) {
  const step = 1.7, i0 = Math.ceil((pos - 1) / step), i1 = Math.floor((pos + 38) / step);
  const rnd = (i, k) => { const a = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453; return a - Math.floor(a); };
  const blob = (x, y, r) => { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); };
  for (let i = i1; i >= i0; i--) for (const side of [-1, 1]) {
    const k = side < 0 ? 1 : 2, t = i * step + rnd(i, k) * 0.6 - pos, s = P.s(t);
    if (t < -0.8 || (side < 0 && s > 0.61 && s < 0.962)) continue;   // keep the left label spot clear (by on-screen size, so the same spot at any depth scale)
    const u = P.laneW * s, x = P.x(side * (half + curb + 0.9 + rnd(i, k + 5) * 1.2), t), y = Math.max(P.y(t), P.yh);   // past the crest: on the horizon line
    const h = u * (1.5 + rnd(i, k + 9) * 0.5) * (rnd(i, k + 13) > 0.65 ? 1.3 : 1);   // about a third are taller
    ctx.save();
    ctx.globalAlpha = clamp((38 - t) / 8, 0, 1) * clamp((t + 0.8) / 0.4, 0, 1);
    ctx.fillStyle = "rgba(30,50,20,0.2)";                         // ground shadow, falling to the lower right
    ctx.beginPath(); ctx.ellipse(x + u * 0.1, y, u * 0.34, u * 0.06, 0, 0, Math.PI * 2); ctx.fill();
    if (rnd(i, k + 7) > 0.5) {                                    // conifer: four tiers, right half in shade
      const tw = u * 0.035;
      ctx.fillStyle = TRUNK[1]; ctx.fillRect(x - tw, y - h * 0.16, tw * 2, h * 0.16);
      for (let j = 0; j < 4; j++) {
        const yb = y - h * (0.1 + j * 0.2), yt = yb - h * 0.34, w = u * (0.34 - j * 0.065);
        ctx.fillStyle = PINE[0]; poly(ctx, [[x - w, yb], [x + w, yb], [x, yt]]); ctx.fill();
        ctx.fillStyle = PINE[1]; poly(ctx, [[x, yb + h * 0.02], [x + w, yb], [x, yt]]); ctx.fill();
        ctx.fillStyle = PINE[2]; poly(ctx, [[x - w * 0.55, yb - h * 0.08], [x - w * 0.15, yb - h * 0.1], [x - w * 0.05, yt + h * 0.08]]); ctx.fill();
      }
    } else {                                                      // broadleaf: tapered trunk, clustered crown
      const tone = LEAF[Math.floor(rnd(i, k + 3) * 3)], cy = y - h * 0.66, r = u * 0.34 * (0.9 + rnd(i, k + 11) * 0.2);
      ctx.fillStyle = TRUNK[0]; poly(ctx, [[x - u * 0.05, y], [x + u * 0.05, y], [x + u * 0.025, cy], [x - u * 0.025, cy]]); ctx.fill();
      ctx.fillStyle = TRUNK[1]; poly(ctx, [[x + u * 0.005, y], [x + u * 0.05, y], [x + u * 0.025, cy], [x + u * 0.005, cy]]); ctx.fill();
      const spots = [];
      for (let j = 0; j < 7; j++) {
        const a = j * Math.PI * 2 / 7 + rnd(i, k + 20 + j) * 0.6, d = r * (0.45 + rnd(i, k + 30 + j) * 0.2);
        spots.push([x + Math.cos(a) * d, cy + Math.sin(a) * d * 0.85, r * (0.5 + rnd(i, k + 40 + j) * 0.15)]);
      }
      ctx.fillStyle = tone[1]; for (const [bx, by, br] of spots) blob(bx + r * 0.08, by + r * 0.1, br);   // shade underneath
      ctx.fillStyle = tone[0]; for (const [bx, by, br] of spots) blob(bx, by, br * 0.92); blob(x, cy, r * 0.6);
      ctx.fillStyle = tone[2];                                    // light on the upper-left leaves
      for (const [bx, by, br] of spots) if (bx < x + r * 0.1 && by < cy + r * 0.1) blob(bx - br * 0.2, by - br * 0.22, br * 0.45);
    }
    ctx.restore();
  }
}

function drawSigns(ctx, P, pos, half) {
  const every = SIGN_EVERY / METERS_PER_ROW;
  const k0 = Math.max(1, Math.ceil((pos - 1.2) / every)), k1 = Math.floor((pos + 36) / every);
  for (let k = k1; k >= k0; k--) {
    const m = k * SIGN_EVERY;
    if (m >= 1000 && m % 100) continue;            // from 1 km on: one sign per 100 m, in km
    const t = k * every - pos, u = P.laneW * P.s(t), x = P.x(half + 0.5, t), y = P.y(t);
    const alpha = clamp((t + 1.2) / 0.6, 0, 1) * clamp((38 - t) / 8, 0, 1);
    if (alpha <= 0 || t > FAR) continue;
    const pw = u * 0.52, ph = u * 0.34, pole = u * 0.36, top = y - pole - ph;   // the plate just above the reflector posts (0.3)
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = COLORS.ink; ctx.fillRect(x - Math.max(1, u * 0.02), top + ph, Math.max(2, u * 0.04), pole);
    ctx.fillStyle = "#ffffff"; ctx.strokeStyle = COLORS.ink; ctx.lineWidth = Math.max(1, u * 0.025);
    rrect(ctx, x - pw / 2, top, pw, ph, u * 0.03); ctx.fill(); ctx.stroke();
    if (u * 0.15 >= 2.5) text(ctx, m < 1000 ? `${m} m` : `${(m / 1000).toFixed(1)} km`, x, top + ph * 0.67, 700, u * 0.15, COLORS.ink, "center");
    ctx.restore();
  }
}

// A few seeded clouds drifting very slowly to the right (about 5 px per second), wrapping around.
function drawClouds(ctx, box, yh) {
  const n = 7, span = box.w + 260, now = (typeof performance !== "undefined" ? performance.now() : 0) / 1000;
  const rnd = (i, k) => { const a = Math.sin(i * 91.7 + k * 17.3) * 43758.5453; return a - Math.floor(a); };
  const sky = yh - box.y;
  ctx.save();
  ctx.beginPath(); ctx.rect(box.x, box.y, box.w, sky); ctx.clip();
  ctx.fillStyle = "rgba(255,255,255,0.92)"; ctx.strokeStyle = "rgba(110,140,170,0.35)"; ctx.lineWidth = 1.2;
  for (let i = 0; i < n; i++) {
    const w = sky * (0.35 + rnd(i, 1) * 0.3), x = box.x + ((rnd(i, 2) * span + now * 5 * (0.7 + rnd(i, 3) * 0.6)) % span) - 130;
    const y = box.y + sky * (0.12 + rnd(i, 4) * 0.62);
    ctx.beginPath();
    ctx.moveTo(x - w * 0.5, y + w * 0.12);
    ctx.arc(x - w * 0.28, y, w * 0.17, Math.PI * 0.55, Math.PI * 1.5);
    ctx.arc(x, y - w * 0.1, w * 0.22, Math.PI, Math.PI * 1.95);
    ctx.arc(x + w * 0.27, y - w * 0.01, w * 0.16, Math.PI * 1.3, Math.PI * 0.5);
    ctx.lineTo(x - w * 0.5, y + w * 0.12);
    ctx.closePath(); ctx.fill(); ctx.stroke();
  }
  ctx.restore();
}

// Soft grey puffs that rise, grow and fade; age in seconds since the collision.
function drawSmoke(ctx, x, base, W, age, seed) {
  for (let i = 0; i < 14; i++) {
    const k = (age - i * 0.18) / 2.2;
    if (k < 0 || k > 1) continue;
    const a = Math.sin((i + seed) * 12.9898) * 43758.5453, rnd = a - Math.floor(a);
    const px = x + (rnd - 0.5) * W * 0.5 + Math.sin(k * 3 + i) * W * 0.12 * k;
    const py = base - W * 0.55 - k * W * 1.5, r = W * (0.14 + 0.3 * k);
    const al = 0.6 * (1 - k) * Math.min(1, k * 8);
    const g = ctx.createRadialGradient(px, py, 0, px, py, r);
    g.addColorStop(0, `rgba(176,173,164,${al})`); g.addColorStop(1, "rgba(150,147,138,0)");
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(px, py, r, 0, Math.PI * 2); ctx.fill();
  }
}

// Comic "bang" star: pops in, stays about 0.7 s, then fades out over 0.5 s.
function drawBang(ctx, x, y, W, age) {
  const alpha = clamp((1.2 - age) / 0.5, 0, 1), pop = age < 0.12 ? 0.6 + 4 * age : 1.08 - Math.min(0.08, (age - 0.12) * 0.4);
  if (alpha <= 0) return;
  const n = 11, pts = [];
  for (let i = 0; i < n * 2; i++) {
    const a = (i / (n * 2)) * Math.PI * 2 - Math.PI / 2, r = (i % 2 ? 0.45 : 0.95 + 0.12 * Math.sin(i * 2.7)) * W * 0.62 * pop;
    pts.push([x + Math.cos(a) * r, y + Math.sin(a) * r * 0.85]);
  }
  ctx.save();
  ctx.globalAlpha = alpha; ctx.lineJoin = "round";
  ctx.fillStyle = ROAD.burst; ctx.strokeStyle = ROAD.burstEdge; ctx.lineWidth = Math.max(2, W * 0.05);
  poly(ctx, pts); ctx.fill(); ctx.stroke();
  ctx.restore();
}

// Steering wheel, radius R centred at (x, y); steer = angle in radians, negative = turned left.
function drawWheel(ctx, x, y, R, steer) {
  ctx.save();
  ctx.translate(x, y); ctx.rotate(steer);
  const s = Math.sin(steer), c = Math.cos(steer);   // the light stays on top while the wheel turns
  const shade = ctx.createLinearGradient(-s * R, -c * R, s * R, c * R);
  shade.addColorStop(0, "#ffffff"); shade.addColorStop(1, COLORS.rule);
  ctx.fillStyle = shade; ctx.strokeStyle = COLORS.ink; ctx.lineWidth = 2.5; ctx.lineJoin = "round";
  for (const [a, w0, w1] of [[0.18, 0.17, 0.1], [Math.PI - 0.18, 0.17, 0.1], [Math.PI / 2, 0.13, 0.08]]) {   // spokes: right, left (both a little low), down
    ctx.save(); ctx.rotate(a);
    poly(ctx, [[R * 0.2, -R * w0], [R * 0.88, -R * w1], [R * 0.88, R * w1], [R * 0.2, R * w0]]); ctx.fill(); ctx.stroke();
    ctx.restore();
  }
  ctx.save(); ctx.shadowColor = "rgba(22,21,15,0.22)"; ctx.shadowBlur = R * 0.12; ctx.shadowOffsetY = R * 0.05;
  ctx.beginPath(); ctx.arc(0, 0, R, 0, 2 * Math.PI); ctx.moveTo(R * 0.82, 0); ctx.arc(0, 0, R * 0.82, 0, 2 * Math.PI, true);   // rim
  ctx.fill(); ctx.restore();
  ctx.beginPath(); ctx.arc(0, 0, R, 0, 2 * Math.PI); ctx.stroke();
  ctx.beginPath(); ctx.arc(0, 0, R * 0.82, 0, 2 * Math.PI); ctx.stroke();
  const m = 0.13;                                   // centre marker on top of the rim, like a race car's
  ctx.beginPath(); ctx.arc(0, 0, R, -Math.PI / 2 - m, -Math.PI / 2 + m); ctx.arc(0, 0, R * 0.82, -Math.PI / 2 + m, -Math.PI / 2 - m, true); ctx.closePath();
  ctx.fillStyle = COLORS.ink; ctx.fill(); ctx.fillStyle = shade;
  rrect(ctx, -R * 0.3, -R * 0.24, R * 0.6, R * 0.48, R * 0.16); ctx.fill(); ctx.stroke();   // hub pad
  ctx.restore();
}

// The radar's two targets (view.tags): a tag over the nearest car ahead in each lane, named like the network's inputs.
// If the two tags overlap, the farther one moves up.
function drawTags(ctx, P, view, box) {
  const { road, pos, lane } = view, L = road.lanes, mine = clamp(Math.round(lane), 0, L - 1), fs = clamp(box.w * 0.017, 11, 16), tags = [];
  for (const [l, name] of [[mine, "My lane"], [1 - mine, "Other lane"]]) {
    for (let d = 1; d <= AHEAD; d++) {
      const r = Math.floor(pos + 1e-9) + d, t = r - pos;
      if (!rowAt(road, r)[l]) continue;
      const W = P.laneW * 0.64 * P.s(t), x = P.x(l - (L - 1) / 2, t), top = P.y(t) + W * 0.08 - W * 0.82;
      ctx.font = `650 ${fs}px ${FONT}`;
      const str = `${name} · ${d * METERS_PER_ROW} m`, w = ctx.measureText(str).width + fs * 1.1, h = fs * 1.7;
      tags.push({ str, x, top, w, h, y: top - h - fs * 0.7, t });
      break;
    }
  }
  if (tags.length === 2) {
    const [a, b] = tags[0].t < tags[1].t ? tags : [tags[1], tags[0]];
    if (Math.abs(a.x - b.x) < (a.w + b.w) / 2 + 4 && b.y + b.h + 4 > a.y) b.y = a.y - b.h - 4;
  }
  for (const g of tags) {
    ctx.strokeStyle = COLORS.ink; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(g.x, g.y + g.h); ctx.lineTo(g.x, g.top); ctx.stroke();
    rrect(ctx, g.x - g.w / 2, g.y, g.w, g.h, 6); ctx.fillStyle = "rgba(213,225,246,0.97)"; ctx.fill(); ctx.stroke();
    text(ctx, g.str, g.x, g.y + g.h * 0.68, 650, fs, COLORS.ink, "center");
  }
}

export function drawRoad(ctx, full, view) {
  const { road, pos, lane, crashed } = view, L = road.lanes;
  const box = full, W0 = box.w * 0.76 / (L + 0.6) * 0.64, R = W0 * 0.33;   // our car's width; the wheel under it
  const P = projector(box, L, box.y + box.h - (view.bottom || 0) - W0 * 0.3 - 2 * R), half = L / 2, curb = 0.3;   // mockup: the wheel's space holds the Move! button
  ctx.save();
  ctx.beginPath(); ctx.rect(full.x, full.y, full.w, full.h); ctx.clip();

  ctx.fillStyle = COLORS.paper; ctx.fillRect(full.x, full.y, full.w, full.h);
  const sg = ctx.createLinearGradient(0, box.y, 0, P.yh);                                 // sky: light blue, paler at the horizon
  sg.addColorStop(0, "#b9d8f1"); sg.addColorStop(1, "#eaf3f6");
  ctx.fillStyle = sg; ctx.fillRect(box.x, box.y, box.w, P.yh - box.y);
  drawClouds(ctx, box, P.yh);
  ctx.strokeStyle = COLORS.rule; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(box.x, P.yh); ctx.lineTo(box.x + box.w, P.yh); ctx.stroke();

  // grass on both sides, a little darker toward the horizon
  const gg = ctx.createLinearGradient(0, P.yh, 0, full.y + full.h);
  gg.addColorStop(0, "#7fa56f"); gg.addColorStop(1, "#a9c98e");
  ctx.fillStyle = gg; ctx.fillRect(full.x, P.yh, full.w, full.y + full.h - P.yh);
  ctx.strokeStyle = COLORS.ink; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(box.x, P.yh); ctx.lineTo(box.x + box.w, P.yh); ctx.stroke();


  // road surface, up to the crest, fading into the horizon
  const g = ctx.createLinearGradient(0, P.yh, 0, P.carY);
  g.addColorStop(0, COLORS.sunk); g.addColorStop(1, CELL_EMPTY);
  ctx.fillStyle = g;
  poly(ctx, [[P.x(-half, FAR), P.yh], [P.x(half, FAR), P.yh], [P.x(half, -2), P.y(-2)], [P.x(-half, -2), P.y(-2)]]);
  ctx.fill();

  // shoulders: grey, with a solid white edge line along the road; reflector posts (one per row) show the rows
  const r0 = Math.floor(pos - 2), r1 = Math.ceil(pos + 40);
  ctx.fillStyle = ROAD.shoulder;
  for (const sx of [-1, 1]) { strip(ctx, P, -2, FAR, sx * half, sx * (half + curb)); ctx.fill(); }
  ctx.fillStyle = "#ffffff";
  for (const sx of [-1, 1]) { strip(ctx, P, -2, FAR, sx * (half - 0.06), sx * (half - 0.01)); ctx.fill(); }
  ctx.strokeStyle = COLORS.ink; ctx.lineWidth = 1.5; ctx.lineJoin = "round";
  for (const sx of [-1, 1]) {
    ctx.beginPath(); ctx.moveTo(P.x(sx * (half + curb), FAR), P.yh); ctx.lineTo(P.x(sx * (half + curb), -2), P.y(-2)); ctx.stroke();
  }

  drawTrees(ctx, P, pos, half, curb);

  // lane markings: one short dash per row, no grid
  ctx.fillStyle = "rgba(251,250,246,0.9)";
  for (let r = r0; r <= r1; r++) {
    const t0 = r - pos - 0.5 + 0.22, t1 = Math.min(FAR, r - pos + 0.5 - 0.22);
    if (t0 >= t1) continue;
    for (let j = 1; j < L; j++) { strip(ctx, P, t0, t1, j - half - 0.02, j - half + 0.02); ctx.fill(); }
  }

  // what the network sees, as a radar beam: a faint 120° wedge from the centre of our car, forwards, weaker with
  // distance: strongest at the car, dispersed by 30 m.
  const Wc = P.laneW * 0.64, ax = P.x(lane - (L - 1) / 2, 0), ay = P.y(0) + Wc * 0.08 - Wc * 0.45;
  const yEnd = P.y(3.5), spread = Math.tan(Math.PI / 3) * (ay - yEnd);
  const fade = (a) => {
    const g = ctx.createLinearGradient(0, ay, 0, yEnd);
    g.addColorStop(0, `rgba(${ZONE.rgb},${a})`); g.addColorStop(1, `rgba(${ZONE.rgb},0)`);
    return g;
  };
  poly(ctx, [[ax, ay], [ax + spread, yEnd], [ax - spread, yEnd]]); ctx.fillStyle = fade(ZONE.beam); ctx.fill();
  ctx.lineWidth = 1.5; ctx.setLineDash([6, 5]); ctx.strokeStyle = fade(ZONE.line);
  ctx.beginPath(); ctx.moveTo(ax - spread, yEnd); ctx.lineTo(ax, ay); ctx.lineTo(ax + spread, yEnd); ctx.stroke();
  ctx.setLineDash([]);

  drawPosts(ctx, P, pos, half + curb);
  drawSigns(ctx, P, pos, half);

  // cars far to near, so near ones cover far ones; ours goes after parked cars in its own row
  const list = [];
  for (let r = Math.floor(pos) - 1; r <= Math.ceil(pos) + VIEW_ROWS + 1; r++) {
    if (r < 0) continue;
    const row = rowAt(road, r);
    const t = r - pos;
    if (t > VIEW_ROWS + 0.5 || t < -1) continue;
    for (let l = 0; l < L; l++) if (row[l]) list.push({ t, u: l - (L - 1) / 2, kind: (r * 7 + l * 3) % 3 });
  }
  const hit = Math.ceil(pos - 1e-9), hitLane = Math.round(lane);
  const side = lane < -1e-6 ? -1 : lane > L - 1 + 1e-6 ? 1 : 0;   // past the outer lane: a side collision with the curb
  for (const c of list) if (crashed && !view.bangOnly && c.t === hit - pos && c.u === hitLane - (L - 1) / 2) c.hit = true;
  list.push({ t: 0, u: lane - (L - 1) / 2, ours: true });
  list.sort((a, b) => b.t - a.t);
  for (const c of list) {
    const s = P.s(c.t), W = P.laneW * 0.64 * s, x = P.x(c.u, c.t), base = P.y(c.t) + W * 0.08;
    const alpha = c.ours ? 1 : clamp(VIEW_ROWS + 0.5 - c.t, 0, 1) * clamp(1 + c.t, 0, 1);
    if (c.ours) drawCar(ctx, x, base, W * (view.carScale || 1), ROAD.ours, ROAD.oursCabin, crashed && !view.bangOnly ? (side ? 0.08 * side : -0.06) : 0, alpha);
    else drawCar(ctx, x, base, W, PARKED[c.kind][0], PARKED[c.kind][1], c.hit ? 0.07 : 0, alpha);
  }
  const wheel = { x: P.cx, y: P.carY + W0 * 0.2 + R, r: R };
  if (view.tags && !crashed) drawTags(ctx, P, view, box);

  if (crashed && view.crashAge >= 0) {             // bang between the cars, smoke from both; off the road: bang at the car's outer side
    const u = lane - (L - 1) / 2, ht = hit - pos, hitRow = rowAt(road, hit);
    const spots = [{ t: 0, seed: 0 }];
    if (!side && hitRow[hitLane]) spots.push({ t: ht, seed: 7 });
    if (!view.quick) for (const sp of spots) {
      const W = P.laneW * 0.64 * P.s(sp.t);
      drawSmoke(ctx, P.x(u, sp.t), P.y(sp.t) + W * 0.08, W, view.crashAge, sp.seed);
    }
    const tm = side ? 0.15 : view.bangOnly ? 0.3 : Math.max(0, ht) / 2, W = P.laneW * 0.64 * P.s(tm);
    drawBang(ctx, P.x(u + side * 0.4, tm), P.y(tm) - W * 0.45, W, view.crashAge);
  }
  const reset = view.noSign ? null : drawCounter(ctx, box, P, view.dist || 0, full.h, view.phone || box.h < box.w * 0.75, view.best || 0);   // last, so it floats above trees and cars; a short road gets the one-line sign
  ctx.restore();
  return { wheel, reset };
}

// ---------------------------------------------------------------- network panel
// Same vocabulary as the digit demo: outputs on top as ink-outlined boxes filled by value, the hidden
// layer on a sunk panel, the input at the bottom, green / magenta connections in between.
// Text sizes are in design px; at 1920x1080 the design space is drawn at about 1:1, and the smallest
// text is 16, never smaller than the digit demo's.

const DW = 760, DESK_DH = 772, SPAN = 660, LEFT = (DW - SPAN) / 2;   // design space
const OUT = { y: 50, size: 76 };
const PANEL = { x: 36, y: 180, w: DW - 72, h: 112 };
const HID = { y: 204, size: 72, gap: 8 };       // size shrinks to fit when there are many neurons
const IN = { cell: 96, gap: 16, radarY: 372, carY: 524 };   // one square per lane: the radar row, its values under it, then our car's lane
const DESK = { DH: DESK_DH, OUT, PANEL, HID, IN, SQ: 1 };
// compact (phones): shorter; every square is a flat rectangle (SQ = height / width), icons squashed to match,
// with tighter rows, a lower hidden-layer panel and smaller input squares
const COMPACT = { DH: 552, OUT: { y: 44, size: 76 }, PANEL: { x: 36, y: 168, w: DW - 72, h: 86 }, HID: { y: 182, size: 72, gap: 8 },
                  IN: { cell: 84, gap: 16, radarY: 300, carY: 398 }, SQ: 0.6 };
const rowX = (count, size, i) => LEFT + i * (size + (SPAN - count * size) / (count - 1));

function text(ctx, str, x, y, weight, size, color, align = "left") {
  ctx.font = `${weight} ${size}px ${FONT}`;
  ctx.fillStyle = color; ctx.textAlign = align; ctx.textBaseline = "alphabetic";
  ctx.fillText(str, x, y);
}

// text on a translucent backing, so it stays readable over the lines
function backed(ctx, str, x, y, weight, size, color, backing, align = "center") {
  ctx.font = `${weight} ${size}px ${FONT}`;
  const w = ctx.measureText(str).width, left = align === "center" ? x - w / 2 : x;
  ctx.fillStyle = backing; ctx.fillRect(left - 4, y - size * 0.95, w + 8, size * 1.25);
  text(ctx, str, x, y, weight, size, color, align);
}

// ink rises from the bottom of a white box, like the digit boxes; height defaults to a square
function fillBox(ctx, x, y, size, fill, radius, lw, height = size) {
  ctx.fillStyle = "#ffffff"; rrect(ctx, x, y, size, height, radius); ctx.fill();
  const pad = lw + 2, inner = size - 2 * pad, innerH = height - 2 * pad, h = innerH * clamp(fill, 0, 1);
  if (h > 0.5) { ctx.fillStyle = COLORS.ink; rrect(ctx, x + pad, y + pad + innerH - h, inner, h, Math.max(1, Math.min(radius - pad, h / 2))); ctx.fill(); }
  ctx.lineWidth = lw; ctx.strokeStyle = COLORS.ink; rrect(ctx, x, y, size, height, radius); ctx.stroke();
}

// contrib[j * from.count + i]: how much source i pushed target j (same line logic as the digit demo)
function connections(ctx, contrib, from, to, floor) {
  const lines = [];
  let maxAbs = floor;
  for (let j = 0; j < to.count; j++) for (let i = 0; i < from.count; i++) {
    const c = contrib[j * from.count + i];
    if (c !== 0) lines.push([i, j, c]);
    maxAbs = Math.max(maxAbs, Math.abs(c));
  }
  for (const l of lines) l[3] = Math.pow(Math.abs(l[2]) / maxAbs, 0.7);
  lines.sort((a, b) => a[3] - b[3]);               // strongest on top
  for (const [i, j, c, s] of lines) {
    if (s < 0.08) continue;
    const [r, g, b] = c > 0 ? COLORS.positive : COLORS.negative;
    ctx.strokeStyle = `rgba(${r},${g},${b},${0.15 + 0.75 * s})`;
    ctx.lineWidth = 0.6 + 1.8 * s;
    ctx.beginPath(); ctx.moveTo(from.x(i), from.y(i)); ctx.lineTo(to.x(j), to.y); ctx.stroke();
  }
}

// Playback eases every displayed value itself (the page passes already-blended fwd values); chosen = optional
// per-action highlight weights 0..1 for the cross-fade from the old choice to the new one.
const hexRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const mixCol = (a, b, w) => { const x = hexRgb(a), y = hexRgb(b); return `rgb(${x.map((v, i) => Math.round(v + (y[i] - v) * w))})`; };

// A radar input square: v = the lane's radar value (0 = nothing, 1/8 = a car 80 m ahead .. 1 = 10 m). The parked car
// comes into view as it nears: 80-40 m a thin wireframe outline growing from small, 30 m a full-size outline,
// 20 m a full wireframe with every part (wheels, window, tail lights), 10 m the full car icon. Same shapes as drawCar.
const WIRE_SCALE = { 8: 0.22, 7: 0.36, 6: 0.5, 5: 0.64, 4: 0.78 };
let pad = null;                                    // offscreen canvas for the hollow wireframes
function carShapes(ctx, x, base, W) {
  return {
    wheels: () => { ctx.beginPath(); for (const sx of [-1, 1]) ctx.roundRect(x + sx * W * 0.5 - W * 0.07, base - W * 0.22, W * 0.14, W * 0.24, W * 0.04); },
    cabin: () => poly(ctx, [[x - W * 0.4, base - W * 0.46], [x - W * 0.29, base - W * 0.8], [x + W * 0.29, base - W * 0.8], [x + W * 0.4, base - W * 0.46]]),
    body: () => rrect(ctx, x - W / 2, base - W * 0.5, W, W * 0.38, W * 0.09),
    window: () => poly(ctx, [[x - W * 0.3, base - W * 0.5], [x - W * 0.22, base - W * 0.73], [x + W * 0.22, base - W * 0.73], [x + W * 0.3, base - W * 0.5]]),
    tails: () => { ctx.beginPath(); for (const sx of [-1, 1]) ctx.roundRect(x + sx * W * 0.36 - W * 0.07, base - W * 0.42, W * 0.14, W * 0.07, W * 0.02); },
  };
}
// height (default: a square) squashes the icon to fit
export function drawRadarIcon(ctx, x, y, size, v, height = size) {
  const d = clamp(Math.round(AHEAD + 1 - v * AHEAD), 1, AHEAD), full = size * 0.66, cy = y + size * 0.53, cx = x + size / 2;
  ctx.fillStyle = "rgba(213,225,246,0.8)"; rrect(ctx, x, y, size, height, 8); ctx.fill();   // the beam's blue (20% on white), 80% opaque: the lines behind show faintly
  if (v > 0.01) {
    const W = full * (WIRE_SCALE[d] || 1), base = cy + W * 0.39;
    if (d === 1) { ctx.save(); ctx.translate(0, y); ctx.scale(1, height / size); ctx.translate(0, -y); drawCar(ctx, cx, base, W, PARKED[0][0], PARKED[0][1], 0, 1); ctx.restore(); }
    else {                                         // wireframes are drawn on the pad, so they stay hollow (see-through)
      const m = ctx.getTransform(), k = Math.hypot(m.a, m.b), n = Math.ceil(size * k);
      if (!pad) pad = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(1, 1) : document.createElement("canvas");
      pad.width = pad.height = n;
      const p = pad.getContext("2d"), S = carShapes(p, cx, base, W), parts = [S.wheels, S.cabin, S.body];
      const erase = (f) => { f(); p.globalCompositeOperation = "destination-out"; p.fill(); p.globalCompositeOperation = "source-over"; };
      p.setTransform(k, 0, 0, k, -x * k, -y * k);
      p.strokeStyle = COLORS.ink; p.lineJoin = "round";
      if (d === 2) {                               // every part, back to front; each erases the edges it hides
        p.lineWidth = 2;
        for (const f of parts) { erase(f); p.stroke(); }
        for (const f of [S.window, S.tails]) { f(); p.stroke(); }
      } else {                                     // the outline only: a double-width stroke, its inner half erased
        p.lineWidth = d === 3 ? 4 : 3;             // half shows: 30 m as thick as the 20 m wireframe (2)
        for (const f of parts) { f(); p.stroke(); }
        for (const f of parts) erase(f);
      }
      ctx.drawImage(pad, 0, 0, n, n, x, y, size, height);
    }
  }
  ctx.lineWidth = 2; ctx.strokeStyle = COLORS.ink; rrect(ctx, x, y, size, height, 8); ctx.stroke();
}

export function drawPanel(ctx, box, net, fwd, { action = -1, explored = false, icons = null, chosen: chosenWeights = null, stats = null, after = 0, textScale = 1, compact = false } = {}) {
  const { DH, OUT, PANEL, HID, IN, SQ } = compact ? COMPACT : DESK;   // the layout: desktop, or compact on phones
  const I = net.inputs, H = net.hidden, O = net.outputs, lanes = I;   // mockup: one radar square per input (our lane, the other lane)
  const hs = Math.min(48, HID.size, (SPAN - (H - 1) * HID.gap) / H);   // hidden neuron size (big enough for the label to stay clear)
  const hh = hs * SQ, oh = OUT.size * SQ, ch = IN.cell * SQ;          // heights: hidden, output, input
  const chosenW = (o) => (chosenWeights ? chosenWeights[o] : o === action ? 1 : 0);
  const sc = Math.min(box.w / DW, box.h / DH);
  ctx.save();
  ctx.beginPath(); ctx.rect(box.x, box.y, box.w, box.h); ctx.clip();
  ctx.translate(box.x + (box.w - DW * sc) / 2, box.y);
  ctx.scale(sc, sc);
  const BACK = "rgba(251,250,246,0.92)";

  // hidden layer sits on a sunk panel
  ctx.fillStyle = COLORS.sunk; ctx.strokeStyle = COLORS.rule; ctx.lineWidth = 1.5;
  rrect(ctx, PANEL.x, PANEL.y, PANEL.w, PANEL.h, 14); ctx.fill(); ctx.stroke();

  // input squares: the radar per lane (index = lane), then our car's lane (lanes + lane) under it
  const { cell, gap } = IN, gridW = lanes * cell + (lanes - 1) * gap, gx = (DW - gridW) / 2 + 40;
  const inX = (i) => gx + (i % lanes) * (cell + gap) + cell / 2;
  const inY = () => IN.radarY;

  // connections: contributions (weight x source activity), like the digit demo
  const c1 = new Float64Array(H * I), c2 = new Float64Array(O * H);
  for (let j = 0; j < H; j++) for (let i = 0; i < I; i++) c1[j * I + i] = net.W1[j * I + i] * fwd.x[i];
  for (let o = 0; o < O; o++) for (let j = 0; j < H; j++) c2[o * H + j] = net.W2[o * H + j] * fwd.h[j];
  const hx = (j) => rowX(H, hs, j) + hs / 2, ox = (o) => rowX(O, OUT.size, o) + OUT.size / 2;
  connections(ctx, c1, { count: I, x: inX, y: inY }, { count: H, x: hx, y: HID.y + hh }, 0.3);
  connections(ctx, c2, { count: H, x: hx, y: () => HID.y }, { count: O, x: ox, y: OUT.y + oh }, 0.5);

  // hidden neurons: box outline like the digit boxes, fill = tanh value (green +, magenta -)
  for (let j = 0; j < H; j++) {
    const x = rowX(H, hs, j), v = fwd.h[j];
    ctx.fillStyle = "#ffffff"; rrect(ctx, x, HID.y, hs, hh, 8); ctx.fill();
    ctx.fillStyle = rgba(v >= 0 ? COLORS.positive : COLORS.negative, 0.15 + 0.8 * Math.min(1, Math.abs(v)));
    rrect(ctx, x, HID.y, hs, hh, 8); ctx.fill();
    ctx.lineWidth = 2.5; ctx.strokeStyle = COLORS.ink; rrect(ctx, x, HID.y, hs, hh, 8); ctx.stroke();
    text(ctx, sgn(v), x + hs / 2, HID.y + hh / 2 + 6, 600, hs < 60 ? 16 : 18, COLORS.ink, "center");
  }

  // outputs: label above, score under; the chosen box gets the green answer outline.
  // Fill is relative to the three scores (lowest empty, highest full): scores are signed and unbounded,
  // so a fixed scale hid the order. The printed number carries the actual value.
  let lo = Infinity, hi = -Infinity;
  for (let o = 0; o < O; o++) { lo = Math.min(lo, fwd.q[o]); hi = Math.max(hi, fwd.q[o]); }
  for (let o = 0; o < O; o++) {
    const x = rowX(O, OUT.size, o), cx = x + OUT.size / 2, q = fwd.q[o], w = chosenW(o), chosen = w > 0.5;
    fillBox(ctx, x, OUT.y, OUT.size, hi - lo > 1e-9 ? (q - lo) / (hi - lo) : 0.5, 8, 2.5, oh);
    if (w > 0) {
      ctx.save(); ctx.globalAlpha = w; ctx.strokeStyle = COLORS.answer; ctx.lineWidth = 4;
      rrect(ctx, x - 5, OUT.y - 5, OUT.size + 10, oh + 10, 12); ctx.stroke(); ctx.restore();
    }
    text(ctx, ["Stay", "Change lane"][o] || String(o), cx, OUT.y - 22, 600, 30, mixCol(COLORS.ink, COLORS.answer, w), "center");
    const vy = OUT.y + oh + 8 + 18;
    backed(ctx, sgn(q), cx, vy, chosen ? 650 : 500, 18, mixCol(COLORS.muted, COLORS.answer, w), BACK);
    if (chosen && explored && !chosenWeights) backed(ctx, "random move", cx, vy + 22, 400, 17, COLORS.muted, BACK);
  }

  // drawn after the connections so no line crosses it
  backed(ctx, `Hidden layer: ${H} neurons`, PANEL.x + 14, PANEL.y + PANEL.h - 14, 600, 19, COLORS.ink, "rgba(244,242,234,0.92)", "left");

  // input: labelled like "Network sees" in the digit demo
  backed(ctx, "Network sees", gx, IN.radarY - 22, 600, 19, COLORS.ink, BACK, "left");
  // the radar squares, each with its value and the distance it stands for; our car's row (white, 80% opaque) holds our car's icon
  for (let l = 0; l < lanes; l++) {
    const v = clamp(fwd.x[l], 0, 1), x = gx + l * (cell + gap), d = Math.round(AHEAD + 1 - v * AHEAD);
    drawRadarIcon(ctx, x, IN.radarY, cell, v, ch);
    backed(ctx, v > 0.01 ? `${v.toFixed(2)} · ${d * METERS_PER_ROW} m` : "0.00", x + cell / 2, IN.radarY + ch + 26, 500, 17, COLORS.muted, BACK);
    text(ctx, ["My lane", "Other lane"][l], x + cell / 2, IN.radarY + ch + 52, 600, 19, COLORS.ink, "center");
  }
  text(ctx, "Radar", gx - 14, IN.radarY + ch / 2 + 7, 400, 19, COLORS.muted, "right");

  // last line, anchored to the box's bottom (level with the page's controls): the training stats; the legend just above
  // `after` (css px) keeps room at the line's end for the page's Reset button; the two are centred together.
  // textScale enlarges both lines (phones).
  const bottom = box.h / sc - 12, fs = 19 * textScale;
  let slot = null;
  if (stats) {
    ctx.font = `400 ${fs}px ${FONT}`;
    const tw = ctx.measureText(stats).width, gap = after ? 12 : 0, x0 = DW / 2 - (tw + gap + after / sc) / 2;
    text(ctx, stats, x0, bottom, 400, fs, COLORS.muted);
    slot = { x: box.x + (box.w - DW * sc) / 2 + (x0 + tw + gap) * sc, y: box.y + (bottom - 6) * sc };
  }

  // legend, muted like the captions, centred under the network
  const ly = stats ? bottom - 32 * textScale : bottom, keys = [[COLORS.positive, "positive weight"], [COLORS.negative, "negative weight"]];
  ctx.font = `400 ${fs}px ${FONT}`;
  let lx = DW / 2 - (keys.reduce((w, [, label]) => w + 32 + ctx.measureText(label).width + 28, 0) + ctx.measureText("thicker line = stronger").width) / 2;
  for (const [col, label] of keys) {
    ctx.strokeStyle = rgba(col, 0.9); ctx.lineWidth = 3; ctx.lineCap = "round";
    ctx.beginPath(); ctx.moveTo(lx, ly - 6); ctx.lineTo(lx + 24, ly - 6); ctx.stroke();
    text(ctx, label, lx + 32, ly, 400, fs, COLORS.muted);
    lx += 32 + ctx.measureText(label).width + 28;
  }
  text(ctx, "thicker line = stronger", lx, ly, 400, fs, COLORS.muted);
  ctx.restore();
  return slot;
}
