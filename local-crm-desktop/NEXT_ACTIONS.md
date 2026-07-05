# Next Actions - Local CRM After Loop 34

## Recommended Next Step

Do not jump directly into DB writes, Action Runner execution, UI confirmation, provider calls, or model calls.

The next formal feature loop should be one of these:

- Loop 35: ConfirmedAction Review Surface / Review Queue Readiness
- Loop 35: Action Runner Boundary Contract Readiness

Recommended safer route: start with the review surface / review queue readiness. It keeps ConfirmedAction envelopes inspectable and queue-shaped without making them executable.

The difference:

- Review Queue Readiness turns dry-run envelopes into review candidates / queue candidates. It remains UI-free, DB-write-free, and execution-free.
- Action Runner Boundary Contract defines runner input/output and preconditions. It is closer to execution and therefore higher risk, even if it remains non-writing at first.

## Recommended Route

### Loop 35A: ConfirmedAction Review Queue / UI-free Review Surface Readiness

Goal:

- Transform ConfirmedAction dry-run envelopes into review candidates / queue candidates.
- Preserve source proposal IDs, evidence refs, risk flags, preconditions, and blocked reasons.
- Keep candidates pending human review.

Boundaries:

- no DB write
- no execution
- no UI / React / pages integration
- no provider/model
- no Action Runner
- no `human_confirmed: true`

### Loop 35B: Human Confirmation Contract

Goal:

- Define the structure for human confirmation.
- Define confirmation evidence.
- Define operator identity placeholder.
- Define time/source metadata shape without using real execution.

Boundaries:

- still no execution
- still no DB write
- still no Action Runner
- still no UI confirmation flow

### Loop 36: Action Runner Contract Readiness

Goal:

- Define runner input/output contract.
- Define precondition contract.
- Define explicit forbidden operations.
- Define how non-executable and blocked actions are represented.

Boundaries:

- no real DB write
- no provider/model
- no state mutation
- no sending messages
- no customer/task/work item update

### Loop 37+: DB Write Dry-run / Transaction Plan

Goal:

- Generate SQL / write plan candidates only.
- Represent transaction boundaries and rollback expectations.
- Prove the plan is inspectable before execution.

Boundaries:

- do not execute SQL
- do not mutate live state
- do not bypass human confirmation

## High-risk Areas

Treat these as high-risk and require stronger process:

- UI confirmation
- `human_confirmed: true`
- Action Runner
- DB write
- provider/model integration
- state machine mutation
- sending messages
- customer update
- task update
- work item update

## Process Rules

Use three process classes.

### Class A - High Risk

Applies to:

- DB writes
- Action Runner
- UI confirmation
- model/provider integration
- state machine mutation
- message sending
- customer/task/work item mutation

Required process: Cursor Plan -> architecture review -> Codex -> three-party review -> commit.

### Class B - Medium Risk

Applies to:

- dry-run gates
- contracts
- adapters
- wrappers
- readiness modules

Allowed process: architect prompt -> Codex implementation -> three-party review -> commit.

### Class C - Low Risk

Applies to:

- documentation
- handoff updates
- test guard wording / path allowlist maintenance

Allowed process: Codex execution -> architect review -> commit.

Even low-risk work must start with Phase 0 and must HOLD if non-document files change unexpectedly.

## Immediate Forbidden Next Step

Do not directly implement:

- Action Runner execution
- DB write
- UI confirmation
- model provider
- auto-send message
- auto-update customer
- auto-update task
- auto-update work item
- any path that treats dry-run envelopes as executed actions

## Suggested Loop 35A Prompt Shape

Start with Phase 0:

- confirm HEAD is `6371048 add confirmed action live dry run readiness` or the later approved documentation commit if Loop 35A docs are committed first
- confirm tracked code is clean
- confirm only approved docs are untracked or already committed

Then limit scope to: ConfirmedAction dry-run envelopes -> review queue candidates.

Required safety claims:

- pending human review
- not executable
- not persisted
- not executed
- no DB read/write
- no provider/model
- no UI
- no Action Runner

## Review Reminder

Before any future commit, reviewers should verify that wording and tests do not imply:

- Action Runner completion
- DB write completion
- UI confirmation completion
- model call completion
- provider integration completion
- automatic execution completion
