import './stack-coordinates-browser.js';
import {canvasController} from '../../main.js';
const stack=canvasController.getStackRuntimeState().stacks.find(s=>s.name==='Moving');
canvasController.setActiveStack(stack.id);
const run=document.createElement('button');run.textContent='Check drawing-tool helper hit testing';
run.style.cssText='position:fixed;bottom:8px;left:220px;z-index:2000;background:white;padding:8px;border:1px solid #888';
const output=document.createElement('output');output.style.cssText='position:fixed;bottom:55px;left:280px;z-index:2000;background:white;padding:12px;white-space:pre-wrap;font:12px Arial';
document.body.append(run,output);
run.onclick=()=>{
 const results=[];
 try{
  const assert=(value,label)=>{if(!value)throw Error(label);results.push(label);};
  const helpers=()=>[...document.querySelectorAll('.constraint-helper-button')];
  assert(helpers().length>0,'Fixture has visible constraint helpers');
  const tools=[...document.querySelectorAll('[data-drawing-tool]')];
  for(const tool of tools){
   if(tool.disabled)continue;
   tool.click();
   assert(tool.getAttribute('aria-pressed')==='true',tool.dataset.drawingTool+' activates');
   assert(helpers().every(helper=>{
    const bounds=helper.getBoundingClientRect();
    return getComputedStyle(helper).pointerEvents==='none' && !document.elementsFromPoint(bounds.x+bounds.width/2,bounds.y+bounds.height/2).some(n=>n.closest?.('.constraint-helper-button'));
   }),tool.dataset.drawingTool+': helpers do not intercept hit tests');
   tool.click();
   assert(helpers().every(h=>getComputedStyle(h).pointerEvents==='auto'),tool.dataset.drawingTool+': helpers restore after deactivation');
  }
  output.textContent='PASS: '+results.length+' checks\n'+results.join('\n');
 }catch(error){output.textContent='FAIL: '+error.message+'\n'+results.join('\n');throw error;}
};
