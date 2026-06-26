# Leg: remove-webview-machinery — Delete the now-vestigial `<webview>` machinery

**Status**: landed
**Flight**: [Tab Surface](../flight.md)

> **Cleanup leg (DD4 Leg-3 half / SC1 source-absence).** With Leg 3 done, **no tab is a `<webview>`**
> (web tabs since Leg 1, internal tabs since Leg 3 — all per-tab `WebContentsView`s, wired explicitly
> in `tab-create`). This leg deletes the machinery that only existed to host `<webview>` guests:
> `webviewTag:true`, the `will-attach-webview` hook, the now-dead `web-contents-created`
> `getType()==='webview'` branch, and the unused preload-path bridge globals. Pure deletion of
> confirmed-dead code — the leg meets SC1's source-absence half outright.

## Objective

Remove every remnant of the `<webview>`-tag substrate so no `<webview>` can be constructed and no
dead `<webview>`-only code remains in the guest path, while leaving the per-tab-view surface (engine,
guest wiring, geometry, the `webview-preload.js`/`internal-preload.js` files that views use as
preloads) fully working. Grep must show zero `webviewTag` / `will-attach-webview` in the tab path; the
app must run with web AND internal tabs browsing as views.

## Context (recon-verified 2026-06-26, branch `b6b1b48`)

**Confirmed dead after Leg 3** (no `<webview>` element is ever created — `grep` for
`createElement('webview')` in the renderer is clean; the renderer `wireWebview` was removed in Leg 3):

- **`webviewTag: true`** — `main.js:417`, in the `chromeView` `webPreferences` (comments `:408–410,416`).
  The only thing it enabled was `<webview>` tags in the chrome doc; none are created now.
- **`will-attach-webview` hook** — `main.js:451–467` (`getChromeContents().on('will-attach-webview', …)`,
  comment block `:443–450`). It applied web/internal `webPreferences` to attaching `<webview>`s; that
  config now lives at construction in `tab-create` (Leg 1 web branch + Leg 3 internal branch). The hook
  **never fires** without `<webview>` attachments.
- **`app.on('web-contents-created')` `getType()==='webview'` branch** — `main.js:659–663`. Its sole body
  is `if (contents.getType() === 'webview') wireGuestContents(contents)`. Guest views (web + internal)
  are wired **explicitly** in `tab-create` (`wireGuestContents(view.webContents)`), and a constructed
  view reports `getType()==='window'`, so this branch never matches. The whole handler is dead.
- **Unused bridge globals** — `chrome-preload.js:146` `webviewPreloadPath` and `:150` `internalPreloadPath`
  (typed at `renderer-globals.d.ts:119`). The renderer set these as `<webview>` `preload` attributes;
  it no longer creates `<webview>`s, so they are unused on the renderer side (main sets each view's
  preload directly via `path.join` — `webview-preload.js` at `main.js:1424`, `internal-preload.js` at the
  Leg-3 internal branch). **Verify no renderer reference before removing.**

**Stays — actively used by views (do NOT remove):**
- `src/preload/webview-preload.js` (the farble main-world preload for **web tab views** — `main.js:1424`).
- `src/preload/internal-preload.js` (the bridge preload for **internal tab views** — Leg-3 branch).
- `wireGuestContents` (called explicitly in `tab-create` for every view).
- The whole per-tab-view surface (registry, accessors, geometry, lifecycle IPC, `wireTabViewEvents`).

**Out of scope — flagged, NOT fixed here (DD6 defers it):** `src/main/automation/find.js:120,170` inject a
script into the chrome renderer that does `document.querySelectorAll('webview')` to attach the
`found-in-page` listener (the D1 automation workaround). With no `<webview>` in the chrome doc this
query now finds nothing, so the **automation `findInPage` MCP op is non-functional** on the view surface.
Per flight **DD6** the `find.js` D1 workaround + the broad MCP parity rework belong to the **mission's
Flight 4/5** (automation parity sweep), not this flight. The user-facing find **bar** is unaffected (Leg
1 re-pointed the `found-in-page` transport for views). Record this as a known deferral; do NOT change
`find.js` here.

## Inputs

- Branch `flight/03-tab-surface` (Legs 1/2/02b/3 landed; all tabs are views).
- Precise removal sites above (recon-verified).

## Outputs

- `webviewTag`, `will-attach-webview`, the dead `web-contents-created` branch, and the unused
  preload-path bridge globals removed.
- App runs; web + internal tabs browse as views; engine + guest wiring intact.
- `grep` clean for `webviewTag` / `will-attach-webview` in the tab path. SC1 source-absence met.

## Acceptance Criteria

- [ ] **AC1 — `webviewTag` gone.** `webviewTag:true` removed from the `chromeView` `webPreferences`
  (`main.js:417`); related comments updated. `grep -rn "webviewTag" src/` → 0 (or only an explanatory
  CHANGELOG/comment, not a live key).
- [ ] **AC2 — `will-attach-webview` hook gone.** The `getChromeContents().on('will-attach-webview', …)`
  block (`main.js:451–467`) and its comment block are removed. `grep -rn "will-attach-webview" src/` →
  no live handler (only incidental comments in unrelated files are acceptable).
- [ ] **AC3 — Dead `web-contents-created` branch gone.** The `app.on('web-contents-created', …)` handler
  whose only body is the `getType()==='webview'` wire (`main.js:659–663`) is removed. `wireGuestContents`
  remains (called from `tab-create`). No guest is left unwired (web + internal views are wired explicitly
  in `tab-create` — verify the explicit calls remain).
