/* Deterministic DJ mix compatibility. Uses supplied BPM and musical key only.
 * No fabricated audio analysis; incomplete metadata remains unknown. */
(function(root){
 "use strict";
 const camelotMinor=['G#m','D#m','A#m','Fm','Cm','Gm','Dm','Am','Em','Bm','F#m','C#m'];
 const camelotMajor=['B','F#','C#','G#','D#','A#','F','C','G','D','A','E'];
 const clean=s=>String(s??'').trim().replace(/♭/g,'b').replace(/♯/g,'#');
 const noteAlias={Db:'C#',Eb:'D#',Gb:'F#',Ab:'G#',Bb:'A#',Cb:'B',Fb:'E','E#':'F','B#':'C'};
 const parseKey=value=>{
  const raw=clean(value);
  const coded=raw.match(/^(1[0-2]|[1-9])\s*([AaBb])$/);
  if(coded)return Number(coded[1])+coded[2].toUpperCase();
  const m=raw.match(/^([A-Ga-g])([#b]?)(?:\s*)(major|maj|minor|min|m)?$/i);
  if(!m)return null;
  let note=m[1].toUpperCase()+m[2];
  note=noteAlias[note]||note;
  const kind=/^(minor|min|m)$/i.test(m[3]||'')?'A':'B';
  const index=(kind==='A'?camelotMinor:camelotMajor).findIndex(k=>k.replace(/m$/,'')===note);
  return index<0?null:String(index+1)+kind;
 };
 const bpmValue=value=>{
  if(value===null||value===undefined||String(value).trim()==='')return null;
  const n=Number(String(value).trim().replace(',','.'));
  return Number.isFinite(n)&&n>=40&&n<=240?n:null;
 };
 const harmonic=(a,b)=>{
  if(!a||!b)return null;
  const n=Number(a.slice(0,-1)),m=Number(b.slice(0,-1));
  const circle=Math.min((n-m+12)%12,(m-n+12)%12);
  if(a===b)return {score:100,label:'Same key'};
  if(n===m&&a.slice(-1)!==b.slice(-1))return {score:95,label:'Relative major/minor'};
  if(a.slice(-1)===b.slice(-1)&&circle===1)return {score:92,label:'Adjacent key'};
  return {score:0,label:'No standard harmonic match'};
 };
 const compare=(source,target)=>{
  const a=parseKey(source?.key),b=parseKey(target?.key);
  const pa=bpmValue(source?.bpm),pb=bpmValue(target?.bpm);
  const h=harmonic(a,b);
  // Tempo ratios 1/2 and 2 support half/double-time material.
  const delta=pa&&pb?Math.min(Math.abs(pb-pa)/pa,Math.abs(pb*2-pa)/pa,Math.abs(pb/2-pa)/pa)*100:null;
  const bpmScore=delta===null?null:delta<=2?100:delta<=4?90:delta<=6?75:delta<=10?50:20;
  const full=h!==null&&bpmScore!==null;
  return {keyA:a,keyB:b,bpmA:pa,bpmB:pb,keyScore:h?.score??null,keyReason:h?.label||'Key missing',
   bpmDifference:delta,bpmScore,score:full?Math.round(h.score*.65+bpmScore*.35):null,
   label:!full?'Missing BPM or key':h.score>=90&&delta<=6?'Excellent':h.score>=90&&delta<=10?'Good':'Review'};
 };
 const recommendations=(source,library)=> (library||[]).filter(t=>t.id!==source.id)
  .map(t=>({track:t,...compare(source,t)}))
  .sort((a,b)=>(b.score??-1)-(a.score??-1)||String(a.track.title).localeCompare(String(b.track.title)));
 root.CrateflowMix=Object.freeze({parseKey,bpmValue,compare,recommendations});
})(globalThis);
