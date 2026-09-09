// Rendered regression assertions, called by the local mixed-solver browser audit.
// These inspect actual SVG geometry, not just serialized derivative definitions.
export function linkedCopyArrayPresentationChecks(canvas) {
  const data = canvas.getProcessingDrawingData();
  const layer = canvas.getObjectLayer();
  const copies = [...layer.querySelectorAll(':scope > .linked-copy-group')];
  const arrays = canvas.getDrawingData().extensions?.arrayTools?.arrays || [];
  const nested = [];
  for (const definition of arrays) {
    for (const ref of definition.sourceRefs || []) {
      if (ref.kind !== 'linked-copy') continue;
      const source = copies.find(n => n.dataset.linkedCopyId === ref.copyId);
      const group = [...layer.querySelectorAll(':scope > .array-group')].find(n => n.dataset.arrayId === definition.id);
      const items = [...(group?.querySelectorAll(':scope > .array-item') || [])];
      let missing = 0, staleTransforms = 0, staleGeometry = 0;
      for (const item of items) {
        // Array clones intentionally strip interactive IDs while retaining paint identity.
        const copy = [...item.querySelectorAll('.linked-copy-group')].find(n => n.dataset.paintOrderKey === `linked-copy:${ref.copyId}`);
        if (!copy || !source) { missing++; continue; }
        if (copy.getAttribute('transform') !== source.getAttribute('transform')) staleTransforms++;
        const geometry = n => [...n.querySelectorAll('.linked-copy-template circle.entity:not(.hit-target)')]
          .map(c => ['cx','cy','r'].map(k => c.getAttribute(k)));
        if (JSON.stringify(geometry(copy)) !== JSON.stringify(geometry(source))) staleGeometry++;
      }
      nested.push({ arrayId: definition.id, copyId: ref.copyId, items: items.length, missing, staleTransforms, staleGeometry });
    }
  }
  let sourceCircles = 0, maxSourceCircleError = 0, paintedCircles = 0, maxCirclePaintError = 0;
  for (const entity of data.entities.filter(e => e.type === 'circle')) {
    const record = [...layer.children].find(n => n.dataset.recordId === entity.id);
    const circle = record?.querySelector(':scope > circle.entity:not(.hit-target)');
    if (!circle) continue;
    sourceCircles++;
    maxSourceCircleError = Math.max(maxSourceCircleError,
      Math.abs(Number(circle.getAttribute('cx')) - entity.center[0]), Math.abs(Number(circle.getAttribute('cy')) - entity.center[1]),
      Math.abs(Number(circle.getAttribute('r')) - entity.radius));
  }
  for (const circle of layer.querySelectorAll('circle.entity:not(.hit-target)')) {
    if (circle.closest('defs')) continue;
    const paint = circle.parentElement.querySelector(':scope > .resolved-boundary-visual');
    if (!paint) continue;
    // SVG getBBox stores floats; two semicircle arcs can report a subtly
    // enlarged box even when their endpoints/radii exactly equal the circle.
    const values = paint.getAttribute('d').match(/[-+]?\d*\.?\d+(?:e[-+]?\d+)?/gi)?.map(Number);
    const cx = Number(circle.getAttribute('cx')), cy = Number(circle.getAttribute('cy')), r = Number(circle.getAttribute('r'));
    const expected = [cx+r,cy,r,r,0,1,1,cx-r,cy,r,r,0,1,1,cx+r,cy];
    if (values?.length !== expected.length) continue;
    paintedCircles++;
    maxCirclePaintError = Math.max(maxCirclePaintError, ...expected.map((v,i) => Math.abs(v-values[i])));
  }
  return { nestedDuplicateArrays: nested, sourceCircles, maxSourceCircleError, paintedCircles, maxCirclePaintError,
    nestedDuplicateArraysComplete: nested.every(n => n.items > 0 && !n.missing && !n.staleTransforms && !n.staleGeometry),
    circleGraphicsCoherent: maxSourceCircleError < 1e-5 && maxCirclePaintError < 1e-5 };
}
