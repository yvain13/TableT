// Targets, hit test, score and animations, drawn on a full-screen canvas.

import {
  TARGET_COUNT, HIT_MARGIN_CM, RESPAWN_MS, TIERS, BOUNDARY_CM, BOUNDARY_COLOR, OUT_COLOR, BOUNDARY_PULSE_MS,
} from './config.js';

// Closest-fitting target: within radius + margin; when two qualify, the smaller wins.
export function hitTest(targets, x, y, marginPx) {
  let best = null;
  for (const t of targets) {
    if (Math.hypot(x - t.x, y - t.y) < t.r + marginPx && (!best || t.r < best.r)) best = t;
  }
  return best;
}

export function pickTier(rand = Math.random) {
  let u = rand();
  for (const tier of TIERS) {
    if (u < tier.share) return tier;
    u -= tier.share;
  }
  return TIERS[TIERS.length - 1];
}

// Random spot for a circle of radius r with no overlap, a margin from the edges, and outside avoid rects.
export function placeTarget(existing, r, W, H, { margin = 0, gap = 0, avoid = [], rand = Math.random, tries = 200 } = {}) {
  const lo = margin + r;
  if (W - 2 * lo <= 0 || H - 2 * lo <= 0) return null;
  for (let i = 0; i < tries; i++) {
    const x = lo + rand() * (W - 2 * lo);
    const y = lo + rand() * (H - 2 * lo);
    if (existing.some((t) => Math.hypot(t.x - x, t.y - y) < t.r + r + gap)) continue;
    if (avoid.some((a) => x + r > a.x && x - r < a.x + a.w && y + r > a.y && y - r < a.y + a.h)) continue;
    return { x, y };
  }
  return null;
}

// Radius of a tier's circles: fixed per tier; only the largest tier is capped on a small wall.
export function tierRadius(tier, pxPerCm, W, H) {
  return Math.min((tier.cm * pxPerCm) / 2, Math.min(W, H) * 0.16);
}

const easeOutBack = (t) => 1 + 2.70158 * (t - 1) ** 3 + 1.70158 * (t - 1) ** 2;

