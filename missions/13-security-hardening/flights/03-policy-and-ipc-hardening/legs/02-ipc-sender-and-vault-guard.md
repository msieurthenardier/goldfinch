# Leg: ipc-sender-and-vault-guard

**Status**: landed
**Flight**: [Policy and IPC Hardening Batch](../flight.md)

## Objective

Add sender-identity validation to the chrome-trust IPC channels that currently ignore the sender, apply a trusted-vs-web-branched URL-safety gate to `tab-navigate`'s `loadURL` arg, and add the `isTrusted` guard to the vault-capture `submit` listener — all mechanical, unit-verifiable defense-in-depth (nothing web-reachable exploits these today).

## Context

- Flight DD2 (IPC sender), DD4 (vault isTrusted). Read them in full.
- `registry.getWindowForChrome(sender)` (`window-registry.js:146-158`) = identity-compare against `rec.chromeView.webContents`, returns the record or null. `getWindowForGuest(wcId)` (`:160-172`) = record owning that tab wcId.
- **HIGH regression to avoid** (design review): `tab-navigate`'s URL gate must NOT be unconditional `isSafeTabUrl` — `openSiteSettingsTab` (`overlay-menus.js:120`) navigates an *existing internal tab* to `goldfinch://settings/#privacy`. Branch on the target tab's trust: `isInternalPageUrl` for internal, `isSafeTabUrl` for web (mirror `guest-wiring.js:73-79`). The `tabViews.get(wcId)` entry carries `trusted`; or use `isInternalContents(wc)`.
- The two IPC classes: **wcId-scoped** channels (act on a payload-named tab) get the **owning-chrome** check `getWindowForChrome(event.sender) === getWindowForGuest(wcId)`; **self/session-scoped** chrome-trust channels get plain `requireChrome(event.sender)`.
- Vault: `webview-preload.js` submit listener (`:329`) — add `if (!(isTrustedGet ? isTrustedGet.call(e) : e.isTrusted)) return;` at the top; `isTrustedGet` is module-scope (`:235-242`). Rewrite the accepted-tradeoff comment (`:324-327`). Source edit propagates via the bundle.

## Inputs

- Branch `flight/03` (stacked); `npm test` green.
- `register-browser-ipc.test.js:124-125` pins `new-container-create` succeeding with a bare `{}` sender — **must invert**.
- `register-tab-ipc.test.js` fixtures already pass a real `chromeView.webContents` sender for tab-close/hide/set-active/set-bounds/navigate/find — adding checks needs new refusal assertions, not fixture rewrites. **No `loadURL`-verb test exists** — add one.

## Outputs

- `src/main/register-tab-ipc.js` — owning-chrome checks on `tab-close`, `tab-hide`, `tab-set-active`, `tab-set-bounds`, `tab-navigate`, `tab-find`, `tab-history-snapshot`; branched URL gate on `tab-navigate` loadURL. A small `requireChrome`/owning helper.
- `src/main/register-browser-ipc.js` — `requireChrome` on `new-container-create`, `rescan-media`, `zoom-apply`/`get-zoom`, `print`, `toggle-devtools`/`is-devtools-open`, `page-context-action`/`page-context-correct`, `identity-new`, `privacy-cookies`/`privacy-clear-cookies`/`privacy-clear-storage`.
- `src/preload/webview-preload.js` — `isTrusted` guard + comment rewrite.
- Tests: `register-tab-ipc.test.js`, `register-browser-ipc.test.js` (invert new-container-create; add refusal + loadURL cases).
- flight-log.md — leg entry.

## Acceptance Criteria

