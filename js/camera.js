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

  async start() {
    if (this.stream) return;
    if (!window.isSecureContext) throw new Error('The camera needs HTTPS (or localhost).');
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('This browser has no camera access.');
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 1280 },
        height: { ideal: 720 },
        frameRate: { ideal: 60 },
      },
    });
    this.track = this.stream.getVideoTracks()[0];
    this.video.srcObject = this.stream;
    await this.video.play();
    if (!this.video.videoWidth) {
      await new Promise((res) => this.video.addEventListener('loadedmetadata', res, { once: true }));
    }
    this.running = true;
    this._fpsStart = performance.now();
    this._loop();
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
    if ('requestVideoFrameCallback' in v) {
      const step = (now) => {
        if (!this.running) return;
        this._emit(now);
        v.requestVideoFrameCallback(step);
      };
      v.requestVideoFrameCallback(step);
    } else {
      let last = -1;
      const step = (now) => {
        if (!this.running) return;
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
