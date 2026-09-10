// Run against Vite on port 5180; PLAYWRIGHT_MODULE_PATH may point to a bundled Playwright.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, readFile } from 'node:fs/promises';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const browser = await chromium.launch({ headless: true, channel: 'msedge' });
const output = 'tmp/control-progression';
await mkdir(output, { recursive: true });
const errors = [];

async function openPage() {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://127.0.0.1:5180/ParaMagic/');
  await page.evaluate(async () => {
    window.testCanvas = (await import('/ParaMagic/src/main.js')).canvasController;
  });
  return page;
}

async function settled(page, name, value) {
  await page.waitForFunction(({ name, value }) => (
    window.testCanvas.getParameters().find(p => p.name === name)?.value === value
    && !window.testCanvas.isDrawingUpdatePending()
    && !document.querySelector('[data-control-id][aria-busy]')
  ), { name, value }, { timeout: 90000 });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

async function checkPair(row, value, step) {
  for (const selector of ['.panel-control-slider-value', '.panel-control-scrollbar']) {
    assert.equal(await row.locator(selector).inputValue(), String(value));
    assert.equal(await row.locator(selector).getAttribute('step'), String(step));
  }
}

try {
  const page = await openPage();
  const fixture = 'src/tests/fixtures/rectangle-ottoman-controls.paramagic';
  const drawing = JSON.parse(await readFile(fixture, 'utf8'));
  await page.locator('#openDrawingFileInput').setInputFiles(fixture);
  await page.waitForFunction(() => document.querySelectorAll('.canvas-record').length > 60);
  await settled(page, 'c1', 70);
  if (await page.locator('#controlsPanel').isHidden()) await page.locator('#controlsToggle').click();
  const item = drawing.extensions.controls.items.find(control => control.parameterName === 'c1');
  const row = page.locator(`[data-control-id="${item.id}"]`);
  const number = row.locator('.panel-control-slider-value');
  const slider = row.locator('.panel-control-scrollbar');
  const geometry = () => page.locator('.geometry-record .selectable-entity:not(.hit-target)').evaluateAll(
    nodes => nodes.map(node => ['d', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'transform'].map(a => node.getAttribute(a))),
  );
  const before = await geometry();
  await checkPair(row, 70, 0.5);
  await number.press('ArrowUp');
  await number.press('Tab');
  await settled(page, 'c1', 70.5);
  await checkPair(row, 70.5, 0.5);
  assert.notDeepEqual(await geometry(), before, 'Number arrow updates the rendered drawing');
  await number.press('ArrowDown');
  await number.press('Tab');
  await settled(page, 'c1', 70);
  await checkPair(row, 70, 0.5);
  await slider.press('ArrowRight');
  await settled(page, 'c1', 70.5);
  await checkPair(row, 70.5, 0.5);
  await page.screenshot({ path: `${output}/ottoman-half-inch.png` });
  await page.close();
  console.log('Ottoman: numeric arrows and slider both advance by 0.5 and update rendered geometry.');

  const controlsPage = await openPage();
  if (await controlsPage.locator('#controlsPanel').isHidden()) await controlsPage.locator('#controlsToggle').click();
  await controlsPage.locator('[data-controls-edit]').click();
  await controlsPage.locator('[data-control-add]').selectOption('Slider Control');
  const customRow = controlsPage.locator('[data-control-id]').first();
  const expression = customRow.locator('[data-control-expression]');
  const customNumber = customRow.locator('.panel-control-slider-value');
  const customSlider = customRow.locator('.panel-control-scrollbar');
  // Keep the same rendered row throughout: this exercises runtime synchronization.
  for (const step of [0.5, 0.25, 2]) {
    await expression.fill(`MinMax(0.25, 10.25, 2.25, ${step})`);
    await expression.press('Tab');
    await settled(controlsPage, 'c1', 2.25);
    await checkPair(customRow, 2.25, step);
    await customNumber.press('ArrowUp');
    await customNumber.press('Tab');
    await settled(controlsPage, 'c1', 2.25 + step);
    await checkPair(customRow, 2.25 + step, step);
    await customSlider.press('ArrowLeft');
    await settled(controlsPage, 'c1', 2.25);
    await checkPair(customRow, 2.25, step);
  }
  await expression.fill('MinMax(0.25, 10.25, 2.25, 0.5)');
  await expression.press('Tab');
  await settled(controlsPage, 'c1', 2.25);
  await customNumber.fill('2.6');
  assert.equal(await customNumber.inputValue(), '2.6', 'Typing remains unsnapped before committing');
  await customNumber.press('Tab');
  await settled(controlsPage, 'c1', 2.75);
  await checkPair(customRow, 2.75, 0.5);
  for (const [typed, expected, arrow] of [['-1', 0.25, 'ArrowDown'], ['20', 10.25, 'ArrowUp']]) {
    await customNumber.fill(typed);
    await customNumber.press('Tab');
    await settled(controlsPage, 'c1', expected);
    await customNumber.press(arrow);
    await customNumber.press('Tab');
    await checkPair(customRow, expected, 0.5);
  }
  await controlsPage.screenshot({ path: `${output}/custom-progression.png` });
  assert.deepEqual(errors, []);
  console.log('Custom control: live step changes, offset minimum, typed snapping and endpoint bounds pass.');
} finally {
  await browser.close();
}
