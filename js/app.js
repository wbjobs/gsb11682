import { detectEnvironment, queryPermission, GeoWatcher, getCurrentOnce, GeoError } from './geo.js';
import { TrackStore } from './db.js';
import { TrackRenderer } from './renderer.js';
import { TrackSmoother, haversineMeters } from './filter.js';
import { toGpx, toGeoJson, downloadText } from './exporter.js';

const $ = (id) => document.getElementById(id);

const els = {
  envBadge: $('env-badge'),
  permBadge: $('perm-badge'),
  recBadge: $('rec-badge'),
  toast: $('toast'),
  btnStart: $('btn-start'),
  btnStop: $('btn-stop'),
  btnExportGpx: $('btn-export-gpx'),
  btnExportGeojson: $('btn-export-geojson'),
  btnClear: $('btn-clear'),
  optHighAccuracy: $('opt-high-accuracy'),
  permTip: $('perm-tip'),
  manualPanel: $('manual-panel'),
  manualLat: $('manual-lat'),
  manualLng: $('manual-lng'),
  manualAcc: $('manual-acc'),
  btnManualAdd: $('btn-manual-add'),
  mapEmpty: $('map-empty'),
  stLat: $('st-lat'),
  stLng: $('st-lng'),
  stSpeed: $('st-speed'),
  stAcc: $('st-acc'),
  stCount: $('st-count'),
  stDist: $('st-dist'),
  stDuration: $('st-duration'),
  stAvg: $('st-avg'),
};

const state = {
  env: detectEnvironment(),
  permission: null,      // granted | prompt | denied | null
  recording: false,
  session: null,
  points: [],            // 平滑后的轨迹点
  distance: 0,
  lastPointAt: 0,
  timeoutCount: 0,
  currentSpeed: null,
  currentAccuracy: null,
};

const store = new TrackStore();
const watcher = new GeoWatcher();
const smoother = new TrackSmoother();
const renderer = new TrackRenderer($('map'));

let toastTimer = null;
function toast(message, type = '', duration = 4000) {
  els.toast.textContent = message;
  els.toast.className = `toast ${type ? `toast-${type}` : ''}`;
  els.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { els.toast.hidden = true; }, duration);
}

function setBadge(el, text, cls) {
  el.textContent = text;
  el.className = `badge ${cls}`;
}

function refreshPermissionBadge() {
  const p = state.permission;
  if (!state.env.ok) {
    setBadge(els.permBadge, '定位不可用', 'badge-err');
    return;
  }
  if (p === 'granted') setBadge(els.permBadge, '权限：已授权', 'badge-ok');
  else if (p === 'denied') setBadge(els.permBadge, '权限：已拒绝', 'badge-err');
  else if (p === 'prompt') setBadge(els.permBadge, '权限：待请求', 'badge-warn');
  else setBadge(els.permBadge, '权限：未知', 'badge-muted');
}

function refreshUi() {
  const canGps = state.env.ok && state.permission !== 'denied';
  els.btnStart.disabled = state.recording || (!canGps && !state.session);
  els.btnStop.disabled = !state.recording;
  const hasPoints = state.points.length > 0;
  els.btnExportGpx.disabled = !hasPoints;
  els.btnExportGeojson.disabled = !hasPoints;
  els.btnClear.disabled = !hasPoints;
  els.mapEmpty.hidden = hasPoints;
  if (state.recording) setBadge(els.recBadge, '● 记录中', 'badge-rec');
  else setBadge(els.recBadge, '未记录', 'badge-muted');
}

function showManualMode(reasonText) {
  els.manualPanel.hidden = false;
  els.permTip.hidden = false;
  els.permTip.textContent = `${reasonText} 已切换为手动记录模式，可手动输入坐标。`;
}

function fmtSpeed(ms) {
  if (ms == null) return '—';
  return `${(ms * 3.6).toFixed(1)} km/h`;
}

