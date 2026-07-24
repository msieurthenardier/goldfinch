# Releasing

Releases are **tag-driven**: pushing a `vX.Y.Z` tag runs `.github/workflows/build.yml`,
which builds installers for Windows/macOS/Linux and publishes a GitHub Release with them
attached. Nothing else is needed to ship the binaries.

## Cut a release

From an up-to-date `main` with green gates (`npm test`, `npm run typecheck`, `npm run lint`):

```bash
npm version patch -m "release-prep: bump to %s"   # or minor / major
git push --follow-tags
```

`npm version` does three things in one commit:

1. bumps `package.json` + `package-lock.json`,
2. runs the **`version` npm-lifecycle hook** → `scripts/update-readme.mjs` regenerates the
   README download links (from the new `package.json` version) and stages `README.md`, and
3. commits all of the above and creates the `vX.Y.Z` tag.

So the **README download-link bump is folded into release-prep** — there is no post-release
job that pushes back to `main`. (That job was removed: it required the `github-actions` bot
to bypass the `main` ruleset — "Changes must be made through a pull request" — which it
can't, so it only ever failed. Regenerating the links at bump time keeps `main` protected.)

`git push --follow-tags` pushes the release-prep commit **and** the tag. The tag fires the
build workflow; the installers publish a minute or two later, at which point the just-written
download links go live.

## Notes

- Pushing the release-prep commit straight to protected `main` relies on a **repo-admin
  bypass** of the pull-request rule (the maintainer pushes it directly). Everyone else opens
  a PR.
- The download links point at `vX.Y.Z` assets that don't exist until the build finishes — a
  short, expected window between the tag push and the installers appearing on the Release.
- To regenerate the links by hand for an arbitrary version:
  `node scripts/update-readme.mjs 0.11.1` (with no argument it uses the `package.json` version).
- The workflow's build job syncs `package.json` from the tag with `--ignore-scripts`, so the
  `version` hook never runs in CI — it only regenerates the README during local release-prep.
