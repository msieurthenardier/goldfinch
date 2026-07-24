/**
 * Global type declarations for the Goldfinch renderer process.
 * Mirrors the contextBridge surface exposed by src/preload/chrome-preload.js.
 */

/** One attached automation session in the audit snapshot (SC10/DD6). Carries no key/hash. */
interface AutomationSession {
  sessionId: string;
  identity: string;
  kind: 'admin' | 'jar';
  jarId: string | null;
  since: number;
}

/** One entry in the bounded automation action log. Carries no key/hash. */
interface AutomationLogEntry {
  ts: number;
  sessionId: string;
  identity: string;
  op: string;
  targetWcId: number | null;
  outcome: 'ok' | 'error';
  errorCode: string | null;
  /** Per-op context string for auditability (e.g. url=…, key=…, text(N chars)). Null when not applicable. */
  detail?: string | null;
}

/** The automation activity snapshot returned by get-activity and the live broadcast. */
interface AutomationActivity {
  sessions: AutomationSession[];
  log: AutomationLogEntry[];
}

interface GoldfinchBridge {
  // --- platform ---
  platform: string;

  // --- window controls ---
  windowMinimize(): void;
  windowToggleMaximize(): void;
  windowClose(): void;
  appQuit(): void;
  unpinToolbarItem(item: string): void;
  windowIsMaximized(): Promise<boolean>;
  onWindowMaximizedChange(cb: (isMax: boolean) => void): void;
  /** New Window command (M09 F6 Leg 4, DD5): creates a fresh window (boots its
   * home tab normally); resolves the new BaseWindow id, or null when refused. */
  windowCreate(): Promise<number | null>;
  /** Boot-config invoke (M09 F6 Leg 4, DD5/L4 + review H1): joins the renderer's
   * boot-gating Promise.all. bootTab defaults true; false for move-created
   * windows. Serving it main-side releases the queued adopt-protocol sends.
   * M09 F9 / DD4: a restored window also carries its ordered saved tab list
   * (restoreTabs), served with bootTab:false — the renderer creates those fresh. */
  windowBootConfig(): Promise<{ bootTab: boolean, restoreTabs?: Array<{ url: string, jarId: string, active: boolean }> }>;

  // --- downloads ---
  downloadMedia(payload: any): Promise<any>;
  chooseDownloadDir(): Promise<string | null>;
  showItemInFolder(savePath: string): void;
  downloadsSnapshot(): Promise<Array<{
    id: number; filename: string; state?: string; received?: number; total?: number;
    paused?: boolean; endTime: number | null; active: boolean;
  }>>;
  // M11 F1 Leg 1 chrome-trust file actions — resolve the actionable savePath
  // MAIN-SIDE by numeric id (never a path from the renderer).
  openDownloadedFile(id: number): Promise<{ ok: boolean; error?: string }>;
  revealDownloadedFile(id: number): Promise<{ ok: boolean }>;

  // --- privacy ---
  onPrivacyNet(cb: (data: any) => void): void;
  onPrivacyPermission(cb: (data: any) => void): void;
  privacyCookies(payload: any): Promise<any>;
  privacyClearCookies(payload: any): Promise<any>;
  privacyClearStorage(payload: any): Promise<any>;

  // --- settings (chrome-trusted; read + subscribe only) ---
  // key omitted (F7, Flight 3 Leg 6 HAT) -> settings-get's main-side handler
  // (`key ? settings.get(key) : settings.getAll()`) returns the FULL settings
  // object — used to read the initial automation key-enabled state at boot.
  settingsGet(key?: string): Promise<any>;
  onSettingsChanged(cb: (all: any) => void): void;

  // --- history (chrome-trusted; M08 Flight 4 Leg 1 — the omnibox's first history bridge method) ---
  historySuggest(payload: any): Promise<any>;

  // --- shields ---
  shieldsGet(): Promise<any>;
  shieldsSet(patch: any): Promise<any>;
  shieldsPause(payload: any): Promise<any>;
  onShieldsChanged(cb: (cfg: any) => void): void;

  // --- automation activity (chrome-trusted read + subscribe; SC10/DD6) ---
  automationGetActivity(): Promise<AutomationActivity>;
  onAutomationActivity(cb: (snap: AutomationActivity) => void): void;

  // --- page zoom ---
  zoomApply(payload: { webContentsId: number; action: string }): void;
  onZoomChanged(cb: (d: { wcId: number; factor: number }) => void): void;
  getZoom(payload: { webContentsId: number }): Promise<number | null>;

  // --- native print ---
  print(payload: { webContentsId: number }): void;

  // --- devtools (human path; DD1) ---
  toggleDevtools(payload: { webContentsId: number }): Promise<boolean>;
  isDevtoolsOpen(payload: { webContentsId: number }): Promise<boolean>;
  onDevtoolsStateChanged(cb: (d: { wcId: number; open: boolean }) => void): void;

  // --- new container create (renderer collects name, main creates jar) ---
  /** Create a new container by name; main calls jars.add and signals back chrome-new-tab-in-container. */
  newContainerCreate(name: string): Promise<{ id: string; name: string; color: string; partition: string } | null>;

