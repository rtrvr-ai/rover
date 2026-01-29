# Contributing to Rover

Thank you for your interest in contributing to Rover! This guide will help you get started.

## Prerequisites

- [Node.js](https://nodejs.org/) 20+
- [pnpm](https://pnpm.io/) 9.12+

## Getting Started

```bash
# Clone the repository
git clone https://github.com/rtrvr-ai/rover.git
cd rover

# Install dependencies
pnpm install

# Build all packages
pnpm build

# Start the demo app (http://localhost:5174)
pnpm dev
```

## Monorepo Structure

| Package | Description |
|---------|-------------|
| `packages/sdk` | Main SDK entry point, bundles everything |
| `packages/worker` | Web Worker agent loop, backend communication |
| `packages/bridge` | MessageChannel RPC between main thread and worker |
| `packages/ui` | Shadow DOM chat widget |
| `packages/dom` | DOM snapshots and system tool execution |
| `packages/a11y-tree` | Accessibility tree generator (W3C compliant) |
| `packages/instrumentation` | Event listener capture and signal providers |
| `packages/shared` | Shared types, constants, and utilities |
| `packages/system-tool-utilities` | System tool helpers |
| `packages/tsconfig` | Shared TypeScript configuration |
| `apps/demo` | Vite demo application |

## Making Changes

1. Create a feature branch from `main`.
2. Make your changes. Run `pnpm build` to verify everything compiles.
3. If you're adding or modifying behavior, add or update tests where applicable.
4. Run `pnpm lint` to check for linting issues.

## Pull Request Process

1. Open a PR against `main` with a clear description of your changes.
2. Ensure the CI build passes.
3. A maintainer will review your PR and may request changes.
4. Once approved, your PR will be squash-merged.

## Contributor License Agreement

By submitting a pull request, you agree that your contributions are licensed under the same [FSL-1.1-Apache-2.0](LICENSE) license that covers the project.

## Questions?

- Open a [GitHub Issue](https://github.com/rtrvr-ai/rover/issues)
- Join our [Discord](https://rtrvr.ai/discord)
