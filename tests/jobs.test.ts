import assert from "node:assert/strict";
import test from "node:test";
import { readEnvironment } from "../src/config/env.ts";
import { operationRequestHash, referencePayload, safeOperationsError } from "../src/lib/jobs/contracts.ts";
import { createOperationsService } from "../src/lib/jobs/service.ts";

test("operation hashes are order-stable and distinguish changed nested payloads", () => {
  const first = { quoteId: "one", nested: { quantity: 2, colors: ["blue", "black"] } };
  assert.equal(operationRequestHash(first), operationRequestHash({ nested: { colors: ["blue", "black"], quantity: 2 }, quoteId: "one" }));
  assert.notEqual(operationRequestHash(first), operationRequestHash({ ...first, quoteId: "two" }));
  assert.notEqual(operationRequestHash(first), operationRequestHash({ ...first, nested: { quantity: 2, colors: ["black", "blue"] } }));
  assert.throws(() => operationRequestHash({ amount: Infinity }), /INVALID_PAYLOAD/);
  assert.throws(() => operationRequestHash({ omitted: undefined }), /INVALID_PAYLOAD/);
});

test("minimal job payloads admit identifiers and reject credential/free-text fields", () => {
  assert.deepEqual(referencePayload({ orderId: "order-1", operationKey: "checkout:1" }), { orderId: "order-1", operationKey: "checkout:1" });
  for (const payload of [{ email: "a@example.test" }, { secretKey: "secret" }, { apiKey: "key" }, { orderId: "private text" }]) {
    assert.throws(() => referencePayload(payload), /INVALID_PAYLOAD/);
  }
});

test("unknown provider/database exceptions never expose raw text or nested details", () => {
  const privateError = { message: "api_secret=private", details: "customer@example.test", code: "42501" };
  const result = safeOperationsError(privateError);
  assert.equal(result.message, "INTERNAL_ERROR");
  assert.equal(JSON.stringify(result).includes("private"), false);
  assert.equal("cause" in result, false);
  assert.equal(safeOperationsError({ message: "LEASE_LOST", details: "private" }).code, "LEASE_LOST");
});

test("fixture mode prevents an operations transport from being constructed or invoked", () => {
  let calls = 0;
  assert.throws(() => createOperationsService(readEnvironment({ APP_MODE: "fixture", APP_URL: "http://localhost:3000" }), async () => {
    calls += 1;
    return { data: null, error: null };
  }), /INTEGRATION_DISABLED/);
  assert.equal(calls, 0);
});
