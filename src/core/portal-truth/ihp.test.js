import assert from 'node:assert/strict';
import test from 'node:test';

import { buildIhpSubmittedTruthCapture } from './ihp.js';

test('buildIhpSubmittedTruthCapture returns an unavailable capture with session and otp attempts', () => {
  const capture = buildIhpSubmittedTruthCapture({
    auditedAt: '2026-04-26T00:00:00.000Z',
    portalUrl: 'https://eclaim.ihp.com.sg/eclaim/login.asp',
    visit: {
      id: 'visit-ihp-1',
      nric: 'S1234567A',
    },
    result: {
      login_state: 'ok',
      otp_state: 'auto_read',
      otp: {
        status: 'auto_read',
        matchedBy: '\\b(?:ihp|eclaim)',
        receivedAt: '2026-04-26T00:01:00.000Z',
      },
      otp_triggered_at: 1745625660000,
      search_state: 'member_found',
      form_state: 'filled',
      sessionState: 'healthy',
      evidence: 'output/playwright/ihp-login.png',
      fillVerification: {
        visitDate: { status: 'verified', observed: '26/04/2026', expected: '26/04/2026' },
      },
    },
  });

  assert.equal(capture.found, false);
  assert.equal(capture.reason, 'submitted_detail_extractor_unavailable_for_ihp');
  assert.equal(capture.context, 'ihp');
  assert.equal(capture.route, 'IHP');
  assert.equal(capture.portalTarget, 'IHP');
  assert.equal(capture.portalName, 'IHP eClaim');
  assert.equal(capture.portalUrl, 'https://eclaim.ihp.com.sg/eclaim/login.asp');
  assert.equal(capture.attempts.length, 4);
  assert.equal(capture.sessionAttempts[0].stage, 'login');
  assert.equal(capture.sessionAttempts[1].stage, 'otp');
  assert.equal(capture.sessionAttempts[1].otpState, 'auto_read');
  assert.equal(capture.sessionAttempts[1].otpStatus, 'auto_read');
  assert.equal(capture.otpAttempts.length, 1);
  assert.equal(capture.loginState, 'ok');
  assert.equal(capture.sessionState, 'healthy');
  assert.equal(capture.evidence, 'output/playwright/ihp-login.png');
});
