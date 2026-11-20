const json = (data, status = 200) => Response.json(data, {status, headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
function validate(r) {
  return r && typeof r.id==='string' && r.id.length>0 && r.id.length<=200 && typeof r.title==='string' && r.title.trim() && r.title.length<=1000 && ['watched','want'].includes(r.status) && Number.isFinite(r.rating) && r.rating>=0 && r.rating<=5 && Number.isFinite(r.updated) && ['date','meta','review'].every(k=>typeof r[k]==='string' && r[k].length<=100000);
}
function clean(r) { const {_revision,...body}=r; return body; }
export async function api(request, env) {
  if(new URL(request.url).pathname.startsWith('/api/bot/'))return botApi(request,env);
  if(!request.headers.get('oai-authenticated-user-id'))return json({error:'同じChatGPTアカウントでログインしてください。'},401);
  if(new URL(request.url).pathname.startsWith('/api/tmdb'))return tmdb(request,env);
  if(!env.DB)return json({error:'保存先の準備が完了していません。'},503);
  const url=new URL(request.url);
  if(request.method!=='GET' && (request.headers.get('Origin')!==url.origin || !request.headers.get('Content-Type')?.startsWith('application/json')))return json({error:'この画面から操作してください。'},403);
  try {
    if(url.pathname==='/api/enrich')return await enrichBatch(request,env);
    if(url.pathname==='/api/records' && request.method==='GET') {
      const {results}=await env.DB.prepare('SELECT body, revision FROM films ORDER BY id').all();
      return json({records:results.map(r=>({...JSON.parse(r.body),_revision:r.revision}))});
    }
    if(url.pathname==='/api/import' && request.method==='POST') {
      const data=await request.json();
      if(!Array.isArray(data.records)||data.records.length>10000||!data.records.every(validate)||new Set(data.records.map(r=>r.id)).size!==data.records.length)return json({error:'記録の形式が正しくありません。'},400);
      let added=0;
      for(let i=0;i<data.records.length;i+=50){
        const results=await env.DB.batch(data.records.slice(i,i+50).map(r=>env.DB.prepare('INSERT OR IGNORE INTO films (id, body, revision) VALUES (?, ?, 1)').bind(r.id,JSON.stringify(clean(r)))));
        added+=results.reduce((n,r)=>n+(r.meta?.changes||0),0);
      }
      return json({added});
    }
    if(url.pathname.startsWith('/api/records/')) {
      const id=decodeURIComponent(url.pathname.slice('/api/records/'.length));const data=await request.json();
      if(!Number.isInteger(data._revision)||data._revision<1)return json({error:'最新の画面を開き直してから編集してください。'},409);
      let result;
      if(request.method==='PUT') {
        if(!validate(data)||data.id!==id)return json({error:'記録の形式が正しくありません。'},400);
        result=await env.DB.prepare('UPDATE films SET body = ?, revision = revision + 1 WHERE id = ? AND revision = ?').bind(JSON.stringify(clean(data)),id,data._revision).run();
      }else if(request.method==='DELETE') {
        result=await env.DB.prepare('DELETE FROM films WHERE id = ? AND revision = ?').bind(id,data._revision).run();
      }else return json({error:'この操作は利用できません。'},405);
      if(result.meta.changes!==1)return json({error:'別の端末で更新されています。この画面を開き直してから編集してください。入力中の感想はコピーして残せます。'},409);
      return json({saved:true});
    }
    return json({error:'見つかりません。'},404);
  }catch(e){return json({error:'同期できませんでした。通信状態を確認してもう一度お試しください。'},503);}
}

const TMDB_HOST='https://api.themoviedb.org/3/';
async function cipherKey(env){return crypto.subtle.importKey('raw',Uint8Array.from(atob(env.TMDB_CONFIG_KEY),c=>c.charCodeAt(0)), 'AES-GCM',false,['encrypt','decrypt']);}
async function storedKey(env){const row=await env.DB.prepare("SELECT body FROM app_settings WHERE name = 'tmdb'").first();if(!row)return '';const data=JSON.parse(row.body);return new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:Uint8Array.from(data.iv)},await cipherKey(env),Uint8Array.from(data.data)));}
async function upstream(path,key,params){const target=new URL(TMDB_HOST+path);target.searchParams.set('language','ja-JP');for(const [k,v] of params)if(['query','region','include_adult','include_video','page','watch_region','with_watch_providers','with_watch_monetization_types','sort_by','append_to_response','with_release_type','release_date.gte','release_date.lte','with_genres','without_genres','with_original_language','first_air_date.gte','first_air_date.lte','air_date.gte','air_date.lte'].includes(k)&&v.length<=300)target.searchParams.set(k,v);const headers={accept:'application/json'};if(/^[a-f0-9]{32}$/i.test(key))target.searchParams.set('api_key',key);else headers.Authorization='Bearer '+key;return fetch(target,{headers,signal:AbortSignal.timeout(15000)});}
// Calendar arithmetic uses the Tokyo calendar date, independent of server timezone.
function japanWeek(now = new Date()) {
 const today = new Date(now.toLocaleDateString('en-CA', {timeZone:'Asia/Tokyo'}) + 'T00:00:00Z');
 const monday = new Date(today);
 monday.setUTCDate(today.getUTCDate() - (today.getUTCDay() + 6) % 7);
 const sunday = new Date(monday);
 sunday.setUTCDate(monday.getUTCDate() + 6);
 return {start:monday.toISOString().slice(0,10),end:sunday.toISOString().slice(0,10)};
}
async function tmdb(request,env){
 const url=new URL(request.url);
 try{
  if(!env.DB||!env.TMDB_CONFIG_KEY)return json({error:'共通接続を準備しています。'},503);
  if(url.pathname==='/api/tmdb/connection'){
   if(request.method==='GET')return json({connected:!!(await storedKey(env))});
   if(request.method!=='POST'||request.headers.get('Origin')!==url.origin||!request.headers.get('Content-Type')?.startsWith('application/json'))return json({error:'この画面から操作してください。'},403);
   const data=await request.json();const key=typeof data.credential==='string'?data.credential.trim():'';
   if(!key||key.length>4096)return json({error:'接続キーを確認してください。'},400);
   const check=await upstream('configuration',key,[]);if(!check.ok)return json({error:'TMDBの接続キーを確認してください。'},400);
   const iv=crypto.getRandomValues(new Uint8Array(12));const encrypted=await crypto.subtle.encrypt({name:'AES-GCM',iv},await cipherKey(env),new TextEncoder().encode(key));
   await env.DB.prepare("INSERT INTO app_settings(name,body) VALUES('tmdb',?) ON CONFLICT(name) DO UPDATE SET body=excluded.body").bind(JSON.stringify({iv:[...iv],data:[...new Uint8Array(encrypted)]})).run();return json({connected:true});
  }
  if(request.method!=='GET')return json({error:'利用できません。'},405);
  let path=url.pathname.slice('/api/tmdb/'.length);
  let params=url.searchParams;
  if(path==='catalog/week'){
   const week=japanWeek();
   path='discover/movie';
   params=new URLSearchParams({page:params.get('page')||'1',region:'JP',with_release_type:'3|2','release_date.gte':week.start,'release_date.lte':week.end,sort_by:'release_date.asc',include_adult:'false',include_video:'false'});
  }
  if(!/^(configuration|search\/(?:movie|tv)|discover\/(?:movie|tv)|movie\/now_playing|trending\/(?:movie|tv)\/week|watch\/providers\/(?:movie|tv)|(?:movie|tv)\/[1-9]\d*(?:\/watch\/providers)?)$/.test(path))return json({error:'見つかりません。'},404);
  const key=await storedKey(env);if(!key)return json({error:'映画情報を接続してください。'},503);
  const result=await upstream(path,key,params);if(!result.ok)return json({error:result.status===429?'検索が混み合っています。少し待って再度お試しください。':'映画情報を取得できませんでした。'},result.status===429?429:502);
  return json(await result.json());
 }catch{return json({error:'映画情報に接続できませんでした。時間をおいて再度お試しください。'},503);}
}
