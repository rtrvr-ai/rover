# A11y Tree Package for AI Web Agents

A lightweight, client-side accessibility tree generator optimized for AI web agents. Built with strict adherence to W3C ARIA standards and designed for browser extension environments.

## Features

- **Client-side only**: No server dependencies, perfect for browser extensions
- **Minimal data footprint**: Only essential properties for AI agent navigation
- **W3C compliant**: Follows ARIA 1.2, HTML-ARIA, and HTML-AAM specifications
- **Framework detection**: Automatically detects React, Vue, Angular, and other frameworks
- **Intelligent labeling**: Smart rtrvr label generation for element identification
- **Iframe support**: Handles cross-origin and same-origin iframes

## Architecture

```
a11y-tree/
├── src/
│   ├── core/
│   │   ├── TreeBuilder.ts          # Main tree construction
│   │   ├── NodeCollector.ts        # DOM traversal and node collection
│   │   ├── NodeLabeler.ts          # Element labeling system
│   │   └── TreeRepresentation.ts   # Tree formatting for LLM
│   ├── accname/
│   │   ├── AccNameComputation.ts   # W3C accessible name computation
│   │   ├── AccNameRules.ts         # Rules 2A-2I implementation
│   │   └── AccNameContext.ts       # Context management
│   ├── roles/
│   │   ├── RoleComputation.ts      # ARIA role determination
│   │   ├── RoleMap.ts              # W3C role mappings
│   │   └── ImplicitRoles.ts        # HTML implicit roles
│   ├── attributes/
│   │   ├── AttributeCollector.ts   # Attribute extraction
│   │   ├── StateProperties.ts      # ARIA states/properties
│   │   └── StyleAnalyzer.ts        # CSS style analysis
│   ├── actions/
│   │   ├── ActionAnalyzer.ts       # Action hint generation
│   │   ├── ListenerDetection.ts    # Event listener analysis
│   │   └── InteractionPatterns.ts  # Interaction pattern detection
│   ├── constants/
│   │   ├── W3CConstants.ts         # W3C specification constants
│   │   ├── ARIAConstants.ts        # ARIA roles and attributes
│   │   └── DOMConstants.ts         # DOM-related constants
│   ├── utils/
│   │   ├── DOMUtils.ts             # DOM manipulation utilities
│   │   ├── TableUtils.ts           # Table structure analysis
│   │   ├── SVGUtils.ts             # SVG handling
│   │   └── FrameworkDetection.ts   # Framework detection
│   ├── types/
│   │   └── A11yTypes.ts            # TypeScript type definitions
│   └── index.ts                     # Main exports
```

# a11y-tree-package

A comprehensive accessibility tree generator for AI Web Agents, designed for browser extensions and automation tools. This package creates exhaustive, W3C-compliant accessibility trees optimized for LLM consumption.

## Features

- 🎯 **Exhaustive Tree Generation** - Captures ALL elements on the page for comprehensive LLM understanding
- 🏷️ **RTRVR Labeling System** - Unique, actionable labels for every interactive element
- 🤖 **AI-Optimized Output** - Structured data perfect for LLM prompting and navigation
- 🔍 **Framework Detection** - Automatically detects React, Vue, Angular, Svelte, and more
- ♿ **W3C Compliant** - Follows ARIA 1.2, HTML-ARIA, and HTML-AAM specifications
- 🎭 **Role Computation** - Comprehensive role detection matching original implementation
- 📝 **Name Computation** - Full W3C Accessible Name and Description computation
- 🎪 **Event Detection** - Detects all event listeners and infers actions
- 🖼️ **Iframe Support** - Processes iframe content (same-origin)
- 🎨 **SVG Support** - Handles SVG elements with proper role assignment
- 🏗️ **Shadow DOM Ready** - Works with web components and shadow roots

## Installation

```bash
npm install a11y-tree-package
```

## Quick Start

```javascript
import { A11yTreeBuilder, initialize } from 'a11y-tree-package';

// Initialize (injects listener detection for browser extensions)
initialize();

// Create builder with configuration
const builder = new A11yTreeBuilder({
  includeHidden: false,        // Include hidden elements
  includeTextNodes: true,       // Include text nodes
  mergeAdjacentText: true,      // Merge adjacent text nodes
  maxDepth: 100,                // Maximum tree depth
  maxNodes: 10000,              // Maximum nodes to process
  generateRtvrLabels: true,     // Generate RTRVR labels
  includeFramework: true,       // Detect frameworks
  includeListeners: true,       // Detect event listeners
  processIframes: true,         // Process iframe content
  crossOriginIframes: false     // Handle cross-origin iframes
});

// Build accessibility tree
const tree = builder.build(document.body);

// Get text representation for LLM
const treeText = builder.buildText(document.body);
// console.log(treeText);
```

