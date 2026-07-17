# Leg: automation-window-semantics

**Status**: completed
**Flight**: [Multi-Window Shell, Part 2](../flight.md)

## Objective

Land the automation surface's deliberate multi-window semantics: an all-windows `enumerateTabs` whose every row carries a registry-stamped `windowId` (DD1), the new admin-only `enumerateWindows()` discovery primitive that retires the probe walk and carries the `booted` completeness signal (DD2), an optional `windowId` discriminator on `getChromeTarget`/`captureWindow` (DD3), identity-bound window capture via `getMediaSourceId()` against an extracted pure picker (DD4), and a schema-shape pin that makes DD3's param drift loud (DD9) — plus the doc rewrite `docs/mcp-automation.md:359-390` is F7's to replace, and the `a11y-audit.mjs` `findSheetWcId` re-point onto `enumerateWindows`.

## Context

### The decisions this leg executes

- **DD1** — `enumerateTabs` spans ALL windows; every row carries `windowId`; the **registry is the ownership authority**, the renderer authoritative only for `url`/`title`/`jarId`. The return stays a **plain array**.
- **DD2** — `enumerateWindows()`: one new admin-only op, the flight's single discovery primitive. **Zero new state.**
- **DD3** — `getChromeTarget({windowId?})` / `captureWindow({windowId?})`; omitted = last-focused.
- **DD4** — `captureWindow` binds by window IDENTITY via `win.getMediaSourceId()`; the best-size-match scoring is **deleted**; no fallback branch.
- **DD9** — extend `automation-mcp-tools.test.js`'s schema pin to the observe/chrome tools' `inputSchema`; `EXPECTED_TOOL_COUNT` 29 → 30.

Nothing else. **Do not** touch DD5's overlay wiring (leg 1, landed), **do not** touch DD6/DD7's activate/timeout paths (leg 2, landed), **do not** rewrite behavior specs (leg 4 — this leg edits **no** file under `tests/behavior/`).

### READ THE WORKING TREE, NOT `HEAD`

Legs 1 and 2 are **landed and UNCOMMITTED**. `HEAD` (`b607411`) is the flight spec only. `git stash`, `git checkout -- .`, or diffing `b607411` for *content* silently reverts both legs. **Every `file:line` in the flight spec, the recon, and this leg's brief is PRE-leg-1/2 and was re-derived here** — see the **Citation Audit**. Legs 1–2 moved main.js 3461 → 3392 → **3469** and rewrote the automation ops.

The precedent that makes this non-cosmetic: the flight cited `getChromeForTab` at `window-registry.js:156-159`; it is at **`:170-173`**, and `:156-162` is now **`getWindowForGuest`** — a different-but-plausible function that **would type-check at the call site**.

### What legs 1 and 2 changed underneath this leg

- **Leg 1** extracted `src/main/find-overlay-manager.js` (365 lines) and instantiated both overlay managers per window into `record.findOverlay` / `record.sheet` (`main.js:1141-1142`), which is exactly what makes DD2's `sheetWcId`/`sheetVisible`/`findWcId`/`findVisible` derivable. Both managers expose `isVisible()` and `getView()` (`menu-overlay-manager.js:332`/`:343`-adjacent; `find-overlay-manager.js:357`/`:359`) — DD2 needs **only these two**, and `grabWindow` already reads both (`main.js:725`, `:750`).
- **Leg 2** deleted `readDom`'s and `evaluate`'s activate branches, added `executeInChrome` to `deps()` (`engine.js:91-94`) — **which this leg reuses as DD1's N-round-trip seam** — and bounded all five `capturePage` awaits.

### Three premises in this leg's brief that are FALSE against the working tree

Recorded rather than silently corrected — this flight's standing pattern is *a total or a claim asserted in prose instead of read off the tool*.

1. **"`a11y-audit.mjs`'s fallback … activates background tabs" is FALSE.** Leg 2's AC5 removed `activate()` from `evaluate` on **every** target, and `CLAUDE.md:388` already records it: *"Since M09 F7 (DD6) that skip is an optimization, not a safety requirement … the walk's old foreground-first hazard … is gone."* The re-point is still owed, on the honest ground: `enumerateWindows` makes discovery **O(1) and exact** instead of an O(64) guess, and the `enumerateTabs`-failure branch (`a11y-audit.mjs:217-219`) still walks **unfiltered**.
2. **"the inert `attachment`/`crossWindow` machinery" conflates a live record with a dead branch.** `main.js:527` still passes an attachment: `rec.sheet.openMenu(payload, { contentView: rec.win.contentView, win: rec.win, bounds })`. `attachedContentView()` (`menu-overlay-manager.js:121-123`), `attachment.win` (`:258`, `:300`), and `nextAtt.bounds` (`:268`) are read on **every menu open**. `attachment` is **live and operative**. Only **`crossWindow`** (`:248`) is structurally unreachable. See **"The `getAttachedWindow` retirement — RULED"**.
3. **DD3's "both return shapes gain `windowId`" is not implementable for `captureWindow`** as written. See **"Design tension — flagged for the FD"**.

### The `getAttachedWindow` retirement — RULED (this leg's explicit decision)

The FD ruled: *"the nine DD7 tests at `menu-overlay-manager.test.js:680-773` still pass while exercising machinery `main.js` no longer drives … Retire them alongside `getAttachedWindow` at leg 3."*

**The premise is wrong for eight of the nine, and enumeration (not prose) shows it.** main.js drives the attachment machinery on every menu open (`main.js:527`). Enumerated against the working tree, test by test:

| Test | Machinery it exercises | Reached by main.js? |
|---|---|---|
| `:680` openMenu records the attachment | `attachedContentView()` `:121-123` | **YES** — live |
| `:689` hide removes from the RECORDED attachment | `:219` | **YES** — live |
| `:699` re-raise show() uses the recorded attachment | `:203` (`main.js:2848` `owner.sheet.show()`) | **YES** — live |
| `:709` ch-7/escape/activated deliver the ATTACHMENT window | `attachment.win` `:258`, `:300` | **YES** — live |
| `:720` **cross-window model-replace** | `crossWindow` `:248`, detach `:262-265` | **NO — structurally unreachable** |
| `:744` SAME-window model-replace does not detach/re-hide | the `!crossWindow` path | **YES** — but it became the **only** case (**vacuous**, the leg-2 class) |
| `:753` attachment bounds seed the show geometry | `nextAtt.bounds` `:268` | **YES** — live |
| `:763` teardown removes from the recorded attachment | `:299-301` | **YES** — live |
| `:773` attachment-less opens keep a null attached window | the `att`-omitted defensive fallback `:243-245` | defensive only |

**Exactly ONE of the nine (`:720`) is over unreachable code; a second (`:744`) went vacuous.** Not nine. *(The eighth instance of this flight's count/enumeration-error pattern — and this time it is the FD's own ruling. Same shape as the other seven: a total asserted in prose instead of an enumeration read off the tool.)*

**RULING: DEFER the whole retirement to the M09 post-mission maintenance flight — named owner, sized, with its premise named. Do NOT retire it in this leg.** Four grounds:

1. **The urgency evaporates with the corrected enumeration.** It is 1 test + 1 branch + 1 unread accessor, not "nine tests and the attachment machinery."
2. **`getAttachedWindow()` alone is not worth re-opening leg 1's pin.** Grep-proven: **1 definition** (`menu-overlay-manager.js:343`) + **5 test-only reads** (`menu-overlay-manager.test.js:686`, `:696`, `:734`, `:770`, `:776`), **zero production readers**. DD2 *does* discharge its stated blocker — the flight said retirement waits *"once DD2 settles the sheet's public read surface"*, and DD2 settles it as `getView()` + `isVisible()`, **not** `getAttachedWindow()`. But the record it accesses **stays** (it is live), so deleting only its accessor is cosmetic, and it costs re-opening AC14's byte-unchanged pin — the premise the just-landed invariant triple (`menu-overlay` 6/6, `find-overlay-geometry` 8/8, `menu-dismissal` 9/9) rests on.
3. **Deleting `crossWindow` rests on an unproven Electron premise with a SILENT failure mode.** It is unreachable **iff** `win.contentView` is identity-stable across accesses (`electron.d.ts:3638` declares `contentView: View` as a *property*, which supports it but does not prove the getter returns a stored object). If it is not, `crossWindow` fires on every same-window model-replace today, and deleting the branch removes a real `removeChildView`/`visible = false` — observable only as a flicker. **An unverified premise whose failure is silent is precisely the shape this flight has paid for seven times.** No in-repo test proves it: `:744` uses a fake contentView.
4. **It is off this leg's risk axis.** This leg is HIGH-risk on a **shared external interface** (DD1/DD2/DD3/DD4/DD9 + docs + the a11y checkpoint). The overlay module is leg 1's axis, and its live coverage lands at **leg 4** (the FD ruled the cross-window blur class *"must become an explicit AC at the first F7 leg that has two windows live (leg 4's `multi-window-automation`)"*). The leg skill's split criterion applies verbatim: *a risky step bundled with routine work that doesn't depend on it.*

