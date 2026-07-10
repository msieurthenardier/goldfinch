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
   * `info-popup` rows {type,text?/label?/value?,id?}, `input-dialog` (empty). */
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
    }>;
    anchor: { alignRight?: number; alignLeft?: number; x?: number; y: number };
    startIndex: number;
    token: number;
  }): void;
  /** Channel 2: programmatic close — reason allowlisted main-side ('toggle' | 'superseded'). */
  menuOverlayClose(payload?: { reason?: 'toggle' | 'superseded' }): void;
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
  jarsList(): Promise<Array<{ id: string; name: string; color: string; partition: string }>>;
  jarsAdd(payload: { name: string; color?: string }): Promise<object | null>;
  jarsRename(payload: { id: string; name?: string; color?: string }): Promise<object | null>;
  jarsRemove(payload: { id: string }): Promise<{ ok: boolean; removed?: object; wiped?: boolean }>;
  jarsSetDefault(payload: { id: string | null }): Promise<boolean>;
  jarsGetDefault(): Promise<{ id: string; name: string; color: string }>;
  onJarsChanged(cb: (payload: { containers: Array<object>; defaultId: string | null }) => void): number;
  offJarsChanged(h: number): void;
}

interface Window {
  goldfinch: GoldfinchBridge;
  /** Present only in goldfinch:// internal pages (contextBridge from internal-preload.js). */
  goldfinchInternal?: GoldfinchInternalBridge;
}

/**
 * Injected by src/shared/url-safety.js via the globalThis branch
 * (renderer runs without nodeIntegration, so it uses the global export).
 */
declare function isSafeTabUrl(url: any): boolean;
declare function isSafePosterUrl(url: any): boolean;
declare function isInternalPageUrl(url: any): boolean;

/**
 * Injected by src/shared/keydown-action.js via the globalThis branch (the pure
 * chrome-shortcut keydown mapper — DD5). Same route as isSafeTabUrl above.
 */
declare function keydownToAction(descriptor: {
  key: string;
  ctrl: boolean;
  meta: boolean;
  shift: boolean;
  lightboxOpen: boolean;
}):
  | 'devtools'
  | 'zoom-in'
  | 'zoom-out'
  | 'zoom-reset'
  | 'find'
  | 'new-tab'
  | 'close-tab'
  | 'focus-address'
  | 'toggle-panel'
  | 'toggle-privacy'
  | 'reload'
  | 'downloads'
  | null;

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

/**
 * Injected by src/shared/safe-color.js via the globalThis branch (the
 * injection-safe color validator extracted from jars.js — M05 F8 Leg 3; the
 * menu-overlay sheet document loads it via <script> to validate dot colors
 * against the SAME domain the product accepts).
 */
declare function isSafeColor(c: any): boolean;

/**
 * Injected by src/shared/site-info.js via the globalThis branch (the pure
 * site-info derivation shared by the chrome popup and the sheet model — M05 F8
 * Leg 3). Same route as isSafeTabUrl above.
 */
declare function deriveSiteInfo(
  tab: { url?: string; privacy?: any } | null | undefined,
  internal: boolean
):
  | { internal: true; note: string }
  | { internal: false; host: string; connection: string; trackers: number; permissions: number };

/**
 * Injected by src/shared/container-menu.js via the globalThis branch (the
 * container-picker sheet model with the NAMESPACED id space — M05 F8 Leg 3).
 */
declare function buildContainerModel(
  containers: Array<{ id?: any; name?: any; color?: any }>
): Array<{ id: string; label: string; color?: string; variant?: string }>;

/**
 * Injected by src/shared/burner.js via the globalThis branch (the frozen Burner
 * identity constant — M06 Flight 1 DD4 / Flight 2 DD8).
 */
declare const BURNER: { id: string; name: string; color: string };

/**
 * Injected by src/shared/default-routing.js via the globalThis branch (the pure
 * new-tab container resolution helper — M06 Flight 2 Leg 1 DD1).
 */
declare function resolveNewTabContainer(
  containers: Array<{ id?: any }>,
  defaultId: string | null | undefined
): any;

/**
 * Injected by src/shared/jar-page-model.js via the globalThis branch (the pure
 * goldfinch://jars row-model — M06 Flight 3 Leg 1 / DD3). Persistent jars in
 * `containers` order, followed by the static Burner row.
 */