- [x] **AC1 (owning-chrome, wcId-scoped)**: `tab-close`, `tab-hide`, `tab-set-active`, `tab-set-bounds`, `tab-navigate`, `tab-find` refuse (no-op / early-return) unless `getWindowForChrome(event.sender)` resolves AND equals `getWindowForGuest(wcId)`. `tab-history-snapshot` requires a chrome sender (it reads by webContentsId; keep its existing internal-exclusion target guard too).
- [x] **AC2 (requireChrome, other chrome-trust)**: `new-container-create`, `rescan-media`, `zoom-apply`, `get-zoom`, `print`, `toggle-devtools`, `is-devtools-open`, `page-context-action`, `page-context-correct`, `identity-new`, `privacy-cookies`, `privacy-clear-cookies`, `privacy-clear-storage` refuse unless `getWindowForChrome(event.sender)` resolves. Existing target/internal-session guards stay as additional gates.
- [x] **AC3 (tab-navigate URL, branched)**: the `loadURL` branch gates the URL — `isInternalPageUrl` when the target tab is trusted/internal, `isSafeTabUrl` when web; an unsafe URL is refused (no-op). `openSiteSettingsTab`'s `goldfinch://settings/#privacy` on an internal tab still works.
- [x] **AC4 (vault isTrusted)**: the submit listener early-returns on a non-trusted (synthetic/page-dispatched) event via the captured `isTrustedGet`; the comment is rewritten to state synthetic submits are ignored (closing the spurious-offer + update-disposition cases). Bundle regenerates (pretest).
- [x] **AC5 (tests)**: representative refusal tests — a non-chrome sender is refused on at least one wcId-scoped channel and one other channel per file; the `new-container-create` `{}`-sender success pin is **inverted** to a refusal; `tab-navigate` `loadURL` gets a web-tab (unsafe refused) case AND an internal-tab (`goldfinch://` allowed) case. Cross-window: a different-window chrome sender is refused on a wcId-scoped channel.
- [x] **AC6 (regression)**: `npm test`, `npm run lint`, `npm run typecheck` pass. No legitimate caller breaks (the existing passing tests that use real senders stay green).

## Verification Steps

- All ACs: `npm test` + read diffs. This leg is fully unit-verifiable — no FD live pass required (the tab-navigate internal-tab case is the regression guard).

## Implementation Guidance

1. Helper in `register-tab-ipc.js` (and/or shared): `requireChrome(event) => registry.getWindowForChrome(event.sender)`; for wcId-scoped, `ownsTab(event, wcId) => { const rec = registry.getWindowForChrome(event.sender); return rec && rec === registry.getWindowForGuest(wcId) ? rec : null; }`. Early-return on null.
2. Apply per AC1/AC2. For channels that already resolve a target (`externalContents`, internal-session checks), ADD the sender check ahead of the existing guard — don't replace it.
3. `tab-navigate` (`:654`): resolve the target entry (`registry.getWindowForGuest(wcId)?.tabViews.get(wcId)` for the `trusted` flag, or `isInternalContents(wc)` after `getTabContents`); in the `loadURL` branch, `const safe = isInternal ? isInternalPageUrl(args[0]) : isSafeTabUrl(args[0]); if (!safe) return;`. `isInternalPageUrl` is already importable from `url-safety` (check current imports).
4. Vault (`webview-preload.js:329`): add the guard line; rewrite `:324-327` comment. Don't touch the bundle (regenerates).
5. Tests per AC5. Invert the `register-browser-ipc.test.js` new-container-create pin. Add the loadURL cases (internal-tab must pass a fixture whose tabViews entry is trusted).
6. Run the gate.

## Edge Cases

- **Self-scoped channels stay untouched**: `vault-*`, `guest-*`, `shields-farble`, `guest-media-list`, `guest-privacy-fp` resolve from `event.sender.id` — already caller-bound; do NOT add requireChrome (would break the guest sender).
- **`closed-tab-stack-size`** takes no event — document why no check (or thread the event and add one if cheap).
- **`vault-capture-dismiss`/`vault-capture-finalize`** — guarded by an opaque main-minted captureId; leave as-is (documented).
- **tab-navigate non-loadURL verbs** (reload/stop/goBack/goForward): the owning-chrome check applies; no URL gate needed.

## Files Affected

- `src/main/register-tab-ipc.js`, `src/main/register-browser-ipc.js`, `src/preload/webview-preload.js`
- `test/unit/register-tab-ipc.test.js`, `test/unit/register-browser-ipc.test.js`
- flight-log.md

---

## Post-Completion Checklist

- [x] All ACs verified
- [x] Tests passing
- [x] Update flight-log.md
- [x] Set leg status `landed`; commit batched at flight end

---

## Citation Audit

Verified at leg design (2026-07-25, from flight-3 recon): `window-registry.js:146-172`; `register-tab-ipc.js:654-670` (tab-navigate); `overlay-menus.js:120` (internal-tab nav — the regression source); `register-browser-ipc.js:77,295,309,357,372,395,416` (unguarded channels); `register-browser-ipc.test.js:124-125` (pin to invert); `webview-preload.js:235-242,324-345` (isTrustedGet + submit). All OK.
