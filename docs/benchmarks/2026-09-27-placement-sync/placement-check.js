import './src/styles/app.css';
import { SolverController } from './packages/paramagic-core/src/modules/solver/SolverController.js';
const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
async function wait(check) { const start=performance.now(); while(!check()) { if(performance.now()-start>30000) throw Error('Timed out'); await frame(); } }
const messages=[], BrowserWorker=globalThis.Worker;
globalThis.Worker=class extends BrowserWorker { constructor(url, options) { super(url,options); if(String(url).includes('SolverWorker'))this.addEventListener('message',({data})=>messages.push(data)); } };
const {canvasController: canvas, initialization}=await import('./src/main.js'); await initialization; globalThis.Worker=BrowserWorker;
const drawing=await(await fetch('/src/tests/fixtures/placement-front-view.paramagic')).json();
let loads=messages.filter(m=>m.commandType==='load-sketch').length;
canvas.loadDrawingData(drawing,{zoomToFit:true,history:'commit'});
canvas.setActiveStack(null);
await wait(()=>messages.filter(m=>m.commandType==='load-sketch').length>loads); await frame(); await frame();
const panel=document.createElement('section'); panel.id='placement-check';
panel.style.cssText='position:fixed;left:340px;top:65px;z-index:20000;background:white;color:#123;padding:8px;max-width:660px;border:1px solid #789;font:12px sans-serif';
panel.innerHTML='<button id="capture-drag">Record completed drag</button> <button id="check-edit">Verify control edit</button> <button id="check-history">Verify history and reload</button><pre id="placement-result" style="max-height:230px;overflow:auto">Ready: drag the Front geometry, then record the drag.</pre>';
document.body.append(panel);
const output=panel.querySelector('pre'), checks=[];
const check=(condition,label)=>{if(!condition)throw Error(label);checks.push(label);};
const near=(a,b,tolerance=1e-5)=>Math.abs(a-b)<tolerance;
const value=()=>canvas.getParameters().find(p=>p.name==='c1').value;
const baseline=canvas.getDrawingData(), initialValue=value();
const svg=()=>document.querySelector('[data-record-id="e00ba7d1-23a4-46bf-8014-b9cb8e6b54dc"]')?.outerHTML;
const beforeSvg=svg();
const plainFrames=data=>JSON.stringify((data.stackState||data.extensions.stacks).stacks.filter(s=>s.kind!=='global').map(s=>[s.id,s.frame]));
const originalFrames=plainFrames(baseline);
let moved, accepted, expectedFrames, expectedValue, loadCount;
function action(id,fn){document.getElementById(id).onclick=async()=>{try{output.textContent='Checking…';await fn();output.textContent=JSON.stringify({checks,initialValue,value:value(),status:'passed'},null,2);}catch(error){output.textContent=error.stack;}};}
action('capture-drag',async()=>{
  await frame(); canvas.flushDrawingUpdate(); moved=canvas.getDrawingData();
  check(canvas.getStackRuntimeState().activeStackId===null,'No Stack is active during relocation');
  check(plainFrames(moved)!==originalFrames,'Collective drag changed Stack placement');
  check(svg()!==beforeSvg,'Relocated geometry is rendered');
  check(value()===initialValue,'Dragging preserves the control dimension');
  loadCount=messages.filter(m=>m.commandType==='load-sketch').length;
  output.textContent='Drag recorded. Change c1, then verify the edit.';
});
action('check-edit',async()=>{
  check(Boolean(moved),'A completed drag was recorded');
  await wait(()=>value()!==initialValue && messages.some(m=>m.commandType==='update-parameter'));
  await frame(); await frame(); accepted=canvas.getDrawingData(); expectedFrames=plainFrames(accepted); expectedValue=value();
  const result=messages.filter(m=>m.commandType==='update-parameter').at(-1);
  const backend=new URLSearchParams(location.search).get('solverBackend')||'wasm';
  check(result.status==='converged','Control edit converges'); check(result.diagnostics.backend===backend,`Control edit uses ${backend}`);
  check(messages.filter(m=>m.commandType==='load-sketch').length===loadCount,'Control edit uses the persistent Worker model');
  const oracle=new SolverController({jacobianMode:'blocks'}); oracle.loadSketch(moved);
  const parameter=canvas.getParameters().find(p=>p.name==='c1');
  const reference=oracle.updateParameter(parameter.id,{expression:parameter.expression});
  check(reference.result.status==='converged','JavaScript reference converges from the relocated drawing');
  const actual=new SolverController({jacobianMode:'blocks'});
  // Hydrate the rendered document for measurement without letting load solve it.
  actual.solve=()=>({status:'unchanged',changedEntityIds:[]}); actual.loadSketch(accepted);
  const residual=Math.hypot(...actual.registry.evaluate(actual.model,actual.dimensions).values);
  check(residual<1e-8,`Final residual ${residual} is below 1e-8`);
  let maxError=0;
  for(const entity of oracle.getGeometrySnapshot()){
    const observed=actual.getEntity(entity.id);
    for(const key of ['point','start','end','center','arcPoint'])if(Array.isArray(entity[key]))for(let axis=0;axis<2;axis++)maxError=Math.max(maxError,Math.abs(entity[key][axis]-observed[key][axis]));
    if(Array.isArray(entity.points))entity.points.forEach((p,i)=>p.forEach((v,axis)=>maxError=Math.max(maxError,Math.abs(v-observed.points[i][axis]))));
  }
  check(maxError<1e-4,`Rendered relocated coordinates match the reference; maximum error ${maxError}`);
  check(accepted.constraints.length===baseline.constraints.length,'All saved constraints remain present');
  canvas.flushDrawingUpdate();
});
action('check-history',async()=>{
  check(Boolean(accepted),'The relocated control solve was verified');
  document.getElementById('undoButton').click(); await wait(()=>value()===initialValue); await frame();
  check(plainFrames(canvas.getDrawingData())===plainFrames(moved),'Undo of control edit retains the relocated position');
  document.getElementById('undoButton').click(); await frame(); await frame();
  check(plainFrames(canvas.getDrawingData())===originalFrames,'Undo of drag restores the original position');
  document.getElementById('redoButton').click(); await frame(); await frame();
  check(plainFrames(canvas.getDrawingData())===plainFrames(moved),'Redo of drag restores the relocated position');
  document.getElementById('redoButton').click(); await wait(()=>value()===expectedValue); await frame();
  check(plainFrames(canvas.getDrawingData())===expectedFrames,'Redo of control edit retains the solved placement');
  const count=messages.filter(m=>m.commandType==='load-sketch').length;
  canvas.loadDrawingData(JSON.parse(JSON.stringify(accepted)),{zoomToFit:false});
  await wait(()=>messages.filter(m=>m.commandType==='load-sketch').length>count);await frame();
  check(plainFrames(canvas.getDrawingData())===expectedFrames && value()===expectedValue,'Serialized reload preserves relocated geometry and control value');
});