  // --- page context menu (main → renderer) ---
  /** Main fires with { wcId, params } — renderer builds the model and opens it on the
   *  menu-overlay sheet (menuType 'page-context'). */
  onPageContextMenu(cb: (d: { wcId: number; params: any }) => void): void;
  /** Write text to the system clipboard (invoked from the HTML context menu Copy action). */
  clipboardWriteText(text: string): Promise<void>;
  /** Replace a misspelled word with the chosen suggestion (context menu spelling correction). */
  correctMisspelling(payload: { webContentsId: number | null; word: string }): Promise<void>;
  /** Execute an edit action (cut/copy/paste/undo/redo) on a guest WebContents. */
  pageContextAction(payload: { webContentsId: number | null; action: string }): Promise<void>;

  // --- cookie jars / identities ---
  jarsList(): Promise<any>;
  jarsAdd(payload: any): Promise<any>;
  /** Structured-cloned container object, or the frozen BURNER sentinel — detect by id (DD3). */
  jarsGetDefault(): Promise<any>;
  /** Retention-edit (M08 Flight 3, Leg 1 / DD4; chrome-bridge wrapper added M10 Flight 2, Leg 3
   * for the behavior-test act path — internal-session evaluate is uniformly refused, so a
   * chrome-target evaluate call against this wrapper is the mechanism, not the internal page's
   * own `<select>`). */
  jarsSetRetention(payload: { id: string; days: number }): Promise<{ ok: boolean; container?: object; error?: string }>;
  identityNew(payload: any): Promise<any>;

  // --- main -> renderer events ---
  /** Fired after every jar mutation with { containers, defaultId } (defaultId null ⇔ Burner). */
  onJarsChanged(cb: (data: { containers: any[]; defaultId: string | null }) => void): void;
  /** Fired after a jars-wipe succeeds, with { id } (Flight 4 Leg 3, DD4) — the cue to reload the jar's open web tabs. */
  onJarWiped(cb: (data: { id: string }) => void): void;
  onDownloadProgress(cb: (data: any) => void): void;
  onDownloadDone(cb: (data: any) => void): void;
  /** DD7 (M06 F3 Leg 4): payload carries the opener's session partition (from
   * main's tabViews registry) so the renderer can inherit the opener's jar via
   * inheritFromPartition; `openerPartition` is undefined when the opener's
   * registry entry is already gone (closed before the popup IPC lands). */
  onOpenTab(cb: (payload: { url: string; openerPartition?: string }) => void): void;
  /** Fired by the main-side Ctrl+F before-input-event capture (SC4/DD2). No payload. */
  onOpenFind(cb: () => void): void;

  // --- find overlay (M05 Flight 7 — main-owned floating find WebContentsView) ---
  /** Open (or restore) the overlay find session for a web tab, seeding its input. */
  findOverlayOpen(payload: { wcId: number; findText: string }): void;
  /** Chrome-initiated close (navigation-close). Main resolves refocusGuest:false from the sender — no focus move. */
  findOverlayClose(): void;
  /** Overlay-side user close (Esc/✕) — clear the tab's findOpen so switch-back doesn't ghost-reopen. */
  onFindOverlayClosed(cb: (d: { wcId: number }) => void): void;
  /** Per-tab text sync — fired on every overlay query, empty text included (deletion sync). */
  onFindOverlayText(cb: (d: { wcId: number; text: string }) => void): void;
  /** Fired by the main-side Ctrl+J before-input-event capture (DD2). No payload. */
  onOpenDownloads(cb: () => void): void;

  // --- menu-overlay sheet (M05 Flight 8, DD4 — chrome owns state/model/actions) ---
  /** Channel 1: open (or model-replace) a menu on the sheet. The model is
   * template-shaped per menuType (Leg 3): `menu` items {id,label,color?,variant?},
   * `info-popup` rows {type,text?/label?/value?,id?}, `input-dialog` (empty),
   * `suggestions` (M08 Flight 4 Leg 3) the omnibox OBJECT shape — distinct from
   * every other template's flat item array (DD1). */
  menuOverlayOpen(payload: {
    menuType: string;
    model: Array<{
      id?: string;
      label?: string;
      color?: string;
      variant?: string;
      type?: 'item' | 'separator' | 'note' | 'row' | 'action';
      text?: string;
      value?: string;
    }> | {
      items: Array<{ primary?: string; secondary?: string }>;
      selectedIndex: number;
      emptyNote?: string;
    };
    anchor: { alignRight?: number; alignLeft?: number; x?: number; y: number };
    startIndex: number;
    token: number;
    /** M08 Flight 4 DD2: gates the sheet's sole focus site (`deliverInit`) — the
     * suggestions controller opens the sheet without stealing OS focus from `#address`. */
    noFocus?: boolean;
  }): void;
  /** Channel 2: programmatic close — reason allowlisted main-side ('toggle' | 'superseded' |
   * 'escape' | 'blur' | 'navigation' | 'input-empty' | 'activated'). */
  menuOverlayClose(payload?: { reason?: 'toggle' | 'superseded' | 'escape' | 'blur' | 'navigation' | 'input-empty' | 'activated' }): void;
  /** Channel 6: an item was activated on the sheet; chrome executes the action.
   * `value` (Leg 3) is the input-dialog's text — main-validated (string, ≤24). */
  onMenuOverlayActivated(cb: (d: { menuType: string; id: string; value?: string }) => void): void;
  /** Channel 7: the menu closed for ANY reason; chrome resets state per reason/token. */
  onMenuOverlayClosed(cb: (d: { menuType: string; reason: string; token: number }) => void): void;
  /** DD13: chrome-class accelerators forwarded from the sheet's before-input-event. */
  onChromeShortcutAction(cb: (d: { action: string }) => void): void;

