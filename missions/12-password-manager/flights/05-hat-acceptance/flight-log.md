# Flight Log: HAT + Alignment — End-to-End Acceptance

**Flight**: [HAT + Alignment — End-to-End Acceptance](flight.md)

## Summary

Flight 5 of Mission 12 — the mission's **closing acceptance gate**: a guided human-acceptance-test
session exercising the built-in password manager end-to-end in a live goldfinch instance, closing the
live-only verification deferred across F1–F4 (sheet-state a11y, vault-page keyboard/focus/aria, the
multi-component flows) and fixing issues inline. **Interactive — the human drives the chrome sheets; the
Executor drives the guest.** Not autonomously executed.

Status: **planning** — flight spec + the new behavior-test spec drafted; operator asked to "design the F5
HAT plan now" (2026-07-21), to run together interactively in a later session. Design review pending.

**Branch**: `flight/05-hat-acceptance`, stacked on `flight/04-...` (the F1–F5 stack; rebases onto main as
it merges). This flight's planning artifacts are docs-only; inline fixes land here when the HAT runs.

## Deferred-to-HAT inventory (carried from F1–F4 debriefs)

- **F1** — the canonical `vault-mcp-surface` Witnessed run (if outstanding).
- **F2** — `npm run a11y` (sheet templates); `vault-human-fill-boundary` behavior test; true human
  end-to-end (typing the real sheet); 3 live-only items (contextBridge Buffer clone; fill-icon positioning
  across layouts; transient-JS-string password lifetime).
- **F3** — the four F3 sheet a11y states + `goldfinch://vault` keyboard/focus/aria (DD9 page-not-axe
  standing gap → HAT is load-bearing for the page portion).
- **F4** — export/import round-trip across profiles (+ cross-machine master-password comprehension, the
  highest live-only design risk; + the `_pendingVaultImport` dismiss edge); rotation one-time-display
  sheets; the registrable-domain widen in a real fill (+ the no-cross-tenant negative); the 4 new sheet
  kinds' a11y + the 3-element offer-export modal focus cycle; the stale vault-page-row after a jar delete.

## Apparatus (the load-bearing design fact — DD1, corrected at design review)

The design review corrected an initial over-claim. **The menu-overlay SHEET is admin-READABLE** (built on
the default session, not internal → `isInternalContents(sheet)` is false; at the admin tier
`enumerateWindows` exposes `sheetWcId` → admin `readDom`/`evaluate` reach the live sheet DOM/aria; the
`npm run a11y` harness already does this). Only `getChromeTarget` is toolbar-only. The F2/F3 security
boundary still holds — a *jar* key / hostile page can't reach the sheet; admin reachability is a
verification affordance. So the HAT splits: **the human DRIVES the sheets** (real gesture / isTrusted /
genuine UX) **and the FD READS them via the admin key** for EXACT assertions (aria/focus/copy text) rather
than only screenshots; **guest-observable flows are Witnessed behavior tests**. The internal PAGE
(`goldfinch://vault`) is the genuinely-unreachable surface (DD2, even for admin) — page a11y is manual +
unit + `captureWindow` pixels. Every acceptance surface is traced to a real act+observe path in the spec.

## Behavior-test specs

- `vault-mcp-surface` (F1) — bundle/run.
- `vault-human-fill-boundary` (F2) — bundle/run.
- **`vault-registrable-domain-fill` (NEW, authored this flight)** — the automation `vaultFill` widen:
  fills a matched subdomain, refuses a multi-tenant sibling / an exact-mode cred / a scheme mismatch /
  an unlisted host (fail-closed). **Apparatus premise flagged**: the fixtures need `/etc/hosts` aliases to
  127.0.0.1 for PSL-known names (`example.com`+`accounts.example.com`; `github.io` tenants) — a reserved
  TLD (`.test`) isn't in the PSL and would fail closed, making the positive step impossible. Probe the
  aliases before the run.

## Session Notes

- **2026-07-21** — F5 planning: flight spec (DD1 apparatus split, DD2 page-a11y manual+unit, DD3
  fix-vs-feature gate, DD4 prerequisites) + the 4 guided segments (A core/fill/lock, B management/rotation,
  C portability/lifecycle, D behavior suite) + the new behavior-test spec drafted. Operator chose "design
  the F5 HAT plan now" — to run interactively later.

**Architect design review — 1 cycle (approve with changes, incorporated).** The apparatus premise-audit
found a genuine [HIGH]: DD1 **over-claimed** the sheet as MCP-unreachable — it is admin-READABLE
(default-session view, `enumerateWindows`→`sheetWcId`→`readDom`/`evaluate`; the a11y harness already uses
this). Corrected: the human still DRIVES the sheet for UX fidelity, but the FD now READS the live sheet
DOM/aria via the admin key for exact assertions (stronger than screenshots) — applied to the sheet-a11y,
the import-comprehension-copy, and the one-time-display steps. DD2 (the internal PAGE genuinely
unreachable even by admin) was confirmed correct — the code proves the page/sheet distinction. Second
[HIGH]: the vault-fixture builder can't yet provision multi-origin + `matchMode` items → named as a
pre-flight task in DD4 + the behavior spec. The matcher/PSL premises were **verified correct** (`.test`
absent from the .dat → fixtures need real PSL names; `github.io`/`co.uk` present; matcher keys off
`URL.hostname` so `/etc/hosts` aliasing works; every RD-fill step matches the real matcher). M/L: the F2
transient-JS-string item has no HAT read path (reframed as noted-not-asserted); the Buffer-clone item
reframed as a fill-success proxy; the page-a11y + stale-row read paths named as human-visual/pixels.

