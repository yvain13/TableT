import test from 'node:test';
import assert from 'node:assert/strict';
import { detectBall, computeRoi } from '../js/tracker.js';
import { DEFAULT_PARAMS } from '../js/config.js';

const W = 200, H = 120;
function frame(fill, blobs = []) {
  const d = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) d.set([...fill, 255], i * 4);
  for (const { x, y, r, rgb } of blobs) {
    for (let yy = y - r; yy <= y + r; yy++) for (let xx = x - r; xx <= x + r; xx++) {
      if ((xx - x) ** 2 + (yy - y) ** 2 <= r * r) d.set([...rgb, 255], (yy * W + xx) * 4);
    }
  }
  return d;
}
const ORANGE = [245, 120, 20];
const run = (frames) => {
  const prev = new Int16Array(W * H), mask = new Uint8Array(W * H);
  let out = null;
  frames.forEach((f, i) => { out = detectBall(f, W, H, prev, mask, i > 0, DEFAULT_PARAMS); });
  return out;
};

test('finds a moving orange ball', () => {
  const det = run([frame([40, 40, 45]), frame([40, 40, 45], [{ x: 120, y: 60, r: 5, rgb: ORANGE }])]);
  assert.ok(det);
  assert.ok(Math.abs(det.x - 120.5) < 1 && Math.abs(det.y - 60.5) < 1);
  assert.ok(det.size > 7 && det.size < 13, `size ${det.size}`);
});

test('ignores a static orange object', () => {
  const still = { x: 50, y: 50, r: 6, rgb: ORANGE };
  assert.equal(run([frame([40, 40, 45], [still]), frame([40, 40, 45], [still])]), null);
});

test('ignores moving non-orange colours (cyan target)', () => {
  assert.equal(run([frame([0, 0, 0]), frame([0, 0, 0], [{ x: 100, y: 60, r: 8, rgb: [0, 229, 255] }])]), null);
});

test('streak width, not length, is the size', () => {
  const blobs = [];
  for (let x = 60; x <= 100; x += 2) blobs.push({ x, y: 60, r: 4, rgb: ORANGE });
  const det = run([frame([30, 30, 30]), frame([30, 30, 30], blobs)]);
  assert.ok(det.size < 12 && det.length > det.size * 2, `size ${det.size} length ${det.length}`);
});

test('region of interest pads the wall area by 10% and clamps', () => {
  const identity = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  assert.deepEqual(computeRoi(identity), { x: 0, y: 0, w: 1, h: 1 });
  // Wall seen in the middle half of the camera: screen -> cam maps [0, 1] to [0.25, 0.75].
  const roi = computeRoi([0.5, 0, 0.25, 0, 0.5, 0.25, 0, 0, 1]);
  for (const [k, v] of Object.entries({ x: 0.2, y: 0.2, w: 0.6, h: 0.6 })) assert.ok(Math.abs(roi[k] - v) < 1e-9, k);
});
