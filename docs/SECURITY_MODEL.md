# Rover v2 Security Model

## Threat Model

Rover runs in customer pages, so browser-visible site keys and runtime behavior must be treated as public-but-scoped. Security comes from:

- server-side domain and policy enforcement
- short-lived Rover session tokens
- strict owner-vs-runtime auth separation
- per-site private settings storage
- explicit agent-attribution trust tiers

## Runtime Security Principles

- Site keys are domain-scoped with `allowedDomains` and enforced server-side.
- `domainScopeMode` changes how entries are interpreted, not whether host checks happen.
- Browser runtime uses short-lived `rvrsess_*` session tokens after bootstrap.
- Out-of-scope navigation/actions are blocked or forced through policy.
- Auth and stale-state failures return typed envelopes so clients can fail safe.

## Key Types

- `pk_site_*`: public bootstrap key for Rover embeds
- `rvrsess_*`: short-lived runtime session token
- Firebase owner auth: control plane auth for Rover Workspace reads/settings

`sk_site_*` or long-lived privileged secrets do not belong in browser runtime.

## RoverBook Auth Separation

RoverBook has two distinct trust boundaries:

- **Runtime/site-tag writes**: authenticated by signed Rover session claims via `requestSigned(...)`
- **Owner dashboard/settings reads**: authenticated by owner Firebase auth and site ownership checks

This prevents public embeds from reading private RoverBook owner settings while still allowing runtime analytics writes.

## Owner Identity vs Visiting Agent Identity

RoverBook now keeps these identities separate:

- `ownerUid`: the authenticated site owner using Rover Workspace
- `agentKey`: the visiting AI caller or attributed agent identity

The previous `agentId -> owner uid` collapse is intentionally removed. Memory, notes, reviews, interviews, and board activity are keyed by `agentKey`, not by the owner auth uid.

## Agent Attribution Trust Tiers

Rover and RoverBook normalize agent identity into:

- `verified`
- `self_reported`
- `heuristic`
- `anonymous`

Current launch behavior uses:

- `self_reported`
- `heuristic`
- `anonymous`

Important rule: plain headers alone never become `verified`.

Heuristic inputs may include:

- `User-Agent`
- `Signature-Agent`
- `Signature`
- `Signature-Input`
- `X-RTRVR-Client-Id`

These can improve attribution and grouping, but they do not imply cryptographic trust.

## Private Settings And Webhook Secrets

RoverBook owner settings are stored privately by `ownerUid + siteId` and include:

- interview questions
- per-site webhook subscriptions
- webhook auth/secret material

These settings are intentionally omitted from the public site config returned to embeds and runtime callers.

## Backend Enforcement

- Site ownership is enforced in two places: Firestore rules gate owner-facing RoverBook analytics reads, and backend callables gate owner-private RoverBook settings.
- Public RoverBook writes derive `siteId`, host, and session context from verified Rover session claims rather than trusting raw client input.
- Generic webhook delivery enforces HTTPS-only validation, payload shaping, retries/backoff, and signing.
- Domain policy, usage metrics, and blocked-host attempts remain enforced at the Rover key layer.

## Operational Guidance

- Use separate site keys per environment/workspace.
- Keep domain allowlists minimal and explicit.
- Rotate keys on suspicious origin activity.
- Treat browser keys as scoped public credentials, not private secrets.
- Treat heuristic agent attribution as useful labeling, not strong identity proof.
