import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildCredentialCandidates,
  buildGenericBotSnapshot,
  detectLoginFailureSignals,
  detectOtpPromptSignals,
  deriveOtpBlockedReason,
  GenericPortalSubmitter,
  shouldTryNextCredentialCandidate,
} from './portal-generic-submitter.js';

function createNoControlPage(bodyText = '') {
  return {
    url: () => 'https://portal.example/login',
    goto: async () => {},
    waitForTimeout: async () => {},
    waitForLoadState: async () => {},
    frames: () => [],
    mainFrame: () => ({}),
    screenshot: async () => {},
    locator: () => ({
      count: async () => 0,
      nth: () => ({
        waitFor: async () => {
          throw new Error('not found');
        },
      }),
    }),
    evaluate: async fn => {
      const source = String(fn || '');
      if (source.includes("querySelectorAll?.('input')")) return [];
      if (source.includes('hasLogout') && source.includes('hasDashboard')) {
        return { hasLogout: false, hasDashboard: false, hasLoginForm: false };
      }
      if (source.includes('/welcome/i')) return false;
      if (source.includes('only one browser window')) return false;
      if (source.includes('body?.innerText') || source.includes('document?.body')) return bodyText;
      return null;
    },
  };
}

test('buildGenericBotSnapshot normalizes core audit fields from visit and verification evidence', () => {
  const snapshot = buildGenericBotSnapshot({
    visit: {
      id: 'visit-1',
      patient_name: 'Test Patient',
      nric: 's1234567a',
      visit_date: '2026-02-13',
      total_amount: 76.3,
      treatment_detail: 'SPECIALIST CONSULTATION x1\nMedication x2',
      extraction_metadata: {
        chargeType: 'follow',
        diagnosisCode: 'S83.6',
        diagnosisResolution: {
          status: 'ambiguous',
          confidence: 0.74,
          reason_if_unresolved: 'generic_without_laterality',
        },
        diagnosisCanonical: {
          code_normalized: 'S83.6',
          source_date: '2026-02-09',
          source_age_days: 4,
        },
      },
      diagnosis_description: 'Sprain of knee',
    },
    portalTarget: 'FULLERTON',
    portalName: 'Fullerton',
    mode: 'fill_evidence',
    fillVerification: {
      visitDate: { observed: '13/02/2026', expected: '13/02/2026' },
      diagnosis: { observed: 'Sprain of knee', expected: 'Sprain of knee' },
      fee: { observed: '70.00', expected: '76.30' },
    },
    evidence: 'screenshots/example.png',
  });

  assert.equal(snapshot.patientName, 'Test Patient');
  assert.equal(snapshot.patientNric, 'S1234567A');
  assert.equal(snapshot.visitDate, '13/02/2026');
  assert.equal(snapshot.chargeType, 'follow');
  assert.equal(snapshot.diagnosisText, 'Sprain of knee');
  assert.equal(snapshot.diagnosisCode, 'S83.6');
  assert.equal(snapshot.consultationFee, '70.00');
  assert.equal(snapshot.totalFee, '76.30');
  assert.equal(snapshot.lineItems.length, 2);
  assert.equal(snapshot.artifacts.screenshot, 'screenshots/example.png');
  assert.equal(snapshot.diagnosisResolution.status, 'ambiguous');
});

test('buildCredentialCandidates tries env credentials before stale runtime fallback by default', () => {
  const candidates = buildCredentialCandidates({
    runtimeCredential: {
      url: 'https://portal.example/login',
      username: 'stale-user',
      password: 'stale-pass',
    },
    config: {
      defaultUrl: 'https://portal.example/login',
      defaultUsername: 'env-user',
      defaultPassword: 'env-pass',
    },
    defaultUrl: 'https://portal.example/login',
  });

  assert.equal(candidates.length, 2);
  assert.equal(candidates[0].source, 'env');
  assert.equal(candidates[0].username, 'env-user');
  assert.equal(candidates[1].source, 'runtime');
});

test('buildCredentialCandidates can prefer runtime credentials when explicitly enabled', () => {
  const original = process.env.FLOW3_PREFER_DB_CREDENTIALS;
  try {
    process.env.FLOW3_PREFER_DB_CREDENTIALS = '1';
    const candidates = buildCredentialCandidates({
      runtimeCredential: {
        url: 'https://portal.example/login',
        username: 'db-user',
        password: 'db-pass',
      },
      config: {
        defaultUrl: 'https://portal.example/login',
        defaultUsername: 'env-user',
        defaultPassword: 'env-pass',
      },
      defaultUrl: 'https://portal.example/login',
    });

    assert.equal(candidates.length, 2);
    assert.equal(candidates[0].source, 'runtime');
    assert.equal(candidates[1].source, 'env');
  } finally {
    if (original === undefined) delete process.env.FLOW3_PREFER_DB_CREDENTIALS;
    else process.env.FLOW3_PREFER_DB_CREDENTIALS = original;
  }
});

test('buildCredentialCandidates does not duplicate identical runtime and env credentials', () => {
  const candidates = buildCredentialCandidates({
    runtimeCredential: {
      url: 'https://portal.example/login',
      username: 'same-user',
      password: 'same-pass',
    },
    config: {
      defaultUrl: 'https://portal.example/login',
      defaultUsername: 'same-user',
      defaultPassword: 'same-pass',
    },
    defaultUrl: 'https://portal.example/login',
  });

  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].source, 'env');
});

