import assert from 'node:assert/strict';
import test from 'node:test';

import {
  FLOW3_READINESS_STATES,
  FLOW3_UI_STATUSES,
  deriveFlow3Readiness,
} from './portal-readiness.js';

test('deriveFlow3Readiness marks complete fill_evidence snapshot as shadow ready', () => {
  const readiness = deriveFlow3Readiness({
    metadata: {
      mode: 'fill_evidence',
      success: true,
      botSnapshot: { patientName: 'Test Patient' },
    },
  });

  assert.equal(readiness.state, FLOW3_READINESS_STATES.PRODUCTION_SHADOW_READY);
  assert.equal(readiness.uiStatus, FLOW3_UI_STATUSES.SHADOW_FILL_READY);
});

test('deriveFlow3Readiness exposes unavailable submitted truth separately', () => {
  const readiness = deriveFlow3Readiness({
    metadata: {
      submittedTruthCapture: {
        found: false,
        reason: 'submitted_detail_extractor_unavailable_for_fullerton',
      },
    },
  });

  assert.equal(readiness.state, FLOW3_READINESS_STATES.PRODUCTION_SHADOW_READY);
  assert.equal(readiness.uiStatus, FLOW3_UI_STATUSES.TRUTH_UNAVAILABLE);
});

test('deriveFlow3Readiness promotes real mismatch categories to drift mismatch', () => {
  const readiness = deriveFlow3Readiness({
    metadata: {
      comparison: {
        mismatchCategories: ['diagnosis_semantic_mismatch'],
      },
    },
  });

  assert.equal(readiness.state, FLOW3_READINESS_STATES.TRUTH_AUDIT_READY);
  assert.equal(readiness.uiStatus, FLOW3_UI_STATUSES.DRIFT_MISMATCH);
});

test('deriveFlow3Readiness maps OTP, CAPTCHA, and read-only blocked states', () => {
  assert.equal(
    deriveFlow3Readiness({ metadata: { sessionState: 'captcha_blocked' } }).uiStatus,
    FLOW3_UI_STATUSES.CAPTCHA_BLOCKED
  );
  assert.equal(
    deriveFlow3Readiness({ metadata: { blocked_reason: 'portal_otp_required' } }).uiStatus,
    FLOW3_UI_STATUSES.OTP_BLOCKED
  );
  assert.equal(
    deriveFlow3Readiness({ metadata: { blocked_reason: 'portal_sms_otp_required' } }).uiStatus,
    FLOW3_UI_STATUSES.SMS_OTP_REQUIRED
  );
  assert.equal(
    deriveFlow3Readiness({ metadata: { blocked_reason: 'portal_read_only_no_claim_form' } })
      .uiStatus,
    FLOW3_UI_STATUSES.PORTAL_READ_ONLY
  );
});

test('deriveFlow3Readiness exposes filled but unverified shadow evidence', () => {
  const readiness = deriveFlow3Readiness({
    metadata: {
      mode: 'fill_evidence',
      success: true,
      botSnapshot: { patientName: 'Test Patient' },
      fillVerification: {
        fee: { status: 'filled_unverified' },
      },
    },
  });

  assert.equal(readiness.state, FLOW3_READINESS_STATES.PRODUCTION_SHADOW_READY);
  assert.equal(readiness.uiStatus, FLOW3_UI_STATUSES.FILLED_UNVERIFIED);
});

test('deriveFlow3Readiness preserves deterministic portal blocked states', () => {
  assert.equal(
    deriveFlow3Readiness({ metadata: { blocked_reason: 'member_not_found' } }).uiStatus,
    FLOW3_UI_STATUSES.NOT_FOUND
  );
  assert.equal(
    deriveFlow3Readiness({ metadata: { blocked_reason: 'portal_login_not_advanced' } }).uiStatus,
    FLOW3_UI_STATUSES.LOGIN_BLOCKED
  );
  assert.equal(
    deriveFlow3Readiness({ metadata: { blocked_reason: 'portal_invalid_credentials' } }).uiStatus,
    FLOW3_UI_STATUSES.LOGIN_BLOCKED
  );
  assert.equal(
    deriveFlow3Readiness({ metadata: { blocked_reason: 'portal_session_conflict' } }).uiStatus,
    FLOW3_UI_STATUSES.SESSION_BLOCKED
  );
  assert.equal(
    deriveFlow3Readiness({ metadata: { blocked_reason: 'portal_unavailable' } }).uiStatus,
    FLOW3_UI_STATUSES.PORTAL_UNAVAILABLE
  );
});
