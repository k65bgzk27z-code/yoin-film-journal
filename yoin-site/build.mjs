import fs from 'node:fs';
fs.rmSync('dist',{recursive:true,force:true});
fs.mkdirSync('dist/server',{recursive:true});
const html=fs.readFileSync('client/index.html','utf8');
const enrichment=fs.readFileSync('worker/enrichment.mjs','utf8').replaceAll('export ','');
const gate=fs.readFileSync('worker/auth-gate.mjs','utf8').replaceAll('export ','');
const bot=fs.readFileSync('worker/bot-api.mjs','utf8').replaceAll('export ','');
const features=fs.readFileSync('worker/features.mjs','utf8').replaceAll('export ','');
const safety=fs.readFileSync('worker/safety.mjs','utf8').replaceAll('export ','');
const api=fs.readFileSync('worker/api.mjs','utf8').replace('export async function api','async function api');
const types={'.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.webmanifest':'application/manifest+json'};
const assets={};
for(const file of fs.readdirSync('client')){if(file==='index.html')continue;const ext=file.slice(file.lastIndexOf('.'));if(types[ext])assets['/'+file]={type:types[ext],base64:fs.readFileSync('client/'+file).toString('base64')};}
const handler='export default {async fetch(request,env){const path=new URL(request.url).pathname;'
+'if(env.AUTH_SECRET&&env.AUTH_PASSPHRASE){const gated=await yoinGate(request,env,path);if(gated instanceof Response)return gated;request=gated;}'
+'if(path.startsWith("/api/"))return api(request,env);const headers={"Cache-Control":"no-store","X-Content-Type-Options":"nosniff","Referrer-Policy":"same-origin"};if(path==="/"||path==="/index.html")return new Response(HTML,{headers:{...headers,"Content-Type":"text/html; charset=utf-8"}});const asset=ASSETS[path];if(asset)return new Response(Uint8Array.from(atob(asset.base64),c=>c.charCodeAt(0)),{headers:{...headers,"Content-Type":asset.type}});return new Response("Not found",{status:404});},async scheduled(event,env,ctx){ctx.waitUntil(runNoticeCheck(env).catch(()=>{}));ctx.waitUntil(runMaintenance(env).catch(()=>{}));}};\n';
fs.writeFileSync('dist/server/index.js',enrichment+'\n'+gate+'\n'+bot+'\n'+features+'\n'+safety+'\n'+api+'\nconst HTML='+JSON.stringify(html)+';\nconst ASSETS='+JSON.stringify(assets)+';\n'+handler);
console.log('Built cloud-backed Yoin (with passphrase gate)');
