# Flight: Jar Management Page

**Status**: in-flight
**Mission**: [Cookie Jar Management](../../mission.md)

## Contributing to Criteria

- [ ] A dedicated jar-management page is reachable from the browser chrome alongside the
      existing special pages, listing every jar with its name, color indicator, and
      default marker.
- [ ] From that page, the user can create a jar with a chosen name and color, and the new
      jar is immediately usable for browsing from the container picker — no restart.
- [ ] The user can rename and recolor an existing jar; the change propagates to open tabs
      and the container picker without restart, and the jar's stored data is preserved.
- [ ] The user can delete a jar after an explicit confirmation; its stored data is wiped,
      any open tabs in that jar close, and the jar disappears from all UI surfaces.
- [ ] The user can move the default flag to any persistent jar from the management page
      (completes criterion 5 — routing half landed in Flight 2).
- [ ] Burner appears as a single always-present list entry exposing no
      rename/recolor/delete controls (list-identity half of criterion 6 — the
      behavioral fallback halves landed in Flight 2).

Also retires two mission Known Issues (not success criteria): popup jar inheritance
and the guest-focus accelerator forwarding gap (operator ruling 2026-07-10: both ride
this flight rather than Flight 5).

---

## Pre-Flight

### Objective

Build `goldfinch://jars` — the third internal special page — giving the operator full
jar lifecycle control from one surface: live list with name/color/default marker and a
static Burner entry, create (curated palette), rename/recolor, set-default, and delete
with explicit confirmation. Deleting a jar closes its open tabs (firm requirement,
doubly runtime-observed in Flight 2). Alongside the page, complete the jar-confinement
stance set at Flight 2's HAT: `window.open`/`target=_blank` popups inherit the opener
tab's jar, and guest-focus chrome accelerators are forwarded through one generalized
classifier instead of per-key one-offs.

### Open Questions

- [x] Entry points → **operator ruling 2026-07-10**: kebab menu item + container-picker
      "Manage jars…" row. No settings-page link this flight. (Mission OQ resolved.)
- [x] Color selection UX → **operator ruling 2026-07-10**: curated palette only
      (DD4). Free input can arrive later without layout rethink. (Mission OQ resolved.)
- [x] Picker quick-create fate → **operator ruling 2026-07-10**: keep it; the page is
      the full-featured surface, quick-create remains the in-flow path. Both funnel to
      the same store. (Mission OQ resolved.)
- [x] Chrome-fix scope → **operator ruling 2026-07-10**: popup inheritance AND the
      generalized accelerator forwarder both ride this flight (DD7/DD8).
- [x] Is "rename is cosmetic — id/partition fixed forever" surfaced on the page? →
      Not surfaced (DD5). The page shows name/color only; ids remain an internal
      concept. Mission OQ resolved as "no, by design."
- [x] Zero tabs after delete-closes-tabs? → resolved in DD6 (fallback new tab in the
      resolved default; matches existing last-tab semantics — leg design verifies the
      existing closeTab last-tab path and reuses it).
- [x] How is the page machine-verified when MCP refuses internal targets? → resolved
      in DD9 (verification split; internal-page automation deliberately deferred).

### Design Decisions

**DD1 — Internal jar bridge: origin-gated `internal-jars-*` channels in jar-ipc.js**:
extend `registerJarIpc` (src/main/jar-ipc.js) to also register internal-origin-gated
variants — `internal-jars-list`, `internal-jars-add`, `internal-jars-rename`,
`internal-jars-remove`, `internal-jars-set-default`, `internal-jars-get-default` —
via the `registerInternalHandler` pattern (src/main/internal-ipc.js:registerInternalHandler,
cf. `internal-settings-set`). Each shares the exact handler body with its chrome twin
(same arg/return shapes as jar-ipc.js:61-128, including the delete composition
wipe→reroll→revoke→broadcasts).
- Rationale: fulfills Flight 1 DD7's explicit deferral ("Flight 3's management page
  runs in the internal session and will reach mutations through the origin-checked
  `registerInternalHandler` pattern — added there, not here"). Keeps main.js thin —
  the registration lives in jar-ipc.js next to its twins, deps-injected and
  unit-testable like the existing 22 jar-ipc tests.
