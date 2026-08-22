# Contributing to AI Native CRM

Thank you for helping improve AI Native CRM. The project is experimental, but contributions should preserve its core product contract: an Agent may reason and propose actions, while CRM writes remain validated, capability-scoped, and human-confirmed.

## Development setup

Prerequisites:

- Node.js 22 or newer
- Rust 1.77.2 or newer
- Tauri 2 system prerequisites for your platform

```bash
git clone https://github.com/renjianxin929-ux/ai-native-crm.git
cd ai-native-crm/local-crm-desktop
npm ci
npx tauri dev
```

## Required checks

Run these before opening a pull request:

```bash
cd local-crm-desktop
npm run lint
npm test
npm run build
cargo test --manifest-path src-tauri/Cargo.toml
```

## Pull requests

- Keep changes focused and explain the user-visible behavior.
- Add or update tests for behavior changes and regressions.
- Preserve local-first storage and never commit provider credentials or real customer data.
- For Agent-driven mutations, retain proposal or clarification, explicit confirmation, validation, and capability authority checks.
- Destructive actions require stronger confirmation than ordinary writes.
- Note relevant limitations instead of overstating natural-language coverage.

## Good first contributions

- Improve zh-CN and en-US coverage on secondary screens.
- Add focused regression tests for Agent intent and capability boundaries.
- Improve developer documentation and platform setup instructions.
- Report reproducible UX issues with environment details and screenshots that contain no real customer data.

## Reporting bugs

Open a GitHub issue with the operating system, app version, reproduction steps, expected behavior, and actual behavior. For security issues, follow [SECURITY.md](SECURITY.md).
