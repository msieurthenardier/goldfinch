# Squawk 0023: Automation audit log records full URLs including query strings

**Status**: open
**Type**: defect
**Severity**: routine
**Reported**: 2026-08-27
**Completed**: —

## Report

The MCP audit log writes the full URL of `navigate` calls, query string and fragment included, and the log is broadcast to the chrome and settings renderers. A navigation to a magic-link or `?token=` URL therefore persists the secret in the audit record. Strip query and fragment (keep scheme + host + path) before logging.

Source: maintenance report 2026-08-27, finding F10h.

## Evidence

- `src/main/automation/mcp-server.js:104, :106` — audit entry construction
- `src/main/main.js:1035` — audit broadcast to renderers

## Corrective Action

*(written at completion)*

## Verification

*(written at completion)*

## Sign-Off

*(written at completion)*
**Reviewer**: —
**Verdict**: —
**Commit**: —