- Trade-off: six near-duplicate registrations. Accepted — the two trust domains stay
  independently legible and independently revocable; sharing one handler body avoids
  logic drift.
- The existing chrome-trusted channels are NOT touched (the picker still uses them).
  `registerInternalHandler` is self-contained — it bakes `isTrustedInternalSender`
  internally and is Electron-free (internal-ipc.js:67) — so jar-ipc.js requires
  `./internal-ipc` directly (like its existing `../shared/burner` require) and
  reuses its already-injected `ipcMain`; no deps-object change. *(Corrected at
  design review cycle 1.)*

**DD2 — Live updates: subscribe, don't re-plumb**: `jars-changed` already fans out to
every internal-session webContents — `registerJarIpc` is injected with
`broadcastToChromeAndInternal` (main.js:2367; jar-ipc.js:50-52 payload
`{ containers, defaultId }`, `defaultId` null ⇔ Burner). The page needs only a
preload subscription: add `onJarsChanged`/`offJarsChanged` to internal-preload.js
using its established numeric-handle `on()/off()` map (internal-preload.js:34-61),
with `pagehide` cleanup like settings.js:138-142.
- Rationale: zero main-side broadcast changes; the settings/downloads push pattern
  verbatim.
- Freshness contract: source of truth is the jars store; rebuild trigger is the
  `jars-changed` invalidation event after every successful mutation (jar-ipc.js
  broadcasts unconditionally post-mutation, including the picker's
  `new-container-create`); boot state via one-shot `internal-jars-list` +
  `internal-jars-get-default` on page load. Max staleness: one IPC hop. Every
  user action that mutates jars (page, picker quick-create, automation) emits the
  same event — no polling, no stale path.

**DD3 — Page scaffold follows downloads.js, logic lives in a pure shared module**:
`src/renderer/pages/jars.html` + `jars.css` + `jars.js` (single IIFE,
`createElement`+`textContent` only — no innerHTML, CSP has no `unsafe-inline`);
registration edits: `INTERNAL_PAGES.jars` (main.js:89 map: `/`, `/jars.css`,
`/jars.js`), `INTERNAL_ORIGINS` in BOTH copies (internal-ipc.js:24 and
internal-preload.js:23 — they must stay in sync), and the `INTERNAL_HOSTS` backing
`isInternalPageUrl` (src/shared/url-safety.js). List/row view-model logic lives in a
new pure dual-export module `src/shared/jar-page-model.js` (rows for persistent jars
with `isDefault`/editability + the static Burner row; truth-table unit-tested like
container-menu.js / default-routing.js). Own dark palette CSS custom properties
mirroring downloads.css values; page `<title>` "Cookie Jars — Goldfinch" drives the
tab title. Sub-views (if any) use hash fragments only — `isInternalPageUrl` is
root-only and `will-navigate` blocks sub-paths (url-safety.js:116-120). While in
this code: generalize the trusted-branch synthetic jar's hardcoded name
(`renderer.js:736` labels EVERY internal tab "Settings") to derive from the URL host
— a one-line pre-existing nit this flight would otherwise triple (design-review
cycle 1 suggestion, adopted; the `id: 'internal'` + internal-partition pairing is
untouched — that pairing is the documented data-loss guard).
- Rationale: every convention is an existing-page pattern; the pure-module split is
  the mission's proven testability seam (seven exemplars to date).

**DD4 — Curated palette**: a fixed frozen array of ~12 hex swatches in
`jar-page-model.js` (each verified by `isSafeColor` in a unit test), rendered as a
swatch grid in create and recolor flows. No free-color input this flight. The store
still clamps via `isSafeColor`→`FALLBACK_COLOR` (jars.js:80, `cleanColor`) — defense in depth, the
page palette is UX not enforcement.
- Rationale: operator ruling; injection-safe by construction; consistent dots.
- Trade-off: no arbitrary colors — acceptable, extensible later (mission's
  extensibility stance).

