// Core-only timings. Use test-control-solver.mjs for complete visible updates.
import { readFileSync, writeFileSync } from 'node:fs';
import { SolverController } from '../packages/paramagic-core/src/modules/solver/SolverController.js';

const drawing = JSON.parse(readFileSync('src/tests/fixtures/rectangle-ottoman-controls.paramagic', 'utf8'));
const rows = [];
for (const [name, value] of [['c1', 70.5], ['c1', 90], ['c2', 37], ['c2', 40]]) {
  const controller = new SolverController({ jacobianMode: 'blocks' });
  controller.loadSketch(structuredClone(drawing));
  const parameter = controller.dimensions.list().find(entry => entry.name === name);
  const solves = [];
  const solve = controller.solve.bind(controller);
  controller.solve = (...args) => {
    const result = solve(...args);
    solves.push({ status: result.status, iterations: result.iterations, timings: result.timings, stats: result.jacobianStats });
    return result;
  };
  const start = performance.now();
  const { result } = controller.updateParameter(parameter.id, {
    expression: parameter.expression.replace(/^(MinMax\([^,]+,[^,]+,)\s*[^,]+,/, `$1 ${value},`),
    usesDrawingUnit: false,
  });
  const row = {
    name, value, ms: performance.now() - start, status: result.status,
    norm: Math.hypot(...controller.registry.evaluate(controller.model, controller.dimensions).values), solves,
  };
  if (!['converged', 'unchanged'].includes(row.status) || row.norm >= 1e-8) {
    throw new Error(`${name}=${value} failed: ${result.message}; residual norm ${row.norm}`);
  }
  rows.push(row);
  console.log(JSON.stringify({ name, value, ms: row.ms, status: row.status, norm: row.norm }));
}
if (process.argv[2]) writeFileSync(process.argv[2], JSON.stringify(rows, null, 2));
