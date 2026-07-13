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

  // --- downloads ---
  downloadMedia(payload: any): Promise<any>;
  chooseDownloadDir(): Promise<string | null>;
  showItemInFolder(savePath: string): void;

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
  /** Close/destroy a web tab view (fire-and-forget). */
  tabClose(wcId: number): void;
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
  onTabNavState(cb: (d: { wcId: number; canGoBack: boolean; canGoForward: boolean }) => void): void;
}

/**
 * Internal bridge surface exposed by src/preload/internal-preload.js to goldfinch:// pages.
 * Only present when the page's origin is in the INTERNAL_ORIGINS allowlist (goldfinch://settings, goldfinch://downloads, goldfinch://jars).
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
