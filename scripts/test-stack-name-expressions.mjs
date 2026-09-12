import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { SolverController } from '../packages/paramagic-core/src/modules/solver/SolverController.js';
import { createControlPanelModel } from '../packages/paramagic-core/src/modules/CanvasUIControls.js';
import { serializeParamagicDocument } from '../packages/paramagic-core/src/document.js';
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const output = 'tmp/stack-name-expressions';
await mkdir(output, { recursive: true });
const ids = Object.fromEntries(['base', 'front', 'back', 'frontLine', 'backLine', 'label'].map(key => [key, randomUUID()]));
const solver = new SolverController();
solver.loadSketch({ drawingUnit: 'mm', stackState: { version: 6, activeStackId: ids.base, stacks: [
  { id: ids.base, name: 'Labels', systemRole: 'default-stack' },
  { id: ids.front, name: 'Front View', enabled: false },
  { id: ids.back, name: 'Back View', enabled: false },
] }, entities: [
  { id: ids.frontLine, type: 'line', stackId: ids.front, start: [0, 0], end: [140, 20] },
  { id: ids.backLine, type: 'line', stackId: ids.back, start: [0, 60], end: [140, 80] },
  { id: ids.label, type: 'text', stackId: ids.base, x: 0, y: -50, text: '[StackName@Front View]', fontSize: 20 },
] });
const controls = createControlPanelModel({ solver });
controls.add('Dropdown', { parameterName: 'c4', label: 'Active view', configurationExpression: '{StackName@Front View|StackName@Back View}' });
const fixturePath = `${output}/stack-names.paramagic`;
await writeFile(fixturePath, serializeParamagicDocument({ ...solver.getSketchSnapshot(), extensions: { stacks: solver.stackState, controls: controls.serialize() } }, 'Stack names'));
const browser = await chromium.launch({ headless: true, channel: 'msedge' });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => { window.showSaveFilePicker = undefined; });
  await page.goto(process.env.PARAMAGIC_TEST_URL || 'http://127.0.0.1:5187/ParaMagic/');
  await page.waitForFunction(() => document.documentElement.dataset.browserAutosaveState === 'ready');
  await page.locator('#openDrawingFileInput').setInputFiles(fixturePath);
  await page.locator(`.text-record[data-record-id="${ids.label}"]`).waitFor();
  await page.evaluate(async () => {
    const module = await import(document.querySelector('script[src*="/src/main.js"]').src);
    await module.initialization;
    window.__canvas = module.canvasController;
  });
  const settled = () => page.waitForFunction(() => !window.__canvas.isDrawingUpdatePending()
    && !document.querySelector('[data-control-id][aria-busy]'));
  const stackRow = id => page.locator(`.stack-tree-row[data-stack-id="${id}"]`);
  const geometry = id => page.locator(`.geometry-record[data-record-id="${id}"]`);
  for (const id of [ids.front, ids.back]) {
    const row = stackRow(id);
    await row.click();
    const field = row.locator('[data-stack-expression]');
    await field.fill('c4 == StackName');
    assert.equal(await page.locator('#stackEnableExpressionSymbols option[value="StackName"]').count(), 1);
    await field.press('Enter');
    await settled();
    assert.equal(await field.getAttribute('aria-invalid'), 'false');
  }
  assert.equal(await geometry(ids.frontLine).isVisible(), true);
  assert.equal(await geometry(ids.backLine).isVisible(), false);
  if (await page.locator('#controlsPanel').isHidden()) await page.locator('#controlsToggle').click();
  const dropdown = page.getByRole('combobox', { name: 'Active view', exact: true });
  await dropdown.selectOption({ label: 'Back View' });
  await settled();
  assert.equal(await geometry(ids.frontLine).isVisible(), false);
  assert.equal(await geometry(ids.backLine).isVisible(), true);
  await dropdown.selectOption({ label: 'Front View' });
  await settled();
  assert.equal(await geometry(ids.frontLine).isVisible(), true);
  assert.equal(await geometry(ids.backLine).isVisible(), false);
  // Rename the selected view through the Stack tree. Both the control's named
  // reference and the text label should follow it, keeping that view enabled.
  await stackRow(ids.front).click();
  await stackRow(ids.front).press('F2');
  const nameField = stackRow(ids.front).locator('[data-stack-name-input]');
  await nameField.fill('Front Elevation');
  await nameField.press('Enter');
  await settled();
  assert.equal(await dropdown.locator('option:checked').innerText(), 'Front Elevation');
  assert.equal(await geometry(ids.frontLine).isVisible(), true);
  assert.equal(await page.locator(`.text-record[data-record-id="${ids.label}"] textarea`).inputValue(), 'Front Elevation');
  await page.mouse.move(1000, 700);
  await page.mouse.wheel(0, 1200);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
  await page.screenshot({ path: `${output}/renamed-enabled.png` });
  await page.locator('#appMenuToggle').click();
  await page.locator('#saveAsButton').click();
  await page.locator('.save-as-name').fill('Stack name conditions');
  const downloading = page.waitForEvent('download');
  await page.locator('.save-as-confirm').click();
  const download = await downloading;
  const savedPath = `${output}/saved.paramagic`;
  await download.saveAs(savedPath);
  const saved = JSON.parse(await readFile(savedPath, 'utf8'));
  ids.front = saved.extensions.stacks.stacks.find(s => s.name === 'Front Elevation').id;
  ids.back = saved.extensions.stacks.stacks.find(s => s.name === 'Back View').id;
  ids.frontLine = saved.entities.find(e => e.type === 'line' && e.stackId === ids.front).id;
  ids.backLine = saved.entities.find(e => e.type === 'line' && e.stackId === ids.back).id;
  assert.equal(saved.extensions.stacks.stacks.find(s => s.id === ids.front).enabledExpression, 'c4 == StackName');
  await page.locator('#openDrawingFileInput').setInputFiles(savedPath);
  await page.waitForFunction(id => window.__canvas.getStackRuntimeState().stacks.some(s => s.id === id), ids.front);
  await settled();
  await dropdown.selectOption({ label: 'Back View' });
  await settled();
  assert.equal(await geometry(ids.frontLine).isVisible(), false);
  assert.equal(await geometry(ids.backLine).isVisible(), true);
  await dropdown.selectOption({ label: 'Front Elevation' });
  await settled();
  assert.equal(await geometry(ids.frontLine).isVisible(), true);
  assert.equal(await geometry(ids.backLine).isVisible(), false);
  assert.deepEqual(errors, []);
  console.log('PASS: c4 == StackName controls rendered stacks; rename, label, dropdown, and save/open preserve references.');
} finally {
  await browser.close();
}
