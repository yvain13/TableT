// Settings overlay: live camera view with tracker overlays, tuning sliders, toggles and readouts.

import { DEFAULT_PARAMS } from './config.js';
import { applyH } from './homography.js';
import { CameraView } from './cameraview.js';

const SLIDERS = [
  { key: 'hueMin', label: 'Hue min', min: -20, max: 60, step: 1, unit: '°' },
  { key: 'hueMax', label: 'Hue max', min: 0, max: 60, step: 1, unit: '°' },
  { key: 'minSat', label: 'Min saturation', min: 0, max: 1, step: 0.01 },
  { key: 'minVal', label: 'Min brightness', min: 0, max: 1, step: 0.01 },
  { key: 'motionThresh', label: 'Motion threshold', min: 0, max: 120, step: 1 },
  { key: 'minBlob', label: 'Min blob size', min: 1, max: 80, step: 1, unit: ' px' },
  { key: 'turnAngle', label: 'Turn angle', min: 30, max: 150, step: 1, unit: '°' },
  { key: 'minMove', label: 'Min move', min: 1, max: 40, step: 1, unit: ' px' },
  { key: 'wallWidthCm', label: 'Projected width', min: 50, max: 500, step: 5, unit: ' cm' },
];

const TOGGLES = [
  { key: 'sizeCheck', label: 'Size check (reject paddle hits)' },
  { key: 'showBallDot', label: 'Show ball dot on wall' },
  { key: 'testMode', label: 'Test mode: tap = hit' },
];

function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  Object.assign(e, attrs);
  e.append(...children);
  return e;
}

export class SettingsPanel {
  // hooks: onChange(params), onRecalibrate(), onResetScore(), onClose(), getStats(), getDebug()
  constructor(root, params, hooks) {
    this.root = root;
    this.params = params;
    this.hooks = hooks;
    this.inputs = {};
    this.isOpen = false;
    this.overlayCanvas = document.createElement('canvas');
    this.overlayCtx = this.overlayCanvas.getContext('2d');
    this.build();
  }

  build() {
    const viewWrap = el('div', { className: 'settings-view' });
    this.view = new CameraView(viewWrap);
    this.readouts = el('div', { className: 'readouts' });

    const sliders = SLIDERS.map((s) => {
      const out = el('output');
      const input = el('input', { type: 'range', min: s.min, max: s.max, step: s.step });
      input.addEventListener('input', () => {
        this.params[s.key] = Number(input.value);
        out.textContent = this.format(s);
        this.hooks.onChange(this.params);
      });
      this.inputs[s.key] = { input, out, spec: s };
      return el('label', { className: 'slider' }, el('span', {}, s.label, ' ', out), input);
    });

    const toggles = TOGGLES.map((t) => {
      const input = el('input', { type: 'checkbox' });
      input.addEventListener('change', () => {
        this.params[t.key] = input.checked;
        this.hooks.onChange(this.params);
      });
      this.inputs[t.key] = { input };
      return el('label', { className: 'toggle' }, input, el('span', {}, t.label));
    });

    const button = (label, fn, cls = '') => {
      const b = el('button', { textContent: label, className: cls });
      b.addEventListener('click', fn);
      return b;
    };

    const defaults = () => {
      const keep = this.params.wallWidthCm;
      Object.assign(this.params, DEFAULT_PARAMS, { wallWidthCm: keep });
      this.sync();
      this.hooks.onChange(this.params);
    };

    this.root.replaceChildren(
      el('div', { className: 'panel' },
        el('div', { className: 'panel-head' },
          el('h2', { textContent: 'Settings' }),
          button('Back to game', () => this.hooks.onClose(), 'primary')),
        viewWrap,
        el('p', { className: 'legend', textContent: 'green: wall · cyan: matching pixels · white: ball and trail · purple: last hit' }),
        this.readouts,
        el('div', { className: 'sliders' }, ...sliders),
        el('div', { className: 'toggles' }, ...toggles),
        el('div', { className: 'actions' },
          button('Recalibrate', () => this.hooks.onRecalibrate()),
          button('Reset score', () => this.hooks.onResetScore()),
          button('Default tuning', defaults))));
    this.sync();
  }

  format(s) {
    const v = this.params[s.key];
    return `${s.step < 1 ? v.toFixed(2) : v}${s.unit ?? ''}`;
  }

  sync() {
    for (const [key, { input, out, spec }] of Object.entries(this.inputs)) {
      if (input.type === 'checkbox') input.checked = !!this.params[key];
      else { input.value = this.params[key]; out.textContent = this.format(spec); }
    }
  }

  open(stream, aspect) {
    this.isOpen = true;
    this.root.hidden = false;
    this.sync();
    this.view.attach(stream);
    this.aspect = aspect;
    this.lastReadout = 0;
  }

  close() {
    this.isOpen = false;
    this.root.hidden = true;
  }

  // Called every animation frame while open.
  render(now) {
    if (!this.isOpen) return;
    const panel = this.root.firstElementChild;
    const maxW = panel.clientWidth - 32;
    this.view.layout(this.aspect || 16 / 9, Math.max(160, maxW), window.innerHeight * 0.32);
    this.drawOverlay();
    if (now - this.lastReadout > 400) {
      this.lastReadout = now;
      const s = this.hooks.getStats();
      this.readouts.replaceChildren(...s.map(([k, v]) => el('div', {}, el('span', { textContent: k }), el('b', { textContent: v }))));
    }
  }

  drawOverlay() {
    const v = this.view;
    const d = this.hooks.getDebug();
    v.clear();
    if (d.Hinv) {
      const wall = [[0, 0], [1, 0], [1, 1], [0, 1]].map(([x, y]) => applyH(d.Hinv, x, y));
      v.line(wall, '#00e676', 2, true);
    }
    const { roi, mask, w, h } = d;
    if (roi) {
      v.line([[roi.x, roi.y], [roi.x + roi.w, roi.y], [roi.x + roi.w, roi.y + roi.h], [roi.x, roi.y + roi.h]],
        'rgba(255,255,255,0.25)', 1, true);
    }
    if (mask && w && h) {
      const oc = this.overlayCanvas;
      if (oc.width !== w || oc.height !== h) {
        oc.width = w; oc.height = h;
        this.maskImage = this.overlayCtx.createImageData(w, h);
      }
      const px = this.maskImage.data;
      for (let i = 0, j = 0; i < mask.length; i++, j += 4) {
        if (mask[i]) { px[j] = 0; px[j + 1] = 229; px[j + 2] = 255; px[j + 3] = 255; } else px[j + 3] = 0;
      }
      this.overlayCtx.putImageData(this.maskImage, 0, 0);
      v.ctx.imageSmoothingEnabled = false;
      v.ctx.drawImage(oc, roi.x * v.w, roi.y * v.h, roi.w * v.w, roi.h * v.h);
    }
    if (d.trail.length > 1) v.line(d.trail, 'rgba(255,255,255,0.7)', 2);
    if (d.ball) v.dot(d.ball[0], d.ball[1], 7, '#fff', true);
    if (d.lastHit) {
      v.dot(d.lastHit[0], d.lastHit[1], 9, '#b05cff', true);
      v.dot(d.lastHit[0], d.lastHit[1], 3, '#b05cff');
    }
  }
}
