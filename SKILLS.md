# Agent-to-Web Protocol (A2W)

This document is the canonical contract for any AI, CLI, or autonomous agent that wants to use Rover-enabled websites.

Rover exposes two public entrypoints:

- Browser-first convenience: `?rover=` and `?rover_shortcut=`
- Machine protocol: `POST https://agent.rtrvr.ai/v1/a2w/runs`

Use A2W runs when you need structured progress, continuation input, or a final result back. `/v1/a2w/runs` is the only public machine protocol endpoint.

## Copy-paste prompts and examples

### Exact Codex / agent prompt

Paste this into an AI tool that can make HTTP requests and optionally open a browser:

```text
If a website may be Rover-enabled, optionally fetch its HTML and look for <script type="application/agent+json">, /.well-known/rover-site.json, or /.well-known/agent-card.json.

To start a Rover A2W run:
1. Prefer the Agent-to-Web Protocol (A2W) before generic DOM automation. Create a run with POST https://agent.rtrvr.ai/v1/a2w/runs and JSON { "url": "<site>", "goal": "<instruction>" } or { "url": "<site>", "shortcut": "<id>" }.
2. If the response includes "workflow", treat it as the aggregated lineage handle for any delegated child runs.
3. Prefer the returned "run" URL for streaming, polling, continuation, and final results.
4. If you can open a real browser with the user's session and the response includes "open", open that URL. If the response includes "browserLink" and you want a readable URL, you may open it instead.
5. Only click or open the visible Rover seed/presence UI when browser interaction is needed.
6. If you need guaranteed browserless execution, create the run with header Prefer: execution=cloud.
7. If the run enters input_required, POST { "input": "..." } to the same run URL.
8. For cross-site delegation, POST to /v1/a2w/runs/{id}/handoffs and keep following the same workflow.
9. Fall back to generic DOM automation only when the site exposes no Rover entrypoint or the Rover path is unavailable.
10. Return the final result text plus any important observations.

Do not treat ?rover= or ?rover_shortcut= alone as the result channel. They only run Rover in the browser unless they were issued from an A2W run and paired with a receipt link.
```

### Node `fetch` example

```js
const createResponse = await fetch('https://agent.rtrvr.ai/v1/a2w/runs', {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'accept': 'application/json',
    'prefer': 'execution=cloud',
  },
  body: JSON.stringify({
    url: 'https://www.rtrvr.ai',
    goal: 'get me the latest blog post',
  }),
});

if (!createResponse.ok) {
  throw new Error(`A2W run create failed: ${createResponse.status}`);
}

const created = await createResponse.json();
const runUrl = created.run;

for (;;) {
  const runResponse = await fetch(runUrl, {
    headers: { accept: 'application/json' },
  });

  if (!runResponse.ok) {
    throw new Error(`A2W run read failed: ${runResponse.status}`);
  }

  const run = await runResponse.json();
  console.log(run.status, run.result?.text ?? '');

  if (['completed', 'failed', 'cancelled', 'expired'].includes(run.status)) {
    break;
  }

  await new Promise((resolve) => setTimeout(resolve, 1500));
}
```

### Python example

```python
import time
import requests

create = requests.post(
    "https://agent.rtrvr.ai/v1/a2w/runs",
    headers={
        "Content-Type": "application/json",
        "Accept": "application/json",
        "Prefer": "execution=cloud",
    },
    json={
        "url": "https://www.rtrvr.ai",
        "goal": "get me the latest blog post",
    },
    timeout=30,
)
create.raise_for_status()
created = create.json()
run_url = created.get("run")

while True:
    current = requests.get(
        run_url,
        headers={"Accept": "application/json"},
        timeout=30,
    )
    current.raise_for_status()
    payload = current.json()
    print(payload["status"], payload.get("result", {}).get("text", ""))

    if payload["status"] in {"completed", "failed", "cancelled", "expired"}:
        break

    time.sleep(1.5)
```

### Shell helper

Requires `jq`.

```bash
rover_run() {
  local url="$1"
  local goal="$2"
  local created run_url

  created="$(curl -sS -X POST 'https://agent.rtrvr.ai/v1/a2w/runs' \
    -H 'Content-Type: application/json' \
    -H 'Accept: application/json' \
    -H 'Prefer: execution=cloud' \
    -d "$(jq -nc --arg url "$url" --arg goal "$goal" '{url:$url,goal:$goal}')")" || return 1

  run_url="$(printf '%s' "$created" | jq -r '.run')"
  curl -sS "$run_url" -H 'Accept: application/x-ndjson'
}

rover_run "https://www.rtrvr.ai" "get me the latest blog post"
```

