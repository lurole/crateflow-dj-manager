// This service worker processes tracks directly on Beatport, without creating any playlists.
// It relies on the active user's existing Beatport browser session.
// Only a deliberately queued, origin-validated job can start it.
const api=typeof browser==='object'?browser:chrome;
let running=false;
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function waitTab(tabId,timeout=25000){
 return await new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>{api.tabs.onUpdated.removeListener(listener);reject(new Error('Beatport page timeout'))},timeout);
  function listener(id,change){if(id===tabId&&change.status==='complete'){clearTimeout(timer);api.tabs.onUpdated.removeListener(listener);resolve()}}
  api.tabs.onUpdated.addListener(listener);
  api.tabs.get(tabId).then(tab=>{if(tab?.status==='complete'){clearTimeout(timer);api.tabs.onUpdated.removeListener(listener);resolve()}}).catch(()=>{});
 });
}
async function runOnTrack(tabId,expectedId){
 const output=await api.scripting.executeScript({target:{tabId},func:async id=>{
  const pause=ms=>new Promise(r=>setTimeout(r,ms));
  const visible=el=>{if(!el||!el.isConnected||el.disabled||el.getAttribute('aria-disabled')==='true')return false;const r=el.getBoundingClientRect(),s=getComputedStyle(el);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none'};
  const getButtons=()=>[...document.querySelectorAll('button,[role="button"]')].filter(visible);
  const label=el=>[el.getAttribute('aria-label'),el.getAttribute('title'),el.textContent].filter(Boolean).join(' ').toLowerCase().replace(/\s+/g,' ').trim();
  const path=new URL(location.href).pathname;
  if(!new RegExp('^/(?:[a-z]{2}/)?track/[^/]+/'+id+'/?$').test(path))return {status:'failed',reason:'Track URL changed'};
  const matchBuy=el=>/\b(add to cart|add track to cart|buy track|buy now)\b/i.test(label(el))&&!/remove|buy all|checkout|wishlist/i.test(label(el));
  const matchInCart=el=>/\b(remove from cart|in cart|already in cart)\b/i.test(label(el));
  let button=null;
  for(let attempt=0;attempt<20;attempt++){
   const elements=getButtons();
   if(elements.some(matchInCart))return {status:'already_in_cart'};
   const options=elements.filter(matchBuy);
   if(options.length===1){button=options[0];break}
   if(options.length>1)return {status:'failed',reason:'Multiple cart buttons on page'};
   await pause(500);
  }
  if(!button)return {status:'failed',reason:'Add to Cart control not found'};
  button.click();
  await pause(1500);
  // Do not claim server-side cart confirmation based on DOM change alone.
  const indicators=[...document.querySelectorAll('[role="status"],[role="alert"],[aria-live]')].filter(visible).map(el=>el.textContent||'').join(' ').toLowerCase();
  return {status:'clicked_unverified',observed:/(added to cart|in your cart|added to your cart)/i.test(indicators)};
 },args:[expectedId]});
 return output?.[0]?.result||{status:'failed',reason:'No Beatport result'};
}
async function processQueue(){
 if(running)return;
 running=true;
 try{
  let job=(await api.storage.local.get('crateflowDirectCartJob')).crateflowDirectCartJob;
  if(!job||job.status!=='queued'||Date.now()-job.createdAt>60000)return;
  job={...job,status:'running'};await api.storage.local.set({crateflowDirectCartJob:job});
  for(const item of job.tracks){
   const latest=(await api.storage.local.get('crateflowDirectCartJob')).crateflowDirectCartJob;
   if(latest?.nonce!==job.nonce)break;
   let tab=null,result;
   try{
    const u=new URL(item.url);
    if(u.protocol!=='https:'||!['www.beatport.com','beatport.com'].includes(u.hostname)||!new RegExp('^/(?:[a-z]{2}/)?track/[^/]+/'+item.trackId+'/?$').test(u.pathname))throw new Error('Invalid track page');
    tab=await api.tabs.create({url:item.url,active:false});
    await waitTab(tab.id);
    result=await runOnTrack(tab.id,item.trackId);
   }catch(error){result={status:'failed',reason:String(error?.message||'Browser error').slice(0,120)}}
   if(tab&&result.status!=='failed'){try{await api.tabs.remove(tab.id)}catch{}}
   job.results.push({id:item.id,status:result.status,reason:result.reason||''});
   job.done++;
   if(result.status==='clicked_unverified'||result.status==='already_in_cart')job.clicked++;
   if(result.status==='failed')job.failed++;
   await api.storage.local.set({crateflowDirectCartJob:{...job}});
   await delay(800);
  }
  const current=(await api.storage.local.get('crateflowDirectCartJob')).crateflowDirectCartJob;
  if(current?.nonce===job.nonce)await api.storage.local.set({crateflowDirectCartJob:{...job,status:'done'}});
 }catch(error){
  const current=(await api.storage.local.get('crateflowDirectCartJob')).crateflowDirectCartJob;
  if(current?.status==='running')await api.storage.local.set({crateflowDirectCartJob:{...current,status:'done',error:String(error?.message||error).slice(0,120)}});
 }finally{running=false}
}
api.storage.onChanged.addListener((changes,area)=>{
 if(area==='local'&&changes.crateflowDirectCartJob?.newValue?.status==='queued')processQueue();
});
api.runtime.onStartup?.addListener(()=>{api.storage.local.get('crateflowDirectCartJob').then(x=>{if(x.crateflowDirectCartJob?.status==='queued')processQueue()})});
