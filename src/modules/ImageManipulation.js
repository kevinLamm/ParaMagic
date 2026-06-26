import { resolveOpacityExpression } from './AppearanceExpressions.js';
import {
  enableWarpSettings,
  formatWarpDimension,
  formatWarpDimensionWithUnit,
  moveWarpGuideCorner,
  normalizeWarpSettings,
  parseWarpDimensionInput,
  setWarpDimension,
  toggleWarpSettings,
  warpImageEntity,
} from './ImageWarp.js';

const clone = (value) => JSON.parse(JSON.stringify(value));
const minimumImageSize = 24;
let fallbackId = 0;

function createId() {
  if (globalThis.crypto?.randomUUID) return `image-${globalThis.crypto.randomUUID()}`;
  fallbackId += 1;
  return `image-${Date.now().toString(36)}-${fallbackId}`;
}

function finite(value, fallback) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function rotatePoint([x, y], degrees) {
  const angle = degrees * Math.PI / 180;
  return [x * Math.cos(angle) - y * Math.sin(angle), x * Math.sin(angle) + y * Math.cos(angle)];
}

function subtract([ax, ay], [bx, by]) {
  return [ax - bx, ay - by];
}

function addPoints([ax, ay], [bx, by]) {
  return [ax + bx, ay + by];
}

function worldToImageLocal(entity, world) {
  const translated = subtract(world, [entity.x, entity.y]);
  const rotated = rotatePoint(translated, -entity.rotation);
  return [rotated[0] * (entity.flipX ? -1 : 1), rotated[1] * (entity.flipY ? -1 : 1)];
}

export function isImageEntity(entity) {
  return entity?.type === 'image' && typeof entity.source === 'string';
}

export function normalizeImageEntity(input = {}) {
  const width = Math.max(minimumImageSize, Math.abs(finite(input.width, 240)));
  const height = Math.max(minimumImageSize, Math.abs(finite(input.height, 160)));
  const source = String(input.source || '');
  const baseWidth = Math.max(minimumImageSize, Math.abs(finite(input.baseWidth, width)));
  const baseHeight = Math.max(minimumImageSize, Math.abs(finite(input.baseHeight, height)));
  const originalSource = String(input.originalSource || input.warp?.originalSource || source);
  const originalWidth = Math.max(minimumImageSize, Math.abs(finite(input.originalWidth, input.warp?.originalWidth ?? baseWidth)));
  const originalHeight = Math.max(minimumImageSize, Math.abs(finite(input.originalHeight, input.warp?.originalHeight ?? baseHeight)));
  return {
    id: input.id || createId(),
    type: 'image',
    name: String(input.name || 'Image'),
    source,
    originalSource,
    originalWidth,
    originalHeight,
    x: finite(input.x, 0),
    y: finite(input.y, 0),
    width,
    height,
    baseWidth,
    baseHeight,
    rotation: finite(input.rotation, 0),
    flipX: Boolean(input.flipX),
    flipY: Boolean(input.flipY),
    locked: Boolean(input.locked),
    construction: Boolean(input.construction),
    appearance: clone(input.appearance || { fillOpacityExpression: '100', fillOpacity: 1 }),
    warp: normalizeWarpSettings(input.warp || {}, { ...input, width, height, source: input.source }),
  };
}

export function imageAppearance(entity, evaluateNumeric = Number) {
  const expression = String(entity.appearance?.fillOpacityExpression ?? ((entity.appearance?.fillOpacity ?? 1) * 100));
  let opacity = finite(entity.appearance?.fillOpacity, 1);
  let error = null;
  try {
    opacity = resolveOpacityExpression(expression, evaluateNumeric);
  } catch (caught) {
    error = caught.message;
  }
  const zIndex = Number(entity.appearance?.zIndex);
  return {
    fillOpacityExpression: expression,
    fillOpacity: Math.min(1, Math.max(0, opacity)),
    zIndex: Number.isFinite(zIndex) ? zIndex : null,
    error,
  };
}

