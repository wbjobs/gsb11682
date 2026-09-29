import { GeoTracker, GeoState, checkEnvironment, queryPermission } from './geo.js';
import { TrackCanvas } from './track-canvas.js';
import * as db from './db.js';
import { toGPX, toGeoJSON, download, timestampName } from './exporter.js';

const $ = (id) => document.getElementById(id);

const ui = {
  banner: $('banner'),
  envBadges: $('env-badges'),
  permStatus: $('perm-status'),
  btnStart: $('btn-start'),
  btnPause: $('btn-pause'),
  btnStop: $('btn-stop'),
  btnClear: $('btn-clear'),
  btnManualMode: $('btn-manual-mode'),
  btnExportGpx: $('btn-export-gpx'),
  btnExportGeojson: $('btn-export-geojson'),
  manualPanel: $('manual-panel'),
  mLat: $('m-lat'),
  mLon: $('m-lon'),
  mAcc: $('m-acc'),
  btnAddManual: $('btn-add-manual'),
  btnFillDemo: $('btn-fill-demo'),
  toast: $('toast'),
  stState: $('st-state'),
  stCount: $('st-count'),
  stDist: $('st-dist'),
  stDuration: $('st-duration'),
  stSpeed: $('st-speed'),
  stAvg: $('st-avg'),
  stAcc: $('st-acc'),
  stPos: $('st-pos'),
};

const STATE_TEXT = {
  idle: '空闲',
  acquiring: '定位中…',
  tracking: '记录中',
  paused: '已暂停',
  denied: '权限被拒',
  manual: '手动记录',
};

const FIRST_FIX_TIMEOUT = 20000;
const GAP_CAP_MS = 60000;

const tracker = new GeoTracker();
const trackCanvas = new TrackCanvas($('track-canvas'), $('canvas-empty'));

let points = [];
let appState = 'idle';
let env = { secure: true, supported: true };
let permState = 'unknown';
let firstFixTimer = null;
let toastTimer = null;
let demoStep = 0;

init();

async function init() {
  bindUI();
  env = checkEnvironment();
  renderEnvBadges();
  await refreshPermission();
  applyEnvPolicy();
  try {
    points = await db.getAllPoints();
  } catch {
    points = [];
  }
  redraw();
  setInterval(updateStats, 1000);
}

function bindUI() {
  ui.btnStart.addEventListener('click', onStartClick);
  ui.btnPause.addEventListener('click', onPauseClick);
  ui.btnStop.addEventListener('click', onStopClick);
  ui.btnClear.addEventListener('click', onClearClick);
  ui.btnManualMode.addEventListener('click', () => {
    ui.manualPanel.classList.toggle('hidden');
  });
  ui.btnExportGpx.addEventListener('click', () => exportTrack('gpx'));
  ui.btnExportGeojson.addEventListener('click', () => exportTrack('geojson'));
  ui.btnAddManual.addEventListener('click', onAddManualPoint);
  ui.btnFillDemo.addEventListener('click', fillDemoCoord);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) redraw();
  });

  tracker.addEventListener('point', (e) => onNewPoint(e.detail));
  tracker.addEventListener('error', (e) => onGeoError(e.detail));
  tracker.addEventListener('statechange', (e) => {
    if (e.detail.state === GeoState.TRACKING && appState === 'acquiring') {
      setState('tracking');
    }
  });
}

function onStartClick() {
  try {
    if (!env.supported || !env.secure || permState === 'denied') {
      applyEnvPolicy();
      return;
    }
    if (appState === 'paused') {
      tracker.resume();
      setState('tracking');
      return;
    }
    tracker.start();
    setState('acquiring');
    armFirstFixTimer();
  } catch (err) {
    showBanner('error', `启动定位失败：${err && err.message ? err.message : err}。已切换手动记录模式。`);
    openManualMode();
  }
}

function onPauseClick() {
  if (appState === 'paused') {
    tracker.resume();
    setState('tracking');
  } else if (appState === 'tracking' || appState === 'acquiring') {
    tracker.pause();
    setState('paused');
  }
}

function onStopClick() {
  tracker.stop();
  clearFirstFixTimer();
  setState('idle');
  showBanner('info', '记录已结束，可导出轨迹文件。');
}

async function onClearClick() {
  if (points.length > 0 && !window.confirm(`确定清空 ${points.length} 个轨迹点？此操作不可恢复。`)) return;
  tracker.stop();
  clearFirstFixTimer();
  points = [];
  try {
    await db.clearPoints();
  } catch {
    // 清空失败不阻塞界面
  }
  setState('idle');
  redraw();
}

