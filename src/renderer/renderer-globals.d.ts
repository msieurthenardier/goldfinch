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
  toolbarContextMenu(item: string): void;
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

  // Absolute file:// path to the webview preload script.
  webviewPreloadPath: string;

  // Absolute file:// path to the trusted internal-page preload script.
  internalPreloadPath: string;

  // The internal `goldfinch://` partition string (single source of truth).
  internalPartition: string;
}

/**
 * Internal bridge surface exposed by src/preload/internal-preload.js to goldfinch:// pages.
 * Only present when the page's origin is 'goldfinch://settings'.
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
