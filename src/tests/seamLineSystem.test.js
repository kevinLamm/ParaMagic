import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createSeamLineEntities,
  createSeamLineSystem,
  materializeSeamLineEntitiesForDrawing,
  seamLineDefinitionsDependOn,
  seamLineSplineLineTrim,
} from '../../packages/paramagic-core/src/modules/SeamLineSystem.js';
import { seamLineEdgeReference, seamLineSourceReference } from '../../packages/paramagic-core/src/modules/SeamLineSystem.js';

test('seam-line presentation skips unrelated record changes', () => {
  const definitions = [{
    regionId: 'region-a',
    recordIds: ['edge-a', 'edge-b'],
    overrides: [{ recordId: 'edge-a', sourceId: 'source-a', targetId: 'target-a' }],
  }];
  assert.equal(seamLineDefinitionsDependOn(definitions, new Set(['edge-b'])), true);
  assert.equal(seamLineDefinitionsDependOn(definitions, new Set(['source-a'])), true);
  assert.equal(seamLineDefinitionsDependOn(definitions, new Set(['unrelated'])), false);
});

function createStubSystem({
  records,
  selectedIds,
  closed = true,
  boundaryFeatures,
  subtractFeatures = [],
  eventFeature = null,
  screenPoint = [0, 0],
  scale = 1,
  getDrawingSnapshot,
  resolvePresentationHost,
}) {
  const resolver = {
    isClosedHost() { return closed; },
    featureFromEvent(event) { return event?.feature || eventFeature; },
    featureForHost(feature) { return feature; },
    boundaryForHost() {
      return { id: records[0]?.id, recordIds: [records[0]?.id], features: boundaryFeatures };
    },
    boundaryFeatures() { return boundaryFeatures; },
  };
  return createSeamLineSystem({
    records,
    selectedIds,
    notchBoundaryResolver: resolver,
    subtractOwnerForRecord(recordId) {
      const record = records.find((candidate) => candidate.id === recordId);
      return record ? { id: record.id, entity: record.entity, recordIds: [record.id] } : null;
    },
    subtractFeaturesForRecord() { return subtractFeatures; },
    screenToWorld() { return screenPoint; },
    getScale() { return scale; },
    requestHistoryCheckpoint() {},
    notifyObjectChange() {},
    syncGeometryStacking() {},
    getDrawingSnapshot,
    resolvePresentationHost,
  });
}

function installFakeSvgDocument() {
  const previous = globalThis.document;
  class FakeSvgNode {
    constructor(tagName) {
      this.tagName = tagName;
      this.attributes = new Map();
      this.children = [];
      this.parentNode = null;
      this.dataset = {};
      this.style = {};
      this.classes = new Set();
      this.classList = {
        toggle: (name, enabled) => enabled ? this.classes.add(name) : this.classes.delete(name),
      };
    }

    setAttribute(name, value) {
      this.attributes.set(name, String(value));
      if (name.startsWith('data-')) {
        const key = name.slice(5).replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase());
        this.dataset[key] = String(value);
      }
    }

    appendChild(node) {
      node.remove();
      this.children.push(node);
      node.parentNode = this;
      return node;
    }

    insertBefore(node, before) {
      node.remove();
      const index = this.children.indexOf(before);
      if (index < 0) return this.appendChild(node);
      this.children.splice(index, 0, node);
      node.parentNode = this;
      return node;
    }

    replaceChildren(...nodes) {
      this.children.forEach((node) => { node.parentNode = null; });
      this.children = [];
      nodes.forEach((node) => this.appendChild(node));
    }

    remove() {
      if (!this.parentNode) return;
      const index = this.parentNode.children.indexOf(this);
      if (index >= 0) this.parentNode.children.splice(index, 1);
      this.parentNode = null;
    }
  }
  globalThis.document = { createElementNS: (_namespace, tagName) => new FakeSvgNode(tagName) };
  return {
    node: (tagName) => new FakeSvgNode(tagName),
    restore() {
      if (previous === undefined) delete globalThis.document;
      else globalThis.document = previous;
    },
  };
}

