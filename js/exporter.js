// 轨迹导出：GPX 1.1 与 GeoJSON，均通过 Blob 触发下载。

function escapeXml(s) {
  return String(s).replace(/[<>&'"]/g, (c) => ({
    '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;',
  }[c]));
}

export function toGpx(points, name = 'track') {
  const trkpts = points
    .map((p) => {
      const time = new Date(p.ts).toISOString();
      const acc = p.accuracy != null ? `      <cmt>accuracy: ${p.accuracy} m</cmt>\n` : '';
      return (
        `    <trkpt lat="${p.lat}" lon="${p.lng}">\n` +
        `      <time>${time}</time>\n` +
        acc +
        `    </trkpt>`
      );
    })
    .join('\n');
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<gpx version="1.1" creator="track-recorder" xmlns="http://www.topografix.com/GPX/1/1">\n` +
    `  <trk>\n    <name>${escapeXml(name)}</name>\n    <trkseg>\n${trkpts}\n    </trkseg>\n  </trk>\n</gpx>\n`
  );
}

export function toGeoJson(points, name = 'track') {
  return JSON.stringify(
    {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: { name, coordTimes: points.map((p) => new Date(p.ts).toISOString()) },
          geometry: {
            type: 'LineString',
            coordinates: points.map((p) => [p.lng, p.lat]),
          },
        },
      ],
    },
    null,
    2
  );
}

export function downloadText(filename, text, mime) {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
