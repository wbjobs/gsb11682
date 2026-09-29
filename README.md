# 轨迹记录仪

纯 HTML/CSS/JavaScript（ES Modules，无任何框架）的轨迹记录应用。

## 运行

浏览器要求页面处于安全上下文（HTTPS 或 localhost）才允许定位，请用本地静态服务器打开：

```bash
python3 -m http.server 8080
# 打开 http://localhost:8080
```

直接双击 `index.html`（file://）时定位会被浏览器禁用，应用会自动降级到手动记录模式。

## 功能

- 申请并展示地理位置权限状态（Permissions API，含状态变更监听）
- 记录轨迹点：实时位置、速度、精度（卡尔曼滤波平滑精度波动）
- Canvas 可视化：轨迹线、轨迹点（GPS 圆点 / 手动方块）、起点/当前标记、精度圈
- 统计：轨迹点数、总距离（haversine）、时长、当前/平均速度
- 导出：GPX 1.1 与 GeoJSON（Blob + 下载）
- 持久化：每个轨迹点即时写入 IndexedDB，刷新/后台被杀不丢数据，重新打开自动恢复

## 关键约束的处理

| 约束 | 处理方式 |
| --- | --- |
| 权限被拒 | 监听 `GeolocationPositionError.code === 1` 与 Permissions API `onchange`，提示并自动打开手动记录 |
| 不支持定位 | `'geolocation' in navigator` 检测，提示并降级手动记录 |
| 非安全上下文 | `window.isSecureContext` 检测，提示并降级手动记录 |
| 用户未交互 | 定位调用只绑定在按钮点击中且整体 try/catch；页面加载仅做权限查询，不触发定位 |
| 定位超时 | watchPosition `timeout: 20s` 错误回调 + 首次定位 20s 看门狗，均给出提示 |
| 精度波动 | 一维卡尔曼滤波（按上报精度自适应权重）平滑经纬度 |
| 后台标签页 | 使用 `position.timestamp`（设备时间戳）做统计；每点即时写 IndexedDB；回到前台重绘 |
| 降级方案 | 手动输入坐标，与 GPS 点共用同一轨迹：入库、绘图、统计、导出完全一致 |

## 文件结构

```
index.html          页面骨架
css/style.css       样式
js/app.js           主控：状态机、UI 绑定、统计
js/geo.js           环境检测、权限查询、GeoTracker（watchPosition 封装）
js/kalman.js        经纬度卡尔曼平滑
js/db.js            IndexedDB 持久化（不可用时内存降级）
js/track-canvas.js  Canvas 轨迹渲染（自适应边界、DPR）
js/exporter.js      GPX / GeoJSON 导出（Blob）
```
