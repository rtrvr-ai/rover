# Rover

[![CI](https://github.com/rtrvr-ai/rover/actions/workflows/ci.yml/badge.svg)](https://github.com/rtrvr-ai/rover/actions/workflows/ci.yml)
[![License: FSL-1.1-Apache-2.0](https://img.shields.io/badge/License-FSL--1.1--Apache--2.0-blue.svg)](LICENSE)
[![npm](https://img.shields.io/npm/v/@rtrvr-ai/rover)](https://www.npmjs.com/package/@rtrvr-ai/rover)
[![Discord](https://img.shields.io/discord/1288571209918844969?color=7289da&label=Discord&logo=discord&logoColor=white)](https://rtrvr.ai/discord)
[![GitHub stars](https://img.shields.io/github/stars/rtrvr-ai/rover?style=social)](https://github.com/rtrvr-ai/rover)

**Turn any website into an AI-native interface — for your users and for AI.**

Chatbots talk. Rover does. One line of code — Rover reads your live page,
plans actions, and executes them in milliseconds. Clicks, forms, navigation —
directly in the DOM. No screenshots, no VMs, no RAG pipelines.

- **Websites** — drop a script tag
- **Chrome Extensions** — inject into any page
- **Electron Apps** — same engine, same capabilities

AI agents call your site by URL:
`https://example.com?rover=book+a+flight`

---

## Why Rover?

| | Chatbots | Screenshot agents | **Rover** |
|---|---|---|---|
| Task completion | Links only | Slow, remote | Native speed, in-browser |
| Reads DOM | No | Vision/pixels | Direct DOM + a11y tree |
| Latency | N/A | Seconds per action | Milliseconds |
| Infrastructure | Iframe/server | Remote VM | Zero — runs in-browser |
| AI-ready URLs | No | No | `?rover=do+something` |
| Open Source | Varies | No | FSL-1.1-Apache-2.0 |

### For websites
Drop-in embed — users get an AI assistant that actually does things on the page.

### For AI agents
Any Rover-enabled page is queryable via URL — no MCP servers, no tool definitions, no Playwright:
`https://example.com?rover=book%20a%20flight`

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

See [`packages/sdk/README.md`](packages/sdk/README.md) for full API reference, React/Next.js/Vue examples, and CSP configuration.

## Features

- **AI-ready deep links** — trigger tasks via URL: `?rover=checkout` or `?rover_shortcut=onboarding`
- **AI-callable URLs** — any Rover-enabled page becomes an AI endpoint, no MCP/Playwright/middleware
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

## AI-Callable URLs

Any page running Rover becomes callable by AI agents — no MCP servers, no tool definitions, no Playwright middleware.

### Prompt deep links

Pass a natural-language instruction via query parameter:

```
https://example.com?rover=book+a+flight+to+tokyo
```

Rover boots, reads the page, and executes the task autonomously.

### Shortcut deep links

Invoke a pre-defined shortcut by ID for repeatable, deterministic flows:

```
https://example.com?rover_shortcut=checkout_flow
```

### Configuration

Deep links are opt-in. Enable them in your boot config:

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
