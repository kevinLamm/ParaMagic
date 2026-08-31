import { readFileSync, readdirSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
const required = [
  'index.html',
  'src/main.js',
  'src/app-config.js',
  'packages/paramagic-core/package.json',
  'packages/paramagic-core/src/index.js',
  'packages/paramagic-core/src/editor.js',
  'packages/paramagic-core/src/images.js',
  'packages/paramagic-core/src/modules/config.js',
  'packages/paramagic-core/src/modules/infiniteCanvas.js',
  'packages/paramagic-core/src/modules/solver/SolverController.js',
  'packages/paramagic-core/src/modules/solver/ParameterRepository.js',
  'packages/paramagic-core/src/modules/solver/NumericSolverCore.js',
  'src/styles/app.css',
  'src/assets/ParaMagic-Logo.svg',
  'src/assets/BasicImageCatalog/catalog.json',
];
for (const file of required) {
  statSync(file);
  const text = readFileSync(file, 'utf8');
  if (!text.trim()) throw new Error(`${file} is empty`);
}
const html = readFileSync('index.html', 'utf8');
if (!html.includes('/src/main.js')) throw new Error('index.html does not load the application entry point');

function javascriptFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return javascriptFiles(path);
    return entry.isFile() && entry.name.endsWith('.js') ? [path] : [];
  });
}

const sources = [
  ...javascriptFiles('src'),
  ...javascriptFiles('packages/paramagic-core/src'),
  ...javascriptFiles('scripts'),
];
sources.forEach((file) => {
  const check = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (check.status !== 0) throw new Error(`JavaScript syntax check failed for ${file}:\n${check.stderr}`);
});

const normalizedPath = (file) => file.replaceAll('\\', '/');
const productionSources = [
  ...javascriptFiles('packages/paramagic-core/src'),
  ...javascriptFiles('src').filter((file) => !normalizedPath(file).includes('/tests/')),
];
const identityAuthority = 'packages/paramagic-core/src/modules/IdentitySystem.js';
const legacyBoundaryOwners = new Map([
  ['stack-default', new Set(['packages/paramagic-core/src/modules/StackArchitecture.js'])],
  ['class-x', new Set(['packages/paramagic-core/src/modules/ClassSystem.js'])],
  ['__paramagic_canvas_origin__', new Set(['packages/paramagic-core/src/modules/CanvasOrigin.js'])],
  ['array-derived:', new Set(['packages/paramagic-core/src/modules/ArrayTools.js'])],
  ['duplicate-derived:', new Set(['packages/paramagic-core/src/modules/SymmetricTool.js'])],
  ['symmetric-derived:', new Set(['packages/paramagic-core/src/modules/SymmetricTool.js'])],
]);

productionSources.forEach((file) => {
  const path = normalizedPath(file);
  const source = readFileSync(file, 'utf8');
  if (/\bcreateStableId\b/.test(source)) throw new Error(`Legacy createStableId usage is prohibited in ${path}.`);
  if (/\bMath\.random\s*\(/.test(source)) throw new Error(`Math.random identity fallback is prohibited in ${path}.`);
  if (/\b(?:requestId|nextRequestId|pickerId|slotId)\b/.test(source)) {
    throw new Error(`Ambiguous external/platform identifier naming is prohibited in ${path}.`);
  }
  if (path !== identityAuthority && /\b(?:crypto\.)?(?:randomUUID|getRandomValues)\s*\(/.test(source)) {
    throw new Error(`Secure UUID generation outside IdentitySystem.js is prohibited in ${path}.`);
  }
  if (/\bfunction\s+\w*Id\s*\(\s*(?:prefix|type|kind|name)\b/.test(source)) {
    throw new Error(`Prefix-taking ID factory is prohibited in ${path}.`);
  }
  if (/\bid\s*:\s*[`'"][^`'"]*(?:component:|intrinsic:|cycle:|array-derived:|duplicate-derived:|symmetric-derived:|seam-line-v2:|subtract-result:|document:)/.test(source)) {
    throw new Error(`Encoded semantic value assigned to an id field in ${path}.`);
  }
  legacyBoundaryOwners.forEach((owners, token) => {
    if (source.includes(token) && !owners.has(path)) {
      throw new Error(`Legacy identity token ${JSON.stringify(token)} is outside its migration boundary in ${path}.`);
    }
  });
});

const requiredIdentitySchemas = [
  'arrayTools',
  'controls',
  'linkedCopyTools',
  'notchTools',
  'seamLines',
  'stackRelationships',
  'swell',
];
const drawingIO = await import('../packages/paramagic-core/src/modules/DrawingIO.js');
const drawingIdentity = await import('../packages/paramagic-core/src/modules/DrawingIdentitySystem.js');
const registeredIdentitySchemas = new Set(drawingIdentity.registeredIdentitySchemaKeys());
requiredIdentitySchemas.forEach((key) => {
  if (!registeredIdentitySchemas.has(key)) throw new Error(`Required extension identity schema ${key} is not registered.`);
});
const identitySmokeDrawing = drawingIO.normalizeDrawingData({});
drawingIO.serializeDrawingJson(identitySmokeDrawing, 'UUID build audit');

console.log(`Validated ${required.length} required files, syntax-checked ${sources.length} JavaScript files, audited ${productionSources.length} production files, and verified ${requiredIdentitySchemas.length} extension UUID schemas.`);
