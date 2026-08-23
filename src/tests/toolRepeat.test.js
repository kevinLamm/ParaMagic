import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clearRepeatableTool,
  rememberRepeatableTool,
  repeatLastTool,
} from '../../packages/paramagic-core/src/modules/CanvasUIControls.js';

test('the last successfully applied tool can be repeated once it is inactive', () => {
  clearRepeatableTool();
  let active = false;
  rememberRepeatableTool(() => {
    if (active) return false;
    active = true;
    return true;
  });

  assert.equal(repeatLastTool(), true);
  assert.equal(active, true);
  assert.equal(repeatLastTool(), false);
});

test('clearing the repeatable tool makes Spacebar repetition a no-op', () => {
  rememberRepeatableTool(() => true);
  clearRepeatableTool();
  assert.equal(repeatLastTool(), false);
});
