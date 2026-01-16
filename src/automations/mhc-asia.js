import { logger } from '../utils/logger.js';
import { PORTALS } from '../config/portals.js';

/**
 * MHC Asia automation module
 */
export class MHCAsiaAutomation {
  constructor(page) {
    this.page = page;
    this.config = PORTALS.MHC_ASIA;
    // Hard safety guard: never allow submission in live system
    this.draftOnly = true;
    this._mhcStep = 0;
  }

  _logStep(message, meta) {
    this._mhcStep += 1;
    const tag = `[MHC ${String(this._mhcStep).padStart(2, '0')}]`;
    if (meta !== undefined) logger.info(`${tag} ${message}`, meta);
    else logger.info(`${tag} ${message}`);
  }

  /**
   * Login to MHC Asia
   */
  async login() {
    try {
      this._logStep('Login start');
      logger.info(`Logging into ${this.config.name}...`);
      
      // Avoid 'networkidle' here; MHC pages can keep long-polling connections open.
      await this.page.goto(this.config.url, { waitUntil: 'domcontentloaded', timeout: 60000 });
      
      // Wait for login form
      await this.page.waitForSelector('input[type="text"], input[name*="username"], input[id*="username"]', { timeout: 10000 });
      
      // Find username field
      const usernameSelectors = [
        'input[name="username"]',
        'input[name="user"]',
        'input[id*="username"]',
        'input[id*="user"]',
        'input[type="text"]',
        'input[placeholder*="username" i]',
        'input[placeholder*="user" i]',
      ];

      let usernameField = null;
      for (const selector of usernameSelectors) {
        try {
          usernameField = await this.page.$(selector);
          if (usernameField) break;
        } catch (e) {
          continue;
        }
      }

      if (!usernameField) {
        await this.page.screenshot({ path: 'screenshots/mhc-asia-login-page.png', fullPage: true });
        throw new Error('Could not find username field');
      }

      await usernameField.fill(this.config.username);
      logger.info('Username filled');

      // Find password field
      const passwordSelectors = [
        'input[type="password"]',
        'input[name*="password"]',
        'input[id*="password"]',
      ];

      let passwordField = null;
      for (const selector of passwordSelectors) {
        try {
          passwordField = await this.page.$(selector);
          if (passwordField) break;
        } catch (e) {
          continue;
        }
      }

      if (!passwordField) {
        throw new Error('Could not find password field');
      }

      await passwordField.fill(this.config.password);
      logger.info('Password filled');

      // Find and click login button
      const loginButtonSelectors = [
        'button[type="submit"]',
        'input[type="submit"]',
        'button:has-text("Login")',
        'button:has-text("LOGIN HERE")',
        'button:has-text("Sign In")',
        'a:has-text("Login")',
        '[onclick*="login" i]',
        'form button',
        'form input[type="submit"]',
      ];

      let loginButton = null;
      for (const selector of loginButtonSelectors) {
        try {
          loginButton = await this.page.$(selector);
          if (loginButton) break;
        } catch (e) {
          continue;
        }
      }

      if (!loginButton) {
        // Try pressing Enter
        await passwordField.press('Enter');
        logger.info('Pressed Enter to submit');
      } else {
        await loginButton.click();
        logger.info('Login button clicked');
      }

      // Wait for navigation
      await this.page.waitForLoadState('domcontentloaded').catch(() => {});
      // Don't wait for networkidle (MHC can keep connections open)
      await this.page.waitForTimeout(2000);
      await this.page.locator('text=/Log\\s*Out/i').first().waitFor({ state: 'attached', timeout: 30000 }).catch(() => {});
      
      // Check for error messages
      const errorSelectors = [
        ':has-text("not able to authenticate")',
        ':has-text("authentication")',
        ':has-text("error")',
        '.error',
        '.alert',
      ];

      let hasError = false;
      for (const selector of errorSelectors) {
        try {
          const errorElement = await this.page.$(selector);
          if (errorElement) {
            const errorText = await errorElement.textContent();
            if (errorText && errorText.toLowerCase().includes('authenticate')) {
              hasError = true;
              logger.error(`Login error detected: ${errorText}`);
              break;
            }
          }
        } catch (e) {
          continue;
        }
      }

      if (hasError) {
        await this.page.screenshot({ path: 'screenshots/mhc-asia-login-error.png', fullPage: true });
        throw new Error('Authentication failed');
      }

      // Take screenshot after login
      await this.page.screenshot({ path: 'screenshots/mhc-asia-after-login.png', fullPage: true });
      
      logger.info(`Successfully logged into ${this.config.name}`);
      this._logStep('Login ok');
      return true;
    } catch (error) {
      logger.error(`Login failed for ${this.config.name}:`, error);
      await this.page.screenshot({ path: 'screenshots/mhc-asia-login-error.png', fullPage: true });
      throw error;
    }
  }

