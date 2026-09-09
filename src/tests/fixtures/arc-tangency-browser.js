import { canvasController as canvas, initialization } from '../../main.js';
await initialization;
const drawing = await (await fetch('./rectangle-ottoman-tangent.paramagic')).json();
const stackId = drawing.extensions.stacks.stacks.find(s => s.name === 'Turned Leg').id;
const arcIds = ['007ed6ab-4cd2-41d4-819e-240806c0aeb5', '39cf8ea3-a795-44b5-9d35-e48c752c0bd0'];
const panel = document.createElement('div');
panel.style.cssText = 'position:fixed;left:320px;top:55px;z-index:3000;background:white;padding:8px;display:flex;gap:8px';
const output = document.createElement('output');
output.setAttribute('aria-label', 'Arc tangent verification');
output.style.cssText = 'position:fixed;left:320px;top:100px;max-width:550px;background:white;font:12px monospace;white-space:pre-wrap';
function button(label, run) {
  const node = document.createElement('button'); node.textContent = label;
  node.onclick = event => { event.stopPropagation(); return run(); };
  panel.append(node);
}
async function reset() {
  canvas.loadDrawingData(structuredClone(drawing), { zoomToFit: true });
  canvas.setActiveStack(stackId);
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  document.getElementById('resetView').click();
  output.textContent = 'Select the two left profile arcs with Tangent.';
}
button('Reset Ottoman', reset);
button('Focus arc joint', () => {
  const element = canvas.getCanvasElement();
  const area = element.getBoundingClientRect();
  const arcBounds = arcIds.map(id => document.querySelector(`.canvas-record[data-record-id="${id}"]`).getBoundingClientRect());
  const start = { clientX: (Math.min(...arcBounds.map(r => r.left)) + Math.max(...arcBounds.map(r => r.right))) / 2,
    clientY: (Math.min(...arcBounds.map(r => r.top)) + Math.max(...arcBounds.map(r => r.bottom))) / 2 };
  const end = { clientX: area.left + area.width / 2, clientY: area.top + area.height / 2 };
  element.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 1, ...start }));
  element.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, button: 1, buttons: 4, ...end }));
  element.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 1, ...end }));
  const height = Math.max(...arcBounds.map(r => r.bottom)) - Math.min(...arcBounds.map(r => r.top));
  element.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, ...end, deltaY: -Math.log(350 / height) / 0.0012 }));
});
arcIds.forEach((id, index) => button(`Pick arc ${index + 1}`, () => {
  const path = document.querySelector(`.canvas-record[data-record-id="${id}"] path.hit-target`);
  const location = path.getPointAtLength(path.getTotalLength() / 2).matrixTransform(path.getScreenCTM());
  const target = document.elementFromPoint(location.x, location.y);
  const options = { bubbles: true, cancelable: true, clientX: location.x, clientY: location.y, button: 0, pointerId: 1, pointerType: 'mouse' };
  target.dispatchEvent(new PointerEvent('pointermove', options));
  target.dispatchEvent(new PointerEvent('pointerdown', options));
  target.dispatchEvent(new MouseEvent('mousedown', options));
  target.dispatchEvent(new PointerEvent('pointerup', options));
  target.dispatchEvent(new MouseEvent('mouseup', options));
  target.dispatchEvent(new MouseEvent('click', { ...options, detail: 1 }));
}));
button('Inspect tangent', () => {
  const data = canvas.getDrawingData();
  const tangent = data.constraints.find(c => c.type === 'Tangent' && arcIds.every(id => c.featureRefs.some(r => r.recordId === id)));
  const [a, b] = arcIds.map(id => data.entities.find(e => e.id === id));
  const radialA = a.center.map((v, i) => v - a.end[i]);
  const radialB = b.center.map((v, i) => v - b.start[i]);
  output.textContent = JSON.stringify({ tangentCreated: !!tangent, endpoint: tangent?.tangentPoint,
    gap: Math.hypot(a.end[0] - b.start[0], a.end[1] - b.start[1]),
    sineOfTangentAngle: Math.abs(radialA[0] * radialB[1] - radialA[1] * radialB[0]) / (Math.hypot(...radialA) * Math.hypot(...radialB)),
    helperVisible: !!tangent && [...document.querySelectorAll('.constraint-helper-button')].some(n => n.dataset.constraintId === tangent.id && n.getBoundingClientRect().width > 0),
  }, null, 2);
});
button('Reload saved Ottoman', () => canvas.loadDrawingData(JSON.parse(JSON.stringify(canvas.getDrawingData())), { zoomToFit: false }));
panel.append(output); document.body.append(panel);
await reset();
