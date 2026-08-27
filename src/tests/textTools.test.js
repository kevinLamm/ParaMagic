import test from 'node:test';
import assert from 'node:assert/strict';

import {
  bindTextRecordInteractions,
  createTextEntity,
  deferTextEditUntilPlacementClick,
  drawingTextPresentationModel,
  drawingTextSvgLayout,
  normalizeTextEntity,
  normalizeTextVerticalAlign,
  rememberTextDefaults,
  resolveTextFields,
} from '../../packages/paramagic-core/src/modules/TextTools.js';

function interactionTarget() {
  const listeners = new Map();
  return {
    addEventListener(type, listener) { listeners.set(type, listener); },
    removeEventListener(type, listener) {
      if (listeners.get(type) === listener) listeners.delete(type);
    },
    dispatch(type, event = {}) {
      listeners.get(type)?.({
        type,
        button: 0,
        clientX: 40,
        clientY: 50,
        ctrlKey: false,
        metaKey: false,
        detail: 1,
        timeStamp: 100,
        preventDefault() {},
        stopPropagation() {},
        ...event,
      });
    },
  };
}

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
  assert.equal(initial.appearance.fillOpacity, 0);
  assert.equal(initial.appearance.strokeOpacity, 0);

  const created = createTextEntity({ x: 4, y: 8 });
  assert.deepEqual(created.classPropertyOverrides, ['fillOpacity', 'strokeOpacity']);

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

test('text normalization preserves class metadata needed by appearance resolution', () => {
  const entity = normalizeTextEntity({
    id: 'label',
    classId: 'class-notes',
    classPropertyOverrides: ['fillOpacity', 'strokeOpacity'],
  });
  assert.equal(entity.classId, 'class-notes');
  assert.deepEqual(entity.classPropertyOverrides, ['fillOpacity', 'strokeOpacity']);
});

test('text interaction owns selection, drag, double-click editing, and click suppression', () => {
  const foreignObject = interactionTarget();
  const record = { id: 'label', foreignObject };
  const actions = [];
  let editing = false;
  let suppressClick = false;
  bindTextRecordInteractions(record, {
    isEditing: () => editing,
    beginEdit: (_record, options) => {
      editing = true;
      actions.push(['edit', options.caretPoint, options.interactionEvent?.type]);
    },
    onClearPropertyFeature: () => actions.push(['clear']),
    onSelect: () => actions.push(['select']),
    onToggleSelection: () => actions.push(['toggle']),
    onStartDrag: () => actions.push(['drag']),
    consumeSuppressedClick: () => {
      const value = suppressClick;
      suppressClick = false;
      return value;
    },
  });

  foreignObject.dispatch('pointerdown');
  assert.deepEqual(actions, [['clear'], ['drag']]);
  suppressClick = true;
  foreignObject.dispatch('click');
  assert.equal(actions.some(([name]) => name === 'select'), false);

  foreignObject.dispatch('pointerdown', { timeStamp: 200, detail: 2, clientX: 44, clientY: 52 });
  assert.equal(actions.filter(([name]) => name === 'drag').length, 1);
  foreignObject.dispatch('dblclick', { timeStamp: 210, detail: 2, clientX: 44, clientY: 52 });
  assert.deepEqual(actions.at(-2), ['select']);
  assert.deepEqual(actions.at(-1), ['edit', { clientX: 44, clientY: 52 }, 'dblclick']);

  editing = false;
  foreignObject.dispatch('click', { ctrlKey: true });
  assert.deepEqual(actions.at(-1), ['toggle']);
});

test('new text editing waits for the placement click to finish', () => {
  const eventTarget = interactionTarget();
  const scheduled = [];
  const actions = [];
  deferTextEditUntilPlacementClick({
    pointerEvent: { type: 'pointerdown', pointerId: 7, clientX: 40, clientY: 50 },
    eventTarget,
    schedule: (callback) => scheduled.push(callback),
    onReady: () => actions.push('edit'),
  });

  assert.deepEqual(actions, []);
  eventTarget.dispatch('pointerup', { pointerId: 7 });
  assert.deepEqual(scheduled, []);
  eventTarget.dispatch('click', { clientX: 80, clientY: 50 });
  assert.deepEqual(scheduled, []);
  eventTarget.dispatch('click', { clientX: 40, clientY: 50 });
  assert.equal(scheduled.length, 1);
  assert.deepEqual(actions, []);
  scheduled[0]();
  assert.deepEqual(actions, ['edit']);
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

test('text presentation converts the live editor value and styling to native SVG layout', () => {
  const attributes = { x: '100', y: '200', width: '240', height: '80' };
  const foreignObject = { getAttribute: (name) => attributes[name] || null };
  const values = new Map([
    ['font-size', '28px'],
    ['line-height', '35px'],
    ['text-align', 'right'],
    ['color', 'rgb(32, 32, 32)'],
    ['font-family', 'Arial'],
    ['background-color', 'rgba(255, 255, 255, 0)'],
    ['border-color', 'rgba(32, 32, 32, 0)'],
    ['border-width', '1.5px'],
  ]);
  const editor = { value: 'First\nSecond', style: { getPropertyValue: () => '' } };
  const model = drawingTextPresentationModel(foreignObject, editor, () => ({
    getPropertyValue: (property) => values.get(property) || '',
  }));

  assert.deepEqual(model.lines, ['First', 'Second']);
  assert.equal(model.contentX, 334.5);
  assert.equal(model.contentY, 205.5);
  assert.equal(model.lineHeight, 35);
  assert.equal(model.textAnchor, 'end');
  assert.equal(model.fontSize, 28);
});
