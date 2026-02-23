# Rover v2 Master Context

## What Rover Is
Rover is an embedded, DOM-native web agent runtime that runs inside customer websites without extension APIs. It preserves the core intelligence model from relay/cloud (planner loop, tool loop, history continuity) while operating through `window`, DOM tools, and backend sub-agent endpoints.

## Core Runtime Components
- `packages/sdk`: boot/update lifecycle, runtime persistence, session coordination, tab continuity, cloud checkpoint sync.
- `packages/bridge`: DOM/snapshot/tool execution adapter, navigation tools, domain guardrails, new-tab registration.
- `packages/worker`: orchestration (`act`/`planner`), status/thought streaming, planner tool execution, structured auth/domain errors.
- `packages/ui`: embeddable widget UI, timeline cards, execution mode controls, compact thought visibility.

## Key v1 Defaults
- Routing default: `act` (fast path). Planner is used when explicitly configured, or in `auto` mode when ACT does not produce a usable outcome.
- Domain scope default: `registrable_domain`.
- External navigation default: `open_new_tab_notice` (same-tab blocked, opens new tab with notice).
- Cross-host in-scope default: `same_tab` (follow target behavior across allowed hosts).
- Auth failures: structured machine-readable payloads with `code/message/missing/next_action/retryable`.

## Persisted State Invariants
- `sessionCoordinator` owns logical tabs and active controller lease.
- Runtime state is durable in local storage + optional cloud checkpoint.
- Worker state persists history/planner context/prevSteps and survives tab handoff.
- External/opened tab metadata is carried in shared tab entries (`external` flag).

## Expected User Experience
- User asks Rover to act on current website.
- Rover emits concise stage status (`analyze/route/execute/verify/complete`).
- Rover executes act-first; planner is used when needed.
- Out-of-scope navigation is intercepted according to policy and surfaced clearly.

## Non-Goals (v1)
- Full extension-only feature parity for unsupported browser capabilities.
- Arbitrary cross-origin control without explicit allow policy.
- Long-lived privileged secrets inside client JavaScript.
