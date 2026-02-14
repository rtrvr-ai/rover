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
| `siteId` | `string` | *required* | Your site identifier |
| `apiKey` | `string` | *required* | API key from Rover Workspace |
| `allowedDomains` | `string[]` | `[]` | Hostnames where Rover may operate |
| `domainScopeMode` | `'registrable_domain' \| 'host_only'` | `'registrable_domain'` | Domain matching strategy |
| `openOnInit` | `boolean` | `false` | Open panel immediately on boot |
| `taskRouting` | `object` | `{ mode: 'act' }` | Task routing strategy |
| `externalNavigationPolicy` | `string` | `'open_new_tab_notice'` | Policy for out-of-scope links |
| `workerUrl` | `string` | auto | Custom worker URL for self-hosting |
| `ui.muted` | `boolean` | `false` | Start with audio muted (user can toggle via UI) |
| `ui.mascot.disabled` | `boolean` | `false` | Disable mascot video (removes `media-src` CSP need) |
| `visitorId` | `string` | auto | Stable visitor identifier |
| `sessionScope` | `'shared_site' \| 'tab'` | `'shared_site'` | Session sharing across tabs |

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

## Content Security Policy (CSP)

If your site sets a CSP header, add these directives:

| Directive | Value | Why |
|---|---|---|
| `script-src` | `https://rover.rtrvr.ai blob:` | SDK script + Web Worker blob |
| `worker-src` | `blob: https://rover.rtrvr.ai` | Web Worker execution |
| `connect-src` | `https://us-central1-rtrvr-extension-functions.cloudfunctions.net` | API calls |
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
