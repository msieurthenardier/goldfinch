# Leg: hat-fixes-01 — HAT issue batch 1

**Status**: landed
**Flight**: [HAT + Alignment — End-to-End Acceptance](../flight.md)

## Objective

Remediate the batchable issues from the F5 HAT's Segment-A pass, then resume the HAT at the fill test.
Cosmetic polish (I1, I2–I4, I7) plus one functional mission-criterion gap — an explicit global "Lock now"
(I6+I8). **The vault-page left sidebar (I5) is split to its own leg** (`hat-page-sidebar`) — the design
review found it a restructure of the 911-line `vault.js` comparable to the jars-nav leg, not a cosmetic
batch item. HAT-driven remediation on the flight/05 branch (committed, not deferred).

## Context

- Found live during the HAT (operator, Segment A). Full wording in the flight-log's **ISSUE BATCH 1**.
- Locking is **global** — `vault-store.lockNow()` clears ALL `vaultKeys` (`vault-store.js:341`), is
  idempotent, and its `onLock` hook already broadcasts `vault-lock-state` to chrome + internal pages
  (`main.js:582,597`). **Callers of `lockNow()` must NOT re-broadcast.**
- The human-fill icon is a **guest-DOM-injected `<div>`** (`createVaultIcon`, `webview-preload.js:269`,
  appended at `:332`; `onIconClick` sends a bare `guest-vault-gesture` with the isTrusted guard at `:260`
  → main forwards `vault-gesture` to the owning chrome, `register-browser-ipc.js:96`). It is decorative /
  spoofable and holds no secret (F2 DD1). **Any menu on it MUST be a native main-process `Menu` popped via
  `menu.popup()` — never DOM injected into the guest page** (a page-DOM menu would be spoofable/readable by
  a hostile page).
- The one-time-display sheets (recovery-show / adminkey-show) are **dismiss-locked** (close only via
  `acknowledge`, `menu-overlay.js:938`), Buffer-channel, `textContent`-only — restyling is **pure
  CSS + a safe-DOM copy-icon node**, touching none of that.

## Issues → changes

**I1 (cosmetic) — kebab menu dividers.** Add two `{ type: 'separator' }` entries in `buildKebabModel()`
(`src/renderer/chrome/overlay-menus.js:3-13`): **after `new-window`** and **after `vault`** (the
"Passwords" entry). The sheet already renders `type:'separator'` as `role="separator"`
(`menu-overlay.js:185`), proven by the page-context menu. Verify the kebab's roving-tabindex/arrow-nav
skips separators (same idiom as the page-context menu). Update the now-stale "seven static role=menuitem"
comment at `renderer.js:172`.

**I2–I4 (cosmetic) — vault sheet-family styling pass** (`src/renderer/menu-overlay.css` ~:299–470; the
copy-icon node in the shared builders `src/shared/vault-recovery-template.js` / `vault-accesskey-template.js`
/ `vault-adminkey-template.js`):
- Sheet **buttons** get the app's **gold hover outline** + consistent (larger) sizing.
- The **Copy** button is a **gold (primary) button** with a **copy icon** (reuse the app's copy-icon
  idiom; add the node via `createElement`/`setAttribute` — **no `innerHTML`**, `textContent`-only for any
  text).
- The **recovery-show / adminkey-show** sheets currently render **gray bg + black text** → restyle to the
  **dark theme** (match the other sheets). **No change** to the dismiss-lock, Buffer channel, or
  no-secret-in-page invariants (all in JS, untouched by CSS).

