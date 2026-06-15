'use strict';

/**
 * settings.js — scroll-spy progressive enhancement.
 *
 * Sets aria-current="true" on the nav link whose section is currently in the
 * viewport; removes it from all other links. Pure enhancement: the page is
 * fully navigable without this script (native anchor links carry navigation).
 *
 * CSP: served as a same-origin subresource under default-src 'self' (no
 * 'unsafe-inline'). No inline event handlers; no dynamic script injection.
 */

/* ---- shared helpers (file-scope, hoisted; visible to every IIFE below) ---- */

/**
 * Copy text to the clipboard with a graceful fallback (DD4). Tries the secure
 * web clipboard API first; on throw/rejection (it can be blocked at runtime
 * under contextIsolation + sandbox) falls back to the internal clipboardWrite
 * IPC. Shows a transient "Copied" / "Copy failed" message in messageEl. Declared
 * at file scope (not in any IIFE) so leg 3's key-copy IIFE calls it directly.
 * @param {string} text
 * @param {HTMLElement|null} [messageEl]
 * @returns {Promise<void>}
 */
async function copyText(text, messageEl) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    try {
      await window.goldfinchInternal.clipboardWrite(text);
    } catch {
      if (messageEl) messageEl.textContent = 'Copy failed';
      return;
    }
  }
  if (messageEl) messageEl.textContent = 'Copied';
}

(function () {
  // Collect all sections that have a corresponding nav link.
  const sections = Array.from(document.querySelectorAll('main section[id]'));
  const navLinks = Array.from(
    document.querySelectorAll('nav[aria-label="Settings sections"] a[href^="#"]')
  );

  if (!sections.length || !navLinks.length) return;

  // Build a map from section id → nav link element.
  /** @type {Map<string, HTMLAnchorElement>} */
  const linkMap = new Map();
  for (const link of navLinks) {
    const id = link.getAttribute('href').slice(1); // strip leading '#'
    linkMap.set(id, /** @type {HTMLAnchorElement} */ (link));
  }

  /**
   * Mark the given section's nav link as current; clear all others.
   * @param {string} activeId
   */
  function setActive(activeId) {
    for (const [id, link] of linkMap) {
      if (id === activeId) {
        link.setAttribute('aria-current', 'true');
      } else {
        link.removeAttribute('aria-current');
      }
    }
  }

  // Track which sections are intersecting.
  /** @type {Set<string>} */
  const visible = new Set();

  const observer = new IntersectionObserver(
    function (entries) {
      for (const entry of entries) {
        const id = entry.target.id;
        if (entry.isIntersecting) {
          visible.add(id);
        } else {
          visible.delete(id);
        }
      }

      // Activate the first section (in document order) that is currently visible.
      for (const section of sections) {
        if (visible.has(section.id)) {
          setActive(section.id);
          return;
        }
      }
      // Nothing visible — leave the last active link as-is (avoids flash on fast scroll).
    },
    {
      // Trigger when a section crosses the midpoint of the viewport.
      rootMargin: '0px 0px -50% 0px',
      threshold: 0
    }
  );

  for (const section of sections) {
    observer.observe(section);
  }
})();

/* ---- home-page controller ---- */

(function () {
  // Guard: only run when the internal bridge is present (goldfinch://settings origin).
  if (!window.goldfinchInternal) return;

  const input = /** @type {HTMLInputElement|null} */ (document.getElementById('home-page-input'));
  const saveBtn = /** @type {HTMLButtonElement|null} */ (document.getElementById('home-page-save'));
  const status = /** @type {HTMLElement|null} */ (document.getElementById('home-page-status'));

  if (!input || !saveBtn || !status) return;

  // Populate the input with the persisted home page on load.
  window.goldfinchInternal.settingsGet('homePage').then((v) => {
    if (v) input.value = v;
  });

  // Save button: write the new home page via the origin-locked bridge.
  saveBtn.addEventListener('click', () => {
    window.goldfinchInternal.settingsSet('homePage', input.value)
      .then(() => {
        status.textContent = 'Saved';
      })
      .catch((e) => {
        status.textContent = 'Not saved: ' + (e && e.message ? e.message : 'invalid URL');
      });
  });

  // Keep the input in sync when settings change from another surface (e.g. future chrome UI).
  // Capture the handle so we can remove this listener on pagehide (DD5: prevents accumulation
  // across reloads — pagehide fires in the OLD document context where handle + wrapper are valid).
  const hSettings = window.goldfinchInternal.onSettingsChanged((all) => {
    if (!input) return;
    if (all && all.homePage) input.value = all.homePage;
  });
  window.addEventListener('pagehide', () => window.goldfinchInternal.offSettingsChanged(hSettings), { once: true });
})();

