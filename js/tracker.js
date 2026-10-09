// Finds the orange, moving ball in each camera frame and maps it to screen coordinates.

import { CELL, WINDOW, PROC_WIDTH, ROI_MARGIN } from './config.js';
import { applyH, invertH } from './homography.js';

// Pure per-pixel detector.
// The orange level is (red - blue) / (red + green + blue): a ratio, so a shadow (which dims a
// pixel without changing its colour) leaves it unchanged, while a passing orange ball raises it.
// data: RGBA pixels (w x h). prev: Float32Array of last frame's orange level, updated in place.
// mask: Uint8Array output, 1 where a pixel is orange and newly orange. hasPrev: false on the first frame.
// Returns { x, y, n, size, length, angle } in pixel coords of this image, or null.
export function detectBall(data, w, h, prev, mask, hasPrev, p) {
  const cols = Math.ceil(w / CELL);
  const rows = Math.ceil(h / CELL);
  const cells = new Uint16Array(cols * rows);
  const minR = p.minVal * 255;
  const { minSat, hueMin, hueMax, motionThresh } = p;

  for (let y = 0, i = 0; y < h; y++) {
    const rowCell = ((y / CELL) | 0) * cols;
    for (let x = 0; x < w; x++, i++) {
      const j = i << 2;
      const r = data[j], g = data[j + 1], b = data[j + 2];
      const level = (r - b) / (r + g + b + 1);
      const old = prev[i];
      prev[i] = level;
      mask[i] = 0;
      if (!hasPrev || level - old < motionThresh) continue;
      if (r < g || r < b || r < minR) continue;
      const d = r - (g < b ? g : b);
      if (d === 0 || d < minSat * r) continue;
      const hue = (60 * (g - b)) / d; // red is max, so hue is in (-60, 60]
      if (hue < hueMin || hue > hueMax) continue;
      mask[i] = 1;
      cells[rowCell + ((x / CELL) | 0)]++;
    }
  }

  let best = -1, bestCount = 0;
  for (let k = 0; k < cells.length; k++) {
    if (cells[k] > bestCount) { bestCount = cells[k]; best = k; }
  }
  if (best < 0) return null;

  const cx = (best % cols) * CELL + CELL / 2;
  const cy = ((best / cols) | 0) * CELL + CELL / 2;
  const half = WINDOW / 2;
  const x0 = Math.max(0, cx - half), x1 = Math.min(w, cx + half);
  const y0 = Math.max(0, cy - half), y1 = Math.min(h, cy + half);
  let n = 0, sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0, i = y * w + x0; x < x1; x++, i++) {
      if (!mask[i]) continue;
      n++; sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y;
    }
  }
  if (n < p.minBlob) return null;

  const mx = sx / n, my = sy / n;
  const vxx = sxx / n - mx * mx, vyy = syy / n - my * my, vxy = sxy / n - mx * my;
  // Eigenvalues of the covariance: the streak's long axis and its width.
  const tr = vxx + vyy;
  const disc = Math.sqrt(Math.max(0, (tr * tr) / 4 - (vxx * vyy - vxy * vxy)));
  const major = tr / 2 + disc;
  const minor = Math.max(tr / 2 - disc, 0.25);
  return {
    x: mx + 0.5,
    y: my + 0.5,
    n,
    size: 4 * Math.sqrt(minor),   // streak width ~ ball diameter, unaffected by motion blur
    length: 4 * Math.sqrt(major),
    angle: 0.5 * Math.atan2(2 * vxy, vxx - vyy),
  };
}

// Camera-space bounding box of the calibrated wall, plus a margin, in normalised camera coords.
export function computeRoi(Hinv) {
  if (!Hinv) return { x: 0, y: 0, w: 1, h: 1 };
  const pts = [[0, 0], [1, 0], [1, 1], [0, 1]].map(([x, y]) => applyH(Hinv, x, y));
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  let x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const mx = (x1 - x0) * ROI_MARGIN, my = (y1 - y0) * ROI_MARGIN;
  x0 = Math.max(0, x0 - mx); y0 = Math.max(0, y0 - my);
  x1 = Math.min(1, x1 + mx); y1 = Math.min(1, y1 + my);
  if (!(x1 > x0 && y1 > y0)) return { x: 0, y: 0, w: 1, h: 1 };
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

export class Tracker {
  constructor() {
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
    this.H = null;
    this.Hinv = null;
    this.roi = { x: 0, y: 0, w: 1, h: 1 };
    this.prev = null;
    this.mask = null;
    this.hasPrev = false;
    this.w = 0;
    this.h = 0;
  }

  // H maps normalised camera coords to normalised screen coords.
  setCalibration(H) {
    this.H = H;
    this.Hinv = H ? invertH(H) : null;
    this.roi = computeRoi(this.Hinv);
    this.hasPrev = false;
  }

  reset() { this.hasPrev = false; }

  // Returns { camX, camY, sx, sy, size, n, angle } (cam and screen coords normalised 0..1) or null.
  process(video, params) {
    const vw = video.videoWidth, vh = video.videoHeight;
    if (!vw || !this.H) return null;
    const scale = Math.min(1, PROC_WIDTH / vw);
    const { roi } = this;
    const sx = roi.x * vw, sy = roi.y * vh, sw = roi.w * vw, sh = roi.h * vh;
    const w = Math.max(1, Math.round(sw * scale));
    const h = Math.max(1, Math.round(sh * scale));
    if (w !== this.w || h !== this.h) {
      this.canvas.width = this.w = w;
      this.canvas.height = this.h = h;
      this.prev = new Float32Array(w * h);
      this.mask = new Uint8Array(w * h);
      this.hasPrev = false;
    }
    this.ctx.drawImage(video, sx, sy, sw, sh, 0, 0, w, h);
    const img = this.ctx.getImageData(0, 0, w, h);
    const det = detectBall(img.data, w, h, this.prev, this.mask, this.hasPrev, params);
    this.hasPrev = true;
    if (!det) return null;
    const camX = roi.x + (det.x / w) * roi.w;
    const camY = roi.y + (det.y / h) * roi.h;
    const [scrX, scrY] = applyH(this.H, camX, camY);
    return { camX, camY, sx: scrX, sy: scrY, size: det.size, n: det.n, angle: det.angle };
  }
}
