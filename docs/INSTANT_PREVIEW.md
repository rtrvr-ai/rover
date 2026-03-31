# Instant Preview

Rover supports a preview-first workflow where someone can prove Rover on a live page before installing a production snippet.

There are really three paths:

- **Hosted Preview**
- **Try on Other Sites from Workspace config**
- **Production install**

## Path matrix

| Path | What you need | Best for | Persistence | Mobile | Managed by |
|---|---|---|---|---|---|
| Hosted Preview | Signed-in URL + prompt | Rover-managed demos | Temporary preview session | Best fallback | Rover |
| Preview Helper | Workspace test config JSON or hosted handoff | Multi-page desktop demos | Re-injects after reloads/navigation | No | Workspace or Rover |
| Console | Workspace test config JSON + generated snippet | Fast DevTools demos | Current page only | No | Workspace |
| Bookmarklet | Workspace test config JSON + generated bookmarklet | Drag-and-click demos | Current page only | Weak | Workspace |
| Production install | Workspace install snippet | Real site install | Persistent site config | Yes | Workspace |

This flow is intentionally split across two systems:

- **Open-source clients in `rover`**
- **Hosted preview control plane outside `rover`**

## What lives in the open-source repo

This repo owns the browser-facing preview clients:

- `packages/sdk`
  - `createRoverConsoleSnippet(...)`
  - `createRoverBookmarklet(...)`
  - `createRoverScriptTagSnippet(...)`
  - `attachLaunch(...)`
- `apps/preview-helper`
  - MV3 Chrome extension
  - generic JSON-config injection
  - hosted preview handoff URL support
  - reinjection across reloads and history navigation

These are the pieces developers should inspect, extend, fork, and use in their own setups.

## What stays in the hosted backend

Hosted preview creation is not part of this repo in the current architecture.

The hosted Rover backend owns:

- preview creation and lookup
- preview auth and short-lived preview tokens
- runtime session token minting
- exact-host policy enforcement
- live attach and hosted/cloud preview launch orchestration
- preview event streams
- production site-key provisioning and Workspace handoff

Those concerns are server-side, stateful, and currently implemented in `rtrvr-cloud-backend` under `/v2/rover/previews`.

## Two config sources

### 1. Workspace production config

This is the persistent install path for a real site.

From Rover Workspace, copy:

- `siteId`
- `publicKey` (`pk_site_*`)
- optional `siteKeyId`
- `allowedDomains`
- `domainScopeMode`

Use those values for:

- production script-tag installs
- SDK boot config
- generic Preview Helper JSON config
- the website "Try on Other Sites" generator

### 2. Hosted preview handoff config

This is the temporary demo path.

The hosted website/backend generates:

- `rover_preview_id`
- `rover_preview_token`
- `rover_preview_api`
- short-lived runtime session token
- preview attach metadata

The Preview Helper can hydrate from Rover's private helper payload fragment, which carries the same preview identifiers and API base without polluting target-site query params. Legacy query-param handoff still works for compatibility. Console snippets and bookmarklets can also be generated from the same preview record.

For the generic Workspace-config path, the website tool can also open a target page with a helper fragment:

- `#rover_helper_payload=<base64url(JSON)>`

The Preview Helper reads that fragment, strips it from the URL, and injects Rover automatically.

## Hosted Preview vs Try on Other Sites vs Production

### Hosted Preview

Use this when:

- you want Rover to create a temporary preview for you
- you do not want to think about config yet
- you need a mobile-friendly fallback

Hosted Preview lives on the Rover website and is backed by `/v2/rover/previews`.
When you click `Open hosted shell`, Rover should open a dedicated hosted viewer page for the cloud-browser fallback, not the launcher again.

### Try on Other Sites

Use this when:

- you already have a real Workspace site
- you want to test Rover on another website with your own config
- you want explicit Helper / Console / Bookmarklet artifacts

The clean path is:

1. open Workspace
2. create or rotate a site key
3. copy the test config JSON
4. paste it into the website tool or Preview Helper

### Production install

Use this when:

- you are ready to ship Rover on your real site
- you need the actual install snippet
- you want the persistent Workspace-managed key, not a preview token

## Choose the right client

### Console snippet

Best for:

- quick desktop demos
- screen-sharing
- manual debugging

