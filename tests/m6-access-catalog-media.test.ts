import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fixtureCatalogSnapshot } from "../src/lib/catalog/fixture.ts";
import { fixtureProductId } from "../src/data/fixtures/catalog.ts";
import { parseCatalogQuery, queryCatalog } from "../src/lib/catalog/query.ts";
import { createFixtureAdminDatabase, executeFixtureRpc } from "../src/lib/admin/db.ts";
import { createMediaService } from "../src/lib/media/service.ts";
import { FixtureMediaStorage } from "../src/lib/media/storage.ts";
import type { Admin } from "../src/lib/auth/policy.ts";

const owner: Admin = { id: "00000000-0000-4000-8000-000000000001", role: "owner" };
const forgedCustomer: Admin = { id: "00000000-0000-4000-8000-000000000003", role: "owner" };

test("M6 Q02: black/S plus blue/M never matches black/M; matching price and stock control results", () => {
  const catalog = structuredClone(fixtureCatalogSnapshot);
  catalog.products = catalog.products.slice(0, 2);
  const first = catalog.products[0]!;
  const second = catalog.products[1]!;
  const variant = first.variants[0]!;
  first.variants = [
    { ...variant, id: randomUUID(), colorKey: "black", colorLabel: "Black", size: "S", pricePaise: 30000, compareAtPaise: null, available: false },
    { ...variant, id: randomUUID(), colorKey: "blue", colorLabel: "Blue", size: "M", pricePaise: 10000, compareAtPaise: null, available: true },
  ];
  second.variants = [{ ...variant, id: randomUUID(), colorKey: "black", colorLabel: "Black", size: "S", pricePaise: 20000, compareAtPaise: null, available: true }];
  const query = (params: string) => queryCatalog(catalog, parseCatalogQuery(new URLSearchParams(params), catalog));
  assert.equal(query("color=black&size=M").total, 0);
  assert.deepEqual(query("color=blue&size=M").rows.map((row) => row.product.id), [first.id]);
  assert.deepEqual(query("color=black&size=S&inStock=true").rows.map((row) => row.product.id), [second.id]);
  assert.deepEqual(query("color=black&size=S&maxPrice=20000").rows.map((row) => row.product.id), [second.id]);
  assert.deepEqual(query("color=black&size=S&sort=price-asc").rows.map((row) => [row.product.id, row.minPricePaise]), [[second.id, 20000], [first.id, 30000]]);
  assert.deepEqual(query("color=black&size=S&sort=price-desc").rows.map((row) => row.product.id), [first.id, second.id]);
});

async function mediaHarness() {
  const previous = { mode: process.env.APP_MODE, url: process.env.APP_URL };
  process.env.APP_MODE = "fixture";
  process.env.APP_URL = "http://localhost:3000";
  const root = await mkdtemp(join(tmpdir(), "clothing-m6-media-"));
  const db = await createFixtureAdminDatabase();
  const rpc = <T = unknown>(name: string, args: Record<string, unknown>) => executeFixtureRpc<T>(db, name, args);
  const storage = new FixtureMediaStorage(root, "fixture");
  const service = createMediaService({ rpc, storage, mode: "fixture", appUrl: "http://localhost:3000", previewSecret: Buffer.alloc(32, 6) });
  return { db, storage, service, async close() {
    await db.close();
    await rm(root, { recursive: true, force: true });
    if (previous.mode === undefined) delete process.env.APP_MODE; else process.env.APP_MODE = previous.mode;
    if (previous.url === undefined) delete process.env.APP_URL; else process.env.APP_URL = previous.url;
  } };
}

test("M6 Q01/Q08: missing upload bytes cannot become attachable or public, and revoked actors cannot upload or complete", async () => {
  const h = await mediaHarness();
  try {
    const input = { fileName: "incomplete.png", contentType: "image/png", sizeBytes: 50, kind: "image" };
    await assert.rejects(h.service.upload(forgedCustomer, input), /FORBIDDEN/);
    const ticket = await h.service.upload(owner, input);
    await assert.rejects(h.service.complete(owner, ticket.mediaId), /Upload the file/);
    const pending = await h.service.get(owner, ticket.mediaId);
    assert.equal(pending.status, "uploading");
    assert.equal(pending.previewUrl, null);
    assert.equal(pending.publicUrl, null);
    await assert.rejects(h.service.setAttachments(owner, { productId: fixtureProductId(1), version: 1, items: [{ mediaId: ticket.mediaId, colorKey: null, isCover: true }] }), /MEDIA_NOT_READY/);
    await assert.rejects(h.service.publicFile(`staging/${ticket.mediaId}/original`));
    await h.db.query("update public.admin_memberships set enabled=false where user_id=$1", [owner.id]);
    await assert.rejects(h.service.complete(owner, ticket.mediaId), /FORBIDDEN/);
    await assert.rejects(h.service.upload(owner, input), /FORBIDDEN/);
  } finally { await h.close(); }
});

test("M6 Q08: cleanup is bounded, retries storage failure and preserves recent, referenced and published media", async () => {
  const h = await mediaHarness();
  try {
    const insert = async (status: string, ageHours = 25) => {
      const id = randomUUID(); const key = `staging/${id}/original`;
      await h.db.query("insert into public.media_assets(id,stage_key,public_key,type,status,content_type,size_bytes,width,height,created_at) values($1,$2,$5,'image',$3,'image/png',4,2,2,now()-($4::int*interval '1 hour'))", [id, key, status, ageHours, status === "published" ? `catalog/${id}/sample.png` : null]);
      await h.storage.putPrivate(key, Buffer.from("test"), "image/png");
      return { id, key };
    };
    const due = [];
    for (let i = 0; i < 21; i++) due.push(await insert(i % 2 === 0 ? "uploading" : "rejected"));
    const protectedRows = [await insert("uploading", 1), await insert("ready"), await insert("validating"), await insert("publishing"), await insert("published"), await insert("rejected")];
    const referenced = protectedRows.at(-1)!;
    await h.db.query("insert into public.product_media(product_id,media_id,is_cover) values($1,$2,false)", [fixtureProductId(1), referenced.id]);
    await assert.rejects(h.service.remove(owner, referenced.id, 1), /MEDIA_IN_USE/);
    const originalDelete = h.storage.deletePrivate.bind(h.storage);
    let failOnce = true;
    let deletes = 0;
    h.storage.deletePrivate = async (key) => {
      deletes += 1;
      if (failOnce) { failOnce = false; throw new Error("Simulated temporary storage outage"); }
      return originalDelete(key);
    };
    assert.deepEqual(await h.service.cleanup(owner), { cleaned: 19, pending: 1 });
    assert.equal(deletes, 20, "one cleanup does not touch more than twenty assets");
    assert.deepEqual(await h.service.cleanup(owner), { cleaned: 2, pending: 0 });
    assert.deepEqual(await h.service.cleanup(owner), { cleaned: 0, pending: 0 });
    for (const row of due) {
      await assert.rejects(h.storage.readPrivate(row.key, 4));
      const stored = (await h.db.query<{ status: string; last_error: string }>("select status,last_error from public.media_assets where id=$1", [row.id])).rows[0]!;
      assert.equal(stored.status, "deleting"); assert.equal(stored.last_error, "CLEANED");
    }
    for (const row of protectedRows) assert.deepEqual(await h.storage.readPrivate(row.key, 4), Buffer.from("test"));
    assert.equal((await h.service.get(owner, referenced.id)).status, "rejected");
  } finally { await h.close(); }
});