  // The internal `goldfinch://` partition string (single source of truth).
  internalPartition: string;

  // --- tab lifecycle (Flight 3, Leg 1 — web tab WebContentsView substrate) ---
  /** Create a web tab view in main; returns the guest wcId (invoke). */
  tabCreate(payload: { url: string; partition: string; trusted: boolean }): Promise<number>;
  /** Close/destroy a web tab view (fire-and-forget). `stripIndex` (M09 F4 Leg 1,
   * optional/additive) is the tab's visual strip position at close time, snapshotted
   * pre-DOM-removal — rides to main for a closed-tab-stack entry's positional reopen. */
  tabClose(wcId: number, stripIndex?: number): void;
  /** Pop the closed-tab stack (M09 F4 Leg 2, DD2 step 2; invoke). Returns the popped
   * entry, or `null` on an empty stack (renderer no-ops silently). `partition` is
   * present iff the entry's original jar still exists (main-side resolved against
   * `jars.list()`); otherwise omitted with `jarFallback: true`. `url` has already
   * been re-validated main-side (`isSafeTabUrl`, defense-in-depth). */
  tabReopen(): Promise<{
    url: string;
    title: string;
    partition?: string;
    stripIndex: number;
    navEntries: unknown[];
    navIndex: number;
    jarFallback: boolean;
  } | null>;
  /** Tab context menu (M09 F5 Leg 1, DD3): snapshot a live web tab's navigation
   * history for Duplicate. Web tabs only — a dead/missing/internal target
   * (TOCTOU-guarded on the passed webContentsId) resolves `null`. */
  tabHistorySnapshot(payload: { webContentsId: number }): Promise<{ entries: unknown[]; index: number } | null>;
  /** Tab context menu (M09 F5 Leg 1, DD3): the closed-tab stack's current size.
   * Since M09 F6 Leg 3 (DD6) this is the push-cache's BOOT SEED only — live
   * updates arrive via onClosedTabStackChanged below. */
  closedTabStackSize(): Promise<number>;
  /** DD6 push-cache (M09 F6 Leg 3): pushed by main with `{ size }` on every
   * closed-tab-stack mutation (capture pushes, reopen pops). The renderer caches
   * it — a push always wins over the boot-seed invoke's resolve — so the
   * tab-context opener builds its model synchronously. */
  onClosedTabStackChanged(cb: (d: { size: number }) => void): void;
  /** Move a tab to a NEW window (M09 F6 Leg 4, DD5 / review H2). The payload is
   * the SOURCE renderer's strip snapshot — favicon and (burner) container exist
   * only renderer-side. Resolves { ok, windowId } or null when refused
   * (vanished/internal/sole-tab target — validated no-op). */
  tabMoveToNewWindow(payload: {
    wcId: number;
    url: string;
    title: string;
    favicon: string | null;
    container: { id: string; name: string; color: string; partition: string; burner?: boolean };
  }): Promise<{ ok: boolean; windowId: number } | null>;
  /** Tear a tab off into its own new window by DRAG (M09 F8 Leg 3, DD5/DD16). Same
   * payload and the same main-side core as tabMoveToNewWindow, and it carries NO
   * coordinate: "did the pointer leave the strip?" was answered window-locally, against
   * the strip's own rect in this window's own viewport, before this was called. Unlike
   * the menu path it NEVER resolves a bare null — a drag cannot be omitted at build time
   * the way a menu item can, so every refusal arrives with a `reason` to announce
   * (DD5: silence is not an outcome). */
  tabTearOff(payload: {
    wcId: number;
    url: string;
    title: string;
    favicon: string | null;
    container: { id: string; name: string; color: string; partition: string; burner?: boolean };
  }): Promise<
    | { ok: true; windowId: number }
    | { ok: false; reason: 'no-source' | 'bad-payload' | 'no-tab' | 'internal' | 'sole-tab' | 'no-target' }
  >;
  /** Move a tab into an EXISTING window (M09 F8 Leg 4, DD8) — the only way a tab
   * crosses windows in F8 (the cross-window DRAG was deferred at leg 2). Same strip
   * snapshot as the two paths above, plus the destination `windowId`, and it likewise
   * carries no coordinate: the menu path never needed one.
   * AUTHORITY (DD8): `windowId` is a DESTINATION REQUEST, never a claim of ownership.
   * Main resolves the SOURCE from the sender, requires the tab to be in that window's
   * own record, and re-resolves `windowId` through the registry — a window closed since
   * the menu was built refuses with `no-target` rather than mis-targeting a survivor. */
  tabMoveToWindow(payload: {
    wcId: number;
    url: string;
    title: string;
    favicon: string | null;
    container: { id: string; name: string; color: string; partition: string; burner?: boolean };
    windowId: number;
  }): Promise<
    | { ok: true; windowId: number }
    | { ok: false; reason: 'no-source' | 'bad-payload' | 'no-tab' | 'internal' | 'sole-tab' | 'no-target' }
  >;
  /** Adopt a dragged tab into THIS window (M09 F11 Leg 3, DD1/DD2) — the cross-window
   * drop. Same identity-payload shape as the three move paths above, but the AUTHORITY
   * is inverted: the SOURCE is resolved from the payload's wcId, gated main-side on the
   * source chrome's live tabDragStarted registration ('not-dragging' else). Sole-tab
   * drags consolidate (the emptied source window closes). Refusals discriminated (DD5). */
  tabAdoptByDrop(payload: {
    wcId: number; url: string; title: string; favicon: string | null;
    container: { id: string; name: string; color: string; partition: string; burner?: boolean };
  }): Promise<{ ok: true; windowId: number } | { ok: false; reason: 'no-source' | 'bad-payload' | 'no-tab' | 'same-window' | 'not-dragging' | 'internal' | 'sole-tab' | 'no-target' }>;
  /** DD2 provenance bookends (M09 F11 Leg 3): fire-and-forget dragstart/dragend
   * declarations of the dragged wcId; main verifies sender ownership and clears the
   * registration on a grace timer (or consumes it on a successful adopt). */
  tabDragStarted(wcId: number): void;
  tabDragEnded(wcId: number): void;
  /** DD8 push-cache boot seed (M09 F8 Leg 4): the OTHER open windows, each captioned
   * from its active tab's title. Sender-resolved main-side — the asking window is never
   * in its own list. Live updates arrive via onMoveTargetsChanged below. */
  moveTargets(): Promise<{ windowId: number; label: string }[]>;
  /** DD8 push-cache (M09 F8 Leg 4): pushed by main with `{ targets }` whenever the
   * window set, an active tab, or an active tab's title changes. The renderer caches it
   * — a push always wins over the boot-seed invoke's resolve — so the tab-context opener
   * builds its model synchronously. Only the LABEL is cached; the windowId is
   * re-validated main-side at dispatch. */
  onMoveTargetsChanged(cb: (d: { targets: { windowId: number; label: string }[] }) => void): void;
  /** adopt-tab (M09 F6 Leg 4, DD5 step 3): the TARGET chrome adopts an already-
   * live webContents — strip insertion WITHOUT createTab. Queued main-side
   * behind the window-boot-config barrier (review H1). */
  onAdoptTab(cb: (d: {
    wcId: number;
    url: string;
    title: string;
    favicon: string | null;
    container: { id: string; name: string; color: string; partition: string; burner?: boolean };
  }) => void): void;
  /** tab-moved-away (M09 F6 Leg 4, DD5 step 3): the SOURCE chrome removes the
   * moved tab's strip entry WITHOUT destroy — the closeTab mirror minus stack
   * capture and the tabClose IPC. */
  onTabMovedAway(cb: (d: { wcId: number }) => void): void;
  /** Hide a web tab view without closing (fire-and-forget). */
  tabHide(wcId: number): void;
  /** Navigate, reload, stop, goBack, goForward on a web tab view (fire-and-forget). */
  tabNavigate(payload: { wcId: number; verb: string; args?: any[] }): void;
  /** Atomic activation: set-bounds + show incoming, hide outgoing (fire-and-forget). */
  tabSetActive(wcId: number, bounds: { x: number; y: number; width: number; height: number }): void;
  /** Update bounds of a web tab view (fire-and-forget). */
  tabSetBounds(wcId: number, bounds: { x: number; y: number; width: number; height: number }): void;
  /** findInPage / stopFindInPage on a web tab view (fire-and-forget). */
  tabFind(payload: { wcId: number; text?: string; options?: any; stop?: boolean }): void;
  /** Send rescan-media to a specific web tab view (fire-and-forget). */
  rescanMedia(payload: { wcId: number }): void;

