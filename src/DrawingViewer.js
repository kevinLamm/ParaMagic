import { createInfiniteCanvas, createDrawingFeatures, createControlTools, parsePortableDrawingText, importPortableCatalogImage } from '@paramagic/core/editor';
import { configureImageCatalogResources } from '@paramagic/core/images';
import { serializeDxf } from '@paramagic/core/document';
import { createCanvasPresentationPng, createDrawingDxfSnapshot, prepareDxfExportGeometry } from '@paramagic/core/export';
import { imageCatalogResources } from './app-config.js';
import { createPublishingClient } from './PublishingClient.js';
import { openFindDrawingsDialog } from './FindDrawingsDialog.js';
import { createPrintDialog } from './PrintDialog.js';
import { createAppSolver } from './AppSolver.js';

export async function openDrawingViewer(id) {
  const root = document.getElementById('root');
  document.title = 'ParaMagic viewer';
  root.innerHTML = `<div class="drawing-viewer">
    <aside class="viewer-sidebar">
      <section class="viewer-description-box">
        <details class="viewer-menu"><summary aria-label="Main Menu" title="Main Menu">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16" /></svg>
        </summary><nav class="viewer-menu-items" aria-label="Main Menu">
          <button type="button" data-find>Find Drawings</button>
          <button type="button" data-png disabled>Export PNG</button>
          <button type="button" data-dxf disabled>Export DXF</button>
          <button type="button" data-print disabled>Print</button>
        </nav></details>
        <p class="viewer-description" aria-label="Drawing description" hidden></p>
      </section>
      <div class="viewer-controls"></div>
    </aside>
    <main class="canvas viewer-canvas" data-canvas="true" aria-label="Drawing"><div class="grid" data-canvas="true"></div><svg class="drawing-plane" data-canvas="true"></svg></main>
    <div class="viewer-notice" hidden><span role="status"></span><button type="button" aria-label="Dismiss notification">×</button></div>
  </div>`;
  const menu = root.querySelector('.viewer-menu');
  const notice = root.querySelector('.viewer-notice');
  const description = root.querySelector('.viewer-description');
  const outputButtons = [...root.querySelectorAll('[data-png], [data-dxf], [data-print]')];
  const client = createPublishingClient();
  let controller; let controls; let solver; let printDialog; let searchDialog;
  let name = 'Drawing'; let loaded = null; let loading = 0; let outputBusy = false; let noticeTimer;

  function message(text = '', temporary = false) {
    clearTimeout(noticeTimer);
    notice.querySelector('[role="status"]').textContent = text;
    notice.hidden = !text;
    if (temporary) noticeTimer = setTimeout(() => message(), 5000);
  }
  notice.querySelector('button').onclick = () => message();
  function updateOutputButtons() {
    outputButtons.forEach(button => { button.disabled = !loaded || outputBusy; });
  }
  function clear() {
    loaded = null;
    printDialog?.close();
    controls?.destroy(); controls = null;
    controller?.clearDrawing();
    name = 'Drawing';
    updateOutputButtons();
    description.textContent = ''; description.hidden = true;
  }
  function fitIfNeeded() {
    if (loaded) controller.fitDrawing({ onlyIfNeeded: true });
  }
  async function load(account) {
    if (account?.user && loaded?.userId === account.user.id && loaded?.id === id) return;
    const current = ++loading;
    clear();
    if (!account?.user || !id) { message(); return; }
    const requestedId = id;
    message('Opening drawing…');
    try {
      if (!/^[a-f0-9-]{36}$/.test(requestedId)) throw new Error('Invalid drawing link.');
      const { content, name: storedName } = await client.loadForViewing(requestedId);
      if (current !== loading) return;
      configureImageCatalogResources(imageCatalogResources);
      const drawing = await parsePortableDrawingText('Shared.paramagic', content, { importAsset: importPortableCatalogImage });
      if (current !== loading) return;
      name = storedName;
      if (!controller) {
        solver = createAppSolver();
        controller = createInfiniteCanvas({ canvas: root.querySelector('.viewer-canvas'), grid: root.querySelector('.grid'),
          svg: root.querySelector('.drawing-plane'), status: document.createElement('span'), reset: document.createElement('button'),
          entities: [], solver, interactive: false, showAxes: false });
        createDrawingFeatures({ canvas: controller });
        // This notification follows all geometry stages, including derived regions.
        controller.onObjectsChange(fitIfNeeded);
        new ResizeObserver(fitIfNeeded).observe(controller.getCanvasElement());
        printDialog = createPrintDialog({ canvas: controller, getDrawingName: () => 'Drawing',
          fixedDimensionView: 'value', allowWindowSelection: false });
      }
      controls = createControlTools({ canvas: controller, solver, host: root.querySelector('.viewer-controls'),
        allowEditing: false, floating: false, showHeader: false, showParameterNames: false });
      controller.setDimensionTextMode('value');
      controller.loadDrawingData(drawing, { zoomToFit: true });
      controls.setVisible(true);
      controller.flushDrawingUpdate();
      description.textContent = controller.getDocumentMetadata().drawingDescription || '';
      description.hidden = !description.textContent;
      loaded = { userId: account.user.id, id: requestedId };
      updateOutputButtons();
      message();
    } catch (error) { if (current === loading) { clear(); message(error.message); } }
  }
  function findDrawings() {
    if (searchDialog && !searchDialog.signal.aborted) return;
    searchDialog = openFindDrawingsDialog({ client,
      modal(markup) {
        document.body.insertAdjacentHTML('beforeend', `<div class="modal-backdrop"><div class="modal"><button type="button" class="close" aria-label="Close" title="Close">×</button>${markup}</div></div>`);
      },
      onAccountChange: load,
      async onOpenDrawing(drawing) {
        id = drawing.id;
        const url = new URL(location.href); url.searchParams.set('view', id);
        history.replaceState(null, '', url);
        try { await load(await client.account()); } catch (error) { clear(); message(error.message); }
      },
    });
  }
  async function outputDrawing(format) {
    if (!loaded || outputBusy) return;
    if (controls?.panel.querySelector('[aria-busy="true"]')) { message('Wait for the control update to finish, then try again.', true); return; }
    const current = loaded;
    outputBusy = true; updateOutputButtons();
    try {
      const account = await client.account();
      if (account.user?.id !== current.userId) { await load(account); throw new Error('Sign in again through Find Drawings.'); }
      await client.checkViewingAccess(current.id);
      await new Promise(resolve => requestAnimationFrame(resolve));
      if (loaded !== current) return;
      if (format === 'print') { printDialog.open(); return; }
      let blob;
      if (format === 'png') {
        blob = (await createCanvasPresentationPng(controller.getObjectLayer(), {
          resolveValueOnlyDimensionText: dimensionId => controller.getDimensionText(dimensionId, 'value'),
        })).blob;
      } else {
        prepareDxfExportGeometry(controller.solveDrawing);
        blob = new Blob([serializeDxf(createDrawingDxfSnapshot(controller.getDrawingData(), {
          effectiveEnabledStackIds: controller.getEffectiveEnabledStackIds(),
        }))], { type: 'application/dxf' });
      }
      if (loaded !== current) return;
      const url = URL.createObjectURL(blob); const link = document.createElement('a');
      link.href = url; link.download = `${name.replace(/[<>:"/\\|?*]+/g, '-').replace(/\.paramagic$/i, '')}.${format}`;
      document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      message(`${format.toUpperCase()} export created.`, true);
    } catch (error) { message(error.message); }
    finally { outputBusy = false; updateOutputButtons(); }
  }
  menu.querySelectorAll('button').forEach(button => button.addEventListener('click', () => {
    menu.open = false; menu.querySelector('summary').focus();
  }));
  document.addEventListener('pointerdown', event => { if (!menu.contains(event.target)) menu.open = false; });
  menu.addEventListener('keydown', event => {
    if (event.key === 'Escape') { menu.open = false; menu.querySelector('summary').focus(); }
  });
  root.querySelector('[data-find]').onclick = findDrawings;
  for (const format of ['png', 'dxf', 'print']) root.querySelector(`[data-${format}]`).onclick = () => outputDrawing(format);
  try {
    const account = await client.account();
    await load(account);
    if (!account.user || !id) findDrawings();
  } catch (error) { message(error.message); findDrawings(); }
}
