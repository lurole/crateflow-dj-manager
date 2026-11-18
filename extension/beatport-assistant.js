// Runs only on Beatport. Does not access authentication tokens, hidden APIs or checkout.
// Requires a recent queued job, the exact playlist title and an explicit button click.
(() => {
 if(!['beatport.com','www.beatport.com'].includes(location.hostname))return;
 const api=typeof browser==='object'?browser:chrome;
 const MAX_AGE=20*60*1000;
 let currentJob=null,lastURL='',renderedFor='';
 const norm=x=>String(x||'').normalize('NFKC').toLocaleLowerCase().replace(/\s+/g,' ').trim();
 const visible=el=>{if(!el||!el.isConnected)return false;const rect=el.getBoundingClientRect(),style=getComputedStyle(el);return rect.width>0&&rect.height>0&&style.visibility!=='hidden'&&style.display!=='none'&&!el.disabled};
 const buttons=()=>[...document.querySelectorAll('button,[role="button"]')].filter(visible).filter(el=>/^(buy all|add all to cart)$/i.test((el.textContent||el.getAttribute('aria-label')||'').trim()));
 const headings=()=>[...document.querySelectorAll('h1,h2,[role="heading"]')].filter(visible).map(el=>norm(el.textContent));
 function dismiss(){document.getElementById('crateflow-cart-assist')?.remove()}
 function show(job,isPlaylist){
  dismiss();
  const root=document.createElement('aside');root.id='crateflow-cart-assist';
  root.setAttribute('role','region');root.setAttribute('aria-label','CRATEFLOW Beatport cart assistant');
  Object.assign(root.style,{position:'fixed',bottom:'20px',right:'20px',zIndex:'2147483646',background:'#172123',border:'1px solid #b1dc65',color:'#eef6e9',borderRadius:'14px',padding:'18px',width:'min(350px, calc(100vw - 40px))',boxSizing:'border-box',boxShadow:'0 15px 46px #0009',font:'14px/1.5 system-ui,sans-serif'});
  const title=document.createElement('strong');title.textContent='CRATEFLOW · Send to Cart';root.append(title);
  const body=document.createElement('p');body.style.margin='10px 0';
  body.textContent=isPlaylist?('Playlist found: '+job.name+'. '+job.count+' tracks were sent via MusicAPI. Review this playlist and approve Buy All.'):('Open your Beatport playlist named “'+job.name+'”. The cart action will be available there.');
  root.append(body);
  const row=document.createElement('div');Object.assign(row.style,{display:'flex',gap:'8px'});
  const cancel=document.createElement('button');cancel.textContent='Cancel transfer';
  const styleButton=(b,primary)=>Object.assign(b.style,{cursor:'pointer',border:'0',borderRadius:'7px',padding:'9px 12px',background:primary?'#d0f76c':'#314044',color:primary?'#101a15':'#e6f0ea',fontWeight:'700',flex:'1'});
  styleButton(cancel,false);
  cancel.addEventListener('click',async()=>{await api.storage.local.remove('crateflowCartJob');currentJob=null;dismiss()});
  row.append(cancel);
  if(!isPlaylist){
   const anchors=[...document.querySelectorAll('a[href]')].filter(visible).filter(a=>{
    try{const url=new URL(a.href,location.href);return ['www.beatport.com','beatport.com'].includes(url.hostname)&&url.protocol==='https:'&&/playlist/i.test(url.pathname)&&norm(a.textContent)===norm(job.name)}
    catch{return false}
   });
   if(anchors.length===1){
    const open=document.createElement('button');open.textContent='Open playlist';styleButton(open,true);
    open.addEventListener('click',()=>{location.assign(anchors[0].href)});
    row.append(open);
   }
  }
  if(isPlaylist){
   const action=document.createElement('button');action.textContent='Confirm Buy All';styleButton(action,true);
   action.addEventListener('click',async()=>{
    // Recheck after the click to prevent stale page navigation or spoofed headings.
    if(!headings().includes(norm(job.name))){body.textContent='Playlist title changed. Reopen the correct playlist.';return}
    const matches=buttons();
    if(matches.length!==1){body.textContent='Unable to find exactly one visible Buy All button. No action taken.';return}
    if(!window.confirm('Run Beatport Buy All for “'+job.name+'”? Please verify the resulting cart. No checkout will be submitted.'))return;
    matches[0].click();
    try{await api.storage.local.set({crateflowCartJob:{...job,status:'click_sent',clickedAt:Date.now()}})}catch{}
    action.disabled=true;action.style.opacity='.5';
    body.textContent='Buy All click sent. Check your Beatport cart to verify tracks were added. CRATEFLOW has NOT confirmed cart contents.';
   });
   row.append(action);
  }
  root.append(row);document.body.append(root);
 }
 async function refresh(){
  if(!document.body)return;
  let job;try{job=(await api.storage.local.get('crateflowCartJob')).crateflowCartJob}catch{return}
  if(!job||!job.createdAt||Date.now()-job.createdAt>MAX_AGE||job.status==='click_sent'){currentJob=null;dismiss();return}
  const match=headings().includes(norm(job.name));
  const key=[location.href,job.nonce,match].join('|');
  if(key===renderedFor&&document.getElementById('crateflow-cart-assist'))return;
  currentJob=job;renderedFor=key;show(job,match);
 }
 // Navigate between playlist and other pages without injecting buttons into checkout.
 let lastRefresh=0;
 const schedule=()=>{if(Date.now()-lastRefresh<1200)return;lastRefresh=Date.now();refresh()};
 const obs=new MutationObserver(schedule);
 const start=()=>{obs.observe(document.body,{childList:true,subtree:true});refresh()};
 if(document.body)start();else document.addEventListener('DOMContentLoaded',start,{once:true});
 window.addEventListener('popstate',()=>{renderedFor='';refresh()});
 window.addEventListener('focus',()=>{renderedFor='';refresh()});
 api.storage.onChanged.addListener((changes,area)=>{if(area==='local'&&changes.crateflowCartJob){renderedFor='';refresh()}});
})();
