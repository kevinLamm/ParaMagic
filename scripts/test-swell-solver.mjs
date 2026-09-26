// Run against Vite on port 5180; PLAYWRIGHT_MODULE_PATH can select bundled Playwright.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const fixture = process.env.SWELL_FIXTURE || 'src/tests/fixtures/swell-front-view.paramagic';
const output = 'tmp/swell-solver';
await mkdir(output, { recursive: true });
const drawing = JSON.parse(await readFile(fixture, 'utf8'));
const widthDimension = drawing.parameters.find(({ name }) => name === 'd10');
const heightDimension = drawing.parameters.find(({ name }) => name === 'd7');
const browser = await chromium.launch({ headless: true, channel: 'msedge' });
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1100 }, acceptDownloads: true });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => {
    Object.defineProperty(window, 'showSaveFilePicker', { value: undefined, configurable: true });
    window.__workerResults = [];
    const OriginalWorker = window.Worker;
    window.Worker = class extends OriginalWorker {
      constructor(...args) {
        super(...args);
        this.addEventListener('message', (event) => window.__workerResults.push(event.data));
      }
    };
  });
  await page.goto('http://127.0.0.1:5180/ParaMagic/');
  await page.waitForFunction(() => document.documentElement.dataset.browserAutosaveState === 'ready');
  await page.locator('#openDrawingFileInput').setInputFiles(fixture);
  await page.waitForFunction((id) => document.querySelector(`[data-record-id="${id}"]`), widthDimension.annotationId);
  await page.evaluate(async (stackId) => {
    window.__canvas = (await import(document.querySelector('script[src*="/src/main.js"]').src)).canvasController;
    window.__canvas.setActiveStack(stackId);
  }, widthDimension.stackId);
  await page.locator('#resetView').click();
  const settled = async () => {
    await page.waitForFunction(() => !window.__canvas.isDrawingUpdatePending());
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  };
  const label = (dimension) => page.locator(`[data-record-id="${dimension.annotationId}"] .dimension-text`);
  const verify = async (width, stage) => {
    await settled();
    await label(widthDimension).filter({ hasText: `d10 = ${width}` }).waitFor();
    assert.equal(await label(widthDimension).isVisible(), true, `${stage}: d10 is visible`);
    assert.equal(await label(heightDimension).textContent(), 'd7 = 20');
    assert.equal(await page.locator('.solve-offender').count(), 0, `${stage}: no broken constraint marker`);
    assert.equal((await page.locator('#solverStatus').textContent()).trim(), '', `${stage}: solver status clear`);
    const result = await page.evaluate(async () => {
      const canvas = window.__canvas;
      const data = canvas.getDrawingData();
      const { identityAudit } = await import('/ParaMagic/packages/paramagic-core/src/modules/DrawingIdentitySystem.js');
      const { deriveSwellGeometry } = await import('/ParaMagic/packages/paramagic-core/src/modules/SwellGeometry.js');
      const derived = deriveSwellGeometry({ entities: data.entities, constraints: data.constraints,
        evaluateLength: (expression, entity) => canvas.evaluateLengthExpression(expression, entity) });
      const gaps = data.constraints.filter((constraint) => constraint.type === 'Coincident' && constraint.featureRefs.some((ref) => ref.derivedFeature))
        .map((constraint) => {
          const ref = constraint.featureRefs.find((entry) => entry.derivedFeature);
          const other = constraint.featureRefs.find((entry) => !entry.derivedFeature);
          const piece = derived.get(ref.recordId).pieces.find(({ role }) => role === ref.derivedFeature.role);
          const endpoint = data.entities.find(({ id }) => id === other.recordId)[other.index === 0 ? 'start' : 'end'];
          const target = piece.entity[ref.index === 0 ? 'start' : 'end'];
          const path = document.querySelector(`[data-swell-piece-id="${piece.id}"]`);
          return { gap: Math.hypot(endpoint[0] - target[0], endpoint[1] - target[1]), rendered: Boolean(path && path.getBBox().width > 0) };
        });
      const widthLine = data.entities.find(({ id }) => id === 'e00ba7d1-23a4-46bf-8014-b9cb8e6b54dc');
      const height = data.constraints.find((constraint) => constraint.dimensionRef === data.parameters.find(({ name }) => name === 'd7').id);
      const ref = height.anchors.start;
      const swell = derived.get(ref.recordId).pieces.find(({ role }) => role === ref.derivedFeature.role);
      const other = data.entities.find(({ id }) => id === height.anchors.end.recordId).start;
      const measuredHeight = Math.abs(swell.entity.end[1] - other[1]) / 25.4;
      return { data, validIdentity: identityAudit(data).valid, gaps, measuredHeight,
        measuredWidth: Math.hypot(widthLine.start[0] - widthLine.end[0], widthLine.start[1] - widthLine.end[1]) / 25.4,
        rendered: [...document.querySelectorAll('.geometry-record, .swell-derived-group')].map((node) => ({
          id: node.dataset.recordId || node.dataset.swellOwnerId,
          shapes: [...node.querySelectorAll('.selectable-entity:not(.hit-target), .swell-derived-piece')]
            .map((shape) => [shape.tagName, ...['d', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'points'].map((name) => shape.getAttribute(name))]),
        })),
      };
    });
    assert.equal(result.data.constraints.length, 84);
    assert.ok(result.data.constraints.every((constraint) => constraint.enabled !== false && !constraint.loadError));
    assert.ok(result.validIdentity, `${stage}: drawing identity valid`);
    assert.equal(result.gaps.length, 4);
    assert.ok(result.gaps.every(({ gap, rendered }) => gap < 0.001 && rendered), `${stage}: all rendered Swell joints attached`);
    assert.ok(Math.abs(result.measuredWidth - width) < width * 0.001);
    assert.ok(Math.abs(result.measuredHeight - 20) < 0.001);
    assert.deepEqual(errors, []);
    await page.screenshot({ path: `${output}/${stage}.png` });
    console.log(`PASS: ${stage}: d10=${width}, d7=20, 84 constraints, 4 attached Swell joints, no solver errors.`);
    return result;
  };
  const initial = await verify(50, 'opened');
  await page.locator(`[data-record-id="${widthDimension.annotationId}"] .dimension-text-hit`).dblclick();
  await page.locator('.dimension-edit-input').fill('52');
  await page.locator('.dimension-edit-input').press('Enter');
  await page.waitForFunction((id) => window.__canvas.getParameters().find((parameter) => parameter.id === id)?.expression === '52', widthDimension.id);
  const edited = await verify(52, 'edited');
  assert.notDeepEqual(edited.rendered, initial.rendered);
  await page.locator('#undoButton').click();
  const undone = await verify(50, 'undo');
  assert.deepEqual(undone.rendered, initial.rendered);
  await page.locator('#redoButton').click();
  const redone = await verify(52, 'redo');
  assert.deepEqual(redone.rendered, edited.rendered);
  const downloadPromise = page.waitForEvent('download');
  await page.locator('#appMenuToggle').click();
  await page.locator('#saveButton').click();
  await page.locator('.save-as-name').fill('Swell-front-view-verified');
  await page.locator('.save-as-confirm').click();
  const download = await downloadPromise;
  const saved = `${output}/verified.paramagic`;
  await download.saveAs(saved);
  await page.evaluate(() => { window.__previous = document.querySelector('.canvas-record'); });
  await page.locator('#openDrawingFileInput').setInputFiles(saved);
  await page.waitForFunction(() => !window.__previous.isConnected);
  await page.evaluate((stackId) => window.__canvas.setActiveStack(stackId), widthDimension.stackId);
  await page.locator('#resetView').click();
  const reopened = await verify(52, 'reopened');
  assert.deepEqual(reopened.rendered, edited.rendered);
  const workers = await page.evaluate(() => window.__workerResults);
  await writeFile(`${output}/workers.json`, JSON.stringify(workers, null, 2));
  assert.ok(workers.some((result) => result.commandType === 'set-dimension' && ['converged', 'unchanged'].includes(result.status)), 'dimension edit uses the worker');
  await writeFile(`${output}/results.json`, JSON.stringify({ widths: [initial.measuredWidth, edited.measuredWidth, reopened.measuredWidth], workers, errors }, null, 2));
  const reordered = structuredClone(drawing);
  reordered.entities.reverse();
  reordered.constraints.reverse();
  reordered.extensions.swell.constraints.reverse();
  await page.locator('#openDrawingFileInput').setInputFiles({ name: 'Swell-reordered.paramagic', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(reordered)) });
  await page.waitForFunction(() => document.title.includes('Swell-reordered'));
  await page.evaluate((stackId) => window.__canvas.setActiveStack(stackId), widthDimension.stackId);
  await page.locator('#resetView').click();
  await verify(50, 'reordered');
} finally {
  await browser.close();
}
