import { spawn, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, appendFileSync, readFileSync, readdirSync, mkdtempSync, rmSync, realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, join, relative, isAbsolute } from 'node:path';
import { tmpdir, cpus, totalmem } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const root = fileURLToPath(new URL('../../', import.meta.url));
const option = (name, fallback) => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const counts = option('counts', '1000,5000,10000,25000,50000,100000').split(',').map(Number);
const samples = Number(option('samples', '3'));
const budgetMs = Number(option('budget-ms', '5000'));
const profileCount = Number(option('profile-count', '5000'));
const auxiliary = option('auxiliary', 'true') !== 'false';
const wasmComparison = option('wasm', 'false') === 'true';
const mixed = option('mixed', 'false') === 'true';
const nativeWorkerOnly = option('native-worker-only', 'false') === 'true';
const nativeAppOnly = option('native-app-only', 'false') === 'true';
const frontAppOnly = option('front-app-only', 'false') === 'true';
const frontWorkerOnly = option('front-worker-only', 'false') === 'true';
const corePipelineOnly = option('core-pipeline-only', 'false') === 'true';
const traceOnly = option('trace-only', 'false') === 'true';
const traceAppOnly = option('trace-app-only', 'false') === 'true';
const frontSamples = Number(option('front-samples', '1'));
const frontBackends = option('front-backends', 'javascript,wasm').split(',');
const failWasmLoad = option('fail-wasm-load', 'false') === 'true';
if (frontBackends.some(backend => !['default', 'javascript', 'wasm'].includes(backend))) throw Error('Invalid front-app backend.');
const renderOnly = option('render-only', 'false') === 'true';
const workerOnly = option('worker-only', 'false') === 'true';
const onlySupplement = renderOnly || workerOnly || wasmComparison || nativeWorkerOnly || nativeAppOnly || frontAppOnly || frontWorkerOnly || corePipelineOnly || traceOnly || traceAppOnly;
const renderCounts = option('render-counts', '333,1000,1666').split(',').map(Number);
const browserPath = option('browser', process.env.CHROME_PATH || [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].find(existsSync));
if (!browserPath) throw Error('Set CHROME_PATH or --browser= to a local Chromium browser.');
if (![...counts, samples, budgetMs, frontSamples].every(value => Number.isSafeInteger(value) && value > 0)) throw Error('Invalid benchmark options.');
const output = resolve(root, option('output', 'docs/benchmarks/2026-09-26-wasm-baseline'));
mkdirSync(output, { recursive: true });
const profileDir = mkdtempSync(join(tmpdir(), 'paramagic-solver-baseline-'));
let serveBuiltAssets = null;
let bundledWorkerUrl = option('bundled-worker-url', null);
let bundledTraceWorkerUrl = null, bundledOpenCvUrl = null;
const builtTarget = option('built', null);
if (failWasmLoad && !builtTarget) throw Error('The WASM loading-failure test requires emitted assets (--built).');
if (builtTarget) {
  if (!['client', 'pages'].includes(builtTarget)) throw Error('Expected --built=client or pages.');
  const directory = join(root, builtTarget === 'pages' ? 'dist-pages/assets' : 'dist/client/assets');
  const mount = builtTarget === 'pages' ? '/ParaMagic/assets/' : '/assets/';
  const files = new Set(readdirSync(directory).filter(name => /^((SolverWorker|ImageTraceWorker|opencv)-[\w-]+\.js|solver-[\w-]+\.wasm)$/.test(name)));
  bundledWorkerUrl = mount + [...files].find(name => name.startsWith('SolverWorker-'));
  const traceFile = [...files].find(name => name.startsWith('ImageTraceWorker-'));
  const openCvFile = [...files].find(name => name.startsWith('opencv-'));
  if (traceFile) bundledTraceWorkerUrl = mount + traceFile;
  if (openCvFile) bundledOpenCvUrl = mount + openCvFile;
  serveBuiltAssets = (request, response, next) => {
    const name = request.url?.startsWith(mount) ? request.url.slice(mount.length) : '';
    if (!files.has(name)) return next();
    if (failWasmLoad && name.endsWith('.wasm')) {
      response.statusCode = 503;
      response.end('Intentional solver WASM loading failure for the browser regression test.');
      return;
    }
    response.setHeader('Content-Type', name.endsWith('.wasm') ? 'application/wasm' : 'text/javascript');
    response.end(readFileSync(join(directory, name)));
  };
}
const server = await createServer({ root, configFile: false, publicDir: 'src/assets',
  plugins: serveBuiltAssets ? [{ name: 'benchmark-built-assets', configureServer(server) { server.middlewares.use(serveBuiltAssets); } }] : [],
  server: { host: '127.0.0.1', port: 0, strictPort: false }, appType: 'mpa', logLevel: 'error' });
