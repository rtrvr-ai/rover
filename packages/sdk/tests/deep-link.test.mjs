import assert from 'node:assert/strict';
import test from 'node:test';

import {
  parseDeepLinkRequest,
  resolveDeepLinkConfig,
  stripDeepLinkParams,
} from '../dist/deepLink.js';

test('deep-link config resolves defaults and stays opt-in', () => {
  assert.deepEqual(resolveDeepLinkConfig(undefined), {
    enabled: false,
    promptParam: 'rover',
    shortcutParam: 'rover_shortcut',
    consume: true,
  });
});

test('shortcut deep links take precedence over prompt deep links', () => {
  const request = parseDeepLinkRequest(
    'https://example.com/products?rover=book%20a%20flight&rover_shortcut=checkout_flow',
    { enabled: true },
  );
  assert.deepEqual(request, {
    kind: 'shortcut',
    paramName: 'rover_shortcut',
    value: 'checkout_flow',
    signature: 'shortcut:rover_shortcut:checkout_flow',
  });
});

test('prompt deep links trim whitespace and ignore empty params', () => {
  assert.equal(
    parseDeepLinkRequest('https://example.com/?rover=%20%20%20', { enabled: true }),
    null,
  );
  assert.deepEqual(
    parseDeepLinkRequest('https://example.com/?rover=%20book%20a%20flight%20', { enabled: true }),
    {
      kind: 'prompt',
      paramName: 'rover',
      value: 'book a flight',
      signature: 'prompt:rover:book a flight',
    },
  );
});

test('custom param names are honored and conflicting names are normalized apart', () => {
  const config = resolveDeepLinkConfig({
    enabled: true,
    promptParam: 'agent',
    shortcutParam: 'agent',
    consume: false,
  });
  assert.equal(config.promptParam, 'agent');
  assert.notEqual(config.shortcutParam, config.promptParam);
  assert.equal(config.consume, false);
});

test('deep-link cleanup removes Rover params and preserves unrelated search + hash', () => {
  assert.equal(
    stripDeepLinkParams(
      'https://example.com/checkout?foo=1&rover=book%20a%20flight&bar=2&rover_shortcut=checkout_flow#shipping',
      { enabled: true },
    ),
    '/checkout?foo=1&bar=2#shipping',
  );
});
