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
  settingsGet(key: string): Promise<any>;
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

  // --- HTML page context menu (main → renderer) ---
  /** Main fires with { wcId, params } — renderer opens the HTML context menu and applies its
   *  own freeze-frame via freezeGuest()/captureActiveGuest() (Option A; no main-side capture). */
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
  identityNew(payload: any): Promise<any>;

  // --- main -> renderer events ---
  onDownloadProgress(cb: (data: any) => void): void;
  onDownloadDone(cb: (data: any) => void): void;
  onOpenTab(cb: (url: string) => void): void;
  /** Fired by the main-side Ctrl+F before-input-event capture (SC4/DD2). No payload. */
  onOpenFind(cb: () => void): void;
  /** Fired by the main-side Ctrl+J before-input-event capture (DD2). No payload. */
  onOpenDownloads(cb: () => void): void;

  // Absolute file:// path to the webview preload script.
  webviewPreloadPath: string;

  // Absolute file:// path to the trusted internal-page preload script.
  internalPreloadPath: string;

  // The internal `goldfinch://` partition string (single source of truth).
  internalPartition: string;

  // --- site-info freeze-frame (Flight 3, Leg 2 sub-step 5) ---
  /** Capture the active web guest as a PNG data URL for freeze-frame behind site-info popup. Returns null if no active web guest. */
  captureActiveGuest(): Promise<string | null>;

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
  onTabFoundInPage(cb: (d: { wcId: number; result: any }) => void): void;
  onTabPrivacyFp(cb: (d: { wcId: number; fpCounts: any }) => void): void;
  onTabNavState(cb: (d: { wcId: number; canGoBack: boolean; canGoForward: boolean }) => void): void;
}

/**
 * Internal bridge surface exposed by src/preload/internal-preload.js to goldfinch:// pages.
 * Only present when the page's origin is in the INTERNAL_ORIGINS allowlist (goldfinch://settings, goldfinch://downloads).
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
