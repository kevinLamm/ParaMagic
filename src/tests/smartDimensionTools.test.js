import test from 'node:test';
import assert from 'node:assert/strict';
import {
  bindDimensionRecordInteractions,
  candidateFromSelections,
  commitSmartDimensionCandidate,
  DIMENSION_EDIT_INPUT_MAXIMUM_HEIGHT,
  DIMENSION_EDIT_INPUT_MINIMUM_HEIGHT,
  dimensionAnchorRecordIds,
  dimensionEditInputHeight,
  dimensionEditKeyAction,
  dimensionEditPanelMarkup,
  dimensionTextHitBounds,
  radialCandidateUsesPlacementClick,
  setDimensionSelectionActive,
} from '../../packages/paramagic-core/src/modules/DimensionSystem.js';
import { createSolverController } from '../../packages/paramagic-core/src/modules/solver/SolverController.js';
import { DEFAULT_SOLVE_TOLERANCE } from '../../packages/paramagic-core/src/modules/solver/NumericSolverCore.js';
import { canvasOriginPointFeature } from '../../packages/paramagic-core/src/modules/CanvasOrigin.js';
import { GLOBAL_LAYER_ID } from '../../packages/paramagic-core/src/modules/StackCoordinates.js';

const normalLengthTolerance = (value) => DEFAULT_SOLVE_TOLERANCE * Math.max(1, Math.abs(value));

test('Driving Dimension editing uses the shared multiline expression box lookup', () => {
  const markup = dimensionEditPanelMarkup();

  assert.match(markup, /<textarea[^>]*class="dimension-edit-input"[^>]*rows="2"[^>]*wrap="soft"/);
  assert.match(markup, /data-expression-lookup-list[^>]*role="listbox"/);
  assert.doesNotMatch(markup, /data-expression-lookup-toggle/);
  assert.doesNotMatch(markup, /<input[^>]*class="dimension-edit-input"/);
  assert.doesNotMatch(markup, /<textarea[^>]*list=/);
  assert.equal(DIMENSION_EDIT_INPUT_MINIMUM_HEIGHT, 54);
  assert.equal(DIMENSION_EDIT_INPUT_MAXIMUM_HEIGHT, 180);
  assert.equal(dimensionEditInputHeight(32), 54);
  assert.equal(dimensionEditInputHeight(96), 96);
  assert.equal(dimensionEditInputHeight(240), 180);
});

test('Driving Dimension multiline editing preserves apply, line-break, and cancel keys', () => {
  assert.equal(dimensionEditKeyAction({ key: 'Enter' }), 'submit');
  assert.equal(dimensionEditKeyAction({ key: 'Enter', shiftKey: true }), null);
  assert.equal(dimensionEditKeyAction({ key: 'Escape' }), 'cancel');
  assert.equal(dimensionEditKeyAction({ key: 'a' }), null);
});

function dimensionInteractionGroup() {
  const listeners = new Map();
  return {
    addEventListener(name, listener) {
      if (!listeners.has(name)) listeners.set(name, []);
      listeners.get(name).push(listener);
    },
    removeEventListener(name, listener) {
      listeners.set(name, (listeners.get(name) || []).filter((entry) => entry !== listener));
    },
    dispatch(name, overrides = {}) {
      const interaction = overrides.interaction || 'text';
      const event = {
        button: 0,
        detail: 1,
        timeStamp: 100,
        clientX: 40,
        clientY: 50,
        defaultPrevented: false,
        propagationStopped: false,
        immediatePropagationStopped: false,
        preventDefault() { this.defaultPrevented = true; },
        stopPropagation() { this.propagationStopped = true; },
        stopImmediatePropagation() {
          this.immediatePropagationStopped = true;
          this.propagationStopped = true;
        },
        target: {
          closest(selector) {
            if (interaction === 'text' && selector.includes('.dimension-text')) return this;
            if (interaction === 'path' && selector === '.dimension-path') return this;
            return null;
          },
        },
        ...overrides,
      };
      for (const listener of listeners.get(name) || []) listener(event);
      return event;
    },
  };
}

