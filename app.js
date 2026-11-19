const $=s=>document.querySelector(s),esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const storage='crateflow_v1',defaults={tracks:[],playlists:[],settings:{}};
let state;try{state={...defaults,...JSON.parse(localStorage.getItem(storage)||'{}')}}catch{state=structuredClone(defaults)}
state.settings={...defaults.settings,preferExtended:true,...state.settings,musicApiSlug:'tracky'};for(const t of state.tracks||[]){if(t.studioResult==='missing_url'&&t.studioCandidate?.externalId&&t.studioCandidate?.score===100)t.studioResult='id_ready';}state.syncHistory=Array.isArray(state.syncHistory)?state.syncHistory:[];
let mixSelectedId=null;
let page=new URLSearchParams(location.search).get('app')==='1'?(localStorage.getItem('crateflow_onboarded')==='yes'?'import':'welcome'):'landing',search='',filter='all',playlistFilter='all';
const persist=()=>localStorage.setItem(storage,JSON.stringify(state)),uid=()=>crypto.randomUUID(),trackStats=()=>({total:state.tracks.length,pending:state.tracks.filter(t=>t.status==='pending').length,cart:state.tracks.filter(t=>t.status==='cart').length,owned:state.tracks.filter(t=>t.status==='owned').length,downloaded:state.tracks.filter(t=>t.status==='downloaded').length});
function toast(s){let t=$('#toast');t.textContent=s;t.classList.add('show');clearTimeout(toast.timer);toast.timer=setTimeout(()=>t.classList.remove('show'),4000)}
function norm(s){return String(s||'').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,' ').trim()}
function importTracks(rows,name){let p=state.playlists.find(p=>p.name===name);if(!p){p={id:uid(),name};state.playlists.push(p)}let count=0,dup=0;for(const row of rows){let title=String(row.title||'').trim(),artist=String(row.artist||'Unknown Artist').trim();if(!title)continue;if(state.tracks.some(t=>(row.spotifyId&&t.spotifyId===row.spotifyId)||(norm(t.title)===norm(title)&&norm(t.artist)===norm(artist)))){dup++;continue}state.tracks.unshift({id:uid(),title,artist,remix:row.remix||'',album:row.album||'',genre:row.genre||'',bpm:row.bpm||'',key:row.key||'',filePath:row.filePath||'',status:row.status||'pending',isrc:row.isrc||'',spotifyId:row.spotifyId||'',spotifyUrl:row.spotifyUrl||'',playlistId:p.id,source:row.source||'manual',date:Date.now()});count++}persist();toast(count+' Tracks importiert'+(dup?' · '+dup+' Duplikate übersprungen':''));return count}
const head=(eyebrow,title,desc)=>'<div class="eyebrow">'+eyebrow+'</div><h1>'+title+'</h1><p>'+desc+'</p>';
const card=(label,num,extra)=>'<div class="card"><label>'+label+'</label><strong>'+num+'</strong><small>'+extra+'</small></div>';
const action=(label,act,id)=>'<button class="btn" data-act="'+act+'" data-id="'+id+'">'+label+'</button>';
const beatport=t=>'https://www.beatport.com/search?q='+encodeURIComponent(t.artist+' '+t.title+(t.remix?' '+t.remix:''));
function visible(){return state.tracks.filter(t=>(filter==='all'||t.status===filter)&&(playlistFilter==='all'||t.playlistId===playlistFilter)&&norm(t.title+' '+t.artist+' '+t.genre).includes(norm(search)))}
function table(tracks){return '<div class="table">'+(tracks.length?'<table><thead><tr><th>TRACK</th><th>BPM / KEY</th><th>GENRE</th><th>STATUS</th><th>ACTIONS</th></tr></thead><tbody>'+tracks.map(t=>'<tr><td><strong>'+esc(t.title)+'</strong><small>'+esc(t.artist)+' '+esc(t.remix)+'</small></td><td>'+esc(t.bpm||'—')+' / '+esc(t.key||'—')+'</td><td>'+esc(t.genre||'—')+'</td><td><span class="pill '+esc(t.status)+'">'+esc(t.status.toUpperCase())+'</span></td><td><div class="row">'+action('⌕','beatport',t.id)+action('✎','edit',t.id)+action('×','delete',t.id)+'</div></td></tr>').join('')+'</tbody></table>':'<div class="empty">Noch keine passenden Tracks vorhanden.</div>')+'</div>'}

