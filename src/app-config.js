export function resolvePublicResourceUrl(
  path,
  {
    baseUrl = '/',
    origin = globalThis.location?.origin || import.meta.url,
  } = {},
) {
  const publicRoot = new URL(baseUrl, origin);
  return new URL(String(path).replace(/^\/+/, ''), publicRoot).href;
}

const publicBaseUrl = import.meta.env?.BASE_URL || '/';

export const imageCatalogResources = Object.freeze({
  manifestUrl: resolvePublicResourceUrl('BasicImageCatalog/catalog.json', { baseUrl: publicBaseUrl }),
  assetBaseUrl: resolvePublicResourceUrl('BasicImageCatalog/', { baseUrl: publicBaseUrl }),
});

export const openCvResources = Object.freeze({
  scriptUrl: new URL('../node_modules/@techstark/opencv-js/dist/opencv.js', import.meta.url).href,
});

export function drawingBrowserTitle(name = 'Untitled Drawing') {
  const drawingName = String(name ?? '').trim() || 'Untitled Drawing';
  return `ParaMagic - ${drawingName}`;
}
