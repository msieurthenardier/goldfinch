# Behavior Test: Bookmarks in Omnibox Suggestions

**Slug**: `bookmarks-omnibox`
**Status**: active
**Created**: 2026-07-28
**Last Run**: 2026-07-29-23-13-53 (pass, 6/6)

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
| 4 | Open a tab in the **second jar**; focus the address field and type the distinctive bookmark name prefix. | The bookmark row appears in this jar too (bookmarks are app-scoped), still marked as a bookmark; no default-jar **history** rows leak in alongside it (history remains jar-scoped). |
| 5 | Select the bookmark suggestion (keyboard: arrow down to it, Enter). | The current tab navigates to the bookmarked URL, staying in the second jar (observable: the tab's jar indicator is unchanged). |
| 6 | Remove that bookmark (star popover → Remove). Retype the same prefix in the default jar. | The bookmark indicator no longer appears; if the URL exists in this jar's history it may still appear as a plain history row. |

## Out of Scope

- Suggestion ranking beyond "bookmarks lead history" (frecency blending is explicitly not in v1 — DD11)
- Star/popover behavior (see `bookmarks-star-sync`); bar behavior (see `bookmarks-bar`)
- Burner/internal-tab suggestion gating (unchanged; pinned by existing `omnibox-suggestions` spec)