const storeSearch=t=>'https://www.beatport.com/search?q='+encodeURIComponent((t.artist||'')+' '+(t.title||'')+(state.settings.preferExtended?' extended mix':''));
function logSync(t,action,details=''){state.syncHistory.unshift({id:uid(),trackId:t.id,title:t.title,artist:t.artist,action,details,time:Date.now()});state.syncHistory=state.syncHistory.slice(0,350);persist()}
function scoreCandidate(t,artist,title,mix){
 return globalThis.CrateflowMatching.assess(t,{artist,name:title,mixHint:mix},state.settings.preferExtended).score;
}
let catalogSearchBusy=false;
async function searchCatalogTrack(t){
 const response=await fetch('/api/search-beatport',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({artist:t.artist,title:t.remix&&!String(t.title).toLowerCase().includes(String(t.remix).toLowerCase())?t.title+' ('+t.remix+')':t.title})});
 const data=await response.json();
 if(!response.ok||!data.ok)throw Error((data.error||'Catalog lookup failed')+(data.providerStatus?' (MusicAPI HTTP '+data.providerStatus+(data.providerCode?', code '+data.providerCode:'')+')':'')+(data.diagnostic==='unrecognized_response'?' [response: '+(data.responseFields||[]).join(', ')+'; data: '+(data.dataFields||[]).join(', ')+'; result: '+(data.resultFields||[]).join(', ')+']':''));
 const candidates=globalThis.CrateflowMatching.rankCandidates(t,data.candidates||[],state.settings.preferExtended);
 t.catalog={status:data.status,candidates,checkedAt:Date.now()};
 const automatic=globalThis.CrateflowMatching.bestAutomatic(t,candidates,state.settings.preferExtended);
 if(automatic)enrichTrackDjMetadata(t,automatic);
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
let studioResolving=false,studioLinkProgress={done:0,total:0},studioRunning=false,studioExporting=false,studioProgress={done:0,total:0},studioError='',studioInput='',studioExportResult=null,studioShowAll=false,studioModal='',studioPlaylistName='',studioInfoOpen=false;
function refreshStoredMatches(){
 let changed=false;
 for(const t of state.tracks){
  if(!Array.isArray(t.catalog?.candidates)||!t.catalog.candidates.length)continue;
  const before=JSON.stringify(t.catalog.candidates.map(c=>[c.externalId,c.score,c.assessment?.candidateVersion]));
  const ranked=globalThis.CrateflowMatching.rankCandidates(t,t.catalog.candidates,state.settings.preferExtended);
  const after=JSON.stringify(ranked.map(c=>[c.externalId,c.score,c.assessment?.candidateVersion]));
  if(before!==after){t.catalog.candidates=ranked;changed=true}
  else t.catalog.candidates=ranked;
  if(t.status!=='pending'||t.beatportPlaylistExported)continue;
  if(['exact','id_ready'].includes(t.studioResult)){
   const best=globalThis.CrateflowMatching.bestAutomatic(t,ranked,state.settings.preferExtended);
   if(!best||String(best.externalId)!==String(t.studioCandidate?.externalId||'')){
    // Previous 100% text matches may be different remixes or ambiguous releases.
    t.studioResult='review';t.studioCandidate=null;
    if(t.match?.source==='musicapi')delete t.match;
    changed=true;
   }else{
    t.studioCandidate={...best};
    if(enrichTrackDjMetadata(t,best))changed=true;
    if(t.match?.source==='musicapi')t.match.score=best.score;
   }
  }else if(t.studioResult==='review'){
   // Upgrade existing review entries when exactly compatible artist/title/version metadata is available.
   const best=globalThis.CrateflowMatching.bestAutomatic(t,ranked,state.settings.preferExtended);
   if(best){
    t.studioCandidate={...best};
    if(enrichTrackDjMetadata(t,best))changed=true;
    if(best.url){
     t.match={url:best.url,title:best.name,artist:best.artist,mix:best.mixHint,score:best.score,source:'musicapi',confirmedAt:Date.now()};
     t.studioResult='exact';
    }else t.studioResult='id_ready';
    changed=true;
   }
  }else if(t.studioResult==='missing_url'){
   t.studioResult='review';t.studioCandidate=null;changed=true;
  }
 }
 if(changed)persist();
}
function enrichTrackDjMetadata(t,candidate){
 if(!candidate?.assessment?.autoEligible)return false;
 let changed=false;
 const bpm=globalThis.CrateflowMix.bpmValue(candidate.bpm);
 if(globalThis.CrateflowMix.bpmValue(t.bpm)===null&&bpm!==null){
  t.bpm=bpm;t.bpmSource='musicapi-beatport';changed=true;
 }
 const key=globalThis.CrateflowMix.parseKey(candidate.key);
 if(!globalThis.CrateflowMix.parseKey(t.key)&&key){
  t.key=key;t.keySource='musicapi-beatport';changed=true;
 }
 return changed;
}
function bestExactCandidate(t,candidates){
 return globalThis.CrateflowMatching.bestAutomatic(t,candidates,state.settings.preferExtended);
}
function autoSelectExact(t,candidates){
 const best=bestExactCandidate(t,candidates);
 if(!best){
  t.studioResult='review';t.studioCandidate=null;
  if(t.match?.source==='musicapi')delete t.match;
  logSync(t,'Match needs review',candidates.length?'No safe title, artist and version match':'No Beatport candidate returned');
  return;
 }
 t.studioCandidate={...best};
 enrichTrackDjMetadata(t,best);
 if(best.url){
  t.match={url:best.url,title:best.name,artist:best.artist,mix:best.mixHint,score:best.score,source:'musicapi',confirmedAt:Date.now()};
  t.studioResult='exact';
 }else{
  t.studioResult='id_ready';
 }
 logSync(t,'Automatic metadata match','Title, artist and version align; unique Beatport ID; not purchase verification');
}
function studioEligible(t){return t.status==='pending'&&['exact','manual','id_ready'].includes(t.studioResult)&&Boolean(t.studioCandidate?.externalId)}
function studioChosen(){return state.tracks.filter(t=>t.studioSelected!==false)}
function studioOpenPlaylistDialog(){
 if(!studioChosen().some(studioEligible))return toast('No selected matched Beatport tracks yet');
 studioPlaylistName='CRATEFLOW '+new Date().toISOString().slice(0,10);
 studioModal='playlist';render();
}
async function exportToBeatportPlaylist(){
 if(studioExporting||studioRunning)return;
 const eligible=studioChosen().filter(studioEligible);
 const unique=[...new Map(eligible.map(t=>[String(t.studioCandidate.externalId),t])).values()];
 if(!unique.length)return toast('Select at least one matched track with a Beatport ID');
 if(unique.length>20)return toast('Maximum 20 tracks per playlist. Select fewer tracks.');
 if(sessionStorage.getItem('beatport_server_verified')!=='yes')return toast('Connect your Beatport account first');
 const title=String(document.querySelector('#studioPlaylistTitle')?.value||studioPlaylistName||'').trim().slice(0,75);
 if(!title)return toast('Enter a playlist name');
 studioExporting=true;studioError='';studioModal='';render();
 try{
  const response=await fetch('/api/export-beatport-playlist',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:title,trackIds:unique.map(t=>String(t.studioCandidate.externalId))})});
  const data=await response.json();
  if(!response.ok||!data.ok)throw Error(data.error||'Beatport playlist transfer failed');
  studioExportResult={name:data.name,added:data.added,playlistId:data.playlistId,at:Date.now()};
  studioInfoOpen=false;
  for(const t of unique){t.beatportPlaylistId=data.playlistId;t.beatportPlaylistExported=true;logSync(t,'Playlist exported','Added to Beatport playlist '+data.playlistId)}
  persist();toast(data.added+' tracks added to Beatport playlist');
 }catch(e){studioError=String(e.message||e);toast(studioError)}
 finally{studioExporting=false;render()}
}
function studioToggleAll(){
 const eligible=state.tracks.filter(t=>!['owned','downloaded'].includes(t.status));
 const all=eligible.length>0&&eligible.every(t=>t.studioSelected!==false);
 for(const t of eligible)t.studioSelected=all?false:true;
 persist();render();
}
function studioView(){
 const beatport=sessionStorage.getItem('beatport_server_verified')==='yes';
 const tracks=state.tracks.filter(t=>!['owned','downloaded'].includes(t.status));
 const selected=tracks.filter(t=>t.studioSelected!==false),ready=selected.filter(studioEligible);
 const exact=tracks.filter(t=>t.studioResult==='exact'||t.studioResult==='id_ready').length;
 const review=tracks.filter(t=>['review','error','missing_url'].includes(t.studioResult)).length;
 const remaining=tracks.filter(t=>!t.studioResult).length;
 const percent=studioProgress.total?Math.round(studioProgress.done/studioProgress.total*100):0;
 const list=studioShowAll?tracks:tracks.slice(0,30);
 const allChecked=tracks.length>0&&tracks.every(t=>t.studioSelected!==false);
 const row=t=>{
  const result=t.studioResult||'pending',checked=t.studioSelected!==false;
  const matches=t.catalog?.candidates||[];
  const status=result==='exact'?'AUTO MATCH':result==='id_ready'?'AUTO MATCH · ID':
    result==='manual'?'USER SELECTED':result==='review'?'REVIEW NEEDED':
    result==='missing_url'?'ID MISSING':result==='error'?'SEARCH ERROR':'PENDING';
  const selectedMatch=['exact','id_ready','manual'].includes(result)?t.studioCandidate:null;
  const selectedInfo=selectedMatch?
    '<div class="compact-match-note"><span>'+esc(selectedMatch.name||'Beatport track')+' · '+esc(selectedMatch.assessment?.candidateVersion||selectedMatch.mixHint||'Version unspecified')+
    ' · '+esc(selectedMatch.score)+'% metadata</span><button class="btn" data-act="studioChange" data-id="'+t.id+'">CHANGE</button></div>':'';
  const reviewOptions=result==='review'?
    '<div class="compact-options" aria-label="Beatport match candidates for '+esc(t.title)+'">'+
    (matches.length?matches.slice(0,1).map((m,i)=>
      '<div class="compact-option"><span><strong>'+esc(m.name)+'</strong><small>'+esc(m.artist)+' · '+esc(m.assessment?.candidateVersion||m.mixHint||'Version unspecified')+
      ' · '+esc(m.score)+'% metadata</small><small class="compact-reason">'+esc(m.assessment?.reason||'Review before selecting')+'</small></span>'+
      '<button class="btn" data-act="studioChoose" data-id="'+t.id+'" data-index="'+i+'" '+(!m.externalId?'disabled title="Beatport playlist ID unavailable"':'')+'>SELECT</button></div>'
    ).join(''):'<div class="compact-option"><span><strong>No catalog candidates found.</strong><small>Try searching again or verify the song on Beatport.</small></span></div>')+
    '<div class="compact-review-actions"><button class="btn" data-act="studioRetry" data-id="'+t.id+'" '+(studioRunning?'disabled':'')+'>SEARCH AGAIN</button></div></div>':'';
  const retryOption=result==='error'?'<div class="compact-review-actions"><button class="btn" data-act="studioRetry" data-id="'+t.id+'" '+(studioRunning?'disabled':'')+'>RETRY</button></div>':'';
  return '<div class="compact-track"><input class="compact-check" type="checkbox" data-id="'+t.id+'" aria-label="Select '+esc(t.title)+'" '+(checked?'checked':'')+'>'+
   '<div class="compact-name"><strong>'+esc(t.title)+'</strong><small>'+esc(t.artist)+(t.remix?' · '+esc(t.remix):'')+'</small>'+
   (result==='error'?'<small class="studio-error">'+esc(t.studioError||'Search failed')+'</small>':'')+selectedInfo+'</div>'+
   '<div class="compact-status"><span class="pill '+(['exact','id_ready','manual'].includes(result)?'':'pending')+'">'+status+'</span></div>'+
   reviewOptions+retryOption+'</div>';
 };
 return '<section class="flow-hero" aria-label="CRATEFLOW introduction">'+
 '<div class="flow-hero-top"><span>[ CRATEFLOW / MUSIC WORKSPACE ]</span><span>DISCOVER · MATCH · TRANSFER</span></div>'+
 '<div class="flow-hero-stage">'+
 '<div class="flow-ambient flow-ambient-left" aria-hidden="true"></div><div class="flow-ambient flow-ambient-right" aria-hidden="true"></div>'+
 '<div class="flow-hero-copy"><div class="flow-kicker">YOUR MUSIC. IN MOTION.</div><h1>FIND YOUR<br>FLOW STATE<span class="flow-dot">.</span></h1><p>One seamless space between the tracks you discover<br>and the playlists you create.</p></div>'+
 '<div class="flow-orbit" aria-hidden="true"><div class="flow-orbit-ring flow-ring-one"></div><div class="flow-orbit-ring flow-ring-two"></div><div class="flow-core"><span>CF<span class="flow-core-dot">.</span></span></div></div>'+
 '<div class="flow-float flow-float-left"><span>01 / IMPORT</span><strong>YOUR DISCOVERIES</strong><small>From Spotify and beyond</small></div>'+
 '<div class="flow-float flow-float-right"><span>02 / EXPORT</span><strong>YOUR PLAYLIST</strong><small>Ready for Beatport</small></div>'+
 '</div>'+
 '<div class="flow-hero-bottom"><span>MADE FOR THE WAY YOU LISTEN</span><span class="flow-scroll">SCROLL TO WORKSPACE ↓</span></div></section>'+
 '<div class="flow-workspace-heading"><span>THE WORKSPACE / 001</span><h2>MAKE IT FLOW<span>.</span></h2><p>Import your music. Find the right match. Build your next Beatport playlist.</p></div>'+
 '<div class="studio-status"><span class="pill">NO SPOTIFY LOGIN REQUIRED</span><span class="pill '+(beatport?'':'pending')+'">Beatport '+(beatport?'verified':'not connected')+'</span><button class="btn" data-page="welcome">BEATPORT CONNECTION</button></div>'+
 '<div class="panel studio-main flow-import-panel"><div class="eyebrow">01 / COPY & PASTE TRACKS</div><p class="note cf-paste-help">Paste Artist – Title lines or Title + Artist columns. No Spotify login required. Paste individual Spotify track URLs, Artist – Title lines, or two spreadsheet columns. Links are resolved via MusicLink when the API is configured. Spotify playlist URLs are imported via MusicAPI; individual Spotify track URLs use MusicLink (public playlists only, up to 500 entries per playlist).</p><textarea id="studioPaste" class="field" rows="5" placeholder="https://open.spotify.com/track/5KBUE75BEZMGmDnfW8y2gd&#10;Adriatique – Closer (Extended Mix)">'+esc(studioInput)+'</textarea><div class="row gap"><button class="btn primary" id="studioImport" '+(studioRunning||studioResolving?'disabled':'')+'>'+(studioResolving?'RESOLVING LINKS…':'IMPORT & MATCH')+'</button><button class="btn" id="uploadCsv" '+(studioResolving?'disabled':'')+'>UPLOAD CSV</button><label class="studio-toggle"><input id="studioExtended" type="checkbox" '+(state.settings.preferExtended?'checked':'')+'> Prefer Extended Mix</label></div>'+(studioResolving?'<p class="note" role="status" aria-live="polite">Resolving Spotify links '+studioLinkProgress.done+' / '+studioLinkProgress.total+'…</p>':'')+'<p class="cf-provider"><a href="https://musiclink.one/" target="_blank" rel="noopener noreferrer">Track metadata by MusicLink</a></p></div>'+
 '<div class="panel studio-main flow-tracks-panel"><div class="compact-header"><div><div class="eyebrow">02 / MATCHED MUSIC</div><h2>'+tracks.length+' songs</h2></div><div class="row"><button class="btn" id="studioSync" '+(studioRunning||studioResolving||!remaining?'disabled':'')+'>'+(studioRunning?'SEARCHING…':'MATCH NEXT 10')+'</button><button class="btn primary" id="studioExport" '+(studioRunning||studioResolving||studioExporting||!ready.length?'disabled':'')+'>CREATE BEATPORT PLAYLIST</button></div></div>'+
 '<p class="note">Selected: '+selected.length+' songs · '+ready.length+' ready to add to a new Beatport playlist.</p>'+
 '<div class="compact-summary"><span><b>'+exact+'</b> auto</span><span><b>'+review+'</b> review</span><span><b>'+remaining+'</b> pending</span><span><b>'+ready.length+'</b> ready</span></div>'+
 '<button class="btn studio-select-all" id="studioSelectAll">'+(allChecked?'DESELECT ALL':'SELECT ALL')+'</button>'+
 (studioRunning?'<div class="studio-progress"><div style="width:'+percent+'%"></div></div><p class="note">'+studioProgress.done+' of '+studioProgress.total+' searched</p>':'')+
 (studioError?'<p class="studio-error">'+esc(studioError)+'</p>':'')+
 '<div class="compact-list"><div class="compact-col-head"><span></span><span>SONG</span><span>STATUS</span></div>'+list.map(row).join('')+(tracks.length>30&&!studioShowAll?'<button id="studioShowAll" class="btn">SHOW ALL '+tracks.length+' SONGS</button>':'')+'</div></div>'+
 (studioExportResult?'<div class="panel studio-main studio-transfer"><div class="compact-header"><div><div class="eyebrow">03 / BEATPORT PLAYLIST</div><h2>Transfer status</h2></div><button class="btn studio-info-btn" id="studioInfo">'+(studioInfoOpen?'HIDE TRANSFER INFO':'✓ PLAYLIST CREATED')+'</button></div>'+(studioInfoOpen?'<div class="studio-export-success"><strong>'+esc(studioExportResult.added)+' tracks added to playlist: '+esc(studioExportResult.name)+'</strong><p>Your playlist was created in your connected Beatport account.</p><a href="https://www.beatport.com/" target="_blank" rel="noopener noreferrer">OPEN BEATPORT ↗</a></div>':'')+'</div>':'')+
 (studioModal==='playlist'?'<div class="studio-overlay"><div class="studio-dialog" role="dialog" aria-modal="true" aria-labelledby="studioDialogTitle"><button class="studio-close" id="studioClose" aria-label="Close">×</button><h2 id="studioDialogTitle">Create Beatport Playlist</h2><label class="label" for="studioPlaylistTitle">Playlist title</label><input class="field" id="studioPlaylistTitle" maxlength="75" value="'+esc(studioPlaylistName)+'"><div class="row studio-dialog-actions"><button class="btn" id="studioCancel">Cancel</button><button class="btn primary" id="studioCreatePlaylist">Create Playlist</button></div></div></div>':'');
}
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function importTextRows(input,name='Quick Import',progress=()=>{}){
 const parsed=globalThis.CrateflowClipboard.parse(input);
 const rows=[...parsed.tracks],warnings=[];
 const trackLinks=parsed.blockedLinks.filter(link=>link.kind==='track');
 const playlists=parsed.blockedLinks.filter(link=>link.kind==='playlist');
 const unknown=parsed.blockedLinks.filter(link=>link.kind==='unsupported');
 if(playlists.length>3)warnings.push((playlists.length-3)+' additional playlists not processed (limit: 3 per import).');
 for(const [pIndex,playlist] of playlists.slice(0,3).entries()){
  let cursor=null,pages=0,seenCursors=new Set(),loaded=0,failedPlaylist=false;
  do{
   progress(pIndex*10+pages+1,Math.min(playlists.length,3)*10);
   try{
    const response=await fetch('/api/resolve-spotify-playlist',{
     method:'POST',headers:{'Content-Type':'application/json'},
     body:JSON.stringify({id:playlist.id,...(cursor?{nextParam:cursor}:{})})
    });
    const result=await response.json().catch(()=>({}));
    if(!response.ok||!result.ok||!Array.isArray(result.tracks)){
     warnings.push('Playlist '+(pIndex+1)+': '+String(result.error||'MusicAPI unavailable').slice(0,150));
     failedPlaylist=true;break;
    }
    rows.push(...result.tracks);loaded+=result.tracks.length;
    if(result.skipped?.unavailable||result.skipped?.incomplete)
     warnings.push('Playlist '+(pIndex+1)+': '+((result.skipped.unavailable||0)+(result.skipped.incomplete||0))+' unavailable or incomplete tracks skipped on page '+(pages+1)+'.');
    cursor=result.nextParam||null;pages++;
    if(cursor){
     if(seenCursors.has(cursor)){warnings.push('Playlist '+(pIndex+1)+': repeated pagination cursor.');failedPlaylist=true;break}
     seenCursors.add(cursor);
    }
   }catch{
    warnings.push('Playlist '+(pIndex+1)+': MusicAPI request failed.');failedPlaylist=true;break;
   }
  }while(cursor&&pages<10);
  if(cursor&&pages>=10)warnings.push('Playlist '+(pIndex+1)+': first 500 entries processed; remaining entries not imported.');
  if(failedPlaylist&&loaded)warnings.push('Playlist '+(pIndex+1)+': only '+loaded+' accessible tracks were loaded.');
 }
 if(unknown.length)warnings.push(unknown.length+' unsupported URL(s) skipped.');
 if(parsed.missingArtist.length)warnings.push(parsed.missingArtist.length+' track name(s) without an artist were skipped.');
 let resolved=0,failed=0,notConfigured=false;
 const batch=trackLinks.slice(0,10);
 if(trackLinks.length>batch.length)warnings.push((trackLinks.length-batch.length)+' additional links not processed; import up to 10 links per batch.');
 for(let i=0;i<batch.length;i++){
  const entry=batch[i];
  progress(i+1,batch.length);
  try{
   const response=await fetch('/api/resolve-spotify-track',{
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({id:entry.id})
   });
   const payload=await response.json().catch(()=>({}));
   if(response.ok&&payload.ok&&payload.track?.title&&payload.track?.artist){
    rows.push({...payload.track,source:'musiclink'});resolved++;
   }else{
    failed++;
    if(payload.code==='not_configured'){
     notConfigured=true;
     warnings.push('Spotify link lookup is not enabled yet: the owner must configure a MusicLink API key in Vercel.');
     break;
    }
    if(payload.code==='rate_limited'||payload.code==='provider_rate_limit'){
     warnings.push('Track lookup limit reached. Try again later or paste Artist – Title.');
     break;
    }
    warnings.push('Track '+(i+1)+' was not resolved: '+String(payload.error||'Unknown metadata error').slice(0,130));
   }
  }catch{
   failed++;warnings.push('Track '+(i+1)+' could not be resolved because the metadata service is unavailable.');
  }
  // The free MusicLink API allows one request/second. Avoid burst traffic.
  if(i<batch.length-1)await sleep(1100);
 }
 const added=rows.length?importTracks(rows,name):0;
 if(notConfigured&&batch.length>1)warnings.push('Other Spotify links were not processed.');
 return {added,resolved,failed,linkCount:trackLinks.length,message:warnings.join(' '),
  hasUnresolved:failed>0||notConfigured||trackLinks.length>batch.length||playlists.length>3||warnings.length>0||unknown.length>0||parsed.missingArtist.length>0};
}
async function studioImport(){
 if(studioRunning||studioResolving)return;
 const input=$('#studioPaste')?.value||studioInput||'';
 studioInput=input;
 if(!input.trim())return toast('Paste a Spotify playlist link, track link or Artist – Title lines first.');
 studioError='';studioResolving=true;studioLinkProgress={done:0,total:0};render();
 let result;
 try{
  result=await importTextRows(input,'Quick Import',(done,total)=>{
   studioLinkProgress={done,total};render();
  });
  studioError=result.message;
  if(!result.added){toast(result.message||'No tracks imported');return}
  if(!result.hasUnresolved)studioInput='';
  localStorage.setItem('crateflow_onboarded','yes');
  toast(result.added+' tracks imported'+(result.resolved?' · '+result.resolved+' Spotify links resolved':'')+
    (result.hasUnresolved?' · review import warnings':''));
 }catch(err){
  studioError=String(err.message||err);toast(studioError);return;
 }finally{studioResolving=false;studioLinkProgress={done:0,total:0};render()}
 if(sessionStorage.getItem('beatport_server_verified')==='yes')await studioSync();
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
 if(!c?.externalId)return toast('Beatport track ID missing. Cannot confirm this track.');
 t.studioCandidate={...c};
 enrichTrackDjMetadata(t,c);
 t.match={url:c.url||null,title:c.name,artist:c.artist,mix:c.mixHint,score:c.score,source:'musicapi',confirmedAt:Date.now()};
 t.studioResult='manual';
 logSync(t,'Selected candidate','User approved '+(c.assessment?.candidateVersion||c.mixHint||'version')+' · similarity '+c.score+'%');
 render();
}
function handleMatching(a,t){const id=t.id;if(a==='searchMatch'){logSync(t,'Search opened','Beatport search opened in new tab');window.open(storeSearch(t),'_blank','noopener');return}
if(a==='saveMatch'){let get=cl=>document.querySelector('.'+cl+'[data-id="'+CSS.escape(id)+'"]')?.value.trim()||'';const url=get('match-url'),title=get('match-title'),artist=get('match-artist'),mix=get('match-mix');let valid;try{let parsed=new URL(url);valid=parsed.protocol==='https:'&&parsed.hostname==='www.beatport.com'&&/^\/track\/[^/]+\/\d+/.test(parsed.pathname)}catch{valid=false}if(!valid)return toast('Paste a valid Beatport track URL (www.beatport.com/track/.../123)');const score=scoreCandidate(t,artist,title,mix);t.match={url,title,artist,mix,score,confirmedAt:Date.now()};logSync(t,'Match saved','Candidate reviewed · heuristic '+score+'%');toast('Candidate saved · '+score+'% score');render();return}
if(a==='markCart'){if(!t.match?.url)return toast('Save a Beatport track match first');if(!confirm('Confirm you personally added this exact track to your Beatport cart?'))return;t.status='cart';logSync(t,'Cart confirmed','User manually confirmed Beatport cart addition');render();return}
if(a==='markUnmatched'){t.match={...(t.match||{}),unmatched:true};logSync(t,'Not found','Manually flagged for further search');toast('Marked not found');render()}
}


