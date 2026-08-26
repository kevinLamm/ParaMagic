import {
  ARRAY_TOOL_ICONS,
  DOCUMENT_VARIABLE_SPECS,
  DrawingHistory,
  DUPLICATE_ICON,
  OBJECT_VISIBILITY_ICON,
  SYMMETRIC_ICON,
  SWELL_ICON,
  arrayToolTypes,
  bindDeferredColorPicker,
  bindFloatingPanelBoundary,
  bindFloatingPanelDrag,
  bindResponsiveToolHeader,
  bindObjectVisibilityOverride,
  bindObjectVisibilityProperties,
  constraintGroups,
  createArrayTools,
  createBrowserAutosaveController,
  createClassTools,
  createControlTools,
  createDrawingClipboard,
  createDrawingFileController,
  createDrawingHint,
  createDrawingTools,
  createFilletTools,
  createImageCatalog,
  createImageEntityFromFile,
  createImageFillPropertyController,
  createImageStrokePropertyController,
  createIndexedDbBrowserFileStore,
  exportTextFileWithPicker,
  createInfiniteCanvas,
  createNotchTools,
  createParametersPanelController,
  createSmartDimensionTools,
  createStackPanel,
  createSwellTools,
  createSubtractTools,
  createLinkedCopyTools,
  createConstraintHandlers,
  dimensionTools,
  drawingTools,
  imageFillPropertiesMarkup,
  imageStrokePropertiesMarkup,
  catalogImageStrokeSizePatch,
  importPortableCatalogImage,
  installToolRepeatShortcut,
  objectVisibilityPropertiesMarkup,
  parameterTableBodyMarkup,
  parameterNameEditorMarkup,
  parametersPanelHeaderActionsMarkup,
  parsePortableDrawingText,
  positionHeaderToolMenu,
  rememberRepeatableTool,
  sampleEntities,
  serializePortableDrawingJson,
  serializePortablePackageJson,
} from '@paramagic/core/editor';
import {
  PARAMAGIC_DOCUMENT_EXTENSION,
  PARAMAGIC_DOCUMENT_MIME_TYPE,
  parseParamagicDocument,
  serializeDxf,
  serializeParamagicDocument,
} from '@paramagic/core/document';
import {
  createDrawingDxfSnapshot,
  createStackDxfSnapshot,
  createCanvasPresentationPng,
  prepareDxfExportGeometry,
  serializeCanvasPresentationSvg,
} from '@paramagic/core/export';
import {
  createSolverExecutionFacade,
  formatUnitlessValue,
  solverJacobianModeFromEnvironment,
  solverWorkerModeFromEnvironment,
} from '@paramagic/core/solver';
import { configureImageCatalogResources, configureOpenCvResources } from '@paramagic/core/images';
import { drawingBrowserTitle, imageCatalogResources, openCvResources } from './app-config.js';
import { toolIconAssetStyle } from './tool-icon-assets.js';

configureImageCatalogResources(imageCatalogResources);
configureOpenCvResources(openCvResources);

const iconPaths = {
  New: '<path d="M12 5v14M5 12h14"/>',
  Save: '<path d="M5 4h12l3 3v13H5z"/><path d="M8 4v6h8V4M8 20v-7h9v7"/>',
  Undo: '<path d="M9 7l-5 5 5 5"/><path d="M5 12h8a6 6 0 0 1 6 6"/>',
  Redo: '<path d="M15 7l5 5-5 5"/><path d="M19 12h-8a6 6 0 0 0-6 6"/>',
  Cut: '<circle cx="7" cy="17" r="3"/><circle cx="17" cy="17" r="3"/><path d="M9 15L18 4M15 15L6 4"/>',
  Copy: '<rect x="8" y="8" width="11" height="11"/><path d="M5 16V5h11"/>',
  Paste: '<path d="M9 5h6v3H9z"/><path d="M7 7H5v14h14V7h-2"/><path d="M9 12h6M9 16h6"/>',
  Open: '<path d="M4 8h6l2 2h8v8H4z"/><path d="M4 8v-2h6l2 2"/>',
  'Save As': '<path d="M5 4h12l3 3v13H5z"/><path d="M8 4v6h8V4M8 20v-7h9v7"/><path d="M18 11h4M20 9v4"/>',
  Import: '<path d="M12 4v11"/><path d="M8 8l4-4 4 4"/><path d="M5 19h14"/>',
  Insert: '<path d="M12 5v14M5 12h14"/><path d="M4 4h5M4 4v5M20 20h-5M20 20v-5"/>',
  'Duplicate Drawing': '<rect x="8" y="8" width="11" height="11"/><path d="M5 16V5h11"/>',
  Parameters: '<rect x="4" y="5" width="16" height="14" rx="1"/><path d="M4 10h16M4 15h16M10 5v14M16 5v14"/>',
  Export: '<path d="M12 4v11"/><path d="M8 11l4 4 4-4"/><path d="M5 19h14"/>',
  Print: '<path d="M7 8V4h10v4"/><path d="M6 17H4v-7h16v7h-2"/><path d="M7 14h10v6H7z"/>',
  'Zoom All': '<circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5L20 20"/><path d="M10.5 7v7M7 10.5h7"/>',
  'App Menu': '<path d="M5 7h14M5 12h14M5 17h14"/>',
  Select: '<path d="M6 4l10 8-5 1 3 6-3 1-3-6-4 3z"/>',
  Line: '<path d="M5 19L19 5"/>',
  Arc: '<path d="M6 16a8 8 0 0 1 12 0"/>',
  Fillet: '<path d="M5 19v-6a8 8 0 0 1 8-8h6"/><path d="M5 19h4M19 5v4"/>',
  Subtract: '<path d="M4 7h10v10H4z"/><circle cx="15" cy="12" r="5"/><path d="M12 8v8"/>',
  Duplicate: DUPLICATE_ICON,
  Symmetric: SYMMETRIC_ICON,
  Array: ARRAY_TOOL_ICONS.Array,
  'Rectangular Array': ARRAY_TOOL_ICONS['Rectangular Array'],
  'Circular Array': ARRAY_TOOL_ICONS['Circular Array'],
  Swell: SWELL_ICON,
  Notch: '<path d="M5 19L19 5"/><circle cx="12" cy="12" r="3" fill="#f28c18" stroke="#f28c18"/>',
  Polyline: '<path d="M4 17l5-8 5 4 6-7"/>',
  Polygon: '<path d="M12 4l7 5v8l-7 4-7-4V9z"/>',
  Circle: '<circle cx="12" cy="12" r="7"/>',
  Rectangle: '<rect x="5" y="7" width="14" height="10" rx="1"/>',
  'Curve / Spline': '<path d="M4 15c4-8 8 8 16-3"/>',
  Text: '<path d="M5 5h14M12 5v14M8 19h8"/>',
  Table: '<rect x="4" y="5" width="16" height="14"/><path d="M4 10h16M4 15h16M10 5v14M16 5v14"/>',
  'Insert Row Below': '<rect x="4" y="5" width="16" height="10"/><path d="M4 10h16M12 17v5M9 20h6"/>',
  'Insert Column After': '<rect x="4" y="5" width="10" height="14"/><path d="M9 5v14M17 12h5M20 9v6"/>',
  Merge: '<path d="M5 5h5v5H5zM14 5h5v5h-5zM5 14h5v5H5zM14 14h5v5h-5z"/><path d="M10 12h4M12 10v4"/>',
  Unmerge: '<path d="M5 5h5v5H5zM14 5h5v5h-5zM5 14h5v5H5zM14 14h5v5h-5z"/><path d="M10 12h4M12 10v4M12 12l4 4"/>',
  Construction: '<rect x="5" y="5" width="14" height="14" stroke-dasharray="3 2"/><circle cx="5" cy="5" r="1.5" fill="currentColor" stroke="none"/><circle cx="19" cy="5" r="1.5" fill="currentColor" stroke="none"/><circle cx="19" cy="19" r="1.5" fill="currentColor" stroke="none"/><circle cx="5" cy="19" r="1.5" fill="currentColor" stroke="none"/>',
  'Insert Image': '<rect x="4" y="5" width="16" height="14"/><circle cx="9" cy="10" r="2"/><path d="M5 17l5-5 3 3 2-2 4 4"/>',
  'Drawing Properties': '<path d="M6 4h9l3 3v13H6z"/><path d="M15 4v4h4M9 12h6M9 16h6"/><circle cx="8" cy="12" r="1"/><circle cx="16" cy="16" r="1"/>',
  'Auto Constrain': '<g><path d="M5 6v8a7 7 0 0 0 14 0V6h-4v8a3 3 0 0 1-6 0V6z"/><path d="M5 9h4M15 9h4M4 3v-2M9 3l1.5-1.5M15 3l-1.5-1.5M20 3v-2"/></g>',
  'Object Snap': '<g><path d="M10 8l5-5a4 4 0 0 1 6 6l-5 5-3-3 5-5a.75.75 0 0 0-1-1l-5 5z"/><path d="M14 16l-5 5a4 4 0 0 1-6-6l5-5 3 3-5 5a.75.75 0 0 0 1 1l5-5z"/><path d="M5 9H2M9 5V2M19 15h3M15 19v3"/></g>',
  Properties: '<path d="M5 7h14M5 12h14M5 17h14"/><circle cx="9" cy="7" r="2"/><circle cx="15" cy="12" r="2"/><circle cx="11" cy="17" r="2"/>',
  'Show Hidden Objects': OBJECT_VISIBILITY_ICON,
  Stacks: '<path d="M4 7l8-4 8 4-8 4zM4 12l8 4 8-4M4 17l8 4 8-4"/>',
  'Class Properties': '<path d="M5 5h14v14H5z"/><path d="M8 9h8M8 13h5"/><circle cx="16" cy="16" r="3"/>',
  'Select All Class': '<path d="M5 3l12 10-6 1 3 6-2.5 1-3-6-3.5 4z"/><path d="M15 4h5v5M20 15v5h-5"/>',
  Controls: '<rect x="5" y="5" width="14" height="14" rx="1"/><path d="M8 9h8M8 13h8"/><circle cx="11" cy="9" r="1.5" fill="currentColor"/><circle cx="15" cy="13" r="1.5" fill="currentColor"/>',
  'Horizontal Slider': '<rect x="4" y="8" width="16" height="8" rx="1"/><path d="M8 8v8M16 8v8"/><circle cx="12" cy="12" r="2.5" fill="currentColor"/>',
  'Vertical Slider': '<rect x="8" y="4" width="8" height="16" rx="1"/><path d="M8 8h8M8 16h8"/><circle cx="12" cy="12" r="2.5" fill="currentColor"/>',
  Checkbox: '<rect x="5" y="5" width="14" height="14" rx="1"/><path d="m8 12 3 3 5-6"/>',
  Options: '<circle cx="8" cy="8" r="2"/><circle cx="8" cy="12" r="2"/><circle cx="8" cy="16" r="2"/><path d="M13 8h6M13 12h6M13 16h6"/>',
  Dropdown: '<rect x="4" y="6" width="16" height="12" rx="1"/><path d="m9 11 3 3 3-3"/>',
  Constraints: '<circle cx="8" cy="12" r="4"/><circle cx="16" cy="12" r="4"/><path d="M10 12h4"/>',
  Coincident: '<path d="M4 18l8-8 8 8"/><circle cx="12" cy="10" r="2" fill="currentColor"/>',
  Concentric: '<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="3"/>',
  Collinear: '<path d="M4 12h16"/><circle cx="8" cy="12" r="2"/><circle cx="16" cy="12" r="2"/>',
  Midpoint: '<path d="M5 12h14"/><path d="M12 7l4 5-4 5-4-5z"/>',
  Fixed: '<rect x="5" y="10" width="14" height="10" rx="1"/><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v2"/>',
  Length: '<path d="M5 8h14M5 16h14"/><path d="M8 5v6M16 13v6"/>',
  Parallel: '<path d="M8 5v14M16 5v14"/>',
  Perpendicular: '<path d="M7 5v12h12"/>',
  Horizontal: '<path d="M5 12h14"/>',
  Vertical: '<path d="M12 5v14"/>',
  Equal: '<path d="M6 9h12M6 15h12"/>',
  Tangent: '<circle cx="9" cy="14" r="5"/><path d="M8 6l12 12"/>',
  'Point-on': '<path d="M5 16l14-8"/><circle cx="12" cy="12" r="2.5"/>',
  'Smart Driving Dimension': '<g><path d="M5 19L19 5"/><path d="M5 19l1.7-5.2 3.5 3.5zM19 5l-1.7 5.2-3.5-3.5z" fill="currentColor"/></g>',
  'Smart Driven Dimension': '<g><path d="M5 19L19 5"/><path d="M5 19l1.7-5.2 3.5 3.5zM19 5l-1.7 5.2-3.5-3.5z" fill="currentColor"/></g>',
  'Dimension Text: Expression': '<path d="M4 7h16M4 12h10M4 17h13"/><path d="M17 10l3 2-3 2"/>',
  'Dimension Text: Named Value': '<path d="M4 8h6M4 16h6M13 8h7M13 16h7"/><path d="M10 12h4"/>',
  'Dimension Text: Value Only': '<path d="M5 7h14M5 12h14M5 17h14"/>',
  DXF: '<path d="M5 6h6a6 6 0 0 1 0 12H5z"/><path d="M15 7l5 10M20 7l-5 10"/>',
  PNG: '<path d="M5 4h10l4 4v12H5zM15 4v5h5"/><circle cx="10" cy="12" r="1.5"/><path d="M7 17l3-3 2 2 2-3 3 4"/>',
  SVG: '<path d="M5 4h10l4 4v12H5zM15 4v5h5"/><path d="M8 13l2-2m-2 2 2 2M16 13l-2-2m2 2-2 2M13 10l-2 6"/>',
  JSON: '<path d="M9 6H7a3 3 0 0 0 0 6 3 3 0 0 1 0 6h2M15 6h2a3 3 0 0 1 0 6 3 3 0 0 0 0 6h-2"/>',
};

