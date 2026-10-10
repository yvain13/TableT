import test from 'node:test';
import assert from 'node:assert/strict';
import { BounceDetector, fitMotion, meetPoint } from '../js/bounce.js';

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
  assert.equal(hits[0].method, 'paths');
});

test('ball straight in and back out along the camera line: hit lands on the contact point', () => {
  // Camera behind the players: in the image the ball shrinks toward the contact point and comes
  // back along nearly the same line, slower after the bounce, touching between two frames.
  for (const offset of [0.2, 0.5, 0.8]) {
    const b = new BounceDetector();
    const pts = path({ inV: [24, -30], outV: [-17, 22.5], offset, size: (t) => 10 + Math.abs(t) * 0.6 });
    const hits = pts.map((p) => b.push(p, params)).filter(Boolean);
    assert.equal(hits.length, 1, `offset ${offset}`);
    assert.ok(Math.hypot(hits[0].x - 500, hits[0].y - 400) < 2, `offset ${offset}: ${JSON.stringify(hits[0])}`);
  }
});

test('ball passing straight through the contact point in the image, speeding up: still a bounce', () => {
  // Comes in below the camera's height and leaves above it: no turn, only a speed change,
  // and the ball looks smallest at the wall.
  const b = new BounceDetector();
  const pts = path({ inV: [6, -8], outV: [18, -24], offset: 0.5, size: (t) => 10 + Math.abs(t) * 0.8 });
  const hits = pts.map((p) => b.push(p, params)).filter(Boolean);
  assert.equal(hits.length, 1);
  assert.ok(Math.hypot(hits[0].x - 500, hits[0].y - 400) < 3, JSON.stringify(hits[0]));
});

test('a ball still flying toward the wall (shrinking) is not a bounce, even on a sharp arc', () => {
  const b = new BounceDetector();
  const pts = path({ size: (t) => 20 - (t + 6) * 0.9 }); // shrinks the whole way
  assert.equal(pts.map((p) => b.push(p, params)).filter(Boolean).length, 0);
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

test('motion fit and meeting point', () => {
  const m1 = fitMotion([{ t: 0, x: 0, y: 0 }, { t: 1, x: 1, y: 2 }, { t: 2, x: 2, y: 4 }]);
  assert.ok(Math.abs(m1.vx - 1) < 1e-9 && Math.abs(m1.vy - 2) < 1e-9 && m1.resid < 1e-9);
  // In: reaches (3, 6) at t = 3. Out: leaves (3, 6) at t = 3 heading back, slower.
  const m2 = fitMotion([{ t: 4, x: 2.5, y: 5 }, { t: 5, x: 2, y: 4 }]);
  const p = meetPoint(m1, m2, 2, 4);
  assert.ok(Math.abs(p.x - 3) < 1e-9 && Math.abs(p.y - 6) < 1e-9 && Math.abs(p.t - 3) < 1e-9, JSON.stringify(p));
});
