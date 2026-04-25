import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildGeNtucSubmittedTruthCapture,
  capturePortalSubmittedTruth,
} from './portal-truth-extractors.js';

test('buildGeNtucSubmittedTruthCapture returns a normalized unavailable capture', () => {
  const capture = buildGeNtucSubmittedTruthCapture({
    visit: {
      id: 'visit-ge-1',
      patient_name: 'Test Patient',
      visit_date: '2026-02-14',
    },
    mode: 'fill_evidence',
    savedAsDraft: false,
    submitted: false,
  });

  assert.equal(capture.found, false);
  assert.equal(capture.reason, 'submitted_detail_extractor_unavailable_for_ge_ntuc');
  assert.equal(capture.route, 'GE_NTUC');
  assert.equal(capture.context, 'ge_ntuc');
  assert.equal(capture.attempts[0].stage, 'submitted_detail_extractor');
  assert.equal(capture.attempts[0].blocker, 'no_submitted_detail_view');
  assert.equal(capture.attempts[0].mode, 'fill_evidence');
  assert.equal(capture.attempts[0].savedAsDraft, false);
  assert.equal(capture.attempts[0].submitted, false);
});

test('capturePortalSubmittedTruth returns the GE_NTUC unsupported capture', async () => {
  const capture = await capturePortalSubmittedTruth({
    route: 'GE_NTUC',
    visit: {
      id: 'visit-ge-2',
      patient_name: 'Another Patient',
      visit_date: '2026-02-15',
    },
  });

  assert.equal(capture.found, false);
  assert.equal(capture.reason, 'submitted_detail_extractor_unavailable_for_ge_ntuc');
  assert.equal(capture.route, 'GE_NTUC');
  assert.ok(Array.isArray(capture.attempts));
  assert.equal(capture.attempts[0].stage, 'submitted_detail_extractor');
});

test('capturePortalSubmittedTruth returns explicit unavailable captures for every non-MHC portal', async () => {
  const cases = [
    ['FULLERTON', 'submitted_detail_extractor_unavailable_for_fullerton'],
    ['IXCHANGE', 'submitted_detail_extractor_unavailable_for_ixchange'],
    ['IHP', 'submitted_detail_extractor_unavailable_for_ihp'],
    ['ALLIANCE_MEDINET', 'submitted_detail_extractor_unavailable_for_alliance_medinet'],
    ['ALLIANZ', 'submitted_detail_extractor_unavailable_for_allianz'],
  ];

  for (const [route, reason] of cases) {
    const capture = await capturePortalSubmittedTruth({
      route,
      visit: {
        id: `visit-${route}`,
        patient_name: 'Test Patient',
        visit_date: '2026-02-16',
      },
    });

    assert.equal(capture.found, false, route);
    assert.equal(capture.reason, reason, route);
    assert.ok(Array.isArray(capture.attempts), route);
  }
});