const iconAssets = {
  Arc: new URL('./assets/Arc.svg', import.meta.url).href,
  Fillet: new URL('./assets/Fillet.svg', import.meta.url).href,
  'Curve / Spline': new URL('./assets/Curve.svg', import.meta.url).href,
  'Auto Constrain': new URL('./assets/Auto-Constrain.svg', import.meta.url).href,
  'Object Snap': new URL('./assets/object-snap.svg', import.meta.url).href,
};

const icon = (label) => iconAssets[label]
  ? `<span class="tool-icon tool-icon-asset" aria-hidden="true" style="${toolIconAssetStyle(iconAssets[label])}"></span>`
  : `<span class="tool-icon" aria-hidden="true"><svg viewBox="0 0 24 24" focusable="false">${iconPaths[label] || '<circle cx="12" cy="12" r="5"/>'}</svg></span>`;
const iconButton = (label, attrs = '') => `<button class="icon-button" title="${label}" aria-label="${label}" ${attrs}>${icon(label)}</button>`;
const appMenuButton = (label, attrs = '') => `<button class="app-menu-item" type="button" ${attrs}>${icon(label)}<span>${label}</span></button>`;
const drawingName = (name) => String(name ?? '').replace(/\.(?:paramagic|json|dxf|svg|png)$/i, '');
const app = document.getElementById('root');
installToolRepeatShortcut(document);

app.innerHTML = `
  <div class="app-shell">
    <header class="app-header" id="appHeader" aria-label="Drawing tools">
      <section class="app-menu-shell" aria-label="Drawing file controls">
        ${iconButton('App Menu', 'id="appMenuToggle" aria-controls="appMenu" aria-expanded="false"')}
        <nav class="app-menu-popover export-dropdown" id="appMenu" aria-label="File actions" hidden>
          ${appMenuButton('New', 'id="newButton"')}
          ${appMenuButton('Open', 'id="openButton"')}
          ${appMenuButton('Save', 'id="saveButton" data-requires-drawing')}
          ${appMenuButton('Save As', 'id="saveAsButton" data-requires-drawing disabled')}
          ${appMenuButton('Import', 'id="importButton"')}
          ${appMenuButton('Insert', 'id="insertButton" data-requires-drawing disabled')}
          ${appMenuButton('Duplicate Drawing')}
          ${appMenuButton('Insert Image', 'id="insertImageButton"')}
          ${appMenuButton('Drawing Properties', 'id="drawingPropertiesButton"')}
          <div class="app-menu-separator" aria-hidden="true"></div>
          ${appMenuButton('Export', 'id="exportButton" data-app-export-toggle aria-controls="appMenuExportOptions" aria-expanded="false" data-requires-drawing disabled')}
          <div class="app-menu-export-options" id="appMenuExportOptions" hidden>
            ${appMenuButton('DXF', 'data-export-format="dxf" data-requires-drawing disabled')}
            ${appMenuButton('SVG', 'data-export-format="svg" data-requires-drawing disabled')}
            ${appMenuButton('PNG', 'data-export-format="png" data-requires-drawing disabled')}
            ${appMenuButton('JSON', 'data-export-format="json" data-requires-drawing disabled')}
          </div>
          ${appMenuButton('Print', 'id="printButton" data-requires-drawing disabled')}
        </nav>
      </section>
      <div class="unified-toolbar" aria-label="Drawing toolbar">${drawingToolbar()}</div>
      <div class="app-header-vertical-rail" id="appHeaderVerticalRail" aria-label="Vertical drawing tools" hidden></div>
    </header>
    <main class="canvas" id="canvas" data-canvas="true">
      <div class="grid" id="grid" data-canvas="true"></div>
      <svg class="drawing-plane" id="drawingPlane" data-canvas="true"></svg>
      <div class="canvas-brand-stamp" aria-hidden="true">ParaMagic</div>
      <div class="solver-status" id="solverStatus" role="status" hidden></div>
    </main>
    <input type="file" id="openParamagicFileInput" accept=".paramagic,application/vnd.paramagic+json,application/json" hidden />
    <input type="file" id="insertParamagicFileInput" accept=".paramagic,application/vnd.paramagic+json,application/json" hidden />
    <input type="file" id="importFileInput" accept=".json,.dxf,application/json,application/dxf" hidden />
    <input type="file" id="imageFileInput" accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml" hidden />
    ${propertiesPanel()}
  </div>`;

const appHeader = document.getElementById('appHeader');
const appHeaderVerticalRail = document.getElementById('appHeaderVerticalRail');
const appMenuShell = document.querySelector('.app-menu-shell');
const appMenuToggle = document.getElementById('appMenuToggle');
const appMenu = document.getElementById('appMenu');
const appMenuExportToggle = document.getElementById('exportButton');
const appMenuExportOptions = document.getElementById('appMenuExportOptions');
let browserAutosaveController = null;
let currentDrawingFileHandle = null;
bindResponsiveToolHeader(appHeader, {
  rail: appHeaderVerticalRail,
});
bindFloatingPanelBoundary(appHeader, { rightRail: appHeaderVerticalRail });

function setAppMenuOpen(open) {
  appMenu.hidden = !open;
  appMenuToggle.setAttribute('aria-expanded', String(open));
  appMenuToggle.classList.toggle('active', open);
  if (!open) {
    appMenuExportOptions.hidden = true;
    appMenuExportToggle.setAttribute('aria-expanded', 'false');
  }
}

appMenuToggle.addEventListener('click', () => setAppMenuOpen(appMenu.hidden));
appMenu.addEventListener('click', (event) => {
  const button = event.target.closest('button:not(:disabled)');
  if (!button) return;
  if (button === appMenuExportToggle) {
    appMenuExportOptions.hidden = !appMenuExportOptions.hidden;
    appMenuExportToggle.setAttribute('aria-expanded', String(!appMenuExportOptions.hidden));
    return;
  }
  setAppMenuOpen(false);
});
document.addEventListener('pointerdown', (event) => {
  if (!appMenu.hidden && !appMenuShell.contains(event.target)) setAppMenuOpen(false);
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !appMenu.hidden) setAppMenuOpen(false);
});

let activeDrawingName = 'Untitled Drawing';
const currentDrawingName = () => activeDrawingName;
const constraintTool = document.querySelector('.constraint-tool');
const constraintMenu = constraintTool.querySelector('.constraint-menu');
const edgeTool = document.querySelector('.edge-tool');
const edgeToolToggle = edgeTool.querySelector('.menu-toggle');
const edgeToolMenu = edgeTool.querySelector('.edge-tool-menu');
const textTableTool = document.querySelector('.text-table-tool');
const textTableToggle = textTableTool?.querySelector('[data-text-table-toggle]');
const textTableMenu = textTableTool?.querySelector('[data-text-table-menu]');
document.body.appendChild(constraintMenu);
document.body.appendChild(edgeToolMenu);
if (textTableMenu) document.body.appendChild(textTableMenu);
let textTableMenuCloseTimer = null;
function setSelectedTextTableTool(selected) {
  if (!textTableToggle || !textTableMenu) return;
  textTableToggle.innerHTML = icon(selected);
  textTableToggle.title = selected;
  textTableToggle.setAttribute('aria-label', selected);
  textTableToggle.dataset.selectedDrawingTool = selected;
  textTableMenu.querySelectorAll('[data-drawing-tool]').forEach((candidate) => {
    const stored = candidate.dataset.drawingTool === selected;
    candidate.classList.toggle('stored-constraint', stored);
    if (stored) candidate.setAttribute('aria-current', 'true');
    else candidate.removeAttribute('aria-current');
  });
}
setSelectedTextTableTool(textTableToggle?.dataset.selectedDrawingTool || 'Text');

function showTextTableMenu() {
  if (!textTableToggle || !textTableMenu) return;
  clearTimeout(textTableMenuCloseTimer);
  textTableTool.classList.add('open');
  textTableMenu.classList.add('open');
  positionHeaderToolMenu(textTableToggle, textTableMenu);
  textTableToggle.setAttribute('aria-expanded', 'true');
}
function hideTextTableMenu() {
  if (!textTableToggle || !textTableMenu) return;
  textTableTool.classList.remove('open');
  textTableMenu.classList.remove('open');
  textTableToggle.setAttribute('aria-expanded', 'false');
}
function scheduleTextTableMenuClose() {
  clearTimeout(textTableMenuCloseTimer);
  textTableMenuCloseTimer = setTimeout(hideTextTableMenu, 120);
}
textTableToggle?.addEventListener('pointerenter', showTextTableMenu);
textTableToggle?.addEventListener('pointerleave', scheduleTextTableMenuClose);
textTableToggle?.addEventListener('keydown', (event) => {
  const openKey = textTableToggle.closest('.header-section-vertical') ? 'ArrowLeft' : 'ArrowDown';
  if (event.key !== openKey) return;
  event.preventDefault();
  showTextTableMenu();
  textTableMenu.querySelector('button')?.focus();
});
textTableToggle?.addEventListener('click', () => {
  const selected = textTableToggle.dataset.selectedDrawingTool || 'Text';
  textTableMenu?.querySelector(`[data-drawing-tool="${selected}"]`)?.click();
});
textTableMenu?.addEventListener('pointerenter', () => clearTimeout(textTableMenuCloseTimer));
textTableMenu?.addEventListener('pointerleave', scheduleTextTableMenuClose);
textTableMenu?.querySelectorAll('[data-drawing-tool]')?.forEach((button) => button.addEventListener('click', (event) => {
  setSelectedTextTableTool(event.currentTarget.dataset.drawingTool);
  hideTextTableMenu();
}));
let constraintController = null;

function updateDrawingActionState() {
  const hasName = currentDrawingName().length > 0;
  const hasObjects = canvasController.getObjectCount() > 0;
  const shouldEnable = hasName || hasObjects;
  document.querySelectorAll('[data-requires-drawing]').forEach((button) => {
    button.disabled = !shouldEnable;
  });
  document.querySelector('.export-dropdown')?.classList.toggle('disabled', !shouldEnable);
}

function panel(body, attrs = '') {
  const attributes = attrs.includes('class=') ? attrs : `class="floating-panel" ${attrs}`;
  return `<section ${attributes}>${body}</section>`;
}

