/**
 * Global type declarations for the save-prompt page (Sortie 06, Leg 1).
 * Mirrors the contextBridge surface exposed by src/preload/save-prompt-preload.js.
 *
 * NOTE: the prompt document has window.savePrompt, NOT window.goldfinch. The project-wide
 * renderer-globals.d.ts makes the chrome bridge *appear* typed here too - it is absent at
 * runtime. This shim exists so `npm run typecheck` covers the page's real bridge.
 */

interface SavePromptInit {
  token: number;
  captureId: string;
  model: any;
  queue: { index: number; total: number } | null;
  remainingMs: number;
  paused: boolean;
  result?: { kind: string; text: string };
}

interface SavePromptBridge {
  platform: string;
  onInit(cb: (d: SavePromptInit) => void): void;
  onTimer(cb: (d: { token: number; remainingMs: number; paused: boolean }) => void): void;
  onResult(cb: (d: { token: number; kind: string; text: string }) => void): void;
  onSaving(cb: (d: { token: number }) => void): void;
  onClear(cb: (d: { token: number }) => void): void;
  onFocusFirst(cb: (d: { token: number }) => void): void;
  pointer(token: number, inside: boolean): void;
  focusInside(token: number, inside: boolean): void;
  height(token: number, height: number): void;
  dismiss(token: number): void;
  save(payload: { token: number; captureId: string; vaultId: string | null | undefined }): Promise<any>;
  consent(payload: { token: number; captureId: string; vaultId: string | null | undefined }): Promise<any>;
}

interface Window {
  savePrompt: SavePromptBridge;
}
