import { canvasController, initialization } from '../../main.js';
import { withSwellDefinition } from '../../../packages/paramagic-core/src/modules/SwellGeometry.js';

await initialization;

const response = await fetch('./stack-coordinates.paramagic');
const drawing = await response.json();
const stackId = drawing.extensions.stacks.stacks.find(({ kind }) => kind === 'stack').id;
const alternateStackId = drawing.extensions.stacks.stacks.find(({ kind, id }) => (
  kind === 'stack' && id !== stackId
)).id;
const classId = drawing.activeClassId;
const ids = {
  arrayBase: '7e532091-29c4-4fc5-bb1b-a838c2fba8b7',
  linkedBase: 'bf688715-8119-4f40-8189-fe24c3b84203',
  swellBase: 'cb55468a-cf38-4b98-be53-4a37492098ba',
  seamBase: '9ed4ea31-823a-44ac-9bb4-2514268e7cbe',
  seamDefinition: '701889ae-eab9-4f35-9ce3-7227c1da51c6',
  parentArray: 'ea96d2e4-ca42-48d7-a4df-33d96bf15793',
  linkedCopy: 'e6b167b0-1414-4fc2-b509-9c4ef52aa086',
  symmetricCopy: '5434b75e-ac6f-4ae8-a028-e187842881b4',
};
const line = (id, start, end) => ({
  id, type: 'line', stackId, start, end, classId, classPropertyOverrides: [],
  sourceRecordId: id, sourceStackId: stackId,
});
const swellBase = withSwellDefinition(line(ids.swellBase, [0, 100], [50, 100]), {
  enabled: true,
  swellEnabled: true,
  offsetExpression: '4',
  swellOffsetExpression: '10',
  startTransitionExpression: '12',
  endTransitionExpression: '12',
});
drawing.drawingUnit = 'mm';
drawing.dxfExportUnit = 'mm';
drawing.entities = [
  line(ids.arrayBase, [0, 0], [20, 0]),
  line(ids.linkedBase, [0, 50], [20, 50]),
  swellBase,
  {
    id: ids.seamBase,
    type: 'rect',
    stackId,
    x: 0,
    y: 140,
    width: 50,
    height: 30,
    classId,
    classPropertyOverrides: [],
    sourceRecordId: ids.seamBase,
    sourceStackId: stackId,
  },
];
drawing.constraints = [];
drawing.parameters = [];
drawing.dimensionAnnotations = [];
drawing.extensions.arrayTools = {
  version: 6,
  arrays: [{
    id: ids.parentArray,
    stackId,
    arrayType: 'rectangular',
    sourceIds: [ids.arrayBase],
    rowCountExpression: '1',
    columnCountExpression: '2',
    rowSpacingExpression: '0',
    columnSpacingExpression: '30',
    columnDirection: 'right',
  }],
};
drawing.extensions.linkedCopyTools = {
  version: 3,
  copies: [{
    id: ids.linkedCopy,
    type: 'duplicate',
    stackId,
    sourceIds: [ids.linkedBase],
    anchor: [90, 50],
    linear: { a: 1, b: 0, c: 0, d: 1 },
    visible: true,
  }, {
    id: ids.symmetricCopy,
    type: 'symmetric',
    stackId,
    sourceIds: [ids.linkedBase],
    anchor: [90, 85],
    linear: { a: -1, b: 0, c: 0, d: 1 },
    visible: true,
  }],
  positionConstraints: [],
};
drawing.extensions.seamLines = {
  version: 2,
  definitions: [{
    id: ids.seamDefinition,
    regionId: ids.seamBase,
    recordIds: [ids.seamBase],
    defaultEnabled: true,
    overrides: [],
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
const pointerDown = (node, modifiers = {}) => node.dispatchEvent(new PointerEvent('pointerdown', {
  button: 0,
  bubbles: true,
  cancelable: true,
  pointerId: 1,
  ...modifiers,
}));
const selectDerivative = async (node) => {
  document.querySelector('[data-array-toggle]').click();
  document.querySelector('[data-array-select-objects]').click();
  pointerDown(node());
  document.querySelector('[data-array-select-objects]').click();
  await nextFrame();
};
const selectDerivativeByWindow = async (node) => {
  document.querySelector('[data-array-toggle]').click();
  document.querySelector('[data-array-select-objects]').click();
  const bounds = node().getBoundingClientRect();
  const start = { clientX: bounds.left - 6, clientY: bounds.top - 6 };
  const end = { clientX: bounds.right + 6, clientY: bounds.bottom + 6 };
  const originalCapture = canvas.setPointerCapture;
  const originalRelease = canvas.releasePointerCapture;
  canvas.setPointerCapture = () => {};
  canvas.releasePointerCapture = () => {};
  try {
    canvas.dispatchEvent(new PointerEvent('pointerdown', {
      ...start, pointerId: 72, pointerType: 'mouse', button: 0, buttons: 1, bubbles: true, cancelable: true,
    }));
    canvas.dispatchEvent(new PointerEvent('pointermove', {
      ...end, pointerId: 72, pointerType: 'mouse', button: 0, buttons: 1, bubbles: true, cancelable: true,
    }));
    canvas.dispatchEvent(new PointerEvent('pointerup', {
      ...end, pointerId: 72, pointerType: 'mouse', button: 0, buttons: 0, bubbles: true, cancelable: true,
    }));
    canvas.dispatchEvent(new MouseEvent('click', {
      ...end, button: 0, bubbles: true, cancelable: true,
    }));
  } finally {
    canvas.setPointerCapture = originalCapture;
    canvas.releasePointerCapture = originalRelease;
  }
  await nextFrame();
  const result = {
    editorVisible: document.querySelector('.array-settings-popup')?.hidden === false,
    sourceCount: document.querySelector('[data-array-source-count]')?.textContent,
  };
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  await nextFrame();
  return result;
};

await nextFrame();
const checks = [];
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
  checks.push(message);
};

try {
  assert(Boolean(objectLayer.querySelector(`.array-group[data-array-id="${ids.parentArray}"] .array-item`)), 'parent Array placement renders');
  assert(Boolean(objectLayer.querySelector(`.linked-copy-group[data-linked-copy-id="${ids.linkedCopy}"]`)), 'Duplicate derivative renders');
  assert(Boolean(objectLayer.querySelector(`.linked-copy-group[data-linked-copy-id="${ids.symmetricCopy}"]`)), 'Symmetric derivative renders');
  assert(Boolean(objectLayer.querySelector(`.swell-derived-group[data-swell-owner-id="${ids.swellBase}"] .swell-derived-piece`)), 'Swell derivative pieces render');
  assert(Boolean(objectLayer.querySelector('.seam-line-presentation .seam-line-hit')), 'Seam Line derivative renders');

  const derivativeWindowSelection = await selectDerivativeByWindow(() => (
    objectLayer.querySelector(`.array-group[data-array-id="${ids.parentArray}"] .array-item-template .selectable-entity`)
  ));
  assert(derivativeWindowSelection.editorVisible, 'window selecting an Array derivative keeps the Array editor active');
  assert(derivativeWindowSelection.sourceCount === '1 object selected', 'window selecting an Array derivative updates the source set');
  const windowCreated = canvasController.getDrawingData().extensions.arrayTools.arrays
    .filter(({ id }) => id !== ids.parentArray);
  assert(
    windowCreated.length === 1
      && windowCreated[0].sourceRefs?.[0]?.kind === 'array-placement',
    'window-selected Array derivative is committed as a live source',
  );
  await selectDerivative(() => objectLayer.querySelector(`.linked-copy-group[data-linked-copy-id="${ids.linkedCopy}"] .linked-copy-hit`));
  await selectDerivative(() => objectLayer.querySelector(`.linked-copy-group[data-linked-copy-id="${ids.symmetricCopy}"] .linked-copy-hit`));
  await selectDerivative(() => objectLayer.querySelector(`.swell-derived-group[data-swell-owner-id="${ids.swellBase}"] .swell-derived-hit`));
  await selectDerivative(() => objectLayer.querySelector('.seam-line-presentation .seam-line-hit'));

  let saved = canvasController.getDrawingData();
  const created = saved.extensions.arrayTools.arrays.filter(({ id }) => id !== ids.parentArray);
  assert(created.length === 5, 'five Arrays are created from derivative objects');
  assert(created.some(({ sourceRefs }) => sourceRefs?.some((reference) => reference.kind === 'array-placement')), 'Array placement is stored as a live source reference');
  assert(created.some(({ sourceRefs }) => sourceRefs?.some((reference) => reference.kind === 'linked-copy')), 'Duplicate is stored as a live source reference');
  assert(created.some(({ sourceRefs }) => sourceRefs?.some((reference) => reference.copyId === ids.symmetricCopy)), 'Symmetric is stored as a live source reference');
  assert(created.some(({ sourceRefs }) => sourceRefs?.some((reference) => reference.kind === 'swell-piece')), 'individual Swell piece is stored as a live source reference');
  assert(created.some(({ sourceRefs }) => sourceRefs?.some((reference) => reference.kind === 'seam-line')), 'Seam Line is stored as a live source reference');
  assert(created.every(({ id }) => objectLayer.querySelector(`.array-group[data-array-id="${id}"] .array-item`)), 'every derivative Array renders visible placements');

  const definitionForKind = (kind) => created.find(({ sourceRefs }) => (
    sourceRefs?.some((reference) => reference.kind === kind)
  ));
  const boundsFor = (definition) => {
    const bounds = objectLayer.querySelector(`.array-group[data-array-id="${definition.id}"]`).getBBox();
    return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height };
  };
  const beforeChanges = {
    array: boundsFor(definitionForKind('array-placement')),
    linked: boundsFor(definitionForKind('linked-copy')),
    swell: boundsFor(definitionForKind('swell-piece')),
    seam: boundsFor(definitionForKind('seam-line')),
  };

  saved.extensions.arrayTools.arrays.find(({ id }) => id === ids.parentArray).columnSpacingExpression = '80';
  saved.extensions.linkedCopyTools.copies.find(({ id }) => id === ids.linkedCopy).anchor[0] += 50;
  const changedSwell = saved.entities.find(({ id }) => id === ids.swellBase);
  changedSwell.start[1] += 25;
  changedSwell.end[1] += 25;
  const changedSeam = saved.entities.find(({ id }) => id === ids.seamBase);
  if (Array.isArray(changedSeam.points)) {
    changedSeam.points = changedSeam.points.map(([x, y]) => [x + 60, y]);
  } else changedSeam.x += 60;

  canvasController.loadDrawingData(structuredClone(saved), { zoomToFit: true });
  canvasController.setActiveStack(stackId);
  await nextFrame();
  saved = canvasController.getDrawingData();
  const reloaded = saved.extensions.arrayTools.arrays.filter(({ id }) => id !== ids.parentArray);
  assert(reloaded.length === 5, 'derivative Array sources survive drawing reload');
  assert(reloaded.every(({ id }) => objectLayer.querySelector(`.array-group[data-array-id="${id}"] .array-item`)), 'every derivative Array renders after reload');
  const duplicateArray = definitionForKind('linked-copy');
  canvasController.setActiveStack(alternateStackId);
  await nextFrame();
  const inactiveDuplicate = objectLayer.querySelector(`.linked-copy-group[data-linked-copy-id="${ids.linkedCopy}"]`);
  const inactiveDuplicateArray = objectLayer.querySelector(`.array-group[data-array-id="${duplicateArray.id}"]`);
  assert(inactiveDuplicate.classList.contains('stack-inactive'), 'Duplicate source enters inactive Stack presentation');
  assert(
    inactiveDuplicateArray.classList.contains('stack-inactive')
      && !inactiveDuplicateArray.classList.contains('object-visibility-hidden')
      && Boolean(inactiveDuplicateArray.querySelector('.array-item')),
    'Array based on a Duplicate remains visible while its Stack is inactive',
  );
  canvasController.setActiveStack(stackId);
  await nextFrame();
  const changed = (before, after) => Math.abs(before.x - after.x) > 0.01
    || Math.abs(before.y - after.y) > 0.01
    || Math.abs(before.width - after.width) > 0.01
    || Math.abs(before.height - after.height) > 0.01;
  assert(changed(beforeChanges.array, boundsFor(definitionForKind('array-placement'))), 'Array-placement source follows its parent Array change');
  assert(changed(beforeChanges.linked, boundsFor(definitionForKind('linked-copy'))), 'Duplicate source follows its linked-copy change');
  assert(changed(beforeChanges.swell, boundsFor(definitionForKind('swell-piece'))), 'Swell-piece source follows its owner change');
  const seamAfter = boundsFor(definitionForKind('seam-line'));
  assert(changed(beforeChanges.seam, seamAfter), `Seam-Line source follows its owner change (${JSON.stringify(beforeChanges.seam)} -> ${JSON.stringify(seamAfter)})`);

  const derivativeGroups = reloaded.map(({ id }) => (
    objectLayer.querySelector(`.array-group[data-array-id="${id}"]`)
  ));
  assert(
    derivativeGroups.every((group) => group.querySelectorAll(':scope > .array-item-hit-definitions').length === 1),
    'each derivative Array owns one reusable hit definition',
  );
  assert(
    derivativeGroups.every((group) => (
      group.querySelectorAll(':scope > .array-item > .array-item-hit-layer > .array-item-hit-use').length
      === group.querySelectorAll(':scope > .array-item').length
    )),
    'derivative Array placements reuse their shared hit definition',
  );

  const removable = definitionForKind('seam-line');
  const removableGroup = objectLayer.querySelector(`.array-group[data-array-id="${removable.id}"]`);
  const nodeCountBeforeDelete = objectLayer.querySelectorAll('*').length;
  removableGroup.querySelector(':scope > .array-item .array-item-hit-use').dispatchEvent(new MouseEvent('click', {
    button: 0,
    bubbles: true,
    cancelable: true,
  }));
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true }));
  await nextFrame();
  assert(
    !canvasController.getDrawingData().extensions.arrayTools.arrays.some(({ id }) => id === removable.id)
      && !objectLayer.querySelector(`.array-group[data-array-id="${removable.id}"]`),
    'deleting a derivative Array removes its definition and rendered group',
  );
  assert(
    objectLayer.querySelectorAll('*').length < nodeCountBeforeDelete,
    'deleting a derivative Array releases its rendered nodes',
  );

  output.textContent = `PASS: ${checks.length} checks\n${checks.join('\n')}`;
} catch (error) {
  output.textContent = `FAIL: ${error.message}\n${checks.join('\n')}`;
  throw error;
}
