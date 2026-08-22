# AI Native CRM v0.2.1

v0.2.1 is a maintenance and release-readiness update for the V0.2 Agent Control Surface.

## Highlights

- Restored the complete frontend test suite: 241 files passed, 1 skipped; 3,433 tests passed, 16 skipped.
- Cleared the repository ESLint baseline to 0 errors and 0 warnings.
- Verified all 55 Rust tests and the TypeScript/Vite production build.
- Added CI quality gates for lint, frontend tests/build, and Rust tests.
- Fixed React hook and render-phase risks, including cancellable deferred effects and render-safe derived state.
- Extracted reusable component helpers to keep refresh boundaries and lint behavior predictable.
- Improved error propagation with contextual causes and corrected brittle test assertions.
- Added contributor, security, and release documentation for public maintenance.

## Upgrade notes

This patch release does not intentionally change the local CRM data model. Back up important local data before upgrading experimental software.

## Known limitations

- Natural-language coverage remains incomplete.
- Secondary and deep configuration surfaces are still being internationalized.
- Installers are platform-specific and require the corresponding Tauri build environment.
