# Flight: Human Fill Trust Boundary

**Status**: landed
**Mission**: [Built-in Password Manager](../../mission.md)

## Contributing to Criteria

Mission criteria this flight advances (the human-UI half of criteria whose
headless/automation half landed in F1):

- [ ] **Fill is gesture-gated and origin-bound, top-frame only** — the **human** path
      (F1 proved the automation path). A person clicks an injected lock icon; the fill
      happens only after that gesture, only for an exact-origin-matched top-frame login.
      **[behavior-test]** (guest-observable slice) + integration.
- [ ] **No vault secret is entered into or readable from web content** except the single
      filled credential — **fully, and this is F2's core**: the master password, recovery
      key, and picker all render in **chrome-owned** UI (the menu-overlay sheet), and the
      injected lock icon is decorative — a hostile page gains nothing by faking or hiding
      it. **[behavior-test]**
- [ ] **Compartmentalization is structural** — the **fill-surface picker** shows only the
      active tab's jar vault plus the global vault, each **badged**, never a sibling jar's
      credentials (F1 proved the key-derivation half; this is the human picker half).
- [ ] **Capture offers to save** — submitting a login form raises a chrome-rendered
      save-or-update prompt (update when origin+username already exists), defaulting to the
      active jar's vault with the global vault selectable, only when the manager is set up.
      **[behavior-test]** (guest-observable slice) + integration.

Deferred out of this flight (documented, not dropped):
- The **registrable-domain per-credential opt-in** (mission fill criterion sub-property) →
  **F3** (see DD6). F2 is exact-origin only — the mission's guaranteed-safe default.
