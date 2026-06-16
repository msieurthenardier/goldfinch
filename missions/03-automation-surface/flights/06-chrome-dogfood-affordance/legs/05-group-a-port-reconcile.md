# Leg: group-a-port-reconcile

**Status**: completed
**Flight**: [Chrome-driving affordance + behavior-spec dogfooding (scoped)](../flight.md)

## Objective
Reconcile the 6 Group-A behavior specs that still hardcode the old `7777` port onto the current `GOLDFINCH_MCP_PORT`/`49707` convention (matching the 2 F4 specs), and scrub the stale `.mcp.json` `goldfinch`-entry reference in `mcp-drive-end-to-end` — careful, non-blind edits (some `7777` strings are load-bearing).

## Context
- **DD5** (flight): Group A is already on the MCP surface; their only F6 debt is the stale port. Light, bundled "dogfooding hygiene." **NOT a blind `s/7777/49707/`** (Architect [LOW]): `mcp-loopback-origin-guard` carries `7777` in **load-bearing expected-result strings** (the `ss`/`lsof` "listener on `127.0.0.1:7777`" check + the Host-header rows), not just apparatus URLs.
- **Target pattern** = `mcp-auth-gating.md` (already reconciled): pin the port with **`GOLDFINCH_MCP_PORT`** (documented default `49707`), export once at launch, and reference `127.0.0.1:$GOLDFINCH_MCP_PORT` in every URL. The 2 newest F4 specs (`mcp-auth-gating`, `mcp-jar-scoping`) already do this — make the other 6 match.
- **No source code** — markdown spec edits only. No semantic step changes; the measured behavior is identical, only the port literal changes.
- Spec-only, independent of the chrome-drive spike — in the autonomous-first batch.

## Inputs (the 6 Group-A specs + every `7777` site, walked 2026-06-15)
1. **`tests/behavior/foreground-to-act.md`** — `:16` precondition "MCP server up on `127.0.0.1:7777`"; `:17` "client connected to `http://127.0.0.1:7777/mcp`"; `:18` apparatus note "MCP client over `127.0.0.1:7777`". (3 sites — all apparatus URLs.)
2. **`tests/behavior/observe-refusal-contract.md`** — `:16`, `:17`, `:19` (same 3 apparatus-URL shape).
3. **`tests/behavior/internal-session-exclusion.md`** — `:16`, `:17`, `:19` (same 3 apparatus-URL shape).
4. **`tests/behavior/devtools-cdp-conflict.md`** — `:19` client URL, `:21` apparatus note. **Port-only change; PRESERVE its `BLOCKED-AS-WRITTEN` annotation** (the non-CDP DevTools-open affordance stays deferred this flight — do not un-block it).
5. **`tests/behavior/mcp-drive-end-to-end.md`** — `:15` "listening on `127.0.0.1:7777`"; **`:16` the stale `.mcp.json` `goldfinch`-entry reference** (scrub — see below); `:18` apparatus note; `:23` observables-frame note; `:31` Step-1 connect URL. (Tool count is **already 17** here — done in leg 1; do NOT touch the tool list.)
6. **`tests/behavior/mcp-loopback-origin-guard.md`** — **the careful one.** `:18` client URL; `:19` apparatus note ("server on `127.0.0.1:7777`"); `:20` curl Host-replacement note ("`Host: 127.0.0.1:7777` automatically … loopback"); **`:32` Step-1 load-bearing `ss`/`lsof` listener check** ("locate the listener on port **7777**" / "A listener exists on **`127.0.0.1:7777`** … not `0.0.0.0:7777` … not `[::]:7777`"); `:33`–`:37` the curl rows' connect URLs + Host headers.

**Reference pattern** (already correct): `tests/behavior/mcp-auth-gating.md:24` ("Port (load-bearing) … pin `GOLDFINCH_MCP_PORT` … new default `49707`") + `:27` (`const port = process.env.GOLDFINCH_MCP_PORT || 49707`).

