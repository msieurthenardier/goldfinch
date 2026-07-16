# Leg: 02-session-persistence-layer

**Status**: completed
**Flight**: [Session Restore](../flight.md)

## Objective

Build the two pure, Electron-free modules session restore stands on — a `session-store.js` disk
store (DD1) and a `session-snapshot.js` builder that turns live window records into the persisted
manifest while dropping burners by the positive persist-jar allowlist (DD2) — each unit-tested
**both directions**, with **no `main.js` wiring** (that is leg 3).

## Context

**Risk: HIGH (recorded in flight-log Flight Director Notes) — privacy-sensitive.** This leg is
where the mission's absolute constraint ("burner ephemerality is structural, not filtered; never a
negative is-not-a-burner check") gets its **first pin against a disk artifact**. Per
`/agentic-workflow` 2a it gets a per-leg design review.

**DD1** — `session-store.js` clones `downloads-store.js`'s durability discipline (Electron-free
`load(userDataPath)`, atomic temp+rename, never-throws→empty, `{serialize,deserialize}` codec seam)
but an **object-schema** snapshot (settings-store's shape — one document replaced wholesale, not an
append log).

**DD2** — the burner drop is **verbatim** `closed-tab-capture.js`'s predicate:
`!tabEntry.trusted && jarsList.find(j => j.partition === tabEntry.partition)`. A tab whose partition
is not a registered jar (burner `burner:<n>`, internal) resolves `null` and is dropped —
**structurally, no negative check.** `captureWindowCloseEntries({tabViews, jarsList, windowId})` is
the sibling to mirror; the session builder is leaner (url + jarId + active only — **no** navEntries,
title, stripIndex, closedAt; DD5 scopes history out).

**No `main.js` wiring here** — the modules are built and unit-tested offline; leg 3 wires
`session-store.load()` at startup, the close-handler write, and the `whenReady` restore.

## Inputs

- `src/main/downloads-store.js` — the durability exemplar (atomic `save`, never-throws `load`,
  codec seam, `SCHEMA_VERSION`).
- `src/main/settings-store.js` — the object-schema exemplar (merge-with-repair, strict per-field
  validation).
- `src/main/closed-tab-capture.js` — the burner allowlist (`captureClosedTabEntry` predicate) and
  the Electron-free-via-injected-handles pattern to mirror.
- `src/main/window-registry.js` — the `WindowRecord` shape the builder consumes: `{ tabViews:
  Map<wcId, {view:{webContents}, partition, trusted, active}>, activeTabWcId }`.
- `test/unit/downloads-store.test.js`, `test/unit/closed-tab-capture.test.js` — house test patterns
  (fakes for webContents, `node:test`, `node:assert/strict`, tmp-dir for the disk store).

## Acceptance Criteria

> **DD10: two readings per state-asserting AC, on the real artifact, both directions.**

- [x] **AC0 — the burner boundary is single-sourced (design-review ruling: FACTOR, not mirror).**
      New neutral pure module `src/main/persist-jar-gate.js` exporting
      `resolvePersistJar(tabEntry, jarsList)` → the resolved **jar or `null`**, body exactly
      `!tabEntry.trusted && jarsList.find(j => j.partition === tabEntry.partition) || null`. **Both**
      `session-snapshot.js` and `closed-tab-capture.js` (`captureClosedTabEntry`) call it instead of
      inlining the predicate — one definition of the security-critical boundary the mission calls
      absolute. `closed-tab-capture.js`'s existing both-directions tests must **re-run green**
      unchanged (they catch any refactor drift). Add `test/unit/persist-jar-gate.test.js` pinning the
      gate **both directions**: a registered-partition non-trusted tab → the jar; a `burner:1`
      partition → `null`; a `trusted:true` tab whose partition IS registered → `null`; empty
      `jarsList` → `null`. **Rationale:** it is incoherent to spend leg 1 killing a latent-defect
      generator while spawning a duplicated security predicate two suites cannot keep in sync.
- [x] **AC1 — `src/main/session-store.js` exists, Electron-free, disk-durable.** Object-schema
      snapshot on disk: `{ version: 1, windows: [ { tabs: [ { url, jarId, active } ] } ] }` in
      `session.json` in the injected `dir`. Shape is **settings-store's object shape** with
      **downloads-store's per-member drop-validator** — **NOT** settings-store's `DEFAULTS`/`VALIDATORS`
      merge loop (session has no fixed keys). API: `load(userDataPath, opts?)` (reads + validates,
      **never throws**), `read()` → the loaded snapshot **or `null` when there is no usable session**
      (missing OR corrupt OR bad-shape OR **zero surviving windows after validation** — so leg 3's
      `if (restoreOn && snapshot)` single truthy gate is provably sufficient and can never boot
      zero windows), `write(snapshot)` → validate + **atomic temp+rename**, `clear()` → remove/empty.
      One `validateSnapshot` function is reused on **load** (load-bearing — untrusted bytes) and
      **write** (belt-and-suspenders): top-level must be a non-array object with a `windows` array;
      per tab `url` and `jarId` are non-empty strings (else drop the tab) and `active` coerces to `!!`;
      per window `tabs` is an array and a **zero-surviving-tab window is dropped**. **Two readings:**
      masked `grep -c "require('electron')" src/main/session-store.js` → **0**; mutate → **1**.
