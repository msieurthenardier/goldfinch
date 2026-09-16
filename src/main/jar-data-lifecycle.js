'use strict';

// Shared destructive-data and immediate-retention sequencing. Electron-free:
// live sessions, stores, clocks, and seed mutation are injected.

const { cookieUrl, partitionFromStoragePath } = require('./jar-data-helpers');
const { createRetentionSweep } = require('./retention-sweep');

function createJarDataLifecycle({
  session,
  rerollSeed,
  historyStore,
  cookieSeen,
  now = () => Date.now(),
  // Mission 20 Flight 2 Leg 2 (DD2/DD6/AC9): the certificate-trust and
  // observer stores — cleared FIRST, before any fail-hard storage call below,
  // so an identity wipe/removal drops trust decisions even when
  // clearStorageData()/clearCache() throws. Optional (offline tests that omit
  // either skip the step — the injection-gated precedent).
  certTrust = null,
  certObserver = null
}) {
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
    // AC9: trust/observer clears run FIRST and fail-soft (one try/catch
    // around both) — `ses.storagePath` is reconstructed back to the exact
    // `persist:<name>` string `entry.partition` carries (the same
    // `partitionFromStoragePath` helper `session-runtime.js` uses for the
    // observer's own install-time key), so no signature change is needed
    // here — both call sites (jar-data-ipc.js's handleWipe, jar-registry-
    // ipc.js's handleRemove) already hold `ses` from `session.fromPartition`.
    try {
      const partition = partitionFromStoragePath(ses.storagePath);
      if (partition) {
        certTrust?.clearPartition(partition);
        certObserver?.clearPartition(partition);
      }
    } catch (error) {
      console.error('[cert-trust]', error);
    }
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
