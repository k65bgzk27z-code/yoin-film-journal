let enriching=false;
const enrichmentSummary=s=>`${s.total}件中 ${s.processed}件照合済み · 追加 ${s.linked}件 · 要確認 ${s.review}件 · ポスター ${s.posters}件${s.errors?' · 再試行待ち '+s.errors+'件':''} · 評価・感想などの差分 ${s.protectedMismatch}件`;
async function enrichmentStatus(){const s=await api('enrich');$('enrich-status').textContent=enrichmentSummary(s);return s;}
$('review-filter').onclick=()=>{filter=filter==='review'?'all':'review';$('review-filter').textContent=filter==='review'?'すべての記録に戻す':'作品の確認が必要な記録';render();};
$('enrich-start').onclick=async()=>{
 if(enriching)return;enriching=true;$('enrich-start').disabled=true;
 let cursor='',errors=0;
 try{while(true){const b=await api('enrich',{method:'POST',body:JSON.stringify({cursor})});cursor=b.cursor;errors+=b.outcomes.filter(o=>o.status==='error'||o.status==='conflict').length;const s=await enrichmentStatus();if(s.protectedMismatch)throw new Error('記録の変更を検出したため停止しました。');if(b.done)break;await new Promise(r=>setTimeout(r,250));}
 await refresh();const s=await enrichmentStatus();$('enrich-status').textContent='照合完了。'+enrichmentSummary(s)+(errors?` · 通信・同時編集などで今回保留 ${errors}件。再実行で未処理分だけ確認できます。`:'');
 }catch(e){$('enrich-status').textContent=e.message+' 追加済みの情報は保存されています。再実行で続けられます。';}
 finally{enriching=false;$('enrich-start').disabled=false;}
};
enrichmentStatus().catch(()=>{});
