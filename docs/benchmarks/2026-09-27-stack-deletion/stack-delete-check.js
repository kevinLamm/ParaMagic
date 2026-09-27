import './src/styles/app.css';
import { canvasController as canvas, initialization } from './src/main.js';
import { SolverController } from './packages/paramagic-core/src/modules/solver/SolverController.js';
import { createStackSystem } from './packages/paramagic-core/src/modules/StackSystem.js';
import { transformStackEntity } from './packages/paramagic-core/src/modules/StackCoordinates.js';
await initialization;
const ids = new Map(); const id = name => { if (!ids.has(name)) ids.set(name,crypto.randomUUID()); return ids.get(name); };
const stackNames = ['Outside','Source','Outline','Detail','Hidden child','After'];
const stacks = createStackSystem({records:[],selectedIds:new Set()});
stacks.restore({version:4,activeStackId:id('Outside'),stacks:stackNames.map((name,i)=>({id:id(name),name,order:i,
  parentStackId:['Outline','Hidden child'].includes(name)?id('Source'):name==='Detail'?id('Outline'):null,
  visible:name!=='Hidden child', frame:name==='Outline'?{x:120,y:30,rotation:.2}:undefined,
}))});
const solver = new SolverController(); solver.setStackState(stacks.getState()); solver.setDrawingProperties({drawingUnit:'mm'});
for (const [i,name] of stackNames.entries()) {
  solver.addEntity({id:id(`line-${name}`),type:'line',stackId:id(name),start:[i*60,0],end:[i*60+40,0]});
  solver.addConstraint({id:id(`length-${name}`),type:'Distance',value:40,featureRefs:[{kind:'point',recordId:id(`line-${name}`),index:0},{kind:'point',recordId:id(`line-${name}`),index:2}]});
}
solver.addEntity({id:id('circle'),type:'circle',stackId:id('Outline'),center:[160,80],radius:20});
solver.addDimension({id:id('annotation'),type:'radius-dimension',subtype:'radius',stackId:id('Outline'),dimensionMode:'driving',expression:'20',
  center:[160,80],radius:20,measuredValue:20,elbow:[195,110],label:[205,110],anchors:{center:{type:'center',recordId:id('circle')},radius:{type:'radius',recordId:id('circle')}}});
const pixel = document.createElement('canvas');pixel.width=pixel.height=8;pixel.getContext('2d').fillRect(0,0,8,8);
const initial = solver.getSketchSnapshot();
initial.extensions={stacks:stacks.getState()};
initial.entities.push({id:id('image'),type:'image',stackId:id('Source'),source:pixel.toDataURL(),x:70,y:60,width:40,height:30,locked:true});
const panel=document.createElement('section');panel.style.cssText='position:fixed;right:12px;bottom:10px;max-width:440px;max-height:250px;overflow:auto;background:white;border:1px solid #888;padding:10px;z-index:40;font:12px sans-serif';
const report=document.createElement('pre');report.id='delete-report';report.style.whiteSpace='pre-wrap';panel.append(report);document.body.append(panel);
const checks=[];let before,after,lastMode;
function check(ok,text){if(!ok)throw Error(text);checks.push(text);report.textContent=checks.join('\n');report.scrollIntoView({block:'end'});}
function action(name,fn){const button=document.createElement('button');button.textContent=name;panel.append(button);button.onclick=()=>{try{fn();}catch(e){report.textContent+='\nFAILED: '+e.stack;}};}
function load(){canvas.loadDrawingData(structuredClone(initial),{zoomToFit:true,preserveStackActivation:true,history:'commit'});canvas.flushDrawingUpdate();before=canvas.getDrawingData();report.textContent='Ready: activate Source, then click its Delete Stack button.';}
const ownedIds=names=>before.entities.filter(e=>names.some(n=>id(n)===e.stackId)).map(e=>e.id);
function checkRemoved(mode){
  canvas.flushDrawingUpdate();after=canvas.getDrawingData();lastMode=mode;
  const removedNames=mode==='delete'?['Source','Outline','Detail','Hidden child']:['Source'];
  const removedIds=ownedIds(removedNames);
  check(removedIds.every(id=>!after.entities.some(e=>e.id===id)), `${mode}: removed geometry is absent from drawing data`);
  check(removedIds.every(id=>!document.querySelector(`[data-record-id="${id}"]`)), `${mode}: removed geometry is absent from the canvas`);
  check(removedNames.every(n=>!after.extensions.stacks.stacks.some(s=>s.id===id(n))), `${mode}: removed Stacks are absent`);
  check(!after.entities.some(e=>removedIds.includes(e.id)&&e.stackId===id('Outside')), `${mode}: no geometry moved to the first Stack`);
  const kept=before.entities.filter(e=>!removedIds.includes(e.id));
  check(kept.every(e=>JSON.stringify(after.entities.find(a=>a.id===e.id))===JSON.stringify(e)), `${mode}: surviving geometry and ownership are unchanged`);
  if(mode==='move'){
    check(after.extensions.stacks.stacks.find(s=>s.id===id('Outline')).parentStackId===null && after.extensions.stacks.stacks.find(s=>s.id===id('Hidden child')).parentStackId===null, 'Children promoted to the drawing root');
    check(after.extensions.stacks.stacks.find(s=>s.id===id('Detail')).parentStackId===id('Outline'), 'Grandchild hierarchy preserved');
    check(before.constraints.filter(c=>c.stackId!==id('Source')).every(c=>after.constraints.some(a=>a.id===c.id)), 'Child constraints retained');
    check(before.parameters.filter(p=>p.kind==='dimension').every(p=>after.parameters.some(a=>a.id===p.id)), 'Child driving dimensions retained');
    check(document.querySelector(`[data-record-id="${id('circle')}"]`).getBoundingClientRect().width>0,'Preserved child geometry is rendered');
  }
  check(!document.querySelector('.stack-delete-backdrop'),'Confirmation modal closes after deletion');
}
action('Reset fixture',load);
action('Verify unchanged',()=>{const now=canvas.getDrawingData();check(JSON.stringify(now.entities)===JSON.stringify(before.entities)&&now.constraints.length===before.constraints.length&&now.extensions.stacks.stacks.length===before.extensions.stacks.stacks.length,'Cancellation leaves the drawing unchanged');});
action('Verify delete children',()=>checkRemoved('delete'));
action('Verify move children',()=>checkRemoved('move'));
action('Verify Undo',()=>{const now=canvas.getDrawingData();check(now.entities.length===before.entities.length&&now.constraints.length===before.constraints.length&&now.extensions.stacks.stacks.length===before.extensions.stacks.stacks.length,'One Undo restores complete geometry, constraints and hierarchy');});
action('Verify Redo',()=>checkRemoved(lastMode));
action('Verify reload',()=>{canvas.loadDrawingData(JSON.parse(JSON.stringify(after)),{zoomToFit:true,history:'none',preserveStackActivation:true});checkRemoved(lastMode);check(true,'Serialized reload preserves deletion outcome');});
load();