test('Seam Line properties reject an open host', () => {
  const feature = { recordId: 'open', kind: 'segment', index: 0, start: [0, 0], end: [100, 0] };
  const records = [{ id: 'open', recordType: 'geometry', entity: { id: 'open', type: 'line' } }];
  const system = createStubSystem({ records, selectedIds: new Set(['open']), closed: false, boundaryFeatures: [feature] });

  assert.equal(system.properties().canEditSeamLine, false);
  assert.equal(system.setSelectedSeamLine(true), false);
  assert.equal(system.extensionProvider.serialize(), null);
});

test('a full closed-region selection does not expose or store Seam Line intent', () => {
  const features = [
    { recordId: 'shape', sourceId: 'shape', kind: 'segment', index: 0, start: [0, 0], end: [100, 0] },
    { recordId: 'shape', sourceId: 'shape', kind: 'segment', index: 1, start: [100, 0], end: [100, 80] },
  ];
  const records = [{ id: 'shape', recordType: 'geometry', entity: { id: 'shape', type: 'rect' } }];
  const system = createStubSystem({ records, selectedIds: new Set(['shape']), boundaryFeatures: features });

  assert.equal(system.properties().canEditSeamLine, false);
  assert.equal(system.setSelectedSeamLine(true), false);
  assert.equal(records.length, 1);
  assert.equal(system.extensionProvider.serialize(), null);
});

test('Ctrl-selected segments expose mixed Seam Line state and edit only those segments', () => {
  const first = { recordId: 'shape', sourceId: 'shape', kind: 'segment', index: 0, start: [0, 0], end: [100, 0] };
  const second = { recordId: 'shape', sourceId: 'shape', kind: 'segment', index: 1, start: [100, 0], end: [100, 80] };
  const records = [{ id: 'shape', recordType: 'geometry', entity: { id: 'shape', type: 'rect' } }];
  const system = createStubSystem({ records, selectedIds: new Set(['shape']), boundaryFeatures: [first, second] });
  system.extensionProvider.restore({
    version: 2,
    definitions: [{
      regionId: 'shape',
      recordIds: ['shape'],
      defaultEnabled: false,
      overrides: [{ ...seamLineEdgeReference(first), enabled: true }],
    }],
  });

  const target = { closest: (selector) => selector === '.segment-select-line' ? target : null };
  system.setPropertyFeatureFromEvent({ target, feature: first });
  system.setPropertyFeatureFromEvent({ target, feature: second, ctrlKey: true });
  assert.equal(system.properties().mixedSeamLine, true);
  assert.equal(system.setSelectedSeamLine(false), true);
  assert.equal(system.extensionProvider.serialize(), null);
});

test('a click inside the fill does not expose region-wide Seam Line editing', () => {
  const first = { recordId: 'shape', sourceId: 'shape', kind: 'segment', index: 0, start: [0, 0], end: [100, 0] };
  const second = { recordId: 'shape', sourceId: 'shape', kind: 'segment', index: 1, start: [100, 0], end: [100, 80] };
  const records = [{ id: 'shape', recordType: 'geometry', entity: { id: 'shape', type: 'rect' } }];
  const system = createStubSystem({
    records,
    selectedIds: new Set(['shape']),
    boundaryFeatures: [first, second],
    eventFeature: first,
    screenPoint: [50, 40],
  });
  system.extensionProvider.restore({
    version: 2,
    definitions: [{ regionId: 'shape', recordIds: ['shape'], defaultEnabled: true, overrides: [] }],
  });

  const target = {
    closest: (selector) => selector === '.closed-constrained-region' ? target : null,
  };
  assert.equal(system.setPropertyFeatureFromEvent({ target }), null);
  assert.equal(system.properties().canEditSeamLine, false);
  assert.equal(system.setSelectedSeamLine(false), false);
  assert.deepEqual(system.extensionProvider.serialize(), {
    version: 2,
    definitions: [{ regionId: 'shape', recordIds: ['shape'], defaultEnabled: true, overrides: [] }],
  });
});

