import { configureOpenCvResources, loadOpenCv, prepareImageTrace, tracePreparedImageRegion } from '../../packages/paramagic-core/src/modules/ImageTrace.js';
import { openCvResources } from '../../src/app-config.js';
import { ImageTraceClient } from '../../packages/paramagic-core/src/modules/ImageTraceClient.js';

export function traceFixture(pixels = 1000000, { complex = false } = {}) {
  const width = Math.round(Math.sqrt(pixels * 4 / 3)), height = Math.round(pixels / width);
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  const c = canvas.getContext('2d'); c.fillStyle = '#ece6dc'; c.fillRect(0, 0, width, height);
  c.fillStyle = '#456a82'; c.beginPath();
  c.moveTo(width * .15, height * .25); c.lineTo(width * .7, height * .15);
  c.bezierCurveTo(width * .95, height * .15, width * .95, height * .8, width * .7, height * .82);
  c.lineTo(width * .2, height * .9); c.closePath(); c.fill();
  c.fillStyle = '#4b7189'; c.fillRect(width * .3, height * .4, width * .2, height * .2);
  // A hole and a disconnected region distinguish seed selection from color alone.
  c.fillStyle = '#ece6dc'; c.beginPath(); c.arc(width * .7, height * .4, height * .04, 0, Math.PI * 2); c.fill();
  c.fillStyle = '#456a82'; c.fillRect(width * .02, height * .1, width * .04, height * .05);
  if (complex) {
    c.fillStyle = '#ece6dc'; c.fillRect(0, 0, width, height);
    c.fillStyle = '#456a82'; c.beginPath();
    for (let i = 0; i < 160; i++) {
      const angle = i * Math.PI * 2 / 160, radius = (i % 2 ? .36 : .44) * height;
      const point = [width / 2 + Math.cos(angle) * radius, height / 2 + Math.sin(angle) * radius];
      if (i) c.lineTo(...point); else c.moveTo(...point);
    }
    c.closePath(); c.fill();
  }
  return { entity: { id: 'trace-fixture', type: 'image', source: canvas.toDataURL('image/png'), x: 0, y: 0, width: 600, height: 450, rotation: 0 }, width, height };
}

const settingsSequence = [
  { name: 'first', tolerance: 24, detail: 8, smoothing: 1 },
  { name: 'detail', tolerance: 24, detail: 10, smoothing: 1 },
  { name: 'smoothing', tolerance: 24, detail: 10, smoothing: 4 },
  { name: 'tolerance', tolerance: 8, detail: 10, smoothing: 4 },
];
export async function traceSample({ count = 1000000, sample = 0, backend = 'reference', phases = false, bundledTraceWorkerUrl, bundledOpenCvUrl } = {}) {
  configureOpenCvResources(bundledOpenCvUrl ? { scriptUrl: bundledOpenCvUrl } : openCvResources);
  const { entity, width, height } = traceFixture(count);
  let start = performance.now(); const cv = backend === 'reference' ? await loadOpenCv() : null; const initializationMs = performance.now() - start;
  start = performance.now(); const prepared = backend === 'reference' ? await prepareImageTrace(entity) : null; const preparationMs = performance.now() - start;
  const client = backend === 'worker' ? new ImageTraceClient(bundledTraceWorkerUrl
    ? { workerFactory: () => new Worker(new URL(bundledTraceWorkerUrl, location.href), { type: 'module' }) } : {}) : null;
  let workerSetupMs = null;
  if (client) { start = performance.now(); await client.open(entity); workerSetupMs = performance.now() - start; }
  const phaseTimes = {}, originals = new Map();
  if (phases) for (const name of ['imread', 'cvtColor', 'inRange', 'connectedComponents', 'morphologyEx', 'findContours', 'approxPolyDP']) {
    const original = cv[name]; originals.set(name, original);
    cv[name] = Object.assign(function (...args) { const begin = performance.now(); try { return original.apply(cv, args); } finally { phaseTimes[name] = (phaseTimes[name] || 0) + performance.now() - begin; } }, original);
  }
  const rows = [];
  try {
    for (const settings of settingsSequence) {
      const prior = { ...phaseTimes }; start = performance.now();
      const result = client ? await client.trace(entity, [0, 0], settings) : await tracePreparedImageRegion(prepared, entity, [0, 0], settings);
      const elapsedMs = performance.now() - start;
      rows.push({ name: settings.name, elapsedMs, points: result.pixelPoints, areaPixels: result.areaPixels, diagnostics: result.diagnostics,
        phases: Object.fromEntries(Object.entries(phaseTimes).map(([key, value]) => [key, value - (prior[key] || 0)])) });
    }
  } finally { client?.dispose(); for (const [name, fn] of originals) cv[name] = fn; }
  return { backend, sample, width, height, pixels: width * height, initializationMs, preparationMs, workerSetupMs, rows };
}
