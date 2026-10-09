import test from 'node:test';
import assert from 'node:assert/strict';
import { BounceDetector, fitLine, intersect } from '../js/bounce.js';

const params = { turnAngle: 70, minMove: 6, sizeCheck: true, bounds: { w: 1000, h: 750 } };

// Ball travels in toward (cx, cy) then back out, sampled every dt ms; contact falls between frames.
function path({ cx = 500, cy = 400, inV = [30, -20], outV = [-15, 30], frames = 6, dt = 16.7, offset = 0.4, size = () => 10 } = {}) {
  const pts = [];
  for (let k = -frames; k <= frames; k++) {
    const s = k + offset; // contact at s = 0
    const v = s < 0 ? inV : outV;
    pts.push({ t: 1000 + (k + frames) * dt, x: cx + v[0] * s, y: cy + v[1] * s, size: size(s) });
  }
  return pts;
}

test('detects a wall bounce and places the hit where the paths cross', () => {
  const b = new BounceDetector();
  const hits = path().map((p) => b.push(p, params)).filter(Boolean);
  assert.equal(hits.length, 1);
  assert.ok(Math.hypot(hits[0].x - 500, hits[0].y - 400) < 1, JSON.stringify(hits[0]));
  assert.equal(hits[0].method, 'lines');
});

test('straight flight is not a bounce', () => {
  const b = new BounceDetector();
  const hits = path({ outV: [30, -20] }).map((p) => b.push(p, params)).filter(Boolean);
  assert.equal(hits.length, 0);
});

test('a bounce outside the wall (floor) is rejected', () => {
  const b = new BounceDetector();
  const hits = path({ cy: 900 }).map((p) => b.push(p, params)).filter(Boolean);
  assert.equal(hits.length, 0);
  assert.equal(b.lastReject.reason, 'outside wall');
});

test('a turn where the ball looks biggest (paddle) is rejected', () => {
  const b = new BounceDetector();
  const hits = path({ offset: 0, size: (s) => 22 - Math.abs(s) * 3 }).map((p) => b.push(p, params)).filter(Boolean);
  assert.equal(hits.length, 0);
  const b2 = new BounceDetector();
  const hits2 = path({ offset: 0, size: (s) => 22 - Math.abs(s) * 3 })
    .map((p) => b2.push(p, { ...params, sizeCheck: false })).filter(Boolean);
  assert.equal(hits2.length, 1);
});

test('a gap over 160 ms resets the track', () => {
  const b = new BounceDetector();
  const pts = path();
  pts.forEach((p, i) => { if (i > 6) p.t += 200; });
  assert.equal(pts.map((p) => b.push(p, params)).filter(Boolean).length, 0);
});

test('two bounces within 250 ms count once', () => {
  const b = new BounceDetector();
  const first = path();
  const second = path({ cx: 600, cy: 300 }).map((p) => ({ ...p, t: p.t + 100 }));
  // Join them so the track continues without a gap.
  const hits = [...first, ...second.filter((p) => p.t > first[first.length - 1].t)].map((p) => b.push(p, params)).filter(Boolean);
  assert.equal(hits.length, 1);
});

test('line fit and intersection', () => {
  const l1 = fitLine([{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 }]);
  const l2 = fitLine([{ x: 0, y: 2 }, { x: 2, y: 0 }]);
  const p = intersect(l1, l2);
  assert.ok(Math.abs(p.x - 1) < 1e-9 && Math.abs(p.y - 1) < 1e-9);
  assert.equal(intersect(l1, fitLine([{ x: 0, y: 1 }, { x: 1, y: 2 }])), null);
});
