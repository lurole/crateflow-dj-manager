(function (root) {
  'use strict';

  const statuses = new Set(['pending', 'cart', 'owned', 'downloaded']);
  const text = value => typeof value === 'string' && !/\p{Cs}/u.test(value);
  const textList = value => Array.isArray(value) && value.every(text);
  const nonemptyText = value => text(value) && value.trim().length > 0;
  const id = value => nonemptyText(value) && !/\p{Cc}/u.test(value);
  const record = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  const numberOrText = value => Number.isFinite(value) || text(value);

  function requireValue(valid, field, expected) {
    if (!valid) throw new Error('Invalid backup. ' + field + ' ' + expected + '.');
  }

  function optionalFields(entry, path, fields, valid, expected) {
    for (const field of fields) {
      if (entry[field] != null) requireValue(valid(entry[field]), path + ' ' + field, expected);
    }
  }

  function validateRows(rows, label, validate) {
    requireValue(Array.isArray(rows), label, 'must be a list');
    rows.forEach((row, index) => {
      const path = label + ' ' + (index + 1);
      requireValue(record(row), path, 'must be an object');
      validate(row, path);
    });
  }

  function validateCandidate(candidate, path) {
    requireValue(record(candidate), path, 'must be an object');
    optionalFields(candidate, path,
      ['name', 'title', 'artist', 'mixHint', 'mixName', 'remix', 'url', 'provider', 'isrc', 'key', 'genre'], text, 'must be text');
    optionalFields(candidate, path, ['id', 'externalId', 'beatportId', 'bpm', 'score'], numberOrText, 'must be a number or text');
    optionalFields(candidate, path, ['artistNames', 'remixerNames'], textList, 'must be a list of text values');
    optionalFields(candidate, path, ['assessment'], record, 'must be an object');
  }

  function validateCatalog(entry, path) {
    requireValue(record(entry), path, 'must be an object');
    optionalFields(entry, path, ['status', 'provider', 'error'], text, 'must be text');
    optionalFields(entry, path, ['checkedAt', 'cachedAt'], numberOrText, 'must be a number or text');
    if (entry.candidates != null) validateRows(entry.candidates, path + ' candidate', validateCandidate);
  }

  function validateTrack(track, path) {
    requireValue(id(track.id), path + ' ID', 'must be non-empty text without control characters');
    requireValue(nonemptyText(track.title), path + ' title', 'must be non-empty text');
    requireValue(statuses.has(track.status), path + ' status', 'must be pending, cart, owned or downloaded');
    optionalFields(track, path, ['artist', 'remix', 'album', 'genre', 'key', 'filePath', 'source', 'isrc', 'spotifyId', 'spotifyUrl',
      'importTitle', 'importArtist', 'importRemix', 'studioResult', 'studioError', 'titleSource', 'bpmSource', 'keySource', 'genreSource'], text, 'must be text');
    optionalFields(track, path, ['playlistId'], value => value === '' || id(value), 'must be a valid playlist ID');
    optionalFields(track, path, ['artistNames'], textList, 'must be a list of text values');
    optionalFields(track, path, ['bpm', 'date', 'durationMs', 'beatportPlaylistId'], numberOrText, 'must be a number or text');
    optionalFields(track, path, ['studioSelected', 'beatportPlaylistExported', 'beatportPlaylistVerified'],
      value => typeof value === 'boolean', 'must be true or false');
    optionalFields(track, path, ['match', 'beatportExportIssue', 'djEnrichment', 'exportMapping'], record, 'must be an object');
    if (track.match != null) validateCandidate(track.match, path + ' match');
    if (track.studioCandidate != null) validateCandidate(track.studioCandidate, path + ' selected candidate');
    if (track.catalog != null) validateCatalog(track.catalog, path + ' catalog');
  }

  function validatePlaylist(playlist, path) {
    requireValue(id(playlist.id) && playlist.id !== 'all', path + ' ID', 'must be a valid playlist ID');
    requireValue(nonemptyText(playlist.name), path + ' name', 'must be non-empty text');
    optionalFields(playlist, path, ['spotifyPlaylistId'], text, 'must be text');
    if (playlist.trackIds != null) {
      requireValue(Array.isArray(playlist.trackIds) && playlist.trackIds.every(id), path + ' track IDs', 'must be a list of valid track IDs');
    }
    if (playlist.memberships != null) {
      validateRows(playlist.memberships, path + ' membership', (entry, field) => {
        requireValue(id(entry.id) && id(entry.libraryTrackId), field, 'must have an entry ID and a library track ID');
      });
    }
  }

  function parse(source) {
    let backup;
    try { backup = JSON.parse(source); }
    catch { throw new Error('Invalid backup. Choose a CRATEFLOW JSON backup file.'); }

    requireValue(record(backup), 'The backup', 'must be a JSON object');
    validateRows(backup.tracks, 'Track', validateTrack);
    validateRows(backup.playlists, 'Playlist', validatePlaylist);
    requireValue(new Set(backup.tracks.map(track => track.id)).size === backup.tracks.length,
      'Track IDs', 'must be unique in the library');
    requireValue(new Set(backup.playlists.map(playlist => playlist.id)).size === backup.playlists.length,
      'Playlist IDs', 'must be unique');

    if (backup.settings != null) {
      requireValue(record(backup.settings), 'Settings', 'must be an object');
      optionalFields(backup.settings, 'Settings', ['preferExtended'], v => typeof v === 'boolean', 'must be true or false');
      optionalFields(backup.settings, 'Settings', ['musicApiSlug'], text, 'must be text');
    }
    if (backup.syncHistory != null) {
      validateRows(backup.syncHistory, 'History entry', (entry, path) => {
        optionalFields(entry, path, ['id', 'trackId', 'title', 'artist', 'action', 'details'], text, 'must be text');
        optionalFields(entry, path, ['time'], numberOrText, 'must be a number or text');
      });
    }
    if (backup.catalogCache != null) {
      requireValue(record(backup.catalogCache), 'Catalog cache', 'must be an object');
      Object.values(backup.catalogCache).forEach((entry, index) => validateCatalog(entry, 'Catalog cache entry ' + (index + 1)));
    }
    return { ...backup, settings: backup.settings ?? {}, syncHistory: backup.syncHistory ?? [] };
  }

  root.CrateflowLibraryBackup = Object.freeze({ parse });
})(globalThis);
