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

      // Wait for navigation - ultra minimal wait times
      await this.page.waitForLoadState('domcontentloaded').catch(() => {});
      // Don't wait for networkidle (MHC can keep connections open)
      // No wait - proceed immediately after domcontentloaded
      // Reduced timeout for Log Out check - proceed quickly
      await this.page.locator('text=/Log\\s*Out/i').first().waitFor({ state: 'attached', timeout: 1000 }).catch(() => {});
      
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
        await this.page.screenshot({ path: 'screenshots/mhc-asia-login-error.png', fullPage: true }).catch(() => {});
        throw new Error('Authentication failed');
      }

      // Wait for any loading/grey screen to disappear after login
      logger.info('Waiting for post-login page to fully load...');
      await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
      await this.page.waitForTimeout(2000); // Wait for grey screen to disappear
      
      // Take screenshot after login (non-blocking)
      await this.page.screenshot({ path: 'screenshots/mhc-asia-after-login.png', fullPage: true }).catch(() => {});
      
      logger.info(`Successfully logged into ${this.config.name}`);
      this._logStep('Login ok');
      return true;
    } catch (error) {
      logger.error(`Login failed for ${this.config.name}:`, error);
      await this.page.screenshot({ path: 'screenshots/mhc-asia-login-error.png', fullPage: true }).catch(() => {});
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
    await this.page.waitForTimeout(500);
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

  /**
   * Fill MC Start Date field
   * @param {string} mcStartDate - MC start date in format DD/MM/YYYY
   */
  async fillMcStartDate(mcStartDate) {
    this._logStep('Fill MC start date', { mcStartDate });
    try {
      if (!mcStartDate) {
        logger.warn('No MC start date provided');
        return false;
      }

      // Try to find MC start date field
      const mcStartDateSelectors = [
        'tr:has-text("MC Start Date")',
        'tr:has-text("MC Date")',
        'tr:has-text("Start Date")',
      ];

      for (const rowSelector of mcStartDateSelectors) {
        try {
          const row = this.page.locator(rowSelector).first();
          if ((await row.count().catch(() => 0)) === 0) continue;

          const field = row.locator('input[type="text"], input[type="date"], input').first();
          if ((await field.count().catch(() => 0)) === 0) continue;

          await field.fill(mcStartDate);
          await this.page.waitForTimeout(300);
          logger.info(`MC start date filled: ${mcStartDate}`);
          return true;
        } catch {
          continue;
        }
      }

      logger.warn('Could not find MC start date field');
      return false;
    } catch (error) {
      logger.warn('Could not fill MC start date:', error.message);
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
      
      // Wait for page to be fully loaded and ready
      await this.page.waitForLoadState('domcontentloaded');
      await this.page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
      await this.page.waitForTimeout(1000); // Ensure page is stable
      
      // Step 1: Click on "Normal Visit" or similar - try multiple selectors
      const normalVisitSelectors = [
        'a:has-text("Normal Visit")',
        'a:has-text("Visit")',
        'button:has-text("Normal Visit")',
        'a[href*="NormalVisit" i]',
        'a[href*="normalvisit" i]',
        'a[href*="visit" i]',
        '[onclick*="visit" i]',
        '[onclick*="normal" i]',
      ];
      
      let normalVisitClicked = false;
      for (const selector of normalVisitSelectors) {
        try {
          const link = this.page.locator(selector).first();
          const count = await link.count().catch(() => 0);
          if (count > 0) {
            const isVisible = await link.isVisible().catch(() => false);
            if (isVisible) {
              this._logStep('Found Normal Visit link', { selector });
              await this._safeClick(link, 'Normal Visit');
              await this.page.waitForTimeout(300);
              await this.page.screenshot({ path: 'screenshots/mhc-asia-after-normal-visit.png', fullPage: true });
              normalVisitClicked = true;
              break;
            }
          }
        } catch (e) {
          this._logStep('Error trying Normal Visit selector', { selector, error: e.message });
          continue;
        }
      }
      
      if (!normalVisitClicked) {
        this._logStep('Could not find Normal Visit link - taking screenshot for debugging');
        await this.page.screenshot({ path: 'screenshots/mhc-asia-normal-visit-not-found.png', fullPage: true });
        throw new Error('Could not find Normal Visit link after login');
      }
      
      // After "Normal Visit", we're on the program selection page with two tiles:
      // 1. "Search under AIA Program" 
      // 2. "Search under other programs"
      // We'll proceed directly to the tile selection - no additional step needed here
      this._logStep('At program selection page (Normal Visit clicked)');
      await this.page.waitForTimeout(500);
      await this.page.screenshot({ path: 'screenshots/mhc-asia-programs-page.png', fullPage: true });
      
      return true;
    } catch (error) {
      logger.error('Failed to navigate to Normal Visit:', error);
      throw error;
    }
  }

  /**
   * Navigate specifically into AIA program search (user flow: Normal Visit > search under AIA program)
   * NOTE: This method uses UI navigation instead of direct URL to avoid navigation issues
   */
  async navigateToAIAProgramSearch() {
    try {
      this._logStep('Navigate: AIA Program search');
      logger.info('Navigating to AIA Program search through UI...');
      
      // Use UI navigation instead of direct URL
      await this.navigateToNormalVisit();
      
      // After navigating to "Search Other Programs", click on "Search under AIA Program" tile if present
      await this.page.waitForLoadState('domcontentloaded');
      await this.page.waitForTimeout(500);
      
      const aiaTileSelectors = [
        'text=/Search\\s+under\\s+AIA\\s+Program/i',
        'a:has-text("AIA Program")',
        'button:has-text("AIA")',
        '[href*="aia" i]',
      ];
      
      for (const selector of aiaTileSelectors) {
        try {
          const tile = this.page.locator(selector).first();
          if ((await tile.count().catch(() => 0)) > 0) {
            await this._safeClick(tile, 'Search under AIA Program (tile)');
            await this.page.waitForTimeout(500);
            break;
          }
        } catch (e) {
          continue;
        }
      }
      
      await this.page.screenshot({ path: 'screenshots/mhc-asia-patient-search.png', fullPage: true });
      this._logStep('Navigated to patient search page');
      return true;
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
        // If we're still on the tile selection screen, click the "Search under other programs" tile
        await this.page.screenshot({ path: 'screenshots/mhc-asia-before-search-field.png', fullPage: true }).catch(() => {});
        
        // Try to find and click "Search under other programs" tile (NOT AIA)
        const otherProgramsSelectors = [
          'text=/Search\\s+under\\s+other\\s+programs/i',
          'a:has-text("other programs")',
          'div:has-text("other programs")',
          '[onclick*="other" i]',
        ];
        
        let otherProgramsClicked = false;
        for (const selector of otherProgramsSelectors) {
          try {
            const tile = this.page.locator(selector).first();
            if ((await tile.count().catch(() => 0)) > 0) {
              await this._safeClick(tile, 'Search under other programs (tile)');
              await this.page.waitForTimeout(1200);
              otherProgramsClicked = true;
              break;
            }
          } catch {
            continue;
          }
        }
        
        if (otherProgramsClicked) {
          // Re-locate the search field after clicking the tile
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

  /**
   * Fill Visit Date field
   * @param {string} date - Date in DD/MM/YYYY format
   */
  async fillVisitDate(date) {
    try {
      this._logStep('Fill visit date', { date });
      
      // Visit date field selectors
      const dateSelectors = [
        'input[name*="visitDate" i]',
        'input[id*="visitDate" i]',
        'input[placeholder*="visit" i]',
        'input[type="text"][value*="/"]', // Date format
      ];

      for (const selector of dateSelectors) {
        try {
          const field = this.page.locator(selector).first();
          if ((await field.count().catch(() => 0)) > 0) {
            await field.fill(date);
            this._logStep('Visit date filled', { date });
            return true;
          }
        } catch (e) {
          continue;
        }
      }

      logger.warn('Visit date field not found');
      return false;
    } catch (error) {
      logger.error('Failed to fill visit date:', error);
      return false;
    }
  }

  /**
   * Fill Charge Type dropdown
   * Maps Clinic Assist visit types to MHC options
   * @param {string} visitType - Visit type from Clinic Assist: "New", "Follow Up", "Repeat"
   */
  async fillChargeType(visitType) {
    try {
      this._logStep('Fill charge type', { visitType });
      
      // Map visit types
      const typeMap = {
        'new': 'First Consult',
        'follow up': 'Follow Up',
        'follow': 'Follow Up',
        'repeat': 'Repeat Medicine',
        'repeat medicine': 'Repeat Medicine',
      };

      const mhcType = typeMap[visitType?.toLowerCase()] || 'Follow Up';

      // Find charge type dropdown
      const dropdownSelectors = [
        'select[name*="charge" i]',
        'select[id*="charge" i]',
        'select[name*="type" i]',
        'select option:has-text("First Consult")',
      ];

      for (const selector of dropdownSelectors) {
        try {
          let dropdown;
          if (selector.includes('option:has-text')) {
            dropdown = this.page.locator('select').first();
          } else {
            dropdown = this.page.locator(selector).first();
          }
          
          if ((await dropdown.count().catch(() => 0)) > 0) {
            await dropdown.selectOption({ label: mhcType });
            this._logStep('Charge type filled', { visitType, mhcType });
            return true;
          }
        } catch (e) {
          continue;
        }
      }

      logger.warn('Charge type dropdown not found');
      return false;
    } catch (error) {
      logger.error('Failed to fill charge type:', error);
      return false;
    }
  }

  /**
   * Fill MC Days field
   * @param {number} mcDays - Number of MC days (usually 0)
   */
  async fillMcDays(mcDays) {
    try {
      this._logStep('Fill MC days', { mcDays });
      
      const mcSelectors = [
        'input[name*="mc" i][name*="day" i]',
        'input[id*="mc" i][id*="day" i]',
        'input[placeholder*="mc" i]',
      ];

      for (const selector of mcSelectors) {
        try {
          const field = this.page.locator(selector).first();
          if ((await field.count().catch(() => 0)) > 0) {
            await field.fill(mcDays.toString());
            this._logStep('MC days filled', { mcDays });
            return true;
          }
        } catch (e) {
          continue;
        }
      }

      logger.warn('MC days field not found');
      return false;
    } catch (error) {
      logger.error('Failed to fill MC days:', error);
      return false;
    }
  }

  /**
   * Fill Consultation Fee field
   * @param {number} fee - Consultation fee amount
   */
  async fillConsultationFee(fee) {
    try {
      this._logStep('Fill consultation fee', { fee });
      
      // Strategy: Enter 99999 to trigger max amount dialog, then accept it
      const highAmount = '99999';
      
      // Try to find the consultation fee field
      const feeSelectors = [
        'input[name*="consultfee" i]',
        'input[name*="ConsultFee" i]',
        'input[id*="consultfee" i]',
        'input[name*="consultation" i]',
        'input[id*="consultation" i]',
        'input[name*="consult" i]',
      ];

      let feeInput = null;
      
      // First try direct selectors
      for (const selector of feeSelectors) {
        try {
          const field = this.page.locator(selector).first();
          if ((await field.count().catch(() => 0)) > 0) {
            feeInput = field;
            break;
          }
        } catch (e) {
          continue;
        }
      }

      // Try to find by label text "Consultation Fee"
      if (!feeInput) {
        try {
          const feeLabel = this.page.locator('td:has-text("Consultation Fee")').first();
          if (await feeLabel.count() > 0) {
            const row = feeLabel.locator('xpath=ancestor::tr');
            const input = row.locator('input[type="text"]').first();
            if (await input.count() > 0) {
              feeInput = input;
            }
          }
        } catch (e) {
          // Continue
        }
      }

      if (!feeInput) {
        // Try JavaScript to find the field
        const found = await this.page.evaluate(() => {
          const inputs = document.querySelectorAll('input[type="text"]');
          for (const input of inputs) {
            const row = input.closest('tr');
            if (row && row.textContent.toLowerCase().includes('consultation fee')) {
              return true;
            }
          }
          return false;
        });
        
        if (found) {
          // Use JavaScript to fill
          await this.page.evaluate((value) => {
            const inputs = document.querySelectorAll('input[type="text"]');
            for (const input of inputs) {
              const row = input.closest('tr');
              if (row && row.textContent.toLowerCase().includes('consultation fee')) {
                input.value = value;
                input.dispatchEvent(new Event('change', { bubbles: true }));
                input.dispatchEvent(new Event('blur', { bubbles: true }));
                return;
              }
            }
          }, highAmount);
          
          this._logStep('Consultation fee set to 99999 via JS, waiting for dialog');
        }
      } else {
        // Fill the input with high amount to trigger max dialog
        await feeInput.clear();
        await feeInput.fill(highAmount);
        await feeInput.press('Tab'); // Trigger blur/change
        this._logStep('Consultation fee set to 99999, waiting for dialog');
      }

      // Wait for and accept the max amount dialog
      await this.page.waitForTimeout(500);
      
      // Handle the dialog - accept to use the max amount
      // The dialog handler should be set up before this, but also try clicking OK
      try {
        const okButton = this.page.locator('button:has-text("OK"), input[value="OK"], button:has-text("Yes")').first();
        if (await okButton.count() > 0 && await okButton.isVisible()) {
          await okButton.click();
          this._logStep('Clicked OK on max amount dialog');
        }
      } catch (e) {
        // Dialog might be handled automatically
      }

      await this.page.waitForTimeout(300);
      this._logStep('Consultation fee filled (max amount accepted)');
      return true;
    } catch (error) {
      logger.error('Failed to fill consultation fee:', error);
      return false;
    }
  }

  /**
   * Fill Primary Diagnosis using "M" button search modal
   * @param {string} diagnosisText - Diagnosis text to search for
   */
  async fillDiagnosisPrimary(diagnosisText) {
    try {
      this._logStep('Fill primary diagnosis via M button', { diagnosis: diagnosisText?.substring(0, 50) });
      
      if (!diagnosisText || diagnosisText.length < 2) {
        logger.warn('Diagnosis text too short, skipping');
        return false;
      }

      // Find and click "M" button for Diagnosis Pri - it's an INPUT element, not button
      // Exact selector: #visit_form > table > tbody > tr:nth-child(2) > td > table > tbody > tr:nth-child(14) > td:nth-child(2) > input
      const mButtonSelectors = [
        '#visit_form > table > tbody > tr:nth-child(2) > td > table > tbody > tr:nth-child(14) > td:nth-child(2) > input',
        'tr:has-text("Diagnosis Pri") input[value="M"]',
        'tr:has-text("Diagnosis Pri") input[type="button"][value="M"]',
        'input[value="M"]:near(text="Diagnosis Pri", 200)',
        'input[type="submit"][value="M"]',
        'input[type="button"][value="M"]',
      ];

      let mButtonFound = false;
      for (const selector of mButtonSelectors) {
        try {
          const mButton = this.page.locator(selector).first();
          if ((await mButton.count().catch(() => 0)) > 0) {
            await mButton.click();
            this._logStep('Clicked M button for diagnosis search', { selector });
            mButtonFound = true;
            break;
          }
        } catch (e) {
          continue;
        }
      }

      if (!mButtonFound) {
        // Try JavaScript click as fallback
        const clicked = await this.page.evaluate(() => {
          // Find the M button near Diagnosis Pri row
          const rows = document.querySelectorAll('tr');
          for (const row of rows) {
            if (row.textContent?.includes('Diagnosis Pri')) {
              const mButton = row.querySelector('input[value="M"]');
              if (mButton) {
                mButton.click();
                return true;
              }
            }
          }
          // Try exact selector
          const exactBtn = document.querySelector('#visit_form input[value="M"]');
          if (exactBtn) {
            exactBtn.click();
            return true;
          }
          return false;
        });
        
        if (clicked) {
          this._logStep('Clicked M button via JavaScript');
          mButtonFound = true;
        }
      }

      if (!mButtonFound) {
        logger.warn('M button for diagnosis not found');
        return false;
      }

      // Wait for search modal to appear
      await this.page.waitForTimeout(1000);

      // Find search field in modal
      const searchSelectors = [
        'input[type="text"]:visible',
        'input[placeholder*="search" i]:visible',
        'input[name*="search" i]:visible',
        'dialog input[type="text"]',
        '.modal input[type="text"]',
      ];

      let searchField = null;
      for (const selector of searchSelectors) {
        try {
          const field = this.page.locator(selector).first();
          if ((await field.count().catch(() => 0)) > 0 && await field.isVisible()) {
            searchField = field;
            break;
          }
        } catch (e) {
          continue;
        }
      }

      if (!searchField) {
        logger.warn('Search field in modal not found');
        return false;
      }

      // Enter diagnosis search text
      await searchField.fill(diagnosisText.substring(0, 50));
      this._logStep('Entered diagnosis search text');

      // Click search/find button or press Enter
      const searchButtonSelectors = [
        'button:has-text("Search")',
        'button:has-text("Find")',
        'button[type="submit"]',
      ];

      let searchButtonFound = false;
      for (const selector of searchButtonSelectors) {
        try {
          const button = this.page.locator(selector).first();
          if ((await button.count().catch(() => 0)) > 0 && await button.isVisible()) {
            await button.click();
            searchButtonFound = true;
            break;
          }
        } catch (e) {
          continue;
        }
      }

      if (!searchButtonFound) {
        // Try pressing Enter
        await searchField.press('Enter');
      }

      this._logStep('Triggered diagnosis search');
      await this.page.waitForTimeout(1500);

      // Select first result
      const resultSelectors = [
        'table tr:visible:first-child',
        'div[role="option"]:visible:first-child',
        '.result:visible:first-child',
        'li:visible:first-child',
      ];

      for (const selector of resultSelectors) {
        try {
          const firstResult = this.page.locator(selector).first();
          if ((await firstResult.count().catch(() => 0)) > 0 && await firstResult.isVisible()) {
            await firstResult.click();
            this._logStep('Selected first diagnosis result');
            await this.page.waitForTimeout(500);
            return true;
          }
        } catch (e) {
          continue;
        }
      }

      logger.warn('Could not select diagnosis result');
      return false;
    } catch (error) {
      logger.error('Failed to fill primary diagnosis:', error);
      return false;
    }
  }

  /**
   * Fill a drug item using "M" button search modal
   * @param {Object} drugData - Drug data: { name, quantity }
   * @param {number} rowIndex - Row index (1-based)
   */
  async fillDrugItem(drugData, rowIndex = 1) {
    try {
      this._logStep('Fill drug item', { drug: drugData.name?.substring(0, 30), quantity: drugData.quantity, rowIndex });
      
      if (!drugData.name || drugData.name.length < 2) {
        logger.warn('Drug name too short, skipping');
        return false;
      }

      // Find and click "M" button for drug row
      const mButtonSelectors = [
        `(//button[text()='M'])[${rowIndex}]`,
        `(//td[contains(., 'Drug Name')]/..//button[text()='M'])[${rowIndex}]`,
        `table tr:nth-child(${rowIndex}) button:has-text("M")`,
      ];

      let mButtonFound = false;
      for (const selector of mButtonSelectors) {
        try {
          const mButton = selector.startsWith('//') 
            ? this.page.locator(selector) 
            : this.page.locator(selector).first();
          
          if ((await mButton.count().catch(() => 0)) > 0) {
            await mButton.click();
            this._logStep(`Clicked M button for drug row ${rowIndex}`);
            mButtonFound = true;
            break;
          }
        } catch (e) {
          continue;
        }
      }

      if (!mButtonFound) {
        logger.warn(`M button for drug row ${rowIndex} not found`);
        return false;
      }

      // Wait for search modal
      await this.page.waitForTimeout(1000);

      // Find and fill search field
      const searchField = this.page.locator('input[type="text"]:visible').first();
      if ((await searchField.count().catch(() => 0)) > 0) {
        await searchField.fill(drugData.name.substring(0, 50));
        await searchField.press('Enter');
        this._logStep('Entered drug search text');
        await this.page.waitForTimeout(1500);

        // Select first result
        const firstResult = this.page.locator('table tr:visible, div[role="option"]:visible').first();
        if ((await firstResult.count().catch(() => 0)) > 0) {
          await firstResult.click();
          this._logStep('Selected drug from search results');
        }
      }

      // Fill quantity if provided
      if (drugData.quantity) {
        await this.page.waitForTimeout(500);
        
        const qtySelectors = [
          `table tr:nth-child(${rowIndex}) input[name*="qty" i]`,
          `table tr:nth-child(${rowIndex}) input[name*="quantity" i]`,
          `(//input[contains(@name, 'qty')])[${rowIndex}]`,
        ];

        for (const selector of qtySelectors) {
          try {
            const qtyField = selector.startsWith('//') 
              ? this.page.locator(selector)
              : this.page.locator(selector).first();
            
            if ((await qtyField.count().catch(() => 0)) > 0) {
              await qtyField.fill(drugData.quantity.toString());
              this._logStep('Filled drug quantity', { quantity: drugData.quantity });
              break;
            }
          } catch (e) {
            continue;
          }
        }
      }

      return true;
    } catch (error) {
      logger.error('Failed to fill drug item:', error);
      return false;
    }
  }

  /**
   * Click "More Drug" button to add another drug row
   */
  async clickMoreDrug() {
    try {
      this._logStep('Click More Drug button');
      
      const moreDrugSelectors = [
        'button:has-text("More Drug")',
        'button:has-text("Add Drug")',
        'input[value*="More Drug" i]',
      ];

      for (const selector of moreDrugSelectors) {
        try {
          const button = this.page.locator(selector).first();
          if ((await button.count().catch(() => 0)) > 0) {
            await button.click();
            await this.page.waitForTimeout(500);
            this._logStep('More Drug button clicked');
            return true;
          }
        } catch (e) {
          continue;
        }
      }

      logger.warn('More Drug button not found');
      return false;
    } catch (error) {
      logger.error('Failed to click More Drug:', error);
      return false;
    }
  }

  /**
   * Click "Compute claim" button to calculate totals
   */
  async computeClaim() {
    try {
      this._logStep('Click Compute claim button');
      
      const computeSelectors = [
        'button:has-text("Compute claim")',
        'button:has-text("Compute")',
        'input[value*="Compute" i]',
      ];

      for (const selector of computeSelectors) {
        try {
          const button = this.page.locator(selector).first();
          if ((await button.count().catch(() => 0)) > 0) {
            await button.click();
            await this.page.waitForTimeout(1000);
            this._logStep('Compute claim clicked');
            return true;
          }
        } catch (e) {
          continue;
        }
      }

      logger.warn('Compute claim button not found');
      return false;
    } catch (error) {
      logger.error('Failed to click Compute claim:', error);
      return false;
    }
  }

  /**
   * Fill drug name using exact selector
   * Selector: #drugTable > tbody > tr:nth-child(2) > td:nth-child(2) > input:nth-child(3)
   * @param {string} drugName - Drug name to fill
   */
  async fillDrugName(drugName) {
    try {
      this._logStep('Fill drug name', { drugName });
      
      const drugSelector = '#drugTable > tbody > tr:nth-child(2) > td:nth-child(2) > input:nth-child(3)';
      
      // Try the exact selector first
      let drugInput = this.page.locator(drugSelector).first();
      
      if ((await drugInput.count().catch(() => 0)) === 0) {
        // Try alternative selectors
        const altSelectors = [
          '#drugTable input[type="text"]',
          'table[id*="drug" i] input[type="text"]',
          'tr:has-text("Drug Name") input[type="text"]',
        ];
        
        for (const sel of altSelectors) {
          drugInput = this.page.locator(sel).first();
          if ((await drugInput.count().catch(() => 0)) > 0) {
            break;
          }
        }
      }
      
      if ((await drugInput.count().catch(() => 0)) > 0) {
        await drugInput.clear();
        await drugInput.fill(drugName);
        this._logStep('Drug name filled', { drugName });
        return true;
      }
      
      // Try JavaScript fallback
      const filled = await this.page.evaluate((name) => {
        const input = document.querySelector('#drugTable > tbody > tr:nth-child(2) > td:nth-child(2) > input:nth-child(3)');
        if (input) {
          input.value = name;
          input.dispatchEvent(new Event('change', { bubbles: true }));
          return true;
        }
        return false;
      }, drugName);
      
      if (filled) {
        this._logStep('Drug name filled via JavaScript', { drugName });
        return true;
      }
      
      logger.warn('Drug name field not found');
      return false;
    } catch (error) {
      logger.error('Failed to fill drug name:', error);
      return false;
    }
  }

  /**
   * Set charge type to New Visit
   */
  /**
   * Set charge type - options: "First Consult", "Follow Up", "Repeat Medicine"
   * @param {string} chargeType - 'first' for First Consult, 'follow' for Follow Up
   */
  async setChargeType(chargeType = 'first') {
    try {
      this._logStep('Set charge type', { chargeType });
      
      // Determine which option to select
      const searchPattern = chargeType.toLowerCase().includes('follow') ? /follow/i : /first/i;
      
      // The select name is "subType"
      const chargeTypeSelectors = [
        'select[name="subType"]',
        'select[name*="subType" i]',
        'select[name*="charge" i]',
      ];
      
      for (const selector of chargeTypeSelectors) {
        try {
          const select = this.page.locator(selector).first();
          if ((await select.count().catch(() => 0)) > 0) {
            const options = await select.locator('option').evaluateAll((opts) =>
              opts.map((o) => ({ value: o.value, label: (o.textContent || '').trim() }))
            );
            
            const targetOption = options.find((o) => searchPattern.test(o.label));
            
            if (targetOption) {
              await select.selectOption({ value: targetOption.value });
              this._logStep('Charge type set', { value: targetOption.value, label: targetOption.label });
              return true;
            }
          }
        } catch (e) {
          continue;
        }
      }
      
      // Try JavaScript fallback
      const selected = await this.page.evaluate((pattern) => {
        const select = document.querySelector('select[name="subType"]');
        if (select) {
          const regex = new RegExp(pattern, 'i');
          for (const opt of select.options) {
            if (regex.test(opt.text)) {
              select.value = opt.value;
              select.dispatchEvent(new Event('change', { bubbles: true }));
              return { success: true, value: opt.value, text: opt.text };
            }
          }
        }
        return { success: false };
      }, chargeType.toLowerCase().includes('follow') ? 'follow' : 'first');
      
      if (selected.success) {
        this._logStep('Charge type set via JavaScript', selected);
        return true;
      }
      
      logger.warn('Charge type field not found');
      return false;
    } catch (error) {
      logger.error('Failed to set charge type:', error);
      return false;
    }
  }

  /**
   * Set charge type to First Consult (New Visit)
   */
  async setChargeTypeNewVisit() {
    return this.setChargeType('first');
  }

  /**
   * Set charge type to Follow Up
   */
  async setChargeTypeFollowUp() {
    return this.setChargeType('follow');
  }

  /**
   * Setup dialog handler to auto-accept prompts (for consultation fee max amount)
   */
  setupDialogHandler() {
    this.page.on('dialog', async (dialog) => {
      logger.info(`Dialog appeared: ${dialog.type()} - ${dialog.message()}`);
      await dialog.accept();
      logger.info('Dialog accepted');
    });
    this._logStep('Dialog handler set up');
  }

  /**
   * Select diagnosis from dropdown by searching for a keyword
   * The dropdown name is "diagnosisPriIdTemp" for primary diagnosis
   * @param {string} searchTerm - Term to search for in diagnosis options (e.g., "sprain", "headache")
   */
  async selectDiagnosis(searchTerm) {
    try {
      this._logStep('Select diagnosis from dropdown', { searchTerm });
      
      if (!searchTerm || searchTerm.length < 2) {
        logger.warn('Search term too short');
        return false;
      }
      
      // Create multiple search patterns:
      // 1. Exact search term (e.g., "Chondromalacia")
      // 2. Individual words (e.g., "Chondromalacia", "patella")
      // 3. Diagnosis code if present (e.g., "36071006")
      const words = searchTerm.split(/\s+/).filter(w => w.length >= 4);
      const searchPatterns = [
        new RegExp(searchTerm, 'i'), // Full search term
        ...words.map(w => new RegExp(w, 'i')), // Individual words
      ];
      
      // Try the diagnosis dropdown
      const diagSelectors = [
        'select[name="diagnosisPriIdTemp"]',
        'select[name*="diagnosisPri" i]',
        'select[name*="diagnosis" i]',
      ];
      
      for (const selector of diagSelectors) {
        try {
          const select = this.page.locator(selector).first();
          if ((await select.count().catch(() => 0)) > 0) {
            const options = await select.locator('option').evaluateAll((opts) =>
              opts.map((o) => ({ value: o.value, label: (o.textContent || '').trim() }))
            );
            
            // Try each search pattern
            let targetOption = null;
            for (const pattern of searchPatterns) {
              targetOption = options.find((o) => pattern.test(o.label));
              if (targetOption) break;
            }
            
            if (targetOption) {
              await select.selectOption({ value: targetOption.value });
              this._logStep('Diagnosis selected', { value: targetOption.value, label: targetOption.label });
              return true;
            }
          }
        } catch (e) {
          continue;
        }
      }
      
      // Try JavaScript fallback
      const selected = await this.page.evaluate((term) => {
        const select = document.querySelector('select[name="diagnosisPriIdTemp"]');
        if (select) {
          const regex = new RegExp(term, 'i');
          for (const opt of select.options) {
            if (regex.test(opt.text)) {
              select.value = opt.value;
              select.dispatchEvent(new Event('change', { bubbles: true }));
              return { success: true, value: opt.value, text: opt.text };
            }
          }
        }
        return { success: false };
      }, searchTerm);
      
      if (selected.success) {
        this._logStep('Diagnosis selected via JavaScript', selected);
        return true;
      }
      
      logger.warn('Diagnosis not found matching:', searchTerm);
      return false;
    } catch (error) {
      logger.error('Failed to select diagnosis:', error);
      return false;
    }
  }
}

