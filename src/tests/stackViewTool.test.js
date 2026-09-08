import test from 'node:test';
import assert from 'node:assert/strict';
import { createStackViewTool } from '../../packages/paramagic-core/src/modules/StackViewTool.js';
import { cameraScreenToWorld, cameraWorldToScreen, rotateCameraAt, scaleCameraAt, fitCameraBounds, cameraViewportBounds } from '../../packages/paramagic-core/src/modules/CanvasViewport.js';

const close = (a, b) => a.forEach((value, i) => assert.ok(Math.abs(value - b[i]) < 1e-9));

test('Stack view toggles on with rotated Stack activation and off for global view', () => {
  let click, stackChange;
  let state = { activeStackId: null, stacks: [{ id: 'a', frame: { rotation: Math.PI / 3 } }] };
  const rotations = [];
  const attributes = new Map();
  createStackViewTool({ button: { addEventListener(_, fn) { click = fn; }, setAttribute(key, value) { attributes.set(key, value); } },
    canvas: { getStackState: () => state, rotateView: angle => rotations.push(angle),
      onStackChange(fn) { stackChange = fn; fn(state, { reason: 'subscribe' }); } } });
  assert.equal(attributes.get('aria-pressed'), 'false');
  state = { ...state, activeStackId: 'a' };
  stackChange(state, { reason: 'activation' });
  assert.equal(attributes.get('aria-pressed'), 'true');
  assert.equal(rotations.at(-1), -Math.PI / 3);
  click();
  assert.equal(attributes.get('aria-pressed'), 'false');
  assert.equal(rotations.at(-1), 0);
  click();
  assert.equal(attributes.get('aria-pressed'), 'true');
  state = { ...state, activeStackId: null };
  stackChange(state, { reason: 'activation' });
  assert.equal(attributes.get('aria-pressed'), 'false');
  assert.equal(rotations.at(-1), 0);
});

test('global-oriented Stack activation leaves the view toggle off', () => {
  let stackChange;
  const attributes = new Map();
  const state = { activeStackId: 'a', stacks: [{ id: 'a', frame: { x: 50, y: 20, rotation: Math.PI * 2 } }] };
  createStackViewTool({ button: { addEventListener() {}, setAttribute(key, value) { attributes.set(key, value); } },
    canvas: { getStackState: () => state, rotateView() {}, onStackChange(fn) { stackChange = fn; } } });
  stackChange(state, { reason: 'activation' });
  assert.equal(attributes.get('aria-pressed'), 'false');
});

test('view alignment preserves the center and zoom, and pointer coordinates invert the rotation', () => {
  const camera = { x: 70, y: -40, scale: 2.7, rotation: 0.3 };
  const center = [600, 400];
  const before = cameraScreenToWorld(camera, center);
  const next = rotateCameraAt(camera, -Math.PI / 4, center);
  close(cameraScreenToWorld(next, center), before);
  assert.equal(next.scale, camera.scale);
  const point = [183, -72];
  close(cameraScreenToWorld(next, cameraWorldToScreen(next, point)), point);
  const zoomed = scaleCameraAt(next, next.scale * 1.8, center);
  close(cameraScreenToWorld(zoomed, center), before);
  const direction = [Math.cos(Math.PI / 4), Math.sin(Math.PI / 4)];
  const origin = cameraWorldToScreen(next, [0, 0]);
  const end = cameraWorldToScreen(next, direction);
  close([end[0] - origin[0], end[1] - origin[1]], [next.scale, 0]);
});

test('Zoom All fits rotated bounds and axes cover every viewport corner', () => {
  const camera = fitCameraBounds({ rotation: -0.7 }, { x: 20, y: 30, width: 300, height: 60 }, 800, 500);
  const bounds = cameraViewportBounds(camera, 800, 500);
  for (const point of [[20, 30], [320, 30], [320, 90], [20, 90]]) {
    const [x, y] = cameraWorldToScreen(camera, point);
    assert.ok(x >= 0 && x <= 800 && y >= 0 && y <= 500);
  }
  for (const point of [[0, 0], [800, 0], [800, 500], [0, 500]]) {
    const [x, y] = cameraScreenToWorld(camera, point);
    assert.ok(x >= bounds.left && x <= bounds.right && y >= bounds.top && y <= bounds.bottom);
  }
  assert.equal(camera.rotation, -0.7);
});
