import assert from 'node:assert/strict';
import test from 'node:test';
import { createNotchBoundaryResolver } from '../../packages/paramagic-core/src/modules/NotchSystem.js';

const sourceFeature = {
  recordId: 'shape',
  kind: 'segment',
  index: 0,
  start: [0, 0],
  end: [20, 0],
};

function resolverForLine() {
  const record = { id: 'shape', recordType: 'geometry', entity: {
    id: 'shape', type: 'line', start: [0, 0], end: [20, 0],
  } };
  const target = { closest: () => ({ dataset: { recordId: 'shape' } }) };
  return createNotchBoundaryResolver({
    records: [record],
    recordSegments: () => [sourceFeature],
    renderedEntityForRecord: () => record.entity,
    evaluateFilletedGeometry: (entities) => entities,
    getClosedCycles: () => [[{ entityId: 'shape' }]],
    getEntityFeature: () => sourceFeature,
    getSegmentFeature: () => sourceFeature,
    arcCircle: () => null,
    screenToWorld: () => [7.25, 0],
    target,
  });
}

test('an ordinary host resolves to its current edge feature', () => {
  const resolver = resolverForLine();
  assert.deepEqual(
    resolver.featureForHost({ recordId: 'shape', kind: 'segment', index: 0 }),
    sourceFeature,
  );
  assert.equal(resolver.isClosedHost(sourceFeature), true);
});

test('an ordinary edge click projects the Notch point onto the clicked edge', () => {
  const resolver = resolverForLine();
  const feature = resolver.featureFromEvent({
    target: { closest: () => ({ dataset: { recordId: 'shape' } }) },
    clientX: 0,
    clientY: 0,
  });
  assert.equal(feature.recordId, 'shape');
  assert.deepEqual(feature.pickedPoint, [7.25, 0]);
});

test('a rectangle exposes every edge to Notch and Seam Line tools', () => {
  const rect = { id: 'rect', type: 'rect', x: 0, y: 0, width: 20, height: 10 };
  const resolver = createNotchBoundaryResolver({
    records: [{ id: 'rect', recordType: 'geometry', entity: rect }],
    recordSegments: (entity) => [
      { index: 0, start: [entity.x, entity.y], end: [entity.x + entity.width, entity.y] },
      { index: 1, start: [entity.x + entity.width, entity.y], end: [entity.x + entity.width, entity.y + entity.height] },
      { index: 2, start: [entity.x + entity.width, entity.y + entity.height], end: [entity.x, entity.y + entity.height] },
      { index: 3, start: [entity.x, entity.y + entity.height], end: [entity.x, entity.y] },
    ],
    renderedEntityForRecord: () => rect,
    evaluateFilletedGeometry: (entities) => entities,
    getClosedCycles: () => [],
    getEntityFeature: () => null,
    getSegmentFeature: () => null,
    arcCircle: () => null,
    screenToWorld: () => [0, 0],
  });
  assert.equal(resolver.boundaryFeatures({ recordId: 'rect', kind: 'segment', index: 0 }).length, 4);
  assert.deepEqual(resolver.inwardTarget(
    { recordId: 'rect', kind: 'segment', index: 0 },
    [10, 0],
    [1, 0],
  ), [10, 6.35]);
});

test('Notch resolution consumes the shared physical boundary contract', () => {
  const resolved = {
    id: 'panel',
    recordIds: ['top', 'right', 'bottom', 'left'],
    polygon: [[0, 0], [20, 0], [20, 10], [0, 10]],
    features: [
      {
        recordId: 'top', sourceId: 'top', targetId: 'panel', kind: 'segment', index: 0,
        stableKey: 'resolved:panel:top:segment:0', start: [0, 0], end: [20, 0],
      },
      {
        recordId: 'right', sourceId: 'right', targetId: 'panel', kind: 'segment', index: 0,
        stableKey: 'resolved:panel:right:segment:0', start: [20, 0], end: [20, 10],
      },
      {
        recordId: 'bottom', sourceId: 'bottom', targetId: 'panel', kind: 'segment', index: 0,
        stableKey: 'resolved:panel:bottom:segment:0', start: [20, 10], end: [0, 10],
      },
      {
        recordId: 'left', sourceId: 'left', targetId: 'panel', kind: 'segment', index: 0,
        stableKey: 'resolved:panel:left:segment:0', start: [0, 10], end: [0, 0],
      },
    ],
  };
  const resolver = createNotchBoundaryResolver({
    records: resolved.recordIds.map((id) => ({
      id, recordType: 'geometry', entity: { id, type: 'line', start: [0, 0], end: [1, 0] },
    })),
    recordSegments: () => [],
    renderedEntityForRecord: (record) => record.entity,
    evaluateFilletedGeometry: (entities) => entities,
    getClosedCycles: () => [],
    getEntityFeature: () => null,
    getSegmentFeature: () => null,
    arcCircle: () => null,
    screenToWorld: () => [20, 4],
    getResolvedBoundaries: () => [resolved],
  });

  const host = { recordId: 'right', stableKey: 'resolved:panel:right:segment:0' };
  assert.equal(resolver.boundaryForHost(host), resolved);
  assert.equal(resolver.featureForHost(host), resolved.features[1]);
  assert.deepEqual(resolver.boundaryFeatures(host), resolved.features);
  assert.equal(resolver.isClosedHost(host), true);
  assert.deepEqual(resolver.inwardTarget(host, [20, 4], [0, 1]), [13.65, 4]);
});

