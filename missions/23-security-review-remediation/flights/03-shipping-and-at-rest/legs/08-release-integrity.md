# Leg: release-integrity

**Status**: planning
**Flight**: [Shipping and At-Rest](../flight.md)

## Objective

A published installer can be traced to the workflow run and commit that built it, a stable release can only come from history that is on `main`, a published release cannot be altered, and the documentation tells an operator and a downloader how to check each of those.

## Context

- Flight DD3 (mission findings 7 and 19: unsigned, unattested artifacts; release tags unprotected). Operator decision at mission planning: no code-signing certificates — checksums, provenance, protected tags, immutable releases. Built on leg `release-build-split`'s topology: `create-release` → `build` (read-only, no token) → `upload` (no project code) → `publish-release`.
- **Checksums already exist.** GitHub computes a SHA-256 digest for every release asset (`gh api repos/msieurthenardier/goldfinch/releases/latest -q '.assets[] | "\(.name) \(.digest)"'` — one per asset on v0.19.15). No checksum file is published; the docs point at the digest.
- **What GitHub's documentation says** (read 2026-11-17 from docs.github.com and the action READMEs; quoted in the flight log):
  - *Attestations*: available to public repositories on every plan; the attesting job needs `id-token: write` and `attestations: write` (and `contents: read`); `actions/attest-build-provenance` v4 is a wrapper over `actions/attest`, which new work should use; `subject-path` takes globs or a list; verification is `gh attestation verify <file> -R <owner>/<repo>`. The flag that pins the signer workflow was **not** in the pages read — to be read from `gh attestation verify --help` at implementation.
  - *Immutable releases*: enabled in repository Settings → Releases ("Enable release immutability"); applies to releases published **after** it is enabled; the recommended flow is exactly this workflow's (create a draft, attach every asset, then publish); after publishing, assets and the tag are locked — "Git tags cannot be moved" and cannot be deleted while the release exists; a release can be deleted, and then the tag can be deleted **but its name cannot be reused**; the title, the notes, and the prerelease / latest flags stay editable; publishing an immutable release creates a **release attestation**, checked with `gh release verify <tag>` and `gh release verify-asset <tag> <file>`. **Not stated**: whether prereleases are covered, whether a draft is locked in any way, a REST endpoint to enable it.
  - *Tag rulesets*: "Restrict creations", "Restrict updates" and "Restrict deletions" exist for tags, with a bypass list that can name the repository-administrator role. **Not stated**: whether restricted creation stops the workflow's token from creating a *release* for a tag that already exists.
- **Consequences for the existing flow** (`docs/RELEASING.md`):
  - The rollback recipe in CLAUDE.md and the clean-up recipe for release-candidate builds (`gh release delete vX.Y.Z --yes --cleanup-tag`, "fix, re-tag") stop being true: a deleted immutable release's tag name is spent. Rollback becomes "publish the next patch version"; a candidate number is used once.
  - Since leg `release-build-split`, a manual dispatch leaves real installers as one-day artifacts on the run. A hands-on Windows or macOS check no longer needs a public prerelease at all; a prerelease is needed only when the published path itself is under test.
- **How releases are really cut** (repository history, read at leg design): the last four stable tags all point at commits that are on `main` (`gh api …/compare/main...v0.19.15` → `identical`), and the version bumps arrived by pull request (`release-prep: bump to 0.19.15 (#290)`) — while `docs/RELEASING.md` still describes `npm version` followed by `git push --follow-tags` straight to `main`, which the `main` ruleset ("changes must be made through a pull request") does not allow. **The Flight Director asks the operator for the real sequence before this leg flies**; the rewritten doc describes that, and the stable-tag check is designed around it.
- The app's update notice believes a stable tag from GitHub's `releases/latest`. That makes "a stable release can only come from `main`" a property the notice depends on, not only a release nicety.
- **No crew member changes a repository setting, pushes a tag, or publishes a release.** The leg supplies exact commands; the operator runs them.

