import './src/styles/app.css';
import {canvasController as canvas, initialization} from './src/main.js';
import {SolverController} from './packages/paramagic-core/src/modules/solver/SolverController.js';
import {transformStackEntity, stackFrameFor} from './packages/paramagic-core/src/modules/StackCoordinates.js';
await initialization;
const ids = new Map(); const id = name => { if (!ids.has(name)) ids.set(name, crypto.randomUUID()); return ids.get(name); };
const segment = name => ({kind:'segment', recordId:id(name), index:0});
const point = name => ({kind:'point', recordId:id(name), index:0});
let before, mode;
const panel=document.createElement('section'); panel.style.cssText='position:fixed;bottom:8px;left:310px;max-width:640px;max-height:150px;overflow:auto;background:white;border:1px solid #777;padding:8px;z-index:40;font:12px sans-serif';
const report=document.createElement('pre'); report.id='drag-report'; report.style.whiteSpace='pre-wrap';panel.append(report);document.body.append(panel);
const data=()=>{canvas.flushDrawingUpdate();return canvas.getDrawingData();};
const round=value=>JSON.parse(JSON.stringify(value,(_,v)=>typeof v==='number'?Number(v.toFixed(6)):v));
const local=d=>d.entities.map(e=>transformStackEntity(e,stackFrameFor(d.extensions.stacks,e.stackId),true));
const frames=d=>Object.fromEntries(['A','B','C'].map(name=>[name,stackFrameFor(d.extensions.stacks,id(name))]));
function button(label,action){const b=document.createElement('button');b.textContent=label;panel.append(b);b.onclick=()=>{try{action();}catch(e){report.textContent+='\nFAILED: '+e.message;}};}
function load(type){
  mode=type;
  const c=new SolverController(); c.setDrawingProperties({drawingUnit:'mm'});
  c.setStackState({version:6,activeStackId:null,stacks:['A','B','C'].map((name,i)=>({id:id(name),name:'Panel '+name,frame:{x:20+i*110,y:30,rotation:0}}))});
  for(const [i,name] of ['A','B','C'].entries()){
    const x=20+i*110;
    c.addEntity({id:id('rect'+name),type:'polygon',stackId:id(name),points:[[x,30],[x+60,30],[x+60,70],[x,70]]});
    c.addEntity({id:id('circle'+name),type:'circle',stackId:id(name),center:[x+30,95],radius:10});
    for(const [index,axis] of [[0,'Horizontal'],[1,'Vertical'],[2,'Horizontal'],[3,'Vertical']]) c.addConstraint({type:axis,featureRefs:[{...segment('rect'+name),index}],solveDomain:'entity'});
  }
  if(['Parallel','Collinear'].includes(type)) c.addConstraint({type,featureRefs:[segment('rectA'),segment('rectB')],solveDomain:'stack-frame'});
  const dimension=(a,b,subtype,dimensionMode='driving')=>c.addDimension({type:'dimension-line',subtype,dimensionMode,solveDomain:'stack-frame',start:c.model.resolvePoint(point('rect'+a)),end:c.model.resolvePoint(point('rect'+b)),label:[85,10],anchors:{start:point('rect'+a),end:point('rect'+b)}});
  if(['Horizontal dimension','Chain','Driven'].includes(type)) dimension('A','B','horizontal',type==='Driven'?'driven':'driving');
  if(type==='Chain') dimension('B','C','vertical');
  const drawing=c.getSketchSnapshot();drawing.extensions={stacks:c.stackState};
  canvas.loadDrawingData(drawing,{zoomToFit:true,preserveStackActivation:true,history:'commit'});
  before=data();report.textContent=type+': drag Panel A (left rectangle).';
}
const near=(a,b)=>Math.abs(a-b)<1e-6;
function verify(){const after=data(),a=frames(after),b=frames(before),dx=a.A.x-b.A.x,dy=a.A.y-b.A.y;
  if(Math.abs(dx)+Math.abs(dy)<1e-6)throw Error('Panel A did not move');
  if(JSON.stringify(round(local(after)))!==JSON.stringify(round(local(before))))throw Error('Local geometry changed');
  if(after.extensions.stacks.activeStackId)throw Error('Stack activated');
  if(!near(a.C.x,b.C.x)||!near(a.C.y,b.C.y))throw Error('Unrelated/transitively free Panel C moved');
  if(['Parallel','Driven'].includes(mode)&&JSON.stringify(round(a.B))!==JSON.stringify(round(b.B)))throw Error('Panel B followed unconstrained translation');
  if(mode==='Collinear'&&(!near(a.B.x,b.B.x)||!near(a.B.y-b.B.y,dy)))throw Error('Collinear did not preserve sliding freedom');
  if(['Horizontal dimension','Chain'].includes(mode)&&(!near(a.B.x-b.B.x,dx)||!near(a.B.y,b.B.y)))throw Error('Horizontal spacing coupled vertical movement');
  const check=new SolverController();check.loadSketch(after);
  if(check.registry.evaluate(check.model,check.dimensions).values.some(v=>Math.abs(v)>1e-6))throw Error('Constraint residual');
  report.textContent+='\nPASS '+mode+': '+JSON.stringify(round({deltaA:[dx,dy],deltaB:[a.B.x-b.B.x,a.B.y-b.B.y]}))+'; shapes and constraints preserved.';
}
for(const name of ['Parallel','Collinear','Horizontal dimension','Chain','Driven'])button(name,()=>load(name));
button('Verify drag',verify);
button('Verify Undo',()=>{const after=data();if(JSON.stringify(round(after.entities))!==JSON.stringify(round(before.entities)))throw Error('Undo geometry differs');if(JSON.stringify(round(frames(after)))!==JSON.stringify(round(frames(before))))throw Error('Undo frames differ');report.textContent+='\nPASS Undo restores original frames and geometry.';});
load('Parallel');
