# Leg: hat-and-alignment

**Status**: ready
**Flight**: [Chrome Password Import](../flight.md)

## Objective

A guided human acceptance test of the Chrome password import on a REAL
Chrome export in the running app — items land, re-import dedupes, the
outcome report reads true, degenerate rows are reported, Replace/Merge
behave, the export-file guidance shows, and the cross-process held-record
seams (lock, window close) drop live — with any look-and-feel fix applied
inline.

## Context

- Interactive leg (`hat-*`): NO autonomous Developer/Reviewer cycle. The
  Flight Director presents one step at a time; the operator performs it
  and reports; failures are diagnosed and fixed inline (a Developer spawn
  only when code changes are needed), then that step is re-verified before
  moving on. Fix-vs-feature gate: a look-and-feel FIX rides inline; a new
  behavior (FEATURE) is promoted to a scoped design review first. A
  cosmetic fix that spans more than the vault page (chrome, main wiring,
  another internal page) gets a lightweight design-review pass before the
  implementing spawn.
- Landed code under test: flight commit `4d1303d` (+ the log follow-up),
  draft PR #208. Both autonomous legs `completed`; green bar 4424/4424.
- Real credentials are in play: the export file is produced and deleted by
  the operator, never committed, never pasted into this log. Report
  results in words and counts only.
- The vault page is internal-session and not axe-auditable; this HAT is
  the live keyboard/label check for the new modals (Tab order through the
  pick → destination → completion modals; Escape closes; labels read).

## Inputs

- The app launched from this branch (`npm start`, or `npm run
  dev:automation` if the operator prefers the dev profile — the import
  path itself has no automation surface, so either works; the dev profile
  is isolated, which keeps the real vault untouched during the HAT).
- A vault that is set up and unlocked (a throwaway dev-profile vault is
  ideal), with at least one persistent jar (name == slug is not required
  here).
- A real Chrome password export: `chrome://password-manager` → Settings →
  Export passwords → save the CSV. Ideally it contains ≥ 5 logins across
  several origins, at least one with a note, at least one with an empty
  username, and (common in real exports) at least one `android://` row.
- Note the export's row count from Chrome before importing (for the
  count checks below).

## Acceptance Criteria (= verification steps, one at a time)

- [ ] **S1 Affordance + guidance.** On `goldfinch://vault` → Settings →
      Import / Export, an "Import from a browser…" button is present while
      unlocked and ABSENT while locked (lock the vault, check, unlock). The
      pick modal's lede names `chrome://password-manager` and "Export
      passwords".
- [ ] **S2 Pick + refusals.** Choosing a non-CSV file (e.g. any `.txt`)
      shows "That file isn't a Chrome password export." with Continue
      disabled; choosing the real export shows "N logins found" (+ "M rows
      can't be imported" if any) with Continue enabled. N + M equals
      Chrome's row count.
- [ ] **S3 Destination modal.** The summary lists skipped rows by line and
      reason (an `android://` row reads "non-web origin (android://)",
      never "null"); the destination select offers Global (preselected)
      and every persistent jar with its "no secrets yet" / "N secrets"
      state; the Replace/Merge select appears ONLY when the chosen
      destination reports ≥ 1 item.
- [ ] **S4 Native confirm + first import (Merge into an empty jar).** Commit
      raises a NATIVE dialog "Import N login(s) into <jar>?" stating the
      destination and count; "Cancel" leaves the modal open with "Import
      cancelled." and Commit re-enabled; "Import" lands the logins. The
      completion modal reads "N imported", lists unmappable counts with
      reasons, and shows the "Delete the exported CSV file now" line.
- [ ] **S5 Items look right.** In that jar's Logins list: titles, origins
      and usernames match Chrome; an item with a note shows it on reveal;
      the empty-username row exists with a blank username; each item's
      match mode reads "registrable domain" in the editor.
- [ ] **S6 Re-import is idempotent.** Import the SAME file into the SAME
      jar (Merge): the native confirm shows "N item(s) already there are
      kept"; the completion modal reads "0 imported, N already present
      (skipped)"; the item count is unchanged.
- [ ] **S7 Changed entry surfaces, never overwrites.** Edit one imported
      login's password in the vault editor, re-import (Merge): that entry
      reports "1 changed — kept as copies"; both the edited original and a
      "<title> (imported)" copy exist; a third import reports it "already
      present" (no third copy).
- [ ] **S8 Replace is explicit and destructive only on confirm.** Import into
      Global with Replace: the native confirm's detail says "This will
      first delete the M item(s) already in Global." with M matching
      Global's real count; Cancel → nothing changes; Import → only the
      imported logins remain in Global.
- [ ] **S9 Held record drops on lock.** Pick the file, reach the destination
      modal, then lock the vault (kebab → Lock, or wait for autolock): the
      modal closes; after unlock, Settings shows NO "Resume browser import…"
      button, and starting again requires a fresh pick.
- [ ] **S10 Held record drops on window close.** In a second window, pick
      the file and reach the destination modal, then close that window;
      in the first window, Settings shows no resume affordance for it (the
      record was that window's own) and the app is unaffected.
- [ ] **S11 Keyboard + labels.** Through the three modals with keyboard
      only: Tab reaches every control in a sensible order, Escape closes
      each modal (and a post-pick Escape drops the record — re-opening
      requires a fresh pick), every control has a visible label, the
      status line updates are announced (role=status).
- [ ] **S12 No plaintext left behind.** After the HAT, `userData/vaults/`
      contains only `.gfvault` files + `manager.json` (no `.csv`, no
      `.json` sidecars), and a `grep -r` for one imported password over
      `userData/` finds nothing. The operator deletes the export file.

## Verification Steps

Each S-step above is its own verification: the operator performs it in
the running app and reports pass/fail with what they saw. The Flight
Director records each result in the flight log's Leg 3 entry as it lands.

## Fix Protocol

- Failure → diagnose from the report; a code fix spawns a Developer with
  the exact symptom, then `npm test` + typecheck + lint + format, then the
  operator re-runs that step. Fixes are committed in a new commit per
  batch (never amend) on the flight branch; the PR updates automatically.
- Every fix, and every fix-vs-feature call, is logged in the flight log's
  Leg 3 entry (HAT fix N, the M18 convention).
- A FEATURE ask goes to the flight log as a debrief/Flight-2 candidate
  unless the operator promotes it to a scoped design review now.

## Files Affected

- Whatever inline fixes touch (expected: `src/renderer/pages/vault-browser-import-controller.js`,
  `src/renderer/pages/vault.css`, `src/shared/vault-page-model.js`,
  `src/main/vault/browser-import-flow.js` copy strings), plus
  `flight-log.md`.

---

## Post-Completion Checklist

**Complete ALL steps before signaling `[COMPLETE:leg]`:**

- [ ] All acceptance criteria verified
- [ ] Tests passing
- [ ] Update flight-log.md with leg progress entry
- [ ] Set this leg's status to `completed` (in this file's header)
- [ ] Check off this leg in flight.md
- [ ] If final leg of flight:
  - [ ] Update flight.md status to `landed`
  - [ ] Check off flight in mission.md
- [ ] Commit all changes together (code + artifacts)
