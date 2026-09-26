// Run against Vite; PLAYWRIGHT_MODULE_PATH may select bundled Playwright.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const output = 'tmp/stack-feature-selection';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: 'msedge' });
const results = [];
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(process.env.PARAMAGIC_TEST_URL || 'http://127.0.0.1:5180/ParaMagic/');
  await page.waitForFunction(() => document.documentElement.dataset.browserAutosaveState === 'ready');
  await page.evaluate(async () => {
    const { canvasController: canvas, initialization } = await import(document.querySelector('script[src*="/src/main.js"]').src);
    await initialization;
    const active = canvas.addStack({ name: 'Edge below fill' });
    const above = canvas.addStack({ name: 'Filled objects above' });
    window.__stackFeatureTest = { canvas, active: active.id, above: above.id, baseline: canvas.getDrawingData() };
  });
  async function settle() {
    await page.waitForFunction(() => !window.__stackFeatureTest.canvas.isDrawingUpdatePending());
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  }
  async function load(kind) {
    await page.keyboard.press('Escape');
    const fixture = await page.evaluate(async (kind) => {
      const { canvas, active, above, baseline } = window.__stackFeatureTest;
      const drawing = structuredClone(baseline);
      drawing.drawingUnit = 'mm';
      const line = { id: crypto.randomUUID(), stackId: active, type: 'line', start: [20, 0], end: [80, 0] };
      const appearance = { fillColor: '#e69e32', fillExpression: '#e69e32', fillOpacity: 1 };
      const rectangle = { id: crypto.randomUUID(), stackId: above, type: 'polygon', points: [[-20, -25], [120, -25], [120, 40], [-20, 40]], appearance };
      let overlays = [rectangle];
      if (kind === 'circle') overlays = [{ id: rectangle.id, stackId: above, type: 'circle', center: [50, 0], radius: 75, appearance }];
      if (kind === 'loose') overlays = rectangle.points.map((start, index, points) => ({
        id: crypto.randomUUID(), stackId: above, type: 'line', start, end: points[(index + 1) % points.length], appearance,
      }));
      if (kind === 'swell') {
        const { withSwellDefinition } = await import('/ParaMagic/packages/paramagic-core/src/modules/SwellGeometry.js');
        overlays = [withSwellDefinition(rectangle, { swellEnabled: false, offsetExpression: '5' })];
      }
      if (kind === 'duplicate') {
        rectangle.points = rectangle.points.map(([x, y]) => [x + 180, y]);
        drawing.extensions.linkedCopyTools = { version: 1, copies: [{ id: crypto.randomUUID(), type: 'duplicate', stackId: above,
          sourceIds: [rectangle.id], anchor: [50, 7.5], linear: { a: 1, b: 0, c: 0, d: 1 }, zIndex: 50 }] };
      }
      if (kind === 'array') {
        rectangle.points = rectangle.points.map(([x, y]) => [x - 180, y]);
        drawing.extensions.arrayTools = { version: 1, arrays: [{ id: crypto.randomUUID(), stackId: above,
          sourceIds: [rectangle.id], arrayType: 'rectangular', rowCountExpression: '1', columnCountExpression: '2',
          rowSpacingExpression: '100', columnSpacingExpression: '180', rowCentroidSpacing: true, columnCentroidSpacing: true }] };
      }
      drawing.entities = [line, ...overlays];
      drawing.constraints = [];
      drawing.parameters = [];
      drawing.dimensions = [];
      drawing.dimensionAnnotations = [];
      canvas.loadDrawingData(drawing, { zoomToFit: true });
      canvas.setActiveStack(active);
      return { lineId: line.id, overlayIds: overlays.map(({ id }) => id), active, above };
    }, kind);
    await page.locator('#resetView').click();
    await settle();
    return fixture;
  }
  async function point(x, y) {
    return page.evaluate(([x, y]) => {
      const position = new DOMPoint(x, y).matrixTransform(window.__stackFeatureTest.canvas.getObjectLayer().getScreenCTM());
      const target = document.elementFromPoint(position.x, position.y);
      return { x: position.x, y: position.y, className: target?.getAttribute('class'),
        recordId: target?.closest('[data-record-id]')?.dataset.recordId,
        stackId: target?.closest('[data-stack-id]')?.dataset.stackId };
    }, [x, y]);
  }
  for (const kind of (process.env.STACK_FEATURE_KINDS || 'polygon,circle,loose,swell,duplicate,array').split(',')) {
    for (const mode of ['constraint', 'Driving Dimension', 'Driven Dimension']) {
      const fixture = await load(kind);
      if (mode === 'constraint') {
        await page.locator('.constraint-tool .menu-toggle').hover();
        await page.locator('[data-constraint="Horizontal"]').click();
      } else await page.locator(`[data-dimension-tool*="${mode}"]`).click();
      await settle();
      const hit = await point(38, 0);
      results.push({ kind, mode, hit });
      await writeFile(`${output}/results.json`, JSON.stringify(results, null, 2));
      assert.equal(hit.recordId, fixture.lineId, `${kind}/${mode}: the inactive fill must pass through to the active edge; hit ${hit.className}`);
      await page.mouse.click(hit.x, hit.y);
      if (mode !== 'constraint') {
        const placement = await point(50, 25);
        await page.mouse.move(placement.x, placement.y);
        await page.mouse.click(placement.x, placement.y);
      }
      await settle();
      const data = await page.evaluate(() => window.__stackFeatureTest.canvas.getDrawingData());
      await writeFile(`${output}/last-drawing.json`, JSON.stringify(data, null, 2));
      if (mode === 'constraint') {
        assert.equal(data.constraints.length, 1);
        assert.equal(data.constraints[0].type, 'Horizontal');
        assert.equal(data.constraints[0].featureRefs[0].recordId, fixture.lineId);
      } else {
        const dimension = data.dimensionAnnotations[0];
        assert.ok(dimension, 'placing the dimension creates its rendered annotation');
        assert.equal(dimension.anchors.start.recordId, fixture.lineId);
        assert.equal(dimension.anchors.end.recordId, fixture.lineId);
        assert.ok(Math.abs(data.dimensions[0].value - 60) < 0.001, 'the dimension measures the intended 60 mm edge');
        assert.ok(await page.locator('.dimension-text').count(), 'the completed dimension is visible');
      }
      assert.deepEqual(errors, []);
      await page.screenshot({ path: `${output}/${kind}-${mode.replaceAll(' ', '-').toLowerCase()}.png` });
      console.log(`PASS: ${kind}: ${mode} selects and uses the active edge beneath the inactive fill.`);
    }
  }
  // Other Stacks' real edges remain valid relationship targets.
  for (const kind of ['polygon', 'loose', 'swell', 'duplicate']) {
    const fixture = await load(kind);
    await page.locator('[data-dimension-tool*="Driven Dimension"]').click();
    await settle();
    const edge = await point(35, kind === 'swell' ? -30 : -25);
    assert.equal(edge.stackId, fixture.above, `${kind}: the inactive edge remains hittable`);
    await page.mouse.click(edge.x, edge.y);
    const placement = await point(45, -10);
    await page.mouse.click(placement.x, placement.y);
    await settle();
    const data = await page.evaluate(() => window.__stackFeatureTest.canvas.getDrawingData());
    await page.screenshot({ path: `${output}/cross-stack-${kind}.png` });
    await writeFile(`${output}/cross-stack-${kind}.json`, JSON.stringify({ edge, data }, null, 2));
    assert.equal(data.dimensionAnnotations.length, 1, `${kind}: the other Stack's edge can be dimensioned`);
    assert.ok(Math.abs(data.dimensions[0].value - (kind === 'swell' ? 150 : 140)) < 0.001);
    assert.ok(await page.locator('.dimension-text').count());
    console.log(`PASS: ${kind}: the inactive edge remains available for dimensions.`);
  }
  const fixture = await load('polygon');
  await page.locator('.constraint-tool .menu-toggle').hover();
  await page.locator('[data-constraint="Parallel"]').click();
  for (const [x, y] of [[38, 0], [35, -25]]) {
    const target = await point(x, y);
    await page.mouse.click(target.x, target.y);
  }
  await settle();
  const relationship = await page.evaluate(() => window.__stackFeatureTest.canvas.getDrawingData().constraints[0]);
  assert.equal(relationship.type, 'Parallel');
  assert.deepEqual(relationship.featureRefs.map(({ recordId }) => recordId).sort(), [fixture.lineId, fixture.overlayIds[0]].sort());
  console.log('PASS: a Parallel constraint can still join edges from different Stacks.');

  await load('polygon');
  await page.locator('[data-dimension-tool*="Driven Dimension"]').click();
  for (const [x, y] of [[20, 0], [-20, -25]]) {
    const target = await point(x, y);
    await page.mouse.move(target.x, target.y);
    await page.mouse.click(target.x, target.y);
  }
  const placement = await point(0, 25);
  await page.mouse.click(placement.x, placement.y);
  await settle();
  const pointDimension = await page.evaluate(() => window.__stackFeatureTest.canvas.getDrawingData());
  assert.equal(pointDimension.dimensionAnnotations.length, 1);
  assert.notEqual(pointDimension.dimensionAnnotations[0].anchors.start.recordId, pointDimension.dimensionAnnotations[0].anchors.end.recordId);
  assert.ok(Math.abs(pointDimension.dimensions[0].value - 40) < 0.001);
  console.log('PASS: points in different Stacks remain available for dimensions.');

  for (const kind of ['polygon', 'loose', 'swell', 'duplicate']) {
    const fixture = await load(kind);
    await page.locator('.constraint-tool .menu-toggle').hover();
    await page.locator('[data-constraint="Horizontal"]').click();
    await page.locator('.constraint-tool .menu-toggle').click();
    await settle();
    assert.equal((await point(38, 0)).stackId, fixture.above, `${kind}: inactive interiors return to normal hit testing when the tool closes`);
    await page.evaluate((id) => window.__stackFeatureTest.canvas.setActiveStack(id), fixture.above);
    await settle();
    const interior = await point(38, 0);
    await page.mouse.click(interior.x, interior.y);
    await settle();
    assert.ok(await page.locator('.canvas-record.selected, .closed-region-hit.selected').count(), `${kind}: active interiors still select objects`);
    await page.evaluate(() => window.__stackFeatureTest.canvas.setActiveStack(null));
    await settle();
    assert.equal(await page.locator('.canvas .stack-inactive').count(), 0);
  }
  assert.deepEqual(errors, []);
  console.log('PASS: normal fill selection and switching the active Stack are preserved.');
} finally {
  await browser.close();
}
