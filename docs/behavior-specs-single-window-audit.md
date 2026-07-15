# Behavior-Spec Single-Window Audit (M09 F6 — DD8 deliverable)

**Date**: 2026-07-15 (F6 leg 5; source: the F6 recon §8 sweep, 2026-07-14,
updated for everything legs 2–4 changed)
**Scope**: the 46 behavior specs in `tests/behavior/` that predate F6. The
F6-authored `multi-window-shell.md` is multi-window-native and not audited.
**Consumer**: **Flight 7** (multi-window part 2 — overlay multi-instance
conversion, capture semantics, multi-window automation semantics). This audit
is F7's input when it redefines the automation surface; it makes no
recommendation about WHICH semantics F7 should pick, only which specs lean on
which single-window assumption.
**Rule**: specs were **NOT edited** for this audit (DD8). The only F6 spec
edits are two wording-only errata (`tab-context-menu.md` sync-opener
precondition; `find-overlay-geometry.md` step-8 re-seed wording) and
Last-Run header updates from the regression runs — none change an Expected
Result's substance.

## The floor this audit stands on: the F6 interim surface

F6 converted the shell to a window registry but deliberately left multi-window
*automation semantics* to F7 (flight DD8). What changed underneath the specs:

- **The accessor is now LAST-FOCUSED, not "the" window.** `getChromeTarget`,
  `enumerateTabs`, `openTab`, and every strip-level op resolve the
  **main-tracked last-focused window** (seeded at window create AND at
  programmatic `win.focus()` — deterministic under WSLg, where compositor
  focus events may never arrive; membership-validated at read with a
  first-record fallback). With ONE window open this is byte-identical to the
  old singleton — the invariant the leg-2 regression triple and the leg-5
  pair re-run prove.
- **`enumerateTabs` is window-scoped, no longer "silently window-1".** The
  recon's finding ("silently sees only the bound chrome's tabs") is upgraded:
  the enumeration is now *deterministically* the last-focused window's tabs.
  It is still **not** an all-windows census — that redefinition is F7's.
- **Raw-wcId ops are cross-window already.** `isTabViewWcId` is all-windows
  membership; `classifyContents` recognizes every registered chrome; the
  jar-tier chrome-exclusion refuses ANY registered chrome. So
  `evaluate`/`readDom`/`readAxTree`/`pressKey`/`click`/`navigate`/
  `captureScreenshot` against an explicit wcId work regardless of which
  window owns it (window-2 chromes resolve at the admin tier, like the
  sheet).
- **`captureWindow` is UNCHANGED — the named F7 item.** It binds
  win/chrome/active-tab to ONE accessor-resolved record, and its
  desktopCapturer best-size-match heuristic can capture the **wrong** of two
  similar windows (recon surprise 3 — pre-existing, unfixed by design). Any
  spec calling `captureWindow` is exposed the moment a second window exists.
