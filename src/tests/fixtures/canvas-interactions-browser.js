import { canvasController as canvas, initialization } from '../../main.js';

await initialization;
const original = await (await fetch('./stack-coordinates.paramagic')).json();
const controls = document.createElement('div');
controls.style.cssText = 'position:fixed;top:55px;left:320px;max-width:calc(100% - 390px);z-index:3000;background:white;padding:8px;display:flex;flex-wrap:wrap;gap:8px';
const output = document.createElement('output');
output.style.cssText = 'position:fixed;left:320px;top:150px;max-width:450px;max-height:100px;overflow:auto;background:white;font:11px monospace';
output.setAttribute('aria-label', 'Interaction verification');
const add = (name, action) => {
  const button = document.createElement('button');
  button.textContent = name;
  button.onclick = (event) => {
    // Fixture inspection must not trigger the app's outside-toolbar action
    // that exits a constraint tool when another application button is used.
    event.stopPropagation();
    return action();
  };
  controls.append(button);
};
function load(data, stackId) {
  output.textContent = '';
  canvas.loadDrawingData(data, { zoomToFit: true });
  canvas.setActiveStack(stackId);
}
function dimensions() {
  const data = structuredClone(original);
  data.name = 'Canvas interaction verification';
  load(data, data.dimensionAnnotations[0].stackId);
}
add('Reset dimensions', dimensions);
add('Reset overlaps', () => {
  const data = structuredClone(original);
  const base = data.entities[0];
  data.entities = [
    { ...base, name: 'Line A', start: [0, 0], end: [100, 0] },
    { ...base, id: 'overlap-line-b', sourceRecordId: 'overlap-line-b', name: 'Line B', start: [0, 0], end: [100, 0] },
  ];
  data.constraints = [];
  data.parameters = [];
  data.dimensionAnnotations = [];
  for (const key of Object.keys(data.extensions)) if (key !== 'stacks') delete data.extensions[key];
  load(data, base.stackId);
});
add('Reset curve', () => {
  const data = structuredClone(original);
  const base = data.entities[0];
  data.entities = [{ ...base, type: 'curve', points: [[0, 0], [50, 30], [100, 0]] }];
  data.constraints = [];
  data.parameters = [];
  data.dimensionAnnotations = [];
  for (const key of Object.keys(data.extensions)) if (key !== 'stacks') delete data.extensions[key];
  load(data, base.stackId);
});
add('Reset near edge', () => {
  const data = structuredClone(original);
  const base = data.entities[0];
  data.entities = [
    { ...base, start: [80, 0], end: [80, 60] },
    { ...base, id: 'nearby-edge', sourceRecordId: 'nearby-edge', start: [-40, 63], end: [300, 63] },
    { ...base, id: 'target-line', sourceRecordId: 'target-line', start: [230, 0], end: [230, 60] },
  ];
  data.constraints = [];
  data.parameters = [];
  data.dimensionAnnotations = [];
  for (const key of Object.keys(data.extensions)) if (key !== 'stacks') delete data.extensions[key];
  load(data, base.stackId);
});
add('Reset derivatives', async () => {
  const data = structuredClone(original);
  const base = data.entities[0];
  data.entities = [{ ...base, start: [0, 0], end: [80, 20] }];
  data.constraints = [];
  data.parameters = [];
  data.dimensionAnnotations = [];
  for (const key of Object.keys(data.extensions)) if (key !== 'stacks') delete data.extensions[key];
  data.extensions.linkedCopyTools = { version: 3, copies: [
    { id: '3b09f52b-c15d-4797-893f-3f5b62329402', type: 'duplicate', stackId: base.stackId, sourceIds: [base.id], anchor: [160, 60], linear: { a: 1, b: 0, c: 0, d: 1 }, visible: true },
    { id: 'c3c42758-22f8-4a83-a3e6-f8a596bb9223', type: 'symmetric', stackId: base.stackId, sourceIds: [base.id], anchor: [160, 140], linear: { a: -1, b: 0, c: 0, d: 1 }, visible: true },
  ], positionConstraints: [] };
  load(data, base.stackId);
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  document.getElementById('resetView').click();
});
add('Check derivative visibility', async () => {
  const area = canvas.getCanvasElement().getBoundingClientRect();
  const away = { clientX: area.left + 20, clientY: area.bottom - 25 };
  const move = async (target, point) => {
    target.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, ...point, pointerType: 'mouse', pointerId: 1 }));
    await new Promise(resolve => setTimeout(resolve, 160));
  };
  const checks = [];
  await move(canvas.getCanvasElement(), away);
  for (const type of ['duplicate', 'symmetric']) {
    const group = document.querySelector(`.linked-copy-group[data-linked-copy-type="${type}"]`);
    const handles = [...group.querySelectorAll('.linked-copy-driving-handle')];
    const idleHidden = handles.every(h => getComputedStyle(h).opacity === '0');
    const handle = handles[0];
    const rect = handle.getBoundingClientRect();
    const point = { clientX: rect.left + rect.width / 2 + 8.5, clientY: rect.top + rect.height / 2 };
    await move(document.elementFromPoint(point.clientX, point.clientY), point);
    const hoverVisible = getComputedStyle(handle).opacity === '1';
    await move(canvas.getCanvasElement(), away);
    const nextRect = handles[1].getBoundingClientRect();
    const geometryPoint = { clientX: (rect.left + rect.width / 2 + nextRect.left + nextRect.width / 2) / 2,
      clientY: (rect.top + rect.height / 2 + nextRect.top + nextRect.height / 2) / 2 };
    await move(document.elementFromPoint(geometryPoint.clientX, geometryPoint.clientY), geometryPoint);
    const geometryHoverVisible = handles.every(h => getComputedStyle(h).opacity === '1');
    await move(canvas.getCanvasElement(), away);
    const hiddenAfterLeave = handles.every(h => getComputedStyle(h).opacity === '0');
    checks.push({ type, count: handles.length, idleHidden, hoverVisible, geometryHoverVisible, hiddenAfterLeave });
  }
  output.textContent = JSON.stringify({ derivativeVisibilityPass: checks.every(c => c.count > 0 && c.idleHidden && c.hoverVisible && c.geometryHoverVisible && c.hiddenAfterLeave), checks });
});
add('Inspect interactions', () => {
  const data = canvas.getDrawingData();
  output.textContent = JSON.stringify({
    constraints: data.constraints.map(c => ({ type: c.type, featureRefs: c.featureRefs })),
    selectedPoints: [...document.querySelectorAll('.point-handle.smart-selected')].map(n => ({
      recordId: n.closest('[data-record-id]')?.dataset.recordId, index: n.dataset.handleIndex,
    })),
    dimensions: data.dimensionAnnotations.map(d => ({ label: d.label, text: d.text })),
    curvePoints: data.entities.filter(e => e.type === 'curve').map(e => e.points.length),
  });
});
add('Check handle perimeter', async () => {
  const handle = document.querySelector('.canvas-handle-group[data-record-id="a982afee-8a0a-5a02-ba88-190691d30708"] .point-handle[data-handle-index="2"]');
  const rect = handle.getBoundingClientRect();
  const samples = [];
  for (let step = 0; step < 8; step++) {
    const angle = step * Math.PI / 4;
    const clientX = rect.left + rect.width / 2 + 8.5 * Math.cos(angle);
    const clientY = rect.top + rect.height / 2 + 8.5 * Math.sin(angle);
    const target = document.elementFromPoint(clientX, clientY);
    target.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX, clientY, pointerId: 1, pointerType: 'mouse' }));
    await new Promise(resolve => setTimeout(resolve, 160));
    const style = getComputedStyle(handle);
    samples.push({ step, topHit: target.closest('[data-record-id]')?.dataset.recordId,
      hovered: handle.classList.contains('hovered'), opacity: style.opacity, pointerEvents: style.pointerEvents });
  }
  output.textContent = JSON.stringify({ perimeterPass: samples.every(s => s.hovered && Number(s.opacity) > 0.99 && s.pointerEvents === 'all'), samples });
});
controls.append(output);
document.body.append(controls);
dimensions();
