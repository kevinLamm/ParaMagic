import test from 'node:test';
import assert from 'node:assert/strict';
import { connectedChain, verify, snapshot } from '../../scripts/solver-baseline/fixtures.js';
import { solveSample, phaseSample } from '../../scripts/solver-baseline/measure.js';
import { verifyJacobianBlock } from '../../packages/paramagic-core/src/modules/solver/JacobianBlocks.js';

test('scale fixture is exactly one connected component with the requested constraint count', () => {
  for (const count of [30, 31, 32, 1000]) {
    const f = connectedChain(count);
    assert.equal(f.model.constraints.size, count);
    assert.equal(f.graph.components.size, 1);
    assert.equal(f.scopedModel.constraints.size, count);
    assert.equal(verify(f, 84).residualL2, 0);
    assert.equal(snapshot(f).entities.length, Math.floor(count / 3));
  }
});
test('one first-panel dimension edit propagates to the entire short chain at strict tolerance', () => {
  const result = solveSample({ count: 30, tolerance: 1e-8, budgetMs: 10000, repeats: 3 });
  assert.equal(result.samples.length, 3);
  for (const row of result.samples) {
    assert.equal(row.status, 'converged');
    assert.ok(row.validation.residualL2 < 1e-8);
    assert.ok(row.validation.maxCoordinateError < 1e-5);
    assert.equal(row.validation.movedFraction, 1);
    assert.equal(row.validation.parameterValue, row.requestedTarget);
  }
});
test('final time-budget cancellation restores geometry and remains visible in the report', () => {
  const row = solveSample({ count: 1000, sharedTarget: true, budgetMs: 0 }).samples[0];
  assert.equal(row.status, 'cancelled');
  assert.equal(row.validation.movedEntities, 0);
  assert.ok(row.validation.residualL2 > 1e-3);
  assert.equal(row.wasmSolveMs, null);
  assert.equal(row.speedup, null);
});
test('phase report distinguishes stored sparse block entries from numerical nonzeros', () => {
  const result = phaseSample({ count: 30 });
  assert.ok(result.numericalNonzeros > 0);
  assert.ok(result.numericalNonzeros < result.storedDerivativeEntries);
  assert.ok(result.storedDerivativeEntries < result.variables * result.residualCount);
  assert.equal(result.diagnostics.analyticalBlocks, 29);
  assert.equal(result.diagnostics.fallbackBlocks, 1);
});
test('fixture analytical derivatives agree with central differences', () => {
  const f = connectedChain(30);
  const contract = f.registry.blocks(f.model, f.dimensions);
  for (const block of contract.blocks) {
    if (!block.evaluateAnalyticalJacobian) continue;
    const result = verifyJacobianBlock(block, { absoluteTolerance: 1e-6, relativeTolerance: 1e-5 });
    assert.ok(result.valid, JSON.stringify({ type: block.type, ...result }));
  }
});
