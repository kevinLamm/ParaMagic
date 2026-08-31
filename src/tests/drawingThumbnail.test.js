import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createDrawingThumbnail, createDrawingThumbnailSvg, DRAWING_CANVAS_BACKGROUND,
  drawingThumbnailEvaluators, drawingThumbnailSvgFromDataUrl, orderThumbnailEntities,
} from '../../packages/paramagic-core/src/modules/DrawingIO.js';
import { configureImageCatalogResources } from '../../packages/paramagic-core/src/modules/ImageSystem.js';
import { stackDrawing } from '../../packages/paramagic-core/src/modules/StackSystem.js';
import { withSwellDefinition } from '../../packages/paramagic-core/src/modules/SwellGeometry.js';

test('drawing thumbnails encode a zoom-all SVG from drawing JSON', () => {
  const thumbnail = createDrawingThumbnail({
    entities: [
      { type: 'line', start: [10, 20], end: [110, 70] },
      { type: 'circle', center: [40, 40], radius: 12 },
    ],
  });
  assert.match(thumbnail, /^data:image\/svg\+xml;charset=utf-8,/);
  const svg = decodeURIComponent(thumbnail.split(',')[1]);
  const [, viewBox] = svg.match(/viewBox="([^"]+)"/);
  const [x, y, width, height] = viewBox.split(' ').map(Number);
  assert.equal(width / height, 240 / 150);
  assert.ok(x < 10 && y < 20);
  assert.ok(x + width > 110 && y + height > 70);
  assert.doesNotMatch(svg, /transform=/);
  assert.match(svg, /preserveAspectRatio="xMidYMid meet"/);
  assert.match(svg, /<line /);
  assert.match(svg, /<circle /);
});

test('drawing thumbnails omit driven dimensions disabled for export', () => {
  const svg = createDrawingThumbnailSvg({
    dimensionAnnotations: [
      {
        id: 'included-dimension',
        type: 'dimension-text',
        dimensionMode: 'driven',
        label: [10, 10],
        text: 'INCLUDED-THUMBNAIL-DIMENSION',
      },
      {
        id: 'excluded-dimension',
        type: 'dimension-text',
        dimensionMode: 'driven',
        excludeFromExport: true,
        label: [20, 20],
        text: 'EXCLUDED-THUMBNAIL-DIMENSION',
      },
    ],
  });

  assert.match(svg, /INCLUDED-THUMBNAIL-DIMENSION/);
  assert.doesNotMatch(svg, /EXCLUDED-THUMBNAIL-DIMENSION/);
});

test('Value Only thumbnails retain Swell offset geometry and its Seam Line while hiding construction parents', () => {
  const source = withSwellDefinition({
    id: 'swell-circle',
    type: 'circle',
    center: [0, 0],
    radius: 20,
  }, {
    enabled: true,
    offsetExpression: '5',
    swellOffsetExpression: '15',
    startTransitionExpression: '20',
    endTransitionExpression: '20',
  });
  const svg = createDrawingThumbnailSvg({
    drawingUnit: 'mm',
    entities: [source],
    constraints: [],
    extensions: {
      seamLines: {
        version: 2,
        definitions: [{
          regionId: source.id,
          recordIds: [source.id],
          defaultEnabled: true,
          overrides: [],
        }],
      },
    },
  }, { dimensionTextMode: 'value' });

  assert.match(svg, /thumbnail-resolved-boundary/);
  assert.match(svg, /stroke-dasharray="5 4"/);
  assert.doesNotMatch(svg, /stroke="#dc2626"/);
});

test('thumbnail SVG can be mounted inline so catalog image resources remain visible', () => {
  const drawing = { entities: [{ type: 'circle', center: [20, 20], radius: 10 }] };
  const svg = createDrawingThumbnailSvg(drawing);
  const dataUrl = createDrawingThumbnail(drawing);
  assert.equal(drawingThumbnailSvgFromDataUrl(dataUrl), svg);
  assert.equal(drawingThumbnailSvgFromDataUrl('data:image/svg+xml,<svg></svg>'), '');
});

test('empty drawings retain a valid thumbnail viewport', () => {
  const svg = decodeURIComponent(createDrawingThumbnail({ entities: [] }).split(',')[1]);
  assert.match(svg, /viewBox="-?\d+(?:\.\d+)? -?\d+(?:\.\d+)? \d+(?:\.\d+)? \d+(?:\.\d+)?"/);
  assert.match(svg, new RegExp(`fill="${DRAWING_CANVAS_BACKGROUND}"`));
});