function onboardingView(){
 const beatport=sessionStorage.getItem('beatport_server_verified')==='yes';
 const callback=!!sessionStorage.getItem('beatport_auth_attempt');
 const msg=sessionStorage.getItem('beatport_callback_notice');
 return head('WELCOME TO CRATEFLOW','From your discoveries to your decks.','Import track titles and artists without Spotify login. Connect Beatport when you want to match and export.')+
 '<div class="onboard-top"><div><span class="eyebrow">NO SPOTIFY LOGIN REQUIRED</span><h2>Copy. Paste. Match.</h2><p>Begin with a list of tracks or a CSV file. Connecting Beatport is optional until you want to search.</p></div><span class="pill pending">BETA · LOCAL LIBRARY</span></div>'+
 '<div class="onboard-card"><div class="onboard-icon">01</div><div class="onboard-copy"><div class="row" style="justify-content:space-between"><h2>Import tracks</h2><span class="pill">READY</span></div><p>Paste Artist – Track lines or two columns from a spreadsheet. Individual Spotify track links can be resolved without Spotify login when the licensed MusicLink integration is configured. Spotify playlist URLs are not supported.</p><button class="btn primary" id="onboardImport">START IMPORT →</button></div></div>'+
 '<div class="onboard-card"><div class="onboard-icon">02</div><div class="onboard-copy"><div class="row" style="justify-content:space-between"><h2>Connect Beatport</h2><span class="pill '+(beatport?'':'pending')+'">'+(beatport?'VERIFIED':'NOT CONNECTED')+'</span></div><p>Required for automatic Beatport matching and playlist creation, not for importing tracks. Automatic cart and audio downloads are not available.</p>'+
 (beatport?'<div class="row"><span class="pill">ACCOUNT VERIFIED</span><button class="btn" id="startBeatportLogin">RECONNECT</button></div>':beatportVerificationPending?'<span class="pill pending">VERIFYING CONNECTION…</span>':callback?'<div class="row"><button class="btn primary" id="verifyBeatportLogin">RETRY VERIFICATION</button><button class="btn" id="startBeatportLogin">RECONNECT</button></div>':'<button class="btn primary" id="startBeatportLogin">CONNECT BEATPORT</button>')+
 '</div></div>'+
 (msg?'<p class="note" style="padding:0 18px">'+esc(msg)+'</p>':'')+
 '<div class="onboard-next"><div><h2>Ready to organize?</h2><p>Import your music now. Beatport can be connected later.</p></div><div class="row"><button class="btn" id="finishOnboarding">GO TO DASHBOARD</button><button class="btn primary" data-page="import">IMPORT MUSIC →</button></div></div>';
}

