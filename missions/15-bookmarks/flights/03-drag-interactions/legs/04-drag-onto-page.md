# Leg: drag-onto-page

**Status**: landed
**Flight**: [Drag Interactions](../flight.md)

## Objective

Make a bookmark dragged from the bar onto the page area load in that tab, without letting a web page gain any new navigation authority, and without breaking pages that handle drops themselves.

## Context

Flight DD2, DD5, DD5b, DD6; mission criterion 6's third clause.

### DD5b was measured, and it changes this leg's mechanism

Operator session 3 measured what Chromium does today with a bookmark dragged onto an ordinary page: **29 `dragover`, zero `drop`, no navigation.** The mechanism is the HTML5 rule — `drop` never fires unless something calls `preventDefault()` on `dragover`. Real Chrome performs URL-drop navigation at the **browser-shell** level, above the page; Electron supplies the renderer but not that shell.

Two consequences, and both simplify the design DD5 originally specified:

1. **The guest preload's `dragover` `preventDefault()` is what makes the feature exist at all** — not an optimisation, not a nicety. Without it there is no `drop` event to handle.
2. **The `drop` handler must NOT call `preventDefault()`** — it would pollute `defaultPrevented`, the very flag the discriminator reads.

⚠ **Why there is no competing default, corrected at design review.** An earlier draft explained this as "Electron gives you the renderer but not Chrome's browser shell." That story is unverified and probably wrong, and the probe cannot support it: `29 dragover / 0 drop` cannot distinguish *"no shell-level navigation exists"* from *"the drop was rejected before any default could run"* — and once our preload preventDefaults `dragover`, a `drop` **is** dispatched, a regime the probe never entered. **Two real mechanisms protect us**, and the implementer should know which: (a) Blink's navigate-on-drop path is gated on the document *not* having handled the drag, so our `dragover` `preventDefault()` suppresses it with the same call that makes `drop` fire; (b) Electron's `navigateOnDragDrop` webPreference defaults to `false` and is set nowhere in this repo (`grep -rn navigateOnDragDrop src/` → no hits). The conclusion stands; the reasoning behind it did not.

DD5's *policy* survives intact — the page still wins — but the mechanism is now: gate `dragover`, don't touch `drop`'s default, and read `defaultPrevented` late.

### Why the discriminator still works

| Page | `dragover` | `drop` fires? | `defaultPrevented` at our deferred read | Outcome |
|---|---|---|---|---|
| Has its own dropzone | page preventDefaults (ours is idempotent) | yes | **true** — the page's drop handler consumed it | page wins, we do nothing |
| Ordinary page | only **our** preventDefault | yes | **false** | we navigate |

**The read must be deferred to a macrotask** (`setTimeout(…, 0)`), never read synchronously and never via `queueMicrotask`. The preload runs at document-start, so its `document`/`window` listener is **first in registration order** and fires *ahead of* a page's own handler on the same node — a synchronous read would see `false` and destroy exactly the drops this design exists to protect. A microtask checkpoint runs between listeners whenever the JS stack is empty, which for a browser-dispatched event it is; only a fresh macrotask is guaranteed to be after the whole dispatch.

### The gate on `types` is mandatory, not cosmetic

`dragover` must be gated on `types.includes(BOOKMARK_DND_MIME)`. Ungated, we would `preventDefault()` **every** drag on **every** page — making pages accept file and link drops they otherwise refuse. `types` is readable during `dragover` under the HTML5 drag protected mode; `getData` is not, and the guest never calls it.

### DD6: the guest's signal carries no authority

`contextIsolation` is **off** in guest tabs (`webview-preload.js` runs in the page main world), so a hostile page can fabricate a `DragEvent` and reach the preload's handler directly. Therefore the signal carries **no url and no id**. The chrome resolves what was dragged from its own live session; main gates on a declared drag. A signal that carries no data cannot be aimed.

## Inputs