function drawingToolbar() {
  const tools = drawingTools
    .filter((label) => label !== 'Select')
    .map((label) => label === 'Notch'
      ? `<div class="menu-tool edge-tool">
        <button class="icon-button menu-toggle" title="Notch" aria-label="Notch" aria-expanded="false" aria-pressed="false" data-selected-edge-tool="Notch">${icon('Notch')}</button>
        <div class="constraint-menu edge-tool-menu">
          ${iconButton('Notch', 'data-edge-tool="Notch" aria-current="true"')}
        </div>
      </div>`
      : label === 'Fillet'
      ? iconButton(label, 'data-fillet-tool aria-pressed="false"')
      : label === 'Subtract'
      ? `<span class="toolbar-divider tool-section-divider" aria-hidden="true"></span>${iconButton(label, 'data-subtract-tool aria-pressed="false" disabled')}`
      : label === 'Duplicate'
        ? iconButton(label, 'data-duplicate-tool aria-pressed="false"')
      : label === 'Symmetric'
        ? iconButton(label, 'data-symmetric-tool aria-pressed="false"')
      : label === 'Array'
        ? `<div class="menu-tool array-tool">
          <button class="icon-button menu-toggle" title="Array" aria-label="Array" aria-expanded="false" aria-pressed="false" data-array-toggle data-selected-array="Rectangular Array">${icon('Array')}</button>
          <div class="constraint-menu array-tool-menu" data-array-menu>
            ${arrayToolTypes.map((item, index) => iconButton(item, `data-array-tool="${item}"${index === 0 ? ' aria-current="true"' : ''}`)).join('')}
          </div>
        </div>`
        : label === 'Text'
          ? `<div class="menu-tool text-table-tool">
          <button class="icon-button menu-toggle" title="Text" aria-label="Text and Table" aria-expanded="false" aria-pressed="false" data-text-table-toggle>${icon('Text')}</button>
          <div class="constraint-menu text-table-tool-menu" data-text-table-menu>
            ${iconButton('Text', 'data-drawing-tool="Text" aria-current="true" aria-pressed="false"')}
            ${iconButton('Table', 'data-drawing-tool="Table" aria-pressed="false"')}
          </div>
        </div>`
        : label === 'Table'
          ? ''
        : label === 'Swell'
          ? iconButton(label, 'data-swell-tool aria-pressed="false"')
        : iconButton(label, `data-drawing-tool="${label}" aria-pressed="false"`))
    .join('');
  return `<div class="toolbar-section app-view-tools">${iconButton('Zoom All', 'id="resetView"')}<span class="toolbar-divider"></span>${iconButton('Parameters', 'id="parametersButton"')}${controlToolbar()}${iconButton('Stacks', 'id="stacksToggle" data-preserve-feature-selection aria-controls="stackPanel" aria-pressed="false"')}${iconButton('Show Hidden Objects', 'id="visibilityOverrideToggle" data-preserve-feature-selection aria-pressed="false"')}${iconButton('Dimension Text: Named Value', 'id="dimensionTextMode" data-dimension-text-mode="named-value"')}<span class="toolbar-divider"></span>${classToolbar()}</div><div class="toolbar-section history-tools">${iconButton('Undo', 'id="undoButton" disabled')}${iconButton('Redo', 'id="redoButton" disabled')}${iconButton('Cut', 'id="cutButton" data-preserve-feature-selection')}${iconButton('Copy', 'id="copyButton" data-preserve-feature-selection')}${iconButton('Paste', 'id="pasteButton"')}</div><div class="toolbar-section drawing-tools">${iconButton('Construction', 'data-toggle-button aria-pressed="false"')}${tools}</div><div class="toolbar-section drawing-aids">${constraintToolbar()}${dimensionToolbar({ includeText: false })}<span class="toolbar-divider"></span>${iconButton('Properties', 'id="propertiesToggle" data-preserve-feature-selection aria-controls="propertiesPanel" aria-pressed="false"')}${iconButton('Auto Constrain', 'data-drawing-aid="auto-constrain" aria-pressed="true"')}${iconButton('Object Snap', 'data-drawing-aid="object-snap" aria-pressed="true"')}</div>`;
}

function classToolbar() {
  return `<div class="toolbar-section class-toolbar" aria-label="Classes">
    ${iconButton('Class Properties', 'id="classPropertiesButton" data-preserve-feature-selection aria-pressed="false"')}
    <label class="sr-only" for="activeClassSelect">Active Class</label>
    <select id="activeClassSelect" class="active-class-select" data-preserve-feature-selection aria-label="Active Class"><option value="class-x">X</option></select>
    ${iconButton('Select All Class', 'id="selectAllClassButton" data-preserve-feature-selection')}
  </div>`;
}

function constraintToolbar() {
  const constraints = constraintGroups.flatMap((group) => group.items)
    .filter((item) => item !== 'Midpoint' && !item.startsWith('Point-on'));
  const fixedIndex = constraints.indexOf('Fixed');
  if (fixedIndex >= 0) constraints.splice(fixedIndex, 1, 'Point-on');
  constraints.push('Fixed');
  return `<div class="menu-tool constraint-tool">
    <button class="icon-button menu-toggle" title="Coincident" aria-label="Coincident constraint" aria-expanded="false" aria-pressed="false" data-selected-constraint="Coincident">${icon('Coincident')}</button>
    <div class="constraint-menu">${constraints.map((item) => iconButton(item, `data-constraint="${item}" ${item === 'Coincident' ? 'aria-current="true"' : ''}`)).join('')}</div>
  </div>`;
}

function dimensionToolbar({ includeText = true } = {}) {
  return `<div class="toolbar-section dimension-toggles">${dimensionTools.map((tool) => iconButton(tool.label, `data-dimension-tool="${tool.label}" aria-pressed="false"`)).join('')}${includeText ? iconButton('Dimension Text: Named Value', 'id="dimensionTextMode" data-dimension-text-mode="named-value"') : ''}</div>`;
}

function controlToolbar() {
  return iconButton('Controls', 'id="controlsToggle" data-controls-toggle data-preserve-feature-selection aria-controls="controlsPanel" aria-pressed="false"');
}

function propertiesPanel() {
  return panel(`<div class="properties-panel-header"><h2>Properties</h2><button type="button" class="panel-close-button properties-panel-close" id="propertiesPanelClose" aria-label="Close Properties" title="Close">&times;</button></div>
    <p class="properties-selection-status" id="propertiesSelectionStatus">No objects selected</p>
    <label class="property-row" for="classProperty"><span>Class</span><select id="classProperty" aria-label="Class for selected geometry" disabled><option value="class-x">X</option></select></label>
    <div class="property-row"><span>Fill Color</span><div class="property-inline property-color-controls"><input id="fillColorProperty" aria-label="Fill color picker" type="color" value="#ffffff" disabled /><button type="button" id="imageFillProperty" class="property-image-fill-button" aria-label="Choose image fill" title="Choose image fill" disabled><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16"/><circle cx="9" cy="10" r="2"/><path d="M4 18l5-5 3 3 3-4 5 6"/></svg></button><input id="fillExpressionProperty" aria-label="Fill hex, expression, or image path" type="text" value="#ffffff" spellcheck="false" disabled /></div></div>
    ${imageFillPropertiesMarkup()}
    <div class="property-row"><span>Fill Opacity</span><div class="property-inline opacity-controls"><input id="fillOpacitySlider" aria-label="Fill opacity slider" type="range" min="0" max="100" step="1" value="100" disabled /><input id="fillOpacityExpression" aria-label="Fill opacity expression" type="text" value="100" spellcheck="false" disabled /></div></div>
    <div class="property-row"><span>Stroke Color</span><div class="property-inline property-color-controls"><input id="strokeColorProperty" aria-label="Stroke color picker" type="color" value="#202020" disabled /><button type="button" id="imageStrokeProperty" class="property-image-fill-button" aria-label="Choose image stroke" title="Choose image stroke" disabled><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16"/><circle cx="9" cy="10" r="2"/><path d="M4 18l5-5 3 3 3-4 5 6"/></svg></button><input id="strokeExpressionProperty" aria-label="Stroke hex, expression, or image path" type="text" value="#202020" spellcheck="false" disabled /></div></div>
    ${imageStrokePropertiesMarkup()}
    <label class="property-row" for="strokeThicknessProperty"><span>Stroke Thickness</span><input id="strokeThicknessProperty" type="number" min="0.1" max="40" step="0.1" value="1.5" disabled /></label>
    <div class="property-row"><span>Stroke Opacity</span><div class="property-inline opacity-controls"><input id="strokeOpacitySlider" aria-label="Stroke opacity slider" type="range" min="0" max="100" step="1" value="100" disabled /><input id="strokeOpacityExpression" aria-label="Stroke opacity expression" type="text" value="100" spellcheck="false" disabled /></div></div>
    <label class="property-row" for="zIndexProperty"><span>Z-Index</span><select id="zIndexProperty" disabled>
      <option value="">Arrange...</option>
      <option value="front">Bring to Front</option>
      <option value="back">Send to Back</option>
      <option value="forward">Bring Forward</option>
      <option value="backward">Send Backward</option>
    </select></label>
    <label class="property-row text-checkbox-row seam-line-property-row" for="seamLineProperty" hidden><span>Seam Line</span><input id="seamLineProperty" type="checkbox" disabled /></label>
    ${objectVisibilityPropertiesMarkup()}
    <label class="property-row text-property-row" for="fontNameProperty" hidden><span>Font Name</span><select id="fontNameProperty" disabled>
      ${['Arial', 'Helvetica', 'Verdana', 'Tahoma', 'Trebuchet MS', 'Times New Roman', 'Georgia', 'Garamond', 'Courier New', 'Comic Sans MS', 'Impact', 'Lucida Console'].map((name) => `<option value="${name}">${name}</option>`).join('')}
    </select></label>
    <label class="property-row text-property-row" for="fontSizeProperty" hidden><span>Font Size</span><input id="fontSizeProperty" type="number" min="1" step="1" value="28" disabled /></label>
    <label class="property-row text-property-row" for="fontColorProperty" hidden><span>Font Color</span><input id="fontColorProperty" type="color" value="#202020" disabled /></label>
    <label class="property-row text-property-row text-layout-property-row" for="scaleTextWithZoomProperty" hidden><span>Scale with Zoom</span><input id="scaleTextWithZoomProperty" type="checkbox" checked disabled /></label>
    <label class="property-row text-property-row text-layout-property-row" for="multilineTextProperty" hidden><span>Multiline</span><input id="multilineTextProperty" type="checkbox" checked disabled /></label>
    <div class="property-row text-property-row text-layout-property-row" id="textAlignmentPropertyRow" hidden><span>Alignment</span><div class="text-alignment-options" role="group" aria-label="Text alignment">
      <button type="button" data-text-align="left" aria-label="Left alignment" title="Left alignment" aria-pressed="true"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M4 10h10M4 14h16M4 18h12"/></svg></button>
      <button type="button" data-text-align="center" aria-label="Center alignment" title="Center alignment" aria-pressed="false"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M7 10h10M4 14h16M6 18h12"/></svg></button>
      <button type="button" data-text-align="right" aria-label="Right alignment" title="Right alignment" aria-pressed="false"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M10 10h10M4 14h16M8 18h12"/></svg></button>
    </div></div>
    <div class="property-row text-property-row text-layout-property-row" id="textVerticalAlignmentPropertyRow" hidden><span>Text Alignment</span><div class="text-alignment-options" role="group" aria-label="Text vertical alignment">
      <button type="button" data-text-vertical-align="top" aria-label="Top text alignment" title="Top" aria-pressed="true"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16M7 9h10M7 13h10M7 17h10"/></svg></button>
      <button type="button" data-text-vertical-align="middle" aria-label="Middle text alignment" title="Middle" aria-pressed="false"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h10M7 9h10M4 12h16M7 15h10M7 19h10"/></svg></button>
      <button type="button" data-text-vertical-align="bottom" aria-label="Bottom text alignment" title="Bottom" aria-pressed="false"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7h10M7 11h10M7 15h10M4 19h16"/></svg></button>
    </div></div>
    <label class="property-row construction-property-row" for="constructionProperty"><span>Construction</span><input id="constructionProperty" type="checkbox" disabled /></label>`, 'class="floating-panel properties-panel" id="propertiesPanel" data-preserve-feature-selection aria-label="Properties" hidden');
}

function modal(html) {
  document.body.insertAdjacentHTML('beforeend', `<div class="modal-backdrop"><div class="modal"><button class="close" aria-label="Close" title="Close">x</button>${html}</div></div>`);
  document.querySelector('.close').onclick = () => document.querySelector('.modal-backdrop').remove();
}

let controlToolsController = null;
document.getElementById('parametersButton').onclick = () => openParametersModal(
  solverController,
  canvasController,
  currentDrawingName(),
  controlToolsController?.model.list() || [],
);