function landingView(){
 return `
 <div class="landing af-landing">
   <section class="af-hero" id="top" aria-labelledby="af-heading">
     <div class="af-grid-pattern" aria-hidden="true"></div>
     <div class="af-glow" aria-hidden="true"></div>
     <div class="af-horizon" aria-hidden="true"></div>
     <header class="af-nav">
       <a href="/" class="af-brand" aria-label="CRATEFLOW Startseite">CRATE<span>FLOW</span><sup>®</sup></a>
       <nav aria-label="Landingpage Navigation">
         <a href="#how">WORKFLOW</a>
         <a href="#about">ABOUT</a>
       </nav>
       <button id="landingLogin" class="af-nav-cta" type="button">APP ÖFFNEN <span aria-hidden="true">↗</span></button>
     </header>
     <div class="af-hero-content">
       <div class="af-top-pill"><span class="af-pulse" aria-hidden="true"></span> THE DJ PLAYLIST WORKFLOW</div>
       <h1 id="af-heading">From Spotify<br>to <em>Beatport.</em><br>In one flow.</h1>
       <p>Discover. Match. Create your playlist.</p>
       <form id="landingImportForm" class="af-import-form" aria-label="Trackliste importieren">
         <label for="landingPlaylistUrl">YOUR TRACK LIST · NO LOGIN NEEDED</label>
         <div class="af-import-row">
           <span class="af-source-icon" aria-hidden="true">♫</span>
           <textarea id="landingPlaylistUrl" name="tracklist" rows="2" autocomplete="off" placeholder="Paste Spotify track links or Artist – Title lines" aria-label="Trackliste mit Künstlern und Titeln" required>${esc(studioInput)}</textarea>
           <button type="submit" title="Playlist importieren" aria-label="Playlist importieren">↗</button>
         </div>
       </form>
       <div class="af-hero-after"><span>NO MANUAL TRACK SEARCHING</span><a href="#how">EXPLORE THE FLOW <span aria-hidden="true">↓</span></a></div>
     </div>
     <div class="af-hero-corner af-corner-left" aria-hidden="true">CRATEFLOW / 001</div>
     <div class="af-hero-corner af-corner-right" aria-hidden="true">MADE FOR MUSIC CURATORS</div>
   </section>
   <section class="af-services" aria-label="Spotify zu Beatport Workflow">
     <div class="af-service-item"><span class="af-service-icon" aria-hidden="true">♫</span><strong>SPOTIFY</strong><small>DISCOVER</small></div>
     <div class="af-service-item"><span class="af-service-symbol" aria-hidden="true">✳</span><strong>CRATEFLOW</strong><small>MATCH</small></div>
     <div class="af-service-item"><span class="af-service-icon" aria-hidden="true">↗</span><strong>BEATPORT</strong><small>CREATE</small></div>
   </section>
   <section class="af-workflow" id="how">
     <div class="af-workflow-inner">
       <div class="af-section-label">THE PROCESS / 01</div>
       <h2>Three steps.<br><em>One seamless flow.</em></h2>
       <div class="af-steps">
         <article class="af-step"><span>01 /</span><div class="af-step-glyph" aria-hidden="true">↗</div><h3>IMPORT</h3><p>Paste Spotify track links or Artist – Track names. No login required.</p></article>
         <article class="af-step"><span>02 /</span><div class="af-step-glyph" aria-hidden="true">◎</div><h3>MATCH</h3><p>Find tracks on Beatport.</p></article>
         <article class="af-step"><span>03 /</span><div class="af-step-glyph" aria-hidden="true">≡</div><h3>CREATE</h3><p>Build your Beatport playlist.</p></article>
       </div>
     </div>
   </section>
   <section class="af-end" id="about">
     <div class="af-section-label">YOUR MUSIC / YOUR FLOW</div>
     <h2>Ready to find<br>your next track?</h2>
     <button type="button" id="landingBottomStart" class="af-end-cta">GET STARTED <span aria-hidden="true">↗</span></button>
     <p>Paste tracks without Spotify login. Beatport connection only for automatic matching and playlist transfer.</p>
   </section>
   <footer class="af-footer"><a href="/" class="af-brand">CRATE<span>FLOW</span><sup>®</sup></a><span>DISCOVER / MATCH / CREATE</span><span>© 2026 CRATEFLOW</span></footer>
 </div>`;
}
function mixView(){
 const tracks=state.tracks;
 const compatible=tracks.filter(t=>globalThis.CrateflowMix.parseKey(t.key)&&globalThis.CrateflowMix.bpmValue(t.bpm));
 const current=tracks.find(t=>t.id===mixSelectedId)||compatible[0];
 if(!current)return head('DJ TOOLS / HARMONIC MIXING','Mix Compatibility','Find songs that work together using real BPM and musical key metadata.')+
 '<div class="panel"><h2>No complete BPM + Key data yet</h2><p>MusicAPI enrichment can check your matched Beatport tracks. If the provider has no BPM or Key, you can enter them manually in your library.</p><button class="btn" id="mixEnrich">FIND MISSING BPM / KEY (NEXT 10)</button> <button class="btn primary" data-page="library">OPEN LIBRARY</button></div>';
 mixSelectedId=current.id;
 const results=globalThis.CrateflowMix.recommendations(current,tracks);
 const ready=results.filter(r=>r.score!==null),unknown=results.length-ready.length;
 return head('DJ TOOLS / HARMONIC MIXING','Mix Compatibility','Choose a track to see compatible songs by Camelot key and BPM. These are mixing suggestions, not guaranteed transitions.')+
 '<div class="panel"><div class="eyebrow">SOURCE TRACK</div><select class="field" id="mixSource">'+tracks.map(t=>'<option value="'+esc(t.id)+'" '+(t.id===current.id?'selected':'')+'>'+esc(t.artist+' – '+t.title)+'</option>').join('')+'</select>'+
 '<p class="note">Key '+esc(globalThis.CrateflowMix.parseKey(current.key)||'not available')+' · '+esc(current.bpm||'BPM not available')+' BPM</p>'+
 '<p class="note">'+ready.length+' rated · '+unknown+' missing BPM or key. To add metadata, open MUSIC LIBRARY and choose EDIT for a track.</p></div>'+
 '<div class="panel"><div class="row"><button class="btn" id="mixEnrich" '+(studioRunning?'disabled':'')+'>FIND MISSING BPM / KEY (NEXT 10)</button></div><p class="note">MusicAPI may not provide BPM or key for every track. Existing values are kept.</p></div>'+
 '<div class="panel"><h2>Recommended next tracks</h2><div class="table"><table><thead><tr><th>TRACK</th><th>KEY</th><th>BPM</th><th>COMPATIBILITY</th><th>REASON</th></tr></thead><tbody>'+
 results.map(r=>'<tr><td><strong>'+esc(r.track.title)+'</strong><small>'+esc(r.track.artist)+'</small></td><td>'+esc(r.keyB||'—')+'</td><td>'+esc(r.bpmB??'—')+'</td>'+
 '<td>'+ (r.score===null?'NOT RATED':r.score+'% · '+esc(r.label))+'</td><td>'+esc(r.score===null?'Enter missing BPM/Key':r.keyReason+(r.bpmDifference!==null?' · '+r.bpmDifference.toFixed(1)+'% tempo':'') )+'</td></tr>').join('')+
 '</tbody></table></div></div>';
}
function render(){document.body.classList.toggle('landing-mode',page==='landing');const labels={landing:'HOME',welcome:'GET STARTED',match:'MATCH & SYNC',overview:'OVERVIEW',import:'IMPORT & SYNC',library:'MUSIC LIBRARY',beatport:'BEATPORT QUEUE',downloads:'DOWNLOADS',export:'REKORDBOX EXPORT',mix:'MIX COMPATIBILITY',settings:'SETTINGS'};$('#crumb').textContent='WORKSPACE / '+labels[page];document.querySelectorAll('[data-page]').forEach(n=>n.classList.toggle('active',n.dataset.page===page));$('#connection').textContent=sessionStorage.getItem('beatport_server_verified')==='yes'?'● Beatport verbunden':'○ Beatport noch nicht verbunden';const s=trackStats();let html='';
if(page==='landing'){html=landingView()}
if(page==='mix'){html=mixView()}
if(page==='welcome'){html=onboardingView()}
if(page==='match'||page==='import'){html=studioView()}
if(page==='overview'){html=head('YOUR COMMAND CENTER','Your music. One workflow.','From Spotify discovery to your DJ decks — organize your entire music pipeline in one place.')+'<div class="grid">'+card('TOTAL TRACKS',s.total,'In your library')+card('TO SOURCE',s.pending,'Awaiting purchase')+card('BEATPORT QUEUE',s.cart,'Marked for checkout')+card('DOWNLOADED',s.downloaded,'Ready for Rekordbox')+'</div><div class="banner"><div><div class="eyebrow">STREAMLINE YOUR WORKFLOW</div><h2>From playlist to dancefloor.</h2><p>Import artist and title lists, look up tracks on Beatport and prepare your Rekordbox library.</p></div><button class="btn primary" data-page="import">＋ IMPORT PLAYLIST</button></div><div class="columns"><div class="panel"><h2>Recently added</h2>'+(state.tracks.slice(0,6).map(t=>'<div class="listrow"><span>'+esc(t.title)+'<br><span class="muted">'+esc(t.artist)+'</span></span><span class="pill">'+esc(t.status)+'</span></div>').join('')||'<p>Starte mit dem Import deiner ersten Playlist.</p>')+'</div><div class="panel"><h2>Workflow progress</h2><div class="listrow"><span>Not yet sourced</span><b>'+s.pending+'</b></div><div class="listrow"><span>In queue</span><b>'+s.cart+'</b></div><div class="listrow"><span>Purchased</span><b>'+s.owned+'</b></div><div class="listrow"><span>Downloaded</span><b class="highlight">'+s.downloaded+'</b></div></div></div>'}
if(page==='library'){html=head('02 / ORGANIZE','Music Library','Search, filter and edit tracks across your playlists.')+'<div class="toolbar"><input class="field" id="search" placeholder="Search tracks..." value="'+esc(search)+'"><select class="field" id="filter">'+['all','pending','cart','owned','downloaded'].map(s=>'<option value="'+s+'" '+(filter===s?'selected':'')+'>'+s.toUpperCase()+'</option>').join('')+'</select><select class="field" id="playlistFilter"><option value="all">ALL PLAYLISTS</option>'+state.playlists.map(p=>'<option value="'+p.id+'" '+(playlistFilter===p.id?'selected':'')+'>'+esc(p.name)+'</option>').join('')+'</select><button class="btn" id="backup">Export JSON</button><button class="btn" id="restoreBtn">Import backup</button></div>'+table(visible())}
if(page==='beatport'){let tracks=state.tracks.filter(t=>t.status==='pending'||t.status==='cart');html=head('03 / SOURCE','Beatport Queue','Open Beatport searches and mark results as queued. This does NOT automatically add items to your Beatport account.')+'<div class="panel gap"><div class="row"><button class="btn primary" id="searchNext">SEARCH NEXT TRACK</button><button class="btn" id="copyQueue">COPY SEARCH LIST</button><button class="btn" id="beatportSite">OPEN BEATPORT</button></div><p class="note">Matching, cart placement and checkout are manual. Confirm the correct remix before buying.</p></div>'+table(tracks)}
if(page==='downloads'){html=head('04 / ACQUIRE','Downloads','Track your purchases and local files. Automatic Beatport downloads are not available.')+'<div class="grid">'+card('PURCHASED',s.owned,'Marked locally')+card('DOWNLOADED',s.downloaded,'Local metadata')+'</div><div class="panel"><div class="row"><button class="btn" id="beatportSite">OPEN BEATPORT DOWNLOADS</button></div><p class="note">Edit each track to set status and its actual absolute local audio file path. The browser cannot retrieve your Beatport purchases automatically.</p></div>'+table(state.tracks.filter(t=>t.status==='owned'||t.status==='downloaded'))}
if(page==='export'){let available=state.tracks.filter(t=>fileUri(t.filePath));html=head('05 / PERFORM','Rekordbox Export','Create an XML library with track locations for imported music files.')+'<div class="columns"><div class="panel"><h2>DJ_PLAYLISTS XML</h2><label class="label">PLAYLIST NAME</label><input class="field" id="exportName" value="CRATEFLOW Selection"><p><label><input id="downloadedOnly" type="checkbox" checked> Only downloaded tracks</label></p><button class="btn primary" id="xmlExport">EXPORT REKORDBOX XML</button><p class="note">A valid absolute local audio path is required for every exported track. '+available.length+' records have a usable file path.</p></div><div class="panel"><h2>Library backup</h2><p>Save your catalog independently of your current browser.</p><div class="row"><button class="btn" id="backup">EXPORT JSON</button><button class="btn" id="csvExport">EXPORT CSV</button></div></div></div>'}
if(page==='settings'){html=head('PREFERENCES','Settings','Manage Beatport access and your local music library.')+
 '<div class="panel" style="max-width:850px"><h2>Connected services</h2><div class="listrow"><span><strong>Spotify</strong><br><small class="muted">No login required. Import your own Artist – Title lists or CSV files.</small></span><span class="pill">NOT REQUIRED</span></div><div class="listrow"><span><strong>Beatport</strong><br><small class="muted">'+(sessionStorage.getItem('beatport_server_verified')==='yes'?'Verified this session':'Not connected')+'</small></span><button class="btn" data-page="welcome">MANAGE CONNECTION</button></div><p class="note">Your tracks are currently stored in this browser only. No cross-device sync or Beatport cart automation.</p><hr style="border:0;border-top:1px solid #303839;margin:24px 0"><h2>Music library</h2><div class="row"><button class="btn" id="backup">EXPORT BACKUP</button><button class="btn" id="restoreBtn">IMPORT BACKUP</button></div><details class="advanced"><summary>Advanced developer settings</summary><div class="advanced-inside"><h2>MusicAPI connection</h2><label class="label">ACCOUNT SLUG (developer only)</label><input id="musicApiSlug" class="field" value="'+esc(state.settings.musicApiSlug||'tracky')+'"><div class="row gap"><button class="btn" id="saveMusicApiSlug">SAVE SLUG</button><button class="btn" id="verifyBeatportLogin">VERIFY SIGN-IN</button><button class="btn" id="startBeatportLogin">OPEN BEATPORT SIGN-IN</button></div><p class="note">Server credentials remain in Vercel environment variables. CRATEFLOW does not collect Beatport passwords.</p><div class="row"><button class="btn danger" id="clearAll">CLEAR LOCAL LIBRARY</button></div></div></details></div>'}

$('#view').innerHTML=html;bind()}
function nav(p){page=p;const url=new URL(location.href);if(p==='landing')url.searchParams.delete('app');else url.searchParams.set('app','1');history.replaceState({},'',url.pathname+url.search+url.hash);render()}
function download(filename,content,type){const b=new Blob([content],{type}),u=URL.createObjectURL(b),a=document.createElement('a');a.href=u;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(u),1000)}
function csvParse(input){
 const rows=[];let row=[],cell='',quoted=false;
 for(let i=0;i<input.length;i++){
  const c=input[i];
  if(quoted){
   if(c==='"'&&input[i+1]==='"'){cell+='"';i++}
   else if(c==='"')quoted=false;
   else cell+=c;
  }else if(c==='"')quoted=true;
  else if(c===','){row.push(cell);cell=''}
  else if(c==='\n'){row.push(cell.replace(/\r$/,''));rows.push(row);row=[];cell=''}
  else cell+=c;
 }
 row.push(cell);if(row.some(v=>v.trim()))rows.push(row);
 const headers=rows.shift()?.map(x=>x.trim().replace(/^\uFEFF/,'').toLowerCase())||[];
 const pick=(value,keys)=>keys.map(key=>value[key]||'').find(Boolean)||'';
 return rows.map(cols=>{
  const value=Object.fromEntries(headers.map((h,i)=>[h,String(cols[i]||'').trim()]));
  const title=pick(value,['title','track','track name','song','song title']);
  const artist=pick(value,['artist','artists','artist name']);
  return {title,artist,album:value.album||'',remix:value.remix||'',genre:value.genre||'',bpm:value.bpm||'',key:value.key||'',isrc:value.isrc||'',source:'CSV'};
 }).filter(x=>x.title&&x.artist);
}

