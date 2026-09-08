import { canvasController, initialization } from '../../main.js';
import { serializeDrawingJson } from '../../../packages/paramagic-core/src/modules/DrawingIO.js';

await initialization;

const runtimeErrors = [];
window.addEventListener('error', (event) => runtimeErrors.push(event.message));

const response = await fetch('./stack-coordinates.paramagic');
const drawing = await response.json();
const stackId = drawing.extensions.stacks.stacks.find(({ kind }) => kind === 'stack').id;
const classId = drawing.activeClassId;
const ids = {
  innerLine: '43639bfd-5b5b-49b1-af85-cb372d9ea164',
  secondLine: '598a9763-dd93-4acd-8be7-0424d2fcad35',
  arraySource: '212b39a5-0f87-479a-ac16-d997d73f27a7',
  circularArray: '0ea4d880-c65a-451f-b4e5-d1065a538bad',
};
const line = (id, start, end) => ({
  id,
  type: 'line',
  stackId,
  start,
  end,
  classId,
  classPropertyOverrides: [],
  sourceRecordId: id,
  sourceStackId: stackId,
});

drawing.drawingUnit = 'mm';
drawing.dxfExportUnit = 'mm';
drawing.entities = [
  line(ids.innerLine, [-130, 40], [-70, 40]),
  line(ids.secondLine, [-260, 120], [-220, 120]),
  line(ids.arraySource, [20, -60], [220, 60]),
];
drawing.constraints = [];
drawing.parameters = [];
drawing.dimensionAnnotations = [];
drawing.extensions.arrayTools = {
  version: 6,
  arrays: [{
    id: ids.circularArray,
    stackId,
    arrayType: 'circular',
    sourceIds: [ids.arraySource],
    sourceRefs: [],
    countExpression: '2',
    fullCircle: true,
    stopAngleExpression: '180',
    centerPoint: [0, 0],
    centerRef: null,
    parentVisibleExpression: 'TRUE',
    parentVisibleManuallyEnabled: true,
  }],
};

canvasController.loadDrawingData(drawing, { zoomToFit: true });
canvasController.setActiveStack(stackId);
const canvas = canvasController.getCanvasElement();
const objectLayer = canvasController.getObjectLayer();
const output = document.createElement('output');
output.style.cssText = 'position:fixed;right:12px;bottom:12px;z-index:2000;padding:10px;background:white;border:1px solid #888;font:13px sans-serif;white-space:pre-wrap';
document.body.append(output);

const nextFrame = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
const screenPoint = (world) => {
  const canvasBounds = canvas.getBoundingClientRect();
  const [x, y] = canvasController.worldToScreen(world);
  return { clientX: canvasBounds.left + x, clientY: canvasBounds.top + y };
};
const topTargetAt = (world) => {
  const point = screenPoint(world);
  return { point, target: document.elementFromPoint(point.clientX, point.clientY) };
};
const clickTopAt = (world) => {
  const { point, target } = topTargetAt(world);
  target.dispatchEvent(new MouseEvent('click', { ...point, button: 0, bubbles: true, cancelable: true }));
  return target;
};
const windowSelect = (startWorld, endWorld, modifiers = {}) => {
  const start = screenPoint(startWorld);
  const end = screenPoint(endWorld);
  const originalCapture = canvas.setPointerCapture;
  const originalRelease = canvas.releasePointerCapture;
  canvas.setPointerCapture = () => {};
  canvas.releasePointerCapture = () => {};
  try {
    canvas.dispatchEvent(new PointerEvent('pointerdown', {
      ...start, pointerId: 91, pointerType: 'mouse', button: 0, buttons: 1, bubbles: true, cancelable: true,
      ...modifiers,
    }));
    canvas.dispatchEvent(new PointerEvent('pointermove', {
      ...end, pointerId: 91, pointerType: 'mouse', button: 0, buttons: 1, bubbles: true, cancelable: true,
      ...modifiers,
    }));
    canvas.dispatchEvent(new PointerEvent('pointerup', {
      ...end, pointerId: 91, pointerType: 'mouse', button: 0, buttons: 0, bubbles: true, cancelable: true,
      ...modifiers,
    }));
  } finally {
    canvas.setPointerCapture = originalCapture;
    canvas.releasePointerCapture = originalRelease;
  }
};
const checks = [];
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
  checks.push(message);
};

