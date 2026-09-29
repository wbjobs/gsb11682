export class KalmanLatLon {
  constructor(processNoise = 3) {
    this.q = processNoise;
    this.variance = -1;
    this.lat = 0;
    this.lon = 0;
    this.ts = 0;
  }

  reset() {
    this.variance = -1;
  }

  process(lat, lon, accuracy, timestamp) {
    if (this.variance < 0) {
      this.lat = lat;
      this.lon = lon;
      this.ts = timestamp;
      this.variance = Math.max(accuracy, 1) ** 2;
      return { lat, lon };
    }
    const dt = (timestamp - this.ts) / 1000;
    if (dt > 0) {
      this.variance += dt * dt * this.q * this.q;
      this.ts = timestamp;
    }
    const accVar = Math.max(accuracy, 1) ** 2;
    const k = this.variance / (this.variance + accVar);
    this.lat += k * (lat - this.lat);
    this.lon += k * (lon - this.lon);
    this.variance = (1 - k) * this.variance;
    return { lat: this.lat, lon: this.lon };
  }
}
