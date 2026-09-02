import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  boundsAtAspect,
  handoffPrintOutput,
  normalizePrintSettings,
  printContentBoundsWithinWindow,
  printDialogMarkup,
  printOutputMarkup,
  printPageOptionLabel,
  printViewport,
  printWindowBoundsFromPoints,
  previewPageSize,
} from '../PrintDialog.js';
import { PRINT_PAGE_SIZES, printLayout } from '../PrintLayouts.js';

test('print layouts include every supplied ANSI, ARCH, and ISO paper size in both orientations', () => {
  assert.equal(PRINT_PAGE_SIZES.length, 19);
  assert.deepEqual(printLayout('letter', 'portrait'), {
    id: 'letter',
    orientation: 'portrait',
    label: 'Letter / ANSI A',
    mmWidth: 215.9,
    mmHeight: 279.4,
    inWidth: 8.5,
    inHeight: 11,
  });
  assert.deepEqual(printLayout('ansi-b', 'landscape'), {
    id: 'ansi-b',
    orientation: 'landscape',
    label: 'Ledger / ANSI B',
    mmWidth: 431.8,
    mmHeight: 279.4,
    inWidth: 17,
    inHeight: 11,
  });
  assert.equal(printLayout('iso-a0', 'portrait').mmWidth, 841);
  assert.equal(printLayout('arch-e', 'landscape').inWidth, 48);
});

test('print settings normalize unsupported values and keep the supported dimension views', () => {
  assert.deepEqual(normalizePrintSettings({
    pageSize: 'unknown',
    orientation: 'sideways',
    area: 'selection',
    scaleMode: 'random',
    scaleDenominator: 0,
    dimensionView: 'unknown',
    centerOnPage: false,
  }), {
    pageSize: 'letter',
    orientation: 'landscape',
    area: 'full',
    scaleMode: 'fit',
    scaleDenominator: 1,
    dimensionView: 'named-value',
    centerOnPage: false,
  });
  assert.equal(normalizePrintSettings({ dimensionView: 'expression' }).dimensionView, 'expression');
  assert.equal(normalizePrintSettings({ dimensionView: 'value' }).dimensionView, 'value');
  assert.equal(normalizePrintSettings({ area: 'display' }).area, 'display');
  assert.equal(normalizePrintSettings({ area: 'window' }).area, 'window');
});

test('fixed print scale converts physical printable paper millimeters into drawing-space millimeters', () => {
  const layout = printLayout('letter', 'landscape');
  const viewport = printViewport({
    layout,
    area: 'full',
    scaleMode: 'custom',
    scaleDenominator: 2,
    contentBounds: { x: 0, y: 0, width: 100, height: 50 },
  });

  assert.equal(viewport.width, (279.4 - 20) * 2);
  assert.equal(viewport.height, (215.9 - 20) * 2);
  assert.equal(viewport.x, (100 - viewport.width) / 2);
  assert.equal(viewport.y, (50 - viewport.height) / 2);
});

