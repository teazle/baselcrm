import { PORTALS } from '../config/portals.js';
import { GenericPortalSubmitter, createDefaultSelectors } from './portal-generic-submitter.js';

function withOverrides(base, overrides) {
  const next = { ...base };
  for (const [key, list] of Object.entries(overrides || {})) {
    next[key] = [...new Set([...(list || []), ...(base[key] || [])])];
  }
  return next;
}

function buildSelectors() {
  return withOverrides(createDefaultSelectors(), {
    loginUsername: ['input[name="txtUserID"]', 'input[id="txtUserID"]', 'input[name*="userid" i]'],
    loginPassword: ['input[name="txtPassword"]', 'input[id="txtPassword"]'],
    loginSubmit: [
      'input[name*="btnLogin" i]',
      'button:has-text("LOG IN")',
      'button:has-text("Login")',
      'input[type="submit"]',
    ],
    otpInputs: ['input[name*="otp" i]', 'input[name*="verification" i]', 'input[id*="otp" i]'],
    searchInput: ['input[name*="nric" i]', 'input[id*="nric" i]', 'input[name*="member" i]'],
    searchSubmit: ['input[name*="btnSearch" i]', 'button:has-text("Search")'],
    searchResultRow: [
      'table tbody tr:has(input[type="button"][value*="Select" i]) input[type="button"][value*="Select" i]',
      'table tbody tr:first-child',
    ],
    formVisitDate: ['input[name*="VisitDate" i]', 'input[id*="VisitDate" i]'],
    formDiagnosis: ['textarea[name*="Diagnosis" i]', 'input[name*="Diagnosis" i]'],
    formAmount: ['input[name*="ClaimAmount" i]', 'input[name*="Consultation" i]'],
  });
}

/**
 * Dedicated submit service boundary for IHP portal flow.
 */
export class IHPSubmitter {
  constructor(page, steps = null) {
    this.steps = steps;
    this.runtime = new GenericPortalSubmitter({
      page,
      steps,
      portalTarget: 'IHP',
      portalName: 'IHP eClaim',
      defaultUrl: PORTALS.IHP?.url || 'https://eclaim.ihp.com.sg/eclaim/login.asp',
      defaultUsername: PORTALS.IHP?.username || '',
      defaultPassword: PORTALS.IHP?.password || '',
      supportsOtp: true,
      selectors: buildSelectors(),
    });
  }

  async submit(visit, runtimeCredential = null) {
    if (this.steps?.step) {
      this.steps.step(2, 'Submitting to IHP portal service');
    }
    return this.runtime.submit(visit, runtimeCredential);
  }
}
