# Open owner decisions
1. **Assembly R/U library** — Provide (or approve a public source for) wall/window/door/ceiling/floor values keyed to framing/insulation/era so the app can pre-fill them as SELECTED with a citation. Default: none shipped; user enters each value once per project.
2. **ACCA example access** — Download Illustrated Example #1/#2 and Long House under ACCA's terms and give us the inputs/expected totals (or legal go-ahead to cite them). Default: validation stays analytic-only.
3. **Cooling method** — Cooling needs sourced solar/CLTD-type data. Choices: (a) you supply a licensed table to key in privately, (b) adopt a public method (e.g. ASHRAE RTS/CLTD data you hold), (c) ship heating-only plus plain-ΔT cooling flagged INCOMPLETE (current). Default: (c).
4. **Slab/below-grade, ducts, mechanical ventilation** — Same sourcing gap; currently excluded and flagged.

## Infrastructure phase (OTA / Play)
5. **Package ID** — RESOLVED 2026-10-03: changed to com.hotatticgames.manualj before first Play upload (earlier test APKs used com.verbal76.manualj; their local data does not transfer).
6. **OTA hosting** — STILL OPEN, intentionally undecided (repo stays private; no manifest URL configured; updates disabled). Options: public repo/`ota` branch, or another static host? Needs a public URL (set repo variables OTA_MANIFEST_URL / OTA_URL_BASE, rebuild native with OTA_MANIFEST_URL). Default: keep updates disabled until chosen.
7. **Canonical Hot Attic Games logo** — add branding/Hot_Attic_Games_Master_Logo.png. Default: no studio card until supplied.