- [ ] **AC4 — Unused bridge globals removed.** `webviewPreloadPath` (`chrome-preload.js:146`) and
  `internalPreloadPath` (`chrome-preload.js:150`, `renderer-globals.d.ts:119`) removed **only after**
  confirming zero renderer references (`grep -rn "webviewPreloadPath\|internalPreloadPath" src/`). The
  `webview-preload.js` and `internal-preload.js` **files stay** (used by main for the views).
- [ ] **AC5 — App runs; tabs browse as views.** Web tabs and internal `goldfinch://settings`/`downloads`
  open/browse/switch/close as views; tab strip reflects nav/title/favicon/load; the guest wiring still
  fires (popup-opens-as-tab, blocked-unsafe-nav, context menu, the four internal gates). No `<webview>`
  can be created (the tag is off).
- [ ] **AC6 — `find.js` deferral flagged, not fixed.** The automation `findInPage` `querySelectorAll('webview')`
  dead-query is recorded as a known deferral (DD6 → mission Flight 4/5); `find.js` is unchanged this leg.
- [ ] **AC7 — Gates green.** `npm test`, `npm run typecheck`, `npm run lint`, `npm run a11y` all green;
  Legs 1/2/02b/3 behavior unregressed.

## Verification Steps

- `grep -rn "webviewTag\|will-attach-webview" src/` → no live keys/handlers (incidental comments OK).
- `grep -rn "webviewPreloadPath\|internalPreloadPath" src/` → 0 after removal (confirm 0 renderer refs
  BEFORE removing).
- `grep -rn "getType() === 'webview'\|getType()==='webview'" src/` → 0.
- Runtime: launch `npm run dev:automation`; open a web tab + Settings + Downloads; confirm all browse as
  views, tab strip updates, a popup opens as a tab, an unsafe nav is blocked; internal gates hold.
- `npm test && npm run typecheck && npm run lint && npm run a11y`.

## Implementation Guidance

**Pure deletion. Confirm-dead-then-remove; if any target turns out to be still-referenced, STOP and report.**

1. **Remove `webviewTag:true`** (`main.js:417`) from the `chromeView` `webPreferences`; update the
   comments at `:408–410` and `:416` (drop the `<webview>` rationale; note guests are per-tab views).
2. **Remove the `will-attach-webview` hook** (`main.js:451–467`) and its comment block (`:443–450`).
3. **Remove the dead `web-contents-created` handler** (`main.js:659–663`). Confirm `wireGuestContents`
   is still called explicitly in `tab-create` for both the web and internal branches (it is — do not
   touch those). Leave `wireGuestContents` defined.
4. **Remove the unused bridge globals** — FIRST `grep -rn "webviewPreloadPath\|internalPreloadPath" src/`
   to confirm no renderer/main consumer remains; then remove `webviewPreloadPath`
   (`chrome-preload.js:146`) and `internalPreloadPath` (`chrome-preload.js:150`) and the
   `internalPreloadPath` type (`renderer-globals.d.ts:119`). If any reference remains, STOP and report
   (do not break it).
5. **Do NOT touch** `webview-preload.js`, `internal-preload.js`, `wireGuestContents`, `find.js`, or any
   view-surface code. Leave a flight-log note for the `find.js` automation-find deferral (AC6).
6. **Smoke + full gate.**

## Edge Cases

- **Double-check the explicit `tab-create` wiring survives.** Removing the global `web-contents-created`
  handler must NOT remove the explicit `wireGuestContents` calls in `tab-create` — those are what wire
  guest views now. If a guest view stops receiving popup/nav/context-menu wiring, that's a regression.
- **`webview-preload.js` is misleadingly named but load-bearing** — it's the web view farble preload.
  Removing it (or its `main.js:1424` reference) would break farbling. Only the bridge *global* goes.
- **Incidental comments** mentioning `<webview>` in unrelated files (e.g. `devtools.js`, `find.js`,
  `settings-store.js`, historical comments) are fine to leave; only the live machinery is in scope.
- **`webviewTag` off means `<webview>` tags are inert** — if any stray `<webview>` markup existed it
  would silently fail to upgrade; recon confirms none is created. The a11y/runtime smoke re-confirms.

## Files Affected

- `src/main/main.js` — remove `webviewTag:true`, the `will-attach-webview` hook, the dead
  `web-contents-created` handler; update comments.
- `src/preload/chrome-preload.js` — remove `webviewPreloadPath` + `internalPreloadPath` globals (if
  unreferenced).
- `src/renderer/renderer-globals.d.ts` — remove the `internalPreloadPath` type (and `webviewPreloadPath`
  if typed).
- (No change to `webview-preload.js`, `internal-preload.js`, `find.js`, or the view surface.)

## Post-Completion Checklist

- [ ] AC1–AC7 verified (grep-clean + runtime smoke + gates + a11y)
- [ ] Tests/typecheck/lint/a11y green
- [ ] Flight log updated (machinery removed; globals removed; `find.js` automation-find deferral noted;
  SC1 source-absence met)
- [ ] Leg status `landed` (NOT committed); `[HANDOFF:review-needed]`

## Citation Audit

Citations recon-verified against branch `b6b1b48` on 2026-06-26: `webviewTag:true` `main.js:417`
(comments `:408–410,416`); `will-attach-webview` hook `main.js:451–467` (comment `:443–450`); dead
`web-contents-created` branch `main.js:659–663`; explicit guest wiring retained in `tab-create`
(`wireGuestContents` call, Leg-1/3); web view preload `main.js:1424` (`webview-preload.js`); bridge
globals `chrome-preload.js:146` (`webviewPreloadPath`), `:150` (`internalPreloadPath`), type
`renderer-globals.d.ts:119`; `find.js:120,170` `querySelectorAll('webview')` deferral (DD6). Line
numbers to be re-verified by the implementer.
