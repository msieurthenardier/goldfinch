// @ts-check
'use strict';

const { refusedThirdPartySetCookie } = require('./third-party-cookies');

// Positive allowlist: only permissions listed here are granted; everything
// else — including permission strings that don't exist yet — is denied by
// default. Electron 43's setPermissionRequestHandler and
// setPermissionCheckHandler each take a DIFFERENT union of permission
// strings (e.g. 'window-management'/'speaker-selection' are request-only;
// 'hid'/'serial'/'usb' are check-only). This one Set is intentionally
// shared by both handlers below — do not "fix" the apparent asymmetry by
// splitting it; a permission irrelevant to one handler's union is simply
// never asked of it. The shared-Set union is pinned by the unit test
// 'permission allowlist denies invented/future permissions and grants
// allowlisted members' (test/unit/session-runtime.test.js), which exercises
// BOTH handlers against the same membership — a split would have to weaken
// that test to land, which is the tell that the refactor is wrong.
const ALLOWED_PERMISSIONS = new Set([
  'fullscreen',
  'clipboard-sanitized-write',
  'pointerLock',
  'mediaKeySystem',
  'storage-access',
  'top-level-storage-access',
  'speaker-selection',
  'window-management'
]);

// Storage Access API permissions: refused while native third-party cookie
// isolation is in force (sortie 02 DD7) — granting would tell the page
// "granted" while Chromium still blocks, so pages get an honest NotAllowedError.
const STORAGE_ACCESS_PERMISSIONS = new Set(['storage-access', 'top-level-storage-access']);

/**
 * Own all web-session behavior: spellcheck, the single shared Shields/privacy
 * webRequest pipeline, permission policy, cookie bookkeeping, and retention cadence.
 * Electron supplies sessions to these handlers; this module imports no Electron API.
 * @param {any} deps
 */
