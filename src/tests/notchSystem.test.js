import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createNotchEntity,
  createNotchLocationMemory,
  createNotchSystem,
  notchDependsOnRecordIds,
  prepareNotchDerivativePresentationClone,
  prepareNotchValueOnlyPresentationClone,
} from '../../packages/paramagic-core/src/modules/NotchSystem.js';

const node = () => ({
  style: {},
  classList: { toggle() {} },
  setAttribute() {},
});

test('notch presentation refreshes only for its own dependency records', () => {
  const notch = {
    id: 'notch-a',
    host: { recordId: 'host-edge', sourceId: 'source-edge', targetId: 'subtract-target' },
  };
  assert.equal(notchDependsOnRecordIds(notch, new Set(['host-edge'])), true);
  assert.equal(notchDependsOnRecordIds(notch, new Set(['source-edge'])), true);
  assert.equal(notchDependsOnRecordIds(notch, new Set(['unrelated-edge'])), false);
});

test('Value Only Notch presentation keeps the physical notch and removes editing markers', () => {
  const attributes = new Map();
  const line = { setAttribute: (name, value) => attributes.set(name, value) };
  let dotRemoved = false;
  let hitRemoved = false;
  const clone = {
    querySelectorAll(selector) {
      if (selector === '.notch-dot, .notch-hit') {
        return [
          { remove: () => { dotRemoved = true; } },
          { remove: () => { hitRemoved = true; } },
        ];
      }
      if (selector === '.notch-line') return [line];
      return [];
    },
  };

  assert.equal(prepareNotchValueOnlyPresentationClone(clone), clone);
  assert.equal(dotRemoved, true);
  assert.equal(hitRemoved, true);
  assert.equal(attributes.get('stroke'), '#000000');
  assert.equal(attributes.get('stroke-width'), '1.5');
  assert.equal(attributes.get('vector-effect'), 'non-scaling-stroke');
});

test('derived Notch presentation removes the non-editable orange position handle', () => {
  let dotRemoved = false;
  let hitRemoved = false;
  const clone = {
    querySelectorAll(selector) {
      if (selector !== '.notch-dot, .notch-hit') return [];
      return [
        { remove: () => { dotRemoved = true; } },
        { remove: () => { hitRemoved = true; } },
      ];
    },
  };

  assert.equal(prepareNotchDerivativePresentationClone(clone), clone);
  assert.equal(dotRemoved, true);
  assert.equal(hitRemoved, true);
});

function createSystem(features, records = []) {
  const featureForHost = (host) => features.find((feature) => (
    feature.recordId === host?.recordId
      && feature.kind === host?.kind
      && feature.index === host?.index
  )) || null;
  return createNotchSystem({
    records,
    addSvg: () => node(),
    objectLayer: node(),
    bindRecordEvents() {},
    updateRecordHandles() {},
    featureForHost,
    inwardTargetForHost: (host, point) => host.index === 0
      ? [point[0], point[1] + 10]
      : [point[0] - 10, point[1]],
    boundaryFeaturesForHost: () => features,
    isClosedHostFeature: () => true,
    requestHistoryCheckpoint() {},
    notifyObjectChange() {},
    syncState() {},
    showStatusMessage() {},
    solver: {},
    getPointFeature: () => null,
    getSegmentFeature: () => null,
    refreshLinkedDimensions() {},
    reapplySolverSnapshot() {},
  });
}

test('a Notch follows the dragged point onto another edge of its host', () => {
  const first = {
    recordId: 'shape', kind: 'segment', index: 0, start: [0, 0], end: [10, 0],
  };
  const second = {
    recordId: 'shape', kind: 'segment', index: 1, start: [10, 0], end: [10, 10],
  };
  const record = {
    id: 'notch', recordType: 'notch',
    entity: {
      id: 'notch', type: 'notch', host: { recordId: 'shape', kind: 'segment', index: 0 },
      parameter: 0.5, locationMemory: createNotchLocationMemory(first, 0.5), point: [5, 0],
    },
    group: { style: {} }, line: node(), hitNode: node(), dot: node(), handles: [],
  };
  const system = createSystem([first, second], [record]);

  assert.equal(system.moveRecord(record, [10, 5]), true);
  assert.equal(record.entity.host.index, 1);
  assert.deepEqual(record.entity.point, [10, 5]);
});

test('a Notch location rule follows an edge when the edge changes length', () => {
  const first = {
    recordId: 'shape', kind: 'segment', index: 0, start: [0, 0], end: [10, 0],
  };
  const second = {
    recordId: 'shape', kind: 'segment', index: 1, start: [10, 0], end: [10, 10],
  };
  const record = {
    id: 'notch', recordType: 'notch',
    entity: {
      id: 'notch', type: 'notch', host: { recordId: 'shape', kind: 'segment', index: 0 },
      parameter: 0.75, locationMemory: createNotchLocationMemory(first, 0.75), point: [7.5, 0],
    },
    group: { style: {} }, line: node(), hitNode: node(), dot: node(), handles: [],
  };
  const system = createSystem([first, second], [record]);

  first.end = [20, 0];
  second.start = [20, 0];
  system.refresh();

  assert.equal(record.entity.host.index, 0);
  assert.deepEqual(record.entity.point, [12.5, 0]);
});

