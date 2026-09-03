import test from 'node:test';
import assert from 'node:assert/strict';

import { syncPropertiesPanelAvailability } from '../../packages/paramagic-core/src/modules/PropertiesPanel.js';

function propertyRow(key) {
  const controls = [{ disabled: true }, { disabled: true }];
  return {
    dataset: { propertyAvailability: key },
    hidden: true,
    controls,
    querySelectorAll: () => controls,
  };
}

test('Properties panel availability shows usable rows and hides unavailable rows', () => {
  const fill = propertyRow('canEditFill');
  const text = propertyRow('canEditText');
  const root = { querySelectorAll: () => [fill, text] };

  const visible = syncPropertiesPanelAvailability(root, {
    canEditFill: true,
    canEditText: false,
  });

  assert.deepEqual(visible, [fill]);
  assert.equal(fill.hidden, false);
  assert.equal(fill.controls.every(({ disabled }) => disabled === false), true);
  assert.equal(text.hidden, true);
  assert.equal(text.controls.every(({ disabled }) => disabled === true), true);
});
