# Rules for Claude sessions in this repo
- Public naming: the product is **Manual J**; the only public version is `v<number>` (sequential integers). Artifacts `Manual-J-v<N>.apk`, GitHub Release title `Manual J v<N>`, marked Latest. Never use codenames, build numbers, SHAs or semver in titles/filenames. Full rules: `docs/RELEASING.md`. Next delivered build is the number in `release/VERSION`.
- Never reuse a version number; never replace a release's binary.
- Engineering rules: no invented engineering constants; unsourced values stay UNKNOWN; do not claim ACCA approval; calculation engine stays UI-free and deterministic; ANALYTIC-001 must stay 3,795 / 1,347.2 / 415.029 Btu/h.
- Package ID is com.hotatticgames.manualj (decided; do not revert). OTA hosting is intentionally undecided; do not publish OTAs or make the repo public.
- Verify claims against the built APK, not just source (permissions were once misreported from source).