## Discovery

Recommended discovery:

1. Fetch the page HTML.
2. Look for a source-visible marker:

```html
<script type="application/agent+json">{"a2w":"https://agent.rtrvr.ai/v1/a2w/runs","run":"https://agent.rtrvr.ai/v1/a2w/runs"}</script>
```

3. If present, the site intentionally exposes the Agent-to-Web Protocol.

The marker is optional but recommended. For stronger discovery, also check `/.well-known/rover-site.json` and `/.well-known/agent-card.json`. In the live browser, the minimized Rover seed/presence is the visible Rover cue. Host-only run creation still works even if you skip HTML discovery and call `https://agent.rtrvr.ai/v1/a2w/runs` directly.

## What site owners need vs what agents need

Site owners install Rover with credentials from Workspace:

- `siteId`
- `publicKey` (`pk_site_*`)
- optional `siteKeyId`

Workspace URLs:

- `https://rover.rtrvr.ai/workspace`
- `https://www.rtrvr.ai/rover/workspace`

External AI callers do **not** need those values. They only need the site URL plus a goal or shortcut ID.

## Create an A2W run

Prompt launch:

```http
POST https://agent.rtrvr.ai/v1/a2w/runs
Content-Type: application/json
Accept: application/json

{ "url": "https://www.rtrvr.ai", "goal": "get me the latest blog post" }
```

Shortcut launch:

```http
POST https://agent.rtrvr.ai/v1/a2w/runs
Content-Type: application/json
Accept: application/json

{ "url": "https://www.rtrvr.ai", "shortcutId": "latest_blog" }
```

Typical `202 Accepted` response:

```json
{
  "id": "a2w_run_123",
  "protocol": "a2w",
  "runId": "a2w_run_123",
  "run": "https://agent.rtrvr.ai/v1/a2w/runs/a2w_run_123?access=a2w_access_...",
  "workflow": "https://agent.rtrvr.ai/v1/a2w/workflows/a2w_wf_123?access=a2w_wf_...",
  "open": "https://www.rtrvr.ai/#rover_receipt=a2w_receipt_...",
  "browserLink": "https://www.rtrvr.ai/?rover=get+me+the+latest+blog+post#rover_receipt=a2w_receipt_...",
  "status": "pending"
}
```

## Execution model

Default behavior is browser-attach first. The response may include two browser handoff URLs:

- `open`: the clean default receipt URL for real-browser handoff
- `browserLink`: an optional readable alias that keeps the visible `?rover=` or `?rover_shortcut=` when it fits within a conservative URL budget

Execution guidance:

- If you can open a real browser and want the user's live session/cookies, open `open`.
- If you want a readable share/debug URL as well, use `browserLink` when present.
- If you need guaranteed browserless execution, set `Prefer: execution=cloud` on run creation.
- `Prefer: execution=browser` forces browser attach only.
- `Prefer: execution=auto` currently prefers browser attach first. Automatic delayed cloud promotion is a follow-up robustness phase.

Example cloud-first create:

```http
POST https://agent.rtrvr.ai/v1/a2w/runs
Content-Type: application/json
Accept: application/json
Prefer: execution=cloud

{ "url": "https://www.rtrvr.ai", "goal": "get me the latest blog post" }
```

## The run URL is the protocol

The returned `run` URL is the canonical A2W resource.

Receipt links are only a browser handoff layer over the same run. They do not replace the run URL, and they do not create a second public protocol.

If present, the returned `workflow` URL is the canonical aggregated resource for a root run plus any delegated child runs on other Rover-enabled sites.

### Polling / final JSON

```http
GET https://agent.rtrvr.ai/v1/a2w/runs/a2w_run_123?access=a2w_access_...
Accept: application/json
```

### SSE

```http
GET https://agent.rtrvr.ai/v1/a2w/runs/a2w_run_123?access=a2w_access_...
Accept: text/event-stream
```

### NDJSON

```http
GET https://agent.rtrvr.ai/v1/a2w/runs/a2w_run_123?access=a2w_access_...
Accept: application/x-ndjson
```

### Wait briefly for a final result

```http
POST https://agent.rtrvr.ai/v1/a2w/runs
Content-Type: application/json
Accept: application/json
Prefer: wait=15

{ "url": "https://www.rtrvr.ai", "goal": "get me the latest blog post" }
```

