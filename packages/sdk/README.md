# @rtrvr-ai/rover

**Turn any web interface into an AI agent — with one line of code.**

Rover is an open-source, DOM-native agent SDK that reads the real DOM,
plans actions, and executes them directly in the browser. Clicks, form fills,
navigation, data extraction — sub-second, no screenshots, no remote VMs.
Embed on websites, browser extensions, Electron apps, or any DOM environment.

[GitHub](https://github.com/rtrvr-ai/rover) · [Website](https://www.rtrvr.ai/rover) · [Docs](https://www.rtrvr.ai/rover/docs) · [Discord](https://rtrvr.ai/discord)

## Prerequisites

You need an rtrvr.ai account with available credits. Free accounts get 250 credits/month. [Sign up or manage your plan](https://www.rtrvr.ai/cloud?view=pricing).

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
  data-allowed-domains="yourdomain.com"
  data-domain-scope-mode="registrable_domain">
</script>
```

Use `data-domain-scope-mode="host_only"` to require exact host matches. Plain entries such as `example.com` become exact-host rules in `host_only` mode. In the default `registrable_domain` mode, plain entries match the apex host and its subdomains, while `*.example.com` matches subdomains only.

Common patterns:

- `allowedDomains: ['example.com']` with `registrable_domain` allows `example.com` and all subdomains.
- `allowedDomains: ['*.example.com']` allows subdomains only, not the apex host.
- `allowedDomains: ['app.example.com']` with `registrable_domain` allows `app.example.com` and its subdomains, but not sibling hosts.
- `allowedDomains: ['example.com']` with `host_only` allows only the exact host `example.com`.

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
| `ui.muted` | `boolean` | `true` | Start with audio muted on first load; stored browser preference wins after the user toggles sound |
| `ui.thoughtStyle` | `'concise_cards' \| 'minimal'` | `'concise_cards'` | Thought rendering style |
| `ui.panel.resizable` | `boolean` | `true` | Enables desktop freeform resizing plus phone/tablet snap-height resizing with per-device memory |
| `ui.showTaskControls` | `boolean` | `true` | Show new/end task controls |
| `ui.shortcuts` | `RoverShortcut[]` | `[]` | Suggested journeys (max 100 stored, max 12 rendered by default; lower site-key policy caps are enforced) |
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
| `tools.client` | `ClientToolDefinition[]` | `[]` | Runtime-registered client tools |
| `pageConfig` | `RoverPageCaptureConfig` | — | Optional per-site page-capture overrides such as `disableAutoScroll`, settle timing, and sparse-tree retry settings |

### AI-Callable URLs (Deep Links)

Rover can be triggered via URL query parameters, turning any page into an AI-callable endpoint.

| Option | Type | Default | Description |
|---|---|---|---|
| `deepLink.enabled` | `boolean` | `false` | Enable URL-triggered Rover |
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

When a site key or session token is used, Rover fetches cloud site config via `/v2/rover/session/open` (shortcuts + greeting + voice + pageConfig).
If the same field exists in both cloud config and boot config, boot config wins.
`deepLink` is boot/runtime only and is not persisted in cloud site config.

If you enable `tools.web.scrapeMode: 'on_demand'`, use a site key capability profile that includes cloud scrape support.

See [full configuration reference](https://github.com/rtrvr-ai/rover/blob/main/docs/INTEGRATION.md#configuration-reference).

## Public Agent Tasks

Rover-enabled sites expose two public entrypoints:

- browser-first convenience via `?rover=` and `?rover_shortcut=`
- machine-first task resources via `POST https://agent.rtrvr.ai/v1/tasks`

Use `/v1/tasks` when you need structured progress, continuation, or the final result back.

The source-visible marker is optional but recommended:

```html
<script type="application/agent+json">{"task":"https://agent.rtrvr.ai/v1/tasks"}</script>
```

```http
POST https://agent.rtrvr.ai/v1/tasks
Content-Type: application/json

{ "url": "https://www.rtrvr.ai", "prompt": "get me the latest blog post" }
```

Anonymous AI callers do **not** need `siteId`, `publicKey`, or `siteKeyId`.

The returned task URL is the canonical resource:

- `GET` + `Accept: application/json` for polling or final result
- `GET` + `Accept: text/event-stream` for SSE
- `GET` + `Accept: application/x-ndjson` for CLI-friendly streaming
- `POST { "input": "..." }` for continuation when the task asks for more input
- `DELETE` to cancel

Task creation may also return browser handoff URLs:

- `open`: clean receipt URL for browser attach
- `browserLink`: optional readable alias with visible `?rover=` or `?rover_shortcut=` when it fits the URL budget

The task URL remains canonical; receipt links are only a browser handoff layer over that same task.

The response also includes an `open` URL for browser attach.

- `Prefer: execution=browser` keeps execution browser-first
- `Prefer: execution=cloud` is the explicit browserless path today
- `Prefer: execution=auto` prefers browser attach first; delayed cloud auto-promotion is a follow-up robustness phase

Rover deep links like `?rover=` and `?rover_shortcut=` remain the simple browser-first entrypoints; `/v1/tasks` is the machine-oriented protocol.

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
| `update(config)` | Update configuration without rebooting |
| `registerTool(def, handler)` | Register a client-side tool |
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
| `checkpoint_state` | `{ state, reason?, action?, code?, message? }` | Checkpoint sync state updates |
| `checkpoint_error` | `{ action, code?, message, ... }` | Checkpoint request failure details |
| `tab_event_conflict_retry` | `{ runId, conflict?, ... }` | One stale seq/epoch tab-event conflict was recovered by silent retry |
| `tab_event_conflict_exhausted` | `{ runId, conflict?, ... }` | Tab-event stale conflict retry exhausted (non-fatal; projection sync follows) |
| `checkpoint_token_missing` | `{ action, status }` | Legacy checkpoint browser path blocked |

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
