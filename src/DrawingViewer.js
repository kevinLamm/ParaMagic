import { createInfiniteCanvas, createControlTools, parsePortableDrawingText, importPortableCatalogImage } from '@paramagic/core/editor';
import { createSolverExecutionFacade } from '@paramagic/core/solver';
import { configureImageCatalogResources } from '@paramagic/core/images';
import { serializeDxf } from '@paramagic/core/document';
import { createCanvasPresentationPng, createDrawingDxfSnapshot, prepareDxfExportGeometry } from '@paramagic/core/export';
import { imageCatalogResources } from './app-config.js';
import { createPublishingClient } from './PublishingClient.js';
import { loadAccountPanel } from './PublishingDialog.js';

export async function openDrawingViewer(id) {
  const root = document.getElementById('root');
  root.innerHTML = `<div class="drawing-viewer">
    <header class="viewer-header"><h1>Drawing viewer</h1><span>Controls, PNG and DXF only</span>
      <button type="button" data-fit disabled>Fit drawing</button>
      <button type="button" data-png disabled>Export PNG</button><button type="button" data-dxf disabled>Export DXF</button>
    </header>
    <aside class="viewer-sidebar"><section class="publishing-account" aria-label="Viewer account"></section>
      <p class="viewer-description"></p><div class="viewer-controls"></div>
      <p>Control changes apply to this viewing session. The owner's drawing stays unchanged.</p>
    </aside>
    <main class="canvas viewer-canvas" data-canvas="true"><div class="grid" data-canvas="true"></div><svg class="drawing-plane" data-canvas="true"></svg></main>
    <p class="viewer-status" role="status">Sign in to view this drawing.</p>
  </div>`;
  const status = root.querySelector('.viewer-status'); const accountPanel = root.querySelector('.publishing-account');
  const client = createPublishingClient(); let controller; let controls; let solver; let name = 'Drawing';
  let loadedFor = null; let loading = 0;
  const exports = [...root.querySelectorAll('[data-png], [data-dxf]')];
  const fit = root.querySelector('[data-fit]');
  function clear() {
    controls?.destroy(); controls = null;
    controller?.clearDrawing();
    loadedFor = null;
    exports.forEach(button => { button.disabled = true; }); fit.disabled = true;
    root.querySelector('.viewer-description').textContent = '';
  }
  async function load(account) {
    const current = ++loading;
    if (!account?.user) { clear(); status.textContent = 'Sign in to view this drawing.'; return; }
    if (loadedFor === account.user.id) return;
    clear(); status.textContent = 'Opening drawing…';
    try {
      if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error('Invalid drawing link.');
      const { content, name: storedName } = await client.loadForViewing(id);
      configureImageCatalogResources(imageCatalogResources);
      const drawing = await parsePortableDrawingText('Shared.paramagic', content, { importAsset: importPortableCatalogImage });
      if (current !== loading) return;
      name = storedName;
      if (!controller) {
        solver = createSolverExecutionFacade({ mode: 'sync' });
        controller = createInfiniteCanvas({ canvas: root.querySelector('.viewer-canvas'), grid: root.querySelector('.grid'),
          svg: root.querySelector('svg'), status: document.createElement('span'), reset: fit, entities: [], solver, interactive: false });
      }
      controls = createControlTools({ canvas: controller, solver,
        host: root.querySelector('.viewer-controls'), allowEditing: false, floating: false });
      controller.loadDrawingData(drawing, { zoomToFit: true }); controls.setVisible(true);
      controls.panel.querySelector('.controls-panel-close').hidden = true;
      root.querySelector('.viewer-description').textContent = controller.getDocumentMetadata().drawingDescription || '';
      root.querySelector('h1').textContent = name; document.title = `ParaMagic viewer - ${name}`;
      loadedFor = account.user.id;
      exports.forEach(button => { button.disabled = false; }); fit.disabled = false;
      status.textContent = 'Viewing only. Adjust the available controls or export PNG / DXF.';
    } catch (error) { if (current === loading) status.textContent = error.message; }
  }
  async function exportDrawing(format) {
    if (!loadedFor) return;
    if (controls?.panel.querySelector('[aria-busy="true"]')) { status.textContent = 'Wait for the control update to finish, then export.'; return; }
    exports.forEach(button => { button.disabled = true; });
    try {
      // Verify access again; a withdrawn publication or expired session cannot start another export.
      const account = await client.account();
      if (account.user?.id !== loadedFor) throw new Error('Your sign-in changed. Reload this viewer before exporting.');
      await client.checkViewingAccess(id);
      // Render the local control values, without writing them to the publishing API.
      await new Promise(resolve => requestAnimationFrame(resolve));
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
      const url = URL.createObjectURL(blob); const link = document.createElement('a');
      link.href = url; link.download = `${name.replace(/[<>:"/\\|?*]+/g, '-').replace(/\.paramagic$/i, '')}.${format}`;
      document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      status.textContent = `${format.toUpperCase()} export created.`;
    } catch (error) { status.textContent = error.message; }
    finally { exports.forEach(button => { button.disabled = !loadedFor; }); }
  }
  root.querySelector('[data-png]').onclick = () => exportDrawing('png');
  root.querySelector('[data-dxf]').onclick = () => exportDrawing('dxf');
  await loadAccountPanel(accountPanel, client, { onChange: load });
}
