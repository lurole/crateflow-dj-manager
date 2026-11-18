const $=s=>document.querySelector(s),esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const storage='crateflow_v1',defaults={tracks:[],playlists:[],settings:{spotifyClientId:'9cf21ad1b0b8483681d12bdb9daeb42f'}};
let state;try{state={...defaults,...JSON.parse(localStorage.getItem(storage)||'{}')}}catch{state=structuredClone(defaults)}
state.settings={...defaults.settings,preferExtended:true,...state.settings,musicApiSlug:'tracky'};state.syncHistory=Array.isArray(state.syncHistory)?state.syncHistory:[];
let page=localStorage.getItem('crateflow_onboarded')==='yes'?'overview':'welcome',search='',filter='all',playlistFilter='all';
const persist=()=>localStorage.setItem(storage,JSON.stringify(state)),uid=()=>crypto.randomUUID(),trackStats=()=>({total:state.tracks.length,pending:state.tracks.filter(t=>t.status==='pending').length,cart:state.tracks.filter(t=>t.status==='cart').length,owned:state.tracks.filter(t=>t.status==='owned').length,downloaded:state.tracks.filter(t=>t.status==='downloaded').length});
function toast(s){let t=$('#toast');t.textContent=s;t.classList.add('show');clearTimeout(toast.timer);toast.timer=setTimeout(()=>t.classList.remove('show'),4000)}
function norm(s){return String(s||'').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,' ').trim()}
function importTracks(rows,name){let p=state.playlists.find(p=>p.name===name);if(!p){p={id:uid(),name};state.playlists.push(p)}let count=0,dup=0;for(const row of rows){let title=String(row.title||'').trim(),artist=String(row.artist||'Unknown Artist').trim();if(!title)continue;if(state.tracks.some(t=>norm(t.title)===norm(title)&&norm(t.artist)===norm(artist))){dup++;continue}state.tracks.unshift({id:uid(),title,artist,remix:row.remix||'',album:row.album||'',genre:row.genre||'',bpm:row.bpm||'',key:row.key||'',filePath:row.filePath||'',status:row.status||'pending',playlistId:p.id,source:row.source||'manual',date:Date.now()});count++}persist();toast(count+' Tracks importiert'+(dup?' · '+dup+' Duplikate übersprungen':''));return count}
const head=(eyebrow,title,desc)=>'<div class="eyebrow">'+eyebrow+'</div><h1>'+title+'</h1><p>'+desc+'</p>';
const card=(label,num,extra)=>'<div class="card"><label>'+label+'</label><strong>'+num+'</strong><small>'+extra+'</small></div>';
const action=(label,act,id)=>'<button class="btn" data-act="'+act+'" data-id="'+id+'">'+label+'</button>';
const beatport=t=>'https://www.beatport.com/search?q='+encodeURIComponent(t.artist+' '+t.title+(t.remix?' '+t.remix:''));
function visible(){return state.tracks.filter(t=>(filter==='all'||t.status===filter)&&(playlistFilter==='all'||t.playlistId===playlistFilter)&&norm(t.title+' '+t.artist+' '+t.genre).includes(norm(search)))}
function table(tracks){return '<div class="table">'+(tracks.length?'<table><thead><tr><th>TRACK</th><th>BPM / KEY</th><th>GENRE</th><th>STATUS</th><th>ACTIONS</th></tr></thead><tbody>'+tracks.map(t=>'<tr><td><strong>'+esc(t.title)+'</strong><small>'+esc(t.artist)+' '+esc(t.remix)+'</small></td><td>'+esc(t.bpm||'—')+' / '+esc(t.key||'—')+'</td><td>'+esc(t.genre||'—')+'</td><td><span class="pill '+esc(t.status)+'">'+esc(t.status.toUpperCase())+'</span></td><td><div class="row">'+action('⌕','beatport',t.id)+action('✎','edit',t.id)+action('×','delete',t.id)+'</div></td></tr>').join('')+'</tbody></table>':'<div class="empty">Noch keine passenden Tracks vorhanden.</div>')+'</div>'}

