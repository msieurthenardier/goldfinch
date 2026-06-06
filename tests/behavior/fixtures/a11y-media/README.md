# a11y-media fixture

Media-bearing page for the `npm run a11y` accessibility sweep (Flight 5 / DD3). It
carries one image (`bird.png`), one audio clip (`tone.wav`), and one video
(`clip.webm`) as same-directory local assets so the media panel catalogs an
image / audio / video card — which in turn renders the media-pick checkboxes,
the docked player transport, and (via the image) the lightbox dialog that the
F23/F24 axe checkpoints audit.

Media **must** load over `http(s)`, not `file://` — the media panel never
catalogs `file://` sources. There is deliberately no `<iframe>` embed (only
youtube/vimeo-style embeds are cataloged, so a local one would not appear).

## Serve

Run from this directory:

```
python3 -m http.server
```

The fixture is then reachable at **http://127.0.0.1:8000/**. Point the audit at it
with `npm run a11y -- --url=http://127.0.0.1:8000/` (this is also the harness
default).
