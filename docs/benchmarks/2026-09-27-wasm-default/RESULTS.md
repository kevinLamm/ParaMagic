# WASM browser default — September 27, 2026

The normal application Worker now selects WASM without a URL flag. The change
belongs to `solverBackendFromEnvironment` in the core's execution facade.
`?solverBackend=javascript` keeps the reference path selectable; `?solverBackend=wasm`
continues to work. Valid host overrides still take precedence. Unknown or absent
values select WASM. No solver mathematics, convergence tolerance, document format,
native binary or image processing changed in this step.

## Why JavaScript remains

The JavaScript solver is the independent correctness oracle and the fallback for
native loading or unsupported component preparation. The existing application also
uses its local controller for synchronous transactions and document state. Removing
it would remove these functions and is not needed to make WASM the default.
Normal Worker operation does not enable shadow comparison or solve every edit
with both backends. The explicit synchronous mode remains JavaScript.

Faster execution does not guarantee nonlinear convergence. Both implementations
can stall on difficult systems; they share the continuation/convergence changes.
JavaScript fallback is not a promise of WASM performance, nor a mechanism that
automatically solves every native numerical failure.

## Validation

Windows, Chrome 153.0.8010.53, Intel Core Ultra 9 275HX:

| Rendered path | Checks passed | Actual backend for all three edits |
| --- | ---: | --- |
| Default, no URL flag, client assets | 58 | WASM |
| Explicit JavaScript URL override, client assets | 51 | JavaScript |
| Default, Pages assets under `/ParaMagic/` | 58 | WASM |
| Default, WASM download deliberately returns HTTP 503 | 52 | JavaScript |

Each path loads the supplied `TestFrontView.paramagic` regression fixture and edits
its visible c1 control from 50 to 85, uses Undo/Redo, edits back to 50 and again to
85, then performs a serialized reload. The checks cover visible control values,
changed SVG geometry, all 193 enabled constraints, released temporary locks,
reference residual below 1e-8, and absence of the stall message. WASM paths also
verify native Stack solving and native Swell display reuse. Startup messages prove
that the default requests WASM rather than silently selecting JavaScript.

The loading-failure case verifies `wasmInitializationError: "WASM solver download
failed: 503"` and successful JavaScript results in the same Worker. The largest
reference residual in that case was 9.68333e-9. That particular original c1 failure
does not recur in the tested fallback path. Native traps and every possible
resource failure were not exercised by this test.

The rendered harness loads application source through Vite and the actual emitted
Worker/WASM assets. It uses a separate browser profile and does not alter the
user's open drawing. Default and fallback screenshots were visually inspected.

- Full suite: **1,257 passed**, zero failed (`tests.txt`).
- Client and Pages builds pass; existing bundle-size warnings remain.
- No end-user install, special headers, shared memory, GPU or server solving.
- Trace Region already uses its OpenCV WASM Worker by default and is unchanged here.

This is local validation of the default switch, not a hosted release or a claim
that every browser or 100,000-constraint system has been validated. Safari, Firefox,
macOS/Linux browser checks and the outstanding large-system convergence tests
remain separate release validation work. Releasing requires including the core
changes, native asset/build manifest and application changes in the normal build
and deployment workflow. Nothing was published in this task.

## Repeat

```sh
npm test
npm run build
npm run build:pages
node scripts/solver-baseline/run-browser.mjs --front-app-only=true --front-backends=default,javascript --front-samples=1 --built=client --output=docs/benchmarks/2026-09-27-wasm-default/client
node scripts/solver-baseline/run-browser.mjs --front-app-only=true --front-backends=default --front-samples=1 --built=pages --output=docs/benchmarks/2026-09-27-wasm-default/pages
node scripts/solver-baseline/run-browser.mjs --front-app-only=true --front-backends=default --front-samples=1 --built=client --fail-wasm-load=true --output=docs/benchmarks/2026-09-27-wasm-default/fallback
```
