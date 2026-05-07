import { PORTALS } from '../config/portals.js';
import { GenericPortalSubmitter, createDefaultSelectors } from './portal-generic-submitter.js';
import { buildIhpSubmittedTruthCapture } from './portal-truth/ihp.js';

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
    otpInputs: [
      'input[name*="otp" i]',
      'input[name*="verification" i]',
      'input[id*="otp" i]',
      'input[id*="verification" i]',
      'input[name*="token" i]',
      'input[id*="token" i]',
      // IHP 2-step verification page uses a generic text input
      'input[type="text"][name*="code" i]',
      'input[type="tel"]',
      'input[type="number"]',
    ],
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

export async function submitIhpEncryptedLogin({ page, helpers }) {
  const submittedByValidate = await page
    .evaluate(() => {
      const form = globalThis.document?.forms?.form1;
      const password = globalThis.document?.querySelector?.('#txtPassword');
      // IHP's login script reads document.form1.txtPassword. Some Chromium
      // builds expose id-only controls there, but setting the name makes the
      // encrypted-login path deterministic.
      if (password && !password.getAttribute('name')) {
        password.setAttribute('name', 'txtPassword');
      }
      if (form && typeof globalThis.validate === 'function') {
        globalThis.validate('');
        return true;
      }
      return false;
    })
    .catch(() => false);
  if (submittedByValidate) return 'ihp:validate-encrypted-login';
  return helpers?.clickFirst?.(
    [
      'button[name="btnSubmit"]',
      'button.btn-login',
      'button:has-text("LOG IN")',
      'button:has-text("Login")',
      'input[type="submit"]',
    ],
    { timeout: 3500 }
  );
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
      loginSubmitter: submitIhpEncryptedLogin,
    });
  }

  async submit(visit, runtimeCredential = null) {
    if (this.steps?.step) {
      this.steps.step(2, 'Submitting to IHP portal service');
    }
    const result = await this.runtime.submit(visit, runtimeCredential);
    return {
      ...result,
      submittedTruthCapture:
        result?.submittedTruthCapture ||
        buildIhpSubmittedTruthCapture({
          visit,
          result,
          portalUrl: result?.portalUrl || runtimeCredential?.url || this.runtime.defaultUrl || null,
          auditedAt: result?.processedAt || new Date().toISOString(),
        }),
      submittedTruthSnapshot: result?.submittedTruthSnapshot ?? null,
    };
  }
}
