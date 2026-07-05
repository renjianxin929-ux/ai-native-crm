# Local CRM Handoff - AI Readiness Chain Through Loop 34

## Current Baseline

- Latest commit: `6371048 add confirmed action live dry run readiness`
- Expected working tree before this documentation commit:
  - tracked code clean
  - untracked may include `HANDOFF.md` and `NEXT_ACTIONS.md`
- Expected working tree after this documentation commit:
  - tracked code clean
  - `HANDOFF.md` and `NEXT_ACTIONS.md` should be tracked
  - no Loop 35A documentation files should remain untracked
- This handoff is Loop 35A documentation freeze only. It is not Loop 35 feature work.

## What This Project Is

This repository is a general AI-native sales CRM Core with a Vertical Rule Profile architecture.

It is not a GEO-only CRM. GEO / foreign-trade workflows are the current default vertical profile or first application direction, not hardcoded CRM Core identity. Future work should keep CRM Core generic and move vertical-specific behavior behind profile/rule boundaries.

## Completed Chain

The current safety chain reaches dry-run ConfirmedAction envelopes:

SQLite loaded snapshot -> Read-only Snapshot Loader -> Snapshot Adapter -> Read-only Agent Live Dry-run -> Suggest-only Live Dry-run -> ConfirmedAction Live Dry-run envelopes

This chain is intentionally read-only / dry-run / non-executing. It proves structured handoff across readiness gates, not production automation.

## Completed Loops / Commits

Core readiness chain commits:

- `31f5518 add confirmed action contract readiness`
- `f1a731a add read only snapshot loader readiness`
- `090449b add read only agent snapshot adapter readiness`
- `6b39294 add read only agent live dry run readiness`
- `85f38ca add suggest only live dry run readiness`
- `6371048 add confirmed action live dry run readiness`

Earlier AI readiness foundations:

- `f959d04 add sales ai eval dataset readiness`
- `d9244d3 add sales ai eval runner readiness`
- `e8a26ee add prompt runtime readiness`
- `0f38f19 add model router runtime readiness`
- `4b183f9 add read only agent readiness`
- `3c1f375 add suggest only agent readiness`

## What Is Actually Implemented

- Read-only Snapshot Loader is read-only / select-only readiness.
- Snapshot Adapter is a candidate bridge from loaded snapshot shape into agent-compatible candidate structures.
- Read-only Agent Live Dry-run consumes caller-provided loaded snapshot data and emits a read-only answer only.
- Suggest-only Live Dry-run consumes caller-provided read-only live dry-run result and emits review proposals only.
- ConfirmedAction Live Dry-run consumes caller-provided Suggest-only Live Dry-run Result and emits pending human confirmation dry-run envelopes only.
- All current chain links remain no execution, no DB write, no provider, no model, no UI confirmation, and no Action Runner.

Loop 34 specifically means: Suggest-only Live Dry-run Result -> ConfirmedAction dry-run envelopes.

Loop 34 does not mean the action can run, write, confirm, send, or mutate state.

## What Is Not Implemented Yet

The following are not implemented:

- Action Runner
- DB write AI action
- UI confirmation
- provider integration
- real model calls
- automatic execution
- state machine writes
- sending messages
- human-confirmed execution flow
- customer/task/work item mutation from AI actions

## Non-negotiable Boundaries

- Do not treat dry-run output as real execution.
- Do not treat a ConfirmedAction envelope as an executed action.
- Do not write DB without explicit human confirmation, runner boundary, and write guard.
- Do not call provider/model from readiness gates.
- Do not skip Phase 0 git verification.
- Do not rely on memory or chat history as repository truth.
- Do not disguise fixture / synthetic paths as live paths.
- Do not hardcode GEO into CRM Core.
- Do not route around static guards to make tests pass.
- Do not turn `human_confirmed: true` into a shortcut for execution.

## Testing Status

Loop 34 completion and Risk-Close verification reported:

- `pnpm test`: 59 files / 737 tests passed
- `npm.cmd run build`: passed

This is the test status at Loop 34 completion. It does not exempt future changes from rerunning their own Phase 0, targeted tests, full test suite, and build as appropriate.

## Handoff Rules For Next Agent

The next agent must:

- run `git rev-parse HEAD`
- run `git status --short`
- confirm the baseline before doing any work
- treat handoff text and chat history only as candidate context
- derive repository facts from current git/log/diff/tests/source
- repeat Phase 0 for every loop
- stop with HOLD if baseline, scope, or safety boundaries do not match
- keep documentation-only loops out of feature development

High-risk loops must use: Cursor Plan -> architecture review -> Codex implementation -> three-party review -> commit.

High-risk means DB writes, Action Runner, UI confirmation, model/provider integration, state machine mutation, message sending, or any path that can turn a suggestion into an executed business action.
