import assert from 'node:assert/strict';
import test from 'node:test';

import { ClaimSubmitter } from './claim-submitter.js';

test('_pickDobForVisit normalizes common Flow 1/Flow 2 DOB shapes for Allianz', () => {
  const pickDob = ClaimSubmitter.prototype._pickDobForVisit;

  assert.equal(
    pickDob({
      extraction_metadata: {
        flow1: {
          dob: '03/04/1985',
        },
      },
    }),
    '1985-04-03'
  );

  assert.equal(
    pickDob({
      extraction_metadata: {
        dateOfBirth: '1990-12-31',
      },
    }),
    '1990-12-31'
  );

  assert.equal(
    pickDob({
      extraction_metadata: {
        flow2: {
          patientDob: '7-8-1975',
        },
      },
    }),
    '1975-08-07'
  );
});

test('_getRequestedMode preserves non-shadow requests so submitClaim can block them', () => {
  const originalFlow3Mode = process.env.FLOW3_MODE;
  const originalSaveDraft = process.env.WORKFLOW_SAVE_DRAFT;
  const originalAllowSubmit = process.env.ALLOW_LIVE_SUBMIT;

  try {
    process.env.FLOW3_MODE = 'draft';
    process.env.WORKFLOW_SAVE_DRAFT = '1';
    process.env.ALLOW_LIVE_SUBMIT = '1';

    assert.equal(ClaimSubmitter.prototype._getRequestedMode(), 'draft');

    delete process.env.FLOW3_MODE;
    delete process.env.WORKFLOW_SAVE_DRAFT;
    assert.equal(ClaimSubmitter.prototype._getRequestedMode(), 'submit');
  } finally {
    if (originalFlow3Mode === undefined) delete process.env.FLOW3_MODE;
    else process.env.FLOW3_MODE = originalFlow3Mode;
    if (originalSaveDraft === undefined) delete process.env.WORKFLOW_SAVE_DRAFT;
    else process.env.WORKFLOW_SAVE_DRAFT = originalSaveDraft;
    if (originalAllowSubmit === undefined) delete process.env.ALLOW_LIVE_SUBMIT;
    else process.env.ALLOW_LIVE_SUBMIT = originalAllowSubmit;
  }
});

test('submitClaim blocks draft mode before portal interaction', async () => {
  const originalFlow3Mode = process.env.FLOW3_MODE;
  const submitter = Object.create(ClaimSubmitter.prototype);
  submitter.steps = { step() {} };

  try {
    process.env.FLOW3_MODE = 'draft';
    const result = await submitter.submitClaim({
      id: 'visit-1',
      pay_type: 'MHC',
      patient_name: 'TEST PATIENT',
      extraction_metadata: {},
    });

    assert.equal(result.success, false);
    assert.equal(result.blocked_reason, 'flow3_shadow_only_mode_locked');
    assert.equal(result.savedAsDraft, false);
    assert.equal(result.submitted, false);
  } finally {
    if (originalFlow3Mode === undefined) delete process.env.FLOW3_MODE;
    else process.env.FLOW3_MODE = originalFlow3Mode;
  }
});
