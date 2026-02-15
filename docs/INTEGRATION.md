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
<script>
  (function(){
    var r = window.rover = window.rover || function(){
      (r.q = r.q || []).push(arguments);
    };
    r.l = +new Date();
  })();

  rover('boot', {
    siteId: 'YOUR_SITE_ID',
    apiKey: 'YOUR_API_KEY',
    allowedDomains: ['yourdomain.com'],
  });
</script>
<script src="https://rover.rtrvr.ai/embed.js" async></script>
```

Get your `siteId` and `apiKey` from the [Rover Workspace](https://rover.rtrvr.ai/workspace).

### Single Script Tag (Data Attributes)

For the simplest integration, use data attributes — no inline JavaScript needed:

```html
<script src="https://rover.rtrvr.ai/embed.js"
  data-site-id="YOUR_SITE_ID"
  data-api-key="YOUR_API_KEY"
  data-allowed-domains="yourdomain.com,app.yourdomain.com">
</script>
```

Supported data attributes: `data-site-id`, `data-api-key`, `data-allowed-domains` (comma-separated), `data-site-key-id`, `data-worker-url`.

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
  apiKey: 'YOUR_API_KEY',
  allowedDomains: ['yourdomain.com'],
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
      apiKey: 'YOUR_API_KEY',
      allowedDomains: ['yourdomain.com'],
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
    apiKey: 'YOUR_API_KEY',
    allowedDomains: ['yourdomain.com'],
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
    apiKey: 'YOUR_API_KEY',
    allowedDomains: ['yourdomain.com'],
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
      apiKey: 'YOUR_API_KEY',
      allowedDomains: ['<?php echo esc_js($_SERVER["HTTP_HOST"]); ?>'],
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
| `connect-src` | `https://extensionrouter.rtrvr.ai` | API calls for task execution, authentication, and checkpointing. |
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
  connect-src 'self' https://extensionrouter.rtrvr.ai;
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
    apiKey: 'YOUR_API_KEY',
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

### Core Auth & Identity

| Option | Type | Default | Description |
|---|---|---|---|
| `siteId` | `string` | *required* | Site identifier from Workspace |
| `apiKey` | `string` | — | Rover key from Workspace |
| `siteKeyId` | `string` | — | Site key ID from Workspace |
| `authToken` | `string` | — | Optional bearer token override for runtime API calls (takes precedence over `apiKey` when both are set) |
| `auth.enableSessionJwt` | `boolean` | `false` | Enable session JWT auth flow |
| `auth.sessionJwtEndpoint` | `string` | — | Endpoint used to refresh session JWT |
| `auth.refreshSkewSec` | `number` | — | Early refresh skew (seconds) before JWT expiry |
| `visitorId` | `string` | auto | Stable visitor identifier |
| `visitor` | `{ name?: string; email?: string }` | — | Optional visitor profile for greeting personalization. Recommended flow is async updates via `identify(...)` after login/user hydration. |
| `sessionId` | `string` | auto | Explicit session ID |
| `sessionScope` | `'shared_site' \| 'tab'` | `'shared_site'` | Shared cross-tab session or tab-isolated session |
| `mode` | `'full' \| 'safe'` | `'full'` | Runtime mode |
| `apiBase` | `string` | `https://extensionrouter.rtrvr.ai` | Custom API base URL. Workspace snippets keep the managed default; code integrations can pass custom domains directly (no `/extensionRouter` suffix required). |
| `workerUrl` | `string` | auto | Custom worker URL (self-hosting) |

### Domain Guardrails & Navigation

| Option | Type | Default | Description |
|---|---|---|---|
| `allowedDomains` | `string[]` | `[]` | Hostnames where Rover may operate |
| `domainScopeMode` | `'registrable_domain' \| 'host_only'` | `'registrable_domain'` | Domain matching strategy |
| `externalNavigationPolicy` | `'open_new_tab_notice' \| 'block' \| 'allow'` | `'open_new_tab_notice'` | External navigation policy |
| `openOnInit` | `boolean` | `false` | Open panel after boot |
| `allowActions` | `boolean` | `true` | Enable/disable action tools |
| `tabPolicy.observerByDefault` | `boolean` | `true` | Observer preference for shared tab sessions |
| `tabPolicy.actionLeaseMs` | `number` | coordinator default | Controller action lease duration |

### Task Routing

| Option | Type | Default | Description |
|---|---|---|---|
| `taskRouting.mode` | `'auto' \| 'act' \| 'planner'` | `'act'` | Task routing mode |
| `taskRouting.actHeuristicThreshold` | `number` | `5` (auto mode) | Complexity threshold for auto-routing |
| `taskRouting.plannerOnActError` | `boolean` | `true` | Retry with planner when ACT fails |

