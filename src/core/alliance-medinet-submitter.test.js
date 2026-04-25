import assert from 'node:assert/strict';
import test from 'node:test';

import { buildAllianceMedinetSubmittedTruthCapture } from './portal-truth-extractors.js';
import { shouldSaveAllianceMedinetDraft } from './alliance-medinet-submitter.js';

test('Alliance Medinet fill_evidence mode skips draft save', () => {
  assert.equal(
    shouldSaveAllianceMedinetDraft({
      flow3Mode: 'fill_evidence',
      workflowSaveDraft: '1',
    }),
    false
  );
  assert.equal(
    shouldSaveAllianceMedinetDraft({
      flow3Mode: 'draft',
      workflowSaveDraft: '1',
    }),
    true
  );
  assert.equal(
    shouldSaveAllianceMedinetDraft({
      flow3Mode: 'draft',
      workflowSaveDraft: '0',
    }),
    false
  );
});

test('Alliance Medinet submitted truth capture is normalized unavailable', () => {
  const capture = buildAllianceMedinetSubmittedTruthCapture({
    visit: { id: 'visit-42', patient_name: 'Test Patient' },
    attempts: [{ stage: 'submitted_detail_extractor', status: 'not_implemented' }],
  });

  assert.equal(capture.found, false);
  assert.equal(capture.reason, 'submitted_detail_extractor_unavailable_for_alliance_medinet');
  assert.equal(capture.route, 'ALLIANCE_MEDINET');
  assert.equal(capture.context, 'alliance_medinet');
  assert.equal(capture.attempts.length, 1);
  assert.equal(capture.attempts[0].stage, 'submitted_detail_extractor');
});
