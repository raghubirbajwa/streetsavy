import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAdminCatalogService, type CatalogRpc } from "../src/lib/admin/catalog.ts";
import { AdminDatabaseError, adminDatabaseError, createFixtureAdminDatabase, executeFixtureRpc } from "../src/lib/admin/db.ts";
import type { Admin } from "../src/lib/auth/policy.ts";
import type { CatalogSnapshot } from "../src/lib/validation/catalog.ts";

const owner: Admin = { id: "00000000-0000-4000-8000-000000000001", role: "owner" };
const staff: Admin = { id: "00000000-0000-4000-8000-000000000002", role: "staff" };
const customer: Admin = { id: "00000000-0000-4000-8000-000000000003", role: "owner" };
const errorCode = (code: string) => (error: unknown) => error instanceof AdminDatabaseError && error.code === code;

function fixtureMode() {
  const previous = { mode: process.env.APP_MODE, url: process.env.APP_URL };
  process.env.APP_MODE = "fixture"; process.env.APP_URL = "http://localhost:3000";
  return () => {
    if (previous.mode === undefined) delete process.env.APP_MODE; else process.env.APP_MODE = previous.mode;
    if (previous.url === undefined) delete process.env.APP_URL; else process.env.APP_URL = previous.url;
  };
}

test("catalog services reject privilege fields before executing an RPC", async () => {
  const restore = fixtureMode(); let calls = 0;
  const service = createAdminCatalogService(async () => { calls += 1; throw new Error("must not execute"); });
  try {
    assert.throws(() => service.createProduct(owner, { title: "x", slug: "x", categoryId: owner.id, status: "published" }), errorCode("INVALID_PAYLOAD"));
    assert.throws(() => service.adjustInventory(owner, { variantId: owner.id,delta: 1,expectedVersion: 1,reason: "reason",operationKey: "key",reserved: 0 }), errorCode("INVALID_PAYLOAD"));
    assert.throws(() => service.replaceVariants(owner,owner.id,{ version: 1,variants: [{ sku: "A", colorKey: "black",colorLabel: "Black",size: "S",pricePaise: 100,unitWeightG: 1,enabled: true },{sku:"A",colorKey:"black",colorLabel:"Black",size:"S",pricePaise:100,unitWeightG:1,enabled:true}] }),errorCode("INVALID_PAYLOAD"));
    assert.equal(calls,0);
  } finally { restore(); }
});

