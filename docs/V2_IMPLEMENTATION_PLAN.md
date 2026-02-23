# Rover v2 Implementation Plan

## Phase 1: Runtime Contracts
- Add `domainScopeMode` and `externalNavigationPolicy` to SDK/Bridge.
- Flip default routing to `act`.
- Emit staged concise statuses (`analyze/route/execute/verify/complete`).
- Normalize missing-auth/api-key rendering to structured JSON.

## Phase 2: Guardrails + Tabs
- Enforce out-of-scope action blocking in bridge.
- Redirect guarded external navigation to new-tab policy.
- Emit `navigation_guardrail` event payloads.
- Preserve external tab metadata in shared state/checkpoints.

## Phase 3: Backend Key Model
- Extend API-key docs with site-key semantics/telemetry fields.
- Add Rover site-key callables:
  - `generateRoverSiteKey`
  - `listRoverSiteKeys`
  - `updateRoverSiteKeyPolicy`
  - `rotateRoverSiteKey`
- Ensure extension-router error envelopes include `missing` and machine-readable details.

## Phase 4: Website Workspace
- Add `/rover/workspace` authenticated experience.
- Provide onboarding wizard inputs (siteId/domains/TTL).
- Support create/list/rotate/toggle/update domains for Rover site keys.
- Generate embed install snippet from created site key.

## Phase 5: Stabilization
- Type/build validation for rover/backend/website.
- Add scenario tests for auth-missing and domain guardrail behavior.
- Run canary rollout with account allowlist before broad default enablement.