  async _safeClick(locator, label) {
    const timeoutMs = 10000;
    try {
      await locator.click({ timeout: timeoutMs });
    } catch {
      await locator.click({ timeout: timeoutMs, force: true }).catch(() => {});
    }
    // Avoid waiting for networkidle (many portals keep connections open)
    await this.page.waitForLoadState('domcontentloaded').catch(() => {});
    await this.page.waitForTimeout(1200);
    if (label) logger.info(`Clicked: ${label}`);
  }

  _normalizeText(s) {
    return (s || '').toString().replace(/\s+/g, ' ').trim();
  }

  _parseDiagnosisCandidate(text) {
    const t = this._normalizeText(text);
    if (!t) return null;
    const m =
      t.match(/(?:\bDx\b|\bDiagnosis\b|\bImpression\b|\bAssessment\b)\s*[:\-]\s*([^\n\r;.]{3,80})/i) ||
      t.match(/(?:\bDx\b|\bDiagnosis\b)\s+([^\n\r;.]{3,80})/i);
    if (m?.[1]) return this._normalizeText(m[1]);
    const head = t.split(/[.\n\r]/).map((x) => this._normalizeText(x)).find((x) => x.length >= 4);
    return head || null;
  }

  async fillVisitTypeFromClinicAssist(visitType) {
    this._logStep('Fill visit type -> charge type', { visitType });
    const t = (visitType || '').toString().toLowerCase();
    let desired = null;
    if (t.includes('new')) desired = /new/i;
    if (t.includes('follow')) desired = /follow/i;
    if (!desired) return false;

    const chargeTypeSelectors = ['select[name*="charge" i]', 'select[id*="charge" i]'];
    for (const sel of chargeTypeSelectors) {
      try {
        const select = this.page.locator(sel).first();
        if ((await select.count().catch(() => 0)) === 0) continue;
        const options = await select.locator('option').evaluateAll((opts) =>
          opts.map((o) => ({ value: o.value, label: (o.textContent || '').trim() }))
        );
        const match = options.find((o) => desired.test(o.label)) || options.find((o) => desired.test(o.value));
        if (!match) continue;
        await select.selectOption({ value: match.value }).catch(async () => select.selectOption({ label: match.label }));
        await this.page.waitForTimeout(400);
        logger.info(`Charge Type set from Clinic Assist visitType: ${visitType}`);
        return true;
      } catch {
        continue;
      }
    }
    return false;
  }

  async fillMcDays(mcDays) {
    this._logStep('Fill MC days', { mcDays });
    const days = Number.isFinite(Number(mcDays)) ? Number(mcDays) : 0;
    try {
      const row = this.page.locator('tr:has-text("MC Day")').first();
      if ((await row.count().catch(() => 0)) === 0) return false;
      const field = row.locator('select, input').first();
      if ((await field.count().catch(() => 0)) === 0) return false;
      const tag = await field.evaluate((el) => el.tagName).catch(() => 'INPUT');
      if (tag === 'SELECT') {
        const options = await field.locator('option').evaluateAll((opts) =>
          opts.map((o) => ({ value: o.value, label: (o.textContent || '').trim() }))
        );
        const match =
          options.find((o) => o.label === String(days) || o.value === String(days)) ||
          options.find((o) => o.label === '0' || o.value === '0');
        if (!match) return false;
        await field.selectOption({ value: match.value }).catch(async () => field.selectOption({ label: match.label }));
        logger.info(`MC days selected: ${days}`);
        return true;
      }
      await field.fill(String(days));
      logger.info(`MC days filled: ${days}`);
      return true;
    } catch {
      logger.warn('Could not fill MC days');
      return false;
    }
  }

  async fillDiagnosisFromText(diagnosisText) {
    this._logStep('Fill diagnosis (best-effort)', { sample: (diagnosisText || '').toString().slice(0, 80) || null });
    const candidate = this._parseDiagnosisCandidate(diagnosisText);
    if (!candidate) {
      logger.warn('No diagnosis text found to map into MHC diagnosis fields');
      return false;
    }

    const words = candidate
      .split(/\s+/)
      .map((w) => w.replace(/[^\w]/g, ''))
      .filter((w) => w.length >= 4)
      .slice(0, 3);
    const rx = words.length ? new RegExp(words.join('|'), 'i') : new RegExp(candidate.slice(0, 10), 'i');

    const tryRow = async (rowText) => {
      const row = this.page.locator(`tr:has-text("${rowText}")`).first();
      if ((await row.count().catch(() => 0)) === 0) return false;
      const select = row.locator('select').first();
      if ((await select.count().catch(() => 0)) === 0) return false;
      const options = await select.locator('option').evaluateAll((opts) =>
        opts.map((o) => ({ value: o.value, label: (o.textContent || '').trim() }))
      );
      const match = options.find((o) => rx.test(o.label)) || options.find((o) => rx.test(o.value));
      if (!match) return false;
      await select.selectOption({ value: match.value }).catch(async () => select.selectOption({ label: match.label }));
      return true;
    };

    const ok = (await tryRow('Diagnosis Pri')) || (await tryRow('Diagnosis Primary')) || (await tryRow('Diagnosis'));
    if (ok) {
      logger.info(`Diagnosis mapped into MHC from notes: ${candidate}`);
      return true;
    }
    logger.warn(`Could not map diagnosis into MHC selects (candidate="${candidate}")`);
    return false;
  }

