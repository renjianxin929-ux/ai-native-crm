# Security Policy

## Supported versions

The current `0.2.x` release line receives security fixes. Earlier experimental releases may not receive backports.

## Reporting a vulnerability

Please do not open a public issue for a suspected vulnerability or include real credentials or customer data in a report.

Use GitHub Security Advisories for this repository to submit a private vulnerability report to the maintainer. Include:

- Affected version and operating system
- Reproduction steps or a minimal proof of concept
- Expected impact
- Any suggested mitigation

The maintainer will acknowledge the report, assess severity and scope, and coordinate a fix and disclosure when appropriate. No response-time guarantee is offered while this remains an experimental, maintainer-led project.

## Scope notes

- CRM data is designed to remain in local SQLite storage.
- Remote model providers receive requests only when configured and invoked by the user.
- Provider credentials must never be committed to this repository.
- Agent-driven writes are expected to pass capability, validation, and confirmation boundaries.