test('Driving Dimension text opens on the second press without starting another drag', () => {
  const group = dimensionInteractionGroup();
  const record = {
    group,
    entity: { type: 'dimension-line', dimensionMode: 'driving', dimensionId: 'length' },
  };
  let dragCount = 0;
  let editCount = 0;
  bindDimensionRecordInteractions(record, {
    beginLineDrag: () => { dragCount += 1; },
    editText: () => { editCount += 1; },
  });

  group.dispatch('pointerdown', { timeStamp: 100, clientX: 40, clientY: 50 });
  const secondPress = group.dispatch('pointerdown', {
    timeStamp: 220,
    clientX: 43,
    clientY: 53,
    detail: 2,
  });
  group.dispatch('dblclick', { timeStamp: 230, detail: 2, clientX: 43, clientY: 53 });

  assert.equal(dragCount, 1);
  assert.equal(editCount, 1);
  assert.equal(secondPress.defaultPrevented, true);
  assert.equal(secondPress.immediatePropagationStopped, true);
});

test('Dimension text hit bounds provide a screen-sized hover area at every zoom', () => {
  for (const scale of [0.5, 1, 2]) {
    const bounds = dimensionTextHitBounds({ x: 20, y: 30, width: 18, height: 14 }, scale);
    assert.ok(bounds.width * scale >= 32);
    assert.ok(bounds.height * scale >= 36);
    assert.equal(bounds.x + bounds.width / 2, 29);
    assert.equal(bounds.y + bounds.height / 2, 37);
  }
});

function semanticVariableKeys(controller, variableIds) {
  return variableIds.map((id) => {
    const variable = controller.model.variableById(id);
    return `${variable.ownerId}:${variable.parameterKey}`;
  });
}

const filletFeature = {
  kind: 'arc',
  recordId: 'fillet-a',
  entityType: 'fillet',
  center: [10, 10],
  radius: 5,
  start: [5, 10],
  arcPoint: [6.46, 6.46],
  end: [10, 5],
  derivedFromFillet: true,
};

test('Smart Dimension selection toggles existing dimension hit-testing on the canvas', () => {
  const classes = new Set();
  const canvas = {
    getCanvasElement: () => ({
      classList: {
        toggle(name, active) {
          if (active) classes.add(name);
          else classes.delete(name);
        },
      },
    }),
  };

  setDimensionSelectionActive(canvas, true);
  assert.equal(classes.has('dimension-selection-active'), true);

  setDimensionSelectionActive(canvas, false);
  assert.equal(classes.has('dimension-selection-active'), false);
});

test('circle Smart Dimensions measure diameter while arc dimensions continue to measure radius', () => {
  const circle = candidateFromSelections([{
    kind: 'circle',
    recordId: 'circle-a',
    center: [0, 0],
    radius: 12,
  }], [30, -20], 'driven', false, 'mm');
  const arc = candidateFromSelections([{
    kind: 'arc',
    recordId: 'arc-a',
    center: [0, 0],
    radius: 12,
    start: [12, 0],
    arcPoint: [0, -12],
    end: [-12, 0],
  }], [30, -20], 'driven', false, 'mm');

  assert.equal(circle.type, 'radius-dimension');
  assert.equal(circle.subtype, 'diameter');
  assert.equal(circle.measuredValue, 24);
  assert.match(circle.text, /^24/);
  assert.ok(Math.abs(circle.offsetDirection[0] - 30 / Math.sqrt(1300)) < 1e-9);
  assert.ok(Math.abs(circle.offsetDirection[1] + 20 / Math.sqrt(1300)) < 1e-9);
  assert.ok(Math.abs(circle.offsetDistance - (Math.sqrt(1300) - 12)) < 1e-9);
  assert.equal(arc.subtype, 'radius');
  assert.equal(arc.measuredValue, 12);
});

test('Smart Dimensions retain the built-in origin as a point anchor', () => {
  const origin = canvasOriginPointFeature();
  const point = {
    kind: 'point',
    recordId: 'line-a',
    entityType: 'line',
    index: 2,
    point: [12, 7],
  };
  const candidate = candidateFromSelections([origin, point], [8, -10], 'driving');

  assert.equal(candidate.type, 'dimension-line');
  assert.equal(candidate.anchors.measureStart.referenceRole, 'canvas-origin');
  assert.equal(Object.hasOwn(candidate.anchors.measureStart, 'recordId'), false);
  assert.deepEqual(candidate.anchors.measureEnd, { type: 'point', recordId: 'line-a', index: 2 });
  assert.deepEqual([...dimensionAnchorRecordIds(candidate)], ['line-a']);
});