test('Notch boundary resolution can use a stable derived subtract edge', () => {
  const derived = {
    recordId: 'target',
    targetId: 'target',
    sourceId: 'cutter',
    sourceFeatureIndex: 1,
    boundaryRole: 'subtract',
    stableKey: 'target:cutter:subtract:1:0:1',
    kind: 'segment',
    index: 0,
    start: [4, 0],
    end: [4, 6],
  };
  const resolver = createNotchBoundaryResolver({
    records: [{ id: 'target', recordType: 'geometry', entity: { id: 'target', type: 'rect', x: 0, y: 0, width: 10, height: 10 } }],
    recordSegments: () => [],
    renderedEntityForRecord: (record) => record.entity,
    evaluateFilletedGeometry: (entities) => entities,
    getClosedCycles: () => [],
    getEntityFeature: () => null,
    getSegmentFeature: () => null,
    arcCircle: () => null,
    screenToWorld: () => [4, 3],
    getSubtractBoundaryFeatures: () => [derived],
    getSubtractBoundaryFeature: (host) => host.stableKey === derived.stableKey ? derived : null,
  });
  assert.equal(resolver.featureForHost({ recordId: 'target', stableKey: derived.stableKey }), derived);
  assert.equal(resolver.boundaryFeatures({ recordId: 'target' })[0].sourceId, 'cutter');
  assert.equal(resolver.featureFromEvent({ target: { closest: () => ({ dataset: { recordId: 'target' } }) }, clientX: 0, clientY: 0 }).sourceId, 'cutter');
});

test('a cut-edge click can resolve to the target boundary even when the cutter receives the event', () => {
  const derived = {
    recordId: 'target',
    sourceId: 'cutter',
    targetId: 'target',
    boundaryRole: 'subtract',
    kind: 'segment',
    index: 0,
    start: [4, 0],
    end: [4, 6],
  };
  const resolver = createNotchBoundaryResolver({
    records: [
      { id: 'target', recordType: 'geometry', entity: { id: 'target', type: 'rect', x: 0, y: 0, width: 10, height: 10 } },
      { id: 'cutter', recordType: 'geometry', entity: { id: 'cutter', type: 'rect', x: 4, y: 0, width: 2, height: 6, subtract: true } },
    ],
    recordSegments: () => [],
    renderedEntityForRecord: (record) => record.entity,
    evaluateFilletedGeometry: (entities) => entities,
    getClosedCycles: () => [],
    getEntityFeature: () => null,
    getSegmentFeature: () => null,
    arcCircle: () => null,
    screenToWorld: () => [4, 3],
    getSubtractBoundaryFeatureFromWorld: () => derived,
  });
  const feature = resolver.featureFromEvent({
    target: { closest: () => ({ dataset: { recordId: 'cutter' } }) },
    clientX: 0,
    clientY: 0,
  });
  assert.equal(feature.recordId, 'target');
  assert.equal(feature.boundaryRole, 'subtract');
});

test('cut-boundary Notches use the remaining-material side', () => {
  const derived = {
    recordId: 'target',
    sourceId: 'cutter',
    targetId: 'target',
    boundaryRole: 'subtract',
    kind: 'segment',
    index: 0,
    start: [4, 0],
    end: [4, 6],
  };
  const resolver = createNotchBoundaryResolver({
    records: [{ id: 'target', recordType: 'geometry', entity: { id: 'target', type: 'rect', x: 0, y: 0, width: 10, height: 10 } }],
    recordSegments: () => [],
    renderedEntityForRecord: (record) => record.entity,
    evaluateFilletedGeometry: (entities) => entities,
    getClosedCycles: () => [],
    getEntityFeature: () => null,
    getSegmentFeature: () => null,
    arcCircle: () => null,
    screenToWorld: () => [4, 3],
    getSubtractBoundaryFeature: () => derived,
    getSubtractBoundaryInwardTarget: () => [8, 3],
  });
  assert.deepEqual(
    resolver.inwardTarget({ recordId: 'target', boundaryRole: 'subtract' }, [4, 3], [0, 1]),
    [8, 3],
  );
});