function csvExport(){let headers=['title','artist','remix','bpm','key','genre','status','filePath'];download('crateflow-library.csv',[headers.join(','),...state.tracks.map(t=>headers.map(h=>'"'+String(t[h]??'').replace(/"/g,'""')+'"').join(','))].join('\n'),'text/csv')}
function fileUri(path){let p=String(path||'').trim().replace(/\\/g,'/');if(/^file:\/\//i.test(p))return p;if(!/^[A-Za-z]:\//.test(p)&&!p.startsWith('/'))return '';return 'file://localhost'+(p.startsWith('/')?'':'/')+p.split('/').map(encodeURIComponent).join('/').replace('%3A',':')}
function xmlEscape(s){return esc(s)}
function xmlExport(){let name=$('#exportName').value||'CRATEFLOW',tracks=state.tracks.filter(t=>fileUri(t.filePath)&&(!$('#downloadedOnly').checked||t.status==='downloaded'));if(!tracks.length){toast('No downloaded tracks with absolute file paths');return}let collection=tracks.map((t,i)=>'    <TRACK TrackID="'+(i+1)+'" Name="'+xmlEscape(t.title)+'" Artist="'+xmlEscape(t.artist)+'" Album="'+xmlEscape(t.album)+'" Genre="'+xmlEscape(t.genre)+'" Kind="MP3 File" AverageBpm="'+(Number(t.bpm)||0)+'" Tonality="'+xmlEscape(t.key)+'" Location="'+xmlEscape(fileUri(t.filePath))+'"/>').join('\n');let entries=tracks.map((_,i)=>'        <TRACK Key="'+(i+1)+'"/>').join('\n');download('crateflow-rekordbox.xml','<?xml version="1.0" encoding="UTF-8"?>\n<DJ_PLAYLISTS Version="1.0.0">\n  <PRODUCT Name="rekordbox" Version="7" Company="AlphaTheta"/>\n  <COLLECTION Entries="'+tracks.length+'">\n'+collection+'\n  </COLLECTION>\n  <PLAYLISTS>\n    <NODE Type="0" Name="ROOT" Count="1">\n      <NODE Name="'+xmlEscape(name)+'" Type="1" KeyType="0" Entries="'+tracks.length+'">\n'+entries+'\n      </NODE>\n    </NODE>\n  </PLAYLISTS>\n</DJ_PLAYLISTS>','application/xml');toast(tracks.length+' tracks exported')}
// The product imports user-supplied track names and artist names only.
// Spotify OAuth and Web API integration intentionally removed from this MVP.
function parsePaste(input){return globalThis.CrateflowClipboard.parse(input)}
async function importPasted(){
 const value=$('#pasteTracks')?.value||'';
 const result=await importTextRows(value,'Pasted tracks');
 if(!result.added){toast(result.message);return}
 if(result.message)toast(result.message);
 else nav('library');
}
function edit(t){const title=prompt('Track title',t.title);if(title===null)return;t.title=title.trim()||t.title;const artist=prompt('Artist',t.artist);if(artist===null)return;t.artist=artist.trim()||t.artist;const remix=prompt('Remix / Mix',t.remix||'');if(remix!==null)t.remix=remix;const bpm=prompt('BPM',t.bpm||'');if(bpm!==null)t.bpm=bpm;const key=prompt('Key',t.key||'');if(key!==null)t.key=key;const genre=prompt('Genre',t.genre||'');if(genre!==null)t.genre=genre;const status=prompt('Status: pending | cart | owned | downloaded',t.status);if(status&&['pending','cart','owned','downloaded'].includes(status.toLowerCase()))t.status=status.toLowerCase();const path=prompt('Absolute local audio file path',t.filePath||'');if(path!==null)t.filePath=path;persist();render()}
function bind(){const on=(sel,fn,event='click')=>{let e=$(sel);if(e)e.addEventListener(event,fn)};on('#landingBottomStart',()=>nav('import'));on('#landingLogin',()=>nav('import'));on('#landingPlaylistUrl',e=>{studioInput=e.target.value},'input');on('#landingImportForm',e=>{e.preventDefault();const text=$('#landingPlaylistUrl')?.value.trim();if(!text)return;studioInput=text;localStorage.setItem('crateflow_onboarded','yes');nav('import');studioImport()},'submit');on('#mixSource',e=>{mixSelectedId=e.target.value;render()},'change');on('#mixEnrich',async()=>{
 if(studioRunning)return;
 if(sessionStorage.getItem('beatport_server_verified')!=='yes')return toast('Connect Beatport before searching for DJ metadata');
 const pool=state.tracks.filter(t=>globalThis.CrateflowMix.bpmValue(t.bpm)===null||!globalThis.CrateflowMix.parseKey(t.key)).slice(0,10);
 if(!pool.length)return toast('No missing BPM or key');
 studioRunning=true;render();let enriched=0;
 try{
  for(const t of pool){
   const before=String(t.bpm)+'|'+String(t.key);
   try{await searchCatalogTrack(t);if(before!==String(t.bpm)+'|'+String(t.key))enriched++}
   catch(e){logSync(t,'DJ metadata lookup error',String(e.message||e).slice(0,120))}
   persist();
  }
 }finally{studioRunning=false;render();toast(enriched+' tracks enriched with available BPM/key metadata')}
});on('#studioPaste',v=>{studioInput=v.target.value},'input');on('#studioImport',studioImport);on('#studioSync',()=>studioSync());on('#studioShowAll',()=>{studioShowAll=true;render()});on('#studioSelectAll',studioToggleAll);on('#studioClose',()=>{studioModal='';render()});on('#studioCancel',()=>{studioModal='';render()});on('#studioInfo',()=>{studioInfoOpen=!studioInfoOpen;render()});on('#studioPlaylistTitle',e=>{studioPlaylistName=e.target.value},'input');on('#studioCreatePlaylist',exportToBeatportPlaylist);document.querySelectorAll('.compact-check').forEach(el=>el.addEventListener('change',()=>{const t=state.tracks.find(t=>t.id===el.dataset.id);if(t){t.studioSelected=el.checked;persist();render()}}));on('#studioExport',studioOpenPlaylistDialog);on('#studioUseExisting',()=>{studioInput='';render()});on('#studioExtended',v=>{state.settings.preferExtended=v.target.checked;refreshStoredMatches();persist();render()},'change');on('#finishOnboarding',()=>{localStorage.setItem('crateflow_onboarded','yes');nav('overview')});on('#onboardImport',()=>{localStorage.setItem('crateflow_onboarded','yes');nav('import')});on('#preferExtended',e=>{state.settings.preferExtended=e.target.checked;refreshStoredMatches();persist();render()},'change');on('#searchFirstMatch',()=>{let t=state.tracks.find(t=>!t.match?.url&&t.status==='pending');if(!t)return toast('No unmatched tracks');window.open(storeSearch(t),'_blank','noopener');logSync(t,'Search opened','Beatport search opened');render()});on('#catalogBatch',lookupQueue);on('#downloadHistory',()=>download('crateflow-sync-history.json',JSON.stringify(state.syncHistory,null,2),'application/json'));on('#saveMusicApiSlug',()=>{let v=($('#musicApiSlug')?.value||'').trim().toLowerCase();if(!/^[a-z0-9][a-z0-9-]{1,62}$/.test(v))return toast('Check MusicAPI account slug');state.settings.musicApiSlug=v;persist();toast('MusicAPI slug saved')});on('#verifyBeatportLogin',()=>verifyBeatportConnection());on('#startBeatportLogin',()=>{const slug='tracky';state.settings.musicApiSlug=slug;persist();sessionStorage.removeItem('beatport_server_verified');sessionStorage.removeItem('beatport_auth_attempt');sessionStorage.removeItem('beatport_claimed_user');sessionStorage.removeItem('beatport_callback_notice');const returnUrl=location.origin+'/';window.location.assign('https://app.musicapi.com/'+slug+'/beatport/auth?returnUrl='+encodeURIComponent(returnUrl))});on('#exportBeatportRequest',()=>{const request='Subject: Beatport API integration request for CRATEFLOW\\n\\nHello Beatport Partnerships Team,\\n\\nI am developing CRATEFLOW, a personal DJ music manager that imports Spotify playlist metadata, identifies corresponding Beatport releases and lets the account holder review candidates before purchase. I would like to ask about authorized API access and OAuth integration. Specifically, are track search, user purchase history and adding an approved track to the user\'s default shopping cart available to third-party partners? Are there licensing, commercial or technical requirements? Checkout and payment would remain on Beatport.com.\\n\\nWebsite: '+location.origin+'\\n\\nThank you.';navigator.clipboard.writeText(request.replaceAll('\\n','\\n')).then(()=>toast('API request copied')).catch(()=>toast('Clipboard permission denied'))});on('#importPasted',importPasted);on('#clearPasted',()=>{$('#pasteTracks').value=''});on('#uploadCsv',()=>$('#csv').click());on('#quickAdd',()=>{let title=$('#quickTitle').value,artist=$('#quickArtist').value;if(!title.trim())return toast('Title required');importTracks([{title,artist}],'Manual additions');nav('library')});on('#search',e=>{search=e.target.value;let pos=e.target.selectionStart;render();$('#search').focus();$('#search').setSelectionRange(pos,pos)},'input');on('#filter',e=>{filter=e.target.value;render()},'change');on('#playlistFilter',e=>{playlistFilter=e.target.value;render()},'change');on('#searchNext',()=>{let t=state.tracks.find(t=>t.status==='pending');if(t)window.open(beatport(t),'_blank','noopener');else toast('Nothing pending')});on('#copyQueue',()=>{navigator.clipboard.writeText(state.tracks.filter(t=>t.status==='pending').map(t=>t.artist+' – '+t.title).join('\n')).then(()=>toast('Copied'))});on('#beatportSite',()=>window.open('https://www.beatport.com','_blank','noopener'));on('#backup',()=>download('crateflow-backup.json',JSON.stringify(state,null,2),'application/json'));on('#restoreBtn',()=>$('#restore').click());on('#csvExport',csvExport);on('#xmlExport',xmlExport);on('#clearAll',()=>{if(confirm('Delete all local tracks and playlists?')){state=structuredClone(defaults);persist();render()}})}
document.addEventListener('click',e=>{let p=e.target.closest('[data-page]');if(p)return nav(p.dataset.page);let a=e.target.closest('[data-act]');if(!a)return;let t=state.tracks.find(t=>t.id===a.dataset.id);if(!t)return;if(a.dataset.act==='studioRetry')return studioSync([t.id]);if(a.dataset.act==='studioChange'){t.studioResult='review';t.studioCandidate=null;if(t.match?.source==='musicapi')delete t.match;persist();return render();}if(a.dataset.act==='studioChoose')return studioChoose(t,Number(a.dataset.index||0));if(a.dataset.act==='catalogLookup')return lookupMusicApi(t);if(a.dataset.act==='acceptCatalog')return applyCatalogCandidate(t,Number(a.dataset.index||0));if(['searchMatch','saveMatch','markCart','markUnmatched'].includes(a.dataset.act))return handleMatching(a.dataset.act,t);if(a.dataset.act==='beatport')window.open(beatport(t),'_blank','noopener');else if(a.dataset.act==='edit')edit(t);else if(a.dataset.act==='delete'&&confirm('Remove '+t.title+'?')){state.tracks=state.tracks.filter(x=>x.id!==t.id);persist();render()}});
$('#csv').addEventListener('change',async e=>{let file=e.target.files[0];if(!file)return;try{const rows=csvParse(await file.text());if(!rows.length){toast('CSV must include title and artist columns.');return}const added=importTracks(rows,file.name.replace(/\.csv$/i,''));nav('import');if(added&&sessionStorage.getItem('beatport_server_verified')==='yes')await studioSync()}catch(err){toast(err.message)}finally{e.target.value=''}});
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
refreshStoredMatches();render();inspectBeatportReturn();
