// Mission 20 Flight 3 Leg 1 (DD11): the generic sheet-activation dispatch
// switch and the shared overlay-closed sink, extracted verbatim out of
// renderer.js (behaviour-preserving move — the F2 debrief's recommendation 2)
// to give legs 2-3's two new surfaces (crash panel, hang bar) headroom in the
// composition root. The three controllers' own `handleActivation` chain
// (downloads / vault / site-security, chained ahead of the generic dispatch
// at the onActivated call site) stays in renderer.js — only the switch itself
// and the closed handler moved.
//
// Every free identifier the switch/closed-handler body reads is an injected
// dependency — no `import` of renderer.js module state, no `globalThis`
// reach. `pageCtx`/`tabCtx` are threaded as GETTERS (`() => pageCtx`), not
// direct properties: both are `const` objects declared in renderer.js AFTER
// this switch's original textual position, so a direct property at
// construction time would be a temporal-dead-zone `ReferenceError` at module
// load — the getter defers the read to dispatch time, by which point both
// exist.

/**
 * @param {{
 *   KEBAB_ACTIONS: Record<string, () => void>,
 *   openNewContainerOverlay: () => void,
 *   openNewTab: (container?: any) => void,
 *   jarsClient: any,
 *   openJarsPage: () => void,
 *   createContainerAndOpenTab: (rawName: string) => void,
 *   bookmarksBarController: any,
 *   findTabByWcId: (wcId: number) => any,
 *   createTab: (url: string, container?: any, opts?: any) => any,
 *   basenameFromUrl: (url: string) => string,
 *   toast: (title: string, body: string) => void,
 *   capPendingQuery: (text: string) => string,
 *   toUrl: (input: string) => string | null,
 *   openWelcomeTab: (opts: any) => any,
 *   orderedTabIds: () => string[],
 *   ctx: any,
 *   activateTab: (id: string) => any,
 *   closeTab: (id: string) => void,
 *   tabs: Map<string, any>,
 *   announceTabStatus: (text: string) => void,
 *   moveOutcomeMessage: (result: any, destination: string) => string,
 *   dispatchChromeAction: (action: string) => void,
 *   handleBookmarkStarActivate: (tab: any) => void,
 *   dispatchSuggestion: (id: string) => void,
 *   handleSuggestionsClosed: (reason: string) => void,
 *   vaultIndicatorAction: (action: 'lock'|'unlock') => void,
 *   vaultHandleClosed: (payload: { menuType: string, reason: string }) => void,
 *   siteSecurityHandleClosed: (payload: { menuType: string, reason: string }) => void,
 *   bridge: any,
 *   els: Record<string, any>,
 *   pageCtx: () => any,
 *   tabCtx: () => any
 * }} deps
 */
