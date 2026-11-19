import test from 'node:test';
import assert from 'node:assert/strict';
import '../clipboard-import.js';

const parse=globalThis.CrateflowClipboard.parse;

test('accepts multiple Artist – Title lines without Spotify auth',()=>{
 const x=parse('Adriatique – Closer (Extended Mix)\nYotto - The One\nSasha — Involver');
 assert.deepEqual(x.tracks.map(t=>[t.artist,t.title]),[['Adriatique','Closer (Extended Mix)'],['Yotto','The One'],['Sasha','Involver']]);
 assert.equal(x.blockedLinks.length,0);
});
test('accepts title and artist columns pasted from a table',()=>{
 const x=parse('Closer (Extended Mix)\tAdriatique\nThe One\tYotto\tSome album');
 assert.equal(x.tracks.length,2);
 assert.equal(x.tracks[0].artist,'Adriatique');
});
test('accepts CSV rows with title,artist headers',()=>{
 const x=parse('title,artist\nCloser,Adriatique\nThe One,Yotto');
 assert.equal(x.tracks.length,2);
 assert.equal(x.tracks[1].artist,'Yotto');
});
test('does not invent track names from Spotify track URLs',()=>{
 const x=parse('https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC?si=abc');
 assert.equal(x.tracks.length,0);
 assert.equal(x.blockedLinks[0].kind,'track');
});
test('does not silently import a Spotify playlist link',()=>{
 const x=parse('https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M');
 assert.equal(x.tracks.length,0);
 assert.equal(x.blockedLinks[0].kind,'playlist');
});
test('accepts valid text while rejecting unsupported URLs in the same paste',()=>{
 const x=parse('Adriatique – Closer\nhttps://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC');
 assert.equal(x.tracks.length,1);
 assert.equal(x.blockedLinks.length,1);
});
test('does not invent an artist for title-only lines',()=>{
 const x=parse('Closer');
 assert.equal(x.tracks.length,0);
 assert.deepEqual(x.missingArtist,['Closer']);
});
test('deduplicates repeated tracks and duplicate Spotify links',()=>{
 const x=parse('Adriatique – Closer\nAdriatique – Closer\nspotify:track:4uLU6hMCjMI75M1A2tKUQC\nspotify:track:4uLU6hMCjMI75M1A2tKUQC');
 assert.equal(x.tracks.length,1);
 assert.equal(x.blockedLinks.length,1);
 assert.equal(x.duplicateCount,2);
});
test('does not treat a URL or unknown artist as a valid track',()=>{
 const x=parse('https://example.com/music\nTitle\tUnknown Artist');
 assert.equal(x.tracks.length,0);
 assert.equal(x.blockedLinks.length,1);
 assert.equal(x.missingArtist.length,1);
});
test('does not confuse radio, mix or remix titles with separate artists',()=>{
 const x=parse('Adriatique – Closer (Yotto Remix)');
 assert.equal(x.tracks[0].artist,'Adriatique');
 assert.equal(x.tracks[0].title,'Closer (Yotto Remix)');
});
