# Behavior Test: Bookmarks in Omnibox Suggestions

**Slug**: `bookmarks-omnibox`
**Status**: active
**Created**: 2026-07-28
**Last Run**: 2026-08-03-19-43-22 — 6/6 pass ([run log](bookmarks-omnibox/runs/2026-08-03-19-43-22.md))

## Intent

Verifies that bookmarked pages surface in address-bar suggestions: matched by name or URL, visually distinguishable from history entries, deduplicated against history (bookmark row wins), ranked ahead of history matches, and available in every cookie jar (the mission's app-scoped ruling) — while jar-scoped history isolation remains intact. Behavior test because the observable is the rendered suggestions sheet driven by live typing against real history + bookmark state across jars.

## Preconditions

- App running via `npm run dev:automation`; **admin-tier** MCP key verified via `getChromeTarget`
- A bookmark exists with a distinctive name (e.g. `Zephyr Docs` → some stable URL) created in the **default** jar; that URL has also been visited in the default jar (so it exists in default-jar history)
- A second cookie jar exists with no browsing history for that URL
- A second bookmark exists whose URL has **never** been visited (bookmark-only, no history row)
- **A history-only URL** (present in the default jar's history, matching NO bookmark) for step 3's control — enumerate it explicitly; run 2026-07-29 had to discover one live via `getHistory` cross-checked against `bookmarksGet()`
- Apparatus (established run 2026-07-29): the suggestions dropdown and star popover render in the overlay sheet, which refuses ALL automation ops at EVERY tier — sheet content is observable only via `captureWindow` composites (`readAxTree` on the chrome returns the bar/address field but never sheet rows), and interaction inside a sheet is operator-performed. Jar identity has two independent signals: `enumerateTabs[].jarId` and the chrome accent colour (work = yellow/gold, personal = blue/green) — the accent is a free corroborating signal for jar-persistence claims. Every `window.goldfinch.*` read is Promise-based (await it or get `{}` silently)

## Observables Required

- browser (rendered suggestions sheet under the address field, chrome UI — goldfinch MCP chrome target; screenshots primary, accessibility tree secondary)

## Steps

| # | Actions | Expected Results |
|---|---------|------------------|
| 1 | In a default-jar tab, focus the address field and type a prefix of the distinctive bookmark name (e.g. `Zeph`). | The suggestions sheet appears; a row for the bookmarked page is present, carries a visible bookmark indicator distinguishing it from plain history rows, and appears **once only** (no duplicate history row for the same URL) at or near the top of the list. |
| 2 | Clear the field; type a term matching the never-visited bookmark's name. | That bookmark appears as a suggestion despite having no history entry, with the bookmark indicator. |
| 3 | Clear the field; type a term that matches history entries but no bookmark. | Suggestions appear as plain history rows with no bookmark indicator (control step: indicator is bookmark-specific). |
| 4 | Open a tab in the **second jar**; focus the address field and type the distinctive bookmark name prefix. | **No bookmark row appears for it** — bookmarks are jar-scoped as of Flight 2 Leg 3 (M15 F2 L3), and this bookmark was created only in the default jar; only this jar's own history rows (if any) may appear, with no bookmark indicator on them. *(Inverts the prior app-scoped assertion. The complementary "each jar surfaces its own" case lives in `bookmarks-jar-scoping` checkpoint 6; this step is the one-directional non-appearance.)* |
| 5 | **Setup**: create a bookmark in the **second jar**, with its own distinctive name and a URL not previously visited in that jar. Then type its name prefix and select the suggestion (keyboard: arrow down to it, Enter). | The current tab navigates to that bookmarked URL, **staying in the second jar** — jar identity confirmed from `enumerateTabs[].jarId`, corroborated by the chrome accent colour. *(Re-targeted at Flight 2 leg 4. This step formerly selected the **default** jar's bookmark from inside the second jar, which jar scoping now makes impossible by construction. What it actually tests — that activating a suggestion navigates the tab without re-homing it to another jar — is unaffected by the scoping change and is covered nowhere else, which is why it was re-targeted rather than retired.)* |
| 6 | Remove that second-jar bookmark (star popover → Remove; operator-performed). Retype the same prefix **in the second jar**. | The bookmark indicator no longer appears for it; if the URL is now in that jar's history it may still appear as a plain history row, unmarked. *(Re-targeted with step 5 — it formerly retyped in the default jar, which no longer follows once the bookmark being removed belongs to the second jar.)* |

## Out of Scope

- Suggestion ranking beyond "bookmarks lead history" (frecency blending is explicitly not in v1 — DD11)
- Star/popover behavior (see `bookmarks-star-sync`); bar behavior (see `bookmarks-bar`)
- Burner/internal-tab suggestion gating (unchanged; pinned by existing `omnibox-suggestions` spec)
