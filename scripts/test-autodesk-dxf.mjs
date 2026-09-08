import { spawnSync } from 'node:child_process';
import {
  existsSync, mkdtempSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAutodeskDxfFixture } from './generate-autodesk-dxf-fixture.mjs';

const configuredConsole = process.env.AUTOCAD_CORE_CONSOLE;
const installedConsole = [
  configuredConsole,
  ...Array.from(
    { length: 16 },
    (_, index) => `C:\\Program Files\\Autodesk\\AutoCAD ${2030 - index}\\accoreconsole.exe`,
  ),
].filter(Boolean).find(existsSync);

if (!installedConsole) {
  throw new Error(
    'AutoCAD Core Console was not found. Install AutoCAD or set AUTOCAD_CORE_CONSOLE to accoreconsole.exe.',
  );
}

const auditScript = fileURLToPath(new URL('./autodesk-dxf-audit.scr', import.meta.url));
const auditDirectory = mkdtempSync(join(tmpdir(), 'paramagic-autodesk-dxf-'));
const fixturePath = join(auditDirectory, 'ParaMagic-All-Geometry-Autodesk-Test.dxf');

const decodeConsoleOutput = (value) => {
  if (!Buffer.isBuffer(value)) return String(value || '');
  const hasUtf16Nulls = value.length > 3 && value[1] === 0 && value[3] === 0;
  return value.toString(hasUtf16Nulls ? 'utf16le' : 'utf8').replaceAll('\0', '');
};

try {
  const rotation = process.env.PARAMAGIC_DXF_TEST_ROTATION;
  writeFileSync(fixturePath, createAutodeskDxfFixture(rotation === undefined ? {} : {
    frame: { x: 100, y: 50, rotation: Number(rotation) },
  }), 'utf8');
  const result = spawnSync(installedConsole, [
    '/i', fixturePath,
    '/s', auditScript,
    '/l', 'en-US',
  ], {
    cwd: auditDirectory,
    encoding: 'buffer',
    timeout: 120_000,
    windowsHide: true,
  });
  const output = `${decodeConsoleOutput(result.stdout)}\n${decodeConsoleOutput(result.stderr)}`;
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`AutoCAD Core Console exited with code ${result.status}.\n${output}`);
  }
  if (!/Total errors found\s+0\s+fixed\s+0/i.test(output)) {
    throw new Error(`AutoCAD did not report a clean DXF audit.\n${output}`);
  }
  console.log('Autodesk DXF audit passed: Total errors found 0 fixed 0.');
} finally {
  rmSync(auditDirectory, { recursive: true, force: true });
}
