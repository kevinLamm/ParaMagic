# Solver baseline harness

Run from the repository root:

```powershell
npm run benchmark:solver:browser
node scripts/solver-baseline/summarize.mjs
node --test src/tests/solverBaseline.test.js
```

The suite runs production JavaScript in installed Chrome/Edge through a local Vite server. Node drives browser measurement only; all numerical work in this suite executes in the browser. No Python, server-side solving, or GPU solving is used.

- `fixtures.js`: connected line models with exact requested constraint counts and closed-form coordinate checks.
- `measure.js`: numerical, derivative, sparse/dense assembly, graph, parameter and serialization diagnostics.
- `browser.js`: real Worker controller and transport cases.
- `render.js`: production canvas geometry application, isolated from solving.
- `run-browser.mjs`: fresh browser realms, bounded runs, raw JSON, CPU and allocation profiles, renderer screenshots.
- `summarize.mjs`: Markdown report from recorded JSON.

See [the experiment report](../../docs/WASM_SOLVER_EXPERIMENT.md) for scope, source inspection, methodology, limitations, next-stage architecture and deployment requirements. The existing JS implementation remains the correctness oracle. This harness does not implement WASM.

Options use `--name=value`:

| Option | Default |
| --- | --- |
| `counts` | `1000,5000,10000,25000,50000,100000` constraints |
| `samples` | `3` per shared-dimension scale |
| `budget-ms` | `5000` for each numeric solve |
| `auxiliary` | `true`; use `false` for numerical/phase runs only |
| `profile-count` | `5000`; use `0` to disable profiling |
| `worker-only` | `false` |
| `render-only` | `false` |
| `render-counts` | `333,1000,1666` entities |
| `browser` | Installed Chrome/Edge, or `CHROME_PATH` |
| `output` | `docs/benchmarks/2026-09-26-wasm-baseline` |

Use a different output directory to retain previous runs. The runner overwrites JSON/profile/PNG files in its chosen output directory. A solver timeout is a valid measured result; a harness error is recorded separately and gives a nonzero exit code. Noncancellable Worker/render diagnostics have an external deadline and their isolated tab is closed if they overrun. The full suite can take several minutes; renderer loading and expression evaluation are intentionally measured as well as the solver.

For interactive inspection, start `npm run dev` and open `/scripts/solver-baseline/` on that local server. The button runs the first-panel-only edit; the automated scale suite uses one shared dimension. Both preserve production residual semantics and record coordinate error separately.
