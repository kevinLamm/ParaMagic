import { trace, wrap, clearTrace, summarizedTrace } from './instrumentation.mjs';
import { SolverExecutionFacade } from '/packages/paramagic-core/src/modules/solver/SolverExecutionFacade.js';
import { identityAudit } from '/packages/paramagic-core/src/modules/DrawingIdentitySystem.js';
import { evaluateFilletedGeometry } from '/packages/paramagic-core/src/modules/FilletSystem.js';
import { deriveSwellGeometry } from '/packages/paramagic-core/src/modules/SwellGeometry.js';
import { linkedCopyArrayPresentationChecks } from '/src/tests/symmetricTool.browser.js';
wrap(SolverExecutionFacade.prototype, 'loadSketch', 'facade.loadSketch', facade => { trace.facade = facade; });
const invokeController = SolverExecutionFacade.prototype.invokeController;
if(new URLSearchParams(location.search).has('profile')) SolverExecutionFacade.prototype.invokeController = function(method, args) {
  const start = performance.now();
  try { return invokeController.call(this, method, args); }
  finally { trace.methods.push({name:`forward.${method}`,start,elapsedMs:performance.now()-start}); }
};
const responses = [], longTasks = [], errors = [];
const NativeWorker = window.Worker;
window.Worker = class extends NativeWorker {
  constructor(url, options) {
    const target = new URL(url, location.href);
    const replacement = new URL('./worker.mjs', import.meta.url);
    replacement.search = target.search;
    super(target.pathname.endsWith('/SolverWorker.js') ? replacement : url, options);
    this.addEventListener('message', event => responses.push({ receivedAt: performance.now(), command: event.data.commandType,
      status: event.data.status, diagnostics: event.data.diagnostics, auditTrace: event.data.auditTrace }));
  }
};
new PerformanceObserver(list => longTasks.push(...list.getEntries().map(e => ({ start: e.startTime, duration: e.duration })))).observe({ type: 'longtask', buffered: true });
window.addEventListener('error', event => errors.push(String(event.message)));
window.addEventListener('unhandledrejection', event => errors.push(String(event.reason)));
const { canvasController: canvas, initialization } = await import('/src/main.js');
await initialization;
for(const name of ['applySolverSnapshot','notifyObjectChange','getDrawingData','getProcessingDrawingData','notifyDerivedFeatureChange','getDerivedPresentationNodes','syncGeometryStacking'])wrap(canvas,name,`canvas.${name}`);
const originalDrawing = await (await fetch('./Rectangle_Ottoman.paramagic')).json();
const results = [];
const panel = document.createElement('section');
panel.style.cssText = 'position:fixed;bottom:8px;left:8px;z-index:5000;max-width:650px;background:#fff;border:1px solid #555;padding:8px;font:13px sans-serif;max-height:40vh;overflow:auto';
panel.innerHTML = '<strong>Mixed geometry performance audit</strong><div id="audit-actions"></div><output id="audit-status">Preparing drawing</output><details><summary>Recorded results</summary><pre id="audit-results"></pre></details>';
document.body.append(panel);
const status = panel.querySelector('output'), output = panel.querySelector('pre');
const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
function geometryCounts() {
  return { records: canvas.getObjectCount(), svgNodes: canvas.getObjectLayer().querySelectorAll('*').length,
    arrayItems: document.querySelectorAll('.array-item').length,
    swellPieces: document.querySelectorAll('.swell-derived-piece').length,
    svgImages: document.querySelectorAll('svg image').length };
}
async function settle() {
  const started = performance.now();
  let idleFrames = 0;
  while (idleFrames < 4) {
    await frame();
    const facade = trace.facade;
    const busy = facade?.workerClient?.inFlight || facade?.workerClient?.queue?.length
      || facade?.restartPromise || canvas.isDrawingUpdatePending?.() || document.querySelector('[data-control-id][aria-busy]');
    idleFrames = busy ? 0 : idleFrames + 1;
    if (performance.now() - started > 90000) throw new Error('Application did not settle within 90 seconds.');
  }
}
function showResults() { output.textContent = JSON.stringify({ environment: navigator.userAgent, results, errors }, null, 2); }
function correctness() {
  const c=trace.facade.controller, residuals=c.registry.evaluate(c.model,c.dimensions).values;
  const data=canvas.getDrawingData();
  let swellCheck={};
  if(loadedDrawing.name?.startsWith('Mixed')) {
    const derived=deriveSwellGeometry({entities:data.entities,constraints:data.constraints});let resolved=0,maxDistance=0;
    const constraints=data.extensions?.swell?.constraints||[];
    for(const constraint of constraints){
      const request=constraint.externalTarget?.derivedRef,movable=constraint.externalTarget?.movableRef;
      const piece=derived.get(request?.recordId)?.pieces.find(p=>p.role===request.derivedFeature.role&&p.ordinal===request.derivedFeature.ordinal);
      const entity=data.entities.find(e=>e.id===movable?.recordId),p=movable?.index===2?entity?.end:entity?.start;
      if(piece?.entity.type==='line'&&p){const {start:a,end:b}=piece.entity;resolved++;maxDistance=Math.max(maxDistance,Math.abs((b[0]-a[0])*(a[1]-p[1])-(a[0]-p[0])*(b[1]-a[1]))/Math.hypot(b[0]-a[0],b[1]-a[1]));}
    }
    swellCheck={externalSwellConstraints:constraints.length,resolvedSwellConstraints:resolved,maxSwellDistance:maxDistance};
  }
  return {identityValid:identityAudit(data).valid, maximumResidual:Math.max(0,...residuals.map(Math.abs)),
    residualCount:residuals.length,dimensionErrors:c.dimensions.list().filter(p=>p.error).map(p=>({name:p.name,error:p.error})),
    finitePaths:[...canvas.getObjectLayer().querySelectorAll('path')].every(p=>!/NaN|Infinity/.test(p.getAttribute('d')||'')),
    liveFillets:data.entities.filter(e=>e.type==='fillet').length,
    validFillets:evaluateFilletedGeometry(data.entities).length-data.entities.filter(e=>e.type!=='fillet').length,
    ...swellCheck,...linkedCopyArrayPresentationChecks(canvas)};
}
async function measure(name, action, validate = null) {
  await settle(); clearTrace(); responses.length = 0;
  const before = geometryCounts(); const started = performance.now();
  await action(); const actionReturnedMs = performance.now() - started;
  let settlingError=null;
  try {await settle();}catch(error){settlingError=String(error.message);}
  const settledMs = performance.now() - started;
  const row = { name, actionReturnedMs, settledMs, before, after: geometryCounts(),
    main: summarizedTrace(), workers: [...responses],
    longTasks: longTasks.filter(t => t.start >= started), execution: trace.facade?.executionStatus(),
    solverStatus: document.getElementById('solverStatus')?.textContent || '',
    settlingError,checks: { ...(validate ? await validate() : {}), ...correctness() } };
  results.push(row); showResults(); status.textContent = `${name}: ${settledMs.toFixed(1)} ms, ${row.longTasks.length} long tasks`;
  await fetch('http://127.0.0.1:5188/mixed-browser',{method:'POST',body:output.textContent});
  if(settlingError)throw Error(settlingError);
  return row;
}
let loadedDrawing = originalDrawing;
async function load(drawing, label) {
  loadedDrawing = structuredClone(drawing);
  return measure(label, () => {
    canvas.loadDrawingData(structuredClone(drawing), { zoomToFit: true });
    const first = drawing.extensions?.stacks?.stacks?.find(s => s.kind === 'stack' && s.name === 'Top')
      || drawing.extensions?.stacks?.stacks?.find(s => s.kind === 'stack');
    if (first) canvas.setActiveStack(first.id);
  }, () => ({ baseEntityCount: canvas.getDrawingData().entities.length,
    constraints: canvas.getDrawingData().constraints.length,
    identityValid: identityAudit(canvas.getDrawingData()).valid,
    finitePaths: [...canvas.getObjectLayer().querySelectorAll('path')].every(p => !/NaN|Infinity/.test(p.getAttribute('d') || '')) }));
}
async function control(parameterName, target) {
  const item = loadedDrawing.extensions.controls.items.find(c => c.parameterName === parameterName);
  if (!item) throw new Error(`Missing control ${parameterName}`);
  if (document.getElementById('controlsPanel').hidden) document.getElementById('controlsToggle').click();
  const field = document.querySelector(`[data-control-id="${item.id}"] .panel-control-slider-value`);
  if (!field) throw new Error(`Missing rendered control ${parameterName}`);
  return measure(`${loadedDrawing.name}: ${parameterName} = ${target}`, () => {
    field.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    field.value = String(target);
    field.dispatchEvent(new Event('change', { bubbles: true }));
  }, () => {
    const parameter = canvas.getParameters().find(p => p.id === item.parameterId);
    return { requested: target, committed: parameter?.value, committedCorrectly: Math.abs(Number(parameter?.value) - target) < 1e-8,
      invalidControls: document.querySelectorAll('.panel-control-row.invalid').length };
  });
}
function button(label, action) {
  const node = document.createElement('button'); node.textContent = label; node.style.margin = '4px';
  node.onclick = async () => { node.disabled = true; status.textContent = `${label} running`; try { await action(); }
    catch (error) { errors.push(error.stack || String(error)); status.textContent = `FAIL: ${error.message}`; showResults(); }
    finally { node.disabled = false; } };
  panel.querySelector('#audit-actions').append(node);
}
button('Original drawing', () => load(originalDrawing, 'Original load'));
button('Ottoman screenshot baseline', async () => {
  await load(originalDrawing, 'Ottoman screenshot load');
  await control('c2',45); await control('c4',11); await control('c1',63.5);
});
button('Ottoman width 74', () => control('c1',74));
button('Ottoman width 63.5', () => control('c1',63.5));
button('Test original controls', async () => {
  for (const [name, base, step] of [['c1',88,0.5],['c2',53,0.5],['c3',9,0.5],['c4',18,0.5],['c5',12,-1]]) {
    await control(name, base + step); await control(name, base);
  }
});
button('Original without Arrays', async () => {
  const drawing = structuredClone(originalDrawing); drawing.name += ' - no Arrays'; drawing.extensions.arrayTools.arrays = [];
  await load(drawing, 'Load without Arrays'); await control('c3',9.5); await control('c3',9);
});
button('Original without Swell', async () => {
  const drawing = structuredClone(originalDrawing); drawing.name += ' - no Swell'; drawing.extensions.swell.constraints = [];
  for (const entity of drawing.entities) if (entity.composite?.swell) entity.composite.swell.enabled = false;
  await load(drawing, 'Load without Swell'); await control('c4',18.5); await control('c4',18);
});
for (const count of [2,4,8]) button(`Mixed ${count} regions`, async () => {
  const drawing = await (await fetch(`./mixed-${count}.paramagic`)).json();
  await load(drawing, `Mixed ${count} load`);
});
button('Round-trip loaded drawing', async () => {
  const saved = canvas.getDrawingData(); saved.name=loadedDrawing.name;
  const counts={entities:saved.entities.length,constraints:saved.constraints.length,arrays:saved.extensions?.arrayTools?.arrays.length,swell:saved.extensions?.swell?.constraints.length};
  const row=await load(JSON.parse(JSON.stringify(saved)), `${loadedDrawing.name}: save/reload`);
  const after=canvas.getDrawingData();row.checks.roundTripCountsPreserved=JSON.stringify(counts)===JSON.stringify({entities:after.entities.length,constraints:after.constraints.length,arrays:after.extensions?.arrayTools?.arrays.length,swell:after.extensions?.swell?.constraints.length});
  showResults();await fetch('http://127.0.0.1:5188/mixed-browser',{method:'POST',body:output.textContent});
});
button('Add concentric circle',async()=>{
  const source=canvas.getDrawingData().entities.find(e=>e.type==='circle');if(!source)throw Error('No circle source');
  const before=canvas.getDrawingData().constraints.length;let record;
  await measure('Create circle with auto Concentric constraint',()=>{
    canvas.requestHistoryCheckpoint();record=canvas.addObject({id:crypto.randomUUID(),type:'circle',center:[...source.center],radius:source.radius*1.4,stackId:source.stackId},{autoConstrain:true,select:true,snapRefs:[{recordId:source.id,index:0,point:source.center},null]});
  },()=>({created:Boolean(record),addedConstraints:canvas.getDrawingData().constraints.length-before,concentricCreated:canvas.getDrawingData().constraints.some(c=>c.type==='Concentric'&&c.featureRefs?.some(r=>r.recordId===record?.id))}));
});
button('Test mixed controls', async () => {
  for(const [name,base,step] of [['c1',80,2],['c2',10,1]]) {await control(name,base+step);await control(name,base);}
});
button('Test original height',async()=>{await control('c4',18.5);await control('c4',18);});
let parityDifferences = [];
function differences(a,b,path='snapshot',out=[]) {
  if(out.length>=20)return out;
  if(typeof a==='number' && typeof b==='number') {
    if(Number(a.toPrecision(12))!==Number(b.toPrecision(12)))out.push({path,local:a,worker:b});
  } else if(a && b && typeof a==='object' && typeof b==='object') {
    for(const key of new Set([...Object.keys(a),...Object.keys(b)]))differences(a[key],b[key],`${path}.${key}`,out);
  } else if(a!==b)out.push({path,local:a,worker:b});
  return out;
}
button('Verify worker consistency',()=>measure('Worker consistency',async()=>{
  const result=await trace.facade.verifyWorkerParity();
  parityDifferences=differences(trace.facade.controller.getSketchSnapshot(),result.result?.snapshot);
},()=>({parityMatched:!trace.facade.executionStatus().parityError,parityDifferences})));
let dragArmed=false,manual=null,lastDrag=null;
button('Arm drag measurement',()=>{dragArmed=true;status.textContent='Ready: drag a source object on the canvas';});
document.addEventListener('pointerdown',event=>{
  if(!dragArmed||!canvas.getCanvasElement().contains(event.target))return;
  dragArmed=false;clearTrace();responses.length=0;
  manual={started:performance.now(),before:geometryCounts(),beforeEntities:canvas.getDrawingData().entities};
},true);
document.addEventListener('pointerup',async()=>{
  if(!manual)return;const active=manual;manual=null;
  try{
    await settle();const settledMs=performance.now()-active.started;
    const afterEntities=canvas.getDrawingData().entities;
    lastDrag={before:active.beforeEntities,after:afterEntities};
    results.push({name:`${loadedDrawing.name}: actual pointer drag`,settledMs,before:active.before,after:geometryCounts(),main:summarizedTrace(),workers:[...responses],longTasks:longTasks.filter(t=>t.start>=active.started),execution:trace.facade.executionStatus(),checks:{...correctness(),geometryChanged:JSON.stringify(active.beforeEntities)!==JSON.stringify(afterEntities)}});
    showResults();await fetch('http://127.0.0.1:5188/mixed-browser',{method:'POST',body:output.textContent});status.textContent=`Pointer drag recorded: ${settledMs.toFixed(1)} ms`;
  }catch(error){errors.push(String(error));showResults();status.textContent=`Drag failed: ${error.message}`;}
},true);
function shapeDifference(expected) {
  const current=new Map(canvas.getDrawingData().entities.map(e=>[e.id,e]));let max=0;
  for(const e of expected||[])for(const key of ['start','end','center','arcPoint','point','radius']) {
    if(e[key]===undefined)continue;const a=[e[key]].flat(),b=[current.get(e.id)?.[key]].flat();
    for(let i=0;i<a.length;i++)max=Math.max(max,Math.abs(a[i]-b[i]));
  }
  return max;
}
button('Test drag Undo and Redo',async()=>{
  if(!lastDrag)throw Error('Perform an actual pointer drag first');
  await measure('Drag Undo',()=>document.getElementById('undoButton').click(),()=>({maxGeometryDifference:shapeDifference(lastDrag.before)}));
  await measure('Drag Redo',()=>document.getElementById('redoButton').click(),()=>({maxGeometryDifference:shapeDifference(lastDrag.after)}));
});
button('Idle timing baseline',()=>measure('Idle baseline',()=>{}));
button('Record dimension result',()=>measure('Actual dimension label edit: rendered result',()=>{},()=>({
  dimensions:canvas.getParameters().filter(p=>p.kind==='dimension').map(({name,value,expression})=>({name,value,expression}))
})));
button('Save audit results',async()=>{showResults();const response=await fetch('http://127.0.0.1:5188/mixed-browser',{method:'POST',body:output.textContent});status.textContent=await response.text();});
const initialFixture=new URLSearchParams(location.search).get('fixture');
await load(initialFixture==='2'?await(await fetch('./mixed-2.paramagic')).json():originalDrawing,initialFixture==='2'?'Mixed 2 initial load':'Initial original load');
status.textContent += ' — ready';
