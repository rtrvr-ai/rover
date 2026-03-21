# Rover

[![CI](https://github.com/rtrvr-ai/rover/actions/workflows/ci.yml/badge.svg)](https://github.com/rtrvr-ai/rover/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@rtrvr-ai/rover)](https://www.npmjs.com/package/@rtrvr-ai/rover)
[![License: FSL-1.1-Apache-2.0](https://img.shields.io/badge/License-FSL--1.1--Apache--2.0-blue.svg)](LICENSE)
[![Discord](https://img.shields.io/discord/1288571209918844969?color=7289da&label=Discord&logo=discord&logoColor=white)](https://rtrvr.ai/discord)
[![GitHub stars](https://img.shields.io/github/stars/rtrvr-ai/rover?style=social)](https://github.com/rtrvr-ai/rover)

**Turn any website into an AI-native interface — for users, AI apps, CLIs, and autonomous agents.**

Chatbots talk. Rover does. One line of code — Rover reads your live page,
plans actions, and executes them in milliseconds. Clicks, forms, navigation —
directly in the DOM. No screenshots, no VMs, no RAG pipelines.

- **Websites** — drop a script tag
- **Chrome Extensions** — inject into any page
- **Electron Apps** — same engine, same capabilities
- **AI / CLI / agent callers** — use the neutral task resource at `POST https://agent.rtrvr.ai/v1/tasks`

---

## Why Rover?

| | Chatbots | Screenshot agents | **Rover** |
|---|---|---|---|
| Task completion | Links only | Slow, remote | Native speed, in-browser |
| Reads DOM | No | Vision/pixels | Direct DOM + a11y tree |
| Latency | N/A | Seconds per action | Milliseconds |
| Infrastructure | Iframe/server | Remote VM | Zero — runs in-browser |
| AI / agent access | No | No | `POST /v1/tasks` + `?rover=` convenience |
| Open Source | Varies | No | FSL-1.1-Apache-2.0 |

### For websites
Drop-in embed — users get an AI assistant that actually does things on the page.

### For AI agents
Rover exposes two entrypoints:

- browser-first convenience via `?rover=` / `?rover_shortcut=`
- machine-first task resources via `POST https://agent.rtrvr.ai/v1/tasks`

Use `/v1/tasks` when you need structured progress or final results back.

Copy-paste agent examples live in [SKILLS.md](SKILLS.md), including:

- an exact Codex / external-agent prompt
- a Node `fetch` example
- a Python example
- a shell helper function

### For any DOM interface
The core SDK works anywhere there's a DOM — browser extensions, Electron apps, webviews. The chat widget is the website surface; the agent engine is universal.

---

## Quick Start

### Script tag (single-tag)

```html
<script src="https://rover.rtrvr.ai/embed.js"
  data-site-id="YOUR_SITE_ID"
  data-public-key="pk_site_YOUR_PUBLIC_KEY"
  data-allowed-domains="yourdomain.com"
  data-domain-scope-mode="registrable_domain"
  async>
</script>
```

### Script tag (boot call)

```html
<script>
  (function(){
    var r = window.rover = window.rover || function(){
      (r.q = r.q || []).push(arguments);
    };
    r.l = +new Date();
  })();

  rover('boot', {
    siteId: 'YOUR_SITE_ID',
    publicKey: 'pk_site_YOUR_PUBLIC_KEY',
    allowedDomains: ['yourdomain.com'],
    domainScopeMode: 'registrable_domain',
  });
</script>
<script src="https://rover.rtrvr.ai/embed.js" async></script>
```

### npm

```bash
npm install @rtrvr-ai/rover
```

```ts
import { boot, shutdown } from '@rtrvr-ai/rover';

boot({
  siteId: 'YOUR_SITE_ID',
  publicKey: 'pk_site_YOUR_PUBLIC_KEY',
  allowedDomains: ['yourdomain.com'],
  domainScopeMode: 'registrable_domain',
});
```

Domain scope cheat sheet: in the default `registrable_domain` mode, `allowedDomains: ['example.com']` allows `example.com` and all of its subdomains. `allowedDomains: ['*.example.com']` allows subdomains only, not the apex host. `host_only` makes plain entries such as `example.com` exact-host only.

Get `siteId`, `publicKey` (`pk_site_*`), and optional `siteKeyId` from Workspace:

- `https://rover.rtrvr.ai/workspace`
- `https://www.rtrvr.ai/rover/workspace`

If you enable Public AI / Agent Task Access in Workspace, the generated snippet includes the source-visible discovery marker automatically. External AI callers do not need those values; they use `POST https://agent.rtrvr.ai/v1/tasks`.

See [`packages/sdk/README.md`](packages/sdk/README.md) for full API reference, React/Next.js/Vue examples, and CSP configuration.

## Features

- **Browser-first deep links** — trigger tasks via `?rover=checkout` or `?rover_shortcut=onboarding`
- **Machine task protocol** — any Rover-enabled page becomes callable through `POST https://agent.rtrvr.ai/v1/tasks`
- **Universal DOM agent** — websites, extensions, Electron, any DOM environment
- **Autonomous navigation** — plans and executes multi-step tasks across pages
- **Shadow DOM widget** — chat UI that mounts without touching your styles
- **Backend-powered planning** — server-authoritative agent loop
- **Execution guardrails** — domain-scoped actions, navigation policies, session isolation
- **Accessibility-first** — W3C a11y tree for reliable element targeting
- **Framework agnostic** — React, Vue, Angular, vanilla JS, WordPress, Shopify
- **Voice input** — browser-native dictation for hands-free interaction
- **Cloud checkpointing** — session state synced across tabs and page reloads
- **WebMCP (Coming Soon)** — sites surface shortcuts as tools other agents can invoke

---

## AI / Agent Access

Rover-enabled sites support two public paths.

### Machine path

This is the canonical AI / CLI protocol:

```http
POST https://agent.rtrvr.ai/v1/tasks
Content-Type: application/json

{ "url": "https://example.com", "prompt": "book a flight to tokyo" }
```

Or:

```http
POST https://agent.rtrvr.ai/v1/tasks
Content-Type: application/json

{ "url": "https://example.com", "shortcut": "checkout_flow" }
```

The response returns a canonical task URL that supports:

- JSON polling / final result
- SSE
- NDJSON
- continuation input
- cancel
- an `open` receipt URL for clean browser attach
- an optional `browserLink` readable alias when the prompt/shortcut fits safely in the visible URL

Task creation may also return browser handoff URLs:

- `open`: clean receipt URL such as `https://example.com/#rover_receipt=rrc_...`
- `browserLink`: optional readable alias such as `https://example.com/?rover=book+a+flight#rover_receipt=rrc_...`

The task URL remains the only durable public resource. Receipt links are browser handoff helpers layered on top of that same task.

Anonymous AI callers do **not** need `siteId`, `publicKey`, or `siteKeyId`. Those values are for site owners installing Rover through Workspace:

- `https://rover.rtrvr.ai/workspace`
- `https://www.rtrvr.ai/rover/workspace`

If the site emits the discovery marker below, AI tools can detect support directly from HTML:

```html
<script type="application/agent+json">{"task":"https://agent.rtrvr.ai/v1/tasks"}</script>
```

Use `Prefer: execution=cloud` when you need guaranteed browserless execution today.

Quick create example:

```bash
curl -X POST 'https://agent.rtrvr.ai/v1/tasks' \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json' \
  -H 'Prefer: execution=cloud' \
  -d '{
    "url": "https://www.rtrvr.ai",
    "prompt": "get me the latest blog post"
  }'
```

See [SKILLS.md](SKILLS.md) for the exact external-agent prompt plus Node, Python, and shell examples.

### Browser-first path

### Prompt deep links

Pass a natural-language instruction via query parameter:

```
https://example.com?rover=book+a+flight+to+tokyo
```

Rover boots in the page, reads the DOM, and executes the task autonomously.

### Shortcut deep links

Invoke a pre-defined shortcut by ID for repeatable, deterministic flows:

```
https://example.com?rover_shortcut=checkout_flow
```

These links run Rover in the browser UI. They are not the machine-readable result channel by themselves. If you need structured progress or results back, use `/v1/tasks`.

### Configuration

Deep links are opt-in browser convenience. Enable them in your boot config:

```js
rover('boot', {
  // ...
  deepLink: {
    enabled: true,
    promptParam: 'rover',        // default
    shortcutParam: 'rover_shortcut', // default
    consume: true,                // strip params from URL after reading
  },
});
```

---

For the full external-agent contract, see [SKILLS.md](SKILLS.md).

## WebMCP (Coming Soon)

Sites running Rover can surface their shortcuts as tools that other AI agents can discover and invoke — turning any web app into a composable building block for agent workflows. No server changes, no API wrappers. The page _is_ the API.

---

## Architecture

```
Host page
  |
  +-- @rover/sdk          # init(), installs global, wires everything
  |     |
  |     +-- @rover/ui     # Shadow DOM chat widget
  |     +-- @rover/bridge # MessageChannel RPC (main thread <-> worker)
  |           |
  |           +-- @rover/dom             # DOM snapshots & system tool execution
  |           +-- @rover/a11y-tree       # W3C accessibility tree generator
  |           +-- @rover/instrumentation # Event listener capture & signals
  |
  +-- Web Worker
        +-- @rover/worker  # Agent loop, backend communication
        +-- @rover/shared  # Types, constants, utilities
```

**Data flow:** User input -> Worker (planner) -> Backend (`/v2/rover/*`) -> Tool calls -> Bridge RPC -> DOM actions -> Result streamed back to UI.

## Monorepo Structure

| Package | Description |
|---------|-------------|
| `packages/sdk` | Main SDK entry point |
| `packages/worker` | Web Worker agent loop |
| `packages/bridge` | MessageChannel RPC layer |
| `packages/ui` | Shadow DOM chat widget |
| `packages/dom` | DOM snapshots and tool execution |
| `packages/a11y-tree` | Accessibility tree generator |
| `packages/instrumentation` | Event listener capture |
| `packages/shared` | Shared types and constants |
| `packages/system-tool-utilities` | System tool helpers |
| `packages/tsconfig` | Shared TypeScript config |
| `apps/demo` | Vite demo application |

## Documentation

| Doc | For | Description |
|-----|-----|-------------|
| [SDK Reference](packages/sdk/README.md) | Integrators | Full API, config, framework guides, CSP |
| [Integration Guide](docs/INTEGRATION.md) | Integrators | Setup, examples, troubleshooting |
| [External Agent Guide](SKILLS.md) | AI / CLI / agents | Discovery marker, `/v1/tasks`, SSE, NDJSON, continuation |
| [Architecture](docs/ARCHITECTURE.md) | Contributors | Package graph, data flow, design decisions |
| [Testing](docs/TESTING.md) | Contributors | Local testing, debugging |
| [Security Model](docs/SECURITY_MODEL.md) | Security | Threat model, key types |
| [Guardrails](docs/EXECUTION_GUARDRAILS.md) | Security | Domain scoping, navigation policies |
| [Licensing FAQ](LICENSING.md) | Legal | What you can/can't do |

## Development

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm build

# Start the demo app (http://localhost:5174)
pnpm dev

# Lint
pnpm lint
```

### Prerequisites

- [Node.js](https://nodejs.org/) 20+
- [pnpm](https://pnpm.io/) 9.12+

## Releasing

See [RELEASE.md](RELEASE.md) for detailed instructions.

```bash
pnpm version:bump 0.1.2
git add -A && git commit -m "chore: bump version to 0.1.2"
git tag v0.1.2
git push && git push --tags
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

[FSL-1.1-Apache-2.0](LICENSE) — Functional Source License with Apache 2.0 future license.

See [LICENSING.md](LICENSING.md) for full details.

## Links

- [Website](https://www.rtrvr.ai/rover)
- [npm](https://www.npmjs.com/package/@rtrvr-ai/rover)
- [Documentation](https://www.rtrvr.ai/rover/docs)
- [GitHub](https://github.com/rtrvr-ai/rover)
- [Product Hunt](https://www.producthunt.com/products/rtrvr-ai)
- [Discord](https://rtrvr.ai/discord)
- [Twitter](https://x.com/rtrvrai)
