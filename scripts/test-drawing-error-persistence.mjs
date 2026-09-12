// Requires a local Vite preview and Playwright; exercises the actual file controls.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const baseUrl = process.env.PARAMAGIC_TEST_URL || 'http://127.0.0.1:5187/ParaMagic/';
const output = 'tmp/drawing-error-persistence';
await mkdir(output, { recursive: true });
const fixture = JSON.parse(await readFile('src/tests/fixtures/rectangle-ottoman-latest-controls.paramagic', 'utf8'));
const missingCopyId = '11111111-2222-4333-8444-555555555555';
fixture.dimensionAnnotations[38].anchors.end.derivedFeature.copyId = missingCopyId;
const annotationId = fixture.dimensionAnnotations[38].id;
const fixturePath = `${output}/broken-copy.paramagic`;
await writeFile(fixturePath, JSON.stringify(fixture, null, 2));
const browser = await chromium.launch({ headless: true, channel: 'msedge' });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => { window.showSaveFilePicker = undefined; });
  await page.goto(baseUrl);
  await page.waitForFunction(() => document.documentElement.dataset.browserAutosaveState === 'ready');
  await page.locator('#openDrawingFileInput').setInputFiles(fixturePath);
  await page.waitForFunction(() => document.querySelectorAll('.canvas-record').length > 60);
  const snapshot = () => page.evaluate(async base => {
    const { canvasController, initialization } = await import(document.querySelector('script[src*="/src/main.js"]').src);
    await initialization;
    while (canvasController.isDrawingUpdatePending()) await new Promise(resolve => requestAnimationFrame(resolve));
    return canvasController.getDrawingData();
  }, baseUrl);
  const checkReference = drawing => assert.equal(
    drawing.dimensionAnnotations.find(({ id }) => id === annotationId)?.anchors.end.derivedFeature.copyId,
    missingCopyId,
  );
  checkReference(await snapshot());
  assert.equal(await page.locator(`[data-record-id="${annotationId}"]`).count() > 0, true, 'broken dimension renders');
  await page.screenshot({ path: `${output}/opened-with-error.png` });
  for (const [button, name, format] of [
    ['#saveAsButton', 'saved-as-broken', 'paramagic'],
    ['#saveButton', 'saved-broken', 'paramagic'],
    ['#saveAsButton', 'saved-broken-json', 'json'],
  ]) {
    await page.locator('#appMenuToggle').click();
    await page.locator(button).click();
    await page.locator('.save-as-name').fill(name);
    if (button === '#saveAsButton') await page.locator('.save-as-format').selectOption(format);
    const downloading = page.waitForEvent('download');
    await page.locator('.save-as-confirm').click();
    const download = await downloading;
    const path = `${output}/${download.suggestedFilename()}`;
    await download.saveAs(path);
    checkReference(JSON.parse(await readFile(path, 'utf8')));
    assert.equal(await page.locator('.modal h2').count(), 0, 'saving has no failure modal');
    await page.locator('#openDrawingFileInput').setInputFiles(path);
    checkReference(await snapshot());
    assert.equal(await page.locator(`[data-record-id="${annotationId}"]`).count() > 0, true, 'reopened dimension renders');
    console.log(`PASS: ${button} ${format}: file downloaded, reopened, and broken reference preserved.`);
  }
  await page.reload();
  await page.waitForFunction(() => document.documentElement.dataset.browserAutosaveState === 'ready');
  checkReference(await snapshot());
  assert.equal(await page.locator(`[data-record-id="${annotationId}"]`).count() > 0, true, 'autosave restored dimension renders');
  await page.screenshot({ path: `${output}/autosave-restored-with-error.png` });
  assert.deepEqual(errors, []);
  console.log('PASS: browser autosave restores the drawing with its unresolved reference. No page errors.');
} finally {
  await browser.close();
}
