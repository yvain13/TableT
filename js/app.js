// Wires the modules together: camera -> tracker -> bounce -> game, plus the three screens.

import { DEFAULT_PARAMS } from './config.js';
import { load, save } from './storage.js';
import { applyH } from './homography.js';
import { Camera } from './camera.js';
import { Tracker } from './tracker.js';
import { BounceDetector } from './bounce.js';
import { Game } from './game.js';
import { Calibrator } from './calibration.js';
import { SettingsPanel } from './settings.js';

const $ = (sel) => document.querySelector(sel);

const params = { ...DEFAULT_PARAMS, ...load('params', {}) };
// v1 stored the motion threshold on a 0..255 scale; it is now a 0..1 ratio.
if (params.motionThresh > 1) params.motionThresh = DEFAULT_PARAMS.motionThresh;
let calibration = load('calibration', null);

const camera = new Camera();
const tracker = new Tracker();
const bounce = new BounceDetector();
const game = new Game($('#game'));
game.wallWidthCm = params.wallWidthCm;
game.showBallDot = params.showBallDot;
game.respawnAll();
if (calibration?.H) tracker.setCalibration(calibration.H);

let screen = 'start';
let sessionTestMode = false; // "try without camera": taps always count
const bounceParams = { ...params, bounds: { w: game.W, h: game.H } };

// ---------- tracking loop ----------

const stats = { procMs: 0, detections: 0, dps: 0, since: performance.now() };
const trail = [];
let lastHit = null;
let seenReject = null;

// A bounce just past the frame's sides or top is an OUT. Below the frame is where paddle hits and
// floor bounces land in the camera view, so that edge stays quiet.
function isNearMiss(r) {
  if (r.reason !== 'outside wall') return false;
  const { W, H } = game;
  return r.x > -0.15 * W && r.x < 1.15 * W && r.y > -0.15 * H && r.y < H;
}

camera.onFrame((t) => {
  if (screen !== 'play' || game.paused || !tracker.H) return;
  const t0 = performance.now();
  const det = tracker.process(camera.video, params);
  if (det) {
    stats.detections++;
    const x = det.sx * game.W, y = det.sy * game.H;
    game.ball = { x, y, time: t0 };
    trail.push({ x: det.camX, y: det.camY, t });
    if (trail.length > 24) trail.shift();
    const hit = bounce.push({ t, x, y, size: det.size }, bounceParams);
    if (hit) {
      game.hit(hit.x, hit.y);
      lastHit = { cam: applyH(tracker.Hinv, hit.x / game.W, hit.y / game.H), t };
    } else if (bounce.lastReject && bounce.lastReject !== seenReject) {
      seenReject = bounce.lastReject;
      if (isNearMiss(seenReject)) game.out(seenReject.x, seenReject.y);
    }
  }
  stats.procMs = stats.procMs * 0.9 + (performance.now() - t0) * 0.1;
  if (t0 - stats.since >= 1000) {
    stats.dps = Math.round((stats.detections * 1000) / (t0 - stats.since));
    stats.detections = 0;
    stats.since = t0;
  }
});

// ---------- screens ----------

function show(name) {
  screen = name;
  $('#start').hidden = name !== 'start';
  $('#lag').hidden = name !== 'lag';
  $('#gear').hidden = name !== 'play';
  if (name === 'calibrate') calibrator.open();
  else calibrator.close();
  if (name !== 'play') settings.close();
  bounce.reset();
  tracker.reset();
  if (name === 'start') refreshStart();
  if (name === 'play') game.flashBoundary();
}

function refreshStart() {
  const has = !!calibration?.H;
  $('#btn-go').textContent = has ? 'Play' : 'Calibrate';
  $('#btn-recal').hidden = !has;
}

// iPhone Safari has no fullscreen API for pages; the Home Screen app is how to lose the bars.
const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const standalone = navigator.standalone || window.matchMedia('(display-mode: standalone)').matches
  || window.matchMedia('(display-mode: fullscreen)').matches;
$('#install-tip').hidden = !(isIOS && !standalone);

// A calibration made with a different camera shape (orientation or aspect) no longer matches.
function calibrationMatchesCamera() {
  if (!calibration?.H) return false;
  if (!calibration.camW || !camera.width) return true;
  const a = calibration.camW / calibration.camH, b = camera.width / camera.height;
  return Math.abs(a - b) / a < 0.03;
}

function status(text) {
  $('#start-status').textContent = text;
}

async function enterSession() {
  try {
    const root = document.documentElement;
    if (!document.fullscreenElement && !document.webkitFullscreenElement) {
      await (root.requestFullscreen?.() ?? root.webkitRequestFullscreen?.());
    }
  } catch { /* fullscreen is optional; the home screen app has no browser bars anyway */ }
  keepAwake();
  try {
    status('Starting camera…');
    await camera.start({ prefer60: params.prefer60fps });
    status('');
    return true;
  } catch (err) {
    status(`Camera failed: ${err.message || err.name}. You can still try test mode.`);
    return false;
  }
}

let wakeLock = null;
async function keepAwake() {
  try { wakeLock = await navigator.wakeLock?.request('screen'); } catch { wakeLock = null; }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && screen !== 'start') keepAwake();
});