  /** Tear-off pill overlay (M09 F10 Leg L4-rebuild): show at pointer position (fire-and-forget). */
  tearoffOverlayShow(pos: { x: number; y: number }): void;
  /** Tear-off pill overlay: reposition to pointer (fire-and-forget; main applies while visible). */
  tearoffOverlayMove(pos: { x: number; y: number }): void;
  /** Tear-off pill overlay: hide (fire-and-forget). */
  tearoffOverlayHide(): void;

  // FIX 1 belt-and-suspenders: main triggers an immediate bounds re-send on maximize/unmaximize/resize.
  onTriggerSendBounds(cb: () => void): void;

  // --- tab event subscriptions (pushed from main) ---
  onTabDidNavigate(cb: (d: { wcId: number; url: string; canGoBack: boolean; canGoForward: boolean }) => void): void;
  onTabDidNavigateInPage(cb: (d: { wcId: number; url: string; canGoBack: boolean; canGoForward: boolean }) => void): void;
  onTabTitle(cb: (d: { wcId: number; title: string }) => void): void;
  onTabFavicon(cb: (d: { wcId: number; favicons: string[] }) => void): void;
  onTabLoading(cb: (d: { wcId: number; loading: boolean }) => void): void;
  onTabDidFinishLoad(cb: (d: { wcId: number }) => void): void;
  onTabDomReady(cb: (d: { wcId: number }) => void): void;
  onTabMediaList(cb: (d: { wcId: number; mediaList: any[] }) => void): void;
  onTabPrivacyFp(cb: (d: { wcId: number; fpCounts: any }) => void): void;
  onVaultGesture(cb: (d: { wcId: number }) => void): void;
  // First-run setup cross-renderer triggers (M12 F3 Leg 4 first-run-setup, DD5). Main
  // forwards the vault page's requestSetup / requestUnlock as bare triggers; the
  // recovery-show carries the recovery key ONLY (admin key deferred to F4).
  onVaultRequestSetup(cb: () => void): void;
  onVaultRequestUnlock(cb: () => void): void;
  onVaultRecoveryShow(cb: (d: { recoveryKey: string; replacing?: boolean }) => void): void;
  // Access-key mint cross-renderer triggers (M12 F3 Leg 5, DD5). onVaultRequestMint carries
  // the NON-SECRET target vault id; onVaultAccessKeyShow carries the minted secret + keyId.
  onVaultRequestMint(cb: (d: { target: string }) => void): void;
  onVaultAccessKeyShow(cb: (d: { secret: string; keyId: string }) => void): void;
  // Import-bundle cross-renderer trigger (M12 F4 Leg 1 export-import, DD1/DD2). A bare trigger —
  // the destination target + the bundle are held main-side; the chrome opens vault-import-unlock.
  onVaultRequestImport(cb: () => void): void;
  // Key-rotation cross-renderer triggers (M12 F4 Leg 2 key-rotation, DD3/DD2). Bare triggers —
  // the chrome opens the matching sheet (rotate-recovery reuses vault-stepup; change-master and
  // recover open their own sheets). The new one-time recovery key reuses onVaultRecoveryShow.
  onVaultRequestRotateRecovery(cb: () => void): void;
  onVaultRequestChangeMaster(cb: () => void): void;
  onVaultRequestRecover(cb: () => void): void;
  // Admin-key provision/rotate cross-renderer triggers (M12 F4 Leg 3 admin-key-provision, DD4).
  // onVaultRequestRotateAdmin is a bare trigger (reuses vault-stepup, mode 'rotate-admin');
  // onVaultAdminKeyShow carries the new one-time admin private key for the adminkey-show sheet.
  onVaultRequestRotateAdmin(cb: () => void): void;
  onVaultAdminKeyShow(cb: (d: { adminPrivateKey: string }) => void): void;
  // Vault lock-state (M12 F2 Leg 2 chrome-unlock, DD10): subscribe + init-time fetch.
  onVaultLockState(cb: (d: { setUp: boolean; unlocked: boolean }) => void): void;
  getVaultLockState(): Promise<{ setUp: boolean; unlocked: boolean }>;
  // Explicit global LOCK (M12 F5 HAT batch 1, I8): chrome-trust trigger for the fill-icon
  // native menu's "Lock now". Global + idempotent, no secret; onLock broadcasts, no re-broadcast.
  vaultLock(): Promise<{ ok: boolean }>;
  // Human pick-and-fill (M12 F2 Leg 3, DD5/DD6): the origin-filtered, metadata-only
  // picker read and the origin/scope-rechecked human fill dispatch. Neither carries
  // a password — it is resolved and sent to the guest ONLY in main.
  vaultReachableItems(wcId: number): Promise<Array<{ vaultId: string; id: string; title: string | null; origin: string | null; username: string | null; hasTotp: boolean; widened: boolean }>>;
  vaultFillHuman(payload: { wcId: number; vaultId: string; itemId: string }): Promise<{ filled: boolean; reason?: string }>;
  // Capture-save (M12 F2 Leg 4, DD7): the save/update offer subscriber (model is
  // metadata only — never a password) + the dismiss-drop invoke. Both chrome-side.
  onVaultCaptureOffer(cb: (d: { captureId: string; model: { origin: string; username: string | null; mode: 'save' | 'update'; defaultVaultId: string; choices: string[] } }) => void): void;
  vaultCaptureDismiss(captureId: string): Promise<void>;
  onTabNavState(cb: (d: { wcId: number; canGoBack: boolean; canGoForward: boolean }) => void): void;
}

