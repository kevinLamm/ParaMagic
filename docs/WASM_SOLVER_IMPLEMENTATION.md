# Persistent WASM solver experiment

## Use it

Run `npm run dev` and open the application normally. **WASM is the default browser
Worker backend.** The normal Worker mode must remain enabled.
`?solverBackend=javascript` explicitly selects the retained reference implementation;
`?solverBackend=wasm` remains supported but is no longer required.
There is no end-user installation, server solving, GPU solving or shared memory.

The numerical backend is implemented and integrated with the existing Worker,
dimension editor and controller transactions. All 25 registered constraint types
now have native implementations, including references to derived Swell geometry.
This default change does not remove JavaScript: reference comparisons, fallback,
local synchronous transactions and the document/controller layer still use it.
If the native module cannot load, the Worker uses JavaScript and includes
`wasmInitializationError` in its response diagnostics. Native coverage fallbacks
remain available. Neither backend runs continuously while idle.
Browser-platform validation beyond the measured Windows/Chrome workflows remains
open validation work. The large-system linear-solving experiment has been
rolled back at the user's request, including its topology compiler, native
capacity and damping changes, opt-in API, and experiment-specific harness.
The earlier WASM backend remains the default. Historical measurements and the
rollback record remain in `docs/benchmarks/2026-09-27-large-linear/`.
This rollback does not establish that the reported Collinear failure is fixed.

## What moved

The measured hot path was matrix-free linear solving, including very frequent
JavaScript clock checks. The C++ module now owns the LM and PCG loops, residuals,
analytical derivatives, CSR row offsets/columns/values, entity preconditioner,
coordinates, numeric targets, accepted solution, and reusable scratch storage.
All numerical values are Float64. No dense Jacobian or full dense normal matrix
is allocated. The small dense preconditioner blocks have at most eight columns.

The JavaScript adapter keeps at most eight component sessions. Repeated numeric
edits update the packed values and warm-start from accepted coordinates. They
do not rebuild CSR topology or grow native memory. Geometry, references, active
variables, constraint additions/removals and enable changes invalidate topology.
The existing JS model remains the document/Worker replica. It is not rebuilt per
iteration, and there are no per-constraint calls across the WASM boundary.

The additional core pipeline now runs numeric/Boolean parameter programs,
connected-component labeling, Stack frame solving, bounded sparse LDLᵀ
factorization, and numeric continuation history/checkpoints in WASM. A native
Swell display packet reuses native construction in the drawing tools. See the
[core pipeline results](benchmarks/2026-09-26-wasm-core/RESULTS.md).

JavaScript retains expression parsing, symbol/unit resolution, string/error
semantics, graph metadata and scope selection, transaction orchestration,
annotations, document rollback/history, serialization and rendering. These
remain separate costs. The reference implementations remain selectable.
Numeric packing writes changed slots; a transaction-scoped topology token
avoids repeated signature construction during nonstructural continuation
steps. Ordinary edits still validate compatibility. The Worker/document model
is still JavaScript, so this does not remove all scanning or copying.

### Native coverage

The original direct kernels support:

- Coincident, Horizontal, Vertical and Fixed point constraints.
- Distance, Horizontal Distance and Vertical Distance.
- Radius, Diameter, Midpoint, Concentric and Point-on Circle.

The expanded native evaluation layer also supports:

- Parallel, Perpendicular, Collinear and Point-on Line.
- Point Line Distance, Line Line Distance, Equal and Length.
- Tangent, including internal/external circles, line/arc contacts, orientation
  branches and the three-equation joined-arc case.
- Point-on Arc, Point-on Fillet, Angle and Meta.
- Arc intrinsic equations, averaged endpoint radii, winding, arc lengths,
  stored middle points and midpoint anchors. Exact diameter chords retain the
  reference's temporary center reduction and radius branch seeding.
- Polygon/rectangle, polyline and table segments; curve control points;
  text/control anchors; intermediate segment points; global frame transforms.
- Derived fillets with line, curve and arc source combinations. Candidate
  selection and validity checks run in WASM as the source geometry changes.