test('buildCredentialCandidates expands configured URL candidates with the same credentials', () => {
  const candidates = buildCredentialCandidates({
    runtimeCredential: null,
    config: {
      defaultUrl: 'https://portal.example/primary',
      defaultUrlCandidates: ['https://portal.example/primary', 'https://portal.example/fallback'],
      defaultUsername: 'env-user',
      defaultPassword: 'env-pass',
    },
    defaultUrl: 'https://portal.example/primary',
  });

  assert.deepEqual(
    candidates.map(candidate => [candidate.source, candidate.url]),
    [
      ['env', 'https://portal.example/primary'],
      ['env_url_candidate', 'https://portal.example/fallback'],
    ]
  );
});

test('shouldTryNextCredentialCandidate retries only recoverable login states', () => {
  assert.equal(shouldTryNextCredentialCandidate('portal_unavailable'), true);
  assert.equal(shouldTryNextCredentialCandidate('login_inputs_missing'), true);
  assert.equal(shouldTryNextCredentialCandidate('login_submit_missing'), true);
  assert.equal(shouldTryNextCredentialCandidate('login_invalid_credentials'), true);
  assert.equal(shouldTryNextCredentialCandidate('portal_captcha_blocked'), false);
  assert.equal(shouldTryNextCredentialCandidate('otp_required'), false);
});

test('deriveOtpBlockedReason preserves actionable OTP mailbox failures', () => {
  assert.equal(deriveOtpBlockedReason('otp_email_waiting'), 'portal_otp_email_waiting');
  assert.equal(deriveOtpBlockedReason('portal_sms_otp_required'), 'portal_sms_otp_required');
  assert.equal(deriveOtpBlockedReason('sms_otp_required'), 'portal_sms_otp_required');
  assert.equal(deriveOtpBlockedReason('config_missing'), 'portal_otp_mail_config_missing');
  assert.equal(deriveOtpBlockedReason('imap_auth_error'), 'portal_otp_mail_auth_failed');
  assert.equal(deriveOtpBlockedReason('imap_error'), 'portal_otp_mail_error');
  assert.equal(deriveOtpBlockedReason('otp_not_received'), 'portal_otp_not_received');
  assert.equal(deriveOtpBlockedReason('otp_stale_only'), 'portal_otp_stale_only');
  assert.equal(deriveOtpBlockedReason('otp_unparseable'), 'portal_otp_unparseable');
});

test('detectOtpPromptSignals distinguishes email OTP from SMS-only OTP prompts', () => {
  assert.deepEqual(
    detectOtpPromptSignals({
      bodyText: 'Enter the OTP sent to your registered email address.',
      fields: [{ name: 'verificationCode', placeholder: 'OTP' }],
    }),
    { hasOtp: true, kind: 'email_or_unknown', hasEmail: true, hasSms: false }
  );

  assert.deepEqual(
    detectOtpPromptSignals({
      bodyText: 'Please enter the OTP sent by SMS to your registered mobile number.',
      fields: [{ name: 'txtOTP' }],
    }),
    { hasOtp: true, kind: 'sms', hasEmail: false, hasSms: true }
  );
});

test('GenericPortalSubmitter blocks configured SMS OTP without polling Gmail', async () => {
  const submitter = new GenericPortalSubmitter({
    page: createNoControlPage('Enter OTP'),
    portalTarget: 'IHP',
    portalName: 'IHP',
    supportsOtp: true,
    otpChannel: 'sms',
  });
  submitter._isOtpVisible = async () => true;
  submitter._captureOtpDebug = async () => ({
    otpPrompt: { hasOtp: true, kind: 'email_or_unknown', hasEmail: false, hasSms: false },
  });
  submitter._safeScreenshot = async () => 'screenshots/sms-otp-required.png';
  const state = {};

  const ok = await submitter._handleOtp(state, { id: 'visit-1' });

  assert.equal(ok, false);
  assert.equal(state.otp_state, 'portal_sms_otp_required');
  assert.equal(state.evidence, 'screenshots/sms-otp-required.png');
});

test('detectLoginFailureSignals catches delayed IXCHANGE login toast text', () => {
  const signals = detectLoginFailureSignals(
    'ERROR Login unsuccessful. Please try again or use the Forgot Password function to reset your login credentials.'
  );

  assert.equal(signals.hasAuthError, true);
  assert.equal(signals.hasCredentialDecryptError, false);
});

test('GenericPortalSubmitter treats service unavailable login page as portal unavailable', async () => {
  const submitter = new GenericPortalSubmitter({
    page: createNoControlPage(
      'Service Unavailable\n\nThe server is temporarily unable to service your request due to maintenance downtime or capacity problems.'
    ),
    portalTarget: 'ALLIANZ',
    portalName: 'Allianz',
    defaultUrl: 'https://portal.example/login',
    selectors: {
      loginUsername: ['input[name="username"]'],
      loginPassword: ['input[name="password"]'],
      loginSubmit: ['button:has-text("Login")'],
    },
  });
  const state = { login_state: 'pending' };

  const ok = await submitter._login('https://portal.example/login', 'user', 'pass', state, {
    id: 'visit-1',
  });

  assert.equal(ok, false);
  assert.equal(state.login_state, 'portal_unavailable');
});
