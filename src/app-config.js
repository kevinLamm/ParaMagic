export const imageCatalogResources = Object.freeze({
  manifestUrl: new URL('/BasicImageCatalog/catalog.json', globalThis.location?.origin || import.meta.url).href,
  assetBaseUrl: new URL('/BasicImageCatalog/', globalThis.location?.origin || import.meta.url).href,
});

export const openCvResources = Object.freeze({
  scriptUrl: new URL('../node_modules/@techstark/opencv-js/dist/opencv.js', import.meta.url).href,
});

export function drawingBrowserTitle(name = 'Untitled Drawing') {
  const drawingName = String(name ?? '').trim() || 'Untitled Drawing';
  return `ParaMagic - ${drawingName}`;
}
