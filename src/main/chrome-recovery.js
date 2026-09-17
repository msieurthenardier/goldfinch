// @ts-check
'use strict';

// Mission 20 Flight 3 Leg 3 (DD5/DD6): chrome reload-and-reconcile. A dead
// chrome renderer is reloaded in place (never recreated — the registry
// record's identity is untouched) and every live guest is re-adopted from
// `record.tabViews` once the fresh document re-invokes `window-boot-config`.
// Electron-free (the settings-store.js precedent): every host dependency
// (`now`, `logger`) is injected so this runs offline under `node --test`;
// every Electron handle (`reload`, `setTitle`, `closeSheet`, …) arrives as a
// hook closure the caller (`window-factory.js`) writes, never required here.

const { isBurnerPartition, BURNER } = require('../shared/burner');
const { INTERNAL_PARTITION } = require('../shared/internal-page');
const { effectiveUrl } = require('./tab-entry-url');
const { pushTabStateFor } = require('./register-tab-ipc');

/**
 * Main-side container derivation for a recovery adopt — the strip died with
 * the renderer, so main must rebuild the `{id, name, color, partition}` jar
 * snapshot every `tab-create`/move payload otherwise carries pre-built. Order
 * matters: internal (by `entry.trusted` OR partition identity — NEVER
 * `.trusted` alone downstream, `isInternalTab()`'s own rule) beats burner
 * beats a persistent-jar lookup.
 * @param {any} entry
 * @param {any[]} jarsList
 * @param {any} defaultJar
 * @param {{ warn: (...a: any[]) => void } | undefined} logger
 */
function adoptInputFor(entry, jarsList, defaultJar, logger) {
  const partition = entry.partition;
  if (entry.trusted || partition === INTERNAL_PARTITION) {
    // The page's own host (e.g. 'settings') — NEVER the renderer-only
    // INTERNAL_JAR_NAMES display-name map (tab-controller.js's own trusted-
    // create branch is chrome-side and unreachable from here); `isInternalTab()`
    // reads `container.id === 'internal' || container.partition ===
    // internalPartition`, never `.trusted`, so this exact shape is what keeps
    // a recovered Settings/Downloads/Jars tab rendering as internal rather
    // than a web page with toolbar buttons enabled.
    let name = 'settings';
    try {
      const host = new URL(effectiveUrl(entry)).host;
      if (host) name = host;
    } catch {
      // keep the fallback name
    }
    return { id: 'internal', name, color: '#9aa0ac', partition: INTERNAL_PARTITION };
  }
  if (isBurnerPartition(partition)) {
    // `burner:<n>` → `burner-<n>` (split on ':', reassemble with '-' — the
    // renderer's own `makeBurner()` id namespace uses a hyphen, never a
    // colon). Full fidelity with `makeBurner()`'s own shape (partition +
    // `burner: true`) — every chrome-side burner check
    // (`tab.container.burner`) reads this flag, not the id shape alone.
    const id = partition.split(':').join('-');
    return { id, name: BURNER.name, color: BURNER.color, partition, burner: true };
  }
  const jar = jarsList.find((j) => j.partition === partition);
  if (jar) return { id: jar.id, name: jar.name, color: jar.color, partition: jar.partition };
  // The jar was deleted mid-session — fall back to the default jar's
  // snapshot (logged; `jars.getDefault()` may return the bare BURNER
  // sentinel with no `partition` when Burner holds the default — the
  // guest's real session partition is unaffected by this UI-facing fallback).
  logger?.warn?.('[chrome-recovery] no jar matches partition at recovery, falling back to default jar:', partition);
  return {
    id: defaultJar.id,
    name: defaultJar.name,
    color: defaultJar.color,
    partition: defaultJar.partition ?? partition
  };
}

/**
 * @param {any} entry
 */
function titleFor(entry) {
  const wc = entry.view.webContents;
  const liveTitle = !wc.isDestroyed() && wc.getTitle();
  if (liveTitle) return liveTitle;
  try {
    return new URL(effectiveUrl(entry)).host || '';
  } catch {
    return '';
  }
}

/**
 * @param {{ now?: () => number, logger?: { warn: (...a: any[]) => void }, windowMs?: number, maxReloads?: number }} [deps]
 */
