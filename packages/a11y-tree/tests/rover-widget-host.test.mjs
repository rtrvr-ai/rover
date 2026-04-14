import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { isRoverWidgetHost } from '../dist/lib/utilities/dom-root-guards.js';

const PKG_ROOT = path.resolve(import.meta.dirname, '..');

function createElement(tagName, options = {}) {
  const attrs = { ...(options.attrs || {}) };
  return {
    nodeType: 1,
    tagName: tagName.toUpperCase(),
    id: options.id || '',
    getAttribute(name) {
      if (name === 'id') return this.id || null;
      return Object.prototype.hasOwnProperty.call(attrs, name) ? attrs[name] : null;
    },
  };
}

test('isRoverWidgetHost detects the Rover widget host id', () => {
  assert.equal(isRoverWidgetHost(createElement('div', { id: 'rover-widget-root' })), true);
  assert.equal(isRoverWidgetHost(createElement('div')), false);
});

test('element analysis source excludes Rover host but keeps general shadow traversal', () => {
  const source = fs.readFileSync(path.join(PKG_ROOT, 'lib/utilities/element-analysis.ts'), 'utf8');

  assert.match(source, /if \(isRoverWidgetHost\(element\)\)\s*\{\s*return \[\];\s*\}/);
  assert.match(source, /if \(isRoverWidgetHost\(element\)\)\s*\{\s*return true;\s*\}/);
  assert.match(source, /const shadowKids = Array\.from\(sr\.childNodes\);/);
  assert.match(source, /return shadowKids\.concat\(lightUnassigned\);/);
});

test('semantic tree constructor source excludes Rover hosts at the root exclusion guard', () => {
  const source = fs.readFileSync(path.join(PKG_ROOT, 'lib/core/semantic-tree-constructor.ts'), 'utf8');

  assert.match(source, /if \(isRoverWidgetHost\(element\)\)\s*\{\s*return true;\s*\}/);
});