function onNewPoint(point) {
  clearFirstFixTimer();
  if (appState === 'acquiring') setState('tracking');
  points.push(point);
  db.addPoint(point).catch(() => showToast('轨迹点写入本地存储失败'));
  redraw();
}

function onGeoError(detail) {
  if (detail.kind === 'denied') {
    tracker.stop();
    clearFirstFixTimer();
    permState = 'denied';
    renderPermStatus();
    setState('denied');
    showBanner('error', '定位权限被拒绝。可在浏览器地址栏/设置中重新允许定位，或使用手动记录模式。');
    openManualMode();
  } else if (detail.kind === 'timeout') {
    showToast('定位超时：请移到开阔地带或检查设备定位开关，记录仍在继续等待。');
  } else if (detail.kind === 'unavailable') {
    showToast('暂时无法获取位置（信号弱），记录会在恢复后继续。');
  } else {
    showToast('定位出现异常，已继续尝试。');
  }
}

function armFirstFixTimer() {
  clearFirstFixTimer();
  firstFixTimer = setTimeout(() => {
    if (appState === 'acquiring') {
      showToast('首次定位超时（20 秒未获取到位置）。请检查定位开关与信号，或改用手动记录。');
      openManualMode();
    }
  }, FIRST_FIX_TIMEOUT);
}

function clearFirstFixTimer() {
  if (firstFixTimer !== null) {
    clearTimeout(firstFixTimer);
    firstFixTimer = null;
  }
}

function onAddManualPoint() {
  const lat = Number(ui.mLat.value);
  const lon = Number(ui.mLon.value);
  const accRaw = ui.mAcc.value === '' ? null : Number(ui.mAcc.value);
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
    showToast('纬度无效：请输入 -90 到 90 之间的数字。');
    return;
  }
  if (!Number.isFinite(lon) || lon < -180 || lon > 180) {
    showToast('经度无效：请输入 -180 到 180 之间的数字。');
    return;
  }
  const point = {
    lat,
    lon,
    rawLat: lat,
    rawLon: lon,
    acc: Number.isFinite(accRaw) && accRaw > 0 ? accRaw : null,
    speed: null,
    alt: null,
    heading: null,
    ts: Date.now(),
    source: 'manual',
  };
  points.push(point);
  db.addPoint(point).catch(() => showToast('轨迹点写入本地存储失败'));
  if (appState === 'idle' || appState === 'denied') setState('manual');
  redraw();
  showToast(`已添加手动轨迹点（${lat.toFixed(5)}, ${lon.toFixed(5)}）`);
}

function fillDemoCoord() {
  const baseLat = 39.9087;
  const baseLon = 116.3975;
  ui.mLat.value = (baseLat + demoStep * 0.0008).toFixed(6);
  ui.mLon.value = (baseLon + demoStep * 0.0011).toFixed(6);
  demoStep += 1;
}

function exportTrack(format) {
  if (points.length === 0) return;
  const name = `track-${timestampName()}`;
  if (format === 'gpx') {
    download(`${name}.gpx`, toGPX(points, name), 'application/gpx+xml');
  } else {
    download(`${name}.geojson`, toGeoJSON(points, name), 'application/geo+json');
  }
  showToast(`已导出 ${points.length} 个轨迹点（${format.toUpperCase()}）`);
}

async function refreshPermission() {
  const { state, status } = await queryPermission();
  permState = state;
  renderPermStatus();
  if (status) {
    status.onchange = () => {
      permState = status.state;
      renderPermStatus();
      if (status.state === 'denied') {
        tracker.stop();
        clearFirstFixTimer();
        setState('denied');
        showBanner('error', '定位权限被关闭。已停止自动记录，可改用手动记录模式。');
        openManualMode();
      } else if (status.state === 'granted' && appState === 'denied') {
        setState('idle');
        showBanner('info', '定位权限已恢复，可重新开始记录。');
        applyEnvPolicy();
      }
    };
  }
}

