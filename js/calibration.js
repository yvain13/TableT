// Calibration: project 4 dots, find them in the camera, and solve the camera -> screen homography.
// Falls back to tapping the dots in the live camera view, and ends on a grid check.

import { CAL_DOTS, PROC_WIDTH } from './config.js';
import { solveHomography, invertH, applyH, isConvexQuad } from './homography.js';
import { CameraView } from './cameraview.js';

const CORNER_NAMES = ['top-left', 'top-right', 'bottom-right', 'bottom-left'];

// Connected bright blobs in (B - A), largest first. A, B: per-pixel green values, w x h.
export function findDots(A, B, w, h, { minThresh = 35, relThresh = 0.35, minArea = 3 } = {}) {
  const n = w * h;
  const diff = new Float32Array(n);
  let max = 0;
  for (let i = 0; i < n; i++) {
    const d = B[i] - A[i];
    diff[i] = d;
    if (d > max) max = d;
  }
  const thresh = Math.max(minThresh, max * relThresh);
  const seen = new Uint8Array(n);
  const stack = new Int32Array(n);
  const blobs = [];
  for (let start = 0; start < n; start++) {
    if (seen[start] || diff[start] < thresh) continue;
    let top = 0, area = 0, sx = 0, sy = 0;
    stack[top++] = start;
    seen[start] = 1;
    while (top) {
      const i = stack[--top];
      const x = i % w, y = (i / w) | 0;
      area++; sx += x; sy += y;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= w) continue;
          const j = yy * w + xx;
          if (!seen[j] && diff[j] >= thresh) { seen[j] = 1; stack[top++] = j; }
        }
      }
    }
    if (area >= minArea) blobs.push({ x: sx / area + 0.5, y: sy / area + 0.5, area });
  }
  return blobs.sort((a, b) => b.area - a.area).slice(0, 4);
}

