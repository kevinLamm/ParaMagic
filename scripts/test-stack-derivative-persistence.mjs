import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const baseUrl = process.env.PARAMAGIC_TEST_URL || 'http://127.0.0.1:5187/ParaMagic/';
const output = 'tmp/stack-derivative-persistence';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: 'msedge' });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('pageerror', error => { errors.push(error.message); console.log('PAGE ERROR', error.message); });
  await page.addInitScript(() => { window.showSaveFilePicker = undefined; });
  await page.goto(baseUrl);
  await page.waitForFunction(() => document.documentElement.dataset.browserAutosaveState === 'ready');
  await page.locator('#openDrawingFileInput').setInputFiles('src/tests/fixtures/rectangle-ottoman-latest-controls.paramagic');
  await page.waitForFunction(() => document.querySelectorAll('.canvas-record').length > 60);
  const state = () => page.evaluate(async base => {
    const { canvasController: canvas, initialization } = await import(document.querySelector('script[src*="/src/main.js"]').src);
    await initialization;
    while (canvas.isDrawingUpdatePending()) await new Promise(resolve => requestAnimationFrame(resolve));
    const drawing = canvas.getDrawingData();
    const layer = canvas.getObjectLayer();
    return {
      entityCount: drawing.entities.length,
      extensionKeys: Object.keys(drawing.extensions || {}),
      copies: drawing.extensions?.linkedCopyTools?.copies || [],
      arrays: drawing.extensions?.arrayTools?.arrays || [],
      annotations: drawing.dimensionAnnotations.map(({ id }) => id).sort(),
      painted: [...layer.querySelectorAll(':scope > .linked-copy-group, :scope > .array-group')]
        .filter(node => getComputedStyle(node).display !== 'none' && node.getBBox().width > 0)
        .map(node => node.dataset.linkedCopyId || node.dataset.arrayId).sort(),
    };
  }, baseUrl);
  const before = await state();
  assert.equal(before.copies.length, 2);
  assert.equal(before.arrays.length, 8);
  console.log('before', JSON.stringify({ copies: before.copies.length, arrays: before.arrays.length, painted: before.painted.length }));
  const row = page.locator(`[data-stack-id="${process.env.STACK_TEST_ID || '4fa0f5b9-33b9-4699-a4fd-b6e388ffbb63'}"]`);
  await row.locator('[data-stack-name]').click();
  await row.locator('[data-stack-enable]').click();
  await state();
  await page.locator('#appMenuToggle').click();
  await page.locator('#saveButton').click();
  const downloading = page.waitForEvent('download');
  await page.locator('.save-as-confirm').click();
  await (await downloading).saveAs(`${output}/disabled-stack.paramagic`);
  await page.waitForFunction(() => document.querySelector('#solverStatus').textContent.startsWith('Saved '));
  // Reload the browser-local drawing while the Stack remains disabled.
  await page.reload();
  await page.waitForFunction(() => document.documentElement.dataset.browserAutosaveState === 'ready');
  await row.locator('[data-stack-name]').click();
  const disabled = await state();
  console.log('disabled', JSON.stringify({ copies: disabled.copies.length, arrays: disabled.arrays.length, painted: disabled.painted.length }));
  await row.locator('[data-stack-enable]').click();
  const after = await state();
  await page.screenshot({ path: `${output}/re-enabled.png` });
  console.log('enabled', JSON.stringify({ copies: after.copies.length, arrays: after.arrays.length, painted: after.painted.length }));
  assert.deepEqual(disabled.copies.map(({ id }) => id), before.copies.map(({ id }) => id), 'disabling preserves copy definitions');
  assert.deepEqual(disabled.arrays.map(({ id }) => id), before.arrays.map(({ id }) => id), 'disabling preserves array definitions');
  assert.deepEqual(after.painted, before.painted, 'all derivative groups render again after enabling');
  assert.deepEqual(after.annotations, before.annotations, 'dimensions survive the enable cycle');
  assert.deepEqual(errors, []);
  console.log('PASS: Stack disable/enable preserves derivatives and dimensions and restores rendered geometry.');
} finally { await browser.close(); }
