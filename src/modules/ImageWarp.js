import { unitFactors, valueInUnit } from './solver/Units.js';

const clone = (value) => JSON.parse(JSON.stringify(value));
const minimumWarpDimension = 24;
const minimumWarpTargetDimension = 0.001;
const maximumWarpPixels = 12_000_000;
let openCvPromise = null;

const finite = (value, fallback) => {
  if (typeof value === 'string' && !value.trim()) return fallback;
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
};
const clampDimension = (value, fallback) => Math.max(minimumWarpDimension, Math.abs(finite(value, fallback)));
const clampTargetDimension = (value, fallback) => Math.max(minimumWarpTargetDimension, Math.abs(finite(value, fallback)));

function defaultGuide(width, height) {
  const insetX = width * 0.15;
  const insetY = height * 0.15;
  return [
    [-width / 2 + insetX, -height / 2 + insetY],
    [width / 2 - insetX, -height / 2 + insetY],
    [width / 2 - insetX, height / 2 - insetY],
    [-width / 2 + insetX, height / 2 - insetY],
  ];
}

export function normalizeWarpSettings(input = {}, entity = {}) {
  const width = clampDimension(entity.width, 240);
  const height = clampDimension(entity.height, 160);
  const points = Array.isArray(input.points) && input.points.length === 4
    ? input.points.map((point, index) => [
      finite(point?.[0], defaultGuide(width, height)[index][0]),
      finite(point?.[1], defaultGuide(width, height)[index][1]),
    ])
    : defaultGuide(width, height);
  return {
    enabled: Boolean(input.enabled),
    source: String(input.source || entity.source || ''),
    sourceDisplayWidth: clampDimension(input.sourceDisplayWidth, width),
    sourceDisplayHeight: clampDimension(input.sourceDisplayHeight, height),
    targetWidth: clampTargetDimension(input.targetWidth, Math.abs(points[1][0] - points[0][0]) || width * 0.7),
    targetHeight: clampTargetDimension(input.targetHeight, Math.abs(points[3][1] - points[0][1]) || height * 0.7),
    points,
  };
}

export function enableWarpSettings(entity) {
  return normalizeWarpSettings({ ...(entity.warp || {}), enabled: true, source: entity.warp?.source || entity.source }, entity);
}

export function toggleWarpSettings(entity) {
  const warp = normalizeWarpSettings(entity.warp || {}, entity);
  return { ...warp, enabled: !warp.enabled, source: warp.source || entity.source };
}

export function moveWarpGuideCorner(input, cornerIndex, point) {
  const warp = normalizeWarpSettings(input);
  const points = warp.points.map((item) => [...item]);
  if (Number.isInteger(cornerIndex) && cornerIndex >= 0 && cornerIndex < 4) {
    points[cornerIndex] = [finite(point?.[0], points[cornerIndex][0]), finite(point?.[1], points[cornerIndex][1])];
  }
  return { ...warp, points };
}

export function setWarpDimension(input, axis, value) {
  const warp = normalizeWarpSettings(input);
  return axis === 'height'
    ? { ...warp, targetHeight: clampTargetDimension(value, warp.targetHeight) }
    : { ...warp, targetWidth: clampTargetDimension(value, warp.targetWidth) };
}

function normalizeLengthUnit(unit = '') {
  const normalized = String(unit || '').trim().toLowerCase();
  if (normalized === '"' || normalized === 'inch' || normalized === 'inches') return 'in';
  if (normalized === 'millimeter' || normalized === 'millimeters') return 'mm';
  return unitFactors[normalized] && normalized !== 'deg' ? normalized : '';
}

function lengthValueToDrawingUnits(value, unit = '') {
  const normalized = normalizeLengthUnit(unit);
  const number = finite(value, 0);
  return normalized ? number * unitFactors[normalized] : number;
}

export function formatWarpDimension(value, unit = '') {
  const normalized = normalizeLengthUnit(unit);
  const number = normalized ? valueInUnit(value, normalized) : finite(value, 0);
  return Number.isInteger(number) ? String(number) : number.toFixed(2).replace(/\.?0+$/, '');
}

export function formatWarpDimensionWithUnit(value, unit = '') {
  const suffix = normalizeLengthUnit(unit);
  return suffix ? `${formatWarpDimension(value, suffix)} ${suffix}` : formatWarpDimension(value);
}