const storeSearch=t=>'https://www.beatport.com/search?q='+encodeURIComponent((t.artist||'')+' '+(t.title||'')+(state.settings.preferExtended?' extended mix':''));
function logSync(t,action,details=''){state.syncHistory.unshift({id:uid(),trackId:t.id,title:t.title,artist:t.artist,action,details,time:Date.now()});state.syncHistory=state.syncHistory.slice(0,350);persist()}
function scoreCandidate(t,artist,title,mix){let normal=x=>norm(String(x||'').replace(/\((original|extended|radio|club|edit|mix|remix)[^)]*\)/ig,''));const tokens=x=>new Set(normal(x).split(' ').filter(Boolean));const similarity=(a,b)=>{let A=tokens(a),B=tokens(b);return !A.size||!B.size?0:[...A].filter(x=>B.has(x)).length/Math.max(A.size,B.size)};let art=similarity(t.artist,artist),song=similarity(t.title,title),score=0.4*art+0.6*song;const ext=/extended/i.test(mix+' '+title),radio=/radio edit/i.test(mix+' '+title);if(state.settings.preferExtended){if(ext)score+=0.06;if(radio)score-=0.14}return Math.max(0,Math.min(100,Math.round(score*100)))}
let catalogSearchBusy=false;
async function searchCatalogTrack(t){
 const response=await fetch('/api/search-beatport',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({artist:t.artist,title:t.title})});
 const data=await response.json();
 if(!response.ok||!data.ok)throw Error((data.error||'Catalog lookup failed')+(data.providerStatus?' (MusicAPI HTTP '+data.providerStatus+(data.providerCode?', code '+data.providerCode:'')+')':''));
 const candidates=(data.candidates||[]).map(c=>({
  ...c,
  score:scoreCandidate(t,c.artist,c.name,c.mixHint||'')
 }));
 t.catalog={status:data.status,candidates,checkedAt:Date.now()};
 logSync(t,'Catalog lookup',candidates.length?candidates.length+' result(s) received from MusicAPI':'No Beatport match returned');
 return candidates;
}
async function lookupMusicApi(t){
 if(catalogSearchBusy)return toast('A catalog lookup is already running');
 catalogSearchBusy=true;
 try{await searchCatalogTrack(t);toast((t.catalog.candidates||[]).length?'Beatport catalog candidate found':'No Beatport catalog candidate found')}
 catch(error){t.catalog={status:'error',candidates:[],checkedAt:Date.now(),error:String(error.message||error)};persist();toast(t.catalog.error)}
 finally{catalogSearchBusy=false;render()}
}
async function lookupQueue(){
 if(catalogSearchBusy)return toast('A catalog lookup is already running');
 const pending=state.tracks.filter(t=>t.status==='pending'&&!t.match?.url&&!t.catalog?.checkedAt).slice(0,5);
 if(!pending.length)return toast('No unchecked pending tracks in the first batch');
 if(!confirm('Search Beatport through MusicAPI for '+pending.length+' track(s)? This may count towards your API usage.'))return;
 catalogSearchBusy=true;let ok=0,fail=0;
 try{for(const t of pending){try{await searchCatalogTrack(t);ok++}catch(e){fail++;logSync(t,'Catalog error',String(e.message||e).slice(0,120))}}}
 finally{catalogSearchBusy=false;render();toast(ok+' catalog searches completed'+(fail?' · '+fail+' errors':''))}
}
function applyCatalogCandidate(t,index=0){
 const c=t.catalog?.candidates?.[index];
 if(!c||!c.url)return toast('No supported Beatport track URL in this result');
 t.match={url:c.url,title:c.name,artist:c.artist,mix:c.mixHint,score:c.score,confirmedAt:Date.now(),source:'musicapi'};
 logSync(t,'Catalog candidate approved','MusicAPI result manually approved · heuristic '+c.score+'%');
 persist();render();toast('Match approved; Beatport cart not changed');
}
// One-screen import and matching. Catalog scores are estimates, not guarantees.
let studioRunning=false,studioExporting=false,studioProgress={done:0,total:0},studioError='',studioInput='',studioExportResult=null;
function bestExactCandidate(t, candidates){
  const exact=candidates.filter(c=>c.score===100);
  if(!exact.length)return null;
  // Prefer an explicitly requested mix; otherwise prefer extended mixes when configured.
  const preferred=String(t.remix||'').trim().toLowerCase();
  return [...exact].sort((a,b)=>{
    const priority=c=>(preferred&&String(c.name).toLowerCase().includes(preferred)?100:0)+(state.settings.preferExtended&&/extended mix/i.test(c.name+' '+c.mixHint)?10:0)+(c.url?2:0);
    return priority(b)-priority(a);
  })[0];
}
function autoSelectExact(t,candidates){
  const best=bestExactCandidate(t,candidates);
  if(!best){t.studioResult='review';t.studioCandidate=null;return}
  t.studioCandidate={...best};
  // A metadata match without a confirmed Beatport URL is NOT a cart-ready match.
  if(best.url){
    t.match={url:best.url,title:best.name,artist:best.artist,mix:best.mixHint,score:best.score,source:'musicapi',confirmedAt:Date.now()};
    t.studioResult='exact';
    logSync(t,'Exact metadata match','100% heuristic, track URL available; cart not changed');
  }else{
    t.studioResult='missing_url';
    logSync(t,'Metadata match','100% heuristic, Beatport track URL unavailable; cart not changed');
  }
}
async function exportToBeatportPlaylist(){
 if(studioExporting||studioRunning)return;
 const ready=state.tracks.filter(t=>['exact','manual','missing_url'].includes(t.studioResult)&&t.studioCandidate?.externalId&&t.status==='pending');
 const unique=[...new Map(ready.map(t=>[String(t.studioCandidate.externalId),t])).values()].slice(0,20);
 if(!unique.length)return toast('No matched tracks with Beatport IDs yet');
 if(sessionStorage.getItem('beatport_server_verified')!=='yes')return toast('Connect Beatport first');
 if(!confirm('Create a Beatport playlist with '+unique.length+' matched tracks? This will NOT add anything to the shopping cart or purchase music.'))return;
 studioExporting=true;studioExportResult=null;render();
 try{
  const response=await fetch('/api/export-beatport-playlist',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'CRATEFLOW '+new Date().toISOString().slice(0,10),trackIds:unique.map(t=>String(t.studioCandidate.externalId))})});
  const data=await response.json();
  if(!response.ok||!data.ok)throw Error(data.error||'Beatport playlist export failed');
  studioExportResult={name:data.name,added:data.added,playlistId:data.playlistId};
  for(const t of unique){t.beatportPlaylistId=data.playlistId;t.beatportPlaylistExported=true;logSync(t,'Playlist exported','Added to Beatport playlist '+data.playlistId+'; NOT added to cart')}
  persist();toast(data.added+' tracks transferred to Beatport playlist');
 }catch(e){studioError=String(e.message||e);toast(studioError)}
 finally{studioExporting=false;render()}
}
function studioView(){
 const spotify=!!sessionStorage.getItem('spotify_access');
 const beatport=sessionStorage.getItem('beatport_server_verified')==='yes';
 const tracks=state.tracks.filter(t=>!['owned','downloaded'].includes(t.status));
 const exact=tracks.filter(t=>t.studioResult==='exact'||t.studioResult==='manual').length;
 const missing=tracks.filter(t=>t.studioResult==='missing_url').length;
 const review=tracks.filter(t=>['review','error'].includes(t.studioResult)).length;
 const untouched=tracks.filter(t=>!t.studioResult).length;
 const percent=studioProgress.total?Math.round(studioProgress.done/studioProgress.total*100):0;
 return head('MUSIC WORKFLOW','Import & Match','Paste your music, find Beatport tracks, and review the results in one place.')+
 '<div class="studio-status"><span class="pill '+(spotify?'':'pending')+'">Spotify '+(spotify?'connected':'not connected')+'</span><span class="pill '+(beatport?'':'pending')+'">Beatport '+(beatport?'verified':'not verified')+'</span><button class="btn" data-page="welcome">MANAGE ACCOUNTS</button></div>'+
 '<div class="panel studio-main"><div class="eyebrow">01 · YOUR MUSIC</div><h2>Paste songs or a playlist</h2><textarea id="studioPaste" class="field" rows="5" placeholder="Spotify playlist or track link, or Artist – Track title (one per line)">'+esc(studioInput)+'</textarea><div class="row gap"><button class="btn primary" id="studioImport" '+(studioRunning?'disabled':'')+'>IMPORT & MATCH</button><button class="btn" id="studioUseExisting" '+(studioRunning?'disabled':'')+'>USE MY LIBRARY ('+tracks.length+')</button></div><p class="note">Spotify track and playlist links require a connected Spotify account. Copied text lines can be imported directly. Import & Match searches up to 10 pending tracks using MusicAPI.</p></div>'+
 '<div class="panel studio-main"><div class="row" style="justify-content:space-between"><div><div class="eyebrow">02 · BEATPORT MATCHING</div><h2>Find the right version</h2></div><span class="pill pending">'+tracks.length+' tracks</span></div>'+
 '<label class="studio-toggle"><input id="studioExtended" type="checkbox" '+(state.settings.preferExtended?'checked':'')+'> Prefer Extended Mix when available</label>'+
 '<div class="row gap"><button class="btn primary" id="studioSync" '+(studioRunning||!tracks.length?'disabled':'')+'>'+(studioRunning?'SEARCHING…':'MATCH UP TO 10 TRACKS')+'</button><span class="muted">API usage per search · no Beatport cart changes</span></div>'+
 (studioRunning?'<div class="studio-progress"><div style="width:'+percent+'%"></div></div><p>'+studioProgress.done+' / '+studioProgress.total+' checked</p>':'')+
 (studioError?'<p class="studio-error">'+esc(studioError)+'</p>':'')+
 '<div class="studio-metrics"><div><strong>'+exact+'</strong><small>Selected with link</small></div><div><strong>'+missing+'</strong><small>100%, link missing</small></div><div><strong>'+review+'</strong><small>Review needed</small></div><div><strong>'+untouched+'</strong><small>Not searched</small></div></div>'+
 '<div class="studio-export"><div><div class="eyebrow">03 · BEATPORT HANDOFF</div><h2>Send to Beatport</h2><p>Build a Beatport playlist from matched tracks, then use Beatport’s own Add to Cart / Buy All action. Purchases stay on Beatport.</p></div><button class="btn primary" id="studioExport" '+(studioRunning||studioExporting?'disabled':'')+'>'+(studioExporting?'EXPORTING…':'CREATE BEATPORT PLAYLIST')+'</button></div>'+
 (studioExportResult?'<div class="studio-export-success"><strong>'+studioExportResult.added+' tracks added to Beatport playlist</strong><span>Open your playlists in Beatport and choose Add to Cart. The real cart has NOT been updated by CRATEFLOW.</span><a href="https://www.beatport.com/my-beatport/playlists" target="_blank" rel="noopener noreferrer">OPEN BEATPORT PLAYLISTS ↗</a></div>':'')+
 '<div class="studio-results">'+(tracks.length?tracks.map(t=>{
 const result=t.studioResult||'pending';
 const c=t.studioCandidate;
 const label=result==='exact'?'100% selected':result==='manual'?'Selected · '+(t.match?.score??'—')+'%':result==='missing_url'?'100% · link needed':result==='review'?'Review match':result==='error'?'Search error':'Not searched';
 const matches=t.catalog?.candidates||[];
 return '<div class="studio-track"><div class="studio-track-main"><div><strong>'+esc(t.title)+'</strong><p>'+esc(t.artist)+'</p></div><span class="pill '+(result==='exact'?'':'pending')+'">'+label+'</span></div>'+
 (c?'<div class="studio-selected">'+esc(c.name)+' · '+esc(c.artist)+(c.url?'<a href="'+esc(c.url)+'" target="_blank" rel="noopener noreferrer">OPEN TRACK</a>':'<span>Store link unavailable</span>')+'</div>':'')+
 (result==='review'?'<div class="studio-review">'+matches.slice(0,4).map((m,i)=>'<div class="studio-option"><span>'+esc(m.name)+' · '+m.score+'%</span><button class="btn" data-act="studioChoose" data-id="'+t.id+'" data-index="'+i+'" '+(!m.url?'disabled':'')+'>SELECT</button></div>').join('')+'</div>':'')+
 (result==='error'?'<p class="studio-error">'+esc(t.studioError||'Search failed')+'</p>':'')+
 '<div class="row"><button class="btn" data-act="studioRetry" data-id="'+t.id+'" '+(studioRunning?'disabled':'')+'>RETRY</button><button class="btn" data-act="searchMatch" data-id="'+t.id+'">SEARCH BEATPORT</button></div></div>'
 }).join(''):'<div class="empty">Import songs to start matching.</div>')+'</div></div>'+
 '<p class="note">A 100% score means an exact result under CRATEFLOW’s text-based matching heuristic—not guaranteed release identity. Tracks are never purchased or added to a cart automatically.</p>';
}
async function studioImport(){
 if(studioRunning)return;
 const input=$('#studioPaste')?.value.trim()||'';
 studioInput=input;
 if(!input)return toast('Paste a Spotify link or track names first');
 const entries=parsePaste(input),rows=[],playlists=entries.filter(e=>e.type==='playlist');
 for(const item of entries.filter(e=>e.type==='text'))rows.push({title:item.title,artist:item.artist||'Unknown Artist',source:'pasted text'});
 const ids=entries.filter(e=>e.type==='track');
 if((ids.length||playlists.length)&&!sessionStorage.getItem('spotify_access'))return toast('Connect Spotify first for Spotify links');
 studioRunning=true;studioError='';render();
 try{
  for(const item of ids){
   const t=await spotifyGet('https://api.spotify.com/v1/tracks/'+item.id);
   if(t?.name)rows.push({title:t.name,artist:(t.artists||[]).map(a=>a.name).join(', '),album:t.album?.name||'',source:'spotify'});
  }
  for(const item of playlists){
   const base='https://api.spotify.com/v1/playlists/'+item.id;
   const p=await spotifyGet(base+'?fields=id,name');
   let next=base+'/items?limit=50',pages=0,list=[];
   while(next&&pages++<30){
    const data=await spotifyGet(next);
    for(const record of data.items||[]){
     const t=record.item||record.track||record;
     if(t?.name&&(!t.type||t.type==='track'))list.push({title:t.name,artist:(t.artists||[]).map(a=>a.name).join(', '),source:'spotify'});
    }
    next=data.next;
   }
   if(list.length)importTracks(list,p.name||'Spotify Playlist');
  }
  if(rows.length)importTracks(rows,'Quick Import');
  studioInput='';toast('Music imported.');
 }catch(e){studioError=String(e.message||e)}
 finally{studioRunning=false;render()}
 if(!studioError && sessionStorage.getItem('beatport_server_verified')==='yes') await studioSync();
}
async function studioSync(ids){
 if(studioRunning)return;
 let pool=state.tracks.filter(t=>t.status==='pending'&&(!t.studioResult||t.studioResult==='error'));
 if(Array.isArray(ids)){pool=state.tracks.filter(t=>ids.includes(t.id))}
 pool=pool.slice(0,10);
 if(!pool.length)return toast('No pending tracks to search');
 if(sessionStorage.getItem('beatport_server_verified')!=='yes')return toast('Connect Beatport from Get Started first');
 studioRunning=true;studioError='';studioProgress={done:0,total:pool.length};render();
 try{
  for(const t of pool){
   try{
    const matches=await searchCatalogTrack(t);
    autoSelectExact(t,matches);
   }catch(e){
    t.studioResult='error';t.studioError=String(e.message||e);
   }
   studioProgress.done++;persist();render();
  }
 }finally{studioRunning=false;render()}
}
function studioChoose(t,index){
 const c=t.catalog?.candidates?.[index];
 if(!c?.url)return toast('Beatport URL missing. Cannot confirm this track.');
 t.studioCandidate=c;
 t.match={url:c.url,title:c.name,artist:c.artist,mix:c.mixHint,score:c.score,source:'musicapi',confirmedAt:Date.now()};
 t.studioResult=c.score===100?'exact':'manual';
 logSync(t,'Selected candidate','User selected match '+c.score+'%; cart unchanged');
 render();
}
function handleMatching(a,t){const id=t.id;if(a==='searchMatch'){logSync(t,'Search opened','Beatport search opened in new tab');window.open(storeSearch(t),'_blank','noopener');return}
if(a==='saveMatch'){let get=cl=>document.querySelector('.'+cl+'[data-id="'+CSS.escape(id)+'"]')?.value.trim()||'';const url=get('match-url'),title=get('match-title'),artist=get('match-artist'),mix=get('match-mix');let valid;try{let parsed=new URL(url);valid=parsed.protocol==='https:'&&parsed.hostname==='www.beatport.com'&&/^\/track\/[^/]+\/\d+/.test(parsed.pathname)}catch{valid=false}if(!valid)return toast('Paste a valid Beatport track URL (www.beatport.com/track/.../123)');const score=scoreCandidate(t,artist,title,mix);t.match={url,title,artist,mix,score,confirmedAt:Date.now()};logSync(t,'Match saved','Candidate reviewed · heuristic '+score+'%');toast('Candidate saved · '+score+'% score');render();return}
if(a==='markCart'){if(!t.match?.url)return toast('Save a Beatport track match first');if(!confirm('Confirm you personally added this exact track to your Beatport cart?'))return;t.status='cart';logSync(t,'Cart confirmed','User manually confirmed Beatport cart addition');render();return}
if(a==='markUnmatched'){t.match={...(t.match||{}),unmatched:true};logSync(t,'Not found','Manually flagged for further search');toast('Marked not found');render()}
}


