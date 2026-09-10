import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { PRINT_PAGE_SIZES, printLayout } from '../src/PrintLayouts.js';

// Run with a local Vite server and Playwright (or PLAYWRIGHT_MODULE_PATH).
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const { PDFDocument } = createRequire(require.resolve(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright'))('pdf-lib');
const output = process.env.PRINT_AUDIT_OUTPUT || 'tmp/print-images';
await mkdir(output, { recursive: true });
const drawing = JSON.parse(await readFile('src/tests/fixtures/stack-coordinates.paramagic', 'utf8'));
const transformed = process.env.PRINT_AUDIT_TRANSFORMED === '1';
drawing.name = 'Print image fills and strokes';
drawing.constraints = [];
drawing.entities = drawing.entities.filter(({ type }) => ['polygon', 'circle', ...(transformed ? ['line'] : [])].includes(type));
drawing.classes[0].properties = {
  ...drawing.classes[0].properties,
  fillExpression: 'basic/Fabric/Seamless_Coral.png',
  fillImageMode: 'tile',
  fillImageWidthExpression: '20 mm',
  fillImageHeightExpression: '20 mm',
  strokeExpression: 'basic/Wood/Dark_Walnut.jpg',
  strokeImageWidthExpression: '20 mm',
  strokeImageHeightExpression: '6 mm',
};
if (transformed) {
  drawing.classes[0].properties.strokeOpacityExpression = '50';
  drawing.extensions.stacks.stacks[1].frame.rotation = 25;
}
await writeFile(`${output}/fixture.paramagic`, JSON.stringify(drawing, null, 2));
const browser = await chromium.launch({ headless: true, channel: 'msedge' });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.goto(process.env.PRINT_AUDIT_URL || 'http://127.0.0.1:5180/ParaMagic/');
  await page.locator('#openDrawingFileInput').setInputFiles(`${output}/fixture.paramagic`);
  await page.waitForFunction(() => document.querySelectorAll('pattern image').length > 5);
  await page.evaluate(async () => {
    const urls = [...new Set([...document.querySelectorAll('pattern image')].map(n => n.getAttribute('href')))];
    await Promise.all(urls.map(src => new Promise((resolve, reject) => {
      const image = new Image(); image.onload = resolve; image.onerror = reject; image.src = src;
    })));
    window.print = () => { window.__printCalled = true; window.__handoffMs = performance.now() - window.__printStart; };
  });
  await page.keyboard.press('Control+p');
  await page.locator('.print-preview-svg').waitFor();
  await page.locator('.print-preview-page').screenshot({ path: `${output}/preview.png` });
  await page.evaluate(() => { window.__printStart = performance.now(); });
  await page.locator('.print-confirm').click();
  await page.waitForFunction(() => window.__printCalled === true);
  assert.equal(await page.evaluate(() => window.__printCalled), true);
  const references = await page.locator('.print-output-root svg').evaluate(svg => {
    const ids = new Set([...svg.querySelectorAll('[id]')].map(n => n.id));
    const missing = [];
    const outside = [];
    for (const node of svg.querySelectorAll('*')) {
      for (const attr of node.attributes) {
        for (const match of attr.value.matchAll(/url\(\s*['"]?#([^\s)'"\u0020]+)['"]?\s*\)/g)) {
          if (!ids.has(match[1])) missing.push(match[1]);
          if (!svg.contains(document.getElementById(match[1]))) outside.push(match[1]);
        }
      }
    }
    return {
      missing: [...new Set(missing)], outside: [...new Set(outside)], patterns: svg.querySelectorAll('pattern').length,
      strokeImages: svg.querySelectorAll('[data-print-image-stroke]').length,
      strokePatterns: svg.querySelectorAll('.image-stroke-brush pattern').length,
      handoffMs: window.__handoffMs,
    };
  });
  if (transformed) {
    await page.evaluate(() => {
      window.__referenceOutput = document.querySelector('.print-output-root').cloneNode(true);
      const svg = document.querySelector('.print-preview-svg').cloneNode(true);
      const ids = new Map([...svg.querySelectorAll('[id]')].map(node => [node.id, `reference-${node.id}`]));
      for (const node of svg.querySelectorAll('*')) {
        if (ids.has(node.id)) node.id = ids.get(node.id);
        for (const attr of [...node.attributes]) {
          const value = attr.value.replace(/url\(#([^)]*)\)/g, (all, id) => ids.has(id) ? `url(#${ids.get(id)})` : all);
          if (value !== attr.value) node.setAttribute(attr.name, value);
        }
      }
      window.__referenceOutput.querySelector('svg').replaceWith(svg);
    });
  }
  await page.emulateMedia({ media: 'print' });
  await page.locator('.print-output-page').screenshot({ path: `${output}/print.png` });
  const pdfStart = performance.now();
  const pdf = await page.pdf({ path: `${output}/print.pdf`, preferCSSPageSize: true, printBackground: false });
  references.pdfMs = Math.round(performance.now() - pdfStart);
  references.pdfBytes = (await stat(`${output}/print.pdf`)).size;
  references.pages = (await PDFDocument.load(pdf)).getPageCount();
  await writeFile(`${output}/references.json`, JSON.stringify(references, null, 2));
  console.log(JSON.stringify(references));
  assert.ok(references.patterns > 0 && references.patterns <= 4);
  assert.equal(references.strokeImages, transformed ? 3 : 2);
  assert.equal(references.strokePatterns, 0);
  assert.equal(references.pages, 1);
  assert.deepEqual(references.missing, [], 'Printed image paints must have definitions in the output SVG');
  assert.deepEqual(references.outside, [], 'Printed paint references must resolve inside the output SVG');
  if (transformed) {
    await page.evaluate(() => document.body.append(window.__referenceOutput));
    await page.locator('.print-output-page').screenshot({ path: `${output}/reference.png` });
    await page.evaluate(() => window.__referenceOutput.remove());
  }
  if (process.env.PRINT_AUDIT_ALL_PAGES === '1') {
    const layouts = [];
    for (const { id } of PRINT_PAGE_SIZES) {
      for (const orientation of ['portrait', 'landscape']) {
        const started = performance.now();
        await page.emulateMedia({ media: 'screen' });
        await page.locator('.print-page-size').selectOption(id);
        await page.locator(`[data-print-orientation="${orientation}"]`).click();
        await page.evaluate(() => { window.__printCalled = false; window.__printStart = performance.now(); });
        await page.locator('.print-confirm').click();
        await page.waitForFunction(() => window.__printCalled);
        const handoffMs = await page.evaluate(() => window.__handoffMs);
        console.log(`${id} ${orientation}: prepared in ${Math.round(handoffMs)} ms`);
        assert.equal(await page.locator('.print-output-root').count(), 1);
        await page.emulateMedia({ media: 'print' });
        const pdf = await PDFDocument.load(await page.pdf({ preferCSSPageSize: true, printBackground: false }));
        const layout = printLayout(id, orientation);
        assert.equal(pdf.getPageCount(), 1, `${id} ${orientation} must produce one page`);
        const size = pdf.getPage(0).getSize();
        assert.ok(Math.abs(size.width - layout.mmWidth * 72 / 25.4) < 1);
        assert.ok(Math.abs(size.height - layout.mmHeight * 72 / 25.4) < 1);
        layouts.push({ id, orientation, pages: pdf.getPageCount(), handoffMs, totalMs: Math.round(performance.now() - started), ...size });
        console.log(`${id} ${orientation}: 1 page (${Math.round(performance.now() - started)} ms total)`);
      }
    }
    await writeFile(`${output}/page-counts.json`, JSON.stringify(layouts, null, 2));
  }
} finally {
  await browser.close();
}
