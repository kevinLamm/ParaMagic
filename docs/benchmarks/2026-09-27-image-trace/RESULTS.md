# Trace Region: persistent OpenCV Worker and batched Apply

Measured September 27, 2026 on Windows, Intel Core Ultra 9 275HX, Chrome
153.0.8010.53. The image processing uses the existing pinned OpenCV WASM build.
No new C++ image-processing operation, GPU path, server processing or third-party
geometry solver was added.

## Findings and changes

The original Trace Region already used native OpenCV for thresholding, connected
components, morphology and contour approximation. Its wrapper rebuilt Mats and
full-image color bounds on every request. It also extracted the selected label
with a JavaScript loop that repeatedly accessed OpenCV's typed-array properties
for every pixel. Even an Edge Detail change repeated this entire pipeline.

An instrumented 4 MP initial trace took 1,150.8 ms. The measured `imread`, color
conversion, thresholding, connected components, morphology, contour extraction
and approximation calls accounted for about 68 ms. The rest includes the JS mask
loop, allocations and uninstrumented work; it is not a direct GC measurement.
Instrumentation perturbs timings, so the comparison below uses separate,
uninstrumented runs. Raw phase evidence: `baseline-phases-final/browser-baseline.json`.

The new image-tool implementation:

- Keeps one lazy module Worker and its OpenCV instance for the canvas.
- Prepares the image when Trace Region opens; the seed click shares that work.
- Transfers RGBA pixels once per source. Subsequent requests contain seed/settings.
- Uses native `cv.compare` to extract the selected connected component, and scalar
  color bounds instead of full-image lower/upper Mats.
- Retains Mats, labels, masks and contours. A detail edit only approximates the
  existing contour; smoothing and tolerance invalidate the appropriate stages.
- Supersedes obsolete revisions between native stages. A running native operation
  finishes before cancellation; there is no interruption inside OpenCV.
- Releases image Mats on tool exit while retaining the initialized Worker. There
  is no recurring work or timer after the last result.
- Applies the closed line chain through the existing Polyline batch transaction,
  avoiding one solver transaction and canvas update for every segment.

`ImageTrace.js` remains unchanged as the reference implementation. The tracing
algorithm, full image resolution, smoothing kernel, approximation formula and
240-vertex cap are preserved.

## Initial trace

Medians of three samples per backend and image size. Backend order alternates.
Each sample uses a fresh page and deterministic 4:3 raster; nominal pixel counts
are rounded when choosing integral dimensions. Emitted client Worker/OpenCV assets
are served locally. Tracing times include request/response overhead and coordinate
mapping but exclude initial OpenCV loading, image decoding and upload.

| Image | Original trace | Worker trace | Speedup |
| --- | ---: | ---: | ---: |
| 1 MP | 183.1 ms | 20.9 ms | 8.8x |
| 4 MP | 679.9 ms | 56.9 ms | 11.9x |
| 12 MP | 2,033.0 ms | 153.3 ms | 13.3x |

Initial setup still matters. Including module startup, decoding, preparation,
upload and the first trace, the same runs measured:

| Image | Original first session | Worker first session | Speedup |
| --- | ---: | ---: | ---: |
| 1 MP | 357.4 ms | 223.1 ms | 1.6x |
| 4 MP | 873.0 ms | 280.1 ms | 3.1x |
| 12 MP | 2,259.7 ms | 449.3 ms | 5.0x |

These are local asset-loading measurements, not internet download measurements.
Early runs through the benchmark's uncached Vite development transform took about
five seconds to initialize the large OpenCV asset. Emitted assets avoid that
development-server transformation cost; the first use of a cold development server
can still show it.

## Settings changes

4 MP medians, same already-prepared image:

| Change | Original | Worker |
| --- | ---: | ---: |
| Edge Detail 8 to 10 | 759.8 ms | 0.3 ms |
| Smoothing 1 to 4 | 932.9 ms | 197.7 ms |
| Tolerance 24 to 8 | 936.1 ms | 204.9 ms |

The sub-millisecond detail figure measures processing and transport, not paint.
The rendered app check took 3.0 ms for this detail change. High smoothing still
does substantial native morphology work; moving it to the Worker keeps it off the
UI thread rather than eliminating that work.

All **36 paired contour and area comparisons were exactly equal**, including point
order. `comparison/browser-baseline.json` contains all outputs; `comparison/summary.json`
contains the checked medians.

## Apply Trace