$('#btn-go').addEventListener('click', async () => {
  if (!(await enterSession())) return;
  sessionTestMode = false;
  show(calibrationMatchesCamera() ? 'play' : 'calibrate');
});
$('#btn-recal').addEventListener('click', async () => {
  if (!(await enterSession())) return;
  show('calibrate');
});
$('#btn-test').addEventListener('click', () => {
  sessionTestMode = true;
  show('play');
});
$('#btn-lag').addEventListener('click', () => show('lag'));
$('#lag-back').addEventListener('click', () => show('start'));

// ---------- calibration ----------

const calibrator = new Calibrator({
  camera,
  screen: $('#calibrate'),
  canvas: $('#cal-canvas'),
  center: $('#cal-center'),
  msg: $('#cal-msg'),
  buttons: $('#cal-buttons'),
  onDone(H, camPts) {
    calibration = { H, camPts, at: Date.now(), camW: camera.width, camH: camera.height };
    save('calibration', calibration);
    tracker.setCalibration(H);
    sessionTestMode = false;
    show('play');
  },
  onCancel() {
    show(calibration?.H ? 'play' : 'start');
  },
});

// ---------- settings ----------

let cameraPref = params.prefer60fps;
const settings = new SettingsPanel($('#settings'), params, {
  async onChange(p) {
    save('params', p);
    if (p.prefer60fps !== cameraPref) {
      cameraPref = p.prefer60fps;
      if (camera.running) {
        try {
          await camera.restart({ prefer60: p.prefer60fps });
          tracker.reset();
          bounce.reset();
          settings.view.attach(camera.stream);
          settings.aspect = camera.aspect;
          if (!calibrationMatchesCamera()) show('calibrate');
        } catch (err) {
          settings.close();
          show('start');
          status(`Camera failed: ${err.message || err.name}`);
        }
      }
    }
    Object.assign(bounceParams, p);
    game.setWallWidth(p.wallWidthCm);
    game.showBallDot = p.showBallDot;
  },
  onRecalibrate() {
    if (!camera.running) {
      settings.close();
      show('start');
      status('Start the camera first, then calibrate.');
      return;
    }
    show('calibrate');
  },
  onResetScore() { game.resetScore(); },
  onClose() { settings.close(); },
  getStats() {
    const asked = camera.requestedFps;
    return [
      ['Camera', camera.running ? `${camera.width}×${camera.height}` : 'off'],
      ['Frames/s', camera.running ? `${camera.fps.toFixed(0)} (track ${asked ? asked.toFixed(0) : '?'})` : '–'],
      ['Camera mode', camera.running ? camera.mode : '–'],
      ['Processing', `${stats.procMs.toFixed(1)} ms`],
      ['Detections/s', String(stats.dps)],
      ['Calibration', calibration?.at ? new Date(calibration.at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }) : 'none'],
      ['Last reject', bounce.lastReject?.reason ?? '–'],
    ];
  },
  getDebug() {
    const now = performance.now();
    const recent = trail.filter((p) => now - p.t < 600).map((p) => [p.x, p.y]);
    const fresh = game.ball && now - game.ball.time < 150 && trail.length;
    return {
      Hinv: tracker.Hinv,
      roi: tracker.H ? tracker.roi : null,
      mask: tracker.mask,
      w: tracker.w,
      h: tracker.h,
      trail: recent,
      ball: fresh ? [trail[trail.length - 1].x, trail[trail.length - 1].y] : null,
      lastHit: lastHit && now - lastHit.t < 3000 ? lastHit.cam : null,
    };
  },
});

$('#gear').addEventListener('click', () => {
  if (settings.isOpen) settings.close();
  else settings.open(camera.stream, camera.aspect);
});

// ---------- touch on the game: test hits and hidden pause / reset on the score ----------

let pressTimer = null;
const canvas = $('#game');
canvas.addEventListener('pointerdown', (e) => {
  if (screen !== 'play') return;
  const r = game.scoreRect();
  if (e.clientX >= r.x && e.clientY <= r.y + r.h) {
    pressTimer = setTimeout(() => { pressTimer = null; game.resetScore(); }, 900);
    return;
  }
  if (params.testMode || sessionTestMode) game.hit(e.clientX, e.clientY);
});
canvas.addEventListener('pointerup', () => {
  if (!pressTimer) return;
  clearTimeout(pressTimer);
  pressTimer = null;
  game.paused = !game.paused;
  bounce.reset();
});
canvas.addEventListener('pointercancel', () => { clearTimeout(pressTimer); pressTimer = null; });

// ---------- render loop ----------

const lagEl = $('#lag-time');
function frame(now) {
  if (screen === 'play') game.render(now);
  settings.render(now);
  if (screen === 'lag') lagEl.textContent = (now / 1000).toFixed(3);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Phones resize on rotation and when browser bars show or hide; the visual viewport reports both.
let resizeTimer = 0;
function onResize() {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    game.resize();
    bounceParams.bounds = { w: game.W, h: game.H };
    bounce.reset();
  }, 120);
}
window.addEventListener('resize', onResize);
window.addEventListener('orientationchange', onResize);
window.visualViewport?.addEventListener('resize', onResize);

if ('serviceWorker' in navigator && window.isSecureContext) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}

// Open with ?debug to poke at the modules from the browser console.
if (new URLSearchParams(location.search).has('debug')) {
  window.wtp = { game, tracker, bounce, camera, params, calibrator, settings };
}

show('start');
