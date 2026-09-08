import { canvasController, initialization } from '../../main.js';
import { serializeDrawingJson } from '../../../packages/paramagic-core/src/modules/DrawingIO.js';

await initialization;

const drawingUrl = new URLSearchParams(window.location.search).get('drawing');
if (!drawingUrl) throw new Error('A drawing query parameter is required.');
const response = await fetch(drawingUrl);
if (!response.ok) throw new Error(`Drawing request failed with ${response.status}.`);
const drawing = await response.json();
const arrays = drawing.extensions?.arrayTools?.arrays || [];
const circularArrays = arrays.filter(({ arrayType }) => arrayType === 'circular');
const circularArrayWithMostSources = [...circularArrays].sort((left, right) => (
  ((right.sourceIds?.length || 0) + (right.sourceRefs?.length || 0))
  - ((left.sourceIds?.length || 0) + (left.sourceRefs?.length || 0))
))[0];
const activeStackId = circularArrayWithMostSources?.stackId;

canvasController.loadDrawingData(drawing, { zoomToFit: true });
if (activeStackId) canvasController.setActiveStack(activeStackId);

const canvas = canvasController.getCanvasElement();
const objectLayer = canvasController.getObjectLayer();
const output = document.createElement('output');
output.style.cssText = 'position:fixed;right:12px;bottom:12px;z-index:2000;padding:10px;background:white;border:1px solid #888;font:13px sans-serif;white-space:pre-wrap';
document.body.append(output);

const nextFrame = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
const checks = [];
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
  checks.push(message);
};
const geometryScreenPoint = (node, portion) => {
  const length = node.getTotalLength?.();
  const matrix = node.getScreenCTM?.();
  if (!Number.isFinite(length) || !matrix) return null;
  const point = node.getPointAtLength(length * portion).matrixTransform(matrix);
  return { clientX: point.x, clientY: point.y };
};
const pointInside = (point, bounds, inset = 0) => (
  point.clientX > bounds.left + inset
  && point.clientX < bounds.right - inset
  && point.clientY > bounds.top + inset
  && point.clientY < bounds.bottom - inset
);
const clickPoint = (point) => {
  const target = document.elementFromPoint(point.clientX, point.clientY);
  target?.dispatchEvent(new PointerEvent('pointerdown', {
    ...point,
    pointerId: 93,
    pointerType: 'mouse',
    button: 0,
    buttons: 1,
    bubbles: true,
    cancelable: true,
  }));
  target?.dispatchEvent(new PointerEvent('pointerup', {
    ...point,
    pointerId: 93,
    pointerType: 'mouse',
    button: 0,
    buttons: 0,
    bubbles: true,
    cancelable: true,
  }));
  target?.dispatchEvent(new MouseEvent('click', {
    ...point,
    button: 0,
    bubbles: true,
    cancelable: true,
  }));
  return target;
};
const windowSelect = (bounds) => {
  const start = { clientX: bounds.left - 8, clientY: bounds.top - 8 };
  const end = { clientX: bounds.right + 8, clientY: bounds.bottom + 8 };
  const originalCapture = canvas.setPointerCapture;
  const originalRelease = canvas.releasePointerCapture;
  canvas.setPointerCapture = () => {};
  canvas.releasePointerCapture = () => {};
  try {
    canvas.dispatchEvent(new PointerEvent('pointerdown', {
      ...start, pointerId: 92, pointerType: 'mouse', button: 0, buttons: 1, bubbles: true, cancelable: true,
    }));
    canvas.dispatchEvent(new PointerEvent('pointermove', {
      ...end, pointerId: 92, pointerType: 'mouse', button: 0, buttons: 1, bubbles: true, cancelable: true,
    }));
    canvas.dispatchEvent(new PointerEvent('pointerup', {
      ...end, pointerId: 92, pointerType: 'mouse', button: 0, buttons: 0, bubbles: true, cancelable: true,
    }));
    canvas.dispatchEvent(new MouseEvent('click', {
      ...end, button: 0, bubbles: true, cancelable: true,
    }));
  } finally {
    canvas.setPointerCapture = originalCapture;
    canvas.releasePointerCapture = originalRelease;
  }
};

