import test from 'node:test';
import assert from 'node:assert/strict';
import { SolverMutationJournal } from '../../packages/paramagic-core/src/modules/solver/SolverMutationJournal.js';

test('solver mutation journal replays commands after its accepted checkpoint', () => {
  const journal = new SolverMutationJournal({ revision: 3, snapshot: { entities: [{ id: 'a' }] } });
  journal.record({ revision: 4, type: 'add-entity', payload: { entity: { id: 'b' } } });
  journal.record({ revision: 5, type: 'remove-entity', payload: { entityId: 'a' } });
  journal.accept(4);

  assert.deepEqual(journal.recoveryPlan().map(({ revision, type }) => ({ revision, type })), [
    { revision: 4, type: 'add-entity' },
    { revision: 5, type: 'remove-entity' },
  ]);
  assert.equal(journal.diagnostics().acceptedRevision, 4);
  assert.deepEqual(journal.checkpointSnapshot(), { revision: 3, snapshot: { entities: [{ id: 'a' }] } });
});

test('solver mutation journal coalesces only consecutive unaccepted interactive commands', () => {
  const journal = new SolverMutationJournal();
  journal.record({ revision: 1, type: 'drag-update', payload: { entities: [{ x: 1 }] }, coalesceKey: 'drag' });
  journal.record({ revision: 2, type: 'drag-update', payload: { entities: [{ x: 2 }] }, coalesceKey: 'drag' });
  assert.deepEqual(journal.recoveryPlan().map((entry) => entry.revision), [2]);

  journal.accept(2);
  journal.record({ revision: 3, type: 'drag-update', payload: { entities: [{ x: 3 }] }, coalesceKey: 'drag' });
  assert.deepEqual(journal.recoveryPlan().map((entry) => entry.revision), [2, 3]);
});

test('installing a checkpoint prunes replayed commands and protects snapshot ownership', () => {
  const snapshot = { entities: [{ id: 'checkpoint-a' }] };
  const journal = new SolverMutationJournal({ checkpointInterval: 2 });
  journal.record({ revision: 1, type: 'add-entity', payload: { entity: { id: 'checkpoint-a' } } });
  journal.record({ revision: 2, type: 'solve', payload: {} });
  journal.accept(2);
  assert.equal(journal.shouldCheckpoint(2), true);
  journal.installCheckpoint(2, snapshot);
  snapshot.entities[0].id = 'mutated-outside';

  assert.equal(journal.recoveryPlan().length, 0);
  assert.equal(journal.checkpointSnapshot().snapshot.entities[0].id, 'checkpoint-a');
  assert.equal(journal.diagnostics().checkpointRevision, 2);
});
