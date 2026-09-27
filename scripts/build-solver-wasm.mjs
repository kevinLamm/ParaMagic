import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const source = resolve(root, 'packages/paramagic-core/native/solver.cpp');
const output = resolve(root, 'packages/paramagic-core/src/modules/solver/wasm/solver.wasm');
const manifestPath = output.replace(/\.wasm$/, '.build.json');
const flags = ['--target=wasm32-unknown-unknown', '-std=c++17', '-O3', '-nostdlib', '-fno-exceptions', '-fno-rtti',
  '-fno-builtin', '-ffp-contract=off', '-fno-fast-math', '-Wl,--no-entry', '-Wl,--export-memory',
  '-Wl,--initial-memory=131072', '-Wl,--max-memory=1073741824', '-Wl,-z,stack-size=65536',
  ...['configure', 'buffer', 'sparse_buffer', 'begin', 'advance', 'cancel', 'linearize', 'abi_version', 'graph_configure', 'graph_buffer', 'graph_components', 'expression_configure', 'expression_buffer', 'expression_evaluate', 'continuation_configure', 'continuation_buffer', 'continuation_reset', 'continuation_accept', 'continuation_checkpoint', 'continuation_restore', 'continuation_predict', 'swell_export', 'swell_export_buffer'].map(name => `-Wl,--export=${name}`)];
const hash = data => createHash('sha256').update(data).digest('hex');
// Git may check out CRLF on Windows and LF in CI. Line endings do not change
// the native program and must not force users to install a compiler.
const sourceForHash = [source, ...['constraint_program.h', 'swell_geometry.h', 'sparse_elimination.h', 'graph_kernel.h', 'parameter_kernel.h', 'continuation.h'].map(name => resolve(dirname(source), name))]
  .map(path => readFileSync(path, 'utf8').replaceAll('\r\n', '\n')).join('\n');
const inputHash = hash(Buffer.concat([Buffer.from(sourceForHash), Buffer.from(JSON.stringify(flags))]));
const previous = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : null;
if (!process.argv.includes('--force') && previous?.inputSha256 === inputHash && existsSync(output)
    && previous.wasmSha256 === hash(readFileSync(output))) {
  console.log(`Verified ParaMagic WASM (${previous.bytes} bytes, ABI ${previous.abiVersion}).`);
} else {
  const executable = process.platform === 'win32' ? 'clang++.exe' : 'clang++';
  const compiler = process.env.WASM_CXX || (process.env.WASI_SDK_PATH && resolve(process.env.WASI_SDK_PATH, 'bin', executable))
    || resolve(root, `tmp/wasm-toolchain/wasi-sdk-27.0-${process.platform === 'win32' ? 'x86_64-windows' : process.platform === 'darwin' ? `${process.arch === 'arm64' ? 'arm64' : 'x86_64'}-macos` : 'x86_64-linux'}/bin/${executable}`);
  if (!existsSync(compiler)) throw new Error('Native source changed: set WASM_CXX or WASI_SDK_PATH to a WebAssembly-capable clang++ compiler. See packages/paramagic-core/native/README.md.');
  mkdirSync(dirname(output), { recursive: true });
  // Link the SDK's CPU math functions. Only used objects are retained, and the
  // import check below ensures no WASI or JavaScript runtime is pulled in.
  const libc = resolve(dirname(compiler), '../share/wasi-sysroot/lib/wasm32-wasi/libc.a');
  const result = spawnSync(compiler, [...flags, source, libc, '-o', output], { stdio: 'inherit', windowsHide: true });
  if (result.status !== 0) throw new Error(`WASM compilation failed (${result.error?.message || result.status}).`);
  const binary = readFileSync(output);
  const module = await WebAssembly.compile(binary);
  if (WebAssembly.Module.imports(module).length) throw new Error('Solver binary must not import JS functions or WASI.');
  writeFileSync(manifestPath, JSON.stringify({ abiVersion: 4, inputSha256: inputHash, wasmSha256: hash(binary),
    bytes: binary.length, compiler: spawnSync(compiler, ['--version'], { encoding: 'utf8', windowsHide: true }).stdout.split('\n')[0].trim(), flags }, null, 2) + '\n');
  console.log(`Built ParaMagic WASM (${binary.length} bytes; no imports).`);
}
