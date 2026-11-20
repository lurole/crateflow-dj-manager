import { beatportSession, connectionKey, beatportCatalogReference, exportSource, itemIdPattern,
  signTrackProof, trackProofLimit, uuidPattern, verifiedExportTrack } from '../lib/beatport-export.js';
// MusicAPI Beatport catalog lookup. No cart or user account mutations.
// Beta: only perform a lookup when explicitly requested by the browser.
// This public beta route has basic per-instance throttling, not durable user authentication.
const hits=new Map();
export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  if(req.method!=='POST'){res.setHeader('Allow','POST');return res.status(405).json({ok:false,error:'Method not allowed'});}
  const host=String(req.headers['x-forwarded-host']||req.headers.host||'').split(',')[0].trim();
  const origin=String(req.headers.origin||'');
  if(!host||origin!=='https://'+host)return res.status(403).json({ok:false,error:'Invalid origin'});
  if(process.env.MUSICAPI_ENABLE_VERIFICATION!=='true')return res.status(503).json({ok:false,error:'MusicAPI evaluation is not enabled'});
  const secret=process.env.MUSICAPI_CLIENT_SECRET;
  const session=secret&&beatportSession(req.headers,secret);
  if(!session)return res.status(401).json({ok:false,error:'Reconnect Beatport to enable account search'});
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
  const check=body?.exportCheck;
  const source=check&&exportSource(check.source);
  if(check&&(!source||typeof check.exportId!=='string'||!uuidPattern.test(check.exportId)))
    return res.status(400).json({ok:false,error:'Invalid export source identity'});
  const artist=source?.artist||(typeof body?.artist==='string'?body.artist.trim():'');
  const title=source?.title||(typeof body?.title==='string'?body.title.trim():'');
  if(!artist||!title||(!source&&(artist.length>160||title.length>200)))
    return res.status(400).json({ok:false,error:'Artist and track title required'});
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
    // The connected-user API is separate from public catalog search.
    // Never interpret an unrecognized 200 payload as a genuine catalog miss.
    // Search endpoints can return either a plain list or a wrapped collection.
    // Inspect only the shallow search/result branches; never expose provider values.
    const collections=[
      ['root',data],['tracks',data?.tracks],['items',data?.items],['results',data?.results],
      ['data',data?.data],['data.tracks',data?.data?.tracks],['data.items',data?.data?.items],
      ['data.results',data?.data?.results],['data.searchResults',data?.data?.searchResults],
      ['searchResults',data?.searchResults],['result',data?.result],
      ['result.tracks',data?.result?.tracks],['result.items',data?.result?.items],
      ['result.results',data?.result?.results],['data.data',data?.data?.data],
      ['data.data.results',data?.data?.data?.results],['data.results.items',data?.data?.results?.items],
      ['data.results.tracks',data?.data?.results?.tracks],
    ];
    let envelope=null,chosenPath=null;
    for(const [path,value] of collections){
      if(Array.isArray(value)){envelope=value;chosenPath=path;break}
    }
    if(!envelope){
      const one=data?.data?.track||data?.track||data?.result?.track||data?.data?.result;
      if(one&&typeof one==='object'&&!Array.isArray(one)&&(one.name||one.title)){envelope=[one];chosenPath='single track'}
    }
    const declaredEmpty=['not_found','notFound','empty'].includes(data?.status)||data?.found===false;
    if(!envelope&&!declaredEmpty){
      const safeKeys=value=>value&&typeof value==='object'&&!Array.isArray(value)
        ?Object.keys(value).filter(k=>/^[a-zA-Z][a-zA-Z0-9_]{0,39}$/.test(k)&&!/auth|token|secret|email|password|cookie|user|session|profile|credential|key/i.test(k)).slice(0,12)
        :[];
      return res.status(502).json({
        ok:false,error:'MusicAPI search result format not recognized; no tracks have been marked as missing.',
        diagnostic:'unrecognized_response',
        responseFields:safeKeys(data),
        dataFields:safeKeys(data?.data),
        resultFields:safeKeys(data?.result),
        providerResultStatus:typeof data?.status==='string'?data.status.slice(0,30):null
      });
    }
    const raw=envelope||[];
    if(check&&(raw.length>25||data?.nextParam||data?.data?.nextParam||data?.result?.nextParam))
      return res.status(409).json({ok:false,error:'MusicAPI results were too broad to verify one recording'});
    const candidates=raw.slice(0,check?25:8).map(item=>{
      const d=item?.data||item?.track||item;
      const artists=Array.isArray(d?.artistNames)?d.artistNames:
        Array.isArray(d?.artists)?d.artists.map(a=>typeof a==='string'?a:a?.name):
        typeof d?.artist==='string'?[d.artist]:[];
      const name=String(d?.name||d?.title||d?.trackName||'').slice(0,220);
      const url=String(d?.url||d?.externalUrl||d?.shareUrl||d?.links?.beatport||d?.external_urls?.beatport||'');
      const catalogReference=beatportCatalogReference(d,url);
      // DJ fields are optional: only accept explicit, plausible values from a matched catalog record.
      const bpmRaw=[d?.bpm,d?.tempo,d?.beatsPerMinute,d?.beats_per_minute,d?.attributes?.bpm].find(v=>v!==undefined&&v!==null&&v!=='');
      const bpmNumber=Number(bpmRaw);
      const bpm=bpmRaw!==undefined&&Number.isFinite(bpmNumber)&&bpmNumber>=40&&bpmNumber<=240?bpmNumber:null;
      const keyRaw=[d?.camelotKey,d?.camelot,d?.musicalKey,d?.musical_key,d?.keyName,d?.key?.name,d?.key?.camelot,d?.key,d?.attributes?.key]
       .find(v=>typeof v==='string'&&v.trim().length>0);
      const key=typeof keyRaw==='string'?keyRaw.trim().slice(0,50):null;
      const externalId=String(d?.externalId||d?.id||'');
      const mixHint=[d?.mixName,d?.mixType,d?.versionName,d?.version,d?.mix].find(v=>typeof v==='string'&&v.trim())
       ||(/extended mix/i.test(name)?'Extended Mix':/radio edit/i.test(name)?'Radio Edit':/original mix/i.test(name)?'Original Mix':'Unspecified');
      const artistNames=artists.filter(v=>typeof v==='string'&&v.trim());
      const providerName=String(d?.name||d?.title||d?.trackName||'');
      const isrc=String(d?.isrc||'');
      if(check&&(!itemIdPattern.test(externalId)||providerName.length>230||mixHint.length>100||isrc.length>40||
         !artistNames.length||artistNames.length>15||artistNames.some(value=>value.length>120)))return null;
      return {bpm,key,name:check?providerName:name,artistNames:artistNames.slice(0,15).map(v=>v.slice(0,120)),
       artist:artistNames.join(', ').slice(0,250),url:/^https:\/\/(www\.)?beatport\.com\/track\//.test(url)?url:null,
       externalId:externalId.slice(0,80),...catalogReference,isrc:isrc.slice(0,40),mixHint:mixHint.slice(0,100),
       ...(typeof d?.isAvailable==='boolean'?{isAvailable:d.isAvailable}:{})};
    }).filter(c=>c?.name?.trim());
    if(raw.length>0&&!candidates.length){
      return res.status(502).json({ok:false,error:'MusicAPI returned records, but CRATEFLOW could not read their track fields.',diagnostic:'unrecognized_tracks',recordCount:raw.length});
    }
    if(check){
      if(candidates.length!==raw.length)
        return res.status(409).json({ok:false,error:'Connected results contained tracks without a verifiable identity'});
      const track=verifiedExportTrack(source,check.selection,candidates);
      if(!track)return res.status(409).json({ok:false,error:'The connected Beatport search did not uniquely confirm the selected recording'});
      const proof=signTrackProof({secret,connection:connectionKey(session,secret,host)},check.exportId,track);
      if(proof.length>trackProofLimit)
        return res.status(409).json({ok:false,error:'The verified track metadata is too large to export safely'});
      return res.status(200).json({ok:true,id:track.id,proof});
    }
    return res.status(200).json({ok:true,status:candidates.length?'success':declaredEmpty?'not_found':raw.length===0?'not_found':'unreadable_tracks',candidates});

  }catch{return res.status(502).json({ok:false,error:'Beatport search timed out or failed'});}
  finally{clearTimeout(timeout);}
}
