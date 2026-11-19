import test from 'node:test';
import assert from 'node:assert/strict';
import '../matching.js';

const matching=globalThis.CrateflowMatching;
const track=(title,artist='Adriatique',extra={})=>({title,artist,...extra});
const candidate=(name,artist='Adriatique',externalId='987',extra={})=>({name,artist,externalId,...extra});
const matches=(song,items,preferExtended=true)=>matching.rankCandidates(song,items,preferExtended);

test('identical title, artist and original version is auto-matchable',()=>{
 const t=track('Closer (Original Mix)');
 const [c]=matches(t,[candidate('Closer (Original Mix)')]);
 assert.equal(c.assessment.score,100);
 assert.equal(c.assessment.autoEligible,true);
 assert.equal(matching.bestAutomatic(t,[c]),c);
});

test('radio edit is not silently accepted for an extended mix',()=>{
 const [c]=matches(track('Closer (Extended Mix)'),[candidate('Closer (Radio Edit)')]);
 assert.equal(c.assessment.autoEligible,false);
 assert.equal(c.assessment.versionOK,false);
 assert.ok(c.assessment.score<=68);
});

test('named remixes must match their actual remixer',()=>{
 const t=track('Closer (Yotto Remix)');
 const ranked=matches(t,[candidate('Closer (Sasha Remix)','Adriatique','1'),candidate('Closer (Yotto Remix)','Adriatique','2')]);
 const wrong=ranked.find(c=>c.externalId==='1'),correct=ranked.find(c=>c.externalId==='2');
 assert.equal(correct.assessment.autoEligible,true);
 assert.equal(wrong.assessment.autoEligible,false);
 assert.equal(matching.bestAutomatic(t,ranked).externalId,'2');
});

test('separately specified desired remix is respected',()=>{
 const t=track('Closer','Adriatique',{remix:'Yotto Remix'});
 const [c]=matches(t,[candidate('Closer (Sasha Remix)')]);
 assert.equal(c.assessment.autoEligible,false);
});

test('different artist cannot be auto-confirmed even for identical title',()=>{
 const [c]=matches(track('Closer'),[candidate('Closer','Yotto')]);
 assert.equal(c.assessment.autoEligible,false);
 assert.ok(c.assessment.score<=86);
});

test('unknown input artist is not an exact match',()=>{
 const [c]=matches(track('Closer','Unknown Artist'),[candidate('Closer','Unknown Artist')]);
 assert.equal(c.assessment.autoEligible,false);
});

test('ISRC disagreement requires review even for otherwise exact metadata',()=>{
 const t=track('Closer (Original Mix)','Adriatique',{isrc:'USABC1234567'});
 const [c]=matches(t,[candidate('Closer (Original Mix)','Adriatique','23',{isrc:'USABC7654321'})]);
 assert.equal(c.assessment.isrcConflict,true);
 assert.equal(c.assessment.autoEligible,false);
 assert.ok(c.assessment.score<=55);
});

test('matching ISRC contributes to ranking',()=>{
 const t=track('Closer','Adriatique',{isrc:'USABC1234567'});
 const candidates=matches(t,[candidate('Closer','Adriatique','1',{isrc:'USABC1234567'}),candidate('Closer','Adriatique','2')]);
 assert.equal(candidates[0].externalId,'1');
 assert.equal(candidates[0].assessment.isrcMatch,true);
});

test('multiple indistinguishable Beatport releases require review, not an arbitrary ID',()=>{
 const t=track('Closer (Original Mix)');
 const candidates=matches(t,[candidate('Closer (Original Mix)','Adriatique','102'),candidate('Closer (Original Mix)','Adriatique','101')]);
 assert.equal(matching.bestAutomatic(t,candidates),null);
});

test('same metadata score prefers matching ISRC over a different release',()=>{
 const t=track('Closer','Adriatique',{isrc:'USABC1234567'});
 const candidates=matches(t,[candidate('Closer','Adriatique','2'),candidate('Closer','Adriatique','1',{isrc:'USABC1234567'})]);
 assert.equal(matching.bestAutomatic(t,candidates).externalId,'1');
});

test('same candidate ID repeated is not falsely ambiguous',()=>{
 const t=track('Closer (Original Mix)');
 const candidates=matches(t,[candidate('Closer (Original Mix)','Adriatique','101'),candidate('Closer (Original Mix)','Adriatique','101')]);
 assert.equal(matching.bestAutomatic(t,candidates).externalId,'101');
});

test('Beatport ID is necessary before automatically selecting for playlist export',()=>{
 const t=track('Closer (Original Mix)');
 const candidates=matches(t,[candidate('Closer (Original Mix)','Adriatique','')]);
 assert.equal(candidates[0].assessment.autoEligible,false);
 assert.equal(matching.bestAutomatic(t,candidates),null);
});

test('extended mixes are preferred when no mix was specified',()=>{
 const t=track('Closer');
 const candidates=matches(t,[candidate('Closer (Original Mix)','Adriatique','1'),candidate('Closer (Extended Mix)','Adriatique','2')],true);
 assert.equal(matching.bestAutomatic(t,candidates,true).externalId,'2');
 assert.equal(matching.bestAutomatic(t,candidates,false).externalId,'1');
});

test('unknown version must not substitute for explicitly requested extended mix',()=>{
 const t=track('Closer (Extended Mix)');
 const candidates=matches(t,[candidate('Closer')]);
 assert.equal(matching.bestAutomatic(t,candidates),null);
});

test('candidate remix metadata is recognized when title has no suffix',()=>{
 const t=track('Closer (Yotto Remix)');
 const candidates=matches(t,[candidate('Closer','Adriatique','12',{mixHint:'Yotto Remix'})]);
 assert.equal(candidates[0].assessment.autoEligible,true);
});

test('feat markers and diacritics are normalized when matching titles',()=>{
 const t=track('Été (feat. Sam) (Extended Mix)','WhoMadeWho');
 const candidates=matches(t,[candidate('Ete (Extended Mix)','Whomadewho')]);
 assert.equal(candidates[0].assessment.titleExact,true);
 assert.equal(candidates[0].assessment.autoEligible,true);
});

test('generic remixes are never automatically substituted for an unspecified source',()=>{
 const t=track('Closer');
 const candidates=matches(t,[candidate('Closer (Sasha Remix)')]);
 assert.equal(matching.bestAutomatic(t,candidates),null);
});

test('additional Beatport collaborators do not penalize the original credited artist',()=>{
 const source=track('Doa','Traumer');
 const result=matches(source,[candidate('Doa','Traumer, Anton, antraum','121')])[0];
 assert.equal(result.score,100);
 assert.equal(result.assessment.autoEligible,true);
 assert.equal(result.assessment.additionalArtistCredits,true);
 assert.equal(matching.bestAutomatic(source,[result]).externalId,'121');
});

test('different or similarly named artists still require manual review',()=>{
 const source=track('Doa','Traumer');
 const result=matches(source,[candidate('Doa','Traumermusic, Anton, antraum','122')])[0];
 assert.equal(result.assessment.autoEligible,false);
 assert.equal(matching.bestAutomatic(source,[result]),null);
});

test('matching an extra-credits release still refuses an explicitly wrong remix',()=>{
 const source=track('Doa (Original Mix)','Traumer');
 const result=matches(source,[candidate('Doa (Radio Edit)','Traumer, Anton, antraum','123')])[0];
 assert.equal(result.assessment.autoEligible,false);
});
