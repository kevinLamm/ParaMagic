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
console.log(`Validated ${required.length} required files and syntax-checked ${sources.length} JavaScript files.`);