- Branch `flight/03-drag-interactions`; `automation-gate`, `carried-debt`, `bar-drag-reorder` landed (uncommitted). Suite **3441 pass / 0 fail**, typecheck and lint clean. `renderer.js` **1588/1650**.
- Leg 3 shipped the drag source: `bookmarks-bar.js:300` `dragstart` sets `BOOKMARK_DND_MIME` (the id) at `:308` plus `text/uri-list`/`text/plain`; session `dnd` at `:180`; `dragActive` at `:184`; `dragend` at `:338-340` **clears the session**.
- `BOOKMARK_DND_MIME` is exported from `src/shared/bookmark-drag.js` — import it, never re-type the string.
- **Declared-drag bookend precedent** (`register-tab-ipc.js:640-660`): `tab-drag-started` verifies `rec.tabViews.has(wcId)` — *"the payload does not get to name a tab the sender does not own"* — and `dragend` clears on a **`DRAG_END_GRACE_MS = 1500`** timer, because *"the target's adopt invoke rides a different IPC pipe with no cross-pipe ordering guarantee, and an immediate clear could race a legitimate adopt into 'not-dragging'"*. Timers are per-record in a `WeakMap`.
- `rec.dragWcId` is a **single slot per window record** (`window-registry.js:99`) — a bookmark drag must **not** reuse it.
- Guest preload: `webview-preload.js`, main world, `ipcRenderer` available; `isTrusted` capture idiom at `:231-234`.
- Navigation gate: `guest-wiring.js:236` `contents.on('will-navigate', guardNav)` (plus `will-frame-navigate`, `will-redirect`).

## Outputs

- `webview-preload.js` — gated `dragover` + deferred-read `drop`, firing a bare signal.
- Main — a bookmark-drag declaration on its own record field, a forwarding handler resolving the **target tab from `event.sender`**, and a grace-timer clear.
- `chrome-preload.js` — the bookend sends and the inbound subscriber channel.
- `bookmarks-bar.js` / `bookmarks-client.js` — declare at `dragstart`, retain the resolved bookmark past `dragend` for a bounded window, navigate on the signal.
- Unit tests for the gate, the discriminator, the bookend refusal, and the grace window.

## Acceptance Criteria

- [ ] **AC1** — A bookmark dragged onto an ordinary page loads it **in the tab that received the drop**.
  - **Autonomous half** *(design-review finding — an AC with only a HAT verification is the trap leg 3's FD note names: an agent either blocks or fabricates)*: drive the finished handler chain in the running app with a real `DragEvent`/`DataTransfer`, the way leg 3 verified its own chain (see this flight's log, leg-3 entry). That exercises guest → main → chrome → navigation without a gesture.
  - **The physical gesture stays at the HAT** — synthetic events cannot confirm the OS transport, and this flight has already recorded that `dropEffect` reads back `"none"` under synthetic `DataTransfer`.
- [ ] **AC2** — A bookmark dropped on a page that handles drops itself is **consumed by the page**: the tab does not navigate, and the page's handler receives the url via `text/uri-list`. The discriminator is `e.defaultPrevented` read in a **`setTimeout(…, 0)` macrotask**. A unit test pins that a synchronous read and a `queueMicrotask` read are *both* insufficient, with the ordering reason in a comment — this is the leg's single most subtle line.
  - **Honest bound**: under `node --test` with a hand-written dispatcher, that test pins the *shape* and the test author's model of dispatch ordering — not Chromium's. The real verification is the HAT fixture page. Say so in the test comment rather than implying the unit proves browser behaviour.
