// Run against Vite; PLAYWRIGHT_MODULE_PATH may select bundled Playwright.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const baseUrl = process.env.PARAMAGIC_TEST_URL || 'http://127.0.0.1:5180/ParaMagic/';
const output = 'tmp/stack-png-export';
await mkdir(output, { recursive: true });
const palette = { parent: [224, 32, 32], child: [32, 176, 64], grandchild: [32, 64, 224], sibling: [208, 32, 208], global: [240, 144, 32], disabled: [32, 192, 208] };
const browser = await chromium.launch({ headless: true, channel: 'msedge' });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => { window.showSaveFilePicker = undefined; });
  await page.goto(baseUrl);
  await page.waitForFunction(() => document.documentElement.dataset.browserAutosaveState === 'ready');
  const fixture = await page.evaluate(async (colors) => {
    const { canvasController: canvas, initialization } = await import(document.querySelector('script[src*="/src/main.js"]').src);
    await initialization;
    window.__pngCanvas = canvas;
    const parent = canvas.addStack({ name: 'PNG Parent' });
    const child = canvas.addChildStack(parent.id, 'PNG Child');
    const grandchild = canvas.addChildStack(child.id, 'PNG Grandchild');
    const disabled = canvas.addChildStack(parent.id, 'PNG Disabled');
    const sibling = canvas.addStack({ name: 'PNG Sibling' });
    canvas.setStackEnabled(disabled.id, false);
    const drawing = canvas.getDrawingData();
    const global = drawing.extensions.stacks.stacks.find((stack) => stack.kind === 'global' || stack.name === 'Global');
    const ids = { parent: parent.id, child: child.id, grandchild: grandchild.id, sibling: sibling.id, global: global.id, disabled: disabled.id };
    const locations = { parent: [0, 0], child: [100, 0], grandchild: [0, 80], disabled: [100, 80], sibling: [500, 0], global: [500, 80] };
    drawing.entities = Object.entries(ids).map(([key, stackId]) => {
      const [x, y] = locations[key];
      const fill = `#${colors[key].map((value) => value.toString(16).padStart(2, '0')).join('')}`;
      return { id: crypto.randomUUID(), type: 'polygon', stackId,
        points: [[x, y], [x + 80, y], [x + 80, y + 60], [x, y + 60]],
        appearance: { fillColor: fill, fillExpression: fill, fillOpacity: 1 },
      };
    });
    drawing.constraints = [];
    drawing.parameters = [];
    drawing.dimensions = [];
    drawing.dimensionAnnotations = [];
    canvas.loadDrawingData(drawing, { zoomToFit: true });
    return { ids, drawing: canvas.getDrawingData() };
  }, palette);
  await writeFile(`${output}/fixture.paramagic`, JSON.stringify(fixture.drawing, null, 2));
  const results = [];
  for (const [scope, included] of [['parent', ['parent', 'child', 'grandchild']], ['child', ['child', 'grandchild']], ['drawing', ['parent', 'child', 'grandchild', 'sibling', 'global']]]) {
    if (scope === 'drawing') {
      await page.locator('#appMenuToggle').click();
      await page.locator('#saveAsButton').click();
    } else {
      await page.evaluate((id) => window.__pngCanvas.setActiveStack(id), fixture.ids[scope]);
      const parentRow = page.locator(`.stack-tree-row[data-stack-id="${fixture.ids.parent}"]`);
      if (scope === 'child' && await parentRow.getAttribute('aria-expanded') === 'false') {
        await parentRow.locator('[data-stack-expand]').click();
      }
      const row = page.locator(`.stack-tree-row[data-stack-id="${fixture.ids[scope]}"]`);
      await row.hover();
      await row.locator('[data-stack-save-as]').click();
    }
    await page.locator('.save-as-name').fill(`PNG-${scope}`);
    await page.locator('.save-as-format').selectOption('png');
    const downloading = page.waitForEvent('download');
    await page.locator('.save-as-confirm').click();
    const path = `${output}/${scope}.png`;
    await (await downloading).saveAs(path);
    const bytes = await readFile(path);
    const pixels = await page.evaluate(async ({ encoded, colors }) => {
      const data = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
      const image = await createImageBitmap(new Blob([data], { type: 'image/png' }));
      const canvas = document.createElement('canvas');
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext('2d');
      context.drawImage(image, 0, 0);
      const rgba = context.getImageData(0, 0, canvas.width, canvas.height).data;
      const counts = Object.fromEntries(Object.keys(colors).map((key) => [key, 0]));
      for (let index = 0; index < rgba.length; index += 4) {
        for (const [key, color] of Object.entries(colors)) {
          if (color.every((channel, offset) => Math.abs(channel - rgba[index + offset]) < 8)) counts[key] += 1;
        }
      }
      image.close();
      return { width: canvas.width, height: canvas.height, counts };
    }, { encoded: bytes.toString('base64'), colors: palette });
    results.push({ scope, ...pixels });
    await writeFile(`${output}/results.json`, JSON.stringify(results, null, 2));
    for (const key of Object.keys(palette)) {
      assert.ok(included.includes(key) ? pixels.counts[key] > 1000 : pixels.counts[key] === 0,
        `${scope}: ${key} has ${pixels.counts[key]} pixels; expected ${included.includes(key) ? 'included' : 'excluded'}`);
    }
    if (scope === 'parent') assert.equal(pixels.width, pixels.height, 'PNG fitting uses only the exported subtree bounds');
    const entities = await page.evaluate(() => window.__pngCanvas.getDrawingData().entities);
    assert.deepEqual(entities, fixture.drawing.entities, 'export preserves the drawing geometry and appearance');
    assert.deepEqual(errors, []);
    console.log(`PASS: ${scope} PNG includes only ${included.join(', ')}; disabled content excluded.`);
  }
  await page.screenshot({ path: `${output}/canvas.png` });
} finally {
  await browser.close();
}
