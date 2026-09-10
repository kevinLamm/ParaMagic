// Run against Vite on port 5180. Set PLAYWRIGHT_MODULE_PATH if Playwright is not installed locally.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const fixture=process.env.CONTROL_FIXTURE || 'src/tests/fixtures/rectangle-ottoman-controls.paramagic';
const output=process.env.CONTROL_AUDIT_OUTPUT || 'tmp/control-stall/ui-fixed';
const cases=process.env.CONTROL_CASES ? JSON.parse(process.env.CONTROL_CASES) : [['c1',70.5],['c1',69.5],['c2',37],['c2',36],['c1',74],['c1',90],['c1',50],['c2',40]];
const d=JSON.parse(await readFile(fixture,'utf8'));await mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true,channel:'msedge'});
const rows=[];
try {
 for(const [name,value] of cases){
  const page=await browser.newPage({viewport:{width:1440,height:1000},acceptDownloads:true});
  await page.addInitScript(()=>{Object.defineProperty(window,'showSaveFilePicker',{value:undefined,configurable:true});window.__workerResults=[];const W=window.Worker;window.Worker=class extends W{constructor(...args){super(...args);this.addEventListener('message',e=>window.__workerResults.push(e.data));}};});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:5180/ParaMagic/');
  await page.locator('#openDrawingFileInput').setInputFiles(fixture);
  await page.waitForFunction(()=>document.querySelectorAll('.canvas-record').length>60);
  await page.evaluate(async()=>{window.__canvas=(await import('/ParaMagic/src/main.js')).canvasController;});
  const settled=async(expected)=>{
   await page.waitForFunction(({name,expected})=>window.__canvas.getParameters().find(p=>p.name===name)?.value===expected&&!window.__canvas.isDrawingUpdatePending()&&!document.querySelector('[data-control-id][aria-busy]'),{name,expected},{timeout:90000});
   await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  };
  const initial=d.parameters.find(p=>p.name===name).value;await settled(initial);
  const rendered=()=>page.locator('.geometry-record').evaluateAll(nodes=>nodes.map(n=>({id:n.getAttribute('data-record-id')||n.id,shapes:[...n.querySelectorAll('.selectable-entity:not(.hit-target)')].map(s=>[s.tagName,...['d','x1','y1','x2','y2','cx','cy','r','points','transform'].map(a=>s.getAttribute(a))])})));
  const before=await rendered();
  if(await page.locator('#controlsPanel').isHidden())await page.locator('#controlsToggle').click();
  const item=d.extensions.controls.items.find(c=>c.parameterName===name);
  const field=page.locator(`[data-control-id="${item.id}"] .panel-control-slider-value`);
  await field.fill(String(value));await page.evaluate(()=>window.__workerResults=[]);
  const start=performance.now();await field.press('Tab');await settled(value);const ms=performance.now()-start;
  const after=await rendered();assert.notDeepEqual(after,before,`${name} must change rendered geometry`);
  const state=await page.evaluate(()=>({data:window.__canvas.getDrawingData(),workers:window.__workerResults,status:document.querySelector('#solverStatus')?.textContent}));
  await page.screenshot({path:`${output}/${name}-${value}.png`});
  await page.locator('#undoButton').click();await settled(initial);assert.ok(JSON.stringify(await rendered())===JSON.stringify(before),'Undo restores rendered geometry');
  await page.locator('#redoButton').click();await settled(value);assert.ok(JSON.stringify(await rendered())===JSON.stringify(after),'Redo restores rendered geometry');
  const downloadPromise=page.waitForEvent('download',{timeout:90000});await page.locator('#appMenuToggle').click();await page.locator('#saveButton').click();
  await page.screenshot({path:`${output}/save-dialog.png`});await page.locator('.save-as-name').waitFor();{await page.locator('.save-as-name').fill(`Ottoman-${name}-${value}`);await page.locator('.save-as-confirm').click();}
  const download=await downloadPromise;const saved=`${output}/${name}-${value}.paramagic`;await download.saveAs(saved);
  await page.evaluate(()=>window.__beforeReloadNode=document.querySelector('.canvas-record'));await page.locator('#openDrawingFileInput').setInputFiles(saved);await page.waitForFunction(()=>!window.__beforeReloadNode.isConnected&&document.querySelectorAll('.canvas-record').length>60);await settled(value);assert.ok(JSON.stringify(await rendered())===JSON.stringify(after),'Save/reload preserves rendered geometry');await page.screenshot({path:`${output}/${name}-${value}-reloaded.png`});
  assert.deepEqual(errors,[]);
  const row={name,value,ms,undo:true,redo:true,saveReload:true,status:state.status,workers:state.workers};rows.push(row);
  await writeFile(`${output}/results.json`,JSON.stringify(rows,null,2));await writeFile(`${output}/${name}-${value}-snapshot.json`,JSON.stringify(state.data,null,2));
  console.log(JSON.stringify({name,value,ms,undo:true,redo:true,saveReload:true}));
  await page.close();
 }
}finally{await browser.close();}