test('a resolved-region line preserves anchor distance and uses percentage only when shortened past it', () => {
  const feature = {
    recordId: 'line',
    sourceId: 'line',
    targetId: 'region',
    stableKey: 'resolved:region:line:segment:0',
    boundaryRole: 'outer',
    kind: 'segment',
    index: 0,
    parameterStart: 0,
    parameterEnd: 1,
    start: [0, 0],
    end: [100, 0],
    pickedPoint: [40, 0],
  };
  const system = createSystem([feature]);
  const created = system.addNotch(feature, feature.pickedPoint);

  assert.equal(created.host.sourceParameter, 0.4);
  assert.equal(created.locationMemory.anchor, 'midpoint');
  assert.ok(Math.abs(created.locationMemory.signedDistance + 10) < 1e-9);

  feature.end = [200, 0];
  system.refresh();
  assert.deepEqual(created.point, [90, 0]);

  feature.end = [10, 0];
  system.refresh();
  assert.deepEqual(created.point, [4, 0]);
});

test('a circle Notch maintains physical distance from its nearest quadrant as radius changes', () => {
  const circle = { recordId: 'circle', kind: 'circle', index: 0, center: [0, 0], radius: 10 };
  const entity = createNotchEntity(
    circle,
    [Math.cos(Math.PI * 0.4) * 10, Math.sin(Math.PI * 0.4) * 10],
    circle.center,
    'circle-notch',
  );
  const record = {
    id: entity.id, recordType: 'notch', entity,
    group: { style: {} }, line: node(), hitNode: node(), dot: node(), handles: [],
  };
  const system = createSystem([circle], [record]);

  circle.radius = 20;
  system.refresh();

  const expectedAngle = Math.PI * 0.45;
  assert.equal(record.entity.locationMemory.quadrant, 1);
  assert.ok(Math.abs(record.entity.point[0] - Math.cos(expectedAngle) * 20) < 1e-9);
  assert.ok(Math.abs(record.entity.point[1] - Math.sin(expectedAngle) * 20) < 1e-9);
});

test('a circle Notch constraint overwrites its quadrant rule and legacy memory migrates', () => {
  const circle = { recordId: 'circle', kind: 'circle', index: 0, center: [0, 0], radius: 10 };
  const entity = createNotchEntity(circle, [10, 0], circle.center, 'circle-notch');
  entity.parameter = Math.PI * 0.4;
  entity.locationMemory = { anchor: 'start', signedDistance: 4 * Math.PI, signedRatio: 0.2 };
  const record = {
    id: entity.id, recordType: 'notch', entity,
    group: { style: {} }, line: node(), hitNode: node(), dot: node(), handles: [],
  };
  const system = createSystem([circle], [record]);

  system.refresh();
  assert.equal(record.entity.locationMemory.anchor, 'quadrant');
  assert.equal(record.entity.locationMemory.quadrant, 1);

  const constrained = system.setDistance(entity.id, { kind: 'point', point: [0, 50] }, 'aligned', 40);
  assert.equal(constrained.valid, true);
  assert.ok(Math.abs(record.entity.point[0]) < 0.01);
  assert.ok(Math.abs(record.entity.point[1] - 10) < 0.01);
  assert.equal(record.entity.locationMemory.quadrant, 1);
  assert.ok(Math.abs(record.entity.locationMemory.signedDistance) < 0.01);
});

test('Notch creation uses the projected point supplied by the edge resolver', () => {
  const feature = {
    recordId: 'shape', kind: 'segment', index: 0, start: [0, 0], end: [10, 0], pickedPoint: [3, 0],
  };
  const system = createSystem([feature]);

  const created = system.addNotch(feature, [9, 0]);
  assert.deepEqual(created.point, [3, 0]);
  assert.equal(created.notchType, 'v-notch');
});

test('Notch creation stores the selected drawing notch type', () => {
  const feature = {
    recordId: 'shape', kind: 'segment', index: 0, start: [0, 0], end: [10, 0], pickedPoint: [3, 0],
  };
  const system = createSystem([feature]);

  assert.equal(system.addNotch(feature, [3, 0], 'straight-slit').notchType, 'straight-slit');
  assert.equal(system.addNotch(feature, [3, 0], 'u-notch').notchType, 'u-notch');
});

test('Notch hosts preserve derived boundary ownership metadata', () => {
  const feature = {
    recordId: 'target',
    targetId: 'target',
    sourceId: 'cutter',
    sourceFeatureIndex: 2,
    boundaryRole: 'subtract',
    stableKey: 'target:cutter:subtract:2:0:1',
    kind: 'segment',
    index: 0,
    start: [0, 0],
    end: [10, 0],
    pickedPoint: [5, 0],
  };
  const system = createSystem([feature]);
  const created = system.addNotch(feature, [5, 0]);
  assert.equal(created.host.sourceId, 'cutter');
  assert.equal(created.host.targetId, 'target');
  assert.equal(created.host.boundaryRole, 'subtract');
  assert.equal(created.host.stableKey, feature.stableKey);
});

test('derived-edge ownership metadata does not override Notch anchor distance', () => {
  const feature = {
    recordId: 'target',
    targetId: 'target',
    sourceId: 'cutter',
    sourceFeatureIndex: 1,
    boundaryRole: 'subtract',
    stableKey: 'target:cutter:subtract:1:0:1',
    kind: 'segment',
    index: 0,
    parameterStart: 0,
    parameterEnd: 1,
    start: [0, 0],
    end: [10, 0],
    pickedPoint: [4, 0],
  };
  const system = createSystem([feature]);
  const created = system.addNotch(feature, [4, 0]);
  assert.equal(created.host.sourceParameter, 0.4);

  feature.end = [20, 0];
  system.refresh();

  assert.deepEqual(created.point, [9, 0]);
  assert.equal(created.host.sourceParameter, 0.4);
});