test('the origin belongs to the global coordinate system when no Stack is active', () => {
  const globalOrigin = canvasOriginPointFeature(null, {
    activeStackId: null,
    stacks: [{ id: 'stack-a', frame: { x: 25, y: 10, rotation: 0 } }],
  });
  const stackOrigin = canvasOriginPointFeature(null, {
    activeStackId: 'stack-a',
    stacks: [{ id: 'stack-a', frame: { x: 25, y: 10, rotation: 0 } }],
  });

  assert.equal(globalOrigin.stackId, GLOBAL_LAYER_ID);
  assert.deepEqual(globalOrigin.point, [0, 0]);
  assert.equal(stackOrigin.stackId, 'stack-a');
  assert.deepEqual(stackOrigin.point, [25, 10]);
});

test('committing a Smart Dimension preserves its selected highlight through the placement click', () => {
  const calls = [];
  const canvas = {
    addDimension(entity) { calls.push(['add', entity]); },
    getActiveStackId() { return null; },
    suppressNextCanvasSelectionClear() { calls.push(['suppress']); },
  };
  const candidate = { type: 'dimension-line', dimensionMode: 'driven' };

  assert.equal(commitSmartDimensionCandidate(canvas, candidate, { preserveSelectionThroughClick: true }), true);
  assert.deepEqual(calls, [
    ['add', { ...candidate, solveDomain: 'stack-frame' }],
    ['suppress'],
  ]);
});

test('a radial candidate treats its next geometry hit as placement instead of another selection', () => {
  const diameter = candidateFromSelections([{
    kind: 'circle',
    recordId: 'circle-a',
    center: [0, 0],
    radius: 12,
  }], [30, -20], 'driving', false, 'mm');

  assert.equal(radialCandidateUsesPlacementClick(diameter, 'driving'), true);
  assert.equal(radialCandidateUsesPlacementClick(diameter, 'driven'), true);
  assert.equal(radialCandidateUsesPlacementClick(diameter, 'driven', { ctrlKey: true }), false);
  assert.equal(radialCandidateUsesPlacementClick({ type: 'dimension-line' }, 'driving'), false);
});

test('a fillet uses a normal solver-driven Smart Driving radius dimension', () => {
  const dimension = candidateFromSelections([filletFeature], [20, 20], 'driving');

  assert.equal(dimension.type, 'radius-dimension');
  assert.equal(dimension.dimensionMode, 'driving');
  assert.equal(dimension.externalDrivingTarget, undefined);
  assert.deepEqual(dimension.anchors.radius, { type: 'radius', recordId: 'fillet-a' });
});

test('a driven fillet radius remains a measurement without a driving target', () => {
  const dimension = candidateFromSelections([filletFeature], [20, 20], 'driven');

  assert.equal(dimension.dimensionMode, 'driven');
  assert.equal(dimension.externalDrivingTarget, undefined);
});

test('a notch point creates an external Smart Driving dimension that retains both anchors', () => {
  const notch = { kind: 'point', recordId: 'notch-a', entityType: 'notch', index: 0, point: [25, 0] };
  const reference = { kind: 'point', recordId: 'line-a', entityType: 'line', index: 0, point: [0, 0] };
  const candidate = candidateFromSelections([notch, reference], [12, -20], 'driving');

  assert.equal(candidate.dimensionMode, 'driving');
  assert.deepEqual(candidate.externalDrivingTarget, {
    type: 'notch-distance',
    recordId: 'notch-a',
    otherAnchor: { type: 'point', recordId: 'line-a', index: 0 },
  });
  assert.deepEqual(candidate.anchors.measureStart, { type: 'point', recordId: 'notch-a', index: 0 });
  assert.deepEqual(candidate.anchors.measureEnd, { type: 'point', recordId: 'line-a', index: 0 });

  const controller = createSolverController();
  const result = controller.addDimension(candidate);
  assert.equal(result.entity.dimensionMode, 'driving');
  assert.equal(result.result.status, 'unchanged');
});

test('a Swell-derived point can be the fixed reference for a Notch Smart Driving dimension', () => {
  const notch = { kind: 'point', recordId: 'notch-a', entityType: 'notch', index: 0, point: [25, 0] };
  const reference = {
    kind: 'point',
    recordId: 'swell-piece-a',
    entityType: 'line',
    index: 2,
    point: [0, 0],
    swellDerived: true,
    swellSourceId: 'line-a',
    dimensionReference: {
      recordId: 'line-a',
      derivedFeature: { provider: 'swell', segmentIndex: 0, role: 'swell', ordinal: 1 },
    },
  };
  const candidate = candidateFromSelections([notch, reference], [12, -20], 'driving');

  assert.deepEqual(candidate.externalDrivingTarget, {
    type: 'notch-distance',
    recordId: 'notch-a',
    otherAnchor: {
      type: 'point',
      recordId: 'line-a',
      derivedFeature: { provider: 'swell', segmentIndex: 0, role: 'swell', ordinal: 1 },
      index: 2,
    },
  });
  assert.deepEqual(candidate.anchors.measureEnd, {
    type: 'point',
    recordId: 'line-a',
    derivedFeature: { provider: 'swell', segmentIndex: 0, role: 'swell', ordinal: 1 },
    index: 2,
  });
});

