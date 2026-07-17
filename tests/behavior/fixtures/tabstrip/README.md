# tabstrip fixture

Shared fixture set for the behavior tests that need **several tabs with pairwise-distinct,
stable titles** so individual tabs stay identifiable across strip reorder, cycling, capture,
re-parent, and close/reopen operations.

**Six pages**, `page1.html` .. `page6.html`, each titled **`Fixture Page N — tabstrip`**.
Six is not arbitrary — it is the maximum any consuming spec needs (`tab-cycling` opens all six;
see *Consumers* below). Pages are otherwise identical by design: the **title is the only
distinguishing feature**, so a spec that confuses two tabs fails on titles rather than on
incidental content.

Each page carries two stable, addressable markers:

- **`<h1 id="marker">`** — echoes the page title. A `readDom` / `readAxTree` read of a tab
  can confirm *which* fixture page a guest holds without depending on the `<title>` alone.
- **`<p id="body-marker">`** — a body-level marker, so a read that reaches the document body
  (rather than just the head) is distinguishable from one that did not.

Both markers are **contract**, not decoration: `multi-window-automation`'s DD6 no-raise step
reads a background-window guest's live DOM and identifies it by these ids. Do not rename them
without updating that spec.

Every page declares **`<meta charset="utf-8">`**, which is **load-bearing**: the titles contain
an em-dash (`—`). A prior run served these pages with no charset and the mojibake rode into a
title-distinctness read (`responsive-tab-strip` Preconditions records the incident). Keep the
declaration.

## Serve

Run from this directory:

```
python3 -m http.server 8000
```

The pages are then reachable at **http://127.0.0.1:8000/pageN.html** (N = 1..6) —
e.g. **http://127.0.0.1:8000/page1.html**.

Port **8000** is the convention every consuming spec's Preconditions names. If the bind fails,
serve on another port and substitute it consistently — but **probe that the port is free first**:
a port collision silently collapses every per-tab URL onto one already-served page, which reads
as "all tabs identical" rather than as a fixture fault (`responsive-tab-strip` records that
incident too).

## Consumers

Each spec resolves URLs as `http://127.0.0.1:8000/pageN.html`. Pages used, read off the specs:

| Spec | Pages used |
|---|---|
| `tab-cycling` | 1–6 (opens all six; **sets this set's size**) |
| `tab-context-menu` | 1–5 |
| `closed-tab-reopen` | 1–5 |
| `multi-window-shell` | 1–4 |
| `multi-window-automation` | 1 |

Adding a page is safe (nothing asserts the directory's size). **Removing or renumbering one is
not** — the specs address pages by number.
