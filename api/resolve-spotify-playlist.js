// Read one page of a public Spotify playlist through MusicAPI Core.
// Credentials never leave the server. MusicLink continues to handle individual songs.
export const maxDuration = 30;
const idPattern = /^[A-Za-z0-9]{22}$/;
const windows = new Map();
function fail(res,status,code,message){return res.status(status).json({ok:false,code,error:message})}
function allowed(ip){
 const now=Date.now(), key=String(ip).slice(0,100);
 const x=windows.get(key)||{minute:now,used:0,day:now,daily:0};
 if(now-x.minute>=60000){x.minute=now;x.used=0}
 if(now-x.day>=86400000){x.day=now;x.daily=0}
 x.used++;x.daily++;windows.set(key,x);
 if(windows.size>750)for(const [k,v] of windows)if(now-v.day>=86400000)windows.delete(k);
 return x.used<=12&&x.daily<=120;
}
export default async function handler(req,res){
 res.setHeader('Cache-Control','no-store');
 res.setHeader('X-Content-Type-Options','nosniff');
 const configured=!!(process.env.MUSICAPI_CLIENT_ID&&process.env.MUSICAPI_CLIENT_SECRET);
 if(req.method==='GET')return res.status(200).json({ok:true,enabled:configured,provider:'MusicAPI',pageSize:50});
 if(req.method!=='POST'){res.setHeader('Allow','GET, POST');return fail(res,405,'method_not_allowed','Method not allowed')}
 const host=String(req.headers['x-forwarded-host']||req.headers.host||'').split(',')[0].trim();
 if(!host||String(req.headers.origin||'')!=='https://'+host)return fail(res,403,'origin','Invalid request origin');
 if(!configured)return fail(res,503,'not_configured','MusicAPI credentials are not configured.');
 let body=req.body;
 if(typeof body==='string'){try{body=JSON.parse(body)}catch{return fail(res,400,'invalid_json','Invalid JSON')}}
 const id=body?.id,nextParam=body?.nextParam;
 if(typeof id!=='string'||!idPattern.test(id))return fail(res,400,'invalid_id','Valid Spotify playlist ID required');
 if(nextParam!==undefined&&nextParam!==null&&(typeof nextParam!=='string'||!nextParam.length||nextParam.length>2048))
  return fail(res,400,'invalid_cursor','Invalid pagination cursor');
 const ip=String(req.headers['x-forwarded-for']||req.socket?.remoteAddress||'unknown').split(',')[0].trim();
 if(!allowed(ip))return fail(res,429,'rate_limited','Playlist lookup limit reached. Try again later.');
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),22000);
 try{
  const auth=Buffer.from(process.env.MUSICAPI_CLIENT_ID+':'+process.env.MUSICAPI_CLIENT_SECRET).toString('base64');
  const payload={playlistId:id,serviceId:'spotify'};
  if(nextParam)payload.nextParam=nextParam;
  const upstream=await fetch('https://api.musicapi.com/public/inspect/playlistItems',{
   method:'POST',headers:{Authorization:'Basic '+auth,'Content-Type':'application/json',Accept:'application/json'},
   body:JSON.stringify(payload),signal:controller.signal
  });
  if(upstream.status===401||upstream.status===403)return fail(res,503,'provider_authorization','MusicAPI credentials or permissions rejected.');
  if(upstream.status===429)return fail(res,429,'provider_rate_limit','MusicAPI rate limit reached.');
  if(!upstream.ok)return fail(res,502,'provider_unavailable','MusicAPI playlist service unavailable.');
  const data=await upstream.json().catch(()=>null);
  if(data?.status==='not_found')return fail(res,404,'not_found','Playlist not found or not accessible.');
  if(data?.status!=='success'||!Array.isArray(data?.data?.results))return fail(res,502,'unrecognized_response','Unexpected MusicAPI response.');
  const tracks=[],skipped={unavailable:0,incomplete:0};
  for(const entry of data.data.results.slice(0,50)){
   if(!entry||entry.isAvailable===false){skipped.unavailable++;continue}
   const title=String(entry.name||'').trim();
   const artist=Array.isArray(entry.artists)?entry.artists.map(a=>String(a?.name||'').trim()).filter(Boolean).join(', '):'';
   if(!title||!artist||title.length>230||artist.length>230){skipped.incomplete++;continue}
   const rawIsrc=String(entry.isrc||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
   const isrc=/^[A-Z]{2}[A-Z0-9]{3}[0-9]{7}$/.test(rawIsrc)?rawIsrc:'';
   const spotifyId=idPattern.test(String(entry.id||''))?entry.id:'';
   tracks.push({title,artist,isrc,album:String(entry.album?.name||'').slice(0,230),
    spotifyId,spotifyUrl:spotifyId?'https://open.spotify.com/track/'+spotifyId:'',
    source:'musicapi-playlist'});
  }
  const cursor=data.data.nextParam;
  if(cursor!==null&&cursor!==undefined&&(typeof cursor!=='string'||cursor.length>2048))
   return fail(res,502,'unrecognized_cursor','Unexpected MusicAPI pagination cursor.');
  return res.status(200).json({ok:true,tracks,nextParam:cursor||null,totalItems:
   Number.isFinite(data.data.totalItems)?data.data.totalItems:null,skipped,provider:'MusicAPI'});
 }catch{
  return fail(res,controller.signal.aborted?504:502,controller.signal.aborted?'timeout':'provider_error',
   'Playlist could not be retrieved right now.');
 }finally{clearTimeout(timer)}
}
