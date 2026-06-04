# Goldfinch

A Chromium-based desktop browser (built on Electron) with the standard browsing
essentials **plus an expandable media panel** that catalogs every image, video,
audio file, and embed on the current page so you can preview, play, or download
each one independently.

## Features

- **Standard browser chrome**: multi-tab browsing, back/forward/reload, address
  bar with search-or-URL detection, persistent session (stays logged in),
  favicons, popups opened as new tabs.
- **Media panel** (toggle with the *Media* button or `Ctrl+M`):
  - Scans the live DOM for `<img>`, `srcset`/`<picture>`, CSS background images,
    `og:image`, `<video>`, `<audio>`, and known video/audio embeds (YouTube,
    Vimeo, SoundCloud, Spotify, Twitch, …).
  - Re-scans automatically as pages lazy-load more media.
  - Filter by type (images / video / audio / embeds).
  - **Play / View** any item in an in-app lightbox player.
  - **Download** any item individually — using the page's own session so
    cookies/referer/auth are preserved — with progress toasts and *Show in
    folder*.

## Run

```bash
npm install
npm start
```

> On Linux you need a graphical session. Under WSL, use WSLg (Windows 11) or an
> X server. If sandboxing errors appear, try `npm start -- --no-sandbox`.

## Keyboard shortcuts

| Shortcut | Action            |
|----------|-------------------|
| `Ctrl+T` | New tab           |
| `Ctrl+W` | Close tab         |
| `Ctrl+L` | Focus address bar |
| `Ctrl+M` | Toggle media panel|
| `Ctrl+R` | Reload            |

## Architecture

| File | Role |
|------|------|
| `src/main/main.js` | Electron main process: window, downloads, popup-to-tab. |
| `src/preload/chrome-preload.js` | Safe `window.goldfinch` API bridge for the UI. |
| `src/preload/webview-preload.js` | Injected into every page; scans the DOM for media. |
| `src/renderer/*` | The browser UI: tabs, toolbar, media panel, lightbox. |

Each tab is a `<webview>` running real Chromium. The media scanner preload is
force-injected into every page and streams its catalog to the UI via
`ipcRenderer.sendToHost`.
