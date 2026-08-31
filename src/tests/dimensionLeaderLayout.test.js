import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyValueOnlyExportDimensionAppearance,
  createDimensionValueOnlyPersistence,
  DRIVEN_DIMENSION_PRESENTATION_COLOR,
  dimensionExcludedFromExport,
  dimensionHiddenInTextMode,
  dimensionIncludedInValueOnly,
  setDimensionIncludedInValueOnly,
  dimensionTextEditable,
  prepareDimensionPresentationClone,
  mclDimensionLayout,
  moveDimensionLine,
  radiusDimensionLayout,
  updateDimensionPresentationScale,
  uprightDimensionControlPoint,
} from '../../packages/paramagic-core/src/modules/DimensionSystem.js';

function attributeNode() {
  const attributes = new Map();
  return {
    style: {},
    textContent: '',
    setAttribute(name, value) { attributes.set(name, String(value)); },
    getAttribute(name) { return attributes.get(name) || ''; },
  };
}

test('Value Only inclusion defaults to driven dimensions and can be enabled for driving dimensions', () => {
  assert.equal(dimensionExcludedFromExport({ dimensionMode: 'driven', excludeFromExport: true }), true);
  assert.equal(dimensionExcludedFromExport({ dimensionMode: 'driven', excludeFromExport: false }), false);
  assert.equal(dimensionExcludedFromExport({ dimensionMode: 'driving' }), true);
  assert.equal(dimensionExcludedFromExport({ dimensionMode: 'driving', includeInValueOnly: true }), false);
  assert.equal(dimensionIncludedInValueOnly({ dimensionMode: 'driving', includeInValueOnly: true }), true);

  const legacyDriving = {};
  assert.equal(dimensionIncludedInValueOnly(legacyDriving), true);
  setDimensionIncludedInValueOnly(legacyDriving, false);
  assert.equal(dimensionIncludedInValueOnly(legacyDriving), false);
});

test('Value Only view hides dimensions not included in that presentation', () => {
  const driving = { dimensionMode: 'driving' };
  const includedDriving = { dimensionMode: 'driving', includeInValueOnly: true };
  const includedDriven = { dimensionMode: 'driven', excludeFromExport: false };
  const excludedDriven = { dimensionMode: 'driven', excludeFromExport: true };

  assert.equal(dimensionHiddenInTextMode(driving, 'value'), true);
  assert.equal(dimensionHiddenInTextMode(includedDriving, 'value'), false);
  assert.equal(dimensionHiddenInTextMode(includedDriven, 'value'), false);
  assert.equal(dimensionHiddenInTextMode(excludedDriven, 'value'), true);
  assert.equal(dimensionHiddenInTextMode(excludedDriven, 'named-value'), false);
  assert.equal(dimensionHiddenInTextMode(excludedDriven, 'expression'), false);
});

test('Driving Dimension text becomes read-only when shown in Value Only view', () => {
  const driving = { dimensionMode: 'driving', includeInValueOnly: true };

  assert.equal(dimensionTextEditable(driving, 'named-value'), true);
  assert.equal(dimensionTextEditable(driving, 'expression'), true);
  assert.equal(dimensionTextEditable(driving, 'value'), false);
  assert.equal(dimensionTextEditable({ dimensionMode: 'driven' }, 'named-value'), false);
});

test('SVG and PNG presentation paint Driving and Driven Dimensions with the Driven color', () => {
  const painted = [];
  const drawable = (name) => ({
    name,
    style: { setProperty(property, value) { painted.push({ name, property, value }); } },
  });
  const path = drawable('path');
  const extension = drawable('extension');
  const arrow = drawable('arrow');
  const text = drawable('text');
  const group = {
    querySelectorAll(selector) {
      if (selector === '.dimension-path, .dimension-extension, .dimension-arrow') {
        return [path, extension, arrow];
      }
      if (selector === '.dimension-arrow, .dimension-text') return [arrow, text];
      return [];
    },
  };
  const root = { querySelectorAll: () => [group] };

  assert.equal(applyValueOnlyExportDimensionAppearance(root), root);
  assert.deepEqual(painted, [
    { name: 'path', property: 'stroke', value: DRIVEN_DIMENSION_PRESENTATION_COLOR },
    { name: 'extension', property: 'stroke', value: DRIVEN_DIMENSION_PRESENTATION_COLOR },
    { name: 'arrow', property: 'stroke', value: DRIVEN_DIMENSION_PRESENTATION_COLOR },
    { name: 'arrow', property: 'fill', value: DRIVEN_DIMENSION_PRESENTATION_COLOR },
    { name: 'text', property: 'fill', value: DRIVEN_DIMENSION_PRESENTATION_COLOR },
  ]);
});

test('dimension Value Only preference persists through the solver annotation', () => {
  const updates = [];
  const changes = [];
  const persist = createDimensionValueOnlyPersistence({
    solver: {
      updateDimensionAnnotation(dimensionId, entity) {
        updates.push({ dimensionId, entity: structuredClone(entity) });
        return true;
      },
    },
    onChange: (entity) => changes.push(entity.dimensionId),
  });
  const entity = {
    dimensionId: 'dimension-width',
    dimensionMode: 'driven',
    excludeFromExport: true,
  };

  assert.equal(persist(entity), true);
  assert.deepEqual(updates, [{ dimensionId: 'dimension-width', entity }]);
  assert.deepEqual(changes, ['dimension-width']);

  const driving = {
    dimensionId: 'dimension-height',
    dimensionMode: 'driving',
    includeInValueOnly: true,
  };
  assert.equal(persist(driving), true);
  assert.deepEqual(updates[1], { dimensionId: 'dimension-height', entity: driving });
  assert.deepEqual(changes, ['dimension-width', 'dimension-height']);
});

