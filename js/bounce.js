// Detects a wall bounce as a sharp turn in the ball's path, and places the hit where the
// path in and the path out cross, so no frame needs to catch the moment of contact.

import { TRACK_MAX, GAP_MS, COOLDOWN_MS, SIZE_RATIO, BOUNDS_TOL } from './config.js';

const MIN_CROSS_SIN = Math.sin((10 * Math.PI) / 180); // lines closer than 10° are "near parallel"

// Total least squares line through points: centroid, unit direction, and squared residual.
export function fitLine(pts) {
  const n = pts.length;
  let mx = 0, my = 0;
  for (const p of pts) { mx += p.x; my += p.y; }
  mx /= n; my /= n;
  let sxx = 0, syy = 0, sxy = 0;
  for (const p of pts) {
    const dx = p.x - mx, dy = p.y - my;
    sxx += dx * dx; syy += dy * dy; sxy += dx * dy;
  }
  const theta = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const dx = Math.cos(theta), dy = Math.sin(theta);
  let resid = 0;
  for (const p of pts) {
    const d = (p.x - mx) * dy - (p.y - my) * dx;
    resid += d * d;
  }
  return { x: mx, y: my, dx, dy, resid };
}

export function intersect(a, b) {
  const denom = a.dx * b.dy - a.dy * b.dx;
  if (Math.abs(denom) < MIN_CROSS_SIN) return null;
  const t = ((b.x - a.x) * b.dy - (b.y - a.y) * b.dx) / denom;
  return { x: a.x + t * a.dx, y: a.y + t * a.dy };
}

// Fit up to 5 points before and after the candidate. The candidate itself may belong to either
// side, so try both splits and keep the one whose lines fit best.
export function hitPoint(track, c, maxDist) {
  const cand = track[c];
  const splits = [
    [track.slice(Math.max(0, c - 4), c + 1), track.slice(c + 1, c + 6)],
    [track.slice(Math.max(0, c - 5), c), track.slice(c, c + 5)],
  ];
  let best = null;
  for (const [before, after] of splits) {
    if (before.length < 2 || after.length < 2) continue;
    const l1 = fitLine(before), l2 = fitLine(after);
    const p = intersect(l1, l2);
    if (!p || Math.hypot(p.x - cand.x, p.y - cand.y) > maxDist) continue;
    const resid = l1.resid + l2.resid;
    if (!best || resid < best.resid) best = { x: p.x, y: p.y, resid };
  }
  return best ? { x: best.x, y: best.y, method: 'lines' } : { x: cand.x, y: cand.y, method: 'candidate' };
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
    if (turn < params.turnAngle) return null;

    const hit = hitPoint(tr, c, 1.5 * Math.max(inLen, outLen));
    const { w, h } = params.bounds;
    const tolX = w * BOUNDS_TOL, tolY = h * BOUNDS_TOL;
    if (hit.x < -tolX || hit.x > w + tolX || hit.y < -tolY || hit.y > h + tolY) {
      return this.reject('outside wall', hit, p);
    }
    if (params.sizeCheck) {
      const before = (tr[c - 2].size + tr[c - 1].size) / 2;
      const after = (tr[c + 1].size + tr[c + 2].size) / 2;
      if (p.size > before * SIZE_RATIO && p.size > after * SIZE_RATIO) {
        return this.reject('ball looked bigger (paddle)', hit, p);
      }
    }
    this.lastHitT = pt.t;
    return { x: hit.x, y: hit.y, t: p.t, detectedAt: pt.t, method: hit.method, turn };
  }
}
