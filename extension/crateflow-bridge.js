// Bridge between the CRATEFLOW web app and its optional cart companion.
// The page cannot read Beatport cookies. Only an explicit on-page click queues work.
(() => {
 const APP_ORIGIN='https://crateflow-dj-manager.vercel.app';
 if(location.origin!==APP_ORIGIN)return;
 const api=typeof browser==='object'?browser:chrome;
 const post=(type,payload={})=>window.postMessage({source:'crateflow-companion',type,version:2,...payload},APP_ORIGIN);
 const validUrl=(url,id)=>{
  try{const u=new URL(url);return u.protocol==='https:'&&['beatport.com','www.beatport.com'].includes(u.hostname)&&new RegExp('/track/[^/]+/'+id+'/?$').test(u.pathname)}catch{return false}
 };
 const onMessage=async event=>{
  if(event.source!==window||event.origin!==APP_ORIGIN)return;
  const msg=event.data;
  if(msg?.source!=='crateflow-app'||msg?.version!==2)return;
  if(msg.type==='PING'){post('READY');return}
  if(msg.type!=='QUEUE_CART')return;
  const nonce=msg.nonce,tracks=msg.tracks;
  if(typeof nonce!=='string'||!/^[a-z0-9_-]{12,80}$/i.test(nonce)||!Array.isArray(tracks)||tracks.length<1||tracks.length>20){
   post('JOB_ERROR',{nonce,reason:'Invalid cart job'});return;
  }
  if(!tracks.every(t=>t&&typeof t.id==='string'&&t.id.length<100&&typeof t.trackId==='string'&&/^\d{1,12}$/.test(t.trackId)&&typeof t.url==='string'&&validUrl(t.url,t.trackId)&&typeof t.title==='string'&&t.title.length<=180)){
   post('JOB_ERROR',{nonce,reason:'Missing verified Beatport track ID'});return;
  }
  try{
   const active=(await api.storage.local.get('crateflowDirectCartJob')).crateflowDirectCartJob;
   if(active?.status==='running'&&Date.now()-active.createdAt<120000){
    post('JOB_ERROR',{nonce,reason:'Another cart sync is already running'});return;
   }
   await api.storage.local.set({crateflowDirectCartJob:{nonce,createdAt:Date.now(),status:'queued',tracks:tracks.map(t=>({id:t.id,trackId:t.trackId,url:t.url,title:t.title})),done:0,clicked:0,failed:0,results:[]}});
   post('JOB_QUEUED',{nonce});
  }catch{post('JOB_ERROR',{nonce,reason:'Could not queue browser cart job'})}
 };
 window.addEventListener('message',onMessage);
 api.storage.onChanged.addListener((changes,area)=>{
  if(area!=='local'||!changes.crateflowDirectCartJob?.newValue)return;
  const job=changes.crateflowDirectCartJob.newValue;
  if(job?.status==='running'||job?.status==='done'){
   post('CART_PROGRESS',{nonce:job.nonce,done:job.done,clicked:job.clicked,failed:job.failed,finished:job.status==='done',results:job.results?.map(x=>({id:x.id,status:x.status}))||[]});
  }
 });
 post('READY');
})();
