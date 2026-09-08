import { identityAudit } from '../../../packages/paramagic-core/src/modules/DrawingIdentitySystem.js';
import { duplicateDerivedRecordId } from '../../../packages/paramagic-core/src/modules/SymmetricTool.js';

const { canvasController, initialization } = await import('../../main.js');
await initialization;

const response = await fetch('./stack-coordinates.paramagic');
const drawing = await response.json();
const stackId = drawing.extensions.stacks.stacks.find(({ kind }) => kind === 'stack').id;
const classId = drawing.activeClassId;
const sourceId = 'bf688715-8119-4f40-8189-fe24c3b84203';
const referenceId = '7e532091-29c4-4fc5-bb1b-a838c2fba8b7';
const copyId = 'e6b167b0-1414-4fc2-b509-9c4ef52aa086';
const constraintId = '91006385-5908-467c-914f-12ef2093a4c4';
const transientRecordId = duplicateDerivedRecordId(copyId, sourceId);
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

drawing.identityArchitectureVersion = 0;
drawing.entities = [
  line(sourceId, [0, 0], [40, 0]),
  line(referenceId, [100, 40], [140, 40]),
];
drawing.constraints = [];
drawing.parameters = [];
drawing.dimensionAnnotations = [];
drawing.extensions.linkedCopyTools = {
  version: 3,
  copies: [{
    id: copyId,
    type: 'duplicate',
    stackId,
    sourceIds: [sourceId],
    anchor: [100, 40],
    linear: { a: 1, b: 0, c: 0, d: 1 },
    visible: true,
  }],
  positionConstraints: [{
    id: constraintId,
    type: 'Coincident',
    source: 'geometric',
    stackId,
    participantStackIds: [],
    featureRefs: [
      { kind: 'point', recordId: transientRecordId, index: 0 },
      { kind: 'point', recordId: referenceId, index: 0 },
    ],
    externalDrivingTarget: {
      type: 'linked-position',
      recordId: transientRecordId,
      copyId,
      sourceId,
      pointIndex: 0,
      otherAnchor: { type: 'point', recordId: referenceId, index: 0 },
      axis: 'horizontal',
      axisSign: 1,
      perpendicularOffset: 0,
    },
  }],
};

canvasController.loadDrawingData(drawing, { zoomToFit: true });
canvasController.setActiveStack(stackId);

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
  const constraint = saved.extensions.linkedCopyTools.positionConstraints[0];
  assert(constraint.featureRefs[0].recordId === sourceId, 'Duplicate constraint stores the real source RecordID');
  assert(constraint.featureRefs[0].derivedFeature?.copyId === copyId, 'Duplicate constraint stores a live derivative selector');
  assert(constraint.externalDrivingTarget.recordId === sourceId, 'linked-position target stores the real source RecordID');
  assert(identityAudit(saved).valid, 'saved drawing passes the complete identity audit');

  output.textContent = `READY: ${checks.length} pre-save checks\n${checks.join('\n')}\nUse App Menu > Save.`;
} catch (error) {
  output.textContent = `FAIL: ${error.message}\n${checks.join('\n')}`;
  throw error;
}
