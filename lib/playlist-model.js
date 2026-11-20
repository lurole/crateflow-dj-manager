(function (root) {
  'use strict';

  const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;

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

  function membershipRows(playlist, trackIds) {
    const saved = playlist.memberships;
    const paired = Array.isArray(saved) && saved.length === trackIds.length &&
      saved.every((entry, position) => typeof entry?.id === 'string' && uuid.test(entry.id) &&
        (entry.libraryTrackId === trackIds[position] ||
          (!isLocalId(entry.libraryTrackId) && !isLocalId(trackIds[position])))) &&
      new Set(saved.map(entry => entry.id.toLowerCase())).size === saved.length;
    return trackIds.map((libraryTrackId, position) => ({
      id: paired ? saved[position].id : 'legacy:' + JSON.stringify([playlist.id, position]),
      libraryTrackId,
    }));
  }

  function saveMemberships(playlist, rows, newId) {
    const memberships = rows.map(({ id, libraryTrackId }) => ({ id: uuid.test(id) ? id : newId(), libraryTrackId }));
    return { ...playlist, trackIds: memberships.map(row => row.libraryTrackId), memberships };
  }

  function entriesForPlaylist(playlist, tracks) {
    return membershipRows(playlist, savedTrackIds(playlist, id => trackIdsWithLegacyAssignment(tracks, id)));
  }

  function editorPlaylist({ tracks, playlists }, playlistId) {
    const playlist = indexById(playlists).get(playlistId);
    if (!playlist) return null;
    const library = indexById(tracks);
    const entries = entriesForPlaylist(playlist, tracks).map(row => ({ ...row, track: library.get(row.libraryTrackId) }));
    return { playlist, entries, library: Array.from(library.values()).filter(Boolean) };
  }

  function editPlaylist({ tracks, playlists }, playlistId, edit, newId) {
    const playlist = indexById(playlists).get(playlistId);
    if (!playlist) return null;
    const rows = entriesForPlaylist(playlist, tracks);
    const library = indexById(tracks);
    let position = rows.findIndex(row => row.id === edit.entryId);
    let editedTrackId;
    if (edit.type === 'add') {
      if (!library.get(edit.trackId)) return null;
      editedTrackId = edit.trackId;
      position = rows.length;
      rows.push({ libraryTrackId: editedTrackId });
    } else {
      if (position < 0) return null;
      editedTrackId = rows[position].libraryTrackId;
      if (edit.type === 'remove') {
        rows.splice(position, 1);
        position = Math.min(position, rows.length - 1);
      } else if (edit.type === 'move') {
        const target = rows.findIndex(row => row.id === edit.targetId);
        if (target < 0 || !['before', 'after'].includes(edit.side)) return null;
        const insertion = target + Number(edit.side === 'after');
        const nextPosition = insertion - Number(position < insertion);
        if (nextPosition === position) return null;
        const [row] = rows.splice(position, 1);
        rows.splice(nextPosition, 0, row);
        position = nextPosition;
      } else {
        return null;
      }
    }

    const nextPlaylist = saveMemberships(playlist, rows, newId);
    return {
      playlists: playlists.map(item => item === playlist ? nextPlaylist : item),
      entryId: nextPlaylist.memberships[position]?.id,
      title: library.get(editedTrackId)?.title || 'Unavailable track',
      position,
      count: rows.length,
    };
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
      for (const [position, row] of membershipRows(playlist, trackIds).entries()) {
        const { libraryTrackId } = row;
        if (library.get(libraryTrackId)) {
          model.memberships.push({ ...row, playlistId, position });
        } else {
          model.issues.push({
            type: library.has(libraryTrackId) ? 'ambiguous-track' : 'missing-track',
            playlistId, libraryTrackId, position,
          });
        }
      }
    }

    return model;
  }

  function tracksInPlaylist({ tracks, playlists }, playlistId) {
    const playlist = indexById(playlists).get(playlistId);
    if (!playlist) return [];
    const library = indexById(tracks);
    return savedTrackIds(playlist, id => trackIdsWithLegacyAssignment(tracks, id))
      .map(trackId => library.get(trackId)).filter(Boolean);
  }

  function findImportPlaylistIndex(playlists, name, spotifyPlaylistId) {
    return playlists.findIndex(playlist => spotifyPlaylistId
      ? playlist?.spotifyPlaylistId === spotifyPlaylistId
      : !playlist?.spotifyPlaylistId && playlist?.name === name);
  }

  function addImportedMemberships(playlist, tracks, incomingTrackIds, keepOccurrences, newId) {
    const prior = savedTrackIds(playlist, id => trackIdsWithLegacyAssignment(tracks, id));
    const remaining = new Map();
    for (const id of prior) remaining.set(id, keepOccurrences ? (remaining.get(id) ?? 0) + 1 : 1);
    const added = incomingTrackIds.filter(id => {
      const count = remaining.get(id) ?? 0;
      if (keepOccurrences) remaining.set(id, Math.max(0, count - 1));
      else remaining.set(id, 1);
      return count === 0;
    });

    if (!added.length) return { playlist: { ...playlist, trackIds: prior }, linked: 0 };
    const existingRows = membershipRows(playlist, prior);
    const newRows = added.map(libraryTrackId => ({ libraryTrackId }));
    const rows = keepOccurrences ? [...existingRows, ...newRows] : [...newRows.reverse(), ...existingRows];
    return { playlist: saveMemberships(playlist, rows, newId), linked: added.length };
  }

  function removeTrackMemberships(playlists, libraryTrackId, newId) {
    return playlists.map(playlist =>
      Array.isArray(playlist?.trackIds) && playlist.trackIds.includes(libraryTrackId)
        ? saveMemberships(playlist, membershipRows(playlist, playlist.trackIds)
          .filter(row => row.libraryTrackId !== libraryTrackId), newId)
        : playlist);
  }

  root.CrateflowPlaylistModel = Object.freeze({
    readLocalPlaylistModel, tracksInPlaylist, findImportPlaylistIndex, addImportedMemberships, removeTrackMemberships,
    editorPlaylist, editPlaylist,
  });
})(globalThis);
