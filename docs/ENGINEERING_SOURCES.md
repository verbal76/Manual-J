# Manual J Engineering Source Register

This repository uses authoritative public references to guide implementation and validation. Do not represent this project as ACCA-approved software unless and until ACCA approval is actually obtained.

## Primary ACCA references

1. ACCA Manual J Residential Load Calculation overview
   https://www.acca.org/standards/technical-manuals/manual-j
   - Describes current Manual J scope, procedure sections, normative tables, documentation, and approved-software distinction.
   - The full Manual J is copyrighted/purchased material and is not copied into this repository.

2. ACCA Residential System Design Review Forms & Examples
   https://www.acca.org/viewdocument/residential-system-design-review-forms-examples
   - Public download library.
   - Illustrated Example #1 demonstrates the full ANSI-recognized Manual J procedure.
   - Illustrated Example #2 demonstrates the Manual J Abridged Edition procedure.
   - Includes current HVAC plan-review forms.

3. ACCA EDU-1: Manuals J, D, and S
   https://www.acca.org/viewdocument/edu-1-manuals-j-d
   - Public educator resource library.
   - Includes Long House block-load and room-load explanatory material and spreadsheets.
   - Useful as reference cases for regression/acceptance testing.

4. ACCA Manual J Abridged Edition SpeedSheet
   https://www.acca.org/viewdocument/acca-speed-sheet-for-manual-j-abridged-edition
   - ACCA states this requires Excel and a copy of Manual J.
   - Use as a reference/learning resource subject to ACCA's displayed copyright/download terms.
   - It is not a replacement for the full Manual J or ACCA-approved software.

5. ACCA Manual J 2016 ANSI update summary
   https://www.acca.org/news/release/acca-2016-manual-j-recognized-by-ansi
   - Useful for current procedure/version context and changed requirements.

## Repository policy

- Preserve URLs, titles, publication/version information, and provenance for every engineering reference.
- Do not copy or redistribute copyrighted Manual J tables/manual text without permission.
- Where a source requires accepting download/copyright terms, keep the canonical source link rather than bypassing those terms.
- Derive implementation requirements in original project documentation.
- Every calculation should eventually have a traceable source and automated verification case.
- Published output must not claim to be an official or ACCA-approved Manual J result unless the software has actually received the required approval.

## Immediate validation targets

The first calculation engine should be checked against ACCA's published illustrated examples and Long House educational examples. Record each test case's source, inputs, expected output, actual output, tolerance, and pass/fail result in the repository.

Last source review: 2026-10-03