- The **audit-origin fix** (mission Known Issue #2) → **F3** (see DD8 rationale). It is an
  MCP-wire-path concern with no cohesive home among F2's human-UI legs.
- **First-run setup UI** (master password chosen + recovery key shown exactly once) → **F3**
  (`goldfinch://vault`). F2 assumes the manager is already set up via the F1 `vault-store`
  API / fixture builder; F2 renders the *unlock* prompt, not the *setup* prompt.

---

## Pre-Flight

### Objective

Build the human trust boundary for the password manager: a decorative, spoofable lock icon
injected into detected login forms; a chrome-owned master-password **unlock** prompt and a
badged **vault picker** rendered on the menu-overlay sheet (never in page DOM); the
gesture-only, exact-origin-matched, top-frame **human fill** flow that reuses F1's proven
`vault-fill` main→preload channel; and a chrome-rendered **capture** (save/update) prompt on
login-form submission wired to the existing `vault-store.saveItem` primitive. The load-bearing
invariant — *the master password is only ever entered into chrome-owned UI, never page DOM* —
is realized here and verified from the guest side, where a leak would be observable.

### Open Questions

- [x] How a guest-page gesture reaches chrome-owned UI without trusting page content →
      **DD3** (mirror the `guest-media-list` → `event.sender.id` → `chromeForTab` idiom;
      the channel is a trigger only, carries no secret, and the wcId is derived in main)
- [x] How the master password travels from the sheet to main without a lossy/capped string
      round-trip → **DD4** (dedicated Buffer-carrying secret channel, NOT channel-4
      `menu-overlay:activated`, which `sanitizeActivatedValue` caps at 24 chars / string-only)
- [x] Whether a behavior test can drive the chrome-owned prompt end-to-end over MCP →
      **DD8** (no — the menu-overlay sheet is deliberately unreachable via MCP; apparatus
      splits across behavior-test / integration / F4-HAT)
- [x] Origin scope for F2 fill + capture → **DD6** (exact-origin only; registrable-domain
      opt-in deferred to F3)
- [x] Where capture save/update is decided → **DD7** (reuse `saveItem`; update-vs-save by an
      origin+username existence check over the reachable-items read)
- [x] Whether a page can programmatically raise the master-password sheet → **DD3** (the
      gesture emit is gated on `event.isTrusted`; scripted clicks are ignored)
- [x] Fill/capture in burner (non-persistent) partitions → **DD9** (structurally suppressed —
      no icon, no prompt, no capture; burner has no vault, per the mission)
- [x] Whether the picker shows all reachable credentials or only origin matches → **DD5/DD6**
      (origin-filtered at the picker — only exact-origin matches from {active jar, global})
- [x] What happens if the vault locks between pick and fill → **DD6** (fill re-checks lock
      state and re-raises the unlock prompt rather than erroring)
- [ ] Lock-icon positioning / z-index strategy without shadow-DOM isolation (contextIsolation
      is off in the guest) — resolved at Leg 1 (absolute overlay anchored to the field rect;
      spoofability accepted per DD1)
- [ ] Picker template shape — `menu` (roving) vs `listbox` (non-focusing) APG pattern —
      resolved at the `pick-and-fill` leg against the menu-controller's existing template set

### Design Decisions

**DD1 — The lock icon is decorative and untrusted; all trust lives in main + chrome**: the
icon is injected into the guest **main world** (contextIsolation is off — see
`register-tab-ipc.js:82-92`), so it is necessarily spoofable and hideable. That is
acceptable and by design: the icon carries **no secret**, and its click emits only a bare
"a user gestured on this tab" signal. Main derives the **trusted** wcId from
`event.sender.id` (never a renderer-supplied id — the `resolve.js` session-identity
discipline), resolves the owning jar, and drives the chrome-owned prompt. A hostile page
that fakes, moves, or hides the icon gains nothing — there is no credential on the page to
capture and no privileged action the fake icon can take.
- Rationale: directly satisfies the mission criterion "the injected lock icon is decorative
  and gains a hostile page nothing if faked or hidden." The security boundary is the
  chrome-owned sheet, not the icon.
- Trade-off: the icon can be visually spoofed by a page (a fake "unlock" affordance). This
  is inherent to main-world injection without shadow DOM and is mitigated by the real prompt
  being unmistakably chrome-owned (outside the page viewport chrome). Documented for the
  threat-model page (F3).

**DD2 — Login-form detection reuses and extends the pure `vault-fill-fields.js` helper**:
Leg 1 factors the DOM-detection logic into a pure, Electron-free, unit-testable sibling (the
established `vault-fill-fields.js` idiom — importable under `node --test`). `findLoginFields`
today returns only the **first** `input[type=password]` (`vault-fill-fields.js:31-53`); the
lock-icon path must enumerate **all** password fields (`querySelectorAll('input[type=password]')`)
for per-form icon placement. Detection stays a `type=password`-anchored heuristic (no
login-form scoring in v1).
- Rationale: one detection source of truth shared by fill (F1) and icon injection (F2);
  headless-testable; matches the codebase's "pure sibling for preload logic" pattern
  (F1 debrief lesson).
- Trade-off: `type=password` misses exotic custom-element logins; acceptable for v1 and
  consistent with the F1 fill heuristic.

**DD3 — The gesture channel mirrors `guest-media-list`; it is a trigger, never a secret
path**: Leg 1 adds `ipcRenderer.send('guest-vault-gesture', …)` in `webview-preload.js`,
received by a new `ipcMain.on('guest-vault-gesture', …)` in `register-browser-ipc.js` that
takes the wcId from `event.sender.id` (trusted) and forwards via
`chromeForTab(event.sender.id)?.send('vault-gesture', { wcId })` to the chrome renderer,
which subscribes through a new `chrome-preload.js` contextBridge method. This is the exact
shape of the existing `guest-media-list` → `tab-media-list` flow
(`register-browser-ipc.js:77-80`). **The emit is gated on `event.isTrusted`** in the Leg 1
click handler: a scripted `iconEl.click()` / synthetic dispatch is ignored, so a hostile page
cannot programmatically raise the chrome unlock prompt (it could never *complete* a fill — the
sheet is chrome-owned — but the gate removes the unsolicited-prompt phishing/annoyance surface
and upholds the "explicit user action" criterion).
- Rationale: reuses the one audited guest→chrome routing idiom; never trusts a
  renderer-supplied id; carries no credential; only a genuine user gesture triggers the prompt.
- Trade-off: none beyond a new channel triple; it is the established pattern.

**DD4 — Chrome-owned prompts render on the menu-overlay sheet; the master password travels
as a Buffer on a dedicated secret channel**: the flight adds new menuTypes — `vault-unlock`
(`chrome-unlock` leg), `vault-picker` (`pick-and-fill` leg), `vault-capture` (`capture-save`
leg) — to the `TEMPLATES` map (`menu-overlay.js:524`) with new template builders driven by the
shared APG `menu-controller`: unlock/capture follow the `input-dialog` pattern
(`menu-overlay.js:328-441`, the `new-container` precedent); the picker follows a
`menu`/`listbox` pattern (decided at the `pick-and-fill` leg). The master password does **not**
ride channel-4 `menu-overlay:activated`: that path is string-only and hard-capped at 24 chars
by `sanitizeActivatedValue` (`menu-overlay-value.js:17,27`) — and widening the shared sanitizer
would weaken the container-name path. Instead a **dedicated channel** carries the secret as a
`Uint8Array`. **The sheet is `contextIsolation:true` (`window-factory.js:88`)** — its isolated
world has no `ipcRenderer`, only the `menuOverlay` contextBridge (`menu-overlay-preload.js:18-24`).
So the secret makes **two hops**, both of which pass typed arrays: a **new `menuOverlay`
contextBridge method** → the sheet preload → a new dedicated ipcMain channel (validated by the
same sender-identity + token check the overlay handlers use, `register-overlay-ipc.js:18-28`).
**The channel is a request/response `ipcRenderer.invoke` (not `send`)** — refined at the
`chrome-unlock` leg design review, because the wrong-password re-prompt needs the `{ ok }` result
back at the sheet to stay open and show an error; `ipcMain.handle` coexists with the existing
`ipcMain.on` overlay handlers, and closing the sheet mid-invoke is safe (`closeMenuOverlay` only
hides the view, never destroys the still-alive webContents that receives the reply). Main
receives the `Uint8Array`, converts to a `Buffer`, passes it straight to `deriveMasterKey`
(which **already** accepts `string | Buffer`, `vault-crypto.js:281-289`; no signature change —
`vault-store.unlock` just forwards it), and `.fill(0)`s **both** the copied `Buffer` and the
incoming `Uint8Array` after `unlock()` resolves (the deserialized array is a separate main-heap
allocation) — mirroring `vault-context.zeroize` (`vault-context.js:124-159`) and `vault-store.js:412`.
- Rationale: honors the mission constraint that secrets which must be wiped travel as
  Buffers, not unscrubbable JS strings; leaves the shared 24-char sanitizer (container-name
  path) untouched; keeps the sheet the sole chrome-owned entry surface. No crypto widening —
  the store already Buffer-accepts.
- Trade-off: the sheet DOM `<input>.value` is unavoidably a JS string for the moment it is
  typed (V8 strings are unscrubbable — an accepted mission limitation); its lifetime is
  minimized and everything main-side is a zeroizable Buffer. One new contextBridge method +
  IPC channel outside the generic overlay-activated path (a deliberate exception, documented
  at the handler).

**DD5 — Human vault reachability is a net-new, metadata-only, origin-filtered `VaultStore`
method**: the picker needs the credentials from "this jar's vault + the global vault" that
**exact-origin-match the current tab** (DD6), as a merged, badged list. No such method exists
(the human path only has per-target `listItems(target)`, `vault-store.js:650`;
`vault-context.list()` merges but is the automation/no-MRK path). The `chrome-unlock` leg adds
a `VaultStore` method that, given a jar id **and the tab origin**, returns login items reachable
for that jar — global + that jar — **whose stored `origin` equals the tab origin**, each tagged
with its source `vaultId` for badging, exposing only `{ vaultId, id, title, origin, username,
hasTotp }` and **never** the password. The password for a chosen item is read by id only at
fill time (existing MRK-gated item read).
- **Reachability guards (state-machine):** the method returns an **empty** list — never throws
  — when the vault is **locked** (no MRK), when the active tab is a **burner/non-persistent**
  partition (DD9), or when a jar vault has not been lazily created yet. `_resolveTarget`
  (`vault-store.js:540-547`) and `_requireMrk` (`vault-store.js:338`) throw in those states, so
  the new method guards them and maps to empty rather than surfacing an exception to the picker.
- **Freshness contract:** source of truth is the on-disk vault decrypted under the in-memory
  MRK; the read is **per-open** (the picker reads fresh each time it is raised — no caching),
  so an item added/edited via capture (DD7) or F3 is reflected on the next pick. The origin
  argument is captured at gesture time from the tab that owns the clicked icon.
- Rationale: parallels the proven `vault-context.list()` shape on the human/MRK side;
  metadata-only upholds "no tool/surface returns a stored password"; badging by source
  vaultId realizes the "each badged, never a sibling's" criterion; origin-filtering means the
  picker never shows a credential that would silently refuse to fill. (This also resolves F1's
  carried "global-via-jar-automation for F2" question: the **human** picker reaches global via
  MRK reachability, not an access-key scope tier — no new access-key tier is needed.)
- Trade-off: a second list path (human MRK + automation session); accepted — they sit on
  different key states and must not be conflated.

**DD6 — Exact-origin only in F2; the registrable-domain opt-in defers to F3**: both the
human fill and capture match **exact origin** (`new URL(url).origin`, reusing
`vault-context.js:44-50` `originOf` and the `vault-context.js:322-326` gate). The
registrable-domain per-credential opt-in — which the mission **requires** to use a hardened
suffix set / PSL and explicitly **not** the `trackers.js` `registrableDomain` curated set
(non-PSL; mis-resolves `example.co.uk` → `co.uk`, `trackers.js:71-79`) — is deferred to F3,
where per-credential CRUD (the natural home for a per-credential toggle) lives and the
hardened matcher can be built.
Exact-origin is applied in **two places**: the picker is **origin-filtered** at open (DD5 —
it only ever lists credentials whose stored origin equals the tab origin), and the fill path
**re-checks** the match at dispatch (the existing `vault-context.js:322-326`-style gate) so a
stale pick cannot fill the wrong origin. If the picker's origin-filtered set is **empty**, the
prompt shows a "no saved logins for this site" state and offers nothing to fill (creating a new
login for the site is F3's `goldfinch://vault` surface).
- **Lock-between-pick-and-fill:** if the vault idle-auto-locks or is explicitly locked between
  the picker read and the fill dispatch (`_requireMrk` would throw `VaultLockedError`,
  `vault-store.js:338,559`), the flow **re-raises the unlock prompt** rather than erroring —
  the gesture→(unlock)→pick→fill state machine treats "locked at fill" the same as "locked at
  gesture." Resolved at the `pick-and-fill` leg.
- Rationale: exact-origin is the mission's stated "default and the only guaranteed-safe
  scope"; F2 needs no domain-matching UI to deliver a complete human fill; hardening the
  matcher is real work that belongs with the credential-editing surface.
- Trade-off: no cross-subdomain fill in F2 (e.g. `accounts.example.com` won't fill an
  `example.com` credential). Acceptable and safe-by-default; F3 adds the opt-in.

**DD7 — Capture reuses `saveItem`; submit-detection lives in the guest preload; the captured
secret is held only until the prompt resolves**: the `capture-save` leg adds a submit observer
(form `submit` / `beforeunload` on detected login forms) in `webview-preload.js` that captures
`{ origin, username, password }` from the user's **own freshly-typed** credential and sends
it up a new channel (paralleling `guest-media-list`). This credential is already in web
content by the user's own action — capturing it is within the trust model (it is not a
*stored* secret being exposed). Main raises a chrome-owned save/update prompt **only when the
manager is set up** (`vault-store.isSetUp()`), **update** when an exact origin+username
already exists (existence check over the DD5 reachable read), **save** otherwise, defaulting
to the active jar's vault with global selectable, and on accept calls
`vault-store.saveItem(target, { type:'login', … })` (`vault-store.js:610` — the existing
primitive, currently caller-less). The captured password is held in main only until
accept/dismiss, then dropped/zeroized; nothing is persisted before the user accepts.
- Rationale: `saveItem` (lazy-creates the vault, upserts by id, validates type) already is
  the correct store primitive; capture is pure wiring onto it; the "offer, don't
  auto-save" posture matches the dedicated-manager (not autofill) thesis.
- Trade-off: the captured password transits guest→main as a value (Buffer where feasible)
  for the prompt's lifetime; bounded and never written to disk pre-accept. The submit
  observer adds a guest-world listener (behind the existing detection gate).

**DD8 — Behavior-test apparatus: the menu-overlay sheet is deliberately MCP-unreachable, so
verification splits across a guest-observable behavior test, main-process integration tests,
and the F4 HAT**: an apparatus audit (both axes) established that **no MCP path exposes the
sheet's WebContents** — `getChromeTarget` resolves only `chromeView.webContents`
(`engine.js:220-236`, `main.js:232-234`), the sheet is classified `'guest'` and never
enumerated (`window-registry.js:152-201`, `resolve.js:56-60`), and the only MCP observation
of sheet state is an admin `captureWindow` **pixel** screenshot (which explicitly composites
the sheet overlay layer when visible, `main.js:485-502` — so the render-evidence step is
genuinely observable). This is the security posture working as intended: the sheet is
unreachable from **web content and from jar-scoped automation**, and its wcId is never exposed
by any MCP tool. The boundary holds **by non-exposure** — an **admin** key carries
`allowInternal:true` (`resolve.js:131`) and *could* `readDom`/`evaluate` the sheet if it
somehow held the raw wcId, but nothing hands it that id, and admin ⊇ operator already, so this
is not a new hole; truly admin-proofing the sheet would need a dedicated resolver guard (out of
scope for F2, noted for the F3 threat-model page). This is **not a gap — and F2 will not weaken
it by registering the sheet wcId for the automation surface.** Verification therefore splits:
- **Behavior test** `vault-human-fill-boundary` (MCP, live GUI): drives the triggering
  gesture (jar/admin `click` on the injected lock icon in the guest tab), asserts the guest
  page never contains the master-password prompt and never receives the master password
  (`readDom`/`evaluate`), asserts the chrome-owned prompt actually renders (admin
  `captureWindow` pixel evidence — the sole MCP view of the sheet), asserts a faked/hidden
  lock icon leaks nothing and triggers no fill, and asserts wrong-origin / iframe never
  fills. This is the real-environment slice MCP can see.
- **Main-process integration tests**: drive the full unlock→pick→fill and capture→save
  flows by simulating the sheet's inbound IPC (the dedicated secret channel + a picker
  selection) against the Electron-free menu-overlay-manager / handlers, asserting the
  `vault-fill` delegate is called with the right credential+origin and `saveItem` with the
  right target — without scripting the unreachable sheet DOM.
