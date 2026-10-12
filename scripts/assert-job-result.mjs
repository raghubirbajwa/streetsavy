import assert from 'node:assert/strict';

// Current endpoint runs one bounded checkout, shipping and returns/refund worker.
export function assertJobResult(data) {
  const totals = { claimed: 0, done: 0, failed: 0 };
  for (const worker of ['checkout', 'shipping', 'refunds']) {
    const counts = data?.[worker];
    assert.ok(counts && ['claimed', 'done', 'failed'].every(key => [0, 1].includes(counts[key])), `${worker} must claim at most one job.`);
    assert.equal(counts.done + counts.failed, counts.claimed, `${worker} counts must balance.`);
    for (const key of ['claimed', 'done', 'failed']) totals[key] += counts[key];
  }
  for (const key of ['claimed', 'done', 'failed']) assert.equal(data[key], totals[key], `Aggregate ${key} must match the worker totals.`);
}