/**
 * Internal bridge surface exposed by src/preload/internal-preload.js to goldfinch:// pages.
 * Only present when the page's origin is in the INTERNAL_ORIGINS allowlist (goldfinch://settings, goldfinch://downloads, goldfinch://jars, goldfinch://vault).
 */
interface GoldfinchInternalBridge {
  version: number;
  settingsGet(key: string): Promise<any>;
  settingsSet(key: string, value: any): Promise<any>;
  onSettingsChanged(cb: (all: any) => void): number;
  offSettingsChanged(h: number): void;
  shieldsGet(): Promise<any>;
  shieldsSet(patch: object): Promise<any>;
  onShieldsChanged(cb: (cfg: any) => void): number;
  offShieldsChanged(h: number): void;
  automationGetStatus(): Promise<{ enabled: boolean; host: string; port: number; bound: boolean; error: string | null }>;
  automationSetPort(port: number): Promise<{ enabled: boolean; host: string; port: number; bound: boolean; error: string | null }>;
  automationFindFreePort(): Promise<{ port: number | null }>;
  clipboardWrite(text: string): Promise<{ ok: boolean }>;
  automationListKeys(): Promise<{ jars: Array<{ id: string; name: string; color: string; hasKey: boolean }>; adminEnabled: boolean; adminKeySet: boolean }>;
  automationJarKeyMint(jarId: string): Promise<{ key: string }>;
  automationJarKeyRevoke(jarId: string): Promise<{ ok: boolean }>;
  automationAdminKeyMint(): Promise<{ key: string | null }>;
  automationAdminKeyRevoke(): Promise<{ ok: boolean }>;
  automationGetActivity(): Promise<AutomationActivity>;
  onAutomationActivity(cb: (snap: AutomationActivity) => void): number;
  offAutomationActivity(h: number): void;
  // --- downloads surface (Flight 5, Leg 2) ---
  downloadsList(): Promise<Array<any>>;
  downloadsAction(id: number, action: string): Promise<{ ok: boolean; error?: string }>;
  downloadsClear(): Promise<{ ok: boolean }>;
  onDownloadsChanged(cb: (payload: any) => void): number[];
  offDownloadsChanged(handles: number[]): void;
  // --- cookie-jar registry surface (Flight 3, Leg 1) ---
  jarsList(): Promise<Array<{ id: string; name: string; color: string; partition: string; retentionDays: number }>>;
  jarsAdd(payload: { name: string; color?: string }): Promise<object | null>;
  jarsRename(payload: { id: string; name?: string; color?: string }): Promise<object | null>;
  jarsRemove(payload: { id: string }): Promise<{ ok: boolean; removed?: object; wiped?: boolean }>;
  jarsSetDefault(payload: { id: string | null }): Promise<boolean>;
  jarsGetDefault(): Promise<{ id: string; name: string; color: string }>;
  onJarsChanged(cb: (payload: { containers: Array<object>; defaultId: string | null }) => void): number;
  offJarsChanged(h: number): void;
  // --- per-jar data controls (Flight 4, Leg 1/3) ---
  jarsClearData(payload: { id: string; classes: string[] }): Promise<{ ok: boolean; cleared?: string[]; error?: string }>;
  jarsWipe(payload: { id: string }): Promise<{ ok: boolean; error?: string }>;
  // --- per-jar retention edit (M08 Flight 3, Leg 1 / DD4) ---
  jarsSetRetention(payload: { id: string; days: number }): Promise<{ ok: boolean; container?: object; error?: string }>;
  // --- Cookies + Other-site-data panel surface (M10 Flight 2, Leg 2 / flight DD2, DD3 VERDICT) ---
  jarsCookiesList(payload: { id: string }): Promise<{
    ok: boolean;
    cookies?: Array<{
      name: string;
      domain: string;
      path: string;
      expirationDate: number | null;
      secure: boolean;
      hostOnly: boolean;
      session: boolean;
    }>;
    error?: string;
  }>;
  jarsCookiesRemove(payload: {
    id: string;
    name: string;
    domain: string;
    path?: string;
    secure?: boolean;
  }): Promise<{ ok: boolean; error?: string }>;
  // F3 HAT walkthrough fix-rider (operator-requested): reveal a single cookie's
  // value on demand, matched client-side to the exact {name, domain, path} identity.
  jarsCookiesValue(payload: {
    id: string;
    name: string;
    domain: string;
    path: string;
  }): Promise<{ ok: boolean; value?: string; error?: string }>;
  jarsSiteDataList(
    payload: { id: string }
  ): Promise<{ ok: boolean; origins?: Array<{ origin: string; tier: 'stored' | 'visited' }>; error?: string }>;
  jarsSiteDataRemoveOrigin(payload: { id: string; origin: string }): Promise<{ ok: boolean; error?: string }>;
  onJarDataChanged(cb: (payload: { jarId: string; classes: string[] }) => void): number;
  offJarDataChanged(h: number): void;
  // --- per-jar history surface (M08 Flight 1, Leg 3; historyCount added M08
  //     Flight 2, Leg 1; historyList -> historyPage + openTabInJar added M08
  //     Flight 6, Leg 4 / H1-H2 design review) ---
  historyPage(payload: any): Promise<any>;
  historySearch(payload: any): Promise<any>;
  historyDelete(payload: any): Promise<any>;
  historyClear(payload: any): Promise<any>;
  historyCount(payload: any): Promise<any>;
  onHistoryChanged(cb: (p: any) => void): number;
  offHistoryChanged(h: number): void;
  openTabInJar(payload: { jarId: string; url: string }): Promise<{ ok: boolean; error?: string }>;
  // --- vault management surface (M12 Flight 3, Leg 1; item CRUD added Leg 2) ---
  /** Vault state: setup/lock flags + the vault list ('global' + each persistent jar).
   * Each row carries a metadata-only item `count` when UNLOCKED (omitted when locked);
   * never a secret. */
  vaultState(): Promise<{ setUp: boolean; unlocked: boolean; vaults: Array<{ vaultId: string; label: string; count?: number }> }>;
  /** Metadata-only item list for one vault (no secret, ever) — { items } or { locked }. */
  vaultList(vaultId: string): Promise<{ items?: Array<VaultItemMeta>; locked?: boolean }>;
  /** Explicit single-item reveal (full item incl. secrets) — { item } or { locked }. */
  vaultReveal(payload: { vaultId: string; itemId: string }): Promise<{ item?: (Record<string, any> | null); locked?: boolean }>;
  /** Preserving full-item save; unchangedSecrets names the masked-untouched fields.
   * Returns the saved item's METADATA (never a secret) — { item } or { locked }. */
  vaultItemSave(payload: { vaultId: string; item: Record<string, any>; unchangedSecrets: string[] }): Promise<{ item?: VaultItemMeta; locked?: boolean }>;
  /** Delete an item by id — { deleted } (false on missing id) or { locked }. */
  vaultItemDelete(payload: { vaultId: string; itemId: string }): Promise<{ deleted?: boolean; locked?: boolean }>;
  /** Live TOTP code (M12 F3 Leg 3 / DD4): the current code + seconds-remaining
   * computed in main — NEVER the seed. { code, secondsRemaining }, { code: null }
   * (no totp), or { locked }. */
  vaultTotpCode(payload: { vaultId: string; itemId: string }): Promise<{ code?: string | null; secondsRemaining?: number; locked?: boolean }>;
  // First-run setup + unlock triggers (M12 F3 Leg 4 / DD5). No secret crosses either — the
  // password lives only on the chrome-owned sheet + in main; the page reacts to the
  // vault-lock-state broadcast below.
  /** Request the chrome-owned first-run setup sheet (vault-set). */
  requestSetup(): Promise<{ ok: boolean }>;
  /** Request the chrome-owned unlock sheet (vault-unlock) — no fill-picker continuation. */
  requestUnlock(): Promise<{ ok: boolean }>;
  /** Explicit global LOCK (M12 F5 HAT batch 1, I6): zeroize ALL vault keys now (idempotent,
   * no secret). The page reacts to the vault-lock-state broadcast; this does not re-broadcast. */
  lockVault(): Promise<{ ok: boolean }>;
  // Access-key management (M12 F3 Leg 5 / flight DD5, mission durable-grant step-up). List +
  // revoke ride internal channels (no secret — keyIds are plaintext fingerprints); MINT rides
  // the chrome-owned vault-stepup sheet via requestMint (no secret crosses here).
  /** List a vault's access-key grants by keyId ONLY — { keys } or { locked }. */
  vaultAccessKeys(vaultId: string): Promise<{ keys?: Array<{ keyId: string }>; locked?: boolean }>;
  /** Revoke an access key by keyId — { revoked } (false on a stale keyId) or { locked }. */
  vaultAccessKeyRevoke(payload: { vaultId: string; keyId: string }): Promise<{ revoked?: boolean; locked?: boolean }>;
  /** Request the chrome-owned access-key MINT sheet (vault-stepup) scoped to `target`. */
  requestMint(target: string): Promise<{ ok: boolean }>;
  // Portable export / import (M12 F4 Leg 1 / DD1 — Option A; page-modal split M12 F5 HAT, I14).
  // Export is fully main-side (build + write); the page Export modal picks a location via
  // pickSavePath then binds source→path via exportVault(target, savePath), while the jars offer
  // calls exportVault(target) with no path. Import: pickImportFile opens + holds the bundle,
  // beginImportUnlock opens the chrome-owned secret sheet, clearPendingImport drops the held
  // bundle on dismiss. NO secret crosses any of these channels.
  /** Export a vault to a portable bundle file. With `savePath` main writes directly (the page
   * modal); without one main runs the save dialog (the jars offer). { ok, path }, { canceled },
   * or { locked }. */
  exportVault(target: string, savePath?: string): Promise<{ ok?: boolean; path?: string; canceled?: boolean; locked?: boolean; error?: string; reason?: string }>;
  /** Pick a save location for an export bundle — save dialog in main ONLY (no write). { path } or
   * { canceled }. */
  pickSavePath(target: string): Promise<{ path?: string; canceled?: boolean }>;
  /** Does this jar have a saved `.gfvault` file? (M12 F4 Leg 6.) Lets the jars page's Delete
   * confirm surface the export-first offer only for a vault-bearing jar. */
  hasVault(vaultId: string): Promise<{ present: boolean }>;
  /** Pick a bundle file for a destination target: open + read + HOLD the bundle main-side (no sheet
   * opened). { ok, path }, { canceled }, or { error }. The page re-picks if the destination changes
   * (H1). */
  pickImportFile(destinationTarget: string): Promise<{ ok?: boolean; path?: string; importHandle?: string; canceled?: boolean; error?: string }>;
  /** Open the chrome-owned vault-import-unlock secret sheet for the held bundle (Import modal
   * Continue). Bare trigger — no secret; the payload is `{ overwrite, handle }` (the Replace-existing
   * checkbox + the pickImportFile importHandle, PR#112 finding 5), bound onto the held record main-side. { ok }. */
  beginImportUnlock(overwrite?: boolean, handle?: string): Promise<{ ok: boolean }>;
  /** Drop the held import bundle (L1) on Import modal dismiss after a pick. Pass the pickImportFile
   * importHandle so only this window's transaction is dropped (finding 5). Always safe. { ok }. */
  clearPendingImport(handle?: string): Promise<{ ok: boolean }>;
  // Key rotation / recover (M12 F4 Leg 2 / DD3). Bare triggers — main opens the chrome-owned
  // sheet that collects the secret(s); NO secret crosses these channels or the page DOM.
  /** Request the recovery-key ROTATION sheet (reuses vault-stepup for a master-pw step-up). */
  requestRotateRecovery(): Promise<{ ok: boolean }>;
  /** Request the admin-key PROVISION/ROTATE sheet (reuses vault-stepup, mode 'rotate-admin'; the
   * new admin private key is shown once on vault-adminkey-show). M12 F4 Leg 3. */
  requestRotateAdmin(): Promise<{ ok: boolean }>;
  /** Request the master-password CHANGE sheet (vault-change-master: old + new + confirm). */
  requestChangeMaster(): Promise<{ ok: boolean }>;
  /** Request the RECOVER-after-forgotten-master sheet (vault-recover: recovery key + new). */
  requestRecover(): Promise<{ ok: boolean }>;
  /** Subscribe to vault lock-state transitions; the page re-queries on every push.
   * Returns a numeric handle for offVaultLockState. */
  onVaultLockState(cb: (d: { setUp: boolean; unlocked: boolean }) => void): number;
  /** Unsubscribe the vault-lock-state listener registered under handle h. */
  offVaultLockState(h: number): void;
}