function safeFileName(name, extension) {
  const base = drawingName(name || 'Untitled Drawing').replace(/[<>:"/\\|?*]+/g, '-').trim() || 'Untitled Drawing';
  return `${base}.${extension}`;
}

function downloadText(content, fileName, type) {
  const link = document.createElement('a');
  const url = URL.createObjectURL(new Blob([content], { type }));
  link.href = url;
  link.download = fileName;
  link.hidden = true;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const exportFileTypes = {
  dxf: { description: 'DXF Drawing', extension: 'dxf', mimeType: 'application/dxf' },
  png: { description: 'PNG Image', extension: 'png', mimeType: 'image/png' },
  svg: { description: 'SVG Drawing', extension: 'svg', mimeType: 'image/svg+xml' },
  json: { description: 'JSON File', extension: 'json', mimeType: 'application/json' },
};

function exportFileWithDialog({ name, format, createContent }) {
  const fileType = exportFileTypes[format];
  if (!fileType) throw new Error(`Unsupported export format: ${format}`);
  return exportTextFileWithPicker({
    createContent,
    description: fileType.description,
    download: downloadText,
    extension: fileType.extension,
    mimeType: fileType.mimeType,
    pickerId: `paramagic-export-${format}`,
    showSaveFilePicker: window.showSaveFilePicker?.bind(window),
    suggestedName: safeFileName(name, fileType.extension),
  });
}

async function readDrawingFile(file) {
  if (!file) return;
  try {
    const drawing = await parsePortableDrawingText(file.name, await file.text(), {
      importAsset: importPortableCatalogImage,
    });
    canvasController.loadDrawingData(drawing);
    currentDrawingFileHandle = null;
    setDrawingName(file.name);
    drawingHistory.reset();
    browserAutosaveController?.saveNow();
    updateDrawingActionState();
  } catch (error) {
    modal(`<h2>Import failed</h2><p>${escapeHtml(error.message)}</p>`);
  }
}

function setDrawingName(name) {
  activeDrawingName = drawingName(name).trim() || 'Untitled Drawing';
  document.title = drawingBrowserTitle(activeDrawingName);
  canvasController.setDocumentContext({ fileName: currentDrawingName() });
  updateDrawingActionState();
}

function drawingSnapshotForFile(name = currentDrawingName()) {
  const snapshot = canvasController.getDrawingData();
  snapshot.documentContext = {
    ...(snapshot.documentContext || {}),
    fileName: name,
  };
  return snapshot;
}

function serializeCurrentDrawing(name = currentDrawingName()) {
  return serializeParamagicDocument(drawingSnapshotForFile(name), name);
}

function paramagicFilePickerOptions(name) {
  return {
    id: 'paramagic-drawing',
    suggestedName: safeFileName(name, PARAMAGIC_DOCUMENT_EXTENSION.slice(1)),
    types: [{
      description: 'ParaMagic Drawing',
      accept: { [PARAMAGIC_DOCUMENT_MIME_TYPE]: [PARAMAGIC_DOCUMENT_EXTENSION] },
    }],
  };
}

function paramagicOpenPickerOptions() {
  const { suggestedName, ...options } = paramagicFilePickerOptions(currentDrawingName());
  return { ...options, multiple: false };
}

function chooseDrawingName(initialName = currentDrawingName()) {
  return new Promise((resolve) => {
    document.body.insertAdjacentHTML('beforeend', `<div class="modal-backdrop save-as-backdrop">
      <form class="modal save-as-modal" role="dialog" aria-modal="true" aria-labelledby="saveAsTitle">
        <button type="button" class="close save-as-close" aria-label="Close" title="Close">x</button>
        <h2 id="saveAsTitle">Save Drawing As</h2>
        <label class="save-as-field"><span>Drawing name</span><input class="save-as-name" value="${escapeHtml(initialName)}" autocomplete="off" /></label>
        <p class="save-as-error" role="alert" hidden>Enter a drawing name.</p>
        <div class="save-as-actions"><button type="button" class="save-as-cancel">Cancel</button><button type="submit" class="save-as-confirm">Save As</button></div>
      </form>
    </div>`);
    const backdrop = [...document.querySelectorAll('.save-as-backdrop')].at(-1);
    const form = backdrop.querySelector('.save-as-modal');
    const input = backdrop.querySelector('.save-as-name');
    const finish = (name) => {
      backdrop.remove();
      resolve(name);
    };
    backdrop.querySelector('.save-as-close').addEventListener('click', () => finish(null));
    backdrop.querySelector('.save-as-cancel').addEventListener('click', () => finish(null));
    backdrop.addEventListener('pointerdown', (event) => { if (event.target === backdrop) finish(null); });
    backdrop.addEventListener('keydown', (event) => { if (event.key === 'Escape') finish(null); });
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const name = drawingName(input.value).trim();
      if (!name) {
        backdrop.querySelector('.save-as-error').hidden = false;
        input.focus();
        return;
      }
      finish(name);
    });
    input.focus();
    input.select();
  });
}

const drawingFileController = createDrawingFileController({
  getHandle: () => currentDrawingFileHandle,
  setHandle: (handle) => { currentDrawingFileHandle = handle; },
  showOpenFilePicker: window.showOpenFilePicker?.bind(window),
  showSaveFilePicker: window.showSaveFilePicker?.bind(window),
  normalizeName: (name) => drawingName(name).trim() || 'Untitled Drawing',
  openPickerOptions: paramagicOpenPickerOptions,
  pickerOptions: paramagicFilePickerOptions,
  serialize: serializeCurrentDrawing,
  download: (content, name) => downloadText(
    content,
    safeFileName(name, PARAMAGIC_DOCUMENT_EXTENSION.slice(1)),
    PARAMAGIC_DOCUMENT_MIME_TYPE,
  ),
  chooseFallbackName: chooseDrawingName,
});

async function saveDrawing(saveAs = false) {
  try {
    const result = await drawingFileController[saveAs ? 'saveAs' : 'save'](currentDrawingName());
    if (result.status !== 'saved') return;
    setDrawingName(result.name);
    drawingHistory.recordSoon();
    await browserAutosaveController?.saveNow();
  } catch (error) {
    modal(`<h2>Save failed</h2><p>${escapeHtml(error.message)}</p>`);
  }
}

async function readParamagicFile(file, mode, fileHandle = null) {
  if (!file) return;
  try {
    const drawing = parseParamagicDocument(await file.text());
    if (mode === 'insert') {
      canvasController.insertDrawingData(drawing);
    } else {
      canvasController.loadDrawingData(drawing);
      currentDrawingFileHandle = fileHandle;
      setDrawingName(file.name.replace(/\.paramagic$/i, ''));
      drawingHistory.reset();
      browserAutosaveController?.saveNow();
    }
    updateDrawingActionState();
  } catch (error) {
    modal(`<h2>${mode === 'insert' ? 'Insert' : 'Open'} failed</h2><p>${escapeHtml(error.message)}</p>`);
  }
}

document.getElementById('importButton').addEventListener('click', () => document.getElementById('importFileInput').click());
document.getElementById('importFileInput').addEventListener('change', async (event) => {
  await readDrawingFile(event.target.files[0]);
  event.target.value = '';
});
document.getElementById('openButton').addEventListener('click', () => {
  const fallbackInput = document.getElementById('openParamagicFileInput');
  if (typeof window.showOpenFilePicker !== 'function') {
    fallbackInput.click();
    return;
  }
  (async () => {
    try {
      const result = await drawingFileController.open();
      if (result.status === 'opened') await readParamagicFile(result.file, 'open', result.handle);
      else if (result.status === 'fallback') fallbackInput.click();
    } catch (error) {
      modal(`<h2>Open failed</h2><p>${escapeHtml(error.message)}</p>`);
    }
  })();
});
document.getElementById('openParamagicFileInput').addEventListener('change', async (event) => {
  await readParamagicFile(event.target.files[0], 'open');
  event.target.value = '';
});
document.getElementById('insertButton').addEventListener('click', () => document.getElementById('insertParamagicFileInput').click());
document.getElementById('insertParamagicFileInput').addEventListener('change', async (event) => {
  await readParamagicFile(event.target.files[0], 'insert');
  event.target.value = '';
});
document.getElementById('saveButton').addEventListener('click', () => saveDrawing());
document.getElementById('saveAsButton').addEventListener('click', () => saveDrawing(true));
document.getElementById('insertImageButton').addEventListener('click', () => {
  window.dispatchEvent(new CustomEvent('paramagic:tool-activated', { detail: { source: 'image' } }));
  document.getElementById('imageFileInput').click();
});
document.getElementById('drawingPropertiesButton').addEventListener('click', openDrawingPropertiesModal);
document.getElementById('imageFileInput').addEventListener('change', async (event) => {
  const file = event.target.files[0];
  event.target.value = '';
  if (!file) return;
  try {
    const canvasElement = canvasController.getCanvasElement();
    const bounds = canvasElement.getBoundingClientRect();
    const center = canvasController.screenToWorld(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2);
    canvasController.addImage(await createImageEntityFromFile(file, { center }));
    updateDrawingActionState();
  } catch (error) {
    modal(`<h2>Insert image failed</h2><p>${escapeHtml(error.message)}</p>`);
  }
});

document.querySelectorAll('[data-export-format]').forEach((button) => {
  button.addEventListener('click', async () => {
    const name = currentDrawingName();
    try {
      const format = button.dataset.exportFormat;
      if (format === 'json') {
        const snapshot = canvasController.getDrawingData();
        await exportFileWithDialog({
          name,
          format,
          createContent: () => serializePortableDrawingJson(snapshot, name),
        });
      } else if (format === 'svg') {
        await exportFileWithDialog({
          name,
          format,
          createContent: () => serializeCanvasPresentationSvg(canvasController.getObjectLayer?.()),
        });
      } else if (format === 'png') {
        let png;
        const result = await exportFileWithDialog({
          name,
          format,
          createContent: async () => {
            png = await createCanvasPresentationPng(canvasController.getObjectLayer?.());
            return png.blob;
          },
        });
        if (result.status === 'saved') {
          showStorageStatus(`Exported ${result.name} (${png.width} × ${png.height}, ${png.blob.size} bytes).`);
        }
      } else {
        prepareDxfExportGeometry(canvasController.solveDrawing);
        const snapshot = canvasController.getDrawingData();
        const dxfSnapshot = createDrawingDxfSnapshot(snapshot);
        await exportFileWithDialog({
          name,
          format,
          createContent: () => serializeDxf(dxfSnapshot),
        });
      }
    } catch (error) {
      modal(`<h2>Export failed</h2><p>${escapeHtml(error.message)}</p>`);
    }
  });
});

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

const drawingUnitOptions = [
  ['in', 'Inches'],
  ['mm', 'Millimeters'],
  ['cm', 'Centimeters'],
  ['m', 'Meters'],
  ['ft', 'Feet'],
];

function openDrawingPropertiesModal() {
  const properties = canvasController.getDrawingProperties();
  const options = (selected) => drawingUnitOptions
    .map(([value, label]) => `<option value="${value}" ${value === selected ? 'selected' : ''}>${label}</option>`)
    .join('');
  modal(`<div class="drawing-properties-modal-content">
    <h2>Drawing Properties</h2>
    <p class="drawing-properties-note">Dimension and parameter expressions use the drawing unit automatically. Unit suffixes are not required.</p>
    <label class="drawing-property-field" for="drawingUnitProperty">
      <span>Drawing Units</span>
      <select id="drawingUnitProperty">${options(properties.drawingUnit)}</select>
    </label>
    <label class="drawing-property-field" for="dxfExportUnitProperty">
      <span>DXF Export Unit</span>
      <select id="dxfExportUnitProperty">${options(properties.dxfExportUnit)}</select>
    </label>
    <label class="drawing-property-field" for="filletRadiusProperty">
      <span>Fillet Radius</span>
      <input id="filletRadiusProperty" type="number" min="0.000001" step="any" value="${escapeHtml(properties.filletRadius)}" />
    </label>
    <button type="button" class="document-variables-button" id="documentVariablesButton">Document Variables…</button>
    <p class="drawing-properties-footnote">The DXF setting changes exported coordinates only; it does not resize the drawing.</p>
  </div>`);
  const backdrop = document.querySelector('.modal-backdrop');
  backdrop.querySelector('.modal').classList.add('drawing-properties-modal');
  const drawingUnit = backdrop.querySelector('#drawingUnitProperty');
  const dxfExportUnit = backdrop.querySelector('#dxfExportUnitProperty');
  const filletRadius = backdrop.querySelector('#filletRadiusProperty');
  backdrop.querySelector('#documentVariablesButton').addEventListener('click', () => {
    backdrop.remove();
    openDocumentVariablesModal();
  });
  notchTools.mountDrawingPropertiesControl(backdrop.querySelector('.drawing-properties-modal-content'));
  const apply = () => canvasController.setDrawingProperties({
    drawingUnit: drawingUnit.value,
    dxfExportUnit: dxfExportUnit.value,
    filletRadius: filletRadius.value,
  });
  drawingUnit.addEventListener('change', apply);
  dxfExportUnit.addEventListener('change', apply);
  const applyFilletRadius = () => {
    const value = Number(filletRadius.value);
    if (Number.isFinite(value) && value > 0) apply();
  };
  filletRadius.addEventListener('input', applyFilletRadius);
  filletRadius.addEventListener('change', () => {
    if (Number(filletRadius.value) > 0) return;
    filletRadius.value = canvasController.getDrawingProperties().filletRadius;
  });
  drawingUnit.focus();
}

function openDocumentVariablesModal() {
  const values = new Map(canvasController.getDocumentVariables().map((entry) => [entry.name, entry]));
  const specs = DOCUMENT_VARIABLE_SPECS.map((spec) => {
    const entry = values.get(spec.name);
    const value = typeof entry?.value === 'number'
      ? formatUnitlessValue(entry.value, entry.unit)
      : entry?.value ?? '';
    return { ...spec, value };
  });
  const rows = specs.map((spec) => `
    <tr data-document-variable="${escapeHtml(spec.name)}">
      <td><code>${escapeHtml(spec.name)}</code><small>${escapeHtml(spec.label)}</small></td>
      <td><input class="document-variable-value" aria-label="${escapeHtml(spec.label)}" value="${escapeHtml(spec.value)}" ${spec.readOnly ? 'readonly' : ''} /></td>
      <td><span class="document-variable-state">${spec.readOnly ? 'Automatic' : 'Editable'}</span></td>
    </tr>`).join('');
  modal(`<div class="document-variables-modal-content">
    <div class="document-variables-heading"><button type="button" id="documentVariablesBack" class="document-variables-back">‹ Drawing Properties</button><h2>Document Variables</h2></div>
    <p class="drawing-properties-note">Use variables such as <code>[DrawingNumber]</code> and <code>[CurrentDate]</code> in text fields and parameter expressions.</p>
    <div class="document-variables-table-scroll">
      <table class="document-variables-table" aria-label="Document variables">
        <thead><tr><th>Variable</th><th>Value</th><th>Source</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  </div>`);
  const backdrop = document.querySelector('.modal-backdrop');
  backdrop.querySelector('.modal').classList.add('document-variables-modal');
  const specByName = new Map(specs.map((spec) => [spec.name, spec]));
  backdrop.querySelectorAll('[data-document-variable]').forEach((row) => {
    const spec = specByName.get(row.dataset.documentVariable);
    if (!spec || spec.readOnly) return;
    row.querySelector('.document-variable-value').addEventListener('input', (event) => {
      canvasController.setDocumentMetadata({ [spec.key]: event.target.value });
    });
  });
  backdrop.querySelector('#documentVariablesBack').addEventListener('click', () => {
    backdrop.remove();
    openDrawingPropertiesModal();
  });
}

function openParametersModal(solver, canvas, drawingName = 'Untitled Drawing', controlItems = []) {
  modal(`<div class="parameters-modal-content">
    <div class="parameters-heading"><h2>Parameters</h2>${parametersPanelHeaderActionsMarkup()}</div>
    <div class="parameters-description">
      <p class="parameters-note">Local to this drawing. Dimensions are added automatically as d1, d2, d3, and Controls as c1, c2, c3. Both can be referenced from expressions.</p>
      <p class="parameters-import-status" role="status" hidden></p>
    </div>
    <div class="parameters-table-scroll" tabindex="0" aria-label="Scrollable drawing parameters">
      <table class="parameters-table" aria-label="Drawing parameters">
        <thead><tr><th>Name</th><th>Expression</th></tr></thead>
        <tbody></tbody>
      </table>
    </div>
    <p class="parameters-help">Operators: + - * / ^, comparisons, &&, ||, !. Functions: min, max, abs, round, sqrt, pow, clamp, if, and degree-based trig. Numeric values use the drawing unit. Quoted text is preserved as a string.</p>
  </div>`);
  const backdrop = document.querySelector('.modal-backdrop');
  backdrop.querySelector('.modal').classList.add('parameters-modal');
  const tableBody = backdrop.querySelector('.parameters-table tbody');
  let selectedId = null;
  let draggingId = null;

  const expressionWithoutUnits = (expression) => String(expression ?? '')
    .replace(/\s+(?:mm|cm|m|in|ft|deg)\b/gi, '')
    .trim();
  const expressionForEntry = (entry) => entry.computed
    ? formatUnitlessValue(entry.value, entry.unit)
    : expressionWithoutUnits(entry.expression);
  const parameterValueText = (entry) => typeof entry?.value === 'boolean'
    ? String(entry.value).toUpperCase()
    : formatUnitlessValue(entry?.value, entry?.unit);
  const tableView = createParametersPanelController({
    root: backdrop,
    solver,
    canvas,
    closeButton: backdrop.querySelector('.parameters-modal > .close'),
    drawingName,
    expressionForEntry,
    onViewChange: () => render(),
    onHelp: openExpressionHelpModal,
    onRender: () => render(),
  });

  function rowMarkup(entry) {
    const dimension = entry.kind === 'dimension';
    const computed = dimension && !entry.driving;
    const control = entry.kind === 'control';
    const rowClass = [dimension ? 'dimension-parameter-row' : '', computed ? 'computed-parameter-row' : '', entry.error ? 'invalid-parameter-row' : '', entry.id === selectedId ? 'selected-parameter-row' : ''].filter(Boolean).join(' ');
    const valueText = parameterValueText(entry);
    return `<tr tabindex="0" class="${rowClass}" data-parameter-id="${escapeHtml(entry.id)}" title="${escapeHtml(entry.error || `Value: ${valueText}`)}">
      <td><input type="hidden" value="${escapeHtml(entry.id)}" /><span class="row-drag-handle" draggable="true" aria-hidden="true" title="Drag to reorder">&#8942;&#8942;</span>${parameterNameEditorMarkup(entry, { controlItems })}</td>
      <td><input class="parameter-expression" aria-label="Parameter expression" value="${escapeHtml(expressionForEntry(entry))}" ${computed || control ? 'readonly' : ''} aria-invalid="${entry.error ? 'true' : 'false'}" /></td>
    </tr>`;
  }

  function draftMarkup() {
    return `<tr class="draft-parameter-row" data-draft-parameter>
      <td><span class="row-drag-handle placeholder" aria-hidden="true">&#8942;&#8942;</span><input class="parameter-name" aria-label="New parameter name" placeholder="New parameter" /></td>
      <td><input class="parameter-expression" aria-label="New parameter expression" placeholder="Start typing to add a row" /></td>
    </tr>`;
  }

  function render(focus = null) {
    tableBody.innerHTML = parameterTableBodyMarkup(solver.parameters(), {
      separated: tableView.isSeparated(),
      rowMarkup,
      draftMarkup,
    });
    bindRows();
    if (focus?.id) {
      const row = tableBody.querySelector(`[data-parameter-id="${CSS.escape(focus.id)}"]`);
      const field = row?.querySelector(focus.selector);
      field?.focus();
      if (field?.setSelectionRange) field.setSelectionRange(field.value.length, field.value.length);
    }
  }

  function updateRowState(row, outcome) {
    const successful = ['converged', 'unchanged'].includes(outcome.result?.status);
    if (successful) canvas.applySolverSnapshot(outcome.snapshot);
    if (outcome.entry?.kind === 'dimension') canvas.updateDimensionParameterName(outcome.entry.id, outcome.entry.name);
    const updateError = outcome.entry?.error || (!successful ? outcome.result?.message : '');
    row.classList.toggle('invalid-parameter-row', Boolean(updateError));
    row.title = updateError || `Value: ${parameterValueText(outcome.entry)}`;
    row.querySelector('.parameter-expression')?.setAttribute('aria-invalid', String(Boolean(updateError)));
    tableView.setStatus(updateError, Boolean(updateError));
    canvas.notifyObjectChange();
  }

  function submitParameterUpdate(row, id, patch, { syncDependents = false } = {}) {
    const update = solver.updateParameterAuthoritative || solver.updateParameter;
    const outcome = update.call(solver, id, patch, {
      coalesceKey: `parameter-editor:${id}`,
    });
    if (!outcome || typeof outcome.then !== 'function') {
      updateRowState(row, outcome);
      if (syncDependents) syncDependentExpressions(id);
      return;
    }
    const revision = String((Number(row.dataset.updateRevision) || 0) + 1);
    row.dataset.updateRevision = revision;
    row.classList.add('pending-parameter-row');
    outcome.then((resolved) => {
      if (row.dataset.updateRevision !== revision) return;
      row.classList.remove('pending-parameter-row');
      updateRowState(row, resolved);
      if (syncDependents) syncDependentExpressions(id);
    }).catch((error) => {
      if (row.dataset.updateRevision !== revision) return;
      row.classList.remove('pending-parameter-row');
      row.classList.add('invalid-parameter-row');
      row.title = error.message || 'Parameter could not be applied.';
      tableView.setStatus(row.title, true);
    });
  }

  function syncDependentExpressions(activeId) {
    const entries = new Map(solver.parameters().map((entry) => [entry.id, entry]));
    tableBody.querySelectorAll('[data-parameter-id]').forEach((candidate) => {
      if (candidate.dataset.parameterId === activeId) return;
      const input = candidate.querySelector('.parameter-expression');
      const entry = entries.get(candidate.dataset.parameterId);
      if (input && entry && document.activeElement !== input) input.value = expressionForEntry(entry);
    });
  }

  function bindRows() {
    tableBody.querySelectorAll('[data-parameter-id]').forEach((row) => {
      const id = row.dataset.parameterId;
      row.addEventListener('pointerdown', (event) => {
        selectedId = id;
        tableBody.querySelectorAll('.selected-parameter-row').forEach((candidate) => candidate.classList.remove('selected-parameter-row'));
        row.classList.add('selected-parameter-row');
        if (!event.target.closest('input, select')) row.focus();
      });
      row.addEventListener('focus', () => {
        selectedId = id;
        row.classList.add('selected-parameter-row');
      });
      row.querySelector('.parameter-name').addEventListener('input', (event) => {
        submitParameterUpdate(row, id, { name: event.target.value }, { syncDependents: true });
      });
      const expressionInput = row.querySelector('.parameter-expression');
      if (expressionInput && !expressionInput.readOnly) {
        expressionInput.addEventListener('input', (event) => submitParameterUpdate(row, id, { expression: event.target.value }));
      }
      row.addEventListener('dragstart', (event) => {
        if (!event.target.closest('.row-drag-handle')) {
          event.preventDefault();
          return;
        }
        draggingId = id;
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', id);
        row.classList.add('dragging-parameter-row');
      });
      row.addEventListener('dragend', () => {
        draggingId = null;
        row.classList.remove('dragging-parameter-row');
      });
      row.addEventListener('dragover', (event) => {
        const movingEntry = solver.dimensions.get(draggingId);
        const targetEntry = solver.dimensions.get(id);
        if (!tableView.canReorder(movingEntry, targetEntry)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
      });
      row.addEventListener('drop', (event) => {
        event.preventDefault();
        const movingId = draggingId || event.dataTransfer.getData('text/plain');
        const movingEntry = solver.dimensions.get(movingId);
        const targetEntry = solver.dimensions.get(id);
        if (movingId && movingId !== id && tableView.canReorder(movingEntry, targetEntry)) {
          solver.reorderParameter(movingId, id);
          canvas.notifyObjectChange();
        }
        render();
      });
    });

    const draftRow = tableBody.querySelector('[data-draft-parameter]');
    const draftName = draftRow.querySelector('.parameter-name');
    const draftExpression = draftRow.querySelector('.parameter-expression');
    const createFromDraft = (source) => {
      if (!draftName.value.trim() && !draftExpression.value.trim()) return;
      const entry = solver.createParameter({ name: draftName.value.trim(), expression: draftExpression.value });
      canvas.notifyObjectChange();
      selectedId = entry.id;
      render({ id: entry.id, selector: source === draftName ? '.parameter-name' : '.parameter-expression' });
    };
    draftName.addEventListener('input', () => createFromDraft(draftName), { once: true });
    draftExpression.addEventListener('input', () => createFromDraft(draftExpression), { once: true });
  }

  backdrop.addEventListener('keydown', (event) => {
    if ((event.key !== 'Delete' && event.key !== 'Backspace') || !selectedId) return;
    if (event.target.closest('input, select')) return;
    const entry = solver.dimensions.get(selectedId);
    if (entry?.kind === 'dimension' || entry?.kind === 'control') return;
    event.preventDefault();
    solver.removeParameter(selectedId);
    canvas.notifyObjectChange();
    selectedId = null;
    render();
  });

  render();
}

function openExpressionHelpModal() {
  document.body.insertAdjacentHTML('beforeend', `<div class="modal-backdrop expression-help-backdrop">
    <div class="modal expression-help-modal" role="dialog" aria-modal="true" aria-labelledby="expressionHelpTitle">
      <button class="close expression-help-close" aria-label="Close" title="Close">x</button>
      <h2 id="expressionHelpTitle">Expression examples</h2>
      <section><h3>Conditional values</h3><p><code>if(condition, value_when_true, value_when_false)</code></p><pre>enabled = TRUE</pre><pre>if(enabled, 600, 50)</pre><p>If <code>enabled</code> evaluates to <code>TRUE</code>, the result is 600; otherwise it is 50.</p></section>
      <section><h3>Parameter references and arithmetic</h3><pre>plate_width / 2 + 10</pre><pre>d1 - 25</pre></section>
      <section><h3>Comparisons and logic</h3><pre>width &gt;= 100</pre><pre>enabled &amp;&amp; width &lt; 500</pre><pre>!disabled</pre></section>
      <section><h3>Functions</h3><pre>max(25, width / 4)</pre><pre>clamp(width, 100, 600)</pre><pre>round(sqrt(area))</pre><pre>sin(30) * 100</pre><pre>MinMax(minimum, maximum, initial, step)</pre></section>
      <section><h3>Text values</h3><p>Wrap text in single or double quotes to create a string parameter.</p><pre>BodyCover = "basic/Fabric/36981_106.webp"</pre></section>
      <section><h3>Drawing units and constants</h3><p>Numeric values use the drawing unit. Constants: <code>pi</code>, <code>e</code>, <code>yes</code>, <code>no</code>, <code>true</code>, <code>false</code>.</p></section>
    </div>
  </div>`);
  const helpBackdrop = document.querySelector('.expression-help-backdrop');
  const close = () => helpBackdrop.remove();
  helpBackdrop.querySelector('.expression-help-close').addEventListener('click', close);
  helpBackdrop.addEventListener('pointerdown', (event) => { if (event.target === helpBackdrop) close(); });
  helpBackdrop.querySelector('.expression-help-close').focus();
}

const constraintToggle = constraintTool.querySelector('.menu-toggle');
let constraintMenuCloseTimer = null;
constraintMenu.querySelector('[data-constraint="Coincident"]')?.classList.add('stored-constraint');

function showConstraintMenu() {
  clearTimeout(constraintMenuCloseTimer);
  constraintTool.classList.add('open');
  constraintMenu.classList.add('open');
  positionHeaderToolMenu(constraintToggle, constraintMenu);
  constraintToggle.setAttribute('aria-expanded', 'true');
}

function hideConstraintMenu() {
  clearTimeout(constraintMenuCloseTimer);
  constraintTool.classList.remove('open');
  constraintMenu.classList.remove('open');
  constraintToggle.setAttribute('aria-expanded', 'false');
}

function scheduleConstraintMenuClose() {
  clearTimeout(constraintMenuCloseTimer);
  constraintMenuCloseTimer = setTimeout(hideConstraintMenu, 120);
}

constraintToggle.addEventListener('pointerenter', showConstraintMenu);
constraintToggle.addEventListener('pointerleave', scheduleConstraintMenuClose);
constraintMenu.addEventListener('pointerenter', () => clearTimeout(constraintMenuCloseTimer));
constraintMenu.addEventListener('pointerleave', scheduleConstraintMenuClose);
constraintToggle.addEventListener('keydown', (event) => {
  const openKey = constraintToggle.closest('.header-section-vertical') ? 'ArrowLeft' : 'ArrowDown';
  if (event.key !== openKey) return;
  event.preventDefault();
  showConstraintMenu();
  constraintMenu.querySelector('button')?.focus();
});

let edgeToolMenuCloseTimer = null;
edgeToolMenu.querySelector('[data-edge-tool="Notch"]')?.classList.add('stored-constraint');

function showEdgeToolMenu() {
  clearTimeout(edgeToolMenuCloseTimer);
  edgeTool.classList.add('open');
  edgeToolMenu.classList.add('open');
  positionHeaderToolMenu(edgeToolToggle, edgeToolMenu);
  edgeToolToggle.setAttribute('aria-expanded', 'true');
}

function hideEdgeToolMenu() {
  clearTimeout(edgeToolMenuCloseTimer);
  edgeTool.classList.remove('open');
  edgeToolMenu.classList.remove('open');
  edgeToolToggle.setAttribute('aria-expanded', 'false');
}

function scheduleEdgeToolMenuClose() {
  clearTimeout(edgeToolMenuCloseTimer);
  edgeToolMenuCloseTimer = setTimeout(hideEdgeToolMenu, 120);
}

edgeToolToggle.addEventListener('pointerenter', showEdgeToolMenu);
edgeToolToggle.addEventListener('pointerleave', scheduleEdgeToolMenuClose);
edgeToolMenu.addEventListener('pointerenter', () => clearTimeout(edgeToolMenuCloseTimer));
edgeToolMenu.addEventListener('pointerleave', scheduleEdgeToolMenuClose);
edgeToolToggle.addEventListener('keydown', (event) => {
  const openKey = edgeToolToggle.closest('.header-section-vertical') ? 'ArrowLeft' : 'ArrowDown';
  if (event.key !== openKey) return;
  event.preventDefault();
  showEdgeToolMenu();
  edgeToolMenu.querySelector('button')?.focus();
});
edgeToolToggle.addEventListener('click', () => {
  window.dispatchEvent(new CustomEvent('paramagic:edge-tool-toggle'));
});
edgeToolMenu.querySelectorAll('[data-edge-tool]').forEach((button) => {
  button.addEventListener('click', (event) => {
    const selected = event.currentTarget.dataset.edgeTool;
    hideEdgeToolMenu();
    edgeToolToggle.innerHTML = icon(selected);
    edgeToolToggle.title = selected;
    edgeToolToggle.setAttribute('aria-label', selected);
    edgeToolToggle.dataset.selectedEdgeTool = selected;
    edgeToolMenu.querySelectorAll('[data-edge-tool]').forEach((candidate) => {
      const stored = candidate.dataset.edgeTool === selected;
      candidate.classList.toggle('stored-constraint', stored);
      if (stored) candidate.setAttribute('aria-current', 'true');
      else candidate.removeAttribute('aria-current');
    });
    window.dispatchEvent(new CustomEvent('paramagic:edge-tool-selected', { detail: { selected } }));
  });
});

function deactivateConstraintSelection() {
  if (constraintToggle.getAttribute('aria-pressed') !== 'true') return;
  constraintController?.deactivate();
  constraintToggle.setAttribute('aria-pressed', 'false');
  constraintToggle.classList.remove('active');
}

function activateStoredConstraint() {
  const selected = constraintToggle.dataset.selectedConstraint || 'Coincident';
  constraintToggle.setAttribute('aria-pressed', 'true');
  constraintToggle.classList.add('active');
  window.dispatchEvent(new CustomEvent('paramagic:tool-activated', { detail: { source: 'constraint' } }));
  constraintController?.setActiveConstraint(selected);
}

function completeConstraintSelection() {
  deactivateConstraintSelection();
  rememberRepeatableTool(() => {
    if (constraintToggle.getAttribute('aria-pressed') === 'true') return false;
    activateStoredConstraint();
    return true;
  });
}

constraintToggle.addEventListener('click', () => {
  if (constraintToggle.getAttribute('aria-pressed') === 'true') deactivateConstraintSelection();
  else activateStoredConstraint();
});

document.querySelectorAll('[data-constraint]').forEach((button) => {
  button.addEventListener('click', (event) => {
    const selected = event.currentTarget.getAttribute('data-constraint');
    hideConstraintMenu();
    constraintToggle.innerHTML = icon(selected);
    constraintToggle.title = selected;
    constraintToggle.setAttribute('aria-label', `${selected} constraint`);
    constraintToggle.setAttribute('data-selected-constraint', selected);
    constraintMenu.querySelectorAll('[data-constraint]').forEach((candidate) => {
      const stored = candidate.dataset.constraint === selected;
      candidate.classList.toggle('stored-constraint', stored);
      if (stored) candidate.setAttribute('aria-current', 'true');
      else candidate.removeAttribute('aria-current');
    });
    activateStoredConstraint();
  });
});

window.addEventListener('paramagic:tool-activated', (event) => {
  if (event.detail?.source !== 'constraint') deactivateConstraintSelection();
});

document.addEventListener('click', (event) => {
  const button = event.target.closest?.('button');
  if (!button || button === constraintToggle || constraintMenu.contains(button)) return;
  deactivateConstraintSelection();
});

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  hideConstraintMenu();
  hideEdgeToolMenu();
  hideTextTableMenu();
  deactivateConstraintSelection();
});