test('a click near a circle edge keeps Seam Line properties scoped to that individual edge', () => {
  const outer = {
    recordId: 'shape', sourceId: 'shape', targetId: 'shape', boundaryRole: 'outer',
    sourceFeatureIndex: 0, kind: 'circle', index: 0, center: [0, 0], radius: 100,
  };
  const cut = {
    recordId: 'shape', sourceId: 'cutter', targetId: 'shape', boundaryRole: 'subtract',
    sourceFeatureIndex: 0, kind: 'circle', index: 1, center: [0, 0], radius: 30,
  };
  const records = [{ id: 'shape', recordType: 'geometry', entity: { id: 'shape', type: 'circle' } }];
  const system = createStubSystem({
    records,
    selectedIds: new Set(['shape']),
    boundaryFeatures: [outer, cut],
    subtractFeatures: [outer, cut],
    eventFeature: outer,
    screenPoint: [100, 0],
  });
  system.extensionProvider.restore({
    version: 2,
    definitions: [{ regionId: 'shape', recordIds: ['shape'], defaultEnabled: true, overrides: [] }],
  });

  const target = {
    closest: (selector) => selector === '.closed-constrained-region' ? target : null,
  };
  assert.deepEqual(system.setPropertyFeatureFromEvent({ target, clientX: 100, clientY: 0 }), outer);
  assert.equal(system.setSelectedSeamLine(false), true);
  assert.deepEqual(system.extensionProvider.serialize(), {
    version: 2,
    definitions: [{
      regionId: 'shape',
      recordIds: ['shape'],
      defaultEnabled: false,
      overrides: [{ ...seamLineEdgeReference(cut), enabled: true }],
    }],
  });
});

test('disabling an explicit segment converts default-on intent to stable enabled-edge intent', () => {
  const first = { recordId: 'shape', sourceId: 'shape', kind: 'segment', index: 0, start: [0, 0], end: [100, 0] };
  const second = { recordId: 'shape', sourceId: 'shape', kind: 'segment', index: 1, start: [100, 0], end: [100, 80] };
  const records = [{ id: 'shape', recordType: 'geometry', entity: { id: 'shape', type: 'rect' } }];
  const system = createStubSystem({
    records,
    selectedIds: new Set(['shape']),
    boundaryFeatures: [first, second],
    eventFeature: first,
  });
  system.extensionProvider.restore({
    version: 2,
    definitions: [{ regionId: 'shape', recordIds: ['shape'], defaultEnabled: true, overrides: [] }],
  });

  const target = { closest: (selector) => selector === '.segment-select-line' ? target : null };
  assert.deepEqual(system.setPropertyFeatureFromEvent({ target }), first);
  assert.equal(system.setSelectedSeamLine(false), true);
  assert.deepEqual(system.extensionProvider.serialize(), {
    version: 2,
    definitions: [{
      regionId: 'shape',
      recordIds: ['shape'],
      defaultEnabled: false,
      overrides: [{ ...seamLineEdgeReference(second), enabled: true }],
    }],
  });
});

test('legacy derived Seam Line entities migrate to intent and never enter the loaded entity list', () => {
  const source = { recordId: 'shape', sourceId: 'shape', kind: 'segment', index: 0, start: [0, 0], end: [100, 0] };
  const system = createStubSystem({
    records: [],
    selectedIds: new Set(),
    boundaryFeatures: [],
  });
  const drawing = system.prepareDrawingLoad({
    entities: [
      {
        id: 'shape',
        type: 'rect',
        x: 0,
        y: 0,
        width: 100,
        height: 80,
        appearance: { displayFinishSize: true },
      },
      {
        id: 'legacy-seam',
        type: 'polyline',
        points: [[0, 12.7], [100, 12.7]],
        composite: { kind: 'finish-size-offset', sourceFeatures: [seamLineSourceReference(source)] },
      },
    ],
  });

  assert.deepEqual(drawing.entities.map(({ id }) => id), ['shape']);
  assert.equal(drawing.extensions.seamLines.version, 2);
  assert.equal(drawing.extensions.seamLines.definitions.length, 1);
});

