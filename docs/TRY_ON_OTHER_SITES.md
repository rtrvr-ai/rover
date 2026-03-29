# Try on Other Sites

Before you try Rover on other sites, get your site config from Workspace.

This is the clean path:

1. Open Rover Workspace.
2. Create or rotate a Rover site key so Workspace reveals the full `pk_site_*` value.
3. Copy the **test config JSON** from the Workspace "Try Rover on Other Sites" card.
4. Paste that JSON into the Rover website tool or the Preview Helper.
5. Choose Helper, Console, or Bookmarklet.

This is not the same as Hosted Preview.

- **Try on Other Sites** uses your real Workspace config.
- **Hosted Preview** creates a temporary demo record and temporary preview tokens for you.
- **Production install** uses the install snippet on your real site.

## Path matrix

| Path | What you need | Best for | Persistence | Mobile |
|---|---|---|---|---|
| Hosted Preview | Signed-in URL + prompt | Rover-managed demos | Temporary preview session | Best fallback |
| Preview Helper | Workspace test config JSON or hosted handoff | Multi-page desktop demos | Re-injects after reloads/navigation | No |
| Console | Workspace test config JSON + generated snippet | Fast DevTools demos | Current page only | No |
| Bookmarklet | Workspace test config JSON + generated bookmarklet | Drag-and-click demos | Current page only | Weak |
| Production install | Workspace install snippet | Your real live site | Persistent | Yes |

## The exact config shape

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
  "allowActions": true
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

## Step 1: Get the config from Workspace

Open one of:

- [https://www.rtrvr.ai/rover/workspace](https://www.rtrvr.ai/rover/workspace)
- [https://rover.rtrvr.ai/workspace](https://rover.rtrvr.ai/workspace)

Then:

1. Create or rotate a Rover site key.
2. In the setup view, find **Try Rover on Other Sites**.
3. Click **Copy test config JSON**.
4. Optionally click **Open Try on Other Sites** to open the website tool with the config prefilled.

Why create or rotate?

Workspace only shows the full public `pk_site_*` value when it is issued. That value is required for the generic Helper / Console / Bookmarklet path.

## Step 2: Choose the right testing method

### Preview Helper

Use this for:

- multi-page desktop demos
- reloads and navigation
- the most reliable live-inject path

How to use it:

1. Load the extension from [apps/preview-helper](../apps/preview-helper/README.md).
2. Open the signed-in website tool at [https://www.rtrvr.ai/rover/instant-preview?tab=try_on_other_sites](https://www.rtrvr.ai/rover/instant-preview?tab=try_on_other_sites).
3. Paste the same Workspace test config JSON there.
4. Enter the target site URL.
5. Click **Open target with helper**.
6. If Rover does not inject, paste the fallback helper JSON into the popup and click `Inject Rover into this tab`.
7. Use `Reconnect preview` after reloads or navigation if needed.

The website tool uses a private URL fragment handoff:

- `#rover_helper_config=<base64url(JSON)>`

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
3. Drag the Rover button into your bookmarks bar.
4. Open the target website.
5. Click the Rover bookmark.

Tradeoff:

- still current-page only
- full reloads need another click
- some sites/browsers block or degrade bookmarklet behavior

## Website tool

The signed-in website tool lives at:

- [https://www.rtrvr.ai/rover/instant-preview?tab=try_on_other_sites](https://www.rtrvr.ai/rover/instant-preview?tab=try_on_other_sites)

It walks through:

1. paste test config JSON
2. enter target URL
3. choose Helper / Console / Bookmarklet
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
- **“The target host is outside allowedDomains.”**
  Fix the site key domain policy in Workspace or test on the right host.
- **“Rover appears but does not take actions.”**
  Your site is probably in `analytics_only`, `safe` mode, or `allowActions: false`.
- **“Bookmarklet worked, then stopped after navigation.”**
  That is expected on full reloads. Use the Preview Helper for multi-page demos.
- **“Mobile feels broken.”**
  Use Hosted Preview on mobile. Generic Helper / Console / Bookmarklet flows are desktop-first.

## Related docs

- [Instant Preview](./INSTANT_PREVIEW.md)
- [Preview Helper](../apps/preview-helper/README.md)
- [SDK README](../packages/sdk/README.md)
- Hosted website docs: [https://www.rtrvr.ai/rover/docs/try-on-other-sites](https://www.rtrvr.ai/rover/docs/try-on-other-sites)
- Hosted preview API docs: [https://www.rtrvr.ai/rover/docs/instant-preview-api](https://www.rtrvr.ai/rover/docs/instant-preview-api)