## HAT Run — 2026-07-21

**Adaptation (operator directive):** instead of the DD3 inline-fix protocol, **accumulate issues into a
running list and batch them into a fix leg** at the end. Look-and-feel FIXES and product DEFECTS both go
in the list; apparatus/setup GAPS are tracked separately (they block steps, they aren't leg work).

**Apparatus probe (session start):**
- goldfinch-development MCP instance is **LIVE**.
- My transport key is **JAR-scoped (`work` jar)** — NOT admin. `enumerateWindows` refused (admin-only),
  so the DD1 admin-sheet-read affordance is **unavailable with this key**; getChromeTarget + global-vault
  + sheet-DOM reads all need admin.
- Tabs: one (`wcId 2`, google.com, work jar).
- `vaultList` → **empty** (the work-jar vault is locked or the manager isn't set up; no fixture data).
- Not present: an admin key, a jar **vault access key** (to `vaultUnlock`), the registrable-domain
  fixtures, the `/etc/hosts` PSL aliases, a second fresh profile, the extended fixture builder.

**Issues found (for the fix leg):**
- **I1 (cosmetic, kebab menu) — menu is cluttered; add dividers.** Add a separator after "New window"
  and a separator after "Passwords" in the kebab/main menu (the vault added the "Passwords" entry →
  in-scope grouping polish). Surface: the menu-overlay kebab template. *(operator, Step 0)*

- **I2 (cosmetic, sheet buttons) — vault sheet buttons don't match the app's dark-button style.** Setup
  sheet: buttons lack the gold hover outline other dark buttons have, and are undersized. The **Copy**
  button should be a **gold (primary) button** to emphasize its importance. *(operator, A1)*
- **I3 (cosmetic, one-time-display sheets) — recovery-key display is poorly styled**: gray background with
  black text (does NOT match the dark theme), buttons unstyled; the **Copy button should carry a copy
  icon**. *(operator, A1)*
- **I4 (cosmetic) — admin-key display has the SAME styling issues as I3** (same one-time-display sheet
  family — recovery-show / adminkey-show; consolidate the fix). *(operator, A1)*
  → **I2–I4 together = a "vault sheet family styling pass"**: match the dark-theme button conventions
    (gold hover outline, sizing), gold primary Copy button + copy icon, and fix the one-time-display
    sheets' gray/black theming. One cosmetic CSS-family fix; multi-surface (several `vault-*-template`
    sheets + `menu-overlay.css`) → a lightweight design-review pass per DD3's multi-surface trigger.
- **I5 (LARGER — layout/IA, likely FEATURE per DD3) — `goldfinch://vault` needs a left sidebar.** The page
  carries a lot of info; other internal pages (jars/settings) use a left-sidebar nav for easier
  navigation. This is a structural layout change, not a cosmetic fix → **promote to a scoped design review
  before implementing** (DD3 fix-vs-feature gate). *(operator, A1)*

- **I6 (FUNCTIONAL GAP — mission criterion) — no explicit "Lock now" affordance.** The mission requires
  "Locking is comprehensive: idle timeout, an explicit 'Lock now', app quit." Backend `lockNow()` exists
  (`vault-store.js:341`, called by the idle timer + the `before-quit` hook) but is **not wired to any UI
  trigger** — no `internal-vault-lock` IPC channel, no page/menu button (grep: only `requestUnlock` /
  `onVaultLockState` are exposed to the page). **Fix leg (functional, multi-surface — design-review-lite):**
  add an `internal-vault-lock` trigger (+ chrome bridge) → `store.lockNow()`, and a "Lock now" button on
  `goldfinch://vault` (and/or the vault menu). *(operator, A2)*
- **I7 (cosmetic/IA) — jar-config divider is at the wrong grouping level.** On the per-jar config listing
  the divider sits BETWEEN a jar's secrets and that same jar's access keys (making them look separated),
  when it should sit BETWEEN one jar's whole config and the next jar's. Re-level the divider. *(Surface to
  pin at leg-design: the per-jar secrets + access-keys listing — settings-automation / jar config.)*
  *(operator, A2)*

- **I8 (functional/UX — consolidates with I6) — surface "Lock now" via a context menu on the fill icon,
  top row.** The injected human-fill icon should carry a context menu; because vault locking is **global,
  not jar-scoped**, "Lock now" belongs on the **top row** of that menu (a prominent, always-available
  global-lock affordance even from a jar tab). Combines with I6 into the Lock-now work: `lockNow()` is
  global (clears all `vaultKeys`), so wire it once and surface it in both the vault page (I6) and the
  fill-icon context menu (I8). *(operator, A3)*

---

### ISSUE BATCH 1 → fix leg `hat-fixes-01` (operator directive: batch + implement, then resume)

Paused the HAT after A3-setup to remediate the accumulated issues as one leg, then resume at the fill
test. Batch: **I1** kebab dividers · **I2–I4** vault sheet-family styling pass · **I5** vault-page left
sidebar (LARGER/feature) · **I6+I8** Lock-now (wire `lockNow()` → vault-page button + fill-icon context
menu, top row, global) · **I7** jar-config divider re-level. Mixed cosmetic + functional + one layout
feature → risk-tier HIGH, design-review before implementing (DD3 multi-surface + the human-fill icon is a
security-sensitive surface).

**Design review (1 cycle, approve with changes — incorporated):** [HIGH] I8 — the fill icon is a
guest-DOM-injected `<div>` (`webview-preload.js:269`), so its context menu MUST be a **native
main-process `Menu` via `menu.popup()`** (icon `contextmenu` listener → bare IPC → chrome builds the
menu), never a guest-DOM dropdown (spoofable). [MED] I6 — `lockNow()` already broadcasts (no
re-broadcast); the trigger goes in `register-vault-ipc.js` calling `lockNow()` directly (not the
sheet-forwarding unlock mirror), and needs **two channels** (internal `internal-vault-lock` for the page +
chrome-trust `vault-lock` for the fill-icon menu, which runs in chrome trust). [MED] **I5 (sidebar) split
to its own leg `hat-page-sidebar`** — it's a restructure of the 911-line `vault.js` comparable to the
jars-nav leg, not a cosmetic-batch item. [LOW] cite fixes: I1 = `{type:'separator'}` in
`overlay-menus.js` `buildKebabModel`; I7 = CSS `border-top` on `.vault-accesskeys` (`vault.css:445`).
Batch-1 now = I1, I2–I4, I6, I7, I8.

**Batch 1 LANDED (`hat-fixes-01`, committed on flight/05):** all five batch items closed —
- **I1** — two `{type:'separator'}` rows in `buildKebabModel()` (after New window, after Passwords); the
  sheet renders them `role="separator"` and the roving nav skips them (no `role="menuitem"`); stale
  `renderer.js` menuitem-count comment updated.
- **I2–I4** — vault sheet-family styling pass: sheet buttons get consistent larger sizing + the app's gold
  hover outline; the **Copy** button is now a gold **primary** button with a decorative copy glyph (shared
  `src/shared/copy-icon.js`, `createElementNS`-only — no `innerHTML`, label stays `textContent`); the
  recovery-show / adminkey-show (and accesskey-show, same latent gap) one-time-display cards were dark-themed
  (`.new-container-inner` set no text color → UA-default black on the dark card; fixed with `color:var(--fg)`).
  Dismiss-lock / Buffer channel / no-secret-in-page invariants untouched (CSS + safe-DOM icon only).
- **I6+I8** — explicit **global** "Lock now", two surfaces + two channels: internal `internal-vault-lock`
  (`register-vault-ipc.js`) drives the vault-page top-level **Lock now** button; chrome-trust `vault-lock`
  (`main.js`) backs the fill-icon **native** context menu. The fill icon gained a `contextmenu` listener
  (isTrusted-guarded, `preventDefault`+`stopPropagation`) sending a **bare** `guest-vault-icon-menu` (no
  payload) → `register-browser-ipc.js` derives the wcId + owning window → main pops a native
  `Menu.buildFromTemplate`/`popup` (top row "Lock now", plus a "Fill login…" shortcut). **No menu DOM is
  injected into the guest page.** Both channels call `lockNow()` (global, idempotent) and rely on the store's
  existing single `vault-lock-state` broadcast — no re-broadcast, no secret.
- **I7** — jar-config divider re-leveled: dropped the `border-top` from `.vault-accesskeys` (it split a jar's
  secrets from its own access keys) and put a jar-boundary rule on `.vault-section + .vault-section` so the
  divider separates one jar's whole config from the next jar's.
- **I5** — **split out to its own leg `hat-page-sidebar`** (vault-page left sidebar; a `vault.js` restructure,
  not a cosmetic batch item) — NOT implemented here.

Tests: full unit suite green (2646 pass / 0 fail); typecheck + lint clean. New coverage: both lock channels →
`lockNow()` + single-broadcast (register-vault-ipc + vault-store `onLock`-once), the native icon-menu bare-IPC
path (register-browser-ipc — no guest send), and the Copy-glyph templates. `npm run a11y` (live-GUI, verify-only)
must be re-run after the dev instance restart — the restyle only improves contrast, so it should stay green. The
guest-DOM absence of the native menu is asserted in the `vault-human-fill-boundary` behavior spec (new variant).

- **I9 (UX / messaging — NOT a crypto bug) — recovery-key lifecycle is confusing.** Operator hit a
  recover failure after: setup (recovery key #1) → rotate-recovery (key #2, which silently invalidates #1)
  → change-master → recover. Root cause = using an invalidated earlier key, compounded by the mental model
  that master-change stales the recovery key (it does NOT — the MRK design decouples them; verified in
  code + `vault-key-rotation.test.js:151,164`). The **crypto is correct and tested**; the gap is messaging:
  (a) the rotate-recovery one-time display ("Save your recovery key… shown once…") does **not** say it
  **replaces/invalidates the previous recovery key**; (b) nothing conveys that changing the master leaves
  the recovery key valid; (c) holding several keys across setup + rotations is confusing. **Fix (bank):**
  on the rotate-recovery display, add "This replaces your previous recovery key — the old one no longer
  works." Consider a note on master-change that the recovery key is unchanged. Operator design question —
  "should master-change also issue a new recovery key (like init)?" — left as a deliberate design decision
  to revisit (current decoupling is intentional; the MRK payoff). *(operator, B9)*

- **I10 (F2 human-fill icon — BUG, fixed live) — the autofill icon was busted + wrong behavior.** The
  injected icon was a `🔒` **emoji** that rendered as a **tofu box `□`** in the guest (no emoji font),
  placed **only on the password field**, shown **always**. Operator wanted: a proper icon in **both**
  username + password fields, **only on focus**. Fixed (commit `a3e40d8`): extracted an electron-free
  `src/preload/vault-fill-icon.js` (unit-testable), replaced the emoji with an **inline-SVG padlock**
  (`createElementNS`, path+rect+circle, no innerHTML), placed per-field, shown on `focusin`/hidden on
  `focusout` (with `mousedown`-preventDefault + deferred-hide so the icon click isn't lost to blur). All
  F2 security invariants preserved (isTrusted-guarded click → bare `guest-vault-gesture` → chrome flow;
  decorative/no-secret; I8 contextmenu/Lock-now intact). **FD-verified live**: on `focusin` the icon is an
  actual `<svg>` (namespaced, path+rect+circle, empty textContent) at the focused field's right edge,
  follows focus between username↔password (single icon), renders as a padlock (screenshot). 2667 tests.
  *(operator finding + FD-verified, 2026-07-22)*

- **I11 (F2 credential picker — UX redesign, fixed) — the picker was bare.** Operator wanted a
  modern-password-manager look (ref: 1Password/Chrome). Redesigned (commit `6466299`): each row now has an
  inline-SVG credential icon (left; no favicon fetch — privacy), stacked title/username (middle), and the
  **jar chicklet moved top-right + colored by the jar's color** (`row.badgeColor = jar.color` via
  `isSafeColor`; Global = neutral), plus a separated **"Manage passwords"** footer → `openVaultPage()`.
  Security invariants preserved: METADATA-ONLY (no password in the picker DOM — unit-asserted),
  textContent-only, the `role=menuitem`/`data-pick-index` selection → fill flow, the `widened` badge.
  2671 tests. Needs an app restart to view (menu-overlay renderer). *(operator finding, 2026-07-22)*

- **I12 (Secrets nav off-by-one — BUG, fixed live) — clicking a left-nav vault highlighted the entry
  ABOVE it.** Root cause in `vault-nav-controller.js` `observe()`: the scroll-spy `IntersectionObserver`
  used `rootMargin: '0px 0px -50% 0px'` (active band = top half of viewport, top inset 0), but
  `.vault-section` carries `scroll-margin-top: 24px` (vault.css). An anchor jump lands the target's top
  ~24px down, leaving the PREVIOUS section's bottom sliver inside the top band; the topmost-visible loop
  runs in DOM order, so that earlier sliver won the `aria-current` — the nav highlighted the vault above
  the clicked one. Fixed: top inset `-48px` (exceeds the 24px scroll-margin) so the previous section's
  post-jump sliver falls outside the band. Renderer-only (tab reload); 5/5 nav-controller unit tests pass.
  *(operator finding + FD-fixed, 2026-07-22)*

- **I13 (modal/sheet action buttons — styling, ACCEPTED/banked, not fixed) — chrome-sheet buttons are
  mis-styled.** The centered dark modal dialogs (step-up master-password confirm, recovery/admin one-time
  displays, etc.) have action buttons that don't match the settings-page "dark button" treatment — wrong
  size and missing the gold/accent outline on hover (operator ref screenshot: the "Mint access key" /
  "Cancel" step-up dialog). Operator's call: this is part of **mixed-up styling that needs a holistic
  pass**, not a one-off — **accepted for now**, deferred to a dedicated styling-cleanup leg/flight that
  reconciles the sheet button styles against the canonical settings-page dark-button rule globally.
  *(operator finding + deferral, 2026-07-22)*
  → **RESOLVED (I16, 2026-07-22).** See I16 below — the vault-page buttons were aligned to the `//settings`
  button system and the interactive chrome sheets brought to parity with the one-time-display sheets.

- **I16 (button styling holistic pass — FIXED live, resolves I13).** Three parts, operator-verified:
  1. **Vault-page text buttons → `//settings` parity.** `.vault-btn` aligned to `settings.css`'s system —
     gold-filled PRIMARY (`.settings-btn`/`#home-page-save`) + dark, gold-hover-outline SECONDARY
     (`.pager-btn`): 14px sizing, matched padding/radius, `:not(:disabled):hover`, `cursor: not-allowed`
     disabled. Icon buttons (`.vault-icon-btn`) intentionally left as-is. **Lock now** promoted to gold
     (`.vault-btn primary`) at the operator's call.
  2. **Interactive chrome sheets → sibling-sheet parity.** The one-time-display sheets (recovery/adminkey/
     accesskey) already had `text-btn primary vault-sheet-btn` (Copy) + `text-btn vault-sheet-btn`
     (acknowledge) from I2–I4, but the seven INTERACTIVE sheets still used plain `text-btn small` (no gold
     primary, no gold hover outline) — the "still unstyled" report. Brought **unlock / change-master /
     stepup (rotate-recovery/rotate-admin/mint) / set / recover / import / capture** to parity: submit →
     `text-btn primary vault-sheet-btn` (gold), cancel → `text-btn vault-sheet-btn` (dark + gold hover).
     className-only (no secret-flow change); the sheets load in the menu-overlay renderer → app restart to
     view (FD-restarted with the admin gate, token preserved).
  3. **Result:** 2680 tests, typecheck + lint clean. **Operator: "pass."** *(operator finding + FD-fixed,
     2026-07-22)*

**Verified live (positives):**
- **F2 human-fill flow — VERIFIED LIVE (operator-driven, FD-observed).** With the I10/I11 redesigns:
  focus a login field → the SVG padlock appears in that field → click it → the redesigned chrome-owned
  **picker** (icon-left, title/username, jar-colored chicklet top-right, "Manage passwords" footer) → pick
  the credential → the form fills. Operator: "looks great and works as expected." The picker is chrome-
  owned (never page DOM), metadata-only; the fill routes through the chrome flow. *(operator-confirmed,
  2026-07-22)*
- **Registrable-domain widen (F4 DD5) — VERIFIED LIVE, FD-driven.** Used `lvh.me`/`*.lvh.me` (public
  wildcard DNS → 127.0.0.1, so no `/etc/hosts` needed; PSL treats them as sharing registrable domain
  `lvh.me`). Operator created a `http://lvh.me:8099` item with "Match any subdomain" ON. FD-driven matrix:
  (1) **widen** — `vaultFill` the lvh.me item on `accounts.lvh.me:8099` → `filled:true`, fields got
  `bob@example.com` + 20-char pw (widen fired: same registrable domain + same scheme); (2) **exact must
  not widen** — the exact-mode `127.0.0.1:8099` item on `accounts.lvh.me` → refused `origin-mismatch`;
  (3) **IP fail-closed** — the lvh.me item on the raw-IP origin `127.0.0.1:8099` → refused (IP literal →
  `registrableDomainSafe`=null → fall back to exact → mismatch). The multi-tenant negative (github.io
  tenants distinct) is unit-covered (`psl.test.js`) — can't wildcard a public-suffix domain to localhost
  without `/etc/hosts` (sudo unavailable); scheme-mismatch guard also unit-covered. *(FD-driven, 2026-07-22)*
- **A4 TOTP (F1) — VERIFIED LIVE, FD-driven + cross-checked.** Operator enrolled the base32 secret
  `JBSWY3DPEHPK3PXP` on the Work item; `hasTotp` flipped true (the secret never appears in `vaultList`).
  `vaultTotp`→ `410791`; goldfinch's own `totp()` computed against the same secret at the same instant =
  `410791` (prev/next windows `842456`/`174345` differ → genuine RFC-6238 match, not coincidence). The
  TOTP secret never crosses the wire — only the 6-digit code. *(FD-driven, 2026-07-22)*
- **A3 automation fill (F1) — VERIFIED LIVE, FD-driven via admin MCP.** With admin transport (dev-mint
  gate) + the vault admin private key, the FD drove the full canonical surface: `vaultUnlock`(admin key)→
  unlocked global+work; `vaultList`→ metadata only (title/origin/username/hasTotp), **no password over the
  wire**; `vaultFill`(work item, matching origin `http://127.0.0.1:8099`)→ `{filled:true, id, origin}` —
  no password returned; the guest form received `alice@example.com` + a 20-char password, and a global/DOM
  leak-scan found **no** vault/credential state (only the standard `credentialless` Chromium global);
  `vaultFill` on `example.com`→ **refused** `{filled:false, reason:origin-mismatch}`. Fill-only +
  origin-bound + no-wire-leak all hold live. The audit-origin fix (F4) confirmed: the resolved origin is
  returned on the fill result (non-secret). *(FD-driven, 2026-07-22)*
- **B9 rotation — VERIFIED LIVE (+ code/test).** Operator's clean 3-step confirmation all pass: (1) rotate
  recovery → lock → recover-with-new-key works; (2) relock → same recovery key works; (3) change master →
  lock → same recovery key works. The step-up + new-key displays render correctly post modal-fix (dark
  card, light text, gold Copy+icon, dismiss-locked). Matches the crypto: `changeMasterPassword` rewrites
  ONLY `mrk.master` (re-wraps the same MRK); recovery + admin envelopes and ALL `.gfvault` files + access
  keys untouched (MRK never re-keyed); recovery key survives a master change; a rotated recovery key
  invalidates the prior one — all asserted in `vault-key-rotation.test.js`. **B9a/B9b/B9c PASS.**
- **B10/admin rotation — PASS (operator)** — provision/rotate admin key: step-up → new admin private key
  one-time display renders correctly (themed, dismiss-locked). Segment B (rotation surface) complete.
- **A2/lock lifecycle (partial)** — lock-on-quit was exercised by the clean-out SIGTERM (keys zeroized on
  quit); the unlock sheet works (setup + the initial "Vault locked" state). Explicit Lock-now wired in
  hat-fixes-01 (I6) — live-confirmed via the B9c recover flow (Lock now → recover); idle-timeout not waited out.
- **A1/setup + trust-boundary** — first-run setup runs on a **chrome sheet**; the master-password ENTRY
  sheet is backdrop-dismissible (fine — re-enterable, not a one-time secret), while the **recovery-key and
  admin-key one-time displays are DISMISS-LOCKED** (backdrop click does NOT dismiss — you must
  acknowledge), Copy works, and **no secret appears inline in the page**. The F3 DD5 boundary + the
  dismiss-locked one-time-display safety hold live. *(Caveat: the internal vault page can't be `readDom`'d
  with a jar key, so DOM-absence is operator-visual + unit tests, per DD2.)* *(operator, Step 0 + A1)*

**Clean slate (2026-07-21):** the dev instance ran in-WSL (userData `~/.config/goldfinch-dev`) with stale
F1–F4 vault data. Gracefully SIGTERM'd (exercising lock-on-quit), moved `vaults/` aside to
`vaults.stale-20260721-161338.bak` (reversible), relaunched via `npm run dev:automation` (PID 1324788,
Wayland/WSLg). MCP rebound (jar key survived — transport keys live in settings, not the vault). Vault is
now unset → next vault-open is genuine first-run setup (Segment A1).

**Blockers (apparatus/setup — resolve before the blocked steps can run):**
- B1 — no admin key → Segments needing admin (sheet DOM reads, global vault, enumerateWindows,
  captureWindow) can't run MCP-side; the operator must drive + report those sheets, or provide an admin key.
- B2 — vault not set up with fixtures → fill/TOTP/registrable-domain steps blocked until first-run setup +
  test items exist (human sheet action) or the fixture builder seeds them.
- B3 — the F4 pre-flight tasks (fixture-builder multi-origin+matchMode, `/etc/hosts` aliases, fresh
  profile) are unmet → Segment D step 17 + Segment C step 12 blocked.

## Flight Director Notes — design phase

Designed F5 as the closing HAT. The load-bearing design decision is the **apparatus split** (DD1): because
the sheets are MCP-unreachable, sheet-driven verification is manual and guest-observable verification is a
behavior test — I traced each of the ~17 verification steps to a concrete act+observe path so no criterion
asserts a state with no read path (the flight-skill apparatus premise-audit on both axes). The single
highest live-only *design* risk to watch is the **cross-machine master-password comprehension** on import
(an operator on a second machine must use the SOURCE master password or the recovery key — if the sheet
copy misleads them toward the destination password, the UX is broken though the crypto is correct). The
new behavior test's fixture-origin premise (PSL-known `/etc/hosts` aliases) is called out prominently — a
`.test` alias would fail closed and silently invalidate the positive case.

## Developer note — hat-page-sidebar first cut (2026-07-21)

**Leg `hat-page-sidebar` — first cut implemented, PENDING operator live review (leg stays `in-flight`).**
Restructured `goldfinch://vault` into a master-detail **nav+main** matching the cookie-jars page and renamed
it **"Secrets Management"** (kebab item + page title/`<h1>`; internal URL `goldfinch://vault` unchanged). Left
nav = a top **Settings** entry (gear) + one entry **per vault** — **Global** with a new `ICON_GLOBE`, each
**jar** with its color dot (joined from `jarsList`, `isSafeColor` backstop). New pure model `vaultNavEntries`
(in `vault-page-model.js`) + a mirrored `vault-nav-controller.js` (aria-current scroll-spy, native-anchor
keyboard model — the jars rail, mirrored). Settings groups the RELOCATED wiring under subsections: lock/unlock,
auto-lock, import, and master-key management (change master / rotate recovery / admin rotate-provision /
**export moved here** from the per-vault header). **DD5 preserved** — trigger-only page, `textContent`-only, no
master-equivalent secret in the DOM (grep-verified). Subsumes the `hat-fixes-01` I7 divider (expected).

Results: `npm test` **2655 pass / 0 fail** (baseline 2646 + 9 new vault nav/model tests), `npm run typecheck`
clean, `npm run lint` clean. Seam/channel pins untouched (no new evaluate-seam entries or channels).

**Design points left open for the operator's live review:**
- **"Lock now"** placed at the **top of the Settings section** (unlocked). Global affordance; alternative would
  be top-of-nav.
- **Export** relocated into **Settings > master-key management** as a source-vault picker + Export button (the
  leg lists export under master-key management), REMOVING the per-vault Export button. Confirm this vs. keeping
  export per-vault.
- **Recover-after-forgotten-master** shown only in the **locked** Settings banner (it's meaningless while
  unlocked); the leg lumped it under "master-key management" — flagging the state-gating choice.
- **Locked mode**: nav renders Settings + all vault entries; per-vault sections show an "Unlock to view items"
  placeholder (items need the MRK). Settings while locked = Unlock/Recover banner + auto-lock only.
- **not-set-up mode**: nav is empty (no vaults yet); main shows the setup CTA.
- **Global**: globe icon, no color dot, **no access-key subsection** (access keys are a jar concept).
- Minor: the Settings section id is `vault-settings`; a hypothetical jar with id `settings` would collide with
  it. Jar ids don't normally take that value — noted, not handled.

Dev instance must be **restarted** (`npm run dev:automation`) to pick up the new page — the internal page is
served from disk but the running instance has the old bundle cached.

## Developer note — I14 Import / Export unified into page modals (2026-07-22)

**I14 (Secrets page — Import/Export consolidation, IMPLEMENTED, PENDING operator live review).** Replaced the
two separate Settings controls (the standalone "Import a vault bundle" subsection + the Export block under
Master-key management) with a **single "Import / Export" Settings subsection** holding **exactly two buttons**
("Import…", "Export…"). Each opens a **page-level modal** that selects the vault (destination for import /
source for export) **and** the file location, ending in a **Cancel / Submit** combo.

**Security boundary preserved (DD2/DD5):** NO master-equivalent secret ever enters a page modal or the page
DOM. For **import**, the modal only selects destination + bundle file, then hands off to the **unchanged**
chrome-owned `vault-import-unlock` sheet (via the unchanged `vault-request-import` forward) where the source
master password / recovery key is entered and the held bundle is consumed. **Export** stays ciphertext-only
and fully main-side — the bundle never transits to the page. All DOM text via `textContent`; the modal is
built inline in `vault.js` (no served-module extraction — vault.js is well under the threshold).

**Key mechanics / mitigations:**
- **exportVault dual-mode (L3):** the page modal picks a save location up front via a new `pickSavePath`
  (main-side `showSaveDialog` ONLY — no write, no held state), then binds source→path at submit via
  `exportVault(target, savePath)` (write-direct, no dialog). The **jars delete-first offer keeps calling
  `exportVault(target)` with no path** (main runs the dialog) — the no-path branch is retained for that
  consumer. **The STORE's `exportVault` stays single-arg** — the pre-chosen path lives in the main-side save
  delegate, never threaded into the store (the `store.exportVault.length === 1` pin holds).
- **Import split:** the old atomic `internal-vault-request-import` (pick+forward in one call) is split into
  `pickImportFile` (dialog+read+HOLD, returns `{ok,path}`, NO forward), `beginImportUnlock` (the bare
  `vault-request-import` forward, unconditional — needs only `chromeForTab`), and `clearPendingImport` (drops
  the held `_pendingVaultImport`).
- **H1 (held-state binding):** the held import destination is bound at pick time; changing the destination
  `<select>` after a successful pick **invalidates** it (clears the path, drops the held bundle via
  `clearPendingImport`, disables Continue, forces a re-pick) so the held destination can never drift from what
  the modal shows.
- **L1:** modal Cancel / Esc / backdrop after a pick calls `clearPendingImport` so an abandoned import never
  lingers.
- **L2:** export `{ locked }` (idle-lock race) closes the modal, refreshes to the locked view, and surfaces a
  brief page notice; a write error shows on the modal status line — neither is silently swallowed.
- **M5 (modal teardown):** the modal lives on `document.body`, so it survives a `#vault-root` re-render;
  `render()` now closes any open Import/Export modal (module-scoped ref) so an idle auto-lock mid-modal can't
  orphan a stale unlocked-context modal.
- Modal infra is a reusable inline `openModal({ title, body, submitLabel, onSubmit, submitEnabled, onCancel })`
  mirroring `jars-confirm-modal.js`: `role="dialog"`/`aria-modal`/`aria-labelledby`, Tab focus-trap, Escape +
  backdrop dismiss, focus-return to the invoking button. Own `.vault-modal-*` CSS (vault serves only
  vault.css — cannot inherit jars' `.jar-modal-*`).

**Files touched:** `src/renderer/pages/vault.js` (modal infra + Import/Export subsection + both modals; export
removed from master-key section; `buildImportSection` deleted), `src/renderer/pages/vault.css` (`.vault-modal-*`
+ `.vault-page-notice` + disabled-button styles), `src/main/main.js` (`vaultPickSavePath`; `vaultSaveBundleToFile`
dual-mode; `vaultImportBeginFromFile` returns `path`; `clearPendingVaultImport`; wiring), `src/main/register-
vault-ipc.js` (export accepts optional `savePath`; `internal-vault-pick-save-path`), `src/main/register-browser-
ipc.js` (import split into pick / begin-unlock / clear), `src/preload/internal-preload.js` +
`src/renderer/renderer-globals.d.ts` (bridge surface: `exportVault(target,savePath?)`, `pickSavePath`,
`pickImportFile`, `beginImportUnlock`, `clearPendingImport`; `requestImport` removed),
`src/renderer/renderer.js` (chrome import-trigger comment updated — the `vault-request-import` forward itself is
unchanged). Tests: `test/unit/vault-request-triggers.test.js` (rewritten for the import split),
`test/unit/register-vault-ipc.test.js` (export savePath branch + `pickSavePath`),
`test/unit/register-browser-ipc.test.js` (channel-inventory + `internal-vault-begin-import-unlock`).

Results: `npm test` **2676 pass / 0 fail** (all suites green; import-split + export-savePath + pickSavePath
coverage added/rewritten), `npm run typecheck` clean,
`npm run lint` clean. DD5 grep-verified: no master-equivalent secret on the page path (the modal handles only
vault ids, file paths, and status strings). Dev instance must be **restarted** (main + preload changed) to
verify live.

## Developer note — I15 Secrets page: typed subsections + modal item editor (2026-07-22)

**I15 (`hat-vault-item-organization` — HIGH-risk, design-reviewed leg, IMPLEMENTED, PENDING operator live
review).** Reworked each vault's section on the Secrets page from a flat list + type-`<select>` + inline editor
into a **typed master-detail**: a title row (jar color dot / Global globe + name), **per-type subsections**
(Logins / Cards / Notes each with its own list + Add), an **Access keys** jar-only subsection (Add = Mint),
**per-row Edit + Delete** (Delete confirmed via a modal), and the **add/edit form moved into a modal** (the
inline `editorHost` is gone). Renderer-only — no main/preload change, so a **tab reload suffices** (no restart).

**THE LOAD-BEARING SECURITY FIX (DD6, design-review HIGH) — editor-modal teardown via `editorCleanups`.**
`openModal`'s `close()` runs neither `onCancel` nor a secret wipe, and the idle-lock path reaches it via
`render()` → `closeActivePageModal()`. A wipe wired only to `onCancel` would be **skipped on idle-lock**,
stranding a revealed secret in the detached-but-live input. Fix: the editor registers
`() => wipeSecretInputs(secretInputs)` into the `editorCleanups` registry at build time (mirroring
buildTotpWidget's cleanup). Teardown is then routed through the registry on **all five exit paths**, each
zeroing every secret input **and** draining the TOTP poll/listeners:
- **Save success** — sync `wipeSecretInputs` pre-roundtrip, then `runEditorCleanups()` → `handle.close()` →
  `refresh()`.
- **Save `{ locked }`** — `runEditorCleanups()` → `close()` → `refresh()`.
- **Cancel / Esc / backdrop** — `onCancel` runs `runEditorCleanups()` (openModal's `dismiss()` calls it BEFORE
  its `close()`).
- **Idle-lock re-render** — `render()` calls `runEditorCleanups()` BEFORE `closeActivePageModal()`, while the
  modal is still attached.
- **Preemption (opening a second editor)** — `openEditor`'s leading `runEditorCleanups()` runs BEFORE
  `openModal`'s preempting `closeActivePageModal()`, so a prior editor is never detached with un-drained
  cleanups.
`handle.close()` is used ONLY for backdrop-removal + focus-return — it is never relied on for teardown (it
drains nothing).

**Other DD6 invariants preserved (new container, same behavior):** masked-until-reveal via `buildSecretField`
(inputs start empty w/ MASK placeholder; value only on explicit Reveal; a pure reveal clears on blur);
per-field Reveal/Copy; `assembleSave` + the out-of-band `unchangedSecrets` signal (unrevealed secrets survive a
save); `textContent`-only for every label/title/username; the origin renders as a link ONLY when `safeHttpUrl`
accepts the scheme, else inert text; access-key secrets never touch the page (Add = Mint → chrome step-up
sheet; keyId is a non-secret fingerprint).

**Structure / mechanics:**
- **Partition helper (the one cleanly unit-testable new piece):** `partitionItemsByType(items)` added to
  `src/shared/vault-editor-model.js` (the page-served ESM; its `EDITOR_TYPES` is pinned to the main-side
  `vault-item-schema.js` taxonomy by the existing drift guard). **Defensive** (design-review LOW): buckets only
  known types (login/card/note); any unknown/missing `type` lands in a separate `unknown` bucket, surfaced on
  the page as an "Other items" subsection + a `console.warn` — never silently dropped. Unit-tested in
  `test/unit/vault-editor-model.test.js` (4 new tests: known-type order-preserving bucketing, unknown/missing
  surfacing, non-array degradation, every-type-bucket-present).
- **buildVaultSection** rewrite: title row uses the entry's own `color`/`kind` (no re-derive from `jarRows`) —
  jar dot via `isSafeColor(color) ? color : fallback`, Global via an inline globe (ICON_GLOBE idiom). ONE
  `bridge.vaultList` read, partitioned client-side; subsections render empty then populate (DD-A: empty
  subsections still show heading + empty state + Add so Add is always reachable). Type `<select>` and inline
  `editorHost` removed.
- **renderItems** → per-row: info spans (title/sub/scheme-guarded origin link, all textContent) + a row-actions
  group (**Edit** opens the edit modal; **Delete** opens a confirm modal) sitting together with no divider.
- **openEditor** → editor-in-modal: the same rich form (non-secret fields, secret fields, TOTP widget, login
  matchMode + generator) rendered as `openModal`'s `body`; the in-editor **Delete** is gone (delete lives on
  the row). Save = modal submit; Cancel/Esc/backdrop = `onCancel`.
- **Delete/Revoke confirm modals** (DD-C): reuse `openModal` with a new `danger` submit variant (red submit);
  a naming message body (item title / keyId via textContent) + a danger submit. Access-key **Revoke** gains a
  confirm (DD-B); **Mint** relabeled "Add" (aria-label kept "Mint access key").
- **`closeEditor` and the `activeEditorHost` single-open machinery removed** — `openModal`'s `activePageModal`
  already enforces single-open.
- **CSS:** title-row dot/globe + name; per-type subsection heads (h4 + Add); item-row info + right-aligned
  Edit/Delete actions (flush, no divider); confirm-message; `.vault-editor` demoted from an inset card to a
  plain form (the modal card supplies chrome + scroll via its existing `max-height`/`overflow-y`); dead
  inline-editor/type-select/item-open rules removed.

**Files touched:** `src/renderer/pages/vault.js` (buildVaultSection + subsections + renderItems + openEditor
modal + delete/revoke confirms + openModal `danger` variant; closeEditor/activeEditorHost removed),
`src/renderer/pages/vault.css`, `src/shared/vault-editor-model.js` (`partitionItemsByType`),
`test/unit/vault-editor-model.test.js` (partition tests). No changes to `vault-page-model` /
`vault-accesskey-template` and no force-edits to existing editor-model tests (they stayed green unchanged).

Results: `npm test` **2680 pass / 0 fail** (+4 partition tests), `npm run typecheck` clean, `npm run lint`
clean. DD6 traced across all five exit paths (each zeroes every secret input + drains TOTP). Renderer-only — a
**tab reload** suffices; the Flight Director handles any restart.

**Operator live-review polish (FD-applied inline, same leg):**
- **Item-row separators + header hierarchy** — the per-row `border-bottom` was dropped (rows now read as a
  clean list) and the type headers (Logins/Cards/Notes/Access keys), scoped so the Settings subsections are
  untouched, were tuned to be the DOMINANT label in their group (bold 14px `--fg`) with item titles lighter
  (`font-weight: 500`) — after an over-correction to small-gray-uppercase read "inverted."
- **Icon buttons** — Add (＋), Edit (✎), Delete/Revoke (🗑, red on hover) replaced the text buttons on the
  item rows, the per-type Add, the access-key Add(=Mint), and Revoke; each keeps its `aria-label` + `title`.
- **In-field Reveal/Copy** — the secret fields' Reveal/Copy became in-field icon buttons surfaced on
  hover/`:focus-within` (Reveal is an eye ↔ eye-off toggle; Copy still writes straight to the OS clipboard,
  never the DOM), with an input-matching backing so a revealed secret can't peek through the glyphs. The
  mask/reveal/hide/blur/copy logic is byte-identical — presentation only. `partitionItemsByType` refactor
  shared a `buildIconSvg` helper.

**Operator VERIFIED LIVE** (typed subsections, modal editor, per-row Edit/Delete + confirm, icon buttons,
in-field reveal/copy). Leg **landed**. 2680 tests; typecheck + lint clean. Committed on flight/05.
