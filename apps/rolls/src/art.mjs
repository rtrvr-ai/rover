import { orange, amber } from './terminal.mjs';

export const LOGO_LINES = [
  ` ___  _____  ___  _   _  ___   ___   ___  _     _    `,
  `| _ \\|_   _|| _ \\| | | || _ \\ | _ \\ / _ \\| |   | |   `,
  `|   /  | |  |   /| |_| ||   / |   /| (_) | |__ | |__ `,
  `|_|_\\  |_|  |_|_\\ \\___/ |_|_\\ |_|_\\ \\___/|____|____| `,
];

export const LOGO_COLORED = LOGO_LINES.map((l) => orange(l));

export const CHICKEN = [
  `    _  _`,
  `   (o >`,
  `   //\\`,
  `   V_/_`,
];

export const CHICKEN_COLORED = CHICKEN.map((l) => amber(l));
