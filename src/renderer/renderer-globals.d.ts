/**
 * Global type declarations for the Goldfinch renderer process.
 * Mirrors the contextBridge surface exposed by src/preload/chrome-preload.js.
 */

interface GoldfinchBridge {
  // --- platform ---
  platform: string;

  // --- window controls ---
  windowMinimize(): void;
  windowToggleMaximize(): void;
  windowClose(): void;
  appQuit(): void;
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

  // --- shields ---
  shieldsGet(): Promise<any>;
  shieldsSet(patch: any): Promise<any>;
  shieldsPause(payload: any): Promise<any>;
  onShieldsChanged(cb: (cfg: any) => void): void;

  // --- cookie jars / identities ---
  jarsList(): Promise<any>;
  jarsAdd(payload: any): Promise<any>;
  identityNew(payload: any): Promise<any>;

  // --- main -> renderer events ---
  onDownloadProgress(cb: (data: any) => void): void;
  onDownloadDone(cb: (data: any) => void): void;
  onOpenTab(cb: (url: string) => void): void;

  // Absolute file:// path to the webview preload script.
  webviewPreloadPath: string;

  // Absolute file:// path to the trusted internal-page preload script.
  internalPreloadPath: string;

  // The internal `goldfinch://` partition string (single source of truth).
  internalPartition: string;
}

interface Window {
  goldfinch: GoldfinchBridge;
}

/**
 * Injected by src/shared/url-safety.js via the globalThis branch
 * (renderer runs without nodeIntegration, so it uses the global export).
 */
declare function isSafeTabUrl(url: any): boolean;
declare function isSafePosterUrl(url: any): boolean;
declare function isInternalPageUrl(url: any): boolean;
