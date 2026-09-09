import assert from 'node:assert/strict';
import test from 'node:test';
import {
  bindDeferredColorPicker,
  createGeometryAppearanceSystem,
} from '../../packages/paramagic-core/src/modules/GeometryAppearanceSystem.js';
import { createClassSystem } from '../../packages/paramagic-core/src/modules/ClassSystem.js';

function createFixture({ selectedSegment = null } = {}) {
  const records = [
    {
      id: 'edge-a',
      recordType: 'geometry',
      entity: {
        id: 'edge-a',
        type: 'line',
        start: [0, 0],
        end: [10, 0],
        appearance: { fillColor: '#ffffff', strokeColor: '#111111' },
      },
    },
    {
      id: 'edge-b',
      recordType: 'geometry',
      entity: {
        id: 'edge-b',
        type: 'line',
        start: [10, 0],
        end: [10, 10],
        appearance: { fillColor: '#ffffff', strokeColor: '#222222' },
      },
    },
  ];
  const selectedIds = new Set(records.map(({ id }) => id));
  const solver = {
    evaluateParameterExpression: (expression) => Number(expression),
    evaluateDrawingLengthExpression: (expression) => Number(expression),
    updateEntityAppearances(updates) {
      return updates.map(({ id, appearance }) => {
        const record = records.find((candidate) => candidate.id === id);
        return {
          ...record.entity,
          appearance: { ...record.entity.appearance, ...appearance },
        };
      });
    },
  };
  const system = createGeometryAppearanceSystem({
    records,
    selectedIds,
    solver,
    getSelectedSegment: () => selectedSegment,
  });
  return { records, system };
}

test('color picker input only syncs the expression and commits appearance on change', () => {
  const picker = new EventTarget();
  const expressionInput = { value: '#ffffff' };
  const commits = [];
  picker.value = '#123456';
  const unbind = bindDeferredColorPicker({
    picker,
    expressionInput,
    onCommit: (value) => commits.push(value),
  });

  picker.dispatchEvent(new Event('input'));
  assert.equal(expressionInput.value, '#123456');
  assert.deepEqual(commits, []);

  picker.dispatchEvent(new Event('change'));
  assert.deepEqual(commits, ['#123456']);

  unbind();
  picker.value = '#abcdef';
  picker.dispatchEvent(new Event('change'));
  assert.deepEqual(commits, ['#123456']);
});

test('a stroke edit targets the selected segment record while fill remains region-wide', () => {
  const { records, system } = createFixture({ selectedSegment: { recordId: 'edge-b', index: 0 } });

  const result = system.setSelectedAppearance({ fillColor: '#abcdef', strokeColor: '#12abef' });

  assert.equal(result.success, true);
  assert.equal(records[0].entity.appearance.fillColor, '#abcdef');
  assert.equal(records[1].entity.appearance.fillColor, '#abcdef');
  assert.equal(records[0].entity.appearance.strokeColor, '#111111');
  assert.equal(records[1].entity.appearance.strokeColor, '#12abef');
  assert.equal(system.selectionProperties().strokeColor, '#12abef');
});

test('without a segment target a stroke edit applies to the selected geometry records', () => {
  const { records, system } = createFixture();

  const result = system.setSelectedAppearance({ strokeColor: '#12abef' });

  assert.equal(result.success, true);
  assert.equal(records[0].entity.appearance.strokeColor, '#12abef');
  assert.equal(records[1].entity.appearance.strokeColor, '#12abef');
});

test('a derived closed-region provider can authorize an image fill for its open source edges', () => {
  const { records, system } = createFixture();
  const patch = { fillExpression: 'basic/Fabric/linen.webp' };

  const rejected = system.setSelectedAppearance(patch, { recordIds: records.map(({ id }) => id) });
  assert.equal(rejected.success, false);
  assert.match(rejected.error, /complete closed objects/);

  const applied = system.setSelectedAppearance(patch, {
    recordIds: records.map(({ id }) => id),
    allowImageFill: true,
  });
  assert.equal(applied.success, true);
  assert.ok(records.every(({ entity }) => entity.appearance.fillType === 'image'));
  assert.ok(records.every(({ entity }) => entity.appearance.fillImageReference === patch.fillExpression));
});

