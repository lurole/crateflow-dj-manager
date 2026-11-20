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
  // Streaming services sometimes credit just the principal artist whereas Beatport
  // lists all credited collaborators. Compare complete artist identities, not
  // the whole joined credit string nor substrings (e.g. "Ann" vs "Anna").
  const splitArtists=(s,structured)=>{
    const value=Array.isArray(structured)&&structured.length?structured:String(s||"").split(/[,;]+|\s+(?:&|feat\.?|ft\.?|featuring|with|vs\.?)\s+/i);
    return [...new Set(value.map(v=>artistName(v)).filter(v=>v&&v!=="unknown artist"))];
  };
  const compareArtists=(track,candidate)=>{
    const input=splitArtists(track?.artist,track?.artistNames);
    const found=splitArtists(candidate?.artist,candidate?.artistNames);
    const allIncluded=Boolean(input.length&&found.length&&input.every(v=>found.includes(v)));
    const equal=allIncluded&&input.length===found.length;
    return {exact:equal,allIncluded,extra:allIncluded&&!equal,input,found};
  };
  const remixForms=["remix","rework","bootleg","vip"];
  const editions=["radio","extended","instrumental","acoustic","live","dub","club","remaster","original","edit"];
  const versionWords=new Set([...remixForms,...editions,"mix","version"]);
  const versionWord=word=>word==="remixed"?"remix":word==="remastered"?"remaster":word;
  const isVersion=s=>words(s).split(" ").some(word=>versionWords.has(versionWord(word)));
  const version=(forms=[],qualifiers=[],detail="")=>{
    const kind=forms.length?"remix":editions.find(marker=>qualifiers.includes(marker))||
      qualifiers[0]||"unspecified";
    return {kind,forms,qualifiers,detail,remixer:forms.length?detail:"",
      key:JSON.stringify([forms,qualifiers,detail])};
  };
  const ambiguousVersion={...version(),kind:"ambiguous"};
  const versionInfo=(s,explicit=false)=>{
    const text=words(s),parts=text.split(" ");
    const flags=[...new Set(parts.map(versionWord).filter(word=>versionWords.has(word)))];
    if(!flags.length)return explicit&&text&&text!=="unspecified"?version([],["version"],text):version();
    const forms=remixForms.filter(word=>flags.includes(word));
    const qualifiers=editions.filter(word=>flags.includes(word));
    if((qualifiers.includes("radio")&&qualifiers.includes("extended"))||
       (forms.length&&qualifiers.includes("original")))return ambiguousVersion;
    if(qualifiers.includes("radio")||qualifiers.includes("extended")){
      const edit=qualifiers.indexOf("edit");
      if(edit!==-1)qualifiers.splice(edit,1);
    }
    if(!forms.length&&!qualifiers.length)qualifiers.push(flags.includes("mix")?"mix":"version");
    const detail=parts.filter(word=>!versionWords.has(versionWord(word))).join(" ").trim();
    return version(forms,qualifiers,detail);
  };
  const sameOrMoreSpecific=(a,b)=>b.every(word=>a.includes(word));
  const combineVersions=(a,b)=>{
    if(a.kind==="ambiguous"||b.kind==="ambiguous")return ambiguousVersion;
    if(a.kind==="unspecified"||(a.kind==="mix"&&!a.detail))return b;
    if(b.kind==="unspecified"||(b.kind==="mix"&&!b.detail))return a;
    if(a.detail&&b.detail&&a.detail!==b.detail)return ambiguousVersion;
    if((a.forms.length||b.forms.length)&&(a.kind==="original"||b.kind==="original"))return ambiguousVersion;
    if(a.forms.length&&b.forms.length&&a.forms.join()!==b.forms.join())return ambiguousVersion;
    if(!sameOrMoreSpecific(a.qualifiers,b.qualifiers)&&!sameOrMoreSpecific(b.qualifiers,a.qualifiers))
      return ambiguousVersion;
    return version(a.forms.length?a.forms:b.forms,
      a.qualifiers.length>=b.qualifiers.length?a.qualifiers:b.qualifiers,a.detail||b.detail);
  };
  const dashSuffix=/\s[-–—]\s((?:(?!\s[-–—]\s).)+)$/;
  const descriptors=title=>{
    const text=String(title||"");
    const parenthetical=[...text.matchAll(/[\[(]([^\])]+)[\])]/g)].map(m=>m[1]).filter(isVersion);
    const dash=text.match(dashSuffix);
    if(dash&&isVersion(dash[1]))parenthetical.push(dash[1]);
    return parenthetical;
  };
  const titleCore=title=>{
    let text=String(title||"");
    text=text.replace(/[\[(]([^\])]+)[\])]/g,(whole,inner)=>
      isVersion(inner)||/^\s*(feat\.?|ft\.?|featuring)\b/i.test(inner)?" ":whole);
    text=text.replace(dashSuffix,(whole,inner)=>isVersion(inner)?" ":whole);
    text=text.replace(/\s+\b(feat\.?|ft\.?|featuring)\s+.+$/i,"");
    return words(text);
  };
  const resolveVersion=(title,hint)=>
    combineVersions(descriptors(title).map(label=>versionInfo(label)).reduce(combineVersions,version()),versionInfo(hint,true));
  const sourceVersion=t=>resolveVersion(t?.title,t?.remix);
  const candidateVersion=c=>{
    const parsed=resolveVersion(c?.name,c?.mixHint);
    if(parsed.kind!=="remix"||!Array.isArray(c?.remixerNames))return parsed;
    const credits=c.remixerNames.map(words).filter(Boolean);
    if(!credits.length)return parsed;
    if(parsed.remixer)
      return [credits.join(" and "),credits.join(" ")].includes(parsed.remixer)?parsed:ambiguousVersion;
    return version(parsed.forms,parsed.qualifiers,credits.join(" and "));
  };
  const versionMatch=(requested,found)=>{
    if(requested.kind==="ambiguous"||found.kind==="ambiguous")return false;
    if(requested.kind==="unspecified")
      return ["unspecified","original","extended"].includes(found.kind)&&
        found.qualifiers.length<=1&&!found.detail;
    if(requested.kind==="remix"&&(!requested.remixer||!found.remixer))return false;
    return requested.key===found.key;
  };
  const editionLabel={extended:"Extended Mix",original:"Original Mix",radio:"Radio Edit",instrumental:"Instrumental",
    acoustic:"Acoustic",live:"Live",dub:"Dub Mix",club:"Club Mix",edit:"Edit",remaster:"Remaster",
    mix:"Mix",version:"Version",unspecified:"Version unspecified",ambiguous:"Conflicting version information"};
  const versionLabel=v=>v.kind==="remix"?
    [v.remixer,...v.qualifiers,...v.forms].filter(Boolean).join(" "):
    [v.detail,...(v.qualifiers.length?v.qualifiers:[v.kind]).map(marker=>editionLabel[marker])].filter(Boolean).join(" ");
  const normalizeISRC=value=>{
    const code=String(value||"").replace(/[\s-]/g,"").toUpperCase();
    return /^[A-Z]{2}[A-Z0-9]{3}[0-9]{7}$/.test(code)?code:"";
  };
  const assess=(track,candidate,preferExtended=true)=>{
    const title=titleCore(track?.title),otherTitle=titleCore(candidate?.name);
    const artist=artistName(track?.artist),otherArtist=artistName(candidate?.artist);
    const artistComparison=compareArtists(track,candidate);
    const titleExact=Boolean(title&&title===otherTitle);
    const artistExact=artistComparison.allIncluded;
    const artistCreditsExact=artistComparison.exact;
    const req=sourceVersion(track),found=candidateVersion(candidate);
    const versionOK=versionMatch(req,found);
    const leftISRC=normalizeISRC(track?.isrc),rightISRC=normalizeISRC(candidate?.isrc);
    const isrcCompared=Boolean(leftISRC&&rightISRC);
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
    else if(!artistCreditsExact)reasons.push("Principal artist matches; Beatport has additional credits");
    if(!versionOK)reasons.push("Different mix/version");
    if(isrcConflict)reasons.push("ISRC differs");
    if(!candidate?.externalId)reasons.push("Beatport playlist ID unavailable");
    if(!reasons.length)reasons.push("Metadata aligns; verify release before purchase");
    const preferred=req.kind==="unspecified"?
      (preferExtended?found.kind==="extended":found.kind==="original"):false;
    const rank=score+(isrcMatch?7:0)+(preferred?3:0)+(candidate?.externalId?1:0);
    return {score,rank,autoEligible,titleExact,artistExact,artistCreditsExact,additionalArtistCredits:artistComparison.extra,versionOK,isrcMatch,isrcConflict,
      sourceVersion:versionLabel(req),candidateVersion:versionLabel(found),versionKind:found.kind,
      reason:reasons[0],reasons};
  };
  const rankCandidates=(track,candidates,preferExtended=true)=>(
    (Array.isArray(candidates)?candidates:[]).map(c=>({...c,assessment:assess(track,c,preferExtended)}))
      .map(c=>({...c,score:c.assessment.score}))
      .sort((a,b)=>b.assessment.rank-a.assessment.rank)
  );
  const bestAutomatic=(track,ranked,preferExtended=true)=>{
    const choices=(Array.isArray(ranked)?ranked:[]).filter(c=>c.assessment?.autoEligible);
    if(!choices.length)return null;
    // Highest metadata similarity first. Prefer the exact recording (ISRC) in ties.
    // The requested mix/version and both title and artist must match before auto-selection.
    const req=sourceVersion(track);
    const preferredKind=preferExtended?"extended":"original";
    const preferred=c=>req.kind==="unspecified"&&c.assessment.versionKind===preferredKind?1:0;
    const ordered=choices.slice().sort((a,b)=>{
      const x=a.assessment,y=b.assessment;
      return y.score-x.score || Number(y.isrcMatch)-Number(x.isrcMatch) ||
        preferred(b)-preferred(a) || y.rank-x.rank ||
        String(a.externalId).localeCompare(String(b.externalId));
    });
    const best=ordered[0];
    // Same song title/artist/mix can belong to distinct releases with different IDs.
    // Without an ISRC or meaningful version preference, arbitrarily choosing one
    // can silently import the wrong recording into the listener's playlist.
    const ambiguous=ordered.some(c=>String(c.externalId)!==String(best.externalId)&&
      c.score===best.score&&
      Boolean(c.assessment.isrcMatch)===Boolean(best.assessment.isrcMatch)&&
      preferred(c)===preferred(best));
    return ambiguous?null:best;
  };
  root.CrateflowMatching=Object.freeze({assess,rankCandidates,bestAutomatic,titleCore,
    sourceVersion,candidateVersion,versionLabel,normalizeISRC});
})(globalThis);
