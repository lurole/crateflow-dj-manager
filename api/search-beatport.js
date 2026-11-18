import crypto from 'node:crypto';
// MusicAPI Beatport catalog lookup. No cart or user account mutations.
// Beta: only perform a lookup when explicitly requested by the browser.
// This public beta route has basic per-instance throttling, not durable user authentication.
const hits=new Map();
export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  if(req.method!=='POST'){res.setHeader('Allow','POST');return res.status(405).json({ok:false,error:'Method not allowed'});}
  const host=String(req.headers['x-forwarded-host']||req.headers.host||'').split(',')[0];
  const origin=String(req.headers.origin||'');
  if(!host||origin!=='https://'+host)return res.status(403).json({ok:false,error:'Invalid origin'});
  if(process.env.MUSICAPI_ENABLE_VERIFICATION!=='true')return res.status(503).json({ok:false,error:'MusicAPI evaluation is not enabled'});
  const rawCookie=String(req.headers.cookie||'').split(';').map(v=>v.trim()).find(v=>v.startsWith('cf_bp='))?.slice(6);
  const secret=process.env.MUSICAPI_CLIENT_SECRET;
  if(!rawCookie||!secret)return res.status(401).json({ok:false,error:'Reconnect Beatport to enable account search'});
  const parts=rawCookie.split('.');
  if(parts.length!==2)return res.status(401).json({ok:false,error:'Invalid Beatport session'});
  const expected=crypto.createHmac('sha256',secret).update('crateflow-beatport-v1.'+parts[0]).digest('base64url');
  if(parts[1].length!==expected.length||!crypto.timingSafeEqual(Buffer.from(parts[1]),Buffer.from(expected)))return res.status(401).json({ok:false,error:'Invalid Beatport session'});
  let session;
  try{session=JSON.parse(Buffer.from(parts[0],'base64url').toString('utf8'))}catch{return res.status(401).json({ok:false,error:'Invalid Beatport session'})}
  if(!/^[0-9a-f-]{36}$/i.test(session?.uid||'')||!Number.isInteger(session?.exp)||session.exp<Math.floor(Date.now()/1000))return res.status(401).json({ok:false,error:'Beatport session expired. Reconnect Beatport'});
  const clientId=process.env.MUSICAPI_CLIENT_ID;
  if(!clientId)return res.status(503).json({ok:false,error:'MusicAPI client ID missing on server'});
  const ip=String(req.headers['x-forwarded-for']||'unknown').split(',')[0].trim().slice(0,80);
  const now=Date.now(),value=hits.get(ip)||{time:now,count:0};
  if(now-value.time>60000){value.time=now;value.count=0;}
  value.count++;hits.set(ip,value);
  if(hits.size>1000)for(const [key,item] of hits)if(now-item.time>120000)hits.delete(key);
  if(value.count>12)return res.status(429).json({ok:false,error:'Search limit reached; try again later'});
  let body=req.body;
  if(typeof body==='string'){try{body=JSON.parse(body)}catch{return res.status(400).json({ok:false,error:'Invalid JSON'})}}
  const artist=typeof body?.artist==='string'?body.artist.trim():'';
  const title=typeof body?.title==='string'?body.title.trim():'';
  if(!artist||!title||artist.length>160||title.length>200)return res.status(400).json({ok:false,error:'Artist and track title required'});
  const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),9500);
  try{
    const response=await fetch('https://api.musicapi.com/api/'+encodeURIComponent(session.uid)+'/search',{
      method:'POST',
      headers:{Authorization:'Basic '+Buffer.from(clientId+':'+secret).toString('base64'),'Content-Type':'application/json',Accept:'application/json'},
      body:JSON.stringify({type:'track',track:title,artist}),
      signal:controller.signal
    });
    const data=await response.json().catch(()=>({}));
    if(!response.ok){
      const code=typeof data?.internalCode==='number'?data.internalCode:null;
      const reason=response.status===412?'Beatport session needs reconnecting':response.status===418?'Beatport account search not supported':response.status===401||response.status===403?'MusicAPI account search not authorized':response.status===429?'MusicAPI rate limit reached':'Beatport account search failed';
      return res.status(502).json({ok:false,error:reason,providerStatus:response.status,providerCode:code});
    }
    const raw=Array.isArray(data?.tracks)?data.tracks:Array.isArray(data?.items)?data.items:Array.isArray(data)?data:[];
    const candidates=raw.slice(0,6).map(item=>{
      const d=item?.data||item;
      const artistNames=Array.isArray(d?.artistNames)?d.artistNames:Array.isArray(d?.artists)?d.artists.map(a=>typeof a==='string'?a:a?.name):[];
      const name=String(d?.name||d?.title||'').slice(0,220);
      const url=String(d?.url||d?.externalUrl||'');
      return {name,artist:artistNames.join(', ').slice(0,250),url:/^https:\/\/(www\.)?beatport\.com\/track\//.test(url)?url:null,externalId:String(d?.externalId||d?.id||'').slice(0,80),isrc:String(d?.isrc||'').slice(0,40),mixHint:/extended/i.test(name)?'Extended Mix':/radio/i.test(name)?'Radio Edit':/original/i.test(name)?'Original Mix':'Unspecified'};
    }).filter(c=>c.name);
    return res.status(200).json({ok:true,status:candidates.length?'success':'not_found',candidates});
  }catch{return res.status(502).json({ok:false,error:'Beatport search timed out or failed'});}
  finally{clearTimeout(timeout);}
}
