'use strict';

// Jar IPC composition facade. Registry/default operations and per-jar data
// operations live in separate Electron-free registrars; this file owns only
// the shared context and the existing broadcastJarsChanged return contract.
// Chrome and internal twins are registered once by their domain registrar.

const { BURNER } = require('../shared/burner');
const appDb = require('./app-db');
const { createJarDataLifecycle } = require('./jar-data-lifecycle');
const { registerJarRegistryIpc } = require('./jar-registry-ipc');
const { registerJarDataIpc } = require('./jar-data-ipc');

/**
 * @param {{
 *   ipcMain: { handle: (channel: string, fn: (event: any, payload?: any) => any) => void },
 *   jars: typeof import('./jars'),
 *   session: { fromPartition: (partition: string) => any },
 *   rerollSeed: (ses: any) => void,
 *   revokeJarKey: (jarId: string, settings: any) => void,
 *   settings: { get: (k: string) => any, set: (k: string, v: any) => any, getAll: () => any },
 *   broadcast: (channel: string, payload: unknown) => void,
 *   historyStore: typeof import('./history-store')
 * }} deps
 */
function registerJarIpc({ ipcMain, jars, session, rerollSeed, revokeJarKey, settings, broadcast, historyStore }) {
  const cookieSeen = appDb.createCookieSeenStore();

  // getDefault() returns the shared frozen BURNER when no persistent jar
  // exists. The live list is structured-cloned by the real IPC boundary.
  function broadcastJarsChanged() {
    const currentDefault = jars.getDefault();
    broadcast('jars-changed', {
      containers: jars.list(),
      defaultId: currentDefault === BURNER ? null : currentDefault.id
    });
  }

  const { retentionSweep, wipeJarData } = createJarDataLifecycle({
    session,
    rerollSeed,
    historyStore,
    cookieSeen
  });

  registerJarRegistryIpc({
    ipcMain,
    jars,
    session,
    wipeJarData,
    revokeJarKey,
    settings,
    broadcast,
    broadcastJarsChanged
  });

  registerJarDataIpc({
    ipcMain,
    jars,
    session,
    historyStore,
    cookieSeen,
    retentionSweep,
    wipeJarData,
    broadcast,
    broadcastJarsChanged
  });

  return { broadcastJarsChanged };
}

module.exports = { registerJarIpc };
