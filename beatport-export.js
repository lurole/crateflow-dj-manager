/* Browser export journal. No provider credentials or automatic write retries. */
(function (root) {
  'use strict';

  const storageKey = 'crateflow_beatport_exports_v1';
  const lockName = 'crateflow-beatport-export';
  const unresolved = job => job && !job.reviewed && !['verified', 'failed'].includes(job.status);

  function create({ storage, locks, fetch, newId, wait, onChange = () => {} }) {
    function jobs() {
      const saved = JSON.parse(storage.getItem(storageKey) || '[]');
      if (!Array.isArray(saved)) throw Error('The local export history could not be read. Check Beatport before starting another export.');
      return saved;
    }

    function save(job) {
      const history = jobs().filter(item => item.exportId !== job.exportId);
      if (job.status === 'verified' || job.reviewed) job = { ...job, receipt: undefined };
      storage.setItem(storageKey, JSON.stringify([job, ...history].slice(0, 30)));
      onChange();
      return job;
    }

    async function exclusive(task) {
      if (!locks?.request) throw Error('Open CRATEFLOW in a browser with cross-tab lock support to export safely.');
      return locks.request(lockName, { ifAvailable: true }, lock => {
        if (!lock) throw Error('A Beatport export is already being handled in another tab.');
        return task();
      });
    }

    async function request(path, body) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 32_000);
      try {
        const response = await fetch(path, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body), signal: controller.signal,
        });
        return await response.json();
      } finally {
        clearTimeout(timeout);
      }
    }

    const emptyOutcomes = {
      added: 0, verified: false, confirmed: [], missing: [], mismatched: [], unavailable: [],
      unverified: [], availabilityUnknown: [], unexpected: 0, unknownCount: 0,
    };

    function issue(job, stage, reason, error) {
      return save({
        ...job, ...emptyOutcomes, status: 'unverified', stage, reason, error,
        unverified: job.localTracks.map(track => track.id),
        ...(stage !== 'verify' ? { writeIssue: { stage, reason, error } } : {}),
      });
    }

    async function dispatch(job, operation, stage, details = {}) {
      let data;
      try {
        data = await request('/api/export-beatport-playlist', { operation, exportId: job.exportId, ...details });
      } catch {
        return issue(job, stage, 'lost_response', 'The response was lost. Check Beatport before making another change.');
      }
      if (data?.status === 'failed' && data.stage === 'preflight') {
        // Only create preflight proves that this attempt never reached a write.
        if (operation === 'create') return save({ ...job, ...data });
        return issue(job, stage, data.reason, data.error);
      }
      if (data?.exportId !== job.exportId ||
          !['pending', 'created', 'appended', 'verified', 'partial', 'unverified'].includes(data.status))
        return issue(job, stage, 'invalid_response', 'The export status could not be read. Check Beatport before making another change.');
      if ((data.status === 'created' || (data.playlistId && !job.receipt)) &&
          (!data.playlistId || !data.receipt))
        return issue(job, stage, 'invalid_response', 'The playlist could not be identified safely. Review it in Beatport.');
      const saved = { ...job, ...emptyOutcomes, error: '', reason: '', warning: '', ...data };
      if (operation !== 'verify' && data.status === 'unverified')
        saved.writeIssue = { stage: data.stage, reason: data.reason, error: data.error };
      return save(saved);
    }

    function start(name, tracks, onProgress = () => {}) {
      return exclusive(async () => {
        const history = jobs();
        if (history.some(unresolved)) throw Error('Check or manually resolve the previous export before creating another playlist.');
        const intent = JSON.stringify([name.toLowerCase(), tracks.map(track => track.localId).sort()]);
        if (history.some(job => job.intent === intent && !job.reviewed && job.status !== 'failed'))
          throw Error('This selection and name were already exported. Use a different playlist name for a new export.');

        const exportId = newId(), proofs = [], musicApiIds = new Set(), localTracks = [];
        for (const track of tracks) {
          onProgress(proofs.length + 1, tracks.length);
          if (proofs.length) await wait(5200);
          const checked = await request('/api/search-beatport', {
            exportCheck: { exportId, source: track.source, selection: track.selection },
          });
          if (!checked?.ok || typeof checked.proof !== 'string' || typeof checked.id !== 'string')
            throw Error(track.label + ' · ' + (checked?.error || 'Could not verify this track.'));
          if (musicApiIds.has(checked.id))
            throw Error('Two selected songs resolve to the same Beatport track. Review the selection before exporting.');
          musicApiIds.add(checked.id);
          proofs.push(checked.proof);
          localTracks.push({ id: checked.id, localId: track.localId, label: track.label, source: track.source });
        }
        // Store the intent before each write. A lost response leaves an
        // unresolved job. Subsequent actions on this job can only read.
        let job = save({ exportId, intent, name, localTracks, requested: tracks.length,
          status: 'pending', stage: 'create', at: Date.now() });
        job = await dispatch(job, 'create', 'create', { name, proofs });
        if (job.status !== 'created') return job;
        job = save({ ...job, status: 'pending', stage: 'add' });
        job = await dispatch(job, 'append', 'add', { receipt: job.receipt });
        if (job.status !== 'appended') return job;
        return dispatch(job, 'verify', 'verify', { receipt: job.receipt });
      });
    }

    function check(exportId) {
      return exclusive(async () => {
        const job = jobs().find(item => item.exportId === exportId);
        if (!unresolved(job)) return job;
        return dispatch(job, 'verify', 'verify', { receipt: job.receipt });
      });
    }

    function acknowledge(exportId) {
      return exclusive(async () => {
        const job = jobs().find(item => item.exportId === exportId);
        if (unresolved(job)) return save({ ...job, reviewed: true });
        return job;
      });
    }

    return { latest: () => jobs()[0], start, check, acknowledge };
  }

  root.CrateflowBeatportExports = Object.freeze({ create, storageKey, unresolved });
})(globalThis);
