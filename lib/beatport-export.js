import { createHmac, timingSafeEqual } from 'node:crypto';
import '../matching.js';

const matching = globalThis.CrateflowMatching;
export const uuidPattern = /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i;
export const itemIdPattern = /^[A-Za-z0-9_-]{1,80}$/;
const catalogIdPattern = /^\d{1,12}$/;
export const proofLifetime = 15 * 60_000;
export const trackProofLimit = 12_000;
export const appendLifetime = 5 * 60_000;
const receiptLifetime = 30 * 24 * 60 * 60_000;

function mac(secret, scope, payload) {
  return createHmac('sha256', secret).update(scope + '.' + payload).digest('base64url');
}

function readSigned(token, scope, secret, maxLength) {
  if (typeof token !== 'string' || token.length > maxLength) return null;
  const [encoded, signature, extra] = token.split('.');
  if (!encoded || !/^[A-Za-z0-9_-]{43}$/.test(signature || '') || extra !== undefined) return null;
  const expected = mac(secret, scope, encoded);
  if (!timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  try {
    return JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

export function beatportSession(headers, secret) {
  const cookie = String(headers.cookie || '').split(';').map(value => value.trim())
    .find(value => value.startsWith('cf_bp='))?.slice(6);
  const session = readSigned(cookie, 'crateflow-beatport-v1', secret, 1024);
  if (typeof session?.uid !== 'string' || !uuidPattern.test(session.uid) ||
      !Number.isInteger(session.exp) || session.exp <= Date.now() / 1000) return null;
  return session;
}

export function connectionKey(session, secret, host) {
  // A reconnect to the same integration user can read its own receipts.
  return mac(secret, 'crateflow-export-connection-v1', host + ':' + session.uid);
}

function seal(purpose, claims, context, lifetime) {
  const encoded = Buffer.from(JSON.stringify({
    ...claims, connection: context.connection, expiresAt: Date.now() + lifetime,
  })).toString('base64url');
  return encoded + '.' + mac(context.secret, 'crateflow-export-' + purpose + '-v1', encoded);
}

function open(purpose, token, context, exportId, maxLength) {
  const claims = readSigned(token, 'crateflow-export-' + purpose + '-v1', context.secret, maxLength);
  return claims?.connection === context.connection && claims.exportId === exportId &&
    Number.isFinite(claims.expiresAt) && claims.expiresAt > Date.now() ? claims : null;
}

export const signTrackProof = (context, exportId, track) =>
  seal('track', { exportId, track }, context, proofLifetime);
export const readTrackProof = (context, exportId, token) =>
  open('track', token, context, exportId, trackProofLimit)?.track;
export const signReceipt = (context, job) =>
  seal('playlist', job, context, receiptLifetime);
export const readReceipt = (context, exportId, token) =>
  open('playlist', token, context, exportId, 20 * trackProofLimit + 1024);

const textField = (value, max) => typeof value === 'string' && value.length <= max ? value.trim() : '';
const names = value => Array.isArray(value) ? value.slice(0, 15)
  .map(name => textField(typeof name === 'string' ? name : name?.name, 120)).filter(Boolean) : [];

export function exportSource(value) {
  const title = textField(value?.title, 230), artist = textField(value?.artist, 250);
  const isrc = matching.normalizeISRC(value?.isrc);
  if (!title || !artist || (value?.isrc && !isrc) ||
      (value?.remix && !textField(value.remix, 100))) return null;
  return { title, artist, remix: textField(value?.remix, 100), isrc };
}

export function beatportCatalogReference(track, url) {
  // Generic id, externalId and trackId are connected-service fields here.
  const explicit = [track?.beatportId, track?.beatportTrackId, track?.beatport_id]
    .map(value => String(value ?? '')).filter(value => catalogIdPattern.test(value));
  const urlId = /^https:\/\/(?:www\.)?beatport\.com\/track\/[^/?#]+\/(\d{1,12})(?:[/?#]|$)/i.exec(url || '')?.[1];
  if (urlId) explicit.push(urlId);
  if (!explicit.every(id => id === explicit[0])) return { beatportId: null, beatportIdConflict: true };
  return { beatportId: explicit[0] || null };
}

function candidateAsSource(candidate) {
  const resolved = matching.candidateVersion(candidate);
  // A structured remixer may be the only source of the full mix descriptor.
  const remix = resolved.kind === 'remix'
    ? [resolved.remixer, ...resolved.qualifiers, ...resolved.forms].filter(Boolean).join(' ')
    : candidate.mixHint;
  return {
    title: candidate.name, artist: candidate.artist, artistNames: candidate.artistNames,
    remix, isrc: candidate.isrc,
  };
}

function connectedBeatportVersion(candidate) {
  // In MusicAPI's connected Beatport API, non-original versions are included in the name.
  return matching.candidateVersion(candidate).kind === 'unspecified'
    ? { ...candidate, mixHint: 'Original Mix' } : candidate;
}

function normalizedSelection(value) {
  if (!['api.sh', 'musicapi'].includes(value?.provider) || value.beatportIdConflict) return null;
  const externalId = textField(value.externalId, 80);
  if (!itemIdPattern.test(externalId) || (value.isrc && !matching.normalizeISRC(value.isrc))) return null;
  const beatportId = value.provider === 'api.sh' && catalogIdPattern.test(String(value.beatportId ?? ''))
    ? String(value.beatportId) : null;
  if (value.provider === 'api.sh' && beatportId !== externalId) return null;
  const name = textField(value.name, 230), artist = textField(value.artist, 250);
  return {
    name, artist, externalId, beatportId, provider: value.provider,
    artistNames: names(value.artistNames), remixerNames: names(value.remixerNames),
    isrc: matching.normalizeISRC(value.isrc), mixHint: textField(value.mixHint, 100),
  };
}

export function verifiedExportTrack(source, selectionValue, candidates) {
  const submitted = normalizedSelection(selectionValue);
  if (!source || !submitted) return null;
  const selection = submitted.provider === 'musicapi' ? connectedBeatportVersion(submitted) : submitted;
  if (!matching.assess(source, selection).autoEligible) return null;
  const ranked = matching.rankCandidates(source, candidates.filter(candidate => itemIdPattern.test(candidate.externalId))
    .map(connectedBeatportVersion));
  const selectedSource = candidateAsSource(selection);
  const eligible = ranked.filter(candidate => {
    if (candidate.isAvailable === false || candidate.beatportIdConflict || !candidate.assessment.autoEligible ||
        !matching.assess(selectedSource, candidate).autoEligible ||
        ((source.isrc || selection.isrc) && !matching.normalizeISRC(candidate.isrc))) return false;
    // A browser preference cannot justify replacing an explicit release version.
    if (matching.candidateVersion(selection).key !== matching.candidateVersion(candidate).key) return false;
    const sameIsrc = selection.isrc && selection.isrc === matching.normalizeISRC(candidate.isrc);
    if (selection.provider === 'musicapi')
      return true;
    if (candidate.beatportId) return candidate.beatportId === selection.beatportId;
    return Boolean(sameIsrc);
  });
  // Check the entire eligible set, not just the row with the expected ID.
  // Conflicting provider records for that same ID also make it unsafe.
  const ids = new Set(eligible.map(item => item.externalId));
  if (ids.size !== 1) return null;
  const chosen = eligible[0];
  if (selection.provider === 'musicapi' && chosen.externalId !== selection.externalId) return null;
  if (ranked.some(item => item.externalId === chosen.externalId && !eligible.includes(item))) return null;
  return {
    id: chosen.externalId, source, identity: candidateAsSource(chosen),
    versionKey: matching.candidateVersion(chosen).key,
  };
}

export function readbackOutcomes(tracks, items) {
  const result = { confirmed: [], missing: [], mismatched: [], unverified: [], unavailable: [], availabilityUnknown: [] };
  const itemId = value => {
    const id = String(value?.id ?? '');
    return itemIdPattern.test(id) ? id : '';
  };
  const originalMix = matching.candidateVersion({ mixHint: 'Original Mix' }).key;
  const expected = new Set(tracks.map(track => track.id));
  const unexpected = items.reduce((count, item) => count + Number(Boolean(itemId(item) && !expected.has(itemId(item)))), 0);
  const unknownCount = items.filter(item => !itemId(item)).length;
  for (const track of tracks) {
    const exact = items.filter(item => itemId(item) === track.id);
    if (!exact.length) {
      result[unknownCount ? 'unverified' : 'missing'].push(track.id);
      continue;
    }
    const item = exact[0];
    const artists = names(item.artists);
    let candidate = {
      externalId: track.id, name: textField(item.name, 230), artist: artists.join(', '), artistNames: artists,
      mixHint: textField(item.mixName, 100), isrc: matching.normalizeISRC(item.isrc),
    };
    if (track.versionKey === originalMix) candidate = connectedBeatportVersion(candidate);
    const actualVersion = matching.candidateVersion(candidate);
    if (exact.length > 1 || !candidate.name || !artists.length || actualVersion.kind === 'ambiguous') {
      result.unverified.push(track.id);
      continue;
    }
    const original = matching.assess(track.source, candidate);
    const identity = matching.assess(track.identity, candidate);
    if ([original, identity].some(value => !value.titleExact || !value.artistExact || value.isrcConflict)) {
      result.mismatched.push(track.id);
      continue;
    }
    if (!original.versionOK || !identity.versionOK || actualVersion.key !== track.versionKey) {
      result[actualVersion.kind === 'unspecified' ? 'unverified' : 'mismatched'].push(track.id);
      continue;
    }
    if ((track.source.isrc || track.identity.isrc) && !candidate.isrc) {
      result.unverified.push(track.id);
      continue;
    }
    if (item.isAvailable === false) result.unavailable.push(track.id);
    else {
      result.confirmed.push(track.id);
      if (item.isAvailable !== true) result.availabilityUnknown.push(track.id);
    }
  }
  return { ...result, unexpected, unknownCount };
}
