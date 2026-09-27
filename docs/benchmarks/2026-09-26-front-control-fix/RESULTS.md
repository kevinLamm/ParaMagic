# TestFrontView: c1 50 → 85 convergence regression

## Finding and correction

The supplied drawing contains 68 entities and 193 constraints. Five equations
reference derived Swell pieces. Selecting WASM currently sends their connected
component to the JavaScript reference solver, with the diagnostic
`Native derived provider swell is not supported.` This edit therefore does not
measure a WASM speedup.

The original implementation reproduced the reported stall and rollback to 50.
Its continuation corrector accepted a step that reduced the error, then declared
stagnation because the squared coordinate step was below `1e-18`. One failing
attempt started at squared residual `1.1179601483285668e-16`, just above the
cross-stack convergence threshold of `1e-16`. Halving the continuation increment
could not remedy that premature stopping rule.

Both JavaScript and native LM now continue after an improving small correction.
Final residual tolerance is unchanged. Failed improvement still terminates at
the existing damping limit; iteration, cancellation and time budgets still
apply. Geometry restoration on unsuccessful final solves is unchanged. No
constraint, parameter expression, Jacobian formula or permanent lock was added
or removed.

## Browser evidence

The actual app loaded the supplied file, edited Overall Width through the
Controls panel, rendered the resulting geometry, and exercised undo, redo,
repeated edits and serialized reload. Both selected backend modes passed all
44 assertions. Every accepted drawing retained all 193 enabled constraints,
released temporary locks, and needed no correction when checked through the
reference model. Its residual norm was below `1e-8`.

Single-run control-event-to-render timings (including worker communication and
two animation frames; excluding reference validation):

| Selected mode | Edit | Actual backend | Time | Final residual L2 |
|---|---|---|---:|---:|
| JavaScript | 50 → 85 | JavaScript | 1,015 ms | 6.70e-9 |
| JavaScript | 85 → 50 | JavaScript | 1,198 ms | 5.35e-9 |
| JavaScript | 50 → 85 again | JavaScript | 791 ms | 9.68e-9 |
| WASM | 50 → 85 | JavaScript fallback | 1,154 ms | 9.52e-9 |
| WASM | 85 → 50 | JavaScript fallback | 1,165 ms | 8.00e-9 |
| WASM | 50 → 85 again | JavaScript fallback | 755 ms | 8.38e-9 |

Environment: Chrome 153.0.8010.53, Windows, Intel Core Ultra 9 275HX.
These are regression observations, not a statistically controlled speed comparison.
The existing mixed-constraint rendered workflow also passed its 17 assertions
using the native Worker.

- [Final browser data and source hashes](verified-final/browser-baseline.json)
- [Rendered drawing with WASM selected](verified-final/front-app-wasm.png)
- [Rendered drawing with JavaScript selected](verified-final/front-app-javascript.png)
- [Full test suite: 1,215 passed](tests.txt)
- [Application build](build.txt) and [Pages build](build-pages.txt)

The new unit tests cover the original file, repeated edits, retained expressions,
constraint satisfaction, released locks and reload. Small-correction tests cover
both numerical kernels; the existing true-stagnation/rollback tests still pass.

Reproduce:

```powershell
node --test src/tests/frontViewControlSolver.test.js src/tests/solverCore.test.js src/tests/wasmSolver.test.js
node scripts/solver-baseline/run-browser.mjs --front-app-only=true --output=tmp/front-control-browser
```

The local server at port 5173 was checked after the update: it serves the
corrected JavaScript and the rebuilt 76,564-byte WASM binary. Reloading the app
recreates the Worker with those files. Full native Swell solving remains outside
this correction and is still unsupported.