test('a notch point to segment creates an external Smart Driving dimension', () => {
  const notch = { kind: 'point', recordId: 'notch-a', entityType: 'notch', index: 0, point: [25, 20] };
  const segment = { kind: 'segment', recordId: 'line-a', entityType: 'line', index: 0, start: [0, 0], end: [100, 0] };
  const candidate = candidateFromSelections([notch, segment], [40, 30], 'driving');

  assert.equal(candidate.dimensionMode, 'driving');
  assert.deepEqual(candidate.externalDrivingTarget, {
    type: 'notch-distance',
    recordId: 'notch-a',
    otherSegment: { kind: 'segment', recordId: 'line-a', index: 0 },
  });
  assert.deepEqual(candidate.anchors.pointToSegment, {
    point: { type: 'point', recordId: 'notch-a', index: 0 },
    segment: { kind: 'segment', recordId: 'line-a', index: 0 },
  });

  const controller = createSolverController();
  const result = controller.addDimension(candidate);
  assert.equal(result.entity.dimensionMode, 'driving');
  assert.equal(result.result.status, 'unchanged');
});

test('a segment to notch point creates the same external Smart Driving dimension', () => {
  const segment = { kind: 'segment', recordId: 'line-a', entityType: 'line', index: 0, start: [0, 0], end: [100, 0] };
  const notch = { kind: 'point', recordId: 'notch-a', entityType: 'notch', index: 0, point: [25, 20] };
  const candidate = candidateFromSelections([segment, notch], [40, 30], 'driving');

  assert.deepEqual(candidate.externalDrivingTarget, {
    type: 'notch-distance',
    recordId: 'notch-a',
    otherSegment: { kind: 'segment', recordId: 'line-a', index: 0 },
  });
  assert.deepEqual(candidate.anchors.pointToSegment.point, {
    type: 'point',
    recordId: 'notch-a',
    index: 0,
  });
});

test('a text point to segment dimension stays driving and retains live anchors', () => {
  const textPoint = { kind: 'point', recordId: 'text-a', entityType: 'text', index: 0, point: [0, 20] };
  const segment = { kind: 'segment', recordId: 'line-a', entityType: 'line', index: 0, start: [0, 0], end: [100, 0] };
  const candidate = candidateFromSelections([textPoint, segment], [40, 30], 'driving');

  assert.equal(candidate.dimensionMode, 'driving');
  assert.deepEqual(candidate.anchors.pointToSegment, {
    point: { type: 'point', recordId: 'text-a', index: 0 },
    segment: { kind: 'segment', recordId: 'line-a', index: 0 },
  });

  const controller = createSolverController();
  controller.addEntity({ id: 'text-a', type: 'text', x: 0, y: 20, text: 'Label', fontName: 'Arial', fontSize: 28 });
  controller.addEntity({ id: 'line-a', type: 'line', start: [0, 0], end: [100, 0] });
  const result = controller.addDimension(candidate);

  assert.equal(result.entity.dimensionMode, 'driving');
  assert.equal(result.result.status, 'converged');
  assert.equal(controller.constraints().some(({ type }) => type === 'Point Line Distance'), true);
});

test('a derived point automatically creates one horizontal linked-position driving dimension', () => {
  const derived = {
    kind: 'point', recordId: 'duplicate-derived:copy-a:line-a', entityType: 'line', index: 0,
    point: [80, 30], linkedCopyId: 'copy-a', linkedCopyType: 'duplicate', linkedSourceId: 'line-a',
    dimensionReference: {
      recordId: 'line-a',
      derivedFeature: { provider: 'linked-copy', copyId: 'copy-a', sourceId: 'line-a' },
    },
  };
  const reference = { kind: 'point', recordId: 'line-b', entityType: 'line', index: 1, point: [20, 10] };
  const candidate = candidateFromSelections([derived, reference], [50, 80], 'driving', false, 'mm');

  assert.equal(candidate.subtype, 'horizontal');
  assert.equal(candidate.dimensionMode, 'driving');
  assert.deepEqual(candidate.externalDrivingTarget, {
    type: 'linked-position',
    recordId: 'line-a',
    derivedFeature: { provider: 'linked-copy', copyId: 'copy-a', sourceId: 'line-a' },
    copyId: 'copy-a',
    sourceId: 'line-a',
    pointIndex: 0,
    otherAnchor: { type: 'point', recordId: 'line-b', index: 1 },
    axis: 'horizontal',
    axisSign: 1,
    perpendicularOffset: 20,
  });
  const controller = createSolverController();
  const result = controller.addDimension(candidate);
  assert.equal(result.entity.dimensionMode, 'driving');
  assert.equal(result.result.status, 'unchanged');
});

