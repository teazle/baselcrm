import assert from 'node:assert/strict';
import test from 'node:test';

import { AllianzSubmitter, parseAllianzUrlCandidates } from './allianz-submitter.js';

test('Allianz runtime includes deterministic URL candidates for AMOS variants', () => {
  const submitter = new AllianzSubmitter({});

  assert.deepEqual(submitter.runtime.config.defaultUrlCandidates, [
    'https://my.allianzworldwidecare.com/sol/login.do',
    'https://my.allianzworldwidecare.com/sol/',
    'https://my.allianzworldwidecare.com/login.do',
  ]);
});

test('parseAllianzUrlCandidates prepends configured candidates and de-duplicates defaults', () => {
  const original = process.env.ALLIANZ_PORTAL_URL_CANDIDATES;
  process.env.ALLIANZ_PORTAL_URL_CANDIDATES =
    'https://custom.example/login, https://my.allianzworldwidecare.com/sol/login.do';
  try {
    assert.deepEqual(
      parseAllianzUrlCandidates('https://my.allianzworldwidecare.com/sol/login.do'),
      [
        'https://custom.example/login',
        'https://my.allianzworldwidecare.com/sol/login.do',
        'https://my.allianzworldwidecare.com/sol/',
        'https://my.allianzworldwidecare.com/login.do',
      ]
    );
  } finally {
    if (original === undefined) {
      delete process.env.ALLIANZ_PORTAL_URL_CANDIDATES;
    } else {
      process.env.ALLIANZ_PORTAL_URL_CANDIDATES = original;
    }
  }
});

test('Allianz search uses DOB when available and attaches the AMOS DOB value', () => {
  const submitter = new AllianzSubmitter({});
  const builder = submitter.runtime.config.searchAttemptBuilder;

  const attempts = builder({
    visit: {
      patient_name: 'HAN SUIANG-SHIUH',
      dob: '1990-02-13',
    },
    state: {},
  });

  assert.equal(submitter.runtime.config.disableDefaultSearchFallback, true);
  assert.equal(attempts.length, 1);
  assert.equal(attempts[0].label, 'surname_and_dob');
  assert.equal(attempts[0].extraInputs[0].value, '13/02/1990');
});

test('Allianz search blocks with a source-data reason when DOB is missing', () => {
  const submitter = new AllianzSubmitter({});
  const builder = submitter.runtime.config.searchAttemptBuilder;
  const state = {};

  const attempts = builder({
    visit: {
      patient_name: 'HAN SUIANG-SHIUH',
    },
    state,
  });

  assert.equal(attempts.length, 0);
  assert.equal(state.search_blocked_reason, 'allianz_dob_required');
  assert.equal(state.allianz_search_blocked, 'dob_required');
  assert.equal(state.allianz_dob_supplied, false);
});
