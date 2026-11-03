const worker = new URL('../supabase/functions/send-openai-ads-conversions/index.ts', import.meta.url);
Deno.test('worker exige consentimento atualizado para Meta/OpenAI e envia GA4 sem personalizacao', async () => {
  const original = { serve: Deno.serve, envGet: Deno.env.get, fetch: globalThis.fetch };
  let handler;
  const sent=[], finalized=[];
  const row={event_name:'schedule',event_id:'fixture',email:'fixture@example.invalid',phone:null,
    oppref:null,external_id:'fixture',party_size:2,landing_url:'https://example.invalid/',
    occurred_at:new Date(Date.now()-1000).toISOString()};
  globalThis.__consentWorker={client:{async rpc(name,args){
    if(name==='fn_advertising_event_allowed') return {data:args.p_queue_id.endsWith('-ok'),error:null};
    if(name==='fn_finalize_openai_ads_conversion'){finalized.push(args);return {error:null};}
    if(name==='fn_claim_pending_openai_ads_conversions')return {data:[{...row,queue_id:'openai-ok'},{...row,queue_id:'openai-denied'}]};
    if(name==='fn_claim_pending_meta_conversions')return {data:[{...row,queue_id:'meta-ok'},{...row,queue_id:'meta-denied'}]};
    if(name==='fn_claim_pending_ga4_conversions')return {data:[{...row,queue_id:'ga',client_id:'123.456',session_id:'123'}]};
    throw new Error('Unexpected RPC '+name);
  }}};
  try {
    Deno.env.get=(key)=>key==='OPENAI_ADS_TRIGGER_SECRET'?'fixture-trigger':'fixture-config';
    Deno.serve=(callback)=>{handler=callback;};
    globalThis.fetch=async(url,options)=>{sent.push({url,body:JSON.parse(options.body)});return new Response('{}',{status:200});};
    let source=(await Deno.readTextFile(worker)).replace(
      'import { createClient } from "https://esm.sh/@supabase/supabase-js@2";',
      'const createClient = () => globalThis.__consentWorker.client;');
    for(const helper of ['openai-event.ts','meta-event.ts'])source=source.replace('"./'+helper+'"',JSON.stringify(new URL('../supabase/functions/send-openai-ads-conversions/'+helper,import.meta.url).href));
    await import('data:application/typescript;base64,'+btoa(unescape(encodeURIComponent(source))));
    const response=await handler(new Request('https://example.invalid',{method:'POST',headers:{'x-openai-ads-secret':'fixture-trigger'},body:'{}'}));
    const result=await response.json();
    if(result.sent!==3||result.failed!==2||sent.length!==3)throw new Error('Enviou publicidade sem consentimento');
    const ga=sent.find(x=>x.url.includes('google-analytics.com')).body;
    if(ga.non_personalized_ads!==true||ga.consent.ad_user_data!=='DENIED'||ga.consent.ad_personalization!=='DENIED')throw new Error('GA4 sem restricao publicitaria');
    const meta=sent.find(x=>x.url.includes('facebook.com')).body.data[0];
    if('value' in meta.custom_data||'currency' in meta.custom_data)throw new Error('Receita presumida');
    if(finalized.filter(x=>x.p_status==='failed').length!==2)throw new Error('Recusa ignorada');
  } finally {
    Deno.serve=original.serve;Deno.env.get=original.envGet;globalThis.fetch=original.fetch;
    delete globalThis.__consentWorker;
  }
});