export function parseWarpDimensionInput(value, fallback, defaultUnit = '') {
  const source = String(value ?? '').trim();
  if (!source) return fallback;
  const match = source.match(/^(-?(?:\d+(?:\.\d*)?|\.\d+))(?:\s*("|in|inch|inches|mm|millimeter|millimeters|cm|m))?$/i);
  if (!match) return fallback;
  return lengthValueToDrawingUnits(Number(match[1]), match[2] || defaultUnit);
}

function loadImage(source) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Could not load the image for perspective warp.'));
    image.src = source;
  });
}

function solveLinearSystem(matrix, vector) {
  const size = vector.length;
  const a = matrix.map((row, index) => [...row, vector[index]]);
  for (let column = 0; column < size; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < size; row += 1) {
      if (Math.abs(a[row][column]) > Math.abs(a[pivot][column])) pivot = row;
    }
    if (Math.abs(a[pivot][column]) < 1e-10) throw new Error('Warp guide points are too close to a singular perspective transform.');
    [a[column], a[pivot]] = [a[pivot], a[column]];
    const divisor = a[column][column];
    for (let item = column; item <= size; item += 1) a[column][item] /= divisor;
    for (let row = 0; row < size; row += 1) {
      if (row === column) continue;
      const factor = a[row][column];
      for (let item = column; item <= size; item += 1) a[row][item] -= factor * a[column][item];
    }
  }
  return a.map((row) => row[size]);
}

export function perspectiveTransformFromPoints(sourcePoints, destinationPoints) {
  const matrix = [];
  const vector = [];
  sourcePoints.forEach(([x, y], index) => {
    const [u, v] = destinationPoints[index];
    matrix.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    vector.push(u);
    matrix.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    vector.push(v);
  });
  const [a, b, c, d, e, f, g, h] = solveLinearSystem(matrix, vector);
  return [a, b, c, d, e, f, g, h, 1];
}

export function transformPerspectivePoint(matrix, [x, y]) {
  const denominator = matrix[6] * x + matrix[7] * y + matrix[8];
  return [
    (matrix[0] * x + matrix[1] * y + matrix[2]) / denominator,
    (matrix[3] * x + matrix[4] * y + matrix[5]) / denominator,
  ];
}

function invert3x3(matrix) {
  const [a, b, c, d, e, f, g, h, i] = matrix;
  const A = e * i - f * h;
  const B = c * h - b * i;
  const C = b * f - c * e;
  const D = f * g - d * i;
  const E = a * i - c * g;
  const F = c * d - a * f;
  const G = d * h - e * g;
  const H = b * g - a * h;
  const I = a * e - b * d;
  const determinant = a * A + b * D + c * G;
  if (Math.abs(determinant) < 1e-10) throw new Error('Warp transform could not be inverted.');
  return [A, B, C, D, E, F, G, H, I].map((value) => value / determinant);
}

export function localPointToSourcePixel(point, warp, sourceWidth, sourceHeight) {
  return [
    (point[0] + warp.sourceDisplayWidth / 2) / warp.sourceDisplayWidth * sourceWidth,
    (point[1] + warp.sourceDisplayHeight / 2) / warp.sourceDisplayHeight * sourceHeight,
  ];
}

function scaledPerspectiveTransform(matrix, scale) {
  return [
    matrix[0] * scale,
    matrix[1] * scale,
    matrix[2] * scale,
    matrix[3] * scale,
    matrix[4] * scale,
    matrix[5] * scale,
    matrix[6],
    matrix[7],
    matrix[8],
  ];
}

