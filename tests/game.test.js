import test from 'node:test';
import assert from 'node:assert/strict';
import { hitTest, pickTier, placeTarget, tierRadius } from '../js/game.js';
import { TIERS } from '../js/config.js';

test('hit within radius plus margin; smaller target wins', () => {
  const big = { x: 100, y: 100, r: 50 }, small = { x: 130, y: 100, r: 10 };
  assert.equal(hitTest([big, small], 132, 100, 5), small);
  assert.equal(hitTest([big], 154, 100, 5), big);
  assert.equal(hitTest([big], 156, 100, 5), null);
});

test('tier shares follow the spec', () => {
  let seed = 1;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const counts = { small: 0, medium: 0, large: 0 };
  for (let i = 0; i < 20000; i++) counts[pickTier(rand).name]++;
  for (const t of TIERS) assert.ok(Math.abs(counts[t.name] / 20000 - t.share) < 0.02, t.name);
});

test('each tier has one size, and higher points are always smaller', () => {
  const [small, medium, large] = TIERS;
  for (const [W, H] of [[1024, 768], [844, 390]]) {
    const pxPerCm = W / 180;
    const r = TIERS.map((t) => tierRadius(t, pxPerCm, W, H));
    assert.deepEqual(r, TIERS.map((t) => tierRadius(t, pxPerCm, W, H)));
    assert.ok(r[0] < r[1] && r[1] < r[2], `${W}x${H}: ${r}`);
    assert.ok(r[0] * 2 >= 10 * pxPerCm, 'small never under 10 cm');
  }
  assert.ok(small.points > medium.points && medium.points > large.points);
  assert.equal(new Set(TIERS.map((t) => t.color)).size, 3);
});

test('placement never overlaps, respects edges and avoid zones', () => {
  const placed = [];
  const avoid = [{ x: 700, y: 0, w: 300, h: 130 }];
  for (let i = 0; i < 6; i++) {
    const r = 40 + i * 5;
    const p = placeTarget(placed, r, 1000, 750, { margin: 20, gap: 5, avoid });
    assert.ok(p);
    placed.push({ ...p, r });
  }
  for (const a of placed) {
    assert.ok(a.x - a.r >= 20 && a.x + a.r <= 980 && a.y - a.r >= 20 && a.y + a.r <= 730);
    assert.ok(!(a.x + a.r > 700 && a.y - a.r < 130));
    for (const b of placed) if (a !== b) assert.ok(Math.hypot(a.x - b.x, a.y - b.y) >= a.r + b.r + 5);
  }
});