**DD5 — Rename is cosmetic and presented as such; delete confirms in-page**:
rename/recolor call `internal-jars-rename` (`rename` carries the `{name, color}`
patch — there is no separate recolor API; id/partition immutable per Flight 1 DD5,
not surfaced on the page). Delete uses an in-page two-step confirm (row enters a
confirm state naming the consequences: "wipes cookies, site storage, and cache;
closes its open tabs"; explicit Confirm/Cancel) — no native dialog, CSP-safe,
keyboard-reachable. The default-flag holder's delete follows store semantics (flag
repairs to another jar, or Burner when last — jars.js:repairDefaultId); Burner's row
renders no edit/delete/set-default controls (mission invariant).
- Rationale: mission requires "explicit confirmation"; in-page confirm matches the
  no-native-chrome feel of the other special pages.

**DD6 — Tabs-close-on-delete lives in the renderer's `jars-changed` orphan branch**:
`refreshOpenTabJars` (renderer.js:140-151) already detects removed-jar tabs — the
`if (!fresh) continue` branch (renderer.js:143-144, with the Flight 2 comment marking
this exact spot as Flight 3/5 scope) becomes "close this tab" via the existing
tab-close path. Internal tabs are untouched (`jar.id === 'internal'` never matches a
store id — but guard explicitly). Reentrancy ruling (design review cycle 1): the
sweep iterates a SNAPSHOT (`[...tabs.values()]`) — `closeTab` (renderer.js:816-832)
mutates the same `tabs` Map and its last-tab fallback calls `createTab`
(renderer.js:830), whose insertion a live Map iterator would revisit. *(Amended at
Leg 3 design review — ordered-sweep ruling, recorded in the flight log:* `closeTab`
*is NOT modified; instead the sweep pre-activates a survivor when the active tab is
an orphan, closes non-active orphans first and the active orphan last — no
intermediate activations fire, and* `closeTab`*'s own last-tab branch provides the
exactly-once fallback, a review-traced convergence. The earlier "run the fallback
once after the sweep, suppressing the per-call fallback" phrasing assumed a
suppression hook that doesn't exist; ordering achieves the same deterministic,
flicker-free outcome without touching* `closeTab`*.)* Deterministic and documented
rather than riding on Map-iteration order.
- Rationale: the renderer owns tab lifecycle (`tabs` map, tab strip); main only knows
  wcIds. Riding the broadcast makes closure uniform across every mutation source —
  page, picker, automation, future surfaces.
- Trade-off: closure is broadcast-driven (an unsubscribed/hung renderer wouldn't
  close tabs) — acceptable: the renderer is the only tab owner, and if it's gone
  there are no tabs.

**DD7 — Popup inheritance: forward the opener's partition, decide renderer-side**:
main's `setWindowOpenHandler` (main.js:1042-1045) currently forwards only the URL.
Fix: the per-view partition tracking ALREADY EXISTS — `tabViews.set(wcId, { view,
partition, trusted, ... })` at main.js:1974, cleaned up on `tab-close` (no staleness
risk); `setWindowOpenHandler` reads `tabViews.get(contents.id)?.partition` and
`open-tab` sends `{ url, openerPartition }`. *(Scoped down at design review cycle 1
— no new state needed.)*
chrome-preload.js:114 forwards the payload object; the renderer's `onOpenTab`
subscriber (renderer.js:2367) resolves it with the SAME truth table as context-menu
opens — `inheritContainerDecision` (src/shared/inherit-container.js): persistent-jar
partition → matching container from `containers`; burner-pattern partition → FRESH
burner (never-share-state invariant); unknown/internal/missing → default routing.
- Rationale: completes the operator's Flight 2 HAT inheritance stance; partition is
  the one opener fact main reliably holds (Electron has no session→partition reverse
  API — creation-time tracking is the only sound source).
