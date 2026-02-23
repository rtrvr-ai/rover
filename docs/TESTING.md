# Rover Testing Guide

## Architecture Overview

Rover is an embeddable autonomous web agent with a 7-layer architecture:

```
User Input → UI Widget (Shadow DOM) → SDK (init/send/registerTool)
    → MessageChannel RPC → Web Worker (agent loop)
    → Backend `/v2/rover/*` runtime (`session/start`, `run/input`, `run/control`, `tab/event`)
    → Gemini LLM → Tool execution via Bridge → DOM actions
```

**Key packages:**
- `@rover/sdk` — Entry point, `boot()`/`init()` creates Bridge + Worker + UI
- `@rover/ui` — Shadow DOM chat widget (launcher button + panel)
- `@rover/bridge` — Main-thread DOM state, tool execution, RPC server
- `@rover/worker` — Web Worker running the agent loop + planner
- `@rover/dom` — Snapshot building, page data, main-world tool executor
- `@rover/a11y-tree` — Accessibility tree generation for LLM input
- `@rover/instrumentation` — Event listener + framework detection
- `@rover/shared` — Types, constants, Gemini SDK, system tool definitions

---

## Prerequisites

### 1. Build Rover

```bash
cd /Users/.../rover
pnpm install
pnpm build
```

This compiles all packages. The SDK output lives at `packages/sdk/dist/`.

### 2. Get a Rover Site Key

Rover bootstraps runtime auth with a **site public key** (`pk_site_...`).
The browser then exchanges that bootstrap key for a short-lived `rvrsess_*` session token via `POST /v2/rover/session/open`.

Without bootstrap auth, Rover emits `auth_required` with code `MISSING_API_KEY` / `INVALID_API_KEY`.

### 3. Backend URL

| Environment | URL |
|-------------|-----|
| **Production base** | `https://extensionrouter.rtrvr.ai` |
| **Production Rover API** | `https://extensionrouter.rtrvr.ai/v2/rover/*` |
| **Firebase Emulator base** | `http://127.0.0.1:5002/rtrvr-extension-functions/us-central1` |
| **Firebase Emulator Rover API** | `http://127.0.0.1:5002/rtrvr-extension-functions/us-central1/v2/rover/*` |

---

## Testing Methods

### Method 1: Demo App (Fastest for Dev)

The demo app at `apps/demo/` is a Vite-based test page with a simple "store" UI.

**Run it:**
```bash
# Terminal 1: Start the demo
cd /Users/.../rover
pnpm dev
# Opens http://localhost:5174
```

**Configuration** (`apps/demo/src/main.ts`):
```typescript
import { init } from '@rover/sdk';

init({
  siteId: 'demo',
  apiBase: 'https://extensionrouter.rtrvr.ai',
  publicKey: 'pk_site_YOUR_PUBLIC_KEY_HERE', // Bootstrap key; Rover exchanges to rvrsess_* automatically
  workerUrl: new URL('./worker.ts', import.meta.url).toString(),
  openOnInit: true,
});
```

**What you'll see:**
- A simple page with "Add to cart" button and email input
- Orange "RVR" launcher button (bottom-right corner)
- Click it to open chat panel
- Try: "Click the Add to cart button" or "Type hello@test.com in the email field"

**What the demo tests:**
- SDK initialization + Worker bootstrap
- UI widget rendering (Shadow DOM isolation)
- Bridge RPC communication (MessageChannel)
- Page snapshot / accessibility tree generation
- Backend planner call (requires valid auth)
- DOM tool execution (click, type, scroll, etc.)

---

### Method 2: Standalone Test HTML (No Build Required After Initial Build)

Create a standalone HTML file that loads the pre-built SDK:

```bash
# After `pnpm build`, serve the SDK dist statically
cd /Users/.../rover
npx serve . --cors -l 3333
```

Then open `test.html` (created below at `apps/demo/test.html`) in your browser at `http://localhost:3333/apps/demo/test.html`.

The test page includes:
- Various interactive elements (buttons, inputs, selects, checkboxes)
- Rover loaded via script tag
- Console logging for all events
- Visual feedback for actions

---

### Method 3: Integration on rtrvr-cloud-website

Add Rover to the Next.js website for testing in a real production-like environment.

**Option A: Script tag in a test page**

Create `app/rover-test/page.tsx`:
```tsx
export const metadata = { title: 'Rover Test | rtrvr.ai' };

export default function RoverTestPage() {
  return (
    <main style={{ padding: '40px', fontFamily: 'sans-serif' }}>
      <h1>Rover Live Test</h1>
      <p>The Rover widget should appear in the bottom-right corner.</p>
      <button onClick={() => alert('Clicked!')}>Test Button</button>
      <input placeholder="Test input" style={{ display: 'block', marginTop: '16px' }} />

      <script
        dangerouslySetInnerHTML={{
          __html: `
            (function(){
              var rover = window.rover = window.rover || function(){
                (rover.q = rover.q || []).push(arguments);
              };
              rover.l = +new Date();
            })();
          `,
        }}
      />
      <script src="https://rover.rtrvr.ai/embed.js" />
      <script
        dangerouslySetInnerHTML={{
          __html: `
            rover('init', {
              siteId: 'rtrvr-website-test',
              publicKey: 'pk_site_YOUR_PUBLIC_KEY',
              openOnInit: true,
            });
          `,
        }}
      />
    </main>
  );
}
```

**Option B: Use the existing demo app and proxy**

The demo app already works standalone. For website integration, the main concern is the SDK being hosted and the `workerUrl` being correct.

---

### Method 4: Firebase Emulator (Full Local Stack)

Run the backend locally for complete end-to-end testing without hitting production:

```bash
# Terminal 1: Start Firebase emulators
cd /Users/.../rtrvr-cloud-backend
firebase emulators:start
# Runs on http://127.0.0.1:5002

# Terminal 2: Start Rover demo
cd /Users/.../rover
pnpm dev
# Runs on http://localhost:5174
```

Update `apps/demo/src/main.ts` to point to local emulator:
```typescript
init({
  siteId: 'demo',
  apiBase: 'http://127.0.0.1:5002/rtrvr-extension-functions/us-central1',
  publicKey: 'pk_site_YOUR_SITE_PUBLIC_KEY',
  workerUrl: new URL('./worker.ts', import.meta.url).toString(),
  openOnInit: true,
});
```

> **Note:** The emulator still needs valid Rover site keys in Firestore to authenticate. You may need to seed test data or use a Firebase auth token from a test user.

---

## What to Test

### Basic Functionality
1. **Widget appears** — Orange "RVR" button in bottom-right
2. **Panel opens/closes** — Click launcher to toggle
3. **Ready event** — Status changes from "idle" to "ready" after Worker init
4. **Send message** — Type and submit in composer
5. **Message display** — User/assistant/system messages render correctly

### DOM Interaction (Requires Backend)
1. **Click elements** — "Click the Add to cart button"
2. **Type into inputs** — "Type hello@test.com into the email field"
3. **Scroll** — "Scroll down"
4. **Navigation** — "Go to https://example.com"
5. **Wait** — "Wait 2 seconds then click the button"

### Advanced Features
1. **Custom tools** — Register via `rover.registerTool()`
2. **Multi-step plans** — "Fill out the form with name John and email john@test.com"
3. **Error handling** — Invalid actions, missing elements, network failures
4. **API mode** — Set `apiMode: true` for non-DOM tool-only mode

### Edge Cases
1. **CSP restrictions** — Test on sites with strict Content-Security-Policy
2. **iframe content** — Elements inside iframes
3. **Dynamic content** — SPAs with lazy-loaded content
4. **Shadow DOM** — Widget doesn't interfere with host page styles

---

## Debugging

### Browser DevTools

**Console filters:**
- Worker messages: Filter for `[Rover]` or watch `worker.onmessage`
- RPC traffic: Set breakpoint in `packages/bridge/src/rpc.ts:20`
- Tool execution: Set breakpoint in `Bridge.executeTool()` at `packages/bridge/src/Bridge.ts:73`

**Network tab:**
- Watch for Rover backend calls:
  - `POST /v2/rover/session/open`
  - `POST /v2/rover/command (type=RUN_INPUT)`
  - `POST /v2/rover/command (type=RUN_CONTROL)`
  - `POST /v2/rover/command (type=TAB_EVENT)`
  - `GET /v2/rover/stream` (SSE)
- Check request payload includes `sessionToken` for runtime calls.
- Check responses include `success: true` and run/session identifiers (`sessionId`, `runId`, `epoch`).

**Elements tab:**
- Look for `#rover-widget-root` on `<html>` element
- Expand its Shadow DOM (closed, but visible in DevTools)
- Check `.panel.open` class for visibility

### Common Errors

| Error | Cause | Fix |
|-------|-------|-----|
| "Rover requires a bootstrap key/session token" | Missing bootstrap key/session token in init config | Add `publicKey: 'pk_site_...'` or `sessionToken: 'rvrsess_...'` |
| "HTTP 401" / "Invalid or expired Rover session token" | Session token expired or bootstrap key invalid | Refresh via `session/start` (automatic) or rotate site key |
| "HTTP 402" | Insufficient credits | Add credits to your rtrvr account |
| Worker fails silently | `workerUrl` is wrong or CORS blocked | Check URL is accessible, serve with CORS |
| "No handler for X" | RPC method mismatch | Rebuild all packages (`pnpm build`) |
| Widget doesn't appear | SDK not loaded or init not called | Check console for load errors |
| Tools fail | `allowActions: false` or element not found | Check config and element IDs |

---

## Configuration Reference

```typescript
init({
  // Required
  siteId: string,              // Site identifier for tracking

  // Authentication
  publicKey?: string,          // Bootstrap site key (`pk_site_*`)
  sessionToken?: string,       // Optional pre-minted rvrsess_* token

  // Backend
  apiBase?: string,            // Override backend base URL
                               // Rover runtime uses `${apiBase}/v2/rover/*`

  // Worker
  workerUrl?: string,          // Override worker script URL
                               // Default: ./worker/worker.js relative to SDK

  // Behavior
  openOnInit?: boolean,        // Auto-open widget (default: false)
  mode?: 'safe' | 'full',     // 'safe' disables inline mutation observation
  allowActions?: boolean,      // Allow DOM modifications (default: true)
  apiMode?: boolean,           // API-only mode, no DOM interaction

  // LLM
  llmIntegration?: {
    model?: string,            // e.g., 'gemini-2.0-flash-exp'
    apiKey?: string,           // Direct Gemini API key
    apiKeys?: string[],        // Multiple Gemini keys for round-robin
  },
  googleAiStudioApiKey?: string,  // Shorthand for llmIntegration.apiKey

  // Custom tools
  tools?: {
    client?: [{
      name: string,
      description?: string,
      parameters?: Record<string, any>,
      llmCallable?: boolean,
    }],
  },

  // Tool filtering
  apiToolsConfig?: {
    mode?: 'allowlist' | 'profile' | 'none',
    enableAdditionalTools?: string[],
  },
});
```

---

## Issues Found & Fixed

### CRITICAL: Wrong backend URL in demo app
**File:** `apps/demo/src/main.ts`
**Was:** `apiBase: 'http://localhost:8787'` (Cloudflare Workers URL - incorrect)
**Fixed to:** `apiBase: 'https://extensionrouter.rtrvr.ai'`
**Impact:** Every backend call would fail with connection refused.

### CRITICAL: Missing bootstrap key in demo config
**File:** `apps/demo/src/main.ts`
**Was:** No `publicKey` field at all
**Fixed:** Added `publicKey` field with comment explaining it's required
**Impact:** Runtime cannot mint a Rover session token, so message execution fails.

### CRITICAL: SDK and Worker not bundled for standalone use
**Files:** `packages/sdk/dist/index.js`, `packages/sdk/dist/worker/worker.js`
**Problem:** TypeScript compiler (`tsc`) outputs individual files with bare module imports (`import { Bridge } from '@rover/bridge'`). These only work when consumed by a bundler (Vite, webpack). Loading the dist files directly via `<script>` or `new Worker()` fails with import resolution errors.
**Fixed:** Added esbuild bundling:
- `packages/sdk/dist/rover.js` — Standalone SDK (394KB), self-contained ESM, auto-calls `installGlobal()`
- `packages/sdk/dist/worker/rover-worker.js` — Bundled Worker (120KB), self-contained ESM (npm export)
- Build pipeline: `tsc → copy-worker → esbuild bundle`

### INFO: Worker copy-worker.mjs only copied 2 files
**File:** `packages/sdk/scripts/copy-worker.mjs`
**Problem:** Only copied `worker.js` and `worker.d.ts` to SDK dist, but `worker.js` has relative imports to `./agent/*.js` files that weren't copied. This meant the unbundled worker in `sdk/dist/worker/` was broken.
**Fixed:** Now also copies `worker.bundle.js` and creates `rover-worker.js` bundled version.

---

## Build Outputs

After `pnpm build`, the SDK dist contains:

```
packages/sdk/dist/
├── index.js              (3.8KB)   — Unbundled SDK (for Vite/webpack consumers)
├── index.d.ts            (1.2KB)   — TypeScript types
├── loader.js             (194B)    — Queue-based loader snippet
├── loader.d.ts           (11B)
├── rover.js              (394KB)   — BUNDLED standalone SDK (for <script> tag / CDN)
└── worker/
    ├── worker.js          (6.4KB)  — Unbundled worker (for Vite/webpack)
    ├── worker.bundle.js   (120KB)  — Bundled worker (standalone)
    ├── rover-worker.js    (120KB)  — Bundled worker (npm export via @rtrvr-ai/rover/worker)
    └── worker.d.ts        (11B)
```

**For bundler consumers** (Vite, webpack, Next.js): Use `index.js` + `worker.js`
**For standalone/CDN use**: Use `embed.js` (or `rover.js`) + `worker/worker.js` (auto-resolved)

---

## Quick Start (TL;DR)

```bash
# 1. Build
cd /path/to/rover
pnpm install && pnpm build

# 2. Run demo app
pnpm dev
# Open http://localhost:5174

# 3. Or serve standalone test page
npx serve . --cors -l 3333
# Open http://localhost:3333/apps/demo/test.html
```

Make sure `apps/demo/src/main.ts` has your `publicKey` set before running `pnpm dev`.