test('stroke properties report the focused segment instead of a mixed region value', () => {
  const { system } = createFixture({ selectedSegment: { recordId: 'edge-b', index: 0 } });

  const properties = system.selectionProperties();

  assert.equal(properties.strokeColor, '#222222');
  assert.equal(properties.mixedStrokeColor, false);
  assert.equal(properties.canEditFill, true);
  assert.equal(properties.canEditStroke, true);
});

test('resolved boundary paint does not mask individual source strokes', () => {
  const { records, system } = createFixture();

  const resolved = system.resolvedBoundaryAppearance(records[0].entity, {
    polygon: [[0, 0], [10, 0], [10, 10], [0, 10]],
    boundaryId: 'region-1',
  });

  assert.equal(resolved.fillPaint, '#ffffff');
  assert.equal(resolved.boundaryStroke, 'none');
  assert.equal(resolved.boundaryStrokeWidth, 0);
  assert.equal(resolved.boundaryStrokeOpacity, 0);
});

test('Properties panel edits become persistent class overrides without freezing inherited properties', () => {
  const records = [{
    id: 'edge-a',
    recordType: 'geometry',
    entity: { id: 'edge-a', type: 'line', start: [0, 0], end: [10, 0] },
  }];
  const selectedIds = new Set(['edge-a']);
  const classSystem = createClassSystem({ records, selectedIds });
  const first = classSystem.addClass('First').class;
  classSystem.updateClassProperties(first.id, { fillExpression: '#ff0000', strokeThickness: 2 });
  records[0].entity = classSystem.assignEntity(records[0].entity, first.id);
  const second = classSystem.addClass('Second').class;
  classSystem.updateClassProperties(second.id, { fillExpression: '#00ff00', strokeThickness: 8 });
  const solver = {
    evaluateParameterExpression: Number,
    evaluateDrawingLengthExpression: Number,
    updateEntity(entity) { return entity; },
  };
  const appearance = createGeometryAppearanceSystem({
    records,
    selectedIds,
    solver,
    resolveEntityAppearance: classSystem.resolveAppearance,
    applyEntityAppearanceOverrides: classSystem.applyAppearanceOverrides,
  });

  assert.equal(appearance.setSelectedAppearance({ fillExpression: '#abcdef' }).success, true);
  classSystem.setRecordClassIds(['edge-a'], second.id);
  const resolved = appearance.appearance(records[0].entity);

  assert.equal(resolved.fillExpression, '#abcdef');
  assert.equal(resolved.strokeThickness, 8);
  assert.deepEqual(records[0].entity.classPropertyOverrides, ['fill']);
});


test('appearance evaluation is reused and invalidated when parameter values change', () => {
  let value = 50, evaluations = 0, changed;
  const solver = {
    subscribe(listener) { changed = listener; },
    evaluateParameterExpression(expression) { evaluations += 1; return expression === 'opacity' ? value : Number(expression); },
    evaluateDrawingLengthExpression: Number,
  };
  const system = createGeometryAppearanceSystem({ records: [], selectedIds: new Set(), solver });
  const entity = { id: 'shape', type: 'circle', radius: 10, appearance: { fillOpacityExpression: 'opacity' } };
  const first = system.appearance(entity);
  const count = evaluations;
  assert.equal(first.fillOpacity, 0.5);
  assert.equal(system.appearance(entity), first);
  assert.equal(evaluations, count);
  value = 25;
  changed();
  assert.equal(system.appearance(entity).fillOpacity, 0.25);
  entity.appearance.strokeColor = '#ff0000';
  assert.equal(system.appearance(entity).strokeColor, '#ff0000');
});
