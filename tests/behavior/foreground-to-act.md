# Behavior Test: Background tab is foregrounded before capture/input

**Slug**: `foreground-to-act`
**Status**: draft
**Created**: 2026-06-13
**Last Run**: 2026-07-08-18-59-14 (pass — see `foreground-to-act/runs/2026-07-08-18-59-14.md`)

> **AUTHORED-ONLY (Flight 3 / leg `behavior-test-specs`).** The surface this spec drives is fully built (Flight 3), so it *could* run — but it is **deferred to Flight 6** (behavior-spec migration) by operator sequencing, and is **not part of Flight 3's acceptance**. Authored now so the Witnessed backing exists; **do not** treat a `/behavior-test foreground-to-act` invocation before Flight 6 as a flight-acceptance run.

## Intent

Verify the DD1/DD5 **foreground-to-act** discipline over the MCP surface: when a **capture or input** tool targets a tab that is currently in the **background**, the engine brings that tab to the **front first**, so the screenshot shows the **target** tab's content (not blank, not the previously-active tab) and the input lands on the **target** tab. This needs a behavior test rather than a unit test because the blank-capture / wrong-tab hazard is a real Chromium compositor/visibility effect (the Flight-1 spike) that only manifests on a live foreground/background guest pair — the unit test fakes `activate` and cannot observe a real composited frame.

> **Scope of "act" — the read/act asymmetry is a CONTRACT LINE, not an accident (M09 F7 DD6).**
> Foreground-to-act is a **capture-and-input** contract; it was never a *read* contract, and under
> multiple windows the two must be stated apart. The governing predicate:
>
> > **An op that needs RENDERED OUTPUT raises the owning window; an op that reads live JS/DOM state
> > does not.**
>
> So `captureScreenshot`, `readAxTree`, `printToPDF`, `findInPage`, `click`, `typeText`, `pressKey`,
> `dragPointer`, and `scroll` **raise**; **`readDom` and `evaluate` do NOT** — they run via
> `executeJavaScript` and work correctly against a background guest. This spec drives only the raising
> ops (capture + input), which is why its steps stand unchanged under DD6. *(Making a **read** steal the
> operator's foreground would be a worse bug than the one this spec protects against — the asymmetry is
> deliberate. `multi-window-automation.md` asserts the no-raise half directly, with a same-run raise as
> its positive control.)*

## Preconditions

- Goldfinch is running via **`npm run dev:automation`** (no `--remote-debugging-port`); MCP server up on `127.0.0.1:$GOLDFINCH_MCP_PORT`.
- An MCP client connected to `http://127.0.0.1:$GOLDFINCH_MCP_PORT/mcp`.
- **Port (load-bearing for every URL below).** Pin the listen port with **`GOLDFINCH_MCP_PORT`** (default `49707`); export it once at launch and reuse it in all client/curl calls.
- **Apparatus note:** the apparatus is the **MCP client over `127.0.0.1:$GOLDFINCH_MCP_PORT`** (app via `npm run dev:automation`), not the `:9222` CDP path. The `chrome-devtools` MCP **does not qualify** (own browser → false pass). Two visually-distinct pages are used so a screenshot can tell A from B (e.g. `https://example.com/` vs `https://example.org/`, which render different headings).

## Observables Required

- mcp (MCP tool results — `openTab` wcIds, `enumerateTabs` `active` flags, image content from `captureScreenshot`, `readDom` snapshots; over the loopback transport)
- browser (rendered tab state — the **pixels** of the captured tab showing the correct page, the live DOM of the target tab after input)

## Steps

| # | Actions | Expected Results |
|---|---------|------------------|
| 1 | **Active-precondition probe.** Connect the MCP client; `initialize`; `tools/list`. | `tools/list` **includes the tools this spec drives**: `openTab`, `activateTab`, `enumerateTabs`, `captureScreenshot`, `click`, `typeText`, `readDom` (presence-checked, not an exact count — the registry total grows independently). **If any are absent, halt.** |
| 2 | `openTab` with a distinctive page **A** (`https://example.com/`) → record wcId **A**. Then `openTab` with a different distinctive page **B** (`https://example.org/`) → record wcId **B**. (B is opened last, so **B ends active / foreground**.) | Both calls return numeric wcIds (not null). `enumerateTabs` shows both; **B** has `active: true`, **A** has `active: false`. (Setup of the background-target condition: A is the background tab.) |
| 3 | With **B** in the foreground, call `captureScreenshot(A)` (target the **background** tab). | The result is an image content block; **the Validator judges the PIXELS: the screenshot shows page A's content** (example.com's "Example Domain") — **not blank/white**, and **not page B's** content. This proves the engine foregrounded A before capturing (DD1 blank-capture / wrong-tab hazard defeated). |
| 4 | Call `enumerateTabs`. | **A** now has `active: true` (the capture's foreground-to-act flipped the active tab); B is no longer active. The `active` flag reflects the foregrounding side effect. |
| 5 | Re-activate **B** (`activateTab(B)`, confirm B active via `enumerateTabs`). Then drive **input** at the now-background **A**: `click(A, x, y)` then `typeText(A, "fg-to-act-input")` (an editable target on A, or any focus-then-type the page accepts). Read back with `readDom(A)`. | The input lands on **A**, not B: `readDom(A)` reflects the typed text / click effect on A's page, and the foreground-to-act brought A to front first (post-input `enumerateTabs` shows **A active**). The input did **not** land on B (B's DOM is unchanged). Proves both capture **and** input honor foreground-to-act for a background target. |

## Out of Scope

- **Invisible/background driving** (**acting** on a tab *without* bringing it to front) — still NOT a capability: every **act** foregrounds. *(Corrected M09 F7 leg 4: this bullet used to add "If a future 'drive without stealing focus' mode is added, cover it separately." **DD6 IS that mode** — for `readDom` and `evaluate`, which read live JS/DOM state and deliberately do **not** raise. It is no longer "future", and it is not covered "separately" by accident: the read/act asymmetry is now a stated contract line — see Intent — and `multi-window-automation.md` asserts the no-raise half. The **act** half of this bullet stands unchanged.)*
- The exact paint-settle delay value (`DEFAULT_PAINT_DELAY_MS` tuning) — a Leg-5 smoke tuning concern, not a behavior assertion here.
- Screenshot **fidelity** beyond "right tab, not blank" (color accuracy, sub-pixel) — out of scope; the assertion is which page is shown.

## Variants (optional)

- N/A. Could parametrize Step 3 over `captureWindow` vs `captureScreenshot` once both foreground paths are confirmed.
