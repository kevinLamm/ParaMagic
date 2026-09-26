// Run against Vite on port 5180; PLAYWRIGHT_MODULE_PATH may point to bundled Playwright.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const browser = await chromium.launch({ headless: true, channel: 'msedge' });
const output = 'tmp/value-only-construction';
await mkdir(output, { recursive: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://127.0.0.1:5180/ParaMagic/src/tests/fixtures/value-only-construction-browser.html');
  await page.waitForFunction(() => [...document.querySelectorAll('output')].some(node => /^(PASS|FAIL):/.test(node.textContent)));
  const report = (await page.locator('output').allTextContents()).find(text => /^(PASS|FAIL):/.test(text));
  assert.match(report, /^PASS:/);
  assert.deepEqual(errors, []);
  await page.screenshot({ path: `${output}/nested-derivatives.png` });
  console.log(report);

  await page.goto('http://127.0.0.1:5180/ParaMagic/');
  await page.locator('#openDrawingFileInput').setInputFiles('src/tests/fixtures/rectangle-ottoman-latest-controls.paramagic');
  await page.waitForFunction(() => document.querySelectorAll('.canvas-record').length > 60);
  const settled = () => page.evaluate(async () => {
    const { canvasController } = await import('/ParaMagic/src/main.js');
    while (canvasController.isDrawingUpdatePending()) await new Promise(resolve => requestAnimationFrame(resolve));
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  await settled();
  const visibleConstruction = () => page.locator('.construction').evaluateAll(nodes => nodes.filter(node => {
    if (node.closest('defs')) return false;
    for (let parent = node; parent; parent = parent.parentElement) {
      if (getComputedStyle(parent).display === 'none' || getComputedStyle(parent).visibility === 'hidden') return false;
    }
    return node.getClientRects().length > 0;
  }).length);
  const before = await visibleConstruction();
  assert.ok(before > 0, 'Ottoman starts with visible construction geometry');
  await page.locator('#dimensionTextMode').click();
  await settled();
  assert.equal(await visibleConstruction(), 0, 'Value Only hides all visible construction geometry');
  const geometryVisible = await page.locator('.array-group, .linked-copy-group, .geometry-record').evaluateAll(nodes => nodes.some(node => getComputedStyle(node).display !== 'none' && node.getClientRects().length > 0));
  assert.equal(geometryVisible, true);
  await page.screenshot({ path: `${output}/ottoman-value-only.png` });
  await page.locator('#dimensionTextMode').click();
  await settled();
  assert.equal(await visibleConstruction(), before, 'Expression view restores construction geometry');
  assert.deepEqual(errors, []);
  console.log(`Ottoman: ${before} construction shapes hidden in Value Only and restored in Expression view.`);
} finally {
  await browser.close();
}
