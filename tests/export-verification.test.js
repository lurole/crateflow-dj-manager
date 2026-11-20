import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import handler from '../api/export-beatport-playlist.js';
import { assertRegression } from './fixtures/known-regression.js';

const secret='test-secret-not-a-real-credential';
function cookie(){
 const session={uid:'00000000-0000-4000-8000-000000000000',exp:Math.floor(Date.now()/1000)+3600};
 const data=Buffer.from(JSON.stringify(session)).toString('base64url');
 const sig=crypto.createHmac('sha256',secret).update('crateflow-beatport-v1.'+data).digest('base64url');
 return 'cf_bp='+data+'.'+sig;
}
function upstreamResponse(status, body={}){
 return {ok:status>=200&&status<300,status,json:async()=>body};
}
async function simulate(readback,{respond,trackIds=['101']}={}){
 const previous={...process.env},originalFetch=globalThis.fetch;
 process.env.MUSICAPI_ENABLE_VERIFICATION='true';
 process.env.MUSICAPI_CLIENT_ID='test-id';
 process.env.MUSICAPI_CLIENT_SECRET=secret;
 const actions=[];
 globalThis.fetch=async(url,options={})=>{
  const endpoint=String(url),method=options.method||'GET';
  actions.push({endpoint,method});
  if(respond)return respond({endpoint,method,signal:options.signal});
  const result=method==='GET'?{results:[readback],nextParam:null}:
    endpoint.endsWith('/items')?{}:{id:'playlist-123'};
  return upstreamResponse(200,result);
 };
 const response={setHeader(){},status(code){this.code=code;return this},
  json(data){this.data=data;return this}};
 const request={method:'POST',headers:{host:'crateflow.test',
  origin:'https://crateflow.test',cookie:cookie()},
  body:{name:'Imported Music',trackIds,
   tracks:trackIds.map((id,index)=>({id,title:index?'Another Track':'Doa',artist:'Traumer',remix:'',isrc:''}))}};
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

const matchedTrack={id:'101',name:'Doa',artists:[{name:'Traumer'}],isAvailable:true};

function actionName({endpoint,method}){
 if(method==='GET')return 'read';
 return endpoint.endsWith('/items')?'add':'create';
}
function assertActions(actions,expected){
 assert.deepEqual(actions.map(actionName),expected);
}
function assertIncompleteResponse(response,stage,playlistId){
 assert.equal(response.code,502);
 assert.equal(response.data.ok,false);
 assert.equal(response.data.stage,stage);
 assert.equal(response.data.playlistId,playlistId);
 assert.notEqual(response.data.verified,true);
}
function waitForAbort(signal){
 return new Promise((_,reject)=>{
  signal.throwIfAborted();
  signal.addEventListener('abort',()=>reject(signal.reason),{once:true});
 });
}
function shortenExportTimers(t){
 const setTimeout=globalThis.setTimeout;
 t.mock.method(globalThis,'setTimeout',(callback,delay,...args)=>
  setTimeout(callback,Math.min(delay,10),...args));
}
function exportTimeout(t,timedOutAction){
 shortenExportTimers(t);
 return simulate(null,{respond:action=>
  actionName(action)===timedOutAction?waitForAbort(action.signal):
   upstreamResponse(200,{id:'playlist-123'})});
}

test('a failed create stops the export before append and read-back',async()=>{
 const {response,actions}=await simulate(null,{respond:()=>upstreamResponse(503)});
 assertIncompleteResponse(response,'create',undefined);
 assertActions(actions,['create']);
});

test('a rejected append retains the created playlist for reconciliation',async()=>{
 const {response,actions}=await simulate(null,{respond:action=>
  actionName(action)==='create'?upstreamResponse(200,{id:'playlist-123'}):upstreamResponse(503)});
 assertIncompleteResponse(response,'add','playlist-123');
 assertActions(actions,['create','add']);
});

test('a create timeout explicitly identifies an unverified write outcome',async t=>{
 const {response,actions}=await exportTimeout(t,'create');
 assertIncompleteResponse(response,'create',undefined);
 assertActions(actions,['create']);

 assertRegression(t,response.data.status,'unverified',{
  knownResult:undefined,
  reason:'A create timeout has no structured status for an unknown write outcome.',
 });
});

test('an append timeout identifies the append stage and the known playlist',async t=>{
 const {response,actions}=await exportTimeout(t,'add');
 assert.equal(response.code,502);
 assert.equal(response.data.ok,false);
 assert.equal(response.data.playlistId,'playlist-123');
 assert.notEqual(response.data.verified,true);
 assertActions(actions,['create','add']);

 assertRegression(t,response.data.stage,'add',{
  knownResult:'verify',
  reason:'The timeout handler labels every error after playlist creation as verification.',
 });
});

test('a read-back timeout retains the playlist ID without reporting verified success',async t=>{
 const {response,actions}=await exportTimeout(t,'read');
 assertIncompleteResponse(response,'verify','playlist-123');
 assertActions(actions,['create','add','read']);
});

test('unsuccessful read-back reports unverified items and retries only reading',async t=>{
 shortenExportTimers(t);
 const {response,actions}=await simulate(null,{respond:action=>
  actionName(action)==='read'?upstreamResponse(503):upstreamResponse(200,{id:'playlist-123'})});
 assert.equal(response.code,200);
 assert.equal(response.data.verified,false);
 assert.equal(response.data.playlistId,'playlist-123');
 assert.equal(response.data.added,0);
 assert.deepEqual(response.data.unverified,['101']);
 assertActions(actions,['create','add','read','read']);
});

test('partial read-back lists confirmed and missing items separately',async t=>{
 shortenExportTimers(t);
 const {response,actions}=await simulate(matchedTrack,{trackIds:['101','102']});
 assert.equal(response.code,200);
 assert.equal(response.data.playlistId,'playlist-123');
 assert.equal(response.data.requested,2);
 assert.equal(response.data.added,1);
 assert.deepEqual(response.data.confirmed,['101']);
 assert.deepEqual(response.data.missing,['102']);
 assertActions(actions,['create','add','read','read']);
});
