import test from 'node:test';
import assert from 'node:assert/strict';
import { setActiveStackToolAvailability } from '../../packages/paramagic-core/src/modules/CanvasUIControls.js';

function fakeControl({ expanded = false } = {}) {
  const attributes = new Map(expanded ? [['aria-expanded', 'true']] : []);
  return {
    disabled: false,
    hasAttribute: (name) => attributes.has(name),
    getAttribute: (name) => attributes.get(name) ?? null,
    setAttribute: (name, value) => attributes.set(name, String(value)),
  };
}

test('active-Stack header tools disable together and close their open menus', () => {
  const controls = [fakeControl(), fakeControl({ expanded: true })];
  const removedClasses = [];
  const menus = [
    { classList: { remove: (name) => removedClasses.push(name) } },
    { classList: { remove: (name) => removedClasses.push(name) } },
  ];
  const root = {
    querySelectorAll(selector) {
      return selector.includes('data-drawing-tool') ? controls : menus;
    },
  };

  assert.deepEqual(setActiveStackToolAvailability(root, null), { available: false, controls });
  assert.deepEqual(controls.map(({ disabled }) => disabled), [true, true]);
  assert.equal(controls[1].getAttribute('aria-expanded'), 'false');
  assert.deepEqual(removedClasses, ['open', 'open']);

  assert.deepEqual(setActiveStackToolAvailability(root, 'stack-a'), { available: true, controls });
  assert.deepEqual(controls.map(({ disabled }) => disabled), [false, false]);
});
