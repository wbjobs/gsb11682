const PADDING = 36;

export class TrackCanvas {
  constructor(canvas, emptyEl) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.emptyEl = emptyEl;
    this.points = [];
    if (typeof ResizeObserver === 'function' && canvas.parentElement) {
      this._observer = new ResizeObserver(() => this.render());
      this._observer.observe(canvas.parentElement);
    }
    window.addEventListener('resize', () => this.render());
  }

  setPoints(points) {
    this.points = Array.isArray(points) ? points : [];
    this.render();
  }

  render() {
    const parent = this.canvas.parentElement;
    if (!parent) return;
    const dpr = window.devicePixelRatio || 1;
    const w = parent.clientWidth;
    const h = parent.clientHeight || 440;
    if (w === 0 || h === 0) return;
    if (this.canvas.width !== Math.round(w * dpr) || this.canvas.height !== Math.round(h * dpr)) {
      this.canvas.width = Math.round(w * dpr);
      this.canvas.height = Math.round(h * dpr);
      this.canvas.style.width = w + 'px';
      this.canvas.style.height = h + 'px';
    }
    const ctx = this.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#121828';
    ctx.fillRect(0, 0, w, h);

    const pts = this.points;
    if (this.emptyEl) this.emptyEl.classList.toggle('hidden', pts.length > 0);
    if (pts.length === 0) return;

    const proj = this._makeProjection(pts, w, h);

    const last = pts[pts.length - 1];
    if (last.source === 'gps' && typeof last.acc === 'number') {
      const [cx, cy] = proj(last.lat, last.lon);
      const r = last.acc * proj.metersPerUnit;
      ctx.beginPath();
      ctx.arc(cx, cy, Math.max(r, 4), 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(79, 140, 255, 0.12)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(79, 140, 255, 0.4)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    if (pts.length >= 2) {
      ctx.beginPath();
      pts.forEach((p, i) => {
        const [x, y] = proj(p.lat, p.lon);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.strokeStyle = '#4f8cff';
      ctx.lineWidth = 2.5;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.stroke();
    }

    for (const p of pts) {
      const [x, y] = proj(p.lat, p.lon);
      if (p.source === 'manual') {
        ctx.fillStyle = '#f5a623';
        ctx.fillRect(x - 3, y - 3, 6, 6);
      } else {
        ctx.beginPath();
        ctx.arc(x, y, 3, 0, Math.PI * 2);
        ctx.fillStyle = '#9dc0ff';
        ctx.fill();
      }
    }

    const [sx, sy] = proj(pts[0].lat, pts[0].lon);
    ctx.beginPath();
    ctx.arc(sx, sy, 6, 0, Math.PI * 2);
    ctx.fillStyle = '#3fb950';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#0f1420';
    ctx.stroke();

    const [ex, ey] = proj(last.lat, last.lon);
    ctx.beginPath();
    ctx.arc(ex, ey, 6, 0, Math.PI * 2);
    ctx.fillStyle = '#e5534b';
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#8b96ad';
    ctx.font = '11px sans-serif';
    ctx.fillText('起点', sx + 9, sy - 6);
    ctx.fillText('当前', ex + 9, ey - 6);
  }

  _makeProjection(pts, w, h) {
    let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity;
    for (const p of pts) {
      if (p.lat < minLat) minLat = p.lat;
      if (p.lat > maxLat) maxLat = p.lat;
      if (p.lon < minLon) minLon = p.lon;
      if (p.lon > maxLon) maxLon = p.lon;
    }
    const lat0 = (minLat + maxLat) / 2;
    const lon0 = (minLon + maxLon) / 2;
    const cosLat = Math.max(Math.cos((lat0 * Math.PI) / 180), 1e-6);
    const spanX = Math.max((maxLon - minLon) * cosLat, 1e-7);
    const spanY = Math.max(maxLat - minLat, 1e-7);
    const availW = Math.max(w - PADDING * 2, 10);
    const availH = Math.max(h - PADDING * 2, 10);
    const scale = Math.min(availW / spanX, availH / spanY);
    const proj = (lat, lon) => {
      const x = w / 2 + (lon - lon0) * cosLat * scale;
      const y = h / 2 - (lat - lat0) * scale;
      return [x, y];
    };
    proj.metersPerUnit = (scale * Math.PI * 6371000) / 180;
    return proj;
  }
}
