# Rover Embed Integration

## Script snippet (loader)

```html
<script>
  (function(){
    var rover = window.rover = window.rover || function(){ (rover.q = rover.q || []).push(arguments); };
    rover.l = +new Date();
  })();
</script>
<script src="https://rover.rtrvr.ai/sdk/rover.js"></script>
<script>
  rover('boot', {
    siteId: 'YOUR_SITE_ID',
    apiBase: 'https://rover.rtrvr.ai',
    workerUrl: 'https://rover.rtrvr.ai/sdk/rover-worker.js',
    apiKey: 'rtrvr_YOUR_API_KEY',
    visitorId: 'your-stable-visitor-id',
    openOnInit: false,
    sessionScope: 'shared_site',
    allowedDomains: ['example.com'],
    domainScopeMode: 'registrable_domain',
    externalNavigationPolicy: 'open_new_tab_notice',
    crossDomainPolicy: 'block_new_tab',
    taskRouting: { mode: 'act', plannerOnActError: true },
    tabPolicy: { observerByDefault: true, actionLeaseMs: 12000 },
    taskContext: {
      inactivityMs: 300000,
      suggestReset: true,
      semanticSimilarityThreshold: 0.18
    },
    checkpointing: {
      enabled: true,
      autoVisitorId: true,
      flushIntervalMs: 7000,
      pullIntervalMs: 9000,
      ttlHours: 24
    }
  });
</script>
```

## Public commands

Rover supports both command style and method style:

- `rover('boot', config)` / `rover.boot(config)`
- `rover('update', partialConfig)` / `rover.update(partialConfig)`
- `rover('shutdown')` / `rover.shutdown()`
- `rover('show')` / `rover.show()`
- `rover('hide')` / `rover.hide()`
- `rover('open')` / `rover.open()` (panel open alias)
- `rover('close')` / `rover.close()` (panel close alias)
- `rover('send', '...')` / `rover.send('...')`
- `rover('newTask', { reason })` / `rover.newTask({ reason })`
- `rover('endTask', { reason })` / `rover.endTask({ reason })`
- `rover('getState')` / `rover.getState()`

Backward compatibility:
- `rover('init', config)` is still supported as an alias for `boot`.

## Multi-tab behavior

- Tabs/windows on the same site share one Rover conversation when `sessionScope: 'shared_site'`.
- Only one runtime holds the action lease (controller) at a time.
- Other tabs stay in observer mode and mirror chat + execution progress.
- Worker context (`history`, `plannerPrevSteps`, `agentPrevSteps`) is mirrored for controller handoff.
- `open_new_tab` (and alias `open_url_new_tab`) create logical tab records; `switch_tab` routes control by logical tab id.
- With `checkpointing.enabled`, Rover also syncs a throttled cloud checkpoint through `extensionRouter` actions `roverSessionCheckpointUpsert` + `roverSessionCheckpointGet` for crash recovery and cross-subdomain restore.

## Task context behavior

- Rover keeps task context by default.
- When inactivity + semantic shift suggests a new intent, Rover shows a `Start new` vs `Continue` prompt (no extra LLM call).
- `newTask` clears conversation/timeline + worker context and starts a fresh task boundary.
- `endTask` closes current task without destroying the widget session.

## Missing auth contract

When auth is missing/invalid, Rover emits an `auth_required` event payload with:

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

## Runtime events (v1 additions)

- `status` now includes:
  - `stage`: `analyze | route | execute | verify | complete`
  - `compactThought`: concise thought string (de-duplicated, max ~120 chars)
- `navigation_guardrail` fires when Rover intercepts out-of-scope traversal.

## CSP
Allow the SDK + worker domains and API base. For strict CSP, self-host the SDK and worker, then point `workerUrl` to your hosted worker file.
