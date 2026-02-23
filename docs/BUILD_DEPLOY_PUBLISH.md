# Rover SDK — Build, Deploy & Publish Reference

## Architecture Overview

```
rover/                          (monorepo — pnpm workspaces)
├── packages/
│   ├── sdk/        → @rtrvr-ai/rover   (the published npm package + embed.js)
│   ├── worker/     → @rover/worker
│   ├── bridge/     → @rover/bridge
│   ├── dom/        → @rover/dom
│   ├── ui/         → @rover/ui
│   ├── instrumentation/ → @rover/instrumentation
│   └── ...
├── apps/
│   └── demo/       → @rover/demo       (dev-only, NOT needed for deploy)
└── .github/workflows/build-deploy.yml
```

**Hosting:** Rover SDK is served from `https://rover.rtrvr.ai/` — which is the `public/` directory of `rtrvr-cloud-website` on Vercel.

**Consumers:** The cloud website loads it via `<script src="https://rover.rtrvr.ai/embed.js">` in `app/layout.tsx`, then calls `window.rover('boot', { ... })`.

---

## Local Build & Deploy (Manual)

### Step 1: Build Rover SDK

```bash
cd ~/work/act_2/rover
pnpm build
```

Builds all workspace packages in dependency order: worker → bridge → sdk → demo.

### Step 2: Prepare Deploy Artifacts

```bash
node packages/sdk/scripts/prepare-deploy.mjs
```

Creates `packages/sdk/dist/deploy/` with:
- `embed.js` — IIFE bundle for `<script>` tag embedding
- `rover.js` — ESM bundle for module imports
- `worker/worker.js` — Web Worker bundle (auto-resolved via `import.meta.url`)

### Step 3: Copy to Cloud Website

```bash
cp packages/sdk/dist/deploy/embed.js        ~/work/act_2/rtrvr-cloud-website/public/embed.js
cp packages/sdk/dist/deploy/rover.js         ~/work/act_2/rtrvr-cloud-website/public/rover.js
mkdir -p ~/work/act_2/rtrvr-cloud-website/public/worker
cp packages/sdk/dist/deploy/worker/worker.js ~/work/act_2/rtrvr-cloud-website/public/worker/worker.js
```

### Step 4: Deploy Website (triggers Vercel)

```bash
cd ~/work/act_2/rtrvr-cloud-website
git add public/embed.js public/rover.js public/worker/
git commit -m "chore: update Rover SDK artifacts"
git push
```

Vercel auto-deploys on push to main.

---

## Quick Reference — Full Rebuild Cycle (Copy-Paste)

```bash
# 1. Build Rover
cd ~/work/act_2/rover
pnpm build
node packages/sdk/scripts/prepare-deploy.mjs

# 2. Copy build files to website
cp packages/sdk/dist/deploy/embed.js        ../rtrvr-cloud-website/public/embed.js
cp packages/sdk/dist/deploy/rover.js         ../rtrvr-cloud-website/public/rover.js
mkdir -p ../rtrvr-cloud-website/public/worker
cp packages/sdk/dist/deploy/worker/worker.js ../rtrvr-cloud-website/public/worker/worker.js

# 3. Commit & deploy website
cd ../rtrvr-cloud-website
git add public/embed.js public/rover.js public/worker/
git commit -m "chore: update Rover SDK artifacts"
git push

# 4. (Optional) Publish to npm
cd ../rover/packages/sdk && npm publish --access public
```

---

## npm Publishing

### Rover SDK (`@rtrvr-ai/rover`)

```bash
# Login (one-time)
npm login --scope=@rtrvr-ai

# Build & publish
cd ~/work/act_2/rover
pnpm build
cd packages/sdk && npm publish --access public && cd ../..
```

### rtrvr-cli Packages (publish in order — core first, cli last)

```bash
# Login (one-time, same scope)
npm login --scope=@rtrvr-ai

# Build all
cd ~/work/act_2/rtrvr-cli
pnpm build

# Publish in dependency order
cd packages/core && pnpm publish --access public && cd ../..
cd packages/sdk  && pnpm publish --access public && cd ../..
cd packages/cli  && pnpm publish --access public && cd ../..
```

**Package versions** (check/bump in each `package.json` before publishing):
- `@rtrvr-ai/core` — core runtime & API client
- `@rtrvr-ai/sdk`  — TypeScript SDK for rtrvr APIs
- `@rtrvr-ai/cli`  — CLI tool (`rtrvr` command)

To bump versions before publish:
```bash
# Example: bump patch version
cd packages/core && npm version patch && cd ../..
cd packages/sdk  && npm version patch && cd ../..
cd packages/cli  && npm version patch && cd ../..
```

---

## GitHub Actions CI/CD (Rover)

**Workflow:** `.github/workflows/build-deploy.yml`
**Trigger:** Push to `main` or manual dispatch

### Jobs

| Job | What it does | Secrets needed |
|-----|-------------|----------------|
| `build` | Builds SDK (excludes demo), uploads artifacts | — |
| `deploy-vercel` | Pushes artifacts to `rtrvr-cloud-website` repo | `WEBSITE_PAT` (GitHub PAT with repo scope) |
| `publish-npm` | Publishes `@rtrvr-ai/rover` to npm | `NPM_TOKEN` |

### Required GitHub Secrets (repo: `rtrvr-ai/rover`)

| Secret | What | How to create |
|--------|------|---------------|
| `WEBSITE_PAT` | GitHub PAT with repo scope for `rtrvr-ai/rtrvr-cloud-website` | GitHub → Settings → Developer settings → Personal access tokens → Fine-grained → select `rtrvr-cloud-website` repo, grant Contents read/write |
| `NPM_TOKEN` | npm access token for `@rtrvr-ai` scope | `npm token create` or npmjs.com → Access Tokens → Generate |

---

## Known Issues & Fixes

### Demo build fails in CI
The `apps/demo` depends on `@rover/sdk` (workspace name) but the SDK was renamed to `@rtrvr-ai/rover` for npm publishing. The CI build filter excludes demo: `pnpm -r --filter '!@rover/demo' build`. Demo is dev-only and not needed for deploy.

### Cross-repo push fails with GITHUB_TOKEN
Default `GITHUB_TOKEN` is scoped to the current repo only. The `deploy-vercel` job pushes to `rtrvr-cloud-website`, so it needs a PAT stored as `WEBSITE_PAT`.

### Cross-origin Worker error
When embed.js is loaded from `rover.rtrvr.ai` but runs on `www.rtrvr.ai`, the Worker can't be constructed cross-origin. Fixed by creating a same-origin blob URL wrapper: `import 'https://rover.rtrvr.ai/worker/worker.js';` (module workers support cross-origin imports).

### Snapshot writes in Rover v2
Rover browser checkpoint sync now writes to `/v2/rover/snapshot` and reads from `/v2/rover/state` using a short-lived `rvrsess_*` session token. Legacy checkpoint action routes are deprecated for Rover browser runtime.

---

## Cloud Website — Rover Integration

**File:** `rtrvr-cloud-website/app/layout.tsx`

The embed script loads from `https://rover.rtrvr.ai/embed.js` and boots with:
```js
window.rover('boot', {
  siteId: 'rtrvr-website',
  publicKey: 'pk_site_...',
  apiBase: 'https://extensionrouter.rtrvr.ai',
  // ... other config
});
```

**CORS/Cache headers** configured in `rtrvr-cloud-website/vercel.json`:
- All rover scripts: `Access-Control-Allow-Origin: *`
- Cache: 5 min browser, 10 min CDN (`max-age=300, s-maxage=600`)