## Inputs

- Leg `release-build-split` landed with a green manual dispatch run. The operator's description of how they cut a release.

## Outputs

- `.github/workflows/build.yml` (attestation in `upload`, the stable-tag check in `create-release`), `docs/RELEASING.md`, `README.md` and `scripts/update-readme.mjs` (the verify recipe), `ci/README.md` if it describes releases, CLAUDE.md, the workflow-invariant test extended; a short operator runbook in the flight log for the two repository settings.

## Acceptance Criteria

- [ ] **AC1 — Provenance in the upload job.** After the name and digest assertions and **before** the upload, `upload` attests the five installers with GitHub's attestation action (pinned to a full commit SHA resolved from the action's repository, the major version current on the day). The job's permissions become exactly `contents: write`, `id-token: write`, `attestations: write`; `build` stays `contents: read` with no token. The step runs on tag builds only — a manual dispatch attests nothing (an attestation for an unpublished build would be a false statement about a release). The invariant test from leg `release-build-split` is extended: `id-token` and `attestations` appear in `upload` and in no other job; the attest step is absent from `build`.
- [ ] **AC2 — A stable tag must be on `main`.** In `create-release`, after the semver validation and before the draft exists: when the tag is stable, ask GitHub's compare endpoint whether the tagged commit is contained in `main` (`repos/{repo}/compare/main...{sha}` → status `identical` or `behind`), retry once after a short wait on `ahead` / `diverged` or an error (a tag and its commit can arrive moments apart), and fail the workflow with a clear message otherwise. A prerelease tag skips the check, and stability is decided from the tag string by the existing classification — a name cannot claim the exemption while looking stable. The check needs no checkout. The decision is one small shell function; a unit test extracts it from the workflow and runs it against canned compare answers (`identical`, `behind`, `ahead`, `diverged`, an error body) for a stable and a prerelease tag.
- [ ] **AC3 — The check is shown working without pushing a bad tag.** The same function is run locally against the live endpoint for real commits (read-only requests): the commit of `v0.19.15` → allowed; the flight branch's head (not on `main`) → refused. Quoted in the log.
- [ ] **AC4 — Verify-your-download, for people who download.** `README.md` gains a short section **outside** the generated download block (or `scripts/update-readme.mjs`'s template is extended — whichever keeps `npm version` from wiping it; `update-readme.test.js` covers the choice): how to see an asset's SHA-256 on the release page and compare it (`sha256sum` / `Get-FileHash` / `shasum -a 256`), and `gh attestation verify <file> -R msieurthenardier/goldfinch` with the signer-workflow flag as read from `gh attestation verify --help`; plus `gh release verify-asset` once immutable releases are on. It says plainly what this does and does not prove: the file was built by this repository's workflow from the named commit — not that the code is safe, and not an operating-system signature (Windows SmartScreen and macOS Gatekeeper will still warn).
- [ ] **AC5 — `docs/RELEASING.md` describes what is true.** Rewritten sections: cutting a release as the operator actually does it; what each workflow job may do; the stable-tag rule and the prerelease exemption; **rollback under immutable releases** (never re-tag — the name is spent; publish a patch); **release candidates** (a hands-on build comes from a manual dispatch run's artifacts; a prerelease tag only when the published path is under test; each `-rc.N` is used once; a candidate tagged below the current stable version when the update notice itself is under test); what a release contains (five installers, GitHub's digests, a provenance attestation per installer, the release attestation); the verification commands; and the operator's two one-time repository settings with the reason for each. CLAUDE.md's *Release / CI* and *Cutting a release* paragraphs are brought into line, including the rollback sentence.
- [ ] **AC6 — The operator runbook** (in the flight log, exact and copy-able, each with how to confirm it took effect and how to undo it): (1) the tag ruleset on `v*` — restrict creation, update and deletion, bypass for the repository-administrator role — as a `gh api repos/msieurthenardier/goldfinch/rulesets` call with its JSON body, plus the Settings path as the alternative; (2) immutable releases — the Settings path (and the API call only if `gh api` help or the REST reference shows one; never an invented endpoint). It states the order (ruleset first; immutability last, after the candidate's dry behaviour is understood) and what each makes irreversible.
- [ ] **AC7 — Checkpoint: the operator applies the settings, then a candidate is cut.** The Developer stops with `[HANDOFF:review-needed]`. The Flight Director walks the operator through the runbook. Verified by read-only calls afterwards: `gh api …/rulesets` lists the tag ruleset; `gh api …/immutable-releases` (or the Settings page, by the operator's word) shows it on. The two things the documentation did not state are then **measured on the acceptance candidate** in leg `hat-and-alignment` and recorded: the workflow's token can still create the draft release for a tag the operator pushed under the ruleset; a prerelease is immutable too. If the ruleset blocks the workflow, the fix (a bypass entry for the workflow's identity, or creating the release differently) is a Flight Director decision with the operator.
- [ ] **AC8 — Gates.** `npm test`, `npm run typecheck`, `npm run lint`, `npm run format:check`.

## Verification Steps

- AC1, AC2: the extended invariant test and the new function test. AC3: the quoted runs. AC4–AC6: read by the Flight Director against GitHub's documentation as quoted in the flight log. AC7: the read-only API calls.

## Implementation Guidance

1. The stable-tag function, its test, and the live read-only demonstration.
2. The attestation step and the permission change; extend the invariant test.
3. `gh attestation verify --help` and `gh release verify --help` for the exact flags; then the README section and `update-readme` handling.
4. `docs/RELEASING.md`, CLAUDE.md.
5. The runbook. Gates, flight-log entry, `[HANDOFF:review-needed]`. Do not commit, push, tag, dispatch, or change any setting.

## Edge Cases

- **The compare endpoint for a tag pushed seconds ago** returns 404 or `ahead`: one retry after a wait; then fail loudly — a failed release run is recoverable (push the tag again after the commit is on `main`), a stable release from unreviewed history is not.
- **`main` is renamed or the default branch changes**: the check names the repository's default branch from the event payload rather than the literal, if that is one line; otherwise the literal and a comment.
- **The attestation action's inputs changed in the current major**: follow its README; never guess an input name.
- **A release created before immutability was enabled** stays mutable: the docs say which release is the first immutable one once known.
- **`npm version` regenerates the README block**: the verify section must survive it — proven by running `node scripts/update-readme.mjs` in the test or by hand and diffing.
- **Anything needing a design call**: `[BLOCKED:<reason>]`.

## Files Affected

- `.github/workflows/build.yml`
- `test/unit/release-workflow-invariants.test.js` (extended), a test for the stable-tag function
- `README.md`, `scripts/update-readme.mjs`, `test/unit/update-readme.test.js`
- `docs/RELEASING.md`, `CLAUDE.md`, `ci/README.md` (only if it describes releases)

## Citation Audit

Checked by the Flight Director on 2026-11-17: the published digests on v0.19.15; `gh api …/compare/main...v0.19.15` → `identical`, and that the last four stable tags are ancestors of `origin/main`; `git log` — `release-prep: bump to 0.19.15 (#290)`; `docs/RELEASING.md` *Cut a release* and *Windows HAT build*; `README.md`'s `DOWNLOADS:START` / `DOWNLOADS:END` markers and `scripts/update-readme.mjs`; GitHub's documentation as fetched 2026-11-17 (listed above, with what it did not state). Written before leg `release-build-split` was built: **re-audited against that leg's actual workflow before this leg is marked `ready`.** Tier: **high** — release pipeline, repository settings, irreversible steps. Developer design review required.

---

## Post-Completion Checklist

Completion steps — status transitions, flight-log update, checking off in the parent flight, and commit — are Flight Control protocol, driven by the execution workflow. Not repeated here.
