# @rtrvr-ai/rover

**Turn any web interface into an AI agent — with one line of code.**

Rover is an open-source, DOM-native agent SDK that reads the real DOM,
plans actions, and executes them directly in the browser. Clicks, form fills,
navigation, data extraction — sub-second, no screenshots, no remote VMs.
Embed on websites, browser extensions, Electron apps, or any DOM environment.

[GitHub](https://github.com/rtrvr-ai/rover) · [Website](https://www.rtrvr.ai/rover) · [Docs](https://www.rtrvr.ai/rover/docs) · [Discord](https://rtrvr.ai/discord)

## Prerequisites

You need an rtrvr.ai account with available credits. Free accounts get 250 credits/month. [Sign up or manage your plan](https://www.rtrvr.ai/cloud?view=pricing).

Before you test Rover on arbitrary websites, get your site config from Workspace first. Hosted Preview is the only path that does not require Workspace config.

## Quick Start (Script Tag)

Add this snippet before `</body>` on any page:

```html
<script type="application/agent+json">{"task":"https://agent.rtrvr.ai/v1/tasks"}</script>
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

If RoverBook is enabled for the site in Rover Workspace, the generated install snippet also includes `https://rover.rtrvr.ai/roverbook.js` plus an inline attach block that calls `window.RoverBook.enableRoverBook(window.rover, ...)`. Copy the Workspace snippet as-is for production installs.

Workspace also controls site mode:

- `Full Rover agent`: action-capable Rover runtime
- `RoverBook analytics-only`: embed-oriented RoverBook deployment with action tools disabled

Get `siteId`, `publicKey` (`pk_site_*`), and optional `siteKeyId` from Rover Workspace:

- `https://rover.rtrvr.ai/workspace`
- `https://www.rtrvr.ai/rover/workspace`

Those values are for site owners installing Rover. External AI callers do **not** need them.

If you have a `siteKeyId`, append it to the script URL as `embed.js?v=YOUR_SITE_KEY_ID` for cache-busting and safer key rotation. The `v` query string does not affect domain authorization or scope matching.

Or use the single-tag shorthand with data attributes:

```html
<script src="https://rover.rtrvr.ai/embed.js"
  data-site-id="YOUR_SITE_ID"
  data-public-key="pk_site_YOUR_PUBLIC_KEY"
  data-session-token="rvrsess_YOUR_SHORT_LIVED_SESSION_TOKEN"
  data-allowed-domains="yourdomain.com"
  data-domain-scope-mode="registrable_domain">
</script>
```

Use `data-domain-scope-mode="host_only"` to require exact host matches. Plain entries such as `example.com` become exact-host rules in `host_only` mode. In the default `registrable_domain` mode, plain entries match the apex host and its subdomains, while `*.example.com` matches subdomains only.

For temporary preview sessions, `data-session-token` can bootstrap Rover without a `publicKey`. If you also have a `sessionId`, add `data-session-id` for a stable runtime boundary.

Common patterns:

- `allowedDomains: ['example.com']` with `registrable_domain` allows `example.com` and all subdomains.
- `allowedDomains: ['*.example.com']` allows subdomains only, not the apex host.
- `allowedDomains: ['app.example.com']` with `registrable_domain` allows `app.example.com` and its subdomains, but not sibling hosts.
- `allowedDomains: ['example.com']` with `host_only` allows only the exact host `example.com`.

## Preview Helpers

The SDK also exports generic helper utilities for live demos and previews:

```ts
import {
  attachLaunch,
  createRoverAgentCardJson,
  createRoverAgentDiscoveryTags,
  createRoverBookmarklet,
  createRoverConsoleSnippet,
  createRoverOwnerInstallBundle,
  createRoverServiceDescLinkHeader,
  createRoverScriptTagSnippet,
} from '@rtrvr-ai/rover';
```

Use `createRoverConsoleSnippet(...)` and `createRoverBookmarklet(...)` to generate one-click bootstrap payloads, and `attachLaunch(...)` when you want to attach a pre-created launch from code.

Before you use any of these helpers on another website:

1. Open Rover Workspace.
2. Create or rotate a site key so Workspace reveals the full `pk_site_*` value.
3. Copy the **test config JSON** from Workspace.
4. Either paste that JSON into the Rover website's "Try on Other Sites" tool, or pass the same values into the SDK helpers below.

### Which helper to use

| Path | What you need | Best for | Persistence |
|---|---|---|---|
| Hosted Preview | Signed-in URL + prompt | Rover-managed demos | Temporary preview session |
| Preview Helper | Workspace test config JSON or hosted handoff | Multi-page desktop demos | Re-injects after reload/navigation |
| Console | Workspace test config JSON + generated snippet | Fast DevTools demos | Current page only |
| Bookmarklet | Workspace test config JSON + generated bookmarklet | Drag-and-click demos | Current page only |
| Production install | Workspace install snippet | Real site install | Persistent |

- `createRoverConsoleSnippet(...)`
  Best for desktop demos, debugging, and screen-sharing when you can paste into DevTools.
- `createRoverBookmarklet(...)`
  Best for quick one-click demos across many pages, with the same current-page limitations as manual injection.
- `createRoverScriptTagSnippet(...)`
  Best for generating an actual snippet from known config values such as Workspace `siteId` and `publicKey`.
- `createRoverOwnerInstallBundle(...)`
  Best for canonical owner-facing install output when you need a body-safe runtime snippet plus separate head discovery HTML, `rover-site.json`, `agent-card.json`, and optional `llms.txt`.
- `createRoverAgentCardJson(...)`, `createRoverAgentDiscoveryTags(...)`, `createRoverServiceDescLinkHeader(...)`
  Best for publishing source-visible discovery metadata so arbitrary agents can find Rover skills before falling back to DOM automation.
- `attachLaunch(...)`
  Best when you already created a launch elsewhere and want Rover to attach to it after boot.

### Example: console snippet from Workspace config

```ts
import { createRoverConsoleSnippet } from '@rtrvr-ai/rover';

const snippet = createRoverConsoleSnippet({
  siteId: 'site_123',
  publicKey: 'pk_site_123',
  siteKeyId: 'key_123',
  allowedDomains: ['example.com'],
  domainScopeMode: 'registrable_domain',
  apiBase: 'https://agent.rtrvr.ai',
  openOnInit: true,
  mode: 'full',
  allowActions: true,
});
```

### Example: bookmarklet from Workspace config

```ts
import { createRoverBookmarklet } from '@rtrvr-ai/rover';

const bookmarklet = createRoverBookmarklet({
  siteId: 'site_123',
  publicKey: 'pk_site_123',
  siteKeyId: 'key_123',
  allowedDomains: ['example.com'],
  domainScopeMode: 'registrable_domain',
  apiBase: 'https://agent.rtrvr.ai',
});
```

### Example: production script-tag snippet from Workspace config

```ts
import { createRoverScriptTagSnippet } from '@rtrvr-ai/rover';

const snippet = createRoverScriptTagSnippet({
  siteId: 'site_123',
  publicKey: 'pk_site_123',
  siteKeyId: 'key_123',
  allowedDomains: ['example.com'],
  domainScopeMode: 'registrable_domain',
  apiBase: 'https://agent.rtrvr.ai',
});
```

### Example: canonical owner install bundle

```ts
import { createRoverOwnerInstallBundle } from '@rtrvr-ai/rover';

const bundle = createRoverOwnerInstallBundle({
  bootConfig: {
    siteId: 'site_123',
    publicKey: 'pk_site_123',
    siteKeyId: 'key_123',
    allowedDomains: ['example.com'],
    domainScopeMode: 'registrable_domain',
  },
  discovery: {
    siteId: 'site_123',
    siteUrl: 'https://example.com/',
    siteName: 'Example Store',
    roverSiteUrl: '/.well-known/rover-site.json',
    agentCardUrl: '/.well-known/agent-card.json',
    llmsUrl: '/llms.txt',
  },
  emitLlmsTxt: true,
});

bundle.bodyInstallHtml;     // paste before </body>
bundle.headDiscoveryHtml;   // place in <head> or managed head custom code
bundle.roverSiteJson;       // publish at /.well-known/rover-site.json
bundle.agentCardJson;       // publish at /.well-known/agent-card.json
bundle.serviceDescLinkHeader;
bundle.llmsTxt;
```

### Example: attach a pre-created launch

```ts
import { attachLaunch, boot } from '@rtrvr-ai/rover';

boot({
  siteId: 'preview_site',
  sessionToken: 'rvrsess_short_lived_token',
  allowedDomains: ['example.com'],
  domainScopeMode: 'host_only',
});

attachLaunch({
  requestId: 'rl_123',
  attachToken: 'attach_123',
});
```

### Two config sources

Use one of these sources for the helper functions above:

- **Workspace production config**
  Persistent `siteId`, `publicKey`, optional `siteKeyId`, `allowedDomains`, and `domainScopeMode` from Rover Workspace.
- **Hosted preview config**
  Short-lived preview/runtime values produced by Rover Instant Preview on the website or by your own preview service.

Get Workspace config from:

- [https://www.rtrvr.ai/rover/workspace](https://www.rtrvr.ai/rover/workspace)
- [https://rover.rtrvr.ai/workspace](https://rover.rtrvr.ai/workspace)

If you want the exact human walkthrough instead of jumping straight into code:

- website guide: [https://www.rtrvr.ai/rover/docs/try-on-other-sites](https://www.rtrvr.ai/rover/docs/try-on-other-sites)
- repo guide: [../../docs/TRY_ON_OTHER_SITES.md](../../docs/TRY_ON_OTHER_SITES.md)
- one-click helper path: use the website tool's `Open target with helper` action after pasting the Workspace config

If you want a public extension that can use either config source, see the Preview Helper app:

- [https://github.com/rtrvr-ai/rover/tree/main/apps/preview-helper](https://github.com/rtrvr-ai/rover/tree/main/apps/preview-helper)
- [https://www.rtrvr.ai/rover/docs/instant-preview-api](https://www.rtrvr.ai/rover/docs/instant-preview-api)

### Agent Discovery Publishing

Use the new discovery helpers when you want generic agents to see explicit Rover skills before they start clicking through the DOM:

```ts
import {
  createRoverAgentCardJson,
  createRoverAgentDiscoveryTags,
  createRoverServiceDescLinkHeader,
} from '@rtrvr-ai/rover';

const agentCardJson = createRoverAgentCardJson({
  siteUrl: 'https://example.com/',
  siteName: 'Example Store',
  shortcuts: [
    {
      id: 'start_checkout',
      label: 'Start Checkout',
      prompt: 'start checkout',
      description: 'Launch the checkout flow directly.',
      tags: ['checkout', 'commerce'],
      examples: ['Start checkout for the current cart.'],
      sideEffect: 'transactional',
      requiresConfirmation: true,
    },
  ],
});

const discoveryTags = createRoverAgentDiscoveryTags({
  siteUrl: 'https://example.com/',
  siteName: 'Example Store',
});

const linkHeader = createRoverServiceDescLinkHeader({
  agentCardUrl: '/.well-known/agent-card.json',
  llmsUrl: '/llms.txt',
});
```

Recommended rollout:

1. Serve `roverSiteJson` at `/.well-known/rover-site.json`.
2. Serve `agentCardJson` at `/.well-known/agent-card.json`.
3. Add `discoveryTags` near the Rover snippet in page source.
4. Add the `Link` header generated by `createRoverServiceDescLinkHeader(...)`.

### Hosted preview handoff behavior

The open-source helper extension understands hosted preview handoff URLs that include:

- `rover_preview_id`
- `rover_preview_token`
- `rover_preview_api`

When those are present, the helper can fetch the short-lived preview config from the hosted Rover API and reconnect it across navigation.

### Security notes

- `pk_site_*` values are Workspace install credentials for a real site.
- `rvrsess_*` values are short-lived runtime session credentials.
- Preview tokens are demo credentials and should be treated as ephemeral.
- Do not treat preview tokens as a replacement for production Workspace site keys.
- Keep preview or helper injections scoped to the intended host with `allowedDomains` and the right `domainScopeMode`.
- Generic `publicKey` config is the normal Workspace path. `sessionToken` is the temporary preview/runtime path.

### Troubleshooting

- **`This API key is missing capability: roverEmbed`**
  Your Workspace key is not embed-enabled. Rotate or create an embed-ready key, then rebuild the snippet or bookmarklet from the fresh test config JSON.
- **`React has blocked a javascript: URL`**
  Delete any old Rover bookmarklet and recreate it from the latest Rover Live Test page. The bookmarklet must be dragged from Rover's dedicated drag control, not clicked on the Rover page itself.
- **Console or Bookmarklet worked once, then stopped**
  Those are current-page-only methods. A full reload drops the injected JavaScript.
- **A site still blocks Rover after you generated valid output**
  Some sites enforce strict CSP or reload aggressively. Use the Preview Helper or Hosted Preview instead.
- **`Open hosted shell` does nothing**
  Hosted Preview should open Rover's dedicated hosted viewer route, not the launcher page.

### Hosted playground

If you want the full managed preview flow, including preview creation and Workspace handoff, use the hosted website:

- [https://www.rtrvr.ai/rover/instant-preview](https://www.rtrvr.ai/rover/instant-preview)

More architecture detail:

- [Instant Preview architecture](https://github.com/rtrvr-ai/rover/blob/main/docs/INSTANT_PREVIEW.md)
- [Hosted preview API docs](https://www.rtrvr.ai/rover/docs/instant-preview-api)
- [Hosted preview OpenAPI spec](https://raw.githubusercontent.com/rtrvr-ai/rtrvr-cloud-backend/main/docs/rover-instant-preview.openapi.yaml)

## npm Install

```bash
npm install @rtrvr-ai/rover
```

```typescript
import { boot, shutdown } from '@rtrvr-ai/rover';

boot({
  siteId: 'YOUR_SITE_ID',
  publicKey: 'pk_site_YOUR_PUBLIC_KEY',
  allowedDomains: ['yourdomain.com'],
  domainScopeMode: 'registrable_domain',
});
```

### React / Next.js

```tsx
import { useEffect } from 'react';
import { boot, shutdown } from '@rtrvr-ai/rover';

export function RoverWidget() {
  useEffect(() => {
    boot({
      siteId: 'YOUR_SITE_ID',
      publicKey: 'pk_site_YOUR_PUBLIC_KEY',
      allowedDomains: ['yourdomain.com'],
      domainScopeMode: 'registrable_domain',
    });

    return () => {
      shutdown();
    };
  }, []);

  return null;
}
```

For Next.js with SSR, use a dynamic import:

```tsx
import dynamic from 'next/dynamic';

const RoverWidget = dynamic(() => import('./RoverWidget'), { ssr: false });
```

## Script Tag vs npm

| Feature | Script Tag | npm Package |
|---|---|---|
| TypeScript types | No | Yes |
| Version pinning | CDN serves latest | Locked in package.json |
| SPA lifecycle | Manual | Framework hooks (useEffect, etc.) |
| SSR safety | N/A (browser only) | Requires dynamic import guard |
| Tree-shaking | No | Yes |
| Build tools required | No | Yes |

## Configuration

### Core

| Option | Type | Default | Description |
|---|---|---|---|
| `siteId` | `string` | *required* | Site identifier |
| `publicKey` | `string` | — | Public embeddable site key (`pk_site_*`) from Rover Workspace |
| `sessionToken` | `string` | — | Optional short-lived Rover session token (`rvrsess_*`). |
| `siteKeyId` | `string` | — | Site key ID from Workspace. Recommended for embed cache-busting/rotation rollouts; not used for scope matching. |
| `visitor` | `{ name?: string; email?: string }` | — | Optional visitor profile for greeting personalization. Recommended flow is async updates via `identify(...)` after login/user hydration. |
| `apiBase` | `string` | `https://agent.rtrvr.ai` | Optional API base override. Rover uses `/v2/rover/*` under this base. |
| `allowedDomains` | `string[]` | `[]` | Hostnames or patterns where Rover may operate. In `registrable_domain`, plain `example.com` covers the apex host and subdomains. |
| `domainScopeMode` | `'registrable_domain' \| 'host_only'` | `'registrable_domain'` | How Rover interprets plain `allowedDomains` entries: `registrable_domain` = apex + subdomains, `host_only` = exact host only. |
| `externalNavigationPolicy` | `'open_new_tab_notice' \| 'block' \| 'allow'` | `'open_new_tab_notice'` | External navigation policy |
| `navigation.crossHostPolicy` | `'same_tab' \| 'open_new_tab'` | `'same_tab'` | In-scope cross-host navigation policy |
| `mode` | `'full' \| 'safe'` | `'full'` | Runtime mode |
| `allowActions` | `boolean` | `true` | Enable or disable action tools |
| `openOnInit` | `boolean` | `false` | Open panel immediately on boot |
| `sessionScope` | `'shared_site' \| 'tab'` | `'shared_site'` | Session sharing across tabs |
| `workerUrl` | `string` | auto | Custom worker URL for self-hosting |
| `apiMode` | `boolean` | auto (`true` when `publicKey` or `sessionToken` exists) | Force API execution mode |

### Timing

| Option | Type | Default | Description |
|---|---|---|---|
| `timing.navigationDelayMs` | `number` | `80` | Delay (ms) before same-tab navigation executes, allowing state persistence |
| `timing.actionTimeoutMs` | `number` | `30000` | Timeout (ms) for bridge RPC calls from the worker |
| `timing.domSettleDebounceMs` | `number` | `24` | Adaptive DOM settle debounce before a11y tree capture |
| `timing.domSettleMaxWaitMs` | `number` | `220` | Adaptive DOM settle max wait before a11y tree capture |
| `timing.domSettleRetries` | `number` | `0` | Adaptive DOM settle bounded retries before capture |
| `timing.sparseTreeRetryDelayMs` | `number` | `35` | Additional delay before sparse-tree retry capture |
| `timing.sparseTreeRetryMaxAttempts` | `number` | `1` | Number of sparse-tree retries when roots are too sparse |

### Tab Indicators

| Option | Type | Default | Description |
|---|---|---|---|
| `ui.tabIndicator.titlePrefix` | `boolean` | `true` | Prepend "[Rover] " to document.title during task execution |
| `ui.tabIndicator.faviconBadge` | `boolean` | `false` | Overlay a colored dot on the favicon (opt-in due to CORS) |
| `ui.tabIndicator.widgetTabBar` | `boolean` | `true` | Show in-widget tab bar of agent-controlled tabs |

### Tab Policy

| Option | Type | Default | Description |
|---|---|---|---|
| `tabPolicy.observerByDefault` | `boolean` | — | Start tabs in observer mode by default |
| `tabPolicy.actionLeaseMs` | `number` | — | Action lease duration in milliseconds |

### Task Management

| Option | Type | Default | Description |
|---|---|---|---|
| `task.singleActiveScope` | `'host_session'` | — | Scope for single active task enforcement |
| `task.tabScope` | `'task_touched_only'` | — | Tab scope strategy |
| `task.maxConcurrentWorkers` | `number` | `2` | Maximum concurrent Web Workers (max: 3) |
| `task.maxQueuedTasks` | `number` | `5` | Maximum queued tasks waiting for a worker |
| `task.maxArchivedTasks` | `number` | `10` | Maximum archived (terminal) tasks to keep |
| `task.resume.mode` | `'crash_only'` | — | Resume behavior mode |
| `task.resume.ttlMs` | `number` | — | Resume TTL in milliseconds |
| `task.autoResumePolicy` | `'auto' \| 'confirm' \| 'never'` | `'confirm'` | Pending-run resume behavior: auto-resume immediately, require Resume/Cancel confirmation, or always cancel pending interrupted run. |
| `task.followup.mode` | `'heuristic_same_window'` | `'heuristic_same_window'` | Heuristic follow-up chat-cue carryover mode |
| `task.followup.ttlMs` | `number` | `120000` | Max age (ms) of prior completed/ended task eligible for follow-up chat cues |
| `task.followup.minLexicalOverlap` | `number` | `0.18` | Minimum lexical overlap ratio to attach follow-up chat cues |

### Task Routing

| Option | Type | Default | Description |
|---|---|---|---|
| `taskRouting.mode` | `'auto' \| 'act' \| 'planner'` | `'act'` | Task routing strategy |
| `taskRouting.plannerOnActError` | `boolean` | `true` | In `auto` mode, retry planner only when ACT does not produce a usable outcome |
| `taskRouting.actHeuristicThreshold` | `number` | `5` (auto mode) | Auto-routing threshold |

### Checkpointing

| Option | Type | Default | Description |
|---|---|---|---|
| `checkpointing.enabled` | `boolean` | `true` | Cloud checkpoint sync is enabled by default in v1. Set to `false` to disable. |
| `checkpointing.autoVisitorId` | `boolean` | `true` | Auto-generate visitor ID when needed |
| `checkpointing.ttlHours` | `number` | `1` | Checkpoint TTL in hours |
| `checkpointing.onStateChange` | `(payload) => void` | — | Checkpoint lifecycle updates (`active`, `paused_auth`) |
| `checkpointing.onError` | `(payload) => void` | — | Checkpoint request error callback |

### Telemetry

| Option | Type | Default | Description |
|---|---|---|---|
| `telemetry.enabled` | `boolean` | `true` | Enable runtime telemetry batching |
| `telemetry.sampleRate` | `number` | `1` | Sampling ratio (`1` = all events, `0.1` ≈ 10%) |
| `telemetry.flushIntervalMs` | `number` | `12000` | Flush cadence for buffered telemetry events |
| `telemetry.maxBatchSize` | `number` | `30` | Maximum number of telemetry events sent per flush request |
| `telemetry.includePayloads` | `boolean` | `false` | Include richer per-event payload details (debug/tool context). Increases telemetry volume and may include sensitive runtime content. |

### UI

| Option | Type | Default | Description |
|---|---|---|---|
| `ui.agent.name` | `string` | `'Rover'` | Custom assistant name |
| `ui.mascot.disabled` | `boolean` | `false` | Disable mascot video |
| `ui.mascot.mp4Url` | `string` | default | Custom mascot MP4 URL |
| `ui.mascot.webmUrl` | `string` | default | Custom mascot WebM URL |
| `ui.mascot.soundEnabled` | `boolean` | `false` | Owner gate for mascot sound. Rover keeps mascot audio unavailable unless this is explicitly `true`. |
| `ui.muted` | `boolean` | `true` | Initial mute state only when mascot sound is enabled. Visitor preference is stored per Rover site after they toggle sound. |
| `ui.thoughtStyle` | `'concise_cards' \| 'minimal'` | `'concise_cards'` | Thought rendering style |
| `ui.panel.resizable` | `boolean` | `true` | Enables desktop freeform resizing plus phone/tablet snap-height resizing with per-device memory |
| `ui.showTaskControls` | `boolean` | `true` | Show new/end task controls |
| `ui.shortcuts` | `RoverShortcut[]` | `[]` | Suggested journeys (max 100 stored, max 12 rendered by default; lower site-key policy caps are enforced). Shortcuts can also publish agent-facing metadata such as `tags`, `examples`, `inputSchema`, `outputSchema`, `sideEffect`, and `requiresConfirmation`. |
| `ui.greeting` | `{ text?, delay?, duration?, disabled? }` | — | Greeting bubble config (`{name}` token supported) |
| `ui.voice` | `{ enabled?: boolean; language?: string; autoStopMs?: number }` | — | Browser dictation for supported Chromium browsers. Rover fills the draft live, waits for post-speech silence before stopping, and the user still sends manually. |

### Web Tools

| Option | Type | Default | Description |
|---|---|---|---|
| `apiToolsConfig.mode` | `'allowlist' \| 'profile' \| 'none'` | `'none'` | API additional tool exposure mode |
| `tools.web.enableExternalWebContext` | `boolean` | `false` | External tab cloud context fallback |
| `tools.web.scrapeMode` | `'off' \| 'on_demand'` | `'off'` | On-demand external tab scrape mode |
| `tools.web.allowDomains` | `string[]` | `[]` | External context allowlist |
| `tools.web.denyDomains` | `string[]` | `[]` | External context denylist |
| `tools.client` | `ClientToolDefinition[]` | `[]` | Runtime-registered client tools. Tool definitions can include `title`, `outputSchema`, and `annotations` (`whenToUse`, `whyUse`, `examples`, `sideEffect`, `requiresConfirmation`) to improve model tool selection and discovery-card quality. |
| `agentDiscovery` | `{ enabled?, siteName?, description?, version?, siteUrl?, agentCardUrl?, roverSiteUrl?, llmsUrl?, hostSurfaceSelector?, preferExecution?, discoverySurface?, additionalSkills? }` | — | Optional overrides for Rover's generated discovery surfaces. `rover-site.json` is the authoritative rich profile, `agent-card.json` is the interop card, and `discoverySurface.beaconLabel` now feeds the visible seed/presence CTA text in production. Legacy `visibleCue` / `visibleCueLabel` remain compatibility inputs only. |
| `pageConfig` | `RoverPageCaptureConfig` | — | Optional per-site page-capture overrides such as `disableAutoScroll`, settle timing, and sparse-tree retry settings |

### AI-Callable URLs (Deep Links)

Rover can be triggered via URL query parameters, turning any page into an AI-callable endpoint.

| Option | Type | Default | Description |
|---|---|---|---|
| `deepLink.enabled` | `boolean` | derived from `siteConfig.aiAccess.enabled` when available, otherwise `false` | Advanced manual override for URL-triggered Rover |
| `deepLink.promptParam` | `string` | `'rover'` | Query parameter for natural-language prompts |
| `deepLink.shortcutParam` | `string` | `'rover_shortcut'` | Query parameter for shortcut IDs |
| `deepLink.consume` | `boolean` | `true` | Strip deep link params from URL after reading |

**Prompt deep link** — pass a natural-language instruction:

```
https://example.com?rover=book%20a%20flight
```

**Shortcut deep link** — invoke a pre-defined flow by ID:

```
https://example.com?rover_shortcut=checkout_flow
```

For AI or CLI-triggered entrypoints, prefer exact shortcut IDs for repeatable flows.

When a site key or session token is used, Rover fetches cloud site config via `/v2/rover/session/open` (shortcuts + `businessType` + sparse `experience` overrides + legacy voice compatibility + `aiAccess` + `pageConfig`).
If the same field exists in both cloud config and boot config, boot config wins.
`siteConfig.aiAccess.enabled` is the canonical owner-facing launch switch persisted from Workspace/Webflow. `deepLink` stays boot/runtime only for advanced manual overrides such as custom param names, explicit enable/disable, or disabling URL param consumption.

If you enable `tools.web.scrapeMode: 'on_demand'`, use a site key capability profile that includes cloud scrape support.

See [full configuration reference](https://github.com/rtrvr-ai/rover/blob/main/docs/INTEGRATION.md#configuration-reference).

## Public Agent Tasks (ATP)

Rover-enabled sites expose two public entrypoints:

- browser-first convenience via `?rover=` and `?rover_shortcut=`
- machine-first task resources via `POST https://agent.rtrvr.ai/v1/tasks`

Use `/v1/tasks` when you need structured progress, continuation, or the final result back.

The source-visible marker is optional but recommended:

```html
<script type="application/agent+json">{"task":"https://agent.rtrvr.ai/v1/tasks"}</script>
```

For stronger pre-task discovery, publish `/.well-known/rover-site.json` as Rover's authoritative rich profile, publish `/.well-known/agent-card.json` as the interop card, add a `Link: </.well-known/agent-card.json>; rel="service-desc"` header, and include inline discovery tags generated by `createRoverAgentDiscoveryTags(...)`.

```http
POST https://agent.rtrvr.ai/v1/tasks
Content-Type: application/json

{
  "url": "https://www.rtrvr.ai",
  "goal": "Get me the latest blog post",
  "capabilityId": "latest_blog_post",
  "accept": { "modes": ["text", "json"] }
}
```

Compatibility aliases such as `{ "url": "...", "prompt": "..." }` and `{ "url": "...", "shortcutId": "..." }` still work, but the richer task envelope is the canonical contract.

Callers may also provide structured visiting-agent metadata:

```http
POST https://agent.rtrvr.ai/v1/tasks
Content-Type: application/json

{
  "url": "https://www.rtrvr.ai",
  "goal": "Get me the latest blog post",
  "agent": {
    "key": "gpt-5.4-demo-agent",
    "name": "GPT-5.4 Demo Agent",
    "vendor": "OpenAI",
    "model": "gpt-5.4",
    "version": "2026-03",
    "homepage": "https://openai.com"
  }
}
```

Anonymous AI callers do **not** need `siteId`, `publicKey`, or `siteKeyId`.

The returned task URL is the canonical resource:

- `GET` + `Accept: application/json` for polling or final result
- `GET` + `Accept: text/event-stream` for SSE
- `GET` + `Accept: application/x-ndjson` for CLI-friendly streaming
- `POST { "input": "..." }` for continuation when the task asks for more input
- `DELETE` to cancel
- a `workflow` URL when the task belongs to an aggregated multi-site workflow

Task creation may also return browser handoff URLs:

- `open`: clean receipt URL for browser attach
- `browserLink`: optional readable alias with visible `?rover=` or `?rover_shortcut=` when it fits the URL budget

The task URL remains canonical; receipt links are only a browser handoff layer over that same task.

- `Prefer: execution=browser` keeps execution browser-first
- `Prefer: execution=cloud` is the explicit browserless path today
- `Prefer: execution=auto` prefers browser attach first; delayed cloud auto-promotion is a follow-up robustness phase

Rover deep links like `?rover=` and `?rover_shortcut=` remain the simple browser-first entrypoints; `/v1/tasks` is the machine-oriented protocol. Cross-site workflows and handoffs extend that same public contract rather than replacing it.

### Agent identity attribution

Rover normalizes visiting-agent attribution in this order:

1. verified signed signal
2. explicit `agent` object on public task creation or handoffs
3. heuristic headers such as `User-Agent`, `Signature-Agent`, `Signature`, `Signature-Input`, and `X-RTRVR-Client-Id`
4. advanced local fallbacks such as RoverBook `identityResolver`
5. anonymous fallback

Trust tiers are `verified_signed`, `signed_directory_only`, `self_reported`, `heuristic`, and `anonymous`. Unsigned headers never escalate above `heuristic`.

### Cross-site workflows and handoffs

Public tasks can delegate to Rover on another Rover-enabled site without leaving the same protocol surface.

- `POST /v1/tasks/{id}/handoffs` creates a child task on another site
- `GET /v1/workflows/{id}` returns aggregated workflow state or stream
- child tasks inherit the same workflow lineage as the parent

Handoff creation also accepts the optional `agent` object so a child task can inherit or explicitly override visiting-agent attribution.

Receiving sites must explicitly opt in through Workspace/site config:

- `aiAccess.enabled = true`
- `aiAccess.allowDelegatedHandoffs = true`

By default, handoffs carry a structured summary rather than the full transcript or tool trace.

## Rover V2 Runtime Endpoints

Browser runtime calls target `https://agent.rtrvr.ai/v2/rover/*`:

- `POST /session/open`
- `POST /command` (`RUN_INPUT`, `RUN_CONTROL`, `TAB_EVENT`, `ASK_USER_ANSWER`)
- `GET /stream` (SSE)
- `GET /state`
- `POST /snapshot`
- `POST /context/external`
- `POST /telemetry/ingest`

Runtime contract notes:

- Server is authoritative (`sessionId + runId + epoch + seq`).
- `taskRouting.mode` maps to `requestedMode` in `POST /command` payloads with `type='RUN_INPUT'`.
- `plannerOnActError` applies only in `auto` mode and only when ACT has no usable outcome.
- Typed conflicts: `stale_seq`, `stale_epoch`, `active_run_exists`.
- `POST /command` stale/missing run is non-fatal for tab navigation decisions (`decision='stale_run'`).
- Cross-registrable navigation preflight is resilient: if command-tab decision checks are unavailable, Rover falls back to local policy (in-scope targets follow `navigation.crossHostPolicy`, default `same_tab`; out-of-scope targets follow `externalNavigationPolicy`).
- External intent routing: `/context/external` uses `read_context` (read/navigation-context prompts) or `act` (mutation prompts). Navigation-only external opens are represented by `POST /command` with `type='TAB_EVENT'` plus external placeholder tab handling.
- Any normal user send starts a fresh task boundary (fresh `prevSteps`, fresh run-scoped tab order/scope).
- `ask_user` answer submissions are the only continuation path and keep the same task boundary.
- `task.followup` is operative heuristic carryover for chat cues only (`user` + `model` summary pair); it never carries previous task state/tab scope.
- `task.autoResumePolicy` is enforced at runtime: `auto` resumes, `confirm` shows explicit Resume/Cancel suggestion, `never` cancels pending resume.
- Resume blocked/declined/never paths terminalize the local task to `cancelled`, clear local running indicators, and schedule backend cancel repair (`RUN_CONTROL cancel`) unless a live remote controller owns that run.
- Server projection never re-adopts locally ignored run IDs; ignored projected active runs trigger cancel repair retry.
- Same-domain/subdomain continuity is preserved when a live controller tab owns the active run; reopening tabs stay observer-safe and do not force-cancel that run.
- Runtime does not use legacy browser checkpoint routes (`roverSessionCheckpointGet/Upsert`).

## API Methods

All methods are available as both command-style and method-style calls:

```javascript
// Command style
rover('boot', config);
rover('send', 'Hello');

// Method style
rover.boot(config);
rover.send('Hello');
```

| Method | Description |
|---|---|
| `boot(config)` | Initialize Rover with configuration |
| `shutdown()` | Tear down Rover and clean up resources |
| `open()` | Open the chat panel |
| `close()` | Close the chat panel |
| `show()` | Show the widget (launcher + panel) |
| `hide()` | Hide the widget entirely |
| `send(text)` | Send a message to Rover |
| `newTask(options?)` | Start a new task, clearing context |
| `endTask(options?)` | End the current task |
| `getState()` | Get current runtime state |
| `getAgentCard()` | Build the current Rover capability card from live shortcuts, client tools, and WebMCP metadata |
| `update(config)` | Update configuration without rebooting |
| `registerTool(def, handler)` | Register a client-side tool |
| `requestSigned(url, init?)` | Issue a fetch signed with the current Rover session token and site/session headers |
| `registerPromptContextProvider(provider)` | Inject bounded prompt context before a fresh Rover task/run |
| `identify(visitor)` | Update visitor profile after boot (for async login/user hydration) |
| `on(event, handler)` | Subscribe to events (returns unsubscribe fn) |

## Events

```javascript
rover.on('ready', () => console.log('Rover ready'));
rover.on('status', (payload) => console.log(payload.stage, payload.compactThought));
rover.on('error', (err) => console.error(err));
```

| Event | Payload | Description |
|---|---|---|
| `ready` | — | SDK initialized and worker connected |
| `status` | `{ stage, compactThought }` | Execution progress updates |
| `error` | `{ message, code? }` | Runtime errors |
| `auth_required` | `{ code, missing }` | Authentication needed |
| `open` | — | Panel opened |
| `close` | — | Panel closed |
| `mode_change` | `{ mode }` | Execution mode changed |
| `navigation_guardrail` | `{ url, policy }` | Out-of-scope navigation intercepted |
| `task_started` | `{ reason }` | New task started |
| `task_ended` | `{ reason }` | Task ended |
| `run_started` | `{ taskId, runId, taskBoundaryId, state, taskComplete, needsUserInput, summary? }` | Public run lifecycle start event |
| `run_state_transition` | `{ taskId, runId, taskBoundaryId, state, taskComplete, needsUserInput, summary?, error? }` | Public run lifecycle transition |
| `run_completed` | `{ taskId, runId, taskBoundaryId, state, taskComplete, needsUserInput, summary?, error? }` | Terminal public run lifecycle event |
| `checkpoint_state` | `{ state, reason?, action?, code?, message? }` | Checkpoint sync state updates |
| `checkpoint_error` | `{ action, code?, message, ... }` | Checkpoint request failure details |
| `tab_event_conflict_retry` | `{ runId, conflict?, ... }` | One stale seq/epoch tab-event conflict was recovered by silent retry |
| `tab_event_conflict_exhausted` | `{ runId, conflict?, ... }` | Tab-event stale conflict retry exhausted (non-fatal; projection sync follows) |
| `checkpoint_token_missing` | `{ action, status }` | Legacy checkpoint browser path blocked |

`requestSigned(...)` and `registerPromptContextProvider(...)` are the main extension points RoverBook uses for signed analytics writes and memory injection.

## Content Security Policy (CSP)

If your site sets a CSP header, add these directives:

| Directive | Value | Why |
|---|---|---|
| `script-src` | `https://rover.rtrvr.ai blob:` | SDK script + Web Worker blob |
| `worker-src` | `blob: https://rover.rtrvr.ai` | Web Worker execution |
| `connect-src` | `https://agent.rtrvr.ai` | API calls |
| `style-src` | `'unsafe-inline'` | Shadow DOM styles |
| `font-src` | `https://rover.rtrvr.ai` | Self-hosted Manrope font |

Optional (if mascot video is enabled):

| Directive | Value | Why |
|---|---|---|
| `media-src` | `https://www.rtrvr.ai` | Mascot video |

Disable the mascot to remove the `media-src` requirement:

```javascript
rover('boot', { ..., ui: { mascot: { disabled: true } } });
```

**No CSP header?** No action needed — Rover works out of the box.

### Self-Hosting (Strict CSP)

For environments that cannot allow external domains:

1. Download `embed.js` and `worker/rover-worker.js` from `https://rover.rtrvr.ai/`
2. Host them on your own domain
3. Point Rover to your hosted files:

```javascript
rover('boot', {
  siteId: 'YOUR_SITE_ID',
  publicKey: 'pk_site_YOUR_PUBLIC_KEY',
  workerUrl: '/assets/rover-worker.js',
});
```

Load your self-hosted `embed.js` instead of the CDN version:

```html
<script src="/assets/embed.js" async></script>
```

## Links

- [GitHub](https://github.com/rtrvr-ai/rover)
- [Integration Guide](https://github.com/rtrvr-ai/rover/blob/main/docs/INTEGRATION.md)
- [Rover Workspace](https://rover.rtrvr.ai/workspace) — generate site keys and install snippets
- [Website](https://www.rtrvr.ai/rover)
- [Documentation](https://www.rtrvr.ai/rover/docs)
- [Discord](https://rtrvr.ai/discord)