let chrome, cdp;
const report = {
  schemaVersion: 1, startedAt: new Date().toISOString(), commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  environment: { node: process.version, platform: process.platform, cpu: cpus()[0]?.model,
    logicalCpus: cpus().length, systemMemoryBytes: totalmem(), browserPath },
  configuration: { counts, samples, budgetMs, profileCount, auxiliary, renderOnly, workerOnly, renderCounts, wasmComparison, frontAppOnly, frontWorkerOnly, frontSamples, corePipelineOnly, builtTarget,
    frontBackends, failWasmLoad, traceOnly, traceAppOnly, traceBackend: option('trace-backend', 'reference'), traceComplex: option('trace-complex', 'false') === 'true', tracePhases: option('trace-phases', 'false') === 'true',
    mixed, tolerance: 1e-3, maxIterations: 2000 },
  methodology: 'Local Chromium on one machine. Connected-chain samples are uninstrumented, budget-limited, warm-started edits; setup and validation excluded. Front-view samples time actual rendered control edits separately from Worker numerical solving and validate against the JavaScript reference at 1e-8. Core pipeline samples measure expression evaluation and connected-component processing independently, alternating backend order. Separate profiler, phase, transport and rendering runs must not be added to solve time. Unmeasured fields remain null.',
  results: [], phases: [], densePhases: [], parameters: [], graphMutations: [], transport: [], workers: [], rendering: [], profiles: [], errors: [],
  wasmPairs: [], nativeWorkers: [], nativeApp: [], corePipeline: [], trace: [], traceApp: [],
};
const save = () => writeFileSync(join(output, 'browser-baseline.json'), JSON.stringify(report, null, 2) + '\n');
report.sourceSha256 = Object.fromEntries([
  'scripts/solver-baseline/run-browser.mjs', 'scripts/solver-baseline/fixtures.js', 'scripts/solver-baseline/measure.js',
  'scripts/solver-baseline/browser.js', 'scripts/solver-baseline/render.js',
  'scripts/solver-baseline/front-app.js', 'scripts/solver-baseline/front-worker.js', 'src/tests/fixtures/front-view-large-control-edit.paramagic',
  'scripts/solver-baseline/wasm.js', 'scripts/solver-baseline/mixed-fixture.js', 'packages/paramagic-core/native/solver.cpp',
  'packages/paramagic-core/native/constraint_program.h',
  'packages/paramagic-core/native/swell_geometry.h',
  ...['sparse_elimination.h', 'graph_kernel.h', 'parameter_kernel.h', 'continuation.h'].map(name => `packages/paramagic-core/native/${name}`),
  ...['WasmGraph', 'WasmParameters', 'WasmContinuation', 'StackPlacementSolver'].map(name => `packages/paramagic-core/src/modules/solver/${name}.js`),
  'scripts/solver-baseline/core-pipeline.js', 'packages/paramagic-core/src/modules/SwellGeometry.js',
  'scripts/image-trace/measure.js', 'scripts/image-trace/app.js',
  ...['ImageTrace', 'ImageTraceClient', 'ImageTraceKernel', 'ImageTraceWorker', 'ImageTraceWorkerRuntime', 'ImageSystem'].map(name => `packages/paramagic-core/src/modules/${name}.js`),
  'packages/paramagic-core/src/modules/solver/WasmSwellModel.js',
  'packages/paramagic-core/src/modules/solver/WasmConstraintCompiler.js', 'packages/paramagic-core/src/modules/solver/WasmFilletCompiler.js',
  'packages/paramagic-core/src/modules/solver/WasmSolverSession.js',
  'packages/paramagic-core/src/modules/solver/wasm/solver.wasm',
  ...['NumericSolverCore', 'JacobianBlocks', 'AnalyticalJacobians', 'CompiledConstraintSystem', 'ComponentSolver',
    'ConstraintGraph', 'ConstraintRegistry', 'ParameterRepository', 'SolverModel', 'SolverController',
    'SolverWorkerRuntime', 'SolverWorkerClient', 'SolverExecutionFacade'].map(name => `packages/paramagic-core/src/modules/solver/${name}.js`),
].map(path => [path, createHash('sha256').update(readFileSync(join(root, path))).digest('hex')]));

