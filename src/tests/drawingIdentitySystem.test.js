import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  IDENTITY_ARCHITECTURE_VERSION,
  cloneDrawingIdentityGraph,
  identityAudit,
  migrateDrawingIdentities,
  remapDrawingIdentityGraph,
} from '../../packages/paramagic-core/src/modules/DrawingIdentitySystem.js';
import { createUuid, isUuid } from '../../packages/paramagic-core/src/modules/IdentitySystem.js';
import {
  createIndependentDrawingSave,
  parseDrawingText,
  serializeDrawingJson,
} from '../../packages/paramagic-core/src/modules/DrawingIO.js';

function legacyDrawing() {
  return {
    entities: [{ id: 'line-a', type: 'line', stackId: 'stack-default', start: [0, 0], end: [10, 0] }],
    constraints: [{
      id: 'constraint-a',
      type: 'Horizontal',
      stackId: 'stack-default',
      featureRefs: [{ kind: 'segment', recordId: 'line-a', index: 0 }],
    }],
    parameters: [],
    dimensionAnnotations: [],
    classes: [{ id: 'class-x', name: 'Default', systemRole: 'default-class', removable: false }],
    activeClassId: 'class-x',
    extensions: {
      stacks: {
        activeStackId: 'stack-default',
        stacks: [{ id: 'stack-default', name: 'Default', systemRole: 'default-stack', removable: false }],
      },
    },
  };
}

test('legacy drawing declarations and references migrate to one UUID graph', () => {
  const { drawing, idMap, unresolved, errors } = migrateDrawingIdentities(legacyDrawing(), {
    allowUnresolvedLegacyReferences: false,
  });
  assert.equal(errors.length, 0);
  assert.equal(unresolved.length, 0);
  assert.equal(drawing.identityArchitectureVersion, IDENTITY_ARCHITECTURE_VERSION);
  assert.equal(isUuid(drawing.drawingId), true);
  assert.equal(drawing.entities[0].id, idMap.get('line-a'));
  assert.equal(drawing.constraints[0].featureRefs[0].recordId, drawing.entities[0].id);
  assert.equal(drawing.constraints[0].stackId, drawing.extensions.stacks.stacks[0].id);
  assert.equal(drawing.activeClassId, drawing.classes[0].id);
  assert.equal(identityAudit(drawing).valid, true);
});

test('identity remapping clones declarations and internal references atomically', () => {
  const canonical = migrateDrawingIdentities(legacyDrawing()).drawing;
  const { drawing: copy, idMap } = remapDrawingIdentityGraph(canonical);
  assert.notEqual(copy.drawingId, canonical.drawingId);
  assert.notEqual(copy.entities[0].id, canonical.entities[0].id);
  assert.equal(copy.constraints[0].featureRefs[0].recordId, copy.entities[0].id);
  assert.equal(copy.constraints[0].featureRefs[0].recordId, idMap.get(canonical.entities[0].id));
  assert.equal(identityAudit(copy).valid, true);
});

test('independent Save As cloning creates a disjoint graph while ordinary migration preserves IDs', () => {
  const canonical = migrateDrawingIdentities(legacyDrawing()).drawing;
  const ordinarySave = migrateDrawingIdentities(canonical).drawing;
  const { drawing: independent, idMap } = cloneDrawingIdentityGraph(canonical);
  const originalIds = new Set([
    canonical.drawingId,
    canonical.entities[0].id,
    canonical.constraints[0].id,
    canonical.classes[0].id,
    canonical.extensions.stacks.stacks[0].id,
  ]);
  const copiedIds = [
    independent.drawingId,
    independent.entities[0].id,
    independent.constraints[0].id,
    independent.classes[0].id,
    independent.extensions.stacks.stacks[0].id,
  ];

  assert.equal(ordinarySave.drawingId, canonical.drawingId);
  assert.equal(ordinarySave.entities[0].id, canonical.entities[0].id);
  assert.equal(copiedIds.every((id) => isUuid(id) && !originalIds.has(id)), true);
  assert.equal(independent.constraints[0].featureRefs[0].recordId, independent.entities[0].id);
  assert.equal(independent.constraints[0].stackId, independent.extensions.stacks.stacks[0].id);
  assert.equal(idMap.get(canonical.entities[0].id), independent.entities[0].id);
  assert.equal(identityAudit(independent).valid, true);
});

test('independent Save As cloning remaps every nested Stack parent to the cloned tree', () => {
  const canonical = migrateDrawingIdentities(legacyDrawing()).drawing;
  const parent = canonical.extensions.stacks.stacks[0];
  const childId = createUuid();
  const grandchildId = createUuid();
  canonical.stackArchitectureVersion = 4;
  canonical.extensions.stacks.version = 4;
  canonical.extensions.stacks.activeStackId = grandchildId;
  canonical.extensions.stacks.stacks.push(
    {
      id: childId,
      name: 'Child',
      parentStackId: parent.id,
      sourceStackId: childId,
    },
    {
      id: grandchildId,
      name: 'Grandchild',
      parentStackId: childId,
      sourceStackId: grandchildId,
    },
  );

  const { drawing: independent, idMap } = cloneDrawingIdentityGraph(canonical);
  const copiedChild = independent.extensions.stacks.stacks.find(({ name }) => name === 'Child');
  const copiedGrandchild = independent.extensions.stacks.stacks.find(({ name }) => name === 'Grandchild');

  assert.equal(copiedChild.parentStackId, idMap.get(parent.id));
  assert.equal(copiedGrandchild.parentStackId, idMap.get(childId));
  assert.equal(independent.extensions.stacks.activeStackId, idMap.get(grandchildId));
  assert.doesNotThrow(() => serializeDrawingJson(independent, 'Nested Save As'));
  assert.equal(identityAudit(independent).valid, true);
});

