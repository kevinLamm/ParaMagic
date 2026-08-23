import assert from 'node:assert/strict';
import test from 'node:test';
import { drawingBrowserTitle, resolvePublicResourceUrl } from '../app-config.js';

test('drawing browser titles include the current drawing name', () => {
  assert.equal(drawingBrowserTitle('Part1'), 'ParaMagic - Part1');
  assert.equal(drawingBrowserTitle(''), 'ParaMagic - Untitled Drawing');
});

test('public resource URLs honor a repository deployment base path', () => {
  assert.equal(
    resolvePublicResourceUrl('BasicImageCatalog/catalog.json', {
      baseUrl: '/ParaMagic/',
      origin: 'https://kevinlamm.github.io',
    }),
    'https://kevinlamm.github.io/ParaMagic/BasicImageCatalog/catalog.json',
  );
  assert.equal(
    resolvePublicResourceUrl('/BasicImageCatalog/', {
      baseUrl: '/',
      origin: 'https://paramagic.example',
    }),
    'https://paramagic.example/BasicImageCatalog/',
  );
});