function applyEnvPolicy() {
  if (!env.secure) {
    setState('denied');
    showBanner('error', '当前为非安全上下文（非 HTTPS 或 localhost），浏览器禁止定位。已切换手动记录模式。');
    openManualMode();
  } else if (!env.supported) {
    setState('denied');
    showBanner('error', '当前浏览器不支持 Geolocation 定位。已切换手动记录模式。');
    openManualMode();
  } else if (permState === 'denied') {
    setState('denied');
    showBanner('error', '定位权限被拒绝。可在浏览器设置中重新允许，或使用手动记录模式。');
    openManualMode();
  } else if (permState === 'granted') {
    showBanner('info', '定位权限已授予，点击「开始记录」即可。');
  } else {
    showBanner('info', '点击「开始记录」后，浏览器会请求定位权限。');
  }
  updateButtons();
}

function openManualMode() {
  ui.manualPanel.classList.remove('hidden');
}

function renderEnvBadges() {
  const items = [];
  items.push(`<span class="badge ${env.secure ? 'ok' : 'bad'}">${env.secure ? '安全上下文' : '非安全上下文'}</span>`);
  items.push(`<span class="badge ${env.supported ? 'ok' : 'bad'}">${env.supported ? '支持定位' : '不支持定位'}</span>`);
  ui.envBadges.innerHTML = items.join('');
}

function renderPermStatus() {
  const map = {
    granted: '定位权限：已允许',
    denied: '定位权限：已拒绝',
    prompt: '定位权限：待请求',
    unknown: '定位权限：未知（浏览器不支持 Permissions API 查询）',
  };
  ui.permStatus.textContent = map[permState] || map.unknown;
}

function setState(next) {
  appState = next;
  ui.stState.textContent = STATE_TEXT[next] || next;
  updateButtons();
}

function updateButtons() {
  const gpsUsable = env.secure && env.supported && permState !== 'denied';
  ui.btnStart.disabled = !gpsUsable || appState === 'tracking' || appState === 'acquiring';
  ui.btnStart.textContent = appState === 'paused' ? '继续记录' : '开始记录';
  ui.btnPause.disabled = !(appState === 'tracking' || appState === 'acquiring' || appState === 'paused');
  ui.btnPause.textContent = appState === 'paused' ? '恢复' : '暂停';
  ui.btnStop.disabled = !(appState === 'tracking' || appState === 'acquiring' || appState === 'paused');
  const hasPoints = points.length > 0;
  ui.btnExportGpx.disabled = !hasPoints;
  ui.btnExportGeojson.disabled = !hasPoints;
}

function redraw() {
  trackCanvas.setPoints(points);
  updateStats();
  updateButtons();
}

function haversine(a, b) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

function computeStats() {
  let dist = 0;
  let durationMs = 0;
  for (let i = 1; i < points.length; i += 1) {
    dist += haversine(points[i - 1], points[i]);
    const gap = points[i].ts - points[i - 1].ts;
    if (gap > 0 && gap <= GAP_CAP_MS) durationMs += gap;
  }
  return { dist, durationMs };
}

function updateStats() {
  const { dist, durationMs } = computeStats();
  ui.stCount.textContent = String(points.length);
  ui.stDist.textContent = formatDistance(dist);
  ui.stDuration.textContent = formatDuration(durationMs);

  const last = points[points.length - 1];
  if (last) {
    ui.stPos.textContent = `${last.lat.toFixed(6)}, ${last.lon.toFixed(6)}`;
    ui.stAcc.textContent = last.acc != null ? `±${Math.round(last.acc)} m（已平滑）` : '--';
    let speed = last.speed;
    if ((speed == null || speed < 0) && points.length >= 2) {
      const prev = points[points.length - 2];
      const dt = (last.ts - prev.ts) / 1000;
      if (dt > 0) speed = haversine(prev, last) / dt;
    }
    ui.stSpeed.textContent = speed != null && speed >= 0 ? formatSpeed(speed) : '--';
  } else {
    ui.stPos.textContent = '--';
    ui.stAcc.textContent = '--';
    ui.stSpeed.textContent = '--';
  }

  ui.stAvg.textContent = durationMs > 0 ? formatSpeed(dist / (durationMs / 1000)) : '--';
}

function formatDistance(m) {
  return m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${Math.round(m)} m`;
}

function formatSpeed(ms) {
  return `${(ms * 3.6).toFixed(1)} km/h`;
}

function formatDuration(ms) {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

function showBanner(type, text) {
  ui.banner.className = `banner ${type}`;
  ui.banner.textContent = text;
}

function showToast(text) {
  ui.toast.textContent = text;
  ui.toast.classList.remove('hidden');
  if (toastTimer !== null) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ui.toast.classList.add('hidden'), 4000);
}
