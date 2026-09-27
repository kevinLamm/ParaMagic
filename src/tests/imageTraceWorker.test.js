import test from 'node:test';
import assert from 'node:assert/strict';
import cvPromise from '@techstark/opencv-js';
import { ImageTraceKernel } from '../../packages/paramagic-core/src/modules/ImageTraceKernel.js';
import { ImageTraceClient } from '../../packages/paramagic-core/src/modules/ImageTraceClient.js';
import { createImageTraceWorkerRuntime } from '../../packages/paramagic-core/src/modules/ImageTraceWorkerRuntime.js';
import { tracePreparedImageRegion, imagePixelToLocalPoint, imageLocalToWorldPoint } from '../../packages/paramagic-core/src/modules/ImageTrace.js';

const cv = await cvPromise;
function fixture(width = 160, height = 120) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    let rgb = [240, 240, 240];
    if (x > 15 && x < width * .85 && y > 12 + x % 5 && y < height * .8) rgb = [40, 80, 120];
    if (x > width * .3 && x < width * .45 && y > height * .3 && y < height * .65) rgb = [50, 88, 125];
    if (x > 19 && x < 29 && y > height * .88 && y < height * .99) rgb = [40, 80, 120];
    data.set([...rgb, x < 3 && y < 3 ? 0 : 255], (y * width + x) * 4);
  }
  return { width, height, data };
}
function run(kernel, seed, settings) { const work = kernel.trace(seed, settings); let r; do { r = work.next(); } while (!r.done); return r.value; }
async function reference(image, seed, settings) {
  const priorCv = globalThis.cv, priorRead = cv.imread;
  globalThis.cv = cv; cv.imread = () => cv.matFromImageData(image);
  const entity = { x: 17, y: -9, width: 500, height: 300, rotation: 31, flipX: true };
  const world = imageLocalToWorldPoint(entity, imagePixelToLocalPoint(entity, seed, image.width, image.height));
  try { return await tracePreparedImageRegion({ canvas: {}, imageData: image, naturalWidth: image.width, naturalHeight: image.height }, entity, world, settings); }
  finally { globalThis.cv = priorCv; cv.imread = priorRead; }
}

test('resident trace preserves exact reference contours across settings, seeds and image sizes', async () => {
  const kernel = new ImageTraceKernel(cv);
  try {
    for (const image of [fixture(), fixture(320, 210)]) {
      kernel.load({ ...image, pixels: image.data.buffer });
      for (const [seed, settings] of [
        [[80, 60], { tolerance: 24, detail: 8, smoothing: 1 }],
        [[80, 60], { tolerance: 24, detail: 10, smoothing: 1 }],
        [[80, 60], { tolerance: 24, detail: 10, smoothing: 0 }],
        [[80, 60], { tolerance: 4, detail: 9, smoothing: 3 }],
        [[40, 40], { tolerance: 4, detail: 8, smoothing: 2 }],
        [[24, Math.round(image.height * .93)], { tolerance: 24, detail: 10, smoothing: 0 }],
      ]) {
        const actual = run(kernel, seed, settings), expected = await reference(image, seed, settings);
        for (const key of ['pixelPoints', 'seedPixel', 'settings', 'areaPixels']) assert.deepEqual(actual[key], expected[key], key);
      }
    }
  } finally { kernel.dispose(); kernel.dispose(); }
});

test('detail and smoothing updates reuse only valid upstream native results', () => {
  const image = fixture(), kernel = new ImageTraceKernel(cv);
  try {
    kernel.load({ ...image, pixels: image.data.buffer });
    run(kernel, [80, 60], { tolerance: 24, detail: 8, smoothing: 1 });
    const initial = { ...kernel.stats };
    run(kernel, [80, 60], { tolerance: 24, detail: 10, smoothing: 1 });
    assert.deepEqual(kernel.stats, { ...initial, approximations: initial.approximations + 1 });
    run(kernel, [80, 60], { tolerance: 24, detail: 10, smoothing: 3 });
    assert.equal(kernel.stats.segmentations, 1); assert.equal(kernel.stats.masks, 1);
    assert.equal(kernel.stats.smoothings, 2); assert.equal(kernel.stats.contourExtractions, 2);
    const allocation = kernel.src.data.buffer;
    for (let detail = 1; detail <= 10; detail++) run(kernel, [80, 60], { tolerance: 24, detail, smoothing: 3 });
    assert.equal(kernel.src.data.buffer, allocation);
    run(kernel, [80, 60], { tolerance: 8, detail: 10, smoothing: 3 });
    assert.equal(kernel.stats.segmentations, 2);
  } finally { kernel.dispose(); }
});

