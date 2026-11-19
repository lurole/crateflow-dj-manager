import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import handler from '../api/export-beatport-playlist.js';

const secret='test-secret-not-a-real-credential';
function cookie(){
 const session={uid:'00000000-0000-4000-8000-000000000000',exp:Math.floor(Date.now()/1000)+3600};
 const data=Buffer.from(JSON.stringify(session)).toString('base64url');
 const sig=crypto.createHmac('sha256',secret).update('crateflow-beatport-v1.'+data).digest('base64url');
 return 'cf_bp='+data+'.'+sig;
}
async function simulate(readback){
 const previous={...process.env},originalFetch=globalThis.fetch;
 process.env.MUSICAPI_ENABLE_VERIFICATION='true';
 process.env.MUSICAPI_CLIENT_ID='test-id';
 process.env.MUSICAPI_CLIENT_SECRET=secret;
 const actions=[];
 globalThis.fetch=async(url,options={})=>{
  const endpoint=String(url),method=options.method||'GET';
  actions.push({endpoint,method});
  const result=method==='GET'?{results:[readback],nextParam:null}:
    endpoint.endsWith('/items')?{}:{id:'playlist-123'};
  return {ok:true,status:200,json:async()=>result};
 };
 const response={setHeader(){},status(code){this.code=code;return this},
  json(data){this.data=data;return this}};
 const request={method:'POST',headers:{host:'crateflow-dj-manager.vercel.app',
  origin:'https://crateflow-dj-manager.vercel.app',cookie:cookie()},
  body:{name:'Imported Music',trackIds:['101'],
   tracks:[{id:'101',title:'Doa',artist:'Traumer',remix:'',isrc:''}]}};
 try{await handler(request,response);return {response,actions}}
 finally{
  globalThis.fetch=originalFetch;
  for(const key of ['MUSICAPI_ENABLE_VERIFICATION','MUSICAPI_CLIENT_ID','MUSICAPI_CLIENT_SECRET']){
   if(previous[key]===undefined)delete process.env[key];else process.env[key]=previous[key];
  }
 }
}
test('only an authentic matching Beatport playlist item is counted as verified',async()=>{
 const {response,actions}=await simulate({id:'101',name:'Doa',artists:[{name:'Traumer'},{name:'Anton'}],
  isrc:'',isAvailable:true});
 assert.equal(response.code,200);
 assert.equal(response.data.added,1);
 assert.deepEqual(response.data.confirmed,['101']);
 assert.equal(actions.filter(x=>x.method==='POST').length,2);
 assert.ok(actions.some(x=>x.method==='GET'));
});
test('successful append response does not hide an incorrect song title',async()=>{
 const {response}=await simulate({id:'101',name:'A Different Song',artists:[{name:'Traumer'}],
  isrc:'',isAvailable:true});
 assert.equal(response.data.added,0);
 assert.deepEqual(response.data.mismatched,['101']);
});
test('unavailable Beatport items are not counted as confirmed',async()=>{
 const {response}=await simulate({id:'101',name:'Doa',artists:[{name:'Traumer'}],
  isrc:'',isAvailable:false});
 assert.equal(response.data.added,0);
 assert.deepEqual(response.data.unavailable,['101']);
});
