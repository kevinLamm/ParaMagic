// Requires a local preview and Playwright. Uses real pointer events on the
// supplied drawing to catch focus moving into SVG <use> instance trees.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const output = 'tmp/derivative-focus';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: 'msedge' });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.goto(process.env.PARAMAGIC_TEST_URL || 'http://127.0.0.1:5187/ParaMagic/');
  await page.waitForFunction(() => document.documentElement.dataset.browserAutosaveState === 'ready');
  await page.locator('#openDrawingFileInput').setInputFiles(process.argv[2] || 'src/tests/fixtures/rectangle-ottoman-latest-controls.paramagic');
  await page.waitForFunction(() => document.querySelectorAll('.canvas-record').length > 60);
  await page.evaluate(async () => {
    const module = await import(document.querySelector('script[src*="/src/main.js"]').src);
    await module.initialization;
    window.__canvas = module.canvasController;
    window.__canvas.setActiveStack(null);
  });
  await page.waitForFunction(() => !window.__canvas.isDrawingUpdatePending());
  const targets = await page.evaluate(() => [...document.querySelectorAll('.array-item-hit-use, .linked-copy-hit')].map(node => {
    const box = node.getBoundingClientRect();
    const x = box.x + box.width / 2, y = box.y + box.height / 2;
    const group = node.closest('.array-group, .linked-copy-group');
    if (x < 320 || x > innerWidth - 20 || y < 80 || y > innerHeight - 30) return null;
    if (document.elementFromPoint(x, y)?.closest('.array-group, .linked-copy-group') !== group) return null;
    return { x, y, stackId: group.dataset.stackId, arrayId: group.dataset.arrayId || null, copyId: group.dataset.linkedCopyId || null };
  }).filter(Boolean));
  assert.ok(targets.some(target => target.arrayId), 'array hit targets are visible');
  assert.ok(targets.some(target => target.copyId), 'linked-copy hit targets are visible');
  for (const target of targets) {
    await page.mouse.click(target.x, target.y);
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'canvas', 'clicking a derivative keeps keyboard focus on the canvas');
  }
  assert.equal(await page.evaluate(() => [...document.querySelectorAll('.array-item-content [tabindex], .array-item-content[tabindex], .linked-copy-content [tabindex], .linked-copy-content[tabindex]')]
    .filter(node => node.namespaceURI === 'http://www.w3.org/2000/svg').length), 0, 'SVG presentation clones do not become focus targets');
  const target = targets.find(target => target.arrayId);
  await page.mouse.click(target.x, target.y);
  assert.ok(await page.locator('.stack-tree-row.geometry-hovered').count(), 'normal Stack hover highlighting remains');
  await page.screenshot({ path: `${output}/no-active-stack.png` });
  await page.evaluate(stackId => window.__canvas.setActiveStack(stackId), target.stackId);
  await page.waitForFunction(() => !window.__canvas.isDrawingUpdatePending());
  const stroke = await page.evaluate(id => {
    const group = document.querySelector(`.array-group[data-array-id="${id}"]`);
    for (const node of group.querySelectorAll('.array-item-template .selectable-entity:not(.hit-target)')) {
      if (!node.getTotalLength) continue;
      for (const fraction of [0.3, 0.7]) {
        const point = node.getPointAtLength(node.getTotalLength() * fraction).matrixTransform(node.getScreenCTM());
        if (point.x < 320 || point.x > innerWidth - 20 || point.y < 80 || point.y > innerHeight - 30) continue;
        if (document.elementFromPoint(point.x, point.y)?.closest('.array-group') === group) return { x: point.x, y: point.y };
      }
    }
    return null;
  }, target.arrayId);
  assert.ok(stroke, 'an unobstructed array stroke is available for selection');
  await page.mouse.click(stroke.x, stroke.y);
  await page.waitForFunction(id => document.querySelector(`.array-group[data-array-id="${id}"]`)?.classList.contains('selected'), target.arrayId);
  assert.equal(await page.locator(`.array-group[data-array-id="${target.arrayId}"].selected`).count(), 1, 'active-stack array selection remains usable');
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'canvas');
  console.log(`PASS: ${targets.length} derivative clicks retain canvas focus, with Stack hover and active-stack selection intact.`);
} finally {
  await browser.close();
}
