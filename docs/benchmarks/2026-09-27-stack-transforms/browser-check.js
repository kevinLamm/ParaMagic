import './src/styles/app.css';
import {canvasController as canvas,initialization} from './src/main.js';
import {SolverController} from './packages/paramagic-core/src/modules/solver/SolverController.js';
import {GLOBAL_LAYER_ID,transformStackEntity,stackFrameFor} from './packages/paramagic-core/src/modules/StackCoordinates.js';
await initialization;
const ids=new Map();const id=name=>{if(!ids.has(name))ids.set(name,crypto.randomUUID());return ids.get(name);};
const c=new SolverController();c.setDrawingProperties({drawingUnit:'mm'});
c.setStackState({version:6,activeStackId:null,stacks:[{id:id('A'),name:'Panel A'},{id:id('B'),name:'Panel B'}]});
c.addEntity({id:id('rectangle'),type:'polygon',stackId:id('A'),points:[[20,20],[80,20],[80,60],[20,60]]});
c.addEntity({id:id('circle'),type:'circle',stackId:id('A'),center:[50,90],radius:10});
c.addEntity({id:id('other'),type:'line',stackId:id('B'),start:[140,20],end:[210,20]});
for (const [type,index] of [['Horizontal',0],['Vertical',1],['Horizontal',2],['Vertical',3]]) c.addConstraint({type,featureRefs:[{kind:'segment',recordId:id('rectangle'),index}],solveDomain:'entity'});
const initial=c.getSketchSnapshot();initial.extensions={stacks:c.stackState};
const panel=document.createElement('section');panel.style.cssText='position:fixed;bottom:8px;left:310px;max-width:450px;max-height:150px;overflow:auto;background:white;border:1px solid #777;padding:8px;z-index:40;font:12px sans-serif';
const report=document.createElement('pre');report.id='transform-report';report.style.whiteSpace='pre-wrap';panel.append(report);document.body.append(panel);
const checks=[];let before;
const round=value=>JSON.parse(JSON.stringify(value,(_,v)=>typeof v==='number'?Number(v.toFixed(7)):v));
const data=()=>{canvas.flushDrawingUpdate();return canvas.getDrawingData();};
const local=d=>d.entities.filter(e=>['polygon','line','circle'].includes(e.type)).map(e=>transformStackEntity(e,stackFrameFor(d.extensions.stacks,e.stackId),true));
function check(value,label){if(!value)throw Error(label);checks.push(label);report.textContent=checks.join('\n');}
function button(label,action){const b=document.createElement('button');b.textContent=label;panel.append(b);b.onclick=()=>{try{action();}catch(e){report.textContent+='\nFAILED: '+e.stack;}};}
function load(){canvas.loadDrawingData(structuredClone(initial),{zoomToFit:true,preserveStackActivation:true,history:'commit'});before=data();report.textContent='Ready: no active Stack. Select a constraint then an edge.';}
function verify(type){const after=data(),constraint=after.constraints.find(x=>x.type===type&&x.solveDomain==='stack-frame');
  check(Boolean(constraint),'Created global '+type+' Stack transform');
  check(constraint.stackId===GLOBAL_LAYER_ID&&constraint.referenceStackId===GLOBAL_LAYER_ID,'Relation references drawing axes');
  check(JSON.stringify(round(local(after)))===JSON.stringify(round(local(before))),'All local geometry and direction preserved');
  const shape=after.entities.find(e=>e.id===id('rectangle')),index=constraint.featureRefs[0].index,a=shape.points[index],b=shape.points[(index+1)%4],axis=type==='Horizontal'?1:0;
  check(Math.abs(a[axis]-b[axis])<1e-7,'Selected edge is '+type.toLowerCase());
  check(before.constraints.every(x=>after.constraints.some(y=>y.id===x.id)),'Existing internal constraints retained');
  check(document.querySelector(`[data-record-id="${id('circle')}"]`).getBoundingClientRect().width>0,'Companion circle remains rendered');
  check(after.entities.find(e=>e.id===id('other')).start[0]===140,'Unrelated Stack stays in place');
  check(!after.extensions.stacks.activeStackId,'No Stack activated by applying constraint');
}
button('Reset fixture',load);button('Verify Horizontal',()=>verify('Horizontal'));button('Verify Vertical',()=>verify('Vertical'));
button('Verify Undo',()=>{const after=data();check(JSON.stringify(round(after.entities))===JSON.stringify(round(before.entities)),'Undo restores original geometry');check(after.constraints.length===before.constraints.length,'Undo removes transform constraint');});
button('Verify disabled',()=>{check(['Length','Equal'].every(x=>document.querySelector(`[data-constraint="${x}"]`).disabled),'Length and Equal disabled without an active Stack');});
button('Verify active tools',()=>{check(['Length','Equal'].every(x=>!document.querySelector(`[data-constraint="${x}"]`).disabled),'Length and Equal enabled with an active Stack');});
button('Verify no dimension',()=>check(data().dimensionAnnotations.length===0,'Internal dimension was not created'));
button('Verify dimension',()=>{const after=data(),dim=after.dimensionAnnotations[0];check(dim?.stackId===GLOBAL_LAYER_ID&&dim?.solveDomain==='stack-frame','Created dimension between Stacks in Global');});
button('Verify local shape',()=>check(JSON.stringify(round(local(data())))===JSON.stringify(round(local(before))),'Dimension edit preserves local geometry'));
load();