document.querySelectorAll('[data-toggle-button]').forEach((button) => {
  button.addEventListener('click', () => {
    const isPressed = button.getAttribute('aria-pressed') === 'true';
    button.setAttribute('aria-pressed', String(!isPressed));
    button.classList.toggle('active', !isPressed);
    window.dispatchEvent(new CustomEvent('paramagic:tool-activated', { detail: { source: 'drawing' } }));
  });
});

const floatingPanelControllers = new WeakMap();
document.querySelectorAll('.floating-panel').forEach((panelElement) => {
  floatingPanelControllers.set(panelElement, bindFloatingPanelDrag(panelElement));
});

const solverController = createSolverExecutionFacade({
  mode: solverWorkerModeFromEnvironment(),
  jacobianMode: solverJacobianModeFromEnvironment(),
});
const solverStatus = document.getElementById('solverStatus');
solverController.subscribeExecution?.(({ mode, state, jacobianMode }) => {
  document.documentElement.dataset.solverExecutionMode = mode;
  document.documentElement.dataset.solverExecutionState = state;
  document.documentElement.dataset.solverJacobianMode = jacobianMode;
});
solverController.subscribe((_snapshot, result) => {
  const failed = result && !['converged', 'unchanged', 'preview'].includes(result.status);
  const loadWarnings = result?.loadWarnings || [];
  solverStatus.hidden = !failed && !loadWarnings.length;
  solverStatus.classList.toggle('storage-status-error', Boolean(failed));
  solverStatus.textContent = failed
    ? result.message
    : loadWarnings.length
      ? `${loadWarnings.length} saved constraint${loadWarnings.length === 1 ? '' : 's'} was disabled while opening because it is invalid.`
      : '';
});
const canvasController = createInfiniteCanvas({
  canvas: document.getElementById('canvas'),
  grid: document.getElementById('grid'),
  svg: document.getElementById('drawingPlane'),
  status: document.getElementById('statusPill'),
  reset: document.getElementById('resetView'),
  entities: sampleEntities,
  solver: solverController,
});
controlToolsController = createControlTools({
  toolbar: document.getElementById('controlsToggle'),
  canvas: canvasController,
  solver: solverController,
});
let storageStatusTimer = null;
function showStorageStatus(message, error = false) {
  clearTimeout(storageStatusTimer);
  solverStatus.hidden = false;
  solverStatus.textContent = message;
  solverStatus.classList.toggle('storage-status-error', error);
  storageStatusTimer = setTimeout(() => {
    solverStatus.hidden = true;
    solverStatus.classList.remove('storage-status-error');
  }, 2400);
}
createClassTools({
  button: document.getElementById('classPropertiesButton'),
  select: document.getElementById('activeClassSelect'),
  selectAllButton: document.getElementById('selectAllClassButton'),
  propertySelect: document.getElementById('classProperty'),
  canvas: canvasController,
  onError: (message) => showStorageStatus(message, true),
});
document.querySelectorAll('[data-drawing-aid]').forEach((button) => {
  button.classList.add('active');
  button.addEventListener('click', () => {
    const enabled = button.getAttribute('aria-pressed') !== 'true';
    button.setAttribute('aria-pressed', String(enabled));
    button.classList.toggle('active', enabled);
    if (button.dataset.drawingAid === 'auto-constrain') canvasController.setAutoConstrainEnabled(enabled);
    if (button.dataset.drawingAid === 'object-snap') canvasController.setObjectSnapEnabled(enabled);
  });
});
const propertiesToggle = document.getElementById('propertiesToggle');
const propertiesPanelElement = document.getElementById('propertiesPanel');
const propertiesPanelClose = document.getElementById('propertiesPanelClose');
const propertiesSelectionStatus = document.getElementById('propertiesSelectionStatus');
const seamLinePropertyRows = [...document.querySelectorAll('.seam-line-property-row')];
const seamLineProperty = document.getElementById('seamLineProperty');
const fillColorProperty = document.getElementById('fillColorProperty');
const imageFillProperty = document.getElementById('imageFillProperty');
const fillExpressionProperty = document.getElementById('fillExpressionProperty');
const fillOpacitySlider = document.getElementById('fillOpacitySlider');
const fillOpacityExpression = document.getElementById('fillOpacityExpression');
const strokeColorProperty = document.getElementById('strokeColorProperty');
const imageStrokeProperty = document.getElementById('imageStrokeProperty');
const strokeExpressionProperty = document.getElementById('strokeExpressionProperty');
const strokeThicknessProperty = document.getElementById('strokeThicknessProperty');
const strokeOpacitySlider = document.getElementById('strokeOpacitySlider');
const strokeOpacityExpression = document.getElementById('strokeOpacityExpression');
const zIndexProperty = document.getElementById('zIndexProperty');
const constructionProperty = document.getElementById('constructionProperty');
const textPropertyRows = [...document.querySelectorAll('.text-property-row')];
const fontNameProperty = document.getElementById('fontNameProperty');
const fontSizeProperty = document.getElementById('fontSizeProperty');
const fontColorProperty = document.getElementById('fontColorProperty');
const scaleTextWithZoomProperty = document.getElementById('scaleTextWithZoomProperty');
const multilineTextProperty = document.getElementById('multilineTextProperty');
const textAlignmentButtons = [...document.querySelectorAll('[data-text-align]')];
const textVerticalAlignmentButtons = [...document.querySelectorAll('[data-text-vertical-align]')];

