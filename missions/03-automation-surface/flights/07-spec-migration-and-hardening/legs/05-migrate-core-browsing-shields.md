# Leg: migrate-core-browsing-shields

**Status**: completed
**Flight**: [Bulk spec migration + ungated-path hardening (scoped)](../flight.md)

## Objective
Migrate `core-browsing-shields` from CDP-`:9222` onto the admin MCP surface as an **admin** spec (DD2): drive the guest navigation via `openTab`/`navigate`, read the param-strip result from the guest `wcId`, and read the chrome **privacy-panel** blocked-tracker count via `getChromeTarget`+`readDom` — eval-free (DD2 premise audit confirmed).

## Context
- **DD2** (flight): `core-browsing-shields` is NOT pure guest-driving — its key assertion (Step 5 tracker-block) reads the **chrome** privacy panel (`.tag.blk`/`#privacy-count`), reachable only via `getChromeTarget`+`readDom` (admin); a jar key is refused (`scope.js:149`). So it runs as an **admin** spec: `openTab` for the guest nav + guest-`wcId` `readDom` for the URL/param result + `getChromeTarget`+`readDom` for the chrome privacy-panel block count. (One identity — simpler than a two-client spec — and correct because the spec asserts chrome-visible state, not jar isolation.)
- **Eval-free (DD2 premise audit)**: Step 5's old apparatus used `Runtime.evaluate document.querySelectorAll('.tag.blk').length` / `document.getElementById('privacy-count').textContent` — but those are just DOM queries; the `.tag.blk` tags + `#privacy-count` text are **static rendered elements in the chrome's `outerHTML`** (once the panel is open), so they migrate to `readDom(chromeWcId)` (count `.tag.blk` occurrences / read `#privacy-count` text in the returned HTML). The Step-4 param-strip result is the webview's `location.href` → `readDom(guestWcId).url`. No script-runtime read.
- This leg is **spec-authoring only** (markdown). Live runs are leg 8. Pure edits; no source.
- **`dev:debug`/`:9222` stays alive** through F7 for un-migrated/deferred items (hardened at leg 7).

## Inputs
- `tests/behavior/core-browsing-shields.md` (status `active`, Last Run 2026-06-05 pass 5/5) — post-Electron-upgrade smoke: app launches, a tab navigates + renders, Shields **block a known tracker** (`google-analytics.com` via `trackers.js`) + **strip tracking params** (`utm_*` stripped, `q=keep` preserved), multi-tab. Currently `:9222`/CDP; a served local HTTP fixture (tracker script + utm params) at `127.0.0.1:8080`.
- **Proven apparatus** (F6 + legs 2–4): `npm run dev:automation` + `GOLDFINCH_AUTOMATION_DEV_MINT=1 GOLDFINCH_AUTOMATION_ADMIN=1 GOLDFINCH_MCP_PORT={port}`; admin MCP client on `127.0.0.1:{port}/mcp`.
- The served HTTP fixture (unchanged — a shell precondition; **keep the fixture port distinct from `{port}`**, e.g. `8080`).

## The apparatus mapping (CDP-`:9222` → admin MCP surface)
| Old (CDP/`:9222`) | New (admin MCP surface) |
|---|---|
| `npm run dev:debug` (`:9222`) | `npm run dev:automation` + dev-mint/admin env + `GOLDFINCH_MCP_PORT={port}` |
| probe `curl :9222/json/version` + list CDP targets | `tools/list` (17) + `getChromeTarget()` → chrome `wcId`; `enumerateTabs()` shows the guest(s) |
| open/navigate a tab | `openTab(url)` → guest `wcId`; `navigate(guestWcId, url)` |
| webview body / `src` / address-bar URL | `readDom(guestWcId)` → `{ url, title, html }` (body text in `html`, current URL in `url`); chrome address bar via `getChromeTarget`+`readDom` if needed |
| Step 5: `Runtime.evaluate` `.tag.blk` count / `#privacy-count` text | open the panel (`click #toggle-privacy` on the **chrome** `wcId`, coordinate via `captureWindow` — both admin-gated), then `readDom(chromeWcId)` → **primary witness**: a `class="tag blk"` row naming `google-analytics.com` (the blocked tracker) in the returned `outerHTML` (eval-free — static rendered tags, present only when the panel is open). **Secondary cross-check**: `#privacy-count` is the **toolbar badge** (`<span id="privacy-count" class="tb-badge">`) whose `textContent` is a **bare integer** of *total* trackers (blocked+allowed), `.hidden` when zero — NOT "Shield (N)"; treat it as a ≥1 corroboration only, not the blocked-specific assertion |
| poll `:9222/json` for a second `webview` target | poll `enumerateTabs()` until a second guest appears; switch via `activateTab` |
| `chrome-devtools` MCP disqualified (implied) | **still disqualified** (launches its own browser → false pass) — keep/add the warning |

