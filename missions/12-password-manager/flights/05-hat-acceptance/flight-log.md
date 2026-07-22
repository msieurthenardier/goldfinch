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

**Verified live (positives):**
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
