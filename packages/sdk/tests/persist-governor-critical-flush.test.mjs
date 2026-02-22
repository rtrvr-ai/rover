import assert from 'node:assert/strict';
import test from 'node:test';

import { RoverCloudCheckpointClient } from '../dist/cloudCheckpoint.js';

function createClient(overrides = {}) {
  return new RoverCloudCheckpointClient({
    siteId: 'site_test',
    visitorId: 'visitor_test',
    getSessionToken: () => 'rvrsess_test_token',
    buildCheckpoint: () => ({
      version: 1,
      siteId: 'site_test',
      visitorId: 'visitor_test',
      sessionId: 'session_test',
      updatedAt: Date.now(),
      sharedState: {},
      runtimeState: {},
    }),
    onCheckpoint: () => {},
    ...overrides,
  });
}

test('persist/write governor enforces sane minimum intervals', () => {
  const client = createClient({
    flushIntervalMs: 50,
    pullIntervalMs: 50,
    minFlushIntervalMs: 10,
  });

  assert.ok(client.flushIntervalMs >= 2000);
  assert.ok(client.pullIntervalMs >= 2000);
  assert.ok(client.minFlushIntervalMs >= 1000);
});

test('persist/write governor keeps configurable intervals when above minima', () => {
  const client = createClient({
    flushIntervalMs: 8000,
    pullIntervalMs: 9000,
    minFlushIntervalMs: 2500,
  });

  assert.equal(client.flushIntervalMs, 8000);
  assert.equal(client.pullIntervalMs, 9000);
  assert.equal(client.minFlushIntervalMs, 2500);
});
