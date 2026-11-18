// Optional popup for the cross-browser Beatport companion.
// Cart action is performed only by the verified playlist's on-page confirmation.
const api=typeof browser!=='undefined'?browser:chrome;
const button=document.getElementById('run'),result=document.getElementById('result');
async function status(){
 try{
  const job=(await api.storage.local.get('crateflowCartJob')).crateflowCartJob;
  if(!job||Date.now()-job.createdAt>20*60*1000){
   result.textContent='No active CRATEFLOW cart handoff. Use Send to Cart in the web app first.';
   button.disabled=true;
   return;
  }
  if(job.status==='click_sent'){
   result.textContent='Buy All click sent for “'+job.name+'”. Check your Beatport cart.';
   button.disabled=true;
   return;
  }
  result.textContent='Waiting for playlist “'+job.name+'” ('+job.count+' tracks). Open it on Beatport; use the CRATEFLOW on-page confirmation.';
 }catch{result.textContent='Unable to read cart handoff.';button.disabled=true}
}
button.textContent='Open Beatport';
button.addEventListener('click',async()=>{
 try{await api.tabs.create({url:'https://www.beatport.com/'})}
 catch(error){result.textContent=error?.message||'Could not open Beatport'}
});
status();