function createChromeRecovery({ now = Date.now, logger, windowMs = 60_000, maxReloads = 3 } = {}) {
  /**
   * @param {any} record
   * @param {{ reason?: string, exitCode?: number } | null | undefined} details
   * @param {{ windowId: number, closeSheet: (reason: string) => void, hideFind: () => void, hideTearoff: () => void, reload: () => void, setTitle: (t: string) => void, onCrash?: (e: any) => void }} hooks
   * @returns {'ignored' | 'reloaded' | 'paused'}
   */
  function onChromeGone(record, details, hooks) {
    const { reason, exitCode } = details || {};
    const { windowId, closeSheet, hideFind, hideTearoff, reload, setTitle, onCrash } = hooks;
    if (reason === 'clean-exit') return 'ignored';

    record.chromeCrashTimes ??= [];
    record.chromeRecoveryPaused ??= false;

    if (record.chromeRecoveryPaused) {
      onCrash?.({ kind: 'chrome', reason, exitCode, url: null, partition: null, windowId, recovery: 'ignored' });
      return 'ignored';
    }

    const t = now();
    record.chromeCrashTimes.push(t);
    record.chromeCrashTimes = record.chromeCrashTimes.filter((x) => t - x <= windowMs);

    if (record.chromeCrashTimes.length > maxReloads) {
      // The pause is for the WINDOW'S LIFETIME (DD6) — later crashes on this
      // record hit the `chromeRecoveryPaused` branch above forever; no
      // re-arm exists.
      record.chromeRecoveryPaused = true;
      // Acceptance-run fix pass F1: the chrome is dead and will never reload
      // again for this record's lifetime, so there is no live document behind
      // it — `bootConfigServed` must go false here too (only the reload
      // branch above used to clear it). `listWindows().booted` /
      // `window-census.js`'s `booted` field both mirror this flag, and
      // `automation/tabs.js`'s `enumerateTabs` skips any window whose
      // `booted` is false — without this, a paused window kept reporting
      // `booted: true` and every `enumerateTabs`/`readDom`-class call against
      // it hung on `executeJavaScript` against a chrome with no renderer.
      record.bootConfigServed = false;
      setTitle('Goldfinch — chrome crashed (recovery paused)');
      onCrash?.({ kind: 'chrome', reason, exitCode, url: null, partition: null, windowId, recovery: 'paused' });
      return 'paused';
    }

    closeSheet('teardown');
    hideFind();
    hideTearoff();
    // Spike (g): a crashed chrome's `reload()` does NOT reset this flag
    // itself — `window-boot-config`'s existing invoke re-fires with the OLD
    // `bootConfigServed === true`, which would send every queued/live push
    // straight through instead of queuing it for the recovery adopts.
    record.bootConfigServed = false;
    record.recoverTabs = true;

    // Exactly ONE record per event: the outcome is only known after the
    // attempt, so `onCrash` fires once, after, carrying whichever outcome
    // actually happened.
    /** @type {'ignored' | 'reloaded' | 'paused'} */
    let outcome = 'reloaded';
    try {
      reload();
    } catch {
      // A destroyed wc (window closing mid-crash) — never let this throw
      // into the render-process-gone listener.
      outcome = 'ignored';
    }
    onCrash?.({ kind: 'chrome', reason, exitCode, url: null, partition: null, windowId, recovery: outcome });
    return outcome;
  }

  /**
   * Ordered `[channel, payload]` pairs to send directly (never queued — this
   * runs INSIDE `window-boot-config`'s own handler, before the boot flag is
   * even set true) once per `record.tabViews` entry, insertion order: one
   * `adopt-tab` (container derived main-side, `active`/`trusted` stamped),
   * then the shared re-push set (`pushTabStateFor`).
   * @param {any} record
   * @param {{ jarsList: any[], defaultJar: any, buildAdoptPayload: Function, logger?: { warn: (...a: any[]) => void } }} ctx
   * @returns {[string, any][]}
   */
  function buildRecoveryAdopts(record, ctx) {
    const { jarsList, defaultJar, buildAdoptPayload, logger: ctxLogger } = ctx;
    const out = [];
    const send = (/** @type {string} */ channel, /** @type {() => any} */ build) => out.push([channel, build()]);
    for (const [wcId, entry] of record.tabViews) {
      const wc = entry.view.webContents;
      const container = adoptInputFor(entry, jarsList, defaultJar, ctxLogger || logger);
      const url = effectiveUrl(entry);
      const title = titleFor(entry);
      // Favicon is a documented drop (it refreshes at the tab's next
      // navigation) — main never persisted one for the entry.
      const payload = buildAdoptPayload({ wcId, url, title, favicon: null, container, trusted: !!entry.trusted }, wc);
      payload.active = wcId === record.activeTabWcId;
      out.push(['adopt-tab', payload]);
      pushTabStateFor(record, wcId, entry, wc, send);
    }
    return out;
  }

  return { onChromeGone, buildRecoveryAdopts };
}

module.exports = { createChromeRecovery, adoptInputFor };
