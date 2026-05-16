import test from 'node:test';
import assert from 'node:assert/strict';
import { createTimelineNarrationScheduler } from './timeline-narration.js';

type AnyEvent = Record<string, unknown>;

function makeToolStartEvent(kind: string, narration: string, opts?: Partial<AnyEvent>): AnyEvent {
  return {
    kind: 'tool_start',
    actionCue: { kind, primaryElementId: undefined, targetLabel: undefined },
    narration,
    narrationActive: true,
    speechProvider: 'browser',
    ...opts,
  };
}

function makeScheduler() {
  const spoken: string[] = [];
  // Defer-the-callback frame mock: scheduleEvent queues items; calling flush()
  // fires the latest pending frame callback so the queue actually drains.
  let pendingCb: FrameRequestCallback | null = null;
  const scheduler = createTimelineNarrationScheduler({
    isEnabled: () => true,
    speak: text => { spoken.push(text); },
    scheduleFrame: (cb): unknown => { pendingCb = cb; return null; },
    cancelFrame: () => { pendingCb = null; },
  });
  function flush(): void {
    const cb = pendingCb;
    pendingCb = null;
    if (cb) cb(Date.now());
  }
  return { scheduler, spoken, flush };
}

test('three quick same-kind clicks collapse to one narration (newest wins)', () => {
  const { scheduler, spoken, flush } = makeScheduler();
  scheduler.scheduleEvent(makeToolStartEvent('click', 'Clicking the first button.') as any);
  scheduler.scheduleEvent(makeToolStartEvent('click', 'Clicking the second button.') as any);
  scheduler.scheduleEvent(makeToolStartEvent('click', 'Clicking the third button.') as any);
  flush();
  assert.equal(spoken.length, 1, `expected 1 spoken narration, got: ${JSON.stringify(spoken)}`);
  assert.equal(spoken[0], 'Clicking the third button.', `expected newest click, got "${spoken[0]}"`);
});

test('different kinds (click then type) both narrate — no false collapse', () => {
  const { scheduler, spoken, flush } = makeScheduler();
  scheduler.scheduleEvent(makeToolStartEvent('click', 'Clicking Sign In.') as any);
  scheduler.scheduleEvent(makeToolStartEvent('type', 'Typing in the email.') as any);
  flush();
  // Both 'click' and 'type' are distinct kinds — both must be present.
  assert.ok(spoken.includes('Clicking Sign In.'), `expected click narration: ${JSON.stringify(spoken)}`);
  assert.ok(spoken.includes('Typing in the email.'), `expected type narration: ${JSON.stringify(spoken)}`);
});

test('mixed planner + ACT for 3 steps: ACT narrations win, no spurious catch-up', () => {
  const { scheduler, spoken, flush } = makeScheduler();
  scheduler.scheduleEvent(makeToolStartEvent('act_on_page', "First I'll sign you in.") as any);
  scheduler.scheduleEvent(makeToolStartEvent('click', 'Clicking Sign In.') as any);
  scheduler.scheduleEvent(makeToolStartEvent('act_on_page', "Now I'll fill in details.") as any);
  scheduler.scheduleEvent(makeToolStartEvent('type', 'Typing in the email.') as any);
  scheduler.scheduleEvent(makeToolStartEvent('act_on_page', "Now I'll submit.") as any);
  scheduler.scheduleEvent(makeToolStartEvent('click', 'Clicking Submit.') as any);
  flush();
  // ACT narrations must reach the speaker. With same-kind collapse, the two
  // 'click' items merge to the latest; 'type' stays distinct.
  assert.ok(
    spoken.some(s => s === 'Clicking Submit.') || spoken.some(s => s === 'Clicking Sign In.'),
    `expected at least one click narration, got: ${JSON.stringify(spoken)}`,
  );
  assert.ok(spoken.some(s => s === 'Typing in the email.'), `expected type narration: ${JSON.stringify(spoken)}`);
  // No catch-up — we only dropped normal-priority planner items (if any).
  assert.ok(
    !spoken.some(s => /Continuing through the form/.test(s)),
    `unexpected catch-up: ${JSON.stringify(spoken)}`,
  );
});

test('catch-up still fires when many distinct high-priority narrations actually drop', () => {
  const { scheduler, spoken, flush } = makeScheduler();
  // Schedule 10 alternating high-priority actions with DISTINCT kinds (so the
  // same-kind collapse can't merge them) — must over-budget by speech time.
  const distinctKinds = ['click', 'type', 'select', 'upload', 'navigate'];
  for (let i = 0; i < 10; i++) {
    const kind = distinctKinds[i % distinctKinds.length];
    scheduler.scheduleEvent(makeToolStartEvent(kind, `Long narration number ${i} that takes time to say aloud.`) as any);
  }
  flush();
  // The catch-up should appear because we genuinely had to drop 'high' items.
  assert.ok(
    spoken.some(s => /Continuing through the form/.test(s)),
    `expected catch-up for high-priority drops: ${JSON.stringify(spoken)}`,
  );
});

test('a planner-only burst (all normal priority) does NOT trigger catch-up', () => {
  const { scheduler, spoken, flush } = makeScheduler();
  // 8 normal-priority planner narrations — only dropped 'normal', no high.
  for (let i = 0; i < 8; i++) {
    scheduler.scheduleEvent(makeToolStartEvent('act_on_page', `Planner phase ${i} narration long enough to chew budget.`) as any);
  }
  flush();
  // Same-kind collapse may merge most of these to one. No 'high' was ever
  // dropped, so the catch-up must not appear.
  assert.ok(
    !spoken.some(s => /Continuing through the form/.test(s)),
    `unexpected catch-up on normal-only burst: ${JSON.stringify(spoken)}`,
  );
});

test('tool_result events with narration text ARE spoken (regression: were silently dropped at scheduler entry)', () => {
  const { scheduler, spoken, flush } = makeScheduler();
  // Worker-derived result summary (deriveResponseNarrationFromOutput).
  scheduler.scheduleEvent({
    kind: 'tool_result',
    actionCue: { kind: 'send_email', primaryElementId: undefined, targetLabel: undefined },
    narration: 'Email sent successfully.',
    narrationActive: true,
    speechProvider: 'browser',
  } as any);
  flush();
  assert.ok(
    spoken.includes('Email sent successfully.'),
    `expected tool_result narration to be spoken, got: ${JSON.stringify(spoken)}`,
  );
});

test('tool_result without narration text is silently ignored (no speech, no crash)', () => {
  const { scheduler, spoken, flush } = makeScheduler();
  scheduler.scheduleEvent({
    kind: 'tool_result',
    actionCue: { kind: 'click', primaryElementId: undefined, targetLabel: undefined },
    // No narration / narrationActive — most tool_result events are like this.
  } as any);
  flush();
  assert.equal(spoken.length, 0, `expected no narration for empty tool_result, got: ${JSON.stringify(spoken)}`);
});