  async setConsultationFeeMax(maxAmount) {
    this._logStep('Set consultation fee max', { maxAmount });
    const max = Number.isFinite(Number(maxAmount)) ? Number(maxAmount) : 9999;
    try {
      const row = this.page.locator('tr:has-text("Consultation Fee")').first();
      if ((await row.count().catch(() => 0)) > 0) {
        const input = row.locator('input[type="text"], input[type="number"]').first();
        if ((await input.count().catch(() => 0)) > 0) {
          await input.fill(String(max));
          await this.page.waitForTimeout(300);
          logger.info(`Consultation Fee set to max: ${max}`);
          return true;
        }
      }
    } catch {
      // ignore
    }
    await this.setConsultationMax(max).catch(() => {});
    return true;
  }

  async _fillTextInputsInTableSection(headerRegex, stopRegex, values) {
    return await this.page
      .evaluate(
        ({ headerReSrc, stopReSrc, values }) => {
          const headerRe = new RegExp(headerReSrc, 'i');
          const stopRe = stopReSrc ? new RegExp(stopReSrc, 'i') : null;
          const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();

          const els = Array.from(document.querySelectorAll('table, div, span, th, td, b, strong, h1, h2, h3'));
          const headerNode = els.find((el) => headerRe.test(norm(el.textContent)));
          if (!headerNode) return { filled: 0 };

          const table = headerNode.closest('table') || headerNode.parentElement?.closest('table');
          if (!table) return { filled: 0 };

          const rows = Array.from(table.querySelectorAll('tr'));
          const startIdx = rows.findIndex((r) => headerRe.test(norm(r.innerText)));
          if (startIdx < 0) return { filled: 0 };

          const candidates = [];
          for (let i = startIdx + 1; i < rows.length; i++) {
            const rowText = norm(rows[i].innerText);
            if (stopRe && stopRe.test(rowText)) break;
            const inputs = Array.from(rows[i].querySelectorAll('input[type="text"], input:not([type])'));
            for (const input of inputs) {
              const rect = input.getBoundingClientRect();
              if (rect.width <= 120) continue;
              if (input.disabled || input.readOnly) continue;
              candidates.push(input);
            }
          }

          let filled = 0;
          for (let i = 0; i < Math.min(values.length, candidates.length); i++) {
            const v = norm(values[i]);
            if (!v) continue;
            candidates[i].value = v;
            candidates[i].dispatchEvent(new Event('input', { bubbles: true }));
            candidates[i].dispatchEvent(new Event('change', { bubbles: true }));
            filled++;
          }
          return { filled };
        },
        { headerReSrc: headerRegex.source, stopReSrc: stopRegex?.source || null, values }
      )
      .catch(() => ({ filled: 0 }));
  }

  async fillServicesAndDrugs(items) {
    this._logStep('Fill services/drugs', { count: (items || []).length });
    const list = (items || []).map((x) => this._normalizeText(x)).filter(Boolean);
    if (!list.length) return false;

    const procedures = [];
    const drugs = [];
    for (const it of list) {
      if (/(xray|x-ray|scan|ultrasound|procedure|physio|ecg|injection|dressing|suturing|vaccine)/i.test(it)) {
        procedures.push(it);
      } else {
        drugs.push(it);
      }
    }

    const drugFilled = (await this._fillTextInputsInTableSection(/Drug Name/i, /Total Drug Fee/i, drugs)).filled;
    const procFilled = (await this._fillTextInputsInTableSection(/Procedure Name/i, /Total Proc Fee/i, procedures)).filled;

    logger.info(`Filled services/drugs into MHC: drugs=${drugFilled}, procedures=${procFilled}`);
    await this.page.screenshot({ path: 'screenshots/mhc-asia-after-items.png', fullPage: true }).catch(() => {});
    return drugFilled + procFilled > 0;
  }

  /**
   * Handle 2FA if required
   * @param {string} verificationCode - Optional verification code (if null, will wait for manual input)
   * @returns {boolean} True if 2FA handled or not required
   */
  async handle2FA(verificationCode = null) {
    try {
      this._logStep('2FA check', { provided: !!verificationCode });
      await this.page.waitForTimeout(3000);
      
      const pageText = await this.page.textContent('body').catch(() => '');
      const has2FA = pageText.includes('Verification Code') || 
                     pageText.includes('2 Factor') ||
                     pageText.includes('Enter Your Verification Code');
      
      if (!has2FA) {
        logger.info('2FA not required');
        this._logStep('2FA not required');
        return true;
      }
      
      logger.info('2FA detected');
      this._logStep('2FA detected - waiting/entering code');
      await this.page.screenshot({ path: 'screenshots/mhc-asia-2fa.png', fullPage: true });
      
      if (verificationCode) {
        // Find verification code input fields
        const codeInputs = await this.page.$$('input[type="text"]:not([disabled])');
        for (let i = 0; i < Math.min(codeInputs.length, verificationCode.length); i++) {
          await codeInputs[i].fill(verificationCode[i]);
        }
        logger.info('2FA code entered');
        // Submit 2FA
        const submitButton = await this.page.$('button[type="submit"], button:has-text("Submit"), button:has-text("Verify")');
        if (submitButton) {
          await submitButton.click();
          await this.page.waitForLoadState('networkidle');
        }
      } else {
        logger.warn('2FA required but no verification code provided - waiting for manual input');
        // Wait up to 60 seconds for manual 2FA entry
        await this.page.waitForTimeout(60000);
      }
      
      return true;
    } catch (error) {
      logger.error('Failed to handle 2FA:', error);
      return false;
    }
  }

