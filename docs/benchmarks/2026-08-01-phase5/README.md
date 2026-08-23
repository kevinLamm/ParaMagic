# Phase 5 dense/block benchmark comparison

Captured sequentially on the same Windows x64 machine with Node.js `v22.20.0`. Quick and stress use three samples per benchmark; standard uses five. Each JSON artifact contains the complete configuration, environment metadata, raw aggregate results, timings, statuses, iteration counts, and analytical/fallback block counts.

## Solver comparison

Positive percentages are improvements from dense to block Jacobian assembly.

| Profile | Fixture | Dense total (ms) | Blocks total (ms) | Total improvement | Dense Jacobian (ms) | Blocks Jacobian (ms) | Jacobian improvement |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Quick | Disconnected lines | 25.033 | 16.181 | 35.4% | 1.930 | 0.292 | 84.9% |
| Quick | Connected chain | 8.437 | 5.967 | 29.3% | 3.668 | 0.640 | 82.6% |
| Quick | Fixed-endpoint arcs | 2.666 | 1.463 | 45.1% | 1.989 | 0.734 | 63.1% |
| Standard | Disconnected lines | 88.977 | 83.114 | 6.6% | 7.746 | 0.636 | 91.8% |
| Standard | Connected chain | 95.874 | 79.722 | 16.8% | 16.229 | 2.011 | 87.6% |
| Standard | Fixed-endpoint arcs | 6.629 | 5.678 | 14.3% | 4.119 | 1.428 | 65.3% |
| Stress | Disconnected lines | 1375.977 | 1289.132 | 6.3% | 60.620 | 1.821 | 97.0% |
| Stress | Connected chain | 1975.677 | 1956.925 | 0.9% | 186.467 | 4.897 | 97.4% |
| Stress | Fixed-endpoint arcs | 109.450 | 73.709 | 32.7% | 47.138 | 4.961 | 89.5% |

Every paired solver fixture retained the same convergence status and iteration count. Sub-millisecond component-local fixtures sometimes measure slower in block mode because contract/assembly overhead is larger than the tiny numerical solve; their absolute difference is less than `0.1 ms` and is below a useful end-to-end threshold.

## Worker drag latency

| Profile | Dense update p95 (ms) | Blocks update p95 (ms) | Dense final (ms) | Blocks final (ms) |
| --- | ---: | ---: | ---: | ---: |
| Quick | 10.464 | 10.448 | 0.165 | 0.120 |
| Standard | 10.485 | 10.453 | 0.154 | 0.113 |
| Stress | 10.822 | 10.718 | 0.553 | 0.477 |

Block mode does not regress interactive Worker latency. Preview streams remain governed by the approximately 10 ms cooperative budget, so most analytical savings appear as extra work completed within the budget rather than a lower p95.

## Decision

Block Jacobians satisfy the Phase 5 correctness and performance promotion gates and can become the application default while retaining `?solverJacobian=dense` as the immediate reference/fallback switch. The stress connected-chain result shows the next bottleneck clearly: a 97.4% Jacobian reduction produces only a 0.9% total improvement because dense normal-equation assembly and factorization dominate. Phase 6 should therefore prioritize sparse typed-array assembly and factorization rather than further residual micro-optimization.

## Artifacts

- `quick-dense.json`
- `quick-blocks.json`
- `standard-dense.json`
- `standard-blocks.json`
- `stress-dense.json`
- `stress-blocks.json`

Reproduce a pair with:

```powershell
npm run benchmark:solver -- --profile=standard --jacobian-mode=dense --output=docs/benchmarks/2026-08-01-phase5/standard-dense.json
npm run benchmark:solver -- --profile=standard --jacobian-mode=blocks --output=docs/benchmarks/2026-08-01-phase5/standard-blocks.json
```
