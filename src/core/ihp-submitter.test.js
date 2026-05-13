import assert from 'node:assert/strict';
import test from 'node:test';

import { IHPSubmitter, submitIhpEncryptedLogin } from './ihp-submitter.js';

test('submitIhpEncryptedLogin uses IHP encrypted validate path before generic click fallback', async () => {
  let evaluateCalled = false;
  let fallbackClicked = false;

  const result = await submitIhpEncryptedLogin({
    page: {
      async evaluate() {
        evaluateCalled = true;
        return true;
      },
    },
    helpers: {
      async clickFirst() {
        fallbackClicked = true;
        return 'fallback';
      },
    },
  });

  assert.equal(evaluateCalled, true);
  assert.equal(fallbackClicked, false);
  assert.equal(result, 'ihp:validate-encrypted-login');
});

test('submitIhpEncryptedLogin falls back to clicking the login button if validate is unavailable', async () => {
  const result = await submitIhpEncryptedLogin({
    page: {
      async evaluate() {
        return false;
      },
    },
    helpers: {
      async clickFirst(selectors) {
        assert.ok(selectors.includes('button[name="btnSubmit"]'));
        return 'button[name="btnSubmit"]';
      },
    },
  });

  assert.equal(result, 'button[name="btnSubmit"]');
});

test('IHPSubmitter uses IHP_OTP_CHANNEL override for email-forwarded SMS OTP setups', () => {
  const original = process.env.IHP_OTP_CHANNEL;
  try {
    process.env.IHP_OTP_CHANNEL = 'email';
    const submitter = new IHPSubmitter({});
    assert.equal(submitter.runtime.otpChannel, 'email');
  } finally {
    if (original === undefined) delete process.env.IHP_OTP_CHANNEL;
    else process.env.IHP_OTP_CHANNEL = original;
  }
});