test('Window and Display preserve their exact viewport while optional centering moves only Window contents', () => {
  const windowBounds = { x: -30, y: 10, width: 160, height: 90 };
  const fitted = boundsAtAspect(windowBounds, 1);
  assert.deepEqual(fitted, { x: -30, y: -25, width: 160, height: 160 });

  const viewport = printViewport({
    layout: { mmWidth: 210, mmHeight: 297 },
    area: 'window',
    scaleMode: 'fit',
    contentBounds: { x: 0, y: 0, width: 20, height: 20 },
    windowBounds,
    windowContentBounds: { x: 10, y: 20, width: 40, height: 30 },
  });
  assert.equal(viewport.width, windowBounds.width);
  assert.equal(viewport.height, windowBounds.height);
  assert.ok(Math.abs((viewport.x + viewport.width / 2) - 30) < 1e-12);
  assert.ok(Math.abs((viewport.y + viewport.height / 2) - 35) < 1e-12);

  const uncenteredViewport = printViewport({
    layout: { mmWidth: 210, mmHeight: 297 },
    area: 'window',
    scaleMode: 'fit',
    centerOnPage: false,
    contentBounds: { x: 0, y: 0, width: 20, height: 20 },
    windowBounds,
    windowContentBounds: { x: 10, y: 20, width: 40, height: 30 },
  });
  assert.deepEqual(uncenteredViewport, windowBounds);

  const displayViewport = printViewport({
    layout: { mmWidth: 297, mmHeight: 210 },
    area: 'display',
    scaleMode: 'fit',
    contentBounds: { x: 0, y: 0, width: 20, height: 20 },
    displayBounds: { x: 10, y: 20, width: 277, height: 190 },
  });
  assert.deepEqual(displayViewport, { x: 10, y: 20, width: 277, height: 190 });
  assert.deepEqual(printViewport({
    layout: { mmWidth: 210, mmHeight: 297 },
    area: 'display',
    scaleMode: 'fit',
    contentBounds: { x: 0, y: 0, width: 20, height: 20 },
    displayBounds: { x: -50, y: -25, width: 300, height: 100 },
  }), { x: -50, y: -25, width: 300, height: 100 });
  assert.equal(printViewport({
    layout: { mmWidth: 297, mmHeight: 210 },
    area: 'window',
    contentBounds: { x: 0, y: 0, width: 20, height: 20 },
  }), null);
});

test('print modal exposes layout, three area choices, scale, the header-style Dimension View toggle, and a live preview', () => {
  const markup = printDialogMarkup();
  const landscapeMarkup = printDialogMarkup({ orientation: 'landscape' });
  assert.doesNotMatch(markup, /Printer|Destination|print-printer/);
  assert.match(markup, /class="print-page-size"/);
  assert.match(markup, /Letter \/ ANSI A — 11 × 8\.5 in \(279\.4 × 215\.9 mm\)/);
  assert.match(markup, /class="print-area"/);
  assert.match(markup, />Full</);
  assert.match(markup, />Display</);
  assert.match(markup, />Window</);
  assert.match(markup, /class="print-icon-button print-window-reselect"[^>]+ hidden/);
  assert.match(markup, /class="print-check-field print-center-field" hidden/);
  assert.doesNotMatch(
    printDialogMarkup({ area: 'window' }),
    /class="print-icon-button print-window-reselect"[^>]+ hidden/,
  );
  assert.doesNotMatch(
    printDialogMarkup({ area: 'window' }),
    /class="print-check-field print-center-field" hidden/,
  );
  assert.match(markup, /class="print-scale-mode"/);
  assert.match(markup, /<button[^>]+class="print-icon-button print-dimension-view"/);
  assert.match(markup, /aria-label="Dimension Text: Named Value"/);
  assert.match(markup, /id="printPreviewTitle">Print preview</);
  assert.match(markup, /aria-label="Portrait"/);
  assert.match(markup, /data-print-orientation="landscape" aria-label="Landscape" title="Landscape" aria-pressed="true"/);
  assert.match(markup, /aria-label="Print"/);
  assert.doesNotMatch(markup, /aria-label="Print"[^>]*>\s*Print\s*</);
  assert.match(markup, /class="print-field print-custom-scale" hidden/);
  assert.match(landscapeMarkup, /Ledger \/ ANSI B — 17 × 11 in \(431\.8 × 279\.4 mm\)/);
  assert.equal(
    printPageOptionLabel('iso-a3', 'portrait'),
    'ISO A3 — 11.69 × 16.54 in (297 × 420 mm)',
  );
});

test('print preview sizing contains the complete portrait or landscape page inside the stage', () => {
  const portrait = previewPageSize(printLayout('letter', 'portrait'), 600, 500);
  assert.ok(portrait.width <= 560);
  assert.ok(portrait.height <= 460);
  assert.ok(Math.abs(portrait.width / portrait.height - 215.9 / 279.4) < 1e-12);
  const landscape = previewPageSize(printLayout('letter', 'landscape'), 600, 500);
  assert.ok(landscape.width <= 560);
  assert.ok(landscape.height <= 460);
  assert.ok(Math.abs(landscape.width / landscape.height - 279.4 / 215.9) < 1e-12);
});

