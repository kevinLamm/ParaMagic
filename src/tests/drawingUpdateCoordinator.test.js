import test from 'node:test';
import assert from 'node:assert/strict';
import { createDrawingUpdateCoordinator, DrawingDependencyIndex } from '../../packages/paramagic-core/src/modules/DrawingUpdateCoordinator.js';

test('one edit publishes only after dependent geometry stabilizes, with one history commit', () => {
  const queued = [], events = [], published = [];
  const updates = createDrawingUpdateCoordinator({ schedule: (callback) => queued.push(callback), publish: (change) => published.push(change) });
  let projected = false;
  updates.register('array', () => events.push('array'), 40);
  updates.register('swell', () => {
    events.push('swell');
    if (!projected) {
      projected = true;
      updates.invalidate({ changedRecordIds: new Set(['follower']), history: 'none', objectsChanged: true });
    }
  }, 20);
  updates.invalidate({ changedRecordIds: new Set(['line']), history: 'none' });
  updates.invalidate({ changedRecordIds: new Set(), history: 'commit', objectsChanged: true });
  assert.equal(queued.length, 1);
  queued.shift()();
  assert.deepEqual(events, ['swell', 'swell', 'array']);
  assert.equal(published.length, 1);
  assert.equal(published[0].history, 'commit');
  assert.deepEqual([...published[0].changedRecordIds], ['line', 'follower']);
  assert.equal(updates.pending, false);
});

test('publishing another edit schedules a distinct update and unknown invalidation stays full', () => {
  const queue = [], published = [];
  const updates = createDrawingUpdateCoordinator({ schedule: (callback) => queue.push(callback), publish(change) {
    published.push(change);
    if (published.length === 1) updates.invalidate({ changedRecordIds: new Set(['next']) });
  } });
  updates.invalidate();
  updates.invalidate({ changedRecordIds: new Set(['first']) });
  queue.shift()();
  assert.equal(published[0].changedRecordIds, null);
  assert.equal(queue.length, 1);
  queue.shift()();
  assert.deepEqual([...published[1].changedRecordIds], ['next']);
});

test('dependency invalidation includes nested derivatives and their centers, and replaces removed edges', () => {
  const index = new DrawingDependencyIndex();
  index.set('swell', ['line']);
  index.set('array', ['swell', 'center']);
  index.set('nested', ['array']);
  index.set('other', ['other-line']);
  assert.deepEqual([...index.affected(['line'])], ['line', 'swell', 'array', 'nested']);
  assert.deepEqual([...index.affected(['center'])], ['center', 'array', 'nested']);
  index.set('array', ['replacement']);
  assert.deepEqual([...index.affected(['line'])], ['line', 'swell']);
  index.set('array', ['nested']);
  assert.deepEqual([...index.affected(['array'])], ['array', 'nested']);
});

test('an inconsistent dependent cycle fails without publishing an intermediate drawing', () => {
  let published = false;
  const updates = createDrawingUpdateCoordinator({ schedule: () => {}, maximumRounds: 3, publish: () => { published = true; } });
  updates.register('cycle', () => updates.invalidate());
  updates.invalidate();
  assert.throws(() => updates.flush(), /did not stabilize/);
  assert.equal(published, false);
});
