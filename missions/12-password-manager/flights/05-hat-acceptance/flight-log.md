# Flight Log: HAT + Alignment — End-to-End Acceptance

**Flight**: [HAT + Alignment — End-to-End Acceptance](flight.md)

## Summary

Flight 5 of Mission 12 — the mission's **closing acceptance gate**: a guided human-acceptance-test
session exercising the built-in password manager end-to-end in a live goldfinch instance, closing the
live-only verification deferred across F1–F4 (sheet-state a11y, vault-page keyboard/focus/aria, the
multi-component flows) and fixing issues inline. **Interactive — the human drives the chrome sheets; the
Executor drives the guest.** Not autonomously executed.

Status: **planning** — flight spec + the new behavior-test spec drafted; operator asked to "design the F5
HAT plan now" (2026-07-21), to run together interactively in a later session. Design review pending.

**Branch**: `flight/05-hat-acceptance`, stacked on `flight/04-...` (the F1–F5 stack; rebases onto main as
it merges). This flight's planning artifacts are docs-only; inline fixes land here when the HAT runs.

## Deferred-to-HAT inventory (carried from F1–F4 debriefs)

- **F1** — the canonical `vault-mcp-surface` Witnessed run (if outstanding).
- **F2** — `npm run a11y` (sheet templates); `vault-human-fill-boundary` behavior test; true human
  end-to-end (typing the real sheet); 3 live-only items (contextBridge Buffer clone; fill-icon positioning
  across layouts; transient-JS-string password lifetime).
- **F3** — the four F3 sheet a11y states + `goldfinch://vault` keyboard/focus/aria (DD9 page-not-axe
  standing gap → HAT is load-bearing for the page portion).
- **F4** — export/import round-trip across profiles (+ cross-machine master-password comprehension, the
  highest live-only design risk; + the `_pendingVaultImport` dismiss edge); rotation one-time-display
  sheets; the registrable-domain widen in a real fill (+ the no-cross-tenant negative); the 4 new sheet
  kinds' a11y + the 3-element offer-export modal focus cycle; the stale vault-page-row after a jar delete.

## Apparatus (the load-bearing design fact — DD1, corrected at design review)

The design review corrected an initial over-claim. **The menu-overlay SHEET is admin-READABLE** (built on
the default session, not internal → `isInternalContents(sheet)` is false; at the admin tier
`enumerateWindows` exposes `sheetWcId` → admin `readDom`/`evaluate` reach the live sheet DOM/aria; the
`npm run a11y` harness already does this). Only `getChromeTarget` is toolbar-only. The F2/F3 security
boundary still holds — a *jar* key / hostile page can't reach the sheet; admin reachability is a
verification affordance. So the HAT splits: **the human DRIVES the sheets** (real gesture / isTrusted /
genuine UX) **and the FD READS them via the admin key** for EXACT assertions (aria/focus/copy text) rather
than only screenshots; **guest-observable flows are Witnessed behavior tests**. The internal PAGE
(`goldfinch://vault`) is the genuinely-unreachable surface (DD2, even for admin) — page a11y is manual +
unit + `captureWindow` pixels. Every acceptance surface is traced to a real act+observe path in the spec.

## Behavior-test specs

- `vault-mcp-surface` (F1) — bundle/run.
- `vault-human-fill-boundary` (F2) — bundle/run.
- **`vault-registrable-domain-fill` (NEW, authored this flight)** — the automation `vaultFill` widen:
  fills a matched subdomain, refuses a multi-tenant sibling / an exact-mode cred / a scheme mismatch /
  an unlisted host (fail-closed). **Apparatus premise flagged**: the fixtures need `/etc/hosts` aliases to
  127.0.0.1 for PSL-known names (`example.com`+`accounts.example.com`; `github.io` tenants) — a reserved
  TLD (`.test`) isn't in the PSL and would fail closed, making the positive step impossible. Probe the
  aliases before the run.

## Session Notes

- **2026-07-21** — F5 planning: flight spec (DD1 apparatus split, DD2 page-a11y manual+unit, DD3
  fix-vs-feature gate, DD4 prerequisites) + the 4 guided segments (A core/fill/lock, B management/rotation,
  C portability/lifecycle, D behavior suite) + the new behavior-test spec drafted. Operator chose "design
  the F5 HAT plan now" — to run interactively later.

**Architect design review — 1 cycle (approve with changes, incorporated).** The apparatus premise-audit
found a genuine [HIGH]: DD1 **over-claimed** the sheet as MCP-unreachable — it is admin-READABLE
(default-session view, `enumerateWindows`→`sheetWcId`→`readDom`/`evaluate`; the a11y harness already uses
this). Corrected: the human still DRIVES the sheet for UX fidelity, but the FD now READS the live sheet
DOM/aria via the admin key for exact assertions (stronger than screenshots) — applied to the sheet-a11y,
the import-comprehension-copy, and the one-time-display steps. DD2 (the internal PAGE genuinely
unreachable even by admin) was confirmed correct — the code proves the page/sheet distinction. Second
[HIGH]: the vault-fixture builder can't yet provision multi-origin + `matchMode` items → named as a
pre-flight task in DD4 + the behavior spec. The matcher/PSL premises were **verified correct** (`.test`
absent from the .dat → fixtures need real PSL names; `github.io`/`co.uk` present; matcher keys off
`URL.hostname` so `/etc/hosts` aliasing works; every RD-fill step matches the real matcher). M/L: the F2
transient-JS-string item has no HAT read path (reframed as noted-not-asserted); the Buffer-clone item
reframed as a fill-success proxy; the page-a11y + stale-row read paths named as human-visual/pixels.

## Flight Director Notes — design phase

Designed F5 as the closing HAT. The load-bearing design decision is the **apparatus split** (DD1): because
the sheets are MCP-unreachable, sheet-driven verification is manual and guest-observable verification is a
behavior test — I traced each of the ~17 verification steps to a concrete act+observe path so no criterion
asserts a state with no read path (the flight-skill apparatus premise-audit on both axes). The single
highest live-only *design* risk to watch is the **cross-machine master-password comprehension** on import
(an operator on a second machine must use the SOURCE master password or the recovery key — if the sheet
copy misleads them toward the destination password, the UX is broken though the crypto is correct). The
new behavior test's fixture-origin premise (PSL-known `/etc/hosts` aliases) is called out prominently — a
`.test` alias would fail closed and silently invalidate the positive case.
