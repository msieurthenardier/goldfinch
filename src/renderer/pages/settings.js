// Imports use the page's SERVING paths, not disk paths: this file is served at
// goldfinch://settings/settings.js and its shared dependencies as flat sibling
// subresources (INTERNAL_PAGES is an exact-match flat map — a disk-true
// ../../shared/*.js specifier would 404 at boot). tsc cannot resolve the flat
// specifiers against the disk layout (TS2307), so each carries @ts-ignore;
// the bindings type as `any`, matching the ambient-global typing they replace
// (M07 Flight 2 leg 5 FD ruling; backlog-noted for a future typing cycle).
// @ts-ignore — serving-path vs disk-path mismatch (see above)
import { initSectionScrollSpy } from './section-scroll-spy.js';
// @ts-ignore — serving-path vs disk-path mismatch (see above)
import { SEARCH_ENGINES, normalizeHomePageInput } from './search-engines.js';
// @ts-ignore — serving-path vs disk-path mismatch (see above)
import { defaultBrowserRowModel } from './default-browser-row-model.js';
import {
  isolationModel,
  restartControl,
  createRestartConfirm,
  COPY as ISOLATION_COPY
  // @ts-ignore — serving-path vs disk-path mismatch (see above)
} from './shields-isolation-model.js';

/* ---- section scroll-spy (shared with the other section-nav internal page) ---- */

initSectionScrollSpy({ document, IntersectionObserver });

/* ---- home-page controller ---- */

(function () {
  // Guard: only run when the internal bridge is present (goldfinch://settings origin).
  if (!window.goldfinchInternal) return;

  const input = /** @type {HTMLInputElement|null} */ (document.getElementById('home-page-input'));
  const saveBtn = /** @type {HTMLButtonElement|null} */ (document.getElementById('home-page-save'));
  // Clear (M16 F2 Leg 1, DD6): writes homePage:null through the SAME validated
  // channel as Save — settings-store's validator already accepts null (F1 DD2).
  const clearBtn = /** @type {HTMLButtonElement|null} */ (document.getElementById('home-page-clear'));
  const status = /** @type {HTMLElement|null} */ (document.getElementById('home-page-status'));

  if (!input || !saveBtn || !clearBtn || !status) return;

  // Persistent unset hint (M16 F2 Leg 2 acceptance-gate fix), symmetric with
  // the search-engine block's UNSET_HINT below: rendered whenever homePage is
  // null, cleared whenever it is set, so the field is never merely empty with
  // no explanation — on load AND on every external write (Settings acceptance
  // spec's "each with its hint").
  const HOME_UNSET_HINT = 'No home page chosen — new tabs will open the welcome page until you set one.';

  /**
   * Render the input + status hint from a homePage value. Nullish-aware
   * (M16 F2 Leg 1, DD6 — Mission KI): `value == null` (unset) leaves the
   * field empty and shows the hint; the old truthy guard left a PRIOR value
   * stuck on screen instead and showed no hint at all. Called on load and
   * from the onSettingsChanged broadcast handler below — NOT from the
   * Save/Clear click handlers, whose own local messages ('Saved', 'Cleared
   * — …') are meant to overwrite this on the page that clicked (see ordering
   * note below).
   * @param {string|null} value
   */
  function reflect(value) {
    input.value = value == null ? '' : value;
    status.textContent = value == null ? HOME_UNSET_HINT : '';
  }

  // Populate the input with the persisted home page on load.
  window.goldfinchInternal.settingsGet('homePage').then(reflect);

  // Save button: write the new home page via the origin-locked bridge.
  // Ordering note: `internal-settings-set` (register-settings-ipc.js) calls
  // broadcastSettings() BEFORE its handler returns, so the settings-changed
  // broadcast below (reflect) always lands at this same page before this
  // .then() runs — this local 'Saved' message deliberately overwrites the
  // broadcast-driven hint on the page that clicked; every OTHER open window
  // only sees the broadcast's reflect() (hint or blank, per DD6 symmetry).
  // Clear action, shared by the Clear button and an empty Save (squawk 0108):
  // the store's unset sentinel is null, never '', so both write null.
  const clearHome = () =>
    window.goldfinchInternal
      .settingsSet('homePage', null)
      .then(() => {
        input.value = '';
        status.textContent = 'Cleared — new tabs will open the welcome page until you set one.';
      })
      .catch((e) => {
        status.textContent = 'Not cleared: ' + (e && e.message ? e.message : 'error');
      });

  saveBtn.addEventListener('click', () => {
    // M16 F3 Leg 2, HAT item 5: normalize a bare domain (e.g. `example.com`)
    // to `https://example.com` before the write, the same rule the address
    // bar and the welcome surface's home-page field apply — the store
    // validator (isSafeTabUrl) requires a scheme and stays the actual gate.
    // This also trims (the field previously sent input.value raw) — an
    // intended side effect of routing through the shared helper.
    const normalized = normalizeHomePageInput(input.value);
    // An empty field is "no home page": behave exactly like Clear.
    if (normalized === '') {
      clearHome();
      return;
    }
    window.goldfinchInternal
      .settingsSet('homePage', normalized)
      .then(() => {
        status.textContent = 'Saved';
      })
      .catch((e) => {
        status.textContent = 'Not saved: ' + (e && e.message ? e.message : 'invalid URL');
      });
  });

  clearBtn.addEventListener('click', clearHome);

  // Keep the input + hint in sync when settings change from another surface
  // (the welcome surface's Set, another window's Settings page, or this
  // page's own Save/Clear broadcast echo — see ordering note above).
  // Capture the handle so we can remove this listener on pagehide (DD5: prevents accumulation
  // across reloads — pagehide fires in the OLD document context where handle + wrapper are valid).
  // Nullish-aware (M16 F2 Leg 1, DD6): `!== undefined` (present in the broadcast, even as
  // null) rather than truthiness, so a null broadcast clears the field instead of leaving
  // stale text — the old truthy guard's bug (Mission KI).
  const hSettings = window.goldfinchInternal.onSettingsChanged((all) => {
    if (all && all.homePage !== undefined) reflect(all.homePage);
  });
  window.addEventListener('pagehide', () => window.goldfinchInternal.offSettingsChanged(hSettings), { once: true });
})();

