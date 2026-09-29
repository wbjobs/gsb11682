function escapeXml(s) {
  return String(s).replace(/[<>&'"]/g, (c) => ({
    '<': '&lt;',
    '>': '&gt;',
    '&': '&amp;',
    "'": '&apos;',
    '"': '&quot;',
  }[c]));
}

function round7(n) {
  return Math.round(n * 1e7) / 1e7;
}

export function toGPX(points, name = 'track') {
  const trkpts = points
    .map((p) => {
      const lines = [`    <trkpt lat="${round7(p.lat)}" lon="${round7(p.lon)}">`];
      if (p.alt != null) lines.push(`      <ele>${p.alt.toFixed(1)}</ele>`);
      lines.push(`      <time>${new Date(p.ts).toISOString()}</time>`);
      const ext = [];
      if (p.acc != null) ext.push(`<accuracy>${p.acc}</accuracy>`);
      if (p.speed != null) ext.push(`<speed>${p.speed}</speed>`);
      ext.push(`<source>${p.source}</source>`);
      lines.push(`      <extensions>${ext.join('')}</extensions>`);
      lines.push('    </trkpt>');
      return lines.join('\n');
    })
    .join('\n');
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<gpx version="1.1" creator="track-recorder" xmlns="http://www.topografix.com/GPX/1/1">',
    `  <trk><name>${escapeXml(name)}</name>`,
    '    <trkseg>',
    trkpts,
    '    </trkseg>',
    '  </trk>',
    '</gpx>',
    '',
  ].join('\n');
}

export function toGeoJSON(points, name = 'track') {
  const line = {
    type: 'Feature',
    properties: { name, created: new Date().toISOString(), count: points.length },
    geometry: {
      type: 'LineString',
      coordinates: points.map((p) => [round7(p.lon), round7(p.lat), p.alt != null ? p.alt : 0]),
    },
  };
  const dots = points.map((p) => ({
    type: 'Feature',
    properties: {
      time: new Date(p.ts).toISOString(),
      accuracy: p.acc != null ? p.acc : null,
      speed: p.speed != null ? p.speed : null,
      source: p.source,
    },
    geometry: { type: 'Point', coordinates: [round7(p.lon), round7(p.lat)] },
  }));
  return JSON.stringify({ type: 'FeatureCollection', features: [line, ...dots] }, null, 2);
}

export function timestampName() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

export function download(filename, content, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