test('independent Save As returns the exact validated drawing represented by the written bytes', () => {
  const canonical = migrateDrawingIdentities(legacyDrawing()).drawing;
  const parent = canonical.extensions.stacks.stacks[0];
  const childId = createUuid();
  canonical.stackArchitectureVersion = 4;
  canonical.extensions.stacks.version = 4;
  canonical.extensions.stacks.activeStackId = childId;
  canonical.extensions.stacks.stacks.push({
    id: childId,
    name: 'Child',
    parentStackId: parent.id,
    sourceStackId: childId,
  });

  const saved = createIndependentDrawingSave(canonical, 'Nested Save As');
  const writtenDrawing = parseDrawingText('Nested Save As.paramagic', saved.content);
  const savedParent = saved.drawing.extensions.stacks.stacks.find(({ name }) => name === 'Default');
  const savedChild = saved.drawing.extensions.stacks.stacks.find(({ name }) => name === 'Child');

  assert.deepEqual(saved.drawing, writtenDrawing);
  assert.equal(savedChild.parentStackId, savedParent.id);
  assert.notEqual(savedParent.id, parent.id);
  assert.notEqual(savedChild.id, childId);
  assert.equal(identityAudit(saved.drawing).valid, true);
});

test('identity audit rejects extension identities without an owning schema', () => {
  const canonical = migrateDrawingIdentities(legacyDrawing()).drawing;
  canonical.extensions.unregisteredTool = {
    items: [{ id: createUuid(), ownerId: canonical.entities[0].id }],
  };
  const audit = identityAudit(canonical);
  assert.equal(audit.valid, false);
  assert.ok(audit.errors.some(({ code }) => code === 'unregistered-extension-identity'));
  assert.ok(audit.errors.some(({ code }) => code === 'unclassified-extension-identity-field'));
});

test('identity migration does not rewrite ordinary text that resembles an ID', () => {
  const input = legacyDrawing();
  input.entities.push({ id: 'text-a', type: 'text', text: 'line-a', stackId: 'stack-default' });
  const migrated = migrateDrawingIdentities(input).drawing;
  assert.equal(migrated.entities[1].text, 'line-a');
});

test('canonical UUID declarations are preserved during migration', () => {
  const entityId = createUuid();
  const drawingId = createUuid();
  const input = {
    drawingId,
    entities: [{ id: entityId, type: 'point', point: [0, 0] }],
    constraints: [],
    parameters: [],
    dimensionAnnotations: [],
    classes: [],
    extensions: {},
  };
  const migrated = migrateDrawingIdentities(input).drawing;
  assert.equal(migrated.drawingId, drawingId);
  assert.equal(migrated.entities[0].id, entityId);
});

test('ordinary save and open preserve every canonical UUID exactly', () => {
  const canonical = migrateDrawingIdentities(legacyDrawing()).drawing;
  const reopened = parseDrawingText('identity.paramagic', serializeDrawingJson(canonical, 'Identity'));
  assert.equal(reopened.drawingId, canonical.drawingId);
  assert.equal(reopened.entities[0].id, canonical.entities[0].id);
  assert.equal(reopened.constraints[0].id, canonical.constraints[0].id);
  assert.equal(reopened.constraints[0].featureRefs[0].recordId, canonical.entities[0].id);
  assert.equal(reopened.extensions.stacks.stacks[0].id, canonical.extensions.stacks.stacks[0].id);
});

test('canonical files fail closed before malformed declarations can be regenerated', () => {
  const canonical = readFileSync(new URL('../../tests/fixtures/paramagic/corrupt-canonical-identity.paramagic', import.meta.url), 'utf8');
  assert.throws(
    () => parseDrawingText('corrupt.paramagic', canonical),
    /entities\.0\.id.*not a UUID/,
  );
});

test('canonical files reject dangling references before entering the live drawing', () => {
  const canonical = migrateDrawingIdentities(legacyDrawing()).drawing;
  canonical.constraints[0].featureRefs[0].recordId = createUuid();
  assert.throws(
    () => parseDrawingText('corrupt.paramagic', JSON.stringify(canonical)),
    /featureRefs\.0\.recordId.*does not resolve/,
  );
});

test('canonical identity audit rejects references to the wrong record kind', () => {
  const canonical = migrateDrawingIdentities(legacyDrawing()).drawing;
  canonical.entities[0].classId = canonical.extensions.stacks.stacks[0].id;
  const audit = identityAudit(canonical);
  const error = audit.errors.find(({ code }) => code === 'wrong-reference-target-kind');
  assert.equal(error?.actualKind, 'stack');
  assert.deepEqual(error?.expectedKinds, ['class']);
  assert.match(error?.message || '', /entities\.0\.classId.*expected class/);
});

test('canonical identity audit requires exactly one Default Stack and Default Class role', () => {
  const canonical = migrateDrawingIdentities(legacyDrawing()).drawing;
  delete canonical.classes[0].systemRole;
  canonical.extensions.stacks.stacks.push({
    ...canonical.extensions.stacks.stacks[0],
    id: createUuid(),
  });
  const audit = identityAudit(canonical);
  assert.ok(audit.errors.some(({ code, role }) => code === 'missing-system-role' && role === 'default-class'));
  assert.ok(audit.errors.some(({ code, role }) => code === 'duplicate-system-role' && role === 'default-stack'));
});