  /**
   * Navigate to Normal Visit > Search Other Programs
   */
  async navigateToNormalVisit() {
    try {
      this._logStep('Navigate: Normal Visit');
      logger.info('Navigating to Normal Visit > Search Other Programs...');
      
      await this.page.waitForLoadState('domcontentloaded');
      await this.page.waitForTimeout(2000);
      
      // Step 1: Click on "Normal Visit" or similar
      const normalVisitSelectors = [
        'a:has-text("Normal Visit")',
        'a:has-text("Visit")',
        'button:has-text("Normal Visit")',
        '[href*="visit" i]',
        '[href*="normal" i]',
      ];
      
      for (const selector of normalVisitSelectors) {
        try {
          const link = this.page.locator(selector).first();
          if (await link.count() > 0) {
            await this._safeClick(link, 'Normal Visit');
            await this.page.screenshot({ path: 'screenshots/mhc-asia-after-normal-visit.png', fullPage: true });
            break;
          }
        } catch (e) {
          continue;
        }
      }
      
      // Step 2: Click on "Search Other Programs"
      const searchProgramsSelectors = [
        'a:has-text("Search Other Programs")',
        'a:has-text("Search Programs")',
        'button:has-text("Search Other Programs")',
        '[href*="search" i]',
        '[onclick*="search" i]',
      ];
      
      for (const selector of searchProgramsSelectors) {
        try {
          const link = this.page.locator(selector).first();
          if (await link.count() > 0) {
            await this._safeClick(link, 'Search Other Programs');
            await this.page.screenshot({ path: 'screenshots/mhc-asia-search-programs.png', fullPage: true });
            return true;
          }
        } catch (e) {
          continue;
        }
      }
      
      logger.warn('Could not find Search Other Programs');
      await this.page.screenshot({ path: 'screenshots/mhc-asia-search-programs-not-found.png', fullPage: true });
      return false;
    } catch (error) {
      logger.error('Failed to navigate to Normal Visit:', error);
      throw error;
    }
  }

  /**
   * Navigate specifically into AIA program search (user flow: Normal Visit > search under AIA program)
   */
  async navigateToAIAProgramSearch() {
    try {
      this._logStep('Navigate: AIA Program search');
      logger.info('Navigating to Normal Visit > AIA Program search...');
      await this.navigateToNormalVisit();

      // This page shows 2 big tiles. We need to click "Search under AIA Program" to reach the NRIC search form.
      const aiaTile = this.page.locator('text=/Search\\s+under\\s+AIA\\s+Program/i').first();
      if ((await aiaTile.count().catch(() => 0)) > 0) {
        await this._safeClick(aiaTile, 'Search under AIA Program (tile)');
        await this.page.screenshot({ path: 'screenshots/mhc-asia-aia-program.png', fullPage: true });
        logger.info('Entered AIA program search');
        this._logStep('Entered AIA Program search');
        return true;
      }

      logger.warn('Could not find AIA Program tile; will continue with NRIC search in current context.');
      await this.page.screenshot({ path: 'screenshots/mhc-asia-aia-program-not-found.png', fullPage: true });
      return false;
    } catch (error) {
      logger.error('Failed to navigate to AIA program search:', error);
      throw error;
    }
  }

