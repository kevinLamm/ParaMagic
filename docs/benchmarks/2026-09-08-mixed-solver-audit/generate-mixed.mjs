// Reproducible mixed-geometry audit fixtures; no production modifications.
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { withSwellDefinition, deriveSwellGeometry } from '../../../packages/paramagic-core/src/modules/SwellGeometry.js';
import { evaluateFillet, regularFilletConstraints } from '../../../packages/paramagic-core/src/modules/FilletSystem.js';
import { SolverController } from '../../../packages/paramagic-core/src/modules/solver/SolverController.js';
const original = JSON.parse(readFileSync(new URL('./Rectangle_Ottoman.paramagic', import.meta.url)));
const uuid = key => { const h = createHash('sha256').update(`mixed-audit:${key}`).digest('hex'); return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-8${h.slice(17,20)}-${h.slice(20,32)}`; };
const point = (entity, index) => ({ kind:'point', recordId:entity.id, index });
const segment = entity => ({ kind:entity.type === 'line' ? 'segment' : entity.type, recordId:entity.id, index:0 });
export function makeMixed(count, connected = true) {
  const stackId = uuid('stack');
  const d = { ...structuredClone(original), name:`Mixed ${count} ${connected ? 'connected' : 'separate'} regions`,
    drawingId:uuid(`drawing-${count}-${connected}`), drawingUnit:'mm', dxfExportUnit:'mm', entities:[],constraints:[],parameters:[],dimensionAnnotations:[],
    documentMetadata:{},documentContext:{},extensions:{
      stacks:{version:6,activeStackId:stackId,stacks:[{id:stackId,name:'Mixed regions',kind:'stack',systemRole:'default-stack',parentStackId:null,order:0,visible:true,enabled:true,frame:{x:0,y:0,rotation:0}},
        {id:'00000000-0000-4000-8000-000000000001',kind:'global',name:'Global',enabled:true,visible:true,order:1,parentStackId:null,removable:false}]},
      controls:{version:3,items:[]},arrayTools:{version:6,arrays:[]},swell:{version:2,constraints:[]}} };
  let serial=0, dimensionIndex=0;
  function constraint(type, refs, extra={}) { const c={id:uuid(`c-${serial++}`),type,featureRefs:refs,source:'geometric',enabled:true,stackId,coordinateSpace:'local',...extra};d.constraints.push(c);return c; }
  function entity(key,type,fields) { const e={id:uuid(key),type,stackId,classId:d.activeClassId,...fields}; d.entities.push(e); return e; }
  function dim(type,refs,expression,value,extra={}) {
    type=({HorizontalDistance:'Horizontal Distance',VerticalDistance:'Vertical Distance'})[type]||type;
    const n=++dimensionIndex, id=uuid(`dimension-${n}`);
    d.parameters.push({id,name:`d${n}`,expression,value,kind:'dimension',driving:true,computed:false,enabled:true,unit:'mm',stackId,order:n+2});
    constraint(type,refs,{source:'dimension',dimensionRef:id,...extra}); return id;
  }
  for (const [name,label,value,min,max,step] of [['c1','Region width',80,70,100,2],['c2','Corner radius',10,6,14,1]]) {
    const expression=`MinMax(${min}, ${max}, ${value}, ${step})`, id=uuid(name);
    d.parameters.push({id,name,expression,value,kind:'control',driving:false,computed:false,unit:null,order:d.parameters.length,usesDrawingUnit:false});
    d.extensions.controls.items.push({id:uuid(`control-${name}`),controlType:'horizontal-scrollbar',label,configurationExpression:expression,selectedIndex:0,visible:true,visibleExpression:'',parameterId:id,parameterName:name});
  }
  let previousTop;
  for(let region=0;region<count;region++) {
    const x=region*150,w=80,h=60,r=10, prefix=`region-${region}`;
    const line=(key,a,b)=>entity(`${prefix}-${key}`,'line',{start:[x+a[0],a[1]],end:[x+b[0],b[1]]});
    const top=line('top',[r,0],[w-r,0]),right=line('right',[w,r],[w,h-r]),bottom=line('bottom',[w-r,h],[r,h]),left=line('left',[0,h-r],[0,r]);
    const edges=[top,right,bottom,left];
    const centers=[[w-r,r],[w-r,h-r],[r,h-r],[r,r]], starts=[-Math.PI/2,0,Math.PI/2,Math.PI];
    const arcs=centers.map((center,j)=> {
      const at=a=>[x+center[0]+r*Math.cos(a),center[1]+r*Math.sin(a)];
      return entity(`${prefix}-arc-${j}`,'arc',{start:at(starts[j]),arcPoint:at(starts[j]+Math.PI/4),end:at(starts[j]+Math.PI/2),center:[x+center[0],center[1]],radius:r,ccw:true});
    });
    edges.forEach((edge,j)=>constraint(j%2?'Vertical':'Horizontal',[segment(edge)]));
    arcs.forEach((arc,j)=> {
      const first=edges[j],second=edges[(j+1)%4];
      const cs=regularFilletConstraints({arcId:arc.id,filletArc:arc,firstEntity:first,firstRecordId:first.id,firstIndex:2,secondEntity:second,secondRecordId:second.id,secondIndex:0});
      cs.forEach(c=>constraint(c.type,c.featureRefs,{...c,id:uuid(`c-${serial++}`),stackId,coordinateSpace:'local'}));
      dim('Radius',[segment(arc)],'c2',10);
    });
    const widthDim=dim('Distance',[point(top,0),point(top,2)],'c1 - 2*c2',60);
    dim('Distance',[point(right,0),point(right,2)],'60 - 2*c2',40);
    const anchors={start:{type:'segment-start',recordId:top.id,index:0},end:{type:'segment-end',recordId:top.id,index:0}};
    const annotationId=uuid(`${prefix}-width-label`), parameter=d.parameters.find(p=>p.id===widthDim); parameter.annotationId=annotationId;
    d.dimensionAnnotations.push({id:annotationId,type:'dimension-line',dimensionMode:'driving',subtype:'aligned',direction:[1,0],start:top.start,end:top.end,measureStart:top.start,measureEnd:top.end,label:[x+w/2,-18],text:'60 mm',anchors:{...anchors,measureStart:anchors.start,measureEnd:anchors.end},measuredValue:60,stackId,coordinateSpace:'local',coordinateFrame:{x:0,y:0,rotation:0},dimensionId:widthDim,dimensionName:parameter.name,managedDimensionText:true,offsetDirection:[0,-1],offsetDistance:18});
    const guide=line('guide',[0,h/2],[w,h/2]); guide.construction=true;
    constraint('Horizontal',[segment(guide)]);constraint('Point-on Line',[point(guide,0),segment(left)]);constraint('Point-on Line',[point(guide,2),segment(right)]);
    dim('VerticalDistance',[point(top,0),point(guide,0)],'30',30);
    const outer=entity(`${prefix}-outer`,'circle',{center:[x+w/2,h/2],radius:10}),inner=entity(`${prefix}-inner`,'circle',{center:[x+w/2,h/2],radius:5});
    constraint('Coincident',[point(outer,0),point(guide,1)]);constraint('Concentric',[segment(outer),segment(inner)]);
    dim('Radius',[segment(outer)],'c2',10);dim('Radius',[segment(inner)],'c2/2',5);
    if(previousTop && connected) {
      constraint('Collinear',[segment(previousTop),segment(top)]);
      dim('HorizontalDistance',[point(previousTop,0),point(top,0)],'c1 + 70',150);
    }
    previousTop=top;
    // A live source-based fillet, in addition to the four solver-owned tangent arcs.
    const a=line('fillet-a',[0,90],[30,90]),b=line('fillet-b',[0,90],[0,120]);
    constraint('Coincident',[point(a,0),point(b,0)]);constraint('Horizontal',[segment(a)]);constraint('Vertical',[segment(b)]);
    constraint('Collinear',[segment(left),segment(b)]);dim('VerticalDistance',[point(guide,0),point(a,0)],'60',60);
    dim('Distance',[point(a,0),point(a,2)],'30',30);dim('Distance',[point(b,0),point(b,2)],'30',30);
    const fillet=entity(`${prefix}-fillet`,'fillet',{sourceA:{recordId:a.id,index:0},sourceB:{recordId:b.id,index:0},radius:8,radiusExpression:'8 mm'});
    const evaluated=evaluateFillet(fillet,new Map(d.entities.map(e=>[e.id,e]))); if(!evaluated.valid)throw Error(evaluated.error);
    const marker=entity(`${prefix}-fillet-marker`,'line',{start:evaluated.arc.arcPoint,end:[evaluated.arc.arcPoint[0]+12,evaluated.arc.arcPoint[1]]});
    constraint('Point-on Fillet',[point(marker,0),{kind:'arc',recordId:fillet.id}]);
    constraint('Horizontal',[segment(marker)]);dim('Distance',[point(marker,0),point(marker,2)],'12',12);
    // Swell source inherits the width dimension; the follower is constrained to its derived line.
    const swell=withSwellDefinition(top,{enabled:true,swellEnabled:true,offsetExpression:'3',swellOffsetExpression:'7',startTransitionExpression:'12',endTransitionExpression:'12'});
    swell.composite.id=uuid(`${prefix}-swell-composite`);Object.assign(top,swell);
    const derived=deriveSwellGeometry({entities:d.entities,constraints:d.constraints}).get(top.id);
    const piece=derived.pieces.find(p=>p.entity.type==='line'&&p.role==='swell');
    if(!piece)throw Error(`Swell line missing: ${JSON.stringify(derived.pieces)}`);
    const mid=[(piece.entity.start[0]+piece.entity.end[0])/2,(piece.entity.start[1]+piece.entity.end[1])/2];
    const follower=entity(`${prefix}-swell-follower`,'line',{start:mid,end:[mid[0]+10,mid[1]]});
    constraint('Horizontal',[segment(follower)]);dim('Distance',[point(follower,0),point(follower,2)],'10',10);
    dim('HorizontalDistance',[point(top,0),point(follower,0)],'(c1 - 2*c2)/2',30);
    const derivedRef={kind:'segment',recordId:top.id,index:0,derivedFeature:{provider:'swell',segmentIndex:0,role:'swell',ordinal:piece.ordinal}};
    d.extensions.swell.constraints.push({id:uuid(`${prefix}-swell-constraint`),type:'Point-on Line',featureRefs:[point(follower,0),derivedRef],source:'geometric',stackId,solveDomain:'entity',participantStackIds:[],externalTarget:{type:'swell-derived',derivedRef,movableRef:point(follower,0),sourceId:top.id}});
    const array={...structuredClone(original.extensions.arrayTools.arrays[0]),id:uuid(`${prefix}-array`),stackId,sourceIds:[...edges,...arcs,outer,inner].map(e=>e.id),sourceRefs:[],rowCountExpression:'2',columnCountExpression:'2',rowSpacingExpression:'20',columnSpacingExpression:'70',rowCentroidSpacing:false,columnCentroidSpacing:false};
    delete array.sourceDefinitionId;delete array.sourceStackId;d.extensions.arrayTools.arrays.push(array);
    d.extensions.arrayTools.arrays.push({...array,id:uuid(`${prefix}-nested-array`),sourceIds:[],sourceRefs:[{kind:'array-placement',arrayId:array.id,placementIndex:1},{kind:'swell-piece',ownerId:top.id,pieceIndex:derived.pieces.indexOf(piece)}],rowCountExpression:'2',columnCountExpression:'1',rowSpacingExpression:'c2*3'});
    d.extensions.arrayTools.arrays.push({...array,id:uuid(`${prefix}-circular-array`),arrayType:'circular',sourceIds:[follower.id],sourceRefs:[],countExpression:'6',centerRef:point(outer,0),centerPoint:outer.center});
  }
  return d;
}
if(process.argv[1]?.endsWith('generate-mixed.mjs'))for(const n of [2,4,8]) {
  const d=makeMixed(n);writeFileSync(new URL(`./mixed-${n}.paramagic`,import.meta.url),JSON.stringify(d,null,2)+'\n');
  const c=new SolverController({jacobianMode:'blocks'});
  const result=c.loadSketch({...d,entities:d.entities.filter(e=>e.type!=='fillet'),derivedEntities:d.entities.filter(e=>e.type==='fillet')});
  console.log(JSON.stringify({regions:n,entities:d.entities.length,constraints:d.constraints.length,arrays:d.extensions.arrayTools.arrays.length,status:result?.status||c.lastResult?.status,finalError:c.lastResult?.finalError,dimensionErrors:c.dimensions.list().filter(p=>p.error).map(p=>({name:p.name,error:p.error}))}));
}