- [x] **AC2 — round-trip + never-throws + atomic + member-validation, unit-tested.** In
      `test/unit/session-store.test.js` (tmp dir; cache-bust per test like `downloads-store.test.js`'s
      `delete require.cache` pattern, since `load`/`read` mutate module state): `write(snap)` then a
      fresh `load()` + `read()` returns an equal snapshot (**round-trip**); a **corrupt** file (garbage
      bytes) → `load()` does not throw and `read()` → null (**both readings**); **missing** file → null;
      **bad top-level shape** (bare array / non-object) → null; a **zero-window** snapshot on disk →
      `read()` → **null** (the boot-safety rule); a **malformed-member** file (a tab with a non-string
      `url`, a window with `tabs: {}`, a zero-tab window) → those members **dropped**, valid siblings
      **kept** (**both directions**); the **codec seam** honored (custom `serialize`/`deserialize`
      passed to `load` is used); **atomic** (no `.tmp` left after `write`).
- [x] **AC3 — `src/main/session-snapshot.js` builds the manifest via the shared gate.**
      `buildSessionSnapshot({ windows, jarsList })` → `{ version: 1, windows: [...] }`. Per window:
      iterate `tabViews`, keep a tab iff `resolvePersistJar(entry, jarsList)` returns a jar (AC0);
      skip a **destroyed** `webContents` (`!wc || wc.isDestroyed()`); emit
      `{ url: wc.getURL(), jarId: jar.id, active: wcId === activeTabWcId }`. **`active` derives from
      `activeTabWcId`, NOT `entry.active`** — codebase trace confirms `entry.active` is write-only in
      main; every authority read uses `activeTabWcId` (`window-census.js`, `move-targets.js`). A window
      with **zero** surviving tabs is **dropped**. Electron-free (injected handles). **Two readings:**
      masked `grep -c "require('electron')" src/main/session-snapshot.js` → **0**; mutate → **1**.
- [x] **AC4 — burner exclusion + active-source pinned BOTH directions.** In
      `test/unit/session-snapshot.test.js` with fakes: one **persist-jar** tab + one **burner**
      (`burner:1`) tab → output has **exactly one** (the persist-jar) (**reading 1**); flip the burner's
      partition to a registered jar → **two** (**reading 2**); flip the persist tab to `trusted:true`
      → dropped despite a resolving partition. **Additions (design review):** a persist-jar tab with
      `isDestroyed()→true` is **skipped**, and a window whose only tab is destroyed is **dropped**;
      **empty `jarsList`** → every window dropped → `{version:1, windows:[]}` (the purest positive-
      allowlist pin — no registered jars ⇒ nothing persisted, never a keep-fallback); the **active tab
      is a burner** that gets filtered → **no** surviving tab marked active (distinct from
      `activeTabWcId===null` → none active — the exact case that makes `wcId===activeTabWcId` correct
      over `entry.active`); a **two-window** input where one window is all-burner (dropped) and one has
      persist tabs → **exactly one** window out. Assert the builder stamps `version: 1` and emits
      `jarId === jar.id` (the resolved id, not the partition string).
- [x] **AC5 — gates green.** `npm test` (state the delta from 1892 — three new suites; note the
      delta is measured for these suites in isolation, the flight-end gate measures the combined tree),
      `npm run lint`, `npm run typecheck` — each **standalone**.

## Out of Scope

- All `main.js` wiring (load at startup, close-handler write, restore) — leg 3.
- The settings toggle — leg 3.
- Behavior tests / live rig — leg 4.
- Navigation history + window geometry — DD5 (not persisted).
- Refactoring `closed-tab-capture.js` — leave the completed F6 module untouched unless the design
  review rules that single-sourcing the allowlist predicate (a shared `isPersistJarTab` helper) is
  worth the touch; default is mirror-with-pointer.

## Verification Steps

1. Both mutation readings per AC in the flight log; masked greps for the Electron-free absence claims.
2. The disk-store tests use a **tmp dir**, never the real userData path, and clean up.
3. `git status --porcelain` — only the four new files (two modules, two tests); no stray artifacts.

## Files Affected

- `src/main/persist-jar-gate.js` (new) — the single-sourced `resolvePersistJar` gate (AC0).
- `src/main/closed-tab-capture.js` (modified) — `captureClosedTabEntry` calls `resolvePersistJar`
  instead of inlining the predicate; **behavior-preserving** (its existing tests re-run green).
- `src/main/session-store.js` (new) — disk store.
- `src/main/session-snapshot.js` (new) — pure builder.
- `test/unit/persist-jar-gate.test.js` (new) — the gate, both directions.
- `test/unit/session-store.test.js` (new).
- `test/unit/session-snapshot.test.js` (new).

## Line Budget (DD11 — CODE lines, comments excluded)

- `persist-jar-gate.js`: **≤ 15 code**. `session-store.js`: **≤ 120 code** (est. ~65–75 — simpler
  than downloads-store: no id/prune/append-log machinery). `session-snapshot.js`: **≤ 45 code**
  (est. ~25–35). `closed-tab-capture.js`: **net ~0** (one inlined line → one call). Exceed ⇒ stop
  and report.

---

## Post-Completion Checklist

- [x] All acceptance criteria verified (both-directions readings recorded)
- [x] Tests passing (delta from 1892 stated; two new suites)
- [x] Update flight-log.md with leg progress entry
- [x] Set this leg's status to `completed`
- [x] Check off this leg in flight.md
- [x] Do NOT commit (flight-end review + single commit per `/agentic-workflow`)
