import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createTextEntity,
  drawingTextSvgLayout,
  normalizeTextEntity,
  normalizeTextVerticalAlign,
  rememberTextDefaults,
  resolveTextFields,
} from '../../packages/paramagic-core/src/modules/TextTools.js';

test('text fields resolve parameter names while leaving unknown fields editable', () => {
  const rendered = resolveTextFields(
    'Width: [OverallWidth]\nMissing: [Unknown]',
    [{ name: 'OverallWidth', value: 82, unit: 'in' }],
    (entry) => `${entry.value}`,
  );
  assert.equal(rendered, 'Width: 82\nMissing: [Unknown]');
});

test('text fields resolve bracketed expressions without changing unresolved fields', () => {
  const rendered = resolveTextFields(
    '[OverallWidth / 2] / [Unknown + 1]',
    [{ name: 'OverallWidth', value: 82, unit: 'in' }],
    (entry) => `${entry.value}`,
    (expression) => {
      if (expression === 'OverallWidth / 2') return 41;
      throw new Error('Unknown expression');
    },
  );
  assert.equal(rendered, '41 / [Unknown + 1]');
});

test('text entities default to Arial 28 and inherit the last edited text properties', () => {
  const initial = normalizeTextEntity({ x: 4, y: 8 });
  assert.equal(initial.fontName, 'Arial');
  assert.equal(initial.fontSize, 28);
  assert.ok(Math.abs(initial.textHeight - (28 * 25.4 / 96)) < 1e-12);
  assert.equal(initial.scaleWithZoom, true);
  assert.equal(initial.multiline, true);
  assert.equal(initial.textAlign, 'left');
  assert.equal(initial.textVerticalAlign, 'top');

  rememberTextDefaults({
    ...initial,
    fontName: 'Georgia',
    fontSize: 20,
    textHeight: 20 * 25.4 / 96,
    fontColor: '#123456',
    scaleWithZoom: false,
    multiline: false,
    textAlign: 'right',
  });
  const next = createTextEntity({ x: 10, y: 12 });
  assert.equal(next.fontName, 'Georgia');
  assert.equal(next.fontSize, 20);
  assert.ok(Math.abs(next.textHeight - (20 * 25.4 / 96)) < 1e-12);
  assert.equal(next.fontColor, '#123456');
  assert.equal(next.scaleWithZoom, false);
  assert.equal(next.multiline, false);
  assert.equal(next.textAlign, 'right');
});

test('single-line text normalizes line breaks and invalid alignment', () => {
  const entity = normalizeTextEntity({ text: 'First\nSecond', multiline: false, textAlign: 'diagonal' });
  assert.equal(entity.text, 'First Second');
  assert.equal(entity.textAlign, 'left');
});

test('text vertical alignment normalizes and moves the text frame within its anchor', () => {
  assert.equal(normalizeTextVerticalAlign('invalid'), 'top');
  assert.equal(normalizeTextVerticalAlign('middle'), 'middle');

  const top = drawingTextSvgLayout({ x: 10, y: 20, text: 'Label', fontSize: 20, textVerticalAlign: 'top' });
  const middle = drawingTextSvgLayout({ x: 10, y: 20, text: 'Label', fontSize: 20, textVerticalAlign: 'middle' });
  const bottom = drawingTextSvgLayout({ x: 10, y: 20, text: 'Label', fontSize: 20, textVerticalAlign: 'bottom' });

  assert.equal(top.frameY, 20);
  assert.equal(middle.frameY, 20 - middle.frameHeight / 2);
  assert.equal(bottom.frameY, 20 - bottom.frameHeight);
});
