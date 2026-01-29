import assert from 'node:assert/strict';
import test from 'node:test';

import { RoverServerRuntimeClient } from '../dist/serverRuntime.js';

test('projection callback is gated by digest/material change', () => {
  const projections = [];
  const client = new RoverServerRuntimeClient({
    siteId: 'site_1',
    getSessionId: () => 'session_1',
    getBootstrapToken: () => 'pk_site_example',
    getHost: () => 'example.com',
    getPageUrl: () => 'https://example.com',
    onProjection: (projection) => projections.push(projection),
  });

  const applyProjection = client.applyProjection.bind(client);

  applyProjection({
    sessionId: 'session_1',
    epoch: 1,
    events: [],
    tabs: [],
    snapshotMeta: { updatedAt: 100, digest: 'sha:1' },
  });
  applyProjection({
    sessionId: 'session_1',
    epoch: 1,
    events: [],
    tabs: [],
    snapshotMeta: { updatedAt: 100, digest: 'sha:1' },
  });
  applyProjection({
    sessionId: 'session_1',
    epoch: 1,
    events: [],
    tabs: [],
    snapshotMeta: { updatedAt: 101, digest: 'sha:2' },
  });

  assert.equal(projections.length, 2);
  assert.equal(projections[0].snapshotMeta?.digest, 'sha:1');
  assert.equal(projections[1].snapshotMeta?.digest, 'sha:2');
});
