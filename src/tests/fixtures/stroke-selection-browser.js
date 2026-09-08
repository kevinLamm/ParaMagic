import './stack-coordinates-browser.js';
import { canvasController } from '../../main.js';
const original = structuredClone(canvasController.getDrawingData());
const button = document.createElement('button');
button.textContent = 'Check stroke selection and Delete';
button.style.cssText = 'position:fixed;bottom:8px;left:220px;z-index:2000;background:white;padding:8px;border:1px solid #888';
const output = document.createElement('output');
output.style.cssText = 'position:fixed;bottom:52px;left:280px;z-index:2000;background:white;padding:12px;white-space:pre-wrap;font:12px Arial;max-height:300px;overflow:auto';
document.body.append(button,output);
const key = (target,key) => target.dispatchEvent(new KeyboardEvent('keydown',{key,bubbles:true,cancelable:true}));
button.onclick = () => {
 const checks=[];
 const assert=(condition,message)=>{if(!condition)throw Error(message);checks.push(message);};
 const reset=()=>{canvasController.loadDrawingData(structuredClone(original),{zoomToFit:true});const stack=canvasController.getStackRuntimeState().stacks.find(s=>s.name==='Moving');canvasController.setActiveStack(stack.id);return stack.id;};
 try {
  for (const kind of ['entity','dimension']) {
   const stackId=reset();
   const data=canvasController.getDrawingData();
   const entry=kind==='entity'?data.entities.find(e=>e.type==='circle'&&e.stackId===stackId):data.dimensionAnnotations.find(e=>e.stackId===stackId);
   assert(Boolean(entry),kind+' exists in active Stack');
   const row=document.querySelector(`[data-stack-id="${stackId}"][role="treeitem"], [data-stack-id="${stackId}"][role="row"]`) || document.querySelector(`.stack-tree-row[data-stack-id="${stackId}"]`);
   row.focus();
   const node=document.querySelector(`.canvas-record[data-record-id="${entry.id}"] .selectable-entity`);
   node.dispatchEvent(new PointerEvent('pointerdown',{button:0,bubbles:true,cancelable:true}));
   canvasController.selectRecords([entry.id]);
   assert(document.activeElement===document.querySelector('.canvas'),kind+' selection transfers keyboard focus from Stack to canvas');
   key(document.activeElement,kind==='entity'?'Delete':'Backspace');
   const after=canvasController.getDrawingData();
   assert(!(kind==='entity'?after.entities:after.dimensionAnnotations).some(e=>e.id===entry.id),kind+' deletion removes the selected item');
   assert(canvasController.getStackRuntimeState().stacks.some(s=>s.id===stackId),kind+' deletion preserves its Stack');
  }
  const stackId=reset();
  const strokes=[...document.querySelectorAll('.canvas .hit-target:not(.dimension-text-hit):not(.table-hit-target), .canvas .segment-select-line')];
  assert(strokes.length>0 && strokes.every(n=>getComputedStyle(n).strokeWidth==='40px'),'All rendered entity/dimension/segment hit strokes are 40px');
  const segment=document.querySelector('.segment-select-line');
  for (const state of ['smart-selected','segment-selected','overlap-cycle-selected']) {
   segment.classList.add(state);segment.style.strokeWidth='1.5px';
   assert(getComputedStyle(segment).strokeWidth==='40px',state+' keeps a 40px hit stroke');segment.classList.remove(state);
  }
  segment.style.strokeWidth='';
  const row=document.querySelector(`.stack-tree-row[data-stack-id="${stackId}"]`);
  row.focus();const event=new KeyboardEvent('keydown',{key:'Delete',bubbles:true,cancelable:true});
  let reachedDocument=false;const observe=()=>{reachedDocument=true;};document.addEventListener('keydown',observe);
  row.dispatchEvent(event);document.removeEventListener('keydown',observe);
  assert(!canvasController.getStackRuntimeState().stacks.some(s=>s.id===stackId),'Explicit Stack keyboard deletion still works');
  assert(!reachedDocument,'Stack deletion does not also execute canvas Delete');
  reset();output.textContent='PASS: '+checks.length+' checks\n'+checks.join('\n');
 }catch(error){output.textContent='FAIL: '+error.message+'\n'+checks.join('\n');throw error;}
};
