// Opens the rear camera at the highest frame rate offered and calls listeners once per new frame.
// Uses requestVideoFrameCallback where available, so slow frames are dropped, never queued.

export class Camera {
  constructor() {
    const v = document.createElement('video');
    v.muted = true;
    v.playsInline = true;
    v.autoplay = true;
    v.setAttribute('playsinline', '');
    this.video = v;
    this.stream = null;
    this.track = null;
    this.running = false;
    this.listeners = new Set();
    this.fps = 0;
    this._frames = 0;
    this._fpsStart = 0;
  }

  get width() { return this.video.videoWidth; }
  get height() { return this.video.videoHeight; }
  get aspect() { return this.width && this.height ? this.width / this.height : 16 / 9; }

  get requestedFps() {
    try { return this.track?.getSettings().frameRate ?? 0; } catch { return 0; }
  }

  // prefer60: ask for 640x360 with at least 50 fps. Phones often have no 60 fps mode at 720p and
  // drop to 30 fps; the tracker works at 640 px wide anyway, so the smaller frame costs nothing.
  // Falls back to 720p at whatever rate the camera gives if the phone refuses.
  async start({ prefer60 = true } = {}) {
    if (this.stream) return;
    if (!window.isSecureContext) throw new Error('The camera needs HTTPS (or localhost).');
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('This browser has no camera access.');
    const facingMode = { ideal: 'environment' };
    const fast = { facingMode, width: { ideal: 640 }, height: { ideal: 360 }, frameRate: { min: 50, ideal: 60 } };
    const sharp = { facingMode, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 60 } };
    this.stream = null;
    if (prefer60) {
      try {
        this.stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: fast });
      } catch (err) {
        if (err.name !== 'OverconstrainedError' && err.name !== 'ConstraintNotSatisfiedError') throw err;
      }
    }
    this.mode = this.stream ? '60 fps mode' : prefer60 ? '60 fps refused, using 720p' : '720p mode';
    this.stream ??= await navigator.mediaDevices.getUserMedia({ audio: false, video: sharp });
    this.track = this.stream.getVideoTracks()[0];
    this.video.srcObject = this.stream;
    await this.video.play();
    if (!this.video.videoWidth) {
      await new Promise((res) => this.video.addEventListener('loadedmetadata', res, { once: true }));
    }
    this.running = true;
    this._fpsStart = performance.now();
    this._frames = 0;
    this._loop();
  }

  stop() {
    this.running = false;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.track = null;
    this.video.srcObject = null;
  }

  async restart(opts) {
    this.stop();
    await this.start(opts);
  }

  onFrame(cb) {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  nextFrame() {
    return new Promise((resolve) => {
      const off = this.onFrame((t) => { off(); resolve(t); });
    });
  }

  _loop() {
    const v = this.video;
    const gen = (this._gen = (this._gen ?? 0) + 1); // a restart ends the previous loop
    if ('requestVideoFrameCallback' in v) {
      const step = (now) => {
        if (!this.running || gen !== this._gen) return;
        this._emit(now);
        v.requestVideoFrameCallback(step);
      };
      v.requestVideoFrameCallback(step);
    } else {
      let last = -1;
      const step = (now) => {
        if (!this.running || gen !== this._gen) return;
        if (v.currentTime !== last) {
          last = v.currentTime;
          this._emit(now);
        }
        requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    }
  }

  _emit(t) {
    this._frames++;
    const elapsed = t - this._fpsStart;
    if (elapsed >= 1000) {
      this.fps = (this._frames * 1000) / elapsed;
      this._frames = 0;
      this._fpsStart = t;
    }
    for (const cb of this.listeners) cb(t);
  }
}
