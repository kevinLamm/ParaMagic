import test from 'node:test';
import assert from 'node:assert/strict';
import {
  constraintFeatureFromEvent,
  constraintHelpersVisible,
  constraintRecordVisible,
  constraintReferencesActiveStack,
  constraintReferencesAnyRecord,
  constraintReferencesVisible,
  constraintHelperPoint,
  featureAllowed,
  pairAllowed,
  setConstraintPointAffordances,
  setConstraintSelectionActive,
} from '../../packages/paramagic-core/src/modules/ConstraintSystem.js';
import { canvasOriginPointFeature } from '../../packages/paramagic-core/src/modules/CanvasOrigin.js';

test('constraint helpers require every referenced record to be visible', () => {
  const constraint = {
    featureRefs: [
      { recordId: 'visible-shape', kind: 'segment', index: 0 },
      { recordId: 'hidden-shape', kind: 'segment', index: 1 },
    ],
  };
  assert.equal(constraintReferencesVisible(constraint, (recordId) => recordId === 'visible-shape'), false);
  assert.equal(constraintReferencesVisible(constraint, () => true), true);
});

test('constraint helpers require both Stack and region visibility', () => {
  const visibility = (stackVisible, objectVisible) => constraintRecordVisible({
    isRecordVisible: () => stackVisible,
    isObjectVisible: () => objectVisible,
  }, 'region-edge');

  assert.equal(visibility(true, true), true);
  assert.equal(visibility(false, true), false);
  assert.equal(visibility(true, false), false);
});

test('constraint helper visibility handles duplicate and missing feature references', () => {
  const visited = [];
  assert.equal(constraintReferencesVisible({ featureRefs: [] }, () => false), true);
  assert.equal(constraintReferencesVisible({
    featureRefs: [{ recordId: 'shape-a' }, { recordId: 'shape-a' }],
  }, (recordId) => {
    visited.push(recordId);
    return true;
  }), true);
  assert.deepEqual(visited, ['shape-a']);
});

test('the built-in origin does not make a constraint helper appear hidden', () => {
  assert.equal(constraintReferencesVisible({
    featureRefs: [
      canvasOriginPointFeature(),
      { recordId: 'shape-a', kind: 'point', index: 0 },
    ],
}, (recordId) => recordId === 'shape-a'), true);
});

test('constraint helpers appear only when their constraint touches the active Stack', () => {
  const inactiveConstraint = {
    featureRefs: [
      { recordId: 'inactive-a', kind: 'segment', index: 0 },
      { recordId: 'inactive-b', kind: 'segment', index: 0 },
    ],
  };
  const crossStackConstraint = {
    featureRefs: [
      { recordId: 'active-shape', kind: 'point', index: 2 },
      { recordId: 'inactive-a', kind: 'point', index: 0 },
    ],
  };

  assert.equal(constraintReferencesActiveStack(inactiveConstraint, () => false), false);
  assert.equal(constraintReferencesActiveStack(crossStackConstraint, (recordId) => recordId === 'active-shape'), true);
  assert.equal(constraintReferencesActiveStack({ featureRefs: [] }, () => false), true);
  assert.equal(constraintReferencesActiveStack({
    featureRefs: [canvasOriginPointFeature()],
  }, () => false), true);
});

test('constraint helper overlay is hidden whenever no Stack is active', () => {
  assert.equal(constraintHelpersVisible({ requested: true, scale: 1, activeStackId: 'stack-a' }), true);
  assert.equal(constraintHelpersVisible({ requested: true, scale: 1, activeStackId: null }), false);
  assert.equal(constraintHelpersVisible({ requested: false, scale: 1, activeStackId: 'stack-a' }), false);
  assert.equal(constraintHelpersVisible({ requested: true, scale: 0.01, activeStackId: 'stack-a' }), false);
});

test('incremental constraint-helper refresh identifies only constraints touching changed records', () => {
  const constraint = {
    featureRefs: [{ recordId: 'line-a' }, { recordId: 'line-b' }],
  };
  assert.equal(constraintReferencesAnyRecord(constraint, new Set(['line-b'])), true);
  assert.equal(constraintReferencesAnyRecord(constraint, new Set(['line-c'])), false);
});

test('constraint selection toggles dimension hit-testing on the canvas', () => {
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

  setConstraintSelectionActive(canvas, true);
  assert.equal(classes.has('constraint-selection-active'), true);

  setConstraintSelectionActive(canvas, false);
  assert.equal(classes.has('constraint-selection-active'), false);
});

test('Equal accepts homogeneous segment, arc, and circle pairs only', () => {
  for (const kind of ['segment', 'arc', 'circle']) {
    assert.equal(featureAllowed('Equal', { kind }), true);
    assert.equal(pairAllowed('Equal', [{ kind }, { kind }]), true);
  }
  assert.equal(featureAllowed('Equal', { kind: 'point' }), false);
  assert.equal(pairAllowed('Equal', [{ kind: 'segment' }, { kind: 'arc' }]), false);
  assert.equal(pairAllowed('Equal', [{ kind: 'arc' }, { kind: 'circle' }]), false);
  assert.equal(pairAllowed('Equal', [{ kind: 'circle' }, { kind: 'segment' }]), false);
});

test('Length accepts only one line segment or arc', () => {
  assert.equal(featureAllowed('Length', { kind: 'segment' }), true);
  assert.equal(featureAllowed('Length', { kind: 'arc' }), true);
  assert.equal(featureAllowed('Length', { kind: 'circle' }), false);
  assert.equal(featureAllowed('Length', { kind: 'curve' }), false);
});

test('constraint helpers anchor arcs on their visible curve instead of their center', () => {
  assert.deepEqual(constraintHelperPoint({
    kind: 'arc',
    center: [100, 100],
    arcPoint: [12, 18],
  }), [12, 18]);
  assert.deepEqual(constraintHelperPoint({
    kind: 'arc',
    center: [100, 100],
    start: [10, 20],
    end: [14, 24],
  }), [12, 22]);
  assert.deepEqual(constraintHelperPoint({ kind: 'circle', center: [5, 6] }), [5, 6]);
});

test('constraint point affordances follow whether the active constraint accepts points', () => {
  const calls = [];
  const canvas = {
    setOriginPointEnabled: (enabled) => calls.push(['origin', enabled]),
    setPointHandlesEnabled: (enabled) => calls.push(['handles', enabled]),
  };

  assert.equal(setConstraintPointAffordances(canvas, 'Coincident'), true);
  assert.deepEqual(calls.splice(0), [['origin', true], ['handles', true]]);

  assert.equal(setConstraintPointAffordances(canvas, 'Equal'), false);
  assert.deepEqual(calls, [['origin', false], ['handles', false]]);
});

test('constraint feature picking includes rendered linked-copy geometry', () => {
  const event = { target: {} };
  const expected = { kind: 'point', recordId: 'duplicate-derived:copy:source', index: 0 };
  const calls = [];
  const canvas = {
    getFeatureFromEvent(receivedEvent, options) {
      calls.push([receivedEvent, options]);
      return expected;
    },
  };

  assert.equal(constraintFeatureFromEvent(canvas, event), expected);
  assert.deepEqual(calls, [[event, { rendered: true }]]);
});