- Trade-off: a payload-shape change on `open-tab` — single subscriber, updated in the
  same leg; leg design greps for any other `open-tab` senders/listeners.

**DD8 — Generalized guest-focus accelerator forwarder**: replace the per-key one-off
forwards in the guest `before-input-event` blocks (web: main.js:1064-1136; internal:
main.js:1171-1174) with one classifier-driven forwarder beside
`handleGuestNewTab`/`handleGuestCrossViewNav`: classify the keystroke with the
existing pure modules (src/shared/keydown-action.js `keydownToAction` /
src/shared/sheet-accelerator.js enumerations), and forward any chrome-class action as
a single `chrome-shortcut-action` send (the channel the renderer already dispatches —
chrome-preload.js:147). Explicit per-guest-kind action allowlists: web guests get the
full chrome-class set (closes the Ctrl+W/sibling gap); internal guests get a
deliberate, enumerated subset (today: cross-view nav + new-tab; leg design decides
each addition explicitly — e.g. Ctrl+W closing an internal tab is desirable,
guest-native keys are not forwarded). Main-side-handled keys (zoom, print, devtools,
find, downloads) keep their existing branches — the forwarder covers chrome-class
actions only.
- Rationale: operator ruling; second occurrence of the hand-rolled-forwarder pattern
  was already flagged at Flight 2's debrief ("before more `handleGuest*` functions
  accumulate"); parity goal — an accelerator that works under chrome focus works
  identically under guest focus.
- Trade-off: keyboard plumbing risk concentrated in one leg with a HAT step
  re-verifying Ctrl+T (the one previously-fixed key) plus the newly forwarded set.

**DD9 — Verification split: HAT owns page-UI, chrome-apparatus behavior tests own
store-visible semantics; internal-page automation stays closed this flight**:
the MCP apparatus can neither act on nor observe internal-page DOM. Precisely: the
admin engine CAN see internal tabs in `enumerateTabs` (`allowInternal: true` —
src/main/automation/mcp-server.js:351; src/main/automation/tabs.js:47), but every
DOM-reaching op refuses internal targets via op-local `isInternalContents` guards
that apply even to admin (src/main/automation/observe.js — `evaluate` :344,
`injectScript` :395, `openDevTools` :439, `closeDevTools` :467; deliberate security
posture). *(Citation corrected at design review cycle 1 — the operative guards are
observe.js's per-op checks, not the resolver's non-admin exclusion; Flight 5
inherits this question and must reason from the right mechanism.)* That posture is
NOT relaxed this flight. Therefore:
- **Machine gates (behavior tests, apparatus = goldfinch MCP + chrome-target
  evaluate, both proven in Flight 2's 7/7 run)**: `jar-delete-closes-tabs` (delete
  with open tabs → tabs close; last-jar delete → zero-tab fallback; drafted at
  design time) and `popup-jar-inheritance` (window.open from persistent-jar and
  burner tabs; drafted at design time). Act path: `openTab`, chrome-target
  `evaluate` of `window.goldfinch.jars*`, in-tab `evaluate` of `window.open`
  (admin key). Read path: `enumerateTabs` per-tab `jarId` + chrome-eval
  `jarsList()`/`jarsGetDefault()`. Also extend `new-tab-default-routing.md` per its
  first run's Validator notes (explicit read actions in step 5; post-add
  `jarsGetDefault` assertion + second-jar-no-claim step).
- **HAT (operator-witnessed)**: page look-and-feel and every page-driven flow
  (create/rename/recolor/set-default/delete-with-confirm, live propagation
  page↔chrome both directions), accelerator parity, popup inheritance from a real
  click.
- Opening an internal-page automation target (so Flight 5's cross-surface behavior
  tests can drive the page directly) is recorded as an open question FOR Flight 5,
  which owns the mission's behavior-test sweep of the page criteria.
- Rationale: both apparatus axes audited (act + observe) — the page's DOM has
  neither, and widening the automation trust boundary is a security decision that
  deserves its own design pass, not a mid-flight scramble.

