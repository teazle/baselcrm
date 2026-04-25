import assert from 'node:assert/strict';
import test from 'node:test';

import {
  FULLERTON_SUBMITTED_DETAIL_REASON,
  buildUnavailableFullertonSubmittedTruthCapture,
  collectFullertonMatchCandidates,
  extractFullertonSubmittedTruthCapture,
} from './fullerton.js';

test('collectFullertonMatchCandidates normalizes and deduplicates Fullerton identifiers', () => {
  const candidates = collectFullertonMatchCandidates({
    nric: 's1234567a',
    patientId: 'S1234567A',
    memberId: '4719550302',
    extraction_metadata: {
      fin: 't7654321z',
      idNumber: 'T7654321Z',
      patientId: 'custom-id-42',
    },
  });

  assert.deepEqual(candidates, ['S1234567A', 'T7654321Z', 'CUSTOMID42', '4719550302']);
});

test('buildUnavailableFullertonSubmittedTruthCapture returns the normalized unavailable capture', () => {
  const capture = buildUnavailableFullertonSubmittedTruthCapture({
    visit: {
      nric: 's1234567a',
      extraction_metadata: {
        memberId: '4719550302',
      },
    },
    pageUrl: 'https://doctor.fhn3.com/patient_list',
    pageProbe: {
      url: 'https://doctor.fhn3.com/patient_list',
      title: 'Doctor Portal @ FHN3',
      bodySnippet: 'Patients Claims History Visit Register',
      claimsHistoryLinkVisible: true,
      claimsHistoryLinkHref: 'patient_list',
      patientVerifyVisible: true,
      visitRegisterVisible: false,
      searchInputVisible: true,
      searchButtonVisible: true,
    },
    auditedAt: '2026-04-26T00:00:00.000Z',
  });

  assert.equal(capture.found, false);
  assert.equal(capture.reason, FULLERTON_SUBMITTED_DETAIL_REASON);
  assert.equal(capture.detailReason, FULLERTON_SUBMITTED_DETAIL_REASON);
  assert.equal(capture.context, 'fullerton');
  assert.equal(capture.portalTarget, 'FULLERTON');
  assert.equal(capture.portalUrl, 'https://doctor.fhn3.com/patient_list');
  assert.equal(capture.source, 'fullerton_submitted_detail');
  assert.deepEqual(capture.matchCandidates, ['S1234567A', '4719550302']);
  assert.equal(capture.attempts.length, 3);
  assert.equal(capture.matchingAttempts.length, 2);
  assert.ok(
    capture.attempts.some(attempt => attempt.kind === 'session_probe' && attempt.matched === true)
  );
  assert.equal(capture.snapshot, null);
  assert.equal(capture.auditedAt, '2026-04-26T00:00:00.000Z');
});

test('extractFullertonSubmittedTruthCapture returns the unavailable capture without a live page', async () => {
  const capture = await extractFullertonSubmittedTruthCapture({
    visit: {
      nric: 's1234567a',
      extraction_metadata: {
        memberId: '4719550302',
      },
    },
    pageUrl: 'https://doctor.fhn3.com/app_index',
    auditedAt: '2026-04-26T00:00:00.000Z',
  });

  assert.equal(capture.found, false);
  assert.equal(capture.reason, FULLERTON_SUBMITTED_DETAIL_REASON);
  assert.equal(capture.portalUrl, 'https://doctor.fhn3.com/app_index');
  assert.equal(capture.attempts[0].kind, 'route_probe');
  assert.equal(capture.matchingAttempts.length, 1);
});
