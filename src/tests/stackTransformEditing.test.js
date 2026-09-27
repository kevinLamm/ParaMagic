import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SolverController } from '../../packages/paramagic-core/src/modules/solver/SolverController.js';
import { WasmSolverBackend } from '../../packages/paramagic-core/src/modules/solver/WasmSolverSession.js';
import { GLOBAL_LAYER_ID } from '../../packages/paramagic-core/src/modules/StackCoordinates.js';
import { stackTransformDimensionAllowed } from '../../packages/paramagic-core/src/modules/StackTransformPolicy.js';
import { candidateFromSelections, commitSmartDimensionCandidate } from '../../packages/paramagic-core/src/modules/DimensionSystem.js';
import { canvasOriginPointFeature } from '../../packages/paramagic-core/src/modules/CanvasOrigin.js';

const module = new WebAssembly.Module(readFileSync(new URL('../../packages/paramagic-core/src/modules/solver/wasm/solver.wasm', import.meta.url)));
const segment = (recordId, index = 0) => ({ kind: 'segment', recordId, index });
const point = (recordId, index = 0) => ({ kind: 'point', recordId, index });
const near = (a, b, tolerance=1e-7) => assert.ok(Math.abs(a-b) < tolerance, `${a} != ${b}`);
const rounded = value => JSON.parse(JSON.stringify(value, (_, item) => typeof item === 'number' ? Number(item.toFixed(9)) : item));
const local = c => [...c.model.entities.values()].map(b=>b.toEntity());
function fixture(native, direction = [0, 40]) {
  const c = new SolverController({ numericBackend: native ? new WasmSolverBackend(module) : null });
  c.setDrawingProperties({ drawingUnit:'mm' });
  c.setStackState({ activeStackId:null, stacks:[{id:'a',name:'A'},{id:'b',name:'B'}] });
  c.addEntity({ id:'edge',type:'line',stackId:'a',start:[20,30],end:[20+direction[0],30+direction[1]] });
  c.addEntity({ id:'shape',type:'polygon',stackId:'a',points:[[10,20],[60,20],[60,80],[10,80]] });
  c.addEntity({ id:'circle',type:'circle',stackId:'a',center:[45,50],radius:5 });
  c.addEntity({ id:'other',type:'line',stackId:'b',start:[150,20],end:[200,20] });
  return c;
}
function add(c,type,featureRefs) { return c.addConstraint({type,featureRefs,solveDomain:'stack-frame'}); }