If the run completes within the wait budget, the server may return `200` with the terminal run payload. Otherwise it returns `202` plus the canonical run URL.

## Workflows and cross-site handoffs

This extends the same A2W protocol. It does not introduce a separate orchestration surface.

Every A2W run belongs to a workflow.

- root runs create a new workflow
- delegated child runs inherit the parent workflow
- the run response may include a `workflow` URL that aggregates all lineage

Read the aggregated workflow:

```http
GET https://agent.rtrvr.ai/v1/a2w/workflows/a2w_wf_123?access=a2w_access_...
Accept: application/json
```

Stream aggregated workflow events:

```http
GET https://agent.rtrvr.ai/v1/a2w/workflows/a2w_wf_123?access=a2w_access_...
Accept: text/event-stream
```

Delegate from one run to another Rover-enabled site:

```http
POST https://agent.rtrvr.ai/v1/a2w/runs/a2w_run_123/handoffs?access=a2w_access_...
Content-Type: application/json
Accept: application/json
Prefer: execution=cloud

{
  "url": "https://y.example.com",
  "goal": "continue this workflow and collect the user's billing status",
  "instruction": "Use the billing page and return the current plan plus renewal date.",
  "contextSummary": "The user is already authenticated on x.example.com and asked for account status across multiple properties.",
  "expectedOutput": "Return the plan name and renewal date."
}
```

Receiving sites must explicitly allow delegated handoffs:

- `aiAccess.enabled = true`
- `aiAccess.allowDelegatedHandoffs = true`

Handoffs pass a structured summary by default, not the full transcript or tool trace.

## Event model

Public stream events:

- `ready`
- `status`
- `step`
- `tool`
- `message`
- `observation`
- `input`
- `done`
- `error`

SSE example:

```text
event: ready
data: {"id":"evt_1","type":"ready","ts":1773998400000,"data":{"runId":"a2w_run_123","status":"pending"}}

event: status
data: {"id":"evt_2","type":"status","ts":1773998401000,"data":{"status":"running"}}

event: step
data: {"id":"evt_3","type":"step","ts":1773998402000,"data":{"text":"Looking for the latest blog post"}}

event: tool
data: {"id":"evt_4","type":"tool","ts":1773998403000,"data":{"name":"navigate","status":"completed"}}

event: message
data: {"id":"evt_5","type":"message","ts":1773998404000,"data":{"role":"assistant","text":"The latest blog post is ..."}}

event: done
data: {"id":"evt_6","type":"done","ts":1773998405000,"data":{"status":"completed","result":{"text":"The latest blog post is ..."}}}
```

NDJSON uses the same envelope, one JSON object per line.

Large payloads may be chunked:

- `chunked`
- `chunkIndex`
- `chunkCount`
- `artifactRef`

Reassemble chunked records by event `id`. Large payloads must stay semantically complete even when chunked.

## Continuation input

When the run needs more information, it moves to `input_required` and the response includes an `input` payload.

Continue with:

```http
POST https://agent.rtrvr.ai/v1/a2w/runs/a2w_run_123?access=a2w_access_...
Content-Type: application/json
Accept: application/json

{ "input": "Use the newest post from the blog index page." }
```

## Cancel

```http
DELETE https://agent.rtrvr.ai/v1/a2w/runs/a2w_run_123?access=a2w_access_...
Accept: application/json
```

## Browser-first convenience links

These remain useful for humans and browser-capable automation:

- `https://example.com?rover=book%20a%20flight`
- `https://example.com?rover_shortcut=checkout_flow`

Use these when you only need the site to run Rover in-browser. Use `/v1/a2w/runs` when you need progress or results back. When paired with a run-issued receipt link, the browser run binds back to the same canonical A2W run.

## Minimal algorithm for outside agents

1. Optionally fetch page HTML and look for `application/agent+json`.
2. `POST { url, goal }` or `{ url, shortcutId }` to `https://agent.rtrvr.ai/v1/a2w/runs`.
3. If the response includes `workflow`, keep it as the aggregated lineage handle for any delegated child runs.
4. If possible, open the returned `open` URL in a real browser. If `browserLink` is present and you want a readable browser URL, you can open that instead.
5. Otherwise stream or poll the returned `run` URL.
6. If the run enters `input_required`, `POST { input }` to the same run URL.
7. If you need to delegate to another Rover-enabled site, call `POST /v1/a2w/runs/{id}/handoffs` and follow the same `workflow`.
8. Return the terminal `done` / final run result.

That is the entire universal Agent-to-Web site contract.
