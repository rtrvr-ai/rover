# @rover/a11y-tree

Accessibility tree generator for Rover's AI web agent. Produces W3C-compliant a11y tree snapshots optimized for LLM consumption.

## What it does

- Traverses the DOM and builds a structured accessibility tree
- Computes ARIA roles, accessible names, and states per W3C specs (ARIA 1.2, HTML-AAM, AccName 1.2)
- Generates unique RTRVR labels for every interactive element
- Detects event listeners and infers available actions (click, type, select, etc.)
- Supports iframes, Shadow DOM, and SVG elements
- Auto-detects frameworks (React, Vue, Angular, Svelte, etc.)

## Usage

This is an internal package consumed by `@rover/bridge` and `@rover/dom`. It is not published independently.

```ts
import { A11yTreeBuilder } from '@rover/a11y-tree';

const builder = new A11yTreeBuilder({ generateRtvrLabels: true });
const tree = builder.build(document.body);
const text = builder.buildText(document.body);
```

## License

[FSL-1.1-Apache-2.0](../../LICENSE)
