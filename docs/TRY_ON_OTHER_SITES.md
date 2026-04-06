# Try on Other Sites

Before you try Rover on other sites, start with Rover's reusable test config unless you specifically need exact site policy.

This is the default path:

1. Sign in to Rover Live Test.
2. Open the `Use reusable test config` path.
3. Rover auto-loads or creates one wildcard tester config for your account.
4. Use the generated script tag when you can edit the target site's code.
5. Use Preview Helper, Bookmarklet, or Console when you want to test without editing the site first.

Use the exact site-scoped Workspace config only when you want to validate the real allowed-domain policy of a specific site key.

This is not the same as Hosted Preview.

- **Try on Other Sites** now defaults to a tester-owned reusable wildcard config.
- **Exact site-scoped config** is the advanced path for validating one real Workspace site key.
- **Hosted Preview** creates a temporary demo record and temporary preview tokens for you.
- **Production install** uses the install snippet on your real site.

## Path matrix

| Path | What you need | Best for | Persistence | Mobile |
|---|---|---|---|---|
| Hosted Preview | Signed-in URL + prompt | Rover-managed demos | Temporary preview session | Best fallback |
| Script tag | Reusable test config or exact site-scoped config + generated snippet | Installing Rover on another site's code | Persistent where installed | Yes |
| Preview Helper | Reusable test config, exact site-scoped config, or hosted handoff | Multi-page desktop demos | Re-injects after reloads/navigation | No |
| Console | Reusable test config or exact site-scoped config + generated snippet | Fast DevTools demos | Current page only | No |
| Bookmarklet | Reusable test config or exact site-scoped config + generated bookmarklet | Drag-and-click demos | Current page only | Weak |
| Production install | Workspace install snippet | Your real live site | Persistent | Yes |

## Reusable config vs exact site config

- **Reusable test config**: wildcard `allowedDomains: ["*"]`, signed-in tester owned, 90-day TTL, powers script tag plus Preview Helper / Console / Bookmarklet by default.
- **Exact site-scoped config**: real Workspace site key plus real allowed domains, preserved as the advanced validation path.

Both shapes use the same JSON family:

Workspace exports JSON in this family:

```json
{
  "siteId": "site_123",
  "publicKey": "pk_site_123",
  "siteKeyId": "key_123",
  "apiBase": "https://agent.rtrvr.ai",
  "allowedDomains": ["example.com"],
  "domainScopeMode": "registrable_domain",
  "externalNavigationPolicy": "open_new_tab_notice",
  "openOnInit": true,
  "mode": "full",
  "allowActions": true,
  "capabilities": {
    "roverEmbed": true
  }
}
```

Required fields for the generic path:

- `siteId`
- either `publicKey` or `sessionToken`

Common optional fields:

- `siteKeyId`
- `apiBase`
- `allowedDomains`
- `domainScopeMode`
- `externalNavigationPolicy`
- `openOnInit`
- `mode`
- `allowActions`
- `capabilities.roverEmbed`

## Step 1: Choose the config source

### Default: reusable test config