## Outputs
- Preconditions/Observables/Step-1 probe rewritten to the admin MCP surface; the served-fixture shell precondition kept (port distinct from `{port}`).
- Step 2 (launch smoke) → `getChromeTarget` (chrome `wcId`) + `enumerateTabs` (≥1 guest). Step 3 → `openTab('https://example.com/')` + `readDom(guestWcId)` body "Example Domain" + URL. Step 4 → `navigate`/`openTab` the fixture with utm params + `readDom(guestWcId).url` shows `utm_source` stripped, `q=keep` kept (the "don't assert the privacy aggregate `stripped` count" note preserved). **Step 5** → open the chrome privacy panel (`click` on chrome) + `readDom(chromeWcId)` `.tag.blk` count ≥1 / `#privacy-count` text (eval-free). Step 6 → second `openTab` + poll `enumerateTabs` for two guests + `activateTab`.
- **Admin requirement** noted in Preconditions (chrome privacy-panel read needs `getChromeTarget` = admin-only; a jar key is refused).
- The focus-anchor + coordinate-click notes added; `chrome-devtools`-disqualified warning present; `**Last Run**` left as-is; status stays `active`.
- Other specs' `:9222` untouched.

## Acceptance Criteria
- [x] **AC1 (apparatus rewritten)** — Preconditions + Observables + Step-1 probe reference the admin MCP surface instead of `dev:debug`/`:9222`/CDP. The served-fixture shell precondition is preserved (distinct port). The `chrome-devtools`-disqualified warning is present.
- [x] **AC2 (admin spec shape, DD2)** — The spec runs as **admin**: guest nav via `openTab`/`navigate`; the Step-5 chrome privacy-panel read via `getChromeTarget`+`readDom`. Preconditions note the admin-key requirement (jar key refused `getChromeTarget`).
- [x] **AC3 (Step 5 eval-free, correct witness)** — The blocked-tracker assertion reads a `class="tag blk"` row naming `google-analytics.com` from `readDom(chromeWcId)` **after opening the panel** (coordinate `click #toggle-privacy`), NOT in-page `Runtime.evaluate`. `#privacy-count` (toolbar badge, bare-integer *total* count, `.hidden` at zero) is at most a secondary ≥1 cross-check — the old "shows `Shield (N)`" wording is dropped as inaccurate. No script-runtime read remains.
- [x] **AC4 (param-strip via readDom.url)** — Step 4 asserts the stripped URL via `readDom(guestWcId).url` (or `enumerateTabs` url) — `utm_source` gone, `q=keep` kept; the "don't assert the privacy-aggregate `stripped` count (0 for mainFrame)" note is preserved.
- [x] **AC5 (semantics preserved)** — Every step's Action/Expected intent unchanged; only apparatus framing + mechanism words change. No checkpoint added or dropped.
- [x] **AC6 (no stray old-apparatus refs)** — `grep -n "9222\|cdp-driver\|dev:debug\|remote-debugging" tests/behavior/core-browsing-shields.md` returns nothing (the fixture port `8080` and `{port}` carry no match).
- [x] **AC7** — `npm test`/typecheck/lint unaffected (spec doc; expect green).

## Verification Steps
- AC1–AC5: read the rewritten spec; confirm admin-spec shape, Step-5 eval-free via `readDom(chromeWcId)`, Step-4 URL-strip via `readDom(guestWcId).url`, preserved semantics.
- AC6: `grep -n "9222\|cdp-driver\|dev:debug\|remote-debugging" tests/behavior/core-browsing-shields.md` — empty.
- AC7: `npm test && npm run typecheck && npm run lint`.
- **Live confirmation is leg 8.**

