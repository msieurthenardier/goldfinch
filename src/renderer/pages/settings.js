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
    shields: /** @type {HTMLButtonElement|null} */ (document.getElementById('pin-shields')),
    devtools: /** @type {HTMLButtonElement|null} */ (document.getElementById('pin-devtools'))
  };
  if (!btns.media || !btns.shields || !btns.devtools) return;

  /** @type {{ media: boolean, shields: boolean, devtools: boolean }} */
  let current = { media: true, shields: true, devtools: false };

  /**
   * Apply a toolbarPins object to the toggle buttons: sets aria-pressed on each
   * and caches the value for use by the click handler's spread.
   * @param {{ media: boolean, shields: boolean, devtools: boolean }} pins
   */
  function apply(pins) {
    current = pins;
    for (const k of /** @type {Array<'media'|'shields'|'devtools'>} */ (['media', 'shields', 'devtools'])) {
      btns[k].setAttribute('aria-pressed', String(!!pins[k]));
    }
  }

  // Populate from the persisted toolbarPins on load.
  window.goldfinchInternal.settingsGet('toolbarPins').then(apply).catch(() => {});

  // Click handler: flip the pin for the clicked key, write the full map.
  // settingsSet resolves to the full config object, not the toolbarPins value, so apply
  // the locally-computed `next` (a clean {media,shields} map) — never the resolution.
  for (const k of /** @type {Array<'media'|'shields'|'devtools'>} */ (['media', 'shields', 'devtools'])) {
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
  const configCodeEl = /** @type {HTMLElement|null} */ (document.getElementById('automation-mcp-config'));
  const copyConfigBtn = /** @type {HTMLButtonElement|null} */ (document.getElementById('automation-copy-config'));

  if (
    !enabledToggle || !enabledNote || !statusLine || !addressInput || !copyBtn ||
    !portInput || !portSaveBtn || !findPortBtn || !portNote || !messageEl ||
    !configCodeEl || !copyConfigBtn
  ) {
    return;
  }

  // Module-local copy of the last status so onSettingsChanged can recompute the
  // pending-port note against the *active* bind (the note gates on status.bound).
  /** @type {{ enabled: boolean, host: string, port: number, bound: boolean, error: (string|null) }|null} */
  let lastStatus = null;

  // The currently-persisted/active port — used to drive Save button dirty state.
  // Seeded on initial load from the persisted setting (preferred) or the active
  // status port (fallback), whichever resolves first.
  /** @type {number|null} */
  let savedPort = null;

  /** @param {string} v @returns {boolean} */
  function isValidPort(v) {
    const n = Number(v);
    return Number.isInteger(n) && n >= 1024 && n <= 65535;
  }

  /** Sync the Save button disabled state to the dirty / validity check. */
  function updatePortSaveDirty() {
    const v = portInput.value;
    portSaveBtn.disabled = !(isValidPort(v) && Number(v) !== savedPort);
  }

  /**
   * Recompute the pending-port annotation. Shows "(unsaved — applies on Save)"
   * ONLY when the surface is bound AND the entered/pending port differs from the
   * active port — gating on `bound` avoids a misleading note when nothing is
   * running (AC6).
   */
  function recomputePortNote() {
    portNote.textContent =
      lastStatus && lastStatus.bound && Number(portInput.value) !== lastStatus.port
        ? '(unsaved — applies on Save)'
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

    // MCP client config block (Claude Code `.mcp.json` http-server form, matching
    // docs/mcp-automation.md). Built from the live status.port (host always
    // loopback) so the operator can copy a ready-to-paste config. The
    // Authorization value is a literal placeholder — never a real key. Written via
    // textContent (never innerHTML) so the JSON renders verbatim.
    const mcpConfig = {
      mcpServers: {
        goldfinch: {
          type: 'http',
          url: 'http://127.0.0.1:' + status.port + '/mcp',
          headers: { Authorization: 'Bearer <your-key>' },
        },
      },
    };
    configCodeEl.textContent = JSON.stringify(mcpConfig, null, 2);

    if (status.bound) {
      statusLine.textContent = 'Connected — listening on 127.0.0.1:' + status.port;
    } else if (status.enabled && status.error) {
      statusLine.textContent = 'Failed to bind: ' + status.error;
    } else {
      // DD2 (Flight 8): the Automation toggle is the sole bind gate — flipping it on
      // binds the surface live (no launch flag needed).
      statusLine.textContent =
        'Not running — turn on the Automation toggle to bind the surface';
    }

    // DD2 (Flight 8): the toggle binds the surface live — a flip takes effect
    // immediately, so there is no "launch with a flag" caveat to surface.
    enabledNote.textContent = status.enabled
      ? ''
      : 'Binds the local automation surface.';

    recomputePortNote();
  }

  // Initial load: status, then the persisted toggle + pending port.
  // savedPort is seeded from whichever path resolves first; the second path
  // overwrites it so the persisted setting always wins when both complete.
  window.goldfinchInternal.automationGetStatus().then((status) => {
    renderStatus(status);
    // Fallback: if the persisted-port path hasn't resolved yet, use the active
    // port as the baseline so Save starts disabled.
    if (savedPort === null && status && status.port != null) {
      savedPort = status.port;
      portInput.value = String(status.port);
      updatePortSaveDirty();
    }
  }).catch(() => {});
  window.goldfinchInternal.settingsGet('automationEnabled').then((v) => {
    enabledToggle.checked = !!v;
  }).catch(() => {});
  window.goldfinchInternal.settingsGet('automationPort').then((p) => {
    if (p != null) {
      // Persisted setting is the authoritative baseline — overwrite whatever
      // the status path may have set so the field and dirty check agree.
      savedPort = Number(p);
      portInput.value = String(p);
    }
    recomputePortNote();
    updatePortSaveDirty();
  }).catch(() => {});

  // Enable toggle: write on change, then re-fetch status. DD2 (Flight 8): the toggle
  // is the sole bind gate, so a flip now DOES change the bind state live (ON →
  // start-from-null, OFF → stop-and-stay-stopped). Re-fetch after settingsSet resolves
  // so the status-line/address reflect the now-bound/unbound surface.
  enabledToggle.addEventListener('change', () => {
    window.goldfinchInternal.settingsSet('automationEnabled', enabledToggle.checked)
      .then(() => {
        messageEl.textContent = '';
        window.goldfinchInternal.automationGetStatus().then(renderStatus).catch(() => {});
      })
      .catch((e) => {
        messageEl.textContent = 'Not saved: ' + (e && e.message ? e.message : 'error');
      });
  });

  // Port save: persist + live-rebind in one IPC (Leg 7). set-port returns the fresh
  // status, so after a successful rebind status.port equals the new port and
  // renderStatus updates the address/config/status line live (the "unsaved" note
  // clears as pending == active). A validator rejection surfaces inline; the field
  // keeps the user's text for correction.
  portSaveBtn.addEventListener('click', () => {
    window.goldfinchInternal.automationSetPort(Number(portInput.value))
      .then((status) => {
        messageEl.textContent = 'Saved';
        renderStatus(status);
        // Advance the baseline to the now-active port so Save returns to
        // disabled (clean signal the save registered).
        savedPort = status.port;
        portInput.value = String(status.port);
        updatePortSaveDirty();
      })
      .catch(() => {
        messageEl.textContent = 'Invalid port (1024–65535)';
      });
  });

  // Find free port: populate the field with the scanned port and save+rebind it; on
  // a null result the field is left unchanged.
  findPortBtn.addEventListener('click', () => {
    window.goldfinchInternal.automationFindFreePort()
      .then((res) => {
        const port = res && res.port;
        if (port == null) {
          messageEl.textContent = 'no free port found';
          return undefined;
        }
        portInput.value = String(port);
        return window.goldfinchInternal.automationSetPort(port)
          .then((status) => {
            messageEl.textContent = 'Saved';
            renderStatus(status);
            // Advance baseline so Save is disabled after find-free-port completes.
            savedPort = status.port;
            portInput.value = String(status.port);
            updatePortSaveDirty();
          });
      })
      .catch(() => {
        messageEl.textContent = 'Invalid port (1024–65535)';
      });
  });

  // Recompute the note and dirty state as the operator edits the port (before saving).
  portInput.addEventListener('input', () => {
    recomputePortNote();
    updatePortSaveDirty();
  });

  // Copy the displayed address via the shared helper (navigator.clipboard with
  // the clipboardWrite IPC fallback — AC7).
  copyBtn.addEventListener('click', () => {
    copyText(addressInput.value, messageEl);
  });

  // Copy the rendered MCP client config via the shared helper.
  copyConfigBtn.addEventListener('click', () => {
    copyText(configCodeEl.textContent || '', messageEl);
  });

  // Two-way sync: another surface changing the setting re-syncs here.
  // Capture the handle so we can remove this listener on pagehide (DD5: prevents
  // accumulation across reloads).
  const hSettings = window.goldfinchInternal.onSettingsChanged((all) => {
    if (!all) return;
    if (all.automationEnabled != null) enabledToggle.checked = !!all.automationEnabled;
    if (all.automationPort != null) {
      savedPort = Number(all.automationPort);
      portInput.value = String(all.automationPort);
      recomputePortNote();
      updatePortSaveDirty();
    }
  });
  window.addEventListener('pagehide', () => window.goldfinchInternal.offSettingsChanged(hSettings), { once: true });
})();

