import './stack-coordinates-browser.js';
import {PANEL_DOCK_STORAGE_KEY} from '../../../packages/paramagic-core/src/modules/PanelDock.js';
const ids=['stacks','controls','properties'];
const host=document.querySelector('#sidePanelDock');
const toggle=id=>document.querySelector(`[data-dock-toggle="${id}"]`);
const section=id=>document.querySelector(`[data-dock-panel="${id}"]`);
const floatOrDock=id=>section(id).querySelector('.dock-panel-grip').dispatchEvent(new KeyboardEvent('keydown',{key:'f',altKey:true,bubbles:true,cancelable:true}));
const run=document.createElement('button');run.textContent='Check dock layouts';run.style.cssText='position:fixed;bottom:8px;left:340px;z-index:2000;padding:8px;border:1px solid #888;background:white';
const output=document.createElement('output');output.style.cssText='position:fixed;bottom:50px;left:340px;z-index:2000;padding:12px;background:white;font:12px Arial;white-space:pre-wrap;max-height:350px;overflow:auto';
document.body.append(run,output);
const nextFrame=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
run.onclick=async()=>{
 const checks=[];
 const assert=(condition,label)=>{if(!condition)throw Error(label);checks.push(label);};
 const contents=ids.map(id=>section(id).querySelector('.dock-panel-content').firstElementChild);
 try{
  for(const id of ids){
   if(section(id).classList.contains('floating'))floatOrDock(id);
   if(section(id).classList.contains('collapsed'))section(id).querySelector('.dock-panel-title').click();
  }
  for(let mask=0;mask<8;mask++){
   ids.forEach((id,index)=>{const visible=Boolean(mask&(1<<index));if(toggle(id).getAttribute('aria-pressed')!==String(visible))toggle(id).click();});
   await nextFrame();
   assert(ids.every((id,index)=>section(id).hidden===!(mask&(1<<index))),`Visibility combination ${mask}: independently toggled panels`);
   const width=host.getBoundingClientRect().width;
   assert((mask===0?width===40:width>=240) && Math.abs(document.querySelector('.canvas').getBoundingClientRect().left-width)<1,`Visibility combination ${mask}: canvas fits the dock`);
  }
  for(const id of ids){
   const title=section(id).querySelector('.dock-panel-title');title.click();await nextFrame();
   assert(section(id).getBoundingClientRect().height===32,id+' collapses to its header');title.click();
   floatOrDock(id);await nextFrame();
   assert(section(id).classList.contains('floating')&&section(id).parentElement===document.body,id+' floats with original content');
   floatOrDock(id);await nextFrame();
   assert(section(id).parentElement===host.querySelector('.panel-dock-body'),id+' docks again');
  }
  const order=()=>[...host.querySelectorAll('.panel-dock-body > [data-dock-panel]')].map(node=>node.dataset.dockPanel);
  const before=order();const id=before[1];const grip=section(id).querySelector('.dock-panel-grip');
  grip.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowUp',altKey:true,bubbles:true,cancelable:true}));
  assert(order()[0]===id,'Keyboard reorder moves a panel up');
  grip.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',altKey:true,bubbles:true,cancelable:true}));
  assert(JSON.stringify(order())===JSON.stringify(before),'Keyboard reorder restores the original order');
  const divider=host.querySelector('.panel-dock-divider');const first=section(divider.dataset.before);const height=first.getBoundingClientRect().height;
  divider.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true,cancelable:true}));await nextFrame();
  assert(first.getBoundingClientRect().height>height,'Keyboard divider resizing changes panel heights');
  divider.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowUp',bubbles:true,cancelable:true}));
  const widthHandle=host.querySelector('.panel-dock-width-handle');const width=host.getBoundingClientRect().width;
  widthHandle.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true,cancelable:true}));await nextFrame();
  assert(host.getBoundingClientRect().width>width,'Dock width resizes independently');
  widthHandle.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true,cancelable:true}));
  assert(contents.every((content,index)=>section(ids[index]).querySelector('.dock-panel-content').firstElementChild===content),'Toggling, floating, and reordering preserve panel instances');
  const saved=JSON.parse(localStorage.getItem(PANEL_DOCK_STORAGE_KEY));
  assert(saved.order.join()===order().join()&&saved.width===width,'Order and width are persisted');
  assert(document.querySelectorAll('#controlsPanel').length===1&&document.querySelectorAll('#propertiesPanel').length===1,'No duplicate Controls or Properties panels');
  output.textContent='PASS: '+checks.length+' checks\n'+checks.join('\n');
 }catch(error){output.textContent='FAIL: '+error.message+'\n'+checks.join('\n');throw error;}
};
