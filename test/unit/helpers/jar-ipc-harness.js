'use strict';

const { registerJarIpc } = require('../../../src/main/jar-ipc');
const { origin } = require('../../../src/main/jar-data-helpers');
// Required once for the file: cache-busting this singleton while jars.js holds
// its own reference would recreate the store-order hazard this harness avoids.
const appDb = require('../../../src/main/app-db');

const personal = {
  id: 'personal',
  name: 'Personal',
  color: '#4caf50',
  partition: 'persist:container:personal'
};
const work = { id: 'work', name: 'Work', color: '#2196f3', partition: 'persist:container:work' };

// Retention sweeps are deliberately fire-and-forget. One macrotask drains the
// already-resolved fake session calls used by the focused tests.
function flush() {
  return new Promise((resolve) => setImmediate(resolve));
}

function freshStore() {
  const resolved = require.resolve('../../../src/main/jars');
  delete require.cache[resolved];
  return require('../../../src/main/jars');
}

function makeFakeHistoryStore({ throws = {} } = {}) {
  /** @type {Map<string, Array<{ url?: string, visitedAt: number }>>} */
  const data = new Map();
  /** @type {string[]} */
  const calls = [];

  function rows(jarId) {
    if (!data.has(jarId)) data.set(jarId, []);
    return data.get(jarId);
  }

  return {
    calls,
    seed(jarId, visitedAt = 1) {
      rows(jarId).push({ visitedAt });
    },
    seedVisit(jarId, url, visitedAt = 1) {
      rows(jarId).push({ url, visitedAt });
    },
    count(jarId) {
      return rows(jarId).length;
    },
    clearJar(jarId) {
      if (throws.clearJar) throw new Error('history store blew up');
      const n = rows(jarId).length;
      data.set(jarId, []);
      return n;
    },
    pruneOneJar(jarId, days, now) {
      calls.push('pruneOneJar');
      if (throws.pruneOneJar) throw new Error('history store blew up');
      const cutoff = now - days * 86_400_000;
      const before = rows(jarId);
      const kept = before.filter((v) => v.visitedAt >= cutoff);
      const deleted = before.length - kept.length;
      data.set(jarId, kept);
      return deleted;
    },
    originsForJar(jarId) {
      if (throws.originsForJar) throw new Error('history store blew up');
      /** @type {Map<string, number>} */
      const byOrigin = new Map();
      for (const row of rows(jarId)) {
        if (!row.url) continue;
        const normalized = origin(row.url);
        if (normalized === null) continue;
        const previous = byOrigin.get(normalized);
        if (previous === undefined || row.visitedAt > previous) byOrigin.set(normalized, row.visitedAt);
      }
      return Array.from(byOrigin, ([originString, lastVisitedAt]) => ({ origin: originString, lastVisitedAt }));
    },
    // This reads the same rows pruneOneJar mutates, making snapshot-before-
    // prune ordering observable rather than hard-coded in a stub.
    expiredOriginsForJar(jarId, cutoffMs) {
      calls.push('expiredOriginsForJar');
      if (throws.expiredOriginsForJar) throw new Error('history store blew up');
      /** @type {Map<string, number>} */
      const byOrigin = new Map();
      for (const row of rows(jarId)) {
        if (!row.url) continue;
        const normalized = origin(row.url);
        if (normalized === null) continue;
        const previous = byOrigin.get(normalized);
        if (previous === undefined || row.visitedAt > previous) byOrigin.set(normalized, row.visitedAt);
      }
      return Array.from(byOrigin.entries())
        .filter(([, lastVisitedAt]) => lastVisitedAt < cutoffMs)
        .map(([originString]) => originString);
    }
  };
}

function trustedJarsEvent() {
  return {
    senderFrame: { origin: 'goldfinch://jars', url: 'goldfinch://jars/' },
    sender: { session: { __goldfinchInternal: true } }
  };
}

/**
 * Build the shared fake-deps harness around the real jars store, seeded
 * through app-db's in-memory document row. Every observable side effect is
 * recorded in `events` so ordering assertions use one log.
 */
function makeHarness(
  t,
  {
    containers = [personal, work],
    defaultId = 'personal',
    storageThrows = false,
    historyThrows = {},
    cookiesByPartition = {},
    cookiesGetThrows = false,
    cookiesRemoveThrows = false,
    storagePaths = {},
    // M12 F4 Leg 6: optional accessor for a (real or fake) vault store, injected into
    // registerJarIpc so handleRemove's fail-soft vault-removal step runs. Omitted by
    // default → the step is skipped (the injection-gated precedent).
    getVaultStore = undefined
  } = {}
) {
  appDb.open('', { memory: true });
  t.after(() => appDb.close());
  appDb
    .createDocumentStore('jars')
    .write(JSON.stringify({ version: 2, defaultId, containers }), 0);
  const jars = freshStore();
  jars.load('');

  const events = [];
  const sessions = [];
  const handlers = new Map();
  const ipcMain = {
    handle(channel, fn) {
      handlers.set(channel, fn);
    }
  };

  const session = {
    fromPartition(partition) {
      const ses = {
        partition,
        storagePath: Object.prototype.hasOwnProperty.call(storagePaths, partition) ? storagePaths[partition] : null,
        async clearStorageData(options) {
          if (storageThrows) throw new Error('wipe failed');
          events.push({ fn: 'clearStorageData', partition, args: options });
        },
        async clearCache(options) {
          events.push({ fn: 'clearCache', partition, args: options });
        },
        cookies: {
          async get(filter) {
            if (cookiesGetThrows) throw new Error('cookies.get failed');
            events.push({ fn: 'cookiesGet', partition, args: filter });
            return cookiesByPartition[partition] || [];
          },
          async remove(url, name) {
            if (cookiesRemoveThrows) throw new Error('cookies.remove failed');
            events.push({ fn: 'cookiesRemove', partition, args: { url, name } });
          }
        }
      };
      sessions.push(ses);
      return ses;
    }
  };

  const rerollSeed = (ses) => events.push({ fn: 'rerollSeed', ses });
  const revokeJarKey = (jarId, settings) => events.push({ fn: 'revokeJarKey', jarId, settings });
  const settingsData = { automationKeyHashes: { personal: 'hash-p' } };
  const settings = {
    get: (key) => settingsData[key],
    set: (key, value) => {
      settingsData[key] = value;
    },
    getAll: () => ({ ...settingsData })
  };
  const broadcast = (channel, payload) =>
    events.push({ fn: 'broadcast', channel, payload: structuredClone(payload), raw: payload });
  const historyStore = makeFakeHistoryStore({ throws: historyThrows });

  const result = registerJarIpc({
    ipcMain,
    jars,
    session,
    rerollSeed,
    revokeJarKey,
    settings,
    broadcast,
    historyStore,
    getVaultStore
  });

  const invoke = (channel, payload) => handlers.get(channel)({}, payload);
  const invokeInternal = (channel, payload) => handlers.get(channel)(trustedJarsEvent(), payload);
  const broadcasts = () => events.filter((event) => event.fn === 'broadcast');

  return {
    jars,
    handlers,
    events,
    sessions,
    settings,
    historyStore,
    broadcastJarsChanged: result.broadcastJarsChanged,
    invoke,
    invokeInternal,
    broadcasts
  };
}

module.exports = {
  appDb,
  flush,
  freshStore,
  makeFakeHistoryStore,
  makeHarness,
  personal,
  trustedJarsEvent,
  work
};
