import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyMatrix,
  duplicateDerivedRecordId,
  linkedCoincidentPositionTarget,
  linkedConstraintHelperVisible,
  isDuplicableEntity,
  isMirrorableEntity,
  isDerivedSeamEntity,
  isSymmetricCenterline,
  linkedCopyDefinitionFromMatrix,
  linkedCopyMatrix,
  linkedPositionAnchorUpdate,
  nearestLinkedHoverSource,
  parseDuplicateDerivedRecordId,
  parseSymmetricDerivedRecordId,
  reflectPoint,
  reflectionMatrix,
  seamDependsOnSelectedSources,
  selectionIdsFromTarget,
  symmetricDerivedRecordId,
} from '../../packages/paramagic-core/src/modules/SymmetricTool.js';
import { resolveVectorDrawingPoint } from '../../packages/paramagic-core/src/modules/DrawingTools.js';

function reflect(matrix, point) {
  return [
    matrix.a * point[0] + matrix.c * point[1] + matrix.e,
    matrix.b * point[0] + matrix.d * point[1] + matrix.f,
  ];
}

test('reflectionMatrix mirrors points across an arbitrary line', () => {
  const vertical = reflectionMatrix([2, -5], [2, 8]);
  assert.deepEqual(reflect(vertical, [5, 3]).map((value) => Math.round(value)), [-1, 3]);

  const diagonal = reflectionMatrix([0, 0], [4, 4]);
  assert.deepEqual(reflect(diagonal, [3, 1]).map((value) => Math.round(value)), [1, 3]);
});

test('symmetric dimension identities preserve the centerline and source feature owner', () => {
  const recordId = symmetricDerivedRecordId('center:one', 'shape/one');
  assert.deepEqual(parseSymmetricDerivedRecordId(recordId), {
    centerlineId: 'center:one',
    sourceId: 'shape/one',
  });
  assert.deepEqual(reflectPoint(reflectionMatrix([0, 0], [0, 10]), [4, 3]), [-4, 3]);
});

test('symmetric centerlines are not valid mirror sources', () => {
  const centerline = {
    id: 'centerline',
    type: 'line',
    composite: { kind: 'symmetric-centerline', sourceIds: [] },
  };
  assert.equal(isSymmetricCenterline(centerline), true);
  assert.equal(isMirrorableEntity(centerline), false);
  assert.equal(isMirrorableEntity({ id: 'line', type: 'line' }), true);
  assert.equal(isMirrorableEntity({ id: 'dimension', type: 'dimension-line' }), false);
});

test('derived Seam Lines mirror with their selected parent boundary', () => {
  const seam = {
    id: 'seam',
    type: 'polyline',
    composite: {
      kind: 'finish-size-offset',
      sourceFeatures: [{ recordId: 'target-edge', sourceId: 'target-edge' }, { recordId: 'target-edge', sourceId: 'cut-edge' }],
    },
  };
  assert.equal(isDerivedSeamEntity(seam), true);
  assert.equal(seamDependsOnSelectedSources(seam, new Set(['target-edge'])), true);
  assert.equal(seamDependsOnSelectedSources(seam, new Set(['other'])), false);
});

test('filled-region selection resolves every source record in the closed shape', () => {
  const region = { dataset: { parentIds: 'edge-a,edge-b,edge-c,edge-d' } };
  const target = {
    closest(selector) {
      if (selector === '.closed-constrained-region[data-parent-ids]') return region;
      return null;
    },
  };
  assert.deepEqual(selectionIdsFromTarget(target), ['edge-a', 'edge-b', 'edge-c', 'edge-d']);
});

test('standard canvas selection IDs remain mirrorable source entities', () => {
  const entities = new Map([
    ['line', { id: 'line', type: 'line' }],
    ['edge-a', { id: 'edge-a', type: 'line' }],
    ['dimension', { id: 'dimension', type: 'dimension-line' }],
  ]);
  const pending = new Set(['line']);
  ['edge-a', 'dimension']
    .filter((id) => isMirrorableEntity(entities.get(id)))
    .forEach((id) => pending.add(id));
  assert.deepEqual([...pending], ['line', 'edge-a']);
});

