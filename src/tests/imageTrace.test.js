import test from 'node:test';
import assert from 'node:assert/strict';
import { applyImageTraceRegion } from '../../packages/paramagic-core/src/modules/ImageSystem.js';
import { createStackSystem } from '../../packages/paramagic-core/src/modules/StackSystem.js';
import { DrawingHistory } from '../../packages/paramagic-core/src/modules/DrawingHistory.js';
import {
  configureOpenCvResources,
  createImageTraceSettingsMemory,
  getOpenCvResourceConfiguration,
  imageLocalToWorldPoint,
  imagePixelToLocalPoint,
  imageWorldToLocalPoint,
  imageWorldToPixelPoint,
  normalizeImageTraceSettings,
} from '../../packages/paramagic-core/src/modules/ImageTrace.js';

const near = (actual, expected, tolerance = 1e-8) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);
const nearPoint = (actual, expected) => {
  near(actual[0], expected[0]);
  near(actual[1], expected[1]);
};

function traceDrawingFixture() {
  let history;
  const stacks = createStackSystem({ records: [], selectedIds: new Set(),
    onChange: ({ history: mode }) => { if (mode === 'commit') history?.record(); },
  });
  const parent = stacks.addStack('Image source');
  stacks.setActiveStack(parent.id);
  const image = { id: 'image', type: 'image', stackId: parent.id };
  let entities = [image];
  const capture = () => ({ stacks: stacks.getState(), entities: structuredClone(entities) });
  history = new DrawingHistory({ capture, restore: (snapshot) => {
    stacks.restore(snapshot.stacks);
    entities = snapshot.entities;
  } });
  const drawing = {
    getStackState: stacks.getState, restoreStackState: stacks.restore, addStack: stacks.addStack,
    checkpoint: () => { history.flush(); history.record(); },
    commit: () => history.record(),
    addObject: () => { throw Error('Trace must retain batched creation'); },
    addObjects: (entries, options) => {
      assert.deepEqual(options, { select: false, notify: false });
      entities.push(...entries.map(({ entity }) => entity));
      return entries.map(({ entity }) => ({ id: entity.id, entity }));
    },
  };
  return { stacks, image, parent, drawing, history, capture };
}

const outline = [[70, 20], [120, 20], [120, 60], [70, 60]];

test('Apply Trace creates a closed outline in a new child without changing activation or selection', () => {
  const f = traceDrawingFixture();
  const placed = f.stacks.getState();
  const frame = { x: 100, y: -40, rotation: 0.4 };
  placed.stacks.find(s => s.id === f.parent.id).frame = frame;
  f.stacks.restore(placed);
  const created = applyImageTraceRegion({ image: f.image, worldPoints: outline }, f.drawing);
  assert.equal(created.length, 4);
  const child = f.stacks.stack(created[0].entity.stackId);
  assert.equal(child.parentStackId, f.parent.id);
  assert.deepEqual(child.frame, frame);
  assert.equal(f.stacks.activeStackId(), f.parent.id);
  assert.equal(f.stacks.selectedStackId(), f.parent.id);
  assert.equal(f.image.stackId, f.parent.id);
  created.forEach(({ entity }, i) => {
    assert.equal(entity.stackId, child.id);
    assert.deepEqual(entity.start, outline[i]);
    assert.deepEqual(entity.end, outline[(i + 1) % outline.length]);
    assert.equal(entity.composite.closed, true);
  });
});

test('each Apply Trace creates a separate sibling under the source image Stack', () => {
  const f = traceDrawingFixture();
  const first = applyImageTraceRegion({ image: f.image, worldPoints: outline }, f.drawing);
  const second = applyImageTraceRegion({ image: f.image, worldPoints: outline }, f.drawing);
  assert.notEqual(first[0].entity.stackId, second[0].entity.stackId);
  const children = f.stacks.getState().stacks.filter(s => s.parentStackId === f.parent.id);
  assert.equal(children.length, 2);
  assert.notEqual(children[0].name, children[1].name);
  assert.equal(f.stacks.activeStackId(), f.parent.id);
});

test('one Undo removes both the trace and its child Stack and Redo restores both', () => {
  const f = traceDrawingFixture(), before = f.capture();
  applyImageTraceRegion({ image: f.image, worldPoints: outline }, f.drawing);
  const after = f.capture();
  assert.equal(f.history.past.length, 1);
  assert.equal(f.history.undo(), true);
  assert.deepEqual(f.capture(), before);
  assert.equal(f.history.redo(), true);
  assert.deepEqual(f.capture(), after);
});