test('stale legacy Seam Line geometry is discarded when its owner intent is off', () => {
  const source = { recordId: 'shape', sourceId: 'shape', targetId: 'shape', kind: 'arc', index: 0 };
  const system = createStubSystem({
    records: [],
    selectedIds: new Set(),
    boundaryFeatures: [],
  });
  const drawing = system.prepareDrawingLoad({
    entities: [
      { id: 'shape', type: 'circle', center: [0, 0], radius: 50 },
      {
        id: 'stale-seam',
        type: 'arc',
        composite: { kind: 'finish-size-offset', sourceFeatures: [source] },
      },
    ],
  });

  assert.deepEqual(drawing.entities.map(({ id }) => id), ['shape']);
  assert.equal(drawing.extensions?.seamLines, undefined);
});

test('Seam Line offsets stay outside a cutter assigned with subtractFrom', () => {
  const entities = materializeSeamLineEntitiesForDrawing({
    entities: [
      { id: 'target', type: 'rect', x: 0, y: 0, width: 20, height: 20 },
      {
        id: 'cutter',
        type: 'circle',
        center: [10, 10],
        radius: 4,
        subtract: false,
        subtractExpression: 'FALSE',
        subtractFrom: ['target'],
      },
    ],
    constraints: [],
    extensions: {
      seamLines: {
        version: 2,
        definitions: [{ regionId: 'target', recordIds: ['target'], defaultEnabled: true, overrides: [] }],
      },
    },
  }, { inset: 1 });
  const cutSeam = entities.find((entity) => (
    entity.type === 'circle'
    && entity.composite.sourceFeatures.some((feature) => feature.boundaryRole === 'subtract')
  ));

  assert.ok(cutSeam);
  assert.equal(cutSeam.radius, 5);
});

test('intersecting parent and cutter circles retain analytic Seam Line arcs at their trims', () => {
  const entities = materializeSeamLineEntitiesForDrawing({
    entities: [
      { id: 'target', type: 'circle', center: [0, 0], radius: 10 },
      {
        id: 'cutter',
        type: 'circle',
        center: [8, 0],
        radius: 6,
        subtract: false,
        subtractExpression: 'FALSE',
        subtractFrom: ['target'],
      },
    ],
    constraints: [],
    extensions: {
      seamLines: {
        version: 2,
        definitions: [{ regionId: 'target', recordIds: ['target'], defaultEnabled: true, overrides: [] }],
      },
    },
  }, { inset: 1 });
  const parentArc = entities.find((entity) => (
    entity.type === 'arc'
    && entity.composite.sourceFeatures.some((feature) => feature.boundaryRole === 'outer')
  ));
  const cutArc = entities.find((entity) => (
    entity.type === 'arc'
    && entity.composite.sourceFeatures.some((feature) => feature.boundaryRole === 'subtract')
  ));

  assert.ok(parentArc);
  assert.ok(cutArc);
  assert.equal(parentArc.radius, 9);
  assert.equal(cutArc.radius, 7);
  const trimDistances = [parentArc.start, parentArc.end].map((parentPoint) => (
    Math.min(
      Math.hypot(parentPoint[0] - cutArc.start[0], parentPoint[1] - cutArc.start[1]),
      Math.hypot(parentPoint[0] - cutArc.end[0], parentPoint[1] - cutArc.end[1]),
    )
  ));
  assert.ok(trimDistances.every((value) => value < 1e-8));
});

test('spline Seam Lines use exact endpoint tangents when trimming to a line', () => {
  const curve = {
    recordId: 'curve',
    sourceId: 'curve',
    kind: 'curve',
    index: 0,
    points: [[0, 0], [30, -50], [70, -50], [100, 0]],
  };
  const line = {
    recordId: 'line',
    sourceId: 'line',
    kind: 'segment',
    index: 0,
    start: [100, 0],
    end: [0, 0],
  };
  const [seam] = createSeamLineEntities(
    [curve, line],
    () => [50, -25],
    1,
    () => [curve, line],
    [curve, line],
  );
  const lineTrimPoints = seam.points.filter((point) => Math.abs(point[1] + 1) < 1e-9);
  const tangent = [30 / Math.hypot(30, 50), 50 / Math.hypot(30, 50)];
  const curveEndOffset = [100 - tangent[1], tangent[0]];
  const ratio = (-1 - curveEndOffset[1]) / tangent[1];
  const expectedRightTrim = curveEndOffset[0] + tangent[0] * ratio;

  assert.ok(lineTrimPoints.length >= 2);
  assert.ok(Math.abs(Math.max(...lineTrimPoints.map(([x]) => x)) - expectedRightTrim) < 1e-9);
});

