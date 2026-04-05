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
Hosted Preview is owned by the signed-in tester who creates it. The temporary runtime session is minted under that tester's `uid`, and Hosted Preview consumes that tester's credits rather than any real Workspace `pk_site_*` on the target website.
When you click `Open hosted shell`, Rover should open a dedicated hosted viewer page for the cloud-browser fallback, not the launcher again.
Under the hood, Hosted Preview now uses a dedicated Rover-managed hosted-browser session. It is not supposed to piggyback on the generic `/internal/agent` request lifecycle.
That hosted browser now boots Rover inside the hosted page itself by injecting the same short-lived preview bootstrap used by the other preview clients, and it should re-inject after top-level navigations or reloads.
Once that hosted page is ready, Rover should auto-run the exact Live Test prompt inside the hosted page. This is meant to feel like a Rover-managed equivalent of `?rover=`, but it does not rely on the target site already being installed.
Hosted Preview has a hard 12-minute maximum aligned with `/agent`. Viewer heartbeats only refresh a short disconnect grace; they do not extend that absolute expiry.
Closing the hosted viewer tab triggers a best-effort close request. If that unload signal is missed, the server-side disconnect grace should still close the hosted session quickly.
That hosted browser still has its own session/state lifecycle, but it now leases from the same shared browser pool as normal automation on that worker.
With `POOL_MAX_INSTANCES=1`, Hosted Preview and `/agent` queue behind whichever side currently holds the browser.
Hosted browser ownership is sticky to one worker. If the owner lease goes stale, Rover should fail closed and ask you to recreate the temporary demo instead of pretending another worker can resume the same browser.
When a hosted session closes, expires, or fails, Rover destroys that browser instead of trying to recycle it for the next request. That is the current safety posture to avoid storage/cookie bleed between hosted preview and normal automation.
Installed-site deep links like `?rover=` remain the real site-owned browser entrypoint. Hosted Preview should stay separate from that site-key and billing context even if the target site already has Rover installed.

### Try on Other Sites

Use this when:

- you want one reusable signed-in test config for Helper / Console / Bookmarklet
- you may still want to validate an exact Workspace site key as an advanced path
- you want explicit Helper / Console / Bookmarklet artifacts

The clean path is:

1. open Live Test on the reusable test-config path
2. let Rover auto-load or create the wildcard tester config
3. enter the target URL
4. choose Helper, Console, or Bookmarklet

Use Workspace Install & Test only when you need the advanced exact site-scoped config path.

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
- a reusable wildcard test config managed for you
- an advanced exact site-config path fed by Workspace Install & Test
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
- `GET /v2/rover/previews/{previewId}` (`touchHostedSession=1` only from the hosted viewer heartbeat path)
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
- **The hosted browser opens but Rover never appears inside the page**
  Hosted Preview should inject the short-lived preview bootstrap into the hosted page and re-inject it after top-level navigations. If the browser opens but Rover never boots, recreate the preview after deploying the latest backend and web-agent changes.
- **Hosted Preview keeps polling `/vnc/sessions` and the browser stays blank**
  That means the hosted-browser session was never marked viewer-ready. Hosted Preview should first provision a persistent Rover-managed browser session, then run Rover on that same browser. Recreate the preview after deploying the latest backend and website changes.
- **Hosted Preview is waiting for the browser**
  Hosted Preview uses the same shared browser pool as normal automation on that worker. If the only browser is busy, Hosted Preview waits instead of creating a second browser.
- **Hosted Preview expired while the viewer was still open**
  That is expected when the hard 12-minute maximum is reached. Viewer heartbeats only refresh the short disconnect grace, not the absolute expiry.
- **Hosted Preview says you do not have credits**
  Hosted Preview is billed to the signed-in tester who created the temporary demo. Sign in first, then add credits or upgrade your plan before creating or continuing the preview.
- **Closing the hosted viewer tab did not close the demo immediately**
  Rover sends a best-effort close on `pagehide` and `beforeunload`. If that signal is missed, the hosted session should still close after the short disconnect grace.
- **Hosted browser says it needs a restart or stale owner**
  Hosted Preview sessions are sticky to one worker. If the worker dies or loses its owner lease, Rover should mark the hosted launch failed and ask you to recreate the temporary demo.
- **Does Hosted Preview reuse the browser after it closes?**
  No. Hosted Preview currently destroys the browser on close, expiry, or failure before the shared pool can reuse capacity for the next request.
- **`React has blocked a javascript: URL`**
  Delete any old Rover bookmarklet and recreate it from the latest Live Test page. Rover's bookmarklet must be dragged from the dedicated drag control, not clicked on the Rover page itself.
- **Console or Bookmarklet only worked on the first page**
  That is expected. They are current-page-only methods. Use the Preview Helper for multi-page desktop demos.
- **A site strips or blocks the inject path**
  Some sites enforce strict CSP or reload aggressively. Fall back to Hosted Preview or the Preview Helper.