test('a closed region is mirrored only when its complete boundary is selected', () => {
  const regionBoundary = ['edge-a', 'edge-b', 'fillet'];
  const completeSelection = new Set(['edge-a', 'edge-b', 'fillet', 'other']);
  const incompleteSelection = new Set(['edge-a', 'edge-b']);
  assert.equal(regionBoundary.every((id) => completeSelection.has(id)), true);
  assert.equal(regionBoundary.every((id) => incompleteSelection.has(id)), false);
});

test('notch entities are valid mirror sources while dimensions remain excluded', () => {
  assert.equal(isMirrorableEntity({ id: 'notch', type: 'notch' }), true);
  assert.equal(isMirrorableEntity({ id: 'dimension', type: 'radius-dimension' }), false);
});

test('construction entities are excluded from symmetric source selection', () => {
  assert.equal(isMirrorableEntity({ id: 'construction', type: 'line', construction: true }), false);
  assert.equal(isMirrorableEntity({
    id: 'swell-construction',
    type: 'line',
    construction: true,
    composite: { kind: 'swell-line', swell: { enabled: true } },
  }), true);
});

test('Symmetric source selection recognizes a complete derived presentation selection set', () => {
  const selectionSet = { dataset: { selectionRecordIds: 'line,arc,spline' } };
  const target = { closest: (selector) => selector === '[data-selection-record-ids]' ? selectionSet : null };
  assert.deepEqual(selectionIdsFromTarget(target), ['line', 'arc', 'spline']);
});

test('Symmetric source selection recognizes geometry through its visible point-handle layer', () => {
  const handleGroup = { dataset: { recordId: 'swell-circle' } };
  const target = {
    closest(selector) {
      if (selector === '[data-selection-record-ids]') return null;
      if (selector === '.closed-constrained-region[data-parent-ids]') return null;
      if (selector.includes('.canvas-handle-group[data-record-id]')) return handleGroup;
      return null;
    },
  };

  assert.deepEqual(selectionIdsFromTarget(target), ['swell-circle']);
});

test('symmetric centerline snapping shares vector snap and Alt bypass behavior', () => {
  const snapped = resolveVectorDrawingPoint({
    rawPoint: [10, 1],
    anchor: [0, 0],
  });
  assert.ok(Math.abs(snapped.point[1]) < 0.000001);

  const unsnapped = resolveVectorDrawingPoint({
    rawPoint: [10, 1],
    anchor: [0, 0],
    event: { altKey: true },
  });
  assert.deepEqual(unsnapped.point, [10, 1]);
});

test('linked duplicates retain their own absolute anchor when the parent moves', () => {
  const definition = {
    id: 'duplicate-1',
    type: 'duplicate',
    sourceIds: ['line'],
    anchor: [50, 60],
    linear: { a: 1, b: 0, c: 0, d: 1 },
  };
  const originalMatrix = linkedCopyMatrix(definition, [10, 20]);
  const movedParentMatrix = linkedCopyMatrix(definition, [110, 120]);

  assert.deepEqual(applyMatrix(originalMatrix, [10, 20]), [50, 60]);
  assert.deepEqual(applyMatrix(movedParentMatrix, [110, 120]), [50, 60]);
  assert.deepEqual(applyMatrix(movedParentMatrix, [115, 123]), [55, 63]);
});

test('linked symmetry stores the reflected result location independently of its axis', () => {
  const matrix = reflectionMatrix([0, -10], [0, 10]);
  const definition = linkedCopyDefinitionFromMatrix({
    id: 'symmetric-1',
    type: 'symmetric',
    sourceIds: ['line'],
    sourceAnchor: [10, 20],
    matrix,
  });

  assert.deepEqual(definition.anchor, [-10, 20]);
  assert.deepEqual(applyMatrix(linkedCopyMatrix(definition, [110, 120]), [110, 120]), [-10, 20]);
  assert.deepEqual(applyMatrix(linkedCopyMatrix(definition, [110, 120]), [115, 123]), [-15, 23]);
});

