# Validation plan

| ID | Reference | Status |
|---|---|---|
| ANALYTIC-001 | Hand-derived arithmetic (tests/fixtures/analytic-box-room.ts) | PASS (see VALIDATION_RESULTS.md). Proves the engine implements its stated formulas; does NOT prove agreement with Manual J. |
| ACCA-EX1 | ACCA Illustrated Example #1 (full Manual J) | NOT RUN. www.acca.org was blocked by the build sandbox; the file also sits behind ACCA's terms. |
| ACCA-EX2 | ACCA Illustrated Example #2 (Abridged) | NOT RUN, same reason. |
| ACCA-LONGHOUSE | EDU-1 Long House block/room loads | NOT RUN, same reason. |

To run an ACCA case: the owner downloads the file under ACCA's terms (do not commit it), supplies the example's inputs and expected totals as a fixture with the page/table citation, and we compare. Expect the cooling comparison to FAIL until CLTD/solar data is sourced; that gap is intentional and visible, not hidden.
