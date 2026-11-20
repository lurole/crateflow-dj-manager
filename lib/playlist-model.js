(function (root) {
  'use strict';

  function isLocalId(value) {
    return typeof value === 'string' && value.trim().length > 0;
  }

  function indexById(records) {
    const index = new Map();
    for (const record of records) {
      const id = record?.id;
      if (isLocalId(id)) index.set(id, index.has(id) ? null : record);
    }
    return index;
  }

  function savedTrackIds(playlist, legacyTrackIds) {
    // An explicit empty list overrides older per-track assignments.
    return Array.isArray(playlist.trackIds) ? playlist.trackIds : legacyTrackIds(playlist.id);
  }

  function trackIdsWithLegacyAssignment(tracks, playlistId) {
    return tracks.filter(track => track?.playlistId === playlistId).map(track => track.id);
  }

  function readMemberships(playlistId, trackIds, library, issues) {
    const memberships = [];
    const occurrenceCounts = new Map();
    for (const [position, libraryTrackId] of trackIds.entries()) {
      if (!library.get(libraryTrackId)) {
        issues?.push({
          type: library.has(libraryTrackId) ? 'ambiguous-track' : 'missing-track',
          playlistId, libraryTrackId, position,
        });
        continue;
      }
      const occurrence = occurrenceCounts.get(libraryTrackId) ?? 0;
      occurrenceCounts.set(libraryTrackId, occurrence + 1);
      memberships.push({
        key: JSON.stringify([playlistId, libraryTrackId, occurrence]),
        playlistId,
        libraryTrackId,
        position,
      });
    }
    return memberships;
  }

  // Read the browser snapshot without copying track metadata or changing its format.
  function readLocalPlaylistModel({ tracks, playlists }) {
    const library = indexById(tracks);
    const playlistsById = indexById(playlists);
    const legacyTrackIds = new Map();
    const model = { playlists: [], memberships: [], issues: [] };

    for (const track of tracks) {
      if (!isLocalId(track?.playlistId)) continue;
      const { playlistId, id: libraryTrackId } = track;
      if (!playlistsById.has(playlistId)) {
        model.issues.push({ type: 'missing-playlist', playlistId, libraryTrackId });
        continue;
      }
      if (!legacyTrackIds.has(playlistId)) legacyTrackIds.set(playlistId, []);
      legacyTrackIds.get(playlistId).push(libraryTrackId);
    }

    for (const [index, playlist] of playlists.entries()) {
      const playlistId = playlist?.id;
      if (!playlistsById.get(playlistId)) {
        model.issues.push({
          type: playlistsById.has(playlistId) ? 'ambiguous-playlist' : 'invalid-playlist-id',
          playlistId, index,
        });
        continue;
      }

      model.playlists.push({
        id: playlistId,
        name: playlist.name,
        folderId: null,
        spotifyPlaylistId: playlist.spotifyPlaylistId ?? null,
      });
      const trackIds = savedTrackIds(playlist, id => legacyTrackIds.get(id) ?? []);
      for (const entry of readMemberships(playlistId, trackIds, library, model.issues)) {
        model.memberships.push(entry);
      }
    }

    return model;
  }

  function tracksInPlaylist({ tracks, playlists }, playlistId) {
    const playlist = indexById(playlists).get(playlistId);
    if (!playlist) return [];
    const library = indexById(tracks);
    const trackIds = savedTrackIds(playlist, id => trackIdsWithLegacyAssignment(tracks, id));
    return readMemberships(playlistId, trackIds, library).map(entry => library.get(entry.libraryTrackId));
  }

  function findImportPlaylistIndex(playlists, name, spotifyPlaylistId) {
    return playlists.findIndex(playlist => spotifyPlaylistId
      ? playlist?.spotifyPlaylistId === spotifyPlaylistId
      : !playlist?.spotifyPlaylistId && playlist?.name === name);
  }

  function addImportedMemberships(playlist, tracks, incomingTrackIds, keepOccurrences) {
    const prior = savedTrackIds(playlist, id => trackIdsWithLegacyAssignment(tracks, id));
    const remaining = new Map();
    for (const id of prior) remaining.set(id, keepOccurrences ? (remaining.get(id) ?? 0) + 1 : 1);
    const added = incomingTrackIds.filter(id => {
      const count = remaining.get(id) ?? 0;
      if (keepOccurrences) remaining.set(id, Math.max(0, count - 1));
      else remaining.set(id, 1);
      return count === 0;
    });

    const trackIds = keepOccurrences ? [...prior, ...added] : [...added.reverse(), ...prior];
    return { playlist: { ...playlist, trackIds }, linked: added.length };
  }

  function removeTrackMemberships(playlists, libraryTrackId) {
    return playlists.map(playlist =>
      Array.isArray(playlist?.trackIds) && playlist.trackIds.includes(libraryTrackId)
        ? { ...playlist, trackIds: playlist.trackIds.filter(id => id !== libraryTrackId) }
        : playlist);
  }

  root.CrateflowPlaylistModel = Object.freeze({
    readLocalPlaylistModel, tracksInPlaylist, findImportPlaylistIndex, addImportedMemberships, removeTrackMemberships,
  });
})(globalThis);
