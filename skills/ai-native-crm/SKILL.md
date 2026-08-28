---
name: ai-native-crm
description: Use the v0.2.2 AI Native CRM CLI through its catalog, profile isolation, and human-confirmation boundary. Apply when reading CRM data or preparing a supported CRM proposal; never use it to confirm or directly access CRM storage.
---

# AI Native CRM v0.2.2

The CLI entrypoint is in `local-crm-desktop`. Treat its `catalog` as the
authority for the current CLI surface: every catalog entry is marked
`SUPPORTED` or `EXPLICITLY_UNSUPPORTED`.

## Required operating rules

1. Every `crm` invocation must explicitly include `--profile <profile>`; never
   rely on a default profile.
2. Start a new CRM task by reading `crm --profile <profile> catalog`.
3. Invoke only a capability published by that catalog with `transport` set to
   `SUPPORTED`. Do not call an `EXPLICITLY_UNSUPPORTED` capability.
4. Do not guess that a customer exists or invent a customer ID. Search first;
   select only an exact ID returned by an unambiguous result. If there is no
   match or more than one plausible match, stop and ask the human.
5. Do not guess a Capability and do not use semantic synonyms. Use the exact
   catalog capability ID. An alias is only mechanical syntax sugar for that
   exact ID: `customer search` is the alias for `cap customer.search`, not a
   request to infer a nearby capability.
6. Read capabilities may be combined for one selected customer and profile.
   Preserve the distinct results as evidence; combining reads does not create a
   write authority.
7. The Agent performs analysis from the returned evidence. The CLI returns
   envelopes and data only; it does not output a “建议你下一步” summary.
8. On either `CONFIRMATION_REQUIRED` or
   `STRONG_CONFIRMATION_REQUIRED`, immediately stop that write path. Do not
   make another write call, retry into confirmation, or treat the proposal as
   executed.
9. The Agent must never run `crm confirm`. It hands the pending proposal to a
   human and does not execute confirmation on the human's behalf.
10. Do not request a production DB path. The explicit profile is the only CRM
    scope handle the Agent needs.
11. Never pass `db`, `clock`, `credential`, or `snapshot` in CLI arguments or
    attempt to supply those runtime dependencies.
12. Never directly read, write, or modify CRM SQLite. Use only the supported
    CLI capability boundary.

For strong confirmation, `confirm_phrase_expected` is the pending proposal's
nonce. It is not the natural-language phrase “删除 广州星河科技”. Even with that
nonce visible in an envelope, the Agent still must not run confirmation.

## Example A — search for a customer

These commands are PowerShell-ready. Read the catalog first, then use the
canonical Capability ID or its catalog-derived alias.

```powershell
crm --profile sandbox catalog
crm --profile sandbox cap customer.search --args '{"name_query":"星河"}'
crm --profile sandbox customer search --args '{"name_query":"星河"}'
```

The last command is exactly the alias form of `cap customer.search`; it is not
a synonym expansion. Use the returned candidates to establish a real customer
ID before any customer-scoped operation.

## Example B — combine reads, then analyze in the Agent

First verify from the catalog that all named capabilities are `SUPPORTED`.
Search, then paste an ID from one unambiguous search result; the prompt is
deliberately a human-evidence handoff, not a guessed ID.

```powershell
crm --profile sandbox catalog
crm --profile sandbox cap customer.search --args '{"name_query":"星河"}'
$customerId = Read-Host 'Paste the exact customer_id returned by the unambiguous customer.search result'
crm --profile sandbox session select-customer --id $customerId
crm --profile sandbox cap customer.get
crm --profile sandbox cap timeline.customer.read
crm --profile sandbox cap follow_up.customer.read
```

The three final calls are independent reads scoped by the selected customer,
so the Agent may combine their evidence before answering. The Agent—not the
CLI—writes the analysis; the CLI must not produce a “建议你下一步” recommendation.

## Example C — create a follow-up proposal and stop at confirmation

Run this only after Example B has selected a real customer and the catalog
shows `follow_up.create` as `SUPPORTED`.

```powershell
crm --profile sandbox catalog
crm --profile sandbox cap follow_up.create --args '{"title":"电话回访","feedback_notes":"已核对当前需求，建议下周联系","next_follow_up_at":"2026-09-03T09:00:00+08:00"}'
```

The successful response is a pending proposal envelope with this status:

```json
{
  "ok": true,
  "status": "CONFIRMATION_REQUIRED",
  "capability_id": "follow_up.create",
  "profile": "sandbox"
}
```

Stop here. Give the human the proposal ID, `human_summary`, and `diff`; do not
run `crm confirm` and do not show a confirmation command. A
`STRONG_CONFIRMATION_REQUIRED` response follows the same stop rule, with its
pending nonce reserved for the human confirmation flow.

## Example D — create a customer proposal and stop at confirmation

First inspect the catalog. Only call the exact `customer.create` capability
when that catalog entry is marked `SUPPORTED`.

```powershell
crm --profile sandbox catalog
crm --profile sandbox cap customer.create --args '{"name":"广州星河科技","contact_person":"张总"}'
```

The args must include a non-empty `name`. Do not pass `customer_id`,
`customerId`, `db`, `clock`, or other runtime dependencies; creation has no
existing-customer scope. A successful proposal returns:

```json
{
  "ok": true,
  "status": "CONFIRMATION_REQUIRED",
  "capability_id": "customer.create",
  "profile": "sandbox"
}
```

Stop at that envelope. The Agent must not run confirmation; a human performs
the separate confirmation step. After that human step, a catalog-supported
`customer.search` may find the new name.

## Example E — update customer profile fields and stop at confirmation

First inspect the catalog. Only call the exact `customer.profile.update`
capability when that catalog entry is marked `SUPPORTED`.

```powershell
crm --profile sandbox catalog
crm --profile sandbox cap customer.profile.update --args '{"customer_id":"<exact customer_id>","industry":"跨境电商","region":"广州"}'
```

Every call must include `--profile`. Supply the exact `customer_id` returned
by an unambiguous search, or first select that customer with
`crm --profile sandbox session select-customer --id <exact customer_id>` and
then omit `customer_id` from the capability args. Only ordinary profile fields
published in the catalog are accepted; do not pass `customerId`, status,
schedule, rule, or runtime fields.

The successful response is a `CONFIRMATION_REQUIRED` pending proposal. Stop at
that envelope: the Agent must not run `crm confirm`; a human performs the
separate confirmation step.

## Example F — update a customer's next follow-up time and stop at confirmation

First inspect the catalog. Only call the exact
`customer.next_follow_up_time.update` capability when the catalog entry is
marked `SUPPORTED`.

```powershell
crm --profile sandbox catalog
crm --profile sandbox session select-customer --id <exact customer_id>
crm --profile sandbox cap customer.next_follow_up_time.update --args '{"next_follow_up_at":"2026-09-03T09:00:00+08:00"}'
```

Every call must include `--profile`. The selected customer may instead be
supplied as an exact `customer_id` scope overlay returned by an unambiguous
search; it is not a business field. The business args contain only the required
non-empty `next_follow_up_at` timestamp. Do not pass `customerId`, profile,
industry, opportunity amount, rule fields, or runtime dependencies.

The successful response is a `CONFIRMATION_REQUIRED` pending proposal. Stop at
that envelope. The Agent must never run `crm confirm`; a human performs the
separate confirmation step.