**Deferred ticket, stated so maintenance need not re-derive it** (AC16 records it in the flight log):
- Delete `getAttachedWindow` (`menu-overlay-manager.js:343`) — 0 production readers; re-point the 5 test reads onto contentView identity, or delete `:773` (whose sole assertion it is).
- Delete the `crossWindow` branch (`:248`, `:262-265`, and `|| crossWindow` at `:275`) — **first verify `win.contentView` identity stability against live Electron**, not against a fake.
- Delete test `:720`; re-word `:744` (it is now the general case, not the same-window special case).
- **KEEP `attachment`** — it is live (`main.js:527` → `:121-123`/`:258`/`:268`/`:300`).
- **F8 checkpoint**: F8 lands cross-window drag. Confirm F8 does not resurrect a legitimate cross-window model-replace before deleting `crossWindow`. *(Consistent with DD1's own recorded F8 constraint.)*

### Design tension — FLAGGED FOR THE FD (DD3 vs. the image contract)

**DD3 says "Both return shapes gain `windowId`." That is free for `getChromeTarget` and NOT IMPLEMENTABLE for `captureWindow`.**

`captureWindow`'s engine op returns a **bare base64 PNG string** (`observe.js:236-241`), consumed **positionally** by `imageResult(b64)` (`mcp-tools.js:87-89`) via `shape: imageResult` (`:416`), and pinned by test: `automation-mcp-tools.test.js:591-599` — *"captureWindow success → MCP image content with the base64 verbatim"*, with `returns: { captureWindow: B64 }` (a raw string).

Returning `{ b64, windowId }` yields `data: { b64: … }` → a **malformed image with no error**. That is the **exact failure mode DD1's pass-2 HIGH deleted the `incomplete` marker to avoid, one DD over** — a wrapper breaking a facade that consumes the return positionally. Emitting a second content block instead breaks DD3's own stated rationale (*"all … 26 `captureWindow` specs keep passing unmodified"*).

**Ruled for this leg, mirroring DD1's own resolution verbatim** (*"DD2's `booted` already carries the signal at the admin tier where topology belongs"*):

- `captureWindow({windowId})` **accepts** the discriminator — the load-bearing half, and what DD4's identity binding consumes.
- Its **MCP wire shape is UNCHANGED** (bare image content). `windowId` is read via **`enumerateWindows()`** — the admin discovery op where topology belongs. The caller already knows which `windowId` it passed; when omitted, `enumerateWindows().find(w => w.lastFocused).windowId` answers "which one did I get".
- **`getChromeTarget`'s return DOES gain `windowId`** — a JSON-text op, nothing consumes it positionally.

**If the FD overrules**, AC6 + AC10 are the blast radius, and `mcp-tools.js:416`'s shaper + `automation-mcp-tools.test.js:591` are where it lands.

#### The fix NOT taken — a `structuredContent` sidecar (recorded so it is not reinvented as a clever fix)

A third option exists and is **rejected deliberately, not from ignorance**: return `windowId` **alongside** `content` on the tool-call result, leaving `content` untouched. The design review raised it as `{content, windowId}` and flagged the SDK envelope as *unclear whether extra top-level fields survive*. **It is not unclear, and the SDK has a first-class affordance for exactly this** — so record the real reason.

`@modelcontextprotocol/sdk`'s `CallToolResultSchema` (`node_modules/@modelcontextprotocol/sdk/dist/esm/types.js:1289-1303`) already carries **`structuredContent`**: *"An object containing structured tool output. If the Tool defines an `outputSchema`, this field MUST be present in the result, and contain a JSON object that matches the schema."* The reviewer is also right that `automation-mcp-tools.test.js:591-599` asserts only `result.content`, so a sidecar would not break that pin.

**Rejected on four grounds, none of them "it might not survive":**

1. **It is circular with DD9.** `structuredContent` is only protocol-meaningful when the tool declares an **`outputSchema`** — a brand-new tool-declaration surface, landing in the same leg as the pin (DD9) whose entire purpose is to stop tool-declaration surfaces from drifting silently.
2. **It breaks the discovery contract this leg is pinning.** `listTools` projects exactly `{name, description, inputSchema}` (`mcp-tools.js:608`), pinned by `automation-mcp-tools.test.js:81-90` (`assert.deepEqual(Object.keys(t).sort(), ['description','inputSchema','name'])`). An `outputSchema` must be projected for a client to act on it — widening the discovery surface for one scalar.
3. **It is heaviest exactly where it is wanted.** `captureWindow` is the **image** op; declaring an `outputSchema` obliges `structuredContent` to be present and matching on **every** call, mixing a structured envelope into the one op whose payload is binary.
4. **It contradicts DD1's own doctrine — the doctrine DD3's correction is derived from.** *"DD2's `booted` already carries the signal at the admin tier where topology belongs."* A sidecar smuggles topology back onto every capture return instead of leaving it at the discovery op. **Adding a field to a return type is precisely the move that produced the `incomplete` marker AND this DD3 defect; a third instance in the same flight should be argued for, not reached for.**

**If the FD wants it anyway**, `outputSchema` + `structuredContent` is the correct mechanism (**not** an ad-hoc top-level field), and `mcp-tools.js:608` + `automation-mcp-tools.test.js:81-90` join AC10's blast radius.

### `multi-window-shell` remains a PLANNED RED

DD1 falsifies its censuses (`:74-75`, `:123`, `:125`, `:127`) as DD5 already falsified its preconditions at leg 1. **Do not run it, do not fix it, do not treat its failure as a regression.** Leg 4 rewrites it once. Record it as a planned red (AC16).

## Inputs

What must be true before this leg runs:

- Branch `flight/7-multi-window-2`. Legs 1 and 2 **landed, UNCOMMITTED**. This flight commits **once** after the flight-end review.
- `src/main/main.js` — **3469** lines (`wc -l`, read off the tool at leg design). `getChromeContents` `:241-244`; `chromeForTab` `:249-252`; `raiseWindowForTab` `:263-268`; `grabWindow` `:630-817`; `createEngine` sites `:831` and `:3336`; `createWindow` `:974`; `registry.create` `:1038`; record slots assigned `:1141-1142`.
- `src/main/window-registry.js` — **210** lines. `records()` `:107-109` (insertion order); `getLastFocused()` `:130-135`; `getChromeForTab` `:170-173`; `getWindowForGuest` `:156-162`; `WindowRecord` typedef `:35-46` (`bootConfigServed` `:41`, `findOverlay` `:43`, `sheet` `:44`); record literal `:73-85` (`bootConfigServed: false` at `:79`). `bootConfigServed` flips true at `main.js:2401`.
- `src/main/automation/engine.js` — **184** lines. Opts bag `:71`; `deps()` `:81-114`; `executeInRenderer` `:83-86`; **`executeInChrome` `:91-94`** (leg 2's seam — DD1 reuses it); `base` `:107`; `enumerateTabs` `:117`; `captureWindow` `:136`; `getChromeTarget` `:146-150`.
- `src/main/automation/tabs.js` — **193** lines. `mapEnumeratedTabs` `:41-53`; `enumerateTabs` `:62-65`; exports `:193`. **Electron-free — keep it that way.**
- `src/main/automation/observe.js` — **502** lines. `captureWindow` `:236-241`. **Electron-free.**
- `src/main/automation/scope.js` — **215** lines. `facade.enumerateTabs` `:148-157` (the jar filter — `tabs.filter(...)` at `:152-155`, by **resolved session**, never `t.jarId`); `facade.captureWindow` `:162-165`; `facade.getChromeTarget` `:181-184` (the `admin-only` template DD2 mirrors); `facade.getDownloadsList` `:190-193` (the cross-jar doctrine).
- `src/main/automation/mcp-tools.js` — **638** lines. `imageResult` `:87-89`; `ToolDef` typedef `:110-117`; `enumerateTabs` def `:119-124`; `captureWindow` def `:411-417`; `CHROME_TOOLS` `:534-548`; `getChromeTarget` def `:535-540`; the `= 29` comment `:577-581`; `TOOLS` `:582`; `listTools` `:608`.
- `src/main/menu-overlay-manager.js` (347) / `src/main/find-overlay-manager.js` (365) — `isVisible()` at `:332` / `:357`; `getView()` at `:343`-adjacent / `:359`. **Both PINNED UNCHANGED** (see the retirement ruling).
- `scripts/a11y-audit.mjs` — **475** lines. `findSheetWcId` `:212-234`; the `enumerateTabs` skip-set `:215-216`; the swallowing `catch` `:217-219`; the 1..64 walk `:220-228`; `fail(...)` `:229-233`; sole call site `:412`.
- `test/unit/automation-mcp-tools.test.js` — the DD9 target. `DRIVE_NAMES` `:23`; `OBSERVE_NAMES` `:29`; count+names `:72-79`; key-shape `:81-90`; **required-fields `:92`**; combinator hygiene `:170`/`:181`/`:188`; **observe schemas `:541-553`** (pins `captureWindow` as **no-input**); **captureWindow image `:591-599`**.
- `test/unit/automation-mcp-server.test.js:26` — `EXPECTED_TOOL_COUNT = 29`.
- `src/renderer/renderer.js:3568-3576` — `listTabs()`, creation order, `wcId: null` until dom-ready.
- `node_modules/electron/electron.d.ts:2809` — `getMediaSourceId(): string`, inside `class BaseWindow` (`:2113`; next class `BrowserWindow` at `:4141`). Electron `^42.6.1` (`package.json:73`). **Verified a third time at this leg's design.**
- Test baseline: **1786/1786 passing, 13 suites** (`npm test`), verified by running it at leg design. `npm run typecheck` clean. `npm run lint` exit 0. `npm run a11y` green.

## Outputs

- **New**: `src/main/window-census.js` — pure, Electron-free `buildWindowCensus(records, lastFocusedId)` → DD2's rows.
- **New**: `test/unit/window-census.test.js` — its unit net.
- **New**: `src/main/capture-source-picker.js` — pure, Electron-free `pickSourceByMediaSourceId(sources, mediaSourceId)` (DD4's extracted picker).
- **New**: `test/unit/capture-source-picker.test.js` — its unit net (**DD4's only rig-provable half**).
- **Modified**: `src/main/automation/tabs.js` — `enumerateTabs` becomes the all-windows census.
- **Modified**: `src/main/automation/engine.js` — `enumerateWindows` op; `getChromeTarget({windowId?})`; `captureWindow({windowId?})`; new opts + deps.
- **Modified**: `src/main/automation/scope.js` — `facade.enumerateWindows` admin-only refusal.
- **Modified**: `src/main/automation/mcp-tools.js` — `enumerateWindows` tool def (+1 → 30); `windowId` on `getChromeTarget`/`captureWindow` schemas; the `= 29` comment.
- **Modified**: `src/main/main.js` — `listWindows` + `enumerateWindows` accessors; `getChromeContents(windowId?)`; `grabWindow(windowId?)`; DD4's identity bind; all three deps injected at **both** engine sites.
- **Modified**: `test/unit/automation-tabs.test.js`, `test/unit/automation-mcp-tools.test.js` (DD9), `test/unit/automation-mcp-server.test.js` (29 → 30).
- **Modified**: `scripts/a11y-audit.mjs` — `findSheetWcId` re-pointed; the walk deleted.
- **Modified**: `docs/mcp-automation.md`, `CLAUDE.md`.
- **Unchanged (pinned)**: `src/main/menu-overlay-manager.js`, `test/unit/menu-overlay-manager.test.js`, `src/main/find-overlay-manager.js`, `src/main/window-registry.js`, `src/main/capture-timeout.js`, `src/main/automation/{observe,input,find,print,resolve,cdp}.js`, **every file under `tests/behavior/`**.

## Acceptance Criteria

### DD1 — the all-windows census

- [x] **AC1** — **`tabs.js:enumerateTabs` assembles from N per-chrome round-trips, and the REGISTRY is the ownership authority.** Exactly this rule, per registered window in **`registry.records()` insertion order**:

  | Registry state | Contribution |
  |---|---|
  | `booted === false` (mid-boot) | **zero rows** — no round-trip attempted |
  | `booted === true` | that chrome's `listTabs()` rows, **filtered to `rec.tabViews.has(wcId)`**, each stamped `windowId` from the **registry** |
  | round-trip throws | zero rows from that window; the census does **not** fail |

  Row order: registry insertion order, then each window's existing `listTabs` **creation order** (`renderer.js:3568-3576` — unchanged, an explicit FD ruling per `CLAUDE.md:404`). The renderer **never learns** `windowId`. `mapEnumeratedTabs` (`tabs.js:41-53`) is applied **per window, unchanged** — its internal-session drop and dom-ready filter still run.

  **`tabs.js` stays Electron-free**: the dep surface carries no raw Electron handle beyond leg 2's `executeInChrome` seam.

- [x] **AC2** — **The return is a PLAIN ARRAY. No `incomplete` marker, no wrapper, no own properties.** Pinned by test: the returned value satisfies `Array.isArray(...)` **and** `Object.keys(result)` contains only indices — a same-run **positive control** asserts the pin can fail (a fixture array carrying an own property is rejected by the same check). This is the DD1 pass-2 HIGH: `scope.js:152-155` does `tabs.filter(...)`, which throws on a wrapper and **silently drops** an own property.

- [x] **AC3** — **The jar facade is untouched and still filters by resolved session.** `src/main/automation/scope.js:148-157` is unchanged apart from AC7's addition; `test/unit/automation-scope.test.js` passes **unmodified**. A jar-tier `enumerateTabs` now sees all windows' tabs **for its own jar** — that is DD1's intent, not a leak (`scope.js:152-155` filters by session identity; the `windowId` stamp rides through).

- [x] **AC4** — **Absent dep → today's single-window behavior** (the house "Absent → no behavior change" idiom, `engine.js:33-41`): with no `listWindows` dep, `enumerateTabs` takes the pre-F7 `executeInRenderer` path and emits **no `windowId`**. This is what lets the existing `automation-tabs.test.js` `enumerateTabs` tests pass **unmodified**. Because the fallback is **silent**, both live injection sites are pinned by AC12.

### DD2 — `enumerateWindows`

- [x] **AC5** — **`enumerateWindows()` returns one row per registered window, in `registry.records()` insertion order**, with exactly these fields:

  | Field | Derived at call time from | Notes |
  |---|---|---|
  | `windowId` | `rec.win.id` | |
  | `chromeWcId` | `rec.chromeView.webContents.id` | |
  | `booted` | `rec.bootConfigServed` (`window-registry.js:41`/`:79`; flipped at `main.js:2401`) | **DD1's completeness discriminator** — without it a mid-boot window is indistinguishable from a booted-empty one (`activeTabWcId: null` in both) |
  | `activeTabWcId` | `rec.activeTabWcId` | |
  | `lastFocused` | `rec.win.id === lastFocusedId` | **Named `lastFocused`, NOT `focused`** — it maps to `getLastFocused()` (`window-registry.js:130-135`), the WSLg-poisoned accessor; `focused` would read as an OS-focus claim this codebase deliberately refuses to make |
  | `sheetWcId?` | `rec.sheet?.getView()?.webContents?.id` | **absent** ⇒ never created (lazy — DD5) |
  | `sheetVisible` | `rec.sheet?.isVisible() ?? false` | separate from the id: a present id conflates "visible" with "instantiated but hidden" |
  | `findWcId?` | `rec.findOverlay?.getView()?.webContents?.id` | absent ⇒ never created |
  | `findVisible` | `rec.findOverlay?.isVisible() ?? false` | |

  **ZERO NEW STATE.** Nothing is cached, no rebuild trigger, nothing to invalidate — every field is read from `registry.records()`, `bootConfigServed`, `activeTabWcId`, and the two managers' `isVisible()`/`getView()` **at call time**. Pinned by test: mutating a fake record between two calls is reflected in the second (no memoization).

  **Null-tolerance is mandatory**: leg 1's AC8b nulls `rec.findOverlay`/`rec.sheet` in the window's `close` handler, so both slots can be `null` on a live record. A destroyed overlay `webContents` must not throw — guard `isDestroyed()`.

- [x] **AC6** — **The row-builder is a PURE module: `src/main/window-census.js` exports `buildWindowCensus(records, lastFocusedId)`.** Electron-free, duck-typed over records exactly as `window-registry.js` is, so it unit-tests offline with fakes. `main.js` is unit-test-exempt (Electron-bound); this is what makes DD2 provable at all, **and** it buys main.js lines back (the accessor becomes ~3 lines) against a target already blown.

  Electron-free, **line-anchored and comment-masked** (see the grep-AC discipline below):
  ```bash
  grep -cE "^\s*[^/]*require\('electron'\)" src/main/window-census.js       # → 0
  grep -cE "^\s*[^/]*require\('electron'\)" src/main/automation/observe.js  # → 0  (CONTROL: the house's canonical Electron-free exemplar)
  grep -cE "^\s*[^/]*require\('electron'\)" src/main/automation/engine.js   # → 1  (CONTROL: a real require — proves the grep reports the POSITIVE case)
  ```
  > This is leg 2's corrected form, verbatim. The naive `grep -c "require('electron')"` returns **1** for `observe.js` — the repo's own Electron-free exemplar — because its header comment names the token. Run **both controls before** the assertion.

- [x] **AC7** — **`enumerateWindows` is admin-only, refused at the scope façade**, mirroring `scope.js:181-184`'s `getChromeTarget` template: `facade.enumerateWindows = () => { requireJar(); throw new Error('automation: admin-only — enumerateWindows (window topology discovery) is restricted to the admin identity'); }`. `requireJar()` **first**, so an unknown jar still errors `no-such-jar` before `admin-only`. `admin-only` stays distinct from `out-of-jar` (`mcp-jar-scoping`/`mcp-auth-gating` pin them). Window topology at the jar tier is a **cross-tenant leak** — the `getDownloadsList` doctrine (`scope.js:186-193`: *"an app-level cross-jar view is an admin capability … new tools must not widen the surface's reach"*).

- [x] **AC8** — **The op count moves 29 → 30 in lockstep, at every site.** `EXPECTED_TOOL_COUNT = 30` (`automation-mcp-server.test.js:26`); `automation-mcp-tools.test.js:72`'s count + name list; `mcp-tools.js:577-581`'s tally comment; `docs/mcp-automation.md:19` and `:394`; `mcp-server.js:358`; `CLAUDE.md:452`. **Enumerated, not counted in prose** — that is seven sites; verify each by reading it.

### DD3 — the window discriminator

- [x] **AC9** — **`getChromeTarget({windowId?})`**: omitted ⇒ **last-focused** (F6's accessor, kept — `registry.getLastFocused()`). Supplied and resolvable ⇒ that window's chrome. Supplied and **unknown** ⇒ throws `/^automation: no-such-window — /` (a named refusal, never a silent fall-back to last-focused — that would be S1's silent-success class restated). The return gains `windowId`: `{ wcId, kind: 'chrome', url, windowId }`.

- [x] **AC10** — **`captureWindow({windowId?})`**: omitted ⇒ last-focused; supplied and unknown ⇒ `/^automation: no-such-window — /`. **The MCP wire shape is UNCHANGED — bare image content.** `automation-mcp-tools.test.js:591-599` (captureWindow → image content, base64 verbatim) passes **unmodified**, which is the control proving the image contract did not move. See **"Design tension — flagged for the FD"** for why the return does **not** gain `windowId`, and `enumerateWindows` is the topology read.

- [x] **AC11** — **Back-compatible by construction.** With one window and no `windowId` passed, `getChromeTarget` and `captureWindow` behave **identically to today**. Pinned by test at the engine tier and by the unmodified `automation-mcp-tools.test.js` image test.

- [x] **AC12** — **All three new deps are injected at BOTH live `createEngine` sites, in parity.** `listWindows`, `enumerateWindows`, and the `windowId`-aware `grabWindow` ride **both** the MCP `getEngine` accessor (`main.js:831`) **and** the dev-seam engine (`main.js:3336`). **Write as ES6 shorthand** — matching `grabWindow,` already in both literals.

  Verify (**line-anchored + syntax-agnostic — accepts shorthand OR `name: value`**; run the control first):
  ```bash
  grep -cE '^\s*grabWindow(,|:)' src/main/main.js        # → 2  (CONTROL — the existing precedent in the same literals)
  grep -cE '^\s*listWindows(,|:)' src/main/main.js       # → 2
  grep -cE '^\s*enumerateWindows(,|:)' src/main/main.js  # → 2
  ```
  The line-anchor excludes definitions (`function listWindows(` ) and every `listWindows(...)` call site (a `(` follows the name, so `(,|:)` cannot match). **Do NOT "simplify" to `grep -c 'listWindows:'`** — that returns **0** on a correct shorthand injection, inverting the AC (leg 2's AC6, design review).

  A forgotten injection silently restores single-window `enumerateTabs` **with no test failure anywhere** (AC4's fallback) — which is exactly why this grep is mandatory.

### DD4 — identity-bound capture

- [x] **AC13** — **The best-size-match scoring is DELETED and replaced by an identity bind.** `main.js:654-662` (the `bestScore` loop) is **gone**: `grep -c 'bestScore' src/main/main.js` → **0** (control: it returns **2** on the current tree — run it **before** the edit and record both). The `desktopCapturer.getSources` call (`:649-653`) keeps its `thumbnailSize` fix and gains no fallback branch: the source is selected by `grabRec.win.getMediaSourceId()` **only**. No match ⇒ fall through to the existing composite path (`:670+`), which is already correctly bound to `grabRec` — **not** a re-introduced heuristic.

- [x] **AC14** — **The picker is a PURE, extracted, unit-tested module.** `src/main/capture-source-picker.js` exports `pickSourceByMediaSourceId(sources, mediaSourceId)` → the matching source or `null`. Electron-free (AC6's three-grep form, controls included). `test/unit/capture-source-picker.test.js` covers: exact match among several; **no match ⇒ null** (never a "closest" fallback — name the test for the contract so a future "be helpful" refactor fails loudly); empty/null sources ⇒ null; a null/absent `mediaSourceId` ⇒ null; sources lacking `id` are skipped.

- [x] **AC15** — **NO AC IN THIS LEG CLAIMS LIVE PROOF OF DD4'S FIX (S2 — load-bearing).** `main.js:642-643` skips the whole `desktopCapturer` branch under Wayland and `dev:automation` selects Wayland — **the buggy branch is DEAD CODE on the dev rig**. Any live step asserting the mis-pick passes **vacuously**. The fix is **unit-scoped (AC14) + HAT/operator-scoped** on a non-Wayland desktop. The flight-log entry must state this rather than let it be inferred, and — per the leg-2 precedent — the HAT item must be **pinned to a non-Wayland desktop or recorded as an accepted permanent gap**, never left as an unqualified ticket that silently cannot run. Mirror of `CLAUDE.md`'s rig-attribution warning: here the rig **hides** the defect.

### DD9 — the schema pin

- [x] **AC16** — **`automation-mcp-tools.test.js`'s schema pin is extended to the observe/chrome tools' `inputSchema`**, so a `windowId` param cannot land while `docs/mcp-automation.md:394` ("All 29 tools below match `mcp-tools.js` exactly") silently lies. The pin covers, **field by field** (not by count): `captureWindow` — `properties.windowId.type === 'integer'`, **no `required`**; `getChromeTarget` — same; `captureScreenshot`/`readDom`/`readAxTree` — unchanged, `wcId` required. **`automation-mcp-tools.test.js:541-553`'s existing "captureWindow no-input" assertion is FALSIFIED by DD3 and must be rewritten, not deleted** — prefer the leg-skill's rename-with-inverted-assertion so `git blame` carries the intent shift.

  **The pin must be proven capable of failing**: a same-run synthetic fixture (an in-test schema object missing `windowId`) is rejected by the same assertion helper. Without that control the pin is an absence confirmed by an instrument never shown able to report presence — the leg-1 false-PASS class.

### The a11y re-point (a flight checkpoint)

- [x] **AC17** — **`a11y-audit.mjs:findSheetWcId` reads `enumerateWindows`; the 1..64 walk is DELETED.** It resolves the sheet via `enumerateWindows()` — preferring a row with `sheetVisible === true`, else any row with a present `sheetWcId` — and keeps its existing `fail(...)` (`:229-233`) when none is found. The `enumerateTabs` skip-set (`:215-216`), its swallowing `catch` (`:217-219`), and the walk (`:220-228`) all go; the now-unused `skipWcIds` param goes with them (sole call site `:412` — `findSheetWcId(client, [wcId])`).

  There is **no fallback**: if `enumerateWindows` fails, `npm run a11y` fails **loudly**. That is the point — a silent fallback to the walk would let DD2 be broken while the checkpoint stayed green.

  Verify (control first):
  ```bash
  grep -cE '^\s*for \(let id = 1; id <= 64' scripts/a11y-audit.mjs   # BEFORE → 1 (CONTROL) ; AFTER → 0
  ```

- [x] **AC18** — **`npm run a11y` is GREEN (exit 0), with all six `sheet:*` states reached.** Mandatory, not skipped — this is the flight checkpoint the re-point puts at risk, and "all six sheet states reached" is what proves the new resolve actually **found** the sheet rather than the audit skipping quietly.

### Docs

- [x] **AC19** — **`docs/mcp-automation.md:359-390` — the whole "Multi-window semantics (interim — M09 Flight 6; F7 redefines)" section — is REPLACED** (not amended) with F7's final contract. It must state, at minimum:
  - `enumerateTabs` is an **all-windows census**; every row carries `windowId`; the **registry** is the ownership authority and the renderer is authoritative only for `url`/`title`/`jarId`; the return is a **plain array**;
  - **the mid-boot adopted-tab disclosure (DD1, verbatim in substance)**: a mid-boot window (`booted === false`) contributes **zero rows**, and **a move-created window's adopted tab is in `rec.tabViews` before its chrome boots, so it is invisible for that interval** — *that is exactly what `booted` exists to disclose*. A caller needing a total census polls `enumerateWindows()` until every `booted` is true. This is honest rather than lossy: an un-booted window's renderer genuinely has no tabs yet;
  - `enumerateWindows()` — admin-only, the single discovery primitive, its full row shape, `lastFocused` (**not** an OS-focus claim), and **absent id ⇒ never created** (lazy);
  - `getChromeTarget({windowId?})` / `captureWindow({windowId?})` — omitted = last-focused; unknown ⇒ `no-such-window`; **`captureWindow`'s image shape is unchanged and `enumerateWindows` is the topology read**;
  - the `captureWindow` mis-pick caveat (`:381-386`) is **retired** — capture now binds by window identity (`getMediaSourceId`);
  - the probe walk is **retired** in favour of `enumerateWindows`.

- [x] **AC20** — **The per-tool rows and the op-count pins are updated.** Enumerated: `docs/mcp-automation.md:403` (`enumerateTabs` — drop "**of the last-focused window**"/"window-scoped since M09 F6"; name `windowId`), `:433` (`captureWindow` — drop "the **last-focused window**" and the two-window caveat; name the `windowId` param), `:494` (`getChromeTarget` — drop the "M09 F6 interim"; name the `windowId` param and the returned `windowId`); a **new row** for `enumerateWindows`; `:19` and `:394` (29 → 30). `CLAUDE.md:452` (29 → 30 + `enumerateWindows` in the tally) and `:404` (the "F7 owns the redefinition" pre-registered revisit — **DD1 lands it; say so**).

- [x] **AC21** — **Two leg-1 doc residuals are swept** (recorded as a residual, not a scope grab — the flight's Completion Checklist names *"CLAUDE.md find-overlay"* and no other leg owns it; both are **actively false** and this leg is already in the file): `CLAUDE.md:29` still describes the find bar as *"a main-owned lazy-singleton view (`overlayView` in `main.js`)"* that *"**ROAMS** across windows with attachment tracking"* with `findOverlayAttachedWin`/`findOverlayTabWcId` — leg 1 extracted all of it to `src/main/find-overlay-manager.js` as **per-window instances**. `CLAUDE.md:169` still says *"the ONE sheet **ROAMS** across windows with attachment tracking … the sheet serves one window at a time — opening a menu in window B closes A's first"* — falsified at leg 1 (two sheets alive simultaneously, AC18 smoke step 3).

### Records and hygiene

- [x] **AC22** — `npm test` green with **≥ 1786** (the leg-2 baseline, verified by running it at leg design). `npm run typecheck` clean. `npm run lint` exit 0.
- [x] **AC23** — **`wc -l src/main/main.js` at landing is RECORDED, and leg 3's delta is recorded SEPARATELY.** Leg-2 landing baseline **3469** — already **8 OVER** the flight's net ≤ 3461 before this leg adds op wiring. **The FD has ruled the target a recorded miss, not a gate.** Do **not** let leg 3 absorb leg 2's overage: record `3469 → N` and **leg 3's delta alone**. AC6's and AC14's pure-module extractions are the flight's named way to buy space back — record what they actually returned, read off `wc -l`, never from memory.
- [x] **AC24** — The flight log carries a leg-3 landing entry (see Post-Completion Checklist).

### The live proof

- [x] **AC25** — **The MCP live smoke passes all four checkpoints** (see Verification Steps → Live smoke). The Developer **cannot** run behavior tests — the Witnessed two-agent protocol is the FD's. The Developer **can** run unit tests, `npm run lint`, `npm run typecheck`, `npm run a11y`, and a live MCP smoke over `npm run dev:automation`, **hand-rolling the client from `scripts/mcp-example-client.mjs`** — *the apparatus is NOT a registered MCP*; the leg-1 log records one Executor falsely blocking on exactly this. Do not repeat it.

## Verification Steps

### Offline

```bash
# AC6/AC14 — Electron-free, line-anchored + comment-masked. RUN THE CONTROLS FIRST.
grep -cE "^\s*[^/]*require\('electron'\)" src/main/automation/observe.js       # → 0  CONTROL (house exemplar)
grep -cE "^\s*[^/]*require\('electron'\)" src/main/automation/engine.js        # → 1  CONTROL (positive case)
grep -cE "^\s*[^/]*require\('electron'\)" src/main/window-census.js            # → 0
grep -cE "^\s*[^/]*require\('electron'\)" src/main/capture-source-picker.js    # → 0

# AC12 — all three deps at BOTH engine sites. CONTROL FIRST.
grep -cE '^\s*grabWindow(,|:)' src/main/main.js         # → 2  CONTROL
grep -cE '^\s*listWindows(,|:)' src/main/main.js        # → 2
grep -cE '^\s*enumerateWindows(,|:)' src/main/main.js   # → 2

# AC13 — the scoring heuristic is gone. RUN BEFORE THE EDIT (→ 2) AND AFTER (→ 0).
grep -c 'bestScore' src/main/main.js                    # BEFORE → 2 (CONTROL) ; AFTER → 0

# AC17 — the walk is gone. RUN BEFORE (→ 1) AND AFTER (→ 0).
grep -cE '^\s*for \(let id = 1; id <= 64' scripts/a11y-audit.mjs   # BEFORE → 1 (CONTROL) ; AFTER → 0

# AC22
npm test && npm run typecheck && npm run lint

# AC18 — the flight checkpoint the re-point puts at risk. MANDATORY.
npm run a11y                                            # → exit 0, all six sheet:* states reached

# AC23
wc -l src/main/main.js                                  # → RECORD the number AND leg 3's delta separately (baseline 3469)
```

> **Grep-AC discipline — this flight has ROOT-CAUSED grep-ACs as a design fault.** Four have failed, **all** passing on wrong code or failing on correct code, because the legs demand *"keep every earned comment"* while the greps count the tokens those comments must cite. The decisive control: `observe.js`, the repo's canonical Electron-free exemplar, **FAILS** `grep -c "require('electron')" → 0`. Every grep above is (a) **line-anchored / syntax-agnostic**, (b) **comment-masked** (the `[^/]*` prefix), and (c) **ships a CONTROL that is RUN**, proving it can report the positive case. Leg 2's AC6 is the only grep-AC in this flight that survived contact — these copy its shape. **If you need a new grep-AC, run it against a candidate correct diff before it ships.** Where a static check needs real rigor, use `broadcast-invariant.test.js`'s `maskComments` toolkit — the house already solved this.

### The unit net (what CAN be tested offline)

`main.js` is **unit-test-exempt** (Electron-bound). The pure parts are not — and AC6/AC14 exist precisely so DD2's and DD4's substance lands in testable modules.

**`test/unit/window-census.test.js`** (DD2 — new):
- one record → one row with every AC5 field; two records → **insertion order** preserved;
- `booted` mirrors `bootConfigServed` **both ways**;
- a record with `sheet: null` / `findOverlay: null` (leg 1's AC8b close-path state) → **no throw**, `sheetVisible`/`findVisible` false, ids **absent**;
- a manager whose `getView()` returns null (never shown — lazy) → id **absent**, not `null`; **pin "absent ⇒ never created"** (DD2's contract) so a future "normalize to null" refactor fails loudly;
- a manager whose view's `webContents.isDestroyed()` is true → id absent, no throw;
- `sheetVisible === true` while `sheetWcId` present, and **`sheetVisible === false` with the id still present** (instantiated-but-hidden) — *the distinction the field exists for; without it leg 4's two-menus variant has no observable*;
- `lastFocused` true for exactly one row; **zero rows true** when `lastFocusedId` matches no record (the membership-validated fallback is the registry's, not the census's — pin that the census does **not** invent one);
- **ZERO NEW STATE**: mutate a fake record between two `buildWindowCensus` calls → the second call reflects it. Name the test for the contract.

**`test/unit/capture-source-picker.test.js`** (DD4 — new): per AC14. **This is DD4's only rig-provable half (S2).**

**`test/unit/automation-tabs.test.js`** (extend, don't rewrite):
- the existing `enumerateTabs` tests pass **unmodified** via AC4's absent-dep fallback — **verify, don't assume**;
- two booted windows → rows from **both**, in insertion order, each stamped with its own `windowId`;
- **a row the renderer reports but the registry does not own (`rec.tabViews.has(wcId)` false) is DROPPED** — the registry-authoritative filter, the heart of DD1;
- a row owned by window **B** but reported by window **A**'s chrome is dropped from A's contribution and appears once, under B — **the anti-double-count pin** (DD1: registry-authoritative ownership makes duplicates *structurally impossible*);
- **`booted === false` ⇒ zero rows AND no round-trip attempted** (assert the fake `executeInChrome` recorded **zero** calls for that window) — an absence with its **positive control in the same test file**: the same window with `booted: true` contributes its rows via the same fake;
- a window whose round-trip **throws** → zero rows from it, the census still returns the other windows' rows;
- **AC2's plain-array pin**, with its own-property positive control;
- `windowId` is stamped from the **registry**, never from the renderer payload: a fake `listTabs` row carrying a bogus `windowId` is **overwritten**.

**`test/unit/automation-mcp-tools.test.js`** (DD9 — AC16) and **`test/unit/automation-mcp-server.test.js`** (`EXPECTED_TOOL_COUNT` 29 → 30).

### AC25 — Live smoke: the four checkpoints (MANDATORY)

Apparatus: `GOLDFINCH_AUTOMATION_ADMIN=1 GOLDFINCH_AUTOMATION_DEV_MINT=1 npm run dev:automation`, admin key **exported via env var only, never a command literal** (leg-2 precedent), hand-rolled client per `scripts/mcp-example-client.mjs`.

| # | Action | Expected |
|---|--------|----------|
| 1 | Launch fresh. `enumerateWindows()`. | **One** row: `booted: true`, `lastFocused: true`, a `chromeWcId`, **`sheetWcId` and `findWcId` ABSENT** (lazy — nothing opened yet), `sheetVisible: false`, `findVisible: false`. ⇒ DD2's "absent ⇒ never created" holds live. |
| 2 | `enumerateTabs()`. Open a second tab **T** with a distinctive page. | Every row carries `windowId` = window 1's id. **`Array.isArray(result)` is true** and the result carries no own properties beyond indices (AC2, live). |
| 3 | **AC25(a) — the mid-boot `booted` observable.** Tab-context-menu on **T** → **Move to new window** (the REAL menu, not a synthesized IPC — leg-2 precedent). **Immediately** poll `enumerateWindows()` + `enumerateTabs()` in a tight loop from the moment the click returns. | At least one poll catches window 2 with **`booted: false`** — and in that same poll `enumerateTabs()` returns **zero rows for window 2**, *even though T is already in window 2's `tabViews`*. Then `booted` flips **true** and T appears with `windowId` = window 2. **This is DD1's mid-boot adopted-tab disclosure, measured.** ⇒ **If the mid-boot window is never caught, say so plainly and DO NOT claim the observable** — the boot may be too fast to sample. The absence is then a **sampling limit, not a proof**; record it as such and fall back to the unit pin (`booted: false` ⇒ zero rows, positive-controlled). *An absence claimed from an instrument that never demonstrated it can report presence is exactly the leg-1 false-PASS class.* |
| 4 | **AC25(b) — the all-windows census.** With T settled in window 2: `enumerateTabs()`. | Rows from **BOTH** windows in one array, each carrying its own `windowId` — window 1's rows first (registry insertion order), then window 2's. ⇒ DD1's headline. **Contrast with pre-F7**, where window 2's tabs were simply absent. |
| 5 | **AC25(c) — two sheets visible at once (the flight's headline observable).** Open the kebab menu in window 1 **and** in window 2, leaving both open. `enumerateWindows()`. | **BOTH** rows report `sheetVisible: true`, with **two distinct `sheetWcId`s**. ⇒ the roaming singleton is retired, read through DD2's own field — **impossible under F6 by design**. *(Leg 1 proved two sheets are alive via a probe count; this is the first read of them as a first-class observable, and it is what leg 4's two-menus variant consumes.)* |
| 6 | **AC25(d) — DD3's `windowId` params.** `getChromeTarget()` → record. `getChromeTarget({windowId: <window 2>})`; `getChromeTarget({windowId: <window 1>})`; `getChromeTarget({windowId: 999999})`. | Omitted ⇒ the **last-focused** chrome (unchanged). Each supplied id ⇒ **that** window's `chromeWcId` (cross-check against step 5's `enumerateWindows`), and the return carries `windowId`. `999999` ⇒ **`automation: no-such-window — …`**, not a silent fall-back to last-focused. |
| 7 | `captureWindow()`; `captureWindow({windowId: <window 2>})`; `captureWindow({windowId: 999999})`. | The first two return **normal image content** (unchanged wire shape — AC10). The third refuses `no-such-window`. **NOTE (S2/AC15): this proves the `windowId` PARAM routes; it proves NOTHING about DD4's mis-pick fix** — the dev rig is Wayland, so `desktopCapturer` is skipped entirely and the identity bind never executes. Do not record it as evidence for DD4. |
| 8 | Regression: `npm run a11y` (AC18); close window 2 via its own close control; `enumerateWindows()`. | a11y green, six sheet states. After the close, **one** row remains, `booted: true` — no stale row, no throw. |

> **Honesty note — state it, do not let it be inferred.** This smoke is a Developer-run, single-pass check, **not** a Witnessed run and **not** a regression net. Step 6's "last-focused" reads inherit leg 2's standing limitation: `getLastFocused()` is **main-side seeded**, so it proves the main-side contract, never the OS compositor (WSLg; F6 spike verdict 4).

### What is left to leg 4's `multi-window-automation` spec

- All four checkpoints re-proven under the **Witnessed** protocol (an independent Validator judging every step);
- the **two-menus-open-simultaneously variant** — the flight's definitive per-window proof, read via DD2's `sheetVisible` (step 5 is the Developer-run stand-in);
- the **DD6 pair** as a pre-registered assertion (activating window B's background tab from window A **raises** window B, while `readDom` on one does **not**);
- the **cross-window blur** deletion from leg 1 — the FD ruled it *"must become an explicit AC at the first F7 leg that has two windows live (leg 4's `multi-window-automation`)"*. **Not this leg**: this leg has two windows but does not touch the blur path;
- **`multi-window-shell`'s FULL rewrite** (DD1 + DD2 + DD5 all falsify it) + its step-8 `ERR_ABORTED` count;
- **re-pointing the 10 probe-walk specs** onto `enumerateWindows` (nine onto `sheetWcId`, `find-overlay-geometry` onto `findWcId` — DD2's find half ships with exactly one caller; glance at `tab-surface-geometry.md:60`'s conditional probe). **This leg re-points `a11y-audit.mjs` ONLY** (AC17) and edits **no** spec file;
- restating the **5 count-precondition specs** against the all-windows census; `kebab-menu.md`'s full-body refresh; re-verifying the audit's dated rows (S7);
- the leg-2 queued errata (`foreground-to-act.md`'s Intent/Out-of-Scope prose; the `menu-dismissal` `document.hasFocus()` erratum; `find-overlay-geometry`'s stale composite caveat) — **inherited, not re-derived**;
- the doc grep-ACs over the **five prose "29" pins** DD9 leaves unguarded.

## Implementation Guidance

> **Read the working tree, not `HEAD`.** Legs 1 and 2 are landed and uncommitted. Every line number below was read off the working tree at this leg's design; re-verify before editing.

### 1. Land the two pure modules FIRST (AC6, AC14)

Both are the leg's only unit-testable substance, and both buy main.js lines back against a target already 8 over.

**`src/main/window-census.js`** — duck-typed over records exactly as `window-registry.js` is (`WinLike` = `{id, [k]: any}`), so it never imports Electron nor either manager's type:

```js
/**
 * DD2's per-window rows, derived AT CALL TIME. ZERO STATE: nothing is cached,
 * there is no rebuild trigger, and nothing to invalidate — every field is read
 * from the records on each call. That is the strongest argument for the op, so
 * it is pinned by test (mutate a record between two calls; the second sees it).
 *
 * NULL-TOLERANT by contract: leg 1 nulls rec.findOverlay / rec.sheet in the
 * window's `close` handler (AC8b), so both slots can be null on a LIVE record.
 * An ABSENT id means "never created" (lazy — DD5), NOT null: a caller must be
 * able to tell "no sheet has ever existed in this window" from "the sheet exists
 * but is hidden", which is exactly why sheetVisible is separate from sheetWcId.
 */
function buildWindowCensus(records, lastFocusedId) { … }
```

`viewWcId(mgr)` — a private helper returning `mgr?.getView()?.webContents?.id` guarded by `isDestroyed()`, `undefined` on any miss — keeps the four id/visible pairs symmetric.

**`src/main/capture-source-picker.js`** — `pickSourceByMediaSourceId(sources, mediaSourceId)`. **One semantic: exact match or `null`.** No scoring, no "closest", no fallback — that is the whole point of DD4 ("*capture *a* window that happens to be the same size* is not a contract"). Name the null test for the contract so a "be helpful" refactor fails loudly.

### 2. `main.js` — the accessors (AC5, AC9, AC10, AC12)

```js
// F7 DD2: the flight's single discovery primitive. Zero state — buildWindowCensus
// derives every field from the live records at call time.
const enumerateWindows = () => buildWindowCensus(registry.records(), registry.getLastFocusedId?.());
```

> **`lastFocusedId` is NOT exported today** (`window-registry.js:52` is closure-local; only `getLastFocused()` `:130-135` reads it). Two options, both acceptable — **pick one and say which in the log**: (a) derive `lastFocused` by identity — `const lf = registry.getLastFocused(); … lastFocused: rec === lf` — which needs **no registry change** and inherits the membership-validated first-record fallback for free; or (b) add a `getLastFocusedId()` accessor. **(a) is preferred**: it keeps `window-registry.js` on the pinned-unchanged list and matches DD2's "derives from `registry.records()`" wording. If you take (a), `buildWindowCensus(records, lastFocusedRecord)` compares by **identity**, and AC5's `lastFocused` test asserts the no-match case yields zero true rows.

`getChromeContents` (`:241-244`) gains an optional windowId — the **one** edit; every existing caller passes nothing and is unaffected:

```js
const getChromeContents = (windowId) => {
  const rec = windowId != null ? registry.get(windowId) : registry.getLastFocused();
  return rec ? rec.chromeView.webContents : null;
};
```

`grabWindow` (`:630`) takes an optional windowId; only `:634` changes:
```js
async function grabWindow(windowId) {
  const grabRec = windowId != null ? registry.get(windowId) : registry.getLastFocused();
  if (!grabRec) return null;
  …
```
Everything downstream already reads `grabRec` — leg 2's F2 discipline ("never mix records mid-capture") is preserved for free.

`listWindows` — DD1's seam. Keep `tabs.js` Electron-free: the only Electron handle that crosses is `chrome`, and `tabs.js` passes it to `executeInChrome` **and nothing else** (leg 2's rule).

```js
// F7 DD1: the REGISTRY is the ownership authority. `ownsTab` is the record's own
// tabViews membership — the renderer is authoritative only for url/title/jarId.
const listWindows = () => registry.records().map((rec) => ({
  windowId: rec.win.id,
  chrome: rec.chromeView.webContents,
  booted: rec.bootConfigServed,
  ownsTab: (wcId) => rec.tabViews.has(wcId),
}));
```

Inject `listWindows`, `enumerateWindows`, and the (now windowId-aware) `grabWindow` at **both** `createEngine` sites: `main.js:831` and `main.js:3336`. **ES6 shorthand**, matching the `grabWindow,` already in both.

### 3. `tabs.js:enumerateTabs` — the census (AC1–AC4)

```js
async function enumerateTabs(deps) {
  // F7 DD1: an ALL-WINDOWS census (mission.md's stated default). Absent dep → the
  // pre-F7 single-window path (the house "Absent → no behavior change" idiom,
  // engine.js:33-41) — which is why BOTH live injection sites are grep-pinned: a
  // forgotten injection silently restores the window-scoped enumeration with no
  // test failure anywhere.
  if (typeof deps.listWindows !== 'function' || typeof deps.executeInChrome !== 'function') {
    const raw = await deps.executeInRenderer('window.__goldfinchAutomation.listTabs()');
    return mapEnumeratedTabs(raw, deps);
  }
  const out = [];
  for (const w of deps.listWindows()) {           // registry insertion order
    // A mid-boot window contributes ZERO rows and gets NO round-trip: its renderer
    // genuinely has no tabs yet. enumerateWindows().booted is the completeness
    // discriminator (DD2) — deliberately NOT a marker on this return (DD1 pass-2
    // HIGH: a wrapper breaks scope.js's .filter, and an array-with-own-property is
    // SILENTLY dropped by Array.prototype.filter, which does not copy own props).
    if (!w.booted) continue;
    let raw;
    try {
      raw = await deps.executeInChrome(w.chrome, 'window.__goldfinchAutomation.listTabs()');
    } catch {
      continue;                                    // one window's failure never fails the census
    }
    for (const t of mapEnumeratedTabs(raw, deps)) {  // per window, UNCHANGED
      // The REGISTRY is the ownership authority. This filter is what makes a
      // double-count STRUCTURALLY IMPOSSIBLE across N non-atomic round-trips: a tab
      // moving A→B mid-census can be REPORTED by both chromes, but only the record
      // that owns it stamps a row. The windowId is stamped HERE, from the registry —
      // the renderer never learns it.
      if (!w.ownsTab(t.wcId)) continue;
      out.push({ ...t, windowId: w.windowId });
    }
  }
  return out;
}
```

> **The `executeInChrome` half of that guard is DEAD, and leg 2's precedent does NOT model a reachable failure — keep it anyway, and say why.** *(Design-review finding, verified against the tree rather than inherited.)* `engine.js:107` builds `executeInChrome` as a **plain, unconditional object-literal property**, unlike `listWindows`/`chromeForTab`/`isTabViewWcId`/`raiseWindowForTab`, which ride the `...(typeof X === 'function' ? { X } : {})` **conditional-spread** idiom. So `typeof deps.executeInChrome !== 'function'` can never be true for engine-built deps: **the fallback is gated on `listWindows` alone.** Leg 2's own log already conceded this about its identical guard (*"Both are injected together at both live sites, so the case is unreachable today — it is defensive, and it costs one `&&`"*) — so citing it as if it modeled a **reachable** failure was wrong.
>
> **Ruling: KEEP the two-dep guard; fix the rationale.** `tabs.js:166` (leg 2's `activateTab`, landed and pinned) carries the **identical** `|| typeof deps.executeInChrome !== 'function'` guard three functions away in this same file. Making `enumerateTabs` differ would read as a defect in one of the two and invite a future reader to "harmonize" them — plausibly in the wrong direction — while reconciling them properly means editing leg-2 code this leg has pinned unchanged. Symmetry with the adjacent landed function is worth one `&&`; **the comment is what stops the reinvention**, so it must name the deadness rather than imply a live failure mode:

```js
// Fallback is gated on listWindows ALONE in practice: executeInChrome is built
// UNCONDITIONALLY in engine.js's deps() (:107, a plain object-literal property),
// NOT via the conditional-spread idiom listWindows/chromeForTab use — so it can
// never be absent from engine-built deps. The check is DECORATIVE: it guards a
// hand-built deps bag (unit tests), and it exists for SYMMETRY with activateTab's
// identical guard (tabs.js:166), so the two routed ops in this file cannot look
// like one of them is wrong. Do not "harmonize" them by DELETING one.
```

**Do not** be tempted to add an atomicity barrier. DD1 (pass 2) verified the drop side is *currently unreachable*: `main.js:2712-2713` is `source.tabViews.delete(...)` / `target.tabViews.set(...)` as **adjacent synchronous statements** inside a fully synchronous handler, so no round-trip can interleave. **DD1 trades a double-count for nothing.** *(F8 constraint, recorded in DD1: any await F8 introduces between those two statements silently degrades this from "structurally impossible" to a reachable — and much quieter — **missing** tab.)*

### 4. `engine.js` — the op + the two discriminators (AC5, AC9, AC10)

Add `listWindows`, `enumerateWindows` to the opts bag (`:71`), document them in the JSDoc alongside `isTabViewWcId`/`chromeForTab` (`:33-51`) with the **same "Absent → no behavior change" wording**, and put `listWindows` on `base` (`:107`) via the same conditional-spread idiom.

`enumerateWindows` lands beside `getChromeTarget` (`:146-150` is the template):
```js
enumerateWindows: () => {
  if (typeof enumerateWindows !== 'function') throw new Error('automation: windows-unavailable — window registry not wired');
  return enumerateWindows();
},
```
*(The `downloads-unavailable` shape at `:154-156` is the in-repo precedent for an unwired accessor.)*

`getChromeTarget` — **derive from DD2**, which is what makes it "the flight's single discovery primitive" rather than a second topology source:
```js
getChromeTarget: ({ windowId } = {}) => {
  if (typeof enumerateWindows !== 'function') {
    if (windowId != null) throw new Error('automation: windows-unavailable — …');
    const cc = getChromeContents();                       // pre-F7 path, unchanged
    if (!cc) throw new Error('automation: chrome-window-unavailable — chrome contents is null (closed or starting up)');
    return { wcId: cc.id, kind: 'chrome', url: cc.getURL() };
  }
  const rows = enumerateWindows();
  const row = windowId != null ? rows.find((r) => r.windowId === windowId) : rows.find((r) => r.lastFocused);
  if (!row && windowId != null) throw new Error('automation: no-such-window — no window ' + windowId);
  …
},
```
**Keep the existing `chrome-window-unavailable` message verbatim** for the null-chrome case — it is a distinct, already-pinned condition from `no-such-window`.

`captureWindow: ({ windowId } = {}) => observe.captureWindow(deps(), { windowId })` — and in `observe.js` (`:236-241`) thread `windowId` into `grabWindow(windowId)`. **`observe.js` stays Electron-free** and **`captureWindow`'s return stays the bare base64 string** (see the FD tension above; `mcp-tools.js:87-89`'s `imageResult` consumes it positionally, and `automation-mcp-tools.test.js:591-599` pins it).

### 5. `main.js:grabWindow` — DD4's identity bind (AC13, AC14)

Delete the `bestScore` loop (`:654-662`) entirely. The branch becomes:

```js
const sources = await desktopCapturer.getSources({ types: ['window'], fetchWindowIcons: false, thumbnailSize: { width: cw, height: ch } });
// F7 DD4: bind by window IDENTITY, never by size. The pre-F7 best-size-match could
// grab an UNRELATED window when two similar-sized windows existed — "capture *a*
// window that happens to be the same size" is not a contract, and the exact identity
// is on the record. NO fallback branch: a miss falls through to the composite below,
// which is already correctly bound to grabRec.
const best = pickSourceByMediaSourceId(sources, grabWin.getMediaSourceId());
if (best && best.thumbnail) return best.thumbnail.toPNG().toString('base64');
```

`grabWin.getBounds()` (`:645`) becomes **unused** — delete it; `getContentBounds()` (`:648`) is still needed for `thumbnailSize`. Watch `no-unused-vars` (`npm run lint` catches it).

> **S2, and it is load-bearing.** `main.js:642-643` skips this whole branch under Wayland and `dev:automation` selects Wayland: **this code never executes on the dev rig.** The unit net (AC14) is the only proof available; the cross-platform half is HAT/operator-scoped. **No AC may claim live proof of a fix the rig cannot reproduce** — and per the leg-2 precedent, the HAT item must be **pinned to a non-Wayland desktop or recorded as an accepted permanent gap**, never left as an unqualified ticket that silently cannot run.

### 6. `scope.js` (AC7) and `mcp-tools.js` (AC8, DD3, DD9)

`scope.js` — add `facade.enumerateWindows` beside `facade.getChromeTarget` (`:181-184`), copying its shape exactly (`requireJar()` first, then the `admin-only` throw). **Do not** add it to `WCID_FIRST_OPS` (`:49`) — it takes no wcId, like `captureWindow`/`getChromeTarget`/`getDownloadsList`.

`mcp-tools.js` — new `enumerateWindows` def in `CHROME_TOOLS` (`:534-548`; it is admin-only chrome/topology discovery, which is exactly that group's charter). Add `windowId` to `getChromeTarget`'s and `captureWindow`'s `inputSchema` (`:538`, `:414`) — `{ type: 'integer' }`, **optional** (no `required`), flat (no `anyOf`/`oneOf` — `automation-mcp-tools.test.js:188` pins that, count-agnostically). Both `call`s become `(engine, { windowId }) => engine.op({ windowId })`. Update `:577-581`'s tally comment and the `CHROME_TOOLS` header comment (`:526-532` says "chrome discovery (1)").

**`captureWindow` keeps `shape: imageResult`** (`:416`) untouched.

### 7. `scripts/a11y-audit.mjs` (AC17, AC18)

```js
// F7 DD2: the sheet's wcId comes from enumerateWindows — an EXACT, O(1) read.
// This RETIRES the id-space probe walk (skip set from enumerateTabs + chrome, then
// walk 1..64). The walk's enumerateTabs-failure branch walked UNFILTERED, and no
// existing op could enumerate non-tab contents — the admin relaxation made overlay
// views ADDRESSABLE, never LISTABLE. enumerateWindows is the op that lists them.
// NO FALLBACK: if this fails, `npm run a11y` fails LOUDLY. A silent fallback to the
// walk would let DD2 be broken while this checkpoint stayed green.
async function findSheetWcId(client) {
  const { value: wins, isError } = await callTool(client, 'enumerateWindows', {});
  if (!isError && Array.isArray(wins)) {
    const row = wins.find((w) => w.sheetVisible && w.sheetWcId != null) || wins.find((w) => w.sheetWcId != null);
    if (row) return row.sheetWcId;
  }
  fail( /* the EXISTING :229-233 message, updated: the sheet is lazy, so a menu must
          have OPENED before discovery, and the audit needs the ADMIN key —
          enumerateWindows is admin-only. */ );
}
```
Update the sole call site (`:412`): `findSheetWcId(client, [wcId])` → `findSheetWcId(client)`. Keep the `sheetWcId == null` once-per-run cache — the sheet is a per-window lazy singleton, so it is still stable across states, and the comment (*"once — stable across states"*) stays true.

**Keep the earned comments** — `CLAUDE.md:388`'s probe-walk doctrine and the audit's own header explain *why* the walk existed. They travel as the retirement's rationale, reworded to past tense.

### 8. Then the docs (AC19–AC21), then the smoke

**Re-read every doc line before editing it** — leg 2 already moved several (`docs/mcp-automation.md:346/:403/:431/:445`, `CLAUDE.md:388/:424`) and the flight's own citations for this section are pre-leg-1/2 (`:356-384` → **`:359-390`**; `:391` → **`:394`**; `:400/:430/:491` → **`:403/:433/:494`**).

Order: pure modules → main.js accessors → tabs.js → engine.js → scope.js/mcp-tools.js → the unit net → a11y → docs → the smoke.

## Edge Cases

- **A mid-boot window's adopted tab is invisible — and that is the DESIGNED behavior, not a bug.** A move-created window's adopted tab is in `rec.tabViews` (`main.js:2713`) **before** its chrome boots (`bootConfigServed` flips at `main.js:2401`). During that interval `enumerateTabs` returns **zero rows** for it. **`booted` exists to disclose exactly this** (DD1). It **must** be documented (AC19) — an undisclosed invisible tab is the failure; a disclosed one is a contract.
- **Why not fail-closed on mid-boot?** Review pass 1 (H3/H4/H5): fail-closed contradicted itself on mid-boot, made `multi-window-shell`'s own boot-bracket poll unsatisfiable, and would refuse throughout F9's multi-window restore. Contributing zero rows is **honest rather than lossy** — an un-booted window's renderer genuinely has no tabs yet.
- **Non-atomicity: the double-count is structurally impossible; the drop is currently unreachable.** N sequential round-trips have no snapshot. Registry-authoritative ownership kills duplicates **by construction** (only the owning record stamps a row). The drop side needs an interleave between `source.tabViews.delete` and `target.tabViews.set` — **adjacent synchronous statements** at `main.js:2712-2713` inside a synchronous handler. And the pre-dom-ready case is already handled: `renderer.js:3570` reports `wcId: null` until dom-ready and `tabs.js:43` already drops those. **DD1 trades a double-count for nothing.** *(The F8 constraint DD1 records points at these lines — **and they have moved twice already**: the flight cited `:2699-2700`, leg 2's audit corrected to `:2639-2640`, and the working tree is now `:2712-2713`. F8 must re-derive them, not inherit any of the three.)*
- **The `incomplete` marker is DELETED from the design — do not reinvent it.** It broke the jar facade outright (`scope.js:152-155` does `tabs.filter(...)` → `tabs.filter is not a function`; `mcp-jar-scoping.md:60` pins "returns a JSON-text **array**"), and an array-with-own-property is **silently dropped** by `Array.prototype.filter`, which does not copy own properties — a jar caller would under-read **with no signal**, the exact failure the marker existed to prevent. It was also a cross-tenant leak. **DD2's `booted` carries the signal at the admin tier where topology belongs.** *(Note the same trap sits one DD over in this leg: `captureWindow`'s return is consumed positionally by `imageResult`. Same shape, same ruling — see the FD tension.)*
- **`rec.sheet` / `rec.findOverlay` can be `null` on a LIVE record.** Leg 1's AC8b nulls both in the `close` handler, and the record stays reachable until `registry.remove` at `closed`. `buildWindowCensus` must be null-tolerant on **every** slot read, and must also tolerate a manager whose `getView()` returns null (never shown) or whose view's `webContents` is destroyed.
- **Absent vs. null for `sheetWcId`.** **Absent** ⇒ never created (lazy — DD5's trade-off: a window that never opens a menu pays nothing). Do **not** normalize to `null` — the distinction is DD2's stated contract, and leg 4's two-menus variant reads it. Pin it by test.
- **`lastFocused` is not an OS-focus claim.** It maps to `getLastFocused()` (`window-registry.js:130-135`) — main-side tracked, membership-validated, first-record fallback, because programmatic `focus()` fires no focus event under WSLg and `getFocusedWindow()` goes stale indefinitely (F6 spike verdict 4). The **naming** is the contract: `focused` would assert something this codebase deliberately refuses to assert.
- **`no-such-window` must not fall back to last-focused.** A silent fall-back would make `captureWindow({windowId: <closed window>})` return **another window's pixels** and report success — S1's silent-success class, restated at window scope, in the very leg that fixes capture's binding.
- **A window closing mid-census.** `listWindows()` snapshots the records array at call time; a window closing between the snapshot and its round-trip makes `executeInChrome` throw → that window contributes zero rows and the census still returns the others. `try`/`continue` is the contract, not a defensive accident.
- **The jar tier now sees more tabs — that is DD1's intent, not a leak.** A jar key's `enumerateTabs` previously saw only the last-focused window's tabs *for its jar*; it now sees all windows' tabs *for its jar*. The confinement is unchanged: `scope.js:152-155` filters by **resolved session identity**, never `t.jarId`. *(DD1's original privacy rationale was factually wrong — burner `jarId` is **not** privacy-model-bearing; a burner is already dropped at the jar tier by session identity. Option (b)'s real cost was admin-tier **observability**. Do not re-derive the wrong reason.)*
- **`enumerateWindows` at the jar tier is topology, and topology is admin.** It names windows a jar identity may hold no tabs in. `scope.js:186-193`'s doctrine is explicit. AC7 is not optional hardening.
- **DD4's miss is not a fallback.** If `pickSourceByMediaSourceId` returns null, fall through to the **existing** composite (`:670+`) — already correctly bound to `grabRec`. Do **not** add "the closest source" or restore any scoring. There is no fallback branch **by design**: the premise resolved (`electron.d.ts:2809`).
- **`getMediaSourceId()` is an X11 `Window` id on Linux** (`electron.d.ts:2805-2807`) — reachable only on the **non-Wayland** path, which is exactly where the buggy heuristic lived. Consistent with S2: the rig cannot reach either.
- **`getChromeContents`'s new param must not perturb its existing callers.** It is read at `main.js:463`, `:2202`, `:3142`, `:3124`-adjacent, and both `createEngine` sites — all call it with **no arguments**, so `windowId` is `undefined` and the last-focused branch runs. Verify by grep rather than assumption.
- **`npm run a11y` is the one live gate this leg can fail loudly.** It is admin-tier, single-window, and it exercises `enumerateWindows` end-to-end through the real MCP transport. Treat a failure as a real defect in DD2, not an apparatus problem.

## Files Affected

- `src/main/window-census.js` — **NEW**. Pure/Electron-free `buildWindowCensus(records, lastFocused)` → DD2's rows.
- `test/unit/window-census.test.js` — **NEW**. Incl. the zero-state pin and the absent-vs-null pin.
- `src/main/capture-source-picker.js` — **NEW**. Pure/Electron-free `pickSourceByMediaSourceId`; exact match or null, no fallback.
- `test/unit/capture-source-picker.test.js` — **NEW**. **DD4's only rig-provable half (S2).**
- `src/main/automation/tabs.js` — `enumerateTabs` (`:62-65`) becomes the all-windows census; `mapEnumeratedTabs` (`:41-53`) **unchanged**, applied per window.
- `src/main/automation/engine.js` — opts bag (`:71`) + JSDoc (`:33-51`) gain `listWindows`/`enumerateWindows`; `base` (`:107`) gains `listWindows`; new `enumerateWindows` op beside `getChromeTarget` (`:146-150`); `getChromeTarget`/`captureWindow` (`:136`) gain `{windowId?}`.
- `src/main/automation/observe.js` — `captureWindow` (`:236-241`) threads `windowId` into `grabWindow`. **Return shape unchanged.**
- `src/main/automation/scope.js` — `facade.enumerateWindows` admin-only refusal beside `:181-184`.
- `src/main/automation/mcp-tools.js` — `enumerateWindows` def in `CHROME_TOOLS` (`:534-548`) + its header (`:526-532`); `windowId` on `getChromeTarget` (`:538`) and `captureWindow` (`:414`) schemas + their `call`s and descriptions; the tally comment (`:577-581`).
- `src/main/main.js` — `enumerateWindows`/`listWindows` accessors; `getChromeContents` (`:241-244`) + `grabWindow` (`:630`, bind at `:634`) gain optional `windowId`; DD4's identity bind replaces the scoring loop (`:654-662`); three deps injected at **both** engine sites (`:831`, `:3336`).
- `scripts/a11y-audit.mjs` — `findSheetWcId` (`:212-234`) re-pointed onto `enumerateWindows`; the walk (`:220-228`), the skip set (`:215-216`), its `catch` (`:217-219`), and the `skipWcIds` param deleted; call site `:412`.
- `test/unit/automation-tabs.test.js` — extended (existing `enumerateTabs` tests pass unmodified via AC4).
- `test/unit/automation-mcp-tools.test.js` — DD9's schema pin extension; `:72`'s count/names; **`:541-553`'s "captureWindow no-input" rewritten (falsified by DD3)**; `:591-599` **unmodified** (AC10's control).
- `test/unit/automation-mcp-server.test.js` — `EXPECTED_TOOL_COUNT` `:26` 29 → 30.
- `docs/mcp-automation.md` — `:359-390` **replaced**; rows `:403`, `:433`, `:494`; a new `enumerateWindows` row; `:19`, `:394` (29 → 30).
- `CLAUDE.md` — `:452` (29 → 30 + `enumerateWindows`), `:404` (DD1 lands the pre-registered revisit), **`:29` and `:169`** (leg-1 residuals: the find bar and the sheet no longer ROAM — AC21).
- **PINNED UNCHANGED**: `src/main/menu-overlay-manager.js` + `test/unit/menu-overlay-manager.test.js` (**the retirement is DEFERRED — see the ruling**), `src/main/find-overlay-manager.js`, `src/main/window-registry.js` (see guidance step 2 option (a)), `src/main/capture-timeout.js`, `src/main/automation/{input,find,print,resolve,cdp,nav,zoom,toggle}.js`, **every file under `tests/behavior/`** (leg 4 owns spec edits).

---

## Post-Completion Checklist

**Complete ALL steps before signaling `[COMPLETE:leg]`:**

- [ ] All acceptance criteria verified
- [ ] Tests passing (`npm test` ≥ 1786; `npm run typecheck`; `npm run lint`)
- [ ] **`npm run a11y` green** — the flight checkpoint AC17's re-point puts at risk. Mandatory, not skipped.
- [ ] The AC25 live smoke run, with every observable recorded
- [ ] **APPEND** a leg-3 landing entry to `flight-log.md` — do **not** edit any existing entry (append-only). Record:
  - [ ] **main.js's line count at landing** (`wc -l`, read off the tool — baseline **3469**) **AND leg 3's delta SEPARATELY**. Do not absorb leg 2's −8 overage. Record what AC6's and AC14's extractions actually bought back.
  - [ ] **The `getAttachedWindow` retirement RULING: DEFERRED to the M09 post-mission maintenance flight**, with (a) the corrected enumeration — **1 of 9 DD7 tests is over unreachable code (`:720`), not nine; a second (`:744`) went vacuous; `attachment` is LIVE (`main.js:527`), only `crossWindow` is dead** — (b) the sized ticket, (c) the `win.contentView` identity-stability premise to verify, and (d) the F8 checkpoint. **The eighth instance of this flight's count/enumeration-error pattern, and this time it is the FD's own ruling** — the debrief wants it.
  - [ ] **The DD3-vs-image-contract tension** and how it was ruled — `captureWindow` accepts `{windowId}` but its return does **not** gain `windowId` (`imageResult` consumes it positionally; `automation-mcp-tools.test.js:591-599` pins it) — **the DD1 `incomplete`-marker failure mode recurring one DD over**. Record the FD's confirmation or overrule.
  - [ ] **AC15's S2 honesty note** — DD4's fix is **never claimed live**; the rig (Wayland) skips the branch entirely. The HAT item **pinned to a non-Wayland desktop or recorded as an accepted permanent gap** — never an unqualified ticket that silently cannot run.
  - [ ] **AC25(a)'s mid-boot observable** — caught, or **explicitly recorded as an unsampled sampling limit rather than a proof**. Do not claim an absence the instrument never demonstrated it could report as a presence.
  - [ ] **AC25(c)** — two sheets `sheetVisible: true` simultaneously with two distinct `sheetWcId`s: the flight's headline observable, read through DD2's own field.
  - [ ] **The three false premises in this leg's brief** (the a11y "activates background tabs" claim, retired by leg 2's AC5 and already recorded at `CLAUDE.md:388`; "inert `attachment`"; DD3's `captureWindow` return) — recorded as **premise-audit finds**, the habit the flight keeps asking for.
  - [ ] **The AC1 `executeInChrome` guard — the fix NOT taken, and why.** The guard is **dead** (`engine.js:107` builds `executeInChrome` unconditionally; only `listWindows` gates the fallback), and **leg 2's precedent does not model a reachable failure** — leg 2's own log already conceded its identical guard was unreachable-but-defensive, so citing it as live was a **premise inherited from prose instead of read off the tree**. Kept for symmetry with `tabs.js:166`; rationale corrected in the comment. *(A fourth premise-audit find, and the first one caught in this leg's own guidance rather than in the brief.)*
  - [ ] **The `structuredContent` sidecar — the OTHER fix not taken, and why.** The MCP SDK **does** have the affordance (`types.js:1289-1303`), so the rejection is not "unclear whether it survives": it is circular with DD9, widens the `listTools` discovery contract (`mcp-tools.js:608`, pinned at `automation-mcp-tools.test.js:81-90`), is heaviest on the one image op, and contradicts DD1's own "topology belongs at the admin tier" doctrine. **Adding a field to a return type is now 0-for-2 in this flight; record it as a shape, not two incidents.**
  - [ ] **FOUR of my own Citation-Audit entries were drifted — and the CORRECTION of one of them drifted too.** (`tabs.js:41-53`→`:40-51`; `mcp-tools.js:110-117`→`:108-115`; `menu-overlay-manager.js:300`→`:304`/`:310`; `:343`-adjacent→`getView()` is `:334`, `:343` is `getAttachedWindow`.) **All four sat in the "verified OK — no drift" list** — the part this leg sells. Caught at design review, re-verified against the tree, none dangerous, **the retirement ruling's substance unaffected**. Then my fix-up row for the `ToolDef` typedef **cited `}} ToolDef` at `:115` when it is `:114`** — caught only by printing the block line-by-line instead of trusting the review's range. **The debrief wants this as one finding, not five:** the leg written to stop citation drift carried four in its own completeness claim, and its correction of one carried a fifth. Same shape as leg 2's AC1 verify line reproducing the count error inside the AC documenting it. **The generalization is now unavoidable and is the flight's real lesson: a boundary quoted from memory, from prose, or from another artifact's range is wrong at a rate this flight has measured many times over — the ONLY reliable move is to print the range and read it.**
  - [ ] **The grep-AC controls actually RUN** (`observe.js` → 0 and `engine.js` → 1; `grabWindow` → 2; `bestScore` → 2 before / 0 after; the 1..64 walk → 1 before / 0 after) — reported as numbers, not as "passed". The flight's root-cause ruling is that a grep-AC without a run control is a design fault.
  - [ ] `multi-window-shell` confirmed **not run and not touched** (planned red; leg 4 rewrites it)
  - [ ] Which `lastFocused` option (guidance step 2 (a) or (b)) was taken, and why
  - [ ] Anything the implementation surfaced that this design missed — the honest place for it, given this flight's standing pattern
- [ ] Set this leg's status to `completed` (in this file's header)
- [ ] Check off this leg in `flight.md`
- [ ] **Do NOT commit** — this flight commits **once** after the flight-end review (the F6 pattern; legs 1 and 2 are landed-uncommitted in the same working tree)

---

## Citation Audit

**Every code-location citation in this leg was verified against the WORKING TREE at leg design** — enumerated below rather than totalled, per this flight's standing lesson (*a number worth writing down is worth reading off the tool*; seven of this flight's errors are a total asserted in prose instead of an enumeration). Because legs 1 and 2 are landed-but-uncommitted, every citation inherited from the flight spec, the recon, and this leg's brief was re-derived against the working tree rather than `HEAD` (`b607411`). The drifted set, the false-premise set, and the verified-OK set are each listed in full below; **no count is asserted for any of them — read the rows.**

### Drifted — repaired inline

Caused by leg 1's ~224-line extraction (3461 → 3392) and leg 2's +77 (→ **3469**), plus leg 2's own doc edits.

| Citation (flight / recon / brief) | Working tree | Note |
|---|---|---|
| `main.js:814-815` — the Wayland skip | **`main.js:642-643`** | S2's basis — the branch DD4 fixes is dead code on the rig |
| `main.js:826-834` — the best-size-match heuristic | **`main.js:654-662`** | DD4's delete target (`bestScore` loop) |
| `main.js:806`/`:808` — `grabWindow`'s record bind | **`main.js:634`** (`grabWindow` at `:630`) | |
| `main.js:2481` — `tabViews` entry shape | **`main.js:2495`** | S4's basis |
| `main.js:2699-2700` → *(leg 2: `:2639-2640`)* — DD1's adjacent sync delete/set | **`main.js:2712-2713`** | **Moved TWICE.** DD1's F8 constraint points here — F8 must re-derive, not inherit any of the three |
| `main.js:237-240` — `getChromeContents` | **`main.js:241-244`** | |
| `main.js:764` / `:3263` — the two `createEngine` sites | **`main.js:831` / `:3336`** | leg 2's own citations, already stale — AC12's greps |
| `window-registry.js:33` — `bootConfigServed` (typedef) | **`window-registry.js:41`** | |
| `window-registry.js:69` — set false | **`window-registry.js:79`** | |
| `window-registry.js:72` — record created before boot | **`window-registry.js:73`** | |
| `window-registry.js:116-121` — `getLastFocused` | **`window-registry.js:130-135`** | |
| `engine.js:124-128` — `getChromeTarget` (DD2's stated template) | **`engine.js:146-150`** | |
| `engine.js:114` — `captureWindow` | **`engine.js:136`** | |
| `engine.js:72-75`/`:71-76` — `executeInRenderer` | **`engine.js:83-86`** | `executeInChrome` (leg 2's seam, DD1 reuses it) is **`:91-94`** |
| `observe.js:215-220` — `captureWindow` | **`observe.js:236-241`** | |
| `scope.js:145-157` — the jar filter | **`scope.js:148-157`** (the `.filter` at **`:152-155`**) | DD1's "unchanged" claim verified |
| `mcp-tools.js:536-540` — `getChromeTarget` def | **`mcp-tools.js:535-540`** | |
| `docs/mcp-automation.md:356-384` — the section F7 replaces | **`docs/mcp-automation.md:359-390`** | AC19 |
| `docs/mcp-automation.md:391` — "All 29 tools … match exactly" | **`docs/mcp-automation.md:394`** | DD9's stated motivation |
| `docs/mcp-automation.md:400`/`:430`/`:491` — the three rows | **`:403` / `:433` / `:494`** | AC20 |
| `a11y-audit.mjs:212-235` — `findSheetWcId` | **`a11y-audit.mjs:212-234`** | the function ends at `:234` |

### Drifted — **MY OWN**, caught at design review and re-verified against the tree

Recorded rather than quietly fixed. All four were in **my "verified OK — no drift" list**, which is the part of this audit the leg actually sells — *an audit that claims completeness while carrying drift is worse than one that claims less.* None is "dangerous" in this flight's sense (none points at a plausible-wrong symbol that would type-check at a call site), but they are four more data points for the debrief's citation-drift class, and they land in the leg that exists to stop it.

| My citation | Working tree | Note |
|---|---|---|
| `tabs.js:41-53` — `mapEnumeratedTabs` | **`tabs.js:40-51`** | `function` at `:40`; `return out;` `:50`; `}` `:51` |
| `mcp-tools.js:110-117` — `ToolDef` typedef | **`mcp-tools.js:108-115`** (the JSDoc block) | `@typedef {{` **`:108`**, `}} ToolDef` **`:114`**, `*/` **`:115`**. (`:117` is the `/** @type {ToolDef[]} */` annotation; `const DRIVE_TOOLS = [` is `:118`.) **My first draft of THIS ROW said "`}} ToolDef` `:115`" — off by one, caught by re-reading the block line-by-line rather than trusting the review's range.** Recorded, not silently fixed: a citation-drift correction that itself carried citation drift is the sharpest available instance of this flight's pattern, and it is the same shape as leg 2's AC1 verify line reproducing the count error *inside the AC documenting the count error*. **The fix is the one this leg already applies everywhere else: print the enumeration, read the enumeration** (`awk 'NR>=107 && NR<=118'`), never quote a boundary from memory or from another artifact's range. |
| `menu-overlay-manager.js:300` — cited as an `attachment.win` read | **`:304` and `:310`** | `:300` is `const att = attachment;`. The real reads are `sendToChrome(…, att ? att.win : null)` `:304` and `focusChrome(att ? att.win : null)` `:310`. **The retirement ruling's substance is unaffected — both are live reads, so `attachment` is still live; only my line numbers were wrong.** |
| `menu-overlay-manager.js:343`-adjacent — cited for `getView()` | **`getView()` is `:334`** | `isVisible()` `:332`, `getView()` `:334`. **`:343` is `getAttachedWindow`** — a *different accessor*, and the one the retirement ruling defers. Citing it as "adjacent" for `getView()` blurred exactly the distinction that ruling turns on: DD2 needs `:332`/`:334`; it does **not** need `:343`. |

### Drifted — points at a COMMENT, not a pin

| Citation | Reality |
|---|---|
| **DD9: "`automation-mcp-tools.test.js`'s existing schema pin (`:8`)"** | `:8` is a **comment line** (*"They pin the discovery contract (18 drive tool names + schemas, no `call` leak)"*), not an assertion. The real pins are `:72-79` (count + names), `:81-90` (key shape), **`:92-168` (required fields)**, `:170`/`:181`/`:188` (combinator hygiene), and **`:541-553` (observe schemas — pins `captureWindow` as no-input, which DD3 FALSIFIES)**. AC16 targets the real ones. |

### Verified OK — no drift

- `main.js:249-252` (`chromeForTab`), `:263-268` (`raiseWindowForTab`), `:281` (`rec.bootConfigServed` read), `:2398-2401` (`window-boot-config` → `bootConfigServed = true` at `:2401`), `:527` (`rec.sheet.openMenu(payload, { contentView: rec.win.contentView, win: rec.win, bounds })`), `:690-695` (leg 2's bounded `Promise.all`), `:725`/`:750` (the overlay-layer gates reading `isVisible()`/`getView()`), `:804-815` (leg 2's re-throw), `:969` (`onWindowClosed`), `:974` (`createWindow`), `:1038` (`registry.create`), `:1141-1142` (record slots assigned), `:1151` (`win.on('close')`) — all by direct read.
- `window-registry.js:107-109` (`records()`, insertion order — DD2's stated source), `:143-149` (`getWindowForChrome`), `:156-162` (`getWindowForGuest`), **`:170-173` (`getChromeForTab`)**, `:35-46` (typedef incl. `findOverlay` `:43` / `sheet` `:44`), `:73-85` (record literal) — confirmed. **`:156-162` is `getWindowForGuest`**, re-confirming the flight's own recorded dangerous-citation warning.
- `scope.js:162-165` (`captureWindow` admin-only), **`:181-184` (`getChromeTarget` admin-only — AC7's template)**, `:186-193` (the `getDownloadsList` cross-jar doctrine), `:49` (`WCID_FIRST_OPS`) — all confirmed **exact**, no drift.
- `mcp-tools.js:87-89` (`imageResult`), `:119-124` (`enumerateTabs` def), `:411-417` (`captureWindow` def, `shape: imageResult` at `:416`), `:534-548` (`CHROME_TOOLS`), `:577-581` (the `= 29` tally), `:582` (`TOOLS`), `:608` (`listTools`) — confirmed. *(`ToolDef` typedef: see my-own-drift table.)*
- `menu-overlay-manager.js:332` (`isVisible: () => visible` — DD2's stated source) — **exact, no drift**. `:117` (`attachment`), `:121-123` (`attachedContentView`), `:248` (`crossWindow`), `:262-265`, `:267-268`, `:299-301` (`hide()` → `const att` → `attachment = null`), `:343` (`getAttachedWindow`) — confirmed. *(`getView()` and the `att.win` reads: see my-own-drift table.)*
- `@modelcontextprotocol/sdk/dist/esm/types.js:1289-1303` — `CallToolResultSchema` incl. **`structuredContent`** and its `outputSchema` obligation; `:1322-1324` (`CompatibilityCallToolResultSchema`). Read at design to settle the sidecar option on evidence rather than on "unclear" — see "The fix NOT taken".
- `engine.js:107` — verified that **`executeInChrome` is unconditional** while `isTabViewWcId`/`isChromeContents`/`chromeForTab`/`raiseWindowForTab` are conditional-spread; `tabs.js:166` — leg 2's identical two-dep guard. Both settle the AC1 guard ruling on the tree rather than on leg 2's prose.
- `menu-overlay-manager.test.js` DD7 tests — **exactly nine**, at `:680, 689, 699, 709, 720, 744, 753, 763, 773` (`grep -c "^test('DD7"` → 9). Confirms leg 1's own correction of the flight's "8".
- `find-overlay-manager.js:357` (`isVisible`), `:359` (`getView`) — confirmed; 365 lines.
- `renderer.js:3568-3576` (`listTabs`, creation order, `wcId: null` until dom-ready) — confirmed.
- `tabs.js:41-53` (`mapEnumeratedTabs`), `:62-65` (`enumerateTabs`) — confirmed **exact**.
- `automation-mcp-server.test.js:26` (`EXPECTED_TOOL_COUNT = 29`) — confirmed exact.
- `electron.d.ts:2809` (`getMediaSourceId(): string`) inside `class BaseWindow` (`:2113`; next class `BrowserWindow` at `:4141`) — **verified a THIRD time**. `:3638` declares `contentView: View` as a **property** (relevant to the retirement ruling's premise). `package.json:73` — `"electron": "^42.6.1"`.
- `mcp-server.js:358` ("the 29 tools"), `CLAUDE.md:19`/`:404`/`:452`, `docs/mcp-automation.md:19` — confirmed.
- Test baseline **1786/1786, 13 suites**, and `wc -l src/main/main.js` = **3469** — both confirmed by **running the tools**, not read from the leg-2 log.

### Corrected against the brief's own text (recorded, not silently fixed)

**1. "`a11y-audit.mjs`'s fallback … activates background tabs" — FALSE.** Leg 2's AC5 deleted `activate()` from `evaluate` on **every** target, and `CLAUDE.md:388` **already records it**: *"Since M09 F7 (DD6) that skip is an optimization, not a safety requirement … the walk's old foreground-first hazard … is gone."* The re-point stands on the surviving true half — the `enumerateTabs`-failure branch (`:217-219`) walks **unfiltered**, and the walk is an O(64) guess where DD2 offers an O(1) exact read.

**2. "the inert `attachment`/`crossWindow` machinery" — `attachment` is NOT inert.** `main.js:527` passes it on every open; `attachedContentView()` (`:121-123`), `attachment.win` (`:258`, `:300`), and `nextAtt.bounds` (`:268`) read it. Only `crossWindow` (`:248`) is dead. **Enumerated: 1 of the 9 DD7 tests is over unreachable code, not 9.** See the retirement ruling.

**3. DD3's "Both return shapes gain `windowId`" — not implementable for `captureWindow`.** Its return is a bare base64 string consumed positionally by `imageResult` (`mcp-tools.js:87-89`, `shape:` at `:416`), pinned by `automation-mcp-tools.test.js:591-599`. **The DD1 `incomplete`-marker failure mode, one DD over.** Ruled and flagged for the FD.

**4. `automation-mcp-tools.test.js:541-553` pins `captureWindow` as "no-input" — DD3 falsifies it.** The flight did not name this test. It is the "green tests over now-unreachable code" class's mirror image: a green test that **will go red** on correct code, which is the *good* outcome DD9 exists to produce. AC16 rewrites it with an inverted assertion rather than deleting it.

**5. `window-registry.js` does not export `lastFocusedId`.** DD2's `lastFocused` is stated as deriving from the registry, but only `getLastFocused()` (`:130-135`) is public (`:52` is closure-local). Guidance step 2 offers two options and prefers the one that keeps `window-registry.js` on the pinned-unchanged list.

**6. `CLAUDE.md:29` and `:169` are leg-1 residuals that are ACTIVELY FALSE** — both still describe the find bar and the sheet as roaming module-scope singletons with attachment tracking, which leg 1 deleted. Leg 1's Files Affected omitted `CLAUDE.md`. The flight's Completion Checklist names *"CLAUDE.md find-overlay"* and no other leg owns it → AC21 sweeps them here.

### Flagged for the FD

- **The `getAttachedWindow` retirement ruling** (deferred, with the FD's own premise corrected) — see Context.
- **The DD3-vs-`imageResult` tension** — see Context. Overruling it lands at AC6/AC10, `mcp-tools.js:416`, and `automation-mcp-tools.test.js:591`.
