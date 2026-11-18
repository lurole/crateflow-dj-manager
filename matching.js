/* CRATEFLOW Beatport matching — deterministic, browser + Node compatible.
 * Scores describe metadata similarity; they never prove purchase availability.
 * Automatically choose only an unambiguous title, artist and mix match.
 */
(function(root){
  "use strict";
  const words=s=>String(s??"").normalize("NFKD").replace(/[\u0300-\u036f]/g,"").toLowerCase()
    .replace(/&/g," and ").replace(/[’']/g,"").replace(/[^a-z0-9]+/g," ").trim().replace(/\s+/g," ");
  const tokens=s=>new Set(words(s).split(" ").filter(Boolean));
  const overlap=(a,b)=>{
    const A=tokens(a),B=tokens(b);
    if(!A.size||!B.size)return 0;
    return 2*[...A].filter(x=>B.has(x)).length/(A.size+B.size);
  };
  const artistName=s=>words(s).replace(/\b(and|feat|ft|featuring|with|vs)\b/g," ").replace(/\s+/g," ").trim();
  const isVersion=s=>/\b(original|extended|radio|club|dub|instrumental|acoustic|remix|remixed|rework|bootleg|vip|live|edit|mix|remaster|remastered|version)\b/i.test(s);
  const versionInfo=s=>{
    const text=words(s);
    if(!text||text==="unspecified")return {kind:"unspecified",remixer:""};
    if(/\b(remix|rework|bootleg|vip)\b/.test(text)){
      const remixer=text.replace(/\b(extended|radio|club|original|mix|edit|version|remix|rework|bootleg|vip|remastered|remaster)\b/g," ").replace(/\s+/g," ").trim();
      return {kind:"remix",remixer};
    }
    if(/\bradio\b/.test(text))return {kind:"radio",remixer:""};
    if(/\bextended\b/.test(text))return {kind:"extended",remixer:""};
    if(/\binstrumental\b/.test(text))return {kind:"instrumental",remixer:""};
    if(/\bacoustic\b/.test(text))return {kind:"acoustic",remixer:""};
    if(/\blive\b/.test(text))return {kind:"live",remixer:""};
    if(/\bdub\b/.test(text))return {kind:"dub",remixer:""};
    if(/\bclub\b/.test(text))return {kind:"club",remixer:""};
    if(/\b(remastered|remaster)\b/.test(text))return {kind:"remaster",remixer:""};
    if(/\boriginal\b/.test(text))return {kind:"original",remixer:""};
    if(/\bedit\b/.test(text))return {kind:"edit",remixer:""};
    if(/\bmix\b/.test(text))return {kind:"mix",remixer:""};
    return {kind:"unspecified",remixer:""};
  };
  const descriptors=title=>{
    const text=String(title||"");
    const parenthetical=[...text.matchAll(/[\[(]([^\])]+)[\])]/g)].map(m=>m[1]).filter(isVersion);
    const dash=text.match(/\s[-–—]\s([^–—]+)$/);
    if(dash&&isVersion(dash[1]))parenthetical.push(dash[1]);
    return parenthetical;
  };
  const titleCore=title=>{
    let text=String(title||"");
    text=text.replace(/[\[(]([^\])]+)[\])]/g,(whole,inner)=>
      isVersion(inner)||/^\s*(feat\.?|ft\.?|featuring)\b/i.test(inner)?" ":whole);
    text=text.replace(/\s[-–—]\s([^–—]+)$/,(whole,inner)=>isVersion(inner)?" ":whole);
    text=text.replace(/\s+\b(feat\.?|ft\.?|featuring)\s+.+$/i,"");
    return words(text);
  };
  const sourceVersion=t=>{
    const manual=String(t?.remix||"").trim();
    if(isVersion(manual))return versionInfo(manual);
    const extracted=descriptors(t?.title||"");
    return extracted.length?versionInfo(extracted[extracted.length-1]):{kind:"unspecified",remixer:""};
  };
  const candidateVersion=c=>{
    const extracted=descriptors(c?.name||"");
    // A named remix in the track title takes precedence over generic API mixHint.
    if(extracted.length)return versionInfo(extracted[extracted.length-1]);
    const hint=String(c?.mixHint||"");
    if(isVersion(hint))return versionInfo(hint);
    return {kind:"unspecified",remixer:""};
  };
  const versionMatch=(requested,found)=>{
    if(requested.kind==="unspecified")
      return ["unspecified","original","extended"].includes(found.kind);
    if(requested.kind!==found.kind)return false;
    if(requested.kind==="remix"&&requested.remixer)
      return requested.remixer===found.remixer;
    return true;
  };
  const versionLabel=v=>v.kind==="remix"?(v.remixer?v.remixer+" remix":"Remix"):
    ({extended:"Extended Mix",original:"Original Mix",radio:"Radio Edit",instrumental:"Instrumental",
      acoustic:"Acoustic",live:"Live",dub:"Dub Mix",club:"Club Mix",edit:"Edit",
      remaster:"Remaster",mix:"Mix",unspecified:"Version unspecified"}[v.kind]||"Version unspecified");
  const assess=(track,candidate,preferExtended=true)=>{
    const title=titleCore(track?.title),otherTitle=titleCore(candidate?.name);
    const artist=artistName(track?.artist),otherArtist=artistName(candidate?.artist);
    const titleExact=Boolean(title&&title===otherTitle);
    const artistExact=Boolean(artist&&artist!=="unknown artist"&&artist===otherArtist);
    const req=sourceVersion(track),found=candidateVersion(candidate);
    const versionOK=versionMatch(req,found);
    const leftISRC=String(track?.isrc||"").replace(/[^a-z0-9]/gi,"").toUpperCase();
    const rightISRC=String(candidate?.isrc||"").replace(/[^a-z0-9]/gi,"").toUpperCase();
    const isrcCompared=leftISRC.length===12&&rightISRC.length===12;
    const isrcConflict=isrcCompared&&leftISRC!==rightISRC;
    const isrcMatch=isrcCompared&&leftISRC===rightISRC;
    const titleSim=titleExact?1:overlap(title,otherTitle);
    const artistSim=artistExact?1:overlap(artist,otherArtist);
    const mixSim=versionOK?1:0;
    let score=Math.round(100*(.59*titleSim+.33*artistSim+.08*mixSim));
    if(!titleExact)score=Math.min(score,84);
    if(!artistExact)score=Math.min(score,86);
    if(!versionOK)score=Math.min(score,68);
    if(isrcConflict)score=Math.min(score,55);
    const autoEligible=Boolean(titleExact&&artistExact&&versionOK&&!isrcConflict&&candidate?.externalId);
    const reasons=[];
    if(!titleExact)reasons.push("Title differs");
    if(!artistExact)reasons.push("Artist differs");
    if(!versionOK)reasons.push("Different mix/version");
    if(isrcConflict)reasons.push("ISRC differs");
    if(!candidate?.externalId)reasons.push("Beatport playlist ID unavailable");
    if(!reasons.length)reasons.push("Metadata aligns; verify release before purchase");
    const preferred=req.kind==="unspecified"?
      (preferExtended?found.kind==="extended":found.kind==="original"):false;
    const rank=score+(isrcMatch?7:0)+(preferred?3:0)+(candidate?.externalId?1:0);
    return {score,rank,autoEligible,titleExact,artistExact,versionOK,isrcMatch,isrcConflict,
      sourceVersion:versionLabel(req),candidateVersion:versionLabel(found),versionKind:found.kind,
      reason:reasons[0],reasons};
  };
  const rankCandidates=(track,candidates,preferExtended=true)=>(
    (Array.isArray(candidates)?candidates:[]).map(c=>({...c,assessment:assess(track,c,preferExtended)}))
      .map(c=>({...c,score:c.assessment.score}))
      .sort((a,b)=>b.assessment.rank-a.assessment.rank)
  );
  const bestAutomatic=(track,ranked,preferExtended=true)=>{
    let choices=(Array.isArray(ranked)?ranked:[]).filter(c=>c.assessment?.autoEligible);
    if(!choices.length)return null;
    const requested=sourceVersion(track);
    if(requested.kind==="unspecified"){
      // Respect the DJ's extended preference, without treating remixes as interchangeable.
      const preferredKind=preferExtended?"extended":"original";
      if(choices.some(c=>c.assessment.versionKind===preferredKind))
        choices=choices.filter(c=>c.assessment.versionKind===preferredKind);
      else if(choices.some(c=>c.assessment.versionKind==="unspecified"))
        choices=choices.filter(c=>c.assessment.versionKind==="unspecified");
    }
    const ids=new Set(choices.map(c=>String(c.externalId)));
    // Two distinct Beatport releases with identical metadata require human review.
    if(ids.size!==1)return null;
    return choices[0];
  };
  root.CrateflowMatching=Object.freeze({assess,rankCandidates,bestAutomatic,titleCore,
    sourceVersion,candidateVersion,versionLabel});
})(globalThis);
