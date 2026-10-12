import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp,readFile,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
const root=process.cwd(), directory=await mkdtemp(join(tmpdir(),'clothing-m2-http-'));
const port=Number(process.env.M2_TEST_PORT??3110),origin=`http://127.0.0.1:${port}`;
const server=spawn(process.execPath,['node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port',String(port)],{cwd:root,env:{...process.env,APP_MODE:'fixture',APP_URL:origin,FIXTURE_AUTH_DIR:directory,FIXTURE_DB_DIR:join(directory,'database'),FIXTURE_MEDIA_DIR:join(directory,'media'),NEXT_TELEMETRY_DISABLED:'1'},stdio:['ignore','pipe','pipe']});
let logs='',exited=false;server.stdout.on('data',d=>logs+=d);server.stderr.on('data',d=>logs+=d);server.on('exit',()=>exited=true);
async function req(path,options={}){assert.ok(path.startsWith('/'));return fetch(origin+path,{...options,redirect:'manual',signal:AbortSignal.timeout(30000)});}
async function json(path,method='GET',body,cookie,status=200){const response=await req(path,{method,headers:{...(cookie?{Cookie:cookie}:{}),...(body===undefined?{}:{'Content-Type':'application/json',Origin:origin})},...(body===undefined?{}:{body:JSON.stringify(body)})});const payload=await response.json();assert.equal(response.status,status,`${method} ${path}: ${JSON.stringify(payload)}`);assert.match(response.headers.get('cache-control')??'',/no-store/);return status<400?payload.data:payload.error;}
async function login(persona){const response=await req('/api/v1/auth/fixture',{method:'POST',headers:{Origin:origin,'Content-Type':'application/x-www-form-urlencoded'},body:`persona=${persona}`});assert.equal(response.status,303);return response.headers.getSetCookie()[0].split(';')[0];}
try{
  let ready=false;for(let i=0;i<100;i++){if(exited)throw Error(logs);try{ready=(await req('/admin/login')).ok;if(ready)break;}catch{}await delay(100);}assert(ready,logs);
  const owner=await login('owner'),staff=await login('staff'),customer=await login('customer');
  await json('/api/v1/admin/products','GET',undefined,undefined,401);
  await json('/api/v1/admin/products','POST',{},customer,403);
  await json('/api/v1/admin/settings','GET',undefined,staff,403);
  await json('/api/v1/admin/settings','POST',{},staff,403);
  const cross=await req('/api/v1/admin/products',{method:'POST',headers:{Cookie:owner,Origin:'https://other.example','Content-Type':'application/json'},body:'{}'});assert.equal(cross.status,403);
  const huge=await req('/api/v1/admin/products',{method:'POST',headers:{Cookie:owner,Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({title:'x'.repeat(270000)})});assert.equal(huge.status,413);
  const catalog=await json('/api/v1/admin/products','GET',undefined,staff);assert.equal(catalog.products.length,16);
  console.log('PASS M2 authorization, owner-only settings, origin and bounded JSON checks');
  const fields={title:'M2 HTTP Test Cap',slug:'m2-http-test-cap',description:'Locally created fixture review product.',categoryId:catalog.categories[0].id,tags:[],fit:'regular',material:'Fixture material',care:['Fixture care only'],sizeGuideId:null,featuredRank:0};
  let p=await json('/api/v1/admin/products','POST',fields,staff);
  const productPath=`/api/v1/admin/products/${p.id}`;
  assert.equal((await req('/api/v1/products/'+p.slug)).status,404);
  await json(productPath+'/publish','POST',{version:p.version},staff,422);
  const conflict=await json(productPath,'PATCH',{...fields,title:'Stale title',version:999},staff,409);assert.equal(conflict.currentVersion,p.version);
  const variant={sku:'M2-HTTP-CAP-BLACK',colorKey:'black',colorLabel:'Black',colorHex:'#202020',size:'ONE_SIZE',pricePaise:45000,compareAtPaise:null,taxCategoryKey:null,unitWeightG:120,enabled:true};
  await json(productPath+'/variants','PUT',{version:p.version,variants:[variant,variant]},staff,422);
  p=await json(productPath+'/variants','PUT',{version:p.version,variants:[variant]},staff);
  const adjustment={variantId:p.variants[0].id,delta:5,expectedVersion:p.variants[0].inventory.version,reason:'M2 HTTP fixture intake',operationKey:'m2-http-intake'};
  const first=await json('/api/v1/admin/inventory/adjustments','POST',adjustment,staff),repeat=await json('/api/v1/admin/inventory/adjustments','POST',adjustment,staff);assert.equal(first.movementId,repeat.movementId);assert.equal(repeat.replayed,true);
  await json('/api/v1/admin/inventory/adjustments','POST',{...adjustment,delta:-6,expectedVersion:2,operationKey:'invalid-removal'},staff,409);
  const settings=await json('/api/v1/admin/settings','POST',{action:'savePackaging',id:null,expectedVersion:0,value:{label:'M2 fixture box',lengthCm:20,widthCm:15,heightCm:10,tareWeightG:50,maxContentsWeightG:1000,maxItems:4,priority:0,active:true}},owner);
  p=await json(productPath+'/packaging','PUT',{version:p.version,presetIds:[settings.packaging[0].id]},staff);
  console.log('PASS product drafts, validation, optimistic conflicts, packaging and idempotent inventory');
  const bytes=await readFile('public/fixtures/catalog/p01-front.png');
  await json('/api/v1/admin/media/uploads','POST',{fileName:'bad.svg',contentType:'image/svg+xml',sizeBytes:10,kind:'image'},staff,422);
  const ticket=await json('/api/v1/admin/media/uploads','POST',{fileName:'fixture-review.png',contentType:'image/png',sizeBytes:bytes.length,kind:'image'},staff);
  assert.equal((await req(ticket.uploadUrl,{method:'PUT',headers:{Cookie:customer,Origin:origin,...ticket.requiredHeaders},body:bytes})).status,403);
  assert.equal((await req(ticket.uploadUrl,{method:'PUT',headers:{Cookie:staff,Origin:origin,...ticket.requiredHeaders},body:bytes})).status,200);
  let media=await json(`/api/v1/admin/media/${ticket.mediaId}/complete`,'POST',{},staff);assert.equal(media.status,'ready');assert.equal(media.contentType,'image/webp');
  assert.equal((await req(media.previewUrl)).status,401);
  const preview=await req(media.previewUrl,{headers:{Cookie:staff}});assert([200,307].includes(preview.status));if(preview.status===307){const signed=new URL(preview.headers.get('location'));const image=await req(signed.pathname+signed.search,{headers:{Cookie:staff}});assert.equal(image.status,200);assert.equal(image.headers.get('content-type'),'image/webp');}
  media=await json(`/api/v1/admin/media/${media.id}`,'PATCH',{version:media.version,alt:'Original neutral fixture placeholder',source:'Local deterministic fixture generator',license:'Original project test asset',focalX:0.5,focalY:0.5,posterMediaId:null},staff);
  const attachment=await json('/api/v1/admin/media/attachments','PUT',{productId:p.id,version:p.version,items:[{mediaId:media.id,colorKey:null,isCover:true}]},staff);p=await json(productPath,'GET',undefined,staff);assert.equal(attachment.version,p.version);
  p=await json(productPath+'/publish','POST',{version:p.version},staff);assert.equal(p.status,'published');
  const published=await json('/api/v1/products/'+p.slug);assert.equal(published.id,p.id);assert.equal(published.media.length,1);assert.equal(published.variants[0].available,true);assert(!('inventory' in published.variants[0]));assert(!('sku' in published.variants[0]));assert(!('stageKey' in published.media[0]));
  const publicImage=await req('/api/v1/media/'+published.media[0].publicKey);assert.equal(publicImage.status,200);assert.equal(publicImage.headers.get('content-type'),'image/webp');
  assert.equal((await req('/api/v1/media/staging/private/file.png')).status,404);
  await json(`/api/v1/admin/media/${media.id}`,'DELETE',{version:media.version},staff,409);
  console.log('PASS real PNG upload, authenticated preview, validated immutable promotion and immediate public product');
  // A separate ready asset can publish directly as a collection cover / hero.
  const contentTicket=await json('/api/v1/admin/media/uploads','POST',{fileName:'standalone-hero.png',contentType:'image/png',sizeBytes:bytes.length,kind:'image'},staff);
  assert.equal((await req(contentTicket.uploadUrl,{method:'PUT',headers:{Cookie:staff,Origin:origin,...contentTicket.requiredHeaders},body:bytes})).status,200);
  let contentMedia=await json(`/api/v1/admin/media/${contentTicket.mediaId}/complete`,'POST',{},staff);
  contentMedia=await json(`/api/v1/admin/media/${contentMedia.id}`,'PATCH',{version:contentMedia.version,alt:'Standalone fixture hero',source:'Local fixture generator',license:'Original test asset',focalX:0.5,focalY:0.5,posterMediaId:null},staff);
  assert.equal(contentMedia.status,'ready');
  const collectionDraft={title:'M2 HTTP edit',slug:'m2-http-edit',description:'Fixture collection',coverMediaId:contentMedia.id,productIds:[p.id],sortOrder:0,active:true};
  let collections=await json('/api/v1/admin/collections','POST',{action:'save',id:null,expectedVersion:0,draft:collectionDraft},staff);let collection=collections.collections.find(c=>c.draft.slug==='m2-http-edit');assert.equal(collection.active,false);
  collections=await json('/api/v1/admin/collections','POST',{action:'publish',id:collection.id,expectedVersion:collection.version},staff);collection=collections.collections.find(c=>c.id===collection.id);assert.equal(collection.active,true); const promotedCover=await json(`/api/v1/admin/media/${contentMedia.id}`,'GET',undefined,staff);assert.equal(promotedCover.status,'published');assert.equal((await req(promotedCover.publicUrl)).status,200);
  const home={hero:{eyebrow:'FIXTURE',heading:'M2 fixture collection',body:'Review copy only',ctaLabel:'Explore',collectionId:collection.id,mediaId:contentMedia.id},story:{heading:'Our test story',body:'Fixture review only.'},announcement:{text:'',collectionId:null},navigation:[{label:'Fixture edit',collectionId:collection.id}],featuredProductIds:[p.id],lookbook:[]};
  let content=await json('/api/v1/admin/content','POST',{action:'save',expectedVersion:0,draft:home},staff);assert.equal(await json('/api/v1/content/home'),null);
  content=await json('/api/v1/admin/content','POST',{action:'publish',expectedVersion:content.version},staff);assert.equal((await json('/api/v1/content/home')).hero.heading,home.hero.heading);
  await json('/api/v1/admin/content','POST',{action:'save',expectedVersion:content.version,draft:{...home,hero:{...home.hero,heading:'PRIVATE NEXT DRAFT'}}},staff);assert.equal((await json('/api/v1/content/home')).hero.heading,home.hero.heading);
  p=await json(productPath+'/archive','POST',{version:p.version},staff);assert.equal((await req('/api/v1/products/'+p.slug)).status,404);assert.equal(p.variants[0].inventory.onHand,5);assert.equal(p.inventoryMovements.length,1);assert.equal(await json('/api/v1/content/home'),null);
  console.log('PASS content draft/publication isolation, current reference checks and archive preserving stock/history');
  for(const page of ['/admin/products','/admin/products/new',`/admin/products/${p.id}`,`/admin/products/${p.id}/preview`,'/admin/size-guides','/admin/media','/admin/collections','/admin/content','/admin/settings']){const response=await req(page,{headers:{Cookie:owner}});assert.equal(response.status,200,page);const html=await response.text();assert(!html.includes('Application error'),page);}
  console.log('PASS all M2 admin pages render on the production server');
}catch(error){console.error(logs);throw error;}finally{server.kill('SIGTERM');for(let i=0;i<30&&!exited;i++)await delay(100);if(!exited)server.kill('SIGKILL');await rm(directory,{recursive:true,force:true});}
