import assert from 'node:assert/strict';
import test from 'node:test';

import { executeSystemToolCallsSequentially } from '../dist/agent/systemTools.js';

test('click_element navigation output is treated as navigation and stops later calls', async () => {
  const calls = [
    {
      name: 'click_element',
      args: { element_id: 'link-1' },
    },
    {
      name: 'fill_input',
      args: { element_id: 'input-1', text: 'should be skipped' },
    },
  ];

  const responses = [
    {
      success: true,
      output: {
        navigationOutcome: 'new_tab_opened',
        logicalTabId: 7,
        openedInNewTab: true,
      },
    },
  ];
  let index = 0;
  const bridgeRpc = async () => responses[index++] || { success: true };

  const result = await executeSystemToolCallsSequentially({
    calls,
    bridgeRpc,
  });

  assert.equal(result.navigationOccurred, true);
  assert.equal(result.navigationOutcome, 'new_tab_opened');
  assert.equal(result.logicalTabId, 7);
  assert.equal(result.results.length, 2);
  assert.equal(result.results[1].response.status, 'Failure');
  assert.match(
    String(result.results[1].response.error || ''),
    /already ran/i,
  );
});
