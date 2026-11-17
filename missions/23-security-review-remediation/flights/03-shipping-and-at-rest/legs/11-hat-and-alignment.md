# Leg: hat-and-alignment

**Status**: in-flight
**Flight**: [Shipping and At-Rest](../flight.md)
**Kind**: interactive — acceptance on a real public release candidate. Operator instruction 2026-11-17: "you can do all of that except Ill install the release candidate" — the Flight Director applies the two repository settings, pushes the candidate tags, runs the refusal test and the verification commands; the operator installs the candidate and reports what they see. No crew agent runs this leg on its own.

## Objective

Run, for the first time and on the real thing, every part of this flight that needs a pushed tag or a repository setting, and have the operator see the installed candidate behave.

## Context

- Flight DD8. Everything below is a first real run: leg `release-integrity`'s log entry lists the twelve items; leg `release-build-split`'s tag-only steps have never executed.
- **Order** (leg 08 runbook): tag ruleset → first candidate → the refusal test → immutable releases → second candidate → verification commands → the operator's install.
- **Each candidate is public and, once immutability is on, its tag name is spent.** Candidates are `v0.19.15-rc.N`, below the current stable, so the installed candidate is genuinely offered v0.19.15 by the real endpoint.
- **The refusal test is the one step that could do harm if the thing under test were broken**: a stable-looking tag on a commit that is not on `main` must be refused by `create-release`. If the check wrongly allowed it, the run would go on to publish a stable release from unreviewed history. Guard: the run is watched from the moment the tag is pushed and **cancelled at once** if `create-release` succeeds — the builds take minutes before anything could be published, and a draft is not public — then the draft and tag are deleted. It runs **before** immutability is turned on, so that clean-up is unrestricted.
- A failed candidate run is fixed through a Developer (never by the Flight Director editing source), committed, pushed, and re-cut under the next `-rc.N`.
- This host's `gh` is 2.45.0 and lacks `gh attestation` and `gh release verify`. A current `gh` binary is fetched into the session scratch directory from the CLI's own release page and checked against its published checksum; nothing is installed system-wide.
- Fix-versus-feature rule for anything the operator's install turns up: a look-and-feel fix goes inline through a Developer; new behaviour gets a scoped design review first; the Flight Director says which.

## Steps

1. **Tag ruleset** applied from the runbook; read back.
2. **Candidate 1** — `v0.19.15-rc.1` on the flight branch head. *Look for:* the owner's tag push is accepted under the ruleset; `create-release` classifies it a prerelease and skips the stable check; the workflow's token can still create the draft; three builds; `upload` verifies, uploads five installers, **attests** (first run — permissions, the multi-line subject list); `publish-release` publishes a prerelease, not latest. The release holds exactly five assets.
3. **Refusal test** — a stable-looking tag on the flight branch head (not on `main`). *Look for:* `create-release` fails at *Require a stable tag to be on the default branch*, printing the compare status; no release, no draft. Tag deleted afterwards.
4. **Immutable releases** on; read back.
5. **Candidate 2** — the next `-rc.N`. *Look for:* published prerelease is immutable (the API says so); its release attestation exists.
6. **Verification, verbatim from the README**: digest comparison; `gh attestation verify … --signer-workflow …`; `gh release verify` / `verify-asset`.
7. **Operator installs the last candidate** (Windows): it installs and starts; Settings → About shows the candidate version and "Version 0.19.15 is available"; the button opens the release page; the kebab shows "Update available" (by eye — automation cannot see it); turning the setting off clears both; a refused launch switch (a shortcut with `--js-flags=--expose-gc`) shows the error box and does not start; the About block's spacing.
8. **By-eye checklist** in `docs/RELEASING.md`: the operator walks what they choose; the rest stays listed.

## Acceptance Criteria

- [ ] Steps 1–6 each recorded in the flight log with the run URL, the decisive log lines and the command output; every unknown the documentation left open is answered in writing (ruleset vs release creation; prerelease immutability; `GITHUB_SHA` on an annotated tag; the attestation permission set; the `update` rule's parameter).
- [ ] The refusal test refused, and left nothing behind.
- [ ] Step 7 reported by the operator in their own words; anything wrong fixed and re-checked, or accepted with the acceptance recorded.
- [ ] Docs corrected for anything the walk showed to be different from what they say (the README's verification commands above all).
- [ ] Whatever was not walked is listed in the flight log as not verified.

## Edge Cases

- **The ruleset blocks the workflow's release creation**: stop; decide a bypass for the Actions integration with the operator.
- **The attestation step fails for a missing permission**: one-line fix through a Developer, next candidate.
- **A candidate publishes something wrong** (extra asset, marked latest): before immutability — delete the release and tag; after — it stays, is recorded, and is superseded.
- **The refusal test's run is not refused**: cancel the run, delete draft and tag, stop the walk, back to design.

---

## Post-Completion Checklist

Completion steps — status transitions, flight-log update, checking off in the parent flight, and commit — are Flight Control protocol, driven by the execution workflow. Not repeated here.