/** Metadata-only item projection (no secret field): the vault-item-schema positive
 * whitelist plus vaultId/id/type/hasTotp. Extra non-secret fields vary by type. */
interface VaultItemMeta {
  vaultId: string;
  id: string;
  type: 'login' | 'card' | 'note';
  hasTotp: boolean;
  title?: string | null;
  username?: string | null;
  origin?: string | null;
  [k: string]: any;
}

interface Window {
  goldfinch: GoldfinchBridge;
  /** Present only in goldfinch:// internal pages (contextBridge from internal-preload.js). */
  goldfinchInternal?: GoldfinchInternalBridge;
}

/**
 * One registered dropdown/popup menu for the shared menuController. Injected as a
 * global type by src/renderer/menu-controller.js (the type lives HERE only — the
 * module references it ambiently, mirroring the AutomationActivity precedent above).
 * `items?` getter present → APG roving-tabindex contract is active; absent → the
 * roving/arrow contract no-ops (popup consumers like the site-info popup). `onOpen`/
 * `onClose` are the RAW show/hide bodies (never the public closeX wrapper — recursion).
 * `focusReturn?` overrides the default trigger.focus() on Escape/Tab (page context menu,
 * which has no persistent trigger button).
 */
interface MenuEntry {
  trigger: HTMLElement;
  menu: HTMLElement;
  items?: () => HTMLElement[];
  onOpen?: (startIndex?: number) => void;
  onClose?: () => void;
  focusReturn?: () => void;
  /** M12 F3 Leg 4 (DD5): false opts the entry OUT of the global outside-click / window-
   * blur dismissal (vault-recovery-show — the one-time recovery key is unrecoverable).
   * Undefined/true keeps the default dismiss behavior. */
  dismissible?: boolean;
}

/**
 * Injected by src/renderer/menu-controller.js via the globalThis branch (the shared
 * menu state machine: open/close + mutual-exclusion + outside-dismiss). Same route
 * as keydownToAction above; loaded via <script> before renderer.js.
 */
declare const menuController: {
  register(entry: MenuEntry): MenuEntry;
  open(entry: MenuEntry, startIndex?: number): void;
  close(entry: MenuEntry): void;
  closeAll(): void;
  readonly current: MenuEntry | null;
};

/** Roving-tabindex helper (wrap math + tabIndex/focus). Injected by menu-controller.js. */
declare function focusItem(items: HTMLElement[], i: number): void;
