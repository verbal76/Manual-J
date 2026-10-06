# Engineering review of the calculation path (2026-10-04)

## Where the logic lives
All load calculations are in `src/engine/calc.ts` (helpers in `geometry.ts`, `units.ts`, `validate.ts`). The UI and report only display engine output; the UI shows gross/net wall area by calling the engine's own geometry helpers (no second implementation of a formula).

## Formulas and constants
| Item | Value / form | Status |
|---|---|---|
| Conduction | Q = U·A·ΔT | textbook; exact |
| Sensible air | 1.08·CFM·ΔT, 1.08 = 60·0.075·0.24 (computed in code) | derived from standard-air density 0.075 lb/ft³ and cp 0.24 Btu/lb·°F; **values not yet cross-checked against ASHRAE Fundamentals** |
| Latent air | 60·0.075·1076·CFM·ΔW(grains)/7000 ≈ 4842·CFM·Δgr/7000 | hfg 1076 Btu/lb is a rounded textbook value; **needs owner/engineer confirmation** |
| CFM | ACH·V/60 | definition |
| grains per lb | 7000 | definition |
No other engineering constants exist. U/R values, ACH, design temperatures, humidity ratios, per-person gains and solar factors are all user-entered and carried with a quality tag (KNOWN/SELECTED/ESTIMATED/UNKNOWN).

## Assumptions embedded in the method (deliberate, now documented)
1. **Infiltration allocation:** one house-wide ACH per mode, applied to each room by volume. The house total equals ACH × total modelled volume; per-room numbers are an allocation, so an interior room with no exterior wall still receives an air load. Manual J's own infiltration method is not implemented (not sourced).
2. **Rectangular rooms:** floor/ceiling area = length × width unless the user enters an explicit ceiling/floor area (needed for vaulted/sloped roofs; a warning appears when a roof open to outdoors uses the floor area).
3. **Cooling is incomplete by design:** opaque surfaces use plain ΔT (no solar or thermal-mass effects); window solar gain only when SHGC and a user orientation factor exist. Totals are labelled INCOMPLETE.
4. Not included: duct gains/losses, mechanical ventilation, slab/below-grade floors, altitude correction.
5. Adjoining unconditioned spaces use user-entered winter/summer temperatures.
6. Display rounding only: results are carried unrounded; displayed lines are rounded individually, so a displayed total can differ from the sum of displayed lines by a few Btu/h.

## Findings from this audit and what was done
| Finding | Severity | Resolution |
|---|---|---|
| NaN, negative or absurd occupants/appliance gains, ACH, humidity, elevation, U, areas passed validation or produced NaN | P1 | Strict finite/range validation with errors; impossible values block the affected load; unusual values warn |
| Typing "96" for a 96-inch ceiling became 96 ft with no complaint | P1 | Plausibility errors/warnings on room, wall, opening and ceiling dimensions |
| Roof open to outdoors silently used floor area | P1 | Optional explicit area + warning when assumed |
| A malformed stored room could crash the whole calculation | P0/P1 | Per-room containment: INTERNAL error for that room, no crash |
| Number parsing accepted "0x10"/"1e3", rejected decimal commas | P2 | `parseNumber` strict decimal parser (comma accepted) |
| U > 6 or non-finite U was calculated | P1 | Rejected as implausible (with R-vs-U hint) |
| Only one hand-built reference case | P1 | Reference suite ANALYTIC-001…009, 150 seeded random houses vs an independent oracle, structural invariants, fuzzing |

## ANALYTIC-001 reassessed
It validates that the engine reproduces a single hand-derived house (two windows, a door, attic ceiling, two partitions, infiltration, latent). Its expected numbers are authoritative **only as arithmetic from the stated formulas**; they say nothing about agreement with Manual J. It is now one of nine analytic cases plus randomized oracle and invariant tests (`tests/fixtures/reference-suite.ts`, `tests/engine-properties.test.ts`, results in `docs/VALIDATION_RESULTS.md`). The values 3,795 / 1,347.2 / 415.029 Btu/h stay pinned.

## Still unverifiable without the owner
ACCA Example #1/#2 and Long House comparison (files not obtainable here); confirmation of the 0.075 / 0.24 / 1076 constants; a sourced assembly R/U library; a sourced cooling (solar/CLTD) method. Until then the app must not be used alone for equipment sizing.
