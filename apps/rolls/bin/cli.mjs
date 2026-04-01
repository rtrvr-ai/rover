#!/usr/bin/env node

import { run } from '../src/index.mjs';

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
