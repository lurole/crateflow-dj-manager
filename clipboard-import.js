/* CRATEFLOW clipboard text importer.
 * No Spotify OAuth, scraping, URL unfurling, or third-party metadata fetching.
 * Links alone do not reveal both track title and artist, so never fake them.
 */
(function(root){
 "use strict";
 const norm=s=>String(s||"").toLowerCase().normalize("NFKD")
   .replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9]+/g," ").trim();
 const spotify=/(?:https?:\/\/(?:open\.)?spotify\.com\/(?:intl-[a-z]{2}\/)?(track|playlist)\/([A-Za-z0-9]{22})|spotify:(track|playlist):([A-Za-z0-9]{22}))/ig;
 const anyUrl=/\b(?:https?:\/\/|www\.|spotify:|spotify\.link\/)/i;
 function parse(input){
  const tracks=[],blockedLinks=[],missingArtist=[],seen=new Set();
  let duplicateCount=0;
  const rows=String(input||"").replace(/\r/g,"").split("\n");
  let csvMode=false;
  for(let raw of rows){
   let line=raw.trim();
   if(!line)continue;
   if(/^title\s*[,;\t]\s*artist\s*(?:[,;\t].*)?$/i.test(line)){csvMode=true;continue}
   // Spotify clipboard may contain several track links on one line.
   const links=[...line.matchAll(spotify)];
   if(links.length){
    for(const m of links){
     const kind=(m[1]||m[3]).toLowerCase(),id=m[2]||m[4];
     const key=kind+":"+id;
     if(seen.has("link:"+key)){duplicateCount++;continue}
     seen.add("link:"+key);
     blockedLinks.push({kind,id});
    }
    continue;
   }
   if(anyUrl.test(line)){
    if(!seen.has("url:"+line)){blockedLinks.push({kind:"unsupported",value:line.slice(0,140)});seen.add("url:"+line)}
    continue;
   }
   // An exported CSV can be pasted directly, not just uploaded.
   if(csvMode){
    const delim=line.includes("\t")?"\t":line.includes(";")?";":",";
    const cells=line.split(delim).map(v=>v.trim().replace(/^"|"$/g,""));
    line=(cells[0]||"")+"\t"+(cells[1]||"");
   }
   line=line.replace(/^\s*(?:[-•*]\s+|\d+[.)]\s+)/,"").trim();
   const columns=line.split(/\t+/).map(c=>c.trim()).filter(Boolean);
   let artist="",title="";
   if(columns.length>=2){title=columns[0];artist=columns[1]}
   else{
    const m=line.match(/^(.+?)\s+[–—-]\s+(.+)$/);
    if(m){artist=m[1].trim();title=m[2].trim()}
    else title=line;
   }
   if(!title)continue;
   if(!artist||/^unknown artist$/i.test(artist)){
    missingArtist.push(title.slice(0,180));
    continue;
   }
   if(title.length>250||artist.length>250){missingArtist.push(line.slice(0,140));continue}
   const key="track:"+norm(artist)+"|"+norm(title);
   if(seen.has(key)){duplicateCount++;continue}
   seen.add(key);tracks.push({title,artist,source:"pasted text"});
  }
  return {tracks,blockedLinks,missingArtist,duplicateCount};
 }
 root.CrateflowClipboard=Object.freeze({parse});
})(globalThis);