- Swell offsets, transition arcs, signed offsets, transition scaling, joined
  endpoints, cycle/composite outward normals, circles, arcs, sampled curves and
  polygon/rectangle/polyline segments. Derived selectors resolve in native code.

JavaScript compiles extended equations into packed instruction arrays when
topology changes. C++ evaluates these arrays and computes analytical derivatives
by reverse differentiation; the results feed the persistent CSR Jacobian.
No JavaScript expression interpreter or geometry callback runs during iterations.
Basic line/point/circle constraints retain their direct C++ kernels.

Nondifferentiable branches retain local central differences inside WASM. Angle,
Meta and global relationships also retain the reference's numerical derivative
policy. Existing analytical derivatives have not been replaced wholesale.

The persistent native Swell evaluator uses packed source references, definitions,
endpoint connections, feature requests and resident scratch arrays. Its numerical
derivatives preserve the JavaScript reference policy and run entirely in WASM.
The native `fallbackBlocks` statistic counts native finite differences; it does
not mean JavaScript was called. Unsupported inputs still use the complete JS
reference with an explicit `fallbackReason`; no equation is silently omitted.

### Persistent Worker and revisions

The existing commands still own geometry/constraint creation, deletion, enable
changes, expressions, parameters and dragging. There is no second drawing API.
Worker initialization loads one module and creates resident component sessions.
No background solve or timer continues once the work has completed.

Controller transactions now share a generator implementation with synchronous
and asynchronous drivers. This preserves dimension continuation, rollback and
temporary gauge cleanup while letting native dimension/parameter solves pause.
The native module retains LM and PCG state between work chunks. A timer turn
after approximately 16 ms of work lets Worker control messages run; one sparse
pass can exceed this target on very large systems. Parameter/graph processing
and unsupported JavaScript solving are still synchronous Worker work.

Consecutive dimension edits to the same target coalesce. Caller-declared
parameter coalescing is also supported. Structural changes and different
targets remain ordered barriers. Obsolete supported solves unwind and restore
their transaction before the newest mutation runs. Responses include the
monotonic request revision; a completed obsolete response is hidden, with any
already-committed delta carried into the next accepted response. The facade's
existing mutation journal remains the document revision owner.

The existing drag policy is retained: bounded previews, then normal final
tolerance at drag end, including rejection/rollback of unacceptable previews.
Drag transactions use the native synchronous kernel within the Worker; rapid
drag events retain the existing queue coalescing and stale-generation filtering.

## Measurements

The [Swell report](benchmarks/2026-09-26-wasm-swell/RESULTS.md) measures the supplied
`TestFrontView` file in the actual browser app. Its `c1: 50 → 85` edit now uses
the native Worker, including all Swell equations, at the existing cross-stack
residual tolerance of `1e-8`. Worker processing and control-to-render time are
reported separately.

See [expanded coverage results](benchmarks/2026-09-26-wasm-coverage/RESULTS.md).
The earlier twelve-type experiment has [paired browser results](benchmarks/2026-09-26-wasm-native/RESULTS.md) and
[raw measurements](benchmarks/2026-09-26-wasm-native/browser-baseline.json).
The original inspection, profiles, graph/expression costs and separate render
measurements remain in [the baseline report](WASM_SOLVER_EXPERIMENT.md).

In the earlier twelve-type experiment, the same-Chrome 1,000-constraint connected chain completed with identical
coordinates and residuals in both backends across three edits. All 333 panels
moved on the first edit. The final comparison measured 14.7–14.9x faster
completed numerical solves. This includes a packed representation
and removal of per-block clock calls; it does not isolate a language-only speedup.

At 5,000–100,000 constraints both implementations still exceeded the five-second
final convergence budget. Two-iteration preview comparisons quantify throughput
only, and their residuals are above final tolerance. They must not be described
as completed large-model solves. The retained PCG/preconditioner still converges
slowly on a very long chain. Multi-core work is deferred until that algorithmic
limit is addressed and the remaining constraint coverage is tested.

The production tolerance is unchanged: residual L2 below `1e-3` unless the
caller requests a stricter tolerance. Normalized residuals on long systems do
not guarantee a tiny absolute coordinate error: the 1,000-constraint fixture
still differs from its exact solution by about 0.663 model units, identically
to the reference. Native execution does not fix that existing accuracy policy.

