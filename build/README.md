# build/ — packaging resources

electron-builder reads app icons from this folder (`directories.buildResources`).

## Drop the logo here

| File | Purpose | Notes |
|------|---------|-------|
| `build/icon.png` | **App icon (all platforms)** | Square, **1024×1024** ideal (≥512×512 required). electron-builder auto-generates the Windows `.ico` and macOS `.icns` from this — a single PNG is enough. |
| `build/icon.ico` | Windows (optional) | Only if you have a real multi-size `.ico`; otherwise it's generated from `icon.png`. |
| `build/icon.icns` | macOS (optional) | Same — generated from `icon.png` if absent. |

The minimum to get a custom icon everywhere is just **`build/icon.png`** at 1024×1024.

> ⚠️ Don't name logo files `goldfinch-*.png` at the repo root — that pattern is
> gitignored (leftover from test screenshots). Inside `build/` you're fine.

In-app UI logo (e.g. a start page / toolbar mark) is separate — put those under
`src/renderer/assets/`.
