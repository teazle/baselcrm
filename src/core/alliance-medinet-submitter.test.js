import assert from 'node:assert/strict';
import test from 'node:test';

import { buildAllianceMedinetSubmittedTruthCapture } from './portal-truth-extractors.js';
import {
  buildAllianceFillVerification,
  shouldSaveAllianceMedinetDraft,
} from './alliance-medinet-submitter.js';

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

test('Alliance Medinet fill verification exposes shadow-filled fields', () => {
  const verification = buildAllianceFillVerification({
    visit: {
      visit_date: '2026-05-04',
      total_amount: '38.00',
      diagnosis_description: 'Upper respiratory tract infection',
      extraction_metadata: {},
    },
    doctor: { doctorName: 'Tan Guoping Kelvin' },
    fillResult: {
      doctorName: 'Tan Guoping Kelvin',
      diagnosisPortalMatch: {
        match_text: 'J06.9 - Acute upper respiratory infection',
      },
      readback: {
        fee: { selector: 'input[formcontrolname*="consultationFee"]', value: '38.00' },
      },
    },
  });

  assert.equal(verification.visitDate.status, 'portal_managed');
  assert.equal(verification.diagnosis.status, 'verified');
  assert.equal(verification.fee.status, 'verified');
  assert.equal(verification.fee.expected, '38.00');
  assert.equal(verification.doctor.status, 'verified');
});