function onboardingView(){
 const spotify=!!sessionStorage.getItem('spotify_access');
 const beatport=sessionStorage.getItem('beatport_server_verified')==='yes';
 const callback=!!sessionStorage.getItem('beatport_auth_attempt');
 const msg=sessionStorage.getItem('beatport_callback_notice');
 const step=(n,title,description,body,done)=>'<div class="onboard-card"><div class="onboard-icon">'+n+'</div><div class="onboard-copy"><div class="row" style="justify-content:space-between"><h2>'+title+'</h2><span class="pill '+(done?'':'pending')+'">'+(done?'CONNECTED':'NOT CONNECTED')+'</span></div><p>'+description+'</p>'+body+'</div></div>';
 return head('WELCOME TO CRATEFLOW','From your playlists to your decks.','Connect your music accounts, import tracks and review matching candidates in one workspace.')+
 '<div class="onboard-top"><div><span class="eyebrow">FIRST TIME SETUP</span><h2>Connect your accounts</h2><p>No API keys or developer configuration required. Only connect the services you want to use.</p></div><span class="pill pending">BETA · LOCAL LIBRARY</span></div>'+
 step('01','Spotify','Import your playlists and track links using your Spotify account.',spotify?'<button class="btn" id="connectSpotify">RECONNECT SPOTIFY</button>':'<button class="btn primary" id="connectSpotify">CONNECT SPOTIFY</button>',spotify)+
 step('02','Beatport','Sign in through MusicAPI to link your Beatport account. Store cart syncing is not supported yet.',beatport?'<span class="pill">ACCOUNT VERIFIED</span>':beatportVerificationPending?'<span class="pill pending">VERIFYING CONNECTION…</span>':callback?'<div class="row"><button class="btn primary" id="verifyBeatportLogin">RETRY VERIFICATION</button><button class="btn" id="startBeatportLogin">RECONNECT</button></div>':'<button class="btn primary" id="startBeatportLogin">CONNECT BEATPORT</button>',beatport)+
 (msg?'<p class="note" style="padding:0 18px">'+esc(msg)+'</p>':'')+
 '<div class="onboard-next"><div><h2>Ready to organize?</h2><p>You can start with Spotify, pasted song lists or CSV. Beatport cart automation is not yet enabled.</p></div><div class="row"><button class="btn" id="finishOnboarding">GO TO DASHBOARD</button><button class="btn primary" id="onboardImport">IMPORT MUSIC →</button></div></div>';
}

