import assert from "node:assert/strict";
import test from "node:test";
import { collectionActionSchema, defaultHome, homeActionSchema } from "../src/lib/admin/content-contracts.ts";
import { defaultSettings, settingsActionSchema } from "../src/lib/admin/settings-contracts.ts";
test("content contracts reject request-supplied identity, duplicate references and missing versions",()=>{
  const draft={title:"Edit",slug:"edit",description:"",coverMediaId:null,productIds:["92000000-0000-4000-8000-000000000001"],sortOrder:0,active:true};
  assert(collectionActionSchema.safeParse({action:"save",id:null,expectedVersion:0,draft}).success);
  assert(!collectionActionSchema.safeParse({action:"save",id:null,expectedVersion:0,draft,actor:"owner"}).success);
  assert(!collectionActionSchema.safeParse({action:"save",id:null,expectedVersion:0,draft:{...draft,productIds:[...draft.productIds,...draft.productIds]}}).success);
  assert(!homeActionSchema.safeParse({action:"save",draft:defaultHome}).success);
  assert(!homeActionSchema.safeParse({action:"save",expectedVersion:0,draft:{...defaultHome,unexpected:"secret"}}).success);
});
test("settings remain inclusive, unconfigured tax stays explicit, and publication requires actual policy/contact text",()=>{
  assert(settingsActionSchema.safeParse({action:"saveSettings",expectedVersion:0,value:defaultSettings}).success);
  for(const change of [{taxInclusive:false},{policiesPublished:true},{contactPublished:true},{providerSecret:"private"},{shippingFeePaise:0.5}]){
    assert(!settingsActionSchema.safeParse({action:"saveSettings",expectedVersion:0,value:{...defaultSettings,...change}}).success);
  }
  assert.equal(defaultSettings.taxRatePercent,null);
  assert.equal(defaultSettings.shippingMode,"provider");
});
