import './src/styles/app.css';
import {canvasController as canvas, initialization} from './src/main.js';
import {SolverController} from './packages/paramagic-core/src/modules/solver/SolverController.js';
import {transformStackEntity,stackFrameFor,GLOBAL_LAYER_ID} from './packages/paramagic-core/src/modules/StackCoordinates.js';
await initialization;
const ids=new Map(),id=name=>{if(!ids.has(name))ids.set(name,crypto.randomUUID());return ids.get(name);};
const panel=document.createElement('section');panel.style.cssText='position:fixed;bottom:8px;left:310px;max-width:640px;max-height:145px;overflow:auto;background:white;border:1px solid #777;padding:8px;z-index:40;font:12px sans-serif';
const report=document.createElement('pre');report.id='origin-report';report.style.whiteSpace='pre-wrap';panel.append(report);document.body.append(panel);
const round=v=>JSON.parse(JSON.stringify(v,(_,n)=>typeof n==='number'?Number(n.toFixed(6)):n));
const data=()=>{canvas.flushDrawingUpdate();return canvas.getDrawingData();};
const local=d=>d.entities.map(e=>{
  const g=transformStackEntity(e,stackFrameFor(d.extensions.stacks,e.stackId),true);
  return {id:g.id,type:g.type,points:g.points,center:g.center,radius:g.radius};
});
let before,axis='horizontal',created,edited;
function button(label,fn){const b=document.createElement('button');b.textContent=label;panel.append(b);b.onclick=()=>{try{fn();}catch(e){report.textContent+='\nFAILED '+e.message;}};}
const near=(a,b,t=0.02)=>{if(Math.abs(a-b)>t)throw Error(`${a} != ${b}`);};
function load(nextAxis='horizontal',linked=false){axis=nextAxis;const c=new SolverController();c.setDrawingProperties({drawingUnit:'mm'});
  c.setStackState({version:6,activeStackId:null,stacks:['A','B','Bounds'].map(name=>({id:id(name),name:'Panel '+name}))});
  const pts=axis==='horizontal'?[[100,60],[200,60],[200,120],[100,120]]:[[60,100],[60,200],[120,200],[120,100]];
  c.addEntity({id:id('rectangle'),type:'polygon',stackId:id('A'),points:pts});
  c.addEntity({id:id('circle'),type:'circle',stackId:id('A'),center:[160,160],radius:10});
  c.addEntity({id:id('other'),type:'polygon',stackId:id('B'),points:[[230,60],[290,60],[290,110],[230,110]]});
  c.addEntity({id:id('bounds'),type:'circle',stackId:id('Bounds'),center:[-35,-35],radius:2});
  for(const [i,type] of (axis==='horizontal'?['Horizontal','Vertical','Horizontal','Vertical']:['Vertical','Horizontal','Vertical','Horizontal']).entries())c.addConstraint({type,solveDomain:'entity',featureRefs:[{kind:'segment',recordId:id('rectangle'),index:i}]});
  if(linked)c.addConstraint({type:'Collinear',solveDomain:'stack-frame',featureRefs:[{kind:'segment',recordId:id('rectangle'),index:0},{kind:'segment',recordId:id('other'),index:0}]});
  const drawing=c.getSketchSnapshot();drawing.extensions={stacks:c.stackState};canvas.loadDrawingData(drawing,{zoomToFit:true,preserveStackActivation:true,history:'commit'});before=data();created=null;edited=null;
  report.textContent=axis+(linked?' linked':'')+': dimension origin to first rectangle edge, then edit 60 to 85.';
}
function verify(value){const d=data(),dim=d.dimensionAnnotations.find(a=>a.anchors?.pointToSegment);if(!dim)throw Error('Missing point-edge dimension');
  if(dim.anchors.pointToSegment.projectionMode!=='line'||dim.dimensionMode!=='driving')throw Error('Point-edge reference or driving mode lost');
  const constraint=d.constraints.find(c=>c.dimensionRef===dim.dimensionId);if(constraint?.type!=='Point Line Distance'||constraint.projectionMode!=='line')throw Error('Wrong constraint type');
  if(constraint.featureRefs[0].referenceRole!=='canvas-origin'||constraint.featureRefs[1].recordId!==id('rectangle'))throw Error('Origin or edge reference lost');
  if(JSON.stringify(round(local(d)))!==JSON.stringify(round(local(before))))throw Error('Local shape changed: '+JSON.stringify({actual:round(local(d)),expected:round(local(before))}));
  const rect=d.entities.find(e=>e.id===id('rectangle')),p=rect.points;
  near(axis==='horizontal'?p[0][1]:p[0][0],value);near(axis==='horizontal'?p[1][1]:p[1][0],value);
  for(const name of ['A','B'])near(stackFrameFor(d.extensions.stacks,id(name)).rotation,0,1e-6);
  if(d.extensions.stacks.activeStackId)throw Error('Stack active');
  report.textContent+=`\nPASS distance ${value}, edge reference and local geometry preserved; no rotation.`;return d;
}
button('Horizontal fixture',()=>load());button('Vertical fixture',()=>load('vertical'));button('Linked fixture',()=>load('horizontal',true));
button('Verify created',()=>{created=verify(60);});button('Verify edited',()=>{edited=verify(85);});
button('Verify sliding',()=>{const d=verify(85),a=stackFrameFor(d.extensions.stacks,id('A')),b=stackFrameFor(edited.extensions.stacks,id('A'));if(Math.abs(axis==='horizontal'?a.x-b.x:a.y-b.y)<2)throw Error('No free sliding motion');report.textContent+='\nPASS diagonal drag retained free sliding.';});
button('Reload snapshot',()=>{canvas.loadDrawingData(data(),{preserveStackActivation:true,history:'commit'});report.textContent+='\nSnapshot reloaded.';});
button('Verify Undo',()=>{verify(60);report.textContent+='\nPASS Undo restored previous dimension.';});
load();
