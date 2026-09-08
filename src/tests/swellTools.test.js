import test from 'node:test';
import assert from 'node:assert/strict';
import {
  entitySupportsSwellOption,
  isSwellPropertiesPanelSuppressed,
  normalizeSwellExternalConstraint,
  rememberSwellCreationExpressions,
  swellAdvancedControlsVisible,
  swellAppearanceSelectionProperties,
  swellBoundaryFeatureFromTarget,
  swellDimensionFeatureSetForPiece,
  swellDimensionFeatureForMode,
  swellDimensionReference,
  swellDerivedFeatureReference,
  swellExternalConstraintRequest,
  swellInteractionGroup,
  swellImageStrokePathMetrics,
  swellPieceHandlePoints,
  swellPieceMatchesDimensionReference,
  swellPresentationHost,
  swellPropertiesPanelMarkup,
  swellLineSelectionProperties,
  swellSelectionCanFill,
  setSwellPropertyRowVisible,
  syncSwellGroupPresentation,
} from '../../packages/paramagic-core/src/modules/SwellTools.js';

test('the Swell panel uses expression inputs and offers Swell only for line-based geometry', () => {
  const markup = swellPropertiesPanelMarkup();
  assert.match(markup, /id="swellEnabledProperty" type="checkbox"/);
  assert.match(markup, /swell-toggle-property[^>]*hidden style="display:none"/);
  assert.equal((markup.match(/swell-line-property[^>]*hidden style="display:none"/g) || []).length, 3);
  assert.equal((markup.match(/class="swell-expression-input"/g) || []).length, 4);
  assert.match(markup, /data-expression-source="swellExpressionNames"/);
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

test('Swell offset pieces expose analytic features to Smart Dimensions', () => {
  const piece = {
    id: 'swell-derived::line::0::swell-1',
    ownerId: 'line',
    segmentIndex: 0,
    role: 'swell',
    ordinal: 1,
    entity: { type: 'line', start: [4, -3], end: [16, -3] },
  };
  const featureSet = swellDimensionFeatureSetForPiece(piece);

  assert.equal(featureSet.recordId, 'swell-derived::line::0::swell-1');
  assert.deepEqual(featureSet.controlPoints, [[4, -3], [10, -3], [16, -3]]);
  assert.deepEqual(featureSet.features.map(({ kind }) => kind), ['point', 'point', 'segment']);
  assert.ok(featureSet.features.every((feature) => feature.swellDerived === true));
  assert.ok(featureSet.features.every((feature) => feature.swellSourceId === 'line'));
  assert.ok(featureSet.features.every((feature) => (
    swellPieceMatchesDimensionReference(piece, feature.dimensionReference)
  )));
  assert.deepEqual(featureSet.features[0].dimensionReference, {
    recordId: 'line',
    derivedFeature: { provider: 'swell', segmentIndex: 0, role: 'swell', ordinal: 1 },
  });
});

test('Swell derivative regions and strokes expose image appearance controls', () => {
  const imageAppearance = {
    fillColor: '#ffffff',
    fillExpression: 'basic/Fabric/linen.webp',
    fillType: 'image',
    fillImageReference: 'basic/Fabric/linen.webp',
    fillImageMode: 'tile',
    fillImageRotationAngle: 12,
    fillImageLeftExpression: '2',
    fillImageTopExpression: '-3',
    strokeColor: '#202020',
    strokeExpression: 'basic/Trim/tape.png',
    strokeType: 'image',
    strokeImageReference: 'basic/Trim/tape.png',
    strokeImageWidthExpression: '8',
    strokeImageHeightExpression: '0.25',
    fillOpacityExpression: '100',
    fillOpacity: 1,
    strokeOpacityExpression: '100',
    strokeOpacity: 1,
    strokeThickness: 1.5,
    errors: {},
  };

  const closed = swellAppearanceSelectionProperties([imageAppearance], { canFill: true });
  assert.equal(closed.canEditImageFill, true);
  assert.equal(closed.canEditImageFillSettings, true);
  assert.equal(closed.imageFillMode, 'tile');
  assert.equal(closed.imageFillRotationAngle, 12);
  assert.equal(closed.imageFillLeftExpression, '2');
  assert.equal(closed.imageFillTopExpression, '-3');
  assert.equal(closed.canEditImageStroke, true);
  assert.equal(closed.canEditImageStrokeSettings, true);
  assert.equal(closed.imageStrokeWidthExpression, '8');
  assert.equal(closed.imageStrokeHeightExpression, '0.25');

  const open = swellAppearanceSelectionProperties([imageAppearance], { canFill: false });
  assert.equal(open.canEditImageFill, false);
  assert.equal(open.canEditImageFillSettings, false);
  assert.equal(open.canEditImageStroke, true);
  assert.equal(open.canEditImageStrokeSettings, true);
});

test('Swell image strokes expose analytic path sampling for derived geometry', () => {
  const line = swellImageStrokePathMetrics({ type: 'line', start: [2, 3], end: [12, 3] });
  assert.equal(line.totalLength, 10);
  assert.deepEqual(line.pointAtLength(4), { x: 6, y: 3 });

  const polygon = swellImageStrokePathMetrics({
    type: 'polygon',
    points: [[0, 0], [3, 0], [3, 4]],
  });
  assert.equal(polygon.totalLength, 12);
  assert.deepEqual(polygon.pointAtLength(9.5), { x: 1.5, y: 2 });

  const circle = swellImageStrokePathMetrics({ type: 'circle', center: [5, 7], radius: 2 });
  assert.equal(circle.totalLength, Math.PI * 4);
  assert.ok(Math.abs(circle.pointAtLength(Math.PI).x - 5) < 1e-9);
  assert.ok(Math.abs(circle.pointAtLength(Math.PI).y - 9) < 1e-9);
});

test('Smart Driving Dimension accepts Swell-derived points but not immutable edges', () => {
  const point = { kind: 'point', recordId: 'swell-piece', index: 0, point: [4, -3] };
  const segment = { kind: 'segment', recordId: 'swell-piece', index: 0, start: [4, -3], end: [16, -3] };

  assert.equal(swellDimensionFeatureForMode(point, 'driving'), point);
  assert.equal(swellDimensionFeatureForMode(segment, 'driving'), null);
  assert.equal(swellDimensionFeatureForMode(segment, 'driven'), segment);
});

test('external entity point constraints retain a reactive Swell-derived target', () => {
  const dimensionReference = swellDimensionReference('line', 0, 'swell', 1);
  const request = swellExternalConstraintRequest('Point-on Line', [
    {
      kind: 'segment',
      recordId: 'swell-derived::line::0::swell-1',
      index: 0,
      swellDerived: true,
      swellSourceId: 'line',
      swellSegmentIndex: 0,
      swellRole: 'swell',
      swellOrdinal: 1,
      dimensionReference,
    },
    { kind: 'point', recordId: 'external-line', index: 2 },
  ], {
    id: 'constraint-1',
    type: 'Point-on Line',
    stackId: 'stack-a',
    participantStackIds: ['stack-b'],
    sourceRelationshipId: 'source-constraint-1',
  });

  assert.equal(request.id, 'constraint-1');
  assert.equal(request.stackId, 'stack-a');
  assert.deepEqual(request.participantStackIds, ['stack-b']);
  assert.equal(request.sourceRelationshipId, 'source-constraint-1');
  assert.deepEqual(request.externalTarget, {
    type: 'swell-derived',
    derivedRef: {
      kind: 'segment',
      ...dimensionReference,
      index: 0,
    },
    movableRef: { kind: 'point', recordId: 'external-line', index: 2 },
    sourceId: 'line',
  });
});

test('legacy Swell constraints normalize transient piece UUIDs to portable source references', () => {
  const transientRecordId = 'swell-derived::line::0::swell-1';
  const dimensionReference = swellDimensionReference('line', 0, 'swell', 1);
  const normalized = normalizeSwellExternalConstraint({
    id: 'constraint-1',
    type: 'Point-on Line',
    externalTarget: {
      type: 'swell-derived',
      derivedRef: { kind: 'segment', recordId: transientRecordId, index: 0 },
      movableRef: { kind: 'point', recordId: 'external-line', index: 2 },
      sourceId: 'line',
    },
  }, (request) => request.recordId === transientRecordId ? {
    kind: 'segment',
    recordId: transientRecordId,
    index: 0,
    swellDerived: true,
    swellSourceId: 'line',
    dimensionReference,
  } : null);

  assert.deepEqual(normalized.externalTarget.derivedRef, {
    kind: 'segment',
    ...dimensionReference,
    index: 0,
  });
  assert.equal(normalized.externalTarget.sourceId, 'line');
});

test('persisted Swell derivative features use a real source RecordID plus a provider selector', () => {
  const swell = swellDerivedFeatureReference({
    kind: 'segment',
    recordId: 'transient-swell-piece-id',
    index: 0,
    dimensionReference: swellDimensionReference('source-line', 0, 'offset', 0),
  });

  assert.equal(swell.recordId, 'source-line');
  assert.equal(swell.derivedFeature.provider, 'swell');
  assert.notEqual(swell.recordId, 'transient-swell-piece-id');
});

test('Swell-derived concentric constraints move the external round feature', () => {
  const request = swellExternalConstraintRequest('Concentric', [
    {
      kind: 'circle',
      recordId: 'swell-derived::circle::entity::offset',
      index: 0,
      swellDerived: true,
      swellSourceId: 'circle',
      dimensionReference: swellDimensionReference('circle', null, 'offset', 0),
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

test('Swell derivative groups inherit hidden Stack presentation after a rebuild', () => {
  const classes = new Set();
  const group = {
    classList: {
      toggle(name, enabled) {
        if (enabled) classes.add(name);
        else classes.delete(name);
      },
    },
  };
  const canvas = {
    getActiveStackId: () => 'other-stack',
    isRecordInActiveStack: () => false,
    isRecordVisible: () => false,
    isObjectVisible: () => true,
  };

  assert.deepEqual(syncSwellGroupPresentation(group, 'swell-source', canvas), {
    inactive: true,
    stackHidden: true,
    objectHidden: false,
  });
  assert.equal(classes.has('stack-hidden'), true);
  assert.equal(classes.has('stack-inactive'), true);
  assert.equal(classes.has('object-visibility-hidden'), false);

  canvas.isRecordVisible = () => true;
  canvas.isRecordInActiveStack = () => true;
  syncSwellGroupPresentation(group, 'swell-source', canvas);
  assert.equal(classes.has('stack-hidden'), false);
  assert.equal(classes.has('stack-inactive'), false);
});
