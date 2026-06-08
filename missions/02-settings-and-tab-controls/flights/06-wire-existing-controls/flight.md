# Flight: Wire Existing Controls (Shields + Home Page) into Settings

**Status**: in-flight
**Mission**: [Settings Area & Tab-Bar Controls](../../mission.md)

## Contributing to Criteria
- [ ] **SC7** — The privacy/Shields controls (already persisted) and the default/home page are operable from
  the settings surface, and changes persist and take effect consistently with the existing panels.
  Promoting the home page to a real setting includes the minimal persistence it needs (it is hardcoded
  today).
- [ ] **SC8** — The newly-wired settings controls are keyboard-operable and introduce no new WCAG A/AA
  violations under the (pinned) accessibility gate.

> **Scope note.** This flight makes the **global Shields toggles** and the **home page** operable from
> `goldfinch://settings`, backed by a **new durable, secure settings store** and the **origin-checked
> internal-page bridge** (the hard security prerequisite carried from Flights 4–5). It does **not** build the
> pin/unpin system or rewire the "Site settings →" link — those are **Flight 7** (split agreed at planning;
> the pin system depends on this flight's store + the settings Privacy section). Per-site Shields *pause*
> stays in the slide-out panel (it needs a current site, which the settings page lacks).

---

## Pre-Flight

### Objective
Turn `goldfinch://settings` from a placeholder shell into a surface with **real, persisted controls**: the
global Shields toggles (`enabled`/`block`/`strip`/`isolate`/`farble`) and the **home page** (promoted from a
hardcoded constant to an editable, persisted setting). All settings-page IPC flows over a **newly-secured
internal bridge** whose privileged channels verify the sender is the internal `goldfinch://` origin in the
**main process** (not just the preload) — closing the Flight-4/5 "web content in the internal session could
call privileged IPC" Known Issue. A new **durable, secure, schema-versioned settings store** is the canonical
home for app preferences going forward (built properly now, not pieced together).

### Open Questions
- [x] Where does the home page persist? → A **new general settings store** (`settings-store.js`), built
  durable/secure now (operator). Not a minimal home-only store, not folded into `shields.js`. See DD1.
- [x] Where is the bridge origin-check enforced? → **Main-side sender-frame verification** on dedicated
  internal channels, plus a preload `location.origin` guard as defense-in-depth (operator-aligned). See DD2.
- [x] Does "secure" mean encryption at rest? → **No, not now.** Access-controlled + validated + atomic +
  schema-versioned. The serialization seam is built **pluggable** so safeStorage can be added when a secrets
  manager lands (operator). See DD1/DD6.
- [x] Which Shields controls in settings? → The **global** toggles; per-site pause stays in the panel. See DD3.
- [ ] **How is the origin-check verified live?** Driving "web content *inside* the internal session calling
  the bridge" is hard post-Flight-5 (the nav lock + webPreferences-immutable). The two tractable assertions:
  (a) `window.goldfinchInternal` is **undefined** in a web guest (different preload); (b) a privileged call
  from a **non-internal sender** is rejected by the main helper — driven via CDP `Runtime.evaluate` against
  the **`file://` chrome target** attempting `ipcRenderer.invoke('internal-settings-set', …)`, which fails
  (the channel isn't on `chrome-preload.js`'s surface) — note this proves "channel not exposed to chrome,"
  which is *adjacent to* but not identical to "main rejects a non-internal sender"; the latter is best proven
  by a focused main-side check. The true in-session vector remains hard to drive — resolve the apparatus at
  the verify leg; if undrivable, assert (a)+(b) + the structural main-side argument and **log the gap**. See
  DD5.

### Design Decisions

**DD1 — Durable, secure, schema-versioned settings store (`src/main/settings-store.js`)**: A general
key-value preferences store in `userData/settings.json` (mirrors `shields.js`'s `app.getPath('userData')`
location convention), built now as the **canonical home for app settings** — not a minimal home-page store.
Exposes `load`/`get`/`set`/`getAll` with: **atomic persistence** (write a temp file + `rename`, unlike
`shields.js`'s direct `writeFileSync`), a **`version` field** + **per-key validation** + **safe-default
repair** on corrupt/partial load (one bad field must not wipe all settings), and a **pluggable
serialization seam** (DD6). Holds `homePage` in this flight; Flight 7 adds pin keys without rearchitecting.
The pure core (validation, merge-with-defaults, repair) is **unit-testable** with an injected path (model
the tests on `test/unit/shields.test.js`'s temp-dir approach: a real temp dir in setup, cleaned up after,
path injected). **The module must NOT call `app.getPath('userData')` at require-time** — `app.getPath` is
only valid after `app.whenReady()`; the path is injected at first `load(userDataPath)` (called from main's
`whenReady`, like `shields.js`), never captured at module load.
- **"Secure"** here = (a) **access-controlled** — only the origin-checked internal bridge + the trusted
  `file://` chrome can read/write; web content cannot; (b) **validated writes** — every set is schema-checked
  (home page via `isSafeTabUrl`); (c) **atomic + versioned persistence**. **Not** encrypted now (it holds
  preferences, not secrets).
- Rationale: the operator wants one durable, secure store now rather than incremental pieces. Trade-off:
  more upfront than a minimal home store — justified as the foundation for Flight 7 and beyond.

**DD2 — Origin-checked internal bridge: dedicated channels, main-side sender verification (HARD
PREREQUISITE)**: Real bridge IPC is introduced via **new internal-only channels**, in **separate pairs per
backend** (`internal-settings-get`/`internal-settings-set` → the new store; `internal-shields-get`/
`internal-shields-set` → `shields.js`) — kept separate because they delegate to different backends, but all
wrapped by **one shared verified-sender helper**. The helper checks **`event.senderFrame?.origin ===
'goldfinch://settings'`** — an **exact serialized-origin string match** (NOT a `url.startsWith('goldfinch://')`
prefix test, which is fragile and admits `goldfinch://settings/../…`), and **rejects when the result is
`false` OR `senderFrame` is `null`** (a frame destroyed mid-IPC reads null). Belt-and-suspenders: also accept
only when `event.sender.session` is the internal session (`__goldfinchInternal` marker), which web content
cannot inhabit. This main-side check is the **authoritative security boundary**. The internal preload
(`internal-preload.js`) exposes the bridge methods on `window.goldfinchInternal` guarded by `location.origin
=== 'goldfinch://settings'` (defense-in-depth; a preload-only guard is bypassable if web content ever runs in
the internal renderer, because `webPreferences` are immutable after webview attach). The chrome's
`shields-get/set` channels are **untouched** (different trust domain — the `file://` chrome).
- This **closes the Flight-4/5 Known Issue** (the bridge graduating from inert `{version:1}` to real IPC is
  exactly the moment the origin-check must exist).
- Rationale: only sender verification at the main boundary is sound. Trade-off: channel duplication
  (internal-* vs chrome's) — accepted for trust separation, per the Flight-5 Architect.
- **Sequenced FIRST among the wiring legs** — no real bridge data flows until the secured channel pattern
  exists.

**DD3 — Shields in settings = global toggles, two-way synced**: The Privacy & Shields section wires the
**global** config (`enabled`/`block`/`strip`/`isolate`/`farble`) via the secured bridge, reusing
`shields.js`'s `get`/`set`. **Per-site pause (`pausedSites`) stays in the slide-out panel** — it needs a
current site, which `goldfinch://settings` does not have. **Critical sync fix (cache-freshness contract):**
the `shields-changed` broadcast today goes only to `mainWindow.webContents`; it must **also reach the settings
guest**. **Primary mechanism (main-owned):** in `shields-set`/`shields-pause`, after the existing send to
`mainWindow.webContents`, also send to every internal-session `webContents` — iterate
`webContents.getAllWebContents()` filtered by the internal session (the `__goldfinchInternal` marker), each
guarded by `!wc.isDestroyed()` (main-side fan-out, no stale single-reference). The internal preload exposes
`window.goldfinchInternal.onShieldsChanged`/`onSettingsChanged(cb)` so the settings page re-renders on the
broadcast. **Source of truth** = `shields.js` config; **rebuild trigger** = the `shields-changed` event (every
set/pause from either surface); **max staleness** = one IPC round-trip; **invalidating actions** = a toggle
from settings OR from the panel (both route through `shields-set`/`shields-pause`, both now broadcast to both
surfaces). No per-site state on the settings page → no per-site staleness.
- Rationale: SC7. Trade-off: a second broadcast fan-out (cheap; bounded by open internal tabs).

**DD4 — Home page promoted to a live, validated setting**: `HOMEPAGE` (a `renderer.js` const at **5 call
sites** — `createTab` default, container/burner opens, the initial tab) becomes a value **read from the
settings store at startup** and kept live via a `settings-changed` (home) broadcast; the settings page edits
it via the bridge. **`set` validates with `isSafeTabUrl`** — `goldfinch://`, `javascript:`, etc. are
rejected and the store keeps the prior value. The renderer caches the live value (like `shieldsConfig`) and
the createTab call sites read the cache, not a const.
- **Startup-race fix (load-bearing):** the renderer's **initial** `createTab(HOMEPAGE)` runs *synchronously*
  at file end (today ~`renderer.js:1893`), **before** any async `settingsGet` could populate the cache — so a
  naive change leaves the first tab on the stale default. The initial open must **await the store**:
  `window.goldfinch.settingsGet('homePage').then((url) => createTab(url || HOMEPAGE))`. Cover **all no-arg
  callers** (the `+` button, Ctrl+T) by changing the signature default from `url = HOMEPAGE` to read a live
  `currentHomePage()` cache accessor — one change covers every no-arg `createTab()`.
- **Migration / first run:** the store's **default `homePage` equals the existing constant**
  (`'https://www.google.com'`); the in-renderer `HOMEPAGE` const stays as the pre-load fallback. First run
  (no `settings.json`) → store returns the default → identical behavior to today.
- Rationale: SC7 + "promoting the home page includes the minimal persistence it needs." Trade-off: `HOMEPAGE`
  is no longer compile-time; call sites read the live value; the initial tab waits one IPC round-trip.

**DD5 — Verification apparatus, premise-audited on BOTH axes (act + observe)**:
- *Act* — drive the settings guest's Shield toggles + the home-page input via `scripts/cdp-driver.mjs` /
  node-CDP guest attach (proven Flights 4–5); drive the security probe by attempting a privileged bridge
  call from a non-internal origin. **Never** the `chrome-devtools` MCP.
- *Observe (cite the read path)* — **persistence**: read `userData/settings.json` (home) and `shields.json`
  (toggles) on the **filesystem** (Read/Bash); **live effect (home)**: open a new tab, read its webview
  `src` == the new home; **sync (shields)**: read the **chrome** privacy-panel DOM reflects the toggle set
  from settings (and vice-versa); **security**: confirm `window.goldfinchInternal` is **absent** in a normal
  web tab (different preload), and that the **main handler rejects a non-internal sender** (observable as the
  call throwing / returning an error + **no change to `settings.json`**).
- *Open premise (the one to resolve at leg design)*: driving **web content *inside* the internal session**
  calling the bridge is hard post-Flight-5 (nav lock + immutable `webPreferences`). If it can't be driven,
  the security assertion rests on the two tractable observations above + the structural argument (main-side
  sender check), and the gap is logged — not papered over.
- Rationale: both axes satisfied by existing surfaces + the filesystem. Trade-off: the in-session attack
  path may be argued rather than driven.

**DD6 — Settings-store serialization is backend-pluggable (future safeStorage)**: The store reads/writes
through a thin, **named seam** — a `{ serialize(obj): string, deserialize(str): any }` pair injected into
`load`/`save`, **defaulting to `JSON.stringify`/`JSON.parse`**. When a secrets manager is built later,
encryption (Electron `safeStorage`) replaces that pair **without touching callers, the schema, or the atomic
write path** — the operator's "if we build a secrets manager, add safeStorage at that time." **Do not build
encryption now.**
- Rationale: honor "don't piece it together" while not over-building. Trade-off: one small indirection now.

### Prerequisites
- [ ] App runs via `npm run dev:debug` (CDP `:9222`); `scripts/cdp-driver.mjs` reaches it. **Not** the
  `chrome-devtools` MCP.
- [ ] `userData` is writable for both `shields.json` and the new `settings.json`.
- [ ] A reachable web page (e.g. `https://example.com/`) for the home-effect + security checks.
- [ ] Guest-target a11y mode (`npm run a11y -- --target=goldfinch://settings`) operational (Flight 4).
- [ ] GUI/desktop runtime (Linux/WSL dev; macOS deferred to the standing mac HAT).
- [ ] **Behavior-test execution prereqs** (verified at flight start): running instance on `:9222`, guest
  reachable, the web page available — for `settings-controls` (and the security spec).

### Pre-Flight Checklist
- [ ] All open questions resolved (the one remaining — DD5 security-test drivability — is scoped to leg design)
- [x] Design decisions documented (DD1–DD6)
- [ ] Prerequisites verified at execution start (live GUI items the harness confirms then)
- [x] Validation approach defined (`settings-controls` behavior test authored; security assertion + apparatus
  premise-audited per DD5)
- [ ] Legs defined (below; finalized per-leg at design time)

---

## In-Flight

### Technical Approach
Build the durable settings store first (the data layer), then the origin-checked secured bridge (the access
layer), then wire the two surfaces (home page, Shields) over it, then docs and verify. The store + bridge are
the foundations; the two wirings are independent of each other and could parallelize.

- **`settings-store`** (leg 1): `src/main/settings-store.js` — atomic, schema-versioned, validated,
  safe-default-repair, injected-path testable core, pluggable serialization seam (DD1/DD6); unit tests under
  `test/unit/`. Holds `homePage`. (foundation)
- **`internal-bridge-secured`** (leg 2): the origin-checked internal IPC pattern — one shared main-side
  verified-sender helper (`senderFrame?.origin === 'goldfinch://settings'` + null-reject + internal-session
  check) wrapping the new internal channel pairs; `internal-preload.js` exposes the bridge + the
  `onShieldsChanged`/`onSettingsChanged` listeners with a `location.origin` guard. **Scope:** this leg proves
  the *plumbing* — `internal-settings-get('homePage')` invoked **from the internal guest** returns the stored
  value and the **same call from a non-internal sender is rejected**. The settings-page *UI controls* land in
  legs 3–4 (leg 2's checkpoint observes the bridge round-trip + rejection, not a rendered control). (HARD
  PREREQUISITE; DD2)
- **`home-page-setting`** (leg 3): promote `HOMEPAGE` to the live store value — startup load that the
  **initial `createTab` awaits** (the race fix, DD4) + a `currentHomePage()` cache fed by a `settings-changed`
  broadcast → every no-arg createTab site; wire the editable home control in the settings "On startup / Home
  page" section via the bridge; validate on set with `isSafeTabUrl`. **Acceptance includes: the first tab at
  startup opens to the persisted home page, not the compile-time default.** (SC7; DD4)
- **`shields-in-settings`** (leg 4): wire the global Shields toggles into the settings "Privacy & Shields"
  section via the bridge; extend the `shields-changed` broadcast to **also** reach the settings guest so the
  panel + settings stay in sync. (SC7, SC8; DD3)
- **`docs`** (leg 5): README + CLAUDE.md — the settings store (durable/secure model + future-safeStorage
  seam), the **origin-checked bridge security model** (the bridge is now real IPC — document HOW it's
  secured + that the Flight-4/5 Known Issue is closed), the home-page setting, Shields-in-settings.
- **`verify-integration`** (leg 6): `settings-controls` behavior test; the **security assertion** (bridge
  absent in web tabs; main rejects non-internal sender; in-session per DD5); `npm run a11y` (chrome +
  guest); regress `tab-scheme-guard` / `settings-shell` / menu+tab suites; offline gates. (SC7, SC8)
- **`hat-and-alignment`** (leg 7, optional): guided HAT — feel the wired toggles + the home-page control;
  fix inline.

### Checkpoints
- [ ] `settings-store` persists atomically, repairs a corrupt file to defaults, validates a bad home page;
  unit tests green.
- [ ] Internal bridge: privileged channels reject a non-`goldfinch://` sender (main-side); the chrome's
  `shields-*` channels still work; `window.goldfinchInternal` exposes the bridge only on the internal origin.
- [ ] Home page: editable in settings; persists to `settings.json`; a new tab opens to the set home; invalid
  URLs rejected.
- [ ] Shields toggles: settable from settings; persist to `shields.json`; the slide-out panel reflects the
  change live (and vice-versa).
- [ ] `settings-controls` behavior test passes; security assertion holds; a11y + regressions + offline green.

### Adaptation Criteria
**Divert / split if**:
- The origin-check / secured-bridge work proves larger than one leg (e.g. the verified-sender helper needs to
  cover more channels than expected) → split leg 2 into the helper + the first-consumer wiring.
- The `shields-changed`-to-guest sync requires reworking the broadcast plumbing beyond a second target →
  reassess; worst case the settings page polls on open rather than live-syncing (degraded, logged).

**Acceptable variations**:
- The exact internal channel names; whether settings + shields share one `internal-settings-*` channel pair
  or get separate pairs.
- Home-page input affordance (inline field vs edit/save); validation messaging copy.
- Whether the security in-session case is driven or argued (DD5).

### Legs
> **Note:** Tentative; legs are created one at a time as the flight progresses.
- [ ] `settings-store` - Durable/secure schema-versioned store (`settings-store.js`); atomic; validated;
  repair; pluggable serialization; unit-tested. (foundation; DD1/DD6)
- [ ] `internal-bridge-secured` - Origin-checked internal channels (main-side sender verification) + preload
  guard; first read consumer. (HARD PREREQUISITE; DD2)
- [ ] `home-page-setting` - Promote `HOMEPAGE` to the live store value + broadcast; editable, validated
  control in settings. (SC7; DD4)
- [ ] `shields-in-settings` - Global Shields toggles in settings via the bridge; `shields-changed` reaches
  the guest too (two-way sync). (SC7, SC8; DD3)
- [ ] `docs` - Settings store + bridge security model + home-page setting + Shields-in-settings in
  README/CLAUDE.md.
- [ ] `verify-integration` - `settings-controls` + security assertion; a11y (chrome + guest); tab-scheme-guard
  / settings-shell / menu+tab regressions; offline gates. (SC7, SC8)
- [ ] `hat-and-alignment` *(optional)* - Guided HAT: wired toggles + home-page control.

---

## Post-Flight

### Completion Checklist
- [ ] All legs completed
- [ ] Code merged
- [ ] Tests passing
- [ ] Documentation updated

### Verification
- **Behavior test `settings-controls`** (SC7, SC8) — toggle a global Shield in settings → it persists in
  `shields.json` AND the slide-out panel reflects it; change the home page in settings → it persists in
  `settings.json` AND a new tab opens to it; both keyboard-operable.
- **Security assertion** (the origin-check prerequisite) — `window.goldfinchInternal` is absent in a normal
  web tab; the main-side handler rejects a privileged call from a non-`goldfinch://` sender (no change to
  `settings.json`); the in-session case per DD5.
- **`npm run a11y`** — chrome + guest (`goldfinch://settings`) clean vs the pinned `ACCEPTED` baseline.
- **Regression** — `tab-scheme-guard`, `settings-shell`, `menu-dismissal`/`kebab-menu`/`unified-tab-controls`/
  `tab-keyboard-operability` still pass.
- **Offline gates** — `npm test` / `npm run typecheck` / `npm run lint` green (incl. new `settings-store` unit
  tests).
- **Manual** — anything CDP can't drive; macOS deferred to the mac HAT; tune feel via the HAT leg.
