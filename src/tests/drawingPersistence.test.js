import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeDrawingData, serializeDrawingJson, createIndependentDrawingSave, parseDrawingText } from '../../packages/paramagic-core/src/modules/DrawingIO.js';
import { serializePortableDrawingJson, parsePortableDrawingText } from '../../packages/paramagic-core/src/modules/ImageSystem.js';
import { createUuid } from '../../packages/paramagic-core/src/modules/IdentitySystem.js';
import { serializePreservedDrawing } from '../../packages/paramagic-core/src/modules/DrawingPersistence.js';

const base = () => normalizeDrawingData({
  entities: [{ id: 'line', type: 'line', start: [0, 0], end: [20, 0] }],
});

for (const [label, corrupt] of [
  ['dangling copy reference', drawing => {
    drawing.dimensionAnnotations = [{ id: createUuid(), anchors: { end: { derivedFeature: { copyId: createUuid() } } } }];
  }],
  ['duplicate declarations', drawing => { drawing.entities.push(structuredClone(drawing.entities[0])); }],
  ['wrong target kind', drawing => { drawing.entities[0].classId = drawing.extensions.stacks.stacks[0].id; }],
  ['unregistered extension', drawing => { drawing.extensions.unknown = { id: createUuid(), payload: 'keep me' }; }],
]) {
  test(`Save and Save As preserve original data with ${label}`, () => {
    const drawing = base();
    corrupt(drawing);
    const before = structuredClone(drawing);
    const saved = JSON.parse(serializeDrawingJson(drawing, label));
    const independent = createIndependentDrawingSave(drawing, label);
    for (const output of [saved, JSON.parse(independent.content)]) {
      assert.ok(output.saveDiagnostics.errors.length);
      for (const key of Object.keys(before)) assert.deepEqual(output[key], before[key], key);
    }
    assert.equal(independent.requiresReload, false);
    assert.deepEqual(drawing, before);
  });
}

test('dangling references survive repeated Save, Open, and JSON Open', async () => {
  const drawing = base();
  const missingId = createUuid();
  drawing.dimensionAnnotations = [{ id: createUuid(), anchors: { end: { derivedFeature: { copyId: missingId } } } }];
  let saved = serializeDrawingJson(drawing);
  for (let cycle = 0; cycle < 3; cycle++) {
    const opened = parseDrawingText('broken.paramagic', saved);
    assert.equal(opened.dimensionAnnotations[0].anchors.end.derivedFeature.copyId, missingId);
    assert.ok(opened.identityWarnings.some(issue => issue.path === 'dimensionAnnotations.0.anchors.end.derivedFeature.copyId'));
    const portable = await parsePortableDrawingText('broken.json', saved);
    assert.equal(portable.dimensionAnnotations[0].anchors.end.derivedFeature.copyId, missingId);
    saved = serializeDrawingJson(opened);
  }
});

test('an audit or normalization exception cannot prevent preserving a JSON drawing', () => {
  const drawing = { entities: { malformed: true }, extensions: { unknown: { diagnostic: 'retain' } } };
  const saved = JSON.parse(serializeDrawingJson(drawing));
  assert.deepEqual(saved.entities, drawing.entities);
  assert.deepEqual(saved.extensions, drawing.extensions);
  assert.ok(saved.saveDiagnostics.errors.some(issue => issue.code === 'identity-audit-failed'));
  assert.equal(JSON.parse(serializePreservedDrawing({}, 'Empty', new Error('failure'))).name, 'Empty');
});

test('missing portable images preserve references and still embed available images', async () => {
  const drawing = base();
  drawing.entities[0].appearance = { fillType: 'image', fillImageReference: 'user/missing', strokeType: 'image', strokeImageReference: 'user/available' };
  const content = await serializePortableDrawingJson(drawing, 'Images', {
    fetchAsset: async reference => {
      if (reference === 'user/missing') throw new Error('Image not found');
      return { bytes: new Uint8Array([1, 2, 3]), mimeType: 'image/png', sha256: 'a'.repeat(64) };
    },
  });
  const saved = JSON.parse(content);
  assert.equal(saved.entities[0].appearance.fillImageReference, 'user/missing');
  assert.equal(saved.embeddedAssets.images[0].reference, 'user/available');
  assert.ok(saved.saveDiagnostics.errors.some(issue => issue.reference === 'user/missing'));
});
