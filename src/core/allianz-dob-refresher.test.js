import assert from 'node:assert/strict';
import test from 'node:test';

import { AllianzDobRefresher } from './allianz-dob-refresher.js';

test('refreshVisitDob patches missing Allianz DOB from Clinic Assist patient biodata', async () => {
  const calls = [];
  const clinicAssist = {
    async login() {
      calls.push(['login']);
    },
    async navigateToPatientPage() {
      calls.push(['navigateToPatientPage']);
      return true;
    },
    async searchPatientByNumber(pcno) {
      calls.push(['searchPatientByNumber', pcno]);
      return true;
    },
    async openPatientFromSearchResultsByNumber(pcno) {
      calls.push(['openPatientFromSearchResultsByNumber', pcno]);
      return true;
    },
    async extractPatientDobFromPatientInfo() {
      calls.push(['extractPatientDobFromPatientInfo']);
      return { iso: '1985-04-03', raw: '03/04/1985', source: 'label:date of birth' };
    },
  };
  const supabase = {
    from(table) {
      assert.equal(table, 'visits');
      return {
        _operation: null,
        select(columns) {
          calls.push(['select', columns]);
          this._operation = 'select';
          return this;
        },
        update(patch) {
          calls.push(['update', patch]);
          this._operation = 'update';
          return this;
        },
        eq(column, value) {
          calls.push(['eq', column, value]);
          return this;
        },
        async single() {
          calls.push(['single']);
          return { data: { extraction_metadata: { flow1: { payType: 'ALLIANZ' } } }, error: null };
        },
        async then(resolve) {
          return resolve({ data: null, error: null });
        },
      };
    },
  };

  const refresher = new AllianzDobRefresher({ clinicAssist, supabase });
  const result = await refresher.refreshVisitDob({
    id: 'visit-1',
    patient_name: 'TEST PATIENT',
    extraction_metadata: { pcno: '12345', flow1: { payType: 'ALLIANZ' } },
  });

  assert.equal(result.status, 'refreshed');
  assert.equal(result.dob, '1985-04-03');
  assert.equal(result.visit.dob, '1985-04-03');
  assert.equal(result.visit.extraction_metadata.flow1.dob, '1985-04-03');
  assert.deepEqual(
    calls.map(call => call[0]),
    [
      'login',
      'navigateToPatientPage',
      'searchPatientByNumber',
      'openPatientFromSearchResultsByNumber',
      'extractPatientDobFromPatientInfo',
      'select',
      'eq',
      'single',
      'update',
      'eq',
    ]
  );
});

test('constructor creates Clinic Assist automation from a page when no automation is injected', () => {
  const page = {
    on() {},
    route() {
      return Promise.resolve();
    },
    context() {
      return { pages: () => [page] };
    },
  };
  const refresher = new AllianzDobRefresher({ clinicAssistPage: page, supabase: null });

  assert.equal(typeof refresher.clinicAssist.login, 'function');
});

test('refreshVisitDob skips Clinic Assist when visit already has DOB', async () => {
  let loginCalled = false;
  const refresher = new AllianzDobRefresher({
    clinicAssist: {
      async login() {
        loginCalled = true;
      },
    },
    supabase: null,
  });

  const result = await refresher.refreshVisitDob({
    id: 'visit-1',
    dob: '1990-02-13',
    extraction_metadata: {},
  });

  assert.equal(result.status, 'already_present');
  assert.equal(result.dob, '1990-02-13');
  assert.equal(result.visit.dob, '1990-02-13');
  assert.equal(loginCalled, false);
});

test('refreshVisitDob preserves current Supabase metadata when persisting DOB', async () => {
  const updates = [];
  const clinicAssist = {
    async login() {},
    async navigateToPatientPage() {
      return true;
    },
    async searchPatientByNumber() {
      return true;
    },
    async openPatientFromSearchResultsByNumber() {
      return true;
    },
    async extractPatientDobFromPatientInfo() {
      return { iso: '1985-04-03', raw: '03/04/1985', source: 'label:date of birth' };
    },
  };
  const supabase = {
    from(table) {
      assert.equal(table, 'visits');
      return {
        _operation: null,
        select(columns) {
          this._operation = ['select', columns];
          return this;
        },
        update(patch) {
          this._operation = ['update'];
          updates.push(patch);
          return this;
        },
        eq() {
          return this;
        },
        async single() {
          assert.deepEqual(this._operation, ['select', 'extraction_metadata']);
          return {
            data: {
              extraction_metadata: {
                diagnosisResolution: { status: 'resolved' },
                flow1: { payType: 'ALLIANZ' },
              },
            },
            error: null,
          };
        },
        async then(resolve) {
          assert.deepEqual(this._operation, ['update']);
          return resolve({ data: null, error: null });
        },
      };
    },
  };

  const refresher = new AllianzDobRefresher({ clinicAssist, supabase });
  await refresher.refreshVisitDob({
    id: 'visit-1',
    extraction_metadata: { pcno: '12345', staleOnly: true },
  });

  assert.equal(updates.length, 1);
  assert.equal(updates[0].extraction_metadata.diagnosisResolution.status, 'resolved');
  assert.equal(updates[0].extraction_metadata.flow1.payType, 'ALLIANZ');
  assert.equal(updates[0].extraction_metadata.flow1.dob, '1985-04-03');
  assert.equal(updates[0].extraction_metadata.staleOnly, undefined);
});

test('refreshVisitDob uses Clinic Assist DOB wrapper when available', async () => {
  let directExtractorCalled = false;
  const clinicAssist = {
    async login() {},
    async navigateToPatientPage() {
      return true;
    },
    async searchPatientByNumber() {
      return true;
    },
    async openPatientFromSearchResultsByNumber() {
      return true;
    },
    async getPatientDOB() {
      return { iso: '1985-04-03', raw: '03/04/1985', source: 'basic_info_tab' };
    },
    async extractPatientDobFromPatientInfo() {
      directExtractorCalled = true;
      return null;
    },
  };

  const refresher = new AllianzDobRefresher({ clinicAssist, supabase: null });
  const result = await refresher.refreshVisitDob({
    id: 'visit-1',
    extraction_metadata: { pcno: '12345' },
  });

  assert.equal(result.status, 'refreshed');
  assert.equal(result.dob, '1985-04-03');
  assert.equal(directExtractorCalled, false);
});
