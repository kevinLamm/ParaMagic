import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeDrawingData, parseDxf, serializeDxf, serializeDrawingJson } from '../modules/DrawingIO.js';

const near = (actual, expected, tolerance = 1e-8) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);

test('JSON export includes drawing parameters as first-class data', () => {
  const json = serializeDrawingJson({
    drawingUnit: 'in',
    entities: [{ id: 'line-1', type: 'line', start: [0, 0], end: [25.4, 0] }],
    constraints: [],
    parameters: [{ id: 'parameter-1', name: 'width', kind: 'user', type: 'Expression', expression: '12 in', value: 304.8, order: 0 }],
    dimensionAnnotations: [],
  }, 'Parameterized Part');
  const parsed = JSON.parse(json);
  assert.equal(parsed.format, 'ParaMagic Drawing');
  assert.equal(parsed.name, 'Parameterized Part');
  assert.equal(parsed.parameters[0].name, 'width');
  assert.equal(parsed.parameters[0].expression, '12 in');
});

test('insert remaps entity IDs and conflicting parameter names and references', () => {
  const base = {
    entities: [{ id: 'shared-line', type: 'line', start: [0, 0], end: [10, 0] }],
    parameters: [{ id: 'base-width', name: 'width', kind: 'user', expression: '10', value: 10, order: 0 }],
  };
  const inserted = {
    entities: [{ id: 'shared-line', type: 'line', start: [20, 0], end: [30, 0] }],
    parameters: [
      { id: 'insert-width', name: 'width', kind: 'user', expression: '20', value: 20, order: 0 },
      { id: 'insert-double', name: 'double', kind: 'user', expression: 'width * 2', value: 40, order: 1 },
    ],
  };
  const merged = mergeDrawingData(base, inserted);
  assert.equal(merged.entities.length, 2);
  assert.notEqual(merged.entities[0].id, merged.entities[1].id);
  assert.deepEqual(merged.parameters.map(({ name }) => name), ['width', 'width_2', 'double']);
  assert.equal(merged.parameters[2].expression, 'width_2 * 2');
});

test('insert preserves appearances and remaps composite drawing-command IDs', () => {
  const composite = { id: 'rectangle-command', kind: 'rectangle', closed: true, count: 2 };
  const inserted = {
    entities: [
      { id: 'a', type: 'line', start: [0, 0], end: [10, 0], composite: { ...composite, index: 0 }, appearance: { fillColor: '#336699', strokeThickness: 2, zIndex: 1 } },
      { id: 'b', type: 'line', start: [10, 0], end: [0, 0], composite: { ...composite, index: 1 }, appearance: { fillColor: '#336699', strokeThickness: 2, zIndex: 2 } },
    ],
  };
  const merged = mergeDrawingData({}, inserted);
  assert.notEqual(merged.entities[0].composite.id, 'rectangle-command');
  assert.equal(merged.entities[0].composite.id, merged.entities[1].composite.id);
  assert.deepEqual(merged.entities[0].appearance, { fillColor: '#336699', strokeThickness: 2, zIndex: 1 });
});

test('DXF export and import round-trip supported geometry in inch units', () => {
  const source = {
    entities: [
      { id: 'line', type: 'line', start: [0, 0], end: [25.4, 50.8] },
      { id: 'circle', type: 'circle', center: [76.2, 25.4], radius: 12.7 },
      { id: 'polyline', type: 'polyline', points: [[0, 0], [25.4, 0], [25.4, 25.4]] },
    ],
  };
  const dxf = serializeDxf(source);
  assert.match(dxf, /\$INSUNITS/);
  const restored = parseDxf(dxf);
  assert.equal(restored.entities.length, 3);
  assert.deepEqual(restored.entities[0].start, [0, 0]);
  near(restored.entities[0].end[0], 25.4);
  near(restored.entities[0].end[1], 50.8);
  near(restored.entities[1].radius, 12.7);
  restored.entities[2].points.flat().forEach((value, index) => near(value, source.entities[2].points.flat()[index]));
});