function setPropertiesPanelVisible(visible) {
  propertiesPanelElement.hidden = !visible;
  if (visible) floatingPanelControllers.get(propertiesPanelElement)?.clamp();
  propertiesToggle.classList.toggle('active', visible);
  propertiesToggle.setAttribute('aria-pressed', String(visible));
}

propertiesToggle.addEventListener('click', () => {
  setPropertiesPanelVisible(propertiesPanelElement.hidden);
});
propertiesPanelClose.addEventListener('click', () => setPropertiesPanelVisible(false));

const imageFillPropertyController = createImageFillPropertyController({
  root: propertiesPanelElement,
  onChange: (patch) => canvasController.setSelectedGeometryAppearance(patch),
  parameterNames: () => solverController.parameters().map(({ name }) => name),
});
const imageStrokePropertyController = createImageStrokePropertyController({
  root: propertiesPanelElement,
  onChange: (patch) => canvasController.setSelectedGeometryAppearance(patch),
  parameterNames: () => solverController.parameters().map(({ name }) => name),
});
const objectVisibilityPropertyController = bindObjectVisibilityProperties({
  root: propertiesPanelElement,
  canvas: canvasController,
});
bindObjectVisibilityOverride({
  button: document.getElementById('visibilityOverrideToggle'),
  canvas: canvasController,
});

