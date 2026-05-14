import assert from 'node:assert/strict';
import test from 'node:test';

import {
  extractCodeFromText,
  getMailConfigsFromEnv,
  parseMailboxList,
  shouldConsiderMessage,
} from './portal-otp.js';

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

test('considers generic OTP-labelled Fullerton emails when sender is not portal-branded', () => {
  assert.equal(
    shouldConsiderMessage('FULLERTON', {
      subject: 'OTP Notification',
      from: [{ name: 'Notification Service', address: 'no-reply@example.test' }],
    }),
    true
  );
});

test('extracts IXCHANGE/SPOS OTP from portal-labelled email text', () => {
  assert.equal(
    extractCodeFromText('SPOS verification code: 654321. This code expires soon.', 'IXCHANGE')
      ?.code,
    '654321'
  );
});

test('parseMailboxList defaults to inbox plus Gmail all mail and de-duplicates overrides', () => {
  assert.deepEqual(parseMailboxList(''), ['INBOX', '[Gmail]/All Mail']);
  assert.deepEqual(parseMailboxList('INBOX, [Gmail]/All Mail, INBOX'), [
    'INBOX',
    '[Gmail]/All Mail',
  ]);
});

test('getMailConfigsFromEnv supports extra OTP Gmail accounts without replacing primary', () => {
  const configs = getMailConfigsFromEnv({
    OTP_GMAIL_EMAIL: 'inbox@example.test',
    OTP_GMAIL_APP_PASSWORD: 'primary-app-password',
    OTP_GMAIL_EMAIL_2: 'salesforce@example.test',
    OTP_GMAIL_APP_PASSWORD_2: 'secondary-app-password',
    OTP_GMAIL_EMAIL_3: 'inbox@example.test',
    OTP_GMAIL_APP_PASSWORD_3: 'duplicate-app-password',
  });

  assert.equal(configs.length, 2);
  assert.equal(configs[0].email, 'inbox@example.test');
  assert.equal(configs[0].authSource, 'app_password');
  assert.equal(configs[1].email, 'salesforce@example.test');
  assert.equal(configs[1].suffix, '_2');
});