export function calculateWarpPlan(entity, image) {
  const warp = normalizeWarpSettings(entity.warp || {}, entity);
  const scaleX = image.naturalWidth / warp.sourceDisplayWidth;
  const scaleY = image.naturalHeight / warp.sourceDisplayHeight;
  const targetPixelWidth = Math.max(1, warp.targetWidth * scaleX);
  const targetPixelHeight = Math.max(1, warp.targetHeight * scaleY);
  const sourceQuad = warp.points.map((point) => localPointToSourcePixel(point, warp, image.naturalWidth, image.naturalHeight));
  const destinationQuad = [[0, 0], [targetPixelWidth, 0], [targetPixelWidth, targetPixelHeight], [0, targetPixelHeight]];
  const sourceToDestination = perspectiveTransformFromPoints(sourceQuad, destinationQuad);
  const projectedCorners = [[0, 0], [image.naturalWidth, 0], [image.naturalWidth, image.naturalHeight], [0, image.naturalHeight]]
    .map((point) => transformPerspectivePoint(sourceToDestination, point));
  const minX = Math.min(...projectedCorners.map((point) => point[0]));
  const minY = Math.min(...projectedCorners.map((point) => point[1]));
  const maxX = Math.max(...projectedCorners.map((point) => point[0]));
  const maxY = Math.max(...projectedCorners.map((point) => point[1]));
  const baseOutputWidth = Math.max(1, Math.ceil(maxX - minX));
  const baseOutputHeight = Math.max(1, Math.ceil(maxY - minY));
  if (![baseOutputWidth, baseOutputHeight, minX, minY, maxX, maxY].every(Number.isFinite)) {
    throw new Error('The warp guide projects the image beyond a stable perspective range. Move the guide points away from a vanishing line.');
  }
  const translatedSourceToDestination = [
    sourceToDestination[0] - minX * sourceToDestination[6],
    sourceToDestination[1] - minX * sourceToDestination[7],
    sourceToDestination[2] - minX * sourceToDestination[8],
    sourceToDestination[3] - minY * sourceToDestination[6],
    sourceToDestination[4] - minY * sourceToDestination[7],
    sourceToDestination[5] - minY * sourceToDestination[8],
    sourceToDestination[6],
    sourceToDestination[7],
    sourceToDestination[8],
  ];
  const rasterScale = Math.min(1, Math.sqrt(maximumWarpPixels / (baseOutputWidth * baseOutputHeight)));
  const rasterSourceToDestination = scaledPerspectiveTransform(translatedSourceToDestination, rasterScale);
  const outputWidth = Math.max(1, Math.ceil(baseOutputWidth * rasterScale));
  const outputHeight = Math.max(1, Math.ceil(baseOutputHeight * rasterScale));
  return {
    warp,
    sourceQuad,
    destinationQuad,
    sourceToDestination: translatedSourceToDestination,
    rasterSourceToDestination,
    destinationToSource: invert3x3(rasterSourceToDestination),
    rasterScale,
    baseOutputWidth,
    baseOutputHeight,
    outputWidth,
    outputHeight,
    displayWidth: baseOutputWidth / scaleX,
    displayHeight: baseOutputHeight / scaleY,
  };
}

export async function projectFullImageWarpBounds(entity) {
  const image = await loadImage(normalizeWarpSettings(entity.warp || {}, entity).source || entity.source);
  return calculateWarpPlan(entity, image);
}

function sampleBilinear(imageData, x, y) {
  const { data, width, height } = imageData;
  if (x < 0 || y < 0 || x >= width - 1 || y >= height - 1) return [0, 0, 0, 0];
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = x0 + 1;
  const y1 = y0 + 1;
  const dx = x - x0;
  const dy = y - y0;
  const index = (px, py) => (py * width + px) * 4;
  const result = [0, 0, 0, 0];
  [[x0, y0, (1 - dx) * (1 - dy)], [x1, y0, dx * (1 - dy)], [x0, y1, (1 - dx) * dy], [x1, y1, dx * dy]]
    .forEach(([px, py, weight]) => {
      const offset = index(px, py);
      for (let channel = 0; channel < 4; channel += 1) result[channel] += data[offset + channel] * weight;
    });
  return result;
}

async function warpWithCanvas(entity) {
  const source = normalizeWarpSettings(entity.warp || {}, entity).source || entity.source;
  const image = await loadImage(source);
  const plan = calculateWarpPlan(entity, image);
  const sourceCanvas = document.createElement('canvas');
  sourceCanvas.width = image.naturalWidth;
  sourceCanvas.height = image.naturalHeight;
  const sourceContext = sourceCanvas.getContext('2d', { willReadFrequently: true });
  sourceContext.drawImage(image, 0, 0);
  const sourceImageData = sourceContext.getImageData(0, 0, sourceCanvas.width, sourceCanvas.height);
  const outputCanvas = document.createElement('canvas');
  outputCanvas.width = plan.outputWidth;
  outputCanvas.height = plan.outputHeight;
  const outputContext = outputCanvas.getContext('2d');
  const outputImageData = outputContext.createImageData(plan.outputWidth, plan.outputHeight);
  for (let y = 0; y < plan.outputHeight; y += 1) {
    for (let x = 0; x < plan.outputWidth; x += 1) {
      const sourcePoint = transformPerspectivePoint(plan.destinationToSource, [x, y]);
      const sample = sampleBilinear(sourceImageData, sourcePoint[0], sourcePoint[1]);
      const offset = (y * plan.outputWidth + x) * 4;
      for (let channel = 0; channel < 4; channel += 1) outputImageData.data[offset + channel] = sample[channel];
    }
  }
  outputContext.putImageData(outputImageData, 0, 0);
  return { source: outputCanvas.toDataURL('image/png'), width: plan.displayWidth, height: plan.displayHeight };
}

