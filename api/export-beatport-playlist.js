import crypto from 'node:crypto';
import '../matching.js';
export const maxDuration=30;
// Explicit user action only. Creates a Beatport playlist; DOES NOT change the shopping cart.
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export default async function handler(req,res){
 res.setHeader('Cache-Control','no-store');
 if(req.method!=='POST'){res.setHeader('Allow','POST');return res.status(405).json({ok:false,error:'Method not allowed'});}
 const host=String(req.headers['x-forwarded-host']||req.headers.host||'').split(',')[0];
 if(!host||req.headers.origin!=='https://'+host)return res.status(403).json({ok:false,error:'Invalid origin'});
 if(process.env.MUSICAPI_ENABLE_VERIFICATION!=='true')return res.status(503).json({ok:false,error:'MusicAPI integration disabled'});
 const clientId=process.env.MUSICAPI_CLIENT_ID,secret=process.env.MUSICAPI_CLIENT_SECRET;
 if(!clientId||!secret)return res.status(503).json({ok:false,error:'MusicAPI credentials missing'});
 const rawCookie=String(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('cf_bp='))?.slice(6);
 if(!rawCookie)return res.status(401).json({ok:false,error:'Connect Beatport first'});
 const parts=rawCookie.split('.');
 if(parts.length!==2)return res.status(401).json({ok:false,error:'Invalid Beatport session'});
 const signature=crypto.createHmac('sha256',secret).update('crateflow-beatport-v1.'+parts[0]).digest('base64url');
 if(parts[1].length!==signature.length||!crypto.timingSafeEqual(Buffer.from(parts[1]),Buffer.from(signature)))return res.status(401).json({ok:false,error:'Invalid Beatport session'});
 let session;try{session=JSON.parse(Buffer.from(parts[0],'base64url').toString('utf8'))}catch{return res.status(401).json({ok:false,error:'Invalid Beatport session'})}
 if(!UUID.test(session?.uid||'')||!Number.isInteger(session?.exp)||session.exp<Math.floor(Date.now()/1000))return res.status(401).json({ok:false,error:'Beatport connection expired; reconnect'});
 let payload;try{payload=typeof req.body==='string'?JSON.parse(req.body||'{}'):req.body}catch{return res.status(400).json({ok:false,error:'Invalid JSON request'})}
 const ids=payload?.trackIds, title=String(payload?.name||'CRATEFLOW Selection').trim().slice(0,75);
 // Optional catalog identity for read-back verification. Never trust acceptance alone.
 const submitted=Array.isArray(payload?.tracks)?payload.tracks:null;
 const safeStr=(v,max)=>typeof v==='string'?v.trim().slice(0,max):'';
 const normalized=s=>String(s||'').normalize('NFKD').replace(/[\\u0300-\\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
 const validateISRC=s=>/^[A-Z]{2}[A-Z0-9]{3}[0-9]{7}$/.test(s);
 if(submitted&&(
    submitted.length!==ids?.length||
    !submitted.every((t,i)=>t&&typeof t==='object'&&String(t.id||'')===ids[i]&&
       typeof t.title==='string'&&t.title.trim().length>0&&t.title.length<=220&&
       typeof t.artist==='string'&&t.artist.trim().length>0&&t.artist.length<=250&&
       (t.remix===undefined||(typeof t.remix==='string'&&t.remix.length<=100))&&
       (!t.isrc||validateISRC(String(t.isrc).toUpperCase()))
    )))return res.status(400).json({ok:false,error:'Invalid track verification metadata'});
 if(!Array.isArray(ids)||ids.length<1||ids.length>20||!title)return res.status(400).json({ok:false,error:'Choose 1 to 20 confirmed tracks'});
 if(!ids.every(x=>typeof x==='string'&&/^[A-Za-z0-9_-]{1,80}$/.test(x)))return res.status(400).json({ok:false,error:'Invalid Beatport track identifiers'});
 const unique=[...new Set(ids)];
 if(unique.length!==ids.length)return res.status(400).json({ok:false,error:'Duplicate tracks must be removed before export'});
 const auth='Basic '+Buffer.from(clientId+':'+secret).toString('base64');
 const base='https://api.musicapi.com/api/'+encodeURIComponent(session.uid)+'/playlists';
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),16000);
 const headers={Authorization:auth,'Content-Type':'application/json',Accept:'application/json'};
 try{
  const created=await fetch(base,{method:'POST',headers,body:JSON.stringify({name:title,visibility:'private'}),signal:controller.signal});
  const playlist=await created.json().catch(()=>({}));
  if(!created.ok)return res.status(502).json({ok:false,stage:'create',error:'Beatport playlist could not be created',providerStatus:created.status});
  const playlistId=playlist?.id;
  if(typeof playlistId!=='string'&&typeof playlistId!=='number')return res.status(502).json({ok:false,stage:'create',error:'MusicAPI returned an unexpected playlist identifier'});
  const added=await fetch(base+'/'+encodeURIComponent(String(playlistId))+'/items',{method:'POST',headers,body:JSON.stringify({itemIds:unique}),signal:controller.signal});
  if(!added.ok)return res.status(502).json({ok:false,stage:'add',error:'Playlist was created, but adding tracks failed. Check Beatport before trying again to avoid duplicate playlists.',providerStatus:added.status,playlistId:String(playlistId)});
  // MusicAPI's POST returns only "ok", not a per-track outcome.
  // Read the actual playlist and compare it to what was requested.
  const actual=[],cursorSet=new Set();
  let cursor=null,complete=false,verifiedRead=true;
  for(let page=0;page<4;page++){
   const u=new URL(base+'/'+encodeURIComponent(String(playlistId))+'/items');
   u.searchParams.set('limitParam','100');
   if(cursor)u.searchParams.set('nextParam',cursor);
   const read=await fetch(u,{headers:{Authorization:auth,Accept:'application/json'},signal:controller.signal});
   if(!read.ok){verifiedRead=false;break}
   const data=await read.json().catch(()=>null);
   if(!data||!Array.isArray(data.results)){verifiedRead=false;break}
   actual.push(...data.results);
   const next=data.nextParam;
   if(next===null||next===undefined||next===''){complete=true;break}
   if(typeof next!=='string'||cursorSet.has(next)){verifiedRead=false;break}
   cursor=next;cursorSet.add(cursor);
  }
  if(!complete)verifiedRead=false;
  if(!verifiedRead){
   return res.status(200).json({ok:true,verified:false,playlistId:String(playlistId),name:title,
    requested:unique.length,added:0,unverified:unique,
    warning:'Beatport accepted the playlist request, but its contents could not be verified. Check the playlist before retrying.',cartUpdated:false});
  }
  const notUsed=new Set(actual.map((_,i)=>i)),confirmed=[],missing=[],mismatched=[];
  for(let i=0;i<unique.length;i++){
   const id=unique[i],request=submitted?.[i];
   // Prefer the exact Beatport catalog ID. Fall back only to a matching ISRC,
   // or the same complete title plus at least one exact artist credit.
   let found=-1,identityOK=false;
   for(const index of notUsed){
    const item=actual[index];
    if(String(item?.id||'')!==id)continue;
    found=index;break;
   }
   if(found<0&&request){
    const srcISRC=String(request.isrc||'').toUpperCase();
    const srcName=normalized(request.title);
    const srcArtists=String(request.artist||'').split(/[,;]+/).map(normalized).filter(Boolean);
    for(const index of notUsed){
     const item=actual[index],returnedISRC=String(item?.isrc||'').toUpperCase();
     const sameISRC=validateISRC(srcISRC)&&srcISRC===returnedISRC;
     const nameOK=srcName&&normalized(item?.name)===srcName;
     const names=Array.isArray(item?.artists)?item.artists.map(a=>normalized(a?.name||a)).filter(Boolean):[];
     const artistOK=srcArtists.length&&srcArtists.every(a=>names.includes(a));
     if(sameISRC||(nameOK&&artistOK)){found=index;break}
    }
   }
   if(found>=0){
    notUsed.delete(found);
    const item=actual[found];
    if(request){
     const artists=Array.isArray(item?.artists)?item.artists.map(a=>typeof a==='string'?a:a?.name).filter(Boolean):[];
     const assessment=globalThis.CrateflowMatching.assess(
      {title:request.title,artist:request.artist,remix:request.remix||'',isrc:request.isrc||''},
      {name:item?.name||'',artist:artists.join(', '),artistNames:artists,
       externalId:item?.id||id,isrc:item?.isrc||''}
     );
     // Neither a matching ID nor a successful playlist write can disguise a wrong version,
     // an artist mismatch or a conflicting recording identifier.
     identityOK=assessment.autoEligible;
    }else identityOK=false;
    if(identityOK)confirmed.push(id);
    else mismatched.push(id);
   }else missing.push(id);
  }
  return res.status(200).json({ok:true,verified:true,playlistId:String(playlistId),
   name:title,requested:unique.length,added:confirmed.length,confirmed,
   missing,mismatched,cartUpdated:false,
   warning:missing.length||mismatched.length?'Some requested tracks were missing or inconsistent after read-back.':null});
 }catch{return res.status(502).json({ok:false,error:'MusicAPI playlist export failed or timed out. Check Beatport for a partial playlist before retrying'});}
 finally{clearTimeout(timer)}
}