- **Unit tests**: the pure detection/positioning helper, the reachable-items API, the Buffer
  secret-channel handler (no string round-trip; main-side zeroize), the exact-origin gate.
- **a11y**: the new sheet templates via `npm run a11y` (the chrome-state driving path
  internal/overlay UI requires; axe-core, `package.json:18`).
- **F4 HAT**: true human end-to-end (typing the master password into the real sheet and
  picking from the real picker).
- Rationale: verifies each property on the surface that can actually observe it; refuses to
  trade a security property for test reach; mirrors F1's unit-heavy + one-behavior-test posture.
- Trade-off: no single automated test drives the whole human flow through the real sheet DOM;
  the integration tests + behavior test + HAT together cover it. Documented so the F4 HAT
  knows the sheet-interaction path is the human-verified segment.

**DD9 — Burner/non-persistent partitions get no lock icon, no fill, no capture — structural,
gated in main + suppressed at the icon**: burner tabs are `trusted:false` web tabs that run
`webview-preload.js` (`register-tab-ipc.js:82-92`), so without an explicit gate they would get
the injected icon and — because the human picker reads via the **MRK**, which reaches the
**global** vault regardless of tab — could fill/capture global credentials. That violates the
mission's "Burner and internal partitions have **no vaults at all**." (Internal is already
excluded — internal tabs load `internalPreloadPath`, `register-tab-ipc.js:73-81`, not this
preload. Burner is **not**.) Two layers:
- **Icon suppression (Leg 1):** the preload gates icon injection on a main-provided
  *vault-eligibility* flag for the tab (queried at preload init in the `shields-farble`
  sync-IPC style, or pushed on load). Main answers *eligible* only when the tab's session
  resolves to a **persistent** jar (reusing the F1 `resolvePersistJar` / `BURNER ∉ jars.list()`
  idiom) — burner → not eligible → no icon.
