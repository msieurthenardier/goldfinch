# Flight Log: Chromium Family Breadth

**Flight**: [Chromium Family Breadth](flight.md)
**Mission**: [Browser Credential Import](../../mission.md)

Runtime decisions, deviations, and anomalies recorded here during execution.

---

## Reconnaissance Report (Phase 1b) — 2026-09-14

Source artifact: the Flight 1 debrief
(`../01-chrome-password-import/flight-debrief.md`). Each action item / forward
recommendation walked against current code (post-turnaround, main c98bed3).

| Item | Classification | Evidence | Recommendation |
|---|---|---|---|
| Document the vault-page-model pure-extraction pattern | already-satisfied | squawk 0065, landed in the 2026-09-11 turnaround (PR #209); CLAUDE.md `### Password vault` now carries the note | retire — done |
| Cite internal-page-route-closure.test.js as a standing guard | already-satisfied | squawk 0066, landed PR #209; CLAUDE.md "Adding an internal page" cites it | retire — done |
| not-set-up-with-jars regression test | already-satisfied | squawk 0064, landed PR #209; `test/unit/vault-page-model.test.js` case added | retire — done |
| Real-boot internal-page smoke check | confirmed-live | no such test exists; needs its own design | out of THIS flight's scope — a standing recommendation (maintenance), not Flight 2 work |
| vault.js restore-modal extraction (M18 F3 rec 2) | confirmed-live | `vault.js` = 2820/2820 (`seam-contract.test.js:193`); restore modals still in `vault.js:715-1252` | **in scope — leg 1 (DD4), operator-ruled to bundle here** |
| Generalize detectChromeExport to the Chromium family | confirmed-live | `browser-import.js:65` Chrome-exact `CHROME_HEADER`; controller strings Chrome-specific (`vault-browser-import-controller.js:54,91-92`) | **in scope — leg 2 (DD2)** |
| Activate dormant blocklist code if Edge emits it | already-satisfied (as no-op) | real Edge sample has no blocklist shape; empty-password rows are federated `no-password` (DD3) | no code needed; recorded |
| Multi-source labeling in the resume slot | retired-by-decision | operator ruled generalized guidance, no source tag (DD2) — no source label anywhere, so no multi-source labeling to do | retire — superseded by DD2 |
| Verify a real Edge export before designing | already-satisfied | done at planning: header byte-identical to Chrome (`name,url,username,password,note`), 8 rows exercising empty-pw/empty-user/android (DD1) | premise resolved |

Net: three debrief follow-ups already landed in the turnaround; the real-boot
smoke check stays a standing (non-Flight-2) recommendation; the extraction and
the Chromium generalization are Flight 2's two build legs; blocklist and
multi-source labeling dissolve given the real format + the generalized-guidance
ruling.

## Planning notes — 2026-09-14

- Operator produced a real Edge export (`~/Downloads/edge.csv`, not committed).
  Inspected header + structure ONLY (no credential values read): header
  `name,url,username,password,note` (identical to Chrome), 8 data rows, 2
  empty-password (federated), 3 empty-username, schemes 7 https + 1 android.
  Premise for DD1 resolved against a real file.
- Operator rulings this planning: (1) produce a real Edge export to verify
  format — done; (2) generalized Chromium guidance, NO source picker (DD2);
  (3) bundle the vault.js restore-modal extraction as leg 1 (DD4); (4) include a
  per-flight guided HAT (DD5). The leg-1 headroom premise (Edge UI needs room)
  was invalidated by DD1+DD2 (Edge adds only copy changes, not vault.js UI); the
  operator chose to keep the extraction bundled anyway as debt paydown — recorded
  as a deliberate, decoupled inclusion, not a headroom necessity.

## 2026-09-14 — Design review (Architect): approve with changes

Incorporated all findings (spec-text only; no leg or DD reversal, so no second
review cycle — the M19 precedent):
- **(high)** `pendingImportRecord` is touched at SIX sites, only three inside
  the extracted functions — leg 1 is a state-ownership refactor, not a verbatim
  move. DD4 now specifies it becomes controller-owned closure state exposed via
  a getter/loader (mirroring `browserImport.heldRecord()`), with vault.js's five
  external sites rewritten to the accessor.
- **(medium)** `openExportModal` shares `buildVaultSelect` with `openMappingModal`
  — extract it alongside the restore modals (default now, not "acceptable
  variation"), keeping the shared helper's consumers in one file. The invariants
  also scan `openExportModal` (`:321,:344`) — retargeted too.
- **(medium)** the CP2 grep-AC is now a TARGETED phrase scan
  (`Chrome password export` / `chrome://password-manager` / `In Chrome,`), never
  a bare `grep -ri chrome` — goldfinch's window-"chrome" naming (`byChrome`,
  `chromeId`, `windowForChrome`) pervades `src/main/vault/` and is unrelated.
- **(low)** leg 1 adds a `/vault-restore-controller.js` route in
  `internal-page-map.js` + the exact-allowlist test update + the flat-specifier
  `// @ts-ignore` convention (the route-closure guard enforces it).
- **(low)** explicit line-budget call: LOWER `VAULT_PAGE_LINE_BUDGET` to the
  post-extraction count + a small buffer to lock in the headroom; the new
  controller gets no budget (sibling precedent).
- Suggestion taken: leg order may flex (small leg 2 first banks Edge value,
  not hostage to leg 1's divert risk) — recorded in Adaptation Criteria; the
  operator's "extraction as leg 1" stays the default. CP1 gains a one-time
  manual app spot-check (no DOM harness for this page).
- Architect citation audit: all leg-owned citations exact; the invariants-scan
  citation was incomplete (missed `openExportModal`), now corrected.

Flight status planning → ready.
