# @rtrvr-ai/rover

Rover is a DOM-native embedded web agent that lives inside your website. Unlike traditional chat widgets that run in iframes, Rover reads the actual DOM and executes actions directly in the user's browser — enabling real task completion, not just conversation.

## Prerequisites

You need an rtrvr.ai account with available credits. Free accounts get 250 credits/month. [Sign up or manage your plan](https://www.rtrvr.ai/cloud?view=pricing).

## Quick Start (Script Tag)

Add this snippet before `</body>` on any page:

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

Or use the single-tag shorthand with data attributes:

```html
<script src="https://rover.rtrvr.ai/embed.js"
  data-site-id="YOUR_SITE_ID"
  data-api-key="YOUR_API_KEY"
  data-allowed-domains="yourdomain.com">
</script>
```

## npm Install

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

| Option | Type | Default | Description |
|---|---|---|---|
| `siteId` | `string` | *required* | Site identifier |
| `apiKey` | `string` | — | API key from Rover Workspace |
| `siteKeyId` | `string` | — | Site key ID from Workspace |
| `authToken` | `string` | — | Optional bearer token override (takes precedence over `apiKey` when both are set) |
| `visitor` | `{ name?: string; email?: string }` | — | Optional visitor profile used for greeting personalization |
| `apiBase` | `string` | `https://extensionrouter.rtrvr.ai` | Optional API base override. For custom domain routing you can pass the base directly (no `/extensionRouter` suffix required). |
| `allowedDomains` | `string[]` | `[]` | Hostnames where Rover may operate |
| `domainScopeMode` | `'registrable_domain' \| 'host_only'` | `'registrable_domain'` | Domain matching strategy |
| `externalNavigationPolicy` | `'open_new_tab_notice' \| 'block' \| 'allow'` | `'open_new_tab_notice'` | External navigation policy |
| `mode` | `'full' \| 'safe'` | `'full'` | Runtime mode |
| `allowActions` | `boolean` | `true` | Enable or disable action tools |
| `openOnInit` | `boolean` | `false` | Open panel immediately on boot |
| `sessionScope` | `'shared_site' \| 'tab'` | `'shared_site'` | Session sharing across tabs |
| `taskRouting.mode` | `'auto' \| 'act' \| 'planner'` | `'act'` | Task routing strategy |
| `taskRouting.plannerOnActError` | `boolean` | `true` | Retry planner when ACT fails |
| `taskRouting.actHeuristicThreshold` | `number` | `5` (auto mode) | Auto-routing threshold |
| `checkpointing.enabled` | `boolean` | `false` | Enable cloud checkpoint sync |
| `checkpointing.autoVisitorId` | `boolean` | `true` | Auto-generate visitor ID when needed |
| `checkpointing.ttlHours` | `number` | `1` | Checkpoint TTL in hours |
| `checkpointing.onStateChange` | `(payload) => void` | — | Checkpoint lifecycle updates (`active`, `paused_auth`) |
| `checkpointing.onError` | `(payload) => void` | — | Checkpoint request error callback |
| `telemetry.enabled` | `boolean` | `true` | Enable runtime telemetry batching |
| `telemetry.sampleRate` | `number` | `1` | Event sampling ratio (0..1) |
| `telemetry.flushIntervalMs` | `number` | `12000` | Telemetry flush cadence |
| `telemetry.maxBatchSize` | `number` | `30` | Max events per telemetry request |
| `telemetry.includePayloads` | `boolean` | `false` | Include richer event payloads |
| `apiMode` | `boolean` | auto (`true` when `apiKey` exists) | Force API execution mode |
| `apiToolsConfig.mode` | `'allowlist' \| 'profile' \| 'none'` | `'none'` | API additional tool exposure mode |
| `tools.web.enableExternalWebContext` | `boolean` | `false` | External tab cloud context fallback |
| `tools.web.scrapeMode` | `'off' \| 'on_demand'` | `'off'` | On-demand external tab scrape mode |
| `tools.web.allowDomains` | `string[]` | `[]` | External context allowlist |
| `tools.web.denyDomains` | `string[]` | `[]` | External context denylist |
| `tools.client` | `ClientToolDefinition[]` | `[]` | Runtime-registered client tools |
| `workerUrl` | `string` | auto | Custom worker URL for self-hosting |
| `ui.agent.name` | `string` | `'Rover'` | Custom assistant name |
| `ui.mascot.disabled` | `boolean` | `false` | Disable mascot video |
| `ui.mascot.mp4Url` | `string` | default | Custom mascot MP4 URL |
| `ui.mascot.webmUrl` | `string` | default | Custom mascot WebM URL |
| `ui.muted` | `boolean` | `false` | Start with audio muted |
| `ui.thoughtStyle` | `'concise_cards' \| 'minimal'` | `'concise_cards'` | Thought rendering style |
| `ui.panel.resizable` | `boolean` | `true` | Panel resizable preference |
| `ui.showTaskControls` | `boolean` | `true` | Show new/end task controls |
| `ui.shortcuts` | `RoverShortcut[]` | `[]` | Suggested journeys (max 100 stored, max 12 rendered by default; lower site-key policy caps are enforced) |
| `ui.greeting` | `{ text?, delay?, duration?, disabled? }` | — | Greeting bubble config (`{name}` token supported) |

When a site key is used, Rover also fetches cloud site config via `roverGetSiteConfig` (shortcuts + greeting).  
If the same field exists in both cloud config and boot config, boot config wins.

If you enable `tools.web.scrapeMode: 'on_demand'`, use a site key capability profile that includes cloud scrape support.

See [full configuration reference](https://github.com/rtrvr-ai/rover/blob/main/docs/INTEGRATION.md#configuration-reference).

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

## Content Security Policy (CSP)

If your site sets a CSP header, add these directives:

| Directive | Value | Why |
|---|---|---|
| `script-src` | `https://rover.rtrvr.ai blob:` | SDK script + Web Worker blob |
| `worker-src` | `blob: https://rover.rtrvr.ai` | Web Worker execution |
| `connect-src` | `https://extensionrouter.rtrvr.ai` | API calls |
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
  apiKey: 'YOUR_API_KEY',
  workerUrl: '/assets/rover-worker.js',
});
```

Load your self-hosted `embed.js` instead of the CDN version:

```html
<script src="/assets/embed.js" async></script>
```

## Links

- [Integration Guide](https://github.com/rtrvr-ai/rover/blob/main/docs/INTEGRATION.md)
- [Rover Workspace](https://rover.rtrvr.ai/workspace) — generate site keys and install snippets
- [Website](https://www.rtrvr.ai/rover)
