# Rover Public Site Tasks

This document is the canonical contract for any AI, CLI, or autonomous agent that wants to use Rover-enabled websites.

Rover has two public entrypoints:

- Browser-first convenience: `?rover=` and `?rover_shortcut=`
- Machine protocol: `POST https://agent.rtrvr.ai/v1/tasks`

Use `/v1/tasks` when you need structured progress, continuation, or a final result back.

## Copy-paste prompts and examples

### Exact Codex / agent prompt

Paste this into an AI tool that can make HTTP requests and optionally open a browser:

```text
If a website may be Rover-enabled, optionally fetch its HTML and look for <script type="application/agent+json">.

To run a task on a Rover-enabled site:
1. Create a task with POST https://agent.rtrvr.ai/v1/tasks and JSON { "url": "<site>", "prompt": "<instruction>" } or { "url": "<site>", "shortcut": "<id>" }.
2. If you can open a real browser with the user's session and the response includes "open", open that URL. If the response includes "browserLink" and you want a readable URL, you may open it instead.
3. If you need guaranteed browserless execution, create the task with header Prefer: execution=cloud.
4. Follow the canonical "task" URL with Accept: text/event-stream for live steps or Accept: application/json for polling/final results.
5. If the task enters input_required, POST { "input": "..." } to the same task URL.
6. Return the final result text plus any important observations.

Do not treat ?rover= or ?rover_shortcut= alone as the result channel. They only run Rover in the browser unless they were issued from a task and paired with a receipt link.
```

### Node `fetch` example

```js
const createResponse = await fetch('https://agent.rtrvr.ai/v1/tasks', {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'accept': 'application/json',
    'prefer': 'execution=cloud',
  },
  body: JSON.stringify({
    url: 'https://www.rtrvr.ai',
    prompt: 'get me the latest blog post',
  }),
});

if (!createResponse.ok) {
  throw new Error(`Task create failed: ${createResponse.status}`);
}

const created = await createResponse.json();
const taskUrl = created.task;

for (;;) {
  const taskResponse = await fetch(taskUrl, {
    headers: { accept: 'application/json' },
  });

  if (!taskResponse.ok) {
    throw new Error(`Task read failed: ${taskResponse.status}`);
  }

  const task = await taskResponse.json();
  console.log(task.status, task.result?.text ?? '');

  if (['completed', 'failed', 'cancelled', 'expired'].includes(task.status)) {
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
    "https://agent.rtrvr.ai/v1/tasks",
    headers={
        "Content-Type": "application/json",
        "Accept": "application/json",
        "Prefer": "execution=cloud",
    },
    json={
        "url": "https://www.rtrvr.ai",
        "prompt": "get me the latest blog post",
    },
    timeout=30,
)
create.raise_for_status()
task = create.json()
task_url = task["task"]

while True:
    current = requests.get(
        task_url,
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
rover_task() {
  local url="$1"
  local prompt="$2"
  local created task_url

  created="$(curl -sS -X POST 'https://agent.rtrvr.ai/v1/tasks' \
    -H 'Content-Type: application/json' \
    -H 'Accept: application/json' \
    -H 'Prefer: execution=cloud' \
    -d "$(jq -nc --arg url "$url" --arg prompt "$prompt" '{url:$url,prompt:$prompt}')")" || return 1

  task_url="$(printf '%s' "$created" | jq -r '.task')"
  curl -sS "$task_url" -H 'Accept: application/x-ndjson'
}

rover_task "https://www.rtrvr.ai" "get me the latest blog post"
```

## Discovery

Recommended discovery:

1. Fetch the page HTML.
2. Look for a source-visible marker:

```html
<script type="application/agent+json">{"task":"https://agent.rtrvr.ai/v1/tasks"}</script>
```

3. If present, the site intentionally exposes the Rover public task protocol.

The marker is optional but recommended. Host-only task creation still works even if you skip HTML discovery and call `https://agent.rtrvr.ai/v1/tasks` directly.

## What site owners need vs what agents need

Site owners install Rover with credentials from Workspace:

- `siteId`
- `publicKey` (`pk_site_*`)
- optional `siteKeyId`

Workspace URLs:

- `https://rover.rtrvr.ai/workspace`
- `https://www.rtrvr.ai/rover/workspace`

External AI callers do **not** need those values. They only need the site URL plus a prompt or shortcut ID.

## Create a task

