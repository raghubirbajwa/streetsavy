import assert from "node:assert/strict";
import { test } from "node:test";
import { AuthFormError, readAuthForm } from "../src/lib/http/security.ts";

function form(body: string | Uint8Array, headers: Record<string, string> = {}) {
  return new Request("http://localhost:3000/api/v1/auth/login", {
    method: "POST", body: typeof body === "string" ? body : new Uint8Array(body),
    headers: { "content-type": "application/x-www-form-urlencoded", ...headers },
  });
}
const hasStatus = (status: number) => (error: unknown) => error instanceof AuthFormError && error.status === status;

test("native forms preserve credentials, Unicode and literal plus signs", async () => {
  const parsed = await readAuthForm(form("email=owner%2Bdemo%40example.test&password=caf%C3%A9%2Bword+with+spaces", {
    "content-type": 'application/x-www-form-urlencoded; charset="UTF-8"',
  }));
  assert.equal(parsed.get("email"), "owner+demo@example.test");
  assert.equal(parsed.get("password"), "café+word with spaces");
  assert.equal((await readAuthForm(form(""))).size, 0);
  assert.equal((await readAuthForm(form(`password=${"a".repeat(4087)}`))).get("password")?.length, 4087);
});

test("streamed size limit applies when Content-Length is absent or forged", async () => {
  for (const headers of [{}, { "content-length": "1" }]) {
    await assert.rejects(readAuthForm(form(`password=${"a".repeat(4088)}`, headers)), hasStatus(413));
  }
  await assert.rejects(readAuthForm(form("password=x", { "content-length": "4097" })), hasStatus(413));
  await assert.rejects(readAuthForm(form(`password=${"é".repeat(2044)}`)), hasStatus(413));
});

test("oversized chunked bodies are cancelled before later chunks are read", async () => {
  let cancelled = false;
  let pulls = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) { pulls += 1; controller.enqueue(new Uint8Array(3000).fill(97)); },
    cancel() { cancelled = true; },
  }, { highWaterMark: 0 });
  const request = new Request("http://localhost:3000/api/v1/auth/login", {
    method: "POST", body, duplex: "half",
    headers: { "content-type": "application/x-www-form-urlencoded" },
  } as RequestInit & { duplex: "half" });
  await assert.rejects(readAuthForm(request), hasStatus(413));
  assert.equal(cancelled, true);
  assert.equal(pulls, 2);
});

test("unsupported encodings and malformed lengths receive safe client errors", async () => {
  for (const contentType of ["application/json", "multipart/form-data; boundary=abc", "application/x-www-form-urlencoded; charset=iso-8859-1", ""]) {
    await assert.rejects(readAuthForm(form("password=test", { "content-type": contentType })), hasStatus(415));
  }
  for (const length of ["-1", "NaN", "1.5", "1, 2"]) {
    await assert.rejects(readAuthForm(form("password=test", { "content-length": length })), hasStatus(400));
  }
});

test("malformed UTF-8, percent escapes and duplicate fields are rejected", async () => {
  for (const body of ["password=secret%ZZ", "password=secret%", "password=%FF", "email=a&email=b", "password=a&pass%77ord=b", new Uint8Array([0xff, 0xfe])]) {
    await assert.rejects(readAuthForm(form(body)), (error: unknown) => {
      assert.ok(error instanceof AuthFormError);
      assert.equal(error.status, 400);
      assert.equal(error.message, "Malformed form body.");
      assert.equal(error.message.includes("secret"), false);
      return true;
    });
  }
});

test("stream failures do not expose raw transport error text", async () => {
  const body = new ReadableStream<Uint8Array>({ start(controller) { controller.error(new Error("secret body or transport detail")); } });
  const request = new Request("http://localhost:3000/api/v1/auth/login", {
    method: "POST", body, duplex: "half", headers: { "content-type": "application/x-www-form-urlencoded" },
  } as RequestInit & { duplex: "half" });
  await assert.rejects(readAuthForm(request), (error: unknown) => {
    assert.ok(error instanceof AuthFormError);
    assert.equal(error.status, 400);
    assert.equal(error.message, "Malformed form body.");
    return true;
  });
});