export function createOverlayDispatch(deps) {
  const {
    KEBAB_ACTIONS,
    openNewContainerOverlay,
    openNewTab,
    jarsClient,
    openJarsPage,
    createContainerAndOpenTab,
    bookmarksBarController,
    findTabByWcId,
    createTab,
    basenameFromUrl,
    toast,
    capPendingQuery,
    toUrl,
    openWelcomeTab,
    orderedTabIds,
    ctx,
    activateTab,
    closeTab,
    tabs,
    announceTabStatus,
    moveOutcomeMessage,
    dispatchChromeAction,
    handleBookmarkStarActivate,
    dispatchSuggestion,
    handleSuggestionsClosed,
    vaultIndicatorAction,
    vaultHandleClosed,
    siteSecurityHandleClosed,
    bridge,
    els,
    pageCtx,
    tabCtx
  } = deps;

  // Channel 6: execute the activated item's action via the named action bodies /
  // shared helpers (one source of truth). Arrives AFTER
  // the channel-7 'activated' close (main emits 7 before 6), so trigger state is
  // already reset and the action wins any focus race. `value` (Leg 3) is the
  // input-dialog's text — shape-validated main-side (string, ≤24), data here.
  function dispatchActivation({ menuType, id, value }) {
    switch (menuType) {
      case 'kebab': {
        const fn = KEBAB_ACTIONS[id];
        if (fn) fn();
        break;
      }
      case 'container': {
        // NAMESPACED id dispatch (round-2 design catch): `jar:<jarId>` selects
        // that jar — even one literally named "New Container" (slug id
        // `new-container`) or "Burner"; sentinels ride the `action:` prefix, so
        // a user jar can never shadow them.
        if (id === 'action:new-container') {
          // Activated-close-then-fresh-open (design decision): main already
          // closed the container menu (reason 'activated' — the normal channel-4
          // path); immediately re-open menuType 'new-container' as a FRESH open
          // through the same path as any trigger open (new token; uniform
          // suppress/aria bookkeeping). The one-IPC-round-trip hide/re-show
          // blink is the accepted variation.
          openNewContainerOverlay();
        } else if (id === 'action:burner') {
          openNewTab(jarsClient.makeBurner()); // M16 F2 Leg 1 (DD4)
        } else if (id === 'action:manage-jars') {
          openJarsPage();
        } else if (id.startsWith('jar:')) {
          const jarId = id.slice('jar:'.length);
          const c = jarsClient.containers.find((x) => x.id === jarId);
          if (c) openNewTab(c); // M16 F2 Leg 1 (DD4)
        }
        break;
      }
      case 'new-container': {
        // Shared submit body (the old dialog's create path, extracted): trim
        // guard + newContainerCreate → push + createTab. The sheet page already
        // guards whitespace-only input (dialog stays open page-side).
        if (id === 'create') createContainerAndOpenTab(value);
        break;
      }
      case 'auth-basic': {
        // The only channel-4 activation is the NON-SECRET id:'cancel' (M14 F1 L2) —
        // the credential rides the dedicated menuOverlay.authSubmit invoke, never
        // this dispatch. Main's auth store maps the 'activated' close to
        // resolve-cancel; nothing to do chrome-side (validated no-op).
        break;
      }
      case 'cert-picker': {
        // Selection already resolved MAIN-SIDE, ledger-first, in register-
        // overlay-ipc BEFORE this unconditional forward (M14 F1 L3 — the
        // deliberate deviation from vault-picker's chrome-side dispatch). Every
        // id ('cert:<i>' / 'cancel') is a validated no-op here.
        break;
      }
      // vault-picker, vault-recovery-show, vault-accesskey-show, vault-adminkey-show:
      // handled by vaultController.handleActivation (chained ahead of this dispatch —
      // see the onActivated wiring above), so no case for them lives here (M15 F2 Leg 1
      // renderer-extraction).
      case 'bookmark-edit': {
        // No channel-4 activation ever rides this menuType — Remove/Done submit
        // over the DEDICATED menu-overlay:bookmark-edit-submit invoke, never
        // sendActivated (24-char cap; DD3-preserving). Included for switch
        // completeness / VALIDATED-NO-OP discipline, the auth-basic/cert-picker
        // precedent.
        break;
      }
      case 'bookmarks-overflow': {
        // Index dispatch (M15 F1 Leg 3, DD9): `bookmark:<i>` (row click) and
        // `bookmark-edit:<i>` (the sheet's first per-row contextmenu, sent via
        // sendActivatedOnce on the SAME channel-4) both resolve against the
        // chrome-side snapshot in bookmarks-bar.js — VALIDATED-NO-OP on an
        // out-of-range/malformed id.
        bookmarksBarController.dispatch(id);
        break;
      }
      case 'page-context': {
        // Bodies read the pageCtx fields CAPTURED at open (TOCTOU: acted-on
        // wcId is never re-resolved via activeTab()). VALIDATED-NO-OP discipline
        // on EVERY id (design review): a synchronous local open can overwrite
        // pageCtx between channel 7 and channel 6, and params can be gone by
        // dispatch time (tab closed) — each body re-guards its inputs and never
        // throws on a stale dispatch (main-side handlers already tolerate dead
        // wcId targets).
        const p = pageCtx().params || {};
        const wcId = pageCtx().wcId;
        // D3 (M06 F2 HAT): link/image/selection-search opens inherit the SOURCE
        // tab's jar (inheritContainerFrom, defined near makeBurner) instead of
        // createTab's default-jar resolution — computed once here (all three
        // call sites below are mutually exclusive per dispatch; the source tab
        // never changes mid-dispatch, so one lookup covers all three bodies).
        const srcContainer = jarsClient.inheritContainerFrom(findTabByWcId(wcId));
        if (id === 'link:open') {
          if (typeof p.linkURL === 'string' && p.linkURL) createTab(p.linkURL, srcContainer);
        } else if (id === 'link:copy') {
          if (typeof p.linkURL === 'string' && p.linkURL) bridge.clipboardWriteText(p.linkURL);
        } else if (id === 'image:open' || id === 'image:copy' || id === 'image:save') {
          // Same srcURL || imageURL preference + mediaType gate as the builder.
          const imgSrc = p.mediaType === 'image' ? p.srcURL || p.imageURL : null;
          if (typeof imgSrc === 'string' && imgSrc) {
            if (id === 'image:open') {
              createTab(imgSrc, srcContainer);
            } else if (id === 'image:copy') {
              bridge.clipboardWriteText(imgSrc);
            } else {
              const r = bridge.downloadMedia({
                webContentsId: wcId,
                url: imgSrc,
                suggestedName: basenameFromUrl(imgSrc)
              });
              Promise.resolve(r)
                .then((res) => {
                  if (!res || !res.ok) toast('Download failed', (res && res.error) || 'Unknown error');
                })
                .catch(() => toast('Download failed', 'Unknown error'));
            }
          }
        } else if (id === 'sel:copy') {
          if (typeof p.selectionText === 'string' && p.selectionText) {
            bridge.clipboardWriteText(p.selectionText);
          }
        } else if (id === 'sel:search') {
          // M16 F2 Leg 2 (DD3): shares the address bar's null-engine handoff
          if (typeof p.selectionText === 'string' && p.selectionText) {
            const q = capPendingQuery(p.selectionText),
              u = toUrl(q); // Capture site 2/2: capped to PENDING_QUERY_MAX
            if (u == null) openWelcomeTab({ container: srcContainer, reasons: ['search'], pendingQuery: q });
            else createTab(u, srcContainer);
          }
        } else if (id.startsWith('edit:')) {
          // Allowlisted edit-action dispatch (main re-validates the allowlist too).
          // Also re-check the captured editFlags that gated menu construction
          // (page-context-model.js: canCut/canCopy/canPaste/canUndo/canRedo).
          const action = id.slice('edit:'.length);
          const flagKey = 'can' + action.charAt(0).toUpperCase() + action.slice(1);
          if (
            p.isEditable &&
            ['cut', 'copy', 'paste', 'undo', 'redo'].includes(action) &&
            p.editFlags &&
            p.editFlags[/** @type {'canCut'|'canCopy'|'canPaste'|'canUndo'|'canRedo'} */ (flagKey)]
          ) {
            bridge.pageContextAction({ webContentsId: wcId, action });
          }
        } else if (id.startsWith('spell:')) {
          // INDEX dispatch (DD8): the id carries only the index; the word resolves
          // from the CAPTURED suggestions with bounds/type validation — a guest
          // string never round-trips as a command. Out-of-range / malformed /
          // params-gone → validated no-op.
          const i = Number.parseInt(id.slice('spell:'.length), 10);
          const sugg = p.dictionarySuggestions;
          if (
            Number.isInteger(i) &&
            i >= 0 &&
            Array.isArray(sugg) &&
            i < Math.min(sugg.length, 8) &&
            typeof sugg[i] === 'string'
          ) {
            bridge.correctMisspelling({ webContentsId: wcId, word: sugg[i] });
          }
        } else if (id === 'action:inspect') {
          if (wcId != null) bridge.toggleDevtools({ webContentsId: wcId });
        } else if (id === 'action:bookmark-page') {
          // VALIDATED-NO-OP (M15 F1 Leg 2): re-resolve the tab from the
          // CAPTURED wcId (TOCTOU rule — never activeTab()); no-op if gone,
          // then run the shared star handler against THAT tab.
          const bmTab = wcId != null ? findTabByWcId(wcId) : null;
          if (bmTab) handleBookmarkStarActivate(bmTab);
        } else if (id.startsWith('action:unpin:')) {
          const item = id.slice('action:unpin:'.length);
          if (item === 'media' || item === 'shields' || item === 'devtools') {
            bridge.unpinToolbarItem(item);
            // Dispatch-body refocus: the unpin hides the button the menu was
            // anchored to — land focus on the address bar. NOT the reason map
            // (page-context stays escape-only).
            els.address.focus();
          }
        } else if (id === 'action:vault-lock') {
          vaultIndicatorAction('lock');
        } else if (id === 'action:vault-unlock') {
          vaultIndicatorAction('unlock');
        } // squawk 0038 + Flight 4 Leg 5 HAT fix: anchor never hides (locked↔unlocked only) — no refocus override needed, unlike unpin above
        break;
      }
      case 'tab-context': {
        // TOCTOU discipline (design review, same pattern as page-context above):
        // the tab id is captured at OPEN (tabCtx.tabId), never re-resolved via
        // activeTab(); every body re-validates the tab still exists via tabs.get
        // and no-ops (never throws) on a vanished id.
        const tabId = tabCtx().tabId;
        const target = tabId ? tabs.get(tabId) : null;
        if (id === 'tab:close') {
          if (target) closeTab(tabId);
        } else if (id === 'tab:close-others' || id === 'tab:close-right') {
          if (!target) break;
          // Ordered-sweep batch close (flight DD2 ruling — the onJarWiped/
          // refreshOpenTabJars activation-flicker idiom): snapshot the targets
          // BEFORE any close mutates the strip, activate the ANCHOR (the invoking
          // tab) FIRST when the active tab is among the targets (Chrome parity —
          // the anchor becomes active), THEN close each target. Activating first
          // means none of the targets is still the active tab by the time
          // closeTab runs on it, so closeTab's own next-tab fallback never fires
          // mid-sweep — never let it cascade.
          const ids = orderedTabIds();
          const anchorIndex = ids.indexOf(tabId);
          if (anchorIndex === -1) break; // vanished — no-op
          const targetIds = id === 'tab:close-others' ? ids.filter((i) => i !== tabId) : ids.slice(anchorIndex + 1);
          if (!targetIds.length) break;
          if (targetIds.includes(ctx.activeTabId)) activateTab(tabId);
          for (const t of targetIds) closeTab(t);
        } else if (id === 'tab:duplicate') {
          // Address + jar + nav history (DD1's resolved open question): the
          // history-snapshot invoke + createTab with restoreHistory + insertAt
          // sourceIndex+1 (Chrome parity — lands beside the source). Title is
          // seeded from the renderer's OWN tab.title — no round-trip through main.
          if (!target || target.wcId == null) break;
          const sourceContainer = target.container;
          const sourceTitle = target.title;
          const sourceUrl = target.url;
          bridge.tabHistorySnapshot({ webContentsId: target.wcId }).then((snap) => {
            if (!snap) return; // internal/dead source by the time the invoke resolved — no-op
            // sourceIndex is computed AND used here, synchronously at resolve time
            // (M09 F6 Leg 3, DD6 — the F5 staleness sibling: capturing it BEFORE
            // the invoke could misplace the duplicate if the strip mutated during
            // the round-trip). A source that vanished mid-invoke (-1) appends.
            const sourceIndex = orderedTabIds().indexOf(tabId);
            createTab(sourceUrl, sourceContainer, {
              restoreHistory: { entries: snap.entries, index: snap.index, title: sourceTitle },
              insertAt: sourceIndex === -1 ? null : sourceIndex + 1
            });
          });
        } else if (id === 'tab:move-new-window') {
          // Move to new window (M09 F6 Leg 4, DD5 / review H2): the invoke
          // carries THIS renderer's strip snapshot — a burner's synthesized
          // container and the favicon exist ONLY renderer-side; main cannot
          // rebuild either from the wcId (it re-derives url/title itself at
          // adopt-send time). Validated no-op on a vanished/wcId-less target;
          // the strip removal arrives via the tab-moved-away push, never done
          // locally (main is the executor).
          if (!target || target.wcId == null) break;
          bridge.tabMoveToNewWindow({
            wcId: target.wcId,
            url: target.url,
            title: target.title,
            favicon: target.favicon,
            container: target.container
          });
        } else if (id.startsWith('tab:move-window:')) {
          // Move to an EXISTING window (M09 F8 Leg 4, DD8) — the tab's only way
          // across windows in F8. Same strip snapshot as the new-window path above,
          // plus the destination.
          //
          // The windowId is ECHOED from the item id main built it into — never a
          // position in the current list, which is exactly what the reversed ordinal
          // scheme would have sent. Re-reading it here rather than re-deriving it
          // from moveTargetsCache is the point: the cache may have been re-pushed
          // since the menu opened, and this move means the window the USER picked.
          // Main re-resolves the id through the registry and REFUSES if that window
          // has closed (DD5) rather than re-pointing at a survivor.
          if (!target || target.wcId == null) break;
          const windowId = Number(id.slice('tab:move-window:'.length));
          if (!Number.isInteger(windowId)) break;
          bridge
            .tabMoveToWindow({
              wcId: target.wcId,
              url: target.url,
              title: target.title,
              favicon: target.favicon,
              container: target.container,
              windowId
            })
            .then((result) => {
              // DD5: every outcome is announced. On success `tab-moved-away` has
              // already removed the strip entry, so this is all that is left either way.
              announceTabStatus(moveOutcomeMessage(result, 'another window'));
            });
        } else if (id === 'tab:reopen-closed') {
          // The EXISTING dispatchChromeAction('reopen-closed-tab') case (dispatch
          // reuse, DD2) — its jar-fallback/positional-reopen decisions ride along
          // free. Deliberately NOT gated on `target`: reopen acts on the closed-tab
          // stack, not the invoking tab, which may itself have vanished by now.
          dispatchChromeAction('reopen-closed-tab');
        }
        break;
      }
      case 'suggestions': {
        // INDEX dispatch (the spell:<i> idiom): the id carries only the row
        // index; the URL resolves from `suggest.items`, which channel 7 (just
        // above, fired before this) deliberately left intact for exactly this
        // read on the 'activated' reason. Vanished/mismatched (e.g. a tab switch
        // raced the click and bumped suggest.seq, invalidating suggest.items in
        // between) → no-op, never throw.
        dispatchSuggestion(id);
        break;
      }
    }
  }

  // Channel 7: the single close-state sink. Stale tokens (a re-open raced an old
  // instance's close) are dropped WHOLE — a stale close must not clear the newer
  // open's state (and, for page-context, must not consume the newer open's
  // returnFocus). aria-expanded resets on EVERY (non-stale) reason — guarded on
  // ariaTarget() (null for page-context, whose transient trigger is never
  // stamped). Refocus is the per-entry reason policy (chrome-side half — main
  // already moved webContents-level focus for escape/activated): fixed-trigger
  // menus focus the trigger on escape/activated; page-context is escape-only →
  // the captured returnFocus (cleared after use). toggle → no move (the click
  // already focused chrome); blur → NO refocus (never steal focus from another
  // app); tab-switch/superseded/tab-close/tab-hide/teardown → no move (the
  // incoming guest keeps focus).
  function handleClosed({ menuType, reason }) {
    // Suggestions branch (design review, HIGH): main-initiated closes (window
    // blur, tab-switch, etc.) reach the sheet WITHOUT going through
    // closeSuggestions() — this is the only place those reset local state, so
    // every NON-STALE suggestions close resets it here too. Timers are ALWAYS
    // cancelled (incl. 'activated' — this is what lets a real Ch6 activation win
    // the pointer-blur grace-timer race: the timer must die the instant the row
    // click's close lands, not 150 ms later). items/selectedIndex are the
    // EXCEPTION on 'activated': channel 7 (this handler) fires strictly BEFORE
    // channel 6 for the same activation (main emits 7 then 6 — round-2 design
    // lock), so the Ch6 `sug:<i>` dispatch below still needs `suggest.items` to
    // resolve the clicked row's URL. Ch6 finishes the reset once it has read it.
    if (menuType === 'suggestions') {
      handleSuggestionsClosed(reason);
    }
    // Vault-owned close branches (vault-unlock's two dismiss-abandon guards, the
    // vault-capture dismiss-drop path) moved wholesale to vault-controller.js
    // (M15 F2 Leg 1 renderer-extraction) — see its handleClosed.
    vaultHandleClosed({ menuType, reason });
    // Mission 20 Flight 2 Leg 1 (DD11 seed): a no-op today (site-info/cert-viewer/
    // cert-override have no close-side state yet) — the seat legs 3-4 use for the
    // cert-override card's navigation-away close.
    siteSecurityHandleClosed({ menuType, reason });
  }

  return { dispatchActivation, handleClosed };
}
