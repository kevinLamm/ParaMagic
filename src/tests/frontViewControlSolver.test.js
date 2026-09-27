import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SolverController } from '../../packages/paramagic-core/src/modules/solver/SolverController.js';
import { WasmSolverBackend, loadWasmSolverModule } from '../../packages/paramagic-core/src/modules/solver/WasmSolverSession.js';

const fixture = () => JSON.parse(readFileSync(new URL('./fixtures/front-view-large-control-edit.paramagic', import.meta.url), 'utf8'));
const module = await loadWasmSolverModule(readFileSync(new URL('../../packages/paramagic-core/src/modules/solver/wasm/solver.wasm', import.meta.url)));

for (const backend of ['javascript', 'wasm']) {
  test(`Front view c1 50 → 85 and repeated large edits retain all constraints (${backend})`, () => {
    const controller = new SolverController({ jacobianMode: 'blocks', numericBackend: backend === 'wasm' ? new WasmSolverBackend(module) : null });
    controller.loadSketch(fixture());
    const control = controller.dimensions.list().find(p => p.name === 'c1');
    const constraints = structuredClone(controller.constraints());
    const expressions = new Map(controller.dimensions.list().map(p => [p.id, p.expression]));
    assert.equal(control.value, 50);
    assert.equal(constraints.length, 193);
    for (const target of [85, 50, 85]) {
      const { result } = controller.updateParameter(control.id, { expression: `MinMax(Min Width, 100, ${target}, 1)`, usesDrawingUnit: false });
      assert.equal(result.status, 'converged', result.message);
      assert.equal(controller.dimensions.get(control.id).value, target);
      assert.ok(result.changedEntityIds.length > 0);
      assert.deepEqual(controller.constraints(), constraints);
      assert.ok(controller.constraints().every(c => c.enabled !== false && !c.loadError));
      assert.ok(controller.model.allVariables().every(v => !v.locked && !v.fixed));
      const residualL2 = Math.hypot(...controller.registry.evaluate(controller.model, controller.dimensions).values);
      assert.ok(residualL2 < 1e-8, `Final residual ${residualL2}`);
      const width = controller.model.entity('e00ba7d1-23a4-46bf-8014-b9cb8e6b54dc');
      // Distance residuals use the model's length scale. Check coordinates at
      // the corresponding relative accuracy as well as the exact residual norm.
      assert.ok(Math.abs(Math.hypot(width.start[0] - width.end[0], width.start[1] - width.end[1]) - target * 25.4) < target * 25.4 * 1e-8);
      for (const p of controller.dimensions.list()) if (p.id !== control.id) assert.equal(p.expression, expressions.get(p.id));
      if (backend === 'wasm') {
        assert.equal(result.backend, 'wasm');
        assert.equal(result.jacobianStats.fallbackReason, undefined);
      }
    }
    const reopened = new SolverController({ jacobianMode: 'blocks' });
    reopened.loadSketch(controller.getSketchSnapshot());
    assert.equal(reopened.dimensions.get(control.id).value, 85);
    assert.deepEqual(reopened.constraints(), constraints);
    assert.ok(Math.hypot(...reopened.registry.evaluate(reopened.model, reopened.dimensions).values) < 1e-8);
  });
}
