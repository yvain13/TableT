import test from 'node:test';
import assert from 'node:assert/strict';
import { solveHomography, applyH, invertH, isConvexQuad } from '../js/homography.js';

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

test('maps the 4 source points onto the 4 destination points', () => {
  const src = [[0.21, 0.18], [0.83, 0.22], [0.78, 0.86], [0.17, 0.79]];
  const dst = [[0.1, 0.1], [0.9, 0.1], [0.9, 0.9], [0.1, 0.9]];
  const H = solveHomography(src, dst);
  src.forEach(([x, y], i) => {
    const [u, v] = applyH(H, x, y);
    close(u, dst[i][0]);
    close(v, dst[i][1]);
  });
});

test('inverse round-trips points', () => {
  const H = solveHomography([[0, 0], [1, 0.1], [0.9, 1], [0.05, 0.8]], [[0, 0], [1, 0], [1, 1], [0, 1]]);
  const Hi = invertH(H);
  for (const [x, y] of [[0.3, 0.4], [0.7, 0.2], [0.5, 0.9]]) {
    const [u, v] = applyH(H, x, y);
    const [x2, y2] = applyH(Hi, u, v);
    close(x2, x);
    close(y2, y);
  }
});

test('degenerate input returns null', () => {
  assert.equal(solveHomography([[0, 0], [0.5, 0.5], [1, 1], [0.25, 0.25]], [[0, 0], [1, 0], [1, 1], [0, 1]]), null);
});

test('convexity check rejects crossed taps', () => {
  assert.ok(isConvexQuad([[0, 0], [1, 0], [1, 1], [0, 1]]));
  assert.ok(!isConvexQuad([[0, 0], [1, 1], [1, 0], [0, 1]]));
});