## Validation and remaining scope

Automated tests execute the actual WASM binary. They compare residuals and
Jacobians for all 25 registered types, branch boundaries, zero/negative
radii and zero-length geometry; test repeated coordinate/parameter parity,
redundancy, inconsistent/no-free-variable cases, topology changes, gauges,
cancellation rollback, expression dependencies, drag preview/final tolerance,
queue barriers and completion/cancellation races.
The expanded tests also compare complete solves, repeated derived-fillet edits,
polygon/table/global references, tangency variants, arc domain endpoints,
degenerate projections, exact semicircles and very large radius edits.

Comparison tolerances in the original test corpus are `1e-12` for residual evaluation,
`1e-7` for Jacobian entries (including finite differences), `1e-5` absolute for
accumulated coordinates and `1e-9` for final residual squared in the repeated
chain test. Final acceptance always uses the application's unchanged tolerance.
The browser's measured chain comparisons found zero coordinate difference.
An additional [strict-tolerance check](benchmarks/2026-09-26-wasm-native/strict-tolerance.json)
at `1e-8` also matched coordinates exactly, with residual L2 `3.95e-9` in both backends.
Expanded comparisons use up to `1e-11` relative/absolute for residuals and `1e-7`
for Jacobians (`1e-6` for rounded fillet construction), with stricter final solves
and repeated-coordinate checks described in the expanded results report.

The [rendered mixed application check](benchmarks/2026-09-26-wasm-coverage/bundled-client/browser-baseline.json)
uses the actual dimension editor, verifies a native Worker result and changed
SVG geometry, and exercises undo/redo, serialized reload, and rejected-expression
rollback. [Screenshot](benchmarks/2026-09-26-wasm-coverage/bundled-client/native-app.png).
The [real Worker check](benchmarks/2026-09-26-wasm-coverage/bundled-client/browser-baseline.json)
tests rapid mixed-model edits and retained topology. The original Worker test
also caught Chromium continuation priority starving cancellation messages.
Both emitted bundles also passed actual Worker/WASM loading, solving and revision
cancellation checks: [Cloudflare bundle](benchmarks/2026-09-26-wasm-coverage/bundled-client/browser-baseline.json)
and [GitHub Pages bundle](benchmarks/2026-09-26-wasm-coverage/bundled-pages/browser-baseline.json).

Large Swell-heavy models and realistic saved-document performance at 100,000
constraints, rendered native dragging across all tool types, browser
failure recovery under WASM traps, sustained idle CPU measurement, and mobile/
Firefox/Safari validation remain unconfirmed. This is not a claim that the
entire requested native solver replacement has been completed.

## Large control edit regression

The supplied `TestFrontView` drawing exposed premature stagnation on a large
`c1: 50 → 85` control edit. Both LM kernels now retain improving small steps
until convergence or an existing solve limit. The complete drawing passed
rendered control edits, undo/redo and reload with all 193 constraints intact.
The initial convergence correction used the JavaScript fallback. Swell has since
been ported, and the newer Swell report verifies and measures native solving.
See the [reproduction and measured results](benchmarks/2026-09-26-front-control-fix/RESULTS.md).

## Build and deployment

`npm run build:solver` verifies the packaged binary against source and flags or
rebuilds it with portable LLVM. Normal `dev`, `build`, and `build:pages` invoke
that check. Vite emits the Worker dependency graph and a versioned WASM asset
for both Cloudflare and GitHub Pages builds. See the
[native build instructions](../packages/paramagic-core/native/README.md).

Single-threaded WASM needs no COOP/COEP changes. The baseline documents the
headers and asset policies that a future shared-memory experiment would need.
No hosting configuration or deployment was changed.

```powershell
npm test
npm run build
npm run build:pages
npm run benchmark:solver:browser -- --wasm=true --samples=1 --auxiliary=false --profile-count=0 --output=tmp/native-comparison
npm run benchmark:solver:browser -- --native-worker-only=true --output=tmp/native-worker
npm run benchmark:solver:browser -- --native-app-only=true --output=tmp/native-app
```
