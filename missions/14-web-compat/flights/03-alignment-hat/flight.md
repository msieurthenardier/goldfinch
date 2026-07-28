# Flight 3: Alignment / HAT — Deferred Verification Bundle + Human Acceptance

**Status**: landed
**Mission**: [Web Compatibility — Silent Failures Become Working Features](../../mission.md)

## Contributing to Criteria

Owns closing every remaining mission criterion: fullscreen live, basic-auth live (+ agent path), client-cert chooser, PDF inline, OAuth fixture flow, popup census, live GitHub OAuth witnessed run, no-regression confirmation.

## Objective

Interactive HAT session: run the seven-item deferred verification bundle under an admin-keyed launch, with the human witnessing and judging the items no spec can (feel, input gaps, close-with-opener, copy on glass), fixing issues inline per the HAT protocol (fix-vs-feature gate; multi-surface fixes get a lightweight design review before implementation).

## Session Plan (order per F1/F2 debriefs)

1. **Environment**: admin-keyed launch (`GOLDFINCH_AUTOMATION_ADMIN=1`), fixture server, instance-identity verification. Optional: `libnss3-tools` install for item 5.
2. `web-compat-fullscreen` — FIRST (zero live visual evidence; render-correctness risk class). Human judges feel on the real-site step.
3. `web-compat-basic-auth` — full credential path + `vaultAnswerAuth` agent path; then the vault-login re-run (M13 carry-forward).
4. `web-compat-oauth-popup` — fixture flow + admin census steps. Human probes: popup feel/focus-return, input gaps (Ctrl+L/T/F/J, right-click), DD1f close-with-opener, popup marker copy, DD3 named-no-features probe.
5. `web-compat-client-cert` — gated on `libnss3-tools` + cert import (reversible).
6. `web-compat-pdf` — lowest priority (substance already witnessed live at premise check).
7. **Live GitHub OAuth witnessed run** — human signs in; FD records the witnessed result.
8. Close-out: check mission criteria, HAT rulings on named-accepted gaps, flight lands.

## HAT Protocol

Steps presented one at a time; human performs/witnesses and reports; failures diagnosed and fixed inline (Developer spawn for code changes; FEATURE requests promoted to scoped design review). Commit when all steps pass.