## Implementation Guidance
1. **Preconditions/Step-1** → MCP-surface framing (legs 2–4 style); probe = `tools/list`(17) + `getChromeTarget` returns chrome `wcId` + the served fixture HTTP 200. Note the admin-key requirement (DD2). Keep the served-fixture instructions (tracker `<script>` + `utm_*` params) and the distinct-port caveat.
2. **Step 2** (launch smoke): `getChromeTarget` (chrome `wcId` present) + `enumerateTabs` (≥1 guest) ⇒ the app started cleanly on the new Electron.
3. **Step 3**: `openTab('https://example.com/')` → guest `wcId`; `readDom(guestWcId)` — `html` contains "Example Domain", `url` is `https://example.com/`.
4. **Step 4**: navigate the guest to `http://127.0.0.1:8080/?utm_source=test&q=keep`; `readDom(guestWcId).url` shows the param **stripped** (`utm_source` gone, `q=keep` kept). Preserve the note: do NOT assert the privacy aggregate's `stripped` count (0 for mainFrame by design).
5. **Step 5** (the DD2 key step): on the **chrome** `wcId`, take a `captureWindow` screenshot (admin-gated), locate + `click` `#toggle-privacy` (open the panel if collapsed), then `readDom(chromeWcId)` and assert a `class="tag blk"` row names `google-analytics.com` (the blocked tracker — the primary, blocked-specific witness). Optionally cross-check the `#privacy-count` toolbar badge reads a bare integer ≥1 (total trackers; NOT "Shield (N)"). State explicitly this is `readDom`, not eval — the rendered tags are in the chrome `outerHTML` once the panel is open. (Both `getChromeTarget` and `captureWindow` are admin-gated — the chrome-coordinate-click path is wholly admin-dependent.)
6. **Step 6**: second `openTab`; poll `enumerateTabs()` (with a timeout) until two guests appear; `activateTab` to switch. No crash.
7. **Do NOT** touch `Last Run`, `## Out of Scope`, or other specs' `:9222`.

## Edge Cases
- **Panel must be open before the Step-5 read**: `.tag.blk`/`#privacy-count` are rendered only with the panel open (the spec already says so) — `click #toggle-privacy` first, then `readDom`. A read before opening returns no tags.
- **Counting `.tag.blk` in outerHTML**: the Validator counts occurrences of the `tag blk` class in the returned `html` (or finds `google-analytics.com`); this is a static-markup read (attribute-serialized) — unlike form-control `.checked`/`.value`, no property-vs-attribute concern here.
- **Fixture port vs `{port}`**: keep them distinct (e.g. fixture `8080`, MCP `{port}`); never reuse `:9222`. **Rewrite the rationale prose too** — the current spec says "use a port other than 9222 (the CDP port)"; that literal `9222` in prose must become "distinct from `{port}` (the MCP port)" or it trips the AC6 grep.
- **Admin-only**: the chrome privacy-panel read needs `getChromeTarget` (admin). Note in Preconditions; a jar key would be refused.
- **Address-bar vs guest URL**: Step 3/4's "address bar shows X" can be read from the guest `wcId`'s `readDom.url` (the authoritative current URL) and/or the chrome address bar via `getChromeTarget`+`readDom` — prefer the guest `url` as the load-bearing witness.

## Files Affected
- `tests/behavior/core-browsing-shields.md` — apparatus → admin MCP surface (admin spec; Step-5 eval-free via chrome `readDom`).

---

## Post-Completion Checklist

**Complete ALL steps before signaling `[COMPLETE:leg]`:**

- [x] All acceptance criteria verified
- [x] `grep` over the spec shows no `9222`/`cdp-driver`/`dev:debug`/`remote-debugging`
- [x] `npm test`/typecheck/lint green (sanity)
- [x] Update flight-log.md with leg progress entry
- [x] Set this leg's status to `landed`
- [x] Check off this leg in flight.md (at flight commit)
- [x] Batched flight — do NOT commit per-leg (committed with the Phase-2d review block)

## Citation Audit
To verify at design-review time (2026-06-16): admin-spec shape = flight DD2 + Architect notes; `getChromeTarget` admin-gated (`scope.js:149`); the privacy-panel `.tag.blk`/`#privacy-count` are rendered DOM (spec Step 5 — confirmed against the chrome renderer privacy panel); tracker `google-analytics.com` in `src/main/trackers.js`. Spec current apparatus (`:9222`/CDP, served fixture) confirmed. The design-review Developer cross-checks the Step-5 eval-free claim (`.tag.blk`/`#privacy-count` truly in `outerHTML` once the panel is open) and the admin-spec routing.