function fmtDistance(m) {
  return m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${Math.round(m)} m`;
}

function fmtDuration(ms) {
  const s = Math.floor(ms / 1000);
  const hh = String(Math.floor(s / 3600)).padStart(2, '0');
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return s >= 3600 ? `${hh}:${mm}:${ss}` : `${mm}:${ss}`;
}

function refreshStats() {
  const n = state.points.length;
  const last = n > 0 ? state.points[n - 1] : null;
  els.stLat.textContent = last ? last.lat.toFixed(6) : '—';
  els.stLng.textContent = last ? last.lng.toFixed(6) : '—';
  els.stSpeed.textContent = fmtSpeed(state.currentSpeed);
  els.stAcc.textContent = state.currentAccuracy != null ? `±${Math.round(state.currentAccuracy)} m` : '—';
  els.stCount.textContent = String(n);
  els.stDist.textContent = fmtDistance(state.distance);
  if (n >= 2) {
    const dur = state.points[n - 1].ts - state.points[0].ts;
    els.stDuration.textContent = fmtDuration(dur);
    els.stAvg.textContent = dur > 0 ? fmtSpeed(state.distance / (dur / 1000)) : '—';
  } else {
    els.stDuration.textContent = '00:00';
    els.stAvg.textContent = '—';
  }
}

async function ensureSession() {
  if (!state.session) {
    state.session = await store.createSession();
  }
  return state.session;
}

// 追加轨迹点（GPS 与手动共用），负责平滑、统计、持久化、渲染
async function appendPoint(raw) {
  await ensureSession();
  let lat = raw.lat;
  let lng = raw.lng;
  if (raw.source === 'gps') {
    const filtered = smoother.filter(raw.lat, raw.lng, raw.accuracy ?? 50, raw.ts);
    lat = filtered.lat;
    lng = filtered.lng;
  }
  const point = {
    sessionId: state.session.id,
    lat, lng,
    accuracy: raw.accuracy ?? null,
    ts: raw.ts,
    source: raw.source,
  };

  const prev = state.points[state.points.length - 1];
  if (prev) {
    const dt = (point.ts - prev.ts) / 1000;
    const d = haversineMeters(prev, point);
    if (dt > 0) state.distance += d;
    // 速度：优先设备回报，否则由位移/时间推导，再做 EMA 平滑
    let speed = raw.speed != null && raw.speed >= 0 ? raw.speed : dt > 0 ? d / dt : null;
    state.currentSpeed = smoother.smoothSpeed(speed);
  } else {
    state.currentSpeed = raw.speed != null && raw.speed >= 0 ? raw.speed : 0;
  }
  state.currentAccuracy = point.accuracy;

  state.points.push(point);
  state.lastPointAt = Date.now();
  try {
    await store.addPoint(point);
  } catch (e) {
    console.error('持久化失败', e);
  }
  renderer.setPoints(state.points);
  renderer.setCurrent({ lat, lng, accuracy: point.accuracy });
  refreshStats();
  refreshUi();
}

function handleGeoError(reason) {
  if (reason === GeoError.DENIED) {
    state.permission = 'denied';
    refreshPermissionBadge();
    watcher.stop();
    state.recording = false;
    showManualMode('定位权限被拒绝。');
    toast('定位权限被拒绝，已降级为手动记录。如需恢复，请在浏览器设置中允许定位。', 'err', 6000);
  } else if (reason === GeoError.TIMEOUT) {
    state.timeoutCount += 1;
    if (state.timeoutCount === 1) {
      toast('定位超时，正在自动重试…', 'warn');
    } else if (state.timeoutCount >= 3) {
      toast('多次定位超时：请到开阔处，或关闭“高精度模式”再试。', 'warn', 6000);
    }
  } else if (reason === GeoError.UNAVAILABLE) {
    toast('暂时无法获取位置（信号不佳），将继续重试。', 'warn');
  } else {
    toast('定位发生未知错误。', 'err');
  }
  refreshUi();
}

function startWatch() {
  watcher.start({
    options: { highAccuracy: els.optHighAccuracy.checked, timeout: 15000, maximumAge: 0 },
    onPosition: (pos) => {
      state.timeoutCount = 0;
      appendPoint({
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        accuracy: pos.coords.accuracy,
        speed: pos.coords.speed,
        ts: pos.timestamp || Date.now(),
        source: 'gps',
      });
    },
    onError: handleGeoError,
  });
}

// 仅在用户点击时调用：先单次定位触发授权，成功后再开启 watch
async function onStart() {
  if (state.recording) return;
  if (!state.env.ok) {
    showManualMode(state.env.message);
    toast('定位不可用，请使用手动记录。', 'warn');
    refreshUi();
    return;
  }
  els.btnStart.disabled = true;
  try {
    await getCurrentOnce({ highAccuracy: els.optHighAccuracy.checked, timeout: 15000 });
  } catch (e) {
    els.btnStart.disabled = false;
    handleGeoError(e.reason);
    return;
  }
  state.permission = 'granted';
  refreshPermissionBadge();
  state.recording = true;
  state.timeoutCount = 0;
  startWatch();
  toast('开始记录轨迹。', 'ok', 2000);
  refreshUi();
}

function onStop() {
  watcher.stop();
  state.recording = false;
  toast('已停止记录。', '', 2000);
  refreshUi();
}

async function onManualAdd() {
  const lat = parseFloat(els.manualLat.value);
  const lng = parseFloat(els.manualLng.value);
  const acc = els.manualAcc.value === '' ? null : parseFloat(els.manualAcc.value);
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
    toast('纬度无效（-90 ~ 90）。', 'err');
    return;
  }
  if (!Number.isFinite(lng) || lng < -180 || lng > 180) {
    toast('经度无效（-180 ~ 180）。', 'err');
    return;
  }
  if (acc != null && (!Number.isFinite(acc) || acc < 0)) {
    toast('精度必须为非负数。', 'err');
    return;
  }
  await appendPoint({ lat, lng, accuracy: acc, speed: null, ts: Date.now(), source: 'manual' });
  toast('已添加手动轨迹点。', 'ok', 1500);
}

function onExport(format) {
  if (state.points.length === 0) return;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  if (format === 'gpx') {
    downloadText(`track-${stamp}.gpx`, toGpx(state.points, `track-${stamp}`), 'application/gpx+xml');
  } else {
    downloadText(`track-${stamp}.geojson`, toGeoJson(state.points, `track-${stamp}`), 'application/geo+json');
  }
  toast('导出成功。', 'ok', 2000);
}

async function onClear() {
  if (state.session) {
    try { await store.clearSession(state.session.id); } catch (e) { console.error(e); }
  }
  state.points = [];
  state.distance = 0;
  state.currentSpeed = null;
  state.currentAccuracy = null;
  smoother.reset();
  renderer.setPoints([]);
  renderer.setCurrent(null);
  refreshStats();
  refreshUi();
  toast('轨迹已清除。', '', 2000);
}

// 后台标签页：watch 回调在后台仍可能触发（被节流），所有点都会立即持久化；
// 回到前台时若长时间无点则重启 watch，尽量补回定位流。
function setupBackgroundGuards() {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      renderer.render();
      if (state.recording && Date.now() - state.lastPointAt > 20000) {
        startWatch();
      }
    }
  });
  // 心跳：前台状态下定位流中断超过 30 秒则重启 watch
  setInterval(() => {
    if (state.recording && document.visibilityState === 'visible' &&
        Date.now() - state.lastPointAt > 30000) {
      startWatch();
    }
    if (state.recording) refreshStats();
  }, 5000);
}

async function init() {
  // 环境检测
  if (!state.env.ok) {
    setBadge(els.envBadge, state.env.reason === GeoError.UNSUPPORTED ? '不支持定位' : '非安全上下文', 'badge-err');
    showManualMode(state.env.message);
    els.btnStart.disabled = true;
  } else {
    setBadge(els.envBadge, '环境正常', 'badge-ok');
  }

  // 权限状态（仅查询，不触发弹窗，页面加载阶段安全）
  state.permission = await queryPermission((next) => {
    state.permission = next;
    refreshPermissionBadge();
    if (next === 'denied' && state.recording) {
      watcher.stop();
      state.recording = false;
      showManualMode('定位权限被撤回。');
    }
    refreshUi();
  });
  refreshPermissionBadge();
  if (state.permission === 'denied') {
    showManualMode('定位权限已被拒绝。');
  }

  // 恢复上次会话的轨迹
  try {
    const session = await store.getLatestSession();
    if (session) {
      state.session = session;
      state.points = await store.getPoints(session.id);
      for (let i = 1; i < state.points.length; i++) {
        state.distance += haversineMeters(state.points[i - 1], state.points[i]);
      }
      if (state.points.length > 0) {
        const last = state.points[state.points.length - 1];
        renderer.setPoints(state.points);
        renderer.setCurrent({ lat: last.lat, lng: last.lng, accuracy: last.accuracy });
        state.currentAccuracy = last.accuracy;
      }
    }
  } catch (e) {
    console.error('恢复轨迹失败', e);
  }

  // 事件绑定（所有定位调用都发生在点击回调内，避免未交互调用问题）
  els.btnStart.addEventListener('click', onStart);
  els.btnStop.addEventListener('click', onStop);
  els.btnManualAdd.addEventListener('click', onManualAdd);
  els.btnExportGpx.addEventListener('click', () => onExport('gpx'));
  els.btnExportGeojson.addEventListener('click', () => onExport('geojson'));
  els.btnClear.addEventListener('click', onClear);

  setupBackgroundGuards();
  refreshStats();
  refreshUi();
}

init();
