import assert from 'node:assert/strict';
import test from 'node:test';

import { createRoverScriptTagSnippet } from '../dist/previewBootstrap.js';

test('script tag snippet includes default-on Rover discovery marker and service links', () => {
  const snippet = createRoverScriptTagSnippet({
    siteId: 'site_123',
    publicKey: 'pk_site_123',
  });

  assert.match(snippet, /application\/agent\+json/);
  assert.match(snippet, /data-rover-agent-discovery="marker"/);
  assert.match(snippet, /rel="service-desc"/);
  assert.match(snippet, /rel="service-doc"/);
  assert.match(snippet, /data-site-id="site_123"/);
});
