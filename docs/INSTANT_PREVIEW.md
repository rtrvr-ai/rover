# Instant Preview

Rover supports a preview-first workflow where someone can prove Rover on a live page before installing a production snippet.

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

### 2. Hosted preview handoff config

This is the temporary demo path.

The hosted website/backend generates:

- `rover_preview_id`
- `rover_preview_token`
- `rover_preview_api`
- short-lived runtime session token
- preview attach metadata

The Preview Helper can read those handoff URL params directly and hydrate itself automatically. Console snippets and bookmarklets can also be generated from the same preview record.

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
- workspace: [https://www.rtrvr.ai/rover/workspace](https://www.rtrvr.ai/rover/workspace)
- hosted API docs: [https://www.rtrvr.ai/rover/docs/instant-preview-api](https://www.rtrvr.ai/rover/docs/instant-preview-api)
- OpenAPI spec: [https://raw.githubusercontent.com/rtrvr-ai/rtrvr-cloud-backend/main/docs/rover-instant-preview.openapi.yaml](https://raw.githubusercontent.com/rtrvr-ai/rtrvr-cloud-backend/main/docs/rover-instant-preview.openapi.yaml)

Use the website if you want:

- preview creation handled for you
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
