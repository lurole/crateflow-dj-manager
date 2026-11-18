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
    const response=await fetch('https://api.musicapi.com/public/search',{
      method:'POST',
      headers:{Authorization:'Token '+clientId,'Content-Type':'application/json',Accept:'application/json'},
      body:JSON.stringify({type:'track',track:title,artist,sources:['beatport']}),
      signal:controller.signal
    });
    const data=await response.json().catch(()=>({}));
    if(!response.ok){
      const providerCode=typeof data?.internalCode==='number'?data.internalCode:null;
      const providerMessage=String(data?.message||data?.error||'').slice(0,140);
      let support='unknown';
      try{
        const metaResponse=await fetch('https://api.musicapi.com/public/search/introspection',{
          headers:{Authorization:'Token '+clientId,Accept:'application/json'},
          signal:controller.signal
        });
        if(metaResponse.ok){
          const meta=await metaResponse.json();
          if(Array.isArray(meta.sources))support=meta.sources.includes('beatport')?'available':'not_supported';
        }
      }catch{/* Diagnostic lookup is optional. */}
      const reason=support==='not_supported'
        ?'Beatport is not supported by MusicAPI public catalog search for this account. A connected-user search needs separate secure integration.'
        :response.status===401||response.status===403
        ?'MusicAPI refused catalog authorization. Check the Client ID and catalog permissions.'
        :response.status===429
        ?'MusicAPI rate limit exceeded. Retry later.'
        :'MusicAPI catalog search failed. Check the provider status and supported sources.';
      return res.status(502).json({ok:false,error:reason,providerStatus:response.status,providerCode,providerMessage,catalogSupport:support});
    }
    const matches=Array.isArray(data.tracks)?data.tracks.filter(t=>t.source==='beatport'):[];
    const candidates=matches.filter(t=>t.status==='success'&&t.data).slice(0,5).map(t=>{
      const d=t.data;
      return {name:String(d.name||'').slice(0,220),artist:Array.isArray(d.artistNames)?d.artistNames.join(', ').slice(0,250):'',url:typeof d.url==='string'&&/^https:\/\/(?:www\.)?beatport\.com\/track\//.test(d.url)?d.url:null,externalId:String(d.externalId||'').slice(0,80),isrc:String(d.isrc||'').slice(0,40),mixHint:/extended/i.test(d.name||'')?'Extended Mix':/radio/i.test(d.name||'')?'Radio Edit':/original/i.test(d.name||'')?'Original Mix':'Unspecified'};
    });
    return res.status(200).json({ok:true,status:matches[0]?.status||'not_found',candidates});
  }catch{return res.status(502).json({ok:false,error:'Beatport search timed out or failed'});}
  finally{clearTimeout(timeout);}
}
