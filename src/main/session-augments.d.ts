export {};

declare module 'electron' {
  interface Session {
    __goldfinchShields?: boolean;
    __goldfinchDownloads?: boolean;
  }
}
