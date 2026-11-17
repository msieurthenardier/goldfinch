'use strict';

const { effectiveAfterRestartFromConfigured } = require('./third-party-cookies');
const { relaunchOptions } = require('./relaunch-options');
const { projectSettingsForChrome, chromeSettingsGet } = require('./settings-chrome-view');

// Electron-free registration for chrome-trusted settings reads and the guarded
// goldfinch://settings mutation/automation surface.

function registerSettingsIpc({
  ipcMain,
  gate,
  // Leg `admin-reach` (DD2): REQUIRED. Minting an automation key asks the reveal gate first (the key is
  // returned to the calling page); registration throws without it. Revokes and the automation toggle are
  // the operator's kill switch and are NOT gated.
  revealGate,
  registerInternalHandler,
  settings,
  shields,
  isolateEffective = false,
  operatorOverride = null,
  broadcast,
  applyAutomationEnabledChange,
  applySpellcheck,
  // Leg `update-check`: `(enabled: boolean) => void`, late-bound in main.js; no-op default.
  applyUpdateCheckEnabled = (/** @type {boolean} */ _enabled) => {},
  getDefaultSession,
  getAllWebContents,
  currentAutomationStatus,
  rebindMcpServer,
  freePortInRange,
  secretClipboard,
  jars,
  mintJarKey,
  revokeJarKey,
  mintAdminKey,
  revokeAdminKey,
  getMcpServer,
  adminEnabled,
  defaultBrowser,
  app,
  env = process.env
}) {
  if (!revealGate || typeof revealGate.confirm !== 'function') {
    throw new Error('registerSettingsIpc: revealGate is required (leg admin-reach, DD2)');
  }
  // DD13: the chrome never receives the automation key hashes; see settings-chrome-view.js.
  const broadcastSettings = () => broadcast('settings-changed', projectSettingsForChrome(settings.getAll()));

  gate.chrome.handle('settings-get', (_event, key) => chromeSettingsGet(settings, key), 'throw');
  gate.chrome.handle('shields-get', () => shields.get(), 'throw');
  // Sortie 02 DD4: read-only, non-secret, process-constant startup decision (bare: consumed
  // by both the file:// chrome and the internal settings page). `operatorOverride` lets the UI
  // compute restart-pending as "would a restart change anything".
  const isolationState = () => ({ isolateEffective, operatorOverride });
  gate.chrome.handle('shields-isolation-state', isolationState, 'throw');

  // Sortie 02 DD11: Restart now. STATE-CHANGING (relaunches the process), so it is guarded:
  // (chrome channel) sender identity via the window registry; (both) a main-side business gate
  // that recomputes "would a restart change anything" from the CURRENT persisted config and the
  // operator override — never from anything the page sends (no page arguments at all). On pass,
  // ORDER IS LOAD-BEARING: strip DEV_MINT from the live env (a re-mint would replace the stored
  // key hash and 401 standing MCP configs) -> release the single-instance lock (else the
  // relaunched child can lose requestSingleInstanceLock() to the still-exiting parent and exit
  // silently) -> relaunch -> the normal quit path (before-quit/will-quit run). There is
  // deliberately NO MCP op for this; admin chrome `evaluate` can reach it, exactly like
  // `appQuit` (accepted, documented in docs/mcp-automation.md).
  // Squawk 0133: `restarting` latches once a restart passes the gate (either channel), so a
  // second activation can't relaunch twice; a throw after the lock release re-acquires it and
  // clears the latch (the deleted DEV_MINT is deliberately NOT restored — no key rotation).
  let restarting = false;
  function restartToApply() {
    if (restarting) return { ok: false, reason: 'in-progress' };
    const configured = shields.isolateConfigured(shields.get());
    if (effectiveAfterRestartFromConfigured(configured, operatorOverride) === isolateEffective) {
      return { ok: false, reason: 'not-pending' };
    }
    restarting = true;
    delete env.GOLDFINCH_AUTOMATION_DEV_MINT;
    try {
      app.releaseSingleInstanceLock();
      app.relaunch(relaunchOptions({ env }));
      app.quit();
    } catch {
      try {
        app.requestSingleInstanceLock();
      } catch {
        // best effort
      }
      restarting = false;
      return { ok: false, reason: 'relaunch-failed' };
    }
    return { ok: true };
  }
  // Mission 23 Flight 1 (`ipc-gate-complete`): chrome class; a refused caller gets the refusal
  // shape the handler always returned. No arguments, and the main-side `not-pending` gate stays
  // inside `restartToApply`.
  gate.chrome.handle('shields-restart-to-apply', () => restartToApply(), {
    value: { ok: false, reason: 'refused' }
  });
  gate.chrome.handle(
    'shields-set',
    (_event, patch) => {
      const config = shields.set(patch || {});
      broadcast('shields-changed', config);
      return config;
    },
    'throw'
  );
  gate.chrome.handle(
    'shields-pause',
    (_event, payload) => {
      const { site, paused } = /** @type {any} */ (payload || {});
      const config = shields.setPaused(site, paused);
      broadcast('shields-changed', config);
      return config;
    },
    'throw'
  );

  registerInternalHandler(ipcMain, 'internal-settings-get', (_event, key) =>
    key ? settings.get(key) : settings.getAll()
  );
  registerInternalHandler(ipcMain, 'internal-settings-set', async (_event, key, value) => {
    // The two key-hash settings are written ONLY by mint / revoke (main-side, through
    // the store directly) — never by a page call, for any caller including the admin
    // tier: the launch flag is the only door to the admin tier (Mission 23 F2, DD3).
    // Refused before `settings.set`: nothing written, nothing broadcast.
    // A non-string key would skip the comparison below yet be coerced to the same
    // property name by the store, so it is refused first.
    if (typeof key !== 'string') throw new Error('internal-settings-set: key must be a string');
    if (key === 'automationKeyHashes' || key === 'automationAdminKeyHash') {
      throw new Error('internal-settings-set: "' + key + '" cannot be written through a settings call');
    }
    const config = settings.set(key, value);
    broadcastSettings();
    if (key === 'automationEnabled') await applyAutomationEnabledChange(value === true);
    if (key === 'updateCheckEnabled') applyUpdateCheckEnabled(value === true);
    if (key === 'spellcheck') {
      const enabled = value === true;
      applySpellcheck(getDefaultSession(), enabled);
      const seen = new Set();
      for (const wc of getAllWebContents()) {
        const ses = wc.session;
        if (!ses || ses.__goldfinchInternal || seen.has(ses)) continue;
        seen.add(ses);
        applySpellcheck(ses, enabled);
      }
    }
    return config;
  });
  registerInternalHandler(ipcMain, 'internal-shields-get', () => shields.get());
  registerInternalHandler(ipcMain, 'internal-shields-isolation-state', isolationState);
  registerInternalHandler(ipcMain, 'internal-shields-restart-to-apply', () => restartToApply());
  registerInternalHandler(ipcMain, 'internal-shields-set', (_event, patch) => {
    const config = shields.set(patch || {});
    broadcast('shields-changed', config);
    return config;
  });

  registerInternalHandler(ipcMain, 'automation:get-status', () => currentAutomationStatus());
  registerInternalHandler(ipcMain, 'automation:set-port', async (_event, port) => {
    settings.set('automationPort', port);
    broadcastSettings();
    await rebindMcpServer();
    return currentAutomationStatus();
  });
  // Default browser (sortie 01 leg 2 / DD7): OS state is the source of truth — no
  // settings-store write, no settings-changed broadcast. Both handlers ignore every
  // argument after _event; nothing page-supplied reaches the module.
  registerInternalHandler(ipcMain, 'default-browser:get-status', () => defaultBrowser.getStatus());
  registerInternalHandler(ipcMain, 'default-browser:make-default', () => defaultBrowser.makeDefault());
  registerInternalHandler(ipcMain, 'automation:find-free-port', async () => ({ port: await freePortInRange() }));

  // clipboard:write is the generic internal clipboard sink: the vault's secret Copy
  // (vault.js) AND the automation page's copyText fallback both ride it. Squawk 0021 / leg
  // `clipboard-and-file-modes`: a copied SECRET (`opts.secret`, an optional 3rd arg) is cleared
  // by the one helper (`secret-clipboard.js`) after 20 s and at quit; every other caller keeps
  // its plain write.
  registerInternalHandler(ipcMain, 'clipboard:write', (_event, text, opts) => {
    secretClipboard.write(text, { secret: !!opts && opts.secret === true });
    return { ok: true };
  });

  registerInternalHandler(ipcMain, 'automation:list-keys', () => {
    const hashes = settings.get('automationKeyHashes') || {};
    return {
      jars: jars.list().map((jar) => ({
        id: jar.id,
        name: jar.name,
        color: jar.color,
        hasKey: !!hashes[jar.id]
      })),
      adminEnabled: !!adminEnabled(),
      adminKeySet: (settings.get('automationAdminKeyHash') || '') !== ''
    };
  });
  registerInternalHandler(ipcMain, 'automation:jar-key-mint', async (event, jarId) => {
    // Gate first; a refusal writes nothing and broadcasts nothing. The label is the jar's own name from
    // the registry; an unknown id has no label and goes straight to the mint, which refuses it as today.
    const jar = jars.list().find((j) => j.id === jarId);
    if (jar) {
      const decision = await revealGate.confirm(event, {
        channel: 'automation:jar-key-mint',
        action: 'jar-key-mint',
        subject: jar.name
      });
      if (decision !== 'not-applicable' && decision !== 'confirmed') return { key: null, refused: 'not-confirmed' };
    }
    const key = mintJarKey(jarId, settings, jars);
    broadcastSettings();
    return { key };
  });
  registerInternalHandler(ipcMain, 'automation:jar-key-revoke', (_event, jarId) => {
    revokeJarKey(jarId, settings);
    broadcastSettings();
    return { ok: true };
  });
  registerInternalHandler(ipcMain, 'automation:admin-key-mint', async (event) => {
    const decision = await revealGate.confirm(event, {
      channel: 'automation:admin-key-mint',
      action: 'admin-key-mint'
    });
    if (decision !== 'not-applicable' && decision !== 'confirmed') return { key: null, refused: 'not-confirmed' };
    const key = mintAdminKey(settings);
    broadcastSettings();
    return { key };
  });
  registerInternalHandler(ipcMain, 'automation:admin-key-revoke', () => {
    revokeAdminKey(settings);
    broadcastSettings();
    return { ok: true };
  });

  // Chrome OR internal page (the indicator and the automation page both read it): a positive
  // class, not a deliberately-open channel.
  gate.chromeOrInternal.handle(
    'automation:get-activity',
    () => {
      const server = getMcpServer();
      return server ? server.getActivity() : { sessions: [], log: [] };
    },
    'throw'
  );

  gate.chrome.handle(
    'chrome-clipboard-write',
    (_event, text) => {
      secretClipboard.write(text);
    },
    'throw'
  );

  gate.chrome.on('unpin-toolbar-item', (_event, item) => {
    if (item !== 'media' && item !== 'shields' && item !== 'devtools') return;
    settings.set('toolbarPins', { ...settings.get('toolbarPins'), [item]: false });
    broadcastSettings();
  });

  // toggle-bookmarks-bar (M15 F1 Leg 3, DD7 / Ctrl+Shift+B): the unpin-toolbar-item
  // shape — a one-way chrome-initiated mutation that flips its own setting and
  // broadcasts itself (CLAUDE.md's "any handler mutating settings directly must
  // broadcast settings-changed itself" rule). The Settings checkbox and the
  // shortcut converge on this SAME stored value — no divergent state.
  gate.chrome.on('toggle-bookmarks-bar', () => {
    settings.set('bookmarksBarEnabled', !settings.get('bookmarksBarEnabled'));
    broadcastSettings();
  });

  // chrome-welcome-set (M16 F2 Leg 1, DD1): the welcome surface's chrome-bridge
  // write — the toggle-bookmarks-bar shape above, but ipcMain.handle (not .on)
  // so the panel can react to a validator rejection, and restricted to the two
  // welcome-relevant keys. `settings.set(` stays literal in this body — the
  // broadcast-invariant net's detection half is a call-shape regex (squawk
  // 0003) — and broadcastSettings() is this handler's own call, per CLAUDE.md's
  // "any handler mutating settings directly must broadcast itself" rule.
  gate.chrome.handle(
    'chrome-welcome-set',
    (_event, { key, value }) => {
      if (key !== 'homePage' && key !== 'searchEngine') return { ok: false, error: 'unknown key' };
      try {
        settings.set(key, value);
        broadcastSettings();
        return { ok: true };
      } catch (e) {
        return { ok: false, error: String(e && e.message) };
      }
    },
    'throw'
  );
}

module.exports = { registerSettingsIpc };