**DD10 — Docs ride the verify leg, including the overdue pattern note**: CLAUDE.md
gains (a) the jars page in the special-pages/docs sections it keeps, and (b) the
architecture note two flights overdue (F1 rec 4, F2 rec 3): the Electron-free
injected-deps + dual-export pure-module patterns (now 7+ exemplars), the two
real-boot defect classes (mkdirSync-before-synchronous-persist; classic-`<script>`
shared-scope collision), and the grep-AC exemption convention. README/docs sweep for
any surface the page changes (docs/mcp-automation.md is unaffected — automation
still refuses internal targets).

### Prerequisites

- [x] Flights 1-2 landed, merged to main (`51e1ea6`), suite 1154/1154 green.
- [x] Jar store + IPC complete: lifecycle API (jars.js), delete composition
      wipe→reroll→revoke (jar-ipc.js:101-128), `jars-changed` already broadcast to
      internal sessions (main.js:2367).
- [x] Internal-page pattern proven twice (settings, downloads): allowlist resolver,
      origin-gated IPC, preload handle-map, session marker, chrome exclusions.
- [ ] `jars-rename` / `jars-set-default` are model-and-handler-proven but have never
      been exercised by a live renderer (F1 debrief) — this flight is their first
      real consumer; do not assume the contract is live-proven until CP2.
- [x] Behavior-test apparatus proven end-to-end in Flight 2 (dev:automation launch
      recipe, admin key, free-port discovery, scratch-profile isolation, curl
      JSON-RPC driving). No new network services introduced — no port conflicts.
- [x] No schema/migration implications (no store shape change; v2 envelope
      untouched).

### Pre-Flight Checklist

- [x] All open questions resolved
- [x] Design decisions documented
- [x] Prerequisites verified (one deliberate carry-flag: rename/set-default
      renderer-proof lands at CP2)
- [x] Validation approach defined
- [x] Legs defined

---

## In-Flight

### Technical Approach

Two workstreams sharing one flight because they share the jar-confinement outcome and
the guest-wiring surface in main.js.

**Workstream A — the page (legs 1-3)**: Leg 1 opens the internal bridge and scaffold:
allowlist registrations (INTERNAL_PAGES, both INTERNAL_ORIGINS copies,
INTERNAL_HOSTS), `internal-jars-*` channels in jar-ipc.js via
`registerInternalHandler`, preload wrappers + `onJarsChanged`/`offJarsChanged`
handle pair, and a read-only live-updating page (list + default marker + static
Burner row) built on the pure `jar-page-model.js`. Leg 2 adds the interactions:
create with curated palette, rename/recolor, set-default, delete with in-page
confirmation. Leg 3 integrates chrome: kebab "Cookie jars" item + picker
"Manage jars…" row (both `createTab('goldfinch://jars', null, {trusted:true})`,
mirroring `openDownloads`; the picker row follows the existing sentinel precedent —
`container-menu.js:57`'s `action:new-container` item, id-prefix-dispatched — as a
new `action:manage-jars` sentinel), and tabs-close-on-delete in the
`refreshOpenTabJars` orphan branch (snapshot sweep + post-sweep zero-tab fallback,
per DD6).

**Workstream B — jar-confinement chrome fixes (leg 4)**: popup inheritance (DD7:
creation-time partition tracking in main, `open-tab` payload `{url,
openerPartition}`, renderer decides via `inheritContainerDecision`) and the
generalized accelerator forwarder (DD8: classifier-driven, per-guest-kind
allowlists, replaces the Ctrl+T one-off).

Then the standing verification pattern: leg 5 real-boot matrix + behavior tests +
docs (DD10); leg 6 interactive HAT.

Testing: every new pure module (jar-page-model, forwarder classification if new
logic, partition→jar resolution) gets truth-table unit tests; jar-ipc's internal
variants get predicate-matrix tests beside the existing 22 (internal-ipc.test.js
pattern); the vm shared-scope net (chrome-shared-scripts.test.js) automatically
covers any new chrome-renderer `<script>` — the page's own scripts load in a
separate document and follow the same no-top-level-const-collision discipline.

