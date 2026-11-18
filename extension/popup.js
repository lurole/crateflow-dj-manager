// Read-only status; direct cart sync is initiated with one click in CRATEFLOW.
const api=typeof browser!=='undefined'?browser:chrome;
const button=document.getElementById('run'),result=document.getElementById('result');
async function update(){
 try{
  const job=(await api.storage.local.get('crateflowDirectCartJob')).crateflowDirectCartJob;
  if(!job){result.textContent='No direct cart job yet. Click Send to Cart in CRATEFLOW.';return}
  result.textContent='Direct cart: '+job.done+'/'+job.tracks.length+' processed. '+job.clicked+' clicks / already in cart, '+job.failed+' failed. '+(job.status==='done'?'Review your Beatport cart.':'Status: '+job.status+'.');
 }catch{result.textContent='Could not read cart status.'}
}
button.textContent='Open Beatport Cart';
button.addEventListener('click',async()=>{
 try{await api.tabs.create({url:'https://www.beatport.com/cart'})}
 catch(error){result.textContent=error?.message||'Unable to open Beatport'}
});
api.storage.onChanged.addListener((changes,area)=>{if(area==='local'&&changes.crateflowDirectCartJob)update()});
update();
