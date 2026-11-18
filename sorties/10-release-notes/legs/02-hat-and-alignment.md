# Leg: hat-and-alignment

**Status**: in-flight
**Flight**: [Release notes](../flight.md)

## Objective

The operator approves the published text, the publishing path is proven on a real release candidate, and the releases already published without notes carry the approved text.

## Context

- Leg 01 landed and the code review confirmed it (`[HANDOFF:confirmed]`, nothing blocking). Interactive leg: the Flight Director guides, the operator decides; no Developer unless a fix is needed (fix-vs-feature gate applies).
- Outward actions (push, tag, `gh release edit`) happen only on the operator's word, each one.

## Acceptance Criteria (walk steps, one at a time)

- [x] **W1** — Operator approves `docs/releases/v0.19.16.md` word for word (or asks for changes, applied and re-shown).
- [x] **W2** — Same for `docs/releases/v0.19.17.md`.
- [x] **W3** — Operator decides on `docs/releases/v0.19.15.md` (outside the charter's two releases): approve to apply, edit, or drop the file.
- [x] **W4** — The Flight Director drafts `docs/releases/v0.19.18.md` (this sortie's own notes, the candidate's text); operator approves.
- [ ] **W5** — On the operator's word: commit the sortie (leg 01 + artifacts; never the operator's `squawks/0195-…` edit) and push the branch; then tag `v0.19.18-rc.1` on the pushed head and push the tag.
- [ ] **W6** — The run: all jobs green; step summary `Release notes: docs/releases/v0.19.18.md`; `gh release view v0.19.18-rc.1` shows title `v0.19.18-rc.1 — …`, text opening `Release candidate for v0.19.18 — for testing, not general use.`, `isPrerelease: true`, immutable, five assets.
- [ ] **W7** — On the operator's word: `gh release edit` v0.19.16 and v0.19.17 (and v0.19.15 if approved) with title and text from the workflow's own `split_release_notes` run locally on the approved file; afterwards each shows the approved title and text and still has five assets; v0.19.17 is still `latest`.

## Verification Steps

Each W-step's observation is recorded in the flight log's leg 02 entry.
