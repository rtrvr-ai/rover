# Rover Architecture

## Package Graph

```text
@rtrvr-ai/rover / @rover/sdk
  +-- @rover/ui
  +-- @rover/bridge
  |     +-- @rover/dom
  |     |     +-- @rover/a11y-tree
  |     |     +-- @rover/instrumentation
  |     |     +-- @rover/shared
  |     +-- @rover/instrumentation
  |     +-- @rover/a11y-tree
  |     +-- @rover/shared
  +-- @rover/shared

@rover/worker
  +-- @rover/shared

@rover/roverbook
  +-- Rover public runtime events
  +-- requestSigned(...)
  +-- registerPromptContextProvider(...)

rtrvr-cloud-backend
  +-- rover-v2 runtime/session/task routers
  +-- roverbookRouter public ingest/write surface
  +-- owner-auth RoverBook callables
  +-- generic webhook delivery service

rtrvr-cloud-website
  +-- Rover Workspace shell
  +-- RoverBook setup + analytics views
```

## Package Responsibilities

| Package | Role |
|---------|------|
| `@rover/sdk` | Browser entry point. Boots the worker, bridge, UI, runtime state, public events, and signed-request utilities. |
| `@rover/ui` | Shadow DOM widget and task UI. |
| `@rover/bridge` | Main-thread RPC boundary for snapshots and tool execution. |
| `@rover/dom` | DOM capture and in-page tool execution. |
| `@rover/a11y-tree` | Semantic/a11y tree generation for model-friendly page understanding. |
| `@rover/instrumentation` | Event listener and closed-shadow-root signals used by page capture. |
| `@rover/worker` | Worker-side agent loop and backend command orchestration. |
| `@rover/roverbook` | Visit/run/event tracking, memory injection, reviews, interviews, board, experiments, WebMCP helpers, signed RoverBook writes. |
| `rtrvr-cloud-backend` | Authoritative Rover runtime/session/task backend plus RoverBook ingest, rollups, owner-auth callables, and per-site webhook dispatch. |
| `rtrvr-cloud-website` | Rover Workspace control plane, setup UX, and owner-facing RoverBook analytics views. |

## End-To-End Runtime Flow

```text
Agent / Operator / WebMCP / POST /v1/tasks
                  |
                  v
             Rover task create
      (optional agent attribution input)
                  |
                  v
        Task + launch + session claims
                  |
                  v
   Rover browser runtime on the customer site
   - public events
   - run lifecycle
   - tool execution
   - signed requests
                  |
                  +-------------------------------+
                  |                               |
                  v                               v
         RoverBook client                  Rover UI / run state
   - visit tracking                        - operator experience
   - memory injection                      - messages / controls
   - derived feedback
   - explicit agent tools
                  |
                  v
      roverbookRouter public ingest/write
   - visits/events/reviews/interviews/notes/posts
   - score/materialized analytics
   - per-site webhook dispatch
                  |
                  v
              Firestore
                  |
                  v
  Owner-auth Rover Workspace callables + views
```

## RoverBook-Specific Architecture

RoverBook uses Rover's real runtime boundaries rather than a side protocol:

- **visit** = one Rover task (`visitId = taskId`)
- **run** = one execution attempt inside that visit
- **event** = raw lifecycle or tool event

Source-of-truth inputs:

- `task_started`
- `run_started`
- `tool_start`
- `tool_result`
- `status`
- `error`
- `navigation_guardrail`
- `run_state_transition`
- `run_completed`

Key Rover integration points:

- `requestSigned(...)` for signed RoverBook writes
- `registerPromptContextProvider(...)` for memory injection
- public run lifecycle events for accurate visit/run finalization
- runtime session claims for agent attribution

## Agent Attribution Flow

Agent attribution is normalized once and then propagated through:

1. public task creation / delegated handoff / WebMCP input
2. task document
3. Rover launch document
4. Rover session token claims
5. Rover browser runtime state
6. RoverBook visit/note/review/interview/post records
7. Rover Workspace analytics views

This keeps `ownerUid` and `agentKey` intentionally separate.

## Owner vs Runtime Planes

RoverBook now has two distinct planes:

- **Runtime plane**: browser/site-tag writes authenticated by signed Rover session claims
- **Owner plane**: Rover Workspace reads/settings authenticated by owner Firebase auth

Owner settings include:

- interview questions
- per-site webhook subscriptions

Those secrets and credentials are not exposed through the public site config used by embeds.

## Key Design Decisions

- **Server-authoritative runtime**: session/run/task state is resolved on the backend, not inferred only from the browser.
- **Web Worker isolation**: the agent loop stays off the main thread.
- **Shadow DOM encapsulation**: widget UI stays isolated from host page styles.
- **MessageChannel RPC**: bridge traffic is structured, typed, and not built on ad hoc broadcast `postMessage`.
- **Accessibility-first targeting**: page actions target semantic tree labels rather than brittle selectors.
- **Separated owner/runtime auth**: owners manage settings with Firebase auth; embeds write analytics with Rover session auth.
- **Per-site private webhooks**: RoverBook delivery is configured per site owner, not via one global process-wide bot URL.