### Checkpoints

- [x] CP1 — Bridge + scaffold: `goldfinch://jars` serves under the internal CSP,
      lists jars live (mutations from the picker/automation appear without reload),
      Burner row static, origin-gating predicate-tested. Suite green.
- [x] CP2 — Page CRUD: create/rename/recolor/set-default/delete all work from the
      page and propagate live to open-tab dots and the picker; `jars-rename` /
      `jars-set-default` now renderer-proven. Suite green.
- [x] CP3 — Chrome integration: both entry points open the page; deleting a jar
      closes its open tabs (incl. zero-tab fallback); popups inherit the opener's
      jar; generalized forwarder passes the accelerator parity check. Suite green.
- [x] CP4 — Verification: `jar-delete-closes-tabs` and `popup-jar-inheritance` pass;
      `new-tab-default-routing` extended and re-passing; real-boot matrix clean;
      docs + CLAUDE.md pattern note landed.
- [ ] CP5 — HAT sign-off; flight `landed`.

### Adaptation Criteria

**Divert if**:
- Page acceptance turns out to REQUIRE driving internal-page DOM by machine
  (i.e. HAT + store-visible behavior tests are judged insufficient) — widening the
  automation trust boundary to internal pages is a security design pass, not an
  inline fix (DD9).
- The `open-tab` payload change surfaces additional senders/consumers beyond the
  three cited sites (DD7's grep comes back non-trivial).

**Acceptable variations**:
- Palette composition/size (any isSafeColor-clean set).
- Confirm-UX shape (inline row vs panel) as long as it's explicit, in-page, and
  names the consequences.
- The internal-guest forwarder allowlist's exact membership (each inclusion decided
  explicitly at leg design).
- Kebab item label / picker row label wording.

### Legs

> **Note:** These are tentative suggestions, not commitments. Legs are planned and
> created one at a time as the flight progresses. This list will evolve based on
> discoveries during implementation.

- [x] `page-bridge-and-scaffold` - Allowlist registrations, `internal-jars-*`
      channels, preload wrappers + jars-changed subscription, read-only live page on
      the pure row-model module (CP1)
- [x] `page-crud-interactions` - Create (curated palette), rename/recolor,
      set-default, delete with in-page confirmation, static Burner row (CP2)
- [x] `chrome-entry-and-delete-integration` - Kebab item + picker "Manage jars…"
      row; tabs-close-on-delete in the orphan branch + zero-tab fallback (CP3)
- [x] `popup-inheritance-and-forwarder` - DD7 popup jar inheritance + DD8
      generalized guest accelerator forwarder (CP3)
- [ ] `verify-integration` - Real-boot matrix; run `jar-delete-closes-tabs` +
      `popup-jar-inheritance`; extend + re-run `new-tab-default-routing`; docs +
      CLAUDE.md pattern note (CP4)
- [ ] `hat-jar-management` - Guided HAT: page look-and-feel + full CRUD on the real
      profile (reversible), destructive delete demo on scratch, accelerator parity,
      popup inheritance from a real click, `.v1.bak` housekeeping (CP5)

---

## Post-Flight

### Completion Checklist

- [ ] All legs completed
- [ ] Code merged
- [ ] Tests passing
- [ ] Documentation updated

### Verification

- Behavior tests: `jar-delete-closes-tabs` (new, drafted at design time),
  `popup-jar-inheritance` (new, drafted at design time), `new-tab-default-routing`
  (extended per its first run's Validator notes) — all pass via `/behavior-test`.
- `npm test` / typecheck / lint green at every checkpoint; no unit-test count
  regression.
- Real-boot matrix (verify-integration leg): fresh scratch, migrated profile, page
  reachable from both entry points, live propagation both directions.
- HAT sign-off (CP5) covers everything machine apparatus cannot observe (page DOM,
  look-and-feel, keyboard parity, real-click popups).
