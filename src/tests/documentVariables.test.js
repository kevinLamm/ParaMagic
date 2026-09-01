import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveTextFields } from '../../packages/paramagic-core/src/modules/TextTools.js';
import { DOCUMENT_VARIABLE_SPECS, buildDocumentVariables } from '../../packages/paramagic-core/src/modules/DocumentVariables.js';
import { SolverController } from '../../packages/paramagic-core/src/modules/solver/SolverController.js';

test('document variables expose automatic drawing values and editable metadata', () => {
  const variables = buildDocumentVariables({
    metadata: { drawingNumber: 'DWG-12', company: 'ParaMagic Labs' },
    context: { fileName: 'Bracket' },
    drawingUnit: 'mm',
    entities: [{ type: 'line', start: [0, 0], end: [120, 40] }],
    now: new Date('2026-08-02T12:00:00.000Z'),
  });
  const byName = new Map(variables.map((entry) => [entry.name, entry]));

  assert.equal(byName.get('FileName').value, 'Bracket');
  assert.equal(byName.get('DrawingNumber').value, 'DWG-12');
  assert.equal(byName.get('Company').value, 'ParaMagic Labs');
  assert.equal(byName.get('Units').value, 'mm');
  assert.equal(byName.get('CurrentDate').value, '2026-08-02');
  assert.equal(byName.get('BoundingBoxWidth').value, 120);
  assert.equal(byName.get('BoundingBoxHeight').value, 40);
  assert.equal(byName.get('FileName').readOnly, true);
  assert.equal(byName.get('DrawingNumber').readOnly, false);
  assert.equal(DOCUMENT_VARIABLE_SPECS.some((spec) => spec.name === 'SheetNumber'), false);
});

test('document variables resolve in text fields and parameter expressions', () => {
  const solver = new SolverController();
  solver.addEntity({ id: 'line', type: 'line', start: [0, 0], end: [50.8, 25.4] });
  solver.setDocumentContext({ fileName: 'Plate' });
  solver.setDocumentMetadata({ drawingNumber: 'P-100' });

  const width = solver.createParameter({ name: 'halfWidth', expression: 'BoundingBoxWidth / 2' });
  assert.equal(width.error, null);
  assert.equal(Number(width.value.toFixed(8)), 25.4);

  const text = resolveTextFields(
    '[FileName] / [DrawingNumber] / [Units] / [BoundingBoxWidth]',
    [...solver.documentVariables(), ...solver.parameters()],
    (entry) => typeof entry.value === 'number' ? String(entry.value) : entry.value,
  );
  assert.equal(text, 'Plate / P-100 / in / 50.8');

  solver.setDocumentMetadata({ drawingNumber: 'P-200' });
  solver.setDocumentContext({ fileName: 'Bracket' });
  const refreshedText = resolveTextFields(
    '[FileName] / [DrawingNumber]',
    [...solver.documentVariables(), ...solver.parameters()],
    (entry) => typeof entry.value === 'number' ? String(entry.value) : entry.value,
  );
  assert.equal(refreshedText, 'Bracket / P-200');
});

test('document metadata persists through solver snapshots', () => {
  const solver = new SolverController();
  solver.setDocumentMetadata({
    documentTitle: 'Mounting Plate',
    revision: 'B',
    revisionDescription: 'Hole pattern updated',
    projectionStandard: 'First angle',
  });
  solver.setDocumentContext({ fileName: 'Mounting Plate' });
  const snapshot = solver.getSketchSnapshot();

  const restored = new SolverController();
  restored.loadSketch(snapshot);
  assert.equal(restored.getDocumentMetadata().documentTitle, 'Mounting Plate');
  assert.equal(restored.getDocumentMetadata().revision, 'B');
  assert.equal(restored.getDocumentMetadata().projectionStandard, 'First angle');
  assert.equal(restored.documentVariables().find((entry) => entry.name === 'FileName').value, 'Mounting Plate');
});

test('disabled Stack geometry is excluded from drawing bounding variables', () => {
  const solver = new SolverController();
  solver.loadSketch({
    stackState: {
      activeStackId: 'stack-a',
      stacks: [{ id: 'stack-a', name: 'Stack A' }, { id: 'stack-b', name: 'Stack B' }],
    },
    entities: [
      { id: 'line-a', type: 'line', stackId: 'stack-a', start: [0, 0], end: [10, 5] },
      { id: 'line-b', type: 'line', stackId: 'stack-b', start: [0, 0], end: [1000, 500] },
    ],
  });
  solver.setEnabledStackIds(['stack-a']);
  const byName = new Map(solver.documentVariables().map((entry) => [entry.name, entry.value]));

  assert.equal(byName.get('BoundingBoxWidth'), 10);
  assert.equal(byName.get('BoundingBoxHeight'), 5);
});