test('linked-position routing forces a deterministic axis and blocks unsupported or repeated relationships', () => {
  const derived = {
    kind: 'point', recordId: 'duplicate-derived:copy-a:line-a', entityType: 'line', index: 0,
    point: [25, 80], linkedCopyId: 'copy-a', linkedCopyType: 'duplicate', linkedSourceId: 'line-a',
  };
  const reference = { kind: 'point', recordId: 'line-b', entityType: 'line', index: 0, point: [20, 10] };
  assert.equal(candidateFromSelections([derived, reference], [22, 45], 'driving').subtype, 'vertical');
  assert.equal(candidateFromSelections([{ ...derived, linkedPositionBlocked: true }, reference], [22, 45], 'driving'), null);
  assert.equal(candidateFromSelections([derived, { ...derived, linkedCopyId: 'copy-b' }], [22, 45], 'driving'), null);
  assert.equal(candidateFromSelections([derived, { kind: 'segment', recordId: 'line-b', entityType: 'line', index: 0, start: [0, 0], end: [10, 0] }], [22, 45], 'driving'), null);
  assert.equal(candidateFromSelections([derived, canvasOriginPointFeature()], [22, 45], 'driving'), null);
});

test('parallel edge dimensions use a cursor-independent distance at the closest stored endpoint', () => {
  const first = { kind: 'segment', recordId: 'line-a', entityType: 'line', index: 0, start: [0, 0], end: [100, 0] };
  const second = { kind: 'segment', recordId: 'line-b', entityType: 'line', index: 0, start: [40, 25], end: [80, 25] };
  const candidate = candidateFromSelections([first, second], [42, 50], 'driven');
  const differentlyPlaced = candidateFromSelections([first, second], [140, 12], 'driven');

  assert.equal(candidate.measurementKind, 'parallel-edge-distance');
  assert.equal(candidate.subtype, 'aligned');
  assert.equal(differentlyPlaced.subtype, 'aligned');
  assert.deepEqual(candidate.measureStart, [40, 0]);
  assert.deepEqual(candidate.measureEnd, [40, 25]);
  assert.deepEqual(differentlyPlaced.measureStart, [80, 0]);
  assert.deepEqual(differentlyPlaced.measureEnd, [80, 25]);
  assert.equal(candidate.measuredValue, 25);
  assert.equal(differentlyPlaced.measuredValue, 25);
  assert.deepEqual(candidate.anchors.lineToLine, {
    reference: { kind: 'segment', recordId: 'line-a', index: 0 },
    measured: { kind: 'segment', recordId: 'line-b', index: 0 },
    referenceEndpoint: 'start',
    measuredEndpoint: 'start',
  });
  assert.equal(differentlyPlaced.anchors.lineToLine.referenceEndpoint, 'end');
  assert.equal(differentlyPlaced.anchors.lineToLine.measuredEndpoint, 'end');
  assert.equal(candidate.anchors.measureStart, undefined);
});

test('parallel oblique edges measure their normal delta and nonparallel edges create an angle', () => {
  const first = { kind: 'segment', recordId: 'line-a', entityType: 'line', index: 0, start: [0, 0], end: [100, 100] };
  const parallel = { kind: 'segment', recordId: 'line-b', entityType: 'line', index: 0, start: [-10, 10], end: [90, 110] };
  const nonparallel = { ...parallel, end: [90, 95] };

  const distance = candidateFromSelections([first, parallel], [-5, 5], 'driving');
  const angle = candidateFromSelections([first, nonparallel], [40, 60], 'driving');

  assert.equal(distance.type, 'dimension-line');
  assert.equal(distance.subtype, 'aligned');
  assert.deepEqual(distance.measureStart, [0, 0]);
  assert.deepEqual(distance.measureEnd, [-10, 10]);
  assert.ok(Math.abs(distance.measuredValue - Math.sqrt(200)) < 1e-9);
  assert.equal(angle.type, 'angle-dimension');
});

