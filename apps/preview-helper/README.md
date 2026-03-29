# Rover Preview Helper

Open-source Chrome extension for injecting Rover into the current tab and keeping it alive across reloads or navigation.

Before you use this helper on arbitrary websites, get your config from Workspace.

- Workspace gives you the real test config JSON.
- Hosted Preview gives you temporary preview handoff params.
- This helper supports both.

## Path matrix

| Path | What you need | Best for | Persistence |
|---|---|---|---|
| Hosted Preview | Signed-in URL + prompt | Rover-managed demos | Temporary preview session |
| Preview Helper | Workspace test config JSON or hosted handoff | Multi-page desktop demos | Re-injects after reload/navigation |
| Console | Workspace test config JSON + generated snippet | Fast DevTools demos | Current page only |
| Bookmarklet | Workspace test config JSON + generated bookmarklet | Drag-and-click demos | Current page only |
| Production install | Workspace install snippet | Real site install | Persistent |

## The two supported input modes

### 1. Generic Workspace config

Use this when you want to test Rover on some other website with your own real site config.

Required:

- `siteId`
- either `publicKey` or `sessionToken`

Typical Workspace JSON:

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

This now works with `publicKey` directly. It is not limited to `sessionToken` anymore.

### 2. Hosted preview handoff

Use this when you start from the Rover website's Hosted Preview flow.

The helper can auto-hydrate from URL params:

- `rover_preview_id`
- `rover_preview_token`
- `rover_preview_api`

You do not need to paste JSON for that path.

## Build and load

From the `rover` repo root:

```bash
pnpm install
pnpm --filter @rover/preview-helper build
```

Then load `apps/preview-helper/dist` as an unpacked Chrome extension.

For local iteration:

```bash
pnpm --filter @rover/preview-helper dev
```

## The clean first-run flow

### Workspace-config testing on other sites

1. Open [Rover Workspace](https://www.rtrvr.ai/rover/workspace).
2. Create or rotate a site key so Workspace reveals the full `pk_site_*` value.
3. Copy the **test config JSON** from the Workspace "Try Rover on Other Sites" card.
4. Open [Try on Other Sites](https://www.rtrvr.ai/rover/instant-preview?tab=try_on_other_sites).
5. Paste the same JSON there and enter the target site URL.
6. Click `Open target with helper`.
7. If Rover does not inject automatically, open the helper popup and paste the same JSON as fallback.

Use `Reconnect preview` after reloads or navigation.

The website tool opens the target page with a private URL fragment:

- `#rover_helper_config=<base64url(JSON)>`

The helper reads that fragment, strips it from the URL, and injects Rover automatically.

### Hosted preview handoff

1. Open [Rover Instant Preview](https://www.rtrvr.ai/rover/instant-preview).
2. Stay on the Hosted Preview tab and create a preview.
3. Choose `Open with helper`.
4. The helper reads the handoff URL params automatically.
5. It fetches the preview config, removes the handoff params from the page URL, injects Rover, and keeps reconnecting across navigation.

## Popup fields

The popup now says **Rover or preview config JSON** on purpose.

That means it accepts either:

- generic Workspace config with `publicKey`
- hosted preview/runtime config with `sessionToken`

The popup is not asking for the production install snippet. It wants JSON only.

## What the helper does

- injects Rover into the active tab from popup JSON config
- auto-hydrates from hosted preview handoff URL params
- refreshes hosted preview state when reconnecting
- re-injects on reload and history navigation
- keeps host scoping tied to the intended target host
- rejects tabs whose host is outside the config's `allowedDomains`

## What it does not do

- it does not create previews by itself
- it does not mint preview tokens or production site keys
- it does not replace Hosted Preview or Workspace

## Reinjection model

- a `document_start` content script signals page readiness
- the background worker decides whether to hydrate hosted preview state or reconnect saved state
- packaged main-world bootstrap code seeds Rover boot config into the page
- the helper re-injects after reloads and history navigation

The helper uses packaged extension scripts and `chrome.scripting.executeScript(...)`. It does not rely on remote bootstrap injection as its only reliability layer.

## Common mistakes

- **Pasting the install snippet instead of JSON**
  The helper wants config JSON, not HTML.
- **Testing on the wrong host**
  If your config says `host_only`, open the exact host in `allowedDomains`.
- **Using preview tokens like production keys**
  Preview tokens are temporary. Workspace keys are persistent.
- **Expecting mobile parity**
  This helper is a desktop Chrome path. Use Hosted Preview on mobile.

## Safe extension points

You can extend this app by:

- changing popup UX and presets
- adding config templates for your own Rover environments
- changing reinjection heuristics
- adding local debug/status views

Be careful not to:

- widen host scoping unintentionally
- persist preview tokens longer than needed
- confuse short-lived preview tokens with persistent Workspace site keys

## Related docs

- Repo root: [../../README.md](../../README.md)
- Try on Other Sites: [../../docs/TRY_ON_OTHER_SITES.md](../../docs/TRY_ON_OTHER_SITES.md)
- Instant Preview architecture: [../../docs/INSTANT_PREVIEW.md](../../docs/INSTANT_PREVIEW.md)
- SDK preview helpers: [../../packages/sdk/README.md](../../packages/sdk/README.md)
- Hosted website walkthrough: [https://www.rtrvr.ai/rover/docs/try-on-other-sites](https://www.rtrvr.ai/rover/docs/try-on-other-sites)
- Hosted preview API docs: [https://www.rtrvr.ai/rover/docs/instant-preview-api](https://www.rtrvr.ai/rover/docs/instant-preview-api)
