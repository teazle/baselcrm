import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildIxchangeSearchAttempts,
  buildIxchangeSubmittedTruthCaptureUnavailable,
  resolveIxchangeMode,
} from './ixchange.js';

test('buildIxchangeSearchAttempts marks Parkway identifier attempts with Parkway signals', () => {
  const attempts = buildIxchangeSearchAttempts({
    visit: {
      pay_type: 'PARKWAY',
      nric: 's1234567a',
      patient_name: 'Ignored Name',
    },
  });

  assert.equal(resolveIxchangeMode({ pay_type: 'PARKWAY' }), 'PARKWAY');
  assert.equal(attempts.length, 1);
  assert.equal(attempts[0].label, 'parkway_nric');
  assert.equal(attempts[0].attemptKind, 'patient_id');
  assert.equal(attempts[0].mode, 'PARKWAY');
  assert.equal(attempts[0].modeSignals.parkway, true);
  assert.equal(attempts[0].modeSignals.all, false);
  assert.equal(attempts[0].portalTarget, 'IXCHANGE');
});

test('buildIxchangeSubmittedTruthCaptureUnavailable keeps ALL mode signals in attempts metadata', () => {
  const capture = buildIxchangeSubmittedTruthCaptureUnavailable({
    visit: {
      pay_type: 'ALL',
      patient_name: 'TAG ALL Jane Doe',
      nric: 's1234567a',
    },
    sessionState: 'healthy',
    auditedAt: '2026-04-26T00:00:00.000Z',
  });

  assert.equal(capture.found, false);
  assert.equal(capture.reason, 'submitted_detail_extractor_unavailable_for_ixchange');
  assert.equal(capture.mode, 'ALL');
  assert.equal(capture.sessionState, 'healthy');
  assert.equal(capture.auditedAt, '2026-04-26T00:00:00.000Z');
  assert.equal(capture.searchAttemptCount, capture.attempts.length);
  assert.ok(capture.attempts.length > 0);
  assert.equal(capture.attempts[0].label, 'all_name');
  assert.equal(capture.attempts[0].attemptKind, 'patient_name');
  assert.equal(capture.attempts[0].modeSignals.parkway, false);
  assert.equal(capture.attempts[0].modeSignals.all, true);
  assert.ok(capture.searchTags.includes('ALL'));
});
