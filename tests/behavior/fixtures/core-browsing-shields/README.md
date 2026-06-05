# core-browsing-shields fixture

Behavior-test fixture for the `core-browsing-shields` test. Serves a static page that
requests a known tracker domain (`google-analytics.com`) so Shields can block it, and
accepts tracking params in the URL so the param-strip path can be asserted.

## Serve

Run from this directory:

```
python3 -m http.server 8080
```

The fixture is then reachable at:

- **http://127.0.0.1:8080/** — base fixture (tracker-block assertion)
- **http://127.0.0.1:8080/?utm_source=test&q=keep** — param-strip assertion URL
