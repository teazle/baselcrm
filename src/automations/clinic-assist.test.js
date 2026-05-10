import assert from 'node:assert/strict';
import test from 'node:test';

import { ClinicAssistAutomation } from './clinic-assist.js';

function createStubPage(bodyText = '', evaluateResult = null) {
  return {
    route: async () => {},
    on: () => {},
    waitForLoadState: async () => {},
    waitForTimeout: async () => {},
    textContent: async selector => (selector === 'body' ? bodyText : ''),
    evaluate: async () => evaluateResult,
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

test('extractPatientDobFromPatientInfo reads DOB from patient form controls', async () => {
  const automation = new ClinicAssistAutomation(createStubPage('', '13-Feb-1990'));
  automation._logStep = () => {};
  automation._extractLabeledValue = async () => null;

  const dob = await automation.extractPatientDobFromPatientInfo();

  assert.deepEqual(dob, {
    iso: '1990-02-13',
    raw: '13-Feb-1990',
    source: 'form_control',
  });
});

test('extractPatientDobFromPatientInfo parses DOB embedded in Clinic Assist form values', async () => {
  const automation = new ClinicAssistAutomation(createStubPage('', '13/02/1990 12:00:00 AM'));
  automation._logStep = () => {};
  automation._extractLabeledValue = async () => null;

  const dob = await automation.extractPatientDobFromPatientInfo();

  assert.deepEqual(dob, {
    iso: '1990-02-13',
    raw: '13/02/1990',
    source: 'form_control',
  });
});
