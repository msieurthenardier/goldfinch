# Leg: verify-integration + hat-and-alignment

**Status**: completed
**Flight**: [Eval tool + DevTools tool + a11y/farbling migration + final :9222 removal](../flight.md)

## Objective
FD-driven final verification of the flight (DD9): green-gate the whole tree, confirm `:9222` is gone, and dogfood the migrated/authored behavior specs on the new surface. (Interactive/verify leg — no autonomous Developer cycle; HAT is operator-elected.)

## Acceptance Criteria
- [x] **AC1 — FD-driven green gates (DD9a).** `npm test` **773 pass / 0 fail**, `npm run typecheck` clean, `npm run lint` clean (post all legs 1-7).
- [x] **AC2 — `:9222` retired.** `dev:debug` absent from `package.json`; `dev:automation` carries no `--remote-debugging-port`; live `dev:automation` launches show **no `:9222` listener** (observed `:52351`-only across the leg-5 + leg-8 runs); the only remaining `--remote-debugging-port` strings are the intentional `isMcpAutomationEnabled`→FALSE invariant tests.
- [x] **AC3 — `npm run a11y` green on the new surface.** Live PASS in leg 3 (exit 0, no NEW violations, MCP eval-tool apparatus, no `:9222`).
- [x] **AC4 — behavior dogfood runs (DD9b/c).** `farbling-correctness` **PASS**; `devtools-cdp-conflict` recorded finding (leg 5); `automation-key-gating` + `settings-activity-viewer` **partial** (each spec's load-bearing assertion PASSES — toggle-OFF gating contract; serve-seam render guard — the UI-interaction steps carried, apparatus-limited). Run logs under each spec's `runs/`.
- [x] **AC5 — HAT (DD9d).** Skipped per operator decision.

## Verification Steps
- `npm test` / `npm run typecheck` / `npm run lint` — green (FD-run).
- Live `dev:automation` (`:52351`) — MCP up, `:9222` absent; FD-driven `node` drivers over `scripts/lib/mcp-client.mjs` executed the four dogfood specs.
- Run logs: `tests/behavior/{farbling-correctness,automation-key-gating,settings-activity-viewer}/runs/2026-06-17-17-23-30.md`, `tests/behavior/devtools-cdp-conflict/runs/2026-06-17-16-25-30.md`.

## Notes
Full detail (gate results, per-spec dispositions, the carried-steps rationale, the WSLg apparatus limitation) is in the flight-log leg-8 entry. The carried behavior-test steps are UI-interaction steps requiring coordinate-click geometry in the internal settings guest (eval-on-internal correctly blocked) — each spec's own load-bearing assertion is verified; the remainder is carried to the debrief.

---

## Post-Completion Checklist
- [x] FD-driven gates green; `:9222` retired; a11y green; dogfood runs done (load-bearing assertions verified)
- [x] Flight-log leg-8 entry written; run logs committed
- [x] Leg status `landed`; checked off in flight.md
- [ ] *(Flight-level: review + commit + PR + land — Phase 2d/3, next)*