export function scaleImageFromCorner(input, cornerIndex, pointer) {
  const entity = normalizeImageEntity(input);
  const signs = [[-1, -1], [1, -1], [1, 1], [-1, 1]][cornerIndex] || [1, 1];
  const oppositeLocal = [-signs[0] * entity.width / 2, -signs[1] * entity.height / 2];
  const oppositeWorld = addPoints([entity.x, entity.y], rotatePoint(oppositeLocal, entity.rotation));
  const pointerFromOpposite = rotatePoint(subtract(pointer, oppositeWorld), -entity.rotation);
  const widthRatio = Math.abs(pointerFromOpposite[0]) / entity.width;
  const heightRatio = Math.abs(pointerFromOpposite[1]) / entity.height;
  const ratio = Math.max(minimumImageSize / entity.width, minimumImageSize / entity.height, widthRatio, heightRatio);
  const width = entity.width * ratio;
  const height = entity.height * ratio;
  const centerOffset = rotatePoint([signs[0] * width / 2, signs[1] * height / 2], entity.rotation);
  return { ...entity, x: oppositeWorld[0] + centerOffset[0], y: oppositeWorld[1] + centerOffset[1], width, height };
}

export function rotateImageFromPointer(input, startPointer, pointer) {
  const entity = normalizeImageEntity(input);
  const angle = ([x, y]) => Math.atan2(y - entity.y, x - entity.x) * 180 / Math.PI;
  return { ...entity, rotation: entity.rotation + angle(pointer) - angle(startPointer) };
}

export function flipImageEntity(input, axis) {
  const entity = normalizeImageEntity(input);
  if (axis === 'horizontal') entity.flipX = !entity.flipX;
  if (axis === 'vertical') entity.flipY = !entity.flipY;
  return entity;
}

export function resetImageEntity(input) {
  const entity = normalizeImageEntity(input);
  return normalizeImageEntity({
    ...entity,
    source: entity.originalSource,
    width: entity.originalWidth,
    height: entity.originalHeight,
    baseWidth: entity.originalWidth,
    baseHeight: entity.originalHeight,
    rotation: 0,
    flipX: false,
    flipY: false,
    warp: normalizeWarpSettings({ enabled: false, source: entity.originalSource }, {
      ...entity,
      source: entity.originalSource,
      width: entity.originalWidth,
      height: entity.originalHeight,
    }),
  });
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error(`Could not read ${file.name || 'the selected image'}.`));
    reader.readAsDataURL(file);
  });
}

function imageDimensions(source) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = () => reject(new Error('The selected file is not a supported image.'));
    image.src = source;
  });
}

export async function createImageEntityFromFile(file, { center = [0, 0], maximumSize = 320 } = {}) {
  if (!file || !String(file.type).startsWith('image/')) throw new Error('Choose a PNG, JPEG, GIF, WebP, or SVG image.');
  const source = await fileToDataUrl(file);
  const dimensions = await imageDimensions(source);
  const scale = Math.min(1, maximumSize / Math.max(dimensions.width, dimensions.height));
  return normalizeImageEntity({
    name: file.name,
    source,
    x: center[0],
    y: center[1],
    width: dimensions.width * scale,
    height: dimensions.height * scale,
  });
}

const toolbarIcons = {
  lock: '<rect x="7" y="10" width="10" height="9"/><path d="M9 10V7a3 3 0 0 1 6 0v3"/>',
  unlock: '<rect x="7" y="10" width="10" height="9"/><path d="M9 10V7a3 3 0 0 1 5-2"/>',
  horizontal: '<path d="M12 4v16"/><path d="M10 7L5 12l5 5zM14 7l5 5-5 5z"/>',
  vertical: '<path d="M4 12h16"/><path d="M7 10l5-5 5 5zM7 14l5 5 5-5z"/>',
  reset: '<path d="M6 7h8a5 5 0 1 1-4.5 7.2"/><path d="M6 7h5M6 7v5"/>',
  warp: '<path d="M5 7l14-2-2 14-12-2z"/><path d="M8 9l7-1-1 7-6-1z"/>',
};