- [ ] **AC3** — The guest's `dragover` handler `preventDefault()`s **only** when `types.includes(BOOKMARK_DND_MIME)`. A test asserts an unrelated drag (e.g. `Files`) is untouched, so pages keep refusing drops they would otherwise refuse.
- [ ] **AC4** — The guest's `drop` handler does **not** call `preventDefault()` (DD5b: there is no default to suppress, and doing so would pollute the discriminator). Pinned by test.
- [ ] **AC5 (DD6)** — The guest→main signal carries **no url and no id**. A test asserts the payload shape is empty/bare. The url is resolved chrome-side from the live drag session, never from anything the guest sent.
- [ ] **AC6b (DD6) — the declaration is CONSUMED on the first successful forward** *(design-review finding)*, mirroring `register-tab-ipc.js:693-700`'s *"a successful adopt CONSUMES the registration — one drag = one drop, shrinking the post-success forgery window to ~0."* Without it the residual is far wider than an earlier draft admitted: during any bookmark drag in window W **plus its grace window**, *every* guest in W — including background tabs the operator never dropped on — could fabricate a `DragEvent` and navigate itself, repeatedly. That is not "the navigation they were performing anyway"; it destroys an unrelated tab's page state. The contract is **one navigation, in one tab, per drag**, and a test pins that a second fabricated signal after a successful forward does nothing.
- [ ] **AC6 (DD6)** — Main refuses a signal with no bookmark drag declared: a fabricated `DragEvent` dispatched from a page with no drag in flight causes **no navigation and no history entry**. The declaration lives on its **own record field, not `dragWcId`** — a test asserts a bookmark drag starting and ending leaves an in-flight tab drag's `dragWcId` untouched.
- [ ] **AC7** — The chrome retains the resolved bookmark past its own `dragend` for a bounded window. ⚠ **This is the PRIMARY path, not a rare race** *(design-review correction)*: the drop is in the guest process and `dragend` fires in the chrome essentially at release, while the signal must cross `setTimeout(…,0)` + guest→main + main→chrome. **`dragend` will win on virtually every drop.** So the holder is load-bearing on the happy path, and AC7's "dragend before the signal" ordering is the **default** test case, not an edge case. The chrome-side window is its own constant, independent of main's `DRAG_END_GRACE_MS` — they bound different things (main's bounds forgery; the chrome's bounds resolution). Rationale is not stylistic: the guest→main→chrome hop crosses two processes and two IPC pipes with **no ordering guarantee** against `dragend`, and leg 3's `dragend` clears `dnd` at `bookmarks-bar.js:338-340`. Without the grace, the navigation resolves to nothing **intermittently** — the worst available failure shape, since it will be reported as "sometimes drag doesn't work" and will not reproduce under a debugger. A test drives `dragend` *before* the signal and asserts the navigation still happens.
- [ ] **AC8** — The navigation rides the **existing untrusted path** and is gated where that path is *actually* gated. ⚠ **Corrected at design review — the first draft named the wrong enforcement point.** The bar-click/omnibox path is `navigate()` → `tabNavigate({verb:'loadURL'})` (`navigation-controller.js:89`) → `ipcMain.on('tab-navigate')` (`register-tab-ipc.js:735`) → `wc.loadURL()`. **Electron does not emit `will-navigate` for a programmatic `loadURL`**, so `guest-wiring.js:236` never runs on this path. The enforcing gate is `register-tab-ipc.js:743-751`, and it is **trust-branched**: `const safe = isInternal ? isInternalPageUrl(args[0]) : isSafeTabUrl(args[0])`, plus an `ownsTab(event, wcId)` check at `:737`. `guest-wiring.js:237-238`'s `will-redirect`/`will-frame-navigate` remain a *second* line for post-`loadURL` redirects, not the first.
  - **The internal branch is structurally unreachable from here**, which is a stronger claim than "the bar is suppressed on internal tabs": internal guests are built with `internal-preload.js` and `contextIsolation: true` (`register-tab-ipc.js:91-100`), so this leg's drag listeners do not exist in them and no drop signal can originate there.
  - **The test must not be vacuous** *(design-review finding)*: `bookmarks-store.js:77-79` defines `validUrl` as `isSafeTabUrl(v) && v !== 'about:blank'`, so a non-`http(s)` bookmark **cannot be stored** — a test that tries to store one asserts nothing. Inject the bad url at the holder/forward layer, or assert the `tab-navigate` gate directly.
