'use strict';

const { isDownloadableMediaUrl } = require('./media-list');
const { RETRY_REASONS, planRetry, projectRow, retryReasonText } = require('./download-retry');

const DOWNLOADS_ACTIONS = new Set(['pause', 'resume', 'cancel', 'remove', 'retry', 'open', 'show']);
const INDICATOR_RECENT_CAP = 25;

function registerDownloadIpc({
  ipcMain,
  gate,
  registry,
  getTabContents,
  path,
  fs,
  sanitizeFilename,
  isWithinDir,
  dialog,
  shell,
  getDownloadsPath,
  getDownloadsManager,
  buildRegisterRecord,
  buildProgressPayload,
  buildDonePayload,
  broadcast,
  registerInternalHandler,
  // Mission 23 Flight 1 (leg `downloads`): the facts Retry and the record's jar need, injected so the
  // module stays Electron-free. `sessionFromPartition` is `session.fromPartition`; `getJars` is
  // `jars.list`; `partitionFromStoragePath` is the persistent-jar fallback; `isPartitionLive` answers
  // whether a burner partition still has a tab or popup.
  sessionFromPartition,
  getJars,
  partitionFromStoragePath,
  isPartitionLive,
  now = Date.now,
  logger = console
}) {
  // Suggested name / folder for a media-panel download, keyed by the DOWNLOADING TAB and the URL (a
  // page-started download of the same URL in another tab must not inherit them) and consumed when the
  // download STARTS, so a request that never produced a download leaves nothing behind.
  // A request that never produces a download (a 404, a blocked request) or a tab that closes first would
  // leave its entry forever, so every add drops entries older than PENDING_DOWNLOAD_MAX_AGE_MS. (No
  // per-tab destroy hook is at hand here; the age bound covers a closed tab too.)
  const pendingDownloads = new Map();
  const PENDING_DOWNLOAD_MAX_AGE_MS = 60_000;
  const prunePendingDownloads = () => {
    const cutoff = now() - PENDING_DOWNLOAD_MAX_AGE_MS;
    for (const [k, v] of pendingDownloads) if (v.at < cutoff) pendingDownloads.delete(k);
  };
  /** @param {number} wcId @param {string} url */
  const pendingKey = (wcId, url) => `${wcId} ${url}`;
  const approvedDownloadDirs = new Set();

  // Session -> partition. A burner session has no storage path to derive a partition from, so tab
  // creation (and Retry) record it here; a persistent jar falls back to its storage path. The browser's
  // own default session has neither and records no partition.
  /** @type {WeakMap<object, string>} */
  const sessionPartitions = new WeakMap();
  /** @param {any} sess @param {unknown} partition */
  function noteSessionPartition(sess, partition) {
    if (sess && typeof partition === 'string' && partition) sessionPartitions.set(sess, partition);
  }
  /** @param {any} sess @returns {string|undefined} */
  function partitionOfSession(sess) {
    const noted = sessionPartitions.get(sess);
    if (noted) return noted;
    const derived = partitionFromStoragePath ? partitionFromStoragePath(sess && sess.storagePath) : null;
    return typeof derived === 'string' && derived ? derived : undefined;
  }
  const retryEnv = {
    isJarPartition: (/** @type {string} */ partition) =>
      (getJars ? getJars() : []).some((/** @type {any} */ jar) => jar && jar.partition === partition),
    isBurnerLive: (/** @type {string} */ partition) => (isPartitionLive ? isPartitionLive(partition) === true : false)
  };
  const liveDownloadItems = new Map();

  function uniquePath(dir, filename) {
    const safe = sanitizeFilename(filename);
    const ext = path.extname(safe);
    const base = path.basename(safe, ext);
    let candidate = path.join(dir, safe);
    let n = 1;
    while (fs.existsSync(candidate)) {
      candidate = path.join(dir, `${base} (${n})${ext}`);
      n++;
    }
    if (!isWithinDir(dir, candidate)) {
      logger.warn('[uniquePath] candidate escaped dir, falling back:', candidate);
      candidate = path.join(dir, 'download');
    }
    return candidate;
  }

  // Owning-chrome class: when the payload names a tab (`webContentsId`) the sender's window must
  // own it; an absent/null id means the sender window's own active tab (the gate guarantees the
  // sender window, so there is no last-focused fallback).
  gate.owningChrome.handle(
    'download-media',
    (payload) => (payload && typeof payload === 'object' ? payload.webContentsId : undefined),
    async (event, payload) => {
      const { webContentsId, url, suggestedName, saveDir } = /** @type {any} */ (payload || {});
      // Mission 23 Flight 1 (leg `jar-isolation`): only web URLs, `blob:` and raster `data:` images are
      // downloadable here. Refused before anything is resolved, started or recorded (`file:` and every
      // other scheme used to reach `downloadURL`).
      if (!isDownloadableMediaUrl(url)) return { ok: false, error: 'Unsupported download URL.' };
      const wc = typeof webContentsId === 'number' ? getTabContents(webContentsId) : null;
      const rec = registry.getWindowForChrome(event.sender);
      const senderActiveTab = rec && rec.activeTabWcId != null ? getTabContents(rec.activeTabWcId) : null;
      // DD6 (Mission 13 Flight 1 / Leg 2): the chrome-view terminal fallback is
      // removed — a download with no resolvable jar-guest context fails loudly
      // instead of riding the default session (the one path a download could
      // have carried default-session cookies). F10c (Flight 02 Leg 3): the
      // renderer-supplied webContentsId is resolved via getTabContents, which
      // returns a live contents only for a genuine tab and null for the
      // chrome's own id, a sheet, a popup, or an unknown/dead id — so naming a
      // non-tab id can no longer resolve as the explicit downloader; it falls
      // through to senderActiveTab like an absent id would.
      const downloader = wc || senderActiveTab;
      if (!downloader) return { ok: false, error: 'No web contents available to download with.' };
      if (saveDir != null && !approvedDownloadDirs.has(path.resolve(saveDir))) {
        return { ok: false, error: 'Download directory not approved.' };
      }
      const key = pendingKey(downloader.id, url);
      prunePendingDownloads();
      pendingDownloads.set(key, { suggestedName, saveDir, at: now() });
      try {
        downloader.downloadURL(url);
        return { ok: true };
      } catch (err) {
        pendingDownloads.delete(key);
        return { ok: false, error: String(err && err.message ? err.message : err) };
      }
    },
    'throw'
  );

  gate.chrome.handle(
    'choose-download-dir',
    async (event) => {
      const rec = registry.getWindowForChrome(event.sender);
      const opts = {
        title: 'Choose a folder to download all media into',
        properties: ['openDirectory', 'createDirectory']
      };
      const result = await dialog.showOpenDialog(rec.win, opts);
      if (result.canceled || !result.filePaths.length) return null;
      const chosen = result.filePaths[0];
      approvedDownloadDirs.add(path.resolve(chosen));
      return chosen;
    },
    'throw'
  );

  gate.chrome.handle(
    'show-item-in-folder',
    (_event, savePath) => {
      if (typeof savePath !== 'string' || !savePath) return;
      const resolved = path.resolve(savePath);
      const isApprovedDir = approvedDownloadDirs.has(resolved);
      const isKnownSavePath = getDownloadsManager()
        ?.listAll()
        .some((entry) => entry.savePath && path.resolve(entry.savePath) === resolved);
      if (isApprovedDir || isKnownSavePath) shell.showItemInFolder(savePath);
    },
    'throw'
  );

  // Chrome-trust file actions (M11 F1 Leg 1, DD4): resolve savePath MAIN-SIDE by
  // numeric id — never trust a renderer-supplied path. Shared with the internal
  // downloads-action open/show bodies via resolveDownloadRecord below.
  // show-item-in-folder (F10c, Flight 02 Leg 3) is the path-holding-caller
  // equivalent: its two renderer callers hold a main-originated path (an
  // approved download directory or a completed record's savePath) rather than
  // a record id, so instead of resolving by id it validates the renderer's
  // path against the same main-known sets before acting — anything else is a
  // silent no-op.
  function resolveDownloadRecord(id) {
    if (typeof id !== 'number') return null;
    const manager = getDownloadsManager();
    if (!manager) return null;
    return manager.listAll().find((entry) => entry.id === id) || null;
  }

  // THE ONE open function (Mission 23 Flight 1, leg `downloads`): the only `shell.openPath` call in
  // `src/main/**` (source-scan pinned). Completion gate is the trust-boundary enforcement of "never
  // openable until complete": an in-flight record already carries a savePath, so opening by id must
  // confirm a known record, completed state and a recorded path, or it would launch a partially-written
  // file. The chrome's open channel and the downloads page's open action both go through here.
  /** @param {unknown} id */
  function openDownload(id) {
    const record = resolveDownloadRecord(/** @type {any} */ (id));
    if (!record || record.state !== 'completed' || !record.savePath) return Promise.resolve({ ok: false });
    return Promise.resolve(shell.openPath(record.savePath)).then((error) => ({
      ok: !error,
      error: error || undefined
    }));
  }

  // One-shot chrome bootstrap for newly created windows. The live feed remains
  // download-progress/download-done; this read only closes the event-history gap
  // before a new chrome renderer subscribed. Paths and URLs stay main-side.
  gate.chrome.handle(
    'downloads-snapshot',
    () => {
      const records = getDownloadsManager()?.listAll() || [];
      const rows = records
        .filter((entry) => entry && typeof entry.id === 'number')
        .map((entry) => ({
          id: entry.id,
          filename: entry.filename,
          state: entry.state,
          received: entry.received,
          total: entry.total,
          paused: entry.paused,
          endTime: entry.endTime ?? null,
          active: entry.endTime == null
        }));
      const active = rows.filter((entry) => entry.active);
      const recent = rows
        .filter((entry) => !entry.active && entry.state === 'completed' && typeof entry.endTime === 'number')
        .sort((a, b) => b.endTime - a.endTime)
        .slice(0, INDICATOR_RECENT_CAP);
      return [...active, ...recent];
    },
    { value: [] }
  );

  gate.chrome.handle(
    'open-downloaded-file',
    (_event, id) => {
      return openDownload(id);
    },
    'throw'
  );

  gate.chrome.handle(
    'reveal-downloaded-file',
    (_event, id) => {
      const record = resolveDownloadRecord(id);
      if (!record || !record.savePath) return { ok: false };
      shell.showItemInFolder(record.savePath);
      return { ok: true };
    },
    'throw'
  );

  function wireDownloadHandler(sess) {
    if (sess.__goldfinchDownloads) return;
    sess.__goldfinchDownloads = true;
    sess.on('will-download', (_event, item, downloadingContents) => {
      const url = item.getURL();
      // Matched against the webContents the event reports; a download that reports none never matches.
      // Consumed here, at start (not at done).
      const key =
        downloadingContents && typeof downloadingContents.id === 'number'
          ? pendingKey(downloadingContents.id, url)
          : null;
      const meta = key ? pendingDownloads.get(key) : undefined;
      if (key) pendingDownloads.delete(key);
      const suggested = (meta && meta.suggestedName) || item.getFilename() || 'download';
      item.setSavePath(
        meta && meta.saveDir ? uniquePath(meta.saveDir, suggested) : uniquePath(getDownloadsPath(), suggested)
      );

      const manager = getDownloadsManager();
      const record = buildRegisterRecord(item, { url, startTime: now(), partition: partitionOfSession(sess) });
      const id = manager ? manager.register(record) : -1;
      if (id !== -1) liveDownloadItems.set(id, item);

      item.on('updated', (_e, state) => {
        const payload = buildProgressPayload(item, { id, url, state });
        const current = getDownloadsManager();
        current?.update(id, {
          state: payload.state,
          received: payload.received,
          total: payload.total,
          paused: payload.paused
        });
        broadcast('download-progress', payload);
      });

      item.once('done', (_e, state) => {
        const payload = buildDonePayload(item, { id, url, state });
        getDownloadsManager()?.finalize(id, { state, savePath: payload.savePath, endTime: now() });
        liveDownloadItems.delete(id);
        broadcast('download-done', payload);
      });
    });
  }

  // Rows carry the main-derived retry verdict (`retryable`, `retryReason`, `retryNote`); the page never
  // decides whether a retry is possible, and main re-decides on the action itself.
  registerInternalHandler(ipcMain, 'internal-downloads-list', () =>
    (getDownloadsManager()?.listAll() || []).map((entry) => projectRow(entry, retryEnv))
  );

  registerInternalHandler(ipcMain, 'internal-downloads-action', (_event, payload) => {
    const id = payload && payload.id;
    const action = payload && payload.action;
    const manager = getDownloadsManager();
    if (typeof id !== 'number' || !DOWNLOADS_ACTIONS.has(action) || !manager) return { ok: false };
    const record = resolveDownloadRecord(id);

    if (action === 'pause' || action === 'resume' || action === 'cancel') {
      const item = liveDownloadItems.get(id);
      if (item) {
        item[action]();
        if (action !== 'cancel') {
          const progress = buildProgressPayload(item, {
            id,
            url: item.getURL(),
            state: item.getState?.() || 'progressing'
          });
          manager.update(id, {
            state: progress.state,
            received: progress.received,
            total: progress.total,
            paused: progress.paused
          });
          broadcast('download-progress', progress);
        }
      }
    } else if (action === 'remove') {
      manager.remove(id);
    } else if (action === 'retry') {
      // Re-request through the session the download came from — never a chrome view or a last-focused
      // accessor. Refused, doing nothing, with a reason code when that is impossible.
      const plan = planRetry(record, retryEnv);
      if (!plan.ok) return { ok: false, reason: plan.reason, message: retryReasonText(plan.reason) };
      try {
        const ses = sessionFromPartition(plan.partition);
        // Written BEFORE the request so the retried download records the same partition.
        noteSessionPartition(ses, plan.partition);
        ses.downloadURL(plan.url);
      } catch {
        return {
          ok: false,
          reason: RETRY_REASONS.REQUEST_FAILED,
          message: retryReasonText(RETRY_REASONS.REQUEST_FAILED)
        };
      }
    } else if (action === 'open') {
      return openDownload(id);
    } else if (action === 'show') {
      const savePath = record ? record.savePath : null;
      if (savePath) shell.showItemInFolder(savePath);
    }
    return { ok: true };
  });

  registerInternalHandler(ipcMain, 'internal-downloads-clear', () => {
    getDownloadsManager()?.clear();
    return { ok: true };
  });

  return { wireDownloadHandler, noteSessionPartition };
}

module.exports = { registerDownloadIpc };