test('thumbnail objects follow the same stack and z-index paint order as the canvas', () => {
  const drawing = {
    entities: [
      {
        id: 'front', type: 'rect', stackId: 'stack-default', x: 0, y: 0, width: 40, height: 40,
        appearance: { fillColor: '#ff0000', zIndex: 2 },
      },
      {
        id: 'back', type: 'rect', stackId: 'stack-default', x: 10, y: 10, width: 40, height: 40,
        appearance: { fillColor: '#0000ff', zIndex: 0 },
      },
      {
        id: 'upper-stack', type: 'circle', stackId: 'stack-upper', center: [25, 25], radius: 10,
        appearance: { fillColor: '#00ff00', zIndex: 0 },
      },
    ],
    extensions: {
      stacks: {
        activeStackId: 'stack-default',
        stacks: [
          { id: 'stack-default', name: 'Default' },
          { id: 'stack-upper', name: 'Upper' },
        ],
      },
    },
  };

  assert.deepEqual(orderThumbnailEntities(drawing, drawing.entities).map(({ id }) => id), [
    'back', 'front', 'upper-stack',
  ]);
  const svg = createDrawingThumbnailSvg(drawing);
  assert.ok(svg.indexOf('fill="#0000ff"') < svg.indexOf('fill="#ff0000"'));
  assert.ok(svg.indexOf('fill="#ff0000"') < svg.indexOf('fill="#00ff00"'));
});

test('generated closed and Boolean thumbnail regions retain their canvas z-index position', () => {
  const svg = createDrawingThumbnailSvg({
    entities: [
      {
        id: 'front-panel', type: 'rect', x: 0, y: 0, width: 100, height: 60,
        appearance: { fillColor: '#ff0000', zIndex: 3 },
      },
      {
        id: 'back-target', type: 'rect', x: 10, y: 10, width: 100, height: 60,
        appearance: { fillColor: '#0000ff', zIndex: 0 },
      },
      {
        id: 'cutter', type: 'circle', center: [30, 10], radius: 10,
        subtract: true, subtractExpression: 'TRUE', appearance: { zIndex: 1 },
      },
    ],
  });

  const booleanIndex = svg.indexOf('class="thumbnail-subtract-result"');
  const frontIndex = svg.indexOf('fill="#ff0000"');
  assert.ok(booleanIndex >= 0);
  assert.ok(frontIndex > booleanIndex);
});