  /**
   * Search patient by NRIC and determine portal
   * @param {string} nric - Patient NRIC
   * @returns {Object} Portal information and patient data
   */
  async searchPatientByNRIC(nric) {
    try {
      this._logStep('Search patient by NRIC', { nric });
      logger.info(`Searching patient by NRIC: ${nric}`);
      
      // Enter NRIC in search field
      const searchSelectors = [
        'input[name*="nric" i]',
        'input[id*="nric" i]',
        'input[name*="search" i]',
        'input[type="text"]',
        'input[placeholder*="NRIC" i]',
      ];
      
      let searchField = null;
      for (const selector of searchSelectors) {
        try {
          const field = this.page.locator(selector).first();
          if (await field.count() > 0) {
            searchField = field;
            break;
          }
        } catch (e) {
          continue;
        }
      }
      
      if (!searchField) {
        // If we're still on the tile selection screen, click the AIA tile and retry once.
        await this.page.screenshot({ path: 'screenshots/mhc-asia-before-search-field.png', fullPage: true }).catch(() => {});
        const aiaTile = this.page.locator('text=/Search\\s+under\\s+AIA\\s+Program/i').first();
        if ((await aiaTile.count().catch(() => 0)) > 0) {
          await this._safeClick(aiaTile, 'Search under AIA Program (tile)');
          await this.page.waitForTimeout(1200);
          for (const selector of searchSelectors) {
            try {
              const field = this.page.locator(selector).first();
              if (await field.count() > 0) {
                searchField = field;
                break;
              }
            } catch {
              continue;
            }
          }
        }
        if (!searchField) throw new Error('Could not find search field');
      }
      
      await searchField.fill(nric);
      await this.page.waitForTimeout(1000);
      
      // Click search button
      const searchButtonSelectors = [
        'button:has-text("Search")',
        'button[type="submit"]',
        'input[type="submit"]',
        'button:has-text("Submit")',
      ];
      
      for (const selector of searchButtonSelectors) {
        try {
          const button = this.page.locator(selector).first();
          if (await button.count() > 0) {
            await button.click();
            await this.page.waitForLoadState('networkidle');
            await this.page.waitForTimeout(3000);
            break;
          }
        } catch (e) {
          continue;
        }
      }
      
      await this.page.screenshot({ path: 'screenshots/mhc-asia-search-results.png', fullPage: true });
      
      // Parse results to determine portal (e.g., aiaclient, GE, etc.)
      const pageText = await this.page.textContent('body').catch(() => '');
      let portal = null;
      
      const portalPatterns = {
        'aiaclient': /aia|aiaclient/i,
        'ge': /great eastern|ge/i,
        'prudential': /prudential/i,
        'axa': /axa/i,
      };
      
      for (const [portalName, pattern] of Object.entries(portalPatterns)) {
        if (pattern.test(pageText)) {
          portal = portalName;
          break;
        }
      }
      
      logger.info(`Portal determined: ${portal}`);
      this._logStep('Search result parsed', { portal, found: portal !== null });
      
      return {
        nric: nric,
        portal: portal,
        found: portal !== null,
      };
    } catch (error) {
      logger.error('Failed to search patient by NRIC:', error);
      throw error;
    }
  }

  /**
   * From search results, click into the patient row/name if present
   * @param {string} nric
   */
  async openPatientFromSearchResults(nric) {
    try {
      this._logStep('Open patient from results', { nric });
      logger.info('Opening patient from search results...');
      const row = this.page.locator('tr').filter({ hasText: nric }).first();
      if ((await row.count().catch(() => 0)) > 0) {
        // The table uses a patient name link; clicking the row may not navigate.
        const nameLink = row.locator('a').first();
        if ((await nameLink.count().catch(() => 0)) > 0) {
          await this._safeClick(nameLink, 'Patient name link');
        } else {
          await this._safeClick(row, 'Patient row');
        }
        await this.page.screenshot({ path: 'screenshots/mhc-asia-patient-opened.png', fullPage: true });
        this._logStep('Patient opened from results');
        return true;
      }

      logger.warn('Could not open patient from search results');
      return false;
    } catch (error) {
      logger.error('Failed to open patient from results:', error);
      throw error;
    }
  }

  /**
   * Add visit for a portal (e.g., aiaclient > add aia visit)
   * @param {string} portal - Portal name (e.g., 'aiaclient')
   */
  async addVisit(portal) {
    try {
      this._logStep('Add visit', { portal });
      logger.info(`Adding visit for portal: ${portal}`);

      // Many flows start the visit form by clicking the patient in the search results.
      // If we already see "Visit Date" / "Visit" form fields, treat as already in visit creation.
      const alreadyInVisit =
        (await this.page.locator('text=/Visit Date/i').count().catch(() => 0)) > 0 ||
        (await this.page.locator('text=/Add Employee Visit/i').count().catch(() => 0)) > 0;
      if (alreadyInVisit) {
        logger.info('Already on visit form after selecting patient');
        await this.page.screenshot({ path: 'screenshots/mhc-asia-add-visit-form.png', fullPage: true }).catch(() => {});
        this._logStep('Already on visit form');
        return true;
      }
      
      // Click on portal link (e.g., "aiaclient")
      const portalSelectors = [
        `a:has-text("${portal}")`,
        `button:has-text("${portal}")`,
        `a[href*="${portal}" i]`,
      ];
      
      for (const selector of portalSelectors) {
        try {
          const link = this.page.locator(selector).first();
          if (await link.count() > 0) {
            await link.click();
            await this.page.waitForLoadState('networkidle');
            await this.page.waitForTimeout(2000);
            logger.info(`Clicked on portal: ${portal}`);
            break;
          }
        } catch (e) {
          continue;
        }
      }
      
      // Click "Add [Portal] Visit" (e.g., "Add AIA Visit")
      const addVisitSelectors = [
        `button:has-text("Add ${portal} Visit")`,
        `a:has-text("Add ${portal} Visit")`,
        `button:has-text("Add Visit")`,
        `a:has-text("Add Visit")`,
        'button:has-text("New Visit")',
      ];
      
      for (const selector of addVisitSelectors) {
        try {
          const button = this.page.locator(selector).first();
          if (await button.count() > 0) {
            await button.click();
            await this.page.waitForLoadState('networkidle');
            await this.page.waitForTimeout(2000);
            logger.info('Clicked Add Visit');
            await this.page.screenshot({ path: 'screenshots/mhc-asia-add-visit-form.png', fullPage: true });
            return true;
          }
        } catch (e) {
          continue;
        }
      }
      
      logger.warn('Could not find Add Visit button');
      return false;
    } catch (error) {
      logger.error('Failed to add visit:', error);
      throw error;
    }
  }

