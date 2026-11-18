// Server-side verification of a MusicAPI hosted sign-in.
// The endpoint stays disabled until the owner explicitly enables verification
// after checking MusicAPI's pricing. No catalog, playlist or cart APIs are called.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  if(req.method!=='POST'){res.setHeader('Allow','POST');return res.status(405).json({ok:false,error:'Method not allowed'});}
  const host=(req.headers['x-forwarded-host']||req.headers.host||'').split(',')[0];
  const origin=req.headers.origin||'';
  if(!host||origin!== 'https://'+host)return res.status(403).json({ok:false,error:'Invalid request origin'});
  if(process.env.MUSICAPI_ENABLE_VERIFICATION!=='true')return res.status(503).json({ok:false,error:'MusicAPI verification is disabled until API costs are approved'});
  const clientId=process.env.MUSICAPI_CLIENT_ID,secret=process.env.MUSICAPI_CLIENT_SECRET;
  if(!clientId||!secret)return res.status(503).json({ok:false,error:'MusicAPI server credentials not configured'});
  let body=req.body;
  if(typeof body==='string'){try{body=JSON.parse(body)}catch{return res.status(400).json({ok:false,error:'Invalid JSON'})}}
  const attemptId=body?.authModelUUID;
  const claimedUser=body?.integrationUserUUID;
  if(typeof attemptId!=='string'||!UUID.test(attemptId)||typeof claimedUser!=='string'||!UUID.test(claimedUser))return res.status(400).json({ok:false,error:'Invalid authentication identifiers'});
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),8000);
  try{
    const response=await fetch('https://api.musicapi.com/public/integrations/auth/'+encodeURIComponent(attemptId),{
      method:'GET',
      headers:{Authorization:'Basic '+Buffer.from(clientId+':'+secret).toString('base64'),Accept:'application/json'},
      signal:controller.signal
    });
    if(!response.ok)return res.status(502).json({ok:false,error:'MusicAPI verification failed',providerStatus:response.status});
    const value=await response.json();
    const actualStatus=value?.authModel?.status;
    const actualId=value?.integrationUser?.uuid;
    const service=value?.integrationUser?.integrationType||value?.integrationUser?.type||value?.integration?.type;
    if(actualStatus!=='success'||actualId!==claimedUser)return res.status(403).json({ok:false,error:'Callback does not match verified MusicAPI sign-in'});
    // The public API response does not consistently supply the service type.
    // The authenticated attempt is verified, but do not claim the service is
    // Beatport without an explicit service type.
    if(service&&String(service).toLowerCase()!=='beatport')return res.status(403).json({ok:false,error:'Verified service is not Beatport'});
    return res.status(200).json({ok:true,verified:true,serviceVerified:!!service,service:service||null,verifiedAt:new Date().toISOString()});
  }catch{return res.status(502).json({ok:false,error:'Unable to contact MusicAPI verification endpoint'});}
  finally{clearTimeout(timer);}
}
