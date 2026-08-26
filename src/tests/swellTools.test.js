import test from 'node:test';
import assert from 'node:assert/strict';
import {
  entitySupportsSwellOption,
  isSwellPropertiesPanelSuppressed,
  rememberSwellCreationExpressions,
  swellAdvancedControlsVisible,
  swellBoundaryFeatureFromTarget,
  swellDimensionFeatureSetForPiece,
  swellExternalConstraintRequest,
  swellInteractionGroup,
  swellPieceHandlePoints,
  swellPresentationHost,
  swellPropertiesPanelMarkup,
  swellLineSelectionProperties,
  swellSelectionCanFill,
  setSwellPropertyRowVisible,
} from '../../packages/paramagic-core/src/modules/SwellTools.js';

test('the Swell panel uses expression inputs and offers Swell only for line-based geometry', () => {
  const markup = swellPropertiesPanelMarkup();
  assert.match(markup, /id="swellEnabledProperty" type="checkbox"/);
  assert.match(markup, /swell-toggle-property[^>]*hidden style="display:none"/);
  assert.equal((markup.match(/swell-line-property[^>]*hidden style="display:none"/g) || []).length, 3);
  assert.equal((markup.match(/class="swell-expression-input"/g) || []).length, 4);
  assert.match(markup, /list="swellExpressionNames"/);
  assert.equal(entitySupportsSwellOption({ type: 'line' }), true);
  assert.equal(entitySupportsSwellOption({ type: 'rect' }), true);
  assert.equal(entitySupportsSwellOption({ type: 'polyline' }), true);
  assert.equal(entitySupportsSwellOption({ type: 'polygon' }), true);
  assert.equal(entitySupportsSwellOption({ type: 'arc' }), false);
  assert.equal(entitySupportsSwellOption({ type: 'circle' }), false);
  assert.equal(entitySupportsSwellOption({ type: 'curve' }), false);
});

test('a mixed Swell object exposes controls from its line-capable geometry', () => {
  const properties = swellLineSelectionProperties([
    {
      entity: { type: 'line' },
      definition: {
        swellEnabled: false,
        swellOffsetExpression: '1.5',
        startTransitionExpression: '4',
        endTransitionExpression: '5',
      },
    },
    {
      entity: { type: 'arc' },
      definition: {
        swellEnabled: true,
        swellOffsetExpression: '99',
        startTransitionExpression: '98',
        endTransitionExpression: '97',
      },
    },
    {
      entity: { type: 'curve' },
      definition: {
        swellEnabled: true,
        swellOffsetExpression: '96',
        startTransitionExpression: '95',
        endTransitionExpression: '94',
      },
    },
  ]);

  assert.deepEqual(properties, {
    swellLineSelection: true,
    swellEnabled: false,
    swellSwellOffsetExpression: '1.5',
    swellStartTransitionExpression: '4',
    swellEndTransitionExpression: '5',
  });
  assert.equal(swellAdvancedControlsVisible(properties), false);
});

test('arc, circle, and spline-only Swell selections hide the Swell controls', () => {
  const properties = swellLineSelectionProperties([
    { entity: { type: 'arc' }, definition: { swellEnabled: true } },
    { entity: { type: 'circle' }, definition: { swellEnabled: true } },
    { entity: { type: 'curve' }, definition: { swellEnabled: true } },
  ]);

  assert.equal(properties.swellLineSelection, false);
  assert.equal(properties.swellEnabled, null);
  assert.equal(swellAdvancedControlsVisible(properties), false);
});

test('Swell expressions are visible for enabled or mixed line selections, but not disabled ones', () => {
  assert.equal(swellAdvancedControlsVisible({ swellLineSelection: true, swellEnabled: true }), true);
  assert.equal(swellAdvancedControlsVisible({ swellLineSelection: true, swellEnabled: null }), true);
  assert.equal(swellAdvancedControlsVisible({ swellLineSelection: true, swellEnabled: false }), false);
});

test('hidden Swell controls are removed from the panel layout', () => {
  const row = { hidden: false, style: { display: '' } };

  setSwellPropertyRowVisible(row, false);
  assert.equal(row.hidden, true);
  assert.equal(row.style.display, 'none');

  setSwellPropertyRowVisible(row, true);
  assert.equal(row.hidden, false);
  assert.equal(row.style.display, '');
});

test('new Swell geometry remembers the last expression entered in every field', () => {
  const remembered = rememberSwellCreationExpressions({}, {
    offsetExpression: '-0.75',
    swellOffsetExpression: 'width * -2',
  });
  const next = rememberSwellCreationExpressions(remembered, {
    startTransitionExpression: '-3',
    endTransitionExpression: '6',
  });

  assert.deepEqual(next, {
    offsetExpression: '-0.75',
    swellOffsetExpression: 'width * -2',
    startTransitionExpression: '-3',
    endTransitionExpression: '6',
  });
});

test('a Swell circle fill resolves its analytic edge for Seam Line', () => {
  const boundary = {
    id: 'circle-boundary',
    features: [{
      kind: 'circle',
      recordId: 'swell-circle-offset',
      sourceId: 'swell-circle',
      targetId: 'circle-boundary',
      center: [10, 20],
      radius: 5,
    }],
  };
  const fillGroup = { dataset: { boundaryId: boundary.id } };
  const target = {
    closest(selector) {
      return selector.includes('swell-derived-fill-group') ? fillGroup : null;
    },
  };

  const feature = swellBoundaryFeatureFromTarget([boundary], target, [16, 20]);

  assert.equal(feature.kind, 'circle');
  assert.equal(feature.sourceId, 'swell-circle');
  assert.deepEqual(feature.pickedPoint, [15, 20]);
  assert.equal(feature.distance, 1);
});

