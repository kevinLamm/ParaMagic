import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { isImageFillReference } from '../../packages/paramagic-core/src/modules/ImageSystem.js';

const catalogRoot = join(dirname(fileURLToPath(import.meta.url)), '../assets/BasicImageCatalog');
const supportedExtensions = new Set(['.jpg', '.jpeg', '.png', '.webp']);

function supportedImageReferences(directory = catalogRoot) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return supportedImageReferences(path);
    if (!entry.isFile() || !supportedExtensions.has(extname(entry.name).toLowerCase())) return [];
    return [`basic/${relative(catalogRoot, path).replaceAll('\\', '/')}`];
  });
}

test('the developer catalog manifest lists every supported built-in image exactly once', () => {
  const manifest = JSON.parse(readFileSync(join(catalogRoot, 'catalog.json'), 'utf8'));
  assert.equal(manifest.version, 1);
  assert.ok(Array.isArray(manifest.assets));
  assert.equal(new Set(manifest.assets).size, manifest.assets.length);
  manifest.assets.forEach((reference) => {
    assert.equal(isImageFillReference(reference), true, reference);
    const path = join(catalogRoot, reference.slice('basic/'.length));
    assert.ok(statSync(path).size > 0, reference);
  });
  assert.deepEqual([...manifest.assets].sort(), supportedImageReferences().sort());
});
