import { clearScreen, box, orange, green, bold, amber, dim, sleep, showCursor } from './terminal.mjs';

export async function showReveal() {
  clearScreen();

  const lines = [
    '',
    bold(orange('          \u{1F389}  APRIL FOOLS!  \u{1F389}')),
    '',
    `   rtrvr rolls isn't real (yet).`,
    `   But ${bold('Rover')} is.`,
    '',
    '   Rover is an AI agent that actually browses the web',
    '   for your users. It clicks, types, navigates, and',
    `   extracts ${dim('— so your users don\'t have to.')}`,
    '',
    `   No tandoori required.`,
    '',
    green('   npx -p @rtrvr-ai/rover rtrvr-rolls'),
    amber('   https://rtrvr.ai/rover'),
    '',
    dim('   \u{2500}\u{2500} No chickens were harmed.'),
    dim('      Some VCs were mildly offended. \u{2500}\u{2500}'),
    '',
  ];

  console.log(box(lines, { width: 58 }));

  await sleep(500);
  showCursor();
  process.stdout.write('\n');
}