Prompt launch:

```http
POST https://agent.rtrvr.ai/v1/tasks
Content-Type: application/json
Accept: application/json

{ "url": "https://www.rtrvr.ai", "prompt": "get me the latest blog post" }
```

Shortcut launch:

```http
POST https://agent.rtrvr.ai/v1/tasks
Content-Type: application/json
Accept: application/json

{ "url": "https://www.rtrvr.ai", "shortcut": "latest_blog" }
```

Typical `202 Accepted` response:

```json
{
  "id": "agt_123",
  "task": "https://agent.rtrvr.ai/v1/tasks/agt_123?access=agt_access_...",
  "open": "https://www.rtrvr.ai/#rover_receipt=rrc_...",
  "browserLink": "https://www.rtrvr.ai/?rover=get+me+the+latest+blog+post#rover_receipt=rrc_...",
  "status": "pending"
}
```

## Execution model

Default behavior is browser-attach first. The response may include two browser handoff URLs:

- `open`: the clean default receipt URL for real-browser handoff
- `browserLink`: an optional readable alias that keeps the visible `?rover=` or `?rover_shortcut=` when it fits within a conservative URL budget

Execution guidance:

- If you can open a real browser and want the user’s live session/cookies, open `open`.
- If you want a readable share/debug URL as well, use `browserLink` when present.
- If you need guaranteed browserless execution, set `Prefer: execution=cloud` on task creation.
- `Prefer: execution=browser` forces browser attach only.
- `Prefer: execution=auto` currently prefers browser attach first. Automatic delayed cloud promotion is a follow-up robustness phase.

Example cloud-first create:

```http
POST https://agent.rtrvr.ai/v1/tasks
Content-Type: application/json
Accept: application/json
Prefer: execution=cloud

{ "url": "https://www.rtrvr.ai", "prompt": "get me the latest blog post" }
```

## The task URL is the protocol

The returned `task` URL is the canonical resource.

Receipt links are only a browser handoff layer over the same task. They do not replace the task URL, and they do not create a second public protocol.

### Polling / final JSON

```http
GET https://agent.rtrvr.ai/v1/tasks/agt_123?access=agt_access_...
Accept: application/json
```

### SSE

```http
GET https://agent.rtrvr.ai/v1/tasks/agt_123?access=agt_access_...
Accept: text/event-stream
```

### NDJSON

```http
GET https://agent.rtrvr.ai/v1/tasks/agt_123?access=agt_access_...
Accept: application/x-ndjson
```

### Wait briefly for a final result

```http
POST https://agent.rtrvr.ai/v1/tasks
Content-Type: application/json
Accept: application/json
Prefer: wait=15

{ "url": "https://www.rtrvr.ai", "prompt": "get me the latest blog post" }
```

If the task completes within the wait budget, the server may return `200` with the terminal task payload. Otherwise it returns `202` plus the canonical task URL.

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
data: {"id":"evt_1","type":"ready","ts":1773998400000,"data":{"taskId":"agt_123","status":"pending"}}

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

When the task needs more information, it moves to `input_required` and the response includes an `input` payload.

Continue with:

```http
POST https://agent.rtrvr.ai/v1/tasks/agt_123?access=agt_access_...
Content-Type: application/json
Accept: application/json

{ "input": "Use the newest post from the blog index page." }
```

## Cancel

```http
DELETE https://agent.rtrvr.ai/v1/tasks/agt_123?access=agt_access_...
Accept: application/json
```

## Browser-first convenience links

These remain useful for humans and browser-capable automation:

- `https://example.com?rover=book%20a%20flight`
- `https://example.com?rover_shortcut=checkout_flow`

Use these when you only need the site to run Rover in-browser. Use `/v1/tasks` when you need progress or results back. When paired with a task-issued receipt link, the browser run binds back to the same canonical task.

## Minimal algorithm for outside agents

1. Optionally fetch page HTML and look for `application/agent+json`.
2. `POST { url, prompt }` or `{ url, shortcut }` to `https://agent.rtrvr.ai/v1/tasks`.
3. If possible, open the returned `open` URL in a real browser. If `browserLink` is present and you want a readable browser URL, you can open that instead.
4. Otherwise stream or poll the returned `task` URL.
5. If the task enters `input_required`, `POST { input }` to the same task URL.
6. Return the terminal `done` / final task result.

That is the entire universal Rover site contract.