/* ---- shields controller ---- */

(function () {
  // Guard: only run when the internal bridge is present (goldfinch://settings origin).
  if (!window.goldfinchInternal) return;

  /** @type {Array<'enabled'|'block'|'strip'|'isolate'|'farble'>} */
  const KEYS = ['enabled', 'block', 'strip', 'isolate', 'farble'];

  /**
   * Apply a Shields config object to the checkboxes. Assigns .checked directly —
   * never .click() or dispatchEvent(new Event('change')), which would echo-loop.
   * @param {object} cfg
   */
  function applyConfig(cfg) {
    if (!cfg) return;
    for (const key of KEYS) {
      const el = /** @type {HTMLInputElement|null} */ (document.getElementById('shield-' + key));
      if (!el) continue;
      el.checked = !!cfg[key];
    }
  }

  // Populate checkboxes from the persisted shields config on load.
  window.goldfinchInternal.shieldsGet().then(applyConfig);

  // Wire each checkbox's change event to write via the origin-locked bridge.
  for (const key of KEYS) {
    const el = /** @type {HTMLInputElement|null} */ (document.getElementById('shield-' + key));
    if (!el) continue;
    el.addEventListener('change', () => {
      window.goldfinchInternal.shieldsSet({ [key]: el.checked });
    });
  }

  // Re-sync when the panel (or another surface) fires shields-changed.
  // Capture the handle so we can remove this listener on pagehide (DD5: prevents accumulation
  // across reloads — pagehide fires in the OLD document context where handle + wrapper are valid).
  const hShields = window.goldfinchInternal.onShieldsChanged(applyConfig);
  window.addEventListener('pagehide', () => window.goldfinchInternal.offShieldsChanged(hShields), { once: true });
})();

/* ---- appearance pins controller ---- */

(function () {
  // Guard: only run when the internal bridge is present (goldfinch://settings origin).
  if (!window.goldfinchInternal) return;

  const btns = {
    media: /** @type {HTMLButtonElement|null} */ (document.getElementById('pin-media')),
    shields: /** @type {HTMLButtonElement|null} */ (document.getElementById('pin-shields'))
  };
  if (!btns.media || !btns.shields) return;

  /** @type {{ media: boolean, shields: boolean }} */
  let current = { media: true, shields: true };

  /**
   * Apply a toolbarPins object to the toggle buttons: sets aria-pressed on each
   * and caches the value for use by the click handler's spread.
   * @param {{ media: boolean, shields: boolean }} pins
   */
  function apply(pins) {
    current = pins;
    for (const k of /** @type {Array<'media'|'shields'>} */ (['media', 'shields'])) {
      btns[k].setAttribute('aria-pressed', String(!!pins[k]));
    }
  }

  // Populate from the persisted toolbarPins on load.
  window.goldfinchInternal.settingsGet('toolbarPins').then(apply).catch(() => {});

  // Click handler: flip the pin for the clicked key, write the full map.
  // settingsSet resolves to the full config object, not the toolbarPins value, so apply
  // the locally-computed `next` (a clean {media,shields} map) — never the resolution.
  for (const k of /** @type {Array<'media'|'shields'>} */ (['media', 'shields'])) {
    btns[k].addEventListener('click', () => {
      const next = { ...current, [k]: !current[k] };
      window.goldfinchInternal.settingsSet('toolbarPins', next)
        .then(() => apply(next))
        .catch(() => {});
    });
  }

  // Two-way sync: a right-click Unpin (leg 3) or another surface change re-syncs here.
  // Capture the handle so we can remove this listener on pagehide (DD5: prevents accumulation
  // across reloads — pagehide fires in the OLD document context where handle + wrapper are valid).
  const h = window.goldfinchInternal.onSettingsChanged((all) => {
    if (all && all.toolbarPins) apply(all.toolbarPins);
  });
  window.addEventListener('pagehide', () => window.goldfinchInternal.offSettingsChanged(h), { once: true });
})();

/* ---- automation controller ---- */

