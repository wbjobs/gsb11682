// 定位能力封装：环境检测、权限查询、watch 管理、错误分类。

export const GeoError = {
  UNSUPPORTED: 'unsupported',       // 浏览器不支持 Geolocation
  INSECURE: 'insecure-context',     // 非安全上下文（非 HTTPS/localhost）
  DENIED: 'denied',                 // 用户拒绝授权
  UNAVAILABLE: 'unavailable',       // 位置不可用（信号差等）
  TIMEOUT: 'timeout',               // 定位超时
  UNKNOWN: 'unknown',
};

export function detectEnvironment() {
  if (!('geolocation' in navigator)) {
    return { ok: false, reason: GeoError.UNSUPPORTED, message: '当前浏览器不支持 Geolocation API' };
  }
  if (!window.isSecureContext) {
    return {
      ok: false,
      reason: GeoError.INSECURE,
      message: '当前不是安全上下文（需要 HTTPS 或 localhost），浏览器禁止定位',
    };
  }
  return { ok: true };
}

// 查询权限状态：granted / prompt / denied / null（Permissions API 不可用时）
export async function queryPermission(onChange) {
  if (!('permissions' in navigator) || !navigator.permissions.query) return null;
  try {
    const status = await navigator.permissions.query({ name: 'geolocation' });
    if (onChange) {
      status.onchange = () => onChange(status.state);
    }
    return status.state;
  } catch (e) {
    // 某些浏览器（如旧 Safari）不支持 geolocation 权限查询
    return null;
  }
}

function classifyError(err) {
  if (!err || typeof err.code !== 'number') return GeoError.UNKNOWN;
  switch (err.code) {
    case 1: return GeoError.DENIED;
    case 2: return GeoError.UNAVAILABLE;
    case 3: return GeoError.TIMEOUT;
    default: return GeoError.UNKNOWN;
  }
}

export class GeoWatcher {
  constructor() {
    this.watchId = null;
  }

  get watching() {
    return this.watchId !== null;
  }

  // options: { highAccuracy, timeout, maximumAge }
  start({ onPosition, onError, options }) {
    this.stop();
    const opts = {
      enableHighAccuracy: !!options.highAccuracy,
      timeout: options.timeout ?? 15000,
      maximumAge: options.maximumAge ?? 0,
    };
    this.watchId = navigator.geolocation.watchPosition(
      (pos) => onPosition(pos),
      (err) => onError(classifyError(err), err),
      opts
    );
  }

  stop() {
    if (this.watchId !== null) {
      navigator.geolocation.clearWatch(this.watchId);
      this.watchId = null;
    }
  }
}

// 单次定位（用于用户点击时先触发授权/验证可用性，必须在用户手势中调用）
export function getCurrentOnce(options) {
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      resolve,
      (err) => {
        const e = new Error(err && err.message ? err.message : 'geolocation error');
        e.reason = classifyError(err);
        reject(e);
      },
      {
        enableHighAccuracy: !!options.highAccuracy,
        timeout: options.timeout ?? 15000,
        maximumAge: options.maximumAge ?? 0,
      }
    );
  });
}
