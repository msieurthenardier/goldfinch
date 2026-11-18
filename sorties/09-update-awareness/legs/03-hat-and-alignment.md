# Leg: hat-and-alignment

**Status**: completed
**Flight**: [Update awareness](../flight.md)
**Kind**: interactive — the operator installs a release candidate and reports; the Flight Director guides.

## Objective

The operator sees the kebab dot and uses "Check now" on an installed build, and anything that looks wrong is aligned.

## Context

- Candidate `v0.19.16-rc.1` on `271889e`, tagged on the operator's word ("yes on the tag"), built and published by the release workflow as an immutable prerelease below the current stable release, so the real endpoint offers v0.19.16.
- Before the walk, two look-and-feel fixes from the behavior-spec Validator were made with the operator's "ok": the Check now result for a newer version reads "Found a newer version — see above." (it repeated the notice), and the result line clears when a check happens another way.

## Steps

1. The dot on the ⋮ button about a minute after start; the kebab item; the tooltip.
2. Settings → About: the running version, the notice, Check now and "Last checked".
3. Check now with automatic checks on: the result; an immediate second press.
4. Check now with automatic checks off: the notice and dot clear on unticking; a press after 30 seconds brings them back.
5. The look of the dot and the About block.

## Acceptance Criteria

- [x] The operator installed `v0.19.16-rc.1` on Windows and reported, verbatim: **"pass"** (steps 1–5).
- [x] No fix was needed during the walk.

## Not walked

- macOS and Linux installed builds.
