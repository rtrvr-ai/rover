import assert from 'node:assert/strict';
import test from 'node:test';

import {
  parseBrowserReceiptRequest,
  stripBrowserReceiptParams,
} from '../dist/receiptLink.js';

test('browser receipt parser reads the receipt token and preserved anchor', () => {
  assert.deepEqual(
    parseBrowserReceiptRequest('https://example.com/?rover=book%20a%20flight#rover_receipt=rrc_123&rover_anchor=details'),
    {
      receipt: 'rrc_123',
      anchor: 'details',
      signature: 'rover_receipt:rrc_123',
    },
  );
});

test('browser receipt cleanup removes rover receipt params and restores the original anchor', () => {
  assert.equal(
    stripBrowserReceiptParams('https://example.com/checkout?rover=book%20a%20flight#rover_receipt=rrc_123&rover_anchor=details'),
    '/checkout?rover=book+a+flight#details',
  );
});

test('browser receipt parser ignores hashes that do not carry rover receipt data', () => {
  assert.equal(
    parseBrowserReceiptRequest('https://example.com/checkout#details'),
    null,
  );
});
