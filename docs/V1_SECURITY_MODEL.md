# Rover v1 Security Model

## Threat Model
Rover runs in customer pages, so client-visible keys are exposed to browser contexts. Security must rely on key scoping, server-side policy checks, and abuse detection.

## Key Principles
- Site keys are domain-scoped (`allowedDomains`) and validated server-side.
- Authorization checks use `origin/referer/host` context for key validation.
- Out-of-scope same-tab navigation/actions are blocked or redirected to new-tab policy.
- Auth failures return structured payloads so clients can fail safe.

## Key Types
- `user` key: generic API usage.
- `site` key: Rover embed usage with required `allowedDomains`.

## Backend Enforcement
- `validateApiKey` checks active state, domain policy, and increments usage metrics.
- Blocked host attempts are recorded (`blockedHostAttempts`, `lastBlockedHost`).
- Usage telemetry by hostname is recorded (`usageByHostname`, `metadata.lastSeenDomains`).

## Optional Hardening (Next)
- Short-lived session JWT exchange endpoint for privileged operations.
- WAF/rate anomaly alerts for hostname abuse spikes.
- Admin controls for wildcard-domain restrictions.

## Operational Guidance
- Use separate site keys per environment/workspace.
- Keep domain allowlists minimal and explicit.
- Rotate keys on suspicious origin activity.
- Treat browser keys as scoped public credentials, not private secrets.