- **The sheet and find overlay are ROAMING SINGLETONS (DD7 interim).** One
  instance each, attaching to the requesting window at show time with
  attachment tracking. The probe-walk discovery idiom ("probe once per run,
  skip every `enumerateTabs` wcId + the chrome") still finds THE one sheet —
  but its skip set is built from a window-scoped enumeration, and F7's
  per-window instances will break "discover once" outright.

## Classification taxonomy (DD8)

A spec can carry multiple classes.

| Class | Meaning | Why it breaks with N windows |
|---|---|---|
| **probe-walk** | Discovers the sheet / find-overlay wcId by walking the id space, skipping every `enumerateTabs` wcId + the chrome | The skip set comes from a **window-scoped** `enumerateTabs` — another window's background tabs are NOT in it, and probing one **activates it** (foreground-first eval ops). Also assumes ONE sheet ("discover once per run") — true in F6's roaming interim, false under F7 per-window instances |
| **getChromeTarget** | Uses `getChromeTarget()` as "THE chrome" (tab rects, strip census, evaluate-seam calls, `jarsList`, focus reads) | Under F6 it returns the last-focused window's chrome — deterministic but window-scoped. A spec that treats it as the app's only chrome mis-scopes every read/act the moment a second window is last-focused |
| **captureWindow** | Calls `captureWindow` (whole-window composite) and/or asserts window-level state (bounds, maximize, focus rings, a detached OS window) | `captureWindow` composites ONE accessor-resolved record and can desktopCapturer-mis-pick between two similar windows; window-bounds/maximize/focus observables become per-window questions |
| **count-precondition** | Exact tab-count or byte-identical-census assertions that implicitly mean "all tabs in the app" | `enumerateTabs` is a per-window census; the assertions stay valid only while the run keeps exactly one window (they do NOT see another window's tabs — silent under-count, not over-count) |
| **none** | No window-coupled assumption | Safe as-is under N windows |

**Occurrence-sweep note.** The recon estimated "~18" captureWindow-class
specs; this audit's exhaustive grep sweep marks **every** spec that calls
`captureWindow` (26), flagging corroboration-only usage where the spec's own
text scopes it that way. The class marks *exposure* — `captureWindow` itself
changes meaning under N windows regardless of how load-bearing the call is.
The getChromeTarget class count (33) matches the recon's exactly; the three
coupled-but-no-getChromeTarget specs are `foreground-to-act`,
`mcp-auth-gating`, and `mcp-jar-scoping` (tier/foreground semantics, below).

## Per-spec classification (46 specs)

| Spec | Classes | Notes |
|---|---|---|
| `automation-key-gating` | getChromeTarget | `captureWindow` appears only as an auth-gate probe (does the op answer at all), not window pixels |
| `chrome-guest-keyboard-nav` | getChromeTarget, captureWindow | Chrome↔guest focus handoffs; window pixels corroborate focus location |
| `closed-tab-reopen` | probe-walk, getChromeTarget, count-precondition | Step 2's **byte-identical** `enumerateTabs` equality + full-URL-list "NOWHERE" checks (steps 7–8) are app-census assumptions; Out of Scope already says "single window this mission". `captureWindow` is corroboration-only (sheet open/closed). **Leg-3 update**: the reopen pop rule is now windowId-gated (same-window `stripIndex` honored, else append) — single-window behavior identical; the step-4 position-P assertion remains valid |
| `core-browsing-shields` | getChromeTarget, captureWindow | Shields/panel pixel checks against the one window |
| `devtools-cdp-conflict` | getChromeTarget, captureWindow | No `captureWindow` calls, but asserts a **detached DevTools OS window** materializing — a window-level observable (macOS-authoritative); "which window owns the conflict" becomes a real question with N windows |
| `downloads-surface` | none | App-level downloads model; no window coupling |
| `farbling-correctness` | none | Per-guest farbling reads by wcId |
| `find-in-page` | none | Find engine results by wcId |
| `find-overlay-geometry` | probe-walk, getChromeTarget, captureWindow | `captureWindow` is **authoritative** for geometry (float, position-sync, maximize tracking); overlay wcId probe walk; maximize/resize are window-level. **Leg-2/-4 update**: the overlay now has attachment tracking and roams (DD7 interim) — single-window identical, re-proven at the leg-2 triple; NEW apparatus caveat recorded 2026-07-15: WSLg Wayland maximize lag-by-one. F7's per-window find instances hit this spec first |
| `foreground-to-act` | captureWindow | No `getChromeTarget`; the spec pins the **foreground-first activation contract** itself — with N windows, "activate" is per-window raise and the contract needs restating (F7) |
| `history-automation-isolation` | none | Store-level isolation |
| `history-recording` | none | Recorder gates by partition/scheme |
| `internal-session-exclusion` | none | Session-identity refusals |
| `internal-tab-menus` | probe-walk, getChromeTarget, captureWindow | Sheet-over-internal-tab pixel checks |
| `jar-data-controls` | getChromeTarget | Chrome evaluate-seam (`jarsList` etc.); data assertions are session-level |
| `jar-delete-closes-tabs` | getChromeTarget | Chrome-driven jar delete; tab-closure census via enumeration |
| `jar-key-revocation-on-delete` | getChromeTarget | Chrome-driven; key/auth assertions are app-level |
| `kebab-menu` | probe-walk, getChromeTarget, captureWindow, count-precondition | Tab count as a negative control (Settings/Downloads open internal tabs); menu pixel checks. **Leg-4 update**: the kebab model gained **New window** as its FIRST item — any exact-item read of the kebab is now stale-by-one (this spec reads the model live; verify on next run) |
| `mcp-auth-gating` | none *(tier probes only)* | `captureWindow` appears once as an auth probe; no window-state assertion. Recon classed it coupled; the coupling is the **op tier**, which F7's captureWindow redefinition must preserve (admin-only refusal shape) |
| `mcp-drive-end-to-end` | getChromeTarget, captureWindow | The surface smoke — inherits whatever semantics F7 defines; cheap to re-point |
| `mcp-jar-scoping` | captureWindow *(tier semantics)* | `captureWindow` exercised as the **admin-only refusal** for jar keys — F7 must keep the refusal shape distinct (`admin-only`, not `out-of-jar`) whatever the multi-window capture signature becomes |
| `mcp-loopback-origin-guard` | none | Transport-level |
| `menu-dismissal` | probe-walk, getChromeTarget, captureWindow | Blur/outside-click dismissal — **F6 conditioned window `blur` on the sheet's attachment window (DD7)**; single-window identical, but the dismissal matrix becomes per-window under F7 |
| `menu-overlay` | probe-walk, getChromeTarget, captureWindow | The sheet's own compositing spec; "the ONE sheet" premise is load-bearing — first in line when F7 goes per-window |
| `new-tab-default-routing` | getChromeTarget | Default-jar routing via chrome-driven opens |
| `observe-refusal-contract` | none | Refusal-shape contract by wcId |
| `omnibox-suggestions` | probe-walk, getChromeTarget | Suggestions render on the sheet (probe walk); `captureWindow` corroboration-only |
| `page-context-menu` | probe-walk, getChromeTarget, captureWindow | Guest→main→chrome forward is now owner-routed (class 3) — single-window identical |
| `page-zoom` | none | Per-wcId zoom ops |
| `panel-slide` | getChromeTarget, captureWindow | Panel geometry against the one window's pixels (authoritative captures) |
| `popup-jar-inheritance` | getChromeTarget, count-precondition | Step 5's **total tab count = boot + 4** is an app-census assumption — OUTRIGHT FAILS if any tab lives in another window |
| `print-to-pdf` | none | Per-wcId print |
| `responsive-tab-strip` | getChromeTarget, captureWindow | Strip disclosure stages vs **window width** — authoritative window pixels + resize |
| `settings-activity-viewer` | getChromeTarget, captureWindow | Settings page + chrome indicator reads |
| `settings-automation` | getChromeTarget, captureWindow | Settings-page automation controls; heaviest getChromeTarget user (11 refs) |
| `settings-controls` | getChromeTarget, captureWindow | Settings page controls |
| `settings-shell` | getChromeTarget, captureWindow | Settings shell/nav pixels |
| `spellcheck` | getChromeTarget, captureWindow | Context-menu suggestions ride the sheet path via chrome |
| `tab-context-menu` | probe-walk, getChromeTarget | `captureWindow` corroboration-only. **Leg-3 update**: the opener is now SYNCHRONOUS (DD6 push-cache) — the stale async precondition bullet is fixed by this leg's wording erratum. **Leg-4 update — flagged for the next run**: the model gained `tab:move-new-window` (present for non-last, non-internal tabs), so step 3's EXACT item list (`Close, Close other tabs, Close tabs to the right, Duplicate`) no longer matches the live menu (it now includes **Move to new window**); step 9's sole-tab list is unaffected (`isLastTab` omission). The spec's own Out of Scope anticipated exactly this ("deliberately absent from the model until the multi-window flights add it") — the exact-items row needs a spec update ruling at the flight-end re-run, which is beyond F6's wording-only edit budget |
| `tab-cycling` | probe-walk, getChromeTarget | Cycle/jump land on the chrome + sheet accelerator path; `captureWindow` corroboration-only. **Leg-4 update**: the sheet accelerator now resolves the ATTACHMENT window's chrome/active tab — single-window identical |
| `tab-keyboard-operability` | getChromeTarget, captureWindow, count-precondition | Tab-count deltas (steps 3/5) + focus-ring **pixel** deltas via `captureWindow` |
| `tab-reorder` | getChromeTarget, captureWindow | Strip DOM order + drag pixels in the one window |
| `tab-scheme-guard` | getChromeTarget, captureWindow | Chrome-driven URL entry; pixel corroboration |
| `tab-surface-geometry` | getChromeTarget, captureWindow | Guest-surface compositing vs window geometry — authoritative window pixels |
| `toolbar-pins` | getChromeTarget, captureWindow | Heaviest `captureWindow` user (16 refs); toolbar pixels + settings sync |
| `unified-tab-controls` | getChromeTarget, captureWindow, count-precondition | Exact tab-count increments (steps 3–5) + pill/focus-ring pixels |

**Class totals**: probe-walk **10** · getChromeTarget **33** (matches the
recon exactly) · captureWindow **26** (of which ~6 corroboration-only) ·
count-precondition **5** (`closed-tab-reopen`, `kebab-menu`,
`popup-jar-inheritance`, `tab-keyboard-operability`,
`unified-tab-controls`) · none **10** (`downloads-surface`,
`farbling-correctness`, `find-in-page`, `history-automation-isolation`,
`history-recording`, `internal-session-exclusion`,
`mcp-loopback-origin-guard`, `observe-refusal-contract`, `page-zoom`,
`print-to-pdf`). `mcp-auth-gating` sits between classes: the recon counted it
coupled, but its only exposure is the **op tier** — this audit reclassifies
it (with `mcp-jar-scoping`) as a **tier-contract** spec, not a
window-semantics spec: F7's capture redefinition must preserve the refusal
shapes, nothing else.

## What legs 2–4 changed under the corpus (and what they did not)

1. **Nothing in the corpus was edited** (except the two wording errata + Last
   Run headers). The single-window invariant — one window open ⇒
   byte-identical behavior — was proven live: the leg-2 regression triple
   (`tab-context-menu` 10/10, `closed-tab-reopen` 9/9,
   `find-overlay-geometry` all checkpoints) ran against the full registry
   conversion, specs unmodified; the leg-5 pair re-run (FD-orchestrated)
   re-proves it after legs 3–4.
2. **Two model enumerations grew** (leg 4): the kebab gained **New window**
   (first item) and the tab-context menu gained **Move to new window**.
   Specs pinning EXACT item lists on those menus (`tab-context-menu` step 3;
   any exact kebab read) are stale-by-one-item against the live product —
   see the per-spec notes above. This is deliberate feature growth hitting
   exact-enumeration assertions, not a regression.
3. **The opener went synchronous** (leg 3, DD6): `tab-context-menu`'s
   async-opener precondition was the only spec text describing the old shape;
   fixed by this leg's erratum. Specs that poll the sheet keep passing (a
   poll resolves instantly on the first read).
4. **`find-overlay-geometry`** picked up a run-log-recorded apparatus caveat
   (WSLg Wayland maximize lag-by-one) and this leg's step-8 wording erratum
   (reopen state = query re-seeded and fully selected, not "fresh/reset").

## F7 consumption note

What F7 must decide, and which specs it touches when it does:

- **`enumerateTabs` scope** — per-window (status quo, but selectable?) vs
  all-windows with a `windowId` field. The 5 count-precondition specs and
  every probe-walk skip set consume the answer. The renderer `listTabs`
  creation-order ruling (CLAUDE.md) pre-registered this exact revisit.
- **`getChromeTarget` arity** — one accessor-resolved chrome (status quo) vs
  enumerable chromes (`getChromeTargets()`?) vs a `windowId` parameter. All
  33 getChromeTarget specs consume the answer; most only need "the chrome I
  was already driving" to stay stable within a single-window run.
- **`captureWindow` signature** — must gain a window discriminator (or be
  deprecated for per-wcId `captureScreenshot` composites). Until then the
  best-size-match mis-pick stands (recon surprise 3). The 26
  captureWindow-class specs consume this; `mcp-jar-scoping`/
  `mcp-auth-gating` additionally pin the admin-only refusal shape.
- **Overlay discovery** — F7's per-window sheet/find instances break both
  probe-walk premises ("one sheet", "skip = enumerateTabs + chrome"). A
  first-class discovery op (or per-window overlay enumeration at admin tier)
  would retire the walk; otherwise every probe-walk spec needs an
  all-windows tab census to build its skip set. The 10 probe-walk specs
  consume this.
- **Foreground-to-act under N windows** — "activate" today raises within the
  owning window and the accessor followed focus-seeding; F7 should restate
  the contract (does acting on window-B's background tab raise window B?).
  `foreground-to-act` pins whatever is decided.
- **Capture-vs-re-parent race** — the leg-1 spike anomaly (a `capturePage`
  on a DETACHED WebContentsView never resolves) is a standing input to F7's
  capture semantics: any capture path that can race a re-parent/hide needs a
  timeout guard.
- **Spec-update sequencing** — when F7 redefines the surface, update specs in
  this order: the 2 stale-enumeration rows (`tab-context-menu` step 3, kebab
  exact reads) are already due; then the 10 probe-walk specs (mechanical
  skip-set fix); then the 5 count-precondition specs (restate as per-window
  censuses); the pure-pixel captureWindow specs last (they need the new
  capture op). The 10 `none` specs need nothing.
