import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/search-beatport-primary.js';
function req(title='Doa',artist='Traumer'){
 return {method:'POST',headers:{host:'crateflow-dj-manager.vercel.app',
  origin:'https://crateflow-dj-manager.vercel.app', 'x-forwarded-for':'test-'+title+'-'+artist},
  body:{title,artist},socket:{remoteAddress:'local'}};
}
function response(){
 return {headers:{},setHeader(k,v){this.headers[k]=v},status(code){this.code=code;return this},
  json(value){this.data=value;return this}};
}
async function withStub(results,run){
 const prev=process.env.APISH_API_KEY,fetchWas=globalThis.fetch;
 process.env.APISH_API_KEY='mock-test-only';
 globalThis.fetch=async()=>({ok:true,status:200,json:async()=>({results,credits_used:1})});
 try{return await run()}finally{
  globalThis.fetch=fetchWas;
  if(prev===undefined)delete process.env.APISH_API_KEY;else process.env.APISH_API_KEY=prev;
 }
}
test('API.SH primary returns Beatport metadata in one request without claiming a playlist ID',async()=>{
 await withStub([{id:131,name:'Doa',artists:[{name:'Traumer'},{name:'Anton'}],
   bpm:124,camelot:'8A',genre:{name:'Tech House'},mix_name:'Original Mix',
   url:'https://www.beatport.com/track/doa/131'}],async()=>{
  const res=response();await handler(req('Doa','Traumer'),res);
  assert.equal(res.code,200);
  assert.equal(res.data.status,'matched');
  assert.equal(res.data.creditsUsed,1);
  assert.equal(res.data.candidates[0].bpm,124);
  assert.equal(res.data.candidates[0].key,'8A');
  assert.equal(res.data.candidates[0].genre,'Tech House');
  assert.equal(res.data.candidates[0].exportIdVerified,false);
  assert.equal(res.data.candidates[0].provider,'api.sh');
 });
});
test('a wrong artist is never treated as a safe match',async()=>{
 await withStub([{id:132,name:'Doa',artists:[{name:'Another Artist'}],
   bpm:124,camelot:'8A'}],async()=>{
  const res=response();await handler(req('Doa','Traumer'),res);
  assert.equal(res.code,200);assert.equal(res.data.status,'review');
 });
});
test('two indistinguishable releases are not automatically selected',async()=>{
 await withStub([131,132].map(id=>({id,name:'Doa',artists:[{name:'Traumer'}],
   bpm:124,camelot:'8A',mix_name:'Original Mix'})),async()=>{
  const res=response();await handler(req('Doa','Traumer'),res);
  assert.equal(res.code,200);assert.equal(res.data.status,'review');
 });
});
