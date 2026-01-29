# Rover Architecture

## Package Graph

```
@rover/sdk
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

@rover/worker  (runs in Web Worker)
  +-- @rover/shared

@rover/system-tool-utilities
  +-- @rover/shared
  +-- @rover/a11y-tree
```

## Package Responsibilities

| Package | Role |
|---------|------|
| `@rover/sdk` | Entry point. Calls `init()`, creates Bridge + Worker + UI. Exposes `window.rover`. |
| `@rover/ui` | Renders the Shadow DOM chat widget. Receives streamed messages from the worker. |
| `@rover/bridge` | MessageChannel RPC server on the main thread. Exposes `getSnapshot`, `executeTool`, `executeClientTool`. |
| `@rover/dom` | Builds page snapshots via `extractSemanticTree` and executes system tools in the main world. |
| `@rover/a11y-tree` | W3C-compliant accessibility tree generator with RTRVR labeling for LLM consumption. |
| `@rover/instrumentation` | Captures event listeners and closed shadow roots in-page. Feeds `ElementSignalProvider` into the a11y tree. |
| `@rover/worker` | Hosts the agent loop inside a Web Worker. Calls the backend planner, dispatches tool calls through the bridge. |
| `@rover/shared` | Shared TypeScript types, constants, and utilities used across all packages. |
| `@rover/system-tool-utilities` | Helpers for system-level tool execution (clipboard, file operations, etc.). |
| `@rover/tsconfig` | Shared `tsconfig.json` base used by all packages. |

## Data Flow

```
User input (chat widget)
  |
  v
@rover/ui  -->  postMessage  -->  @rover/worker (Web Worker)
                                    |
                                    v
                              Backend planner (/v2/rover/*)
                                    |
                                    v
                              Tool call response
                                    |
                                    v
                              @rover/worker routes tool call
                                    |
                                    v
                  postMessage (MessageChannel RPC)
                                    |
                                    v
                              @rover/bridge
                                    |
                                    v
                              @rover/dom  (snapshot or action)
                                    |
                                    v
                              Result returned via RPC
                                    |
                                    v
                              @rover/worker  (continues agent loop or streams result)
                                    |
                                    v
                              @rover/ui  (displays to user)
```

## Key Design Decisions

- **Web Worker isolation**: The agent loop runs off the main thread to avoid blocking the host page.
- **Shadow DOM encapsulation**: The UI widget is fully isolated from host page styles.
- **Server-authoritative planning**: All planning decisions come from the backend; the client only executes tool calls.
- **MessageChannel RPC**: Bridge uses structured MessageChannel communication instead of `postMessage` broadcasts for reliable, typed request/response.
- **Accessibility-first targeting**: Elements are targeted by a11y tree labels rather than fragile CSS selectors.