(function () {
  // Guard: only run when the internal bridge is present (goldfinch://settings origin).
  if (!window.goldfinchInternal) return;

  const enabledToggle = /** @type {HTMLInputElement|null} */ (document.getElementById('automation-enabled'));
  const enabledNote = /** @type {HTMLElement|null} */ (document.getElementById('automation-enabled-note'));
  const statusLine = /** @type {HTMLElement|null} */ (document.getElementById('automation-status'));
  const addressInput = /** @type {HTMLInputElement|null} */ (document.getElementById('automation-address'));
  const copyBtn = /** @type {HTMLButtonElement|null} */ (document.getElementById('automation-copy-address'));
  const portInput = /** @type {HTMLInputElement|null} */ (document.getElementById('automation-port'));
  const portSaveBtn = /** @type {HTMLButtonElement|null} */ (document.getElementById('automation-port-save'));
  const findPortBtn = /** @type {HTMLButtonElement|null} */ (document.getElementById('automation-find-port'));
  const portNote = /** @type {HTMLElement|null} */ (document.getElementById('automation-port-note'));
  const messageEl = /** @type {HTMLElement|null} */ (document.getElementById('automation-message'));

  if (
    !enabledToggle || !enabledNote || !statusLine || !addressInput || !copyBtn ||
    !portInput || !portSaveBtn || !findPortBtn || !portNote || !messageEl
  ) {
    return;
  }

  // Module-local copy of the last status so onSettingsChanged can recompute the
  // pending-port note against the *active* bind (the note gates on status.bound).
  /** @type {{ enabled: boolean, host: string, port: number, bound: boolean, error: (string|null) }|null} */
  let lastStatus = null;

  /**
   * Recompute the pending-port annotation. Shows "(takes effect on next launch)"
   * ONLY when the surface is bound AND the entered/pending port differs from the
   * active port — gating on `bound` avoids a misleading note when nothing is
   * running (AC6).
   */
  function recomputePortNote() {
    portNote.textContent =
      lastStatus && lastStatus.bound && Number(portInput.value) !== lastStatus.port
        ? '(takes effect on next launch)'
        : '';
  }

  /**
   * Render the automation status into the address, status line, enabled-note,
   * and port note (AC4 / AC5).
   * @param {{ enabled: boolean, host: string, port: number, bound: boolean, error: (string|null) }} status
   */
  function renderStatus(status) {
    if (!status) return;
    lastStatus = status;
    // Host is always loopback (SC7); the address always renders the resolved port
    // so the operator can pre-configure their client even when not bound.
    addressInput.value = 'http://127.0.0.1:' + status.port + '/mcp';

    if (status.bound) {
      statusLine.textContent = 'Connected — listening on 127.0.0.1:' + status.port;
    } else if (status.enabled && status.error) {
      statusLine.textContent = 'Failed to bind: ' + status.error;
    } else {
      statusLine.textContent =
        'Not running — start Goldfinch with `--automation-dev` to bind the surface';
    }

    // Toggle-honesty (AC5): the automationEnabled setting only gates auth on an
    // already-running server; the server binds only under --automation-dev. When
    // the surface is not enabled at runtime, explain why flipping the toggle ON
    // won't bind this launch.
    enabledNote.textContent = status.enabled
      ? ''
      : 'Takes effect when Goldfinch is launched with `--automation-dev`.';

    recomputePortNote();
  }

  // Initial load: status, then the persisted toggle + pending port.
  window.goldfinchInternal.automationGetStatus().then(renderStatus).catch(() => {});
  window.goldfinchInternal.settingsGet('automationEnabled').then((v) => {
    enabledToggle.checked = !!v;
  }).catch(() => {});
  window.goldfinchInternal.settingsGet('automationPort').then((p) => {
    if (p != null) portInput.value = String(p);
    recomputePortNote();
  }).catch(() => {});

  // Enable toggle: write on change. No status re-fetch — a setting flip does not
  // change status.enabled in a non-dev build, so the enabled-note stays correct.
  enabledToggle.addEventListener('change', () => {
    window.goldfinchInternal.settingsSet('automationEnabled', enabledToggle.checked)
      .then(() => { messageEl.textContent = ''; })
      .catch((e) => {
        messageEl.textContent = 'Not saved: ' + (e && e.message ? e.message : 'error');
      });
  });

  // Port save: write, then refresh status (so the note recomputes against the
  // active bind). A validator rejection surfaces inline; the field keeps the
  // user's text for correction.
  portSaveBtn.addEventListener('click', () => {
    window.goldfinchInternal.settingsSet('automationPort', Number(portInput.value))
      .then(() => {
        messageEl.textContent = 'Saved';
        return window.goldfinchInternal.automationGetStatus().then(renderStatus);
      })
      .catch(() => {
        messageEl.textContent = 'Invalid port (1024–65535)';
      });
  });

  // Find free port: populate the field with the scanned port and save it; on a
  // null result the field is left unchanged.
  findPortBtn.addEventListener('click', () => {
    window.goldfinchInternal.automationFindFreePort()
      .then((res) => {
        const port = res && res.port;
        if (port == null) {
          messageEl.textContent = 'no free port found';
          return undefined;
        }
        portInput.value = String(port);
        return window.goldfinchInternal.settingsSet('automationPort', port)
          .then(() => {
            messageEl.textContent = 'Saved';
            return window.goldfinchInternal.automationGetStatus().then(renderStatus);
          });
      })
      .catch(() => {
        messageEl.textContent = 'Invalid port (1024–65535)';
      });
  });

  // Recompute the note as the operator edits the port (before saving).
  portInput.addEventListener('input', recomputePortNote);

  // Copy the displayed address via the shared helper (navigator.clipboard with
  // the clipboardWrite IPC fallback — AC7).
  copyBtn.addEventListener('click', () => {
    copyText(addressInput.value, messageEl);
  });

  // Two-way sync: another surface changing the setting re-syncs here.
  // Capture the handle so we can remove this listener on pagehide (DD5: prevents
  // accumulation across reloads).
  const hSettings = window.goldfinchInternal.onSettingsChanged((all) => {
    if (!all) return;
    if (all.automationEnabled != null) enabledToggle.checked = !!all.automationEnabled;
    if (all.automationPort != null) {
      portInput.value = String(all.automationPort);
      recomputePortNote();
    }
  });
  window.addEventListener('pagehide', () => window.goldfinchInternal.offSettingsChanged(hSettings), { once: true });
})();

