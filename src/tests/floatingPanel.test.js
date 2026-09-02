import test from 'node:test';
import assert from 'node:assert/strict';
import {
  anchoredToolMenuPosition,
  clampPanelPosition,
  floatingPanelMaximumRight,
  floatingPanelMinimumLeft,
  floatingPanelMinimumTop,
  horizontalToolSectionCount,
  horizontalToolSectionIndexes,
} from '../../packages/paramagic-core/src/modules/CanvasUIControls.js';

test('floating panels remain fully inside the viewport', () => {
  assert.deepEqual(clampPanelPosition(
    { left: -120, top: -80, width: 300, height: 200 },
    { viewportWidth: 1000, viewportHeight: 700, margin: 8 },
  ), { left: 8, top: 8 });
  assert.deepEqual(clampPanelPosition(
    { left: 940, top: 650, width: 300, height: 200 },
    { viewportWidth: 1000, viewportHeight: 700, margin: 8 },
  ), { left: 692, top: 492 });
});

test('floating panel clamping respects a toolbar-safe top boundary', () => {
  assert.deepEqual(clampPanelPosition(
    { left: 500, top: 20, width: 340, height: 400 },
    { viewportWidth: 1200, viewportHeight: 800, margin: 8, minTop: 108 },
  ), { left: 500, top: 108 });
});

test('floating panels stay right of the Stack sidebar', () => {
  assert.deepEqual(clampPanelPosition(
    { left: 16, top: 120, width: 340, height: 400 },
    {
      viewportWidth: 1200,
      viewportHeight: 800,
      margin: 8,
      minLeft: 268,
      minTop: 56,
    },
  ), { left: 268, top: 120 });
  assert.equal(floatingPanelMinimumLeft({ right: 260 }, { gap: 8 }), 268);
});

test('the Stack sidebar boundary takes priority when a panel cannot fit between both side rails', () => {
  assert.deepEqual(clampPanelPosition(
    { left: 0, top: 120, width: 340, height: 400 },
    {
      viewportWidth: 620,
      viewportHeight: 800,
      margin: 8,
      minLeft: 268,
      maxRight: 560,
    },
  ), { left: 268, top: 120 });
});

test('floating panels stay left of a vertical toolbar rail', () => {
  assert.deepEqual(clampPanelPosition(
    { left: 900, top: 120, width: 340, height: 400 },
    { viewportWidth: 1200, viewportHeight: 800, margin: 8, minTop: 56, maxRight: 1090 },
  ), { left: 750, top: 120 });
  assert.equal(floatingPanelMaximumRight(
    { left: 1100, width: 92 },
    { gap: 8, viewportWidth: 1200 },
  ), 1092);
});

test('wrapped headers publish their current bottom edge as the floating-panel boundary', () => {
  assert.equal(floatingPanelMinimumTop({ bottom: 92 }, { gap: 8 }), 100);
  assert.equal(floatingPanelMinimumTop({ bottom: 176 }, { gap: 8 }), 184);
});

test('toolbar sections keep every fitting section in the single horizontal row', () => {
  assert.equal(horizontalToolSectionCount({
    availableWidth: 1268,
    menuWidth: 40,
    sectionWidths: [624, 217, 604, 264],
    gap: 7,
  }), 3);
  assert.deepEqual(horizontalToolSectionIndexes({
    availableWidth: 1268,
    menuWidth: 40,
    sectionWidths: [624, 217, 604, 264],
    gap: 7,
  }), [0, 1, 3]);
  assert.equal(horizontalToolSectionCount({
    availableWidth: 720,
    menuWidth: 40,
    sectionWidths: [624, 217, 604, 264],
    gap: 7,
  }), 1);
});

test('vertical toolbar menus open to the left while horizontal menus open below', () => {
  assert.deepEqual(anchoredToolMenuPosition(
    { left: 1140, top: 100, width: 40, height: 40 },
    { width: 200, height: 90 },
    { viewportWidth: 1200, viewportHeight: 800, vertical: true },
  ), { left: 936, top: 75, placement: 'left' });
  assert.deepEqual(anchoredToolMenuPosition(
    { left: 200, top: 6, width: 40, height: 40 },
    { width: 200, height: 90 },
    { viewportWidth: 1200, viewportHeight: 800 },
  ), { left: 120, top: 50, placement: 'below' });
});