test('trace errors preserve reference behavior and allow a later valid selection', async () => {
  const image = fixture(), kernel = new ImageTraceKernel(cv);
  try {
    kernel.load({ ...image, pixels: image.data.buffer });
    assert.throws(() => run(kernel, [1, 1], {}), /opaque/);
    await assert.rejects(reference(image, [1, 1], {}), /opaque/);
    assert.throws(() => run(kernel, [-1, 1], {}), /seed/);
    assert.ok(run(kernel, [80, 60], {}).pixelPoints.length >= 3);
    const tiny = { width: 3, height: 3, pixels: new Uint8Array(36).fill(255).buffer };
    kernel.load(tiny); assert.throws(() => run(kernel, [1, 1], {}), /too small/);
  } finally { kernel.dispose(); }
});

test('trace Worker supersedes queued and in-flight requests between native stages', async () => {
  const messages = [], image = fixture(); let interrupted = false, completed;
  const done = new Promise(resolve => { completed = resolve; });
  const runtime = createImageTraceWorkerRuntime({ loadCv: async () => cv,
    postMessage: message => { messages.push(message); if (message.id === 4) completed(); },
    nextTask: async () => {
      if (interrupted) return; interrupted = true;
      runtime.receive({ id: 3, type: 'trace', sourceVersion: 1, seed: [80, 60], settings: { tolerance: 10 } });
      runtime.receive({ id: 4, type: 'trace', sourceVersion: 1, seed: [80, 60], settings: { tolerance: 5 } });
    },
  });
  runtime.receive({ id: 1, type: 'open', sourceVersion: 1, ...image, pixels: image.data.buffer });
  await new Promise(resolve => setImmediate(resolve));
  runtime.receive({ id: 2, type: 'trace', sourceVersion: 1, seed: [80, 60], settings: {} });
  await done;
  assert.equal(messages.find(m => m.id === 2).status, 'superseded');
  assert.equal(messages.find(m => m.id === 3).status, 'superseded');
  assert.equal(messages.find(m => m.id === 4).status, 'complete');
  assert.equal(messages.find(m => m.id === 4).result.settings.tolerance, 5);
  runtime.receive({ id: 5, type: 'release', sourceVersion: 1 });
});

class FakeWorker {
  listeners = {}; sent = []; terminated = false;
  addEventListener(name, fn) { this.listeners[name] = fn; }
  postMessage(message, transfer) { this.sent.push({ message, transfer }); }
  respond(data) { this.listeners.message({ data }); }
  terminate() { this.terminated = true; }
}
const turn = () => new Promise(resolve => setImmediate(resolve));
test('client uploads once, transfers pixels, ignores stale results and disposes pending requests', async () => {
  const worker = new FakeWorker(), image = fixture(); let preparations = 0;
  const client = new ImageTraceClient({ workerFactory: () => worker, resources: () => ({ scriptUrl: '/opencv.js' }),
    prepare: async () => { preparations++; return { naturalWidth: image.width, naturalHeight: image.height, imageData: image }; } });
  const entity = { source: 'one', width: 100, height: 100, x: 0, y: 0 };
  const first = client.trace(entity, [0, 0]); await turn();
  const open = worker.sent[0]; assert.equal(open.message.type, 'open'); assert.equal(open.transfer[0], image.data.buffer);
  worker.respond({ id: open.message.id, sourceVersion: 1, status: 'ready' }); await turn();
  const old = worker.sent.at(-1).message;
  const second = client.trace(entity, [0, 0], { detail: 10 }); await turn();
  const latest = worker.sent.at(-1).message;
  const result = { settings: {}, seedPixel: [80, 60], pixelPoints: [[10, 10], [20, 10], [20, 20]], areaPixels: 100 };
  worker.respond({ id: old.id, sourceVersion: 1, status: 'complete', result });
  worker.respond({ id: latest.id, sourceVersion: 1, status: 'complete', result });
  assert.equal(await first, null); assert.equal((await second).worldPoints.length, 3); assert.equal(preparations, 1);
  const pending = client.trace(entity, [0, 0]); await turn(); client.dispose();
  assert.equal(await pending, null); assert.equal(worker.terminated, true); assert.equal(client.pending.size, 0);
});

