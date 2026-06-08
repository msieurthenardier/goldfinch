# Leg: hat-and-alignment (optional)

**Status**: completed
**Flight**: [Pinnable Toolbar Items (Media + Shields)](../flight.md)

## Objective
Operator-guided acceptance of the pin/unpin system on the running app: icon/badge feel, the native right-click
Unpin, pin/unpin behavior, and "Site settings →".

## Session (2026-06-08)
- **Toolbar icons** — operator: the placeholder ASCII/Unicode glyphs (▤/◈) read poorly. **Swapped to inline
  SVG icons** (Lucide, ISC): a **clapperboard** for Media, a **shield** for Shields, and a proper **pushpin**
  for the Appearance pin toggles. Operator: **"looks good."** (See the DD2 override note in the flight log.)
- **Right-click → "Unpin"** — works (the native menu appears and unpins). Operator: the **native context
  menu is clumsy** against the app's chrome. Functionality accepted; **recorded a future need** — a
  system-wide custom context-menu component — in the mission Known Issues (out of scope here).
- **Pin/unpin via Appearance + "Site settings →"** — verified live in leg 7 (two-way sync across 3 toggles;
  "Site settings →" opens `goldfinch://settings#privacy`, not the panel). Operator satisfied.
- **Verdict**: **Land it** (operator).

## Outcome
- [x] Icons approved (after the SVG swap).
- [x] Right-click Unpin functional (clumsy native-menu styling → future need recorded).
- [x] Pin/unpin + "Site settings →" accepted.
- [x] Operator sign-off to land.

## Follow-ups (recorded, not done here)
- Mission Known Issues: **system-wide custom context-menu component** (on-brand, behavior-testable; likely
  graduates `menuController` as its 4th consumer).
- Carry to the flight debrief: the live behavior test caught a real two-way-sync bug (leg 7) — value of the
  behavior-test apparatus.

---

## Post-Completion Checklist
- [x] HAT performed; operator satisfied
- [x] Icon swap implemented + verified live
- [x] Future need recorded (mission Known Issues)
- [x] Flight log updated; leg `completed`; checked off in flight.md
