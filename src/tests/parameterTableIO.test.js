import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createParameterTableExport,
  normalizeImportedParameterRows,
  parameterTableExportRows,
  readParameterTableFile,
  replaceParametersFromRows,
} from '../../packages/paramagic-core/src/modules/ParameterTableIO.js';

test('parameter table exports include Parameters, Dimensions, and Controls with type metadata', () => {
  const rows = parameterTableExportRows([
    { name: 'width', expression: '100', kind: 'user' },
    { name: 'd1', expression: 'width', kind: 'dimension' },
    { name: 'c1', expression: '4', kind: 'control' },
  ]);
  assert.deepEqual(rows, [
    ['Name', 'Expression', 'Type'],
    ['width', '100', 'Parameter'],
    ['d1', 'width', 'Dimension'],
    ['c1', '4', 'Control'],
  ]);
});

test('JSON exports preserve the three parameter types', async () => {
  const output = await createParameterTableExport([
    { name: 'width', expression: '100', kind: 'user' },
    { name: 'd1', expression: 'width', kind: 'dimension' },
    { name: 'c1', expression: '4', kind: 'control' },
  ], 'json');
  const parsed = JSON.parse(await output.blob.text());
  assert.deepEqual(parsed.map(({ Type }) => Type), ['Parameter', 'Dimension', 'Control']);
});

test('CSV, XLS, and XLSX exports round-trip through the parameter table reader', async () => {
  const entries = [
    { name: 'width', expression: '100', kind: 'user' },
    { name: 'd1', expression: 'width', kind: 'dimension' },
    { name: 'c1', expression: '4', kind: 'control' },
  ];

  for (const format of ['csv', 'xls', 'xlsx']) {
    const output = await createParameterTableExport(entries, format);
    assert.ok(output.blob.size > 0, `${format} export should contain file data`);
    const workbook = await readParameterTableFile({
      name: `Parameters.${format}`,
      text: () => output.blob.text(),
      arrayBuffer: () => output.blob.arrayBuffer(),
    });
    assert.deepEqual(workbook.rowsForSheet(workbook.sheetNames[0]), [
      ['Name', 'Expression', 'Type'],
      ['width', '100', 'Parameter'],
      ['d1', 'width', 'Dimension'],
      ['c1', '4', 'Control'],
    ]);
  }
});

test('parameter imports consume two columns and skip blank, header-like, and duplicate rows', () => {
  const normalized = normalizeImportedParameterRows([
    ['Name', 'Expression', 'ignored'],
    ['width', '100', 'Parameter'],
    ['height', 'Parameter Expression', 'ignored'],
    ['', '', 'ignored'],
    ['width', '200', 'ignored'],
    ['depth', '50', 'ignored'],
  ]);
  assert.deepEqual(normalized.rows.map(({ name, expression }) => ({ name, expression })), [
    { name: 'width', expression: '100' },
    { name: 'depth', expression: '50' },
  ]);
  assert.deepEqual(normalized.skipped, { blank: 1, header: 2, duplicate: 1 });
});

function fakeSolver() {
  let nextId = 1;
  const entries = [
    { id: 'user-old', name: 'old', expression: '1', kind: 'user', order: 0 },
    { id: 'dimension-1', name: 'd1', expression: '10', kind: 'dimension', computed: false, order: 1 },
    { id: 'control-1', name: 'c1', expression: '2', kind: 'control', computed: false, order: 2 },
  ];
  return {
    parameters: () => entries.slice().sort((a, b) => a.order - b.order).map((entry) => ({ ...entry })),
    removeParameter: (id) => {
      const index = entries.findIndex((entry) => entry.id === id && entry.kind === 'user');
      if (index < 0) return false;
      entries.splice(index, 1);
      return true;
    },
    createParameter: ({ name, expression }) => {
      const entry = { id: `import-${nextId++}`, name: name || `p${nextId}`, expression, kind: 'user', order: entries.length };
      entries.push(entry);
      return { ...entry };
    },
    updateParameter: (id, patch) => {
      const entry = entries.find((candidate) => candidate.id === id);
      Object.assign(entry, patch);
      return { entry: { ...entry }, result: { status: 'unchanged' } };
    },
    reorderParameter: (id) => {
      const moving = entries.find((entry) => entry.id === id);
      const ordered = entries.filter((entry) => entry.id !== id);
      ordered.push(moving);
      ordered.forEach((entry, order) => { entry.order = order; });
      entries.splice(0, entries.length, ...ordered);
      return true;
    },
  };
}

test('Replace User Parameters preserves Dimension and Control values', () => {
  const solver = fakeSolver();
  const summary = replaceParametersFromRows({
    solver,
    scope: 'user',
    rows: [
      { name: 'newWidth', expression: '25' },
      { name: 'd1', expression: '50' },
      { name: 'c1', expression: '8' },
    ],
  });
  const entries = solver.parameters();
  assert.equal(entries.find(({ name }) => name === 'old'), undefined);
  assert.equal(entries.find(({ name }) => name === 'newWidth').expression, '25');
  assert.equal(entries.find(({ name }) => name === 'd1').expression, '10');
  assert.equal(entries.find(({ name }) => name === 'c1').expression, '2');
  assert.equal(summary.skippedProtected, 2);
});

test('Replace ALL Existing Parameters updates matching Dimensions and Controls', () => {
  const solver = fakeSolver();
  const summary = replaceParametersFromRows({
    solver,
    scope: 'all',
    rows: [
      { name: 'newWidth', expression: '25' },
      { name: 'd1', expression: '50' },
      { name: 'c1', expression: '8' },
    ],
  });
  const entries = solver.parameters();
  assert.equal(entries.find(({ name }) => name === 'old'), undefined);
  assert.equal(entries.find(({ name }) => name === 'd1').expression, '50');
  assert.equal(entries.find(({ name }) => name === 'c1').expression, '8');
  assert.equal(summary.inserted, 1);
  assert.equal(summary.replaced, 2);
});
