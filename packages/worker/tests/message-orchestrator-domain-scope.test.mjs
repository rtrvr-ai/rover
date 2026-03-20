import assert from 'node:assert/strict';
import test from 'node:test';

import { __messageOrchestratorInternals } from '../dist/agent/messageOrchestrator.js';

test('cross-domain dependency counting respects private suffix registrable domains', () => {
  const tabs = [{ url: 'https://sphere-demo-nine.vercel.app/home' }];

  assert.equal(
    __messageOrchestratorInternals.hasCrossDomainPlanDependency(
      'Open https://beta.sphere-demo-nine.vercel.app/pricing and summarize it',
      tabs,
    ),
    false,
  );

  assert.equal(
    __messageOrchestratorInternals.hasCrossDomainPlanDependency(
      'Open https://other-site.vercel.app/pricing and summarize it',
      tabs,
    ),
    true,
  );

  assert.equal(
    __messageOrchestratorInternals.countCrossDomainNavigationDependencies(
      'Compare https://beta.sphere-demo-nine.vercel.app/pricing with https://other-site.vercel.app/pricing and https://app.service.gov.au/login',
      tabs,
    ),
    2,
  );
});