class Connection {
  constructor(socket) {
    this.socket = socket; this.sequence = 0; this.pending = new Map(); this.listeners = new Map();
    socket.addEventListener('message', ({ data }) => {
      const message = JSON.parse(data);
      if (message.id) {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        clearTimeout(pending.timer); this.pending.delete(message.id);
        if (message.error) pending.reject(Error(JSON.stringify(message.error))); else pending.resolve(message.result);
      } else for (const listener of this.listeners.get(message.method) || []) listener(message.params, message.sessionId);
    });
    socket.addEventListener('close', () => {
      for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(Error('Browser disconnected')); }
      this.pending.clear();
    });
  }
  on(method, listener) { if (!this.listeners.has(method)) this.listeners.set(method, []); this.listeners.get(method).push(listener); }
  send(method, params = {}, sessionId, timeoutMs = 120000) {
    return new Promise((resolve, reject) => {
      const id = ++this.sequence;
      const timer = setTimeout(() => { this.pending.delete(id); reject(Error(`${method} exceeded ${timeoutMs} ms`)); }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer, method });
      this.socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }
}
async function page() {
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  await cdp.send('Page.enable', {}, sessionId);
  await cdp.send('Page.navigate', { url: `${server.resolvedUrls.local[0]}scripts/solver-baseline/index.html` }, sessionId);
  for (let i = 0; i < 200; i++) {
    const ready = await cdp.send('Runtime.evaluate', { expression: 'Boolean(window.baseline)', returnByValue: true }, sessionId);
    if (ready.result.value) return { targetId, sessionId };
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw Error('Benchmark module did not load.');
}
async function evaluate(sessionId, expression, timeout = 120000) {
  const result = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId, timeout);
  if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result.value;
}
async function run(method, args, timeout = 120000) {
  const p = await page();
  try {
    if (method.endsWith('AppSample')) await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 960, deviceScaleFactor: 1, mobile: false }, p.sessionId);
    // A small solver warmup for each fresh JS realm. No full-size warmup is hidden.
    await evaluate(p.sessionId, 'baseline.solveSample({count:300,sharedTarget:true,budgetMs:1000})');
    const result = await evaluate(p.sessionId, `baseline.${method}(${JSON.stringify(args)})`, timeout);
    if (method === 'renderSample' || method.endsWith('AppSample')) {
      const screenshot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }, p.sessionId);
      const imageName = method === 'nativeAppSample' ? 'native-app.png'
        : method === 'traceAppSample' ? 'trace-app.png'
        : method === 'frontAppSample' ? `front-app-${args.backend}.png` : `render-${args.count}.png`;
      writeFileSync(join(output, imageName), Buffer.from(screenshot.data, 'base64'));
    }
    return result;
  } catch (error) {
    if (method.endsWith('AppSample')) {
      try {
        const screenshot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }, p.sessionId, 5000);
        writeFileSync(join(output, 'native-app-failure.png'), Buffer.from(screenshot.data, 'base64'));
        writeFileSync(join(output, 'native-app-failure.json'), JSON.stringify(await evaluate(p.sessionId,
          `({text:document.body.innerText,dimensions:[...document.querySelectorAll('.dimension-record')].map(n=>n.outerHTML)})`, 5000), null, 2));
      } catch (captureError) { console.log(`Failure capture: ${captureError.message}`); }
    }
    throw error;
  } finally { await cdp.send('Target.closeTarget', { targetId: p.targetId }); }
}
async function record(collection, method, args, timeout) {
  try {
    const result = await run(method, args, timeout);
    report[collection].push(result);
    console.log(JSON.stringify({ collection, ...args, status: result.samples?.[0]?.status ?? result.status ?? 'completed', elapsedMs: result.samples?.[0]?.elapsedMs ?? result.elapsedMs }));
  } catch (error) { report.errors.push({ collection, method, args, error: error.message }); console.log(JSON.stringify(report.errors.at(-1))); }
  save();
}
function summarizeProfile(profile) {
  const nodes = new Map(profile.nodes.map(node => [node.id, node]));
  const durations = new Map();
  for (let i = 0; i < (profile.samples?.length || 0); i++) durations.set(profile.samples[i], (durations.get(profile.samples[i]) || 0) + profile.timeDeltas[i]);
  const grouped = new Map();
  for (const [id, us] of durations) {
    const frame = nodes.get(id)?.callFrame;
    const key = JSON.stringify([frame?.functionName, frame?.url, frame?.lineNumber]);
    if (!grouped.has(key)) grouped.set(key, { name: frame?.functionName || '(anonymous)', url: frame?.url, line: (frame?.lineNumber ?? -1) + 1, selfMs: 0 });
    grouped.get(key).selfMs += us / 1000;
  }
  return [...grouped.values()].sort((a, b) => b.selfMs - a.selfMs);
}
function sampledBytes(node) { return (node.selfSize || 0) + (node.children || []).reduce((total, child) => total + sampledBytes(child), 0); }

