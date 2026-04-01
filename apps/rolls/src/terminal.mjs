// ── ANSI escape helpers (zero deps) ──

export const ESC = '\x1b[';

// Colors
export const orange = (s) => `\x1b[38;2;255;76;0m${s}\x1b[0m`;
export const amber = (s) => `\x1b[38;2;255;184;0m${s}\x1b[0m`;
export const green = (s) => `\x1b[38;2;74;222;128m${s}\x1b[0m`;
export const dim = (s) => `\x1b[2m${s}\x1b[0m`;
export const bold = (s) => `\x1b[1m${s}\x1b[0m`;
export const white = (s) => `\x1b[97m${s}\x1b[0m`;
export const red = (s) => `\x1b[31m${s}\x1b[0m`;
export const cyan = (s) => `\x1b[36m${s}\x1b[0m`;

// Screen
export const clearScreen = () => process.stdout.write(`${ESC}2J${ESC}H`);
export const hideCursor = () => process.stdout.write(`${ESC}?25l`);
export const showCursor = () => process.stdout.write(`${ESC}?25h`);
export const moveTo = (row, col) => process.stdout.write(`${ESC}${row};${col}H`);

// Typewriter effect
export function typewrite(text, delay = 40) {
  return new Promise((resolve) => {
    let i = 0;
    const tick = () => {
      if (i < text.length) {
        process.stdout.write(text[i]);
        i++;
        setTimeout(tick, delay);
      } else {
        resolve();
      }
    };
    tick();
  });
}

// Sleep helper
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Wait for a keypress
export function waitForEnter() {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }
    process.stdin.resume();
    process.stdin.once('data', (key) => {
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(false);
      }
      // Ctrl+C
      if (key[0] === 3) {
        showCursor();
        process.exit(0);
      }
      resolve();
    });
  });
}

// Arrow key menu selector
export function selectMenu(items, renderFn) {
  return new Promise((resolve) => {
    let selected = 0;

    const render = () => {
      renderFn(items, selected);
    };

    render();

    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }
    process.stdin.resume();
    process.stdin.setEncoding('utf8');

    const onData = (key) => {
      // Ctrl+C
      if (key === '\u0003') {
        process.stdin.removeListener('data', onData);
        if (process.stdin.isTTY) {
          process.stdin.setRawMode(false);
        }
        showCursor();
        process.exit(0);
      }

      // Up arrow
      if (key === '\u001b[A') {
        selected = (selected - 1 + items.length) % items.length;
        render();
      }
      // Down arrow
      if (key === '\u001b[B') {
        selected = (selected + 1) % items.length;
        render();
      }
      // Enter
      if (key === '\r' || key === '\n') {
        process.stdin.removeListener('data', onData);
        if (process.stdin.isTTY) {
          process.stdin.setRawMode(false);
        }
        resolve(items[selected]);
      }
    };

    process.stdin.on('data', onData);
  });
}

// Center text in a given width
export function center(text, width) {
  const stripped = stripAnsi(text);
  const pad = Math.max(0, Math.floor((width - stripped.length) / 2));
  return ' '.repeat(pad) + text;
}

// Strip ANSI codes for length calculation
export function stripAnsi(s) {
  return s.replace(/\x1b\[[0-9;]*m/g, '');
}

// Draw a box around lines
export function box(lines, { width = 56, padding = 2, double = true } = {}) {
  const [tl, tr, bl, br, h, v] = double
    ? ['╔', '╗', '╚', '╝', '═', '║']
    : ['┌', '┐', '└', '┘', '─', '│'];

  const inner = width - 2;
  const out = [];
  out.push(`  ${tl}${h.repeat(inner)}${tr}`);

  for (const line of lines) {
    const stripped = stripAnsi(line);
    const rightPad = Math.max(0, inner - padding - stripped.length);
    out.push(`  ${v}${' '.repeat(padding)}${line}${' '.repeat(rightPad)}${v}`);
  }

  out.push(`  ${bl}${h.repeat(inner)}${br}`);
  return out.join('\n');
}
