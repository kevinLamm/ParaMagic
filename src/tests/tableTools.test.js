import test from 'node:test';
import assert from 'node:assert/strict';
import {
  insertTableColumn,
  insertTableRow,
  deleteTableRows,
  isTableCellMerged,
  mergeTableCells,
  normalizeTableEntity,
  tableCellRects,
  tableCornerPoints,
  tableDimensions,
  tableCornerIndexFromSolverIndex,
  tableCellTextSvgLayout,
  tableCellClipboardText,
  tableCellClipboardValue,
  tableConstraintEntity,
  tableSolverCornerIndex,
  unmergeTableCells,
} from '../../packages/paramagic-core/src/modules/TableTools.js';

function table() {
  return normalizeTableEntity({
    id: 'table-a',
    x: 10,
    y: 20,
    columns: [{ width: 50 }, { width: 70 }],
    rows: [{ height: 30 }, { height: 40 }],
  });
}

test('explicit two-by-two tables normalize with an editable cell grid and multiline disabled', () => {
  const entity = table();
  assert.equal(entity.type, 'table');
  assert.equal(entity.cells.length, 2);
  assert.equal(entity.cells[0].length, 2);
  assert.equal(entity.cells[0][0].multiline, false);
  assert.equal(entity.cells[0][0].textAlign, 'left');
  assert.equal(entity.cells[0][0].textVerticalAlign, 'top');
  assert.deepEqual(tableDimensions(entity), { width: 120, height: 70 });
  assert.deepEqual(tableCornerPoints(entity), [[10, 20], [130, 20], [130, 90], [10, 90]]);
});

test('new tables default to three columns and three rows', () => {
  const entity = normalizeTableEntity({ id: 'default-table' });
  assert.equal(entity.columns.length, 3);
  assert.equal(entity.rows.length, 3);
  assert.equal(entity.cells.length, 3);
  assert.equal(entity.cells.every((row) => row.length === 3), true);
});

test('table rows and columns insert after the selected index', () => {
  const withRow = insertTableRow(table(), 0);
  assert.equal(withRow.rows.length, 3);
  assert.equal(withRow.rows[1].height, 32);
  assert.equal(withRow.cells.length, 3);
  const withColumn = insertTableColumn(table(), 0);
  assert.equal(withColumn.columns.length, 3);
  assert.equal(withColumn.columns[1].width, 120);
  assert.equal(withColumn.cells[0].length, 3);
});

test('deleting a selected middle row preserves the remaining table rows', () => {
  const entity = normalizeTableEntity({
    ...table(),
    rows: [{ height: 20 }, { height: 30 }, { height: 40 }],
  });
  const deleted = deleteTableRows(entity, [1]);
  assert.equal(deleted.rows.length, 2);
  assert.deepEqual(deleted.rows.map((row) => row.height), [20, 40]);
  assert.equal(deleted.cells.length, 2);
  assert.equal(deleted.cells[1][0].multiline, false);
});

test('table cell rectangles and rectangular merge/unmerge preserve the anchor cell', () => {
  const merged = mergeTableCells(table(), [{ row: 0, column: 0 }, { row: 0, column: 1 }]);
  assert.equal(merged.cells[0][0].colSpan, 2);
  assert.equal(merged.cells[0][1].mergedInto.row, 0);
  assert.equal(isTableCellMerged(merged, 0, 0), true);
  assert.equal(isTableCellMerged(merged, 0, 1), true);
  assert.equal(tableCellRects(merged).length, 3);
  const unmerged = unmergeTableCells(merged, [{ row: 0, column: 1 }]);
  assert.equal(unmerged.cells[0][0].colSpan, 1);
  assert.equal(unmerged.cells[0][1].mergedInto, undefined);
  assert.equal(tableCellRects(unmerged).length, 4);
});

test('table corner handles map to the rectangular solver feature indices', () => {
  const entity = table();
  assert.deepEqual(tableConstraintEntity(entity), {
    id: 'table-a',
    type: 'table',
    x: 10,
    y: 20,
    width: 120,
    height: 70,
    appearance: entity.appearance,
  });
  assert.deepEqual([0, 1, 2, 3].map(tableSolverCornerIndex), [0, 1, 2, 3]);
  assert.deepEqual([0, 1, 2, 3].map(tableCornerIndexFromSolverIndex), [0, 1, 2, 3]);
});

test('table cell text layout supports horizontal and vertical alignment', () => {
  const rect = { x: 10, y: 20, width: 100, height: 50 };
  assert.deepEqual(tableCellTextSvgLayout(rect, { textAlign: 'center', textVerticalAlign: 'middle' }), {
    x: 60,
    y: 45,
    textAnchor: 'middle',
    dominantBaseline: 'middle',
  });
  assert.deepEqual(tableCellTextSvgLayout(rect, { textAlign: 'right', textVerticalAlign: 'bottom' }), {
    x: 106,
    y: 67,
    textAnchor: 'end',
    dominantBaseline: 'alphabetic',
  });
});

test('table clipboard preserves plain text and extracts copied text entities', () => {
  assert.equal(tableCellClipboardValue('plain cell text'), 'plain cell text');
  assert.equal(tableCellClipboardValue(JSON.stringify({
    format: 'ParaMagic Clipboard',
    version: 1,
    drawing: { entities: [{ id: 'text-1', type: 'text', text: 'Copied text' }] },
  })), 'Copied text');
  assert.equal(tableCellClipboardValue(JSON.stringify({
    format: 'ParaMagic Clipboard',
    version: 1,
    drawing: { entities: [{ id: 'text-2', type: 'text', text: 'Line 1\nLine 2' }] },
  })), 'Line 1\nLine 2');
  assert.equal(tableCellClipboardValue(JSON.stringify({
    format: 'ParaMagic Clipboard',
    version: 1,
    drawing: { entities: [{ id: 'line-1', type: 'line', start: [0, 0], end: [1, 1] }] },
  })), null);
});

test('table clipboard serializes selected cells as tab-separated text', () => {
  const entity = normalizeTableEntity({
    ...table(),
    cells: [
      [{ text: 'A' }, { text: 'B' }],
      [{ text: 'C' }, { text: 'D' }],
    ],
  });
  const record = {
    entity,
    tableSelection: { cells: new Set(['0:0', '0:1', '1:0', '1:1']), rows: new Set(), columns: new Set() },
  };
  assert.equal(tableCellClipboardText(record), 'A\tB\nC\tD');
});
