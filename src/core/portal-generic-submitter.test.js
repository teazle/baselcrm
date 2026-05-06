import assert from 'node:assert/strict';
import test from 'node:test';

import { buildCredentialCandidates, buildGenericBotSnapshot } from './portal-generic-submitter.js';

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

test('buildCredentialCandidates tries runtime credentials before distinct env fallback', () => {
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
  assert.equal(candidates[0].source, 'runtime');
  assert.equal(candidates[1].source, 'env');
  assert.equal(candidates[1].username, 'env-user');
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
  assert.equal(candidates[0].source, 'runtime');
});
