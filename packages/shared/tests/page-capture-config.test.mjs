import assert from 'node:assert/strict';
import test from 'node:test';

import { sanitizeRoverPageCaptureConfig } from '../dist/lib/page/index.js';

test('sanitizeRoverPageCaptureConfig keeps only supported keys and clamps numeric values', () => {
  const result = sanitizeRoverPageCaptureConfig({
    disableAutoScroll: true,
    onlyTextContent: false,
    totalBudgetMs: 25,
    pageDataTimeoutMs: 20,
    pdfTextSelectionTimeoutMs: 100,
    adaptiveSettleDebounceMs: 900,
    adaptiveSettleMaxWaitMs: 10,
    adaptiveSettleRetries: 99,
    sparseTreeRetryDelayMs: 1,
    sparseTreeRetryMaxAttempts: 99,
    maxParallelTabs: 12,
  });

  assert.deepEqual(result, {
    disableAutoScroll: true,
    onlyTextContent: false,
    totalBudgetMs: 1500,
    pageDataTimeoutMs: 500,
    pdfTextSelectionTimeoutMs: 150,
    adaptiveSettleDebounceMs: 500,
    adaptiveSettleMaxWaitMs: 120,
    adaptiveSettleRetries: 6,
    sparseTreeRetryDelayMs: 40,
    sparseTreeRetryMaxAttempts: 4,
  });
});
