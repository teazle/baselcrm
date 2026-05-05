import assert from 'node:assert/strict';
import test from 'node:test';

import { buildGeFillVerification } from './ge-submitter.js';

test('GE / NTUC fill verification exposes popup-filled fields', () => {
  const verification = buildGeFillVerification({
    visit: {
      visit_date: '2026-05-04',
      total_amount: '42.00',
      diagnosis_description: 'Cough',
      extraction_metadata: { chargeType: 'First Consultation' },
    },
    diagnosisResult: {
      success: true,
      diagnosisState: {
        primaryCode: 'R05',
        primaryText: 'Cough',
      },
    },
    feeTypeState: {
      selected: true,
      value: 'First Consultation Fee',
      by: 'preferred',
    },
    feeAmount: '42.00',
    mcDays: '0',
    mcReason: 'Pain-unspecified',
    remarks: 'Shadow fill only',
  });

  assert.equal(verification.visitDate.status, 'portal_managed');
  assert.equal(verification.diagnosis.status, 'verified');
  assert.equal(verification.fee.observed, '42.00');
  assert.equal(verification.chargeType.status, 'verified');
  assert.equal(verification.remarks.expected, 'Shadow fill only');
});
