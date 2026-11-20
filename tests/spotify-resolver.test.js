import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/resolve-spotify-track.js';

const id='5KBUE75BEZMGmDnfW8y2gd';
const url='https://open.spotify.com/track/'+id;
const record={title:'Example Track (Extended Mix)',artist:'Example Artist',isrc:'USRC17607839',links:{spotify:url}};
function mockRes(){
 return {code:0,headers:{},body:null,setHeader(k,v){this.headers[k]=v;return this},
  status(v){this.code=v;return this},json(v){this.body=v;return this}};
}
function request({method='POST',body={id},origin='https://crateflow.test',ip='unit-test-ip'}={}){
 return {method,body,headers:{host:'crateflow.test',origin,'x-forwarded-for':ip}};
}
async function call(opts={}){
 const savedKey=process.env.MUSICLINK_API_KEY,flag=process.env.SPOTIFY_LINK_LOOKUP_ENABLED;
 const oldFetch=global.fetch;
 process.env.MUSICLINK_API_KEY=opts.key===false?'':'unit_test_key';
 process.env.SPOTIFY_LINK_LOOKUP_ENABLED=opts.enabled===false?'false':'true';
 let received=null;
 global.fetch=async(uri,init)=>{
  received={uri,init};
  return {ok:(opts.status||200)>=200&&(opts.status||200)<300,status:opts.status||200,
   json:async()=>opts.payload||{success:true,data:[record]}};
 };
 const res=mockRes();
 try{await handler(request(opts),res);return {res,received}}
 finally{
  global.fetch=oldFetch;
  if(savedKey===undefined)delete process.env.MUSICLINK_API_KEY;else process.env.MUSICLINK_API_KEY=savedKey;
  if(flag===undefined)delete process.env.SPOTIFY_LINK_LOOKUP_ENABLED;else process.env.SPOTIFY_LINK_LOOKUP_ENABLED=flag;
 }
}
test('resolves a verified Spotify ID and returns sanitized title, artist and ISRC',async()=>{
 const {res,received}=await call({ip:'resolved-test'});
 assert.equal(res.code,200);
 assert.equal(res.body.track.title,record.title);
 assert.equal(res.body.track.artist,record.artist);
 assert.equal(res.body.track.isrc,record.isrc);
 assert.equal(res.body.track.spotifyUrl,url);
 assert.equal(received.uri,'https://api.ml.jadquir.com/v1/lookup/spotify/'+id);
 assert.equal(received.init.headers.Authorization,'Bearer unit_test_key');
 assert.equal(JSON.stringify(res.body).includes('unit_test_key'),false);
});
test('no account tokens or Spotify OAuth are needed',async()=>{
 const {res}=await call({ip:'no-oauth'});
 assert.equal(res.code,200);
 assert.equal(res.body.track.source,'musiclink');
});
test('disabled endpoint never calls MusicLink',async()=>{
 const {res,received}=await call({enabled:false,ip:'disabled'});
 assert.equal(res.code,503);
 assert.equal(res.body.code,'not_configured');
 assert.equal(received,null);
});
test('missing API key yields explicit setup message',async()=>{
 const {res}=await call({key:false,ip:'missing-key'});
 assert.equal(res.code,503);
 assert.equal(res.body.code,'not_configured');
});
test('rejects invalid Spotify IDs before provider fetch',async()=>{
 const {res,received}=await call({body:{id:'not-a-track'},ip:'invalid-id'});
 assert.equal(res.code,400);
 assert.equal(received,null);
});
test('rejects cross-origin anonymous API calls',async()=>{
 const {res,received}=await call({origin:'https://bad-site.test',ip:'cross-origin'});
 assert.equal(res.code,403);
 assert.equal(received,null);
});
test('does not import metadata for a different Spotify ID',async()=>{
 const {res}=await call({payload:{success:true,data:[{...record,links:{spotify:'https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC'}}]},ip:'mismatch'});
 assert.equal(res.code,422);
 assert.equal(res.body.code,'ambiguous_match');
});
test('does not invent artists when the provider omits them',async()=>{
 const {res}=await call({payload:{success:true,data:[{...record,artist:''}]},ip:'no-artist'});
 assert.equal(res.code,422);
 assert.equal(res.body.code,'incomplete_metadata');
});
test('rejects ambiguous duplicated lookup records',async()=>{
 const {res}=await call({payload:{success:true,data:[record,record]},ip:'ambiguous'});
 assert.equal(res.code,422);
});
test('returns actionable rate-limit response from MusicLink',async()=>{
 const {res}=await call({status:429,ip:'provider-limit'});
 assert.equal(res.code,429);
 assert.equal(res.body.code,'provider_rate_limit');
});
test('a provider authentication failure does not reveal keys',async()=>{
 const {res}=await call({status:401,ip:'unauthorized'});
 assert.equal(res.code,503);
 assert.equal(res.body.code,'provider_authorization');
 assert.equal(JSON.stringify(res.body).includes('unit_test_key'),false);
});
test('returns public configuration status without exposing the key',async()=>{
 const {res,received}=await call({method:'GET',ip:'config-status'});
 assert.equal(res.code,200);
 assert.equal(res.body.enabled,true);
 assert.equal(received,null);
 assert.equal(JSON.stringify(res.body).includes('unit_test_key'),false);
});
test('accepts an exact Spotify URL with tracking parameters from provider',async()=>{
 const {res}=await call({payload:{success:true,data:[{...record,links:{spotify:url+'?si=abc&context=playlist'}}]},ip:'query-url'});
 assert.equal(res.code,200);
 assert.equal(res.body.track.spotifyId,id);
});
test('rejects empty or malformed provider payloads',async()=>{
 const {res}=await call({payload:{success:true,data:[{}]},ip:'empty-record'});
 assert.equal(res.code,422);
});
