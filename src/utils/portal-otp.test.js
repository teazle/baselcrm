import assert from 'node:assert/strict';
import test from 'node:test';

import { extractCodeFromText } from './portal-otp.js';

test('extracts Fullerton 2xSecure OTP when subject and sender carry the portal identity', () => {
  const text = [
    'OTP Notification',
    '2xSecure',
    'Your One-Time PIN for Fullerton Health login is 123456.',
    'This code expires shortly.',
  ].join('\n');

  assert.equal(extractCodeFromText(text, 'FULLERTON')?.code, '123456');
});

test('extracts Fullerton OTP when the code is separated by spaces or dashes', () => {
  assert.equal(
    extractCodeFromText('OTP Notification: your security code is 123 456', 'FULLERTON')?.code,
    '123456'
  );
  assert.equal(
    extractCodeFromText('2xSecure authentication token: 123-456', 'FULLERTON')?.code,
    '123456'
  );
});

test('extracts OTP when code appears before the OTP label', () => {
  assert.equal(
    extractCodeFromText('Use 123456 as your OTP to continue signing in.', 'FULLERTON')?.code,
    '123456'
  );
});
