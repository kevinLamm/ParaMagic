import { canvasController, initialization } from '../../main.js';
import { candidateFromSelections } from '../../../packages/paramagic-core/src/modules/DimensionSystem.js';

await initialization;

const drawing = await (await fetch('./stack-coordinates.paramagic')).json();
const drivingDrawing = structuredClone(drawing);
const base = drawing.entities[0];
const first = { ...base, start: [0, 0], end: [100, 0] };
const second = {
  ...base,
  id: '1a114b43-8b51-44fa-88a0-09e70388c061',
  start: [20, 60],
  end: [140, 60],
};
second.sourceRecordId = second.id;
const circle = {
  ...base,
  id: '974d096c-c776-4cb4-83de-b45227e56753',
  type: 'circle',
  center: [50, 30],
  radius: 30,
};
circle.sourceRecordId = circle.id;
delete circle.start;
delete circle.end;
const feature = (entity) => ({
  kind: 'segment',
  recordId: entity.id,
  index: 0,
  start: entity.start,
  end: entity.end,
});

drawing.name = 'Dimension extension verification';
drawing.constraints = [];
drawing.parameters = [];
drawing.dimensionAnnotations = [];
// Keep the fixture's Stack definitions, without its derived geometry systems.
for (const key of Object.keys(drawing.extensions)) {
  if (key !== 'stacks') delete drawing.extensions[key];
}

function showDimension(candidate, entities, value) {
  const annotation = {
    ...candidate,
    id: '4fa05dc5-e8ac-4155-bc87-2e5bff3a81e1',
    stackId: first.stackId,
    coordinateSpace: 'local',
    dimensionId: '8525a22f-3668-490c-a4b9-9478fb0cbb65',
    dimensionName: 'd1',
  };
  // Omit cached segments to verify existing drawings resolve geometry on load.
  delete annotation.firstSegment;
  delete annotation.secondSegment;
  drawing.entities = entities;
  drawing.dimensionAnnotations = [annotation];
  drawing.parameters = [{
    id: annotation.dimensionId,
    name: 'd1',
    kind: 'dimension',
    driving: false,
    computed: true,
    enabled: true,
    value,
    unit: 'in',
    expression: '',
    annotationId: annotation.id,
    stackId: first.stackId,
  }];
  canvasController.loadDrawingData(drawing, { zoomToFit: true });
}

const controls = document.createElement('div');
controls.style.cssText = 'position:fixed;bottom:12px;left:330px;z-index:3000;background:white;padding:10px';
const addButton = (name, action) => {
  const button = document.createElement('button');
  button.textContent = name;
  button.onclick = action;
  controls.append(button);
};

addButton('Lines right', () => showDimension(
  candidateFromSelections([feature(first), feature(second)], [200, 30], 'driven'),
  [first, second],
  60,
));
addButton('Lines left', () => showDimension(
  candidateFromSelections([feature(first), feature(second)], [-100, 30], 'driven'),
  [first, second],
  60,
));
addButton('Extend right endpoint', () => {
  const snapshot = canvasController.getDrawingData();
  const measured = snapshot.entities.find(({ id }) => id === second.id);
  measured.end = [220, 60];
  canvasController.loadDrawingData(snapshot, { zoomToFit: true });
});
addButton('Point to line', () => showDimension(
  candidateFromSelections([
    feature(first),
    { kind: 'point', recordId: second.id, index: 0, point: second.start },
  ], [200, 30], 'driven'),
  [first, second],
  60,
));
addButton('Diameter', () => showDimension(
  candidateFromSelections([{
    kind: 'circle', recordId: circle.id, center: circle.center, radius: circle.radius,
  }], [110, 30], 'driven'),
  [circle],
  60,
));
addButton('Grow diameter', () => {
  const snapshot = canvasController.getDrawingData();
  const targetCircle = snapshot.entities.find(({ id }) => id === circle.id);
  targetCircle.radius = 60;
  canvasController.loadDrawingData(snapshot, { zoomToFit: true });
});
addButton('Length direction', () => showDimension(
  candidateFromSelections([feature(first)], [50, -40], 'driven'),
  [first],
  100,
));
addButton('Driving expression', () => {
  canvasController.loadDrawingData(structuredClone(drivingDrawing), { zoomToFit: true });
});
addButton('Reverse anchor order', () => {
  const snapshot = canvasController.getDrawingData();
  const line = snapshot.entities.find(({ id }) => id === first.id);
  [line.start, line.end] = [line.end, line.start];
  canvasController.loadDrawingData(snapshot, { zoomToFit: true });
});

document.body.append(controls);
controls.firstChild.click();
