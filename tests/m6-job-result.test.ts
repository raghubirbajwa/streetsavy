import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assertJobResult } from '../scripts/assert-job-result.mjs';

test('M6 hosted helper accepts all three bounded workers and rejects invalid or concealed counts', () => {
  const empty = { claimed: 0, done: 0, failed: 0 };
  const done = { claimed: 1, done: 1, failed: 0 };
  const failed = { claimed: 1, done: 0, failed: 1 };
  assertJobResult({ ...empty, checkout: empty, shipping: empty, refunds: empty });
  const three = { claimed: 3, done: 3, failed: 0, checkout: done, shipping: done, refunds: done };
  assertJobResult(three);
  const mixed = { claimed: 3, done: 2, failed: 1, checkout: done, shipping: done, refunds: failed };
  assertJobResult(mixed); // Caller still refuses a run whose reported failed count is nonzero.
  assert.throws(() => assertJobResult({ ...mixed, failed: 0 }), /Aggregate failed/);
  assert.throws(() => assertJobResult({ ...three, claimed: 1 }), /Aggregate claimed/);
  assert.throws(() => assertJobResult({ ...three, shipping: { claimed: 2, done: 2, failed: 0 } }), /shipping/);
  assert.throws(() => assertJobResult({ ...three, refunds: { ...done, failed: 1 } }), /balance/);
  assert.throws(() => assertJobResult({ ...three, checkout: undefined }), /checkout/);
});