canvasController.onSelectionChange((properties) => {
  const editable = properties.supportedCount > 0;
  seamLinePropertyRows.forEach((row) => { row.hidden = !properties.canEditSeamLine; });
  seamLineProperty.disabled = !properties.canEditSeamLine;
  [fillColorProperty, fillExpressionProperty].forEach((control) => { control.disabled = !properties.canEditFill; });
  imageFillProperty.disabled = !properties.canEditImageFill;
  imageFillPropertyController.update(properties);
  objectVisibilityPropertyController.update(properties);
  [fillOpacitySlider, fillOpacityExpression].forEach((control) => { control.disabled = !properties.canEditOpacity; });
  [strokeColorProperty, strokeExpressionProperty, strokeThicknessProperty, strokeOpacitySlider, strokeOpacityExpression].forEach((control) => { control.disabled = !properties.canEditStroke; });
  imageStrokeProperty.disabled = !properties.canEditImageStroke;
  imageStrokePropertyController.update(properties);
  zIndexProperty.disabled = !editable;
  constructionProperty.disabled = !properties.canEditConstruction;
  textPropertyRows.forEach((row) => { row.hidden = !properties.canEditText; });
  document.querySelectorAll('.text-layout-property-row').forEach((row) => { row.hidden = !properties.canEditText; });
  scaleTextWithZoomProperty.disabled = !properties.canEditText || properties.canEditScaleWithZoom === false;
  [fontNameProperty, fontSizeProperty, fontColorProperty, multilineTextProperty, ...textAlignmentButtons, ...textVerticalAlignmentButtons]
    .forEach((control) => { control.disabled = !properties.canEditText; });
  if (properties.canEditSeamLine) propertiesSelectionStatus.textContent = 'Stroke selected';
  else if (properties.arrayCount === 1) propertiesSelectionStatus.textContent = 'Array selected';
  else if (!properties.selectionCount) propertiesSelectionStatus.textContent = 'No objects selected';
  else if (properties.imageCount === 1 && !properties.geometryCount && !properties.textCount) propertiesSelectionStatus.textContent = `Image selected${properties.locked ? ' (locked)' : ''}`;
  else if (properties.textCount === 1 && properties.selectionCount === 1) propertiesSelectionStatus.textContent = 'Text selected';
  else if (properties.tableCount === 1 && properties.selectionCount === 1) propertiesSelectionStatus.textContent = 'Table selected';
  else if (!properties.geometryCount && !properties.imageCount && !properties.textCount && !properties.tableCount) propertiesSelectionStatus.textContent = 'No editable objects selected';
  else {
    const objectCount = properties.geometryCount + properties.imageCount + properties.textCount + (properties.tableCount || 0);
    propertiesSelectionStatus.textContent = `${objectCount} object${objectCount === 1 ? '' : 's'} selected`;
  }
  fillColorProperty.value = properties.fillColor || '#ffffff';
  fillColorProperty.dataset.mixed = String(properties.mixedFill);
  fillColorProperty.title = properties.mixedFill ? 'Mixed fill colors' : 'Fill Color';
  if (document.activeElement !== fillExpressionProperty) fillExpressionProperty.value = properties.fillExpression ?? '';
  fillExpressionProperty.placeholder = properties.mixedFill ? 'Mixed' : '#ffffff, expression, or image path';
  fillExpressionProperty.setAttribute('aria-invalid', String(Boolean(properties.errors?.fill)));
  fillExpressionProperty.title = properties.errors?.fill || 'Hex color, numeric expression, parameter name, or catalog image path';
  fillOpacitySlider.value = properties.fillOpacity === null ? 100 : Math.round(properties.fillOpacity * 100);
  if (document.activeElement !== fillOpacityExpression) fillOpacityExpression.value = properties.fillOpacityExpression ?? '';
  fillOpacityExpression.placeholder = properties.mixedFillOpacity ? 'Mixed' : '0–100';
  fillOpacityExpression.setAttribute('aria-invalid', String(Boolean(properties.errors?.fillOpacity)));
  fillOpacityExpression.title = properties.errors?.fillOpacity || 'Expression or parameter name from 0 to 100';
  strokeThicknessProperty.value = properties.strokeThickness ?? '';
  strokeColorProperty.value = properties.strokeColor || '#202020';
  if (document.activeElement !== strokeExpressionProperty) strokeExpressionProperty.value = properties.strokeExpression ?? '';
  strokeExpressionProperty.placeholder = properties.mixedStrokeExpression ? 'Mixed' : '#202020, expression, or image path';
  strokeExpressionProperty.setAttribute('aria-invalid', String(Boolean(properties.errors?.stroke)));
  strokeExpressionProperty.title = properties.errors?.stroke || 'Hex color, numeric expression, parameter name, or catalog image path';
  strokeThicknessProperty.placeholder = properties.mixedStroke ? 'Mixed' : '';
  strokeThicknessProperty.title = properties.mixedStroke ? 'Mixed stroke thicknesses' : 'Stroke Thickness';
  strokeOpacitySlider.value = properties.strokeOpacity === null ? 100 : Math.round(properties.strokeOpacity * 100);
  if (document.activeElement !== strokeOpacityExpression) strokeOpacityExpression.value = properties.strokeOpacityExpression ?? '';
  strokeOpacityExpression.placeholder = properties.mixedStrokeOpacity ? 'Mixed' : '0–100';
  strokeOpacityExpression.setAttribute('aria-invalid', String(Boolean(properties.errors?.strokeOpacity)));
  strokeOpacityExpression.title = properties.errors?.strokeOpacity || 'Expression or parameter name from 0 to 100';
  constructionProperty.checked = properties.construction;
  constructionProperty.indeterminate = properties.mixedConstruction;
  seamLineProperty.checked = properties.seamLine === true;
  seamLineProperty.indeterminate = properties.mixedSeamLine;
  if (document.activeElement !== fontNameProperty) fontNameProperty.value = properties.fontName ?? '';
  if (document.activeElement !== fontSizeProperty) fontSizeProperty.value = properties.fontSize ?? '';
  fontSizeProperty.placeholder = properties.fontSize === null ? 'Mixed' : '28';
  fontColorProperty.value = properties.fontColor || '#202020';
  scaleTextWithZoomProperty.checked = properties.scaleWithZoom !== false;
  scaleTextWithZoomProperty.indeterminate = properties.scaleWithZoom === null;
  multilineTextProperty.checked = properties.multiline !== false;
  multilineTextProperty.indeterminate = properties.multiline === null;
  textAlignmentButtons.forEach((button) => {
    const selected = properties.textAlign === button.dataset.textAlign;
    button.classList.toggle('active', selected);
    button.setAttribute('aria-pressed', String(selected));
  });
  textVerticalAlignmentButtons.forEach((button) => {
    const selected = properties.textVerticalAlign === button.dataset.textVerticalAlign;
    button.classList.toggle('active', selected);
    button.setAttribute('aria-pressed', String(selected));
  });
});

