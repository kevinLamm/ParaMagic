import { canvasController, initialization } from '../../main.js';

await initialization;

const response = await fetch('./stack-coordinates.paramagic');
const drawing = await response.json();
const arraySource = drawing.entities.find(({ type }) => type === 'line');
arraySource.construction = true;

const duplicateSource = {
  ...arraySource,
  id: '8fb40d79-d0c0-4b23-9e04-1457b3ae1494',
  start: [0, 90],
  end: [70, 90],
  sourceRecordId: '8fb40d79-d0c0-4b23-9e04-1457b3ae1494',
};
drawing.entities.push(duplicateSource);
drawing.extensions.arrayTools = {
  version: 5,
  arrays: [{
    id: 'b6ec65ca-d912-4b09-8b5c-f231466d7f11',
    stackId: arraySource.stackId,
    arrayType: 'rectangular',
    sourceIds: [arraySource.id],
    rowCountExpression: '1',
    columnCountExpression: '3',
    rowSpacingExpression: '0',
    columnSpacingExpression: '30',
    columnDirection: 'right',
  }, {
    id: 'f8c1903e-a230-45ee-8d89-f09d0a22e156',
    stackId: arraySource.stackId,
    arrayType: 'rectangular',
    sourceIds: [],
    sourceRefs: [{ kind: 'array-placement', arrayId: 'b6ec65ca-d912-4b09-8b5c-f231466d7f11', placementIndex: 1 }],
    rowCountExpression: '2',
    columnCountExpression: '1',
    rowSpacingExpression: '40',
    columnSpacingExpression: '0',
  }],
};
drawing.extensions.linkedCopyTools = {
  version: 3,
  copies: [{
    id: '67f4e8a7-d8f8-466e-94ed-8879ca5a261b',
    type: 'duplicate',
    stackId: duplicateSource.stackId,
    sourceIds: [duplicateSource.id],
    anchor: [170, 90],
    linear: { a: 1, b: 0, c: 0, d: 1 },
    visible: true,
  }],
  positionConstraints: [],
};

canvasController.loadDrawingData(drawing, { zoomToFit: true });
const objectLayer = canvasController.getObjectLayer();
const dimensionTextModeButton = document.getElementById('dimensionTextMode');
const output = document.createElement('output');
output.style.cssText = 'position:fixed;right:12px;bottom:12px;z-index:2000;padding:10px;background:white;border:1px solid #888;font:13px sans-serif;white-space:pre-wrap';
document.body.append(output);

const nextFrame = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
const constructionDerivativeCount = () => objectLayer.querySelectorAll([
  '.array-group .array-item-content .construction',
  '.linked-copy-group .linked-copy-content .construction',
].join(',')).length;

await nextFrame();
const before = constructionDerivativeCount();
dimensionTextModeButton.click();
await nextFrame();
const during = constructionDerivativeCount();
const originalHidden = [...objectLayer.querySelectorAll('.canvas-record[data-record-id]')]
  .filter((node) => node.querySelector('.construction'))
  .every((node) => getComputedStyle(node).display === 'none');
const ordinaryGeometryVisible = [...objectLayer.querySelectorAll('.canvas-record[data-record-id]')]
  .some((node) => node.querySelector('.entity') && getComputedStyle(node).display !== 'none');

dimensionTextModeButton.click();
await nextFrame();
const expressionCount = constructionDerivativeCount();
dimensionTextModeButton.click();
await nextFrame();
const restored = constructionDerivativeCount();
dimensionTextModeButton.click();
await nextFrame();

const checks = {
  'construction derivatives and nested arrays render outside Value Only': before >= 4,
  'construction derivatives are absent in Value Only': during === 0,
  'original construction records are hidden in Value Only': originalHidden,
  'ordinary geometry remains visible in Value Only': ordinaryGeometryVisible,
  'leaving Value Only restores construction derivatives': restored === before,
  'Expression view restores construction derivatives': expressionCount === before,
  'returning to Value Only hides derivatives again': constructionDerivativeCount() === 0,
};
const failed = Object.entries(checks).filter(([, passed]) => !passed).map(([label]) => label);
output.textContent = failed.length
  ? `FAIL: ${failed.join('; ')}`
  : `PASS: ${Object.keys(checks).length} checks\n${Object.keys(checks).join('\n')}`;
if (failed.length) throw new Error(output.textContent);
