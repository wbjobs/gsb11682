// Canvas 轨迹渲染：自适应边界、轨迹线、轨迹点、起止标记、当前位置与精度圈。

const PADDING = 40;

export class TrackRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.points = [];
    this.current = null; // { lat, lng, accuracy }
    this._resizeObserver = new ResizeObserver(() => this.render());
    this._resizeObserver.observe(canvas.parentElement || canvas);
    window.addEventListener('resize', () => this.render());
  }

  setPoints(points) {
    this.points = points;
    this.render();
  }

  setCurrent(current) {
    this.current = current;
    this.render();
  }

  _fitCanvas() {
    const dpr = window.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();
    const w = Math.max(rect.width, 1);
    const h = Math.max(rect.height, 1);
    if (this.canvas.width !== w * dpr || this.canvas.height !== h * dpr) {
      this.canvas.width = w * dpr;
      this.canvas.height = h * dpr;
    }
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { w, h };
  }

  _projector(w, h) {
    const all = this.current ? this.points.concat([this.current]) : this.points;
    let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
    for (const p of all) {
      if (p.lat < minLat) minLat = p.lat;
      if (p.lat > maxLat) maxLat = p.lat;
      if (p.lng < minLng) minLng = p.lng;
      if (p.lng > maxLng) maxLng = p.lng;
    }
    if (!isFinite(minLat)) {
      minLat = maxLat = minLng = maxLng = 0;
    }
    // 单点时给一点边距，避免除零
    if (maxLat - minLat < 1e-6) { minLat -= 5e-4; maxLat += 5e-4; }
    if (maxLng - minLng < 1e-6) { minLng -= 5e-4; maxLng += 5e-4; }
    const iw = w - PADDING * 2;
    const ih = h - PADDING * 2;
    const scale = Math.min(iw / (maxLng - minLng), ih / (maxLat - minLat));
    const ox = PADDING + (iw - (maxLng - minLng) * scale) / 2;
    const oy = PADDING + (ih - (maxLat - minLat) * scale) / 2;
    return {
      toXY(p) {
        return [ox + (p.lng - minLng) * scale, oy + (maxLat - p.lat) * scale];
      },
      metersToPx(meters, lat) {
        const mPerDeg = 111320 * Math.cos((lat * Math.PI) / 180) || 1e-6;
        return (meters / mPerDeg) * scale;
      },
    };
  }

  render() {
    const { w, h } = this._fitCanvas();
    const ctx = this.ctx;
    ctx.clearRect(0, 0, w, h);
    if (this.points.length === 0 && !this.current) return;

    const proj = this._projector(w, h);

    // 轨迹线
    if (this.points.length >= 2) {
      ctx.beginPath();
      this.points.forEach((p, i) => {
        const [x, y] = proj.toXY(p);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.strokeStyle = '#2563eb';
      ctx.lineWidth = 2.5;
      ctx.lineJoin = 'round';
      ctx.stroke();
    }

    // 轨迹点（手动点用橙色区分）
    for (const p of this.points) {
      const [x, y] = proj.toXY(p);
      ctx.beginPath();
      ctx.arc(x, y, 3, 0, Math.PI * 2);
      ctx.fillStyle = p.source === 'manual' ? '#d97706' : '#2563eb';
      ctx.fill();
    }

    // 起点 / 终点
    if (this.points.length > 0) {
      const [sx, sy] = proj.toXY(this.points[0]);
      ctx.beginPath();
      ctx.arc(sx, sy, 6, 0, Math.PI * 2);
      ctx.fillStyle = '#059669';
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 9px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('起', sx, sy);
    }

    // 当前位置 + 精度圈
    if (this.current) {
      const [cx, cy] = proj.toXY(this.current);
      if (this.current.accuracy) {
        const r = proj.metersToPx(this.current.accuracy, this.current.lat);
        ctx.beginPath();
        ctx.arc(cx, cy, Math.min(r, Math.max(w, h)), 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(220, 38, 38, 0.10)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(220, 38, 38, 0.35)';
        ctx.lineWidth = 1;
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.arc(cx, cy, 6, 0, Math.PI * 2);
      ctx.fillStyle = '#dc2626';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#fff';
      ctx.stroke();
    }
  }
}
