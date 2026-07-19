// @ts-check
'use strict';

const SENSITIVE_PERMISSIONS = new Set([
  'media',
  'geolocation',
  'notifications',
  'midi',
  'midiSysex',
  'clipboard-read',
  'hid',
  'serial',
  'usb',
  'bluetooth',
  'idle-detection',
  'display-capture'
]);

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
    chromeForTab,
    schedule,
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
    privacySendTimers.set(webContentsId, schedule(() => {
      privacySendTimers.delete(webContentsId);
      const aggregate = privacyByTab.get(webContentsId);
      const chrome = chromeForTab(webContentsId);
      if (aggregate && chrome) {
        chrome.send('privacy-net', {
          webContentsId,
          agg: serializeAggregate(aggregate)
        });
      }
    }, 350));
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
        const entry = aggregate.trackers[classification.tracker][classification.domain] ||
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
      const firstParty = tabFirstParty(details.webContentsId) ||
        registrableDomain(hostnameOf(details.url));
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
      const firstParty = tabFirstParty(details.webContentsId) ||
        registrableDomain(hostnameOf(details.url));
      const headers = details.requestHeaders;
      if (shields.active('strip', firstParty) && headers.Referer) {
        try {
          headers.Referer = new URL(headers.Referer).origin + '/';
        } catch {
          delete headers.Referer;
        }
      }
      if (shields.active('isolate', firstParty) &&
          details.resourceType !== 'mainFrame' && headers.Cookie) {
        const classification = classify(details.url, firstParty);
        if (classification.thirdParty) {
          delete headers.Cookie;
          const aggregate = privacyByTab.get(details.webContentsId);
          if (aggregate && classification.domain) {
            aggregate.cookieBlockedDomains[classification.domain] = 1;
            schedulePrivacySend(details.webContentsId);
          }
        }
      }
      callback({ requestHeaders: headers });
    });

    session.webRequest.onHeadersReceived((details, callback) => {
      const firstParty = tabFirstParty(details.webContentsId) ||
        registrableDomain(hostnameOf(details.url));
      const headers = details.responseHeaders || {};
      if (shields.active('isolate', firstParty) &&
          details.resourceType !== 'mainFrame' &&
          classify(details.url, firstParty).thirdParty) {
        for (const key of Object.keys(headers)) {
          if (key.toLowerCase() === 'set-cookie') delete headers[key];
        }
      }
      callback({ responseHeaders: headers });
    });

    session.setPermissionRequestHandler((webContents, permission, callback) => {
      const granted = !SENSITIVE_PERMISSIONS.has(permission);
      const webContentsId = webContents ? webContents.id : null;
      const chrome = webContentsId != null ? chromeForTab(webContentsId) : null;
      chrome?.send('privacy-permission', { webContentsId, permission, granted });
      callback(granted);
    });
    session.setPermissionCheckHandler((_webContents, permission) =>
      !SENSITIVE_PERMISSIONS.has(permission));
  }

  function onSessionCreated(session) {
    if (isCreatingInternalSession()) {
      session.__goldfinchInternal = true;
      return;
    }

    applyShields(session);
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
            cookieSeenStore.insertIfAbsent(
              jarId,
              cookie.name,
              cookie.domain,
              cookie.path,
              now()
            );
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
      const retentionByJarId = Object.fromEntries(
        jarList.map((jar) => [jar.id, jar.retentionDays])
      );
      const agedOutOriginsByJarId = retentionSweep.snapshotAgedOutOrigins(jarList);
      const deleted = historyStore.pruneExpired(retentionByJarId, now());
      for (const jarId of Object.keys(deleted)) {
        broadcast('history-changed', { jarId });
      }
      retentionSweep.sweepAll(jarList, agedOutOriginsByJarId)
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