test('Window print area accepts drag or two-click corners with optional entity-point snapping', () => {
  assert.deepEqual(printWindowBoundsFromPoints([50, 70], [-10, 20]), {
    x: -10,
    y: 20,
    width: 60,
    height: 50,
  });
  assert.equal(printWindowBoundsFromPoints([0, 0], [0, 20]), null);
  assert.deepEqual(printContentBoundsWithinWindow([
    { x: -30, y: 10, width: 40, height: 40 },
    { x: 25, y: 25, width: 20, height: 10 },
    { x: 200, y: 200, width: 10, height: 10 },
  ], { x: 0, y: 0, width: 50, height: 50 }), {
    x: 0,
    y: 10,
    width: 45,
    height: 40,
  });
  const source = readFileSync(new URL('../PrintDialog.js', import.meta.url), 'utf8');
  assert.match(source, /print-window-selection-active/);
  assert.match(source, /getFeatureFromEvent/);
  assert.match(source, /getNearestSnapPoint/);
  assert.match(source, /clipPresentationToBounds/);
  assert.match(source, /getBoundingClientRect/);
  assert.match(source, /print-window-selection-box/);
  assert.match(source, /pointermove/);
  assert.match(source, /clickAnchor/);
  assert.match(source, /queueWindowSelection/);
  assert.match(source, /setTimeout\(begin, 0\)/);
  assert.match(source, /printWindowPhase = 'awaiting-first-corner'/);
  assert.match(source, /printWindowPhase = 'awaiting-second-corner'/);
  assert.doesNotMatch(source, /activationPoint|ignoreInitialHover/);
  assert.doesNotMatch(source, /print-window-selection-instruction|selectionOverlay/);
  assert.match(source, /if \(!hasOpened\)/);
  const styles = readFileSync(new URL('../styles/app.css', import.meta.url), 'utf8');
  assert.match(styles, /print-window-selection-active \.point-handle \{ opacity: 0 !important; pointer-events: all !important; \}/);
  assert.match(styles, /print-window-selection-active \.point-handle:hover/);
  assert.match(styles, /print-window-selection-active \.point-handle\.hovered \{ opacity: 1 !important; pointer-events: all !important; \}/);
  assert.match(styles, /inactive-stack-hit-test-blocked:not\(\.print-window-selection-active\)/);
});

test('Main Menu Print action opens the owned Print dialog and intercepts Ctrl+P', () => {
  const mainSource = readFileSync(new URL('../main.js', import.meta.url), 'utf8');
  assert.match(mainSource, /createPrintDialog\(\{/);
  assert.match(mainSource, /printButton[^\n]*addEventListener\('click'/);
  assert.match(mainSource, /if \(key === 'p'\)/);
});

test('Print hands a physical-size page to the system print dialog and cleans it up', () => {
  const layout = printLayout('iso-a3', 'landscape');
  assert.match(printOutputMarkup(layout), /@page \{ size: 420mm 297mm; margin: 0; \}/);
  let appended = null;
  let afterPrint = null;
  let printed = 0;
  let removed = 0;
  const output = { remove: () => { removed += 1; } };
  handoffPrintOutput(output, {
    documentRef: { body: { appendChild: (node) => { appended = node; } } },
    windowRef: {
      addEventListener: (name, listener, options) => { afterPrint = { name, listener, options }; },
      setTimeout: (callback, delay) => {
        assert.equal(delay, 1000);
        callback();
      },
    },
    print: () => { printed += 1; },
  });

  assert.equal(appended, output);
  assert.equal(printed, 1);
  assert.equal(removed, 1);
  assert.equal(afterPrint.name, 'afterprint');
  assert.deepEqual(afterPrint.options, { once: true });
});