## Core Concepts

### A11y Tree Structure

The tree consists of nodes with comprehensive properties:

```typescript
interface A11yNode {
  // Identification
  id: number;                  // Unique node ID
  rtvrLabel?: string;          // RTRVR label for interaction
  
  // Semantics
  role?: AriaRole;             // ARIA role
  name?: string;               // Accessible name
  
  // Hierarchy
  parent?: number;             // Parent node ID
  children?: number[];         // Child node IDs
  
  // Navigation
  href?: string;               // URL for links/actions
  
  // Interaction
  actions?: string[];          // Available actions
  listeners?: string[];        // Event listeners
  disabled?: boolean;          // Disabled state
  
  // Content
  text?: string;               // Text content
  value?: string;              // Input value
  placeholder?: string;        // Placeholder text
  
  // Framework
  framework?: FrameworkType;   // Detected framework
  
  // And many more comprehensive properties...
}
```

### RTRVR Labels

RTRVR (Retriever) labels provide unique, actionable identifiers:

```
[id=123]                     // Simple ID
[id=45|role=button]          // With role
[id=67|name="Submit"]        // With name
[id=89|href="/page"]         // With navigation target
```

### Actions

The package detects and infers actions from:
- Event listeners (click, input, change, etc.)
- Element roles and types
- Framework-specific patterns
- Interactive attributes

Common actions:
- `click` - Clickable elements
- `type` - Text input fields
- `select` - Dropdowns and selects
- `toggle` - Checkboxes and switches
- `submit` - Form submission
- `drag` - Draggable elements
- `swipe` - Swipeable content
- `navigate` - Links and navigation

## Usage Examples

### Building Tree for Entire Page

```javascript
const builder = new A11yTreeBuilder();
const tree = builder.build(document.body);

// Access nodes
// console.log('Total nodes:', Object.keys(tree.nodes).length);
// console.log('Framework:', tree.framework);
// console.log('Title:', tree.title);
```

### Finding Interactive Elements

```javascript
const builder = new A11yTreeBuilder();
const tree = builder.build();

// Find all interactive elements
const interactive = Object.values(tree.nodes).filter(node => 
  node.rtvrLabel && !node.disabled && node.actions?.length > 0
);

// Create action map for AI agent
const actionMap = interactive.map(node => ({
  id: node.id,
  label: node.rtvrLabel,
  name: node.name,
  actions: node.actions,
  href: node.href
}));
```

### Interacting with Elements

```javascript
const builder = new A11yTreeBuilder();
builder.build();

// Find element by RTRVR label
const node = builder.findByLabel('[id=123]');
if (node) {
  // Get DOM element
  const element = builder.getElementById(123);
  
  // Perform action
  if (node.actions?.includes('click')) {
    element.click();
  } else if (node.actions?.includes('type')) {
    element.value = 'AI Agent Input';
  }
}
```

### Processing Forms

```javascript
const form = document.querySelector('form');
const builder = new A11yTreeBuilder();
const tree = builder.build(form);

// Find all form inputs
const inputs = Object.values(tree.nodes).filter(node => 
  node.actions?.includes('type') || 
  node.actions?.includes('select') ||
  node.actions?.includes('toggle')
);

// Fill form programmatically
inputs.forEach(node => {
  const element = builder.getElementById(node.id);
  if (node.actions?.includes('type')) {
    element.value = 'Test value';
  }
});
```

### Handling Dynamic Content

```javascript
const builder = new A11yTreeBuilder();
let tree = builder.build();

// Watch for DOM changes
const observer = new MutationObserver((mutations) => {
  const hasSignificantChanges = mutations.some(m => 
    m.type === 'childList' && 
    (m.addedNodes.length > 0 || m.removedNodes.length > 0)
  );
  
  if (hasSignificantChanges) {
    tree = builder.build();
    // console.log('Tree rebuilt');
  }
});

observer.observe(document.body, {
  childList: true,
  subtree: true
});
```

### Browser Extension Integration