test('a driving parallel-edge dimension persists one line-to-line constraint without a separate Parallel constraint', () => {
  const controller = createSolverController();
  const first = controller.addEntity({ id: 'line-a', type: 'line', start: [0, 0], end: [100, 0] });
  const second = controller.addEntity({ id: 'line-b', type: 'line', start: [40, 25], end: [80, 25] });
  assert.ok(controller.addConstraint({
    type: 'Fixed',
    featureRefs: [{ kind: 'segment', recordId: first.id, index: 0 }],
  }).constraint);
  const candidate = candidateFromSelections([
    { kind: 'segment', recordId: first.id, entityType: 'line', index: 0, start: first.start, end: first.end },
    { kind: 'segment', recordId: second.id, entityType: 'line', index: 0, start: second.start, end: second.end },
  ], [42, 50], 'driving');

  const added = controller.addDimension(candidate);
  assert.ok(['converged', 'unchanged'].includes(added.result.status), added.result.message);
  const distanceConstraint = controller.constraints().find(({ type }) => type === 'Line Line Distance');
  assert.deepEqual(distanceConstraint.featureRefs, [
    { kind: 'segment', recordId: first.id, index: 0 },
    { kind: 'segment', recordId: second.id, index: 0 },
  ]);
  assert.equal(controller.constraints().some(({ type }) => type === 'Parallel'), false);

  const snapshot = controller.getSketchSnapshot();
  const restored = createSolverController();
  assert.ok(['converged', 'unchanged'].includes(restored.loadSketch(snapshot).status));
  assert.ok(restored.constraints().some(({ type }) => type === 'Line Line Distance'));
  assert.equal(restored.getSketchSnapshot().dimensionAnnotations[0].measurementKind, 'parallel-edge-distance');

  const changed = restored.updateEntities([{
    ...restored.model.entity(second.id),
    start: [40, 40],
    end: [80, 80],
  }]);
  assert.ok(['converged', 'unchanged'].includes(changed.result.status), changed.result.message);
  const solvedFirst = restored.model.entity(first.id);
  const solvedSecond = restored.model.entity(second.id);
  const referenceDirection = [
    solvedFirst.end[0] - solvedFirst.start[0],
    solvedFirst.end[1] - solvedFirst.start[1],
  ];
  const pointOffset = [
    solvedSecond.start[0] - solvedFirst.start[0],
    solvedSecond.start[1] - solvedFirst.start[1],
  ];
  const supportingLineDistance = Math.abs(referenceDirection[0] * pointOffset[1] - referenceDirection[1] * pointOffset[0])
    / Math.hypot(...referenceDirection);
  const measuredDirection = [
    solvedSecond.end[0] - solvedSecond.start[0],
    solvedSecond.end[1] - solvedSecond.start[1],
  ];
  const restoredTarget = restored.dimensions.get(distanceConstraint.dimensionRef).value;
  assert.ok(Math.abs(supportingLineDistance - restoredTarget) < normalLengthTolerance(restoredTarget));
  assert.ok(
    Math.abs(referenceDirection[0] * measuredDirection[1] - referenceDirection[1] * measuredDirection[0])
      / (Math.hypot(...referenceDirection) * Math.hypot(...measuredDirection))
      < DEFAULT_SOLVE_TOLERANCE,
  );
});