try {
  await server.listen();
  chrome = spawn(browserPath, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profileDir}`,
    '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-background-networking',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--enable-precise-memory-info', 'about:blank'],
    { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
  const endpoint = await new Promise((resolve, reject) => {
    let log = '';
    const timer = setTimeout(() => reject(Error(`Browser launch timed out: ${log.slice(-1500)}`)), 20000);
    chrome.on('error', error => { clearTimeout(timer); reject(error); });
    chrome.stderr.on('data', data => { appendFileSync(join(output, 'browser-launch.log'), data); log += data; const match = log.match(/DevTools listening on (ws:\/\/[^\s]+)/); if (match) { clearTimeout(timer); resolve(match[1]); } });
  });
  const socket = new WebSocket(endpoint);
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  cdp = new Connection(socket);
  report.environment.browser = await cdp.send('Browser.getVersion');
  const p = await page();
  report.environment.browserCapabilities = await evaluate(p.sessionId, '({userAgent:navigator.userAgent,hardwareConcurrency:navigator.hardwareConcurrency,crossOriginIsolated,sharedArrayBuffer:typeof SharedArrayBuffer,wasm:typeof WebAssembly})');
  await cdp.send('Target.closeTarget', { targetId: p.targetId });
  if (nativeWorkerOnly) await record('nativeWorkers', 'nativeWorkerSample', { count: 1000, bundledWorkerUrl, mixed });
  if (frontWorkerOnly) await record('nativeWorkers', 'frontWorkerSample', { bundledWorkerUrl });
  if (traceAppOnly) {
    report.methodology = 'Actual rendered Trace Region panel, seed click, settings changes and Apply, followed by reference constraint validation, Undo, Redo and serialized reload. Emitted Worker/OpenCV assets are used when --built is set; the app harness loads application source through Vite. Timings include UI and rendering where labeled.';
    await record('traceApp', 'traceAppSample', { bundledTraceWorkerUrl, bundledOpenCvUrl, complex: option('trace-complex', 'false') === 'true' }, 180000);
  }
  if (traceOnly) {
    report.methodology = 'Trace Region in local Chromium; first invocation and detail/smoothing/tolerance changes on the same raster. Phase instrumentation is separate from uninstrumented samples.';
    for (const count of counts) for (let sample = 0; sample < samples; sample++) {
      const requested = option('trace-backend', 'reference');
      const backends = requested === 'both' ? (sample % 2 ? ['worker', 'reference'] : ['reference', 'worker']) : [requested];
      for (const backend of backends) await record('trace', 'traceSample', {
        count, sample, phases: option('trace-phases', 'false') === 'true', backend, bundledTraceWorkerUrl, bundledOpenCvUrl,
      });
    }
  }
  if (corePipelineOnly) for (const count of counts) for (let sample = 0; sample < samples; sample++) {
    for (const backend of sample % 2 ? ['wasm', 'javascript'] : ['javascript', 'wasm'])
      await record('corePipeline', 'corePipelineSample', { count, backend, sample }, 60000);
  }
  if (nativeAppOnly) await record('nativeApp', 'nativeAppSample', { mixed });
  if (frontAppOnly) for (let sample = 0; sample < frontSamples; sample++) {
    for (const backend of sample % 2 ? [...frontBackends].reverse() : frontBackends)
      await record('nativeApp', 'frontAppSample', { backend, sample, bundledWorkerUrl, expectWasmLoadFailure: failWasmLoad && backend !== 'javascript' }, 120000);
  }
  if (wasmComparison) {
    report.methodology = 'Paired same-Chrome JS/WASM resident numerical solves; separate fixed-iteration preview throughput and normal-tolerance final convergence. Load/validation excluded; typed-array synchronization included. No speedup for unequal incomplete work.';
    for (const count of counts) for (let sample = 0; sample < samples; sample++) {
      await record('wasmPairs', 'pairSample', { count, mixed, budgetMs, maxIterations: 2000, reverse: sample % 2 === 1 });
      await record('wasmPairs', 'pairSample', { count, mixed, budgetMs: 60000, maxIterations: 2, mode: 'interactive', reverse: sample % 2 === 0 });
    }
    await record('wasmPairs', 'pairSample', { count: mixed ? Math.min(...counts) : 1000, mixed, budgetMs: 30000, repeats: 3 });
    await record('nativeWorkers', 'nativeWorkerSample', { count: 1000, mixed });
  }
  for (const count of onlySupplement ? [] : counts) for (let sample = 0; sample < samples; sample++) {
    await record('results', 'solveSample', { count, budgetMs, sharedTarget: true });
  }
  for (const count of onlySupplement ? [] : counts) await record('phases', 'phaseSample', { count, budgetMs });
  if (auxiliary && !onlySupplement) {
    await record('densePhases', 'densePhaseSample', { count: 90 });
    await record('results', 'solveSample', { count: 30, budgetMs, tolerance: 1e-8, sharedTarget: true, repeats: 3 });
    for (const tolerance of [1e-3, 1e-8]) await record('results', 'solveSample', { count: 1000, budgetMs, tolerance, repeats: 3 });
    for (const count of [1000, 5000, 10000]) await record('parameters', 'parameterSample', { count });
    // This mutation is not cancellable in production. Bound its scale; do not
    // extrapolate a completed bridge update to 100,000 constraints.
    for (const count of [1000, 3000, 5000]) await record('graphMutations', 'graphMutationSample', { count }, 30000);
    for (const count of counts) await record('transport', 'transportSample', { count });
  }
  if ((auxiliary && !onlySupplement) || workerOnly) for (const count of [1000, 5000]) await record('workers', 'workerSample', { count }, 30000);
  if ((auxiliary && !onlySupplement) || renderOnly) for (const count of renderCounts) await record('rendering', 'renderSample', { count }, 60000);
  if (profileCount > 0 && !onlySupplement) {
    const p = await page();
    try {
      await evaluate(p.sessionId, 'baseline.solveSample({count:300,sharedTarget:true,budgetMs:1000})');
      await cdp.send('Profiler.enable', {}, p.sessionId);
      await cdp.send('Profiler.setSamplingInterval', { interval: 1000 }, p.sessionId);
      await cdp.send('Profiler.start', {}, p.sessionId);
      const profiled = await evaluate(p.sessionId, `baseline.solveSample({count:${profileCount},sharedTarget:true,budgetMs:${budgetMs}})`);
      const { profile } = await cdp.send('Profiler.stop', {}, p.sessionId);
      writeFileSync(join(output, 'solver.cpuprofile'), JSON.stringify(profile));
      const ranks = summarizeProfile(profile);
      writeFileSync(join(output, 'cpu-self-time.json'), JSON.stringify(ranks, null, 2) + '\n');
      await cdp.send('HeapProfiler.startSampling', { samplingInterval: 32768,
        includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true }, p.sessionId);
      const allocationRun = await evaluate(p.sessionId, `baseline.solveSample({count:${profileCount},sharedTarget:true,budgetMs:${budgetMs}})`);
      const allocation = await cdp.send('HeapProfiler.stopSampling', {}, p.sessionId);
      writeFileSync(join(output, 'allocations.heapprofile'), JSON.stringify(allocation.profile));
      report.profiles.push({ count: profileCount, cpu: profiled, allocationRun,
        sampledDurationMs: profile.timeDeltas.reduce((sum, us) => sum + us, 0) / 1000,
        sampledAllocatedBytesEstimate: sampledBytes(allocation.profile.head),
        garbageCollectorSampleMs: ranks.filter(row => row.name === '(garbage collector)').reduce((sum, row) => sum + row.selfMs, 0),
        topSelfTime: ranks.slice(0, 25) });
    } finally { await cdp.send('Target.closeTarget', { targetId: p.targetId }); }
  }
  report.finishedAt = new Date().toISOString();
  save();
} catch (error) {
  report.errors.push({ stage: 'runner', error: error.stack }); save(); throw error;
} finally {
  if (cdp) { try { await cdp.send('Browser.close', {}, undefined, 5000); } catch {} cdp.socket.close(); }
  if (chrome && chrome.exitCode === null) await new Promise(resolve => {
    const timer = setTimeout(() => { chrome.kill(); resolve(); }, 5000);
    chrome.once('exit', () => { clearTimeout(timer); resolve(); });
  });
  await server.close();
  // Only delete the exact temporary browser profile created by this process.
  const resolvedProfile = realpathSync(profileDir);
  const relativeProfile = relative(realpathSync(tmpdir()), resolvedProfile);
  if (!relativeProfile.startsWith('..') && !isAbsolute(relativeProfile) && relativeProfile.startsWith('paramagic-solver-baseline-')) {
    try { rmSync(resolvedProfile, { recursive: true, force: true, maxRetries: 3 }); } catch { /* browser may still be releasing its profile */ }
  }
}
if (report.errors.length) process.exitCode = 1;
