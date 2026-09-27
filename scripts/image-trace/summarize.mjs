import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const directory = resolve(process.argv[2] || 'docs/benchmarks/2026-09-27-image-trace/comparison');
const report = JSON.parse(readFileSync(resolve(directory, 'browser-baseline.json'), 'utf8'));
assert.equal(report.errors.length, 0);
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const rows = [], setup = []; let comparisons = 0;
for (const pixels of [...new Set(report.trace.map(sample => sample.pixels))]) {
  const original = report.trace.filter(s => s.pixels === pixels && s.backend === 'reference');
  const worker = report.trace.filter(s => s.pixels === pixels && s.backend === 'worker');
  assert.equal(original.length, report.configuration.samples);
  assert.equal(worker.length, original.length);
  for (const sample of original) {
    const candidate = worker.find(s => s.sample === sample.sample);
    for (const row of sample.rows) {
      const actual = candidate.rows.find(r => r.name === row.name);
      assert.deepEqual(actual.points, row.points, `Contour ${pixels}/${sample.sample}/${row.name}`);
      assert.equal(actual.areaPixels, row.areaPixels);
      comparisons++;
    }
  }
  for (const name of original[0].rows.map(r => r.name)) {
    const originalMs = median(original.map(s => s.rows.find(r => r.name === name).elapsedMs));
    const workerMs = median(worker.map(s => s.rows.find(r => r.name === name).elapsedMs));
    rows.push({ pixels, name, originalMs, workerMs, speedup: originalMs / workerMs });
  }
  const originalFirstSessionMs = median(original.map(s => s.initializationMs + s.preparationMs + s.rows[0].elapsedMs));
  const workerFirstSessionMs = median(worker.map(s => s.workerSetupMs + s.rows[0].elapsedMs));
  setup.push({ pixels, originalSetupMs: median(original.map(s => s.initializationMs + s.preparationMs)),
    workerSetupMs: median(worker.map(s => s.workerSetupMs)), originalFirstSessionMs, workerFirstSessionMs,
    speedup: originalFirstSessionMs / workerFirstSessionMs });
}
const summary = { environment: report.environment, exactContourAndAreaComparisons: comparisons, rows, setup };
writeFileSync(resolve(directory, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
console.log(JSON.stringify(summary, null, 2));
