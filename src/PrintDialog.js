import {
  createCanvasPresentationSvg,
  fittedPresentationViewport,
} from '@paramagic/core/export';
import { dimensions } from '@paramagic/core/editor';
import { PRINT_PAGE_SIZES, printLayout } from './PrintLayouts.js';

const PRINT_MARGIN_MM = 10;
const ICONS = Object.freeze({
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  dimensionExpression: '<path d="M4 7h16M4 12h10M4 17h13"/><path d="M17 10l3 2-3 2"/>',
  dimensionNamedValue: '<path d="M4 8h6M4 16h6M13 8h7M13 16h7"/><path d="M10 12h4"/>',
  dimensionValue: '<path d="M5 7h14M5 12h14M5 17h14"/>',
  landscape: '<rect x="3.5" y="6" width="17" height="12"/><path d="M7 15h10"/>',
  portrait: '<rect x="6" y="3.5" width="12" height="17"/><path d="M9 17h6"/>',
  print: '<path d="M7 8V4h10v4"/><path d="M6 17H4v-7h16v7h-2"/><path d="M7 14h10v6H7z"/>',
  window: '<path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/><path d="M8 12h8M12 8v8"/>',
});

const icon = (name) => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`;

export const DEFAULT_PRINT_SETTINGS = Object.freeze({
  pageSize: 'letter',
  orientation: 'landscape',
  area: 'full',
  scaleMode: 'fit',
  scaleDenominator: 1,
  dimensionView: 'named-value',
  centerOnPage: true,
});

export function normalizePrintSettings(settings = {}) {
  const pageSize = PRINT_PAGE_SIZES.some(({ id }) => id === settings.pageSize)
    ? settings.pageSize
    : DEFAULT_PRINT_SETTINGS.pageSize;
  const scaleDenominator = Math.max(0.01, Number(settings.scaleDenominator) || 1);
  return {
    pageSize,
    orientation: ['portrait', 'landscape'].includes(settings.orientation)
      ? settings.orientation
      : DEFAULT_PRINT_SETTINGS.orientation,
    area: ['full', 'display', 'window'].includes(settings.area) ? settings.area : 'full',
    scaleMode: ['fit', 'actual', 'custom'].includes(settings.scaleMode) ? settings.scaleMode : 'fit',
    scaleDenominator,
    dimensionView: ['named-value', 'value', 'expression'].includes(settings.dimensionView)
      ? settings.dimensionView
      : DEFAULT_PRINT_SETTINGS.dimensionView,
    centerOnPage: settings.centerOnPage !== false,
  };
}

function positiveBounds(bounds) {
  const x = Number(bounds?.x);
  const y = Number(bounds?.y);
  const width = Number(bounds?.width);
  const height = Number(bounds?.height);
  if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return null;
  return { x, y, width, height };
}

export function boundsAtAspect(bounds, targetRatio) {
  const source = positiveBounds(bounds);
  if (!source) return null;
  const ratio = Math.max(0.0001, Number(targetRatio) || 1);
  let { width, height } = source;
  if (width / height > ratio) height = width / ratio;
  else width = height * ratio;
  return {
    x: source.x + (source.width - width) / 2,
    y: source.y + (source.height - height) / 2,
    width,
    height,
  };
}

export function printViewport({
  layout,
  area = 'full',
  scaleMode = 'fit',
  scaleDenominator = 1,
  centerOnPage = true,
  contentBounds,
  displayBounds,
  windowBounds,
  windowContentBounds,
  marginMm = PRINT_MARGIN_MM,
} = {}) {
  const printableWidth = Math.max(1, Number(layout?.mmWidth) - marginMm * 2);
  const printableHeight = Math.max(1, Number(layout?.mmHeight) - marginMm * 2);
  const areaBounds = area === 'display'
    ? displayBounds
    : area === 'window'
      ? windowBounds
      : contentBounds;
  const source = positiveBounds(areaBounds);
  if (!source) return null;
  const centeredSource = area === 'window'
    ? positiveBounds(windowContentBounds) || source
    : source;
  if (scaleMode === 'fit') {
    if (area === 'full') return fittedPresentationViewport(source, printableWidth, printableHeight);
    if (area === 'display' || !centerOnPage) return source;
    return {
      x: centeredSource.x + (centeredSource.width - source.width) / 2,
      y: centeredSource.y + (centeredSource.height - source.height) / 2,
      width: source.width,
      height: source.height,
    };
  }
  const denominator = scaleMode === 'actual'
    ? 1
    : Math.max(0.01, Number(scaleDenominator) || 1);
  const width = printableWidth * denominator;
  const height = printableHeight * denominator;
  const shouldCenter = area !== 'window' || centerOnPage;
  return {
    x: shouldCenter ? centeredSource.x + (centeredSource.width - width) / 2 : source.x,
    y: shouldCenter ? centeredSource.y + (centeredSource.height - height) / 2 : source.y,
    width,
    height,
  };
}

export function printWindowBoundsFromPoints(first, second) {
  const x1 = Number(first?.[0]);
  const y1 = Number(first?.[1]);
  const x2 = Number(second?.[0]);
  const y2 = Number(second?.[1]);
  if (![x1, y1, x2, y2].every(Number.isFinite)) return null;
  return positiveBounds({
    x: Math.min(x1, x2),
    y: Math.min(y1, y2),
    width: Math.abs(x2 - x1),
    height: Math.abs(y2 - y1),
  });
}

export function printContentBoundsWithinWindow(boundsList, windowBounds) {
  const window = positiveBounds(windowBounds);
  if (!window) return null;
  const right = window.x + window.width;
  const bottom = window.y + window.height;
  const matches = (boundsList || []).map(positiveBounds).filter(Boolean).flatMap((bounds) => {
    const left = Math.max(bounds.x, window.x);
    const top = Math.max(bounds.y, window.y);
    const matchRight = Math.min(bounds.x + bounds.width, right);
    const matchBottom = Math.min(bounds.y + bounds.height, bottom);
    return matchRight > left && matchBottom > top
      ? [{ x: left, y: top, width: matchRight - left, height: matchBottom - top }]
      : [];
  });
  if (!matches.length) return null;
  const left = Math.min(...matches.map((bounds) => bounds.x));
  const top = Math.min(...matches.map((bounds) => bounds.y));
  const matchRight = Math.max(...matches.map((bounds) => bounds.x + bounds.width));
  const matchBottom = Math.max(...matches.map((bounds) => bounds.y + bounds.height));
  return { x: left, y: top, width: matchRight - left, height: matchBottom - top };
}

export function printPageOptionLabel(pageSize, orientation = 'portrait') {
  const layout = printLayout(pageSize, orientation);
  return `${layout.label} — ${layout.inWidth} × ${layout.inHeight} in (${layout.mmWidth} × ${layout.mmHeight} mm)`;
}

function pageOptions(selected, orientation = 'portrait') {
  return PRINT_PAGE_SIZES.map(({ id }) => (
    `<option value="${id}"${id === selected ? ' selected' : ''}>${printPageOptionLabel(id, orientation)}</option>`
  )).join('');
}

const DIMENSION_VIEW_MODES = Object.freeze([
  { mode: 'named-value', label: 'Dimension Text: Named Value', shortLabel: 'Named Value', icon: 'dimensionNamedValue' },
  { mode: 'value', label: 'Dimension Text: Value Only', shortLabel: 'Value Only', icon: 'dimensionValue' },
  { mode: 'expression', label: 'Dimension Text: Expression', shortLabel: 'Expression', icon: 'dimensionExpression' },
]);

function dimensionViewMode(mode) {
  return DIMENSION_VIEW_MODES.find((candidate) => candidate.mode === mode) || DIMENSION_VIEW_MODES[0];
}

function dimensionViewButton(mode) {
  const selected = dimensionViewMode(mode);
  return `<button type="button" class="print-icon-button print-dimension-view" data-dimension-view="${selected.mode}" aria-label="${selected.label}" title="${selected.label}">${icon(selected.icon)}</button><output class="print-dimension-view-label">${selected.shortLabel}</output>`;
}

export function printDialogMarkup(settings = DEFAULT_PRINT_SETTINGS) {
  const normalized = normalizePrintSettings(settings);
  return `<div class="modal-backdrop print-modal-backdrop">
    <section class="modal print-modal" role="dialog" aria-modal="true" aria-labelledby="printModalTitle">
      <header class="print-modal-heading">
        <h2 id="printModalTitle">Print</h2>
        <button type="button" class="print-icon-button print-close" aria-label="Close" title="Close">${icon('close')}</button>
      </header>
      <div class="print-modal-content">
        <div class="print-settings" aria-label="Print settings">
          <fieldset class="print-settings-group">
            <legend>Layout</legend>
            <label class="print-field"><span>Paper size</span><select class="print-page-size">${pageOptions(normalized.pageSize, normalized.orientation)}</select></label>
            <div class="print-field"><span>Orientation</span><div class="print-orientation" role="group" aria-label="Page orientation">
              <button type="button" class="print-icon-button" data-print-orientation="portrait" aria-label="Portrait" title="Portrait" aria-pressed="${normalized.orientation === 'portrait'}">${icon('portrait')}</button>
              <button type="button" class="print-icon-button" data-print-orientation="landscape" aria-label="Landscape" title="Landscape" aria-pressed="${normalized.orientation === 'landscape'}">${icon('landscape')}</button>
            </div></div>
          </fieldset>
          <fieldset class="print-settings-group">
            <legend>Print area</legend>
            <div class="print-field"><span>Area</span><div class="print-area-control"><select class="print-area" aria-label="Print Area"><option value="full"${normalized.area === 'full' ? ' selected' : ''}>Full</option><option value="display"${normalized.area === 'display' ? ' selected' : ''}>Display</option><option value="window"${normalized.area === 'window' ? ' selected' : ''}>Window</option></select><button type="button" class="print-icon-button print-window-reselect" aria-label="Select print window" title="Select print window"${normalized.area === 'window' ? '' : ' hidden'}>${icon('window')}</button></div></div>
          </fieldset>
          <fieldset class="print-settings-group">
            <legend>Print scale</legend>
            <label class="print-field"><span>Scale</span><select class="print-scale-mode"><option value="fit"${normalized.scaleMode === 'fit' ? ' selected' : ''}>Fit to page</option><option value="actual"${normalized.scaleMode === 'actual' ? ' selected' : ''}>1:1</option><option value="custom"${normalized.scaleMode === 'custom' ? ' selected' : ''}>Custom</option></select></label>
            <label class="print-field print-custom-scale"${normalized.scaleMode === 'custom' ? '' : ' hidden'}><span>Ratio</span><span class="print-ratio-input"><b>1:</b><input type="number" min="0.01" step="0.01" value="${normalized.scaleDenominator}" aria-label="Custom print scale denominator" /></span></label>
            <label class="print-check-field print-center-field"${normalized.area === 'window' ? '' : ' hidden'}><input class="print-center" type="checkbox"${normalized.centerOnPage ? ' checked' : ''} /><span>Center on page</span></label>
          </fieldset>
          <fieldset class="print-settings-group">
            <legend>Options</legend>
            <div class="print-field"><span>Dimension view</span><div class="print-dimension-view-control">${dimensionViewButton(normalized.dimensionView)}</div></div>
          </fieldset>
        </div>
        <section class="print-preview-panel" aria-labelledby="printPreviewTitle">
          <div class="print-preview-heading"><h3 id="printPreviewTitle">Print preview</h3><output class="print-preview-scale"></output></div>
          <div class="print-preview-stage"><div class="print-preview-page"><div class="print-preview-content"></div></div></div>
          <p class="print-preview-status" role="status"></p>
        </section>
      </div>
      <footer class="print-modal-footer">
        <button type="button" class="print-icon-button print-confirm" aria-label="Print" title="Print">${icon('print')}</button>
      </footer>
    </section>
  </div>`;
}

export function printOutputMarkup(layout) {
  return `<style>@page { size: ${layout.mmWidth}mm ${layout.mmHeight}mm; margin: 0; }</style><section class="print-output-page"></section>`;
}

export function handoffPrintOutput(output, {
  documentRef = globalThis.document,
  windowRef = globalThis.window,
  print = () => windowRef?.print?.(),
} = {}) {
  documentRef.body.appendChild(output);
  const cleanup = () => output.remove();
  windowRef?.addEventListener?.('afterprint', cleanup, { once: true });
  print();
  windowRef?.setTimeout?.(cleanup, 1000);
}

export function previewPageSize(layout, containerWidth, containerHeight, inset = 20) {
  const availableWidth = Math.max(1, Number(containerWidth) - inset * 2);
  const availableHeight = Math.max(1, Number(containerHeight) - inset * 2);
  const scale = Math.min(
    availableWidth / Math.max(1, Number(layout?.mmWidth) || 1),
    availableHeight / Math.max(1, Number(layout?.mmHeight) || 1),
  );
  return {
    width: Math.max(1, Number(layout?.mmWidth) * scale),
    height: Math.max(1, Number(layout?.mmHeight) * scale),
    scale,
  };
}

function canvasDisplayBounds(canvas) {
  const element = canvas?.getCanvasElement?.();
  const rect = element?.getBoundingClientRect?.();
  if (!rect || rect.width <= 0 || rect.height <= 0) return null;
  const topLeft = canvas.screenToWorld?.(rect.left, rect.top);
  const bottomRight = canvas.screenToWorld?.(rect.right, rect.bottom);
  if (!topLeft || !bottomRight) return null;
  return positiveBounds({
    x: Math.min(topLeft[0], bottomRight[0]),
    y: Math.min(topLeft[1], bottomRight[1]),
    width: Math.abs(bottomRight[0] - topLeft[0]),
    height: Math.abs(bottomRight[1] - topLeft[1]),
  });
}

function contentBounds(svg) {
  try {
    return positiveBounds(svg?.querySelector?.('[data-canvas-presentation-content]')?.getBBox?.());
  } catch {
    return null;
  }
}

function canvasContentBoundsWithinWindow(canvas, windowBounds) {
  const window = positiveBounds(windowBounds);
  const canvasElement = canvas?.getCanvasElement?.();
  const objectLayer = canvas?.getObjectLayer?.();
  const canvasRect = canvasElement?.getBoundingClientRect?.();
  if (!window || !canvasRect || !objectLayer) return null;
  const topLeft = canvas.worldToScreen?.([window.x, window.y]);
  const bottomRight = canvas.worldToScreen?.([window.x + window.width, window.y + window.height]);
  if (!topLeft?.every(Number.isFinite) || !bottomRight?.every(Number.isFinite)) return null;
  const screenWindow = {
    x: canvasRect.left + Math.min(topLeft[0], bottomRight[0]),
    y: canvasRect.top + Math.min(topLeft[1], bottomRight[1]),
    width: Math.abs(bottomRight[0] - topLeft[0]),
    height: Math.abs(bottomRight[1] - topLeft[1]),
  };
  const screenBounds = printContentBoundsWithinWindow(
    [...objectLayer.children].flatMap((node) => {
      if (node.hidden || node.style?.display === 'none'
        || node.classList?.contains('stack-hidden') || node.classList?.contains('stack-disabled')) return [];
      try {
        return [node.getBoundingClientRect()];
      } catch {
        return [];
      }
    }),
    screenWindow,
  );
  if (!screenBounds) return null;
  const worldTopLeft = canvas.screenToWorld?.(screenBounds.x, screenBounds.y);
  const worldBottomRight = canvas.screenToWorld?.(
    screenBounds.x + screenBounds.width,
    screenBounds.y + screenBounds.height,
  );
  return printWindowBoundsFromPoints(worldTopLeft, worldBottomRight);
}

function clipPresentationToBounds(svg, sourceBounds, documentRef) {
  const bounds = positiveBounds(sourceBounds);
  const content = svg?.querySelector?.('[data-canvas-presentation-content]');
  if (!bounds || !content) return;
  const namespace = 'http://www.w3.org/2000/svg';
  let defs = svg.querySelector?.('defs');
  if (!defs) {
    defs = documentRef.createElementNS(namespace, 'defs');
    svg.prepend(defs);
  }
  const clipPath = documentRef.createElementNS(namespace, 'clipPath');
  const clipId = 'print-area-clip';
  clipPath.setAttribute('id', clipId);
  clipPath.setAttribute('clipPathUnits', 'userSpaceOnUse');
  const rect = documentRef.createElementNS(namespace, 'rect');
  rect.setAttribute('x', bounds.x);
  rect.setAttribute('y', bounds.y);
  rect.setAttribute('width', bounds.width);
  rect.setAttribute('height', bounds.height);
  clipPath.append(rect);
  defs.append(clipPath);
  content.setAttribute('clip-path', `url(#${clipId})`);
}

