import { createTableSystem } from '../../../packages/paramagic-core/src/modules/TableTools.js';
import { createCanvasPresentationPng } from '../../../packages/paramagic-core/src/modules/PngExport.js';
import { serializeCanvasPresentationSvg } from '../../../packages/paramagic-core/src/modules/SvgExport.js';
import { createDrawingDxfSnapshot } from '../../../packages/paramagic-core/src/modules/DxfExport.js';
import { serializeDxf } from '../../../packages/paramagic-core/src/modules/DrawingIO.js';

const status = document.getElementById('status');
const details = document.getElementById('details');
const checkpoints = [];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function pointerDown(node) {
  node.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }));
}

function keyDown(node, key, options = {}) {
  node.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key, ...options }));
}

function toolbarButton(record, label) {
  return [...record.toolbarContent.querySelectorAll('button')]
    .find((button) => button.getAttribute('aria-label') === label);
}

async function run() {
  const system = createTableSystem({
    objectLayer: document.getElementById('objects'),
    handleLayer: document.getElementById('handles'),
    previewLayer: document.getElementById('preview'),
    screenToWorld: (x, y) => [x, y],
    requestHistoryCheckpoint: (reason) => checkpoints.push(reason),
  });
  const record = system.createRecord({ id: 'browser-table', stackId: 'stack-export', x: 120, y: 120 });
  record.group.classList.add('selected');
  record.syncState(true);

  const placementPointer = new PointerEvent('pointerdown', {
    bubbles: true,
    button: 0,
    pointerId: 7,
    clientX: 120,
    clientY: 120,
  });
  system.beginEdit(record, { placementPointerEvent: placementPointer });
  assert(document.activeElement !== record.editors.get('0:0'), 'Table editing started before the placement click finished.');
  document.dispatchEvent(new MouseEvent('click', {
    bubbles: true,
    button: 0,
    clientX: 120,
    clientY: 120,
  }));
  await new Promise((resolve) => requestAnimationFrame(resolve));
  assert(document.activeElement === record.editors.get('0:0'), 'The first table cell did not receive focus after placement.');
  assert(record.editors.get('0:0').classList.contains('editing'), 'The first table cell did not enter edit mode after placement.');
  system.updateRecord(record);
  assert(document.activeElement === record.editors.get('0:0'), 'Refreshing the table replaced the active editor without restoring focus.');
  record.editors.get('0:0').blur();

  const initialLabels = [...record.toolbarContent.querySelectorAll('button')]
    .map((button) => button.getAttribute('aria-label'));
  assert(initialLabels.includes('Delete Selected Rows'), 'The row-delete toolbar button is missing.');
  assert(initialLabels.includes('Delete Selected Columns'), 'The column-delete toolbar button is missing.');

  pointerDown(record.content.querySelector('[data-table-row-select="1"]'));
  const deleteRow = toolbarButton(record, 'Delete Selected Rows');
  assert(deleteRow && !deleteRow.disabled, 'The row-delete button did not enable for a selected row.');
  deleteRow.click();
  assert(record.entity.rows.length === 2, 'The selected row was not deleted.');

  pointerDown(record.content.querySelector('[data-table-column-select="1"]'));
  const deleteColumn = toolbarButton(record, 'Delete Selected Columns');
  assert(deleteColumn && !deleteColumn.disabled, 'The column-delete button did not enable for a selected column.');
  deleteColumn.click();
  assert(record.entity.columns.length === 2, 'The selected column was not deleted.');

  const first = record.editors.get('0:0');
  first.focus();
  keyDown(first, 'ArrowRight');
  await new Promise((resolve) => requestAnimationFrame(resolve));
  assert(document.activeElement === record.editors.get('0:1'), 'ArrowRight did not move to the next cell.');

  keyDown(document.activeElement, 'Tab');
  await new Promise((resolve) => requestAnimationFrame(resolve));
  assert(document.activeElement === record.editors.get('1:0'), 'Tab did not move to the next row.');
  assert(!document.activeElement.readOnly, 'A cell selected with Tab was not editable.');
  assert(document.activeElement.classList.contains('editing'), 'A cell selected with Tab did not enter edit mode.');

  const editing = document.activeElement;
  editing.value = 'X';
  editing.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: 'X' }));
  keyDown(editing, 'ArrowRight');
  await new Promise((resolve) => requestAnimationFrame(resolve));
  assert(document.activeElement === record.editors.get('1:1'), 'ArrowRight did not commit and advance from an edited cell.');
  assert(!document.activeElement.readOnly, 'A cell selected with an arrow key was not editable.');
  assert(record.entity.cells[1][0].text === 'X', 'Arrow navigation did not preserve the edited cell value.');
  keyDown(document.activeElement, 'ArrowLeft');
  await new Promise((resolve) => requestAnimationFrame(resolve));
  assert(document.activeElement === record.editors.get('1:0'), 'ArrowLeft did not return to the previous cell.');
  keyDown(document.activeElement, 'Tab');
  await new Promise((resolve) => requestAnimationFrame(resolve));
  assert(document.activeElement === record.editors.get('1:1'), 'Tab did not commit and advance from an edited cell.');

  const svgMarkup = await serializeCanvasPresentationSvg(document.getElementById('objects'), { stackId: 'stack-export' });
  assert(!svgMarkup.includes('<foreignObject'), 'SVG export retained HTML table controls.');
  assert(svgMarkup.includes('>X<'), 'SVG export omitted table cell text.');
  assert(!svgMarkup.includes('table-column-selector'), 'SVG export retained table column selectors.');
  assert(!svgMarkup.includes('table-row-selector'), 'SVG export retained table row selectors.');

  const png = await createCanvasPresentationPng(document.getElementById('objects'), { stackId: 'stack-export' });
  assert(png.blob.type === 'image/png' && png.blob.size > 1000, 'PNG export did not encode the table.');
  const exportedPng = document.getElementById('exported-png');
  const pngUrl = URL.createObjectURL(png.blob);
  await new Promise((resolve, reject) => {
    exportedPng.addEventListener('load', resolve, { once: true });
    exportedPng.addEventListener('error', () => reject(new Error('The exported table PNG could not be displayed.')), { once: true });
    exportedPng.src = pngUrl;
    exportedPng.hidden = false;
  });

  const dxfSnapshot = createDrawingDxfSnapshot({
    drawingUnit: 'mm',
    dxfExportUnit: 'mm',
    entities: [record.entity],
  });
  const dxf = serializeDxf(dxfSnapshot);
  assert(dxfSnapshot.entities.filter(({ type }) => type === 'line').length === 6, 'DXF export did not create the two-by-two table grid.');
  assert(dxfSnapshot.entities.some(({ type, text }) => type === 'text' && text === 'X'), 'DXF export omitted table cell text.');
  assert((dxf.match(/\n0\nLINE\n/g) || []).length === 6, 'DXF serialization did not contain six unique grid lines.');
  assert(/\n0\nTEXT\n[\s\S]*\n1\nX\n/.test(dxf), 'DXF serialization did not contain the edited cell text.');

  status.dataset.state = 'passed';
  status.textContent = 'PASS — Table interaction and SVG, PNG, and DXF exports work.';
  details.textContent = JSON.stringify({
    rows: record.entity.rows.length,
    columns: record.entity.columns.length,
    activeCell: '1:1',
    editedValue: record.entity.cells[1][0].text,
    toolbar: initialLabels,
    checkpoints,
    svgBytes: new Blob([svgMarkup]).size,
    pngBytes: png.blob.size,
    dxfBytes: new Blob([dxf]).size,
    dxfLines: 6,
  }, null, 2);
  document.documentElement.dataset.tableToolTest = 'passed';
  setTimeout(() => URL.revokeObjectURL(pngUrl), 1000);
}

try {
  await run();
} catch (error) {
  status.dataset.state = 'failed';
  status.textContent = `FAIL — ${error.message}`;
  details.textContent = error.stack || String(error);
  document.documentElement.dataset.tableToolTest = 'failed';
}
