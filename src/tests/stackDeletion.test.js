import test from 'node:test';
import assert from 'node:assert/strict';
import { planStackDeletion, createStackDeletionAction } from '../../packages/paramagic-core/src/modules/StackDeletion.js';
import { requestStackDeletion } from '../../packages/paramagic-core/src/modules/StackDeleteDialog.js';
import { createStackSystem } from '../../packages/paramagic-core/src/modules/StackSystem.js';
import { SolverController } from '../../packages/paramagic-core/src/modules/solver/SolverController.js';
import { GLOBAL_LAYER_ID } from '../../packages/paramagic-core/src/modules/StackCoordinates.js';
import { fixtureUuid } from './helpers/fixtureUuid.js';

const id = name => fixtureUuid(`stack-deletion:${name}`);
function fixture() {
  const stacks = [
    { id: id('root'), name: 'Root' },
    { id: id('before'), name: 'Before', parentStackId: id('root'), order: 0 },
    { id: id('parent'), name: 'Parent', parentStackId: id('root'), order: 1 },
    { id: id('child'), name: 'Child', parentStackId: id('parent'), order: 0, frame: { x: 80, y: 20, rotation: 0.3 } },
    { id: id('grandchild'), name: 'Grandchild', parentStackId: id('child'), enabled: false },
    { id: id('child2'), name: 'Child 2', parentStackId: id('parent'), order: 1, visible: false },
    { id: id('after'), name: 'After', parentStackId: id('root'), order: 2 },
  ];
  const records = stacks.map((s, i) => ({ id: id(`line-${s.name}`), recordType: 'geometry', entity: {
    id: id(`line-${s.name}`), type: 'line', stackId: s.id, start: [i*30, 0], end: [i*30+10, 0],
  } }));
  const system = createStackSystem({ records, selectedIds: new Set() });
  system.restore({ version: 4, stacks, activeStackId: id('child') });
  return { system, records };
}

test('moving children preserves their frames, IDs and subtrees at the deleted parent position', () => {
  const { system } = fixture(), before = system.getState();
  const plan = planStackDeletion(before, id('parent'), { children: 'move' });
  assert.deepEqual(plan.removedStackIds, [id('parent')]);
  assert.deepEqual(plan.promotedStackIds, [id('child'), id('child2')]);
  const removed = system.removeStackSubtree(id('parent'), { children: 'move' });
  assert.deepEqual(removed.recordIds, [id('line-Parent')]);
  assert.deepEqual(system.getState().stacks.filter(s => s.parentStackId === id('root')).map(s=>s.name), ['Before','Child','Child 2','After']);
  for (const name of ['child','grandchild','child2']) {
    const original = before.stacks.find(s=>s.id===id(name));
    assert.deepEqual(system.stack(id(name)), { ...original, ...(name === 'grandchild' ? {} : {
      parentStackId: id('root'), order: name === 'child' ? 1 : 2,
    }) });
  }
  assert.equal(system.activeStackId(), id('child'));
});

test('moving children of a top-level Stack promotes them to the drawing root', () => {
  const { system } = fixture();
  system.removeStackSubtree(id('root'), { children: 'move' });
  assert.equal(system.stack(id('parent')).parentStackId, null);
  assert.equal(system.stack(id('child')).parentStackId, id('parent'));
  assert.equal(system.stack(id('grandchild')).parentStackId, id('child'));
});

test('delete children includes hidden and disabled descendants and excludes outside Stacks', () => {
  const { system } = fixture();
  const result = system.removeStackSubtree(id('parent'), { children: 'delete' });
  assert.deepEqual(new Set(result.recordIds), new Set(['Parent','Child','Grandchild','Child 2'].map(n=>id(`line-${n}`))));
  assert.equal(system.stack(id('before')).name, 'Before');
  assert.equal(system.stack(id('child')), null);
});

test('invalid removal modes and the Global layer cannot mutate Stack state', () => {
  const { system } = fixture(), before = system.getState();
  assert.throws(()=>system.removeStackSubtree(id('parent'), { children: 'unknown' }), /delete or move/);
  assert.equal(system.removeStackSubtree(GLOBAL_LAYER_ID), false);
  assert.deepEqual(system.getState(), before);
});

for (const mode of ['delete', 'move']) test(`Stack ${mode} removes only applicable constraints and passes explicit records to deletion`, () => {
  const { system, records } = fixture();
  const solver = new SolverController();
  const constraints = records.map(r => ({ id: id(`constraint-${r.id}`), type: 'Distance',
    stackId: r.entity.stackId, value: 10, featureRefs: [{kind:'point',recordId:r.id,index:0},{kind:'point',recordId:r.id,index:2}],
  }));
  solver.loadSketch({ stackState: system.getState(), entities: records.map(r=>r.entity), constraints });
  const calls = [];
  const remove = createStackDeletionAction({ stacks: system, solver,
    checkpoint: () => calls.push('checkpoint'), extensionProviders: [], getRelationships: () => null,
    deleteRecords: (ids, options) => { calls.push({ ids, options }); ids.forEach(id=>solver.removeEntity(id)); },
  });
  assert.equal(remove(id('parent'), { children: mode }), true);
  const expectedNames = mode === 'delete' ? ['Parent','Child','Grandchild','Child 2'] : ['Parent'];
  assert.deepEqual(new Set(calls[1].ids), new Set(expectedNames.map(n=>id(`line-${n}`))));
  assert.equal(calls[1].options.respectLocks, false);
  const survivingConstraints = constraints.filter(c=>!expectedNames.map(n=>id(`line-${n}`)).includes(c.featureRefs[0].recordId));
  assert.deepEqual(new Set(solver.constraints().map(c=>c.id)), new Set(survivingConstraints.map(c=>c.id)));
  assert.equal(calls.filter(c=>c==='checkpoint').length, 1);
});

for (const response of [null, 'move', 'delete']) {
  test(`Stack deletion asks only how to handle children: ${response}`, async () => {
    const { system } = fixture(), prompts = [], removals = [];
    const result = await requestStackDeletion({ stackId: id('parent'), getStackState: system.getState,
      choose: async prompt => { assert.equal(removals.length,0); prompts.push(prompt); return response; },
      removeStack: (stackId, options) => { removals.push({ stackId, options }); return true; },
    });
    assert.equal(prompts.length, 1);
    assert.deepEqual(prompts[0].choices.map(choice=>choice.value), ['move', 'delete']);
    assert.equal(result, response!==null);
    assert.equal(removals.length, result ? 1 : 0);
    if (result) assert.deepEqual(removals[0], { stackId:id('parent'), options:{children:response} });
    assert.match(prompts[0].message, /into “Root”/);
  });
}

test('a Stack without children is deleted immediately without a dialog', async () => {
  const { system } = fixture(); let removal;
  const result = requestStackDeletion({ stackId:id('before'), getStackState:system.getState,
    choose: async()=>assert.fail('Leaf deletion must not open a dialog'),
    removeStack:(stackId, options)=>{removal={stackId,options}; return true;},
  });
  assert.deepEqual(removal,{stackId:id('before'),options:{children:'delete'}});
  assert.equal(await result, true);
});

test('disposing the panel while the child choice is pending cancels deletion', async () => {
  const { system } = fixture(), abort = new AbortController(); let removed=false;
  assert.equal(await requestStackDeletion({ stackId:id('parent'), getStackState:system.getState, signal:abort.signal,
    choose: async()=>{abort.abort();return 'delete';},removeStack:()=>{removed=true;},
  }),false);
  assert.equal(removed,false);
});
