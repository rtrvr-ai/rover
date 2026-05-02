import assert from 'node:assert/strict';
import test from 'node:test';

globalThis.indexedDB = undefined;

function createSessionStorage() {
  const values = new Map();
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    removeItem(key) {
      values.delete(key);
    },
    clear() {
      values.clear();
    },
  };
}

globalThis.window = {
  sessionStorage: createSessionStorage(),
};

const { createConversationHistoryStore } = await import('../dist/conversationHistory.js');

test('summary-only upsert preserves an existing transcript payload', async () => {
  const store = createConversationHistoryStore({
    siteId: `site-${Date.now()}`,
    visitorId: 'visitor-preserve',
  });
  const payload = {
    uiMessages: [{ id: 'msg-1', role: 'user', text: 'Show pricing', ts: 1000 }],
    timeline: [],
  };

  store.upsert({
    summary: {
      conversationId: 'conv-1',
      title: 'Show pricing',
      updatedAt: 1000,
    },
    payload,
  });
  store.upsert({
    summary: {
      conversationId: 'conv-1',
      title: 'Show pricing updated',
      updatedAt: 2000,
    },
  });

  const record = await store.get('conv-1');
  assert.equal(record?.summary.title, 'Show pricing updated');
  assert.deepEqual(record?.payload, payload);
});

test('summary-only upsert without payload indexes the chat but does not create a fake restorable record', async () => {
  const store = createConversationHistoryStore({
    siteId: `site-${Date.now()}`,
    visitorId: 'visitor-summary-only',
  });

  store.upsert({
    summary: {
      conversationId: 'conv-summary',
      title: 'Remote summary only',
      updatedAt: 3000,
    },
  });
  await new Promise(resolve => setTimeout(resolve, 0));

  const list = await store.list();
  const record = await store.get('conv-summary');
  assert.deepEqual(list.map(item => item.conversationId), ['conv-summary']);
  assert.equal(record, null);
});
