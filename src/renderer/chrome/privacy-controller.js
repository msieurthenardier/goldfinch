/** @typedef {any} Tab */

/** @param {any} deps */
export function createPrivacyController(deps) {
  const {
    window, document, ctx, els, activeTab, findTabByWcId, isInternalTab, isWebTab,
    togglePanel, sendActiveBounds, openToolbarContextMenu, toast, jarsClient,
    buildAutomationIndicatorModel, isSafeColor, escapeHtml, isInternalPageUrl
  } = deps;
  /* --------------------------------------------------------- privacy panel */

  function blankPrivacy() {
    return { net: null, fp: { canvas: 0, webgl: 0, audio: 0 }, permissions: [], cookies: null };
  }

  function closePrivacyPanel() {
    els.privacyPanel.classList.add('collapsed');
    els.togglePrivacy.classList.remove('active');
    // Opening the media panel calls this directly, so sync aria-expanded here too
    // or the privacy toggle would keep a stale "true" after being collapsed.
    els.togglePrivacy.setAttribute('aria-expanded', 'false');
  }

  function togglePrivacy(force) {
    const collapsed = els.privacyPanel.classList.contains('collapsed');
    const show = force != null ? force : collapsed;
    els.privacyPanel.classList.toggle('collapsed', !show);
    els.togglePrivacy.classList.toggle('active', show);
    els.togglePrivacy.setAttribute('aria-expanded', String(show));
    if (show) {
      togglePanel(false); // close the media panel
      fetchCookies(); // cookies are fetched on demand
      renderPrivacy();
      els.privacyClose.focus(); // only move focus when actually opening
    } else if (els.privacyPanel.contains(document.activeElement)) {
      // Closing while focus is inside the (now zero-width) panel would strand it:
      // restore focus to the toggle. Guard avoids stealing focus on programmatic closes.
      // Focus-restoration guard: if the button is unpinned (hidden), .focus() is a
      // silent no-op that strands focus on <body> — fall back to the address bar.
      if (!els.togglePrivacy.classList.contains('hidden')) els.togglePrivacy.focus();
      else els.address.focus();
    }
  }

  els.togglePrivacy.addEventListener('click', () => { togglePrivacy(); sendActiveBounds(); });
  els.togglePrivacy.addEventListener('contextmenu', (e) => { e.preventDefault(); openToolbarContextMenu('shields', els.togglePrivacy); });

  /* ------------------------------------------------------------------ devtools toggle */

  // The #toggle-devtools button is a toggle reflecting the active web tab's DevTools
  // open state (aria-pressed + .active styling — NOT aria-expanded; it controls no
  // in-page panel). Open state's source of truth is wc.isDevToolsOpened() main-side
  // (DD3); the pressed state is driven by (a) the post-toggle return of toggleDevtools,
  // (b) the devtools-state-changed event, and (c) the isDevtoolsOpen reconcile on tab
  // activation. Never cached.

  /** @param {boolean} open */
  function setDevtoolsPressed(open) {
    els.toggleDevtools.setAttribute('aria-pressed', String(open));
    els.toggleDevtools.classList.toggle('active', open);
  }

  els.toggleDevtools.addEventListener('click', async () => {
    const t = activeTab();
    // Inert on internal / no-wcId tabs (DD5) — never opens DevTools on goldfinch:// chrome.
    if (!t || isInternalTab(t) || t.wcId == null) return;
    const open = await window.goldfinch.toggleDevtools({ webContentsId: t.wcId });
    setDevtoolsPressed(!!open);
  });
  els.toggleDevtools.addEventListener('contextmenu', (e) => { e.preventDefault(); openToolbarContextMenu('devtools', els.toggleDevtools); });

  // Live update from the Leg-1 devtools-state-changed event (catches a DevTools-window-
  // initiated close). Apply only when the change targets the currently-active tab.
  window.goldfinch.onDevtoolsStateChanged(({ wcId, open }) => {
    const t = activeTab();
    if (t && t.wcId === wcId) setDevtoolsPressed(!!open);
  });
  els.privacyClose.addEventListener('click', () => { togglePrivacy(false); sendActiveBounds(); });
  // Non-modal: Escape closes the privacy panel; togglePrivacy restores focus to the toggle.
  els.privacyPanel.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      togglePrivacy(false);
      sendActiveBounds();
    }
  });
  els.privacyRefresh.addEventListener('click', () => {
    fetchCookies();
    renderPrivacy();
  });

  window.goldfinch.onPrivacyNet((d) => {
    const tab = findTabByWcId(d.webContentsId);
    if (!tab) return;
    tab.privacy.net = d.agg;
    if (tab.id === ctx.activeTabId) renderPrivacy();
    updatePrivacyBadge();
  });

  window.goldfinch.onPrivacyPermission((d) => {
    const tab = findTabByWcId(d.webContentsId);
    if (!tab) return;
    const existing = tab.privacy.permissions.find((p) => p.permission === d.permission);
    if (existing) existing.granted = d.granted;
    else tab.privacy.permissions.push({ permission: d.permission, granted: d.granted });
    if (tab.id === ctx.activeTabId) renderPrivacy();
  });

  async function fetchCookies() {
    const tab = activeTab();
    if (!tab || tab.wcId == null) return;
    try {
      tab.privacy.cookies = await window.goldfinch.privacyCookies({ webContentsId: tab.wcId, url: tab.url });
      if (tab.id === ctx.activeTabId) renderPrivacy();
    } catch {
      /* ignore */
    }
  }

  async function clearCookies(scope) {
    const tab = activeTab();
    if (!tab) return;
    const res = await window.goldfinch.privacyClearCookies({ webContentsId: tab.wcId, scope, url: tab.url });
    toast('Cookies cleared', `${res.removed} cookie(s) removed`);
    fetchCookies();
  }

  async function clearStorage() {
    const tab = activeTab();
    if (!tab) return;
    const res = await window.goldfinch.privacyClearStorage({ url: tab.url, webContentsId: tab.wcId });
    toast(res.ok ? 'Site storage cleared' : 'Clear failed', res.ok ? res.origin : res.error || '');
  }

  function updatePrivacyBadge() {
    const tab = activeTab();
    const n = tab && tab.privacy.net ? tab.privacy.net.trackers.count : 0;
    // The badge count is the non-color cue (WCAG 1.4.1): the red `.alert` styling
    // is reinforced by the visible tracker count (badge + aria-label) so state isn't
    // conveyed by color alone.
    els.privacyCount.textContent = n ? String(n) : '';
    els.privacyCount.classList.toggle('hidden', !n);
    els.togglePrivacy.setAttribute('aria-label', n ? 'Shields, ' + n + ' blocked' : 'Shields');
    els.togglePrivacy.classList.toggle('alert', n > 0);
  }

  /* ---- Shields config (active protection toggles) ---- */

  let shieldsConfig = null;
  window.goldfinch.shieldsGet().then((c) => {
    shieldsConfig = c;
    renderPrivacy();
  });
  window.goldfinch.onShieldsChanged((c) => {
    shieldsConfig = c;
    renderPrivacy();
  });

  /* ---- Automation activity indicator (SC10 / DD6) ---- */

  // The last activity snapshot received, cached so the jarsList() resolve can re-run
  // the render with friendly jar names / jar colors once `containers` is populated
  // (the snapshot can arrive first).
  let lastSnap = /** @type {{ sessions?: any[] }} */ ({ sessions: [] });

  // The last automation KEY state (F7, Flight 3 Leg 6 HAT — distinct from the activity
  // snapshot above: this is which keys are ENABLED, not which connections are live).
  // Populated from settings.getAll() (settings-get at boot, settings-changed live) —
  // automationKeyHashes/automationAdminKeyHash are non-secret hash digests already
  // broadcast to chrome on every settings-changed (jar-key-mint et al broadcast the
  // full settings object today), so no new IPC channel is needed.
  let lastKeyState = { enabledJarKeyCount: 0, adminKeyEnabled: false };

  /**
   * Map a jarId to its display name via the loaded `containers`, falling back to the raw
   * jarId when the jar isn't (yet) known. jarId is operator-controlled, so the result is
   * only ever used via textContent / title — never innerHTML.
   * @param {string|null} jarId
   * @returns {string}
   */
  function jarDisplayName(jarId) {
    const c = jarsClient.containers.find((x) => x.id === jarId);
    return c ? c.name : (jarId || 'jar');
  }

  /**
   * Derive { enabledJarKeyCount, adminKeyEnabled } from a settings.getAll() payload.
   * Defensive against a missing/malformed automationKeyHashes (never throws).
   * @param {{ automationKeyHashes?: any, automationAdminKeyHash?: any }} all
   * @returns {{ enabledJarKeyCount: number, adminKeyEnabled: boolean }}
   */
  function computeAutomationKeyState(all) {
    const hashes = (all && all.automationKeyHashes && typeof all.automationKeyHashes === 'object')
      ? all.automationKeyHashes
      : {};
    return {
      enabledJarKeyCount: Object.keys(hashes).length,
      adminKeyEnabled: !!(all && all.automationAdminKeyHash),
    };
  }

  /**
   * Render the toolbar automation ("robot") indicator (F7, Flight 3 Leg 6 HAT —
   * operator ruling). Pulls the enabled-key state (lastKeyState) and the live-activity
   * snapshot (lastSnap) through the pure buildAutomationIndicatorModel and applies the
   * result to the DOM: hidden when no key is enabled; otherwise grayed out (idle),
   * tinted with the single active jar's color (jar), a neutral accent for
   * multiple-simultaneous-active-jars (multi), or an animated rainbow when the admin
   * key is enabled AND currently active (admin — trumps any concurrent jar activity).
   * The count badge always shows the ENABLED JAR key count (never the admin key, never
   * the live-connection count) — hidden at 0, matching the pre-F7 hidden-at-zero UX.
   */
  function renderAutomationIndicator() {
    const sessions = (lastSnap && lastSnap.sessions) || [];
    const activeJarIds = sessions.filter((s) => s && s.kind === 'jar').map((s) => s.jarId);
    const adminActive = sessions.some((s) => s && s.kind === 'admin');
    const model = buildAutomationIndicatorModel({
      enabledJarKeyCount: lastKeyState.enabledJarKeyCount,
      adminKeyEnabled: lastKeyState.adminKeyEnabled,
      activeJarIds,
      adminActive,
      containers: jarsClient.containers,
    });

    els.automationIndicator.classList.toggle('hidden', !model.visible);
    els.automationIndicator.classList.remove('automation-idle', 'automation-jar', 'automation-multi', 'automation-admin');

    if (!model.visible) {
      els.automationIndicatorBadge.textContent = '';
      els.automationIndicatorBadge.classList.add('hidden');
      els.automationIndicator.style.color = '';
      els.automationIndicator.title = '';
      els.automationIndicator.setAttribute('aria-label', 'Automation sessions');
      return;
    }

    els.automationIndicator.classList.add('automation-' + model.mode);
    // Defense in depth (F7 spec): re-validate before ever writing to an inline style,
    // even though buildAutomationIndicatorModel already gated `color` on isSafeColor.
    els.automationIndicator.style.color = (model.mode === 'jar' && model.color && isSafeColor(model.color))
      ? model.color
      : '';

    if (model.count > 0) {
      els.automationIndicatorBadge.textContent = String(model.count);
      els.automationIndicatorBadge.classList.remove('hidden');
    } else {
      els.automationIndicatorBadge.textContent = '';
      els.automationIndicatorBadge.classList.add('hidden');
    }

    const jarWord = model.count === 1 ? 'jar' : 'jars';
    const enabledPart = model.count > 0 ? model.count + ' ' + jarWord + ' automation-enabled' : 'automation enabled';
    const connectedNames = sessions.map((s) => (s.kind === 'admin' ? 'admin' : jarDisplayName(s.jarId)));
    // "connected" names the live transport(s) (DD6 wording — never "authorized");
    // "enabled" (above) names the persisted key state — kept as two distinct concepts.
    const label = enabledPart + (connectedNames.length ? ' — connected: ' + connectedNames.join(', ') : '');
    els.automationIndicator.title = label;
    els.automationIndicator.setAttribute('aria-label', label);
  }

  /**
   * Update the cached activity snapshot (live connections) and re-render.
   * @param {{ sessions?: any[] }} snap
   */
  function updateAutomationIndicator(snap) {
    lastSnap = snap || { sessions: [] };
    renderAutomationIndicator();
  }

  /**
   * Update the cached automation KEY state (enabled jar-key count / admin-key
   * enabled) from a settings.getAll()-shaped payload and re-render.
   * @param {{ automationKeyHashes?: any, automationAdminKeyHash?: any }} all
   */
  function updateAutomationKeyState(all) {
    lastKeyState = computeAutomationKeyState(all);
    renderAutomationIndicator();
  }

  // Initial snapshot (catches sessions attached before the chrome loaded) + live updates.
  window.goldfinch.automationGetActivity().then(updateAutomationIndicator).catch(() => {});
  window.goldfinch.onAutomationActivity(updateAutomationIndicator);
  // Initial key state — settingsGet() with no key returns the full settings object
  // (settings-get: (_e, key) => key ? settings.get(key) : settings.getAll()).
  window.goldfinch.settingsGet().then(updateAutomationKeyState).catch(() => {});

  function currentSite() {
    const tab = activeTab();
    if (tab && tab.privacy.net && tab.privacy.net.firstParty) return tab.privacy.net.firstParty;
    try {
      const h = new URL(tab.url).hostname.split('.');
      return h.length <= 2 ? h.join('.') : h.slice(-2).join('.');
    } catch {
      return '';
    }
  }

  async function setShield(key, value) {
    shieldsConfig = await window.goldfinch.shieldsSet({ [key]: value });
    renderPrivacy();
  }

  async function toggleSitePause() {
    const site = currentSite();
    if (!site) return;
    const paused = shieldsConfig && shieldsConfig.pausedSites.includes(site);
    shieldsConfig = await window.goldfinch.shieldsPause({ site, paused: !paused });
    renderPrivacy();
  }

  const SHIELD_ROWS = [
    ['block', 'Block trackers'],
    ['strip', 'Strip tracking params'],
    ['isolate', 'Isolate 3rd-party cookies'],
    ['farble', 'Farble fingerprint']
  ];

  function pShields() {
    const s = document.createElement('div');
    s.className = 'privacy-section shields';
    const cfg = shieldsConfig || {};
    const site = currentSite();
    const paused = cfg.pausedSites && cfg.pausedSites.includes(site);

    const head = document.createElement('div');
    head.className = 'shields-head';
    head.innerHTML = '<div class="ps-title">Shields</div>';
    head.appendChild(toggle(!!cfg.enabled, (v) => setShield('enabled', v), 'Shields'));
    s.appendChild(head);

    const net = (activeTab() && activeTab().privacy.net) || {};
    // Counts are distinct DOMAINS so they line up with the lists below
    // (block -> Trackers "N blocked", isolate/strip -> distinct domains affected).
    const EFFECT = {
      block: [(net.trackers && net.trackers.blocked) || 0, 'blocked'],
      strip: [net.stripped, 'cleaned'],
      isolate: [net.cookiesBlocked, 'isolated']
    };

    const dim = !cfg.enabled || paused;
    for (const [key, label] of SHIELD_ROWS) {
      const row = document.createElement('div');
      row.className = 'shield-row' + (dim ? ' dim' : '');
      const lbl = document.createElement('span');
      lbl.className = 'shield-lbl';
      lbl.textContent = label;
      row.appendChild(lbl);
      const eff = EFFECT[key];
      if (cfg[key] && !dim && eff && eff[0]) {
        const c = document.createElement('span');
        c.className = 'shield-count';
        c.textContent = `${eff[0]} ${eff[1]}`;
        row.appendChild(c);
      }
      row.appendChild(toggle(!!cfg[key], (v) => setShield(key, v), label));
      s.appendChild(row);
    }

    if (site) {
      const pauseRow = document.createElement('div');
      pauseRow.className = 'shield-row pause';
      pauseRow.innerHTML = `<span>${paused ? 'Shields paused on' : 'Active on'} ${escapeHtml(site)}</span>`;
      const btn = document.createElement('button');
      btn.className = 'text-btn small';
      btn.textContent = paused ? 'Resume here' : 'Pause on this site';
      btn.addEventListener('click', toggleSitePause);
      pauseRow.appendChild(btn);
      s.appendChild(pauseRow);
    }

    // Network shields only affect NEW requests, so changes show after a reload.
    const foot = document.createElement('div');
    foot.className = 'shield-foot';
    const reload = document.createElement('button');
    reload.className = 'text-btn small';
    reload.textContent = 'Reload to apply';
    reload.addEventListener('click', () => {
      const t = activeTab();
      if (!t) return;
      // Internal tabs are excluded by disabled button state; only web tabs reach here.
      if (isWebTab(t) && t.wcId != null) window.goldfinch.tabNavigate({ wcId: t.wcId, verb: 'reload', args: [] });
    });
    foot.appendChild(reload);
    s.appendChild(foot);

    return s;
  }

  function toggle(on, onChange, label) {
    const t = document.createElement('button');
    t.className = 'switch' + (on ? ' on' : '');
    t.setAttribute('role', 'switch');
    t.setAttribute('aria-checked', String(on));
    if (label) t.setAttribute('aria-label', label);
    t.addEventListener('click', () => onChange(!on));
    return t;
  }

  function pJar() {
    const tab = activeTab();
    const c = tab && tab.container;
    const s = document.createElement('div');
    s.className = 'privacy-section';
    // Every tab now always carries a real container (createTab always resolves one),
    // so the no-tab/no-container branch is defensive-only — never fabricate a jar,
    // just render a neutral placeholder. pJar()'s only call site appends its return
    // value directly, so this must always return an HTMLElement.
    if (!c) {
      s.innerHTML = `<div class="ps-title">Jar</div><div class="ps-main">—</div>`;
      return s;
    }
    s.innerHTML =
      `<div class="ps-title">Jar</div>` +
      `<div class="ps-main"><span class="cm-dot" style="background:${c.color}"></span> ${escapeHtml(c.name)}${c.burner ? ' · burner (evaporates on close)' : ''}</div>`;
    const row = document.createElement('div');
    row.className = 'privacy-buttons';
    const btn = document.createElement('button');
    btn.className = 'text-btn small';
    btn.textContent = 'New identity';
    btn.title = 'Wipe this jar (cookies + storage) and reroll the fingerprint';
    // Tab-scoped disable: the privacy panel can stay open across a switch to an
    // internal goldfinch:// tab — never offer a wipe of the privileged partition.
    // (Main's identity-new handler also refuses __goldfinchInternal as defense-in-depth.)
    btn.disabled = isInternalTab(tab);
    btn.addEventListener('click', newIdentity);
    row.appendChild(btn);
    s.appendChild(row);
    return s;
  }

  async function newIdentity() {
    const tab = activeTab();
    // Belt-and-suspenders with pJar()'s disabled state + main's internal-session guard.
    if (!tab || isInternalTab(tab)) return;
    const res = await window.goldfinch.identityNew({ partition: tab.container.partition });
    if (res && res.ok) {
      toast('New identity', 'Jar wiped + fingerprint rerolled');
      if (isWebTab(tab) && tab.wcId != null) window.goldfinch.tabNavigate({ wcId: tab.wcId, verb: 'reload', args: [] });
    } else {
      toast('New identity failed', (res && res.error) || '');
    }
  }

  function renderPrivacy() {
    updatePrivacyBadge();
    if (els.privacyPanel.classList.contains('collapsed')) return;
    const tab = activeTab();
    const p = tab ? tab.privacy : null;
    const net = p && p.net;
    const body = els.privacyBody;
    body.innerHTML = '';

    // Shields controls
    body.appendChild(pShields());

    // Jar / identity
    body.appendChild(pJar());

    // Connection
    const internal = !!(tab && isInternalPageUrl(tab.url || ''));
    const secure = internal || (tab && /^https:/i.test(tab.url || ''));
    body.appendChild(
      pSection(
        'Connection',
        secure ? 'ok' : 'bad',
        internal ? 'Secure — Goldfinch page' : secure ? 'Secure — HTTPS' : 'Not secure — HTTP',
        net && net.mixedContent ? `${net.mixedContent} insecure (mixed-content) request(s)` : ''
      )
    );

    // Trackers — blocked vs allowed
    const trk = net ? net.trackers : { ads: [], analytics: [], social: [], other: [], count: 0, blocked: 0, allowed: 0 };
    const tLabel = trk.count ? `${trk.blocked} blocked · ${trk.allowed} allowed` : 'no trackers detected';
    const tSec = pBigStat('Trackers', trk.count, tLabel);
    for (const cat of ['ads', 'analytics', 'social', 'other']) {
      if (trk[cat] && trk[cat].length) tSec.appendChild(pGroupStatus(cat, trk[cat]));
    }
    body.appendChild(tSec);

    // Third-party domains
    const tpCount = net ? net.thirdPartyCount : 0;
    const tpSec = pBigStat('Third-party domains', tpCount, 'distinct domains contacted');
    if (net && net.thirdPartyList.length)
      tpSec.appendChild(pList(net.thirdPartyList.map((x) => `${x.domain} (${x.count})`)));
    body.appendChild(tpSec);

    // Cookies + storage
    const ck = p && p.cookies;
    const cSec = pSection('Cookies', '', ck ? `${ck.first} first-party · ${ck.third} third-party` : 'Loading…', '');
    const cBtns = document.createElement('div');
    cBtns.className = 'privacy-buttons';
    cBtns.appendChild(pButton('Clear third-party', () => clearCookies('third')));
    cBtns.appendChild(pButton('Clear all cookies', () => clearCookies('all')));
    cBtns.appendChild(pButton('Clear site storage', clearStorage));
    cSec.appendChild(cBtns);
    if (ck && ck.list.length)
      cSec.appendChild(pList(ck.list.slice(0, 50).map((c) => `[${c.third ? '3rd' : '1st'}] ${c.name} — ${c.domain}`)));
    body.appendChild(cSec);

    // Fingerprinting
    const fp = p ? p.fp : { canvas: 0, webgl: 0, audio: 0 };
    const fpTotal = fp.canvas + fp.webgl + fp.audio;
    const fpSec = pBigStat('Fingerprinting', fpTotal, fpTotal ? 'fingerprinting API calls' : 'none detected');
    if (fpTotal) {
      fpSec.appendChild(
        pList(
          [
            fp.canvas ? `Canvas reads: ${fp.canvas}` : null,
            fp.webgl ? `WebGL GPU probe: ${fp.webgl}` : null,
            fp.audio ? `AudioContext: ${fp.audio}` : null
          ].filter(Boolean)
        )
      );
    }
    body.appendChild(fpSec);

    // Permissions
    const perms = p ? p.permissions : [];
    const permSec = pSection('Permissions', '', perms.length ? `${perms.length} requested` : 'none requested', '');
    if (perms.length)
      permSec.appendChild(pList(perms.map((x) => `${x.granted ? 'granted' : 'denied'} — ${x.permission}`)));
    body.appendChild(permSec);
  }

  function pSection(title, tone, main, sub) {
    const s = document.createElement('div');
    s.className = 'privacy-section';
    s.innerHTML =
      `<div class="ps-title">${escapeHtml(title)}</div>` +
      `<div class="ps-main ${tone || ''}">${escapeHtml(main)}</div>` +
      (sub ? `<div class="ps-sub warn">${escapeHtml(sub)}</div>` : '');
    return s;
  }
  function pBigStat(title, num, label) {
    const s = document.createElement('div');
    s.className = 'privacy-section';
    s.innerHTML =
      `<div class="ps-title">${escapeHtml(title)}</div>` +
      `<div class="ps-big ${num ? 'hot' : ''}">${num}</div><div class="ps-sub">${escapeHtml(label)}</div>`;
    return s;
  }
  // Tracker list with a blocked/allowed status tag per domain.
  function pGroupStatus(cat, entries) {
    const d = document.createElement('div');
    d.className = 'ps-group';
    d.innerHTML = `<div class="ps-cat">${escapeHtml(cat)} (${entries.length})</div>`;
    const list = document.createElement('div');
    list.className = 'ps-list';
    list.tabIndex = 0;   // scrollable region must be keyboard-focusable so it can be arrow-scrolled (a11y)
    for (const e of entries) {
      const item = document.createElement('div');
      item.className = 'ps-item status';
      item.innerHTML =
        `<span class="tag ${e.blocked ? 'blk' : 'allow'}">${e.blocked ? 'blocked' : 'allowed'}</span>` +
        `<span class="dom${e.blocked ? ' struck' : ''}">${escapeHtml(e.domain)}</span>`;
      list.appendChild(item);
    }
    d.appendChild(list);
    return d;
  }
  function pList(items) {
    const l = document.createElement('div');
    l.className = 'ps-list';
    l.tabIndex = 0;   // scrollable region must be keyboard-focusable so it can be arrow-scrolled (a11y)
    l.innerHTML = items.map((i) => `<div class="ps-item">${escapeHtml(i)}</div>`).join('');
    return l;
  }
  function pButton(label, fn) {
    const b = document.createElement('button');
    b.className = 'text-btn small';
    b.textContent = label;
    b.addEventListener('click', fn);
    return b;
  }


  return {
    blankPrivacy,
    closePrivacyPanel,
    togglePrivacy,
    setDevtoolsPressed,
    fetchCookies,
    clearCookies,
    clearStorage,
    updatePrivacyBadge,
    updateAutomationIndicator,
    updateAutomationKeyState,
    renderAutomationIndicator,
    getAutomationSnapshot: () => lastSnap,
    setShield,
    toggleSitePause,
    newIdentity,
    renderPrivacy
  };
}
