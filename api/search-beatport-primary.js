// Primary single-request Beatport catalog search: API.SH supplies matching + DJ metadata.
// Returns Beatport catalog IDs, NOT MusicAPI connected-user playlist item IDs.
// MusicAPI item IDs are verified separately before playlist creation.
import '../matching.js';
export const maxDuration=30;
const requests=new Map();
function deny(res,status,code,error){return res.status(status).json({ok:false,code,error})}
const clean=(x,n=200)=>typeof x==='string'?x.trim().slice(0,n):'';
function allow(ip){
 const now=Date.now(),key=String(ip||'unknown').slice(0,100);
 const q=requests.get(key)||{minute:now,perMinute:0,day:now,perDay:0};
 if(now-q.minute>=60000){q.minute=now;q.perMinute=0}
 if(now-q.day>=86400000){q.day=now;q.perDay=0}
 q.perMinute++;q.perDay++;requests.set(key,q);
 if(requests.size>700)for(const [k,v] of requests)if(now-v.day>=86400000)requests.delete(k);
 return q.perMinute<=10&&q.perDay<=40;
}
function normalize(x){
 if(!x||typeof x!=='object')return null;
 const artists=Array.isArray(x.artists)?x.artists.map(a=>clean(typeof a==='string'?a:a?.name,120)).filter(Boolean):[];
 const remixers=Array.isArray(x.remixers)?x.remixers.map(a=>clean(typeof a==='string'?a:a?.name,120)).filter(Boolean):[];
 const id=String(x.id??'');
 const name=clean(x.name,220);
 if(!/^[0-9]{1,12}$/.test(id)||!name||!artists.length)return null;
 const rawISRC=clean(x.isrc,30).toUpperCase();
 const bpm=Number(x.bpm);
 const key=clean(x.camelot,4).toUpperCase();
 const url=clean(x.url,300);
 return {externalId:id,beatportId:id,name,artistNames:artists,artist:artists.join(', ').slice(0,250),
   mixHint:clean(x.mix_name,100),...(remixers.length?{remixerNames:remixers}:{}),isrc:/^[A-Z]{2}[A-Z0-9]{3}[0-9]{7}$/.test(rawISRC)?rawISRC:'',
   bpm:Number.isFinite(bpm)&&bpm>=40&&bpm<=240?bpm:null,
   key:/^(?:[1-9]|1[0-2])[AB]$/.test(key)?key:'',
   genre:clean(x.genre?.name,90),
   url:/^https:\/\/(?:www\.)?beatport\.com\/track\//.test(url)?url:null,
   provider:'api.sh',exportIdVerified:false};
}
export default async function handler(req,res){
 res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
 if(req.method==='GET')return res.status(200).json({ok:true,enabled:Boolean(process.env.APISH_API_KEY),provider:'API.SH'});
 if(req.method!=='POST'){res.setHeader('Allow','GET, POST');return deny(res,405,'method','Method not allowed')}
 const host=String(req.headers['x-forwarded-host']||req.headers.host||'').split(',')[0].trim();
 if(!host||String(req.headers.origin||'')!=='https://'+host)return deny(res,403,'origin','Invalid request origin');
 if(!process.env.APISH_API_KEY)return deny(res,503,'not_configured','API.SH is not configured');
 let body=req.body; if(typeof body==='string'){try{body=JSON.parse(body)}catch{return deny(res,400,'json','Invalid JSON')}}
 const artist=clean(body?.artist,160),title=clean(body?.title,180),remix=clean(body?.remix,100),isrc=clean(body?.isrc,25);
 if(!title||!artist)return deny(res,400,'input','Artist and title are required');
 const ip=String(req.headers['x-forwarded-for']||req.socket?.remoteAddress||'unknown').split(',')[0].trim();
 if(!allow(ip))return deny(res,429,'rate_limit','Catalog lookup limit reached');
 const u=new URL('https://api.api.sh/beatport/v1/search');
 u.searchParams.set('q',(artist+' '+title).slice(0,300));
 u.searchParams.set('type','tracks');u.searchParams.set('per_page','25');
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20000);
 try{
  const response=await fetch(u,{headers:{'x-api-key':process.env.APISH_API_KEY,Accept:'application/json'},signal:controller.signal});
  if(response.status===429)return deny(res,429,'provider_limit','API.SH rate limit reached');
  if(response.status===401||response.status===403)return deny(res,503,'auth','API.SH access rejected');
  if(!response.ok)return deny(res,502,'upstream','API.SH Beatport search unavailable');
  const data=await response.json().catch(()=>null);
  if(!data||!Array.isArray(data.results))return deny(res,502,'schema','Unexpected Beatport search response');
  const source={title,artist,remix,isrc};
  const ranked=globalThis.CrateflowMatching.rankCandidates(source,data.results.slice(0,25).map(normalize).filter(Boolean),true);
  // Keep eligible alternatives even when duplicate records fill the display shortlist.
  const candidates=ranked.filter((candidate,index)=>index<8||candidate.assessment.autoEligible);
  const best=globalThis.CrateflowMatching.bestAutomatic(source,candidates,true);
  return res.status(200).json({ok:true,provider:'API.SH',status:best?'matched':candidates.length?'review':'not_found',
   candidates,creditsUsed:Number.isFinite(Number(data.credits_used))?Number(data.credits_used):null});
 }catch{return deny(res,controller.signal.aborted?504:502,'network','API.SH request failed or timed out')}
 finally{clearTimeout(timer)}
}