test('Swell properties stay hidden while Duplicate, Symmetric, or Array is active', () => {
  const root = (pressedSelector = null) => ({
    querySelector(selector) {
      return {
        getAttribute(name) {
          return name === 'aria-pressed' && selector === pressedSelector ? 'true' : 'false';
        },
      };
    },
  });

  assert.equal(isSwellPropertiesPanelSuppressed(root()), false);
  assert.equal(isSwellPropertiesPanelSuppressed(root('[data-duplicate-tool]')), true);
  assert.equal(isSwellPropertiesPanelSuppressed(root('[data-symmetric-tool]')), true);
  assert.equal(isSwellPropertiesPanelSuppressed(root('[data-array-toggle]')), true);
});

test('Swell offset pieces expose ordinary geometry-style point handles', () => {
  assert.deepEqual(swellPieceHandlePoints({
    entity: { type: 'line', start: [0, 0], end: [10, 0] },
  }), [[0, 0], [5, 0], [10, 0]]);
  assert.deepEqual(swellPieceHandlePoints({
    entity: { type: 'arc', start: [10, 0], arcPoint: [7, 7], end: [0, 10] },
  }), [[10, 0], [7, 7], [0, 10]]);
  assert.deepEqual(swellPieceHandlePoints({
    entity: { type: 'polyline', points: Array.from({ length: 9 }, (_, index) => [index, index ** 2]) },
  }), [[0, 0], [4, 16], [8, 64]]);
});

test('a complete connected Swell boundary enables fill properties for every source type', () => {
  const boundary = { recordIds: ['line', 'arc', 'spline'] };
  assert.equal(swellSelectionCanFill(['line', 'arc', 'spline'], [boundary]), true);
  assert.equal(swellSelectionCanFill(['line', 'arc'], [boundary]), false);
  assert.equal(swellSelectionCanFill(['unrelated'], [boundary]), false);
});

test('Swell offset pieces expose analytic features to Smart Driven Dimension', () => {
  const featureSet = swellDimensionFeatureSetForPiece({
    id: 'swell-derived::line::0::swell-1',
    ownerId: 'line',
    segmentIndex: 0,
    role: 'swell',
    entity: { type: 'line', start: [4, -3], end: [16, -3] },
  });

  assert.equal(featureSet.recordId, 'swell-derived::line::0::swell-1');
  assert.deepEqual(featureSet.controlPoints, [[4, -3], [10, -3], [16, -3]]);
  assert.deepEqual(featureSet.features.map(({ kind }) => kind), ['point', 'point', 'segment']);
  assert.ok(featureSet.features.every((feature) => feature.swellDerived === true));
  assert.ok(featureSet.features.every((feature) => feature.swellSourceId === 'line'));
});

test('external entity point constraints retain a reactive Swell-derived target', () => {
  const request = swellExternalConstraintRequest('Point-on Line', [
    {
      kind: 'segment',
      recordId: 'swell-derived::line::0::swell-1',
      index: 0,
      swellDerived: true,
      swellSourceId: 'line',
    },
    { kind: 'point', recordId: 'external-line', index: 2 },
  ], { id: 'constraint-1', type: 'Point-on Line' });

  assert.equal(request.id, 'constraint-1');
  assert.deepEqual(request.externalTarget, {
    type: 'swell-derived',
    derivedRef: { kind: 'segment', recordId: 'swell-derived::line::0::swell-1', index: 0 },
    movableRef: { kind: 'point', recordId: 'external-line', index: 2 },
    sourceId: 'line',
  });
});

test('Swell-derived concentric constraints move the external round feature', () => {
  const request = swellExternalConstraintRequest('Concentric', [
    {
      kind: 'circle',
      recordId: 'swell-derived::circle::entity::offset',
      index: 0,
      swellDerived: true,
      swellSourceId: 'circle',
    },
    { kind: 'arc', recordId: 'external-arc', index: 0 },
  ], { type: 'Concentric' });

  assert.deepEqual(request.externalTarget.movableRef, {
    kind: 'point', recordId: 'external-arc', index: 0, pointRole: 'center',
  });
});

test('Swell Seam Line presentation mounts in the visible derived record', () => {
  const classes = (...names) => ({ contains: (name) => names.includes(name) });
  const visibleGeometry = { classList: classes('swell-derived-piece') };
  const hitTarget = { classList: classes('swell-derived-hit') };
  const handleGroup = { classList: classes('swell-derived-handle-group') };
  const derivedGroup = {
    classList: classes('canvas-record', 'swell-derived-group'),
    dataset: { swellOwnerId: 'source-line' },
    children: [visibleGeometry, hitTarget, handleGroup],
  };
  const unrelatedGroup = {
    classList: classes('canvas-record', 'swell-derived-group'),
    dataset: { swellOwnerId: 'other-line' },
    children: [],
  };

  const host = swellPresentationHost({ children: [unrelatedGroup, derivedGroup] }, 'source-line');

  assert.equal(host.container, derivedGroup);
  assert.equal(host.before, hitTarget);
  assert.equal(swellInteractionGroup({ children: [unrelatedGroup, derivedGroup] }, 'source-line'), derivedGroup);
  assert.equal(swellPresentationHost({ children: [derivedGroup] }, 'missing'), null);
});