try {
  await nextFrame();
  const circularGroups = circularArrays
    .map(({ id }) => objectLayer.querySelector(`.array-group[data-array-id="${id}"]`))
    .filter(Boolean);
  assert(circularGroups.length === circularArrays.length, 'all circular Arrays in the supplied drawing render');
  assert(
    circularGroups.every((group) => !group.querySelector('.array-item-bounds-hit')),
    'circular geometry Arrays do not create aggregate bounding-box hit frames',
  );
  const inactiveCircularGroups = circularGroups.filter((group) => group.classList.contains('stack-inactive'));
  assert(
    inactiveCircularGroups.every((group) => (
      [...group.querySelectorAll('.array-item-geometry-hit, .array-item-area-hit')]
        .every((target) => getComputedStyle(target).pointerEvents === 'none')
    )),
    'inactive circular Arrays cannot intercept active-Stack pointer hits',
  );

  const arrayBounds = circularGroups.flatMap((group) => (
    [...group.querySelectorAll('.array-item')].map((node) => node.getBoundingClientRect())
  ));
  const ordinaryHits = [...objectLayer.querySelectorAll(
    `.canvas-record[data-stack-id="${activeStackId}"] .hit-target`,
  )];
  let enclosedGeometry = null;
  for (const node of ordinaryHits) {
    for (const portion of [0.15, 0.3, 0.5, 0.7, 0.85]) {
      const point = geometryScreenPoint(node, portion);
      if (!point || !arrayBounds.some((bounds) => pointInside(point, bounds, 3))) continue;
      const target = document.elementFromPoint(point.clientX, point.clientY);
      const record = node.closest('.canvas-record[data-record-id]');
      if (target?.closest('.canvas-record[data-record-id]') === record) {
        enclosedGeometry = { point, recordId: record.dataset.recordId };
        break;
      }
    }
    if (enclosedGeometry) break;
  }
  if (enclosedGeometry) {
    checks.push('the supplied drawing contains ordinary geometry inside a circular Array placement');
    clickPoint(enclosedGeometry.point);
    assert(
      objectLayer.querySelector(`.canvas-record[data-record-id="${enclosedGeometry.recordId}"]`)?.classList.contains('selected'),
      'ordinary geometry inside the rectangle is directly selectable',
    );
  } else {
    checks.push('the current supplied drawing has no ordinary geometry inside a circular Array placement');
  }

  canvasController.clearSelection();
  let selectableArray = null;
  for (const group of circularGroups.filter((candidate) => !candidate.classList.contains('stack-inactive'))) {
    for (const node of group.querySelectorAll([
      ':scope > .array-item .array-item-template .array-item-content .selectable-entity:not(.hit-target):not(.segment-select-line)',
      ':scope > .array-item .array-item-template .array-item-content .subtract-result-boundary',
      ':scope > .array-item .array-item-template .array-item-content .resolved-boundary-visual',
      ':scope > .array-item .array-item-template .array-item-content .seam-line-path',
    ].join(','))) {
      for (const portion of [0.15, 0.3, 0.5, 0.7, 0.85]) {
        const point = geometryScreenPoint(node, portion);
        if (!point) continue;
        const target = document.elementFromPoint(point.clientX, point.clientY);
        if (target?.closest('.array-group[data-array-id]') === group) {
          selectableArray = { point, arrayId: group.dataset.arrayId };
          break;
        }
      }
      if (selectableArray) break;
    }
    if (selectableArray) break;
  }
  if (selectableArray) {
    clickPoint(selectableArray.point);
    await nextFrame();
    assert(
      objectLayer.querySelector(`.array-group[data-array-id="${selectableArray.arrayId}"]`)?.classList.contains('selected'),
      'the circular Array derivative is directly selectable on its stroke',
    );
  } else {
    const activeCircularGroup = circularGroups.find((group) => !group.classList.contains('stack-inactive'));
    assert(
      Boolean(activeCircularGroup),
      'the supplied drawing has an active circular Array',
    );
    windowSelect(activeCircularGroup.getBoundingClientRect());
    await nextFrame();
    assert(
      objectLayer.querySelector(`.array-group[data-array-id="${activeCircularGroup.dataset.arrayId}"]`)?.classList.contains('selected'),
      'a fully overlapped circular Array remains selectable with window selection',
    );
  }

  document.querySelector('[data-array-close]').click();
  document.querySelector('[data-array-toggle]').click();
  document.querySelector('[data-array-select-objects]').click();
  const sourceCandidate = [...objectLayer.querySelectorAll(
    `.canvas-record.geometry-record[data-stack-id="${activeStackId}"]:not(.stack-inactive):not(.stack-hidden)`,
  )].filter((node) => {
    const bounds = node.getBoundingClientRect();
    return bounds.width > 4 && bounds.height > 4;
  }).sort((left, right) => {
    const leftBounds = left.getBoundingClientRect();
    const rightBounds = right.getBoundingClientRect();
    return (leftBounds.width * leftBounds.height) - (rightBounds.width * rightBounds.height);
  })[0];
  assert(Boolean(sourceCandidate), 'the supplied drawing exposes ordinary geometry for Array source selection');
  const arrayCountBeforeWindowSelection = objectLayer.querySelectorAll('.array-group[data-array-id]').length;
  windowSelect(sourceCandidate.getBoundingClientRect());
  await nextFrame();
  assert(
    document.querySelector('.array-settings-popup')?.hidden === false,
    'window source selection keeps the Array editor active in the supplied drawing',
  );
  assert(
    document.querySelector('[data-array-source-count]')?.textContent !== '0 objects selected',
    'window source selection retains selected objects in the supplied drawing',
  );
  assert(
    objectLayer.querySelectorAll('.array-group[data-array-id]').length > arrayCountBeforeWindowSelection,
    'window-selected sources render the new Array in the supplied drawing',
  );
  document.querySelector('[data-array-select-objects]').click();
  await nextFrame();
  assert(
    document.querySelector('[data-array-select-objects]')?.textContent === 'Select Objects',
    'finishing window source selection returns the Array editor to editing mode',
  );

  const frontStack = drawing.extensions.stacks.stacks.find(({ name }) => name === 'Front');
  const frontArray = arrays.find(({ stackId, sourceIds = [] }) => (
    stackId === frontStack?.id && sourceIds.length >= 4
  ));
  assert(Boolean(frontStack && frontArray), 'the supplied drawing contains the Front Stack and its base-rectangle Array');

  canvasController.loadDrawingData(structuredClone(drawing), { zoomToFit: true });
  canvasController.setActiveStack(frontStack.id);
  await nextFrame();
  const frontRow = document.querySelector(`.stack-tree-row[data-stack-id="${frontStack.id}"]`);
  const frontDeleteButton = frontRow?.querySelector('[data-stack-delete]');
  assert(Boolean(frontDeleteButton), 'the Front Stack exposes its Delete action');
  frontDeleteButton.click();
  await nextFrame();
  const afterFrontDelete = canvasController.getDrawingData();
  assert(
    !canvasController.getStackRuntimeState().stacks.some(({ id }) => id === frontStack.id),
    'deleting Front removes the Stack',
  );
  assert(
    !afterFrontDelete.entities.some(({ stackId }) => stackId === frontStack.id)
      && !(afterFrontDelete.extensions.arrayTools?.arrays || []).some(({ stackId }) => stackId === frontStack.id),
    'deleting Front removes its records and dependent Arrays',
  );
  assert(
    Boolean(serializeDrawingJson(afterFrontDelete, 'Front Stack deletion')),
    'the drawing serializes after deleting Front',
  );

  canvasController.loadDrawingData(structuredClone(drawing), { zoomToFit: true });
  canvasController.setActiveStack(frontStack.id);
  canvasController.selectRecords(frontArray.sourceIds);
  await nextFrame();
  const deleteStart = performance.now();
  document.dispatchEvent(new KeyboardEvent('keydown', {
    key: 'Delete',
    bubbles: true,
    cancelable: true,
  }));
  const deleteDuration = performance.now() - deleteStart;
  await nextFrame();
  const afterRectangleDelete = canvasController.getDrawingData();
  assert(
    frontArray.sourceIds.every((id) => !afterRectangleDelete.entities.some((entity) => entity.id === id)),
    'deleting the selected Front base rectangle removes all four source lines',
  );
  assert(
    !(afterRectangleDelete.extensions.arrayTools?.arrays || []).some(({ stackId }) => stackId === frontStack.id),
    'deleting the Front base rectangle removes both dependent Arrays',
  );
  assert(
    canvasController.getStackRuntimeState().stacks.some(({ id }) => id === frontStack.id),
    'deleting the Front base rectangle preserves the Front Stack',
  );
  assert(deleteDuration < 3000, `base-rectangle deletion returns without freezing (${Math.round(deleteDuration)} ms)`);
  assert(
    Boolean(serializeDrawingJson(afterRectangleDelete, 'Front rectangle deletion')),
    'the drawing serializes after deleting the Front base rectangle',
  );

  output.textContent = `PASS: ${checks.length} checks\n${checks.join('\n')}`;
} catch (error) {
  output.textContent = `FAIL: ${error.message}\n${checks.join('\n')}`;
  throw error;
}