test("SQL catalog workflow enforces drafts, current membership, versions, stock audit and publication", async () => {
  const restore = fixtureMode(); const db = await createFixtureAdminDatabase();
  const rpc: CatalogRpc = async <T>(name: string,args: Record<string,unknown>) => {
    try { return await executeFixtureRpc<T>(db,name,args); } catch (error) { throw adminDatabaseError(error); }
  };
  const service = createAdminCatalogService(rpc,async () => undefined);
  try {
    await assert.rejects(service.getCatalogAdmin(customer),errorCode("FORBIDDEN"));
    const initial = await service.getCatalogAdmin(staff);
    assert.equal(initial.products.length,16);
    const settings = await rpc<{version:number}>("admin_settings_read",{p_actor:owner.id});
    assert.equal(settings.version,0,"fixture runtime loads the content-settings migration as well");
    const fields = { title:"Admin Test Cap",slug:"admin-test-cap",description:"Explicit test draft",categoryId:initial.categories[0]!.id,tags:[],fit:"regular",material:null,care:[],sizeGuideId:null,featuredRank:0 };
    let product = await service.createProduct(staff,fields);
    assert.equal(product.status,"draft"); assert.equal(product.version,1);
    await assert.rejects(service.publishProduct(staff,product.id,{version:1}),errorCode("PUBLISH_INCOMPLETE"));
    await assert.rejects(service.updateProduct(staff,product.id,{...fields,version:10}), (error:unknown) => error instanceof AdminDatabaseError && error.code==="VERSION_CONFLICT" && error.currentVersion===1);
    product = await service.replaceVariants(staff,product.id,{version:product.version,variants:[{sku:"ADMIN-TEST-CAP",colorKey:"black",colorLabel:"Black",colorHex:"#000000",size:"ONE_SIZE",pricePaise:10000,compareAtPaise:null,taxCategoryKey:null,unitWeightG:100,enabled:true}]});
    const variant = product.variants[0]!;
    const adjustment = { variantId:variant.id,delta:5,expectedVersion:1,reason:"Test intake",operationKey:"intake-cap" };
    const movement = await service.adjustInventory(staff,adjustment);
    const repeat = await service.adjustInventory(staff,adjustment);
    assert.equal(repeat.movementId,movement.movementId); assert.equal(repeat.replayed,true);
    await assert.rejects(service.adjustInventory(staff,{...adjustment,expectedVersion:2}),errorCode("IDEMPOTENCY_CONFLICT"));
    await assert.rejects(service.adjustInventory(staff,{...adjustment,delta:-6,expectedVersion:2,operationKey:"invalid-remove"}),errorCode("STOCK_CONFLICT"));
    product = await service.getProductAdmin(staff,product.id);
    assert.equal(product.variants[0]!.inventory.onHand,5); assert.equal(product.inventoryMovements.length,1);
    const preset = (await db.query<{id:string}>("insert into public.packaging_presets(label,length_cm,width_cm,height_cm,tare_weight_g,max_contents_weight_g,max_items,active) values('Test only',10,10,10,10,1000,10,true) returning id")).rows[0]!;
    product = await service.setProductPackaging(staff,product.id,{version:product.version,presetIds:[preset.id]});
    const media = (await db.query<{id:string}>("insert into public.media_assets(stage_key,public_key,type,status,content_type,size_bytes,width,height,alt,source_details,license_details) values('test-stage','catalog/test.png','image','publishing','image/png',10,10,10,'Test asset','{\"source\":\"test generator\"}','{\"license\":\"test only\"}') returning id")).rows[0]!;
    await db.query("insert into public.product_media(product_id,media_id,color_key,is_cover) values($1,$2,'black',true)",[product.id,media.id]);
    product = await service.getProductAdmin(staff,product.id);
    assert.deepEqual(product.publicationMissing,[]);
    const before = await rpc<CatalogSnapshot>("public_catalog",{});
    assert.equal(before.products.some((p) => p.id===product.id),false);
    product = await service.publishProduct(staff,product.id,{version:product.version});
    assert.equal(product.status,"published");
    assert.equal((await rpc<CatalogSnapshot>("public_catalog",{})).products.some((p)=>p.id===product.id),true);
    assert.equal((await db.query<{status:string}>("select status from public.media_assets where id=$1",[media.id])).rows[0]!.status,"published");
    product = await service.updateProduct(staff,product.id,{...fields,title:"Edited test cap",version:product.version});
    assert.equal(product.status,"draft");
    assert.equal((await rpc<CatalogSnapshot>("public_catalog",{})).products.some((p)=>p.id===product.id),false);
    product = await service.archiveProduct(staff,product.id,{version:product.version});
    assert.equal(product.status,"archived"); assert.equal(product.inventoryMovements.length,1);
    assert.equal(product.variants[0]!.inventory.onHand,5);
    await db.query("update public.admin_memberships set enabled=false where user_id=$1",[staff.id]);
    await assert.rejects(service.getCatalogAdmin(staff),errorCode("FORBIDDEN"));
    await assert.rejects(service.archiveProduct(staff,product.id,{version:product.version}),errorCode("FORBIDDEN"));
  } finally { await db.close(); restore(); }
});

test("fixture database persists admin edits across reopen without reseeding and refuses other modes", async () => {
  const restore = fixtureMode(); const directory = await mkdtemp(join(tmpdir(),"clothing-m2-catalog-"));
  let db = await createFixtureAdminDatabase(directory);
  try {
    await db.query("update public.products set title='Persistent test title' where id=(select id from public.products order by id limit 1)");
    await db.close(); db=await createFixtureAdminDatabase(directory);
    assert.equal((await db.query<{count:number}>("select count(*)::int as count from public.products where title='Persistent test title'")).rows[0]!.count,1);
    assert.equal((await db.query<{count:number}>("select count(*)::int as count from public.products")).rows[0]!.count,16);
    process.env.APP_MODE="live"; process.env.APP_URL="https://example.test";
    await assert.rejects(createFixtureAdminDatabase(),errorCode("FORBIDDEN"));
    await assert.rejects(executeFixtureRpc(db,"public_catalog",{}),errorCode("FORBIDDEN"));
  } finally { await db.close(); await rm(directory,{recursive:true,force:true}); restore(); }
});

test("database errors expose allowlisted codes and conflict versions without private query details", () => {
  const failure=adminDatabaseError({code:"XX000",message:"secret database password",details:"private provider response"});
  assert.equal(failure.message,"DATABASE_UNAVAILABLE"); assert.equal(failure.status,503);
  const conflict=adminDatabaseError({code:"P0001",message:"VERSION_CONFLICT",detail:'{"currentVersion":4,"private":"secret"}'});
  assert.equal(conflict.currentVersion,4); assert.equal(JSON.stringify(conflict).includes("secret"),false);
});
