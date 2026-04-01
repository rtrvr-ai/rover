# rtrvr rolls 🥙

The world's first agentic restaurant. Order protein-packed rolls from your terminal.

> An April Fools' CLI experience that ships as a bin entry in `@rtrvr-ai/rover`.

## Try it

```bash
# Quickest way (no install needed)
npx -p @rtrvr-ai/rover rtrvr-rolls

# If you already have @rtrvr-ai/rover installed
npx rtrvr-rolls

# Or install globally
npm install -g @rtrvr-ai/rover
rtrvr-rolls
```

Requires Node.js 18+.

## What happens

1. A welcome screen with the RTRVR ROLLS ASCII logo
2. An interactive menu — arrow keys to browse, Enter to order
3. A simulated "agent ordering" flow with typewriter effects
4. The reveal: Rover is real, the restaurant is not

## Development

```bash
# Run directly from source
node apps/rolls/bin/cli.mjs

# Build the bundled version (included in SDK build)
pnpm build

# The bundle lands at packages/sdk/dist/rolls-cli.mjs
node packages/sdk/dist/rolls-cli.mjs
```

## How it ships

The CLI is bundled into `packages/sdk/dist/rolls-cli.mjs` by `packages/sdk/scripts/bundle-rolls.mjs` during the SDK build. The SDK's `package.json` declares it as a bin entry:

```json
"bin": {
  "rtrvr-rolls": "./dist/rolls-cli.mjs"
}
```

This means it ships with every `@rtrvr-ai/rover` publish — no separate package needed.