### Task Context

| Option | Type | Default | Description |
|---|---|---|---|
| `taskContext.resetMode` | `'auto' \| 'ask' \| 'off'` | `'auto'` | Advisory task reset behavior |
| `taskContext.inactivityMs` | `number` | — | Optional inactivity hint for continuity logic |
| `taskContext.suggestReset` | `boolean` | `true` | Allow reset suggestions when continuity is unclear |
| `taskContext.semanticSimilarityThreshold` | `number` | — | Optional similarity hint for continuity scoring |

### Checkpointing

| Option | Type | Default | Description |
|---|---|---|---|
| `checkpointing.enabled` | `boolean` | `false` | Enable cloud checkpoint sync |
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
| `apiMode` | `boolean` | auto (`true` when `apiKey` is set) | Force API execution mode |
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
| `ui.muted` | `boolean` | `false` | Start with media muted |
| `ui.thoughtStyle` | `'concise_cards' \| 'minimal'` | `'concise_cards'` | Thought rendering preference |
| `ui.panel.resizable` | `boolean` | `true` | Panel resize preference |
| `ui.showTaskControls` | `boolean` | `true` | Show new/end task controls |
| `ui.shortcuts` | `RoverShortcut[]` | `[]` | Suggested journeys (max 100 stored, max 12 rendered by default; lower site-key policy caps are enforced) |
| `ui.greeting` | `{ text?, delay?, duration?, disabled? }` | — | Greeting bubble config; supports `{name}` placeholder |

With site keys, Rover also fetches cloud site config using `roverGetSiteConfig` (shortcuts + greeting).  
If boot config and cloud config define the same field, boot config takes precedence.

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
| `open` | — | Panel opened |
| `close` | — | Panel closed |

---

## Multi-Tab Behavior

- Tabs/windows on the same site share one Rover conversation when `sessionScope: 'shared_site'`.
- Only one runtime holds the action lease (controller) at a time.
- Other tabs stay in observer mode and mirror chat and execution progress.
- Worker context (`history`, `plannerPrevSteps`, `agentPrevSteps`) is mirrored for controller handoff.
- `open_new_tab` and `switch_tab` actions manage logical tab records; `switch_tab` routes control by logical tab ID.
- With `checkpointing.enabled`, Rover syncs a throttled cloud checkpoint for crash recovery and cross-subdomain restore.

---

## Task Context Behavior

- Rover keeps task context by default within a session.
- When inactivity combined with semantic shift suggests a new intent, Rover shows a "Start new" vs "Continue" prompt (no extra LLM call — purely local heuristic).
- `newTask` clears conversation/timeline and worker context, starting a fresh task boundary.
- `endTask` closes the current task without destroying the widget session.

---

## Missing Auth Contract

When authentication is missing or invalid, Rover emits an `auth_required` event:

```json
{
  "success": false,
  "code": "MISSING_API_KEY",
  "message": "...",
  "requires_api_key": true,
  "missing": ["apiKey"],
  "next_action": "Provide apiKey in rover.boot(...) or an Authorization Bearer token."
}
```

---

## Troubleshooting

### Widget doesn't appear
- **CSP errors in console?** Add the required CSP directives from the [CSP section](#content-security-policy-csp).
- **Domain not allowed?** Check that the current hostname is in `allowedDomains`. With `domainScopeMode: 'registrable_domain'`, `app.example.com` matches an `example.com` entry.
- **No API key?** Rover requires a valid `apiKey`. Generate one in the [Workspace](https://rover.rtrvr.ai/workspace).

### Worker fails to start
- Check for `worker-src` or `script-src` CSP errors in the browser console.
- Ensure `blob:` is included in both `script-src` and `worker-src` directives.
- For strict CSP: self-host the worker and set `workerUrl` in your config.

### Fonts look wrong
- CSP may be blocking `font-src https://rover.rtrvr.ai`. Add this directive, or self-host the font.

### API errors / "Failed to fetch"
- Add `connect-src https://extensionrouter.rtrvr.ai` to your CSP.

### Auth errors
- Ensure `apiKey` is present and valid in the boot config.
- Check that the key is active in the [Workspace](https://rover.rtrvr.ai/workspace).
- If using `siteKeyId`, ensure it matches the key ID from Workspace.

### No credits remaining
- Rover emits an `auth_required` event when credits are exhausted.
- Check your balance in the [Workspace](https://rover.rtrvr.ai/workspace).
- Upgrade your plan or wait for renewal at [rtrvr.ai](https://www.rtrvr.ai/cloud?view=pricing).
