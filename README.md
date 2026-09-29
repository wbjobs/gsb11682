# 轨迹记录器

纯原生 Web 技术（无框架）实现的移动轨迹记录应用。

## 运行

```bash
python3 -m http.server 8080
# 打开 http://localhost:8080
```

> Geolocation API 只在安全上下文可用：`localhost` 或 HTTPS。直接用 `file://` 或局域网 IP 打开会触发"非安全上下文"降级。

## 技术栈

Geolocation API、Permissions API、Canvas、IndexedDB、Blob，ES Modules，零依赖。

## 文件结构

- `index.html` / `css/style.css` — 页面与样式
- `js/app.js` — 主逻辑：状态机、权限处理、后台保活、降级
- `js/geo.js` — 环境检测、权限查询、watch 封装、错误分类
- `js/filter.js` — 卡尔曼平滑（纬度/经度）、速度 EMA、haversine 距离
- `js/renderer.js` — Canvas 轨迹线/轨迹点/起止标记/精度圈
- `js/db.js` — IndexedDB 会话与轨迹点持久化
- `js/exporter.js` — GPX / GeoJSON 导出（Blob 下载）

## 关键约束的处理

- **权限被拒**：Permissions API 监听状态变化，拒绝时提示并自动切换手动输入模式
- **不支持定位**：`navigator.geolocation` 检测，显示"不支持定位"并降级
- **非安全上下文**：`window.isSecureContext` 检测，提示需要 HTTPS/localhost 并降级
- **未交互不崩**：页面加载只查询权限状态（不弹窗）；所有定位调用都在按钮点击回调内
- **定位超时**：错误码分类处理，自动重试，连续超时给出降低精度等建议
- **精度波动**：双一维卡尔曼滤波（测量噪声 = 上报 accuracy），速度做 EMA 平滑
- **后台标签页**：每个回调点立即写入 IndexedDB（渲染与存储解耦）；回到前台时若定位流中断则自动重启 watch，另有心跳兜底
- **降级方案**：手动输入纬度/经度/精度追加轨迹点，统计、可视化、导出全部可用

## 导出

- GPX 1.1（`<trkpt>` 含时间与精度注释）
- GeoJSON（LineString + coordTimes）