  /**
   * Select card and patient name
   * @param {string} cardNumber - Card number to select
   * @param {string} patientName - Patient name to select
   */
  async selectCardAndPatient(cardNumber, patientName) {
    try {
      this._logStep('Select card/patient', { cardNumber: cardNumber || null, patientName });
      logger.info(`Selecting card: ${cardNumber}, patient: ${patientName}`);
      
      // Select card
      const cardSelectors = [
        'select[name*="card" i]',
        'select[id*="card" i]',
        'select[name*="policy" i]',
      ];
      
      for (const selector of cardSelectors) {
        try {
          const select = this.page.locator(selector).first();
          if (await select.count() > 0) {
            // Try to select by value or label
            try {
              await select.selectOption({ label: cardNumber });
            } catch (e) {
              await select.selectOption({ value: cardNumber });
            }
            await this.page.waitForTimeout(1000);
            logger.info(`Card selected: ${cardNumber}`);
            break;
          }
        } catch (e) {
          continue;
        }
      }
      
      // Select patient name
      const patientSelectors = [
        'select[name*="patient" i]',
        'select[id*="patient" i]',
        'select[name*="name" i]',
      ];
      
      for (const selector of patientSelectors) {
        try {
          const select = this.page.locator(selector).first();
          if (await select.count() > 0) {
            if (!patientName || patientName === '__FIRST__') {
              const options = await select.locator('option').evaluateAll((opts) =>
                opts.map((o) => ({ value: o.value, label: (o.textContent || '').trim() }))
              );
              const candidate =
                options.find((o) => o.value && o.value.trim().length > 0) ||
                options.find((o) => o.label && o.label.trim().length > 0);
              if (candidate) {
                try {
                  await select.selectOption({ value: candidate.value });
                } catch {
                  await select.selectOption({ label: candidate.label });
                }
              }
            } else {
              await select.selectOption({ label: patientName });
            }
            await this.page.waitForTimeout(1000);
            logger.info(`Patient selected: ${patientName}`);
            break;
          }
        } catch (e) {
          continue;
        }
      }
      
      return true;
    } catch (error) {
      logger.error('Failed to select card and patient:', error);
      throw error;
    }
  }

  /**
   * Fill charge type from Clinic Assist
   * @param {string} chargeType - Charge type from Clinic Assist
   */
  async fillChargeType(chargeType) {
    try {
      logger.info(`Filling charge type: ${chargeType}`);
      
      const chargeTypeSelectors = [
        'select[name*="charge" i]',
        'select[id*="charge" i]',
        'input[name*="charge" i]',
      ];
      
      for (const selector of chargeTypeSelectors) {
        try {
          const field = this.page.locator(selector).first();
          if (await field.count() > 0) {
            const tagName = await field.evaluate(el => el.tagName);
            if (tagName === 'SELECT') {
              await field.selectOption({ label: chargeType });
            } else {
              await field.fill(chargeType);
            }
            await this.page.waitForTimeout(500);
            logger.info('Charge type filled');
            return true;
          }
        } catch (e) {
          continue;
        }
      }
      
      logger.warn('Could not find charge type field');
      return false;
    } catch (error) {
      logger.error('Failed to fill charge type:', error);
      throw error;
    }
  }

  /**
   * Process special remarks with AI context understanding
   * Determines diagnosis category and checks for waiver
   * @param {string} specialRemarks - Special remarks from Clinic Assist
   * @returns {Object} Processed remarks with diagnosis category and waiver flag
   */
  async processSpecialRemarks(specialRemarks) {
    try {
      logger.info(`Processing special remarks: ${specialRemarks?.substring(0, 50)}...`);
      
      if (!specialRemarks) {
        return { diagnosisCategory: null, hasWaiver: false };
      }
      
      // Simple keyword-based diagnosis category detection
      // In production, this could use an AI/ML model for better understanding
      const diagnosisKeywords = {
        'General Consultation': ['consultation', 'general', 'follow up', 'review'],
        'Acute Illness': ['fever', 'cough', 'cold', 'flu', 'infection', 'acute'],
        'Chronic Disease': ['diabetes', 'hypertension', 'chronic', 'long term'],
        'Preventive Care': ['vaccine', 'screening', 'checkup', 'preventive'],
        'Mental Health': ['depression', 'anxiety', 'mental', 'psychiatric'],
      };
      
      const remarksLower = specialRemarks.toLowerCase();
      let diagnosisCategory = 'General Consultation'; // Default
      
      for (const [category, keywords] of Object.entries(diagnosisKeywords)) {
        if (keywords.some(keyword => remarksLower.includes(keyword))) {
          diagnosisCategory = category;
          break;
        }
      }
      
      // Check for waiver keywords
      const waiverKeywords = ['waiver', 'waive', 'no referral', 'referral not required', 'exempt'];
      const hasWaiver = waiverKeywords.some(keyword => remarksLower.includes(keyword));
      
      logger.info(`Diagnosis category: ${diagnosisCategory}, Has waiver: ${hasWaiver}`);
      
      return {
        diagnosisCategory,
        hasWaiver,
        originalRemarks: specialRemarks,
      };
    } catch (error) {
      logger.error('Failed to process special remarks:', error);
      return { diagnosisCategory: null, hasWaiver: false };
    }
  }

