import test from 'node:test';
import assert from 'node:assert/strict';
import {
  expressionBoxLookupMarkup,
  expressionLookupKeyAction,
  expressionLookupMatches,
  expressionLookupRange,
  insertExpressionLookupValue,
  normalizeExpressionLookupOptions,
} from '../../packages/paramagic-core/src/modules/ExpressionBox.js';

test('Expression Box lookup normalizes parameter entries for every field type', () => {
  assert.deepEqual(normalizeExpressionLookupOptions([
    'Waist',
    { name: 'd1@Front Panel', label: 'd1@Front Panel (dimension)' },
    { value: 'Waist', label: 'duplicate' },
    null,
  ]), [
    { value: 'Waist', label: 'Waist' },
    { value: 'd1@Front Panel', label: 'd1@Front Panel (dimension)' },
  ]);
  assert.deepEqual(expressionLookupMatches(['Width', 'Waist', 'Height'], 'wa'), [
    { value: 'Waist', label: 'Waist' },
  ]);
});

test('Expression Box lookup replaces the current expression token at the caret', () => {
  assert.deepEqual(expressionLookupRange('2 * d1@Fro', 10, 10), {
    start: 4,
    end: 10,
    query: 'd1@Fro',
  });
  assert.deepEqual(insertExpressionLookupValue('2 * d1@Fro', 10, 10, 'd1@Front Panel'), {
    value: '2 * d1@Front Panel',
    selectionStart: 18,
    selectionEnd: 18,
  });
});

test('Expression Box autofill markup supplies a suggestion list without a dropdown control', () => {
  const markup = expressionBoxLookupMarkup({ id: 'lookup-test' });
  assert.doesNotMatch(markup, /button|data-expression-lookup-toggle/);
  assert.match(markup, /id="lookup-test"[^>]*role="listbox"/);
});

test('Expression Box autofill only inserts an explicitly highlighted suggestion', () => {
  assert.equal(expressionLookupKeyAction({ key: 'Enter', listOpen: true }), 'close');
  assert.equal(expressionLookupKeyAction({ key: 'Tab', listOpen: true }), 'close');
  assert.equal(expressionLookupKeyAction({ key: 'Enter', listOpen: true, activeIndex: 0 }), 'choose');
  assert.equal(expressionLookupKeyAction({ key: 'Tab', listOpen: true, activeIndex: 1 }), 'choose');
  assert.equal(expressionLookupKeyAction({ key: 'Enter', shiftKey: true, listOpen: true, activeIndex: 0 }), 'close');
  assert.equal(expressionLookupKeyAction({ key: 'ArrowDown', listOpen: true }), 'next');
  assert.equal(expressionLookupKeyAction({ key: 'ArrowUp', listOpen: true }), 'previous');
  assert.equal(expressionLookupKeyAction({ key: 'Enter', listOpen: false }), null);
});

test('Expression lookup preserves multiline expressions when inserting a symbol', () => {
  const expression = '2 * Width\n+ H';
  assert.deepEqual(insertExpressionLookupValue(expression, expression.length, expression.length, 'Height'), {
    value: '2 * Width\n+ Height',
    selectionStart: 18,
    selectionEnd: 18,
  });
});
