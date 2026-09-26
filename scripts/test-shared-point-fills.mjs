// Run against Vite on port 5180; PLAYWRIGHT_MODULE_PATH may point to bundled Playwright.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const browser = await chromium.launch({ headless: true, channel: 'msedge' });
const directory = 'tmp/shared-point-fills';
await mkdir(directory, { recursive: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('http://127.0.0.1:5180/ParaMagic/src/tests/fixtures/shared-point-fills-browser.html');
  const output = page.getByLabel('Shared point fill verification');
  await output.filter({ hasText: 'PASS:' }).waitFor();
  for (const [label, name] of [['Line / arc / curve', 'loose'], ['Touching rectangles', 'rectangles'], ['Mixed objects', 'mixed']]) {
    await page.getByRole('button', { name: label, exact: true }).click();
    for (const operation of [null, 'Reverse record order', 'Save / reload']) {
      if (operation) await page.getByRole('button', { name: operation, exact: true }).click();
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      assert.match(await output.textContent(), /^PASS:/);
      // Exercise real interior clicks and check that selection stays on that
      // region's members, not the other closed object's edges.
      const regions = await page.locator('.resolved-boundary-visual').evaluateAll((paths) => paths.map((path) => {
        const bounds = path.getBBox();
        const point = new DOMPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2).matrixTransform(path.getScreenCTM());
        return { x: point.x, y: point.y, members: path.dataset.parentIds.split(',').sort(), color: getComputedStyle(path).fill };
      }));
      for (const region of regions) {
        await page.mouse.click(region.x, region.y);
        await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        const selected = await page.locator('.closed-region-hit.selected').evaluateAll((nodes) => nodes.map((node) => node.dataset.parentIds.split(',').sort()));
        assert.deepEqual(selected, [region.members], `${name}: interior click selects exactly its own boundary`);
      }
      assert.deepEqual(errors, []);
    }
    // Reopen a serialized drawing through the application's file input so
    // history starts at the same baseline as a normal Open operation.
    await page.getByRole('button', { name: 'Reopen drawing file', exact: true }).click();
    await output.filter({ hasText: 'PASS:' }).waitFor();
    const target = await page.locator('.resolved-boundary-visual').first().evaluate((path) => {
      const bounds = path.getBBox();
      const point = new DOMPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2).matrixTransform(path.getScreenCTM());
      return { x: point.x, y: point.y };
    });
    await page.mouse.click(target.x, target.y);
    const colors = () => page.locator('.resolved-boundary-visual').evaluateAll((paths) => Object.fromEntries(paths.map((path) => [path.dataset.boundaryId, getComputedStyle(path).fill])));
    const before = await colors();
    const selectedId = await page.locator('.closed-region-hit.selected').getAttribute('data-boundary-id');
    await page.locator('#fillExpressionProperty').fill('#28a86b');
    await page.locator('#fillExpressionProperty').press('Tab');
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const expected = { ...before, [selectedId]: 'rgb(40, 168, 107)' };
    assert.deepEqual(await colors(), expected, `${name}: editing a region's fill preserves its neighbour`);
    await page.locator('#undoButton').click();
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.deepEqual(await colors(), before, `${name}: Undo restores the original region fills`);
    await page.locator('#redoButton').click();
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.deepEqual(await colors(), expected, `${name}: Redo changes only the selected region`);
    await page.locator('#undoButton').click();
    await page.mouse.move(310, 110);
    await page.screenshot({ path: `${directory}/${name}.png` });
    console.log(`PASS: ${label}: independent fills, interior selection, reordering, save/reload, fill editing and Undo/Redo.`);
  }
} finally {
  await browser.close();
}
