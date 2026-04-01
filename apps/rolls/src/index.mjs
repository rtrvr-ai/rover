import { LOGO_COLORED } from './art.mjs';
import { MENU_ITEMS } from './menu.mjs';
import {
  clearScreen,
  hideCursor,
  showCursor,
  box,
  selectMenu,
  waitForEnter,
  orange,
  dim,
  bold,
  amber,
  stripAnsi,
} from './terminal.mjs';
import { playOrderFlow } from './order-flow.mjs';
import { showReveal } from './reveal.mjs';

// ── Graceful exit ──
function cleanup() {
  showCursor();
  process.stdout.write('\n');
  process.exit(0);
}
process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);

// ── Screen 1: Welcome ──
async function showWelcome() {
  clearScreen();
  hideCursor();

  const lines = [
    '',
    ...LOGO_COLORED,
    '',
    bold("   Protein-packed rolls for founders who forgot to eat"),
    orange('   The world\'s first agentic restaurant.'),
    '',
    dim('   Press ENTER to view the menu...'),
    '',
  ];

  console.log(box(lines, { width: 58 }));
  await waitForEnter();
}

// ── Screen 2: Menu ──
async function showMenu() {
  const renderMenu = (items, selectedIndex) => {
    clearScreen();
    hideCursor();

    const W = 47;
    const h = '\u{2500}';
    const header = [
      `  \u{250C}${h.repeat(W)}\u{2510}`,
      `  \u{2502}  ${bold('THE MENU')}${' '.repeat(W - 38)}${dim('rtrvr rolls  est. 2026')}  \u{2502}`,
      `  \u{251C}${h.repeat(W)}\u{2524}`,
    ];

    const body = [];
    body.push(`  \u{2502}${' '.repeat(W)}\u{2502}`);

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const pointer = i === selectedIndex ? orange('\u{276F}') : ' ';
      const nameColor = i === selectedIndex ? orange : (s) => s;

      const nameLine = `  ${pointer} ${item.emoji} ${nameColor(bold(item.name))}`;
      const priceLine = `       ${amber(item.price)}`;
      const subLine = `       ${dim(`"${item.subtitle}"`)}`;

      // Pad each line to fit the box
      const padLine = (line) => {
        const stripped = stripAnsi(line);
        const pad = Math.max(0, W - stripped.length);
        return `  \u{2502}${line}${' '.repeat(pad)}\u{2502}`;
      };

      body.push(padLine(nameLine));
      body.push(padLine(priceLine));
      body.push(padLine(subLine));
      body.push(`  \u{2502}${' '.repeat(W)}\u{2502}`);
    }

    const footer = [
      `  \u{2502}  ${dim('\u{2191}/\u{2193} to browse  ENTER to order')}${' '.repeat(W - 33)}\u{2502}`,
      `  \u{2514}${h.repeat(W)}\u{2524}`,
    ];

    process.stdout.write([...header, ...body, ...footer].join('\n') + '\n');
  };

  return selectMenu(MENU_ITEMS, renderMenu);
}

// ── Main ──
export async function run() {
  await showWelcome();
  const selected = await showMenu();
  await playOrderFlow(selected);
  await showReveal();
}
