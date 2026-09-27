import { writeFileSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { cpus } from 'node:os';
import { fileURLToPath } from 'node:url';
import { makeMixed } from './generate-mixed.mjs';
import { SolverController } from '../../../packages/paramagic-core/src/modules/solver/SolverController.js';
const target=new URL('./mixed-numerical.json',import.meta.url);
if(process.argv[2]==='child') {
  const count=Number(process.argv[3]),connected=process.argv[4]==='true',rows=[];
  const out=new URL(`./numeric-${count}-${connected}.json`,import.meta.url);
  for(let sample=0;sample<3;sample++) {
    const d=makeMixed(count,connected),c=new SolverController({jacobianMode:'blocks'});
    c.loadSketch({...d,entities:d.entities.filter(e=>e.type!=='fillet'),derivedEntities:d.entities.filter(e=>e.type==='fillet')});
    const unsupported=d.constraints.filter(x=>!c.registry.supports(x.type));if(unsupported.length)throw Error(JSON.stringify(unsupported));
    for(const [name,value] of [['c1',82],['c1',80],['c2',11],['c2',10]]) {
      const p=c.dimensions.list().find(x=>x.name===name),start=performance.now();
      const expression=name==='c1'?`MinMax(70, 100, ${value}, 2)`:`MinMax(6, 14, ${value}, 1)`;
      const outcome=c.updateParameter(p.id,{expression,usesDrawingUnit:false});
      if(c.dimensions.get(p.id).value!==value)throw Error(`Control ${name} did not commit ${value}: ${outcome.result.status}`);
      const elapsedMs=performance.now()-start,result=outcome.result,residuals=c.registry.evaluate(c.model,c.dimensions).values;
      rows.push({count,connected,sample,operation:`${name}=${value}`,elapsedMs,status:result.status,iterations:result.iterations,
        maxResidual:Math.max(0,...residuals.map(Math.abs)),squaredResidual:residuals.reduce((a,v)=>a+v*v,0),timings:result.timings,
        scope:result.solveScope,jacobian:result.jacobianStats,committed:c.dimensions.get(p.id).value});
      writeFileSync(out,JSON.stringify(rows,null,2)+'\n');
    }
    const guide=d.entities.find(e=>e.construction&&e.type==='line'&&!e.composite?.swell),actual=c.getEntity(guide.id);
    const circle={id:`audit-circle-${sample}`,type:'circle',stackId:guide.stackId,center:[actual.start[0]+20,actual.start[1]+2],radius:3};
    const start=performance.now();
    const added=c.applyConstraintBatch({entities:[circle],constraints:[{id:`audit-on-line-${sample}`,type:'Point-on Line',enabled:true,stackId:guide.stackId,
      featureRefs:[{kind:'point',recordId:circle.id,index:0},{kind:'segment',recordId:guide.id,index:0}]}]});
    const elapsedMs=performance.now()-start,residuals=c.registry.evaluate(c.model,c.dimensions).values;
    rows.push({count,connected,sample,operation:'Add circle and point-on-line constraint',elapsedMs,status:added.result?.status||c.lastResult.status,
      maxResidual:Math.max(...residuals.map(Math.abs)),scope:c.lastResult.solveScope});
    writeFileSync(out,JSON.stringify(rows,null,2)+'\n');
  }
  console.log(JSON.stringify({count,connected,samples:rows.length,maxMs:Math.max(...rows.map(r=>r.elapsedMs)),statuses:[...new Set(rows.map(r=>r.status))]}));
} else {
  const report={date:new Date().toISOString(),node:process.version,cpu:cpus()[0].model,
    methodology:'Production SolverController, blocks Jacobian, default iteration/tolerance/backend policy. Three fresh fixtures per case. Shared width/radius changes then adding a circle constrained to a source line. Live fillet residuals included; Arrays and external Swell follow-up/rendering are excluded here and measured separately in the browser. 30 second process ceiling per size/topology; partial results retained. Connected and separate fixtures share parameter dependencies; separate means no geometric bridges.',results:[],failures:[]};
  for(const connected of [true,false])for(const count of [2,4,8,16]) {
    try {console.log(execFileSync(process.execPath,[fileURLToPath(import.meta.url),'child',String(count),String(connected)],{encoding:'utf8',timeout:30000}).trim());}
    catch(e){report.failures.push({count,connected,message:String(e.message)});}
    try{report.results.push(...JSON.parse(readFileSync(new URL(`./numeric-${count}-${connected}.json`,import.meta.url))));}catch{}
    writeFileSync(target,JSON.stringify(report,null,2)+'\n');
  }
}
