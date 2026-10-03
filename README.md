# Manual-J
Field-first residential heating/cooling load **survey and calculation** tool (phone/tablet, offline). **Not ACCA-approved; not an official Manual J result.**

- `src/engine` deterministic engine (no UI imports): types, units, geometry, validation, calc, provenance.
- `src/model` factories, persistence + schema migration. `src/report` report generator. `src/ui` vanilla-TS field UI.
- `tests` engine tests + analytic fixture; `npm run validate` writes `docs/VALIDATION_RESULTS.md`.
- Android: Capacitor wrapper in `android/`; CI (`.github/workflows/android.yml`) builds a debug APK per commit.

Commands: `npm ci`, `npm test`, `npm run build`, `npm run dev`.
Docs: `docs/ENGINEERING_SOURCES.md`, `docs/IMPLEMENTATION_BRIEF.md`, `docs/VALIDATION_PLAN.md`, `docs/OWNER_QUESTIONS.md`.
Engineering rule: no unsourced constants. Unknown values stay UNKNOWN and block the affected load.
