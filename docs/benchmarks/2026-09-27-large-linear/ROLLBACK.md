# Large-system linear solver rollback — 2026-09-27

## Scope

Restores the implementation from before the large-system sparse-direct experiment:

- Removes `WasmSparseTopology.js`, the `experimentalLargeSparse` constructor option,
  and the symbolic-work diagnostic.
- Restores the existing `compileConstraintTopology` path for arc and Stack-placement
  components. Native direct factorization is again bounded to 2,048 active variables
  and 65,536 factor entries; larger systems use the earlier native sparse PCG path.
- Restores the original `1e-7` direct-solver ridge and native configuration guards.
- Restores `solver.wasm` and its build manifest from the saved pre-experiment copy.
- Removes the experiment-specific test file, `linear.js`, and benchmark switches.
  Removes large-app benchmark instrumentation; ordinary rendered workflow checks remain.
- Reverts the document-bounds change and its test introduced during the experiment.
- Keeps historical benchmark results, marked as withdrawn.

The earlier default WASM backend, all native constraint implementations, Swell,
parameters, graph processing, continuation, persistent Worker sessions and Trace
Region changes remain. The JavaScript reference remains available. No isolated
Collinear translation or gauge experiment is installed.

## Verification

- `solver.cpp` and `sparse_elimination.h` match their pre-experiment SHA-256 hashes.
- `npm run build:solver` verifies the restored source and manifest together.
- Restored binary: 141,661 bytes, SHA-256
  `65fa796f2c0fa2d6106263d71fefe3cc98751b1ac98cfadf14adf08335bca752`.
- Full test run after installing the rollback: **1,257 passed, zero failures**.
  During isolated preparation, one test initially lacked its fixture; restoring
  the fixture resolved that preparation issue without changing an assertion.
- Standard client and GitHub Pages builds pass after installation. Both emit the restored binary
  with the hash above. Existing chunk-size warnings remain.
- Browser verification: 58 checks passed on the rendered TestFrontView workflow.
  The default Worker used WASM for repeated c1 edits 50 → 85 → 50 → 85, with
  residual L2 values `6.700732752624027e-9`, `5.3603991986013554e-9`, and
  `9.683619252780145e-9`. All 193 constraints remained enabled; temporary locks
  were released; Swell and Stack placement used native results. Undo, Redo,
  serialized reload and the displayed geometry were checked.

These checks verify the rollback and retention of the earlier WASM workflow.
They do not establish that the later d11/d12 Collinear failure or the earlier
reported geometry reversal is fixed. Those remain separate correctness issues.
