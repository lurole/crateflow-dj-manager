// Explicit opt-in Beatport BPM and Camelot lookup via API.SH.
// Each lookup can consume an API.SH credit. No credential is sent to the browser.
import '../matching.js';
export const maxDuration=30;
const quota=new Map();
const digits=/^[0-9]{1,12}$/;
function fail(res,status,code,error){return res.status(status).json({ok:false,code,error})}
function permitted(ip){
 const now=Date.now(),key=String(ip).slice(0,100);
 const q=quota.get(key)||{minute:now,minCount:0,day:now,dayCount:0};
 if(now-q.minute>60000){q.minute=now;q.minCount=0}
 if(now-q.day>86400000){q.day=now;q.dayCount=0}
 q.minCount++;q.dayCount++;quota.set(key,q);
 if(quota.size>700)for(const [k,v] of quota)if(now-v.day>86400000)quota.delete(k);
 return q.minCount<=10&&q.dayCount<=40;
}
const str=(x,n=200)=>typeof x==='string'?x.trim().slice(0,n):'';
function candidate(x){
 const artists=Array.isArray(x?.artists)?x.artists.map(a=>a?.name).filter(v=>typeof v==='string'):[],
       remixers=Array.isArray(x?.remixers)?x.remixers.map(a=>a?.name).filter(v=>typeof v==='string'):[];
 const isrc=str(x?.isrc,25).toUpperCase();
 const bpm=Number(x?.bpm);
 const camelot=str(x?.camelot,4).toUpperCase();
 const validKey=/^(?:[1-9]|1[0-2])[AB]$/.test(camelot)?camelot:null;
 const url=str(x?.url,300);
 return {externalId:String(x?.id||''),name:str(x?.name),artist:artists.join(', '),mixHint:str(x?.mix_name||'',100),
  isrc,bpm:Number.isFinite(bpm)&&bpm>=40&&bpm<=240?bpm:null,
  key:validKey,genre:str(x?.genre?.name,90),
  url:/^https:\/\/www\.beatport\.com\/track\//.test(url)?url:null,
  remixerNames:remixers};
}
export default async function handler(req,res){
 res.setHeader('Cache-Control','no-store');
 res.setHeader('X-Content-Type-Options','nosniff');
 if(req.method==='GET')return res.status(200).json({ok:true,enabled:Boolean(process.env.APISH_API_KEY),provider:'API.SH',creditsPerLookup:1});
 if(req.method!=='POST'){res.setHeader('Allow','GET, POST');return fail(res,405,'method_not_allowed','Method not allowed')}
 const host=String(req.headers['x-forwarded-host']||req.headers.host||'').split(',')[0].trim();
 if(!host||String(req.headers.origin||'')!=='https://'+host)return fail(res,403,'origin','Invalid request origin');
 if(!process.env.APISH_API_KEY)return fail(res,503,'not_configured','API.SH is not configured.');
 let body=req.body;
 if(typeof body==='string'){try{body=JSON.parse(body)}catch{return fail(res,400,'invalid_json','Invalid JSON')}}
 const title=str(body?.title,180),artist=str(body?.artist,180),remix=str(body?.remix,100),
       isrc=str(body?.isrc,25),beatportId=String(body?.beatportId||'').trim();
 if(!title||!artist)return fail(res,400,'invalid_track','Title and artist required.');
 if(beatportId&&!digits.test(beatportId))return fail(res,400,'invalid_id','Invalid Beatport ID');
 const ip=String(req.headers['x-forwarded-for']||req.socket?.remoteAddress||'unknown').split(',')[0].trim();
 if(!permitted(ip))return fail(res,429,'rate_limited','Daily or per-minute enrichment limit reached.');
 const u=new URL(beatportId?'https://api.api.sh/beatport/v1/track':'https://api.api.sh/beatport/v1/search');
 if(beatportId)u.searchParams.set('id',beatportId);
 else {u.searchParams.set('q',artist+' '+title);u.searchParams.set('type','tracks');u.searchParams.set('per_page','25')}
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),22000);
 try{
  const upstream=await fetch(u,{headers:{'x-api-key':process.env.APISH_API_KEY,Accept:'application/json'},signal:controller.signal});
  if(upstream.status===401||upstream.status===403)return fail(res,503,'provider_authorization','API.SH rejected the key or endpoint permissions.');
  if(upstream.status===429)return fail(res,429,'provider_rate_limit','API.SH credit or rate limit reached.');
  if(upstream.status===404)return fail(res,404,'not_found','No Beatport track found.');
  if(!upstream.ok)return fail(res,502,'provider_unavailable','API.SH Beatport lookup unavailable.');
  const payload=await upstream.json().catch(()=>null);
  const raw=beatportId?[payload]:payload?.results;
  if(!Array.isArray(raw))return fail(res,502,'unexpected_format','Unexpected API.SH response.');
  const t={title,artist,remix,isrc};
  const ranked=globalThis.CrateflowMatching.rankCandidates(t,raw.map(candidate),false);
  // A track with a different title, artist, mix/version or ISRC must never get fabricated DJ data.
  const best=globalThis.CrateflowMatching.bestAutomatic(t,ranked,false);
  if(!best)return fail(res,422,'unverified_match','No verified title, artist and mix match for BPM/key.');
  if(beatportId&&best.externalId!==beatportId)return fail(res,422,'id_mismatch','Beatport track ID does not match.');
  if(best.bpm===null&&!best.key&&!best.genre)return res.status(200).json({ok:true,status:'no_metadata',bpm:null,key:null,genre:null,provider:'API.SH'});
  return res.status(200).json({ok:true,status:'enriched',bpm:best.bpm,key:best.key,
   genre:best.genre||null,beatportId:best.externalId,matchScore:best.score,provider:'API.SH'});
 }catch{return fail(res,controller.signal.aborted?504:502,
    controller.signal.aborted?'timeout':'provider_error','Beatport metadata lookup failed.')}
 finally{clearTimeout(timer)}
}
