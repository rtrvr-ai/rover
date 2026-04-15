import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizePendingRunResumeReason } from '../dist/resumeReasons.js';

test('pending-run resume reason normalization keeps worker_interrupted', () => {
  assert.equal(
    normalizePendingRunResumeReason('worker_interrupted'),
    'worker_interrupted',
  );
  assert.equal(
    normalizePendingRunResumeReason('cross_host_navigation'),
    'cross_host_navigation',
  );
  assert.equal(
    normalizePendingRunResumeReason('unexpected_reason'),
    undefined,
  );
});
