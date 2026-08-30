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

`npm run verify:bundled-cli` stages a generated sidecar in a temporary mock
installation directory, clears PATH for the child process, verifies the JSON
catalog call, checks that a production database path is rejected, and verifies
that `customer.create` remains a no-write confirmation-required proposal.

The Rust resolver has Windows and macOS mock-layout unit coverage. This change
does not claim that a signed/notarized macOS package has been completed.
