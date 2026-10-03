# Manual J Calculator — Initial Implementation Brief

## Product goal

Build a fast, field-friendly residential heating and cooling load calculator for phone/tablet use. The product should turn the traditional worksheet workflow into guided data entry, deterministic calculations, room and whole-house results, and a clear exportable report.

## Calculation pipeline

Project/design conditions -> house/room geometry -> opaque assemblies -> fenestration -> infiltration/ventilation -> internal loads -> duct/system effects -> heating load + cooling sensible load + cooling latent load -> room totals -> whole-house totals -> report.

## Engineering rules

1. Calculations are deterministic. AI must not invent engineering values.
2. Separate calculation/data modules from UI code.
3. Every lookup table, coefficient, default, and formula must carry provenance.
4. Unit conversions must be centralized and tested.
5. Inputs must be validated before calculation.
6. Unknown construction data must be visibly identified rather than silently guessed.
7. Results must distinguish heating, cooling sensible, cooling latent, and total cooling load where applicable.
8. Room-by-room and block-load workflows should share the same calculation engine.
9. Build regression fixtures from authoritative published examples before treating the calculator as trustworthy.
10. Do not claim ACCA approval.

## UX target

A technician or salesperson should be able to walk a house with a phone/tablet and enter the survey progressively. Favor large controls, reusable construction presets, room duplication, immediate subtotals, clear missing-data warnings, autosave/recovery, and an end-of-job review before final calculation.

## First usable milestone

A vertical slice is complete when:
- a project can be created and saved;
- design conditions can be entered;
- rooms and envelope components can be entered;
- the supported load components calculate deterministically;
- room and whole-house results are visible;
- a project can be reopened without data loss;
- a readable report can be generated;
- automated calculation tests reproduce selected authoritative reference examples within documented tolerances.

See docs/ENGINEERING_SOURCES.md for source provenance.