try {
  await nextFrame();
  const arrayGroup = objectLayer.querySelector(`.array-group[data-array-id="${ids.circularArray}"]`);
  assert(Boolean(arrayGroup), `circular Array derivative renders (${JSON.stringify({
    array: canvasController.getDrawingData().extensions?.arrayTools?.arrays?.[0],
    records: objectLayer.querySelectorAll('.canvas-record').length,
    source: Boolean(objectLayer.querySelector(`[data-record-id="${ids.arraySource}"]`)),
    sourceBounds: (() => {
      const node = objectLayer.querySelector(`[data-record-id="${ids.arraySource}"]`);
      const bounds = node?.getBBox?.();
      return bounds && { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height };
    })(),
    runtimeErrors,
  })})`);
  const arrayGeometryHits = arrayGroup.querySelectorAll('.array-item-geometry-hit');
  assert(arrayGeometryHits.length > 0, 'Array uses geometry-shaped hit targets');
  assert(
    Number.parseFloat(getComputedStyle(arrayGeometryHits[0]).strokeWidth) === 40,
    'Array derivative stroke hit width is 40px',
  );
  assert(!arrayGroup.querySelector('.array-item-bounds-hit'), 'geometry Arrays do not create aggregate bounding-box hit frames');

  const innerTarget = topTargetAt([-100, 40]).target;
  assert(!innerTarget.closest('.array-group'), 'Array bounding box does not intercept enclosed geometry');
  clickTopAt([-100, 40]);
  assert(
    objectLayer.querySelector(`.canvas-record[data-record-id="${ids.innerLine}"]`)?.classList.contains('selected'),
    'direct click selects ordinary geometry inside the Array bounds',
  );

  canvasController.clearSelection();
  windowSelect([-140, 30], [-60, 50]);
  await nextFrame();
  windowSelect([-270, 110], [-210, 130], { ctrlKey: true });
  await nextFrame();
  assert(
    [ids.innerLine, ids.secondLine].every((id) => (
      objectLayer.querySelector(`.canvas-record[data-record-id="${id}"]`)?.classList.contains('selected')
    )),
    'Ctrl window selection adds ordinary geometry to the existing selection',
  );
  windowSelect([-270, 110], [-210, 130], { ctrlKey: true });
  await nextFrame();
  assert(
    objectLayer.querySelector(`.canvas-record[data-record-id="${ids.innerLine}"]`)?.classList.contains('selected')
      && !objectLayer.querySelector(`.canvas-record[data-record-id="${ids.secondLine}"]`)?.classList.contains('selected'),
    'Ctrl window selection toggles a fully selected group like Ctrl pick selection',
  );
  windowSelect([-225, -20], [-145, -70], { ctrlKey: true });
  await nextFrame();
  assert(
    objectLayer.querySelector(`.canvas-record[data-record-id="${ids.innerLine}"]`)?.classList.contains('selected')
      && objectLayer.querySelector(`.array-group[data-array-id="${ids.circularArray}"]`)?.classList.contains('selected'),
    'Ctrl window selection adds an Array derivative without clearing ordinary geometry',
  );

  canvasController.clearSelection();
  clickTopAt([-100, 12]);
  if (document.querySelector('.array-settings-popup')?.hidden) clickTopAt([-100, 12]);
  assert(
    document.querySelector('.array-settings-popup')?.hidden === false,
    'direct click selects the Array derivative on its stroke',
  );

  canvasController.clearSelection();
  windowSelect([-235, -75], [-5, 75]);
  await nextFrame();
  assert(
    objectLayer.querySelector(`.array-group[data-array-id="${ids.circularArray}"]`)?.classList.contains('selected'),
    'window selection includes the Array derivative',
  );

  canvasController.clearSelection();
  clickTopAt([-100, 12]);
  if (document.querySelector('.array-settings-popup')?.hidden) clickTopAt([-100, 12]);
  await nextFrame();
  document.querySelector('[data-array-select-objects]').click();
  windowSelect([-140, 30], [-60, 50]);
  await nextFrame();
  assert(
    document.querySelector('.array-settings-popup')?.hidden === false,
    'source window selection keeps the Array editor active',
  );
  assert(
    document.querySelector('[data-array-source-count]')?.textContent === '1 object selected',
    'source window selection updates the Array source set',
  );
  windowSelect([-270, 110], [-210, 130], { ctrlKey: true });
  await nextFrame();
  assert(
    document.querySelector('[data-array-source-count]')?.textContent === '2 objects selected',
    'Ctrl window selection adds to the Array source set',
  );
  document.querySelector('[data-array-select-objects]').click();
  await nextFrame();
  assert(
    new Set(canvasController.getDrawingData().extensions.arrayTools.arrays[0].sourceIds).size === 2
      && canvasController.getDrawingData().extensions.arrayTools.arrays[0].sourceIds.includes(ids.innerLine)
      && canvasController.getDrawingData().extensions.arrayTools.arrays[0].sourceIds.includes(ids.secondLine),
    'source window selection commits both selected objects to the Array',
  );

  canvasController.selectRecords([ids.innerLine]);
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true }));
  await nextFrame();
  const afterSourceDelete = canvasController.getDrawingData();
  assert(
    !afterSourceDelete.entities.some(({ id }) => id === ids.innerLine),
    'deleting an Array source removes the selected source entity',
  );
  assert(
    !(afterSourceDelete.extensions.arrayTools?.arrays || []).some(({ id }) => id === ids.circularArray),
    'deleting an Array source removes the dependent Array definition',
  );
  assert(
    !objectLayer.querySelector(`.array-group[data-array-id="${ids.circularArray}"]`),
    'deleting an Array source removes the dependent Array presentation',
  );
  assert(
    Boolean(serializeDrawingJson(afterSourceDelete, 'Array source deletion')),
    'the drawing serializes after deleting an Array source',
  );

  output.textContent = `PASS: ${checks.length} checks\n${checks.join('\n')}`;
} catch (error) {
  output.textContent = `FAIL: ${error.message}\n${checks.join('\n')}`;
  throw error;
}