// DD6 (Flight 6): one shared on-load fetch of automation key state, consumed by BOTH the
// key-management and activity-viewer IIFEs (was two IPC round-trips). Memoizes the FIRST
// call only — refresh() after mint/revoke still fetches fresh (it must reflect a new key).
let _automationKeysOnce = null;
function automationKeysOnce() {
  const bridge = window.goldfinchInternal;
  if (!bridge) return Promise.resolve(null);            // null-safe off-origin (AC4)
  if (!_automationKeysOnce) _automationKeysOnce = bridge.automationListKeys();
  return _automationKeysOnce;
}

/* ---- automation key management controller (Leg 3) ---- */

(function () {
  // The bridge only exists on the genuine goldfinch://settings origin.
  if (!window.goldfinchInternal) return;

  const jarsContainer = /** @type {HTMLElement|null} */ (document.getElementById('automation-jars'));
  const revealEl = /** @type {HTMLElement|null} */ (document.getElementById('automation-key-reveal'));
  const keyValue = /** @type {HTMLInputElement|null} */ (document.getElementById('automation-key-value'));
  const keyCopyBtn = /** @type {HTMLButtonElement|null} */ (document.getElementById('automation-key-copy'));
  const keyDoneBtn = /** @type {HTMLButtonElement|null} */ (document.getElementById('automation-key-done'));
  const keyMessageEl = /** @type {HTMLElement|null} */ (document.getElementById('automation-key-message'));
  const adminBlock = /** @type {HTMLElement|null} */ (document.getElementById('automation-admin'));
  const adminStatus = /** @type {HTMLElement|null} */ (document.getElementById('automation-admin-status'));
  const adminMintBtn = /** @type {HTMLButtonElement|null} */ (document.getElementById('automation-admin-mint'));
  const adminRevokeBtn = /** @type {HTMLButtonElement|null} */ (document.getElementById('automation-admin-revoke'));

  if (
    !jarsContainer || !revealEl || !keyValue || !keyCopyBtn || !keyDoneBtn || !keyMessageEl ||
    !adminBlock || !adminStatus || !adminMintBtn || !adminRevokeBtn
  ) {
    return;
  }

  const bridge = window.goldfinchInternal;

  // DD9 (Flight 8): the PERSISTED `automationEnabled` gates KEY GENERATION (mint),
  // never revocation. Tracked here and kept live by the onSettingsChanged subscription
  // below. Gate strictly on the persisted value (what the toggle reflects) — NEVER on
  // status.enabled / effective-bound — so dev (override live, persisted off) mirrors
  // production key-gating and the contract is testable in dev.
  let automationEnabled = false;

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
      // DD9: key GENERATION is gated on the persisted toggle; Revoke (below) is not.
      mintBtn.disabled = !automationEnabled;
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
    // DD9: admin key GENERATION is gated on the persisted toggle; admin Revoke is not.
    adminMintBtn.disabled = !automationEnabled;
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

  // Dismiss the show-once reveal once the operator has copied the key. Clears the
  // plaintext field and re-hides the reveal via the existing clearReveal().
  keyDoneBtn.addEventListener('click', clearReveal);

  // Initial load — reveal stays hidden (it is only ever populated by a mint).
  // on load — use the shared single fetch (AC1); reveal stays hidden.
  // DD9: fold the persisted `automationEnabled` read into the SAME init so the FIRST
  // render already has the flag (no mint-button flicker) and NO second
  // automationListKeys fires (automationKeysOnce is the memoized fetch; refresh()
  // bypasses it, so we must NOT refresh() just to pick up the flag here).
  clearReveal();
  Promise.all([automationKeysOnce(), bridge.settingsGet('automationEnabled')])
    .then(([info, en]) => {
      automationEnabled = !!en;
      if (info) { renderJars(info.jars); renderAdmin(info.adminEnabled, info.adminKeySet); }
    })
    .catch(() => {});

  // Live updates (DD9): when the persisted toggle flips, update the tracked flag and
  // re-render so the mint buttons enable/disable immediately. refresh() rebuilds
  // jars + admin reading the tracked flag. Remove the handle on pagehide, matching
  // the other IIFEs' cleanup pattern (pagehide fires in the OLD document context
  // where the handle + wrapper are still valid).
  const hKeys = bridge.onSettingsChanged((all) => {
    if (all && all.automationEnabled != null) {
      automationEnabled = !!all.automationEnabled;
      refresh().catch(() => {});
    }
  });
  window.addEventListener('pagehide', () => bridge.offSettingsChanged(hKeys), { once: true });
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
  automationKeysOnce()
    .then((info) => {
      if (info && Array.isArray(info.jars)) {
        for (const j of info.jars) jarNames.set(j.id, j.name);
      }
      // Re-render so any session whose snapshot arrived before the names loaded
      // picks up the friendly jar name.
      if (haveSnapshot) renderActivity();
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

  // Entries per page. 20/page newest-first. The freshness contract (page 1 live,
  // higher pages frozen) survives underneath but is invisible to the operator —
  // standard numbered pagination on top. The windowing + freshness state machine
  // is the pure module audit-paging.js, loaded as a <script> before this one
  // (globals: windowPage / countNewer / activeLogOf / reduceAudit / pageList /
  // pageCount — the url-safety.js dual-export precedent).
  const PAGE_SIZE = 20;

  // Single nav container; the numbered pager (‹ 1 2 3 … › buttons) is rebuilt
  // into it on every render.
  const pagerEl = /** @type {HTMLElement|null} */ (document.getElementById('automation-activity-pager'));

  /** @type {{ page: number, frozenLog: any[]|null, liveLog: any[] }} */
  let state = { page: 1, frozenLog: null, liveLog: [] };
  /** @type {any[]} the sessions list from the latest snapshot (rendered live, unaffected by paging). */
  let lastSessions = [];
  // Kept for the deferred jar-names re-render: do we have any snapshot yet?
  let haveSnapshot = false;

  /**
   * Render the active-sessions list. Unchanged by paging — always reflects the
   * latest snapshot.
   * @param {any[]} sessions
   */
  function renderSessions(sessions) {
    sessionsEl.textContent = '';
    if (!sessions.length) {
      emptyLine(sessionsEl, 'No automation sessions');
      return;
    }
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

  /**
   * Build one activity-log row element from an audit entry. All audit-derived
   * strings (identity, jarId, op, errorCode) go through textContent — never
   * innerHTML — because jar names are operator-controlled (AC7).
   * @param {any} e
   * @returns {HTMLElement}
   */
  function buildLogRow(e) {
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

    if (e.detail) {
      const detail = document.createElement('span');
      detail.className = 'activity-log-detail muted';
      detail.textContent = e.detail;
      row.appendChild(detail);
    }

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

    return row;
  }

  /**
   * Build one pager control button (arrow or page number). Real <button> with an
   * accessible name; the current page carries aria-current="page".
   * @param {string} label    visible text
   * @param {string} ariaLabel accessible name
   * @param {() => void} onClick
   * @param {{ disabled?: boolean, current?: boolean }} [flags]
   * @returns {HTMLButtonElement}
   */
  function pagerButton(label, ariaLabel, onClick, flags) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'pager-btn';
    b.textContent = label;
    b.setAttribute('aria-label', ariaLabel);
    if (flags && flags.disabled) b.disabled = true;
    if (flags && flags.current) {
      b.setAttribute('aria-current', 'page');
      b.classList.add('current');
    }
    b.addEventListener('click', onClick);
    return b;
  }

  /**
   * Render the current paged window + standard numbered pager from `state`.
   * Windows over the active log (frozenLog ?? liveLog) so the rows + total never
   * jump to the live ring while reading a higher page.
   */
  function renderActivity() {
    renderSessions(lastSessions);

    const active = activeLogOf(state);
    const win = windowPage(active, state.page, PAGE_SIZE);

    // --- recent action log (newest-first) ---
    logEl.textContent = '';
    if (!win.total) {
      emptyLine(logEl, 'No recent activity');
    } else {
      for (const e of win.rows) logEl.appendChild(buildLogRow(e));
    }

    // --- standard numbered pager: ‹ 1 2 3 … 7 › ---
    if (!pagerEl) return;
    pagerEl.hidden = win.total === 0;
    pagerEl.textContent = '';
    if (win.total === 0) return;

    const pages = pageCount(win.total, PAGE_SIZE);

    // Previous arrow (disabled on page 1).
    pagerEl.appendChild(pagerButton('‹', 'Previous page', () => dispatch({ type: 'prev' }), { disabled: !win.hasPrev }));

    // Numbered buttons + ellipsis spans.
    for (const item of pageList(win.total, PAGE_SIZE, state.page, { edge: 1, around: 1 })) {
      if (item === '…') {
        const span = document.createElement('span');
        span.className = 'pager-ellipsis';
        span.setAttribute('aria-hidden', 'true');
        span.textContent = '…';
        pagerEl.appendChild(span);
        continue;
      }
      const n = /** @type {number} */ (item);
      const isCurrent = n === state.page;
      pagerEl.appendChild(pagerButton(
        String(n),
        isCurrent ? 'Page ' + n + ', current page' : 'Page ' + n,
        () => dispatch({ type: 'goto', page: n }),
        { current: isCurrent }
      ));
    }

    // Next arrow (disabled on last page).
    pagerEl.appendChild(pagerButton('›', 'Next page', () => dispatch({ type: 'next' }), { disabled: state.page >= pages }));
  }

  /**
   * Dispatch an event through the freshness state machine and re-render.
   * @param {{type:string, log?: any[], page?: number}} event
   */
  function dispatch(event) {
    state = reduceAudit(state, event);
    renderActivity();
  }

  /**
   * Handle an activity snapshot (initial read or live broadcast). The session
   * list always reflects the latest snapshot; the log is fed through the freshness
   * machine (page 1 stays live, page >= 2 stays frozen).
   * @param {{ sessions?: any[], log?: any[] }} snap
   */
  function onSnapshot(snap) {
    const s = snap || {};
    lastSessions = s.sessions || [];
    haveSnapshot = true;
    dispatch({ type: 'broadcast', log: s.log || [] });
  }

  // Pager buttons are (re)built per render in renderActivity() with their own
  // click handlers, so there is nothing to wire up here.

  // Initial snapshot (catches sessions/log present before this page loaded) + live
  // updates. Listener removed on pagehide to prevent accumulation across reloads.
  bridge.automationGetActivity().then(onSnapshot).catch(() => {});
  const h = bridge.onAutomationActivity(onSnapshot);
  window.addEventListener('pagehide', () => bridge.offAutomationActivity(h), { once: true });
})();