- [ ] **AC9** — **Tab-switch-mid-drag is resolved by construction, not by a guard** (the flight's open question): main resolves the target tab from **`event.sender`** — the guest that actually received the drop — and forwards it, rather than the chrome navigating whatever happens to be active at signal time. Whatever the operator did mid-drag, the page they dropped on is the page that navigates. A test covers signal-from-a-non-active-tab.
- [ ] **AC10** — Dropping on the **bar itself** still reorders (leg 3) and does not also navigate; dropping outside both bar and page is inert. No double-handling.
- [ ] **AC11** — `npm test`, `npm run typecheck`, `npm run lint` green; suite count against the **3441** baseline. `renderer.js` stays within budget (1588/1650); DD12 forbids a raise.

## Verification Steps

- AC2–AC7, AC9, AC10 — unit tests with stubbed IPC/DOM
- AC1, AC8 — live against the running app: drag a bookmark onto a page, read the tab's url; the operator gesture half rides the HAT
- AC3 — assert the handler's early return on a non-bookmark `types` set
- AC11 — `npm test`, `npm run typecheck`, `npm run lint`

## Implementation Guidance

1. **Guest preload** (`webview-preload.js`): register on `window`, bubble phase, at document-start.
   - `dragover`: if `types.includes(BOOKMARK_DND_MIME)` → `preventDefault()`. Nothing else.
   - `drop`: if the MIME is absent → return. Otherwise capture what you need into **locals synchronously**, then `setTimeout(…, 0)` and read `e.defaultPrevented` there. Do **not** `preventDefault()`.
   - ⚠ **`dataTransfer` leaves protected mode when dispatch ends** — any `types`/`getData` read inside the deferred callback returns empty. Read synchronously, act late.
   - **Capture `setTimeout` into a module-scoped local at document-start** *(design-review finding)*. `contextIsolation` is off and the handler resolves `window.setTimeout` at *drop* time, long after page scripts have run — a page can monkeypatch it to run synchronously (defeating page-wins) or never (suppressing the navigation). Same annoyance class as `isTrusted`, and the file already has the idiom at `:235-242`.
   - The `isTrusted` capture idiom (`:231-234`) applies as annoyance hardening, honestly labelled as such — not a security boundary, because DD6's design is what makes forgery pointless.

2. **The closest precedent is `guest-vault-gesture`, not the tab bookend** *(design-review finding)*. `register-browser-ipc.js:116-123` is byte-for-byte DD6's shape: a `contextIsolation:false` guest sends a payload-free gesture, main derives the trusted wcId from `event.sender.id` (*"never a renderer-supplied id"*) and forwards a bare trigger to `chromeForTab(wcId)`; `webview-preload.js:195-204` documents the doctrine. It is already unit-covered. Follow it for the signal half, and the tab bookend (`register-tab-ipc.js:640-700`) for the declaration/grace/consume half.

3. **Main**: a new `bookmark-drag-started` / `bookmark-drag-ended` pair on their **own** record field. `registry.getWindowForGuest(wcId)` (`window-registry.js:171`) and `getChromeForTab(wcId)` (`:185`) resolve window and chrome from `event.sender.id` in one step. Verify the sender is a chrome (the same discipline `tab-drag-started` uses for `tabViews`). On the guest signal, resolve the sending guest's owning window and tab from `event.sender`, check the declaration, and forward `{ targetWcId }` to that window's chrome. Clear on a grace timer, per-record, `WeakMap`-keyed — copy the tab bookend's shape rather than inventing one.

4. **Chrome**: `bookmarks-bar.js`'s current `navigate` dep is **active-tab-only**, which contradicts AC9 — the chrome needs a per-wcId dep (`tabNavigate({ wcId, verb: 'loadURL', args: [url] })`). That is a small addition to `renderer.js`'s glue; budget it rather than discover it (DD12: 62 lines). Declare at `dragstart` and end at `dragend`; keep the last resolved bookmark in a small holder that survives `dragend` for the grace window; on the inbound signal, resolve the url from that holder and navigate the named tab through the existing untrusted path.

5. **Order the work so the security tests exist before the happy path** — AC5, AC6, AC8 are the criteria that make this leg safe, and they are cheaper to write first than to retrofit.

## Frame scope — a stated decision, not an omission

`webview-preload.js` runs in **every frame** of a guest webContents — which is why it carries `IS_TOP_FRAME` (`:209`) and gates the vault icon (`:262`), submit capture (`:338`), and the eligibility query on it. This leg **registers in all frames**, deliberately.

Rationale: the signal is bare and main navigates the **tab**, not a frame, so the outcome is identical no matter which frame received the drop — while top-frame-only would make iframe regions inert and the feature would silently fail on iframe-heavy pages (the shape that gets reported as *"drag onto page doesn't work on some sites"*). The cost is that a subframe can also fabricate a signal, which AC6 + AC6b already bound to one navigation per real drag.

## Edge Cases

- **Page consumes the drop** — AC2. The most likely real-world case and the one a synchronous read silently breaks.
- **Fabricated drop, no drag in flight** — AC6; nothing happens.
- **Fabricated drop *during* a real drag** — the operator is already dragging a bookmark; the worst outcome is the navigation they were performing anyway. Stated so the residual is bounded rather than unexamined.
- **`dragend` beats the signal** — AC7's grace window.
- **Drop lands on a non-active tab's guest** — AC9; `event.sender` decides.
- **Burner / internal tab** — the bar is suppressed there, so no drag source exists; assert rather than add a guard.
- **Bookmark deleted mid-drag** — the holder's url is captured at `dragstart`, so the navigation still targets what the operator dragged. Acceptable: they asked for that page.
- **Two windows dragging simultaneously** — declarations are per-record; a `WeakMap` timer per record keeps them independent.
- **Cross-window drop** — a bookmark dragged from window A and released on window B's guest resolves to B, finds no declaration there, and is **refused**. Correct, and stated so it is a deliberate no-op rather than an unexplained one.
- **No double-handling with leg 3, and it is structural** — leg 3's chrome-document `drop` (`bookmarks-bar.js:485-505`) preventDefaults and swallows any non-`reorder` zone, and the guest is a separate `WebContentsView`, so the chrome handler cannot see a guest drop or vice versa (AC10 holds by construction, not by a guard).

## Files Affected

- `src/preload/webview-preload.js` — the two guest listeners. **The bundle is generated** (`scripts/build-preload.mjs`, gitignored, rebuilt at `prestart`/`pretest`, carries a `GENERATED — do not edit` banner) — **do not edit it**; `test/unit/webview-preload-bundle.test.js` rebuilds it hermetically.
- `src/main/register-tab-ipc.js` or a sibling — the bookmark bookend + forwarding
- `src/main/window-registry.js` — the new record field
- `src/preload/chrome-preload.js` — bookend sends + inbound subscriber
- `src/renderer/chrome/bookmarks-bar.js`, `bookmarks-client.js` — declare, hold, navigate
- `src/renderer/renderer.js` — subscription glue only (budget: 62 lines)
- tests: guest gate/discriminator, bookend refusal, grace window, `event.sender` targeting

## Deferred to the HAT

The live gesture confirmations for AC1 and AC2 (a real page with a real dropzone) ride the HAT session, alongside leg 1's two outstanding vault checks. Everything else is agent-verifiable offline.

## Citation Audit

Verified against the working tree with the three landed legs applied.

| Citation | Status |
|---|---|
| `bookmarks-bar.js:180`, `:184`, `:300`, `:308`, `:338-340` | verified |
| `bookmark-drag.js` exports `BOOKMARK_DND_MIME` | verified |
| `register-tab-ipc.js:640-660` (`DRAG_END_GRACE_MS = 1500`, `WeakMap` timers, `tabViews` ownership check) | verified |
| `window-registry.js:99` (`dragWcId`, single slot) | verified |
| `webview-preload.js:231-234` (`isTrusted` capture) | verified |
| **`register-tab-ipc.js:735-755`** — the ACTUAL gate (`ownsTab` `:737`, trust-branched `safe` `:751`) | **corrected** — the first draft named `will-navigate`, which does not fire for programmatic `loadURL` |
| `register-tab-ipc.js:693-700` (consume-on-success), `:663-672` (grace clear), `:91-100` (internal guests are `contextIsolation:true`) | **added** |
| `navigation-controller.js:89` (`tabNavigate` call site); `bookmarks-store.js:77-79` (`validUrl`) | added |
| `register-browser-ipc.js:116-123` + `webview-preload.js:195-204` (the `guest-vault-gesture` bare-signal precedent) | added |
| `window-registry.js:171` (`getWindowForGuest`), `:185` (`getChromeForTab`) | added |
| `webview-preload.js:209` (`IS_TOP_FRAME`), `:235-242` (capture idiom) | added |
| `guest-wiring.js:237-238` (`will-redirect`/`will-frame-navigate` — the *second* line, not the first) | corrected |
| DD5b measurement (29 `dragover`, 0 `drop`) | flight log, Operator Session 3 |

---

## Post-Completion Checklist

- [ ] All acceptance criteria verified
- [ ] Tests passing
- [ ] Update flight-log.md with a leg progress entry
- [ ] Set this leg's status to `landed`
- [ ] Check off this leg in flight.md
- [ ] **Do NOT commit** — this flight batches review and commit after the last autonomous leg
