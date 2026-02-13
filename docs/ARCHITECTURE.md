# Rover Architecture

- `@rover/instrumentation` captures listeners + closed shadow roots in-page and feeds an `ElementSignalProvider` into the a11y tree.
- `@rover/dom` builds snapshots via `extractSemanticTree` and executes system tools in the main world.
- `@rover/bridge` exposes `getSnapshot` / `executeTool` / `executeClientTool` over MessageChannel RPC.
- `@rover/worker` hosts the agent loop and calls the backend; tool calls are routed through the bridge.
- `@rover/ui` renders a Shadow DOM chat widget.
- `@rover/sdk` wires everything and exposes `window.rover`.
