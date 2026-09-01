# Bundled Executable CLI (v0.2.2 release surface)

The desktop bundle owns the user-facing CLI. `dist/cli/main.js` is only a
build input; it is never the customer delivery mechanism.

`tauri build` invokes `npm run build:bundled-cli` through
`beforeBuildCommand`. That build creates the native Tauri `externalBin`
sidecar named `crm` (`crm.exe` in a Windows installation; `crm` in a macOS app
bundle), stages the Node runtime beside it, and stages the CLI bundle plus the
required `better_sqlite3.node` addon. The launcher resolves every runtime file
from the installed application layout and does not look up `node` on PATH.

The Settings page requests the active mode, active profile, fixed Profile DB
path, and installed CLI path from Rust. It displays those values read-only and
does not offer a SQLite or executable picker. In PROFILE mode, the copy button
uses the Rust-resolved absolute executable path, for example:

```text
"<absolute-cli-path>" --profile demo catalog
```

Agent integration is restricted to `catalog`, `cap`, `session`, and
`profile-status`. Agents must not call `confirm` and must not pass `--phrase`.
There is one bundled `crm` sidecar, not a separate Agent binary.

## Release truth

The planner catalog contains 25 capabilities, of which the CLI transports 21.
Exactly four Battle Card write capabilities are `EXPLICITLY_UNSUPPORTED`:

- `battle_card.draft.create`
- `battle_card.confirm`
- `battle_card.hypothesis.status.update`
- `battle_card.intelligence_import.confirm`

This does not mean all Battle Card capabilities are unsupported: the CLI keeps
`battle_card.current.read`, `battle_card.history.read`, and
`battle_card.context.read` as `SUPPORTED`. The four write capabilities above
must not be presented as supported.

A supported `cap` write stops at confirmation and never completes a business
write directly. A human running `crm confirm` enters the existing confirmation
execution path. `customer.delete` requires strong confirmation. Agent
integration must not call `confirm` or pass `--phrase`.

## Database boundary

The CLI and Agent working database is
`~/.localcrm/profiles/<profile>/crm.sqlite`. `personal-crm.db` is Desktop
LEGACY compatibility only. The CLI never uses the legacy production database
as its target and does not automatically migrate it.

## Troubleshooting `PROFILE_OPEN_FAILED`

When the installed CLI reports `PROFILE_OPEN_FAILED`, first check whether the
Agent sandbox can access the directory containing
`~/.localcrm/profiles/<profile>/crm.sqlite`. Do not immediately diagnose a
damaged bundled runtime or schema: a restricted Agent sandbox can produce this
error even when the bundled Node runtime, `better-sqlite3`, schema, and profile
filesystem are healthy. Granting the Agent filesystem access to
`~/.localcrm` does not change the storage boundary: the Agent may use CRM only
through the `crm` CLI and must never directly read or modify `crm.sqlite`.

## Installed runtime layout

The user CLI is the installed `crm` sidecar executable, not
`dist/cli/main.js`. Its runtime is resolved from the installed sidecar layout:

- Windows: `{exeDir}\crm-runtime`
- macOS: `Contents/Resources/crm-runtime`

`npm run verify:bundled-cli` stages a generated sidecar in a temporary mock
installation directory, clears PATH for the child process, verifies the JSON
catalog call, checks that a production database path is rejected, and verifies
that `customer.create` remains a no-write confirmation-required proposal.

The Rust resolver has Windows and macOS mock-layout unit coverage. This change
does not claim that a signed/notarized macOS package has been completed.
