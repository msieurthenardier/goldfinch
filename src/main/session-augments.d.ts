export {};

declare module 'electron' {
  interface Session {
    __goldfinchShields?: boolean;
    __goldfinchDownloads?: boolean;
    /** Marks the dedicated goldfinch:// internal session — set after creation. */
    __goldfinchInternal?: boolean;
  }
}