```javascript
// Content script
import { A11yTreeBuilder, initialize } from 'a11y-tree-package';

// Initialize on load
initialize();

// Listen for messages from extension
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'buildTree') {
    const builder = new A11yTreeBuilder();
    const tree = builder.build();
    sendResponse({ tree });
  } else if (request.action === 'clickElement') {
    const builder = new A11yTreeBuilder();
    builder.build();
    const element = builder.getElementById(request.elementId);
    if (element) {
      element.click();
      sendResponse({ success: true });
    }
  }
  return true; // Keep channel open
});
```

### AI Agent Prompt Generation

```javascript
function generatePrompt() {
  const builder = new A11yTreeBuilder({
    mergeAdjacentText: true,
    maxNodes: 500 // Limit for token constraints
  });
  
  const treeText = builder.buildText();
  
  return `
Navigate the following web page:

${treeText}

Available commands:
- click [id=X]: Click element
- type [id=X] "text": Type text
- select [id=X] "option": Select option
- scroll [direction]: Scroll page

What would you like to do?
`;
}
```

## Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `includeHidden` | boolean | false | Include hidden elements |
| `includeTextNodes` | boolean | true | Include text nodes |
| `mergeAdjacentText` | boolean | true | Merge adjacent text nodes |
| `maxDepth` | number | 100 | Maximum traversal depth |
| `maxNodes` | number | 10000 | Maximum nodes to process |
| `generateRtvrLabels` | boolean | true | Generate RTRVR labels |
| `includeFramework` | boolean | true | Detect frameworks |
| `includeListeners` | boolean | true | Detect event listeners |
| `processIframes` | boolean | true | Process iframe content |
| `crossOriginIframes` | boolean | false | Handle cross-origin iframes |

## API Reference

### A11yTreeBuilder

Main class for building accessibility trees.

#### Methods

- `build(root?: Element): A11yTree` - Build tree from root element
- `buildText(root?: Element): string` - Get text representation
- `findByLabel(label: string): A11yNode | undefined` - Find node by RTRVR label
- `getHref(elementId: number): string | undefined` - Get href for element
- `getElementById(rtvrId: number): Element | null` - Get DOM element by ID

### TreeBuilder

Core tree building orchestrator.

#### Methods

- `buildTree(root: Element): A11yTree` - Build complete tree
- `findByLabel(label: string): A11yNode | undefined` - Find node by label
- `getHref(elementId: number): string | undefined` - Get element href
- `getElementByRtvrId(id: number): Element | null` - Get DOM element

### Node Properties

Comprehensive properties captured for each node:

- **Identification**: id, nodeType, nodeName, tagName
- **ARIA**: role, name, description, properties, states
- **Hierarchy**: parent, children, ariaOwnedChildNodes
- **States**: disabled, focused, isHidden, isContentEditable
- **Attributes**: Full attribute map
- **Styles**: Relevant computed styles
- **Navigation**: href (combined href/src/data/action)
- **Interaction**: actions, listeners, draggable, swipe capabilities
- **Content**: text, value, placeholder
- **Framework**: Detected framework type
- **Special**: SVG structure, iframe info, table/form specifics

## Framework Detection

Automatically detects:
- React (including Next.js, Gatsby)
- Vue.js (including Nuxt.js)
- Angular
- Svelte (including SvelteKit)
- Preact
- Ember.js
- Alpine.js
- Stimulus
- Vanilla JavaScript

## W3C Compliance

The package strictly follows:
- [ARIA 1.2 Specification](https://www.w3.org/TR/wai-aria-1.2/)
- [HTML-ARIA](https://www.w3.org/TR/html-aria/)
- [HTML-AAM](https://www.w3.org/TR/html-aam-1.0/)
- [AccName 1.2](https://www.w3.org/TR/accname-1.2/)

## Performance Considerations

- **Lazy Evaluation**: Properties computed on-demand
- **Caching**: ID management and label caching
- **Limits**: Configurable depth and node limits
- **Optimization**: Merges adjacent text nodes
- **Pruning**: Skips hidden elements by default

## Browser Compatibility

- Chrome/Edge 90+
- Firefox 88+
- Safari 14+
- Opera 76+

## Contributing

Contributions are welcome! Please read our [Contributing Guide](CONTRIBUTING.md) for details.

## License

MIT © AI Web Agent Team

## Acknowledgments

This package builds upon W3C specifications and best practices from the accessibility community. Special thanks to the original codebase that inspired this improved implementation.

## Support

For issues, questions, or suggestions, please [open an issue](https://github.com/your-org/a11y-tree-package/issues).