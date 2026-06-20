# Flight Log: Downloads Surface

**Flight**: [Downloads Surface](flight.md)

## Summary

Flight planned 2026-06-19, marked **ready** 2026-06-20 after two architect review cycles (both *approve
with changes*, all issues applied). Adds an app-level, persisted downloads surface
(`goldfinch://downloads`, reached from the kebab menu + `Ctrl+J`) over the existing `will-download`
plumbing, plus the admin-only `downloadsList` automation tool (SC7, SC8 part). Status: `ready`.

---

## Reconnaissance Report

This flight sources its scope from the mission roadmap (Flight 5) and the Flight-4 debrief carry-forward
list, not from a findings-enumerating artifact with cited file:line items. The mission's cited download
plumbing was verified live against current code during planning:

| Item | Classification | Evidence | Note |
|------|---------------|----------|------|
| `will-download` handler exists, session-scoped, URL-keyed, toast-only | `confirmed-live` | `main.js:507` (`wireDownloadHandler`), `:456` `pendingDownloads`, `:526`/`:539` progress/done events | The gap is the model/persistence/UI/tool layer — this flight's scope. |
| Sanitize + traversal-guard + unique-path save helpers | `already-satisfied` (reuse) | `download-path.js` (`sanitizeFilename`, `isWithinDir`, `uniquePath`) | Reused by DD3/DD5; no rework. |
| `show-item-in-folder` reveal | `already-satisfied` (reuse) | `main.js:550` | Reused by DD4; add `open file` (`shell.openPath`) alongside. |
| Single-download path prompts a native save dialog | `confirmed-live` (to change) | `setSaveDialogOptions` in `wireDownloadHandler` | DD5 drops the prompt for the silent default-save (operator confirm). |
| `menuController` graduation (Flight-4 carry-forward) | `confirmed-live` | `renderer.js` IIFE, 4+ consumers; Flight-4 debrief recommendation #1 | Folded in as DD8 (`menu-controller-graduation` leg). |
| `getChromeTarget` admin-only app-level tool (template for `downloadsList`) | `already-satisfied` (template) | `mcp-tools.js:493` `CHROME_TOOLS`, `scope.js` façade admin-only gate | `downloadsList` mirrors this gating (DD6); not a `wcId`-first op. |

No stale/`already-satisfied` work items required retirement from scope.

---

## Decisions Log

- **2026-06-19** — Operator: downloads are **app-level, not jar-level**, and persistence **mimics modern
  browsers** (persisted history, app-level). This **supersedes** the mission Open Question's "session/
  lightweight, defer to jars-lifecycle mission" lean. Rationale: files aren't separable on disk once
  downloaded, so the list carries no per-jar privacy stance. (→ DD3)
- **2026-06-19** — Operator: surface = `goldfinch://downloads` internal page; entry via the **kebab menu +
  `Ctrl+J`**, **no toolbar button** (pins are tab-level, downloads is app-level). (→ DD1, DD2)
- **2026-06-19** — Operator: **full browser-parity** controls. (→ DD4)
- **2026-06-19** — Operator: `downloadsList` automation tool is **admin-key only**. (→ DD6)
- **2026-06-19** — Operator: include the optional **HAT + alignment** leg. (→ legs)
- **2026-06-19** — Operator: **fold `menuController` graduation** into this flight. (→ DD8)
- **2026-06-19** — Planning (flagged for operator confirmation): **Chrome-like silent save to the OS
  Downloads folder, no per-download dialog** (DD5) — follows "mimic modern browsers" and is a feasibility
  prerequisite for the SC8 behavior-test act path (a native dialog is not automation-drivable).
- **2026-06-20** — Operator: **DD5 confirmed** (silent save, keep it).
- **2026-06-20** — Operator: **retention** = JSON store now with a **"Clear now"** button + **500-item
  cap** (prune oldest); **SQLite is the planned future substrate** for storage in general (downloads +
  browsing history) — JSON built behind a narrow repo interface for a localized swap. (→ DD3, DD9; BACKLOG
  seed added)
- **2026-06-20** — Operator: **media-panel downloads are included** in the downloads list (free — same
  `will-download` funnel). (→ DD4)
- **2026-06-20** — Design discussion → **persistence model**: single store, **persist terminal records
  only**, in-progress memory-only (no second file, no restart reconciliation); never-complete handling =
  terminal states persisted/retryable, stalled = user-cancel (no v1 watchdog), crash-mid-download is the
  one accepted history gap. (→ DD3)