test('driven dimension export control follows rotated text without rotating itself', () => {
  const point = uprightDimensionControlPoint([30, 10], 'rotate(90 10 10)');

  assert.ok(Math.abs(point[0] - 10) < 1e-9);
  assert.ok(Math.abs(point[1] - 30) < 1e-9);
});

test('radius dimension text begins at the horizontal leader endpoint on initial placement', () => {
  const entity = {
    type: 'radius-dimension',
    center: [0, 0],
    radius: 50,
    elbow: [30, -20],
    label: [30, -20],
  };

  const layout = radiusDimensionLayout(entity, 1);

  assert.deepEqual(layout.label, layout.landingEnd);
  assert.equal(layout.textAnchor, 'start');
});

test('radius arrowhead follows the leader when the elbow is inside the circle', () => {
  const layout = radiusDimensionLayout({
    type: 'radius-dimension',
    center: [0, 0],
    radius: 50,
    elbow: [10, 0],
    label: [10, 0],
  }, 1);
  const values = layout.arrowA.match(/[-+]?\d+(?:\.\d+)?/g).map(Number);

  assert.deepEqual(values.slice(0, 2), [50, 0]);
  assert.ok(values[2] < values[0], 'arrowhead body should extend toward the elbow');
});

test('diameter dimension spans both circle edges and renders two arrowheads', () => {
  const layout = radiusDimensionLayout({
    type: 'radius-dimension',
    subtype: 'diameter',
    center: [0, 0],
    radius: 50,
    elbow: [80, 0],
    label: [80, 0],
  }, 1);

  assert.deepEqual(layout.oppositeTarget, [-50, 0]);
  assert.deepEqual(layout.target, [50, 0]);
  assert.match(layout.leaderPath, /^M -50 0 L 50 0 /);
  assert.notEqual(layout.arrowA, '');
  assert.notEqual(layout.arrowB, '');
});

test('multi-length dimension text ends at the horizontal leader endpoint on the left side', () => {
  const entity = {
    type: 'multi-curve-length-dimension',
    target: [100, 50],
    elbow: [40, 20],
    label: [40, 20],
  };

  const layout = mclDimensionLayout(entity, 1);

  assert.deepEqual(layout.label, layout.landingEnd);
  assert.equal(layout.textAnchor, 'end');
});

test('dimension presentation snapshots recompute arrows, labels, and offsets at the fitted scale', () => {
  const path = attributeNode();
  const extensionA = attributeNode();
  const extensionB = attributeNode();
  const arrowA = attributeNode();
  const arrowB = attributeNode();
  const text = attributeNode();
  text.textContent = '100.013';
  const cloneGroup = {
    querySelector(selector) {
      if (selector === '.dimension-text') return text;
      if (selector === '.dimension-path:not(.hit-target)') return path;
      return null;
    },
    querySelectorAll(selector) {
      if (selector === '.dimension-extension:not(.hit-target)') return [extensionA, extensionB];
      if (selector === '.dimension-arrow') return [arrowA, arrowB];
      if (selector === '.dimension-record') return [];
      return [];
    },
  };
  prepareDimensionPresentationClone(null, cloneGroup, {
    entity: {
      type: 'dimension-line',
      subtype: 'horizontal',
      dimensionMode: 'driven',
      start: [0, 0],
      end: [100, 0],
      measureStart: [0, 0],
      measureEnd: [100, 0],
      label: [50, 30],
      text: 'Width = 100.013',
    },
  });

  const exportScale = 5;
  assert.equal(updateDimensionPresentationScale(cloneGroup, exportScale), 1);
  assert.equal(Number(text.getAttribute('font-size')) * exportScale, 14);
  assert.equal(text.textContent, '100.013');

  const pathValues = path.getAttribute('d').match(/[-+]?(?:\d+\.?\d*|\.\d+)/g).map(Number);
  const textOffsetPixels = Math.abs(Number(text.getAttribute('y')) - pathValues[1]) * exportScale;
  assert.ok(Math.abs(textOffsetPixels - 14) < 1e-9);

  const arrowValues = arrowA.getAttribute('d').match(/[-+]?(?:\d+\.?\d*|\.\d+)/g).map(Number);
  const tip = arrowValues.slice(0, 2);
  const baseCenter = [
    (arrowValues[2] + arrowValues[4]) / 2,
    (arrowValues[3] + arrowValues[5]) / 2,
  ];
  const arrowLengthPixels = Math.hypot(baseCenter[0] - tip[0], baseCenter[1] - tip[1]) * exportScale;
  assert.ok(Math.abs(arrowLengthPixels - 12) < 1e-9);
});

test('dragging a radius dimension keeps its text attached to the leader landing', () => {
  const entity = {
    type: 'radius-dimension',
    center: [0, 0],
    radius: 50,
    elbow: [30, -20],
    label: [62, -20],
  };
  const record = {
    entity,
    path: { setAttribute() {} },
    pathHit: { setAttribute() {}, getAttribute() { return ''; } },
    arrowA: { setAttribute() {} },
    text: { setAttribute() {}, textContent: '' },
  };

  moveDimensionLine(record, [50, 10], [30, -20], structuredClone(entity), 1);

  const layout = radiusDimensionLayout(entity, 1);
  assert.deepEqual(entity.label, layout.landingEnd);
});
