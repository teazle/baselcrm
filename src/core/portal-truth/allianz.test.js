import assert from 'node:assert/strict';
import test from 'node:test';

import { buildAllianzSubmittedTruthCapture } from './allianz.js';

test('buildAllianzSubmittedTruthCapture returns an explicit unavailable read-only capture', () => {
  const capture = buildAllianzSubmittedTruthCapture({
    auditedAt: '2026-04-26T00:00:00.000Z',
    portalUrl: 'https://my.allianzworldwidecare.com/sol/login.do',
    visit: {
      nric: 'S1234567A',
    },
    state: {
      claim_form_navigation: 'policy_verified_no_claim_form',
      claim_form_entry_url: 'https://my.allianzworldwidecare.com/sol/forms/tpa/search.do',
      claim_form_settled_url: 'https://my.allianzworldwidecare.com/sol/forms/tpa/policy.do',
      claim_form_post_view_last_url: 'https://my.allianzworldwidecare.com/sol/forms/tpa/policy.do',
      claim_form_click: 'view_policy:a#BnView_A',
      detailReason: 'allianz_portal_read_only',
      portal_submission_mode: 'policy_verification_only',
      allianz_policy_details: {
        policyStatus: 'In Force',
        policyMember: 'TEST PATIENT',
        dob: '13/02/1990',
        policyNumbers: [{ policyNumber: 'P005351032', coverageWindow: '01/01/26 - 31/12/26' }],
        healthcarePlans: ['MasterCard Asia / Pacific Plan'],
      },
      allianz_policy_evidence_screenshot: 'screenshots/allianz-policy-verified-1.png',
    },
  });

  assert.equal(capture.found, false);
  assert.equal(capture.reason, 'submitted_detail_extractor_unavailable_for_allianz');
  assert.equal(capture.context, 'allianz');
  assert.equal(capture.blocked_reason, 'portal_read_only_no_claim_form');
  assert.equal(capture.detailReason, 'allianz_portal_read_only');
  assert.equal(capture.portalReadOnly, true);
  assert.equal(capture.claimFormSupport, 'no_claim_form');
  assert.equal(capture.attempts.length, 3);
  assert.equal(capture.attempts[0].step, 'policy_search');
  assert.equal(capture.attempts[0].nric, 'S1234567A');
  assert.equal(capture.attempts[1].policyStatus, 'In Force');
  assert.equal(capture.attempts[2].reason, 'portal_read_only_no_claim_form');
  assert.equal(capture.attempts[2].navigation, 'policy_verified_no_claim_form');
  assert.equal(capture.policyDetails.policyMember, 'TEST PATIENT');
});