test('a line-to-line driving dimension removes its controlled axis from endpoint drag locks', () => {
  const controller = createSolverController();
  const reference = controller.addEntity({ id: 'drag-reference', type: 'line', start: [0, 0], end: [100, 0] });
  const measured = controller.addEntity({ id: 'drag-measured', type: 'line', start: [0, 20], end: [100, 20] });
  const candidate = candidateFromSelections([
    { kind: 'segment', recordId: reference.id, entityType: 'line', index: 0, start: reference.start, end: reference.end },
    { kind: 'segment', recordId: measured.id, entityType: 'line', index: 0, start: measured.start, end: measured.end },
  ], [50, 35], 'driving');
  assert.ok(controller.addDimension(candidate).result);
  const baseline = controller.getEntity(measured.id);

  const endpoint = { kind: 'point', recordId: measured.id, index: 2 };
  const dragVariables = controller.dragVariableIdsForFeature(endpoint);
  const dragVariableKeys = semanticVariableKeys(controller, dragVariables);
  assert.ok(dragVariableKeys.includes('drag-measured:end.x'));
  assert.equal(dragVariableKeys.includes('drag-measured:end.y'), false);
  assert.ok(dragVariableKeys.includes('drag-reference:start.y'));
  assert.ok(dragVariableKeys.includes('drag-reference:end.y'));
  controller.beginDrag(dragVariables);
  const preview = controller.updateEntities([{
    ...baseline,
    end: [140, 60],
  }], { solveOptions: { solveMode: 'interactive', timeBudgetMs: Infinity } });
  assert.ok(['converged', 'preview', 'unchanged'].includes(preview.result.status), preview.result.message);
  const committed = controller.endDrag();
  assert.ok(['converged', 'unchanged'].includes(committed.status), committed.message);
  const solved = controller.getEntity(measured.id);
  assert.ok(Math.abs(solved.end[0] - 140) < 1e-6);
  assert.ok(Math.abs(solved.start[1] - baseline.start[1]) < normalLengthTolerance(baseline.start[1]));
  assert.ok(Math.abs(solved.end[1] - baseline.end[1]) < normalLengthTolerance(baseline.end[1]));
  assert.ok(Math.hypot(solved.end[0] - solved.start[0], solved.end[1] - solved.start[1]) > 100);
});

test('axis dimensions stored with point anchors hold the opposite anchor during endpoint drag', () => {
  const controller = createSolverController();
  const reference = controller.addEntity({ id: 'anchor-reference', type: 'line', start: [0, 0], end: [100, 0] });
  const measured = controller.addEntity({ id: 'anchor-measured', type: 'line', start: [0, 20], end: [100, 20] });
  const candidate = candidateFromSelections([
    { kind: 'point', recordId: reference.id, index: 1, point: [50, 0] },
    { kind: 'point', recordId: measured.id, index: 1, point: [50, 20] },
  ], [70, 10], 'driving');
  assert.ok(controller.addDimension(candidate).result);

  const dragVariables = semanticVariableKeys(
    controller,
    controller.dragVariableIdsForFeature({ kind: 'point', recordId: measured.id, index: 2 }),
  );
  assert.ok(dragVariables.includes('anchor-measured:end.x'));
  assert.equal(dragVariables.includes('anchor-measured:end.y'), false);
  assert.ok(dragVariables.includes('anchor-reference:start.y'));
  assert.ok(dragVariables.includes('anchor-reference:end.y'));
});

test('angled dimensions use the rays selected by the user instead of the opposite acute angle', () => {
  const horizontal = {
    kind: 'segment',
    recordId: 'horizontal-angle',
    entityType: 'line',
    index: 0,
    start: [0, 0],
    end: [100, 0],
    pickPoint: [20, 0],
  };
  const diagonal = {
    kind: 'segment',
    recordId: 'diagonal-angle',
    entityType: 'line',
    index: 0,
    start: [100, 0],
    end: [200, -100],
    pickPoint: [180, -80],
  };
  const candidate = candidateFromSelections([horizontal, diagonal], [40, -60], 'driving');

  assert.equal(candidate.type, 'angle-dimension');
  assert.ok(Math.abs(candidate.measuredValue - 135) < 1e-9);
  assert.equal(candidate.firstRaySign, -1);
  assert.equal(candidate.secondRaySign, 1);
  assert.equal(candidate.angleOrientation, 1);
  assert.deepEqual(candidate.start, [20, 0]);

  const oppositeSector = candidateFromSelections([horizontal, diagonal], [140, -20], 'driving');
  assert.ok(Math.abs(oppositeSector.measuredValue - 45) < 1e-9);
  assert.equal(oppositeSector.firstRaySign, 1);
  assert.equal(oppositeSector.secondRaySign, 1);
});