export class Game {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.targets = [];
    this.effects = [];
    this.spawnQueue = [];
    this.score = 0;
    this.scoreBump = 0;
    this.paused = false;
    this.wallWidthCm = 180;
    this.showBallDot = false;
    this.ball = null;
    this.rand = Math.random;
    this.nextId = 1;
    this.resize();
  }

  get pxPerCm() { return this.W / this.wallWidthCm; }

  // Browser bars appearing or hiding resize the page mid-game, so keep the targets that
  // still fit and only replace the ones that no longer do.
  resize() {
    const dpr = window.devicePixelRatio || 1;
    this.W = this.canvas.clientWidth || window.innerWidth;
    this.H = this.canvas.clientHeight || window.innerHeight;
    this.canvas.width = Math.round(this.W * dpr);
    this.canvas.height = Math.round(this.H * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.targets = this.targets.filter((t) => t.x - t.r >= 0 && t.y - t.r >= 0 && t.x + t.r <= this.W && t.y + t.r <= this.H);
    const now = performance.now();
    while (this.targets.length + this.spawnQueue.length < TARGET_COUNT && this.spawn(now));
  }

  setWallWidth(cm) {
    if (cm === this.wallWidthCm) return;
    this.wallWidthCm = cm;
    this.respawnAll();
  }

  // Score corner and settings button stay clear of targets.
  avoidZones() {
    return [this.scoreRect(), { x: 0, y: 0, w: 72, h: 72 }];
  }

  respawnAll() {
    this.targets = [];
    this.spawnQueue = [];
    const now = performance.now();
    for (let i = 0; i < TARGET_COUNT; i++) this.spawn(now);
  }

  get boundaryWidth() { return Math.max(6, BOUNDARY_CM * this.pxPerCm); }

  // Pulse the play-area frame, e.g. when a game starts.
  flashBoundary(now = performance.now()) { this.boundaryFlash = now; }

  // A bounce just outside the play area: flash the nearest edge.
  out(x, y, now = performance.now()) {
    const d = { left: x, right: this.W - x, top: y, bottom: this.H - y };
    const edge = Object.keys(d).reduce((a, b) => (d[a] < d[b] ? a : b));
    this.effects.push({ kind: 'out', edge, x, y, start: now });
  }

  spawn(now) {
    const opts = {
      margin: Math.max(12, this.W * 0.03, this.boundaryWidth * 2),
      gap: this.pxPerCm * 3,
      avoid: this.avoidZones(),
      rand: this.rand,
    };
    // Try the drawn tier first, then smaller tiers if the wall is too crowded.
    const first = pickTier(this.rand);
    const order = [first, ...TIERS.filter((t) => t !== first).sort((a, b) => a.cm - b.cm)];
    for (const tier of order) {
      const r = tierRadius(tier, this.pxPerCm, this.W, this.H);
      const pos = placeTarget(this.targets, r, this.W, this.H, opts);
      if (!pos) continue;
      this.targets.push({
        id: this.nextId++, x: pos.x, y: pos.y, r, tier, points: tier.points, color: tier.color, born: now,
      });
      return true;
    }
    return false;
  }

  // Hit at screen px. Returns the target hit, or null for a miss.
  hit(x, y, now = performance.now()) {
    if (this.paused) return null;
    const t = hitTest(this.targets, x, y, HIT_MARGIN_CM * this.pxPerCm);
    if (!t) {
      this.effects.push({ kind: 'ripple', x, y, start: now });
      return null;
    }
    this.targets = this.targets.filter((o) => o !== t);
    this.score += t.points;
    this.scoreBump = now;
    const shards = [];
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * Math.PI * 2 + this.rand() * 0.3;
      const speed = t.r * (2.2 + this.rand() * 1.6);
      shards.push({ vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, s: 0.08 + this.rand() * 0.08 });
    }
    this.effects.push({ kind: 'burst', x: t.x, y: t.y, r: t.r, color: t.color, shards, start: now });
    this.effects.push({ kind: 'float', x: t.x, y: t.y, text: `+${t.points}`, start: now });
    this.spawnQueue.push(now + RESPAWN_MS);
    return t;
  }

  resetScore() {
    this.score = 0;
    this.respawnAll();
  }

  render(now) {
    const { ctx, W, H } = this;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);

    while (this.spawnQueue.length && this.spawnQueue[0] <= now) {
      this.spawnQueue.shift();
      if (this.targets.length < TARGET_COUNT) this.spawn(now);
    }

    this.drawBoundary(now);
    for (const t of this.targets) this.drawTarget(t, now);
    this.effects = this.effects.filter((e) => this.drawEffect(e, now));
    this.drawScore(now);

    if (this.showBallDot && this.ball && now - this.ball.time < 150) {
      ctx.beginPath();
      ctx.arc(this.ball.x, this.ball.y, Math.max(5, this.pxPerCm * 1.2), 0, Math.PI * 2);
      ctx.fillStyle = '#fff';
      ctx.fill();
    }
    if (this.paused) {
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.font = `700 ${Math.round(H * 0.07)}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('Paused', W / 2, H / 2);
    }
  }

  drawBoundary(now) {
    const { ctx, W, H } = this;
    const bw = this.boundaryWidth;
    const k = (now - (this.boundaryFlash ?? -Infinity)) / BOUNDARY_PULSE_MS;
    const pulse = k >= 0 && k < 1 ? 0.5 + 0.5 * Math.cos(k * Math.PI * 6) : 0;
    ctx.strokeStyle = BOUNDARY_COLOR;
    ctx.globalAlpha = 0.85 + 0.15 * pulse;
    ctx.lineWidth = bw * (1 + pulse);
    ctx.strokeRect(ctx.lineWidth / 2, ctx.lineWidth / 2, W - ctx.lineWidth, H - ctx.lineWidth);
    ctx.globalAlpha = 1;
  }

  drawTarget(t, now) {
    const { ctx } = this;
    const k = Math.min(1, (now - t.born) / 240);
    const s = easeOutBack(k);
    if (s <= 0) return;
    ctx.save();
    ctx.translate(t.x, t.y);
    ctx.scale(s, s);
    ctx.beginPath();
    ctx.arc(0, 0, t.r, 0, Math.PI * 2);
    ctx.fillStyle = t.color;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(0, 0, t.r * 0.66, 0, Math.PI * 2);
    ctx.lineWidth = Math.max(2, t.r * 0.07);
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.stroke();
    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    ctx.font = `800 ${Math.round(t.r * 0.62)}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(t.points), 0, t.r * 0.04);
    ctx.restore();
  }

  // Returns false once the effect has finished.
  drawEffect(e, now) {
    const { ctx } = this;
    const age = now - e.start;
    if (e.kind === 'burst') {
      const life = 520;
      if (age > life) return false;
      const k = age / life;
      const sec = age / 1000;
      ctx.globalAlpha = 1 - k;
      ctx.fillStyle = e.color;
      for (const sh of e.shards) {
        ctx.beginPath();
        ctx.arc(e.x + sh.vx * sec, e.y + sh.vy * sec, e.r * sh.s * (1 - k * 0.5), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.beginPath();
      ctx.arc(e.x, e.y, e.r * (1 + k * 0.8), 0, Math.PI * 2);
      ctx.lineWidth = Math.max(2, e.r * 0.12 * (1 - k));
      ctx.strokeStyle = e.color;
      ctx.stroke();
      ctx.globalAlpha = 1;
      return true;
    }
    if (e.kind === 'float') {
      const life = 800;
      if (age > life) return false;
      const k = age / life;
      ctx.globalAlpha = 1 - k * k;
      ctx.fillStyle = '#fff';
      ctx.font = `800 ${Math.round(this.H * 0.06)}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(e.text, e.x, e.y - k * this.H * 0.08);
      ctx.globalAlpha = 1;
      return true;
    }
    if (e.kind === 'out') {
      const life = 900;
      if (age > life) return false;
      const k = age / life;
      const { W, H } = this;
      const bw = this.boundaryWidth * 2.5;
      const blink = Math.cos(k * Math.PI * 5) > 0 ? 1 : 0.35;
      ctx.globalAlpha = (1 - k) * blink;
      ctx.fillStyle = OUT_COLOR;
      const len = 0.35;
      if (e.edge === 'left' || e.edge === 'right') {
        const y = Math.min(Math.max(e.y, H * len / 2), H * (1 - len / 2));
        ctx.fillRect(e.edge === 'left' ? 0 : W - bw, y - (H * len) / 2, bw, H * len);
      } else {
        const x = Math.min(Math.max(e.x, W * len / 2), W * (1 - len / 2));
        ctx.fillRect(x - (W * len) / 2, e.edge === 'top' ? 0 : H - bw, W * len, bw);
      }
      const size = Math.round(H * 0.08);
      ctx.font = `800 ${size}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const inset = bw + size;
      const tx = e.edge === 'left' ? inset * 1.2 : e.edge === 'right' ? W - inset * 1.2 : Math.min(Math.max(e.x, inset * 2), W - inset * 2);
      const ty = e.edge === 'top' ? inset : e.edge === 'bottom' ? H - inset : Math.min(Math.max(e.y, inset), H - inset);
      ctx.fillText('OUT', tx, ty);
      ctx.globalAlpha = 1;
      return true;
    }
    if (e.kind === 'ripple') {
      const life = 450;
      if (age > life) return false;
      const k = age / life;
      ctx.beginPath();
      ctx.arc(e.x, e.y, this.pxPerCm * (2 + k * 7), 0, Math.PI * 2);
      ctx.lineWidth = 2;
      ctx.strokeStyle = `rgba(255,255,255,${0.35 * (1 - k)})`;
      ctx.stroke();
      return true;
    }
    return false;
  }

  drawScore(now) {
    const { ctx, W, H } = this;
    const bump = Math.max(0, 1 - (now - this.scoreBump) / 220);
    const size = Math.round(H * 0.11 * (1 + 0.15 * bump));
    ctx.fillStyle = '#fff';
    ctx.font = `800 ${size}px system-ui, sans-serif`;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'top';
    ctx.fillText(String(this.score), W - W * 0.03, H * 0.03);
  }

  // Region of the score, used for the hidden pause / reset gestures.
  scoreRect() {
    return { x: this.W * 0.7, y: 0, w: this.W * 0.3, h: this.H * 0.18 };
  }
}