## Outputs
- All 6 specs reference `127.0.0.1:$GOLDFINCH_MCP_PORT` (default `49707`) instead of `7777`, each carrying a short port-pin precondition note mirroring `mcp-auth-gating`.
- `mcp-loopback-origin-guard`'s load-bearing strings (the `ss`/`lsof` listener assertion + Host headers) updated correctly — **except Step 6's deliberately-mismatched `Host: 127.0.0.1:9999`, which stays `9999`** (it is intentionally NOT the listen port — the port-agnostic-Host control).
- `mcp-drive-end-to-end`'s stale `.mcp.json` `goldfinch`-entry reference scrubbed.
- `devtools-cdp-conflict`'s `BLOCKED-AS-WRITTEN` annotation preserved.
- `grep -rn "7777" tests/behavior/` returns **nothing** (no Group-A spec references the old port).

## Acceptance Criteria
- [x] **AC1 (port reconcile, 6 specs)** — Each of the 6 specs replaces `7777` apparatus URLs with `127.0.0.1:$GOLDFINCH_MCP_PORT` (default `49707`) and gains a brief port-pin precondition note in the style of `mcp-auth-gating.md:24` ("pin `GOLDFINCH_MCP_PORT`; default `49707`; export once and reuse"). No step semantics change.
- [x] **AC2 (`mcp-loopback-origin-guard` load-bearing strings)** — The Step-1 `ss`/`lsof` listener check asserts a loopback bind on **`$GOLDFINCH_MCP_PORT`/49707** ("`127.0.0.1:$GOLDFINCH_MCP_PORT` not `0.0.0.0:$GOLDFINCH_MCP_PORT` not `[::]:$GOLDFINCH_MCP_PORT`"), and the curl rows' connect URLs + the auto-`Host` references use the pinned port. **Step 6's `Host: 127.0.0.1:9999` (mismatched-port control) stays `9999`** — only its connect URL (`http://127.0.0.1:7777/mcp` → pinned) changes; the row's point (loopback Host with a non-listen port still passes) is preserved and its prose still reads correctly.
- [x] **AC3 (`.mcp.json` scrub)** — `mcp-drive-end-to-end.md:16` no longer claims a `.mcp.json` `goldfinch` entry exists (it was removed in F5). The apparatus line keeps the real options (SDK client / `scripts/mcp-example-client.mjs`) at the pinned port. (Full `.mcp.json` rewrite remains Flight 7 — this is reference-scrub only.)
- [x] **AC4 (`devtools-cdp-conflict` block preserved)** — its `BLOCKED-AS-WRITTEN` annotation is unchanged after the port edit (port-only; still blocked pending the deferred non-CDP DevTools-open affordance).
- [x] **AC5 (no 7777 remains)** — `grep -rn "7777" tests/behavior/` returns nothing across specs (run-log files under `tests/behavior/*/runs/` are immutable history — exclude/ignore them).
- [x] **AC6** — No source changed; `npm test` / `typecheck` / `lint` are unaffected (run them to confirm nothing regressed — these are spec docs, so green is expected).

