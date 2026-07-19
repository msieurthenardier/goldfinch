/** @param {any} deps */
export function createWindowController(deps) {
  const {
    window, document, ctx, els, tabs, orderedTabIds, releaseTabWidths,
    keyboardMove, commitTabMove, activateTab, closeTab, activeTab,
    setHomePage, updateAutomationKeyState
  } = deps;
  // --- custom window controls (win+linux frameless; hidden on macOS) ---
  els.winMin.addEventListener('click', () => window.goldfinch.windowMinimize());
  els.winMax.addEventListener('click', () => window.goldfinch.windowToggleMaximize());
  els.winClose.addEventListener('click', () => window.goldfinch.windowClose());
  function setMaximized(isMax) {
    els.winMax.setAttribute('data-state', isMax ? 'maximized' : 'normal');
    els.winMax.setAttribute('aria-label', isMax ? 'Restore' : 'Maximize');
    els.winMax.title = isMax ? 'Restore' : 'Maximize';
    // Icon is drawn in CSS keyed off data-state (normal=square, maximized=restore pair);
    // no textContent so the CSS pseudo-element glyphs aren't clobbered.
  }
  window.goldfinch.windowIsMaximized().then(setMaximized);
  window.goldfinch.onWindowMaximizedChange(setMaximized);

  function focusTab(id) {
    const t = tabs.get(id);
    if (t && t.btn) /** @type {HTMLElement} */ (t.btn).focus();
  }
  // announceTabStatus (M09 F2 DD3): transient sr-only status announcement for tab-strip
  // actions, mirroring the existing #media-status idiom on its own dedicated region so
  // tab announcements never race media-panel ones.
  function announceTabStatus(text) {
    els.tabStatus.textContent = text;
  }
  els.tabs.addEventListener('keydown', (e) => {
    // DD1: DOM order is authoritative for the strip's keyboard contract.
    const ids = orderedTabIds();
    if (!ids.length) return;
    // Cast the closest() RESULT (Element|null) to HTMLElement so `.dataset` typechecks —
    // `.closest()` returns Element regardless of receiver, and `.dataset` is HTMLElement-only.
    const cur = /** @type {HTMLElement|null} */ (document.activeElement?.closest('.tab'))?.dataset.id || ctx.activeTabId;

    // Reorder (M09 F2 DD3): Ctrl+Shift+ArrowLeft/Right moves the FOCUSED tab one slot.
    // Checked BEFORE the plain-arrow branch below so a modified arrow never falls
    // through to select-and-focus navigation; same no-hijack scoping as the rest of
    // this handler (it only runs when focus is inside the strip). Selection
    // (aria-selected) is untouched — only the focused tab's DOM position moves, and it
    // may not be the active tab (Edge Cases: focused tab ≠ active tab).
    if (e.ctrlKey && e.shiftKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      e.preventDefault();
      releaseTabWidths(); // keyboard reorder always reflows immediately (DD5 parity with Delete)
      const direction = e.key === 'ArrowRight' ? 'right' : 'left';
      const moved = keyboardMove(ids, cur, direction);
      if (moved !== ids) {
        const targetIndex = moved.indexOf(cur);
        commitTabMove(cur, targetIndex);
        focusTab(cur);
        announceTabStatus(`Tab moved to position ${targetIndex + 1} of ${moved.length}`);
      }
      // At an end (or a single tab), keyboardMove no-ops silently — no announcement.
      return;
    }

    const idx = Math.max(0, ids.indexOf(cur));
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      const next = ids[(idx + (e.key === 'ArrowRight' ? 1 : ids.length - 1)) % ids.length];
      activateTab(next);
      focusTab(next);
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      const next = e.key === 'Home' ? ids[0] : ids[ids.length - 1];
      activateTab(next);
      focusTab(next);
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      releaseTabWidths(); // keyboard close always reflows immediately (DD5) — clears any active freeze
      closeTab(cur);
      const now = activeTab();
      if (now && now.btn) focusTab(now.id);
    }
  });

  function applyToolbarPins(pins) {
    els.toggleMedia.classList.toggle('hidden', !pins.media);
    els.togglePrivacy.classList.toggle('hidden', !pins.shields);
    // DD5: pin-state-driven only — never coupled to the active tab type. The button
    // stays visible on internal tabs (its click no-ops via the isInternalTab guard).
    els.toggleDevtools.classList.toggle('hidden', !pins.devtools);
  }

  window.goldfinch.settingsGet('toolbarPins').then(applyToolbarPins).catch(() => {});

  window.goldfinch.onSettingsChanged((all) => {
    if (all && all.homePage !== undefined) setHomePage(all.homePage);
    if (all && all.toolbarPins) applyToolbarPins(all.toolbarPins);
    // F7 (Flight 3, Leg 6 HAT): settings-changed always carries the FULL settings
    // object (settings.getAll()), so automationKeyHashes/automationAdminKeyHash are
    // always present here — re-derive the enabled-key state on every broadcast
    // (mint/revoke/admin-mint/admin-revoke all fire this channel).
    if (all) updateAutomationKeyState(all);
  });



  return { setMaximized, announceTabStatus, applyToolbarPins };
}
