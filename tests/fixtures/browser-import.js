import { webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';

const appRoot = new URL('../../', import.meta.url);
const html = readFileSync(new URL('index.html', appRoot), 'utf8');
const scripts = Array.from(html.matchAll(/<script\b[^>]*\bsrc="\/([^"?]+)(?:\?[^"]*)?"[^>]*>/g), ([, name]) =>
  [name, readFileSync(new URL(name, appRoot), 'utf8')]);

export function createImportBrowser(fetch, savedState) {
  const storage = new Map();
  if (savedState) storage.set('crateflow_v1', JSON.stringify(savedState));
  const elements = new Map();
  const documentListeners = new Map();
  function getElement(selector) {
    if (!elements.has(selector)) {
      const listeners = new Map();
      elements.set(selector, {
        addEventListener(type, callback) { listeners.set(type, callback); },
        dispatch(type, event) { return listeners.get(type)(event); },
        classList: { add() {}, remove() {}, toggle() {} },
      });
    }
    return elements.get(selector);
  }

  const location = new URL('https://crateflow.test/?app=1');
  const context = createContext({
    crypto: webcrypto,
    URL,
    URLSearchParams,
    location,
    structuredClone,
    confirm: () => true,
    localStorage: {
      getItem: key => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
    },
    sessionStorage: { getItem: () => null },
    document: {
      body: getElement('body'),
      querySelector: getElement,
      querySelectorAll: () => [],
      addEventListener(type, callback) { documentListeners.set(type, callback); },
    },
    // Advance the import throttle without waiting in real time.
    setTimeout: callback => queueMicrotask(callback),
    clearTimeout() {},
    fetch,
  });

  for (const [filename, source] of scripts) {
    runInContext(source, context, { filename });
  }

  return {
    importText: input => context.importTextRows(input),
    snapshot: () => JSON.parse(storage.get('crateflow_v1')),
    restoreBackup: snapshot => getElement('#restore').dispatch('change', {
      target: { files: [{ text: async () => JSON.stringify(snapshot) }] },
    }),
    deleteTrack: id => documentListeners.get('click')({
      target: { closest: selector => selector === '[data-act]' ? { dataset: { act: 'delete', id } } : null },
    }),
    visiblePlaylist: runInContext('id => { playlistFilter = id; return visible(); }', context),
    checkMatch: context.studioMatchResult,
    searchCatalog: context.searchCatalogTrack,
  };
}