- **Main-side refusal (defense in depth):** the gesture handler and the capture handler
  independently resolve the owning persistent jar from `event.sender.id`; a non-persistent tab
  raises **no** prompt and captures **nothing** — never a fallback to the global vault. (Note:
  DD7's "default to the active jar's vault" would otherwise throw `VaultStateError` for a burner
  tab with no `jars.list()` entry, `vault-store.js:540-547` — the gate prevents reaching that.)
- Rationale: extends F1's structural exclusion idiom to the human surface; a security flight
  must not leave the burner default (silent global fill/capture) implicit.
- Trade-off: a per-tab eligibility query at preload init; cheap, mirrors `shields-farble`.

**DD10 — Lock-state has one source of truth (`vault-store` MRK-present) pushed to all chrome
renderers on every transition**: the toolbar vault-lock indicator (a new `icon-btn` near
`#automation-indicator`, `index.html:99`) reflects whether the manager is unlocked. Today the
`onLock` hook is **unwired** (`main.js` injects only `listJars` + `getAutoLockMinutes`) and
there is **no `onUnlock` hook** (`_installMrk` is silent, `vault-store.js:494-499`). The
`chrome-unlock` leg wires both directions to a broadcast to **every** chrome renderer (model
the existing `broadcastToChromeAndInternal`, `main.js:294`):
- **unlock** — add a new `onUnlock` hook fired from **inside `_installMrk`**
  (`vault-store.js:494-499`), the single choke point **all three** MRK-install paths funnel
  through (`unlock` `:454`, `unlockWithRecovery` `:470`, `unlockWithAdmin` `:488`). Firing at the
  choke point — symmetric with `onLock` firing from `lockNow` — means a recovery/admin unlock
  broadcasts too, so the indicator can never show "locked" while the store is unlocked. (The
  recovery/admin unlock *UIs* are F3, but the hook belongs at `_installMrk` now — zero extra
  cost, strictly more correct. `changeMasterPassword` `:508` is **not** a transition — it
  re-wraps while already unlocked and never calls `_installMrk` — so the set is complete.)
