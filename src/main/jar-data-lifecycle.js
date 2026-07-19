'use strict';

// Shared destructive-data and immediate-retention sequencing. Electron-free:
// live sessions, stores, clocks, and seed mutation are injected.

const { cookieUrl } = require('./jar-data-helpers');
const { createRetentionSweep } = require('./retention-sweep');

function createJarDataLifecycle({ session, rerollSeed, historyStore, cookieSeen, now = () => Date.now() }) {
  const retentionSweep = createRetentionSweep({
    cookieSeen,
    historyOrigins: (jarId, cutoffMs) => historyStore.expiredOriginsForJar(jarId, cutoffMs),
    sessionFor: (jar) => session.fromPartition(jar.partition),
    cookieUrl,
    now
  });

  // Session failures propagate to each caller's existing policy: remove is
  // fail-soft, explicit wipe is fail-hard. Metadata cleanup alone is fail-soft.
  async function wipeJarData(ses, jarId) {
    await ses.clearStorageData();
    await ses.clearCache();
    rerollSeed(ses);
    let purged = 0;
    try {
      purged = historyStore.clearJar(jarId);
    } catch (error) {
      console.error('[history]', error);
    }
    try {
      cookieSeen.deleteByJar(jarId);
    } catch (error) {
      console.error('[retention-sweep]', error);
    }
    return purged;
  }

  return { retentionSweep, wipeJarData };
}

module.exports = { createJarDataLifecycle };