test('Boolean spline fragments form one smooth offset run before line and arc trims', () => {
  const curveSegments = [
    { start: [0, 0], end: [25, -30], parameterStart: 0, parameterEnd: 0.25 },
    { start: [25, -30], end: [75, -30], parameterStart: 0.25, parameterEnd: 0.75 },
    { start: [75, -30], end: [100, 0], parameterStart: 0.75, parameterEnd: 1 },
  ].map((feature, index) => ({
    recordId: 'target',
    targetId: 'target',
    sourceId: 'spline',
    sourceFeatureIndex: 0,
    sourceBoundaryKind: 'curve',
    boundaryRole: 'outer',
    kind: 'segment',
    index,
    stableKey: `spline-piece-${index}`,
    ...feature,
  }));
  const line = {
    recordId: 'target', targetId: 'target', sourceId: 'line', sourceFeatureIndex: 0,
    boundaryRole: 'outer', kind: 'segment', index: 3, stableKey: 'line-piece',
    start: [100, 0], end: [0, 0],
  };
  const entities = createSeamLineEntities(
    [...curveSegments, line],
    () => [50, -15],
    1,
    () => [...curveSegments, line],
    [...curveSegments, line],
  );

  assert.equal(entities.length, 1);
  assert.equal(entities[0].type, 'polyline');
  assert.equal(entities[0].points.length, 5);
});

test('spline trimming uses the actual offset crossing and discards the overshooting tail', () => {
  const points = [[0, 0], [4, 0], [8, 4], [12, 7]];
  const trim = seamLineSplineLineTrim(points, [0, 1], [1, 0], points.at(-1));

  assert.ok(trim);
  assert.equal(trim.segmentIndex, 1);
  assert.deepEqual(trim.point, [5, 1]);
});

test('Seam Line presentation mounts inside its owner group before hit targets', () => {
  const fake = installFakeSvgDocument();
  try {
    const objectLayer = fake.node('g');
    const ownerGroup = fake.node('g');
    const foregroundGroup = fake.node('g');
    const ownerPath = fake.node('path');
    const hitTarget = fake.node('circle');
    ownerGroup.appendChild(ownerPath);
    ownerGroup.appendChild(hitTarget);
    objectLayer.appendChild(ownerGroup);
    objectLayer.appendChild(foregroundGroup);
    const records = [{ id: 'shape', recordType: 'geometry', entity: { id: 'shape', type: 'rect' } }];
    const system = createStubSystem({
      records,
      selectedIds: new Set(['shape']),
      boundaryFeatures: [{ recordId: 'shape', sourceId: 'shape', kind: 'segment', index: 0, start: [0, 0], end: [100, 0] }],
      getDrawingSnapshot: () => ({
        entities: [{ id: 'shape', type: 'rect', x: 0, y: 0, width: 100, height: 80 }],
        constraints: [],
      }),
      resolvePresentationHost: (ownerRecordId) => ownerRecordId === 'shape'
        ? { container: ownerGroup, before: hitTarget }
        : null,
    });

    system.extensionProvider.restore({
      version: 2,
      definitions: [{ regionId: 'shape', recordIds: ['shape'], defaultEnabled: true, overrides: [] }],
    });

    assert.equal(system.refresh().length, 1);
    assert.equal(ownerGroup.children.length, 3);
    assert.equal(ownerGroup.children[0], ownerPath);
    assert.equal(ownerGroup.children[2], hitTarget);
    const root = ownerGroup.children[1];
    assert.equal(root.attributes.get('class'), 'seam-line-presentation-layer');
    assert.equal(root.dataset.ownerRecordId, 'shape');
    assert.deepEqual(objectLayer.children, [ownerGroup, foregroundGroup]);
    assert.equal(system.presentationNodesForSourceIds(['shape']).length, 1);

    system.extensionProvider.clear();
    assert.deepEqual(ownerGroup.children, [ownerPath, hitTarget]);
  } finally {
    fake.restore();
  }
});
