function isLocalId(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function countLocalIds(records) {
  const counts = new Map();
  for (const record of records) {
    const id = record?.id;
    if (isLocalId(id)) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
}

// Read the browser snapshot without copying track metadata or changing its format.
export function readLocalPlaylistModel({ tracks, playlists }) {
  const trackCounts = countLocalIds(tracks);
  const playlistCounts = countLocalIds(playlists);
  const legacyTrackIds = new Map();
  const model = { playlists: [], memberships: [], issues: [] };

  for (const track of tracks) {
    if (!isLocalId(track?.playlistId)) continue;
    const { playlistId, id: libraryTrackId } = track;
    if (!playlistCounts.has(playlistId)) {
      model.issues.push({ type: 'missing-playlist', playlistId, libraryTrackId });
      continue;
    }
    if (!legacyTrackIds.has(playlistId)) legacyTrackIds.set(playlistId, []);
    legacyTrackIds.get(playlistId).push(libraryTrackId);
  }

  for (const [index, playlist] of playlists.entries()) {
    const playlistId = playlist?.id;
    const count = playlistCounts.get(playlistId);
    if (count !== 1) {
      model.issues.push({ type: count ? 'ambiguous-playlist' : 'invalid-playlist-id', playlistId, index });
      continue;
    }

    model.playlists.push({
      id: playlistId,
      name: playlist.name,
      folderId: null,
      spotifyPlaylistId: playlist.spotifyPlaylistId ?? null,
    });

    // An explicit empty list overrides older per-track assignments.
    const trackIds = Array.isArray(playlist.trackIds) ? playlist.trackIds : legacyTrackIds.get(playlistId) ?? [];
    const occurrenceCounts = new Map();
    for (const [position, libraryTrackId] of trackIds.entries()) {
      const count = trackCounts.get(libraryTrackId);
      if (count !== 1) {
        model.issues.push({ type: count ? 'ambiguous-track' : 'missing-track', playlistId, libraryTrackId, position });
        continue;
      }

      const occurrence = occurrenceCounts.get(libraryTrackId) ?? 0;
      occurrenceCounts.set(libraryTrackId, occurrence + 1);
      model.memberships.push({
        key: JSON.stringify([playlistId, libraryTrackId, occurrence]),
        playlistId,
        libraryTrackId,
        position,
      });
    }
  }

  return model;
}
