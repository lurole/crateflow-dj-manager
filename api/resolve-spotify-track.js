// CRATEFLOW Spotify track-link resolver.
// Uses MusicLink's documented Spotify-ID lookup, not Spotify OAuth, scraping or Spotify Web API.
// Disabled until the owner configures MUSICLINK_API_KEY and SPOTIFY_LINK_LOOKUP_ENABLED=true.
// Beta only: per-instance throttling is NOT a substitute for durable per-account quotas.
export const maxDuration=30;
const idPattern=/^[A-Za-z0-9]{22}$/;
const windows=new Map();
function error(res,status,message,code){
 return res.status(status).json({ok:false,error:message,code});
}
function takeQuota(ip){
 const now=Date.now();
 const key=ip.slice(0,100);
 const value=windows.get(key)||{minute:now,used:0,day:now,daily:0};
 if(now-value.minute>=60000){value.minute=now;value.used=0}
 if(now-value.day>=86400000){value.day=now;value.daily=0}
 value.used++;value.daily++;windows.set(key,value);
 if(windows.size>750){
  for(const [k,v] of windows){if(now-v.day>=86400000)windows.delete(k)}
 }
 return value.used<=10&&value.daily<=100;
}
function linkId(url){
 if(typeof url!=='string')return null;
 try{
  const parsed=new URL(url);
  if(parsed.hostname!=='open.spotify.com'||parsed.protocol!=='https:')return null;
  const found=parsed.pathname.match(/^\/(?:intl-[a-z]{2}\/)?track\/([A-Za-z0-9]{22})(?:\/)?$/i);
  return found?.[1]||null;
 }catch{return null}
}
export default async function handler(req,res){
 res.setHeader('Cache-Control','no-store');
 res.setHeader('X-Content-Type-Options','nosniff');
 const active=process.env.SPOTIFY_LINK_LOOKUP_ENABLED==='true'&&Boolean(process.env.MUSICLINK_API_KEY);
 if(req.method==='GET'){
  return res.status(200).json({ok:true,enabled:active,provider:'MusicLink',requiresSpotifyLogin:false,
   note:active?'Individual track links are supported. Playlist links are not supported.':
   'Track link resolution requires an authorized MusicLink API key and an enabled server setting.'});
 }
 if(req.method!=='POST'){res.setHeader('Allow','GET, POST');return error(res,405,'Method not allowed','method_not_allowed')}
 const host=String(req.headers['x-forwarded-host']||req.headers.host||'').split(',')[0].trim();
 if(!host||String(req.headers.origin||'')!=='https://'+host)return error(res,403,'Invalid request origin','origin');
 if(!active)return error(res,503,'Spotify link import is not configured yet. The site owner must set MUSICLINK_API_KEY and SPOTIFY_LINK_LOOKUP_ENABLED=true in Vercel.','not_configured');
 let input=req.body;
 if(typeof input==='string'){try{input=JSON.parse(input)}catch{return error(res,400,'Invalid JSON request','invalid_json')}}
 const id=input?.id;
 if(typeof id!=='string'||!idPattern.test(id))return error(res,400,'A valid Spotify track ID is required','invalid_id');
 const ip=String(req.headers['x-forwarded-for']||req.socket?.remoteAddress||'unknown').split(',')[0].trim();
 if(!takeQuota(ip))return error(res,429,'Too many Spotify link lookups. Try again later.','rate_limited');
 const controller=new AbortController();
 const timer=setTimeout(()=>controller.abort(),20000);
 try{
  const r=await fetch('https://api.ml.jadquir.com/v1/lookup/spotify/'+id,{
   method:'GET',
   headers:{Authorization:'Bearer '+process.env.MUSICLINK_API_KEY,Accept:'application/json'},
   signal:controller.signal
  });
  if(r.status===404)return error(res,404,'No reliable metadata found for this Spotify track. Paste Artist – Title instead.','not_found');
  if(r.status===429)return error(res,429,'Metadata provider rate limit reached. Try again later.','provider_rate_limit');
  if(r.status===401||r.status===403)return error(res,503,'MusicLink API access is not authorized. Contact the site owner.','provider_authorization');
  if(!r.ok)return error(res,502,'Metadata service temporarily unavailable. Try again or paste Artist – Title.','provider_unavailable');
  const payload=await r.json().catch(()=>null);
  if(payload?.success!==true||!Array.isArray(payload.data))
   return error(res,502,'Metadata service returned an unexpected response.','unrecognized_response');
  const records=payload.data.filter(x=>x&&typeof x==='object');
  // The returned cross-platform link must identify this exact Spotify track.
  // Never silently import an unrelated release with an ambiguous mapping.
  const matching=records.filter(x=>linkId(x?.links?.spotify)===id);
  if(matching.length!==1)
   return error(res,422,'Spotify link could not be verified against the metadata result. Check the track manually.','ambiguous_match');
  const entry=matching[0],title=String(entry.title||'').trim(),artist=String(entry.artist||'').trim();
  if(!title||!artist||title.length>230||artist.length>230||/^(unknown|unknown artist|null|undefined)$/i.test(artist))
   return error(res,422,'Track name or artist missing. Paste Artist – Title manually.','incomplete_metadata');
  const rawIsrc=String(entry.isrc||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
  const isrc=/^[A-Z]{2}[A-Z0-9]{3}[0-9]{7}$/.test(rawIsrc)?rawIsrc:'';
  return res.status(200).json({ok:true,status:'resolved',track:{
   title,artist,isrc,spotifyId:id,spotifyUrl:'https://open.spotify.com/track/'+id,
   source:'musiclink',metadataVerified:true
  }});
 }catch(e){
  return error(res,controller.signal.aborted?504:502,
   controller.signal.aborted?'Metadata lookup timed out. Try again later.':'Unable to resolve Spotify track right now.',
   controller.signal.aborted?'timeout':'provider_error');
 }finally{clearTimeout(timer)}
}
