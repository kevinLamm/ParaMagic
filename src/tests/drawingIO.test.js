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
  assert.equal(parsed.drawingUnit, 'in');
  assert.equal(parsed.dxfExportUnit, 'in');
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
    drawingUnit: 'in',
    dxfExportUnit: 'in',
    entities: [
      { id: 'line', type: 'line', start: [0, 0], end: [1, 2] },
      { id: 'circle', type: 'circle', center: [3, 1], radius: 0.5 },
      { id: 'polyline', type: 'polyline', points: [[0, 0], [1, 0], [1, 1]] },
    ],
  };
  const dxf = serializeDxf(source);
  assert.match(dxf, /\$INSUNITS/);
  const restored = parseDxf(dxf);
  assert.equal(restored.drawingUnit, 'in');
  assert.equal(restored.dxfExportUnit, 'in');
  assert.equal(restored.entities.length, 3);
  assert.deepEqual(restored.entities[0].start, [0, 0]);
  near(restored.entities[0].end[0], 25.4);
  near(restored.entities[0].end[1], 50.8);
  near(restored.entities[1].radius, 12.7);
  restored.entities[2].points.flat().forEach((value, index) => near(value, source.entities[2].points.flat()[index] * 25.4));
});

test('DXF export converts drawing coordinates into the selected DXF unit', () => {
  const source = {
    drawingUnit: 'in',
    dxfExportUnit: 'mm',
    entities: [{ id: 'line', type: 'line', start: [0, 0], end: [1, 2] }],
  };
  const dxf = serializeDxf(source);
  assert.match(dxf, /\$INSUNITS\n70\n4/);
  assert.match(dxf, /\n11\n25\.4\n21\n-50\.8/);
  const restored = parseDxf(dxf);
  assert.equal(restored.drawingUnit, 'mm');
  assert.equal(restored.dxfExportUnit, 'mm');
  near(restored.entities[0].end[0], 25.4);
  near(restored.entities[0].end[1], 50.8);
});

test('DXF export applies every drawing-to-export unit mismatch consistently', () => {
  const coordinate = (drawingUnit, dxfExportUnit) => {
    const dxf = serializeDxf({
      drawingUnit,
      dxfExportUnit,
      entities: [{ id: 'line', type: 'line', start: [0, 0], end: [2, 0] }],
    });
    return Number(/\n11\n([^\n]+)/.exec(dxf)?.[1]);
  };

  near(coordinate('in', 'mm'), 50.8);
  near(coordinate('mm', 'in'), 2 / 25.4);
  near(coordinate('cm', 'm'), 0.02);
  near(coordinate('m', 'ft'), 2 * 1000 / 304.8);
  near(coordinate('ft', 'cm'), 60.96);
  near(coordinate('mm', 'mm'), 2);
});

test('DXF unit scaling is applied to every supported geometric coordinate and radius', () => {
  const dxf = serializeDxf({
    drawingUnit: 'in',
    dxfExportUnit: 'mm',
    entities: [
      { id: 'line', type: 'line', start: [1, 2], end: [3, 4] },
      { id: 'circle', type: 'circle', center: [5, 6], radius: 2 },
      { id: 'arc', type: 'arc', center: [8, 8], radius: 2, start: [10, 8], arcPoint: [8, 6], end: [6, 8] },
      { id: 'polyline', type: 'polyline', points: [[7, 8], [9, 10]] },
    ],
  });
  assert.match(dxf, /\n10\n25\.4\n20\n-50\.8\n11\n76\.19999999999999\n21\n-101\.6/);
  assert.match(dxf, /\nCIRCLE\n[\s\S]*?\n10\n127\n20\n-152\.39999999999998\n40\n50\.8/);
  assert.match(dxf, /\nARC\n[\s\S]*?\n10\n203\.2\n20\n-203\.2\n40\n50\.8/);
  assert.match(dxf, /\nLWPOLYLINE\n[\s\S]*?\n10\n177\.79999999999998\n20\n-203\.2\n10\n228\.6\n20\n-254/);
});

test('insert keeps the destination drawing and DXF units', () => {
  const merged = mergeDrawingData(
    { drawingUnit: 'cm', dxfExportUnit: 'm' },
    { drawingUnit: 'mm', dxfExportUnit: 'ft' },
  );
  assert.equal(merged.drawingUnit, 'cm');
  assert.equal(merged.dxfExportUnit, 'm');
});

test('fillets persist in JSON, remap source references on insert, and export as trimmed DXF geometry', () => {
  const source = {
    entities: [
      { id: 'horizontal', type: 'line', start: [0, 0], end: [100, 0] },
      { id: 'vertical', type: 'line', start: [0, 0], end: [0, 100] },
      {
        id: 'corner-fillet',
        type: 'fillet',
        sourceA: { recordId: 'horizontal', index: 0 },
        sourceB: { recordId: 'vertical', index: 0 },
        radius: 10,
        radiusExpression: '10 mm',
      },
    ],
  };
  const parsed = JSON.parse(serializeDrawingJson(source, 'Filleted Corner'));
  assert.equal(parsed.entities[2].type, 'fillet');
  assert.equal(parsed.entities[2].radiusExpression, '10 mm');

  const merged = mergeDrawingData({}, source);
  const mergedFillet = merged.entities.find(({ type }) => type === 'fillet');
  assert.notEqual(mergedFillet.sourceA.recordId, 'horizontal');
  assert.notEqual(mergedFillet.sourceB.recordId, 'vertical');
  assert.ok(merged.entities.some(({ id }) => id === mergedFillet.sourceA.recordId));
  assert.ok(merged.entities.some(({ id }) => id === mergedFillet.sourceB.recordId));

  const dxf = serializeDxf(source);
  assert.equal((dxf.match(/\nLINE\n/g) || []).length, 2);
  assert.equal((dxf.match(/\nARC\n/g) || []).length, 1);
  assert.doesNotMatch(dxf, /\n10\n0\n20\n0\n11\n3\.937/);
});
