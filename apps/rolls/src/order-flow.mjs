import { typewrite, sleep, green, dim, orange, red, cyan, clearScreen } from './terminal.mjs';

export async function playOrderFlow(item) {
  clearScreen();

  const cmd = `  $ rover order --item "${item.name}" --extra-spicy`;
  await typewrite(green(cmd), 30);
  process.stdout.write('\n\n');

  const lines = [
    { text: 'Booting agent runtime...', delay: 600 },
    { text: 'Authenticating with rtrvr-rolls-HQ...', delay: 800 },
    { text: 'Agent connected. Model: gpt-4-turbo-tandoori', delay: 500 },
    { text: 'Navigating to kitchen API...', delay: 900 },
    { text: `Locating: "${item.name}"`, delay: 700 },
    { text: 'Adding to cart... done', delay: 500 },
    { text: 'Applying coupon: DEMO-DAY-DISCOUNT', delay: 600 },
    { text: 'Coupon rejected: this is not a real restaurant', delay: 400, color: 'red' },
    { text: 'Processing payment via npm credits...', delay: 800 },
    { text: 'Contacting kitchen microservice...', delay: 1000 },
    { text: "Kitchen API returned: 418 I'm a teapot", delay: 500, color: 'red' },
    { text: 'Retrying with exponential backoff and extra masala...', delay: 1200 },
    { text: 'Hmm...', delay: 800 },
    { text: 'Wait a second...', delay: 1000 },
    { text: '...', delay: 1500 },
  ];

  for (const line of lines) {
    const prefix = dim('  [rover] ');
    let text = line.text;
    if (line.color === 'red') {
      text = red(text);
    } else {
      text = cyan(text);
    }
    process.stdout.write(prefix);
    await typewrite(text, 25);
    process.stdout.write('\n');
    await sleep(line.delay);
  }

  await sleep(500);
}