function toolbarButton(label, iconName) {
  const button = document.createElementNS('http://www.w3.org/1999/xhtml', 'button');
  button.className = 'image-toolbar-button canvas-overlay-button';
  button.type = 'button';
  button.title = label;
  button.setAttribute('aria-label', label);
  button.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${toolbarIcons[iconName]}</svg>`;
  return button;
}

function createWarpGuide(addSvg, parent) {
  const warpGuide = addSvg(parent, 'g', { class: 'image-warp-guide' });
  const warpPolygon = addSvg(warpGuide, 'polygon', { class: 'image-warp-polygon' });
  const warpSides = [0, 1, 2, 3].map((index) => addSvg(warpGuide, 'line', { class: 'image-warp-side', 'data-warp-side': index }));
  const warpHandles = [0, 1, 2, 3].map((index) => addSvg(warpGuide, 'rect', { class: 'image-warp-handle point-handle', 'data-warp-corner': index }));
  const warpTexts = [0, 1, 2, 3].map((index) => addSvg(warpGuide, 'text', { class: 'image-warp-dimension-text', 'data-warp-dimension': index }));
  const warpApply = addSvg(warpGuide, 'foreignObject', { class: 'image-warp-apply' });
  const warpApplyContent = document.createElementNS('http://www.w3.org/1999/xhtml', 'div');
  warpApplyContent.className = 'image-warp-apply-content canvas-overlay-button';
  warpApplyContent.innerHTML = '<button type="button" class="image-warp-apply-button">Apply Warp</button><span class="image-warp-status" role="status"></span>';
  warpApply.appendChild(warpApplyContent);

  const warpEditor = addSvg(warpGuide, 'foreignObject', { class: 'image-warp-dimension-editor' });
  const warpEditorContent = document.createElementNS('http://www.w3.org/1999/xhtml', 'div');
  warpEditorContent.className = 'image-warp-dimension-editor-content canvas-overlay-button';
  warpEditorContent.innerHTML = `
    <input class="image-warp-dimension-input" type="text" inputmode="decimal" />
    <span class="image-warp-dimension-unit"></span>
    <button type="button" class="image-warp-dimension-ok">OK</button>
    <button type="button" class="image-warp-dimension-cancel">Cancel</button>`;
  warpEditor.appendChild(warpEditorContent);
  warpEditor.style.display = 'none';

  return {
    warpGuide,
    warpPolygon,
    warpSides,
    warpHandles,
    warpTexts,
    warpApply,
    warpApplyContent,
    warpApplyButton: warpApplyContent.querySelector('.image-warp-apply-button'),
    warpStatus: warpApplyContent.querySelector('.image-warp-status'),
    warpEditor,
    warpEditorContent,
    warpEditorInput: warpEditorContent.querySelector('.image-warp-dimension-input'),
    warpEditorUnit: warpEditorContent.querySelector('.image-warp-dimension-unit'),
    warpEditorOk: warpEditorContent.querySelector('.image-warp-dimension-ok'),
    warpEditorCancel: warpEditorContent.querySelector('.image-warp-dimension-cancel'),
    handles: warpHandles,
  };
}

function updateWarpGuide(record) {
  const warp = normalizeWarpSettings(record.entity.warp || {}, record.entity);
  const visible = Boolean(warp.enabled) && !record.entity.locked && record.group.classList.contains('selected');
  record.warpGuide.style.display = visible ? '' : 'none';
  if (!visible) return;
  const scale = record.currentScale || 1;
  const points = warp.points;
  record.warpPolygon.setAttribute('points', points.map(([x, y]) => `${x},${y}`).join(' '));
  const sidePairs = [[0, 1], [1, 2], [2, 3], [3, 0]];
  record.warpSides.forEach((side, index) => {
    const [startIndex, endIndex] = sidePairs[index];
    side.setAttribute('x1', points[startIndex][0]);
    side.setAttribute('y1', points[startIndex][1]);
    side.setAttribute('x2', points[endIndex][0]);
    side.setAttribute('y2', points[endIndex][1]);
    side.setAttribute('stroke-width', 1.5 / scale);
  });
  const size = 10 / scale;
  record.warpHandles.forEach((handle, index) => {
    handle.setAttribute('x', points[index][0] - size / 2);
    handle.setAttribute('y', points[index][1] - size / 2);
    handle.setAttribute('width', size);
    handle.setAttribute('height', size);
    handle.setAttribute('stroke-width', 1.5 / scale);
  });
  const textData = [
    { side: [points[0], points[1]], value: warp.targetWidth, offset: [0, -16 / scale], anchor: 'middle' },
    { side: [points[1], points[2]], value: warp.targetHeight, offset: [16 / scale, 0], anchor: 'start' },
    { side: [points[2], points[3]], value: warp.targetWidth, offset: [0, 22 / scale], anchor: 'middle' },
    { side: [points[3], points[0]], value: warp.targetHeight, offset: [-16 / scale, 0], anchor: 'end' },
  ];
  record.warpTexts.forEach((text, index) => {
    const { side, value, offset, anchor } = textData[index];
    text.textContent = formatWarpDimensionWithUnit(value, record.getDrawingUnit());
    text.setAttribute('x', (side[0][0] + side[1][0]) / 2 + offset[0]);
    text.setAttribute('y', (side[0][1] + side[1][1]) / 2 + offset[1]);
    text.setAttribute('font-size', 13 / scale);
    text.setAttribute('text-anchor', anchor);
  });
  record.warpApply.setAttribute('x', Math.min(...points.map(([x]) => x)));
  record.warpApply.setAttribute('y', Math.max(...points.map(([, y]) => y)) + 30 / scale);
  record.warpApply.setAttribute('width', 220 / scale);
  record.warpApply.setAttribute('height', 56 / scale);
  record.warpApplyContent.style.transform = `scale(${1 / scale})`;
  record.warpApplyContent.style.transformOrigin = '0 0';
  record.warpApplyContent.style.width = '220px';
  record.warpStatus.textContent = '';
  record.warpApplyButton.disabled = false;
  record.warpApplyButton.textContent = 'Apply Warp';
}

function openWarpDimensionEditor(record, textIndex) {
  const warp = normalizeWarpSettings(record.entity.warp || {}, record.entity);
  const isHeight = textIndex === 1 || textIndex === 3;
  const text = record.warpTexts[textIndex];
  record.warpEditingAxis = isHeight ? 'height' : 'width';
  record.warpEditorInput.value = formatWarpDimension(isHeight ? warp.targetHeight : warp.targetWidth, record.getDrawingUnit());
  record.warpEditorUnit.textContent = record.getDrawingUnit();
  record.warpEditor.setAttribute('x', Number(text.getAttribute('x')) - 36 / (record.currentScale || 1));
  record.warpEditor.setAttribute('y', Number(text.getAttribute('y')) + 8 / (record.currentScale || 1));
  record.warpEditor.setAttribute('width', 190 / (record.currentScale || 1));
  record.warpEditor.setAttribute('height', 38 / (record.currentScale || 1));
  record.warpEditorContent.style.transform = `scale(${1 / (record.currentScale || 1)})`;
  record.warpEditorContent.style.transformOrigin = '0 0';
  record.warpEditor.style.display = '';
  record.warpEditorInput.focus();
  record.warpEditorInput.select();
}

function closeWarpDimensionEditor(record) {
  record.warpEditor.style.display = 'none';
  record.warpEditingAxis = null;
}

function submitWarpDimensionEditor(record) {
  if (!record.warpEditingAxis) return;
  const warp = normalizeWarpSettings(record.entity.warp || {}, record.entity);
  const fallback = record.warpEditingAxis === 'height' ? warp.targetHeight : warp.targetWidth;
  record.entity.warp = setWarpDimension(record.entity.warp, record.warpEditingAxis, parseWarpDimensionInput(record.warpEditorInput.value, fallback, record.getDrawingUnit()));
  closeWarpDimensionEditor(record);
  finishRecordChange(record);
}

function finishRecordChange(record) {
  record.updateRecord(record);
  record.finishChange(record);
}

export function createImageManipulation({ addSvg, parent, screenToWorld, getScale, getDrawingUnit = () => '', evaluateNumeric, onSelect, onMoveStart, onChange, onDelete }) {
  let drag = null;
  const toolbarVisualWidth = 160;
  const toolbarObjectWidth = 240;

  function updateRecord(record) {
    const entity = record.entity;
    const scale = getScale();
    const appearance = imageAppearance(entity, evaluateNumeric);
    record.group.setAttribute('transform', `translate(${entity.x} ${entity.y})`);
    record.transform.setAttribute('transform', `rotate(${entity.rotation}) scale(${entity.flipX ? -1 : 1} ${entity.flipY ? -1 : 1})`);
    record.image.setAttribute('x', -entity.width / 2);
    record.image.setAttribute('y', -entity.height / 2);
    record.image.setAttribute('width', entity.width);
    record.image.setAttribute('height', entity.height);
    record.image.setAttribute('href', entity.source);
    record.image.setAttribute('opacity', appearance.fillOpacity);
    [record.hitTarget, record.selectionFrame].forEach((node) => {
      node.setAttribute('x', -entity.width / 2);
      node.setAttribute('y', -entity.height / 2);
      node.setAttribute('width', entity.width);
      node.setAttribute('height', entity.height);
    });
    const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    const size = 10 / scale;
    record.cornerHandles.forEach((handle, index) => {
      handle.setAttribute('x', corners[index][0] * entity.width / 2 - size / 2);
      handle.setAttribute('y', corners[index][1] * entity.height / 2 - size / 2);
      handle.setAttribute('width', size);
      handle.setAttribute('height', size);
      handle.setAttribute('stroke-width', 1.5 / scale);
    });
    const rotationOffset = 28 / scale;
    record.rotationStem.setAttribute('y1', -entity.height / 2);
    record.rotationStem.setAttribute('y2', -entity.height / 2 - rotationOffset);
    record.rotationStem.setAttribute('stroke-width', 1.5 / scale);
    record.rotationHandle.setAttribute('cy', -entity.height / 2 - rotationOffset);
    record.rotationHandle.setAttribute('r', 6 / scale);
    record.rotationHandle.setAttribute('stroke-width', 1.5 / scale);
    const angle = entity.rotation * Math.PI / 180;
    const visualTop = (Math.abs(entity.width * Math.sin(angle)) + Math.abs(entity.height * Math.cos(angle))) / 2;
    record.toolbar.setAttribute('x', -toolbarVisualWidth / 2 / scale);
    record.toolbar.setAttribute('y', -visualTop - 68 / scale);
    record.toolbar.setAttribute('width', toolbarObjectWidth / scale);
    record.toolbar.setAttribute('height', 128 / scale);
    record.toolbarContent.style.transform = `scale(${1 / scale})`;
    record.toolbarContent.style.transformOrigin = '0 0';
    record.toolbarContent.style.width = `${toolbarVisualWidth}px`;
    record.toolbarContent.style.height = '34px';
    record.lockButton.title = entity.locked ? 'Unlock image' : 'Lock image';
    record.lockButton.setAttribute('aria-label', record.lockButton.title);
    record.lockButton.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${toolbarIcons[entity.locked ? 'lock' : 'unlock']}</svg>`;
    record.horizontalButton.disabled = entity.locked;
    record.verticalButton.disabled = entity.locked;
    record.resetButton.disabled = entity.locked;
    record.warpButton.disabled = entity.locked;
    record.warpButton.setAttribute('aria-pressed', String(Boolean(entity.warp?.enabled)));
    record.warpButton.classList.toggle('active', Boolean(entity.warp?.enabled));
    if (entity.locked) record.resetPanel.hidden = true;
    record.group.classList.toggle('locked', entity.locked);
    record.group.classList.toggle('construction', entity.construction);
    record.group.classList.toggle('expression-error', Boolean(appearance.error));
    record.currentScale = scale;
    updateWarpGuide(record);
  }

  function finishChange(record) {
    updateRecord(record);
    onChange(record);
  }

  function beginDrag(event, record, mode, cornerIndex = null) {
    if (mode === 'move' && onMoveStart?.(event, record)) return;
    event.preventDefault();
    event.stopPropagation();
    onSelect(record.id);
    if (record.entity.locked || event.button !== 0) return;
    const pointer = screenToWorld(event.clientX, event.clientY);
    drag = { mode, cornerIndex, record, startPointer: pointer, startEntity: clone(record.entity), moved: false };
    record.group.setPointerCapture(event.pointerId);
  }

  function pointerMove(event) {
    if (!drag) return false;
    const pointer = screenToWorld(event.clientX, event.clientY);
    const delta = subtract(pointer, drag.startPointer);
    if (Math.hypot(delta[0], delta[1]) > 0.001) drag.moved = true;
    if (drag.mode === 'move') {
      drag.record.entity = { ...drag.startEntity, x: drag.startEntity.x + delta[0], y: drag.startEntity.y + delta[1] };
    }
    if (drag.mode === 'scale') drag.record.entity = scaleImageFromCorner(drag.startEntity, drag.cornerIndex, pointer);
    if (drag.mode === 'rotate') drag.record.entity = rotateImageFromPointer(drag.startEntity, drag.startPointer, pointer);
    if (drag.mode === 'warp-corner') {
      drag.record.entity.warp = moveWarpGuideCorner(drag.startEntity.warp, drag.cornerIndex, worldToImageLocal(drag.startEntity, pointer));
    }
    updateRecord(drag.record);
    return true;
  }

  function pointerUp() {
    if (!drag) return false;
    const changed = drag.moved;
    const record = drag.record;
    drag = null;
    if (changed) onChange(record);
    return true;
  }

  function createRecord(input) {
    const entity = normalizeImageEntity(input);
    const group = addSvg(parent, 'g', { class: 'canvas-record image-record', 'data-record-id': entity.id, 'data-entity-type': 'image' });
    const transform = addSvg(group, 'g', { class: 'image-transform' });
    const image = addSvg(transform, 'image', { class: 'canvas-image', preserveAspectRatio: 'none' });
    const hitTarget = addSvg(transform, 'rect', { class: 'selectable-entity image-hit-target' });
    const selectionFrame = addSvg(transform, 'rect', { class: 'image-selection-frame' });
    const rotationStem = addSvg(transform, 'line', { x1: 0, x2: 0, class: 'image-rotation-stem' });
    const handleGroup = addSvg(transform, 'g', { class: 'image-handle-group' });
    const cornerHandles = [0, 1, 2, 3].map((index) => addSvg(handleGroup, 'rect', { class: 'image-scale-handle point-handle', 'data-corner-index': index }));
    const rotationHandle = addSvg(handleGroup, 'circle', { cx: 0, class: 'image-rotation-handle point-handle' });
    const warpGuide = createWarpGuide(addSvg, transform);
    const toolbar = addSvg(group, 'foreignObject', { class: 'image-context-toolbar' });
    const toolbarContent = document.createElementNS('http://www.w3.org/1999/xhtml', 'div');
    toolbarContent.className = 'image-context-toolbar-content canvas-overlay-button';
    const lockButton = toolbarButton('Lock image', 'unlock');
    const horizontalButton = toolbarButton('Flip horizontal', 'horizontal');
    const verticalButton = toolbarButton('Flip vertical', 'vertical');
    const resetButton = toolbarButton('Reset image transform', 'reset');
    const warpButton = toolbarButton('Warp Perspective', 'warp');
    warpButton.setAttribute('aria-pressed', 'false');
    const resetPanel = document.createElementNS('http://www.w3.org/1999/xhtml', 'div');
    resetPanel.className = 'image-reset-warning';
    resetPanel.hidden = true;
    resetPanel.innerHTML = `
      <p>Reset this image's size, rotation, and flips?</p>
      <div class="image-reset-actions">
        <button type="button" class="image-reset-confirm">Reset</button>
        <button type="button" class="image-reset-cancel">Cancel</button>
      </div>`;
    const resetConfirmButton = resetPanel.querySelector('.image-reset-confirm');
    const resetCancelButton = resetPanel.querySelector('.image-reset-cancel');
    toolbarContent.append(lockButton, horizontalButton, verticalButton, resetButton, warpButton, resetPanel);
    toolbar.appendChild(toolbarContent);
    const record = {
      id: entity.id,
      recordType: 'image',
      entity,
      group,
      transform,
      image,
      hitTarget,
      selectionFrame,
      handleGroup,
      handles: [...cornerHandles, rotationHandle, ...warpGuide.handles],
      cornerHandles,
      rotationHandle,
      rotationStem,
      toolbar,
      toolbarContent,
      lockButton,
      horizontalButton,
      verticalButton,
      resetButton,
      warpButton,
      resetPanel,
      updateRecord,
      finishChange,
      getDrawingUnit,
      ...warpGuide,
    };

    hitTarget.addEventListener('pointerdown', (event) => beginDrag(event, record, 'move'));
    cornerHandles.forEach((handle, index) => handle.addEventListener('pointerdown', (event) => beginDrag(event, record, 'scale', index)));
    rotationHandle.addEventListener('pointerdown', (event) => beginDrag(event, record, 'rotate'));
    record.warpHandles.forEach((handle, index) => handle.addEventListener('pointerdown', (event) => beginDrag(event, record, 'warp-corner', index)));
    group.addEventListener('click', (event) => { event.stopPropagation(); onSelect(record.id); });
    toolbarContent.addEventListener('pointerdown', (event) => event.stopPropagation());
    lockButton.addEventListener('click', (event) => {
      event.stopPropagation();
      record.entity.locked = !record.entity.locked;
      finishChange(record);
    });
    horizontalButton.addEventListener('click', (event) => {
      event.stopPropagation();
      if (record.entity.locked) return;
      record.entity = flipImageEntity(record.entity, 'horizontal');
      finishChange(record);
    });
    verticalButton.addEventListener('click', (event) => {
      event.stopPropagation();
      if (record.entity.locked) return;
      record.entity = flipImageEntity(record.entity, 'vertical');
      finishChange(record);
    });
    resetButton.addEventListener('click', (event) => {
      event.stopPropagation();
      if (record.entity.locked) return;
      resetPanel.hidden = !resetPanel.hidden;
    });
    resetCancelButton.addEventListener('click', (event) => {
      event.stopPropagation();
      resetPanel.hidden = true;
    });
    resetConfirmButton.addEventListener('click', (event) => {
      event.stopPropagation();
      if (record.entity.locked) return;
      record.entity = resetImageEntity(record.entity);
      resetPanel.hidden = true;
      finishChange(record);
    });
    warpButton.addEventListener('click', (event) => {
      event.stopPropagation();
      if (record.entity.locked) return;
      record.entity.warp = toggleWarpSettings(record.entity);
      if (record.entity.warp.enabled) record.entity.warp = enableWarpSettings(record.entity);
      finishChange(record);
    });
    record.warpTexts.forEach((text, index) => {
      text.addEventListener('dblclick', (event) => {
        event.preventDefault();
        event.stopPropagation();
        openWarpDimensionEditor(record, index);
      });
      text.addEventListener('click', (event) => event.stopPropagation());
    });
    record.warpApplyButton.addEventListener('click', async (event) => {
      event.stopPropagation();
      if (record.entity.locked) return;
      record.warpApplyButton.disabled = true;
      record.warpApplyButton.textContent = 'Warping...';
      try {
        record.entity = normalizeImageEntity(await warpImageEntity(record.entity));
        updateRecord(record);
        onChange(record);
      } catch (error) {
        record.warpStatus.textContent = error.message;
        record.warpApplyButton.disabled = false;
        record.warpApplyButton.textContent = 'Apply Warp';
      }
    });
    record.warpEditorInput.addEventListener('keydown', (event) => {
      event.stopPropagation();
      if (event.key === 'Enter') {
        event.preventDefault();
        submitWarpDimensionEditor(record);
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        closeWarpDimensionEditor(record);
      }
    });
    record.warpEditorOk.addEventListener('click', (event) => {
      event.stopPropagation();
      submitWarpDimensionEditor(record);
    });
    record.warpEditorCancel.addEventListener('click', (event) => {
      event.stopPropagation();
      closeWarpDimensionEditor(record);
    });
    updateRecord(record);
    return record;
  }

  function syncRecord(record, selected) {
    record.group.classList.toggle('selected', selected);
    record.toolbar.style.display = selected ? '' : 'none';
    if (!selected) record.resetPanel.hidden = true;
    record.handleGroup.style.display = selected && !record.entity.locked ? '' : 'none';
    record.rotationStem.style.display = selected && !record.entity.locked ? '' : 'none';
    record.warpGuide.style.display = selected && record.entity.warp?.enabled ? '' : 'none';
    updateRecord(record);
  }

  function setAppearance(record, patch) {
    const current = imageAppearance(record.entity, evaluateNumeric);
    const expression = patch.fillOpacityExpression ?? current.fillOpacityExpression;
    const appearance = { ...(record.entity.appearance || {}), fillOpacityExpression: String(expression), fillOpacity: current.fillOpacity };
    try { appearance.fillOpacity = resolveOpacityExpression(expression, evaluateNumeric); } catch { /* retain last valid opacity */ }
    record.entity.appearance = appearance;
    finishChange(record);
    return true;
  }

  return { createRecord, updateRecord, syncRecord, setAppearance, pointerMove, pointerUp, isDragging: () => Boolean(drag), deleteRecord: onDelete };
}
