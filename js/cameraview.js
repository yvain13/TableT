// A live camera view with a drawing overlay, used by calibration and settings.
// The video is shown in greyscale: this view is projected onto the wall too, and an orange
// ball inside it would otherwise be a second, moving orange object for the tracker.

export class CameraView {
  constructor(parent) {
    this.el = document.createElement('div');
    this.el.className = 'camview';
    this.video = document.createElement('video');
    this.video.muted = true;
    this.video.playsInline = true;
    this.video.autoplay = true;
    this.video.setAttribute('playsinline', '');
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d');
    this.el.append(this.video, this.canvas);
    parent.append(this.el);
    this.w = 0;
    this.h = 0;
  }

  attach(stream) {
    if (stream && this.video.srcObject !== stream) {
      this.video.srcObject = stream;
      this.video.play().catch(() => {});
    }
  }

  // Size the view to the camera aspect within maxW x maxH CSS px.
  layout(aspect, maxW, maxH) {
    let w = maxW, h = w / aspect;
    if (h > maxH) { h = maxH; w = h * aspect; }
    w = Math.round(w); h = Math.round(h);
    if (w === this.w && h === this.h) return;
    this.w = w; this.h = h;
    this.el.style.width = `${w}px`;
    this.el.style.height = `${h}px`;
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  // Pointer event to normalised camera coords.
  toNorm(e) {
    const r = this.el.getBoundingClientRect();
    return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height];
  }

  clear() { this.ctx.clearRect(0, 0, this.w, this.h); }

  // Polyline through normalised camera points.
  line(pts, color, width = 2, close = false) {
    const { ctx } = this;
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i ? ctx.lineTo(x * this.w, y * this.h) : ctx.moveTo(x * this.w, y * this.h)));
    if (close) ctx.closePath();
    ctx.lineWidth = width;
    ctx.strokeStyle = color;
    ctx.stroke();
  }

  dot(x, y, r, color, stroke = false) {
    const { ctx } = this;
    ctx.beginPath();
    ctx.arc(x * this.w, y * this.h, r, 0, Math.PI * 2);
    if (stroke) { ctx.lineWidth = 2; ctx.strokeStyle = color; ctx.stroke(); } else { ctx.fillStyle = color; ctx.fill(); }
  }

  label(text, x, y, color = '#fff') {
    const { ctx } = this;
    ctx.font = '600 14px system-ui, sans-serif';
    ctx.fillStyle = color;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    ctx.fillText(text, x * this.w + 8, y * this.h - 6);
  }
}