## Verification Steps
- AC1–AC4: read each edited spec; confirm URLs use `$GOLDFINCH_MCP_PORT`, the `ss`/`lsof` and Host strings in `mcp-loopback-origin-guard` are correct (Step 6 still `9999`), the `.mcp.json` reference is gone from `mcp-drive-end-to-end`, and `devtools-cdp-conflict` is still `BLOCKED-AS-WRITTEN`.
- AC5: `grep -rn "7777" tests/behavior/*.md` → nothing.
- AC6: `npm test && npm run typecheck && npm run lint` → green (sanity; specs don't affect the suite).

## Implementation Guidance
1. **Pick the representation**: use `$GOLDFINCH_MCP_PORT` (shell) / `process.env.GOLDFINCH_MCP_PORT || 49707` (SDK), default `49707`, mirroring `mcp-auth-gating.md:24,27` verbatim in spirit. Add a one-line "Port (load-bearing): pin `GOLDFINCH_MCP_PORT`; default `49707`" bullet to each spec's Preconditions so the `$GOLDFINCH_MCP_PORT` references resolve.
2. **The 4 simple specs** (`foreground-to-act`, `observe-refusal-contract`, `internal-session-exclusion`, `devtools-cdp-conflict`): replace each `127.0.0.1:7777` → `127.0.0.1:$GOLDFINCH_MCP_PORT`. For `devtools-cdp-conflict`, do NOT touch the `BLOCKED-AS-WRITTEN` annotation or its block rationale.
3. **`mcp-drive-end-to-end`**: replace the `:15`/`:18`/`:23`/`:31` port literals; **rewrite `:16`** so it no longer references a `.mcp.json` `goldfinch` entry — e.g. "An MCP client is available: the SDK client or `scripts/mcp-example-client.mjs`, connected to `http://127.0.0.1:$GOLDFINCH_MCP_PORT/mcp`." Leave the 17-tools list (leg 1) alone.
4. **`mcp-loopback-origin-guard`** (careful):
   - `:18`/`:19`/`:20` apparatus + curl-Host note → pinned port (the "curl auto-sends `Host: 127.0.0.1:7777`" example becomes `127.0.0.1:$GOLDFINCH_MCP_PORT`).
   - `:32` Step-1 `ss`/`lsof`: "locate the listener on port **7777**" → "**$GOLDFINCH_MCP_PORT** (default 49707)"; the assertion "`127.0.0.1:7777` not `0.0.0.0:7777` not `[::]:7777`" → the pinned port in all three forms. Keep the bind-check semantics identical.
   - `:33`,`:34`,`:35` connect URLs + the loopback-`Host` examples → pinned port.
   - `:36` **Step 6**: the connect URL `http://127.0.0.1:7777/mcp` → pinned port, **BUT keep `-H 'Host: 127.0.0.1:9999'` as 9999** — that mismatched port is the whole point of the row (a loopback host with a non-listen port still passes the port-agnostic Host check). Ensure the row's prose ("mismatched port", "normalizes to loopback") still reads coherently with the new listen port.
   - `:37` (Step 6 expected result) — confirm no stray `7777` and the explanation still holds.
5. **Do NOT edit** the historical run logs under `tests/behavior/*/runs/*.md` (immutable evidence — they legitimately record `7777` from past runs).
6. Run `npm test`/`typecheck`/`lint` as a regression sanity check (expect green — no source touched).

## Edge Cases
- **Step 6's `9999`**: the single `7777`→pinned change that must NOT also rewrite a sibling port literal on the same line. The mismatched-port control is deliberate; rewriting `9999` would destroy the test's meaning.
- **Run-log `7777` hits**: `grep -rn "7777" tests/behavior/` will also match `tests/behavior/*/runs/*.md` — those are immutable past-run records; the AC5 "nothing remains" target is the **specs** (`tests/behavior/*.md`), not the run logs. Scope the final grep to `tests/behavior/*.md`.
- **`mcp-jar-scoping.md:81` stale openTab v1-limitation note** — surfaced in leg 3; it is NOT a `7777` issue and belongs to the leg-4 migration (recorded there), not this leg. Leave it.

## Files Affected
- `tests/behavior/foreground-to-act.md`
- `tests/behavior/observe-refusal-contract.md`
- `tests/behavior/internal-session-exclusion.md`
- `tests/behavior/devtools-cdp-conflict.md` (port-only; block preserved)
- `tests/behavior/mcp-drive-end-to-end.md` (port + `.mcp.json` scrub)
- `tests/behavior/mcp-loopback-origin-guard.md` (port + load-bearing `ss`/Host strings; Step-6 `9999` preserved)

---

## Post-Completion Checklist

**Complete ALL steps before signaling `[COMPLETE:leg]`:**

- [x] All acceptance criteria verified
- [x] `grep -rn "7777" tests/behavior/*.md` returns nothing
- [x] `npm test` / typecheck / lint green (regression sanity)
- [x] Update flight-log.md with leg progress entry
- [x] Set this leg's status to `landed`
- [ ] Check off this leg in flight.md (at flight commit)
- [x] Batched flight — do NOT commit per-leg

## Citation Audit
All `7777` sites verified against current spec text at leg design time (2026-06-15): `foreground-to-act:16-18`, `observe-refusal-contract:16-19`, `internal-session-exclusion:16-19`, `devtools-cdp-conflict:19,21`, `mcp-drive-end-to-end:15-16,18,23,31`, `mcp-loopback-origin-guard:18-20,32-37` — all OK (line content matches). Reference pattern `mcp-auth-gating:24,27` confirmed as the reconciled target. `mcp-drive-end-to-end:16` `.mcp.json` `goldfinch`-entry reference confirmed stale (entry removed in F5; `.mcp.json` now carries only `playwright`).
