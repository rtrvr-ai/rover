# Rover Integration Guide

## Quick Start

### Prerequisites

Rover requires an active rtrvr.ai account with available credits. Each Rover task consumes credits from your account balance.

| Plan | Credits / month | Price |
|---|---|---|
| Free | 250 | $0 |
| Starter | 1,500 | $9.99/mo |
| Pro | 4,000 | $29.99/mo |
| Enterprise | 12,500 | $99.99/mo |
| Scale | 60,000 | $499.99/mo |

Check your credit balance in the [Rover Workspace](https://rover.rtrvr.ai/workspace). Manage your subscription at [rtrvr.ai](https://www.rtrvr.ai/cloud?view=pricing).

When credits are exhausted, Rover API calls return an `auth_required` event. See [Troubleshooting](#troubleshooting) for details.

Add this snippet before `</body>` on your website:

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

Get your `siteId` and `publicKey` (`pk_site_*`) from the [Rover Workspace](https://rover.rtrvr.ai/workspace). If you also have a `siteKeyId`, append it to the script URL as `embed.js?v=YOUR_SITE_KEY_ID` for cache-busting and safer key-rotation rollouts. The `v` query string does not affect domain authorization or scope matching.

Site-owner credentials are only for installing Rover on your website. External AI callers do **not** need `siteId`, `publicKey`, or `siteKeyId` when they use the public task protocol.

### Single Script Tag (Data Attributes)

For the simplest integration, use data attributes — no inline JavaScript needed:

```html
<script src="https://rover.rtrvr.ai/embed.js"
  data-site-id="YOUR_SITE_ID"
  data-public-key="pk_site_YOUR_PUBLIC_KEY"
  data-allowed-domains="yourdomain.com"
  data-domain-scope-mode="registrable_domain">
</script>
```

Supported data attributes: `data-site-id`, `data-public-key`, `data-allowed-domains` (comma-separated), `data-domain-scope-mode`, `data-site-key-id`, `data-worker-url`.

Use `data-domain-scope-mode="host_only"` when the key should only run on the exact host that booted Rover. In `host_only` mode, plain entries like `example.com` are normalized as exact-host rules instead of suffix matches. In the default `registrable_domain` mode, a plain entry like `example.com` matches the apex host and its subdomains, while `*.example.com` matches subdomains only.

### Domain Scope Semantics

- `allowedDomains: ['example.com']` with `domainScopeMode: 'registrable_domain'` allows `example.com` and all of its subdomains.
- `allowedDomains: ['*.example.com']` allows subdomains only. It does not match the apex host `example.com`.
- `allowedDomains: ['app.example.com']` with `domainScopeMode: 'registrable_domain'` allows `app.example.com` and its subdomains, but not sibling hosts such as `www.example.com`.
- `allowedDomains: ['example.com']` with `domainScopeMode: 'host_only'` allows only the exact host `example.com`.
- `example.com` plus `*.example.com` is usually redundant in `registrable_domain` mode, because the plain `example.com` entry already covers the apex host and subdomains.

For advanced configuration (task routing, checkpointing, UI options), use the JS boot call.

---

## How It Works

The two-part snippet pattern works like this:

1. **Queue stub** — The inline `<script>` creates a lightweight `rover()` function that queues commands. This lets you call `rover('boot', ...)` immediately, before the SDK has loaded.
2. **Async SDK** — The `embed.js` script loads asynchronously (non-blocking). Once loaded, it replays any queued commands and replaces the stub with the full API.

This pattern ensures Rover never blocks your page load, and commands are never lost regardless of load order.

---

## npm Integration

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

**When to use npm over the script tag:**
- TypeScript types and autocompletion
- Version pinning via `package.json`
- SPA lifecycle management (boot/shutdown on mount/unmount)
- SSR safety with dynamic imports

---

## Framework Guides

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

**Next.js SSR guard** — Rover requires `window` and `document`. Use a dynamic import:

```tsx
import dynamic from 'next/dynamic';

const RoverWidget = dynamic(() => import('./RoverWidget'), { ssr: false });

// In your layout or page:
export default function Layout({ children }) {
  return (
    <>
      {children}
      <RoverWidget />
    </>
  );
}
```

### Vue / Nuxt

```vue
<script setup>
import { onMounted, onUnmounted } from 'vue';

onMounted(async () => {
  const { boot } = await import('@rtrvr-ai/rover');
  boot({
    siteId: 'YOUR_SITE_ID',
    publicKey: 'pk_site_YOUR_PUBLIC_KEY',
    allowedDomains: ['yourdomain.com'],
    domainScopeMode: 'registrable_domain',
  });
});

onUnmounted(async () => {
  const { shutdown } = await import('@rtrvr-ai/rover');
  shutdown();
});
</script>
```

**Nuxt** — Create a client-only plugin:

```typescript
// plugins/rover.client.ts
import { boot } from '@rtrvr-ai/rover';

export default defineNuxtPlugin(() => {
  boot({
    siteId: 'YOUR_SITE_ID',
    publicKey: 'pk_site_YOUR_PUBLIC_KEY',
    allowedDomains: ['yourdomain.com'],
    domainScopeMode: 'registrable_domain',
  });
});
```

### Vanilla JS / WordPress / Shopify

Use the script tag snippet from [Quick Start](#quick-start). Place it before `</body>` in your theme template, `functions.php`, or theme settings.

For WordPress, you can add it via `wp_footer`:

```php
add_action('wp_footer', function() {
  ?>
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
      allowedDomains: ['<?php echo esc_js($_SERVER["HTTP_HOST"]); ?>'],
      domainScopeMode: 'host_only',
    });
  </script>
  <script src="https://rover.rtrvr.ai/embed.js" async></script>
  <?php
});
```

---

## Content Security Policy (CSP)

**No CSP header on your site?** Skip this section — Rover works out of the box with no configuration.

If your site sets a `Content-Security-Policy` header or `<meta>` tag, add the following directives:

### Required Directives

| Directive | Value | Why |
|---|---|---|
| `script-src` | `https://rover.rtrvr.ai blob:` | Loads the SDK script. `blob:` is needed because the Web Worker is created from a blob URL via `importScripts()`. |
| `worker-src` | `blob: https://rover.rtrvr.ai` | Allows the Web Worker to execute. The worker handles AI task processing off the main thread. |
| `connect-src` | `https://agent.rtrvr.ai` | API calls for task execution, authentication, checkpointing, and public task resources. |
| `style-src` | `'unsafe-inline'` | Rover renders inside a Shadow DOM and injects its styles inline. This is standard for Shadow DOM components. |
| `font-src` | `https://rover.rtrvr.ai` | Loads the self-hosted Manrope font used in the widget UI. |

### Optional Directives

| Directive | Value | Why |
|---|---|---|
| `media-src` | `https://www.rtrvr.ai` | Mascot video in the launcher and header. **Not needed** if you disable the mascot: `ui: { mascot: { disabled: true } }` |

### Copy-Paste CSP Meta Tag

```html
<meta http-equiv="Content-Security-Policy" content="
  script-src 'self' https://rover.rtrvr.ai blob:;
  worker-src blob: https://rover.rtrvr.ai;
  connect-src 'self' https://agent.rtrvr.ai;
  style-src 'self' 'unsafe-inline';
  font-src 'self' https://rover.rtrvr.ai;
  media-src 'self' https://www.rtrvr.ai;
">
```

### Self-Hosting (Strict CSP)

If your CSP policy cannot allow any external script domains, self-host the Rover files:

1. Download from `https://rover.rtrvr.ai/`:
   - `embed.js`
   - `worker/rover-worker.js`
   - `rover/fonts/manrope-latin.woff2` (optional — for font self-hosting)
2. Host them on your origin (e.g., `/assets/rover/`)
3. Load from your origin:

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
    workerUrl: '/assets/rover/rover-worker.js',
  });
</script>
<script src="/assets/rover/embed.js" async></script>
```

This eliminates all `script-src`, `worker-src`, and `font-src` external domain requirements. You still need `connect-src` for the API.

---

## CORS

**You do NOT need to configure CORS on your server.** CORS headers are set on Rover's CDN (Vercel) side. The `embed.js`, worker, and font files all include `Access-Control-Allow-Origin: *`. Your website simply loads them — no server-side changes required.

---

## API Reference

All commands support both styles:

```javascript
// Command style (works before SDK loads, via queue stub)
rover('boot', config);

// Method style (works after SDK loads)
rover.boot(config);
```

| Command | Arguments | Description |
|---|---|---|
| `boot` | `config: RoverInit` | Initialize Rover. If already booted, calls `update` instead. |
| `init` | `config: RoverInit` | Alias for `boot`. |
| `update` | `config: Partial<RoverInit>` | Update configuration without rebooting. |
| `shutdown` | — | Destroy the widget, worker, and all state. |
| `open` | — | Open the chat panel. |
| `close` | — | Close the chat panel. |
| `show` | — | Show the widget (launcher button + panel). |
| `hide` | — | Hide the widget entirely. |
| `send` | `text: string` | Send a user message. |
| `newTask` | `{ reason?: string }` | Start a new task, clearing conversation and worker context. |
| `endTask` | `{ reason?: string }` | End the current task without destroying the session. |
| `getState` | — | Returns the current runtime state object. |
| `registerTool` | `def, handler` | Register a client-side tool callable by the agent. |
| `identify` | `{ name?, email? }` | Update visitor profile after boot (async auth/user hydration). |
| `on` | `event, handler` | Subscribe to an event. Returns an unsubscribe function. |

---

## Configuration Reference

### Core Identity & Auth

| Option | Type | Default | Description |
|---|---|---|---|
| `siteId` | `string` | *required* | Site identifier from Workspace |
| `publicKey` | `string` | — | Public Rover bootstrap key (`pk_site_*`) from Workspace |
| `sessionToken` | `string` | — | Optional pre-minted short-lived session token (`rvrsess_*`) |
| `siteKeyId` | `string` | — | Site key ID from Workspace. Recommended for embed cache-busting/rotation rollouts; not used for scope matching. |
| `visitorId` | `string` | auto | Stable visitor identifier |
| `visitor` | `{ name?: string; email?: string }` | — | Optional visitor profile for greeting personalization. Recommended flow is async updates via `identify(...)` after login/user hydration. |
| `sessionId` | `string` | auto | Explicit session ID |
| `sessionScope` | `'shared_site' \| 'tab'` | `'shared_site'` | Shared cross-tab session or tab-isolated session |
| `mode` | `'full' \| 'safe'` | `'full'` | Runtime mode |
| `apiBase` | `string` | `https://agent.rtrvr.ai` | Custom API base URL. Rover runtime uses `/v2/rover/*` under this base. |
| `workerUrl` | `string` | auto | Custom worker URL (self-hosting) |

### Domain Guardrails & Navigation

| Option | Type | Default | Description |
|---|---|---|---|
| `allowedDomains` | `string[]` | `[]` | Hostnames or patterns where Rover may operate. In `registrable_domain`, plain `example.com` covers the apex host and subdomains. |
| `domainScopeMode` | `'registrable_domain' \| 'host_only'` | `'registrable_domain'` | How Rover interprets plain entries in `allowedDomains`: `registrable_domain` = apex + subdomains, `host_only` = exact host only. |
| `externalNavigationPolicy` | `'open_new_tab_notice' \| 'block' \| 'allow'` | `'open_new_tab_notice'` | External navigation policy |
| `navigation.crossHostPolicy` | `'same_tab' \| 'open_new_tab'` | `'same_tab'` | In-scope cross-host navigation policy |
| `openOnInit` | `boolean` | `false` | Open panel after boot |
| `deepLink` | `{ enabled?: boolean; promptParam?: string; shortcutParam?: string; consume?: boolean }` | `{ enabled: false, promptParam: 'rover', shortcutParam: 'rover_shortcut', consume: true }` | Opt-in URL-triggered Rover (`?rover=book%20a%20flight` or `?rover_shortcut=checkout_flow`) |
| `allowActions` | `boolean` | `true` | Enable/disable action tools |
| `tabPolicy.observerByDefault` | `boolean` | `true` | Observer preference for shared tab sessions |
| `tabPolicy.actionLeaseMs` | `number` | coordinator default | Controller action lease duration |

### Task Routing

| Option | Type | Default | Description |
|---|---|---|---|
| `taskRouting.mode` | `'auto' \| 'act' \| 'planner'` | `'act'` | Task routing mode |
| `taskRouting.actHeuristicThreshold` | `number` | `5` (auto mode) | Complexity threshold for auto-routing |
| `taskRouting.plannerOnActError` | `boolean` | `true` | In `auto` mode, retry with planner only when ACT does not produce a usable outcome |

### Task Context

| Option | Type | Default | Description |
|---|---|---|---|
| `taskContext.resetMode` | `'auto' \| 'ask' \| 'off'` | `'auto'` | Advisory task reset behavior |
| `taskContext.inactivityMs` | `number` | — | Optional inactivity hint for continuity logic |
| `taskContext.suggestReset` | `boolean` | `true` | Allow reset suggestions when continuity is unclear |
| `taskContext.semanticSimilarityThreshold` | `number` | — | Optional similarity hint for continuity scoring |
| `task.followup.mode` | `'heuristic_same_window'` | `'heuristic_same_window'` | Heuristic follow-up chat-cue carryover mode |
| `task.followup.ttlMs` | `number` | `120000` | Max age (ms) of prior completed/ended task eligible for follow-up chat cues |
| `task.followup.minLexicalOverlap` | `number` | `0.18` | Minimum lexical overlap ratio to attach follow-up chat cues |
| `task.autoResumePolicy` | `'auto' \| 'confirm' \| 'never'` | `'confirm'` | Interrupted-run resume behavior (`auto` resume, `confirm` prompt Resume/Cancel, or `never` cancel pending run). |

### Checkpointing

| Option | Type | Default | Description |
|---|---|---|---|
| `checkpointing.enabled` | `boolean` | `true` | Cloud checkpoint sync is enabled by default in v1. Set to `false` to disable. |
| `checkpointing.autoVisitorId` | `boolean` | `true` | Auto-generate visitor ID when needed |
| `checkpointing.flushIntervalMs` | `number` | service default | Push interval for checkpoint writes |
| `checkpointing.pullIntervalMs` | `number` | service default | Pull interval for checkpoint refresh |
| `checkpointing.minFlushIntervalMs` | `number` | service default | Minimum checkpoint flush interval |
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

### API Execution

| Option | Type | Default | Description |
|---|---|---|---|
| `apiMode` | `boolean` | auto (`true` when `publicKey` or `sessionToken` is set) | Force API execution mode |
| `apiToolsConfig.mode` | `'allowlist' \| 'profile' \| 'none'` | `'none'` | Additional tool exposure mode |
| `apiToolsConfig.enableAdditionalTools` | `string[]` | `[]` | Additional first-party tools to enable |
| `apiToolsConfig.userDefined` | `string[]` | `[]` | User-defined tools to expose |

### External Web Context

| Option | Type | Default | Description |
|---|---|---|---|
| `tools.web.enableExternalWebContext` | `boolean` | `false` | Allow external tab cloud context fallback |
| `tools.web.scrapeMode` | `'off' \| 'on_demand'` | `'off'` | Cloud scrape mode for external tabs |
| `tools.web.allowDomains` | `string[]` | `[]` | Optional allowlist for external cloud context fetch |
| `tools.web.denyDomains` | `string[]` | `[]` | Optional denylist for external cloud context fetch |

When `tools.web.scrapeMode` is `on_demand`, ensure your Rover site key includes cloud scrape capability.

### UI & Branding

| Option | Type | Default | Description |
|---|---|---|---|
| `ui.agent.name` | `string` | `'Rover'` | Assistant name shown in UI and runtime context |
| `ui.mascot.disabled` | `boolean` | `false` | Disable mascot video |
| `ui.mascot.mp4Url` | `string` | default | Custom mascot MP4 URL |
| `ui.mascot.webmUrl` | `string` | default | Custom mascot WebM URL |
| `ui.muted` | `boolean` | `true` | Start with media muted on first load; stored browser preference wins after the user toggles sound |
| `ui.thoughtStyle` | `'concise_cards' \| 'minimal'` | `'concise_cards'` | Thought rendering preference |
| `ui.panel.resizable` | `boolean` | `true` | Enables desktop freeform resizing plus phone/tablet snap-height resizing with per-device memory |
| `ui.showTaskControls` | `boolean` | `true` | Show new/end task controls |
| `ui.shortcuts` | `RoverShortcut[]` | `[]` | Suggested journeys (max 100 stored, max 12 rendered by default; lower site-key policy caps are enforced) |
| `ui.greeting` | `{ text?, delay?, duration?, disabled? }` | — | Greeting bubble config; supports `{name}` placeholder |
| `ui.voice` | `{ enabled?: boolean; language?: string; autoStopMs?: number }` | — | Browser dictation on supported Chromium browsers. Transcript fills the draft live, Rover waits for post-speech silence before stopping, and the user manually sends. |
| `pageConfig` | `RoverPageCaptureConfig` | — | Optional per-site page-capture overrides such as `disableAutoScroll`, settle timing, and sparse-tree retry settings |

With site keys (or a valid `rvrsess_*` token), Rover fetches cloud site config via `POST /v2/rover/session/open` (shortcuts + greeting + voice + aiAccess + pageConfig).
If boot config and cloud config define the same field, boot config takes precedence.
`deepLink` remains boot/runtime only and is not stored in cloud site config.

For AI and CLI-triggered entrypoints, prefer exact shortcut IDs for repeatable flows:

```text
https://example.com?rover_shortcut=checkout_flow
```

Use raw prompt deep links for ad hoc tasks:

```text
https://example.com?rover=book%20a%20flight
```

For AI and CLI tools that need structured results back, use the neutral task resource instead of raw deep links:

```http
POST https://agent.rtrvr.ai/v1/tasks
Content-Type: application/json

{ "url": "https://example.com", "prompt": "book a flight" }
```

The returned task URL supports JSON polling, SSE, NDJSON, continuation input, and cancel. Task creation may also return:

- `open`: clean receipt URL for browser attach
- `browserLink`: optional readable alias with visible `?rover=` or `?rover_shortcut=` when it fits the URL budget

The task URL remains canonical; receipt links are only a browser handoff layer over that same task.

The discovery marker is optional but recommended:

```html
<script type="application/agent+json">{"task":"https://agent.rtrvr.ai/v1/tasks"}</script>
```

Execution guidance:

- `Prefer: execution=cloud` is the explicit browserless path today
- `Prefer: execution=browser` keeps execution browser-first
- `Prefer: execution=auto` currently prefers browser attach first; delayed cloud auto-promotion is a follow-up robustness phase

Site owners manage install credentials in Workspace:

- `https://rover.rtrvr.ai/workspace`
- `https://www.rtrvr.ai/rover/workspace`

### Rover V2 Runtime APIs

Runtime base is `https://agent.rtrvr.ai/v2/rover/*`.

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/session/open` | Bootstrap/refresh runtime session and initial projection |
| `POST` | `/command` | Authoritative command uplink (`RUN_INPUT`, `RUN_CONTROL`, `TAB_EVENT`, `ASK_USER_ANSWER`) |
| `GET` | `/stream` | SSE projection stream |
| `GET` | `/state` | Projection polling fallback/resync |
| `POST` | `/snapshot` | Compacted boundary snapshot/checkpoint upsert |
| `POST` | `/context/external` | External context/action bridge |
| `POST` | `/telemetry/ingest` | Runtime telemetry ingestion |

Runtime semantics:

- Server authority key is `sessionId + runId + epoch + seq`.
- `taskRouting.mode` maps to `requestedMode` in `POST /command` payloads with `type='RUN_INPUT'`.
- `taskRouting.plannerOnActError` applies only in `auto` mode, and planner fallback is not triggered after usable ACT success.
- Typed conflicts: `409 stale_seq`, `409 stale_epoch`, `409 active_run_exists`.
- `POST /command` stale/missing run is non-fatal for tab navigation decisions (`decision='stale_run'`).
- `GET /state` is metadata-first by default (`includeSnapshot=false`). Use `includeSnapshot=true` only when full checkpoint payload is required.
- Projection payloads expose `snapshotMeta` (`updatedAt`, `digest`) for lightweight change detection. Full `snapshot` is sent at bootstrap and selective resync points.
- Cross-registrable navigation preflight is resilient: when `POST /command` tab decision checks are unavailable, Rover falls back to local policy (in-scope targets follow `navigation.crossHostPolicy`, default `same_tab`; out-of-scope targets follow `externalNavigationPolicy`).
- External intent routing: `/context/external` uses `read_context` (read/navigation-context prompts) or `act` (mutation prompts). Navigation-only external opens are represented by `POST /command` with `type='TAB_EVENT'` plus external placeholder tab handling.
- Any normal user send starts a fresh task boundary (fresh `prevSteps`, fresh run-scoped tab order/scope).
- `ask_user` answer submissions are the only continuation path and keep the same task boundary.
- `task.followup` is operative heuristic carryover for chat cues only (`user` + `model` summary pair); it never carries previous task state/tab scope.
- `task.autoResumePolicy` is enforced at runtime: `auto` resumes immediately, `confirm` shows Resume/Cancel, `never` cancels pending interrupted run.
- Resume blocked/declined/never transitions local task state to `cancelled`, clears local running indicators, and enqueues backend run cancel repair (`RUN_CONTROL cancel`) unless a live remote controller owns the run.
- Projection sync will not rehydrate ignored local run IDs; ignored projected active runs trigger cancel repair retry.
- Same-domain/subdomain live-controller handoff remains seamless: observer/reopened tabs do not force-cancel runs owned by an active controller tab.
- Browser runtime path is legacy-free: no checkpoint calls to `roverSessionCheckpointGet/Upsert`.

### Client Tools

| Option | Type | Default | Description |
|---|---|---|---|
| `tools.client` | `ClientToolDefinition[]` | `[]` | Runtime-registered client tools available to Rover |

---

## Events

Subscribe with `rover.on(event, handler)`. The returned function unsubscribes.

```javascript
const off = rover.on('ready', () => {
  console.log('Rover is ready');
});

// Later:
off(); // unsubscribe
```

| Event | Payload | Description |
|---|---|---|
| `ready` | — | SDK initialized, worker connected |
| `updated` | `config` | Configuration updated via `update()` |
| `status` | `{ stage, compactThought }` | Execution progress. Stages: `analyze`, `route`, `execute`, `verify`, `complete` |
| `tool_start` | `{ name, args }` | Agent started executing a tool |
| `tool_result` | `{ name, result }` | Tool execution completed |
| `error` | `{ message, code? }` | Runtime error |
| `auth_required` | `{ code, missing, message }` | Authentication needed |
| `navigation_guardrail` | `{ url, policy }` | Out-of-scope navigation intercepted |
| `mode_change` | `{ mode }` | Switched between `controller` and `observer` |
| `task_started` | `{ reason }` | New task started |
| `task_ended` | `{ reason }` | Task ended |
| `context_restored` | — | Session restored from checkpoint |
| `checkpoint_state` | `{ state, reason?, action?, code?, message? }` | Checkpoint sync state updates |
| `checkpoint_error` | `{ action, code?, message, ... }` | Checkpoint request failure details |
| `tab_event_conflict_retry` | `{ runId, conflict?, ... }` | A stale seq/epoch tab-event conflict was recovered by one silent retry |
| `tab_event_conflict_exhausted` | `{ runId, conflict?, ... }` | Tab-event stale conflict retry was exhausted (non-fatal; projection sync path) |
| `checkpoint_token_missing` | `{ action, status }` | Legacy checkpoint browser path was blocked |
| `open` | — | Panel opened |
| `close` | — | Panel closed |

---

## Multi-Tab Behavior

- Tabs/windows on the same site share one Rover conversation when `sessionScope: 'shared_site'`.
- Only one runtime holds the action lease (controller) at a time.
- Other tabs stay in observer mode and mirror chat and execution progress.
- Worker context (`history`, `plannerPrevSteps`, `agentPrevSteps`) is mirrored for controller handoff.
- `open_new_tab` and `switch_tab` actions manage logical tab records; `switch_tab` routes control by logical tab ID.
- By default, Rover syncs a throttled cloud checkpoint for crash recovery and cross-subdomain restore (`checkpointing.enabled !== false`).

---

## Task Context Behavior

- Every normal `send` call starts a fresh task boundary in Rover v2.
- `ask_user` answer submission is the only case that continues the existing task boundary.
- Follow-up continuity is chat-cue only: `task.followup.*` can attach prior task intent/output heuristically (TTL + lexical overlap), but does not carry `prevSteps` or tab scope.
- `newTask` clears conversation/timeline and worker context, starting a fresh task boundary.
- `endTask` closes the current task without destroying the widget session.

---

## Missing Auth Contract

When authentication is missing or invalid, Rover emits an `auth_required` event:

```json
{
  "success": false,
  "code": "MISSING_BOOTSTRAP_TOKEN",
  "message": "...",
  "requires_api_key": true,
  "missing": ["publicKey"],
  "next_action": "Provide publicKey in rover.boot(...) or a valid rvrsess_* sessionToken."
}
```

---

## Troubleshooting

### Widget doesn't appear
- **CSP errors in console?** Add the required CSP directives from the [CSP section](#content-security-policy-csp).
- **Domain not allowed?** Check that the current hostname is in `allowedDomains`. With `domainScopeMode: 'registrable_domain'`, `app.example.com` matches an `example.com` entry, but `*.example.com` does not match the apex `example.com`, and `app.example.com` does not automatically match sibling hosts like `www.example.com`.
- **No site key?** Rover requires a valid `publicKey` (`pk_site_*`). Generate one in the [Workspace](https://rover.rtrvr.ai/workspace).

### Worker fails to start
- Check for `worker-src` or `script-src` CSP errors in the browser console.
- Ensure `blob:` is included in both `script-src` and `worker-src` directives.
- For strict CSP: self-host the worker and set `workerUrl` in your config.

### Fonts look wrong
- CSP may be blocking `font-src https://rover.rtrvr.ai`. Add this directive, or self-host the font.

### API errors / "Failed to fetch"
- Add `connect-src https://agent.rtrvr.ai` to your CSP.

### Auth errors
- Ensure `publicKey` is present and valid in the boot config.
- Check that the key is active in the [Workspace](https://rover.rtrvr.ai/workspace).
- If using `siteKeyId`, ensure it matches the key ID from Workspace.

### No credits remaining
- Rover emits an `auth_required` event when credits are exhausted.
- Check your balance in the [Workspace](https://rover.rtrvr.ai/workspace).
- Upgrade your plan or wait for renewal at [rtrvr.ai](https://www.rtrvr.ai/cloud?view=pricing).
