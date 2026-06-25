const clone = (value) => JSON.parse(JSON.stringify(value));
const dxfUnitFactors = { 1: 25.4, 2: 304.8, 4: 1, 5: 10, 6: 1000 };
let fallbackId = 0;

function newId(prefix) {
  if (globalThis.crypto?.randomUUID) return `${prefix}-${globalThis.crypto.randomUUID()}`;
  fallbackId += 1;
  return `${prefix}-import-${Date.now().toString(36)}-${fallbackId}`;
}

export function normalizeDrawingData(input = {}) {
  const source = input.drawing || input;
  const parameters = source.parameters || source.dimensions || [];
  return {
    drawingUnit: source.drawingUnit || 'in',
    entities: clone(source.entities || []),
    constraints: clone(source.constraints || []),
    parameters: clone(parameters),
    dimensions: clone(parameters),
    dimensionAnnotations: clone(source.dimensionAnnotations || source.annotations || []),
  };
}

export function serializeDrawingJson(snapshot, name = 'Untitled Drawing') {
  const drawing = normalizeDrawingData(snapshot);
  delete drawing.dimensions;
  return JSON.stringify({
    format: 'ParaMagic Drawing',
    version: 1,
    name,
    ...drawing,
  }, null, 2);
}

function replaceExpressionNames(expression, nameMap) {
  let next = String(expression ?? '');
  [...nameMap.entries()].sort((a, b) => b[0].length - a[0].length).forEach(([before, after]) => {
    if (before === after) return;
    const escaped = before.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    next = next.replace(new RegExp(`\\b${escaped}\\b`, 'g'), after);
  });
  return next;
}

function nextAvailableName(requested, kind, usedNames) {
  if (!usedNames.has(requested)) return requested;
  if (kind === 'dimension') {
    let index = 1;
    while (usedNames.has(`d${index}`)) index += 1;
    return `d${index}`;
  }
  let index = 2;
  while (usedNames.has(`${requested}_${index}`)) index += 1;
  return `${requested}_${index}`;
}

function replaceMappedValues(value, idMap) {
  if (Array.isArray(value)) return value.map((item) => replaceMappedValues(item, idMap));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, replaceMappedValues(item, idMap)]));
  return typeof value === 'string' && idMap.has(value) ? idMap.get(value) : value;
}

export function mergeDrawingData(baseInput, insertedInput) {
  const base = normalizeDrawingData(baseInput);
  const inserted = normalizeDrawingData(insertedInput);
  const idMap = new Map();
  inserted.entities.forEach((entity) => idMap.set(entity.id, newId('entity')));
  new Set(inserted.entities.map((entity) => entity.composite?.id).filter(Boolean))
    .forEach((compositeId) => idMap.set(compositeId, newId('composite')));
  inserted.parameters.forEach((parameter) => idMap.set(parameter.id, newId(parameter.kind === 'dimension' ? 'dimension' : 'parameter')));
  inserted.constraints.forEach((constraint) => idMap.set(constraint.id, newId('constraint')));
  inserted.dimensionAnnotations.forEach((annotation) => idMap.set(annotation.id, newId('dimension-annotation')));

  const usedNames = new Set(base.parameters.map((parameter) => parameter.name));
  const nameMap = new Map();
  inserted.parameters.forEach((parameter) => {
    const nextName = nextAvailableName(parameter.name, parameter.kind, usedNames);
    usedNames.add(nextName);
    nameMap.set(parameter.name, nextName);
  });

  const remapped = replaceMappedValues(inserted, idMap);
  remapped.parameters = remapped.parameters.map((parameter, order) => ({
    ...parameter,
    name: nameMap.get(parameter.name) || parameter.name,
    expression: replaceExpressionNames(parameter.expression, nameMap),
    order: base.parameters.length + order,
  }));
  remapped.dimensions = clone(remapped.parameters);
  remapped.dimensionAnnotations = remapped.dimensionAnnotations.map((annotation) => ({
    ...annotation,
    dimensionName: nameMap.get(annotation.dimensionName) || annotation.dimensionName,
  }));

  const parameters = [...base.parameters, ...remapped.parameters];
  return {
    drawingUnit: base.drawingUnit,
    entities: [...base.entities, ...remapped.entities],
    constraints: [...base.constraints, ...remapped.constraints],
    parameters,
    dimensions: clone(parameters),
    dimensionAnnotations: [...base.dimensionAnnotations, ...remapped.dimensionAnnotations],
  };
}

function dxfPairs(text) {
  const lines = String(text).replace(/\r/g, '').split('\n');
  const pairs = [];
  for (let index = 0; index + 1 < lines.length; index += 2) {
    pairs.push({ code: Number(lines[index].trim()), value: lines[index + 1].trim() });
  }
  return pairs;
}

function dxfUnitFactor(pairs) {
  const marker = pairs.findIndex((pair) => pair.code === 9 && pair.value === '$INSUNITS');
  if (marker < 0) return 1;
  const setting = pairs.slice(marker + 1, marker + 4).find((pair) => pair.code === 70);
  return dxfUnitFactors[Number(setting?.value)] || 1;
}

function entityFields(pairs) {
  const fields = new Map();
  pairs.forEach(({ code, value }) => {
    if (!fields.has(code)) fields.set(code, []);
    fields.get(code).push(value);
  });
  return fields;
}