/* ---- search-engine controller (M16 F1 Leg 2 / DD7) ---- */

(function () {
  // Guard: only run when the internal bridge is present (goldfinch://settings origin).
  if (!window.goldfinchInternal) return;

  const group = /** @type {HTMLElement|null} */ (document.getElementById('search-engine-options'));
  // Clear (M16 F2 Leg 2, DD6): writes searchEngine:null through the SAME
  // validated channel as a radio pick — settings-store's validator already
  // accepts null (F1 DD2).
  const clearBtn = /** @type {HTMLButtonElement|null} */ (document.getElementById('search-engine-clear'));
  const status = /** @type {HTMLElement|null} */ (document.getElementById('search-engine-status'));
  if (!group || !clearBtn || !status) return;

  const UNSET_HINT = 'No search engine chosen — the welcome page will ask the first time you search.';

  // Render one radio per curated engine, entirely from the imported
  // SEARCH_ENGINES table (id/label/description) — no engine data is
  // hand-typed in this file or in settings.html (DD7). Built with
  // createElement + textContent (never innerHTML/template strings): the
  // description copy ships with the app, not from any external input, but
  // this keeps the same discipline every other user-facing list on this page
  // follows (jar names, activity log rows, …).
  /** @type {Map<string, HTMLInputElement>} */
  const radios = new Map();

  for (const engine of SEARCH_ENGINES) {
    const row = document.createElement('div');
    row.className = 'search-engine-row';

    const label = document.createElement('label');
    label.className = 'search-engine-option shield-row';
    label.htmlFor = 'search-engine-' + engine.id;

    const input = document.createElement('input');
    input.type = 'radio';
    input.name = 'search-engine';
    input.id = 'search-engine-' + engine.id;
    input.value = engine.id;

    const text = document.createElement('span');
    text.textContent = engine.label;

    label.appendChild(text);
    label.appendChild(input);
    row.appendChild(label);

    const desc = document.createElement('p');
    desc.className = 'muted search-engine-description';
    desc.textContent = engine.description;
    row.appendChild(desc);

    group.appendChild(row);
    radios.set(engine.id, input);

    // Radio `change` fires only on a real selection change (native browser
    // behavior — clicking an already-checked radio fires no event), so no
    // same-value guard is needed here (matches house style — see the Edge
    // Cases note in the leg spec).
    input.addEventListener('change', () => {
      if (input.checked) {
        window.goldfinchInternal
          .settingsSet('searchEngine', engine.id)
          .then(() => applyChecked(engine.id))
          .catch(() => {});
      }
    });
  }

  /**
   * Check the radio matching `id`, uncheck every other. A `null`/unknown id
   * (including F1's raw-IPC `searchEngine: null` edge case) leaves every
   * radio unchecked — an honest rendering of "unset", not a synthetic "none"
   * option (accepted F1 behavior by design ruling; Flight 2 owns the unset UX).
   * Also drives the unset hint line (M16 F2 Leg 2, DD6): shown iff `id` is
   * null, cleared otherwise.
   * @param {string|null} id
   */
  function applyChecked(id) {
    for (const [engineId, radio] of radios) {
      radio.checked = engineId === id;
    }
    status.textContent = id == null ? UNSET_HINT : '';
  }

  clearBtn.addEventListener('click', () => {
    window.goldfinchInternal
      .settingsSet('searchEngine', null)
      .then(() => applyChecked(null))
      .catch(() => {});
  });

  // Populate from the persisted setting on load. searchEngine is never
  // `undefined` here (settingsGet resolves an id string or null — DD2), so
  // applyChecked runs unconditionally.
  window.goldfinchInternal
    .settingsGet('searchEngine')
    .then(applyChecked)
    .catch(() => {});

  // Re-sync when another surface (another window's Settings page, the Clear
  // button above, or this radio group's own change) changes the setting.
  // Guard is `!== undefined`, never truthiness — null is a meaningful value.
  // Capture the handle so we can remove this listener on pagehide (DD5:
  // prevents accumulation across reloads — pagehide fires in the OLD document
  // context where handle + wrapper are valid).
  const hSearchEngine = window.goldfinchInternal.onSettingsChanged((all) => {
    if (all && all.searchEngine !== undefined) applyChecked(all.searchEngine);
  });
  window.addEventListener('pagehide', () => window.goldfinchInternal.offSettingsChanged(hSearchEngine), { once: true });
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

  // Sortie 02 leg 2 (DD4/DD5/DD6): restart-to-apply truth. The model projects (config, what is
  // IN FORCE, operator override) to the notes and the Restart now control. Everything below is
  // patched in place with textContent/hidden — never rebuilt (the checkboxes keep focus).
  /** @type {any} */
  let shieldsCfg = null;
  /** @type {any} */
  let isolation = null;
  let restoreSession = true;
  let restartFailure = '';
  const $ = (/** @type {string} */ id) => document.getElementById(id);
  const restartBtn = /** @type {HTMLButtonElement|null} */ ($('shields-restart'));
  const restartNote = $('shields-restart-note');

  const confirm = createRestartConfirm({
    onChange: () => renderIsolation(),
    onInvoke: () => {
      restartFailure = '';
      Promise.resolve()
        .then(() => window.goldfinchInternal.shieldsRestartToApply())
        .then((res) => {
          if (res && res.ok) return;
          confirm.reset();
          restartFailure = ISOLATION_COPY.restartFailed;
          renderIsolation();
        })
        .catch(() => {
          confirm.reset();
          restartFailure = ISOLATION_COPY.restartFailed;
          renderIsolation();
        });
    }
  });

  /** @param {string} id @param {string} text */
  function setNote(id, text) {
    const el = $(id);
    if (!el) return;
    el.textContent = text;
    el.hidden = text === '';
  }

  function renderIsolation() {
    if (!shieldsCfg || !isolation) return;
    const m = isolationModel({
      cfg: shieldsCfg,
      isolateEffective: isolation.isolateEffective,
      operatorOverride: isolation.operatorOverride,
      paused: false
    });
    setNote('shield-enabled-note', m.masterNote ? m.copy[m.masterNote] : '');
    setNote('shield-isolate-note', m.isolateRow.note ? m.copy[m.isolateRow.note] : '');
    const isolateRowEl = $('shield-isolate') && $('shield-isolate').closest('.shield-row');
    if (isolateRowEl) isolateRowEl.classList.toggle('isolate-enforced', !m.isolateRow.dim);
    if (!m.restartPending) confirm.reset();
    const ctl = restartControl({
      restartPending: m.restartPending,
      confirming: confirm.isConfirming(),
      restoreSession
    });
    if (restartBtn) {
      restartBtn.hidden = ctl.hidden;
      restartBtn.textContent = ctl.label;
      if (ctl.note !== '') restartBtn.setAttribute('aria-describedby', 'shields-restart-note');
      else restartBtn.removeAttribute('aria-describedby');
    }
    // A failure line (after a revert) shows only while the control is visible and idle.
    const text = ctl.note !== '' ? ctl.note : ctl.hidden ? '' : restartFailure;
    if (restartNote) {
      restartNote.textContent = text;
      restartNote.hidden = text === '';
    }
  }

  if (restartBtn) {
    restartBtn.addEventListener('click', () => {
      restartFailure = '';
      confirm.activate();
    });
    restartBtn.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && confirm.escape()) {
        e.stopPropagation();
        e.preventDefault();
      }
    });
    restartBtn.addEventListener('blur', () => {
      if (confirm.isConfirming()) confirm.focusOut();
    });
  }

  /** @param {object} cfg */
  function applyShields(cfg) {
    applyConfig(cfg);
    shieldsCfg = cfg;
    renderIsolation();
  }

  // Populate checkboxes from the persisted shields config on load.
  window.goldfinchInternal.shieldsGet().then(applyShields);
  window.goldfinchInternal
    .shieldsIsolationState()
    .then((st) => {
      isolation = st;
      renderIsolation();
    })
    .catch(() => {});
  window.goldfinchInternal
    .settingsGet('restoreSession')
    .then((v) => {
      if (v !== undefined) restoreSession = v;
      renderIsolation();
    })
    .catch(() => {});
  // Guard is `!== undefined`, never truthiness.
  const hRestore = window.goldfinchInternal.onSettingsChanged((all) => {
    if (all && all.restoreSession !== undefined) {
      restoreSession = all.restoreSession;
      renderIsolation();
    }
  });
  window.addEventListener('pagehide', () => window.goldfinchInternal.offSettingsChanged(hRestore), { once: true });

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
  const hShields = window.goldfinchInternal.onShieldsChanged(applyShields);
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
  window.goldfinchInternal
    .settingsGet('toolbarPins')
    .then(apply)
    .catch(() => {});

  // Click handler: flip the pin for the clicked key, write the full map.
  // settingsSet resolves to the full config object, not the toolbarPins value, so apply
  // the locally-computed `next` (a clean {media,shields} map) — never the resolution.
  for (const k of /** @type {Array<'media'|'shields'|'devtools'>} */ (['media', 'shields', 'devtools'])) {
    btns[k].addEventListener('click', () => {
      const next = { ...current, [k]: !current[k] };
      window.goldfinchInternal
        .settingsSet('toolbarPins', next)
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

/* ---- spellcheck controller ---- */

(function () {
  // Guard: only run when the internal bridge is present (goldfinch://settings origin).
  if (!window.goldfinchInternal) return;

  const el = /** @type {HTMLInputElement|null} */ (document.getElementById('spellcheck-enabled'));
  if (!el) return;

  // Populate from the persisted setting on load. Assign .checked directly — never
  // .click()/dispatchEvent('change'), which would echo-loop back through settingsSet.
  window.goldfinchInternal
    .settingsGet('spellcheck')
    .then((v) => {
      el.checked = v === true;
    })
    .catch(() => {});

  // Write a real boolean (the internal-settings-set side-effect uses value === true, so a
  // non-boolean truthy value would not silently enable — but we send a clean boolean anyway).
  el.addEventListener('change', () => {
    window.goldfinchInternal.settingsSet('spellcheck', !!el.checked).catch(() => {});
  });

  // Re-sync when another surface changes the setting. Capture the handle so we can remove
  // this listener on pagehide (DD5: prevents accumulation across reloads).
  const h = window.goldfinchInternal.onSettingsChanged((all) => {
    if (all && typeof all.spellcheck === 'boolean') el.checked = all.spellcheck;
  });
  window.addEventListener('pagehide', () => window.goldfinchInternal.offSettingsChanged(h), { once: true });
})();

/* ---- default-browser controller (sortie 01 leg 2 / DD7) ---- */

(function () {
  // Default browser row (sortie 01 leg 2 / DD7). Renders from the RETURNED status
  // only, through the pure row model. Patch-in-place (textContent / hidden /
  // disabled) — never rebuilds the focused button. Refreshes are coalesced (one
  // get-status in flight) and any response older than the latest issued request
  // is dropped, including a get-status that resolves after a make-default.
  if (!window.goldfinchInternal) return;
  const statusEl = document.getElementById('default-browser-status');
  const failureEl = document.getElementById('default-browser-failure');
  const btn = /** @type {HTMLButtonElement|null} */ (document.getElementById('default-browser-make-default'));
  if (!statusEl || !failureEl || !btn) return;

  let status = null;
  let lastResult = null;
  let inFlight = false;
  let issued = 0;
  let refreshing = false;

  function render() {
    const m = defaultBrowserRowModel({ status, lastResult, inFlight });
    if (statusEl.textContent !== m.text) statusEl.textContent = m.text;
    if (failureEl.textContent !== m.failureText) failureEl.textContent = m.failureText;
    failureEl.hidden = !m.failureText;
    btn.hidden = m.buttonHidden;
    btn.disabled = m.buttonDisabled;
    if (btn.textContent !== m.buttonLabel) btn.textContent = m.buttonLabel;
  }

  function refresh() {
    if (refreshing) return;
    refreshing = true;
    const mine = ++issued;
    window.goldfinchInternal
      .defaultBrowserGetStatus()
      .then((s) => {
        if (mine !== issued) return;
        status = s;
        // A fresh read that finds Goldfinch default supersedes a stale failure line.
        if (s && s.isDefault === true) lastResult = null;
        render();
      })
      .catch(() => {})
      .finally(() => {
        refreshing = false;
      });
  }

  btn.addEventListener('click', () => {
    if (inFlight) return;
    inFlight = true;
    const mine = ++issued;
    render();
    window.goldfinchInternal
      .defaultBrowserMakeDefault()
      .then((res) => {
        if (mine !== issued) return;
        lastResult = res;
        if (res && res.status) status = res.status;
      })
      .catch(() => {
        if (mine === issued) lastResult = { ok: false };
      })
      .finally(() => {
        inFlight = false;
        render();
      });
  });

  render();
  refresh();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') refresh();
  });
  window.addEventListener('focus', refresh);
})();

/* ---- session-restore controller (M09 Flight 9 / DD7) ---- */

(function () {
  // Guard: only run when the internal bridge is present (goldfinch://settings origin).
  if (!window.goldfinchInternal) return;

  const el = /** @type {HTMLInputElement|null} */ (document.getElementById('restore-session-enabled'));
  if (!el) return;

  // Populate from the persisted setting on load. Assign .checked directly — never
  // .click()/dispatchEvent('change'), which would echo-loop back through settingsSet.
  // No live side-effect: the flag is read by main only at the next whenReady (startup-only).
  window.goldfinchInternal
    .settingsGet('restoreSession')
    .then((v) => {
      el.checked = v === true;
    })
    .catch(() => {});

  // Write a clean boolean on change (the strict validator rejects a non-boolean anyway).
  el.addEventListener('change', () => {
    window.goldfinchInternal.settingsSet('restoreSession', !!el.checked).catch(() => {});
  });

  // Re-sync when another surface changes the setting. Capture the handle so we can remove
  // this listener on pagehide (DD5: prevents accumulation across reloads).
  const h = window.goldfinchInternal.onSettingsChanged((all) => {
    if (all && typeof all.restoreSession === 'boolean') el.checked = all.restoreSession;
  });
  window.addEventListener('pagehide', () => window.goldfinchInternal.offSettingsChanged(h), { once: true });
})();

/* ---- bookmarks-bar controller (M15 F1 Leg 3 / DD7) ---- */

(function () {
  // Guard: only run when the internal bridge is present (goldfinch://settings origin).
  if (!window.goldfinchInternal) return;

  const el = /** @type {HTMLInputElement|null} */ (document.getElementById('bookmarks-bar-enabled'));
  if (!el) return;

  // Populate from the persisted setting on load. Assign .checked directly — never
  // .click()/dispatchEvent('change'), which would echo-loop back through settingsSet
  // (the restore-session checkbox's own idiom, byte-for-byte in shape).
  window.goldfinchInternal
    .settingsGet('bookmarksBarEnabled')
    .then((v) => {
      el.checked = v === true;
    })
    .catch(() => {});

  // Write a clean boolean on change (the strict validator rejects a non-boolean
  // anyway). Every open chrome window re-syncs live via the settings-changed
  // broadcast (window-controller.js's applyBookmarksBar) — the same stored value
  // Ctrl+Shift+B flips, so the checkbox and the shortcut never diverge.
  el.addEventListener('change', () => {
    window.goldfinchInternal.settingsSet('bookmarksBarEnabled', !!el.checked).catch(() => {});
  });

  // Re-sync when another surface changes the setting (the shortcut, or another
  // window's checkbox). Capture the handle so we can remove this listener on
  // pagehide (DD5: prevents accumulation across reloads).
  const h = window.goldfinchInternal.onSettingsChanged((all) => {
    if (all && typeof all.bookmarksBarEnabled === 'boolean') el.checked = all.bookmarksBarEnabled;
  });
  window.addEventListener('pagehide', () => window.goldfinchInternal.offSettingsChanged(h), { once: true });
})();