test('saved visibility hides closed objects and their Boolean, array, and symmetric thumbnail children', () => {
  const hiddenAppearance = {
    fillColor: '#123456',
    visible: false,
    visibleExpression: 'showPanel',
  };
  const svg = createDrawingThumbnailSvg({
    entities: [
      {
        id: 'hidden-target', type: 'rect', x: 0, y: 0, width: 100, height: 60,
        appearance: hiddenAppearance,
      },
      {
        id: 'cutter', type: 'circle', center: [30, 30], radius: 12,
        subtract: true, subtractExpression: 'TRUE',
      },
      {
        id: 'visible-target', type: 'rect', x: 300, y: 0, width: 60, height: 40,
        appearance: { fillColor: '#654321' },
      },
      {
        id: 'mirror-line', type: 'line', start: [150, -50], end: [150, 100],
        construction: true,
        composite: { kind: 'symmetric-centerline', sourceIds: ['hidden-target'] },
      },
    ],
    extensions: {
      arrayTools: {
        arrays: [{
          id: 'hidden-array',
          arrayType: 'rectangular',
          sourceIds: ['hidden-target'],
          rowCountExpression: '1',
          columnCountExpression: '2',
          rowSpacingExpression: '0',
          columnSpacingExpression: '150',
        }],
      },
    },
  }, {
    evaluateExpression: (expression) => ({
      TRUE: true,
      FALSE: false,
      showPanel: false,
    })[expression],
  });

  assert.doesNotMatch(svg, /#123456/);
  assert.doesNotMatch(svg, /thumbnail-subtract-result/);
  assert.match(svg, /#654321/);
});

test('thumbnail Seam Lines stay with their owner and below foreground geometry', () => {
  const svg = createDrawingThumbnailSvg({
    entities: [
      {
        id: 'seam-owner', type: 'circle', center: [50, 50], radius: 45,
        appearance: { fillColor: '#ffe5e5', zIndex: 0 },
      },
      {
        id: 'cutter', type: 'circle', center: [25, 20], radius: 20,
        subtract: true, subtractExpression: 'TRUE', appearance: { zIndex: 1 },
      },
      {
        id: 'foreground', type: 'rect', x: 55, y: 45, width: 55, height: 30,
        appearance: { fillColor: '#23867a', zIndex: 2 },
      },
    ],
    extensions: {
      seamLines: {
        version: 2,
        definitions: [{
          regionId: 'seam-owner',
          recordIds: ['seam-owner'],
          defaultEnabled: true,
          overrides: [],
        }],
      },
    },
  });

  const ownerIndex = svg.indexOf('class="thumbnail-subtract-result"');
  const seamIndex = svg.indexOf('stroke-dasharray="5 4"');
  const foregroundIndex = svg.indexOf('fill="#23867a"');
  assert.ok(ownerIndex >= 0);
  assert.ok(seamIndex > ownerIndex);
  assert.ok(foregroundIndex > seamIndex);
});

test('closed image fills are retained in thumbnail patterns', (context) => {
  context.after(() => configureImageCatalogResources());
  configureImageCatalogResources({
    manifestUrl: 'https://app.example/assets/catalog.json',
    assetBaseUrl: 'https://app.example/assets/',
  });
  const svg = decodeURIComponent(createDrawingThumbnail({
    entities: [{
      id: 'fabric-circle', type: 'circle', center: [10, 10], radius: 8,
      appearance: {
        fillType: 'image', fillExpression: 'basic/Fabric/sample.webp',
        fillImageReference: 'basic/Fabric/sample.webp', fillColor: '#ffffff',
      },
    }],
  }).split(',')[1]);
  assert.match(svg, /<pattern[^>]+thumbnail-image-fill/);
  assert.match(svg, /patternUnits="userSpaceOnUse"/);
  assert.match(svg, /data-image-fill-mode="tile"/);
  assert.match(svg, /https:\/\/app\.example\/assets\/Fabric\/sample\.webp/);
  assert.match(svg, /fill="url\(#thumbnail-image-fill-/);
});

test('thumbnail image fills resolve through string-valued parameters', () => {
  const svg = createDrawingThumbnailSvg({
    entities: [{
      id: 'fabric-circle', type: 'circle', center: [10, 10], radius: 8,
      appearance: {
        fillExpression: 'Fabric1', fillColor: '#ffffff',
      },
    }],
  }, {
    evaluateExpression: (expression) => expression === 'Fabric1'
      ? 'basic/Fabric/sample.webp'
      : Number(expression),
    evaluateLength: Number,
  });
  assert.match(svg, /<pattern[^>]+thumbnail-image-fill/);
  assert.match(svg, /fill="url\(#thumbnail-image-fill-/);
});

test('ordinary multi-edge closed regions use one authoritative solid or image-filled boundary', () => {
  const composite = { id: 'closed-panel', kind: 'rectangle', closed: true, count: 4 };
  const svg = createDrawingThumbnailSvg({
    entities: [
      {
        id: 'edge-a', type: 'line', start: [0, 0], end: [80, 0],
        composite: { ...composite, index: 0 },
        appearance: {
          fillType: 'image', fillImageReference: 'basic/Fabric/sample.webp',
          fillExpression: 'basic/Fabric/sample.webp', fillColor: '#bd9494',
        },
      },
      { id: 'edge-b', type: 'line', start: [80, 0], end: [80, 40], composite: { ...composite, index: 1 } },
      { id: 'edge-c', type: 'line', start: [80, 40], end: [0, 40], composite: { ...composite, index: 2 } },
      { id: 'edge-d', type: 'line', start: [0, 40], end: [0, 0], composite: { ...composite, index: 3 } },
    ],
  });

  assert.equal((svg.match(/class="thumbnail-resolved-boundary"/g) || []).length, 1);
  assert.match(svg, /class="thumbnail-resolved-boundary"[^>]+fill="url\(#thumbnail-image-fill-/);
  assert.doesNotMatch(svg, /<line /);
});

test('thumbnail image patterns resolve Scale, Stretch, and Tile appearance settings', () => {
  const imageEntity = (id, mode, x) => ({
    id, type: 'rect', x, y: 0, width: 20, height: 10,
    appearance: {
      fillType: 'image', fillExpression: 'basic/Fabric/sample.webp',
      fillImageReference: 'basic/Fabric/sample.webp', fillImageMode: mode,
      fillImageWidthExpression: '10', fillImageHeightExpression: '5',
      fillImageLeftExpression: '0', fillImageTopExpression: '-12',
      fillImageAspectRatio: 2, fillColor: '#ffffff',
    },
  });
  const svg = createDrawingThumbnailSvg({
    entities: [imageEntity('scale', 'scale', 0), imageEntity('stretch', 'stretch', 30), imageEntity('tile', 'tile', 60)],
  }, { evaluateNumeric: (expression) => expression === 'imageScale' ? 25 : Number(expression), evaluateLength: Number });
  assert.match(svg, /data-image-fill-mode="scale"/);
  assert.doesNotMatch(svg, /data-image-fill-mode="scale"[^>]+data-image-fill-width=/);
  assert.match(svg, /data-image-fill-mode="scale"[^>]*>[\s\S]*?preserveAspectRatio="xMidYMid meet"/);
  assert.match(svg, /data-image-fill-mode="stretch"/);
  assert.match(svg, /preserveAspectRatio="none"/);
  assert.match(svg, /data-image-fill-mode="tile"/);
  assert.match(svg, /x="-5" y="-14.5" width="10" height="5" patternUnits="userSpaceOnUse"/);
});

test('stack thumbnails include only the objects owned by that stack', () => {
  const drawing = {
    entities: [
      { id: 'default-line', type: 'line', stackId: 'stack-default', start: [10, 20], end: [110, 70] },
      { id: 'second-line', type: 'line', stackId: 'stack-two', start: [400, 500], end: [450, 550] },
    ],
    dimensionAnnotations: [
      { id: 'default-dimension', type: 'dimension-line', stackId: 'stack-default', start: [10, 10], end: [110, 10] },
      { id: 'second-dimension', type: 'dimension-line', stackId: 'stack-two', start: [400, 490], end: [450, 490] },
    ],
  };
  const filtered = stackDrawing(drawing, 'stack-two');
  assert.deepEqual(filtered.entities.map(({ id }) => id), ['second-line']);
  assert.deepEqual(filtered.dimensionAnnotations.map(({ id }) => id), ['second-dimension']);
  const svg = decodeURIComponent(createDrawingThumbnail(filtered).split(',')[1]);
  assert.match(svg, /x1="400" y1="500" x2="450" y2="550"/);
  assert.doesNotMatch(svg, /x1="10" y1="20"/);
});

test('stack thumbnails materialize rectangular array copies from parametric expressions', () => {
  const drawing = {
    entities: [
      { id: 'source', type: 'line', stackId: 'stack-default', start: [0, 0], end: [10, 0] },
    ],
    extensions: {
      arrayTools: {
        arrays: [{
          id: 'array-1',
          stackId: 'stack-array',
          arrayType: 'rectangular',
          sourceIds: ['source'],
          rowCountExpression: '1',
          columnCountExpression: 'copies',
          rowSpacingExpression: '0',
          columnSpacingExpression: '5',
          rowDirection: 'down',
          columnDirection: 'right',
        }],
      },
    },
  };
  const svg = decodeURIComponent(createDrawingThumbnail(drawing, {
    stackId: 'stack-array',
    evaluateNumeric: (expression) => expression === 'copies' ? 3 : Number(expression),
    evaluateLength: Number,
  }).split(',')[1]);

  assert.equal((svg.match(/<line /g) || []).length, 2);
  assert.match(svg, /transform="matrix\(1 0 0 1 15 0\)"/);
  assert.match(svg, /transform="matrix\(1 0 0 1 30 0\)"/);
});

test('rectangular array export derives edge spacing from the rendered arc span', () => {
  const radius = 100;
  const pointAtAngle = (angle) => [
    Math.cos(angle) * radius,
    100 + Math.sin(angle) * radius,
  ];
  const svg = createDrawingThumbnailSvg({
    entities: [{
      id: 'shallow-arc',
      type: 'arc',
      center: [0, 100],
      radius,
      start: pointAtAngle(-Math.PI / 2),
      arcPoint: pointAtAngle(-Math.PI / 3),
      end: pointAtAngle(-Math.PI / 6),
    }],
    extensions: {
      arrayTools: {
        arrays: [{
          id: 'shallow-arc-array',
          arrayType: 'rectangular',
          sourceIds: ['shallow-arc'],
          rowCountExpression: '1',
          columnCountExpression: '2',
          rowSpacingExpression: '0',
          columnSpacingExpression: '0',
          rowDirection: 'down',
          columnDirection: 'right',
        }],
      },
    },
  });

  assert.match(svg, /transform="matrix\(1 0 0 1 86\.602540378 0\)"/);
  assert.doesNotMatch(svg, /transform="matrix\(1 0 0 1 200 0\)"/);
});

test('arrayed image fills retain local aspect-preserving pattern coordinates', () => {
  const svg = createDrawingThumbnailSvg({
    entities: [{
      id: 'fabric', type: 'rect', x: 0, y: 0, width: 20, height: 10,
      appearance: {
        fillType: 'image',
        fillExpression: 'basic/Fabric/sample.webp',
        fillImageReference: 'basic/Fabric/sample.webp',
        fillImageMode: 'scale',
        fillImageAspectRatio: 2,
      },
    }],
    extensions: {
      arrayTools: {
        arrays: [{
          id: 'fabric-array', arrayType: 'rectangular', sourceIds: ['fabric'],
          rowCountExpression: '1', columnCountExpression: '2',
          rowSpacingExpression: '0', columnSpacingExpression: '10',
          rowDirection: 'down', columnDirection: 'right',
        }],
      },
    },
  }, {
    evaluateNumeric: Number,
    evaluateLength: Number,
  });

  assert.equal((svg.match(/<pattern /g) || []).length, 1);
  assert.match(svg, /<pattern[^>]+x="0" y="0" width="20" height="10"/);
  assert.match(svg, /<image x="-10" y="-5" width="40" height="20" preserveAspectRatio="xMidYMid meet"/);
  assert.match(svg, /transform="matrix\(1 0 0 1 30 0\)"[^>]*><path class="thumbnail-resolved-boundary"/);
});

test('array thumbnails duplicate resolved closed regions without exposing source edges', () => {
  const composite = { id: 'array-panel', kind: 'rectangle', closed: true, count: 4 };
  const svg = createDrawingThumbnailSvg({
    drawingUnit: 'mm',
    entities: [
      { id: 'top', type: 'line', start: [0, 0], end: [40, 0], composite: { ...composite, index: 0 } },
      { id: 'right', type: 'line', start: [40, 0], end: [40, 20], composite: { ...composite, index: 1 } },
      { id: 'bottom', type: 'line', start: [40, 20], end: [0, 20], composite: { ...composite, index: 2 } },
      { id: 'left', type: 'line', start: [0, 20], end: [0, 0], composite: { ...composite, index: 3 } },
    ],
    extensions: {
      arrayTools: {
        arrays: [{
          id: 'closed-array', arrayType: 'rectangular', sourceIds: ['top', 'right', 'bottom', 'left'],
          rowCountExpression: '1', columnCountExpression: '3',
          rowSpacingExpression: '0', columnSpacingExpression: '10',
          rowDirection: 'down', columnDirection: 'right',
        }],
      },
    },
  });

  assert.equal((svg.match(/class="thumbnail-resolved-boundary"/g) || []).length, 3);
  assert.equal((svg.match(/<line /g) || []).length, 0);
  assert.match(svg, /transform="matrix\(1 0 0 1 50 0\)"[^>]*><path class="thumbnail-resolved-boundary"/);
  assert.match(svg, /transform="matrix\(1 0 0 1 100 0\)"[^>]*><path class="thumbnail-resolved-boundary"/);
});

test('array thumbnails derive every Seam Line copy from V2 intent', () => {
  const svg = createDrawingThumbnailSvg({
    drawingUnit: 'mm',
    entities: [{ id: 'shape', type: 'rect', x: 0, y: 0, width: 80, height: 50 }],
    extensions: {
      seamLines: {
        version: 2,
        definitions: [{ regionId: 'shape', recordIds: ['shape'], defaultEnabled: true, overrides: [] }],
      },
      arrayTools: {
        arrays: [{
          id: 'seam-array', arrayType: 'rectangular', sourceIds: ['shape'],
          rowCountExpression: '1', columnCountExpression: '2',
          rowSpacingExpression: '0', columnSpacingExpression: '20',
          rowDirection: 'down', columnDirection: 'right',
        }],
      },
    },
  });

  assert.equal((svg.match(/stroke-dasharray="5 4"/g) || []).length, 2);
  assert.equal(svg.includes('finish-size-offset-record'), false);
});

test('thumbnails render the final Boolean contour instead of target and cutter sources', () => {
  const svg = createDrawingThumbnailSvg({
    entities: [
      {
        id: 'target', type: 'rect', stackId: 'stack-default', x: 0, y: 0, width: 100, height: 60,
        appearance: { fillColor: '#bd9494', fillOpacity: 1, strokeThickness: 2 },
      },
      {
        id: 'cutter', type: 'circle', stackId: 'stack-default', center: [50, 0], radius: 20,
        subtract: true, subtractExpression: 'TRUE',
      },
    ],
  });

  assert.equal((svg.match(/class="thumbnail-subtract-result"/g) || []).length, 1);
  assert.match(svg, /class="thumbnail-subtract-result"[^>]+fill-rule="evenodd"/);
  assert.match(svg, /class="thumbnail-subtract-result"[^>]+fill="#bd9494"/);
  assert.doesNotMatch(svg, /<circle cx="50" cy="0"/);
  assert.doesNotMatch(svg, /<rect x="0" y="0" width="100" height="60"/);
});

test('thumbnails preserve edited geometry stroke colors', () => {
  const svg = createDrawingThumbnailSvg({
    entities: [{
      id: 'colored-line', type: 'line', start: [0, 0], end: [40, 0],
      appearance: { strokeColor: '#12abef' },
    }],
  });

  assert.match(svg, /stroke="#12abef"/);
});

test('thumbnails preserve filleted target boundaries in the final Boolean fill path', () => {
  const composite = { id: 'rounded-target', kind: 'rectangle', closed: true, count: 4 };
  const svg = createDrawingThumbnailSvg({
    entities: [
      { id: 'edge-a', type: 'line', start: [0, 0], end: [100, 0], composite: { ...composite, index: 0 }, appearance: { fillColor: '#bd9494' } },
      { id: 'edge-b', type: 'line', start: [100, 0], end: [100, 60], composite: { ...composite, index: 1 } },
      { id: 'edge-c', type: 'line', start: [100, 60], end: [0, 60], composite: { ...composite, index: 2 } },
      { id: 'edge-d', type: 'line', start: [0, 60], end: [0, 0], composite: { ...composite, index: 3 } },
      {
        id: 'corner-fillet', type: 'fillet', radius: 10,
        sourceA: { recordId: 'edge-a', index: 2 },
        sourceB: { recordId: 'edge-b', index: 0 },
      },
      {
        id: 'cutter', type: 'circle', center: [40, 0], radius: 15,
        subtract: true, subtractExpression: 'TRUE',
      },
    ],
  });

  assert.equal((svg.match(/class="thumbnail-subtract-result"/g) || []).length, 1);
  assert.match(svg, /class="thumbnail-subtract-result"[^>]+d="[^"]*A 15 15[^"]*A 10 10/);
  assert.match(svg, /fill="#bd9494"/);
});

test('array thumbnails copy the authoritative Boolean result for every placement', () => {
  const svg = createDrawingThumbnailSvg({
    drawingUnit: 'mm',
    entities: [
      { id: 'target', type: 'rect', stackId: 'stack-default', x: 0, y: 0, width: 100, height: 60 },
      {
        id: 'cutter', type: 'circle', stackId: 'stack-default', center: [50, 0], radius: 20,
        subtract: true, subtractExpression: 'TRUE',
      },
    ],
    extensions: {
      arrayTools: {
        arrays: [{
          id: 'boolean-array',
          stackId: 'stack-default',
          arrayType: 'rectangular',
          sourceIds: ['target'],
          rowCountExpression: '1',
          columnCountExpression: '2',
          rowSpacingExpression: '0',
          columnSpacingExpression: '20',
          rowDirection: 'down',
          columnDirection: 'right',
        }],
      },
    },
  });

  assert.equal((svg.match(/class="thumbnail-subtract-result"/g) || []).length, 2);
  assert.match(svg, /transform="matrix\(1 0 0 1 120 0\)"[^>]*><path class="thumbnail-subtract-result"/);
  assert.doesNotMatch(svg, /<circle cx="50" cy="0"/);
});

test('thumbnail Boolean results include every derived array cutter placement', () => {
  const svg = createDrawingThumbnailSvg({
    drawingUnit: 'mm',
    entities: [
      {
        id: 'target', type: 'rect', x: 0, y: 0, width: 180, height: 60,
        appearance: { fillColor: '#bd9494' },
      },
      {
        id: 'cutter', type: 'circle', center: [20, 0], radius: 10,
        subtract: true, subtractExpression: 'TRUE',
      },
    ],
    extensions: {
      arrayTools: {
        arrays: [{
          id: 'cutter-array', arrayType: 'rectangular', sourceIds: ['cutter'],
          rowCountExpression: '1', columnCountExpression: '3',
          rowSpacingExpression: '0', columnSpacingExpression: '50',
          rowCentroidSpacing: true, columnCentroidSpacing: true,
          rowDirection: 'down', columnDirection: 'right',
        }],
      },
    },
  });

  assert.equal((svg.match(/class="thumbnail-subtract-result"/g) || []).length, 1);
  assert.ok((svg.match(/A 10 10/g) || []).length >= 3);
  assert.doesNotMatch(svg, /<circle /);
  assert.doesNotMatch(svg, /class="thumbnail-resolved-boundary"[^>]+A 10 10/);
});

test('stack thumbnails materialize symmetric copies owned by a centerline stack', () => {
  const drawing = {
    entities: [
      { id: 'source', type: 'line', stackId: 'stack-default', start: [10, 0], end: [20, 0] },
      {
        id: 'mirror',
        type: 'line',
        stackId: 'stack-mirror',
        start: [0, -10],
        end: [0, 10],
        composite: { kind: 'symmetric-centerline', sourceIds: ['source'] },
      },
    ],
  };
  const svg = decodeURIComponent(createDrawingThumbnail(drawing, { stackId: 'stack-mirror' }).split(',')[1]);

  assert.equal((svg.match(/<line /g) || []).length, 2);
  assert.match(svg, /transform="matrix\(-1 0 0 1 0 0\)"/);
});

test('linked-copy thumbnails keep duplicate and symmetric groups at their saved independent anchors', () => {
  const drawing = {
    entities: [{ id: 'source', type: 'line', start: [100, 100], end: [120, 100] }],
    extensions: {
      linkedCopyTools: {
        version: 1,
        copies: [
          {
            id: 'duplicate', type: 'duplicate', sourceIds: ['source'], anchor: [30, 40],
            linear: { a: 1, b: 0, c: 0, d: 1 },
          },
          {
            id: 'symmetric', type: 'symmetric', sourceIds: ['source'], anchor: [-30, 40],
            linear: { a: -1, b: 0, c: 0, d: 1 },
          },
        ],
      },
    },
  };
  const svg = decodeURIComponent(createDrawingThumbnail(drawing).split(',')[1]);

  assert.match(svg, /transform="matrix\(1 0 0 1 -80 -60\)"/);
  assert.match(svg, /transform="matrix\(-1 0 0 1 80 -60\)"/);
});

test('symmetric thumbnails reflect V2 Seam Line presentation with the source object', () => {
  const svg = createDrawingThumbnailSvg({
    entities: [
      { id: 'shape', type: 'rect', x: 0, y: 0, width: 60, height: 40 },
      {
        id: 'mirror', type: 'line', start: [100, -20], end: [100, 80], construction: true,
        composite: { kind: 'symmetric-centerline', sourceIds: ['shape'] },
      },
    ],
    extensions: {
      seamLines: {
        version: 2,
        definitions: [{ regionId: 'shape', recordIds: ['shape'], defaultEnabled: true, overrides: [] }],
      },
    },
  });

  assert.equal((svg.match(/stroke-dasharray="5 4"/g) || []).length, 2);
  assert.match(svg, /transform="matrix\(-1 0 0 1 200 0\)"/);
});

test('storage-style thumbnails resolve saved parameters and include arrays and symmetry', () => {
  const drawing = {
    drawingUnit: 'mm',
    parameters: [{
      id: 'parameter-copies', name: 'copies', kind: 'user', expression: '3', value: 3, order: 0,
    }],
    entities: [
      { id: 'source', type: 'line', stackId: 'stack-default', start: [10, 0], end: [20, 0] },
      {
        id: 'mirror',
        type: 'line',
        stackId: 'stack-default',
        start: [0, -10],
        end: [0, 10],
        composite: { kind: 'symmetric-centerline', sourceIds: ['source'] },
      },
    ],
    extensions: {
      arrayTools: {
        arrays: [{
          id: 'array-1',
          stackId: 'stack-default',
          arrayType: 'rectangular',
          sourceIds: ['source'],
          rowCountExpression: '1',
          columnCountExpression: 'copies',
          rowSpacingExpression: '0',
          columnSpacingExpression: '5',
          rowDirection: 'down',
          columnDirection: 'right',
        }],
      },
    },
  };
  const svg = decodeURIComponent(createDrawingThumbnail(drawing).split(',')[1]);

  assert.match(svg, /transform="matrix\(1 0 0 1 15 0\)"/);
  assert.match(svg, /transform="matrix\(1 0 0 1 30 0\)"/);
  assert.match(svg, /transform="matrix\(-1 0 0 1 0 0\)"/);
});

test('stack thumbnails render dimensions, controls, notches, and image objects', () => {
  const drawing = {
    entities: [
      { id: 'control', type: 'control', stackId: 'stack-tools', controlType: 'checkbox', x: 5, y: 5, width: 24, height: 24 },
      { id: 'notch', type: 'notch', stackId: 'stack-tools', point: [40, 5], end: [40, 12] },
      { id: 'v-notch', type: 'notch', notchType: 'v-notch', stackId: 'stack-tools', point: [45, 5], end: [45, 12] },
      { id: 'u-notch', type: 'notch', notchType: 'u-notch', stackId: 'stack-tools', point: [50, 5], end: [50, 12] },
      { id: 'image', type: 'image', stackId: 'stack-tools', x: 50, y: 5, width: 30, height: 20 },
    ],
    dimensionAnnotations: [{
      id: 'dimension', type: 'dimension-line', stackId: 'stack-tools',
      start: [5, 40], end: [80, 40], measureStart: [5, 25], measureEnd: [80, 25], label: [42.5, 38], text: '75',
    }],
  };
  const svg = decodeURIComponent(createDrawingThumbnail(drawing, { stackId: 'stack-tools' }).split(',')[1]);

  assert.match(svg, />75<\/text>/);
  assert.match(svg, /fill="#e5e7eb"/);
  assert.match(svg, /class="thumbnail-dimension-path"/);
  assert.match(svg, /class="thumbnail-dimension-extension"/);
  assert.ok((svg.match(/<line /g) || []).length >= 2);
  assert.match(svg, /<path d="M 40 5 L 40 12"/);
  assert.equal((svg.match(/fill="#000000" fill-opacity="1"/g) || []).length, 2);
  assert.ok((svg.match(/<rect /g) || []).length >= 2);
});

test('thumbnail callers can retain filled geometry while explicitly omitting dimensions', () => {
  const svg = createDrawingThumbnailSvg({
    entities: [{
      id: 'filled-shape', type: 'rect', stackId: 'stack-tools',
      x: 0, y: 0, width: 80, height: 40,
      appearance: { fillColor: '#bd9494', fillOpacity: 1 },
    }],
    dimensionAnnotations: [{
      id: 'dimension', type: 'dimension-line', stackId: 'stack-tools',
      start: [0, -10], end: [80, -10], measureStart: [0, 0], measureEnd: [80, 0],
      label: [40, -10], text: '80',
    }],
  }, { stackId: 'stack-tools', includeDimensions: false });

  assert.match(svg, /class="thumbnail-resolved-boundary"[^>]+fill="#bd9494"/);
  assert.doesNotMatch(svg, /thumbnail-dimension-/);
  assert.doesNotMatch(svg, />80<\/text>/);
});

test('thumbnail Value Only presentation includes opted-in Driving Dimensions with Driven formatting', () => {
  const svg = createDrawingThumbnailSvg({
    parameters: [
      {
        id: 'driven-width', name: 'd1', kind: 'dimension', expression: '82 in',
        value: 2082.8, unit: 'in', driving: false, computed: true, order: 0,
      },
      {
        id: 'driving-height', name: 'd2', kind: 'dimension', expression: '10 in',
        value: 254, unit: 'in', driving: true, computed: false, order: 1,
      },
      {
        id: 'included-driving-height', name: 'd3', kind: 'dimension', expression: '12.5 in',
        value: 317.5, unit: 'in', driving: true, computed: false, order: 2,
      },
    ],
    dimensionAnnotations: [
      {
        id: 'driven', dimensionId: 'driven-width', dimensionMode: 'driven',
        type: 'dimension-text', label: [10, 10], text: 'd1 = 82',
      },
      {
        id: 'driving', dimensionId: 'driving-height', dimensionMode: 'driving',
        type: 'dimension-text', label: [20, 20], text: 'd2 = 10',
      },
      {
        id: 'included-driving', dimensionId: 'included-driving-height', dimensionMode: 'driving',
        includeInValueOnly: true,
        type: 'dimension-text', label: [30, 30], text: 'd3 = 12.5',
      },
    ],
  });

  assert.match(svg, />82&quot;<\/text>/);
  assert.doesNotMatch(svg, /d1\s*=/);
  assert.doesNotMatch(svg, /d2\s*=/);
  assert.doesNotMatch(svg, />10<\/text>/);
  assert.match(svg, />12\.5&quot;<\/text>/);
  assert.doesNotMatch(svg, /d3\s*=/);
});

test('Value Only text identifies multi-curve length dimensions as perimeter measurements', () => {
  const evaluators = drawingThumbnailEvaluators({
    drawingUnit: 'mm',
    parameters: [{
      id: 'perimeter',
      name: 'd1',
      kind: 'dimension',
      expression: '125 mm',
      value: 125,
      unit: 'mm',
      driving: false,
      computed: true,
      order: 0,
    }],
  });

  assert.equal(evaluators.dimensionValueText({
    type: 'multi-curve-length-dimension',
    dimensionId: 'perimeter',
    text: 'MCL = 125 mm',
  }), 'PERIM 125 mm');
});

test('thumbnail Value Only text uses eighth-inch rounding while DXF text uses thirty-seconds', () => {
  const evaluators = drawingThumbnailEvaluators({
    drawingUnit: 'in',
    parameters: [{
      id: 'visual-value',
      name: 'd1',
      kind: 'dimension',
      expression: '1.1 in',
      value: 1.1 * 25.4,
      unit: 'in',
      driving: false,
      computed: true,
      order: 0,
    }],
  });
  const annotation = { dimensionId: 'visual-value', type: 'dimension-text', text: 'd1 = 1.1' };

  assert.equal(evaluators.dimensionValueText(annotation), '1.125"');
  assert.equal(evaluators.dimensionDxfValueText(annotation), '1.09375"');
});

test('dimension thumbnails use the rendered offset line instead of connecting measured points', () => {
  const svg = decodeURIComponent(createDrawingThumbnail({
    dimensionAnnotations: [{
      id: 'dimension',
      type: 'dimension-line',
      subtype: 'horizontal',
      start: [0, 0],
      end: [100, 0],
      measureStart: [0, 0],
      measureEnd: [100, 0],
      label: [50, -30],
      text: '100',
    }],
  }).split(',')[1]);

  assert.match(svg, /class="thumbnail-dimension-path" d="M 0 -30 L 100 -30"/);
  assert.doesNotMatch(svg, /class="thumbnail-dimension-path" d="M 0 0 L 100 0"/);
});

test('diameter dimension thumbnails span the circle and include both arrowheads', () => {
  const svg = createDrawingThumbnailSvg({
    dimensionAnnotations: [{
      id: 'diameter',
      type: 'radius-dimension',
      subtype: 'diameter',
      dimensionMode: 'driven',
      center: [0, 0],
      radius: 20,
      elbow: [35, 0],
      label: [67, 0],
      text: '40',
    }],
  });

  assert.match(svg, /class="thumbnail-dimension-path" d="M -20 0 L 20 0 /);
  assert.equal((svg.match(/class="thumbnail-dimension-arrow"/g) || []).length, 2);
});
