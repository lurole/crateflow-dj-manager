// CRATEFLOW -> extension bridge. No credentials, cookies or account data are transferred.
// A pending job is created only after the user presses the explicit continue button in CRATEFLOW.
(() => {
 const APP_ORIGIN='https://crateflow-dj-manager.vercel.app';
 if(location.origin!==APP_ORIGIN)return;
 const api=typeof browser==='object'?browser:chrome;
 const ready=()=>window.postMessage({source:'crateflow-companion',type:'READY',version:1},APP_ORIGIN);
 const onMessage=async event=>{
  if(event.source!==window||event.origin!==APP_ORIGIN)return;
  const msg=event.data;
  if(!msg||msg.source!=='crateflow-app'||msg.type!=='QUEUE_PLAYLIST'||msg.version!==1)return;
  const {nonce,name,playlistId,count}=msg;
  if(typeof nonce!=='string'||!/^[A-Za-z0-9_-]{12,80}$/.test(nonce))return;
  if(typeof name!=='string'||!name.trim()||name.length>75)return;
  if(typeof playlistId!=='string'||playlistId.length>100)return;
  if(!Number.isInteger(count)||count<1||count>20)return;
  const job={nonce,name:name.trim(),playlistId,count,createdAt:Date.now(),status:'awaiting_playlist'};
  try{
   await api.storage.local.set({crateflowCartJob:job});
   window.postMessage({source:'crateflow-companion',type:'JOB_QUEUED',version:1,nonce},APP_ORIGIN);
  }catch{
   window.postMessage({source:'crateflow-companion',type:'JOB_ERROR',version:1,nonce},APP_ORIGIN);
  }
 };
 window.addEventListener('message',onMessage);
 ready();
})();
