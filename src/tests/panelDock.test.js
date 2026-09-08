import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePanelDockLayout, reorderDockPanel, resizeDockPair } from '../../packages/paramagic-core/src/modules/PanelDock.js';

test('panel dock starts with all three panels visible in the intended order', () => {
  const layout = normalizePanelDockLayout();
  assert.deepEqual(layout.order, ['stacks', 'controls', 'properties']);
  assert.equal(layout.width, 300);
  assert.ok(Object.values(layout.panels).every(panel => panel.visible && !panel.floating));
});

test('panel layout repairs stale ordering and invalid saved dimensions', () => {
  const layout = normalizePanelDockLayout({ width: 900, order: ['properties', 'unknown', 'properties'], panels: { controls: { visible: false, floating: true, weight: -1 } } });
  assert.deepEqual(layout.order, ['properties', 'stacks', 'controls']);
  assert.equal(layout.width, 520);
  assert.equal(layout.panels.controls.weight, 0.05);
  assert.equal(layout.panels.controls.visible, false);
  assert.equal(layout.panels.controls.floating, true);
  assert.deepEqual(normalizePanelDockLayout(null), normalizePanelDockLayout());
});

test('drag ordering can move a panel first or last without losing hidden panels', () => {
  const original = ['stacks', 'controls', 'properties'];
  assert.deepEqual(reorderDockPanel(original, 'properties', 'stacks'), ['properties', 'stacks', 'controls']);
  assert.deepEqual(reorderDockPanel(original, 'stacks'), ['controls', 'properties', 'stacks']);
  assert.deepEqual(reorderDockPanel(original, 'controls', 'controls'), original);
  assert.deepEqual(original, ['stacks', 'controls', 'properties']);
});

test('divider resizing preserves combined height and protects both panels from being squeezed shut', () => {
  assert.deepEqual(resizeDockPair(200, 300, 50), [250, 250]);
  assert.deepEqual(resizeDockPair(200, 300, 900), [392, 108]);
  assert.deepEqual(resizeDockPair(200, 300, -900), [108, 392]);
  assert.deepEqual(resizeDockPair(80, 80, 30), [80, 80]);
});