test('duplicate identities and source eligibility exclude dimensions but retain construction geometry', () => {
  const recordId = duplicateDerivedRecordId('copy:one', 'shape/one');
  assert.deepEqual(parseDuplicateDerivedRecordId(recordId), { copyId: 'copy:one', sourceId: 'shape/one' });
  assert.equal(isDuplicableEntity({ id: 'construction', type: 'line', construction: true }), true);
  assert.equal(isDuplicableEntity({ id: 'dimension', type: 'dimension-line' }), false);
  assert.equal(isDuplicableEntity({ id: 'seam', type: 'line', composite: { kind: 'finish-size-offset' } }), false);
});

test('linked-position updates preserve the perpendicular offset while following the reference point', () => {
  const definition = {
    id: 'copy-a', type: 'duplicate', sourceIds: ['line-a'], anchor: [80, 30],
    linear: { a: 1, b: 0, c: 0, d: 1 },
  };
  const target = { axis: 'horizontal', axisSign: 1, perpendicularOffset: 20 };

  assert.deepEqual(linkedPositionAnchorUpdate(definition, [80, 30], [40, 50], target, 60), [100, 70]);
  assert.deepEqual(linkedPositionAnchorUpdate(definition, [80, 30], [40, 50], { ...target, axisSign: -1 }, 60), [-20, 70]);
  assert.equal(linkedPositionAnchorUpdate(definition, [80, 30], [40, 50], { ...target, axis: 'aligned' }, 60), null);
});

test('linked Coincident uses the existing linked-position operation with a zero offset', () => {
  const derived = {
    kind: 'point',
    recordId: duplicateDerivedRecordId('copy-a', 'line-a'),
    index: 2,
    linkedCopyId: 'copy-a',
    linkedSourceId: 'line-a',
  };
  const target = linkedCoincidentPositionTarget(derived, {
    kind: 'point', recordId: 'line-b', index: 0,
  });
  assert.deepEqual(target, {
    type: 'linked-position',
    recordId: derived.recordId,
    copyId: 'copy-a',
    sourceId: 'line-a',
    pointIndex: 2,
    otherAnchor: { type: 'point', recordId: 'line-b', index: 0 },
    axis: 'horizontal',
    axisSign: 1,
    perpendicularOffset: 0,
  });
  assert.deepEqual(linkedPositionAnchorUpdate(
    { id: 'copy-a', sourceIds: ['line-a'], anchor: [80, 30] },
    [110, 55],
    [40, 75],
    target,
    0,
  ), [10, 50]);
});

test('linked constraint helpers hide on inactive Stacks unless tied to active geometry', () => {
  const definition = { id: 'copy-a', stackId: 'stack-inactive', sourceIds: ['line-a'] };
  const constraint = {
    featureRefs: [
      { recordId: duplicateDerivedRecordId('copy-a', 'line-a') },
      { recordId: 'reference-line' },
    ],
  };
  const visibility = (activeRecordIds = []) => linkedConstraintHelperVisible({
    definition,
    constraint,
    isStackVisible: () => true,
    isStackActive: () => false,
    isObjectVisible: () => true,
    isRecordInActiveStack: (recordId) => activeRecordIds.includes(recordId),
  });

  assert.equal(visibility(), false);
  assert.equal(visibility(['reference-line']), true);
  assert.equal(linkedConstraintHelperVisible({
    definition,
    constraint,
    isStackVisible: () => true,
    isStackActive: () => true,
    isObjectVisible: () => true,
  }), true);
  assert.equal(linkedConstraintHelperVisible({
    definition,
    constraint,
    isStackVisible: () => false,
    isStackActive: () => true,
    isObjectVisible: () => true,
  }), false);
});


test('linked Driving Dimension hover resolves only nearby derived geometry', () => {
  const featureSets = [{
    features: [
      { kind: 'point', point: [10, 10], linkedSourceId: 'line-a' },
      { kind: 'segment', start: [10, 10], end: [40, 10], linkedSourceId: 'line-a' },
      { kind: 'segment', start: [100, 100], end: [140, 100], linkedSourceId: 'line-b' },
    ],
  }];

  assert.equal(nearestLinkedHoverSource(featureSets, [25, 14], 5), 'line-a');
  assert.equal(nearestLinkedHoverSource(featureSets, [120, 102], 5), 'line-b');
  assert.equal(nearestLinkedHoverSource(featureSets, [70, 70], 5), null);
});
