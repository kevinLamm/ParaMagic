import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { serializeDxf } from '../packages/paramagic-core/src/modules/DrawingIO.js';
import { createDrawingDxfSnapshot } from '../packages/paramagic-core/src/modules/DxfExport.js';
import { transformStackEntity } from '../packages/paramagic-core/src/modules/StackCoordinates.js';

export const autodeskDxfFixtureDrawing = {
  drawingUnit: 'mm',
  dxfExportUnit: 'mm',
  documentContext: { fileName: 'ParaMagic All Geometry Autodesk Test' },
  entities: [
    { id: 'line', type: 'line', start: [0, 0], end: [80, 20] },
    { id: 'construction', type: 'line', start: [0, -10], end: [80, -10], construction: true },
    {
      id: 'seam', type: 'line', start: [0, -20], end: [80, -20],
      composite: { kind: 'finish-size-offset', sourceFeatures: [{ recordId: 'line', kind: 'segment', index: 0 }] },
    },
    { id: 'circle', type: 'circle', center: [120, 0], radius: 20 },
    {
      id: 'arc', type: 'arc', center: [200, 0], radius: 20,
      start: [180, 0], arcPoint: [200, -20], end: [220, 0], clockwise: true,
    },
    { id: 'polyline', type: 'polyline', points: [[0, 60], [30, 40], [60, 65], [90, 45]] },
    { id: 'polygon', type: 'polygon', points: [[120, 40], [170, 40], [180, 75], [130, 85]] },
    { id: 'rectangle', type: 'rect', x: 200, y: 40, width: 60, height: 40 },
    { id: 'curve', type: 'curve', points: [[0, 120], [35, 90], [70, 145], [110, 110]] },
    { id: 'straight-notch', type: 'notch', notchType: 'straight-slit', point: [140, 120], end: [140, 130] },
    { id: 'v-notch', type: 'notch', notchType: 'v-notch', point: [180, 120], end: [180, 132] },
    { id: 'u-notch', type: 'notch', notchType: 'u-notch', point: [220, 120], end: [220, 132] },
    {
      id: 'single-line-text', type: 'text', x: 0, y: 180, text: 'Single-line TEXT: Autodesk R2000',
      multiline: false, fontName: 'Arial', fontSize: 12, textHeight: 5, textAlign: 'left',
    },
    {
      id: 'multiline-text', type: 'text', x: 160, y: 180,
      text: 'Multiline MTEXT\nSecond line with braces {OK}',
      multiline: true, fontName: 'Times New Roman', fontSize: 12, textHeight: 5, textAlign: 'center',
    },
    {
      id: 'table', type: 'table', x: 0, y: 220,
      columns: [{ width: 70 }, { width: 90 }],
      rows: [{ height: 24 }, { height: 30 }],
      cells: [
        [{ text: 'Table heading', textAlign: 'center' }, { text: 'Value', textAlign: 'center' }],
        [{ text: 'DXF linework' }, { text: 'Autodesk TEXT' }],
      ],
    },
  ],
  dimensionAnnotations: [
    {
      id: 'aligned-dimension', type: 'dimension-line', dimensionMode: 'driven',
      start: [0, 0], end: [80, 20], measureStart: [0, 0], measureEnd: [80, 20],
      label: [40, -40], text: 'aligned = 82.462 mm',
    },
    {
      id: 'horizontal-dimension', type: 'dimension-line', subtype: 'horizontal', dimensionMode: 'driven',
      start: [120, -20], end: [220, -20], measureStart: [120, -20], measureEnd: [220, -20],
      label: [170, -45], text: 'horizontal = 100 mm',
    },
    {
      id: 'vertical-dimension', type: 'dimension-line', subtype: 'vertical', dimensionMode: 'driven',
      start: [280, 0], end: [280, 80], measureStart: [280, 0], measureEnd: [280, 80],
      label: [305, 40], text: 'vertical = 80 mm',
    },
    {
      id: 'radius-dimension', type: 'radius-dimension', dimensionMode: 'driven',
      center: [120, 0], radius: 20, elbow: [145, -25], label: [145, -25], text: 'radius = 20 mm',
    },
    {
      id: 'diameter-dimension', type: 'radius-dimension', subtype: 'diameter', dimensionMode: 'driven',
      center: [200, 0], radius: 20, elbow: [225, -25], label: [225, -25], text: 'diameter = 40 mm',
    },
    {
      id: 'angle-dimension', type: 'angle-dimension', dimensionMode: 'driven',
      vertex: [300, 130], start: [340, 130], end: [300, 90], radius: 30,
      label: [325, 105], text: 'angle = 90 degrees',
    },
    {
      id: 'curve-length-dimension', type: 'multi-curve-length-dimension', dimensionMode: 'driven',
      target: [70, 120], elbow: [100, 155], label: [130, 155], text: 'curve length = 125 mm',
    },
  ],
};

export function createAutodeskDxfFixture({ frame = null } = {}) {
  const drawing = structuredClone(autodeskDxfFixtureDrawing);
  if (frame) {
    drawing.entities = drawing.entities.map((entity) => transformStackEntity(entity, frame));
    drawing.dimensionAnnotations = drawing.dimensionAnnotations.map((entity) => ({
      ...transformStackEntity(entity, frame), coordinateFrame: frame,
    }));
  }
  return serializeDxf(createDrawingDxfSnapshot(drawing));
}

export function writeAutodeskDxfFixture(outputPath = resolve('autodesk-paramagic-fixture.dxf')) {
  const resolvedPath = resolve(outputPath);
  writeFileSync(resolvedPath, createAutodeskDxfFixture(), 'utf8');
  return resolvedPath;
}

const invokedModuleUrl = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (import.meta.url === invokedModuleUrl) {
  console.log(writeAutodeskDxfFixture(process.argv[2]));
}
