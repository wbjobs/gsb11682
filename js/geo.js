import { KalmanLatLon } from './kalman.js';

export const GeoState = {
  IDLE: 'idle',
  ACQUIRING: 'acquiring',
  TRACKING: 'tracking',
  PAUSED: 'paused',
  DENIED: 'denied',
  UNSUPPORTED: 'unsupported',
  INSECURE: 'insecure',
};

export function checkEnvironment() {
  return {
    secure: window.isSecureContext === true,
    supported: 'geolocation' in navigator,
  };
}

export async function queryPermission() {
  if (!('permissions' in navigator) || typeof navigator.permissions.query !== 'function') {
    return { state: 'unknown', status: null };
  }
  try {
    const status = await navigator.permissions.query({ name: 'geolocation' });
    return { state: status.state, status };
  } catch {
    return { state: 'unknown', status: null };
  }
}

export class GeoTracker extends EventTarget {
  constructor() {
    super();
    this.kalman = new KalmanLatLon(3);
    this.watchId = null;
    this.paused = false;
  }

  get watching() {
    return this.watchId !== null;
  }

  start() {
    try {
      this.kalman.reset();
      this.paused = false;
      this.watchId = navigator.geolocation.watchPosition(
        (pos) => this._onPosition(pos),
        (err) => this._onError(err),
        { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 }
      );
      this._emit('statechange', { state: GeoState.ACQUIRING });
    } catch (err) {
      this._emit('error', { kind: 'exception', error: err });
    }
  }

  pause() {
    this.paused = true;
  }

  resume() {
    this.paused = false;
    this.kalman.reset();
  }

  stop() {
    if (this.watchId !== null) {
      try {
        navigator.geolocation.clearWatch(this.watchId);
      } catch {
        // 忽略清理阶段的异常
      }
      this.watchId = null;
    }
    this.paused = false;
  }

  _onPosition(pos) {
    if (this.paused) return;
    const { latitude, longitude, accuracy, speed, altitude, heading } = pos.coords;
    const ts = typeof pos.timestamp === 'number' && pos.timestamp > 0 ? pos.timestamp : Date.now();
    const acc = typeof accuracy === 'number' && accuracy > 0 ? accuracy : 50;
    const smoothed = this.kalman.process(latitude, longitude, acc, ts);
    const point = {
      lat: smoothed.lat,
      lon: smoothed.lon,
      rawLat: latitude,
      rawLon: longitude,
      acc,
      speed: typeof speed === 'number' && !Number.isNaN(speed) ? speed : null,
      alt: typeof altitude === 'number' && !Number.isNaN(altitude) ? altitude : null,
      heading: typeof heading === 'number' && !Number.isNaN(heading) ? heading : null,
      ts,
      source: 'gps',
    };
    this._emit('point', point);
    this._emit('statechange', { state: GeoState.TRACKING });
  }

  _onError(err) {
    const kinds = { 1: 'denied', 2: 'unavailable', 3: 'timeout' };
    this._emit('error', { kind: kinds[err && err.code] || 'unknown', error: err });
  }

  _emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }
}