test('source replacement during decode uploads only the latest image', async () => {
  const worker = new FakeWorker(), decodes = new Map(), image = fixture();
  const client = new ImageTraceClient({ workerFactory: () => worker, resources: () => ({ scriptUrl: '/opencv.js' }),
    prepare: entity => new Promise(resolve => decodes.set(entity.source, resolve)) });
  const base = { width: 100, height: 100, x: 0, y: 0 };
  const old = client.trace({ ...base, source: 'old' }, [0, 0]);
  const latest = client.trace({ ...base, source: 'new' }, [0, 0]);
  decodes.get('old')({ imageData: image, naturalWidth: image.width, naturalHeight: image.height });
  assert.equal(await old, null); assert.equal(worker.sent.length, 0);
  decodes.get('new')({ imageData: image, naturalWidth: image.width, naturalHeight: image.height }); await turn();
  assert.equal(worker.sent.length, 1); assert.equal(worker.sent[0].message.sourceVersion, 2);
  client.dispose(); assert.equal(await latest, null);
});

test('release cancels work but keeps the initialized Worker for the next image', async () => {
  const worker = new FakeWorker(), image = fixture(); let constructions = 0;
  const client = new ImageTraceClient({ workerFactory: () => { constructions++; return worker; }, resources: () => ({ scriptUrl: '/opencv.js' }),
    prepare: async () => ({ naturalWidth: image.width, naturalHeight: image.height, imageData: image }) });
  const entity = { source: 'one', width: 100, height: 100, x: 0, y: 0 };
  const first = client.trace(entity, [0, 0]); await turn();
  const open = worker.sent.at(-1).message; worker.respond({ ...open, status: 'ready' }); await turn();
  const trace = worker.sent.at(-1).message;
  client.release(); const release = worker.sent.at(-1).message;
  worker.respond({ ...trace, status: 'superseded' }); worker.respond({ ...release, status: 'released' });
  assert.equal(await first, null); assert.equal(worker.terminated, false);
  const second = client.trace(entity, [0, 0]); await turn();
  assert.equal(constructions, 1); assert.equal(worker.sent.at(-1).message.type, 'open');
  client.dispose(); assert.equal(await second, null);
});

test('Worker load failure is surfaced and a later request can start a fresh Worker', async () => {
  const workers = [], image = fixture();
  const client = new ImageTraceClient({ workerFactory: () => { const worker = new FakeWorker(); workers.push(worker); return worker; },
    resources: () => ({ scriptUrl: '/opencv.js' }), prepare: async () => ({ naturalWidth: image.width, naturalHeight: image.height, imageData: image }) });
  const entity = { source: 'one', width: 100, height: 100, x: 0, y: 0 };
  const failed = assert.rejects(client.trace(entity, [0, 0]), /load failed/); await turn();
  workers[0].listeners.error({ message: 'load failed' }); await failed;
  assert.equal(workers[0].terminated, true);
  const retried = client.trace(entity, [0, 0]); await turn(); assert.equal(workers.length, 2);
  client.dispose(); assert.equal(await retried, null);
});

test('OpenCV initialization errors reset the Worker instead of retaining a rejected module', async () => {
  const workers = [], image = fixture();
  const client = new ImageTraceClient({ workerFactory: () => { const worker = new FakeWorker(); workers.push(worker); return worker; },
    resources: () => ({ scriptUrl: '/opencv.js' }), prepare: async () => ({ naturalWidth: image.width, naturalHeight: image.height, imageData: image }) });
  const entity = { source: 'one', width: 100, height: 100, x: 0, y: 0 };
  const failed = assert.rejects(client.trace(entity, [0, 0]), /OpenCV/); await turn();
  workers[0].respond({ id: workers[0].sent[0].message.id, status: 'error', message: 'OpenCV initialization failed' }); await failed;
  assert.equal(workers[0].terminated, true);
  const retried = client.trace(entity, [0, 0]); await turn(); assert.equal(workers.length, 2);
  client.dispose(); assert.equal(await retried, null);
});
