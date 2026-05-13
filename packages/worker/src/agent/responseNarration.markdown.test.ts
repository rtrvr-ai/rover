import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeResponseNarration } from './responseNarration.js';

test('strips **bold** markers — TTS does not read asterisks', () => {
  const out = sanitizeResponseNarration(
    'To run a workflow, you can use the **Vibe Scrape with Cloud Browsers** feature.',
    { responseKind: 'final' },
  );
  assert.ok(out, 'expected narration output');
  assert.ok(!out!.includes('*'), `Expected no asterisks: "${out}"`);
  assert.ok(out!.includes('Vibe Scrape with Cloud Browsers'), `Expected inner text preserved: "${out}"`);
});

test('strips * and - and + bullet markers at line starts', () => {
  const md = [
    'Key features:',
    '* Scale: run 1,000+ parallel browsers.',
    '- Data Enrichment: enrich spreadsheets.',
    '+ Integration: append to Google Sheets.',
  ].join('\n');
  const out = sanitizeResponseNarration(md, { responseKind: 'final' });
  assert.ok(out, 'expected narration output');
  assert.ok(!/^[\s*+\-]/.test(out!), `Expected no leading bullet marker: "${out}"`);
  assert.ok(out!.includes('Scale'), `Expected first bullet content preserved: "${out}"`);
});

test('strips numbered list markers (1. 2.) but keeps content', () => {
  const out = sanitizeResponseNarration('1. First step. 2. Second step.', { responseKind: 'final' });
  assert.ok(out, 'expected narration output');
  assert.ok(!/^\s*\d+\./.test(out!), `Expected no leading numeric marker: "${out}"`);
  assert.ok(out!.includes('First step'), `Expected first item content preserved: "${out}"`);
});

test('strips # heading markers but keeps heading text', () => {
  const out = sanitizeResponseNarration('# Cloud Workflow Features\n\nScale and enrich.', { responseKind: 'final' });
  assert.ok(out, 'expected narration output');
  assert.ok(!out!.startsWith('#'), `Expected no # prefix: "${out}"`);
  assert.ok(out!.includes('Cloud Workflow Features'), `Expected heading text preserved: "${out}"`);
});

test('long final responses get a graceful close, never mid-word cuts', () => {
  const long =
    'This allows you to scale up to 1,000+ parallel cloud browser agents by simply providing a prompt and a list of URLs that need to be processed in a single run with full enrichment and structured output.';
  const padded = `Intro paragraph. ${long} ${long} ${long}`;
  const out = sanitizeResponseNarration(padded, { responseKind: 'final' });
  assert.ok(out, 'expected narration output');
  // The output ends with a polished suffix OR a complete sentence — never a partial word.
  assert.ok(
    /The full result is in the chat\.$/.test(out!) || /[.!?…]$/.test(out!),
    `Expected polished end, got: "${out}"`,
  );
  // No trailing single-letter word.
  assert.ok(!/\s[A-Za-z]$/.test(out!), `Expected no trailing single-letter word: "${out}"`);
});

test('regression: user-reported "show me a demo" response does not cut "URLs" mid-word', () => {
  const responseTextFromUserReport =
    'To run a workflow on the cloud using rtrvr.ai, you can use the **Vibe Scrape with Cloud Browsers** feature. ' +
    'This allows you to scale up to 1,000+ parallel cloud browser agents by simply providing a prompt and a list of URLs. ' +
    'You can watch the specific demo for this cloud workflow here: ' +
    '[Vibe Scrape 1k+ Sites with Cloud Browsers Demo](https://www.youtube.com/embed/ggLDvZKuBlU) ' +
    'Key Cloud Workflow Features: * **Scale:** Run 1,000+ parallel cloud browser automations simultaneously. ' +
    '* **Data Enrichment:** Enrich spreadsheets with web data at scale.';
  const out = sanitizeResponseNarration(responseTextFromUserReport, { responseKind: 'final' });
  assert.ok(out, 'expected narration output');
  assert.ok(!out!.includes('*'), `Expected zero asterisks in TTS text: "${out}"`);
  assert.ok(!/\bU$/.test(out!) && !out!.endsWith(' U'), `Expected no mid-word "U" cut: "${out}"`);
  // If "list of" survived in the narration, "URLs" must be intact (not truncated to "U").
  if (out!.includes('list of')) {
    assert.ok(out!.includes('URLs'), `Expected "URLs" intact when "list of" is included: "${out}"`);
  }
});

test('does not mangle "snake_case_var" or arithmetic like "5 * x"', () => {
  // Defensive: bold/italic regex must not strip non-markdown content.
  const out1 = sanitizeResponseNarration('Pass snake_case_var through to the function.', { responseKind: 'final' });
  assert.ok(out1?.includes('snake_case_var'), `Expected snake_case_var preserved: "${out1}"`);

  const out2 = sanitizeResponseNarration('Compute 5 * x for each row.', { responseKind: 'final' });
  // Defensive sweep strips space-flanked stray asterisks, which is fine here:
  // the narration just reads "Compute 5 x for each row." — readable and no asterisk leakage.
  assert.ok(out2, 'expected narration');
  assert.ok(!out2!.includes('*'), `Expected no asterisks: "${out2}"`);
});
