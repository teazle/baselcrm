import assert from 'node:assert/strict';
import test from 'node:test';

import { ClaimSubmitter } from './claim-submitter.js';

test('_pickDobForVisit normalizes common Flow 1/Flow 2 DOB shapes for Allianz', () => {
  const pickDob = ClaimSubmitter.prototype._pickDobForVisit;

  assert.equal(
    pickDob({
      extraction_metadata: {
        flow1: {
          dob: '03/04/1985',
        },
      },
    }),
    '1985-04-03'
  );

  assert.equal(
    pickDob({
      extraction_metadata: {
        dateOfBirth: '1990-12-31',
      },
    }),
    '1990-12-31'
  );

  assert.equal(
    pickDob({
      extraction_metadata: {
        flow2: {
          patientDob: '7-8-1975',
        },
      },
    }),
    '1975-08-07'
  );
});
