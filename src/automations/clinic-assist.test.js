import assert from 'node:assert/strict';
import test from 'node:test';

import { ClinicAssistAutomation } from './clinic-assist.js';

function createStubPage(bodyText = '') {
  return {
    route: async () => {},
    on: () => {},
    waitForLoadState: async () => {},
    waitForTimeout: async () => {},
    textContent: async selector => (selector === 'body' ? bodyText : ''),
  };
}

test('extractPatientDobFromPatientInfo returns a normalized DOB from labeled biodata', async () => {
  const automation = new ClinicAssistAutomation(createStubPage());
  automation._logStep = () => {};
  automation._extractLabeledValue = async label =>
    label === 'date of birth' ? '13/02/1990' : null;

  const dob = await automation.extractPatientDobFromPatientInfo();

  assert.deepEqual(dob, {
    iso: '1990-02-13',
    raw: '13/02/1990',
    source: 'label:date of birth',
  });
});

test('extractPatientDobFromPatientInfo falls back to body text when labels are absent', async () => {
  const automation = new ClinicAssistAutomation(
    createStubPage('Patient Biodata\nDate of birth: 1990-02-13')
  );
  automation._logStep = () => {};
  automation._extractLabeledValue = async () => null;

  const dob = await automation.extractPatientDobFromPatientInfo();

  assert.deepEqual(dob, {
    iso: '1990-02-13',
    raw: '1990-02-13',
    source: 'body_text',
  });
});
