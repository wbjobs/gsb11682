// 轨迹平滑与地理计算工具。
// 使用两个独立的一维卡尔曼滤波器（纬度/经度）抑制精度波动，
// 测量噪声直接取自定位回报的 accuracy（米），精度差时收敛慢、精度好时跟随快。

const METERS_PER_DEG_LAT = 111320;

export function metersPerDegLng(lat) {
  return METERS_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180) || 1e-6;
}

export function haversineMeters(a, b) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

class Kalman1D {
  constructor(processNoise) {
    this.q = processNoise; // 过程噪声（米^2/秒）
    this.x = null; // 当前估计（度）
    this.p = 1; // 估计方差（度^2）
    this.lastTs = null;
    this.degPerMeter = 1 / METERS_PER_DEG_LAT;
  }

  reset() {
    this.x = null;
    this.p = 1;
    this.lastTs = null;
  }

  // measurement: 测量值（度）, accuracyM: 测量精度（米）, ts: 毫秒时间戳
  update(measurement, accuracyM, ts) {
    const r = Math.max(accuracyM, 1) * this.degPerMeter;
    const rVar = r * r;
    if (this.x === null) {
      this.x = measurement;
      this.p = rVar;
      this.lastTs = ts;
      return this.x;
    }
    const dt = Math.min(Math.max((ts - this.lastTs) / 1000, 0), 60);
    const qVar = this.q * this.degPerMeter * this.degPerMeter * Math.max(dt, 0.1);
    this.p += qVar;
    const k = this.p / (this.p + rVar);
    this.x += k * (measurement - this.x);
    this.p *= 1 - k;
    this.lastTs = ts;
    return this.x;
  }
}

export class TrackSmoother {
  constructor() {
    // 行人/车载速度量级的过程噪声，兼顾步行与乘车
    this.latFilter = new Kalman1D(3);
    this.lngFilter = new Kalman1D(3);
    this.speedEma = null;
  }

  reset() {
    this.latFilter.reset();
    this.lngFilter.reset();
    this.speedEma = null;
  }

  setLngScale(lat) {
    this.lngFilter.degPerMeter = 1 / metersPerDegLng(lat);
  }

  // 输入原始定位，输出平滑后的 { lat, lng }
  filter(lat, lng, accuracy, ts) {
    this.setLngScale(lat);
    return {
      lat: this.latFilter.update(lat, accuracy, ts),
      lng: this.lngFilter.update(lng, accuracy, ts),
    };
  }

  // 速度指数滑动平均，alpha 越小越平滑
  smoothSpeed(speed) {
    if (speed == null || Number.isNaN(speed)) return this.speedEma;
    const alpha = 0.35;
    this.speedEma = this.speedEma === null ? speed : this.speedEma + alpha * (speed - this.speedEma);
    return this.speedEma;
  }
}
