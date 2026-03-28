# Rover Preview Helper

Open-source Chrome extension for injecting Rover into the current tab and keeping it alive across reloads or navigation.

This app is meant for two public use cases:

- **Generic Rover injection** from normal Rover boot config
- **Hosted preview handoff** from Rover Instant Preview on the website

It keeps the visible Rover UI inside the target site. It does not replace the Rover runtime or the hosted preview backend.

## What it does

- injects Rover into the active tab from popup JSON config
- auto-hydrates from hosted preview handoff URL params
- refreshes preview config when reconnecting a preview session
- re-injects on reload and history navigation
- keeps host scoping tied to the intended target host

## What it does not do

- it does not create previews by itself
- it does not mint preview tokens or production site keys
- it does not provide a hosted control plane

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

## Two ways to use it

### 1. Hosted preview handoff

Use this when you start from the Rover website playground:

1. Open [Rover Instant Preview](https://www.rtrvr.ai/rover/instant-preview)
2. Sign in and create a preview
3. Choose `Open with helper`
4. The helper reads:
   - `rover_preview_id`
   - `rover_preview_token`
   - `rover_preview_api`
5. The helper fetches the preview config, strips the handoff params from the URL, injects Rover, and reconnects it across navigation

You do not need to paste JSON for this path. The helper can hydrate itself directly from the handoff URL.

Preview tokens are temporary demo credentials, not production site keys.

### 2. Generic config JSON

Use this when you already have Rover config from Workspace or from your own server:

```json
{
  "siteId": "site_123",
  "publicKey": "pk_site_123",
  "sessionToken": "rvrsess_123",
  "siteKeyId": "key_123",
  "allowedDomains": ["example.com"],
  "domainScopeMode": "host_only",
  "apiBase": "https://agent.rtrvr.ai"
}
```

Paste the config into the popup and click:

- `Inject Rover into this tab`
- `Reconnect preview`

The popup label uses neutral wording because it accepts both Workspace-style Rover config and hosted preview config.

## Get config from Workspace

For a production or generic helper setup:

1. Open [Rover Workspace](https://www.rtrvr.ai/rover/workspace)
2. Create or select a site
3. Copy:
   - `siteId`
   - `publicKey`
   - optional `siteKeyId`
4. Confirm:
   - `allowedDomains`
   - `domainScopeMode`
5. Either use the generated install snippet directly or map those values into helper JSON

## Popup config reference

Required for generic injection:

- `siteId`
- either `publicKey` or `sessionToken`

Useful optional fields:

- `siteKeyId`
- `apiBase`
- `allowedDomains`
- `domainScopeMode`
- `targetUrl`
- `launchUrl`
- `requestId`
- `attachToken`
- `embedScriptUrl`

Preview-specific optional fields:

- `previewId`
- `previewToken`

If `previewId` and `previewToken` are present, the helper can refresh preview state from the hosted API during reconnect.

## How reinjection works

- a `document_start` content script signals page readiness
- the background worker decides whether to hydrate preview state or reconnect saved state
- packaged main-world code seeds Rover boot config into the page
- the helper re-injects after reloads and history navigation

The helper uses packaged extension scripts plus `chrome.scripting.executeScript(...)`, not remote code injection as its reliability layer.

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

## Related links

- Repo root: [https://github.com/rtrvr-ai/rover](https://github.com/rtrvr-ai/rover)
- SDK preview helpers: [packages/sdk/README.md](../../packages/sdk/README.md)
- Instant Preview architecture: [docs/INSTANT_PREVIEW.md](../../docs/INSTANT_PREVIEW.md)
- Hosted playground: [https://www.rtrvr.ai/rover/instant-preview](https://www.rtrvr.ai/rover/instant-preview)
- Hosted preview API docs: [https://www.rtrvr.ai/rover/docs/instant-preview-api](https://www.rtrvr.ai/rover/docs/instant-preview-api)
- Hosted preview OpenAPI spec: [https://raw.githubusercontent.com/rtrvr-ai/rtrvr-cloud-backend/main/docs/rover-instant-preview.openapi.yaml](https://raw.githubusercontent.com/rtrvr-ai/rtrvr-cloud-backend/main/docs/rover-instant-preview.openapi.yaml)
- Workspace: [https://www.rtrvr.ai/rover/workspace](https://www.rtrvr.ai/rover/workspace)