function render(){const labels={welcome:'GET STARTED',match:'MATCH & SYNC',overview:'OVERVIEW',import:'IMPORT & SYNC',library:'MUSIC LIBRARY',beatport:'BEATPORT QUEUE',downloads:'DOWNLOADS',export:'REKORDBOX EXPORT',settings:'SETTINGS'};$('#crumb').textContent='WORKSPACE / '+labels[page];document.querySelectorAll('[data-page]').forEach(n=>n.classList.toggle('active',n.dataset.page===page));$('#connection').textContent=sessionStorage.getItem('spotify_access')?'● Spotify verbunden':'○ Spotify nicht verbunden';const s=trackStats();let html='';
if(page==='welcome'){html=onboardingView()}
if(page==='match'||page==='import'){html=studioView()}
if(page==='overview'){html=head('YOUR COMMAND CENTER','Your music. One workflow.','From Spotify discovery to your DJ decks — organize your entire music pipeline in one place.')+'<div class="grid">'+card('TOTAL TRACKS',s.total,'In your library')+card('TO SOURCE',s.pending,'Awaiting purchase')+card('BEATPORT QUEUE',s.cart,'Marked for checkout')+card('DOWNLOADED',s.downloaded,'Ready for Rekordbox')+'</div><div class="banner"><div><div class="eyebrow">STREAMLINE YOUR WORKFLOW</div><h2>From playlist to dancefloor.</h2><p>Import Spotify playlists, look up tracks on Beatport and prepare your Rekordbox library.</p></div><button class="btn primary" data-page="import">＋ IMPORT PLAYLIST</button></div><div class="columns"><div class="panel"><h2>Recently added</h2>'+(state.tracks.slice(0,6).map(t=>'<div class="listrow"><span>'+esc(t.title)+'<br><span class="muted">'+esc(t.artist)+'</span></span><span class="pill">'+esc(t.status)+'</span></div>').join('')||'<p>Starte mit dem Import deiner ersten Playlist.</p>')+'</div><div class="panel"><h2>Workflow progress</h2><div class="listrow"><span>Not yet sourced</span><b>'+s.pending+'</b></div><div class="listrow"><span>In queue</span><b>'+s.cart+'</b></div><div class="listrow"><span>Purchased</span><b>'+s.owned+'</b></div><div class="listrow"><span>Downloaded</span><b class="highlight">'+s.downloaded+'</b></div></div></div>'}
if(page==='library'){html=head('02 / ORGANIZE','Music Library','Search, filter and edit tracks across your playlists.')+'<div class="toolbar"><input class="field" id="search" placeholder="Search tracks..." value="'+esc(search)+'"><select class="field" id="filter">'+['all','pending','cart','owned','downloaded'].map(s=>'<option value="'+s+'" '+(filter===s?'selected':'')+'>'+s.toUpperCase()+'</option>').join('')+'</select><select class="field" id="playlistFilter"><option value="all">ALL PLAYLISTS</option>'+state.playlists.map(p=>'<option value="'+p.id+'" '+(playlistFilter===p.id?'selected':'')+'>'+esc(p.name)+'</option>').join('')+'</select><button class="btn" id="backup">Export JSON</button><button class="btn" id="restoreBtn">Import backup</button></div>'+table(visible())}
if(page==='beatport'){let tracks=state.tracks.filter(t=>t.status==='pending'||t.status==='cart');html=head('03 / SOURCE','Beatport Queue','Open Beatport searches and mark results as queued. This does NOT automatically add items to your Beatport account.')+'<div class="panel gap"><div class="row"><button class="btn primary" id="searchNext">SEARCH NEXT TRACK</button><button class="btn" id="copyQueue">COPY SEARCH LIST</button><button class="btn" id="beatportSite">OPEN BEATPORT</button></div><p class="note">Matching, cart placement and checkout are manual. Confirm the correct remix before buying.</p></div>'+table(tracks)}
if(page==='downloads'){html=head('04 / ACQUIRE','Downloads','Track your purchases and local files. Automatic Beatport downloads are not available.')+'<div class="grid">'+card('PURCHASED',s.owned,'Marked locally')+card('DOWNLOADED',s.downloaded,'Local metadata')+'</div><div class="panel"><div class="row"><button class="btn" id="beatportSite">OPEN BEATPORT DOWNLOADS</button></div><p class="note">Edit each track to set status and its actual absolute local audio file path. The browser cannot retrieve your Beatport purchases automatically.</p></div>'+table(state.tracks.filter(t=>t.status==='owned'||t.status==='downloaded'))}
if(page==='export'){let available=state.tracks.filter(t=>fileUri(t.filePath));html=head('05 / PERFORM','Rekordbox Export','Create an XML library with track locations for imported music files.')+'<div class="columns"><div class="panel"><h2>DJ_PLAYLISTS XML</h2><label class="label">PLAYLIST NAME</label><input class="field" id="exportName" value="CRATEFLOW Selection"><p><label><input id="downloadedOnly" type="checkbox" checked> Only downloaded tracks</label></p><button class="btn primary" id="xmlExport">EXPORT REKORDBOX XML</button><p class="note">A valid absolute local audio path is required for every exported track. '+available.length+' records have a usable file path.</p></div><div class="panel"><h2>Library backup</h2><p>Save your catalog independently of your current browser.</p><div class="row"><button class="btn" id="backup">EXPORT JSON</button><button class="btn" id="csvExport">EXPORT CSV</button></div></div></div>'}
if(page==='settings'){html=head('PREFERENCES','Settings','Manage your connected music services and library settings.')+
'<div class="panel" style="max-width:850px"><h2>Connected accounts</h2><div class="listrow"><span><strong>Spotify</strong><br><small class="muted">'+(sessionStorage.getItem('spotify_access')?'Connected this session':'Not connected')+'</small></span><button class="btn" id="connectSpotify">'+(sessionStorage.getItem('spotify_access')?'RECONNECT':'CONNECT')+'</button></div><div class="listrow"><span><strong>Beatport</strong><br><small class="muted">'+(sessionStorage.getItem('beatport_server_verified')==='yes'?'Verified this session':'Not verified')+'</small></span><button class="btn" data-page="welcome">MANAGE CONNECTION</button></div><p class="note">Account links are session-based in this beta. Your tracks remain saved only in the browser and are not shared across devices. Store cart sync is not available yet.</p><hr style="border:0;border-top:1px solid #303839;margin:24px 0"><h2>Music library</h2><div class="row"><button class="btn" id="backup">EXPORT BACKUP</button><button class="btn" id="restoreBtn">IMPORT BACKUP</button></div><details class="advanced"><summary>Advanced developer settings</summary><div class="advanced-inside"><h2>Spotify OAuth Client</h2><label class="label">CLIENT ID</label><input class="field" id="clientId" value="'+esc(state.settings.spotifyClientId)+'"><p class="note">Redirect URI: '+esc(location.origin+'/')+'</p><div class="row"><button class="btn" id="saveSettings">SAVE CLIENT ID</button><button class="btn" id="disconnectSpotify">DISCONNECT SPOTIFY</button></div><hr style="border:0;border-top:1px solid #303839;margin:24px 0"><h2>MusicAPI Connection</h2><label class="label">ACCOUNT SLUG (developer only)</label><input id="musicApiSlug" class="field" value="'+esc(state.settings.musicApiSlug||'tracky')+'"><div class="row gap"><button class="btn" id="saveMusicApiSlug">SAVE SLUG</button><button class="btn" id="verifyBeatportLogin">VERIFY SIGN-IN</button><button class="btn" id="startBeatportLogin">OPEN BEATPORT SIGN-IN</button></div><p class="note">Server credentials must remain in Vercel environment variables. No Beatport password is collected by CRATEFLOW. Verification is a test feature, not cart access.</p><div class="row"><button class="btn danger" id="clearAll">CLEAR LOCAL LIBRARY</button></div></div></details></div>'}
$('#view').innerHTML=html;bind()}
function nav(p){page=p;render()}
function download(filename,content,type){const b=new Blob([content],{type}),u=URL.createObjectURL(b),a=document.createElement('a');a.href=u;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(u),1000)}
function csvParse(input){const rows=[];let row=[],cell='',quoted=false;for(let i=0;i<input.length;i++){let c=input[i];if(quoted){if(c==='"'&&input[i+1]==='"'){cell+='"';i++}else if(c==='"')quoted=false;else cell+=c}else if(c==='"')quoted=true;else if(c===','){row.push(cell);cell=''}else if(c==='\n'){row.push(cell.replace(/\r$/,''));rows.push(row);row=[];cell=''}else cell+=c}row.push(cell);if(row.some(v=>v.trim()))rows.push(row);let headers=rows.shift()?.map(x=>x.trim().replace(/^\uFEFF/,''))||[];return rows.map(c=>Object.fromEntries(headers.map((h,i)=>[h,c[i]||'']))).filter(x=>x.title)}
function csvExport(){let headers=['title','artist','remix','bpm','key','genre','status','filePath'];download('crateflow-library.csv',[headers.join(','),...state.tracks.map(t=>headers.map(h=>'"'+String(t[h]??'').replace(/"/g,'""')+'"').join(','))].join('\n'),'text/csv')}
function fileUri(path){let p=String(path||'').trim().replace(/\\/g,'/');if(/^file:\/\//i.test(p))return p;if(!/^[A-Za-z]:\//.test(p)&&!p.startsWith('/'))return '';return 'file://localhost'+(p.startsWith('/')?'':'/')+p.split('/').map(encodeURIComponent).join('/').replace('%3A',':')}
function xmlEscape(s){return esc(s)}
function xmlExport(){let name=$('#exportName').value||'CRATEFLOW',tracks=state.tracks.filter(t=>fileUri(t.filePath)&&(!$('#downloadedOnly').checked||t.status==='downloaded'));if(!tracks.length){toast('No downloaded tracks with absolute file paths');return}let collection=tracks.map((t,i)=>'    <TRACK TrackID="'+(i+1)+'" Name="'+xmlEscape(t.title)+'" Artist="'+xmlEscape(t.artist)+'" Album="'+xmlEscape(t.album)+'" Genre="'+xmlEscape(t.genre)+'" Kind="MP3 File" AverageBpm="'+(Number(t.bpm)||0)+'" Tonality="'+xmlEscape(t.key)+'" Location="'+xmlEscape(fileUri(t.filePath))+'"/>').join('\n');let entries=tracks.map((_,i)=>'        <TRACK Key="'+(i+1)+'"/>').join('\n');download('crateflow-rekordbox.xml','<?xml version="1.0" encoding="UTF-8"?>\n<DJ_PLAYLISTS Version="1.0.0">\n  <PRODUCT Name="rekordbox" Version="7" Company="AlphaTheta"/>\n  <COLLECTION Entries="'+tracks.length+'">\n'+collection+'\n  </COLLECTION>\n  <PLAYLISTS>\n    <NODE Type="0" Name="ROOT" Count="1">\n      <NODE Name="'+xmlEscape(name)+'" Type="1" KeyType="0" Entries="'+tracks.length+'">\n'+entries+'\n      </NODE>\n    </NODE>\n  </PLAYLISTS>\n</DJ_PLAYLISTS>','application/xml');toast(tracks.length+' tracks exported')}
const b64=b=>btoa(String.fromCharCode(...b)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');
async function spotifyConnect(){const client=state.settings.spotifyClientId.trim();if(!client){nav('settings');return toast('Client ID required')}let verifier=b64(crypto.getRandomValues(new Uint8Array(64))),challenge=b64(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier)))),nonce=uid();sessionStorage.setItem('spotify_verifier',verifier);sessionStorage.setItem('spotify_state',nonce);const p=new URLSearchParams({response_type:'code',client_id:client,scope:'playlist-read-private playlist-read-collaborative',redirect_uri:location.origin+'/',code_challenge_method:'S256',code_challenge:challenge,state:nonce});location.href='https://accounts.spotify.com/authorize?'+p}
async function spotifyAuth(){let u=new URL(location.href),code=u.searchParams.get('code'),error=u.searchParams.get('error');if(!code&&!error)return;history.replaceState({},'',location.pathname);if(error){toast('Spotify: '+error);return}if(u.searchParams.get('state')!==sessionStorage.getItem('spotify_state')){toast('Spotify state mismatch');return}try{let form=new URLSearchParams({client_id:state.settings.spotifyClientId,grant_type:'authorization_code',code,redirect_uri:location.origin+'/',code_verifier:sessionStorage.getItem('spotify_verifier')||''});let r=await fetch('https://accounts.spotify.com/api/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:form}),x=await r.json();if(!r.ok)throw Error(x.error_description||x.error);sessionStorage.setItem('spotify_access',x.access_token);sessionStorage.setItem('spotify_expiry',Date.now()+x.expires_in*1000);if(x.refresh_token)sessionStorage.setItem('spotify_refresh',x.refresh_token);toast('Spotify verbunden')}catch(e){toast(e.message)}render()}
async function token(){let t=sessionStorage.getItem('spotify_access');if(!t)throw Error('Connect Spotify first');if(Date.now()<Number(sessionStorage.getItem('spotify_expiry')||0)-30000)return t;let f=new URLSearchParams({grant_type:'refresh_token',refresh_token:sessionStorage.getItem('spotify_refresh')||'',client_id:state.settings.spotifyClientId}),r=await fetch('https://accounts.spotify.com/api/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:f}),x=await r.json();if(!r.ok)throw Error(x.error_description||x.error);sessionStorage.setItem('spotify_access',x.access_token);sessionStorage.setItem('spotify_expiry',Date.now()+x.expires_in*1000);if(x.refresh_token)sessionStorage.setItem('spotify_refresh',x.refresh_token);return x.access_token}
async function spotifyGet(url){let r=await fetch(url,{headers:{Authorization:'Bearer '+await token()}});if(!r.ok)throw Error('Spotify API HTTP '+r.status+': '+(await r.text()).slice(0,130));return r.json()}

function parsePaste(input){
  const entries=[],seen=new Set();
  const re=/(?:https?:\/\/(?:open\.)?spotify\.com\/(track|playlist)\/|spotify:(track|playlist):)([A-Za-z0-9]{22})/ig;
  for(const line of input.split(/\r?\n/)){
    const trimmed=line.trim();if(!trimmed)continue;
    const matches=[...trimmed.matchAll(re)];
    if(matches.length){for(const m of matches){const type=(m[1]||m[2]).toLowerCase(),id=m[3],k=type+':'+id;if(!seen.has(k)){entries.push({type,id});seen.add(k)}}continue}
    if(/^(?:https?:\/\/|spotify:)/i.test(trimmed)) {entries.push({type:'unsupported',value:trimmed});continue}
    const tabbed=trimmed.split('\t').map(s=>s.trim()).filter(Boolean);
    let artist='',title='';
    if(tabbed.length>=2){title=tabbed[0];artist=tabbed[1]}
    else{
      const sep=trimmed.match(/^(.+?)\s+[–—-]\s+(.+)$/);
      if(sep){artist=sep[1].trim();title=sep[2].trim()}else title=trimmed;
    }
    if(title){const k='text:'+norm(artist+' '+title);if(!seen.has(k)){entries.push({type:'text',title,artist});seen.add(k)}}
  }
  return entries;
}
async function importPasted(){
  const value=$('#pasteTracks')?.value||'';
  const entries=parsePaste(value);
  if(!entries.length)return toast('Paste tracks or Spotify URLs first');
  const playlist=entries.filter(e=>e.type==='playlist');
  const ids=entries.filter(e=>e.type==='track');
  const textual=entries.filter(e=>e.type==='text');
  const unsupported=entries.filter(e=>e.type==='unsupported');
  let rows=[...textual.map(e=>({...e,source:'pasted text'}))],fail=0;
  if(ids.length){
    if(!sessionStorage.getItem('spotify_access'))return toast('Connect Spotify to resolve track URLs');
    for(const item of ids){
      try{
        const t=await spotifyGet('https://api.spotify.com/v1/tracks/'+item.id);
        if(t?.name)rows.push({title:t.name,artist:(t.artists||[]).map(a=>a.name).join(', '),album:t.album?.name||'',source:'spotify',spotifyUrl:'https://open.spotify.com/track/'+item.id});
        else fail++;
      }catch(err){fail++;if(fail===1)console.warn('Spotify track import issue',err)}
    }
  }
  let added=0;
  if(rows.length)added=importTracks(rows,'Pasted tracks');
  if(playlist.length){
    const p=playlist[0];$('#spotifyUrl').value='https://open.spotify.com/playlist/'+p.id;
    if(playlist.length===1&&!ids.length&&!textual.length){await spotifyImport();return}
  }
  if(unsupported.length||fail||playlist.length>1)toast(added+' imported · '+fail+' Spotify lookup errors · '+unsupported.length+' unsupported links'+(playlist.length?' · Playlist URL shown below':''));
  if(added){$('#pasteTracks').value='';nav('library')}
  else if(!playlist.length)toast('No songs imported; check Spotify access and pasted format');
}
async function spotifyImport(){let m=($('#spotifyUrl').value||'').match(/(?:playlist\/|spotify:playlist:)([A-Za-z0-9]+)/);if(!m)return toast('Please enter a Spotify playlist URL');try{let p=await spotifyGet('https://api.spotify.com/v1/playlists/'+m[1]+'?fields=id,name'),next='https://api.spotify.com/v1/playlists/'+m[1]+'/items?limit=50',tracks=[],pages=0;while(next&&pages++<30){let r=await spotifyGet(next);for(let item of r.items||[]){let t=item.item||item.track||item;if(!t?.name||t.type&&t.type!=='track')continue;tracks.push({title:t.name,artist:(t.artists||[]).map(a=>a.name).join(', '),album:t.album?.name||'',source:'spotify'})}next=r.next}importTracks(tracks,p.name||'Spotify Playlist');nav('library')}catch(e){toast(e.message)}}
function edit(t){const title=prompt('Track title',t.title);if(title===null)return;t.title=title.trim()||t.title;const artist=prompt('Artist',t.artist);if(artist===null)return;t.artist=artist.trim()||t.artist;const remix=prompt('Remix / Mix',t.remix||'');if(remix!==null)t.remix=remix;const bpm=prompt('BPM',t.bpm||'');if(bpm!==null)t.bpm=bpm;const key=prompt('Key',t.key||'');if(key!==null)t.key=key;const genre=prompt('Genre',t.genre||'');if(genre!==null)t.genre=genre;const status=prompt('Status: pending | cart | owned | downloaded',t.status);if(status&&['pending','cart','owned','downloaded'].includes(status.toLowerCase()))t.status=status.toLowerCase();const path=prompt('Absolute local audio file path',t.filePath||'');if(path!==null)t.filePath=path;persist();render()}
function bind(){const on=(sel,fn,event='click')=>{let e=$(sel);if(e)e.addEventListener(event,fn)};on('#studioPaste',v=>{studioInput=v.target.value},'input');on('#studioImport',studioImport);on('#studioSync',()=>studioSync());on('#studioExport',exportToBeatportPlaylist);on('#studioUseExisting',()=>{studioInput='';render()});on('#studioExtended',v=>{state.settings.preferExtended=v.target.checked;persist();render()},'change');on('#finishOnboarding',()=>{localStorage.setItem('crateflow_onboarded','yes');nav('overview')});on('#onboardImport',()=>{localStorage.setItem('crateflow_onboarded','yes');nav('import')});on('#preferExtended',e=>{state.settings.preferExtended=e.target.checked;persist();render()},'change');on('#searchFirstMatch',()=>{let t=state.tracks.find(t=>!t.match?.url&&t.status==='pending');if(!t)return toast('No unmatched tracks');window.open(storeSearch(t),'_blank','noopener');logSync(t,'Search opened','Beatport search opened');render()});on('#catalogBatch',lookupQueue);on('#downloadHistory',()=>download('crateflow-sync-history.json',JSON.stringify(state.syncHistory,null,2),'application/json'));on('#saveMusicApiSlug',()=>{let v=($('#musicApiSlug')?.value||'').trim().toLowerCase();if(!/^[a-z0-9][a-z0-9-]{1,62}$/.test(v))return toast('Check MusicAPI account slug');state.settings.musicApiSlug=v;persist();toast('MusicAPI slug saved')});on('#verifyBeatportLogin',()=>verifyBeatportConnection());on('#startBeatportLogin',()=>{const slug='tracky';state.settings.musicApiSlug=slug;persist();const returnUrl=location.origin+'/';window.location.assign('https://app.musicapi.com/'+slug+'/beatport/auth?returnUrl='+encodeURIComponent(returnUrl))});on('#exportBeatportRequest',()=>{const request='Subject: Beatport API integration request for CRATEFLOW\\n\\nHello Beatport Partnerships Team,\\n\\nI am developing CRATEFLOW, a personal DJ music manager that imports Spotify playlist metadata, identifies corresponding Beatport releases and lets the account holder review candidates before purchase. I would like to ask about authorized API access and OAuth integration. Specifically, are track search, user purchase history and adding an approved track to the user\'s default shopping cart available to third-party partners? Are there licensing, commercial or technical requirements? Checkout and payment would remain on Beatport.com.\\n\\nWebsite: '+location.origin+'\\n\\nThank you.';navigator.clipboard.writeText(request.replaceAll('\\n','\\n')).then(()=>toast('API request copied')).catch(()=>toast('Clipboard permission denied'))});on('#connectSpotify',spotifyConnect);on('#importSpotify',spotifyImport);on('#importPasted',importPasted);on('#clearPasted',()=>{$('#pasteTracks').value=''});on('#uploadCsv',()=>$('#csv').click());on('#quickAdd',()=>{let title=$('#quickTitle').value,artist=$('#quickArtist').value;if(!title.trim())return toast('Title required');importTracks([{title,artist}],'Manual additions');nav('library')});on('#search',e=>{search=e.target.value;let pos=e.target.selectionStart;render();$('#search').focus();$('#search').setSelectionRange(pos,pos)},'input');on('#filter',e=>{filter=e.target.value;render()},'change');on('#playlistFilter',e=>{playlistFilter=e.target.value;render()},'change');on('#searchNext',()=>{let t=state.tracks.find(t=>t.status==='pending');if(t)window.open(beatport(t),'_blank','noopener');else toast('Nothing pending')});on('#copyQueue',()=>{navigator.clipboard.writeText(state.tracks.filter(t=>t.status==='pending').map(t=>t.artist+' – '+t.title).join('\n')).then(()=>toast('Copied'))});on('#beatportSite',()=>window.open('https://www.beatport.com','_blank','noopener'));on('#backup',()=>download('crateflow-backup.json',JSON.stringify(state,null,2),'application/json'));on('#restoreBtn',()=>$('#restore').click());on('#csvExport',csvExport);on('#xmlExport',xmlExport);on('#saveSettings',()=>{state.settings.spotifyClientId=$('#clientId').value.trim();persist();toast('Settings saved')});on('#disconnectSpotify',()=>{['spotify_access','spotify_refresh','spotify_expiry'].forEach(k=>sessionStorage.removeItem(k));render()});on('#clearAll',()=>{if(confirm('Delete all local tracks and playlists?')){state=structuredClone(defaults);persist();render()}})}
document.addEventListener('click',e=>{let p=e.target.closest('[data-page]');if(p)return nav(p.dataset.page);let a=e.target.closest('[data-act]');if(!a)return;let t=state.tracks.find(t=>t.id===a.dataset.id);if(!t)return;if(a.dataset.act==='studioRetry')return studioSync([t.id]);if(a.dataset.act==='studioChoose')return studioChoose(t,Number(a.dataset.index||0));if(a.dataset.act==='catalogLookup')return lookupMusicApi(t);if(a.dataset.act==='acceptCatalog')return applyCatalogCandidate(t,Number(a.dataset.index||0));if(['searchMatch','saveMatch','markCart','markUnmatched'].includes(a.dataset.act))return handleMatching(a.dataset.act,t);if(a.dataset.act==='beatport')window.open(beatport(t),'_blank','noopener');else if(a.dataset.act==='edit')edit(t);else if(a.dataset.act==='delete'&&confirm('Remove '+t.title+'?')){state.tracks=state.tracks.filter(x=>x.id!==t.id);persist();render()}});
$('#csv').addEventListener('change',async e=>{let file=e.target.files[0];if(!file)return;try{importTracks(csvParse(await file.text()),file.name.replace(/\.csv$/i,''));nav('library')}catch(err){toast(err.message)}e.target.value=''});
$('#restore').addEventListener('change',async e=>{let file=e.target.files[0];if(!file)return;try{let x=JSON.parse(await file.text());if(!Array.isArray(x.tracks)||!Array.isArray(x.playlists))throw Error('Invalid backup');if(confirm('Replace your current library?')){state={...defaults,...x,settings:{...defaults.settings,...x.settings}};persist();render();toast('Backup restored')}}catch(err){toast(err.message)}e.target.value=''});
let beatportVerificationPending=false;
async function verifyBeatportConnection(){
 if(beatportVerificationPending)return;
 const attempt=sessionStorage.getItem('beatport_auth_attempt'),user=sessionStorage.getItem('beatport_claimed_user');
 if(!attempt||!user)return toast('Reconnect Beatport to start a new sign-in');
 beatportVerificationPending=true;
 sessionStorage.setItem('beatport_callback_notice','Checking your Beatport connection securely…');
 render();
 try{
  const response=await fetch('/api/verify-beatport',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({authModelUUID:attempt,integrationUserUUID:user})});
  const result=await response.json();
  if(!response.ok||!result.ok||!result.serviceVerified||result.service!=='beatport')throw Error(result.error||'Beatport connection could not be confirmed');
  sessionStorage.setItem('beatport_server_verified','yes');
  sessionStorage.setItem('beatport_callback_notice','Beatport connected and verified for this browser session.');
  sessionStorage.removeItem('beatport_auth_attempt');
  sessionStorage.removeItem('beatport_claimed_user');
  toast('Beatport connected successfully');
 }catch(error){
  sessionStorage.removeItem('beatport_server_verified');
  const notice='Beatport verification failed: '+String(error.message||error);
  sessionStorage.setItem('beatport_callback_notice',notice);
  toast(notice);
 }finally{beatportVerificationPending=false;render()}
}
function inspectBeatportReturn(){
 const url=new URL(location.href),encoded=url.searchParams.get('data64');
 if(!encoded)return;
 history.replaceState({},'',location.pathname);
 let message='A MusicAPI callback was received, but is not yet server-verified.';
 let shouldVerify=false;
 sessionStorage.removeItem('beatport_auth_attempt');
 sessionStorage.removeItem('beatport_claimed_user');
 sessionStorage.removeItem('beatport_server_verified');
 try{
  const data=JSON.parse(atob(encoded.replace(/-/g,'+').replace(/_/g,'/')));
  const status=data?.authModel?.status;
  const service=data?.integration?.type;
  const attempt=data?.authModel?.uuid;
  const connected=data?.integrationUserUUID;
  const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if(service!=='beatport')message='The returned service is not Beatport or is missing.';
  else if(status==='error')message='MusicAPI reported a failed sign-in.';
  else if(status==='success'&&uuid.test(attempt||'')&&uuid.test(connected||'')){
   sessionStorage.setItem('beatport_auth_attempt',attempt);
   sessionStorage.setItem('beatport_claimed_user',connected);
   shouldVerify=true;
   message='Beatport sign-in returned. Verifying the connection automatically…';
  }else message='Beatport sign-in did not return valid identifiers.';
 }catch{message='Unable to parse MusicAPI callback.'}
 sessionStorage.setItem('beatport_callback_notice',message);page='welcome';render();if(shouldVerify)verifyBeatportConnection();else toast(message);
}
render();inspectBeatportReturn();spotifyAuth();
