import assert from 'node:assert/strict';
import test from 'node:test';

globalThis.window ||= {};
globalThis.document ||= {
  addEventListener() {},
  removeEventListener() {},
  querySelector() {
    return null;
  },
};

const { __roverInternalsForTests } = await import('../dist/rover.js');

const scriptShortcut = {
  id: 'find_plan',
  label: 'Find the right plan',
  prompt: 'Help me choose the best plan.',
  routing: 'act',
  runKind: 'guide',
};

const savedShortcut = {
  id: 'saved_workspace',
  label: 'Saved workspace shortcut',
  prompt: 'Run the saved workspace shortcut.',
  routing: 'planner',
  runKind: 'task',
};

test('explicit boot shortcuts replace saved workspace shortcuts', () => {
  const resolved = __roverInternalsForTests.resolveEffectiveShortcutsForTests(
    { siteId: 'site_test', ui: { shortcuts: [scriptShortcut] } },
    { shortcuts: [savedShortcut], businessType: 'support' },
  );

  assert.deepEqual(resolved.map(shortcut => shortcut.id), ['find_plan']);
  assert.equal(resolved[0].runKind, 'guide');
});

test('explicit empty boot shortcuts suppress saved and generated shortcuts', () => {
  const resolved = __roverInternalsForTests.resolveEffectiveShortcutsForTests(
    { siteId: 'site_test', ui: { shortcuts: [] } },
    { shortcuts: [savedShortcut], businessType: 'support' },
  );

  assert.deepEqual(resolved, []);
});

test('omitted boot shortcuts use saved workspace shortcuts', () => {
  const resolved = __roverInternalsForTests.resolveEffectiveShortcutsForTests(
    { siteId: 'site_test' },
    { shortcuts: [savedShortcut], businessType: 'support' },
  );

  assert.deepEqual(resolved.map(shortcut => shortcut.id), ['saved_workspace']);
  assert.equal(resolved[0].runKind, 'task');
});

test('generated business shortcuts only appear when no explicit shortcuts exist', () => {
  const resolved = __roverInternalsForTests.resolveEffectiveShortcutsForTests(
    { siteId: 'site_test' },
    { shortcuts: [], businessType: 'support' },
  );

  assert.equal(resolved.length, 3);
  assert.equal(resolved.every(shortcut => shortcut.id.startsWith('suggested_support_')), true);
});