export function parseDxf(text) {
  const pairs = dxfPairs(text);
  const factor = dxfUnitFactor(pairs);
  const entities = [];
  let inEntities = false;
  for (let index = 0; index < pairs.length; index += 1) {
    const pair = pairs[index];
    if (pair.code === 2 && pair.value === 'ENTITIES') { inEntities = true; continue; }
    if (!inEntities || pair.code !== 0) continue;
    if (pair.value === 'ENDSEC') { inEntities = false; continue; }
    const type = pair.value;
    let end = index + 1;
    while (end < pairs.length && pairs[end].code !== 0) end += 1;
    const fields = entityFields(pairs.slice(index + 1, end));
    const number = (code, occurrence = 0) => Number(fields.get(code)?.[occurrence] || 0) * factor;
    const point = (xCode, yCode, occurrence = 0) => [number(xCode, occurrence), -number(yCode, occurrence)];
    if (type === 'LINE') entities.push({ type: 'line', start: point(10, 20), end: point(11, 21) });
    if (type === 'CIRCLE') entities.push({ type: 'circle', center: point(10, 20), radius: number(40) });
    if (type === 'ARC') {
      const center = point(10, 20);
      const radius = number(40);
      const startAngle = Number(fields.get(50)?.[0] || 0) * Math.PI / 180;
      const endAngleRaw = Number(fields.get(51)?.[0] || 0) * Math.PI / 180;
      const endAngle = endAngleRaw < startAngle ? endAngleRaw + Math.PI * 2 : endAngleRaw;
      const at = (angle) => [center[0] + radius * Math.cos(angle), center[1] - radius * Math.sin(angle)];
      entities.push({ type: 'arc', start: at(startAngle), arcPoint: at((startAngle + endAngle) / 2), end: at(endAngle), center, radius, ccw: false });
    }
    if (type === 'LWPOLYLINE') {
      const xs = fields.get(10) || [];
      const ys = fields.get(20) || [];
      const points = xs.map((value, vertex) => [Number(value) * factor, -Number(ys[vertex] || 0) * factor]);
      if (points.length >= 2) entities.push({ type: (Number(fields.get(70)?.[0] || 0) & 1) ? 'polygon' : 'polyline', points });
    }
    index = end - 1;
  }
  return normalizeDrawingData({ drawingUnit: 'in', entities });
}

function circleThrough(a, b, c) {
  const d = 2 * (a[0] * (b[1] - c[1]) + b[0] * (c[1] - a[1]) + c[0] * (a[1] - b[1]));
  if (Math.abs(d) < 1e-9) return null;
  const aa = a[0] ** 2 + a[1] ** 2;
  const bb = b[0] ** 2 + b[1] ** 2;
  const cc = c[0] ** 2 + c[1] ** 2;
  const center = [
    (aa * (b[1] - c[1]) + bb * (c[1] - a[1]) + cc * (a[1] - b[1])) / d,
    (aa * (c[0] - b[0]) + bb * (a[0] - c[0]) + cc * (b[0] - a[0])) / d,
  ];
  return { center, radius: Math.hypot(a[0] - center[0], a[1] - center[1]) };
}

function arcCircle(entity) {
  if (Array.isArray(entity.center) && entity.center.every(Number.isFinite) && Number.isFinite(entity.radius) && Math.abs(entity.radius) > 1e-8) {
    return { center: [...entity.center], radius: Math.abs(entity.radius) };
  }
  return circleThrough(entity.start, entity.arcPoint, entity.end);
}

export function serializeDxf(snapshot) {
  const drawing = normalizeDrawingData(snapshot);
  const scale = 1 / 25.4;
  const lines = ['0', 'SECTION', '2', 'HEADER', '9', '$INSUNITS', '70', '1', '0', 'ENDSEC', '0', 'SECTION', '2', 'ENTITIES'];
  const push = (...values) => lines.push(...values.map(String));
  const x = (value) => Number(value) * scale;
  const y = (value) => -Number(value) * scale;
  drawing.entities.forEach((entity) => {
    if (entity.type === 'line') push(0, 'LINE', 8, 0, 10, x(entity.start[0]), 20, y(entity.start[1]), 11, x(entity.end[0]), 21, y(entity.end[1]));
    if (entity.type === 'circle') push(0, 'CIRCLE', 8, 0, 10, x(entity.center[0]), 20, y(entity.center[1]), 40, x(entity.radius));
    if (entity.type === 'arc') {
      const circle = arcCircle(entity);
      if (!circle) return;
      const angle = (point) => ((Math.atan2(-(point[1] - circle.center[1]), point[0] - circle.center[0]) * 180 / Math.PI) + 360) % 360;
      let startAngle = angle(entity.start);
      let endAngle = angle(entity.end);
      const midAngle = angle(entity.arcPoint);
      const containsMid = ((midAngle - startAngle + 360) % 360) <= ((endAngle - startAngle + 360) % 360);
      if (!containsMid) [startAngle, endAngle] = [endAngle, startAngle];
      push(0, 'ARC', 8, 0, 10, x(circle.center[0]), 20, y(circle.center[1]), 40, x(circle.radius), 50, startAngle, 51, endAngle);
    }
    if (['polyline', 'polygon', 'curve'].includes(entity.type)) {
      push(0, 'LWPOLYLINE', 8, 0, 90, entity.points.length, 70, entity.type === 'polygon' ? 1 : 0);
      entity.points.forEach((point) => push(10, x(point[0]), 20, y(point[1])));
    }
  });
  push(0, 'ENDSEC', 0, 'EOF');
  return lines.join('\n');
}

export function parseDrawingText(fileName, text) {
  if (/\.dxf$/i.test(fileName)) return parseDxf(text);
  const parsed = JSON.parse(text);
  return normalizeDrawingData(parsed);
}
