// Match only unambiguous exact titles; never use popularity as identity evidence.
export const normalizeTitle = s => String(s||'').normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}]/gu,'');
export function chooseCandidate(record,data){
 const title=normalizeTitle(record.title),year=(record.meta||'').match(/((?:19|20)\d{2})年製作/)?.[1];
 if(data.total_pages>1)return {reason:'候補が多いため要確認'};
 const exact=(data.results||[]).filter(m=>[m.title,m.original_title].some(t=>normalizeTitle(t)===title));
 const candidates=year?exact.filter(m=>m.release_date?.slice(0,4)===year):exact;
 if(candidates.length!==1)return {reason:candidates.length>1?'同名作品の候補が複数':'作品名・公開年の完全一致なし'};
 if(!year&&title.length<=3)return {reason:'短い作品名・公開年なしのため要確認'};
 return {candidate:candidates[0],evidence:year?'作品名と製作年が完全一致':'作品名が完全一致・全検索結果内で候補が1件'};
}
const txt=v=>typeof v==='string'?v:'';
export function metadata(data){
 const now=Date.now(),jp=data['watch/providers']?.results?.JP,groups={};
 for(const k of ['flatrate','rent','buy','free','ads'])groups[k]=[...new Set((jp?.[k]||[]).map(p=>txt(p.provider_name)).filter(Boolean))];
 const dates=(data.release_dates?.results||[]).find(r=>r.iso_3166_1==='JP')?.release_dates||[];
 return {source:'TMDB',id:data.id,title:txt(data.title),originalTitle:txt(data.original_title),releaseDate:txt(data.release_date),japanTheatricalDate:dates.filter(r=>[2,3].includes(r.type)).map(r=>r.release_date.slice(0,10)).sort()[0]||'',runtime:data.runtime||null,directors:(data.credits?.crew||[]).filter(p=>p.job==='Director').map(p=>txt(p.name)),cast:(data.credits?.cast||[]).slice(0,12).map(p=>({name:txt(p.name),character:txt(p.character)})),genres:(data.genres||[]).map(g=>txt(g.name)),overview:txt(data.overview),poster:/^\/[\w.-]+$/.test(data.poster_path||'')?'https://image.tmdb.org/t/p/w500'+data.poster_path:'',checkedAt:now,providers:data['watch/providers']?{...groups,checkedAt:now,region:'JP',link:txt(jp?.link)}:null,providerError:!data['watch/providers']};
}
export const protectedRecord = record => {const {movie,enrichment,_revision,...rest}=record;return rest;};
export async function enrichBatch(request,env){
 const url=new URL(request.url);
 if(request.method==='GET'){
  const {results}=await env.DB.prepare('SELECT f.id,f.body,s.body AS original FROM films f LEFT JOIN enrichment_snapshots s ON f.id=s.id').all();
  let linked=0,review=0,errors=0,posters=0,protectedMismatch=0,processed=0;
  for(const row of results){const r=JSON.parse(row.body);if(r.enrichment){processed++;if(r.enrichment.status==='linked')linked++;else if(r.enrichment.status==='review')review++;else errors++;}if(r.movie?.poster)posters++;if(row.original){const o=JSON.parse(row.original),core=x=>JSON.stringify([x.title,x.status,x.rating,x.review,x.meta]);/* Only records the owner has not edited since the snapshot; enrichment never changes updated. */if(o.updated===r.updated&&core(r)!==core(o))protectedMismatch++;}}
  return json({total:results.length,processed,linked,review,errors,posters,protectedMismatch});
 }
 if(request.method!=='POST')return json({error:'利用できません。'},405);
 const input=await request.json(),cursor=typeof input.cursor==='string'?input.cursor:'';
 const {results}=await env.DB.prepare('SELECT id,body,revision FROM films WHERE id > ? ORDER BY id LIMIT 5').bind(cursor).all();
 const key=await storedKey(env);if(!key)return json({error:'映画情報の共通接続が必要です。'},503);
 const outcomes=await Promise.all(results.map(async row=>{
  const record=JSON.parse(row.body);
  if(record.enrichment||record.movie?.id)return {id:row.id,status:'skip'};
  try{
   const search=await upstream('search/movie',key,[['query',record.title],['include_adult','false'],['region','JP']]);if(!search.ok)throw new Error('search');
   const data=await search.json(),match=chooseCandidate(record,data);let movie;
   if(match.candidate){const detail=await upstream('movie/'+match.candidate.id,key,[['append_to_response','credits,release_dates,watch/providers']]);if(!detail.ok)throw new Error('details');const d=await detail.json();if(d.id!==match.candidate.id)throw new Error('identity');movie=metadata(d);}
   const enrichment={status:movie?'linked':'review',reason:match.evidence||match.reason,checkedAt:Date.now(),candidates:movie?[]:(data.results||[]).filter(m=>normalizeTitle(m.title)===normalizeTitle(record.title)||normalizeTitle(m.original_title)===normalizeTitle(record.title)).slice(0,6).map(m=>({id:m.id,title:m.title,year:(m.release_date||'').slice(0,4)}))};
   const next={...record,...(movie?{movie}:{}),enrichment};
   // The snapshot and optimistic update are one transaction. Concurrent edits win.
   const saved=await env.DB.batch([env.DB.prepare('INSERT OR IGNORE INTO enrichment_snapshots(id,body,revision) VALUES(?,?,?)').bind(row.id,row.body,row.revision),env.DB.prepare('UPDATE films SET body=?,revision=revision+1 WHERE id=? AND revision=?').bind(JSON.stringify(next),row.id,row.revision)]);
   return {id:row.id,status:saved[1].meta.changes===1?enrichment.status:'conflict'};
  }catch{return {id:row.id,status:'error'};}
 }));
 return json({cursor:results.at(-1)?.id||cursor,done:results.length<5,outcomes});
}
