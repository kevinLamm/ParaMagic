import { SolverController } from '../packages/paramagic-core/src/modules/solver/SolverController.js';
import { createControlPanelModel } from '../packages/paramagic-core/src/modules/ControlTools.js';
import { serializeDrawingJson } from '../packages/paramagic-core/src/modules/DrawingIO.js';
import { createUuid } from '../packages/paramagic-core/src/modules/IdentitySystem.js';

export function publishingFixtureDrawing() {
  const solver = new SolverController(); const model = createControlPanelModel({ solver });
  const control = model.add('Horizontal Scrollbar', { label: 'Width', configurationExpression: 'MinMax(1, 12, 4, 0.5)' });
  const container = model.add('Container', { label: 'Overall size' });
  model.move(control.id, container.id);
  const line = solver.addEntity({ id: createUuid(), type: 'line', start: [0, 0], end: [101.6, 0] });
  solver.addEntity({ id: createUuid(), type: 'line', start: [0, 0], end: [0, 50] });
  const anchors = {
    start: { type: 'segment-start', recordId: line.id, index: 0 }, end: { type: 'segment-end', recordId: line.id, index: 0 },
    measureStart: { type: 'segment-start', recordId: line.id, index: 0 }, measureEnd: { type: 'segment-end', recordId: line.id, index: 0 },
  };
  const dimension = solver.addDimension({ type: 'dimension-line', dimensionMode: 'driving', includeInValueOnly: true, subtype: 'horizontal',
    start: [...line.start], end: [...line.end], measureStart: [...line.start], measureEnd: [...line.end],
    label: [50.8, -20], text: '', anchors });
  solver.setDimension(dimension.entity.dimensionId, control.parameterName);
  const description = 'Disposable red ottoman pattern with an adjustable width control.';
  solver.setDocumentMetadata({ drawingDescription: description, developers: 'Local test fixture' });
  const snapshot = solver.getSketchSnapshot();
  const content = serializeDrawingJson({ ...snapshot, extensions: { controls: model.serialize(), stacks: snapshot.stackState } }, 'Adjustable ottoman test');
  return { content, description, name: 'Adjustable ottoman test', searchable: true };
}
