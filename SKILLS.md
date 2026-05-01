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
1. Prefer the Agent-to-Web Protocol (A2W) before generic DOM automation. Create a run with POST https://agent.rtrvr.ai/v1/a2w/runs and JSON { "url": "<site>", "prompt": "<instruction>" } or { "url": "<site>", "shortcutId": "<id>" }. The older "goal" field is still accepted as an alias.
2. If the response includes "workflow", treat it as the aggregated lineage handle for any delegated child runs.
3. Run creation can return 202 before work is done. Prefer returned "links.stream", "links.ndjson", or "links.poll"; otherwise use the returned "run" URL for streaming, polling, continuation, and final results.
4. If you can open a real browser with the user's session and the response includes "open", open that URL. If the response includes "browserLink" and you want a readable URL, you may open it instead.
5. Only click or open the visible Rover seed/presence UI when browser interaction is needed.
6. If you need guaranteed browserless execution, create the run with header Prefer: execution=cloud, wait=10.
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
    'prefer': 'execution=cloud, wait=10',
  },
  body: JSON.stringify({
    url: 'https://www.rtrvr.ai',
    prompt: 'get me the latest blog post',
  }),
});

if (!createResponse.ok) {
  throw new Error(`A2W run create failed: ${createResponse.status}`);
}

const created = await createResponse.json();
const runUrl = created.run;
let run = created;

while (!['completed', 'failed', 'cancelled', 'expired'].includes(run.status)) {
  if (run.status === 'input_required') {
    throw new Error(`A2W run needs input: ${JSON.stringify(run.input ?? {})}`);
  }
  const runResponse = await fetch(runUrl, {
    headers: { accept: 'application/json', prefer: 'wait=10' },
  });

  if (!runResponse.ok) {
    throw new Error(`A2W run read failed: ${runResponse.status}`);
  }

  run = await runResponse.json();
  console.log(run.status, run.result?.text ?? '');
}

if (run.status !== 'completed') {
  throw new Error(run.result?.error || `A2W run ended with ${run.status}`);
}
```

### Python example

```python
import requests

create = requests.post(
    "https://agent.rtrvr.ai/v1/a2w/runs",
    headers={
        "Content-Type": "application/json",
        "Accept": "application/json",
        "Prefer": "execution=cloud, wait=10",
    },
    json={
        "url": "https://www.rtrvr.ai",
        "prompt": "get me the latest blog post",
    },
    timeout=30,
)
create.raise_for_status()
created = create.json()
run_url = created.get("run")
payload = created

while payload["status"] not in {"completed", "failed", "cancelled", "expired"}:
    if payload["status"] == "input_required":
        raise RuntimeError(f"A2W run needs input: {payload.get('input')}")
    current = requests.get(
        run_url,
        headers={"Accept": "application/json", "Prefer": "wait=10"},
        timeout=30,
    )
    current.raise_for_status()
    payload = current.json()
    print(payload["status"], payload.get("result", {}).get("text", ""))

if payload["status"] != "completed":
    raise RuntimeError(payload.get("result", {}).get("error") or f"A2W run ended with {payload['status']}")
```

### Shell helper

Requires `jq`.

```bash
rover_run() {
  local url="$1"
  local prompt="$2"
  local created run_url

  created="$(curl -sS -X POST 'https://agent.rtrvr.ai/v1/a2w/runs' \
    -H 'Content-Type: application/json' \
    -H 'Accept: application/json' \
    -H 'Prefer: execution=cloud, wait=10' \
    -d "$(jq -nc --arg url "$url" --arg prompt "$prompt" '{url:$url,prompt:$prompt}')")" || return 1

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

External AI callers do **not** need those values. They only need the site URL plus a prompt or shortcut ID.

## Create an A2W run

Prompt launch:

```http
POST https://agent.rtrvr.ai/v1/a2w/runs
Content-Type: application/json
Accept: application/json

{ "url": "https://www.rtrvr.ai", "prompt": "get me the latest blog post" }
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
  "status": "running",
  "retryAfterMs": 2000,
  "terminalStatuses": ["completed", "failed", "cancelled", "expired"],
  "interactiveStatuses": ["input_required"],
  "links": {
    "poll": { "href": "https://agent.rtrvr.ai/v1/a2w/runs/a2w_run_123?access=a2w_access_...", "method": "GET", "headers": { "Accept": "application/json", "Prefer": "wait=10" } },
    "stream": { "href": "https://agent.rtrvr.ai/v1/a2w/runs/a2w_run_123?access=a2w_access_...", "method": "GET", "headers": { "Accept": "text/event-stream" } },
    "ndjson": { "href": "https://agent.rtrvr.ai/v1/a2w/runs/a2w_run_123?access=a2w_access_...", "method": "GET", "headers": { "Accept": "application/x-ndjson" } }
  },
  "next": {
    "action": "follow",
    "message": "Run is still active. Use stream, ndjson, or poll until a terminal or input_required status."
  },
  "open": "https://www.rtrvr.ai/#rover_receipt=a2w_receipt_...",
  "browserLink": "https://www.rtrvr.ai/?rover=get+me+the+latest+blog+post#rover_receipt=a2w_receipt_..."
}
```

## Execution model

Default behavior is browser-attach first. The response may include two browser handoff URLs:

- `open`: the clean default receipt URL for real-browser handoff
- `browserLink`: an optional readable alias that keeps the visible `?rover=` or `?rover_shortcut=` when it fits within a conservative URL budget

Execution guidance:

- If you can open a real browser and want the user's live session/cookies, open `open`.
- If you want a readable share/debug URL as well, use `browserLink` when present.
- If you need guaranteed browserless execution, set `Prefer: execution=cloud, wait=10` on run creation, then follow the returned links.
- `Prefer: execution=browser` forces browser attach only.
- `Prefer: execution=auto` currently prefers browser attach first. Automatic delayed cloud promotion is a follow-up robustness phase.

Example cloud-first create:

```http
POST https://agent.rtrvr.ai/v1/a2w/runs
Content-Type: application/json
Accept: application/json
Prefer: execution=cloud, wait=10

{ "url": "https://www.rtrvr.ai", "prompt": "get me the latest blog post" }
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

{ "url": "https://www.rtrvr.ai", "prompt": "get me the latest blog post" }
```

If the run completes within the wait budget, the server may return `200` with the terminal run payload. Otherwise it returns `202` plus the canonical run URL.
For browserless agents, prefer `Prefer: execution=cloud, wait=10` on create, then keep following `links.ndjson`, `links.stream`, or `links.poll` until `status` is `completed`, `failed`, `cancelled`, `expired`, or `input_required`.

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
Prefer: execution=cloud, wait=10

{
  "url": "https://y.example.com",
  "prompt": "continue this workflow and collect the user's billing status",
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
2. `POST { url, prompt }` or `{ url, shortcutId }` to `https://agent.rtrvr.ai/v1/a2w/runs`; `goal` is accepted as a compatibility alias.
3. If the response includes `workflow`, keep it as the aggregated lineage handle for any delegated child runs.
4. If possible, open the returned `open` URL in a real browser. If `browserLink` is present and you want a readable browser URL, you can open that instead.
5. Otherwise stream or poll using `links.ndjson`, `links.stream`, or `links.poll`.
6. If the run enters `input_required`, `POST { input }` to the same run URL.
7. If you need to delegate to another Rover-enabled site, call `POST /v1/a2w/runs/{id}/handoffs` and follow the same `workflow`.
8. Return the terminal `done` / final run result.

That is the entire universal Agent-to-Web site contract.
