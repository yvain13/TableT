// Detects a wall bounce as a sharp turn in the ball's path, and places the hit where the
// path in and the path out meet, so no frame needs to catch the moment of contact.

import { TRACK_MAX, GAP_MS, COOLDOWN_MS, SIZE_RATIO, SHRINK_RATIO, SMALLEST_RATIO, SPEED_JUMP, BOUNDS_TOL } from './config.js';

// Straight-line motion through timed points: position at time t is (x + vx*(t - t0), y + vy*(t - t0)).
// Returns the fit and its squared residual.
export function fitMotion(pts) {
  const n = pts.length;
  const t0 = pts[0].t;
  let mt = 0, mx = 0, my = 0;
  for (const p of pts) { mt += p.t - t0; mx += p.x; my += p.y; }
  mt /= n; mx /= n; my /= n;
  let stt = 0, stx = 0, sty = 0;
  for (const p of pts) {
    const dt = p.t - t0 - mt;
    stt += dt * dt; stx += dt * (p.x - mx); sty += dt * (p.y - my);
  }
  const vx = stt ? stx / stt : 0, vy = stt ? sty / stt : 0;
  const tc = t0 + mt;
  let resid = 0;
  for (const p of pts) {
    const dt = p.t - tc;
    resid += (p.x - mx - vx * dt) ** 2 + (p.y - my - vy * dt) ** 2;
  }
  return { t: tc, x: mx, y: my, vx, vy, resid };
}

const at = (m, t) => [m.x + m.vx * (t - m.t), m.y + m.vy * (t - m.t)];

// The moment, between tMin and tMax, when the path in and the path out are closest; the hit is
// the midpoint there. This works for a V-shaped turn and for a ball that comes straight back
// along the camera's line of sight, where crossing two fitted lines is undefined.
export function meetPoint(a, b, tMin, tMax) {
  const dvx = a.vx - b.vx, dvy = a.vy - b.vy;
  const dv2 = dvx * dvx + dvy * dvy;
  if (dv2 < 1e-12) return null;
  // a(t) - b(t) = (a.x - a.vx*a.t) - (b.x - b.vx*b.t) + dv*t
  const cx = a.x - a.vx * a.t - (b.x - b.vx * b.t);
  const cy = a.y - a.vy * a.t - (b.y - b.vy * b.t);
  const t = Math.min(tMax, Math.max(tMin, -(cx * dvx + cy * dvy) / dv2));
  const [ax, ay] = at(a, t), [bx, by] = at(b, t);
  return { t, x: (ax + bx) / 2, y: (ay + by) / 2, gap: Math.hypot(ax - bx, ay - by) };
}

// Fit up to 3 points either side of the candidate (short spans keep gravity's curve out of the
// fit). The candidate frame may sit on either side of the contact, so try both splits and keep
// the one whose paths fit best and meet most closely.
export function hitPoint(track, c, maxDist) {
  const cand = track[c];
  const splits = [
    [track.slice(Math.max(0, c - 2), c + 1), track.slice(c + 1, c + 4)],
    [track.slice(Math.max(0, c - 3), c), track.slice(c, c + 3)],
  ];
  let best = null;
  for (const [before, after] of splits) {
    if (before.length < 2 || after.length < 2) continue;
    const a = fitMotion(before), b = fitMotion(after);
    const p = meetPoint(a, b, before[before.length - 1].t, after[0].t);
    if (!p || Math.hypot(p.x - cand.x, p.y - cand.y) > maxDist) continue;
    const score = a.resid + b.resid + p.gap * p.gap;
    if (!best || score < best.score) best = { x: p.x, y: p.y, score };
  }
  return best ? { x: best.x, y: best.y, method: 'paths' } : { x: cand.x, y: cand.y, method: 'candidate' };
}

export class BounceDetector {
  constructor() {
    this.track = [];
    this.lastHitT = -Infinity;
    this.lastReject = null;
    this.rejectedT = -Infinity;
  }

  reset() { this.track = []; }

  // A rejected turn also shows up in the next two candidates, whose windows still span it.
  reject(reason, hit, p) {
    this.lastReject = { reason, x: hit.x, y: hit.y, t: p.t };
    this.rejectedT = p.t;
    return null;
  }

  // pt: { t, x, y, size } in screen px. params: { turnAngle, minMove, sizeCheck, bounds: { w, h } }.
  // Returns a hit { x, y, t, method } or null.
  push(pt, params) {
    const tr = this.track;
    if (tr.length && pt.t - tr[tr.length - 1].t > GAP_MS) tr.length = 0;
    tr.push(pt);
    if (tr.length > TRACK_MAX) tr.shift();

    const c = tr.length - 3;
    if (c < 2) return null;
    if (pt.t - this.lastHitT < COOLDOWN_MS) return null;

    const a = tr[c - 2], p = tr[c], b = tr[c + 2];
    if (a.t <= this.rejectedT) return null;
    const inX = p.x - a.x, inY = p.y - a.y, outX = b.x - p.x, outY = b.y - p.y;
    const inLen = Math.hypot(inX, inY), outLen = Math.hypot(outX, outY);
    if (inLen < params.minMove || outLen < params.minMove) return null;
    const cos = (inX * outX + inY * outY) / (inLen * outLen);
    const turn = (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI;

    // The ball looks smallest at the wall (farthest from the camera). Shrinking on both sides
    // means it is still flying toward the wall: an arc seen in perspective, not a bounce.
    const sizeBefore = (tr[c - 2].size + tr[c - 1].size) / 2;
    const sizeAfter = (tr[c + 1].size + tr[c + 2].size) / 2;
    if (sizeBefore > p.size * SHRINK_RATIO && sizeAfter * SHRINK_RATIO < p.size) return null;

    // Seen from behind, a bounce may not turn the path at all: the ball can pass straight through
    // the contact point in the image and only change speed. Accept a sharp speed change when the
    // ball looks smallest there.
    const smallest = sizeBefore >= p.size * SMALLEST_RATIO && sizeAfter >= p.size * SMALLEST_RATIO;
    const speedJump = Math.max(inLen, outLen) / Math.min(inLen, outLen);
    if (turn < params.turnAngle && !(smallest && speedJump >= SPEED_JUMP)) return null;

    const hit = hitPoint(tr, c, 1.5 * Math.max(inLen, outLen));
    if (params.sizeCheck) {
      if (p.size > sizeBefore * SIZE_RATIO && p.size > sizeAfter * SIZE_RATIO) {
        return this.reject('ball looked bigger (paddle)', hit, p);
      }
    }
    const { w, h } = params.bounds;
    const tolX = w * BOUNDS_TOL, tolY = h * BOUNDS_TOL;
    if (hit.x < -tolX || hit.x > w + tolX || hit.y < -tolY || hit.y > h + tolY) {
      return this.reject('outside wall', hit, p);
    }
    this.lastHitT = pt.t;
    return { x: hit.x, y: hit.y, t: p.t, detectedAt: pt.t, method: hit.method, turn };
  }
}
