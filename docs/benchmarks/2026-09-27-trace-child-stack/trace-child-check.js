import './src/styles/app.css';
import { traceFixture } from './scripts/image-trace/measure.js';
import { imageLocalToWorldPoint } from './packages/paramagic-core/src/modules/ImageTrace.js';
import { SolverController } from './packages/paramagic-core/src/modules/solver/SolverController.js';
import { canvasController as canvas, initialization } from './src/main.js';
await initialization;
canvas.loadDrawingData({ entities: [], constraints: [], parameters: [] }, { history: 'none' });
const { entity } = traceFixture(600000);
const root = canvas.addStack({ name: 'Image collection' });
const owner = canvas.addChildStack(root.id, 'Image source');
const stacks = canvas.getStackState();
stacks.activeStackId = owner.id;
stacks.stacks.find(s => s.id === owner.id).frame = { x: 150, y: 70, rotation: 0.3 };
Object.assign(entity, { x: 160, y: 80, rotation: 23, flipX: true, stackId: owner.id });
canvas.loadDrawingData({ entities: [entity], constraints: [], parameters: [], extensions: { stacks } },
  { zoomToFit: true, history: 'commit', preserveStackActivation: true });
canvas.selectRecords([entity.id]);
const panel = document.createElement('section');
panel.style.cssText = 'position:fixed;bottom:8px;right:8px;z-index:10000;background:white;color:black;padding:8px;max-width:460px;border:1px solid #888;font:12px sans-serif';
const report = document.createElement('pre'); report.id = 'trace-child-report'; report.style.whiteSpace = 'pre-wrap';
panel.append(report); document.body.append(panel);
const checks = [];
function check(ok, text) { if (!ok) throw Error(text); checks.push(text); report.textContent = checks.join('\n'); }
function action(name, fn) {
  const b = document.createElement('button'); b.textContent = name; panel.append(b);
  b.onclick = async () => { try { await fn(); } catch (e) { report.textContent += '\nFAILED: ' + e.stack; } };
}
const children = () => canvas.getStackState().stacks.filter(s => s.parentStackId === owner.id);
let before, expected, after, beforeChildren;
document.addEventListener('click', event => {
  if (!event.target.closest('.image-trace-create')) return;
  before = canvas.getDrawingData(); beforeChildren = children().map(s => s.id);
  const currentImage = before.entities.find(e => e.id === entity.id);
  expected = document.querySelector('.image-trace-preview').getAttribute('points').split(' ').map(p => imageLocalToWorldPoint(currentImage, p.split(',').map(Number)));
}, true);
action('Verify Apply', () => {
  canvas.flushDrawingUpdate(); after = canvas.getDrawingData();
  const added = children().filter(s => !beforeChildren.includes(s.id));
  check(added.length === 1, 'Apply adds exactly one child of the image Stack');
  const child = added[0];
  const lines = after.entities.filter(e => e.stackId === child.id).sort((a,b) => a.composite.index - b.composite.index);
  check(lines.length === expected.length, 'Every traced edge belongs to the child');
  const oracle = new SolverController({ jacobianMode: 'blocks' });
  oracle.loadSketch({ ...after, entities: after.entities.filter(e=>e.type==='line').map(e=>e.stackId === child.id
    ? {...e, start: expected[e.composite.index], end: expected[(e.composite.index+1)%expected.length]} : e) });
  const error = Math.max(...lines.map(line => { const reference = oracle.getEntity(line.id); return Math.max(Math.hypot(line.start[0]-reference.start[0],line.start[1]-reference.start[1]),Math.hypot(line.end[0]-reference.end[0],line.end[1]-reference.end[1])); }));
  check(error < 1e-5, `Transformed trace matches reference with the same auto constraints (max error ${error})`);
  check(canvas.getActiveStackId() === owner.id, 'Image Stack remains active');
  check(canvas.getSelectedRecordIds().includes(entity.id), 'Source image remains selected');
  check(lines.every(e => { const n = document.querySelector(`[data-record-id="${e.id}"]`); return n?.classList.contains('stack-inactive') && n.getBoundingClientRect().width > 0; }), 'Child outline renders as inactive geometry');
  check(after.entities.find(e => e.id === entity.id).stackId === owner.id, 'Image remains in its original Stack');
  check(document.querySelector(`[data-stack-id="${owner.id}"][aria-current="true"]`), 'Stack tree still marks the image Stack active');
  check(!document.querySelector('.canvas.inactive-stack-hit-test-blocked'), 'Apply releases trace hit testing');
});
action('Verify Undo', () => {
  check(canvas.getDrawingData().entities.length === before.entities.length && children().length === beforeChildren.length, 'One Undo removes outline and child together');
  check(canvas.getActiveStackId() === owner.id, 'Undo preserves image Stack activation');
});
action('Verify Redo', () => {
  check(canvas.getDrawingData().entities.length === after.entities.length && children().length === beforeChildren.length+1, 'One Redo restores outline and child together');
  check(canvas.getActiveStackId() === owner.id, 'Redo preserves image Stack activation');
});
action('Reload saved drawing', () => {
  canvas.loadDrawingData(JSON.parse(JSON.stringify(after)), { zoomToFit: true, preserveStackActivation: true, history: 'none' });
  canvas.selectRecords([entity.id]);
  check(children().length === beforeChildren.length+1, 'Child hierarchy survives serialized reload');
  check(canvas.getActiveStackId() === owner.id, 'Reload preserves image Stack activation');
  check(canvas.getDrawingData().entities.filter(e => e.type === 'line').every(e => document.querySelector(`[data-record-id="${e.id}"]`)?.getBoundingClientRect().width > 0), 'Reloaded outline is rendered');
});
report.textContent = 'Ready: use Trace Region, pick the blue shape, Apply, then Verify Apply.';