Actual rendered UI runs with Auto Constraint enabled. Each row compares one original
Apply measurement with one final batch measurement; these are single-run examples,
not medians. Both use the optimized image Worker, isolating the Apply change.

| Outline | Original synchronous Apply | Batch synchronous Apply | Original through render | Batch through render |
| --- | ---: | ---: | ---: | ---: |
| 17 vertices | 144.7 ms | 21.6 ms | 168.4 ms | 51.2 ms |
| 160 vertices | 14,810.1 ms | 290.1 ms | 15,026.4 ms | 475.0 ms |

Batching changes the timing of automatic inference: the existing Polyline path
detects relationships using the original segment coordinates, then solves once.
The previous Trace Region path detected each segment against earlier segments that
had already been solved. Consequently, with Auto Constraint enabled, **the inferred
constraints and applied coordinates can differ**. In the detailed fixture the old
path created 284 constraints and the batch path created 294; the largest paired
coordinate difference was 0.832 drawing units after rounding up. This is not an
exact applied-geometry equivalence claim. The preview contour remains exact, the
same inference rules are used, and final constraint tolerance is unchanged.

The final batch model required no correction when loaded by the JavaScript solver.
Its residual L2 norm and all adjoining endpoint gaps passed the existing 1e-3
threshold. A failed batch leaves the preview available and reports the failure.
Apply is still synchronous, so very complex existing drawings can still cause a
pause; this experiment does not establish a worst-case latency bound.

## Validation

- Full suite: **1,255 passed**, zero failed (`tests.txt`).
- Final focused trace/image/drawing tests: **28 passed** (`focused-tests-final.txt`).
- Client and Pages production builds pass (`build-client.txt`, `build-pages.txt`),
  with the existing bundle-size warning.
- Actual UI workflow: **20 checks passed** with client assets, the 160-vertex
  fixture, and Pages assets under `/ParaMagic/`. This covers opening the panel,
  clicking a seed, rendered contour parity, settings and rapid revisions, one image
  upload, Apply, final solver validation, connected endpoints, rendered lines,
  preserved source image, Undo/Redo, serialized reload, Worker reuse and idle behavior.
- Screenshots were visually inspected in `validated/trace-app.png` and
  `validated-complex/trace-app.png`.
- The user's running `http://localhost:5173/` serves the new client module.

The UI harness loads application source through Vite and uses the emitted Worker
and OpenCV assets. It is not a hosted deployment smoke test. Unit tests additionally
cover transparent/tiny regions, invalid seeds, multiple source sizes, supersession,
release/dispose and recovery from Worker/OpenCV initialization failure.

No image fixture was supplied for this request; the raster fixtures are generated
by `scripts/image-trace/measure.js`. Safari, Firefox, macOS, Linux and the user's
own images have not been tested in this run.

## Memory and deployment

The persistent full-image Mats require approximately 14 bytes per pixel before
contour storage and OpenCV scratch allocations (about 56 MB at 4 MP, 168 MB at
12 MP). This is a layout estimate, not a measured process-memory total. Closing the
tool frees those Mat allocations, but the WASM heap can retain its peak capacity.
The original JS image decode/canvas readback remains on the main thread once per
image session. Trace and Warp can have separate OpenCV instances if both are used.

The new path is single-threaded WASM in an ordinary module Worker. No SharedArrayBuffer,
cross-origin isolation, special COOP/COEP headers or end-user setup is needed. The
test browser reported `crossOriginIsolated: false` and no SharedArrayBuffer. Vite's
normal builds emit the Worker and pinned OpenCV asset. Warp Perspective is unchanged.

## Repeat

```sh
npm test
npm run build
npm run build:pages
node scripts/solver-baseline/run-browser.mjs --trace-only=true --trace-backend=both --counts=1000000,4000000,12000000 --samples=3 --built=client --output=docs/benchmarks/2026-09-27-image-trace/comparison
node scripts/image-trace/summarize.mjs
node scripts/solver-baseline/run-browser.mjs --trace-app-only=true --built=client --output=docs/benchmarks/2026-09-27-image-trace/validated
node scripts/solver-baseline/run-browser.mjs --trace-app-only=true --trace-complex=true --built=client --output=docs/benchmarks/2026-09-27-image-trace/validated-complex
node scripts/solver-baseline/run-browser.mjs --trace-app-only=true --built=pages --output=docs/benchmarks/2026-09-27-image-trace/bundled-pages
```

Run benchmarks serially with other heavy work idle. The runner uses a separate
browser profile and does not change the user's open drawing.
