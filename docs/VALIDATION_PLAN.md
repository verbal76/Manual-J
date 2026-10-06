# Validation plan
| ID | Reference | Status |
|---|---|---|
| ANALYTIC-001 … 009 | Hand-derived first-principles cases (tests/fixtures/reference-suite.ts) | PASS (27 quantities, docs/VALIDATION_RESULTS.md). Proves the engine implements its stated formulas; does NOT prove agreement with Manual J. |
| Oracle + invariants | 150 seeded random houses vs an independent re-derivation, plus structural invariants and fuzzing (tests/engine-properties.test.ts) | PASS |
| ACCA-EX1 / EX2 | ACCA Illustrated Examples #1 and #2 | NOT RUN: acca.org unreachable from the build environment; downloads sit behind ACCA terms |
| ACCA-LONGHOUSE | EDU-1 Long House block/room loads | NOT RUN, same reason |

To run an ACCA case: the owner downloads the file under ACCA's terms (do not commit it) and supplies the example's inputs and expected totals with a page/table citation; we add a fixture and compare. Expect cooling to differ until a cooling method is sourced.