declare function buildJarPageModel(
  containers: Array<{ id?: any; name?: any; color?: any }>,
  defaultId: string | null | undefined
): Array<{ id: string; name: string; color: string; isDefault: boolean; isBurner: boolean }>;

/**
 * Injected by src/shared/jar-page-model.js via the globalThis branch (the curated,
 * frozen swatch palette for the create/recolor swatch grid — M06 Flight 3 Leg 2 /
 * DD4). Every entry passes isSafeColor; PALETTE[0] is the preselected color for a
 * new jar.
 */
declare const PALETTE: readonly string[];

/**
 * Injected by src/shared/inherit-container.js via the globalThis branch (the
 * pure link/image/selection-search container-inheritance decision — M06 Flight
 * 2 HAT Leg 4 / D3). At most one of `container`/`freshBurner` is ever set;
 * neither set means "no inheritance — the caller's default-jar resolution
 * applies".
 */
declare function inheritContainerDecision(
  sourceContainer: { id?: any; burner?: boolean } | null | undefined,
  sourceIsInternal: boolean
): { container?: { id?: any; burner?: boolean }; freshBurner?: boolean };

/**
 * Injected by src/shared/inherit-container.js via the globalThis branch (DD7,
 * M06 F3 Leg 4 — popup-inheritance decision: resolves the opener's forwarded
 * session-partition string into the SAME decision shape inheritContainerDecision
 * above produces). At most one of `container`/`freshBurner` is ever set; neither
 * set means "no inheritance — the caller's default-jar resolution applies".
 */
declare function inheritFromPartition(
  openerPartition: string | null | undefined,
  containers: Array<{ id?: any; partition?: string; burner?: boolean }> | null | undefined
): { container?: { id?: any; partition?: string; burner?: boolean }; freshBurner?: boolean };

/**
 * Injected by src/shared/automation-indicator-model.js via the globalThis
 * branch (the pure toolbar automation-indicator decision model — Flight 3, Leg
 * 6 / HAT inline finding F7). Visibility is driven by ENABLED keys (jar or
 * admin); mode/color are driven by which connection, if any, is currently
 * ACTIVE. `color` is only ever a value that already passed isSafeColor.
 */
declare function buildAutomationIndicatorModel(input: {
  enabledJarKeyCount?: number;
  adminKeyEnabled?: boolean;
  activeJarIds?: Array<string | null | undefined>;
  adminActive?: boolean;
  containers?: Array<{ id?: any; color?: any }>;
}): {
  visible: boolean;
  count: number;
  mode: 'idle' | 'jar' | 'multi' | 'admin';
  color: string | null;
};

/**
 * Injected by src/shared/page-context-model.js via the globalThis branch (the
 * pure page-context params→model builder with the namespaced/INDEX-dispatched id
 * space — M05 F8 Leg 4). Toolbar mode short-circuits to the single Unpin item.
 */
declare function pageContextModel(
  params: any,
  toolbarItem?: 'media' | 'shields' | 'devtools' | null
): Array<
  | { type: 'item'; id: string; label: string }
  | { type: 'separator' }
  | { type: 'note'; text: string }
>;

/**
 * Injected by src/shared/audit-paging.js via the globalThis branch (the
 * activity-viewer pagination + freshness state machine — DD4). `activeLog` is
 * exposed as `activeLogOf` to avoid colliding with any generic page global.
 */
declare function windowPage(
  activeLog: any[],
  page: number,
  pageSize: number
): { rows: any[]; total: number; showingFrom: number; showingTo: number; hasPrev: boolean; hasNext: boolean };
declare function countNewer(liveLog: any[], frozenLog: any[] | null): number;
declare function activeLogOf(state: { page: number; frozenLog: any[] | null; liveLog: any[] }): any[];
declare function reduceAudit(
  state: { page: number; frozenLog: any[] | null; liveLog: any[] },
  event: { type: string; log?: any[]; page?: number }
): { page: number; frozenLog: any[] | null; liveLog: any[] };
/** Number of pages for `total` entries at `pageSize`; always >= 1. */
declare function pageCount(total: number, pageSize: number): number;
/** Standard numbered-pagination model: page numbers interleaved with '…' gaps. */
declare function pageList(
  total: number,
  pageSize: number,
  currentPage: number,
  opts?: { edge?: number; around?: number }
): Array<number | '…'>;