- **lock** — wire the existing `onLock` hook, which `lockNow()` and the idle timer already fire
  (`vault-store.js:289-291,312-318`); also fires on **quit** (the `before-quit`→`lockNow` path);
- the `main.js:560-564` comment that the store is driven with "only stateless methods / never
  mutates human lock state" becomes false once F2 uses the stateful human `unlock()` — update it.
- **Freshness contract:** source of truth = `vault-store` MRK-present state; rebuild trigger =
  **event push on every transition** (no polling, no TTL); max staleness = none (pushed
  synchronously on transition); invalidating actions = human unlock, Lock-now, idle auto-lock,
  quit. The indicator is a pure projection of pushed state — it never reads a cache.
- Rationale: an indicator that can disagree with actual lock state is a security-confusing bug;
  a single pushed source of truth prevents it.
- Trade-off: a new broadcast + an `onUnlock` hook; small and localized to `chrome-unlock`.

### Prerequisites

- [ ] MCP automation surface runs locally (`npm run dev:automation`, loopback **49707** —
      existing default) with an **admin** transport key (`GOLDFINCH_AUTOMATION_ADMIN` set,
      `mintAdminKey`) for the behavior test's `captureWindow` sheet-render evidence.
- [ ] A **login-form fixture page** (reuse/extend F1's `tests/behavior/fixtures/vault-login/`)
      with at least one multi-form page and one cross-origin iframe case for the top-frame /
      origin assertions — probed before the flight lands.
- [ ] The **push-button vault-fixture builder** (F1's `build-fixtures.mjs`) provisions a
      set-up manager + a jar vault with Login items for the human-path reachability + fill —
      extended if the human picker needs items the F1 builder doesn't stage.
- [ ] `npm run a11y` tooling (axe-core) available for the new sheet templates.
- [ ] **F1's `vault-fill` main→preload channel verified live before F2 leans on it** — F1
      landed it on unit + a smoke run, but the canonical `vault-mcp-surface` Witnessed test
      remains unrun (F1 debrief Action Item). The `pick-and-fill` leg reuses this exact channel
      (`main.js:634-636`), so confirm the F1 fill path works end-to-end (re-run F1's smoke or the
      Witnessed test) at the start of that leg rather than debugging a compound failure later.
- [ ] No new port, service, or dependency is introduced (zero-runtime-dependency identity
      holds — all F2 work is UI wiring + a metadata read on existing crypto).

### Pre-Flight Checklist

- [x] All open questions resolved (two remaining are leg-internal, noted above)
- [x] Design decisions documented (DD1–DD10)
- [x] Prerequisites verified (probed at design; the F1-fill-live check runs at the
      `pick-and-fill` leg per its prereq)
- [x] Validation approach defined (unit + integration + one behavior test + a11y — see
      Verification; apparatus per DD8)
- [x] Legs defined (4 legs; verified by two Architect design-review passes)

---

## In-Flight

### Technical Approach

Four legs, each a coherent human-trust-boundary slice built and tested in one pass, layered so
each consumes the last. The chrome-owned sheet is the security boundary throughout; the guest
world only *detects* and *triggers*; main holds every secret as a zeroizable Buffer. (Leg 2 of
the original 3-leg sketch was split at design review — the security-critical unlock/secret
channel is its own leg from the picker/fill orchestration, so each gets its own review gate.)

1. **`lock-icon-inject`** — the guest half + the trigger. A pure, unit-testable detection/
   positioning helper (extending/factoring `vault-fill-fields.js` to enumerate all password
   fields); main-world injection of a decorative lock icon anchored to each detected login form
   (MutationObserver-driven re-placement, reusing the preload's existing debounced observer),
   **suppressed in burner tabs via a main-provided eligibility flag (DD9)**; and the
   `guest-vault-gesture` → `event.sender.id` → `chromeForTab` → `vault-gesture` trigger channel
   (emit **`event.isTrusted`-gated**, DD3) with its chrome-preload subscriber (DD1, DD2, DD3,
   DD9). No secret crosses any new channel. Chrome-side lands a subscriber stub Leg 3 fills in.

2. **`chrome-unlock`** — the security-critical unlock surface. The new menu-overlay
   `vault-unlock` prompt template + the dedicated **`menuOverlay` contextBridge → preload →
   ipcMain** Buffer secret channel (main zeroizes after `unlock()` resolves; no crypto widening —
   `deriveMasterKey` already Buffer-accepts, DD4); and the **lock-state source-of-truth +
   broadcast** to all chrome renderers on unlock/lock/quit with the new toolbar `icon-btn`
   indicator near `#automation-indicator` (DD10, wiring `onLock` + a new `onUnlock`). *(The DD5
   reachable-items method moved to `pick-and-fill` at leg design — co-located with its first
   consumer, the picker; see flight log — keeping this leg the tight secret-channel + lock-state
   security surface.)*

3. **`pick-and-fill`** — the orchestration. The net-new **origin-filtered, metadata-only
   `VaultStore` reachable-items method** (DD5); the `vault-picker` template (badged: this jar +
   global; origin-filtered per DD5/DD6); and the full **gesture → (unlock if locked) → pick →
   fill** state machine that re-checks lock state at dispatch (re-prompt if locked, DD6) and
   hands the chosen credential to F1's `vault-fill` main→preload channel (`main.js:634-636`),
   exact-origin matched, top-frame only. **Starts by verifying F1's fill path live** (prereq).

4. **`capture-save`** — the reverse direction. A guest-preload submit observer on detected login
   forms (**burner-gated + set-up-gated**, DD9/DD7); the capture channel guest→main; the
   chrome-owned `vault-capture` save/update template (update when an exact origin+username
   exists, save otherwise; default active jar, global selectable; only when set up); wired to the
   existing `saveItem` primitive (DD7). The captured secret is held only for the prompt's
   lifetime, then zeroized.

Verification is integration-heavy for the flow logic (the sheet is MCP-unreachable by design —
DD8), unit-tested for the pure helpers + the secret channel + the reachable read, one
guest-observable behavior test (`vault-human-fill-boundary`) for the real-environment trust
boundary, a11y for the new templates, and the true human end-to-end deferred to F4's HAT.

### Checkpoints

- [ ] **(a)** Lock-icon injection + detection + the trigger channel: a decorative icon appears
      on a detected login form (and **not** in a burner tab), an `isTrusted` click emits the
      trusted-wcId `vault-gesture` to chrome, and faking/hiding the icon changes nothing —
      pure-helper unit tests + the channel wiring green (end of `lock-icon-inject`).
- [ ] **(b1)** Chrome-owned unlock + lock-state: the master password enters only the sheet and
      travels to main as a zeroized Buffer that unlocks the store; the lock indicator reflects
      unlock/lock/quit (broadcast to all chrome renderers) — integration (simulated secret-channel
      IPC) + unit green (end of `chrome-unlock`).
- [ ] **(b2)** Reachable read + picker + human fill: the reachable method returns only
      origin-matching {jar, global} metadata (never a password, empty when locked/burner); the
      picker shows only those, badged; a pick fills the exact-origin top-frame form via the
      `vault-fill` channel with the password never in the tool/return path; a lock between pick and
      fill re-prompts — integration + unit green, on a live-verified F1 fill path (end of
      `pick-and-fill`).
- [ ] **(c)** Capture: submitting a login form (in a non-burner, set-up state) raises a
      chrome-owned save/update prompt (update on existing origin+username), and accepting persists
      via `saveItem`; the prompt is never in page DOM — integration + unit green (end of
      `capture-save`); the `vault-human-fill-boundary` behavior test passes its guest-observable
      steps and `npm run a11y` passes for the new templates (flight end).

### Adaptation Criteria

**Divert if**:
- Injecting a positioned icon without shadow-DOM isolation proves unworkable across common
  login layouts (reconsider whether the icon anchors to the field vs. a toolbar-only
  affordance — the gesture can also originate from the chrome, not only the page).
- The dedicated Buffer secret channel cannot bypass the sheet's string DOM layer meaningfully
  (i.e. no zeroization benefit is achievable) — revisit DD4 (accept best-effort string, or
  move password entry off the sheet).
- The menu-overlay sheet cannot render a second concurrent prompt shape where the flow needs
  one (e.g. unlock-then-pick as two sheets) — restructure the flow within the manager's
  open-while-open model-replace (`menu-overlay-manager.js:241`).

**Acceptable variations**:
- Picker as `menu` vs `listbox`; exact template factoring and CSS.
- Icon glyph, exact positioning strategy, and observer debounce within the DD1/DD2 envelope.
- Additional unit/integration cases beyond those enumerated.
- Whether the unlock prompt and picker are one combined sheet flow or two sequential sheets.

### Legs

> **Note:** Tentative; planned one at a time as the flight progresses.

- [x] `lock-icon-inject` — pure login-form detection helper (all password fields) + decorative
      main-world lock-icon injection (burner-suppressed, DD9) + the `guest-vault-gesture`/
      `vault-gesture` trigger channel (`isTrusted`-gated, trusted wcId from `event.sender.id`) +
      chrome-preload subscriber. *(Checkpoint a.)*
- [x] `chrome-unlock` — `vault-unlock` sheet template + `menuOverlay`-contextBridge Buffer
      secret channel (zeroized; no crypto widening) + lock-state source-of-truth broadcast on
      unlock/lock/quit with the toolbar indicator (DD10). *(Checkpoint b1.)*
- [x] `pick-and-fill` — net-new origin-filtered metadata-only `VaultStore` reachable-items
      method (DD5) + badged, origin-filtered `vault-picker` template + the
      gesture→(unlock)→pick→fill state machine on F1's `vault-fill` channel (exact-origin,
      top-frame, re-prompt-on-lock). Verifies the F1 fill path live first (prereq).
      *(Checkpoint b2.)*
- [x] `capture-save` — guest submit observer (burner/set-up-gated) + capture channel +
      `vault-capture` save/update sheet template (update-on-existing, default-jar/global-
      selectable) wired to `saveItem` (DD7). *(Checkpoint c.)*

*(No per-flight HAT leg — the mission's closing HAT is Flight 4, which covers the true human
end-to-end that DD8 defers.)*

---

## Post-Flight

### Completion Checklist

- [x] All legs completed (4/4: lock-icon-inject, chrome-unlock, pick-and-fill, capture-save)
- [x] Code committed on `flight/02-human-fill-trust-boundary`; draft PR opened (merge is the
      operator's gate — stacked on F1's unmerged PR #108)
- [x] Unit + integration suites passing (`npm test` **2389/2389**), typecheck clean, lint clean;
      whole-diff flight-end security review passed (1 blocking data-loss issue found + fixed +
      re-review-confirmed)
- [ ] `npm run a11y` passing for the new sheet templates — **deferred: live-GUI step** (the audit
      drives real chrome state; not runnable headless in-session). Flight-end/F4-HAT GUI step.
- [ ] `vault-human-fill-boundary` behavior test passing its guest-observable steps — **deferred:
      live-GUI step** (per DD8 the sheet interior is integration + F4-HAT; the guest-observable
      slice needs a running GUI with the F2 build). Flight-end/F4-HAT GUI step.
- [ ] Flight debrief written (the go/no-go point before F3) — next step.

### Verification

- **Unit** (`node --test test/unit/*.test.js`): the pure detection/positioning helper (all
  password fields, per-form anchoring, no-login-field null path); the metadata-only
  reachable-items `VaultStore` method (this-jar + global merge, source-vault tagging, never a
  password, locked/absent target contributes nothing); the Buffer secret-channel handler
  (`deriveMasterKey`/`unlock` accept `Buffer`; the buffer is `.fill(0)`'d after scrypt; no
  string round-trip); the exact-origin gate for both fill and capture; capture update-vs-save
  existence logic.
- **Integration (main-process, simulated sheet IPC)**: gesture→unlock→pick→fill end-to-end —
  a simulated dedicated-secret-channel unlock + a simulated picker selection results in the
  `vault-fill` delegate being called with the correct credential and an exact-origin match,
  and the password never appears in any return value; capture→save — a simulated captured
  submit + accepted `vault-capture` results in `saveItem` called with the right target
  (update on existing origin+username, else save; refused when not set up).
- **Behavior test** `vault-human-fill-boundary` (`/behavior-test vault-human-fill-boundary`):
  guest-observable trust boundary over the live MCP surface — clicking the injected lock icon
  triggers a chrome-owned prompt (admin `captureWindow` pixel evidence; the guest DOM contains
  no prompt and never receives the master password), a faked/hidden icon leaks nothing and
  fills nothing, and a wrong-origin / cross-origin-iframe login never fills. Apparatus per DD8
  (the sheet interior is verified by integration + F4 HAT, not this test).
- **a11y** (`npm run a11y`): the new `vault-unlock` / `vault-picker` / `vault-capture` sheet
  templates pass axe via the chrome-state driving path (roving/focus-trap per the APG
  menu-controller).
