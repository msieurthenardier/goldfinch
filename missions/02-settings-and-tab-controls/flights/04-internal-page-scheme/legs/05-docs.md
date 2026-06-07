# Leg: docs

**Status**: landed
**Flight**: [Internal Page Scheme (`goldfinch://`)](../flight.md)

## Objective
Document the new internal-page mechanism — the `goldfinch://` scheme, its dedicated session + CSP, the
trusted embedder path, and the internal-page preload bridge — in `README.md` and `CLAUDE.md`, so the
new architectural seams are discoverable and the security model is written down.

## Context
- This flight introduces a genuinely new subsystem (a privileged internal URL scheme + a trusted
  tab-opening path distinct from the web path). New internal-page mechanism + new architectural seams
  warrant docs (flight skill guidance: documentation legs for new mechanisms).
- **Reference symbols / DD ids, NEVER line numbers** in committed docs/comments (Flight-2 lesson — the
  hand-mirrored d.ts and the `app-quit` comment already bit on line-number drift).
- Keep it accurate to what legs 1–4 actually built; do not document Flight 5/6 work (settings page
  chrome, wired controls) as if it exists — the page is a **stub** ("coming soon").

## Inputs
- Current `README.md` and `CLAUDE.md` (read both to find where browser-architecture / security / IPC /
  keyboard topics already live, and match their structure — do NOT invent new top-level sections if an
  existing one fits).
- The implemented mechanism from legs 1–4 (scheme registration, internal session + CSP-in-Response,
  `isInternalPageUrl` + `createTab` trusted flag, internal preload, session-aware `will-navigate`,
  the a11y `ACCEPTED` baseline + guest-target mode).

## Outputs
- `README.md` and/or `CLAUDE.md` updated to describe the internal-page mechanism and its security model.
- No source/behaviour change; offline gates unaffected.

## Acceptance Criteria
- [ ] **The `goldfinch://` scheme** is documented: privileged (`{ standard, secure }`), registered at
  module load, served from a **dedicated internal session** via `protocol.handle`, with the strict CSP
  (`frame-ancestors 'none'`) set **in the response headers**. Currently serves one stub page
  (`goldfinch://settings`, "coming soon").
- [ ] **The trusted embedder path** is documented as the security-critical design: internal pages open
  **only** through `createTab(..., { trusted: true })` validated by `isInternalPageUrl` — **never** by
  widening `isSafeTabUrl`; the page-reachable `onOpenTab` route can never set the flag; the four gates
  (provenance flag + `isInternalPageUrl` allowlist + session-aware `will-navigate` + internal-session-only
  handler). State plainly that web content cannot navigate to / open / embed / `fetch` the scheme.
- [ ] **The internal-page preload bridge** (`internal-preload.js`, `contextIsolation: true`, minimal
  surface, distinct from the media `webview-preload.js` and the chrome `window.goldfinch`) is documented,
  noting Flight 6 will populate it.
- [ ] **The a11y baseline** change is documented where the project documents testing/a11y: `npm run a11y`
  now diffs against a curated `ACCEPTED` allowlist in `scripts/a11y-audit.mjs` (not "fail on any"), and a
  `--target=<url-substring>` guest mode exists. (Brief — the mechanism detail lives in the script header.)
- [ ] If the project keeps a **keyboard-shortcuts** or **menu** doc table, the kebab **Settings** item is
  noted as now opening the settings page (it was an inert placeholder before this flight).
- [ ] **No line numbers** in any added doc text; reference symbols / scheme names / DD ids.
- [ ] Docs match the **stub** reality (no claims of a working settings UI or wired controls — those are
  Flight 5/6).
- [ ] Offline gates unaffected: `npm run lint` / `npm run typecheck` / `npm test` still green (docs-only;
  if the repo lints/formats Markdown, keep it clean — run `npm run format` if that's the project norm).

## Verification Steps
- Re-read the added doc sections against the implemented code (scheme privileges, CSP location, the four
  gates, the preload isolation) — every claim must be true of legs 1–4 as built.
- Confirm no line-number references were introduced.
- `npm run lint` / `npm run typecheck` / `npm test` unchanged-green (docs-only).

## Implementation Guidance
1. **Read `README.md` and `CLAUDE.md`** first; find the existing homes for architecture / security /
   privacy / IPC / testing topics and extend those rather than bolting on parallel sections.
2. **README** — a concise user/contributor-facing description of the internal-page scheme + that Settings
   now opens an internal page (stub). If there's a keyboard/menu table, update the Settings row.
3. **CLAUDE.md** — the architecture/security note future agents need: the four-gate model, "never widen
   `isSafeTabUrl` for internal pages — use the trusted path", CSP-in-Response (not `onHeadersReceived`,
   which custom-protocol responses bypass), the internal session/partition (`goldfinch-internal`,
   single-sourced in `src/shared/internal-page.js`), and the internal preload bridge. Mention the a11y
   `ACCEPTED` baseline + guest mode briefly.
4. **Scope**: docs only. Do NOT touch source, tests, or behavior specs. Do NOT run the live GUI.

## Edge Cases
- **Existing doc already partly covers schemes/security**: extend it coherently; don't duplicate or
  contradict the existing `isSafeTabUrl` description — add the internal-path exception alongside it.
- **Markdown lint/format**: if the repo formats Markdown (prettier), run the project's format step so the
  docs leg doesn't introduce drift (there's a known `.github/dependabot.yml` prettier drift carry-forward
  — do NOT fix unrelated drift here, just keep the touched files clean).

## Files Affected
- `README.md` — internal-page scheme description (+ Settings/keyboard row if present).
- `CLAUDE.md` — architecture/security note for the internal-page mechanism + a11y baseline.
- (No source, tests, or specs.)

---

## Post-Completion Checklist

**Batched-commit flight: implement + update artifacts, do NOT commit; signal `[HANDOFF:review-needed]`.**

- [ ] All acceptance criteria verified
- [ ] Offline gates passing (`npm test` / `typecheck` / `lint`)
- [ ] Update flight-log.md with leg progress entry
- [ ] Set this leg's status to `landed`
- [ ] Check off this leg in flight.md
- [ ] Do NOT commit; signal `[HANDOFF:review-needed]`