function applyPresentationViewport(svg, viewport, pixelWidth, pixelHeight) {
  svg.setAttribute('viewBox', `${viewport.x} ${viewport.y} ${viewport.width} ${viewport.height}`);
  svg.setAttribute('width', '100%');
  svg.setAttribute('height', '100%');
  const background = svg.querySelector?.('[data-canvas-presentation-background]');
  if (background) {
    background.setAttribute('x', viewport.x);
    background.setAttribute('y', viewport.y);
    background.setAttribute('width', viewport.width);
    background.setAttribute('height', viewport.height);
  }
  const content = svg.querySelector?.('[data-canvas-presentation-content]');
  const presentationScale = Math.max(0.0001, Math.min(pixelWidth / viewport.width, pixelHeight / viewport.height));
  dimensions.updateDimensionPresentationScale(content, presentationScale);
  return presentationScale;
}

export function createPrintDialog({
  canvas,
  getDrawingName = () => 'Untitled Drawing',
  getDimensionView = () => 'named-value',
  documentRef = globalThis.document,
  windowRef = globalThis.window,
  print = () => windowRef?.print?.(),
} = {}) {
  let settings = normalizePrintSettings({ dimensionView: getDimensionView() });
  let backdrop = null;
  let printableSvg = null;
  let keydownListener = null;
  let resizeListener = null;
  let selectionKeydownListener = null;
  let selectionCanvasElement = null;
  let selectionPointerDownListener = null;
  let selectionPointerMoveListener = null;
  let selectionPointerUpListener = null;
  let selectionPointerCancelListener = null;
  let selectionClickListener = null;
  let selectionHoverListener = null;
  let selectionWheelListener = null;
  let selectionBox = null;
  let selectionSnapHandle = null;
  let selectionStartTimer = null;
  let selectedWindowBounds = null;
  let hasOpened = false;

  function clearWindowSelection() {
    if (selectionStartTimer !== null) {
      windowRef?.clearTimeout?.(selectionStartTimer);
      selectionStartTimer = null;
    }
    if (selectionKeydownListener) {
      documentRef.removeEventListener('keydown', selectionKeydownListener, true);
      selectionKeydownListener = null;
    }
    if (selectionCanvasElement) {
      selectionCanvasElement.removeEventListener('pointerdown', selectionPointerDownListener, true);
      selectionCanvasElement.removeEventListener('click', selectionClickListener, true);
      selectionCanvasElement.removeEventListener('pointermove', selectionHoverListener);
      selectionCanvasElement.removeEventListener('wheel', selectionWheelListener);
      selectionCanvasElement.classList.remove('print-window-selection-active');
      delete selectionCanvasElement.dataset.printWindowPhase;
    }
    windowRef?.removeEventListener?.('pointermove', selectionPointerMoveListener, true);
    windowRef?.removeEventListener?.('pointerup', selectionPointerUpListener, true);
    windowRef?.removeEventListener?.('pointercancel', selectionPointerCancelListener, true);
    selectionBox?.remove();
    selectionSnapHandle?.remove();
    selectionCanvasElement = null;
    selectionPointerDownListener = null;
    selectionPointerMoveListener = null;
    selectionPointerUpListener = null;
    selectionPointerCancelListener = null;
    selectionClickListener = null;
    selectionHoverListener = null;
    selectionWheelListener = null;
    selectionBox = null;
    selectionSnapHandle = null;
  }

  function close() {
    if (!backdrop) return;
    clearWindowSelection();
    documentRef.removeEventListener('keydown', keydownListener);
    windowRef?.removeEventListener?.('resize', resizeListener);
    backdrop.remove();
    backdrop = null;
    printableSvg = null;
  }

  function readSettings() {
    settings = normalizePrintSettings({
      ...settings,
      pageSize: backdrop.querySelector('.print-page-size').value,
      orientation: backdrop.querySelector('[data-print-orientation][aria-pressed="true"]')?.dataset.printOrientation,
      area: backdrop.querySelector('.print-area').value,
      scaleMode: backdrop.querySelector('.print-scale-mode').value,
      scaleDenominator: backdrop.querySelector('.print-custom-scale input').value,
      dimensionView: backdrop.querySelector('.print-dimension-view').dataset.dimensionView,
      centerOnPage: backdrop.querySelector('.print-center').checked,
    });
    return settings;
  }

  function renderPreview() {
    if (!backdrop || backdrop.hidden) return;
    const next = readSettings();
    const layout = printLayout(next.pageSize, next.orientation);
    const paper = backdrop.querySelector('.print-preview-page');
    const host = backdrop.querySelector('.print-preview-content');
    const status = backdrop.querySelector('.print-preview-status');
    const scaleOutput = backdrop.querySelector('.print-preview-scale');
    const printButton = backdrop.querySelector('.print-confirm');
    const customScale = backdrop.querySelector('.print-custom-scale');
    customScale.hidden = next.scaleMode !== 'custom';
    backdrop.querySelector('.print-window-reselect').hidden = next.area !== 'window';
    backdrop.querySelector('.print-center-field').hidden = next.area !== 'window';
    [...backdrop.querySelector('.print-page-size').options].forEach((option) => {
      option.textContent = printPageOptionLabel(option.value, next.orientation);
    });
    paper.style.aspectRatio = `${layout.mmWidth} / ${layout.mmHeight}`;
    const stage = backdrop.querySelector('.print-preview-stage');
    const previewSize = previewPageSize(layout, stage.clientWidth, stage.clientHeight);
    paper.style.width = `${previewSize.width}px`;
    paper.style.height = `${previewSize.height}px`;
    paper.style.padding = `${PRINT_MARGIN_MM * previewSize.scale}px`;
    host.replaceChildren();
    printableSvg = null;
    const innerWidthMm = Math.max(1, layout.mmWidth - PRINT_MARGIN_MM * 2);
    const innerHeightMm = Math.max(1, layout.mmHeight - PRINT_MARGIN_MM * 2);
    const pixelWidth = 720;
    const pixelHeight = pixelWidth * innerHeightMm / innerWidthMm;
    const displayBounds = canvasDisplayBounds(canvas);
    const svg = createCanvasPresentationSvg({
      objectLayer: canvas?.getObjectLayer?.(),
      width: pixelWidth,
      height: pixelHeight,
      background: '#ffffff',
      dimensionTextMode: next.dimensionView,
      resolveDimensionText: (dimensionId, mode) => canvas?.getDimensionText?.(dimensionId, mode),
      documentRef,
    });
    if (svg) host.replaceChildren(svg);
    if (svg && next.area === 'display') {
      clipPresentationToBounds(svg, displayBounds, documentRef);
    } else if (svg && next.area === 'window') {
      clipPresentationToBounds(svg, selectedWindowBounds, documentRef);
    }
    const bounds = contentBounds(svg);
    const viewport = printViewport({
      layout,
      area: next.area,
      scaleMode: next.scaleMode,
      scaleDenominator: next.scaleDenominator,
      centerOnPage: next.centerOnPage,
      contentBounds: bounds,
      displayBounds,
      windowBounds: selectedWindowBounds,
      windowContentBounds: canvasContentBoundsWithinWindow(canvas, selectedWindowBounds),
    });
    if (!svg || !bounds || !viewport) {
      host.replaceChildren();
      status.textContent = next.area === 'window'
        ? 'Select a print window from the drawing.'
        : 'There are no visible drawing objects to print.';
      printButton.disabled = true;
      return;
    }
    applyPresentationViewport(svg, viewport, pixelWidth, pixelHeight);
    if (next.dimensionView === 'value') dimensions.applyValueOnlyExportDimensionAppearance(svg);
    svg.classList.add('print-preview-svg');
    svg.setAttribute('aria-label', `${getDrawingName()} print preview`);
    host.replaceChildren(svg);
    printableSvg = svg;
    const denominator = next.scaleMode === 'fit'
      ? Math.max(viewport.width / innerWidthMm, viewport.height / innerHeightMm)
      : next.scaleMode === 'actual' ? 1 : next.scaleDenominator;
    scaleOutput.textContent = `Scale 1:${Number(denominator.toFixed(3))}`;
    status.textContent = `${layout.label} · ${next.orientation === 'landscape' ? 'Landscape' : 'Portrait'}`;
    printButton.disabled = false;
  }

  function syncDimensionViewControl(mode) {
    const selected = dimensionViewMode(mode);
    const button = backdrop.querySelector('.print-dimension-view');
    button.dataset.dimensionView = selected.mode;
    button.title = selected.label;
    button.setAttribute('aria-label', selected.label);
    button.innerHTML = icon(selected.icon);
    backdrop.querySelector('.print-dimension-view-label').textContent = selected.shortLabel;
  }

  function queueWindowSelection(previousArea = settings.area) {
    if (!backdrop || selectionCanvasElement || selectionStartTimer !== null) return;
    const begin = () => {
      selectionStartTimer = null;
      if (backdrop) beginWindowSelection(previousArea);
    };
    if (typeof windowRef?.setTimeout === 'function') {
      selectionStartTimer = windowRef.setTimeout(begin, 0);
      return;
    }
    begin();
  }

  function beginWindowSelection(previousArea = settings.area) {
    if (!backdrop || selectionCanvasElement) return;
    const canvasElement = canvas?.getCanvasElement?.();
    const canvasRect = canvasElement?.getBoundingClientRect?.();
    if (!canvasRect || canvasRect.width <= 0 || canvasRect.height <= 0) return;
    settings = normalizePrintSettings({ ...settings, area: 'window' });
    backdrop.hidden = true;
    selectionCanvasElement = canvasElement;
    selectionCanvasElement.classList.add('print-window-selection-active');
    selectionCanvasElement.dataset.printWindowPhase = 'awaiting-first-corner';
    selectionBox = documentRef.createElement('div');
    selectionBox.className = 'print-window-selection-box';
    selectionBox.hidden = true;
    selectionSnapHandle = documentRef.createElement('div');
    selectionSnapHandle.className = 'print-window-snap-handle';
    selectionSnapHandle.hidden = true;
    selectionCanvasElement.append(selectionBox, selectionSnapHandle);
    let dragStart = null;
    let dragPointerId = null;
    let clickAnchor = null;
    let finishing = false;
    let hoverReady = false;

    const restoreModal = (area, bounds = null) => {
      clearWindowSelection();
      if (!backdrop) return;
      if (bounds) selectedWindowBounds = bounds;
      settings = normalizePrintSettings({ ...settings, area });
      backdrop.querySelector('.print-area').value = area;
      backdrop.hidden = false;
      renderPreview();
      (area === 'window'
        ? backdrop.querySelector('.print-window-reselect')
        : backdrop.querySelector('.print-area'))?.focus();
    };
    const cancelSelection = () => restoreModal(previousArea);
    const hideSnapHandle = () => { if (selectionSnapHandle) selectionSnapHandle.hidden = true; };
    const pointOnCanvas = (event, { showSnap = true } = {}) => {
      const rect = canvasElement.getBoundingClientRect();
      const clientX = Math.min(rect.right, Math.max(rect.left, Number(event.clientX) || 0));
      const clientY = Math.min(rect.bottom, Math.max(rect.top, Number(event.clientY) || 0));
      const withinCanvas = event.clientX >= rect.left && event.clientX <= rect.right
        && event.clientY >= rect.top && event.clientY <= rect.bottom;
      const renderedTarget = withinCanvas
        ? (event.target?.closest?.('.canvas-record, .canvas-handle-group, .array-group, .linked-copy-group')
          ? event.target
          : documentRef.elementsFromPoint?.(clientX, clientY)
            ?.find((node) => canvasElement.contains(node)) || canvasElement)
        : canvasElement;
      const raw = canvas.screenToWorld?.(clientX, clientY);
      const feature = withinCanvas ? canvas.getFeatureFromEvent?.({
        target: renderedTarget,
        clientX,
        clientY,
      }, { rendered: true, dimensionMode: 'driven' }) : null;
      const nativePoint = withinCanvas && [raw?.[0], raw?.[1]].every(Number.isFinite)
        ? canvas.getNearestSnapPoint?.(raw, 10)
        : null;
      const pointFeature = feature?.kind === 'point' ? feature : nativePoint;
      const snapped = Array.isArray(pointFeature?.point)
        && pointFeature.point.every(Number.isFinite)
        ? [...pointFeature.point]
        : null;
      const nativeHandleHovered = renderedTarget?.classList?.contains('point-handle');
      if (showSnap && snapped && !nativeHandleHovered) {
        const screen = canvas.worldToScreen?.(snapped);
        if (screen?.every(Number.isFinite)) {
          selectionSnapHandle.style.left = `${screen[0]}px`;
          selectionSnapHandle.style.top = `${screen[1]}px`;
          selectionSnapHandle.hidden = false;
        }
      } else if (showSnap) {
        hideSnapHandle();
      }
      return snapped || ([raw?.[0], raw?.[1]].every(Number.isFinite) ? raw : null);
    };
    const updateSelectionBox = (first, second) => {
      const firstScreen = canvas.worldToScreen?.(first);
      const secondScreen = canvas.worldToScreen?.(second);
      if (!firstScreen?.every(Number.isFinite) || !secondScreen?.every(Number.isFinite)) return null;
      const left = Math.min(firstScreen[0], secondScreen[0]);
      const top = Math.min(firstScreen[1], secondScreen[1]);
      const width = Math.abs(secondScreen[0] - firstScreen[0]);
      const height = Math.abs(secondScreen[1] - firstScreen[1]);
      Object.assign(selectionBox.style, {
        left: `${left}px`,
        top: `${top}px`,
        width: `${width}px`,
        height: `${height}px`,
      });
      selectionBox.hidden = width < 1 && height < 1;
      return { width, height };
    };
    const suppressSelectionEvent = (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    const resetDrag = () => {
      dragStart = null;
      dragPointerId = null;
      if (selectionBox) selectionBox.hidden = true;
    };
    const completeSelection = (event) => {
      const end = pointOnCanvas(event);
      const screenBounds = dragStart && end ? updateSelectionBox(dragStart, end) : null;
      const bounds = dragStart && end ? printWindowBoundsFromPoints(dragStart, end) : null;
      if (!bounds || !screenBounds || screenBounds.width < 4 || screenBounds.height < 4) {
        if (!clickAnchor && dragStart) {
          clickAnchor = [...dragStart];
          canvasElement.dataset.printWindowPhase = 'awaiting-second-corner';
        }
        resetDrag();
        return;
      }
      finishing = true;
      const complete = () => restoreModal('window', bounds);
      if (typeof windowRef?.setTimeout === 'function') windowRef.setTimeout(complete, 0);
      else complete();
    };
    selectionKeydownListener = (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopImmediatePropagation();
      cancelSelection();
    };
    documentRef.addEventListener('keydown', selectionKeydownListener, true);
    selectionPointerDownListener = (event) => {
      if (event.button !== 0 || finishing) return;
      hoverReady = true;
      hideSnapHandle();
      const point = pointOnCanvas(event);
      if (!point) return;
      dragStart = clickAnchor ? [...clickAnchor] : [...point];
      dragPointerId = event.pointerId;
      updateSelectionBox(dragStart, point);
      suppressSelectionEvent(event);
    };
    selectionPointerMoveListener = (event) => {
      if (dragStart === null || event.pointerId !== dragPointerId) return;
      const point = pointOnCanvas(event);
      if (point) updateSelectionBox(dragStart, point);
      event.preventDefault();
    };
    selectionPointerUpListener = (event) => {
      if (dragStart === null || event.pointerId !== dragPointerId) return;
      suppressSelectionEvent(event);
      completeSelection(event);
    };
    selectionPointerCancelListener = (event) => {
      if (dragStart === null || event.pointerId !== dragPointerId) return;
      suppressSelectionEvent(event);
      resetDrag();
    };
    selectionClickListener = (event) => {
      if (event.button === 0) suppressSelectionEvent(event);
    };
    selectionHoverListener = (event) => {
      if (dragStart !== null) return;
      if (!hoverReady) {
        hoverReady = true;
        hideSnapHandle();
        return;
      }
      const point = pointOnCanvas(event);
      if (clickAnchor && point) updateSelectionBox(clickAnchor, point);
    };
    selectionWheelListener = hideSnapHandle;
    selectionCanvasElement.addEventListener('pointerdown', selectionPointerDownListener, true);
    selectionCanvasElement.addEventListener('click', selectionClickListener, true);
    selectionCanvasElement.addEventListener('pointermove', selectionHoverListener);
    selectionCanvasElement.addEventListener('wheel', selectionWheelListener);
    windowRef?.addEventListener?.('pointermove', selectionPointerMoveListener, true);
    windowRef?.addEventListener?.('pointerup', selectionPointerUpListener, true);
    windowRef?.addEventListener?.('pointercancel', selectionPointerCancelListener, true);
  }

  function printCurrentPreview() {
    if (!printableSvg || !backdrop) return;
    readSettings();
    const layout = printLayout(settings.pageSize, settings.orientation);
    const output = documentRef.createElement('div');
    output.className = 'print-output-root';
    output.innerHTML = printOutputMarkup(layout);
    const page = output.querySelector('.print-output-page');
    page.setAttribute('aria-label', `${getDrawingName()} print output`);
    page.style.width = `${layout.mmWidth}mm`;
    page.style.height = `${layout.mmHeight}mm`;
    page.style.padding = `${PRINT_MARGIN_MM}mm`;
    const svg = printableSvg.cloneNode(true);
    svg.removeAttribute('aria-label');
    page.appendChild(svg);
    handoffPrintOutput(output, { documentRef, windowRef, print });
  }

  function bind() {
    backdrop.querySelector('.print-close').addEventListener('click', close);
    backdrop.addEventListener('pointerdown', (event) => { if (event.target === backdrop) close(); });
    backdrop.querySelector('.print-confirm').addEventListener('click', printCurrentPreview);
    backdrop.querySelectorAll('select:not(.print-area), input').forEach((control) => {
      control.addEventListener(control.type === 'number' ? 'input' : 'change', renderPreview);
    });
    const areaSelect = backdrop.querySelector('.print-area');
    areaSelect.addEventListener('change', () => {
      if (areaSelect.value === 'window') {
        queueWindowSelection(settings.area);
        return;
      }
      renderPreview();
    });
    backdrop.querySelector('.print-window-reselect').addEventListener('click', () => queueWindowSelection('window'));
    backdrop.querySelector('.print-dimension-view').addEventListener('click', (event) => {
      const current = DIMENSION_VIEW_MODES.findIndex(({ mode }) => mode === event.currentTarget.dataset.dimensionView);
      const next = DIMENSION_VIEW_MODES[(current + 1) % DIMENSION_VIEW_MODES.length];
      syncDimensionViewControl(next.mode);
      renderPreview();
    });
    backdrop.querySelectorAll('[data-print-orientation]').forEach((button) => {
      button.addEventListener('click', () => {
        backdrop.querySelectorAll('[data-print-orientation]').forEach((candidate) => {
          candidate.setAttribute('aria-pressed', String(candidate === button));
        });
        renderPreview();
      });
    });
    keydownListener = (event) => { if (event.key === 'Escape' && !selectionCanvasElement) close(); };
    documentRef.addEventListener('keydown', keydownListener);
    resizeListener = () => renderPreview();
    windowRef?.addEventListener?.('resize', resizeListener);
  }

  return {
    open() {
      if (backdrop) return backdrop;
      if (!hasOpened) {
        settings = normalizePrintSettings({ ...settings, dimensionView: getDimensionView() });
        hasOpened = true;
      }
      documentRef.body.insertAdjacentHTML('beforeend', printDialogMarkup(settings));
      backdrop = [...documentRef.querySelectorAll('.print-modal-backdrop')].at(-1);
      bind();
      renderPreview();
      backdrop.querySelector('.print-page-size').focus();
      return backdrop;
    },
    close,
    settings: () => ({ ...settings }),
  };
}