for (const native of [false,true]) {
  const backend = native?'WASM':'JavaScript';
  for (const [type,direction] of [['Horizontal',[0,40]],['Vertical',[40,0]],['Horizontal',[-40,15]],['Vertical',[20,-40]]]) {
    test(`${backend}: ${type} rotates a whole Stack from ${direction} without deforming its objects`,()=>{
      const c=fixture(native,direction), before=local(c), other=c.model.entity('other');
      const added=add(c,type,[segment('edge')]);
      assert.ok(added.constraint,JSON.stringify(added.result));
      assert.equal(added.constraint.stackId,GLOBAL_LAYER_ID);
      assert.equal(added.constraint.referenceStackId,GLOBAL_LAYER_ID);
      assert.equal(added.constraint.movingStackId,'a');
      assert.deepEqual(local(c),before);
      assert.deepEqual(c.model.entity('other'),other);
      const edge=c.model.entity('edge'), axis=type==='Horizontal'?1:0;
      near(edge.end[axis],edge.start[axis]);
      assert.ok(Math.abs(c.model.stackFrame('a').rotation)<=Math.PI/2+1e-8);
      near(c.model.stackFrame('a').x,0); near(c.model.stackFrame('a').y,0);
      if(native) assert.equal(added.result.placementBackend,'wasm');
      const restored=new SolverController({ numericBackend:native?new WasmSolverBackend(module):null });
      restored.loadSketch(c.getSketchSnapshot());
      assert.deepEqual(restored.constraints(),c.constraints());
      near(restored.model.stackFrame('a').rotation,c.model.stackFrame('a').rotation);
      assert.deepEqual(rounded(local(restored)),rounded(before));
    });
  }
  test(`${backend}: local constraints survive global rotation and contradictory axes roll back`,()=>{
    const c=fixture(native), internal=c.addConstraint({type:'Vertical',featureRefs:[segment('edge')]});
    assert.ok(internal.constraint);
    const before=local(c);
    assert.ok(add(c,'Horizontal',[segment('edge')]).constraint);
    assert.deepEqual(local(c),before);
    const accepted=c.getSketchSnapshot();
    assert.equal(add(c,'Vertical',[segment('edge')]).constraint,null);
    assert.deepEqual(c.stackState,accepted.stackState);
    assert.deepEqual(local(c),before);
    assert.deepEqual(c.constraints(),accepted.constraints);
    assert.ok(c.registry.evaluate(c.model,c.dimensions).values.every(v=>Math.abs(v)<1e-7));
  });
  test(`${backend}: global Fixed point holds its world position without locking local variables`,()=>{
    const c=fixture(native), before=local(c), pin=c.model.resolvePoint(point('edge'));
    assert.ok(add(c,'Fixed',[point('edge')]).constraint);
    assert.ok(c.model.allVariables().every(v=>!v.fixed));
    assert.ok(add(c,'Horizontal',[segment('edge')]).constraint);
    c.model.resolvePoint(point('edge')).forEach((v,i)=>near(v,pin[i]));
    assert.deepEqual(local(c),before);
  });
  test(`${backend}: global Fixed edge fixes the Stack frame and prevents conflicting rotation`,()=>{
    const c=fixture(native), before=local(c);
    const fixed=add(c,'Fixed',[segment('edge')]);
    assert.ok(fixed.constraint);
    assert.ok(fixed.constraint.fixedFrame);
    assert.ok(c.model.allVariables().every(v=>!v.fixed));
    assert.equal(add(c,'Horizontal',[segment('edge')]).constraint,null);
    near(c.model.stackFrame('a').rotation,0);
    assert.deepEqual(local(c),before);
  });
  test(`${backend}: Length, Equal and same-Stack relations cannot deform geometry in transform mode`,()=>{
    const c=fixture(native), before=local(c), constraints=c.constraints();
    for (const [type,refs] of [['Length',[segment('edge')]],['Equal',[segment('edge'),segment('other')]],['Coincident',[point('edge'),point('shape')]]]) {
      const result=add(c,type,refs); assert.equal(result.constraint,null); assert.equal(result.result.status,'invalid');
    }
    assert.deepEqual(local(c),before); assert.deepEqual(c.constraints(),constraints);
  });
  test(`${backend}: a driving distance between Stacks moves frames and an internal dimension is rejected`,()=>{
    const c=fixture(native), before=local(c);
    const candidate=candidateFromSelections([
      {...point('edge'),point:[20,30]}, {...point('other'),point:[150,20]},
    ],[80,-30],'driving',false,'mm');
    const dim=c.addDimension({...candidate,solveDomain:'stack-frame'});
    assert.equal(dim.entity.stackId,GLOBAL_LAYER_ID);
    const changed=c.setDimension(dim.entity.dimensionId,'200');
    assert.ok(['converged','unchanged'].includes(changed.result?.status||changed.status),JSON.stringify(changed));
    near(Math.abs(c.model.entity('other').start[0]-c.model.entity('edge').start[0]),200,1e-3);
    assert.deepEqual(local(c),before);
    const count=c.parameters().length;
    const internal=candidateFromSelections([{kind:'segment',recordId:'edge',index:0,...c.model.entity('edge')}],[80,50],'driving',false,'mm');
    assert.ok(internal);
    assert.equal(c.addDimension({...internal,solveDomain:'stack-frame'}).entity,null);
    assert.equal(c.parameters().length,count);
  });
  test(`${backend}: active-Stack Horizontal retains local geometry editing`,()=>{
    const c=fixture(native,[20,40]);
    c.setStackState({...c.stackState,activeStackId:'a'});
    const frames=structuredClone(c.stackState), circle=c.model.entity('circle');
    const added=c.addConstraint({type:'Horizontal',solveDomain:'entity',featureRefs:[segment('edge')]});
    assert.ok(added.constraint);
    assert.equal(added.constraint.coordinateSpace,'local');
    assert.deepEqual(c.stackState,frames); assert.deepEqual(c.model.entity('circle'),circle);
    near(c.model.entity('edge').start[1],c.model.entity('edge').end[1],1e-3);
  });
}

test('Smart Dimensions in transform mode accept cross-Stack angles/distances and the origin, excluding internal and external shape edits',()=>{
  const owner=id=>id==='a1'||id==='a2'?'a':'b';
  const dimension=(first,second)=>({type:'dimension-line',anchors:{start:first,end:second}});
  assert.equal(stackTransformDimensionAllowed(dimension(point('a1'),point('b1')),owner),true);
  assert.equal(stackTransformDimensionAllowed(dimension(canvasOriginPointFeature(),point('a1')),owner),true);
  assert.equal(stackTransformDimensionAllowed(dimension(point('a1'),point('a2')),owner),false);
  assert.equal(stackTransformDimensionAllowed({type:'radius-dimension',anchors:{center:point('a1')}},owner),false);
  assert.equal(stackTransformDimensionAllowed({...dimension(point('a1'),point('b1')),externalDrivingTarget:{type:'notch-distance'}},owner),false);
  let calls=0;
  assert.equal(commitSmartDimensionCandidate({getActiveStackId:()=>null,getRecordStackId:owner,addDimension:()=>calls++},dimension(point('a1'),point('a2'))),false);
  assert.equal(calls,0);
});