async function loadOpenCv() {
  if (globalThis.cv?.Mat) return globalThis.cv;
  if (openCvPromise) return openCvPromise;
  openCvPromise = new Promise((resolve, reject) => {
    if (typeof document === 'undefined' || !document.head) {
      reject(new Error('OpenCV.js is only available in the browser.'));
      return;
    }
    const script = document.createElement('script');
    script.async = true;
    script.src = new URL('../../public/vendor/opencv.js', import.meta.url).href;
    script.onload = async () => {
      try {
        if (globalThis.cv?.then) globalThis.cv = await globalThis.cv;
        if (globalThis.cv?.Mat) resolve(globalThis.cv);
        else if (globalThis.cv) {
          globalThis.cv.onRuntimeInitialized = () => resolve(globalThis.cv);
        } else {
          reject(new Error('OpenCV.js loaded but did not expose cv.'));
        }
      } catch (error) {
        reject(error);
      }
    };
    script.onerror = () => reject(new Error('OpenCV.js was not found at public/vendor/opencv.js.'));
    document.head.appendChild(script);
  });
  return openCvPromise;
}

async function warpWithOpenCv(entity) {
  const cv = await loadOpenCv();
  const source = normalizeWarpSettings(entity.warp || {}, entity).source || entity.source;
  const image = await loadImage(source);
  const plan = calculateWarpPlan(entity, image);
  const sourceCanvas = document.createElement('canvas');
  sourceCanvas.width = image.naturalWidth;
  sourceCanvas.height = image.naturalHeight;
  sourceCanvas.getContext('2d').drawImage(image, 0, 0);
  const outputCanvas = document.createElement('canvas');
  outputCanvas.width = plan.outputWidth;
  outputCanvas.height = plan.outputHeight;
  const src = cv.imread(sourceCanvas);
  const dst = new cv.Mat();
  const matrix = cv.matFromArray(3, 3, cv.CV_64F, plan.rasterSourceToDestination);
  try {
    cv.warpPerspective(src, dst, matrix, new cv.Size(plan.outputWidth, plan.outputHeight), cv.INTER_LINEAR, cv.BORDER_CONSTANT, new cv.Scalar(0, 0, 0, 0));
    cv.imshow(outputCanvas, dst);
  } finally {
    src.delete();
    dst.delete();
    matrix.delete();
  }
  return { source: outputCanvas.toDataURL('image/png'), width: plan.displayWidth, height: plan.displayHeight };
}

export async function warpImageEntity(input) {
  const entity = clone(input);
  const warp = normalizeWarpSettings(entity.warp || {}, entity);
  const originalSource = String(entity.originalSource || warp.originalSource || warp.source || entity.source || '');
  const originalWidth = clampDimension(entity.originalWidth ?? warp.originalWidth, entity.baseWidth || entity.width);
  const originalHeight = clampDimension(entity.originalHeight ?? warp.originalHeight, entity.baseHeight || entity.height);
  entity.warp = warp;
  let result;
  try {
    result = await warpWithOpenCv(entity);
  } catch (error) {
    if (!/OpenCV\.js/.test(error.message)) throw error;
    result = await warpWithCanvas(entity);
  }
  return {
    ...entity,
    source: result.source,
    originalSource,
    originalWidth,
    originalHeight,
    width: result.width,
    height: result.height,
    baseWidth: result.width,
    baseHeight: result.height,
    rotation: 0,
    flipX: false,
    flipY: false,
    warp: {
      ...normalizeWarpSettings({ enabled: false, source: result.source }, { ...entity, source: result.source, width: result.width, height: result.height }),
      originalSource,
      originalWidth,
      originalHeight,
    },
  };
}