/* ---- automation key management controller (Leg 3) ---- */

(function () {
  // The bridge only exists on the genuine goldfinch://settings origin.
  if (!window.goldfinchInternal) return;

  const jarsContainer = /** @type {HTMLElement|null} */ (document.getElementById('automation-jars'));
  const revealEl = /** @type {HTMLElement|null} */ (document.getElementById('automation-key-reveal'));
  const keyValue = /** @type {HTMLInputElement|null} */ (document.getElementById('automation-key-value'));
  const keyCopyBtn = /** @type {HTMLButtonElement|null} */ (document.getElementById('automation-key-copy'));
  const keyMessageEl = /** @type {HTMLElement|null} */ (document.getElementById('automation-key-message'));
  const adminBlock = /** @type {HTMLElement|null} */ (document.getElementById('automation-admin'));
  const adminStatus = /** @type {HTMLElement|null} */ (document.getElementById('automation-admin-status'));
  const adminMintBtn = /** @type {HTMLButtonElement|null} */ (document.getElementById('automation-admin-mint'));
  const adminRevokeBtn = /** @type {HTMLButtonElement|null} */ (document.getElementById('automation-admin-revoke'));

  if (
    !jarsContainer || !revealEl || !keyValue || !keyCopyBtn || !keyMessageEl ||
    !adminBlock || !adminStatus || !adminMintBtn || !adminRevokeBtn
  ) {
    return;
  }

  const bridge = window.goldfinchInternal;

  /**
   * Show an inline error in the key message line. Does NOT reveal a key.
   * @param {unknown} e
   */
  function showErr(e) {
    keyMessageEl.textContent = 'Error: ' + (e && /** @type {any} */ (e).message ? /** @type {any} */ (e).message : 'failed');
  }

  /**
   * Clear and hide the show-once reveal. Called at the START of every mint/revoke
   * action and on init — NEVER by refresh()/renderJars/renderAdmin (AC8: the
   * post-mint list rebuild must not be able to wipe a just-shown key).
   */
  function clearReveal() {
    keyValue.value = '';
    keyMessageEl.textContent = '';
    revealEl.hidden = true;
  }

  /**
   * Populate and show the reveal with the show-once plaintext. The LAST write on
   * a mint resolve (after refresh() completes). The key is never stored anywhere
   * else — it lives only in this readonly field until the next clearReveal().
   * @param {string} key
   */
  function reveal(key) {
    keyValue.value = key;
    keyMessageEl.textContent = '';
    revealEl.hidden = false;
  }

  /**
   * Rebuild the jars list. Built with createElement + textContent (NOT innerHTML)
   * because jar names are user-controlled. NEVER touches the reveal (AC8).
   * @param {Array<{ id: string, name: string, color: string, hasKey: boolean }>} jars
   */
  function renderJars(jars) {
    jarsContainer.textContent = '';
    for (const jar of jars) {
      const row = document.createElement('div');
      row.className = 'settings-row jar-row';

      const swatch = document.createElement('span');
      swatch.className = 'jar-swatch';
      swatch.style.backgroundColor = jar.color;
      row.appendChild(swatch);

      const name = document.createElement('span');
      name.className = 'jar-name';
      name.textContent = jar.name;
      row.appendChild(name);

      const status = document.createElement('span');
      status.className = 'muted jar-key-status';
      status.textContent = jar.hasKey ? 'key set' : 'no key';
      row.appendChild(status);

      const mintBtn = document.createElement('button');
      mintBtn.className = 'settings-btn';
      mintBtn.type = 'button';
      mintBtn.textContent = jar.hasKey ? 'Rotate key' : 'Generate key';
      mintBtn.addEventListener('click', () => {
        clearReveal();
        bridge.automationJarKeyMint(jar.id)
          .then(({ key }) => refresh().then(() => reveal(key)))
          .catch(showErr);
      });
      row.appendChild(mintBtn);

      const revokeBtn = document.createElement('button');
      revokeBtn.className = 'settings-btn';
      revokeBtn.type = 'button';
      revokeBtn.textContent = 'Revoke';
      revokeBtn.disabled = !jar.hasKey;
      revokeBtn.addEventListener('click', () => {
        clearReveal();
        bridge.automationJarKeyRevoke(jar.id).then(refresh).catch(showErr);
      });
      row.appendChild(revokeBtn);

      jarsContainer.appendChild(row);
    }
  }

  /**
   * Render the env-gated admin block. NEVER touches the reveal (AC8). The block
   * stays hidden unless the GOLDFINCH_AUTOMATION_ADMIN env gate is set.
   * @param {boolean} adminEnabled
   * @param {boolean} adminKeySet
   */
  function renderAdmin(adminEnabled, adminKeySet) {
    adminBlock.hidden = !adminEnabled;
    if (!adminEnabled) return;
    adminStatus.textContent = adminKeySet ? 'Admin key set' : 'No admin key';
    adminMintBtn.textContent = adminKeySet ? 'Rotate admin key' : 'Generate admin key';
    adminRevokeBtn.disabled = !adminKeySet;
  }

  /**
   * Pull fresh key state and rebuild the list + admin DOM. Returns the promise so
   * callers can sequence reveal(key) AFTER the rebuild. Does NOT clear/set the
   * reveal (AC8).
   * @returns {Promise<void>}
   */
  function refresh() {
    return bridge.automationListKeys().then(({ jars, adminEnabled, adminKeySet }) => {
      renderJars(jars);
      renderAdmin(adminEnabled, adminKeySet);
    });
  }

  // Admin mint: clear reveal first, refresh, then reveal the plaintext last. A
  // null key (env gate unset — defense-in-depth) shows no reveal.
  adminMintBtn.addEventListener('click', () => {
    clearReveal();
    bridge.automationAdminKeyMint()
      .then(({ key }) => refresh().then(() => { if (key) reveal(key); }))
      .catch(showErr);
  });

  adminRevokeBtn.addEventListener('click', () => {
    clearReveal();
    bridge.automationAdminKeyRevoke().then(refresh).catch(showErr);
  });

  // Copy the show-once key via the shared helper (navigator.clipboard with the
  // clipboardWrite IPC fallback — DD4).
  keyCopyBtn.addEventListener('click', () => {
    copyText(keyValue.value, keyMessageEl);
  });

  // Initial load — reveal stays hidden (it is only ever populated by a mint).
  clearReveal();
  refresh().catch(() => {});
})();

