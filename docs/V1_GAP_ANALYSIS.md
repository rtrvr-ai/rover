# Rover v1 Gap Analysis

## Parity Matrix (Relay/Backend -> Rover)

### Implemented in Rover
- Act/planner routing with configurable mode and act-escalation.
- Shared-session control handoff and logical tab coordination.
- Cloud checkpoint upsert/get for context recovery.
- API-key auth normalization and `auth_required` signaling.
- Domain guardrails for navigation with out-of-scope interception.

### Partially Implemented
- Planner/tool envelope parity: now structured for auth/domain errors, but backend sub-agents still vary on non-auth failures.
- Rich planner history semantics: Rover keeps lightweight state vs relay’s heavier long-running context model.
- Cross-tab out-of-scope enforcement: enforced in bridge/action path; telemetry/visibility can still be expanded.

### Remaining Gaps
- Session JWT exchange/refresh path for elevated operations (feature-flagged follow-up).
- Full operational analytics surface for blocked-host anomalies.
- Broader tool-level envelope normalization for every backend failure path.
- Formal canary flags for per-account policy rollout.

## UX Gaps Closed in This Iteration
- Stage-based concise status now emitted and de-duplicated.
- Structured JSON shown for missing auth/api key failures.
- Navigation guardrail events surfaced to SDK timeline.
- Rover workspace route added for site-key onboarding and policy management.

## Risk Areas to Watch
- Public client embedding still requires scoped-key abuse monitoring.
- Keep SDK/docs/workspace aligned on canonical `externalNavigationPolicy` only.
- Website and backend callable schema drift without shared contract tests.