**I6 + I8 (FUNCTIONAL — mission-criterion gap) — explicit global "Lock now", two surfaces, two channels.**
Backend `lockNow()` exists but has no UI trigger. Wire it (global; no re-broadcast) and surface it:
- **Vault-page channel (I6):** add `internal-vault-lock` in **`register-vault-ipc.js`** (which has
  `getVaultStore`) — a bare internal handler: `registerInternalHandler(ipcMain, 'internal-vault-lock',
  () => { getVaultStore().lockNow(); return { ok: true }; })`. **Not** in `register-browser-ipc.js`, and
  **not** a sheet-forward (that's the unlock shape, which needs a secret — lock needs none). Add the page
  bridge method + a **"Lock now" button** on `goldfinch://vault` (top-level; locking is global). The page
  reflects locked state off the existing `vault-lock-state` broadcast.
- **Fill-icon channel (I8):** the chrome-trust menu can't call an internal-origin channel, so add a
  **chrome-trust** `ipcMain.handle('vault-lock', () => { getVaultStore().lockNow(); return { ok:true }; })`
  (analogous to the existing `vault-lock-state-get` handle, `main.js:1274`).
- **Fill-icon context menu (I8):** add a `contextmenu` listener **on the injected icon `<div>`**
  (`webview-preload.js`, mirroring `onIconClick` incl. the captured-`isTrusted` guard) that sends a **bare
  IPC** (e.g. `guest-vault-icon-menu`, no payload); main derives the wcId from `event.sender.id`, and the
  owning **chrome builds a native `Menu`** and calls `menu.popup({ window })`. The menu's **top row is
  "Lock now"** (→ the chrome-trust `vault-lock` handle; global). **No menu DOM is injected into the guest
  page.** *(Other menu entries — e.g. a fill/pick shortcut — at the design's discretion; Lock now is the
  required top row.)*

**I7 (cosmetic/IA) — jar-config divider re-level.** The divider is a **CSS `border-top` on
`.vault-accesskeys` (`src/renderer/pages/vault.css:445`)**, drawn *within* each jar's section (separating
a jar's secrets from its own access keys). Drop that border and put a jar-boundary border on
`.vault-section` instead, so the divider separates one jar's whole config from the next jar's. (DOM nesting
— accesskeys inside the vault section — is `vault.js:384`; the change itself is CSS.)

## Acceptance Criteria

- [x] **I1** — a separator after "New window" and after "Passwords" in the kebab menu; roving-nav skips
      them; nothing else reordered; the stale menuitem-count comment updated.
- [x] **I2–I4** — vault sheet buttons have the gold hover outline + consistent sizing; the Copy button is
      a gold primary button with a copy icon; recovery-show / adminkey-show are dark-themed. The
      dismiss-lock, Buffer channel, and `textContent`-only / no-secret-in-page invariants are unchanged.
- [x] **I6+I8** — an explicit **global** "Lock now" locks all vaults and the UI reflects locked state,
      reachable from **both** the vault page (button) and the fill-icon **native** context menu (Lock now
      top row). The fill icon stays decorative; **no menu DOM is injected into the guest page**; neither
      lock channel carries a secret; no double-broadcast.
- [x] **I7** — the divider separates jars, not a jar's secrets from its own access keys.
- [x] Existing tests pass; new tests cover **both** lock channels (`internal-vault-lock` + chrome-trust
      `vault-lock` → `lockNow()` → single `vault-lock-state` broadcast) and assert **no menu DOM node is
      injected** into the guest page (extended in the `vault-human-fill-boundary` behavior spec).
      `npm test`, typecheck, lint clean; **`npm run a11y`** is live-GUI verify-only — re-run after the dev
      instance restart (contrast-improving restyle → should stay green).

## Verification Steps

- Unit: both lock triggers call `lockNow()` (no re-broadcast); the fill-icon menu path injects no guest
  DOM + carries no secret; `npm run a11y` for the restyled sheet states. Mirror
  `test/unit/vault-request-triggers.test.js` + `register-browser-ipc.test.js`.
- Live (resume HAT): operator confirms dividers, sheet restyle, Lock-now from both surfaces, divider
  re-level.
- `npm test` / typecheck / lint / a11y clean. Grep: no guest-DOM menu node; both lock channels bare.

## Implementation Guidance

1. **Cosmetic** (I1, I2–I4, I7): the two kebab separators; the sheet CSS pass + safe-DOM copy icon; the
   `.vault-accesskeys`→`.vault-section` border re-level. Preserve DD5.
2. **Lock-now** (I6+I8): `internal-vault-lock` in `register-vault-ipc.js` (bare, direct `lockNow()`, no
   re-broadcast) + the vault-page button; the chrome-trust `vault-lock` handle; the icon `contextmenu`
   listener (isTrusted-guarded, bare IPC) → native `Menu.popup` with Lock now on top. No guest-DOM menu.

## Edge Cases

- **Lock now while already locked** — idempotent no-op (mirrors `lockNow()`).
- **Icon menu with no matching credential** — Lock now still present (global); a fill/pick entry, if
  added, reflects "no match" as a normal state.
- **Sheet restyle** — dismiss-lock / Buffer / no-secret-in-page unchanged (CSS + safe-DOM icon only).
- **Unauthenticated lock trigger** — safe: `lockNow()` only zeroizes keys; `registerInternalHandler`
  rejects non-internal senders; the chrome handle is chrome-trust.

## Files Affected

- `src/renderer/chrome/overlay-menus.js` — kebab separators (I1); `src/renderer/renderer.js` — stale comment.
- `src/renderer/menu-overlay.css` + `src/shared/vault-{recovery,accesskey,adminkey}-template.js` — sheet styling + copy icon (I2–I4).
- `src/main/register-vault-ipc.js` — `internal-vault-lock` (I6); `src/main/main.js` — chrome-trust `vault-lock` handle (I8); `src/preload/*` (+ types) — page bridge + chrome trigger.
- `src/renderer/pages/vault.{js,css}` — Lock-now button (I6), divider re-level (I7, CSS).
- `src/preload/webview-preload.js` + `src/main/register-browser-ipc.js` — icon `contextmenu` → bare IPC → native menu (I8).
- `test/unit/…` — both lock channels + the no-guest-DOM-menu assertion.

## Split-out follow-up

- **`hat-page-sidebar` (I5, its own leg)** — add a left-sidebar nav to `goldfinch://vault` mirroring the
  internal-page `<nav>` pattern (`jars.html:39` + `jars-nav-controller.js`; `settings.html:20`).
  Restructures `vault.js` (911 lines, imperative section builders) into nav+main + a nav controller +
  keyboard/focus/aria — comparable to the jars-nav leg. Design-reviewed separately.

---

## Post-Completion Checklist

- [x] All acceptance criteria verified
- [x] Tests passing (`npm test` 2646/0, typecheck, lint; a11y is live-GUI verify-only — re-run on HAT resume)
- [x] Update flight-log.md (which issues closed; I5 split to `hat-page-sidebar`)
- [x] Set this leg's status to `landed`
- [x] Commit on the flight/05 branch