// Order 4 points as top-left, top-right, bottom-right, bottom-left. Null if ambiguous.
export function orderCorners(pts) {
  if (pts.length !== 4) return null;
  const by = (f, pick) => pts.reduce((best, p) => (pick(f(p), f(best)) ? p : best));
  const tl = by((p) => p[0] + p[1], (a, b) => a < b);
  const br = by((p) => p[0] + p[1], (a, b) => a > b);
  const tr = by((p) => p[0] - p[1], (a, b) => a > b);
  const bl = by((p) => p[0] - p[1], (a, b) => a < b);
  const out = [tl, tr, br, bl];
  return new Set(out).size === 4 ? out : null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const nextPaint = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

export class Calibrator {
  constructor({ camera, screen, canvas, center, msg, buttons, onDone, onCancel }) {
    Object.assign(this, { camera, screen, canvas, center, msg, buttons, onDone, onCancel });
    this.ctx = canvas.getContext('2d');
    this.view = new CameraView(center);
    this.grab = document.createElement('canvas');
    this.grabCtx = this.grab.getContext('2d', { willReadFrequently: true });
    this.token = 0;
    this.taps = [];
    this.view.el.addEventListener('pointerdown', (e) => this.onTap(e));
  }

  open() {
    this.screen.hidden = false;
    this.auto();
  }

  close() {
    this.token++;
    this.screen.hidden = true;
  }

  sizeCanvas() {
    const dpr = window.devicePixelRatio || 1;
    this.W = this.canvas.clientWidth || window.innerWidth;
    this.H = this.canvas.clientHeight || window.innerHeight;
    this.canvas.width = Math.round(this.W * dpr);
    this.canvas.height = Math.round(this.H * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  showUi(on) {
    this.center.hidden = !on;
    this.msg.parentElement.hidden = !on;
  }

  setButtons(list) {
    this.buttons.replaceChildren(...list.map(([label, fn, primary]) => {
      const b = document.createElement('button');
      b.textContent = label;
      if (primary) b.className = 'primary';
      b.addEventListener('click', fn);
      return b;
    }));
  }

  // Fit the camera view into the space the message and buttons leave free.
  layoutView() {
    this.view.attach(this.camera.stream);
    const ui = this.center.parentElement;
    const bar = this.msg.parentElement;
    const maxH = ui.clientHeight - bar.offsetHeight - 30;
    this.view.layout(this.camera.aspect, ui.clientWidth, Math.max(80, maxH));
  }

  drawBlack() {
    this.ctx.fillStyle = '#000';
    this.ctx.fillRect(0, 0, this.W, this.H);
  }

  drawDots() {
    this.drawBlack();
    const r = Math.min(this.W, this.H) * 0.035;
    this.ctx.fillStyle = '#00ff00';
    for (const [x, y] of CAL_DOTS) {
      this.ctx.beginPath();
      this.ctx.arc(x * this.W, y * this.H, r, 0, Math.PI * 2);
      this.ctx.fill();
    }
  }

  drawGrid() {
    const { ctx, W, H } = this;
    this.drawBlack();
    ctx.strokeStyle = '#00e5ff';
    ctx.lineWidth = 2;
    for (let k = 0; k <= 10; k++) {
      const x = Math.min(W - 1, Math.max(1, (k / 10) * W));
      const y = Math.min(H - 1, Math.max(1, (k / 10) * H));
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    }
  }

  // Average n camera frames' green channel at processing resolution.
  async captureGreen(n) {
    const v = this.camera.video;
    const scale = Math.min(1, PROC_WIDTH / v.videoWidth);
    const w = Math.round(v.videoWidth * scale), h = Math.round(v.videoHeight * scale);
    this.grab.width = w;
    this.grab.height = h;
    const sum = new Float32Array(w * h);
    for (let k = 0; k < n; k++) {
      await this.camera.nextFrame();
      this.grabCtx.drawImage(v, 0, 0, w, h);
      const d = this.grabCtx.getImageData(0, 0, w, h).data;
      for (let i = 0, j = 1; i < sum.length; i++, j += 4) sum[i] += d[j];
    }
    for (let i = 0; i < sum.length; i++) sum[i] /= n;
    return { data: sum, w, h };
  }

  async auto() {
    const tok = ++this.token;
    this.sizeCanvas();
    this.showUi(false);
    if (!this.camera.running) {
      this.manualUnavailable();
      return;
    }
    this.drawBlack();
    await nextPaint();
    await sleep(700);
    if (tok !== this.token) return;
    const A = await this.captureGreen(3);
    if (tok !== this.token) return;
    this.drawDots();
    await nextPaint();
    await sleep(500);
    if (tok !== this.token) return;
    const B = await this.captureGreen(3);
    if (tok !== this.token) return;

    const blobs = findDots(A.data, B.data, A.w, A.h);
    const ordered = blobs.length === 4 ? orderCorners(blobs.map((b) => [b.x / A.w, b.y / A.h])) : null;
    const H = ordered && isConvexQuad(ordered) ? solveHomography(ordered, CAL_DOTS) : null;
    if (H && invertH(H)) this.check(H, ordered, 'Found all 4 dots.');
    else if (blobs.length < 4) this.manual(`Auto found ${blobs.length} of 4 dots. Tap them yourself.`);
    else this.manual('Auto found 4 bright spots, but they are not the 4 corners. Tap the dots yourself.');
  }

  manualUnavailable() {
    this.drawBlack();
    this.showUi(true);
    this.center.hidden = true;
    this.msg.textContent = 'The camera is not running, so calibration cannot start.';
    this.setButtons([['Back', () => this.onCancel(), true]]);
  }

  manual(note = '') {
    this.token++;
    this.mode = 'manual';
    this.taps = [];
    this.note = note;
    this.sizeCanvas();
    this.drawDots();
    this.showUi(true);
    this.setButtons([
      ['Undo', () => { this.taps.pop(); this.drawManual(); }],
      ['Retry auto', () => this.auto()],
      ['Cancel', () => this.onCancel()],
    ]);
    this.drawManual(); // sets the message, so the view can size around it
    this.layoutView();
    this.drawManual();
  }

  drawManual() {
    const v = this.view;
    v.clear();
    this.taps.forEach(([x, y], i) => {
      v.dot(x, y, 7, '#00e676');
      v.label(String(i + 1), x, y, '#00e676');
    });
    if (this.taps.length > 1) v.line(this.taps, '#00e676', 2, this.taps.length === 4);
    const next = CORNER_NAMES[this.taps.length];
    this.msg.textContent = `${this.note} In the camera view, tap the ${next} dot (${this.taps.length + 1} of 4).`.trim();
  }

  onTap(e) {
    if (this.mode !== 'manual') return;
    e.preventDefault();
    this.taps.push(this.view.toNorm(e));
    if (this.taps.length < 4) {
      this.drawManual();
      return;
    }
    const pts = this.taps;
    const H = isConvexQuad(pts) ? solveHomography(pts, CAL_DOTS) : null;
    if (H && invertH(H)) {
      this.check(H, pts, 'Corners set by hand.');
    } else {
      this.note = 'Those taps cross over. Start again, in order.';
      this.taps = [];
      this.drawManual();
    }
  }

  check(H, camPts, note) {
    this.token++;
    this.mode = 'check';
    this.sizeCanvas();
    this.drawGrid();
    this.showUi(true);
    this.msg.textContent = `${note} The green grid in the camera view should sit on the projected cyan grid.`;
    this.setButtons([
      ['Looks right: play', () => this.onDone(H, camPts), true],
      ['Redo auto', () => this.auto()],
      ['Tap corners', () => this.manual()],
    ]);
    this.layoutView();
    const Hinv = invertH(H);
    const v = this.view;
    v.clear();
    for (let k = 0; k <= 10; k++) {
      const u = k / 10;
      v.line([applyH(Hinv, u, 0), applyH(Hinv, u, 1)], 'rgba(0,230,118,0.9)', 1.5);
      v.line([applyH(Hinv, 0, u), applyH(Hinv, 1, u)], 'rgba(0,230,118,0.9)', 1.5);
    }
    camPts.forEach(([x, y]) => v.dot(x, y, 6, '#b05cff'));
  }
}
