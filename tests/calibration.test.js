import test from 'node:test';
import assert from 'node:assert/strict';
import { findDots, orderCorners } from '../js/calibration.js';

test('finds 4 projected dots and orders them TL, TR, BR, BL', () => {
  const w = 160, h = 120;
  const A = new Float32Array(w * h).fill(20);
  const B = new Float32Array(w * h).fill(22);
  const centres = [[30, 20], [130, 25], [125, 100], [35, 95]];
  // Ambient noise blob that is not in the dot frame difference: a static bright patch in both.
  for (let i = 0; i < 40; i++) { A[60 * w + 80 + i % 5] = 200; B[60 * w + 80 + i % 5] = 200; }
  for (const [cx, cy] of centres) {
    for (let y = cy - 3; y <= cy + 3; y++) for (let x = cx - 3; x <= cx + 3; x++) {
      if ((x - cx) ** 2 + (y - cy) ** 2 <= 9) B[y * w + x] = 180;
    }
  }
  const blobs = findDots(A, B, w, h);
  assert.equal(blobs.length, 4);
  const ordered = orderCorners(blobs.map((b) => [b.x, b.y]));
  ordered.forEach(([x, y], i) => {
    assert.ok(Math.abs(x - 0.5 - centres[i][0]) < 1 && Math.abs(y - 0.5 - centres[i][1]) < 1);
  });
});

test('reports fewer than 4 when dots are missing', () => {
  const w = 50, h = 50;
  const A = new Float32Array(w * h);
  const B = new Float32Array(w * h);
  B[10 * w + 10] = B[10 * w + 11] = B[11 * w + 10] = B[11 * w + 11] = 200;
  assert.equal(findDots(A, B, w, h).length, 1);
});