test('Apply Trace uses image ownership even when a different Stack is active', () => {
  const f = traceDrawingFixture();
  const other = f.stacks.addStack('Other');
  f.stacks.setActiveStack(other.id);
  const created = applyImageTraceRegion({ image: f.image, worldPoints: outline }, f.drawing);
  assert.equal(f.stacks.stack(created[0].entity.stackId).parentStackId, f.parent.id);
  assert.equal(f.stacks.activeStackId(), other.id);
});

for (const fail of ['rejected', 'exception']) test(`a ${fail} trace leaves no empty Stack or history action`, () => {
  const f = traceDrawingFixture(), before = f.capture();
  f.drawing.addObjects = () => { if (fail === 'exception') throw Error('Unable to add'); return []; };
  const apply = () => applyImageTraceRegion({ image: f.image, worldPoints: outline }, f.drawing);
  if (fail === 'exception') assert.throws(apply, /Unable to add/);
  else assert.deepEqual(apply(), []);
  assert.deepEqual(f.capture(), before);
  assert.equal(f.history.past.length, 0);
  assert.equal(f.stacks.selectedStackId(), f.parent.id);
});

test('the host configures the exact OpenCV script resource used by core', (context) => {
  context.after(() => configureOpenCvResources());
  assert.throws(() => configureOpenCvResources({}), /scriptUrl/);
  assert.deepEqual(configureOpenCvResources({
    scriptUrl: 'https://cdn.example/opencv/5.0.0/opencv.js',
  }), {
    scriptUrl: 'https://cdn.example/opencv/5.0.0/opencv.js',
  });
  assert.deepEqual(getOpenCvResourceConfiguration(), {
    scriptUrl: 'https://cdn.example/opencv/5.0.0/opencv.js',
  });
});

test('image trace settings use practical defaults and clamp user input', () => {
  assert.deepEqual(normalizeImageTraceSettings(), { tolerance: 24, detail: 8, smoothing: 1 });
  assert.deepEqual(normalizeImageTraceSettings({ tolerance: 250, detail: 0, smoothing: -4 }), {
    tolerance: 100,
    detail: 1,
    smoothing: 0,
  });
  assert.deepEqual(normalizeImageTraceSettings({ tolerance: '18', detail: '9', smoothing: '3' }), {
    tolerance: 18,
    detail: 9,
    smoothing: 3,
  });
});

test('image trace settings memory recalls the latest normalized slider values', () => {
  const memory = createImageTraceSettingsMemory();
  assert.deepEqual(memory.recall(), { tolerance: 24, detail: 8, smoothing: 1 });
  assert.deepEqual(memory.remember({ tolerance: '41', detail: '6', smoothing: '4' }), {
    tolerance: 41,
    detail: 6,
    smoothing: 4,
  });
  const recalled = memory.recall();
  assert.deepEqual(recalled, { tolerance: 41, detail: 6, smoothing: 4 });
  recalled.tolerance = 0;
  assert.equal(memory.recall().tolerance, 41);
});

test('trace coordinates map the displayed image corners to raster corners', () => {
  const entity = { x: 300, y: 200, width: 200, height: 100, rotation: 0, flipX: false, flipY: false };
  assert.deepEqual(imageWorldToPixelPoint(entity, [200, 150], 401, 201), [0, 0]);
  assert.deepEqual(imageWorldToPixelPoint(entity, [400, 250], 401, 201), [400, 200]);
  assert.deepEqual(imagePixelToLocalPoint(entity, [0, 0], 401, 201), [-100, -50]);
  assert.deepEqual(imagePixelToLocalPoint(entity, [400, 200], 401, 201), [100, 50]);
});

test('trace coordinate conversion respects image rotation and flips', () => {
  const entity = { x: 120, y: 80, width: 240, height: 120, rotation: 37, flipX: true, flipY: false };
  const local = [42, -27];
  const world = imageLocalToWorldPoint(entity, local);
  nearPoint(imageWorldToLocalPoint(entity, world), local);
  const pixel = imageWorldToPixelPoint(entity, world, 481, 241);
  assert.deepEqual(pixel, [324, 66]);
  nearPoint(imagePixelToLocalPoint(entity, pixel, 481, 241), local);
});

test('pixel points converted to world coordinates retain the displayed image transform', () => {
  const entity = { x: 50, y: 75, width: 100, height: 50, rotation: 90, flipX: false, flipY: true };
  const local = imagePixelToLocalPoint(entity, [100, 50], 201, 101);
  assert.deepEqual(local, [0, 0]);
  nearPoint(imageLocalToWorldPoint(entity, local), [50, 75]);
  nearPoint(imageLocalToWorldPoint(entity, [50, -25]), [25, 125]);
});