1. Open [https://www.rtrvr.ai/rover/instant-preview?flow=workspace_config](https://www.rtrvr.ai/rover/instant-preview?flow=workspace_config).
2. Sign in.
3. Let Rover auto-load or create the reusable wildcard config.
4. Note the expiry, then use **Renew 90 days** or **Revoke** when needed.

### Advanced: exact site-scoped Workspace config

Open one of:

- [https://www.rtrvr.ai/rover/workspace](https://www.rtrvr.ai/rover/workspace)
- [https://rover.rtrvr.ai/workspace](https://rover.rtrvr.ai/workspace)

Then:

1. Create or rotate a Rover site key.
2. In the setup view, find **Try Rover on Other Sites**.
3. Click **Copy exact config JSON**.
4. Optionally click **Open Live Test with exact config** to open the website tool with that JSON prefilled.

Why create or rotate?

Workspace only shows the full public `pk_site_*` value when it is issued. That value is required for the advanced exact site-config path.

## Step 2: Choose the right path

### Script tag

Use this for:

- installing Rover on another site's code
- persistent cross-page testing when you can edit the site
- the closest path to a real install without using your production Workspace snippet

How to use it:

1. Generate the script tag from Live Test or the SDK helper.
2. Paste it into the target site's code, template, head, or body.
3. Reload the target site.
4. Rover stays available on later pages because the site now loads Rover directly.

### Preview Helper

Use this for:

- multi-page desktop demos
- reloads and navigation when you do not want to edit the site
- the most reliable live-inject path

How to use it:

1. Load the extension from [apps/preview-helper](../apps/preview-helper/README.md).
2. Open the signed-in website tool at [https://www.rtrvr.ai/rover/instant-preview?flow=workspace_config](https://www.rtrvr.ai/rover/instant-preview?flow=workspace_config).
3. Use the reusable test config by default, or open the advanced exact site-config section if you want to paste the Workspace JSON there.
4. Enter the target site URL in the Preview Helper section.
5. Click **Open target with helper**.
6. If Rover does not inject, paste the fallback helper JSON into the popup and click `Inject Rover into this tab`.
7. Use `Reconnect preview` after reloads or navigation if needed. Generic helper sessions keep re-injecting while later pages still match `allowedDomains`.

The website tool uses a private URL fragment handoff:

- `#rover_helper_payload=<base64url(JSON)>`

That keeps the config out of target-site query params and request logs.

### Console snippet

Use this for:

- quick DevTools demos
- screen-sharing
- debugging current-page behavior

How to use it:

1. Open the target website.
2. Generate the console snippet from the website tool or SDK helper.
3. Open DevTools.
4. Paste the snippet into the Console and press Enter.

Tradeoff:

- full page reloads drop the injected JavaScript

### Bookmarklet

Use this for:

- the “drag this once, click it anywhere” demo moment
- repeated current-page demos

How to use it:

1. Show the bookmarks bar with `Ctrl+Shift+B` or `Cmd+Shift+B`.
2. Generate the bookmarklet from the website tool or SDK helper.
3. Drag the Rover button from Live Test into your bookmarks bar. Do not click it on the Rover page itself.
4. Open the target website.
5. Click the Rover bookmark.

Tradeoff:

- still current-page only
- full reloads need another click
- some sites/browsers block or degrade bookmarklet behavior

## Website tool

The signed-in website tool lives at:

- [https://www.rtrvr.ai/rover/instant-preview?flow=workspace_config](https://www.rtrvr.ai/rover/instant-preview?flow=workspace_config)

It walks through:

1. reusable or exact config selection
2. script-tag install output for sites you can edit
3. Preview Helper / Bookmarklet / Console testing tools for sites you do not want to edit
4. copy or drag the generated artifact
5. read the “Why this may not work” notes before assuming Rover is broken

## SDK helper path

The SDK exports:

- `createRoverConsoleSnippet(...)`
- `createRoverBookmarklet(...)`
- `createRoverScriptTagSnippet(...)`

Docs:

- [packages/sdk/README.md](../packages/sdk/README.md)

Use the same Workspace config values there. The SDK does not create the config for you; Workspace does.

## Preview Helper generic config path

The Preview Helper now supports both:

- generic Workspace config with `publicKey`
- hosted preview/runtime config with `sessionToken`

Docs:

- [apps/preview-helper/README.md](../apps/preview-helper/README.md)

## Troubleshooting

- **“What JSON do I paste?”**
  Use the Workspace test config JSON, not the install snippet and not a random code sample.
- **`This API key is missing capability: roverEmbed`**
  Your selected key is not embed-ready. Go back to Workspace and create or rotate a key with Rover embed enabled, then copy the fresh test config JSON.
- **“The target host is outside allowedDomains.”**
  Fix the site key domain policy in Workspace or test on the right host.
- **“Rover appears but does not take actions.”**
  Your site is probably in `analytics_only`, `safe` mode, or `allowActions: false`.
- **“Open hosted shell does nothing.”**
  That button belongs to Hosted Preview, not this Workspace-config path. If you need Rover-managed fallback, switch to the Hosted Preview branch in Live Test, where Rover shows the hosted browser directly on the page and can also open it full-screen.
- **`React has blocked a javascript: URL`**
  You likely dragged an old Rover bookmarklet that was created before the drag-only fix. Delete it and recreate it from the current Live Test page.
- **“Bookmarklet worked, then stopped after navigation.”**
  That is expected on full reloads. Use the Preview Helper for sticky no-code desktop testing, or use the script tag if you can edit the target site.
- **“Console snippet pasted but Rover still did not attach.”**
  Some sites block injection with strict CSP rules. Try the Preview Helper or Hosted Preview instead.
- **“Mobile feels broken.”**
  Use Hosted Preview on mobile. Generic Helper / Console / Bookmarklet flows are desktop-first.

## Related docs

- [Instant Preview](./INSTANT_PREVIEW.md)
- [Preview Helper](../apps/preview-helper/README.md)
- [SDK README](../packages/sdk/README.md)
- Hosted website docs: [https://www.rtrvr.ai/rover/docs/try-on-other-sites](https://www.rtrvr.ai/rover/docs/try-on-other-sites)
- Hosted preview API docs: [https://www.rtrvr.ai/rover/docs/instant-preview-api](https://www.rtrvr.ai/rover/docs/instant-preview-api)