  /**
   * Fill diagnosis category and check waiver checkbox if needed
   * @param {Object} processedRemarks - Processed remarks from processSpecialRemarks
   */
  async fillDiagnosisAndWaiver(processedRemarks) {
    try {
      logger.info('Filling diagnosis category and waiver...');
      
      // Fill diagnosis category
      const diagnosisSelectors = [
        'select[name*="diagnosis" i]',
        'select[id*="diagnosis" i]',
        'select[name*="category" i]',
      ];
      
      if (processedRemarks.diagnosisCategory) {
        for (const selector of diagnosisSelectors) {
          try {
            const select = this.page.locator(selector).first();
            if (await select.count() > 0) {
              await select.selectOption({ label: processedRemarks.diagnosisCategory });
              await this.page.waitForTimeout(500);
              logger.info(`Diagnosis category filled: ${processedRemarks.diagnosisCategory}`);
              break;
            }
          } catch (e) {
            continue;
          }
        }
      }
      
      // Check waiver of referral checkbox if needed
      if (processedRemarks.hasWaiver) {
        const waiverSelectors = [
          'input[type="checkbox"][name*="waiver" i]',
          'input[type="checkbox"][id*="waiver" i]',
          'input[type="checkbox"][name*="referral" i]',
        ];
        
        for (const selector of waiverSelectors) {
          try {
            const checkbox = this.page.locator(selector).first();
            if (await checkbox.count() > 0) {
              await checkbox.check();
              await this.page.waitForTimeout(500);
              logger.info('Waiver of referral checkbox checked');
              break;
            }
          } catch (e) {
            continue;
          }
        }
      }
      
      return true;
    } catch (error) {
      logger.error('Failed to fill diagnosis and waiver:', error);
      throw error;
    }
  }

  /**
   * Change consultation set max
   * @param {number} maxAmount - Maximum consultation amount
   */
  async setConsultationMax(maxAmount) {
    try {
      logger.info(`Setting consultation max: ${maxAmount}`);
      
      const maxSelectors = [
        'input[name*="max" i]',
        'input[id*="max" i]',
        'input[name*="consultation" i]',
        'input[type="number"]',
      ];
      
      for (const selector of maxSelectors) {
        try {
          const field = this.page.locator(selector).first();
          if (await field.count() > 0) {
            await field.fill(maxAmount.toString());
            await this.page.waitForTimeout(500);
            logger.info(`Consultation max set: ${maxAmount}`);
            return true;
          }
        } catch (e) {
          continue;
        }
      }
      
      logger.warn('Could not find consultation max field');
      return false;
    } catch (error) {
      logger.error('Failed to set consultation max:', error);
      throw error;
    }
  }

  /**
   * Fill medicine names in the form
   * @param {Array<string>} medicineNames - Array of medicine names
   */
  async fillMedicines(medicineNames) {
    try {
      logger.info(`Filling ${medicineNames.length} medicines...`);
      
      // Look for medicine input fields or add medicine buttons
      const medicineInputSelectors = [
        'input[name*="medicine" i]',
        'input[name*="drug" i]',
        'textarea[name*="medicine" i]',
        'input[placeholder*="medicine" i]',
      ];
      
      // Try to find and fill medicine fields
      for (let i = 0; i < medicineNames.length; i++) {
        const medicineName = medicineNames[i];
        
        // Look for add medicine button first
        const addButtonSelectors = [
          'button:has-text("Add Medicine")',
          'button:has-text("Add Drug")',
          'button:has-text("+")',
          'a:has-text("Add")',
        ];
        
        let added = false;
        for (const selector of addButtonSelectors) {
          try {
            const button = this.page.locator(selector).first();
            if (await button.count() > 0) {
              await button.click();
              await this.page.waitForTimeout(1000);
              
              // Fill the medicine name in the newly added field
              const medicineField = this.page.locator('input[type="text"]:last-of-type, textarea:last-of-type').first();
              if (await medicineField.count() > 0) {
                await medicineField.fill(medicineName);
                await this.page.waitForTimeout(500);
                added = true;
                logger.info(`Medicine added: ${medicineName}`);
                break;
              }
            }
          } catch (e) {
            continue;
          }
        }
        
        if (!added) {
          // Try direct input if no add button
          for (const selector of medicineInputSelectors) {
            try {
              const field = this.page.locator(selector).first();
              if (await field.count() > 0) {
                await field.fill(medicineName);
                await this.page.waitForTimeout(500);
                logger.info(`Medicine filled: ${medicineName}`);
                break;
              }
            } catch (e) {
              continue;
            }
          }
        }
      }
      
      return true;
    } catch (error) {
      logger.error('Failed to fill medicines:', error);
      throw error;
    }
  }