test('every Smart Driving dimension records a normalized direction', () => {
  const firstPoint = { kind: 'point', recordId: 'line-a', entityType: 'line', index: 0, point: [0, 0] };
  const secondPoint = { kind: 'point', recordId: 'line-b', entityType: 'line', index: 2, point: [6, 8] };
  const aligned = candidateFromSelections([firstPoint, secondPoint], [3, 4], 'driving');
  const horizontal = candidateFromSelections([firstPoint, secondPoint], [3, -30], 'driving');
  const radius = candidateFromSelections([{
    kind: 'circle', recordId: 'circle-a', entityType: 'circle', center: [0, 0], radius: 10,
  }], [30, 40], 'driving');
  const firstSegment = {
    kind: 'segment', recordId: 'edge-a', entityType: 'line', index: 0, start: [0, 0], end: [100, 0],
  };
  const parallelSegment = {
    kind: 'segment', recordId: 'edge-b', entityType: 'line', index: 0, start: [0, 25], end: [100, 25],
  };
  const angledSegment = {
    kind: 'segment', recordId: 'edge-c', entityType: 'line', index: 0, start: [100, 0], end: [150, 50],
  };
  const lineToLine = candidateFromSelections([firstSegment, parallelSegment], [50, 40], 'driving');
  const angle = candidateFromSelections([firstSegment, angledSegment], [80, 30], 'driving');

  assert.deepEqual(aligned.direction, [0.6, 0.8]);
  assert.deepEqual(horizontal.direction, [1, 0]);
  assert.deepEqual(radius.direction, [0.6, 0.8]);
  assert.deepEqual(lineToLine.direction, [0, 1]);
  for (const dimension of [aligned, horizontal, radius, lineToLine, angle]) {
    assert.ok(Array.isArray(dimension.direction), `${dimension.type} is missing direction data.`);
    assert.ok(Math.abs(Math.hypot(...dimension.direction) - 1) < 1e-12);
  }
});

test('an aligned Smart Driving dimension rejects an endpoint dragged onto its mirrored branch', () => {
  const controller = createSolverController();
  const line = controller.addEntity({ id: 'directed-line', type: 'line', start: [0, 0], end: [10, 0] });
  assert.ok(controller.addConstraint({
    type: 'Fixed',
    featureRefs: [{ kind: 'point', recordId: line.id, index: 0 }],
  }).constraint);
  const candidate = candidateFromSelections([{
    kind: 'segment', recordId: line.id, entityType: 'line', index: 0, start: line.start, end: line.end,
  }], [5, 0], 'driving');
  const added = controller.addDimension(candidate);
  assert.ok(['converged', 'unchanged'].includes(added.result.status), added.result.message);
  assert.deepEqual(added.entity.direction, [1, 0]);

  const update = controller.updateEntities([{
    ...controller.getEntity(line.id),
    end: [-10, 0],
  }]);
  assert.ok(['converged', 'unchanged'].includes(update.result.status), update.result.message);
  const solved = controller.getEntity(line.id);
  assert.ok(solved.end[0] > solved.start[0], `The line flipped to ${JSON.stringify(solved)}.`);
  assert.ok(Math.abs(Math.hypot(
    solved.end[0] - solved.start[0],
    solved.end[1] - solved.start[1],
  ) - 10) < normalLengthTolerance(10));

  const resized = controller.setDimension(added.entity.dimensionId, '20 mm');
  assert.ok(['converged', 'unchanged'].includes(resized.status), resized.message);
  const parameterSolved = controller.getEntity(line.id);
  assert.ok(parameterSolved.end[0] > parameterSolved.start[0]);
  assert.ok(Math.abs(Math.hypot(
    parameterSolved.end[0] - parameterSolved.start[0],
    parameterSolved.end[1] - parameterSolved.start[1],
  ) - 20) < normalLengthTolerance(20));
});

test('loading a legacy driving dimension derives and persists its current direction', () => {
  const controller = createSolverController();
  const line = controller.addEntity({ id: 'legacy-directed-line', type: 'line', start: [0, 0], end: [6, 8] });
  const candidate = candidateFromSelections([{
    kind: 'segment', recordId: line.id, entityType: 'line', index: 0, start: line.start, end: line.end,
  }], [3, 4], 'driving');
  assert.ok(controller.addDimension(candidate).result);
  const legacySnapshot = controller.getSketchSnapshot();
  legacySnapshot.dimensionAnnotations.forEach((annotation) => delete annotation.direction);
  legacySnapshot.constraints.forEach((constraint) => delete constraint.direction);

  const restored = createSolverController();
  const loaded = restored.loadSketch(legacySnapshot);
  assert.ok(['converged', 'unchanged'].includes(loaded.status), loaded.message);
  const annotation = restored.getSketchSnapshot().dimensionAnnotations.find(({ dimensionMode }) => dimensionMode === 'driving');
  const constraint = restored.constraints().find(({ source }) => source === 'dimension');
  assert.ok(Math.abs(annotation.direction[0] - 0.6) < 1e-9);
  assert.ok(Math.abs(annotation.direction[1] - 0.8) < 1e-9);
  assert.deepEqual(constraint.direction, annotation.direction);
});