function createSessionRuntime(deps) {
  const {
    isCreatingInternalSession,
    wireDownloadHandler,
    settings,
    partitionFromStoragePath,
    jars,
    appDb,
    cookieChangeAction,
    cookieSeenStore,
    now,
    retentionSweep,
    historyStore,
    broadcast,
    registrableDomain,
    hostnameOf,
    classify,
    shields,
    // Sortie 02 DD1: the startup decision (process constant), default false so
    // pre-existing callers/tests are unaffected unless they opt in.
    isolateEffective = false,
    chromeForTab,
    schedule,
    // Mission 20 Flight 2 Leg 2 (DD6): the session-level certificate-
    // verification observer — installed on every web session below, beside
    // applyShields.
    certObserver,
    logger
  } = deps;

  const privacyByTab = new Map();
  const privacySendTimers = new Map();

  function blankAggregate(firstParty) {
    return {
      firstParty: firstParty || '',
      secure: true,
      total: 0,
      mixedContent: 0,
      blocked: 0,
      strippedDomains: {},
      cookieBlockedDomains: {},
      thirdPartyDomains: {},
      trackers: { ads: {}, analytics: {}, social: {}, other: {} }
    };
  }

  function serializeAggregate(aggregate) {
    const trackers = { count: 0, blocked: 0, allowed: 0 };
    let count = 0;
    let blocked = 0;
    for (const category of ['ads', 'analytics', 'social', 'other']) {
      trackers[category] = Object.entries(aggregate.trackers[category]).map(([domain, value]) => {
        count++;
        if (value.blocked) blocked++;
        return { domain, blocked: value.blocked };
      });
    }
    trackers.count = count;
    trackers.blocked = blocked;
    trackers.allowed = count - blocked;
    return {
      firstParty: aggregate.firstParty,
      secure: aggregate.secure,
      total: aggregate.total,
      mixedContent: aggregate.mixedContent,
      blocked: aggregate.blocked,
      stripped: Object.keys(aggregate.strippedDomains).length,
      cookiesBlocked: Object.keys(aggregate.cookieBlockedDomains).length,
      thirdPartyCount: Object.keys(aggregate.thirdPartyDomains).length,
      thirdPartyList: Object.entries(aggregate.thirdPartyDomains)
        .map(([domain, requestCount]) => ({ domain, count: requestCount }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 200),
      trackers
    };
  }

  function schedulePrivacySend(webContentsId) {
    if (privacySendTimers.has(webContentsId)) return;
    privacySendTimers.set(
      webContentsId,
      schedule(() => {
        privacySendTimers.delete(webContentsId);
        const aggregate = privacyByTab.get(webContentsId);
        const chrome = chromeForTab(webContentsId);
        if (aggregate && chrome) {
          chrome.send('privacy-net', {
            webContentsId,
            agg: serializeAggregate(aggregate)
          });
        }
      }, 350)
    );
  }

  function recordRequest(details, action) {
    const webContentsId = details.webContentsId;
    if (webContentsId == null) return;
    if (details.resourceType === 'mainFrame') {
      const aggregate = blankAggregate(registrableDomain(hostnameOf(details.url)));
      aggregate.secure = details.url.startsWith('https:');
      privacyByTab.set(webContentsId, aggregate);
      schedulePrivacySend(webContentsId);
      return;
    }

    let aggregate = privacyByTab.get(webContentsId);
    if (!aggregate) {
      aggregate = blankAggregate('');
      privacyByTab.set(webContentsId, aggregate);
    }
    aggregate.total++;
    if (action === 'block') aggregate.blocked++;
    if (action === 'strip') {
      aggregate.strippedDomains[registrableDomain(hostnameOf(details.url))] = 1;
    }
    if (aggregate.secure && details.url.startsWith('http:')) aggregate.mixedContent++;

    const classification = classify(details.url, aggregate.firstParty);
    if (classification.thirdParty && classification.domain) {
      aggregate.thirdPartyDomains[classification.domain] =
        (aggregate.thirdPartyDomains[classification.domain] || 0) + 1;
      if (classification.tracker && aggregate.trackers[classification.tracker]) {
        const entry =
          aggregate.trackers[classification.tracker][classification.domain] ||
          (aggregate.trackers[classification.tracker][classification.domain] = { blocked: false });
        if (action === 'block') entry.blocked = true;
      }
    }
    schedulePrivacySend(webContentsId);
  }

  function tabFirstParty(webContentsId) {
    return privacyByTab.get(webContentsId)?.firstParty || '';
  }

  function applySpellcheck(session, enabled) {
    if (!session || session.__goldfinchInternal) return;
    session.setSpellCheckerLanguages(enabled ? ['en-US'] : []);
  }

  function applyShields(session) {
    if (!session || session.__goldfinchInternal || session.__goldfinchShields) return;
    session.__goldfinchShields = true;

    session.webRequest.onBeforeRequest((details, callback) => {
      const firstParty = tabFirstParty(details.webContentsId) || registrableDomain(hostnameOf(details.url));
      let action = 'allow';
      let response = {};
      if (details.resourceType !== 'mainFrame' && shields.active('block', firstParty)) {
        const classification = classify(details.url, firstParty);
        if (classification.thirdParty && classification.tracker) {
          action = 'block';
          response = { cancel: true };
        }
      }
      if (action === 'allow' && shields.active('strip', firstParty)) {
        const clean = shields.stripUrl(details.url);
        if (clean && clean !== details.url) {
          action = 'strip';
          response = { redirectURL: clean };
        }
      }
      try {
        recordRequest(details, action);
      } catch {
        // Privacy accounting must never break traffic.
      }
      callback(response);
    });

    session.webRequest.onBeforeSendHeaders((details, callback) => {
      const firstParty = tabFirstParty(details.webContentsId) || registrableDomain(hostnameOf(details.url));
      const headers = details.requestHeaders;
      if (shields.active('strip', firstParty) && headers.Referer) {
        try {
          headers.Referer = new URL(headers.Referer).origin + '/';
        } catch {
          delete headers.Referer;
        }
      }
      callback({ requestHeaders: headers });
    });

    session.webRequest.onHeadersReceived((details, callback) => {
      const firstParty = tabFirstParty(details.webContentsId) || registrableDomain(hostnameOf(details.url));
      const headers = details.responseHeaders || {};
      // Sortie 02 DD3/DD6: isolation is native now (Chromium refuses the cookie), so
      // the response passes through UNMODIFIED; this only does the honest accounting.
      // Independent of pause and of the configured state: Chromium refuses regardless.
      if (isolateEffective && details.resourceType !== 'mainFrame') {
        try {
          const classification = classify(details.url, firstParty);
          if (classification.thirdParty && classification.domain) {
            const key = Object.keys(headers).find((k) => k.toLowerCase() === 'set-cookie');
            const raw = key === undefined ? undefined : headers[key];
            const lines = typeof raw === 'string' ? [raw] : raw;
            if (Array.isArray(lines) && lines.length > 0 && refusedThirdPartySetCookie(lines)) {
              const aggregate = privacyByTab.get(details.webContentsId);
              if (aggregate) {
                aggregate.cookieBlockedDomains[classification.domain] = 1;
                schedulePrivacySend(details.webContentsId);
              }
            }
          }
        } catch {
          // Privacy accounting must never break traffic.
        }
      }
      callback({ responseHeaders: headers });
    });

    const permissionGranted = (/** @type {string} */ permission) =>
      ALLOWED_PERMISSIONS.has(permission) && !(isolateEffective && STORAGE_ACCESS_PERMISSIONS.has(permission));
    session.setPermissionRequestHandler((webContents, permission, callback) => {
      const granted = permissionGranted(permission);
      const webContentsId = webContents ? webContents.id : null;
      const chrome = webContentsId != null ? chromeForTab(webContentsId) : null;
      chrome?.send('privacy-permission', { webContentsId, permission, granted });
      callback(granted);
    });
    session.setPermissionCheckHandler((_webContents, permission) => permissionGranted(permission));
  }

  function onSessionCreated(session) {
    if (isCreatingInternalSession()) {
      session.__goldfinchInternal = true;
      return;
    }

    applyShields(session);
    // Mission 20 Flight 2 Leg 2 (DD6): install the verify-proc observer for
    // EVERY web session, Burner included — BEFORE the jar-lookup block below,
    // whose `if (!jarEntry) return` would otherwise skip the Burner session
    // entirely (Burner is never a `jars.list()` entry, `jars.js:18`). The
    // default session has no jar storage path at all, so it keys `'default'`
    // (media-proxy fetches; never affects any tab entry — no tab lives there).
    const certObserverPartition = partitionFromStoragePath(session.storagePath) ?? 'default';
    session.setCertificateVerifyProc(certObserver.procFor(certObserverPartition));
    wireDownloadHandler(session);
    let spellcheckOn;
    try {
      spellcheckOn = settings.get('spellcheck') === true;
    } catch {
      spellcheckOn = false;
    }
    applySpellcheck(session, spellcheckOn);

    try {
      const partition = partitionFromStoragePath(session.storagePath);
      const jarEntry = partition ? jars.list().find((jar) => jar.partition === partition) : null;
      if (!jarEntry) return;
      const jarId = jarEntry.id;
      session.cookies.on('changed', (_event, cookie, cause, removed) => {
        if (!appDb.isOpen()) return;
        try {
          const action = cookieChangeAction(cause, removed);
          if (action === 'skip') return;
          if (action === 'delete') {
            cookieSeenStore.deleteByIdentity(jarId, cookie.name, cookie.domain, cookie.path);
          } else {
            cookieSeenStore.insertIfAbsent(jarId, cookie.name, cookie.domain, cookie.path, now());
          }
        } catch (err) {
          logger.error('[retention-sweep]', err);
        }
      });
    } catch (err) {
      logger.error('[retention-sweep] cookies-listener attach failed:', err);
    }
  }

  function pruneAllJars() {
    try {
      const jarList = jars.list();
      const retentionByJarId = Object.fromEntries(jarList.map((jar) => [jar.id, jar.retentionDays]));
      const agedOutOriginsByJarId = retentionSweep.snapshotAgedOutOrigins(jarList);
      const deleted = historyStore.pruneExpired(retentionByJarId, now());
      for (const jarId of Object.keys(deleted)) {
        broadcast('history-changed', { jarId });
      }
      retentionSweep
        .sweepAll(jarList, agedOutOriginsByJarId)
        .then((results) => {
          for (const jarId of Object.keys(results)) {
            const classes = results[jarId].classes;
            if (classes && classes.length > 0) {
              broadcast('jar-data-changed', { jarId, classes });
            }
          }
        })
        .catch((err) => logger.error('[retention-sweep] cadence sweep failed:', err));
    } catch (err) {
      logger.error('[history] prune failed:', err);
    }
  }

  return { applySpellcheck, applyShields, onSessionCreated, pruneAllJars };
}

module.exports = { createSessionRuntime };