Tradeoff:

- injected JS is lost on full page reload

### Bookmarklet

Best for:

- quick one-click demos
- repeated testing across many sites

Tradeoff:

- same reload limitations as manual injection
- some browsers/sites are stricter about bookmarklet behavior

### Preview Helper extension

Best for:

- multi-page live demos
- reinjection across reload/navigation
- developers who want to inspect and extend the preview workflow

Tradeoff:

- requires loading an unpacked extension locally

## Website playground

The hosted website gives you the easiest way to try the full flow:

- playground: [https://www.rtrvr.ai/rover/instant-preview](https://www.rtrvr.ai/rover/instant-preview)
- try on other sites guide: [https://www.rtrvr.ai/rover/docs/try-on-other-sites](https://www.rtrvr.ai/rover/docs/try-on-other-sites)
- workspace: [https://www.rtrvr.ai/rover/workspace](https://www.rtrvr.ai/rover/workspace)
- hosted API docs: [https://www.rtrvr.ai/rover/docs/instant-preview-api](https://www.rtrvr.ai/rover/docs/instant-preview-api)
- OpenAPI spec: [https://raw.githubusercontent.com/rtrvr-ai/rtrvr-cloud-backend/main/docs/rover-instant-preview.openapi.yaml](https://raw.githubusercontent.com/rtrvr-ai/rtrvr-cloud-backend/main/docs/rover-instant-preview.openapi.yaml)

Use the website if you want:

- preview creation handled for you
- a guided Try on Other Sites generator fed by Workspace config
- hosted fallback when live attach is not ideal
- share links and Workspace conversion

## Hosted preview API

The hosted preview control plane is a signed-in Rover service, not an anonymous public demo endpoint.

Use it when you want:

- a real preview record created for a target URL
- preview tokens and runtime session tokens minted for you
- helper/console/bookmarklet assets returned in one response
- event streaming, follow-up input, cancel, share, and Workspace conversion

Core route family:

- `POST /v2/rover/previews`
- `GET /v2/rover/previews/{previewId}`
- `GET /v2/rover/previews/{previewId}/events`
- `POST /v2/rover/previews/{previewId}/input`
- `POST /v2/rover/previews/{previewId}/cancel`
- `POST /v2/rover/previews/{previewId}/share`
- `GET /v2/rover/previews/{previewId}/bootstrap.js`

Direct references:

- Human docs: [https://www.rtrvr.ai/rover/docs/instant-preview-api](https://www.rtrvr.ai/rover/docs/instant-preview-api)
- Machine-readable spec: [https://raw.githubusercontent.com/rtrvr-ai/rtrvr-cloud-backend/main/docs/rover-instant-preview.openapi.yaml](https://raw.githubusercontent.com/rtrvr-ai/rtrvr-cloud-backend/main/docs/rover-instant-preview.openapi.yaml)

## Manual verification matrix

- **Non-dev operator**: create a preview in the hosted website, try helper/console/bookmarklet, switch to hosted preview if needed, save a share link, then use Workspace conversion.
- **Developer**: load the public Preview Helper, try generic Workspace JSON, then verify helper handoff plus SDK-generated console/bookmarklet/script-tag snippets.
- **AI / programmatic caller**: use the OpenAPI spec and the hosted API docs to create a preview, fetch state, stream events, send input, cancel/share it, and fetch `bootstrap.js`.

## Security notes

- Preview tokens are temporary demo credentials and should be treated as ephemeral.
- Workspace site keys are persistent install credentials for a real Rover site.
- Do not reuse preview tokens as production config.
- Keep helper injection scoped to intended hosts and respect domain policy.

## Troubleshooting

- **`This API key is missing capability: roverEmbed`**
  The Workspace key you copied is not embed-enabled. Rotate or create an embed-ready key in Workspace, then copy the new test config JSON.
- **`Open hosted shell` does nothing**
  Hosted Preview should open the dedicated hosted viewer route on the Rover website. If it does not, recreate the preview and try again.
- **Console or Bookmarklet only worked on the first page**
  That is expected. They are current-page-only methods. Use the Preview Helper for multi-page desktop demos.
- **A site strips or blocks the inject path**
  Some sites enforce strict CSP or reload aggressively. Fall back to Hosted Preview or the Preview Helper.
