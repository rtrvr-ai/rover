import assert from 'node:assert/strict';
import test from 'node:test';

import { AgentMemory } from '../dist/memory.js';
import { VisitTracker } from '../dist/trajectory.js';

test('same page with two tasks creates two distinct visits', () => {
  const tracker = new VisitTracker({ siteId: 'site-demo' }, { key: 'agent-1', name: 'Agent 1' });

  tracker.handleTaskStarted({ taskId: 'task-1' });
  tracker.handleRunStarted({ taskId: 'task-1', runId: 'run-1', taskBoundaryId: 'boundary-1', text: 'buy item' });
  tracker.handleToolStart({ runId: 'run-1', call: { name: 'click', args: { selector: '#buy' } } });
  tracker.handleToolResult({ runId: 'run-1', call: { name: 'click', args: { selector: '#buy' } }, result: { success: true } });
  tracker.handleRunLifecycle('run_completed', {
    taskId: 'task-1',
    runId: 'run-1',
    taskBoundaryId: 'boundary-1',
    terminalState: 'completed',
    taskComplete: true,
    endedAt: Date.now(),
  });

  tracker.handleTaskStarted({ taskId: 'task-2' });
  tracker.handleRunStarted({ taskId: 'task-2', runId: 'run-2', taskBoundaryId: 'boundary-2', text: 'find pricing' });
  tracker.handleToolStart({ runId: 'run-2', call: { name: 'extract', args: { selector: '.price' } } });
  tracker.handleToolResult({ runId: 'run-2', call: { name: 'extract', args: { selector: '.price' } }, result: { success: true } });
  tracker.handleRunLifecycle('run_completed', {
    taskId: 'task-2',
    runId: 'run-2',
    taskBoundaryId: 'boundary-2',
    terminalState: 'completed',
    taskComplete: true,
    endedAt: Date.now(),
  });

  const visits = tracker.listVisits().sort((a, b) => a.visitId.localeCompare(b.visitId));
  assert.equal(visits.length, 2);
  assert.equal(visits[0].visitId, 'task-1');
  assert.equal(visits[1].visitId, 'task-2');
  assert.equal(visits[0].metrics.totalSteps, 1);
  assert.equal(visits[1].metrics.totalSteps, 1);
  assert.notEqual(visits[0].runSummaries[0].runId, visits[1].runSummaries[0].runId);
});

test('same agent revisit loads prior notes into prompt context', async () => {
  const api = {
    getNotes: async params => {
      if (params.visibility === 'private') {
        return [{
          noteId: 'note-1',
          siteId: 'site-demo',
          visitId: 'visit-1',
          agentKey: 'agent-1',
          type: 'learning',
          title: 'Pricing page',
          content: 'Pricing lives under /pricing and the CTA is near the footer.',
          tags: ['pricing'],
          linkedUrl: '/pricing',
          visibility: 'private',
          provenance: 'agent_authored',
          createdAt: Date.now(),
        }];
      }
      return [];
    },
    saveNote: async () => true,
  };

  const memory = new AgentMemory(api, { siteId: 'site-demo' }, {
    resolveIdentity: async () => ({ key: 'agent-1', name: 'Agent 1' }),
    getActiveVisit: () => undefined,
  });

  const context = await memory.buildPromptContext();
  assert.match(context, /Pricing page/);
  assert.match(context, /CTA is near the footer/i);
});

test('shared-note access obeys visibility settings', async () => {
  const calls = [];
  const api = {
    getNotes: async params => {
      calls.push(params);
      return params.visibility === 'shared'
        ? [{
            noteId: 'shared-1',
            siteId: 'site-demo',
            visitId: 'visit-2',
            agentKey: 'agent-2',
            type: 'tip',
            content: 'Shared note',
            visibility: 'shared',
            provenance: 'agent_authored',
            createdAt: Date.now(),
          }]
        : [];
    },
    saveNote: async () => true,
  };

  const privateOnlyMemory = new AgentMemory(api, {
    siteId: 'site-demo',
    memory: { sharedAccess: 'private_only' },
  }, {
    resolveIdentity: async () => ({ key: 'agent-1' }),
    getActiveVisit: () => undefined,
  });
  const privateOnlySnapshot = await privateOnlyMemory.refresh(true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].visibility, 'private');
  assert.equal(privateOnlySnapshot.sharedNotes.length, 0);

  calls.length = 0;
  const sharedMemory = new AgentMemory(api, {
    siteId: 'site-demo',
    memory: { sharedAccess: 'read_shared' },
  }, {
    resolveIdentity: async () => ({ key: 'agent-1' }),
    getActiveVisit: () => undefined,
  });
  const sharedSnapshot = await sharedMemory.refresh(true);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls.map(call => call.visibility), ['private', 'shared']);
  assert.equal(sharedSnapshot.sharedNotes.length, 1);
});

