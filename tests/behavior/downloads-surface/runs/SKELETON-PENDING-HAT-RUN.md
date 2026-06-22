# Behavior Test Run: downloads-surface — SKELETON (PENDING HAT RUN)

> **SKELETON — DO NOT TREAT AS A RESULT.** This is a pre-written run-log template created by the Leg-6
> deterministic pass (PART D setup) to reduce friction for the operator-driven `hat-and-alignment` (HAT)
> leg. **It records no verdicts.** The live HAT run must: replace the `SKELETON-PENDING-HAT-RUN` filename
> with the real `{ts}` timestamp (`YYYY-MM-DD-HH-MM-SS.md`), fill every `<TODO>`, set the per-row
> dispositions, and write the disposition. Delete this skeleton file once the real run log lands (or
> rename it to the timestamp). The spec stays `active`; this re-run re-confirms it after the PART-A
> hardening (the new dedup + exactly-one-record checkpoints).

**Spec**: [tests/behavior/downloads-surface.md](../../downloads-surface.md)
**Status**: <TODO: pass | fail>
**Started**: <TODO ISO timestamp>
**Completed**: <TODO>
**Duration**: <TODO>
**Mode**: scripted live integration smoke (leg-permitted alternative to the multi-agent Witnessed run — see
the leg artifact PART D / the Flight-5 precedent run log) OR Witnessed `/behavior-test downloads-surface`.
**Apparatus**: Goldfinch MCP automation surface (loopback), admin key + jar key, attach+env-key model.
**Driver**: <TODO: ephemeral Node script over `scripts/lib/mcp-client.mjs`, or the Witnessed agents — not committed>

## Summary

<TODO: N / N judged checkpoints. Note this is the POST-PART-A-hardening re-run; the new dedup (Step 6) +
the sharpened exactly-one-record assertion (Step 3) are the new checkpoints. Note which fixture mechanism
fired (primary `.bin`/octet-stream vs the `Content-Disposition: attachment` fallback).>

## Environment

- App: `GOLDFINCH_AUTOMATION_ADMIN=1 GOLDFINCH_AUTOMATION_DEV_MINT=1 npm run dev:automation` (WSLg, X11/`:0`).
- MCP server **bound port <TODO>** (capture live from the listening socket — do NOT hardcode 49707; it
  free-falls-back, e.g. 49709 last run).
- Fixture server: `python3 -m http.server 8000 --directory tests/behavior/fixtures`. Fixture
  `download-fixture.bin` (4096 bytes) at `http://127.0.0.1:8000/downloads/download-fixture.bin`.
  Mechanism used: <TODO primary octet-stream | Content-Disposition fallback>.

## Step Results

### Tool discovery — <TODO>
- **Raw state**: `listTools` returned <TODO> tools (expect 27); `downloadsList` present? <TODO>.
- **Verdict**: <TODO>.
- **Evidence**: <TODO>

### Step 1 (baseline `downloadsList`, admin) — SETUP
- **Raw state**: baseline count `N = <TODO>`.
- **Evidence**: <TODO>

### Step 2 (open tab + navigate to fixture, silent download) — SETUP (no judgment)
- **Raw state**: <TODO>. (A `navigate` `ERR_FAILED` is expected — the body is consumed as a download.)

### Step 3 (single download ⇒ exactly one new record — sharpened, PART A) — <TODO>
- **Raw state**: count went `N → <TODO>`; new record id(s) = <TODO>.
- **Expected**: count goes `N → N+1` (**not** `N+2`); the new record's `id` is **distinct** (no duplicate
  id); record has fixture `filename`, `state: 'completed'`, non-empty `savePath`, `received === total > 0`.
  A double-`will-download` recurrence (two records / a duplicate id from one trigger) **fails** this step.
- **Verdict**: <TODO>.
- **Evidence**: <TODO>

### Step 4 (`stat` the `savePath`) — <TODO>
- **Raw state**: file exists? size? <TODO>.
- **Verdict**: <TODO>.
- **Evidence**: <TODO>

### Step 5 (jar key refused `downloadsList`) — <TODO>
- **Raw state**: <TODO — must be the DISTINCT admin-only refusal, not a generic 401 / "not a function">.
- **Verdict**: <TODO>.
- **Evidence**: <TODO>

### Step 6 (same-filename dedup — REQUIRED, PART A wrong-filename guard) — <TODO>
- **Actions taken**: `navigate` the same fixture URL a **second** time; wait for settle; `downloadsList`.
- **Raw state**: both records present? second record's `savePath` `uniquePath` ` (n)` suffix? distinct
  on-disk path from the first? <TODO>.
- **Expected**: the list carries **both** records distinctly (distinct `id`s, same `filename`); the second
  record's `savePath` carries the ` (n)` suffix (e.g. `download-fixture (1).bin`) — a distinct on-disk
  path. The model dedups rather than overwriting/mis-naming (Flight-5 wrong-filename regression guard).
- **Verdict**: <TODO>.
- **Evidence**: <TODO — anonymize the real abs savePath to `~/…` in this committed log>

### Step 7 (restart persistence — optional/HAT) — <TODO: RUN | NOT RUN>
- <TODO: skip-allowed; if the harness can restart the app, confirm the same `id` survives restart.>

## Orchestrator Notes

- <TODO: mode chosen + why; the live-captured bound port; the on-disk `savePath` base dir (real abs path
  stays in ephemeral evidence only — committed log uses `~/…`).>

## Evidence

Ephemeral (NOT committed): `/tmp/behavior-tests/goldfinch/downloads-surface/<TODO ts>/` — <TODO list the
JSON/screenshot evidence files>. Re-derive by re-running.

## Disposition

<TODO: on a green re-run including the new dedup + exactly-one-record checkpoints, the spec stays `active`
and `**Last Run**` is bumped in the spec header. Record any skipped/HAT checkpoints (e.g. restart
persistence).>
