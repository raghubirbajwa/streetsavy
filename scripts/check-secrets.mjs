import assert from 'node:assert/strict';
import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { parseEnv } from 'node:util';

// Local, redacted guard: known key formats, privileged JWTs, populated example
// secrets, configured secret values in distributable source, and client bundles.
// Not an entropy scanner, history audit, or substitute for hosted secret controls.
const secretNames=['SUPABASE_SECRET_KEY','R2_ACCESS_KEY_ID','R2_SECRET_ACCESS_KEY','RAZORPAY_KEY_SECRET','RAZORPAY_WEBHOOK_SECRET','SHIPROCKET_API_PASSWORD','SHIPROCKET_WEBHOOK_TOKEN','JOBS_SECRET','TRANSACTIONAL_EMAIL_API_KEY'];
function signatures(text){
 const found=[];
 for(const [name,pattern] of [
  ['private-key',/-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/],
  ['AWS-access-key',/\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/],
  ['Supabase-secret',/\bsb_secret_[A-Za-z0-9_-]{20,}\b/],
  ['GitHub-token',/\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})\b/],
  ['secret-key',/\bsk_(?:live|test)_[A-Za-z0-9]{20,}\b/],
 ])if(pattern.test(text))found.push(name);
 for(const token of text.matchAll(/\beyJ[A-Za-z0-9_-]+\.([A-Za-z0-9_-]+)\.[A-Za-z0-9_-]+\b/g)){
  try{if(JSON.parse(Buffer.from(token[1],'base64url').toString()).role==='service_role')found.push('privileged-JWT');}catch{/* Non-JWT text is not evidence of a key. */}
 }
 return found;
}
// Self-check the guard without storing a real credential or printing test values.
assert.ok(signatures('sb_'+'secret_'+'a'.repeat(24)).includes('Supabase-secret'));
assert.ok(signatures('-----BEGIN '+'PRIVATE KEY-----').includes('private-key'));
assert.deepEqual(signatures('RAZORPAY_KEY_SECRET=\nSUPABASE_SECRET_KEY='),[]);
function secretValues(source){
 const declarations=[...source.matchAll(/^[\t ]*(?:export[\t ]+)?([A-Za-z_]\w*)[\t ]*=/gm)];
 return declarations.flatMap((entry,index)=>{
  const name=entry[1];if(!secretNames.includes(name))return [];
  const value=parseEnv(source.slice(entry.index,declarations[index+1]?.index))[name]??'';
  return [{name,value}];
 });
}
assert.deepEqual(secretValues('JOBS_SECRET=\nexport JOBS_SECRET = "guard sentinel"\n'),[{name:'JOBS_SECRET',value:''},{name:'JOBS_SECRET',value:'guard sentinel'}]);
const root=process.cwd(),findings=[];let scanned=0,bundles=0;
const report=(file,rule)=>findings.push(`${relative(root,file)}: ${rule}`);
const example=await readFile(join(root,'.env.example'),'utf8');
for(const {name,value} of secretValues(example))if(value.trim())report(join(root,'.env.example'),`example has a populated ${name}`);
let localEnv='';try{localEnv=await readFile(join(root,'.env.local'),'utf8');}catch{/* An environment file is optional for source scans. */}
const configured=[...secretValues(localEnv),...secretNames.map(name=>({name,value:process.env[name]??''}))].filter(({value})=>value.length>=8);
async function scan(directory,client=false){
 for(const item of await readdir(directory,{withFileTypes:true})){
  if(item.isSymbolicLink())continue;
  const path=join(directory,item.name);
  if(item.isDirectory()){if(!['node_modules','.next','.fixture','.git','review','coverage','test-results'].includes(item.name))await scan(path,client);continue;}
  if(!/\.(?:[cm]?[jt]sx?|json|map|md|sql|ya?ml|toml|html|css|py)$/.test(item.name)&&item.name!=='.env.example')continue;
  if((await stat(path)).size>20*1024*1024){report(path,'file exceeds scan bound');continue;}
  const body=await readFile(path,'utf8');scanned++;if(client)bundles++;
  for(const rule of signatures(body))report(path,rule);
  for(const {name,value} of configured)if(body.includes(value))report(path,`configured ${name} value appears in scanned content`);
  if(client)for(const name of secretNames)if(body.includes(name))report(path,`private configuration name ${name} appears in public bundle`);
 }
}
await scan(root);
try{await scan(join(root,'.next/static'),true);}catch(error){if(error.code==='ENOENT')throw Error('Run npm run build before check:secrets; public bundles are required.');throw error;}
if(!bundles)throw Error('No public build files found; run npm run build.');
if(findings.length){console.error(`FAIL secret guard: ${findings.length} finding(s). Values are redacted.`);for(const finding of [...new Set(findings)])console.error(finding);process.exitCode=1;}
else console.log(`PASS local secret guard: ${scanned} text files including ${bundles} public build files; empty example secrets; no known key/privileged JWT/configured secret value or private client configuration detected. Configured values cover .env.local/process.env values of at least 8 characters. History, entropy and hosted secret storage remain outside this scan.`);