- **2026-06-20** — Operator: **remove = history-only** ("Remove from list" + footer note; no "Delete
  file" action this flight). (→ DD4)
- **2026-06-20** — Operator: **seed the SQLite storage-migration mission in `BACKLOG.md`** — done
  (`BACKLOG.md` "Persistent storage substrate: JSON stores → SQLite").

---

## Design Review

- **2026-06-19** — Architect review (1 cycle): **approve with changes**. Two [high] issues, several
  [medium]/[low], all applied to the spec:
  - **[high]** The internal-IPC/preload seam is **single-origin (`settings`) at three points**
    (`internal-preload.js:20`, `internal-ipc.js:18` `INTERNAL_ORIGIN`, `url-safety.js:109`
    `isInternalPageUrl`) — "reuses the hardened seam" hid the real widenings. → DD1 + `downloads-page` leg
    now name all three (CLAUDE.md:80 already prescribes the `isInternalPageUrl` one).
  - **[high]** `downloadsList` admin-only refusal is **not free** — an app-level op left out of
    `WCID_FIRST_OPS` throws the opaque "engine.getDownloadsList is not a function"; needs an explicit jar
    refusal block in `scope.js` (mirror `getChromeTarget:165`) + a dedicated jar-refused unit test (the
    three-place guard only covers wcId-first ops). → DD6 + `downloads-mcp-tool` leg updated.
  - **[medium]** Live-progress push is feasible via `broadcastToChromeAndInternal` (`main.js:798`,
    by session marker not origin) — retire the "request/response only" worry. → DD1/DD3 route events there.
  - **[medium]** Toast-consumer citations corrected (`renderer.js:2580`/`2595`, not 1755/1779) + the
    URL→id bulk-correlation through `pendingDownloads` called out. → DD3.
  - **[medium]** `downloads-model` leg overloaded → split into `downloads-model-store` (main) + action
    handlers folded into `downloads-page` (where exercised).
  - **[medium]** DD5 silent-save also removes native rename/redirect + overwrite handling → `uniquePath`
    dedup is now load-bearing (behavior-test dedup variant kept).
  - **[low]** Cache-freshness/restart contract: `progressing → interrupted` reconciliation in NORMALIZERS,
    throttled progress persistence, source-of-truth declared. → DD3.
  - **[low]** DD2 capture-path wording: the page-focused `before-input-event` is `!__goldfinchInternal`,
    so internal-page `Ctrl+J` relies on the renderer fallback. → DD2.
  - Confirmed sound (no change): the behavior-test act path (`navigate` to a `Content-Disposition:
    attachment` fixture fires `will-download`, completes dialog-free under DD5; internal page truly
    unreadable by automation, so `downloadsList` + filesystem `stat` is the right observable); the
    tool-count ref sites; the DD8 `menuController` extraction plan.
  - Open question resolutions adopted: per-download id = **persisted monotonic counter** (hash collides on
    same-url re-downloads DD5 allows); retry = fresh `downloadURL` re-issue.

- **2026-06-20** — Architect review **cycle 2** (on the storage/retention revisions): **approve with
  changes**. Storage model judged fundamentally sound (terminal-only persistence eliminates
  reconciliation; display merge coherent; repo interface is the right seam; media-panel funneling verified;
  remove-from-list never touches disk verified). Issues applied:
  - **[high]** The monotonic `id` had no persistence home in the repo interface — `max(persisted id)+1` is
    unsafe because the high-id record can be pruned/removed. → DD3 + interface add **`getNextId()`** + a
    persisted **`nextId`** never lowered by prune/remove; folded into the repo interface to keep DD9's
    one-module-swap honest.
  - **[medium]** A stale `progressing → interrupted` reconciliation line in the Technical Approach
    contradicted the revised DD3. → removed.
  - **[medium]** "Crash-only" loss framing was too generous — a normal quit also loses in-progress
    (`before-quit` is sync, the store write is I/O; quit handlers only stop the MCP server). → reframed as
    **any-teardown**, with a best-effort `interrupted` flush noted, contract = "in-progress is not durable."
  - **[low]** "Mirror `settings-store.js`'s DEFAULTS/VALIDATORS/NORMALIZERS" is a poor mechanical fit for
    an array-of-records store. → reworded to reuse its **durability discipline** (electron-free + injected
    path, atomic write, corrupt→empty-list, codec seam), NOT its fixed-key object schema; per-record
    validator + 500-cap clamp on load is the array analogue.
  - **[low]** scope.js path drift → `src/main/automation/scope.js`; `getChromeTarget` refusal at `:168`.
  - Confirmed (no change): `node:sqlite` is available in Electron 42 / Node ≥ 22.12 (zero-dep SQLite path
    open today — BACKLOG seed sharpened); 500-cap "oldest" = by `id`; action handlers tolerate a missing
    id; behavior test still sound (step 6 asserts a *completed* record survives restart).

## Execution Notes

_(append-only during execution)_

### Flight Director Notes

- **2026-06-20** — `/agentic-workflow` started. Phase 1 context loaded: mission `active`, flight
  `ready` → transitioned to **`in-flight`**. Branch `flight/05-downloads-surface` cut from `main`;
  prior `/flight` planning artifacts (flight spec/log, `downloads-surface` behavior-test draft,
  `BACKLOG.md` SQLite seed, mission roadmap annotation) committed as the flight baseline. No legs
  designed yet — starting the leg cycle at leg 1 `downloads-model-store`. Crew per
  `.flightops/agent-crews/leg-execution.md` (Developer = Sonnet, Reviewer = Sonnet). Per the skill:
  per-leg **design** review, but code review + commit **deferred** until after the last autonomous
  leg.
