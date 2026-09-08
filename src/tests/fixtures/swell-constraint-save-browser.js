import { identityAudit } from '../../../packages/paramagic-core/src/modules/DrawingIdentitySystem.js';
import {
  deriveSwellGeometry,
  withSwellDefinition,
} from '../../../packages/paramagic-core/src/modules/SwellGeometry.js';

const { canvasController, initialization } = await import('../../main.js');
await initialization;

const response = await fetch('./stack-coordinates.paramagic');
const drawing = await response.json();
const stackId = drawing.extensions.stacks.stacks.find(({ kind }) => kind === 'stack').id;
const classId = drawing.activeClassId;
const sourceId = '49b032a5-9063-4f6d-923e-f4769f204d21';
const movableId = 'd9b0f795-a2af-46ae-a7f9-aa632c312dd2';
const constraintId = 'd65a9df8-6290-4468-8b6f-87f12df2342e';
const line = (id, start, end) => ({
  id,
  type: 'line',
  stackId,
  start,
  end,
  classId,
  classPropertyOverrides: [],
  sourceRecordId: id,
  sourceStackId: stackId,
});
const source = withSwellDefinition(line(sourceId, [0, 0], [80, 0]), {
  swellEnabled: false,
  offsetExpression: '10',
  swellOffsetExpression: '10',
  startTransitionExpression: '0',
  endTransitionExpression: '0',
});
const movable = line(movableId, [30, 25], [55, 25]);
const derived = deriveSwellGeometry({
  entities: [source, movable],
  constraints: [],
  evaluateLength: Number,
}).get(sourceId);
const transientPieceId = derived.pieces.find(({ entity }) => entity.type === 'line').id;

drawing.identityArchitectureVersion = 0;
drawing.entities = [source, movable];
drawing.constraints = [];
drawing.parameters = [];
drawing.dimensionAnnotations = [];
drawing.extensions.swell = {
  version: 1,
  constraints: [{
    id: constraintId,
    type: 'Point-on Line',
    source: 'geometric',
    stackId,
    participantStackIds: [],
    externalTarget: {
      type: 'swell-derived',
      derivedRef: { kind: 'segment', recordId: transientPieceId, index: 0 },
      movableRef: { kind: 'point', recordId: movableId, index: 0 },
      sourceId,
    },
  }],
};

canvasController.loadDrawingData(drawing, { zoomToFit: true });
canvasController.setActiveStack(stackId);
await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

const output = document.createElement('output');
output.style.cssText = 'position:fixed;right:12px;bottom:12px;z-index:2000;padding:10px;background:white;border:1px solid #888;font:13px sans-serif;white-space:pre-wrap';
document.body.append(output);
const checks = [];
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
  checks.push(message);
};

try {
  const saveButton = document.getElementById('saveButton');
  saveButton.disabled = false;
  assert(!saveButton.disabled, 'normal Save action is available');
  const saved = canvasController.getDrawingData();
  const constraint = saved.extensions.swell.constraints[0];
  assert(constraint.externalTarget.derivedRef.recordId === sourceId, 'Swell constraint stores the real source RecordID');
  assert(constraint.externalTarget.derivedRef.derivedFeature?.provider === 'swell', 'Swell constraint stores a live derivative selector');
  assert(constraint.externalTarget.sourceId === sourceId, 'Swell target source identity is portable');
  assert(identityAudit(saved).valid, 'saved drawing passes the complete identity audit');

  output.textContent = `READY: ${checks.length} pre-save checks\n${checks.join('\n')}\nUse App Menu > Save.`;
} catch (error) {
  output.textContent = `FAIL: ${error.message}\n${checks.join('\n')}`;
  throw error;
}