bindDeferredColorPicker({
  picker: fillColorProperty,
  expressionInput: fillExpressionProperty,
  onCommit: (value) => canvasController.setSelectedGeometryAppearance({ fillExpression: value }),
});
createImageCatalog({
  button: imageFillProperty,
  getDrawingUnit: () => canvasController.getDrawingUnit(),
  formatLength: (value) => canvasController.formatDrawingLength(value),
  evaluateLength: (expression) => canvasController.evaluateLengthExpression(expression),
  onSelect: (reference, sizePatch = {}) => {
    const result = canvasController.setSelectedGeometryAppearance({
      fillExpression: reference,
      ...sizePatch,
    });
    if (!result.success) modal(`<h2>Image fill failed</h2><p>${escapeHtml(result.error)}</p>`);
  },
  onError: (error) => showStorageStatus(`Image catalog unavailable: ${error.message}`, true),
});
createImageCatalog({
  button: imageStrokeProperty,
  title: 'Image Stroke',
  sizeUsage: 'image strokes',
  getDrawingUnit: () => canvasController.getDrawingUnit(),
  formatLength: (value) => canvasController.formatDrawingLength(value),
  evaluateLength: (expression) => canvasController.evaluateLengthExpression(expression),
  onSelect: (reference, sizePatch = {}) => {
    const result = canvasController.setSelectedGeometryAppearance({
      strokeExpression: reference,
      ...catalogImageStrokeSizePatch(sizePatch),
    });
    if (!result.success) modal(`<h2>Image stroke failed</h2><p>${escapeHtml(result.error)}</p>`);
  },
  onError: (error) => showStorageStatus(`Image catalog unavailable: ${error.message}`, true),
});
fillExpressionProperty.addEventListener('change', () => canvasController.setSelectedGeometryAppearance({ fillExpression: fillExpressionProperty.value }));
bindDeferredColorPicker({
  picker: strokeColorProperty,
  expressionInput: strokeExpressionProperty,
  onCommit: (value) => canvasController.setSelectedGeometryAppearance({ strokeExpression: value }),
});
strokeExpressionProperty.addEventListener('change', () => canvasController.setSelectedGeometryAppearance({ strokeExpression: strokeExpressionProperty.value }));
fillExpressionProperty.addEventListener('keydown', (event) => { if (event.key === 'Enter') fillExpressionProperty.blur(); });
strokeExpressionProperty.addEventListener('keydown', (event) => { if (event.key === 'Enter') strokeExpressionProperty.blur(); });
fillOpacitySlider.addEventListener('input', () => {
  fillOpacityExpression.value = fillOpacitySlider.value;
  canvasController.setSelectedGeometryAppearance({ fillOpacityExpression: fillOpacitySlider.value });
});
fillOpacityExpression.addEventListener('change', () => canvasController.setSelectedGeometryAppearance({ fillOpacityExpression: fillOpacityExpression.value }));
fillOpacityExpression.addEventListener('keydown', (event) => { if (event.key === 'Enter') fillOpacityExpression.blur(); });
strokeThicknessProperty.addEventListener('input', () => {
  if (!strokeThicknessProperty.value) return;
  canvasController.setSelectedGeometryAppearance({ strokeThickness: Number(strokeThicknessProperty.value) });
});
strokeOpacitySlider.addEventListener('input', () => {
  strokeOpacityExpression.value = strokeOpacitySlider.value;
  canvasController.setSelectedGeometryAppearance({ strokeOpacityExpression: strokeOpacitySlider.value });
});
strokeOpacityExpression.addEventListener('change', () => canvasController.setSelectedGeometryAppearance({ strokeOpacityExpression: strokeOpacityExpression.value }));
strokeOpacityExpression.addEventListener('keydown', (event) => { if (event.key === 'Enter') strokeOpacityExpression.blur(); });
zIndexProperty.addEventListener('change', () => {
  if (zIndexProperty.value) canvasController.arrangeSelectedGeometry(zIndexProperty.value);
  zIndexProperty.value = '';
});
seamLineProperty.addEventListener('change', () => {
  seamLineProperty.indeterminate = false;
  canvasController.setSelectedSeamLine(seamLineProperty.checked);
});
constructionProperty.addEventListener('change', () => {
  constructionProperty.indeterminate = false;
  canvasController.setSelectedConstruction(constructionProperty.checked);
});
fontNameProperty.addEventListener('change', () => canvasController.setSelectedTextProperties({ fontName: fontNameProperty.value }));
fontSizeProperty.addEventListener('input', () => {
  if (fontSizeProperty.value) canvasController.setSelectedTextProperties({ fontSize: Number(fontSizeProperty.value) });
});
fontColorProperty.addEventListener('input', () => canvasController.setSelectedTextProperties({ fontColor: fontColorProperty.value }));
scaleTextWithZoomProperty.addEventListener('change', () => {
  scaleTextWithZoomProperty.indeterminate = false;
  canvasController.setSelectedTextProperties({ scaleWithZoom: scaleTextWithZoomProperty.checked });
});
multilineTextProperty.addEventListener('change', () => {
  multilineTextProperty.indeterminate = false;
  canvasController.setSelectedTextProperties({ multiline: multilineTextProperty.checked });
});
textAlignmentButtons.forEach((button) => button.addEventListener('click', () => {
  canvasController.setSelectedTextProperties({ textAlign: button.dataset.textAlign });
}));
textVerticalAlignmentButtons.forEach((button) => button.addEventListener('click', () => {
  canvasController.setSelectedTextProperties({ textVerticalAlign: button.dataset.textVerticalAlign });
}));
const dimensionTextModeButton = document.getElementById('dimensionTextMode');
const dimensionTextModes = [
  { mode: 'named-value', label: 'Dimension Text: Named Value' },
  { mode: 'value', label: 'Dimension Text: Value Only' },
  { mode: 'expression', label: 'Dimension Text: Expression' },
];
dimensionTextModeButton.addEventListener('click', () => {
  const current = dimensionTextModes.findIndex(({ mode }) => mode === dimensionTextModeButton.dataset.dimensionTextMode);
  const next = dimensionTextModes[(current + 1) % dimensionTextModes.length];
  const accessibleLabel = next.mode === 'value' ? 'Dimension Text: Value Only (Hide Driving)' : next.label;
  dimensionTextModeButton.dataset.dimensionTextMode = next.mode;
  dimensionTextModeButton.title = accessibleLabel;
  dimensionTextModeButton.setAttribute('aria-label', accessibleLabel);
  dimensionTextModeButton.innerHTML = icon(next.label);
  canvasController.setDimensionTextMode(next.mode);
  constraintController?.setHelpersVisible(next.mode !== 'value');
});
canvasController.setDimensionTextMode('named-value');
constraintController = createConstraintHandlers({
  canvas: canvasController,
  solver: solverController,
  onApplied: completeConstraintSelection,
});
const undoButton = document.getElementById('undoButton');
const redoButton = document.getElementById('redoButton');
const drawingHistory = new DrawingHistory({
  capture: () => ({ name: currentDrawingName(), drawing: canvasController.getDrawingData() }),
  restore: (state) => {
    canvasController.loadDrawingData(state.drawing, { zoomToFit: false });
    setDrawingName(state.name || 'Untitled Drawing');
    const mode = dimensionTextModeButton.dataset.dimensionTextMode;
    canvasController.setDimensionTextMode(mode);
    constraintController.setHelpersVisible(mode !== 'value');
    updateDrawingActionState();
    browserAutosaveController?.schedule();
  },
  onChange: ({ canUndo, canRedo }) => {
    undoButton.disabled = !canUndo;
    redoButton.disabled = !canRedo;
  },
});
window.addEventListener('paramagic:history-checkpoint', () => {
  drawingHistory.flush();
  drawingHistory.record();
});
function runHistoryAction(action) {
  window.dispatchEvent(new CustomEvent('paramagic:tool-activated', { detail: { source: 'history' } }));
  return action === 'undo' ? drawingHistory.undo() : drawingHistory.redo();
}
undoButton.addEventListener('click', () => runHistoryAction('undo'));
redoButton.addEventListener('click', () => runHistoryAction('redo'));
document.addEventListener('keydown', (event) => {
  if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
  if (document.querySelector('.modal-backdrop')) return;
  if (event.target.closest?.('input, textarea, select, [contenteditable="true"]')) return;
  const key = event.key.toLowerCase();
  if (key === 's') {
    event.preventDefault();
    document.getElementById(event.shiftKey ? 'saveAsButton' : 'saveButton').click();
    return;
  }
  if (key === 'z' && !event.shiftKey) {
    if (runHistoryAction('undo')) event.preventDefault();
    return;
  }
  if ((key === 'z' && event.shiftKey) || key === 'y') {
    if (runHistoryAction('redo')) event.preventDefault();
  }
});
document.getElementById('newButton').onclick = async () => {
  canvasController.finishTextEditing?.();
  window.dispatchEvent(new CustomEvent('paramagic:tool-activated', { detail: { source: 'new' } }));
  canvasController.clearDrawing();
  currentDrawingFileHandle = null;
  setDrawingName('Untitled Drawing');
  drawingHistory.reset();
  updateDrawingActionState();
  await browserAutosaveController?.saveNow();
};
canvasController.onObjectsChange((change = {}) => {
  updateDrawingActionState();
  if (change.history === 'commit') drawingHistory.record();
  else if (change.history !== 'none') drawingHistory.recordSoon();
  if (change.history !== 'none') browserAutosaveController?.schedule();
});
updateDrawingActionState();

const drawingHint = createDrawingHint({ canvas: canvasController });
canvasController.setDrawingHint(drawingHint);

const swellTools = createSwellTools({
  toolbar: document.querySelector('.drawing-tools'),
  canvas: canvasController,
});

createDrawingTools({
  toolbar: document.querySelector('.drawing-tools'),
  canvas: canvasController,
  drawingHint,
  decorateEntity: swellTools.decorateEntity,
});

constraintController.registerConstraintOperation?.(swellTools.constraintOperation);

createFilletTools({
  toolbar: document.querySelector('.drawing-tools'),
  canvas: canvasController,
});

createSubtractTools({
  toolbar: document.querySelector('.drawing-tools'),
  canvas: canvasController,
});

const linkedCopyTools = createLinkedCopyTools({
  toolbar: document.querySelector('.drawing-tools'),
  canvas: canvasController,
});

const arrayTools = createArrayTools({
  toolbar: document.querySelector('.array-tool'),
  canvas: canvasController,
});

canvasController.registerDerivedDimensionFeatureProvider?.(linkedCopyTools.derivedDimensionProvider);
canvasController.registerDerivedDimensionFeatureProvider?.(arrayTools.derivedDimensionProvider);
constraintController.registerConstraintOperation?.(linkedCopyTools.constraintOperation);
canvasController.registerSubtractOperandProvider?.(arrayTools.subtractOperandProvider);
canvasController.registerSelectionPropertyProvider?.(arrayTools.selectionPropertyProvider);

const drawingClipboard = createDrawingClipboard({
  canvas: canvasController,
  arrayTools,
  linkedCopyTools,
  cutButton: document.getElementById('cutButton'),
  copyButton: document.getElementById('copyButton'),
  pasteButton: document.getElementById('pasteButton'),
  importAsset: importPortableCatalogImage,
  stackExporters: {
    dxf: async ({ stack, stackId }) => {
      prepareDxfExportGeometry(canvasController.solveDrawing);
      const snapshot = canvasController.getDrawingData();
      const dxfSnapshot = createStackDxfSnapshot(snapshot, stackId);
      await exportFileWithDialog({
        name: stack.name,
        format: 'dxf',
        createContent: () => serializeDxf(dxfSnapshot),
      });
    },
    svg: async ({ stack, stackId, snapshot }) => {
      await exportFileWithDialog({
        name: stack.name,
        format: 'svg',
        createContent: () => serializeCanvasPresentationSvg(canvasController.getObjectLayer?.(), { stackId }),
      });
    },
    png: async ({ stackId }) => {
      let png;
      const result = await exportFileWithDialog({
        name: currentDrawingName(),
        format: 'png',
        createContent: async () => {
          png = await createCanvasPresentationPng(canvasController.getObjectLayer?.(), { stackId });
          return png.blob;
        },
      });
      if (result.status === 'saved') {
        showStorageStatus(`Exported ${result.name} (${png.width} × ${png.height}, ${png.blob.size} bytes).`);
      }
    },
    json: async ({ stack, packageValue }) => {
      await exportFileWithDialog({
        name: stack.name,
        format: 'json',
        createContent: () => serializePortablePackageJson(packageValue),
      });
    },
  },
  onStatus: showStorageStatus,
});

createStackPanel({
  toggle: document.getElementById('stacksToggle'),
  canvas: canvasController,
  onExport: drawingClipboard.exportStack,
  onImport: drawingClipboard.importStack,
  onMoveSelection: (stackId) => {
    const recordIds = canvasController.getSelectedRecordIds();
    const selectedLinkedCopy = linkedCopyTools.selectedDefinition?.();
    const selectedArray = arrayTools.selectedDefinition?.();
    if (recordIds.length) canvasController.setRecordStackIds(drawingClipboard.expandedRecordIds(recordIds), stackId);
    if (selectedLinkedCopy?.id) linkedCopyTools.setDefinitionStack(selectedLinkedCopy.id, stackId);
    if (selectedArray?.id) arrayTools.setDefinitionStack(selectedArray.id, stackId);
  },
  onRemove: (stackId) => {
    linkedCopyTools.reassignStack(stackId, 'stack-default');
    arrayTools.reassignStack(stackId, 'stack-default');
    canvasController.removeStack(stackId);
  },
});

const notchTools = createNotchTools({
  toolbar: document.querySelector('.drawing-tools'),
  canvas: canvasController,
  drawingHint,
  button: edgeToolToggle,
  bindButton: false,
});

function selectedEdgeToolController() {
  return notchTools;
}

window.addEventListener('paramagic:edge-tool-toggle', () => selectedEdgeToolController().toggle());
window.addEventListener('paramagic:edge-tool-selected', () => selectedEdgeToolController().activate());

createSmartDimensionTools({
  toolbar: document.querySelector('.dimension-toggles'),
  canvas: canvasController,
});

browserAutosaveController = createBrowserAutosaveController({
  store: createIndexedDbBrowserFileStore(),
  capture: () => {
    const name = currentDrawingName();
    return {
      name,
      content: serializeParamagicDocument(drawingSnapshotForFile(name), name),
      mimeType: PARAMAGIC_DOCUMENT_MIME_TYPE,
      fileHandle: currentDrawingFileHandle,
      updatedAt: Date.now(),
    };
  },
  onError: (error) => showStorageStatus(error?.message || 'The browser-local autosave failed.', true),
});

async function initializeBrowserAutosave() {
  document.documentElement.dataset.browserAutosaveState = 'loading';
  try {
    const browserFile = await browserAutosaveController.load();
    if (browserFile?.content) {
      canvasController.loadDrawingData(parseParamagicDocument(browserFile.content), { zoomToFit: true });
      currentDrawingFileHandle = browserFile.fileHandle || null;
      setDrawingName(browserFile.name);
    } else {
      currentDrawingFileHandle = null;
      setDrawingName('Untitled Drawing');
      await browserAutosaveController.saveNow();
    }
    document.documentElement.dataset.browserAutosaveState = 'ready';
  } catch (error) {
    currentDrawingFileHandle = null;
    setDrawingName('Untitled Drawing');
    document.documentElement.dataset.browserAutosaveState = 'error';
    showStorageStatus(error?.message || 'The browser-local autosave could not be restored.', true);
  }
  drawingHistory.reset();
  updateDrawingActionState();
}

initializeBrowserAutosave();