  /**
   * Save claim as draft (NOT submit)
   * @returns {boolean} True if saved successfully
   */
  async saveAsDraft() {
    try {
      logger.info('Saving claim as draft (NOT submitting)...');
      
      // Safety: never click submit-like buttons
      if (!this.draftOnly) {
        throw new Error('Draft-only mode disabled unexpectedly; refusing to proceed.');
      }

      // Lightweight screenshot for debugging (visit form shows buttons at bottom)
      await this.page.screenshot({ path: 'screenshots/mhc-asia-before-save-draft.png', fullPage: true }).catch(() => {});

      // Helper: click and capture any blocking dialog message.
      const clickWithDialogCapture = async (locator, label) => {
        const dialogPromise = this.page.waitForEvent('dialog', { timeout: 2000 }).catch(() => null);
        await this._safeClick(locator, label);
        const dialog = await dialogPromise;
        if (!dialog) return null;
        const msg = dialog.message?.() || '';
        logger.warn(`Dialog during draft save: ${msg}`);
        await dialog.accept().catch(() => {});
        return msg;
      };

      // Step 0: Click "Compute claim" if available (portal may require it before saving/submitting).
      const computeClaimCandidates = [
        this.page.getByRole('button', { name: /compute\s+claim/i }).first(),
        this.page.locator('button, input').filter({ hasText: /compute\s+claim/i }).first(),
      ];
      for (const computeLoc of computeClaimCandidates) {
        try {
          if ((await computeLoc.count().catch(() => 0)) === 0) continue;
          await this._safeClick(computeLoc, 'Compute claim');
          await this.page.waitForTimeout(1200);
          break;
        } catch {
          continue;
        }
      }

      // Only click buttons that explicitly indicate DRAFT (never generic "Save" to avoid risky actions).
      const saveDraftLocators = [
        // Accessible name based (covers <button>, <input type=button|submit|reset>, etc.)
        this.page.getByRole('button', { name: /save\s+as\s+draft/i }).first(),
        this.page.getByRole('button', { name: /save\s+(?:a\s+)?draft/i }).first(),
        // Fallbacks for older markup
        this.page.locator('button, input, a').filter({ hasText: /save\s+as\s+draft/i }).first(),
        this.page.locator('button, input, a').filter({ hasText: /save\s+(?:a\s+)?draft/i }).first(),
      ];

      // Prefer robust explicit matches first
      for (let i = 0; i < saveDraftLocators.length; i++) {
        const locator = saveDraftLocators[i];
        try {
          if ((await locator.count().catch(() => 0)) === 0) continue;

          // Extra safety: ensure the visible text/value contains "draft" and NOT "submit"
          const text = ((await locator.textContent().catch(() => '')) || '').toLowerCase();
          const ariaLabel = ((await locator.getAttribute('aria-label').catch(() => '')) || '').toLowerCase();
          if (
            !(text.includes('draft') || ariaLabel.includes('draft')) ||
            text.includes('submit') ||
            ariaLabel.includes('submit')
          ) {
            continue;
          }

          const dialogMsg = await clickWithDialogCapture(locator, 'Save As Draft');
          // Avoid networkidle (MHC keeps background connections open)
          await this.page.waitForLoadState('domcontentloaded').catch(() => {});
          await this.page.waitForTimeout(1500);

          await this.page.screenshot({ path: 'screenshots/mhc-asia-draft-saved.png', fullPage: true }).catch(() => {});
          if (dialogMsg && /must\s+compute\s+claim/i.test(dialogMsg)) {
            logger.warn('Draft save blocked: portal requires Compute claim first (already attempted).');
            return false;
          }
          logger.info('Claim saved as draft (clicked Save As Draft)');
          return true;
        } catch {
          continue;
        }
      }

      logger.warn('Could not find Save As Draft button');
      await this.page.screenshot({ path: 'screenshots/mhc-asia-save-draft-not-found.png', fullPage: true }).catch(() => {});
      return false;
    } catch (error) {
      logger.error('Failed to save as draft:', error);
      throw error;
    }
  }

  /**
   * Logout from MHC Asia
   */
  async logout() {
    try {
      logger.info('Logging out...');
      
      const logoutSelectors = [
        'a:has-text("Logout")',
        'a:has-text("Log Out")',
        'button:has-text("Logout")',
        '[href*="logout" i]',
        '[onclick*="logout" i]',
        '.logout',
        '#logout',
      ];

      for (const selector of logoutSelectors) {
        try {
          const element = await this.page.$(selector);
          if (element && await element.isVisible()) {
            await element.click();
            await this.page.waitForLoadState('networkidle');
            logger.info('Logged out successfully');
            return true;
          }
        } catch (e) {
          continue;
        }
      }

      logger.warn('Could not find logout button');
      return false;
    } catch (error) {
      logger.error('Failed to logout:', error);
      throw error;
    }
  }
}