/* ---- automation activity viewer (Leg 4 / SC10 / DD6) ---- */

(function () {
  // The bridge only exists on the genuine goldfinch://settings origin.
  if (!window.goldfinchInternal) return;

  const sessionsEl = /** @type {HTMLElement|null} */ (document.getElementById('automation-active-sessions'));
  const logEl = /** @type {HTMLElement|null} */ (document.getElementById('automation-activity-log'));
  if (!sessionsEl || !logEl) return;

  const bridge = window.goldfinchInternal;

  // jarId → display name. Seeded from list-keys (which carries id+name for every
  // persistent jar); falls back to the raw jarId for an unknown jar. jarId is
  // operator-controlled, so it is only ever rendered via textContent.
  /** @type {Map<string, string>} */
  const jarNames = new Map();
  bridge.automationListKeys()
    .then((info) => {
      if (info && Array.isArray(info.jars)) {
        for (const j of info.jars) jarNames.set(j.id, j.name);
      }
      // Re-render so any session whose snapshot arrived before the names loaded
      // picks up the friendly jar name.
      if (lastSnap) renderActivity(lastSnap);
    })
    .catch(() => {});

  /**
   * @param {string|null} jarId
   * @returns {string}
   */
  function jarDisplayName(jarId) {
    if (jarId == null) return 'jar';
    return jarNames.get(jarId) || jarId;
  }

  /**
   * Format an epoch-ms timestamp for display (local time). Display-only.
   * @param {number} ts
   * @returns {string}
   */
  function fmtTime(ts) {
    const d = new Date(ts);
    return Number.isNaN(d.getTime()) ? '—' : d.toLocaleTimeString();
  }

  /**
   * Append a one-line empty-state row to a container.
   * @param {HTMLElement} container
   * @param {string} text
   */
  function emptyLine(container, text) {
    const p = document.createElement('p');
    p.className = 'muted activity-empty';
    p.textContent = text;
    container.appendChild(p);
  }

  // Cap on rendered log rows — bounds DOM work under rapid per-mutation broadcasts.
  const LOG_DISPLAY_CAP = 50;
  /** @type {{ sessions?: any[], log?: any[] }|null} */
  let lastSnap = null;

  /**
   * Rebuild both lists from an activity snapshot. Admin vs jar is visually
   * distinguished; error log rows are distinct. All audit-derived strings
   * (identity, jarId, op, errorCode) are inserted via textContent / createElement —
   * never innerHTML — because jar names are operator-controlled (AC7).
   * @param {{ sessions?: any[], log?: any[] }} snap
   */
  function renderActivity(snap) {
    lastSnap = snap || {};
    const sessions = (lastSnap.sessions) || [];
    const log = (lastSnap.log) || [];

    // --- active sessions ---
    sessionsEl.textContent = '';
    if (!sessions.length) {
      emptyLine(sessionsEl, 'No automation sessions');
    } else {
      for (const s of sessions) {
        const row = document.createElement('div');
        row.className = 'activity-session';
        const isAdmin = s.kind === 'admin';
        if (isAdmin) row.classList.add('admin');

        const kind = document.createElement('span');
        kind.className = 'activity-kind';
        kind.textContent = isAdmin ? 'admin' : 'jar';
        row.appendChild(kind);

        const name = document.createElement('span');
        name.className = 'activity-name';
        name.textContent = isAdmin ? 'app / chrome' : jarDisplayName(s.jarId);
        row.appendChild(name);

        const since = document.createElement('span');
        since.className = 'activity-since muted';
        since.textContent = 'connected since ' + fmtTime(s.since);
        row.appendChild(since);

        sessionsEl.appendChild(row);
      }
    }

    // --- recent action log (newest-first; the contract is newest-last) ---
    logEl.textContent = '';
    if (!log.length) {
      emptyLine(logEl, 'No recent activity');
    } else {
      const rows = log.slice().reverse().slice(0, LOG_DISPLAY_CAP);
      for (const e of rows) {
        const row = document.createElement('div');
        row.className = 'activity-log-row';
        if (e.outcome === 'error') row.classList.add('error');

        const time = document.createElement('span');
        time.className = 'activity-log-time muted';
        time.textContent = fmtTime(e.ts);
        row.appendChild(time);

        const op = document.createElement('span');
        op.className = 'activity-log-op';
        op.textContent = e.op;
        row.appendChild(op);

        const identity = document.createElement('span');
        identity.className = 'activity-log-identity';
        identity.textContent = e.identity;
        row.appendChild(identity);

        const outcome = document.createElement('span');
        outcome.className = 'activity-log-outcome';
        outcome.textContent = e.outcome === 'error'
          ? ('error' + (e.errorCode ? ': ' + e.errorCode : ''))
          : 'ok';
        row.appendChild(outcome);

        logEl.appendChild(row);
      }
    }
  }

  // Initial snapshot (catches sessions/log present before this page loaded) + live
  // updates. Listener removed on pagehide to prevent accumulation across reloads.
  bridge.automationGetActivity().then(renderActivity).catch(() => {});
  const h = bridge.onAutomationActivity(renderActivity);
  window.addEventListener('pagehide', () => bridge.offAutomationActivity(h), { once: true });
})();
