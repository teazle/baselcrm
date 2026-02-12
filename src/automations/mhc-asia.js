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
    this._loginInProgress = false;
    this._lastLoginAt = 0;
    this.isAiaClinicSystem = false;
    this.isSinglifeSystem = false;
  }

  /**
   * Ensure we're at the main MHC portal home (not inside AIA Clinic pages).
   * This is important between patients: after switching system to AIA Clinic,
   * the left-nav contains "AIA Visit" links that can confuse generic selectors.
   */
  async ensureAtMhcHome() {
    this._logStep('Ensure at MHC home');

    const currentUrl = this.page.url() || '';
    const onMhc =
      /\/mhc\//i.test(currentUrl) &&
      !/aiaclinic|pcpcare|singlife/i.test(currentUrl);
    const logoutVisibleNow = await this.page
      .locator('text=/Log\\s*Out/i')
      .first()
      .isVisible()
      .catch(() => false);
    const passwordVisibleNow = await this.page
      .locator('input[type="password"], input[name="txtPassword"], input[name*="password" i]')
      .first()
      .isVisible()
      .catch(() => false);
    const userVisibleNow = await this.page
      .locator('input[type="text"], input[name*="user" i], input[id*="user" i]')
      .first()
      .isVisible()
      .catch(() => false);
    const loginBtnVisibleNow = await this.page
      .locator('button:has-text("SIGN IN"), input[type="submit"][value*="SIGN" i], button:has-text("LOGIN")')
      .first()
      .isVisible()
      .catch(() => false);
    const loginVisibleNow = passwordVisibleNow && (userVisibleNow || loginBtnVisibleNow);
    const navVisibleNow = await this.page
      .locator('a:has-text("Normal Visit"), a:has-text("Add Normal Visit"), a:has-text("Add AIA Visit")')
      .first()
      .isVisible()
      .catch(() => false);
    // If we are already on the MHC domain and the login form is NOT visible, assume
    // the session is still valid. This prevents unnecessary re-login loops.
    if (onMhc && (!loginVisibleNow || navVisibleNow)) {
      const bodyText = await this.page.textContent('body').catch(() => '');
      if (!/502\s+bad\s+gateway|nginx/i.test(bodyText || '')) {
        this.isAiaClinicSystem = false;
        this.isSinglifeSystem = false;
        return true;
      }
    }
    if (onMhc && logoutVisibleNow) {
      const bodyText = await this.page.textContent('body').catch(() => '');
      if (!/502\s+bad\s+gateway|nginx/i.test(bodyText || '')) {
        this.isAiaClinicSystem = false;
        this.isSinglifeSystem = false;
        return true;
      }
    }

    // Always hard-navigate back to the base portal URL when not already on MHC.
    await this.page.goto(this.config.url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await this.page.waitForTimeout(800);

    // If the Normal Visit nav is already visible, we're authenticated; skip re-login.
    const normalVisitVisible = await this.page
      .locator('a:has-text("Normal Visit"), a:has-text("Add Normal Visit")')
      .first()
      .isVisible()
      .catch(() => false);
    if (normalVisitVisible) {
      this.isAiaClinicSystem = false;
      this.isSinglifeSystem = false;
      return true;
    }

    const csrfVisible = await this.page
      .locator('text=/csrf\\s+detected/i')
      .first()
      .isVisible()
      .catch(() => false);
    if (csrfVisible) {
      logger.warn('[MHC] CSRF detected on home; resetting session');
      await this._resetMhcSession('csrf-home').catch(() => {});
    }

    // If we see a logout link, we're already authenticated.
    const logoutVisible = await this.page
      .locator('text=/Log\\s*Out/i')
      .first()
      .isVisible()
      .catch(() => false);
    if (logoutVisible) {
      this.isAiaClinicSystem = false;
      this.isSinglifeSystem = false;
      return true;
    }

    // If we got bounced back to login, re-login.
    const passwordVisible = await this.page
      .locator('input[type="password"], input[name="txtPassword"], input[name*="password" i]')
      .first()
      .isVisible()
      .catch(() => false);
    const userVisible = await this.page
      .locator('input[type="text"], input[name*="user" i], input[id*="user" i]')
      .first()
      .isVisible()
      .catch(() => false);
    const loginBtnVisible = await this.page
      .locator('button:has-text("SIGN IN"), input[type="submit"][value*="SIGN" i], button:has-text("LOGIN")')
      .first()
      .isVisible()
      .catch(() => false);
    const loginVisible = passwordVisible && (userVisible || loginBtnVisible);
    if (loginVisible) {
      logger.info('Login form visible after ensureAtMhcHome; re-logging in');
      await this.login();
    }

    return true;
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
    if (this._loginInProgress) {
      logger.warn('[MHC] Login already in progress; skipping duplicate attempt');
      return true;
    }
    const now = Date.now();
    const loginFormVisible = await this.page
      .locator('input[type="password"], input[name="txtPassword"], input[name*="password" i]')
      .first()
      .isVisible()
      .catch(() => false);
    if (!loginFormVisible && this._lastLoginAt && now - this._lastLoginAt < 60 * 1000) {
      logger.info('[MHC] Skipping login (recently authenticated)');
      return true;
    }
    const maxAttempts = 3;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        this._loginInProgress = true;
        this._logStep('Login start', { attempt, maxAttempts });
        logger.info(`Logging into ${this.config.name}...`);

        if (attempt > 1) {
          // Clear cookies/storage before retrying to avoid CSRF loops.
          await this._resetMhcSession('login-retry').catch(() => {});
        }

        // Avoid 'networkidle' here; MHC pages can keep long-polling connections open.
        await this.page.goto(this.config.url, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await this.page.waitForTimeout(800);

        // If we land on a CSRF warning page, reset and retry.
        const csrfPreLogin = await this.page
          .locator('text=/csrf\\s+detected/i')
          .first()
          .isVisible()
          .catch(() => false);
        if (csrfPreLogin) {
          logger.warn('[MHC] CSRF detected before login attempt; resetting session');
          await this._resetMhcSession('csrf-pre-login').catch(() => {});
          if (attempt < maxAttempts) continue;
        }

        // If already logged in (session cookies), bail out early.
        const alreadyLoggedIn = await this.page
          .locator('text=/Log\\s*Out/i')
          .first()
          .isVisible()
          .catch(() => false);
        if (alreadyLoggedIn) {
          logger.info(`Already logged into ${this.config.name}`);
          this._logStep('Login ok (already logged in)');
          this._lastLoginAt = Date.now();
          return true;
        }

        // Best-effort: if a "Select Country" dropdown exists, make sure Singapore is selected.
        try {
          const selects = this.page.locator('select');
          const count = await selects.count().catch(() => 0);
          for (let i = 0; i < count; i++) {
            const sel = selects.nth(i);
            const options = await sel
              .locator('option')
              .evaluateAll((opts) => opts.map((o) => ({ value: o.value, label: (o.textContent || '').trim() })))
              .catch(() => []);
            const match = options.find((o) => /singapore/i.test(o.label));
            if (!match) continue;
            await sel.selectOption({ value: match.value }).catch(async () => sel.selectOption({ label: match.label }));
            await this.page.waitForTimeout(250);
            this._logStep('Country selected (best-effort)', { label: match.label });
            break;
          }
        } catch {
          // ignore
        }

        // Wait for login form
        await this.page.waitForSelector('input[type="text"], input[name*="username"], input[id*="username"]', {
          timeout: 10000,
        });

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
          } catch {
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
        const passwordSelectors = ['input[type="password"]', 'input[name*="password"]', 'input[id*="password"]'];

        let passwordField = null;
        for (const selector of passwordSelectors) {
          try {
            passwordField = await this.page.$(selector);
            if (passwordField) break;
          } catch {
            continue;
          }
        }

        if (!passwordField) throw new Error('Could not find password field');

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
          } catch {
            continue;
          }
        }

        if (!loginButton) {
          await passwordField.press('Enter');
          logger.info('Pressed Enter to submit');
        } else {
          await loginButton.click();
          logger.info('Login button clicked');
        }

        // Wait for navigation - ultra minimal wait times
        await this.page.waitForLoadState('domcontentloaded').catch(() => {});
        await this.page.locator('text=/Log\\s*Out/i').first().waitFor({ state: 'attached', timeout: 1500 }).catch(() => {});

        // If CSRF mismatch, retry with clean state.
        const csrfDetected = await this.page
          .locator('text=/csrf\\s+detected/i')
          .first()
          .isVisible()
          .catch(() => false);
        if (csrfDetected) {
          logger.warn('[MHC] CSRF detected after login submit');
          await this.page.screenshot({ path: 'screenshots/mhc-asia-login-csrf.png', fullPage: true }).catch(() => {});
          if (attempt < maxAttempts) {
            await this._resetMhcSession('csrf-after-login').catch(() => {});
            continue;
          }
        }

        // Check for auth error messages
        const errorSelectors = [
          ':has-text("not able to authenticate")',
          ':has-text("authentication")',
          '.error',
          '.alert',
        ];

        for (const selector of errorSelectors) {
          const el = await this.page.$(selector).catch(() => null);
          if (!el) continue;
          const errorText = (await el.textContent().catch(() => '')) || '';
          if (errorText.toLowerCase().includes('authenticate')) {
            logger.error(`Login error detected: ${errorText}`);
            await this.page.screenshot({ path: 'screenshots/mhc-asia-login-error.png', fullPage: true }).catch(() => {});
            throw new Error('Authentication failed');
          }
        }

        await this.page.waitForLoadState('domcontentloaded').catch(() => {});
        logger.info(`Successfully logged into ${this.config.name}`);
        this._logStep('Login ok');
        this._lastLoginAt = Date.now();
        return true;
      } catch (error) {
        logger.error(`Login failed for ${this.config.name}:`, error);
        await this.page.screenshot({ path: 'screenshots/mhc-asia-login-error.png', fullPage: true }).catch(() => {});
        if (attempt >= maxAttempts) throw error;
      } finally {
        this._loginInProgress = false;
      }
    }

    throw new Error('Login failed');
  }

  async _resetMhcSession(reason = 'unknown') {
    this._logStep('Reset MHC session', { reason });
    await this.page.context().clearCookies().catch(() => {});
    await this.page
      .evaluate(() => {
        try {
          localStorage.clear();
          sessionStorage.clear();
        } catch {
          // ignore
        }
      })
      .catch(() => {});
    await this.page.goto(this.config.url, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
    await this.page.waitForTimeout(1200);
  }

  /**
   * Singlife PCP pages sometimes bounce to a dedicated login page with:
   * "csrf detected, please login again".
   *
   * This is distinct from the MHC Asia login. If credentials are provided via:
   * - SINGLIFE_PCP_USERNAME
   * - SINGLIFE_PCP_PASSWORD
   * we can attempt a best-effort login. Otherwise we leave the page as-is and return false.
   *
   * @returns {Promise<boolean>} true if already logged in or login succeeded; false if login required but creds missing/failed.
   */
  async loginSinglifePcpIfNeeded() {
    // Prefer dedicated Singlife PCP creds; fallback to MHC creds (often the same clinic account).
    const username = process.env.SINGLIFE_PCP_USERNAME || process.env.MHC_ASIA_USERNAME || '';
    const password = process.env.SINGLIFE_PCP_PASSWORD || process.env.MHC_ASIA_PASSWORD || '';

    const onPcpLogin = await this.page
      .locator('text=/Singlife\\s+Preferred\\s+Care\\s+Plus/i')
      .first()
      .isVisible()
      .catch(() => false);
    if (!onPcpLogin) return true;

    const csrfMsg = await this.page
      .locator('text=/csrf\\s+detected/i')
      .first()
      .isVisible()
      .catch(() => false);
    this._logStep('Singlife PCP login detected', { csrfDetected: csrfMsg });
    await this.page.screenshot({ path: 'screenshots/singlife-pcp-login.png', fullPage: true }).catch(() => {});

    if (!username || !password) {
      logger.warn('Singlife PCP login required but credentials not set (SINGLIFE_PCP_* or MHC_ASIA_*)');
      return false;
    }

    // Best-effort: fill USER ID + PASSWORD and click SIGN IN.
    const userIdField =
      this.page.locator('input[name="username"], input[name="userId"], input[type="text"]').first();
    const passField = this.page.locator('input[type="password"]').first();
    const signInBtn = this.page
      .locator('button:has-text("SIGN IN"), input[type="submit"], button[type="submit"]')
      .first();

    if ((await userIdField.count().catch(() => 0)) === 0 || (await passField.count().catch(() => 0)) === 0) {
      logger.warn('Singlife PCP login: could not locate credential fields');
      await this.page.screenshot({ path: 'screenshots/singlife-pcp-login-fields-not-found.png', fullPage: true }).catch(() => {});
      return false;
    }

    await userIdField.fill(username).catch(() => {});
    await passField.fill(password).catch(() => {});
    if ((await signInBtn.count().catch(() => 0)) > 0) await this._safeClick(signInBtn, 'Singlife PCP: Sign in');
    else await passField.press('Enter').catch(() => {});

    await this.page.waitForLoadState('domcontentloaded').catch(() => {});
    await this.page.waitForTimeout(800);

    const stillOnLogin = await this.page
      .locator('text=/Singlife\\s+Preferred\\s+Care\\s+Plus/i')
      .first()
      .isVisible()
      .catch(() => false);
    await this.page.screenshot({ path: 'screenshots/singlife-pcp-after-login.png', fullPage: true }).catch(() => {});
    if (stillOnLogin) {
      logger.warn('Singlife PCP login attempt did not leave login page (check credentials / CSRF)');
      return false;
    }

    logger.info('Singlife PCP login succeeded (best-effort)');
    return true;
  }

  async _safeClick(locator, label) {
    const timeoutMs = 5000;
    const onClaimForm = await this.page
      .locator('button:has-text("Save As Draft"), input[value*="Save As Draft" i], input[value*="Save Draft" i]')
      .first()
      .isVisible()
      .catch(() => false);
    if (onClaimForm) {
      const targetMeta = await locator
        .first()
        .evaluate((el) => {
          const text = (el.textContent || '').trim();
          const value = (el.getAttribute('value') || '').trim();
          const aria = (el.getAttribute('aria-label') || '').trim();
          const type = (el.getAttribute('type') || '').trim().toLowerCase();
          return { text, value, aria, type };
        })
        .catch(() => null);
      const combined = `${targetMeta?.text || ''} ${targetMeta?.value || ''} ${targetMeta?.aria || ''}`.toLowerCase();
      const safeLabel = String(label || '').toLowerCase();
      const isSubmitLike = /\bsubmit\b/.test(combined) || (targetMeta?.type === 'submit' && !/search|find/.test(combined));
      const isDraftAction = /save\s+as\s+draft|save\s+draft/.test(combined) || /save\s+as\s+draft|save\s+draft/.test(safeLabel);
      const isComputeAction = /compute\s*claim|\bcompute\b/.test(combined) || /compute\s*claim|\bcompute\b/.test(safeLabel);
      if (isSubmitLike && !isDraftAction && !isComputeAction) {
        logger.error('[MHC] Blocked unsafe submit click on claim form', {
          label,
          target: targetMeta,
          url: this.page.url(),
        });
        await this.page.screenshot({ path: 'screenshots/mhc-asia-blocked-submit-click.png', fullPage: true }).catch(() => {});
        throw new Error('Blocked unsafe submit click on claim form');
      }
    }
    try {
      await locator.click({ timeout: timeoutMs });
    } catch {
      await locator.click({ timeout: timeoutMs, force: true }).catch(() => {});
    }
    // Avoid waiting for networkidle (many portals keep connections open)
    await this.page.waitForLoadState('domcontentloaded', { timeout: 3000 }).catch(() => {});
    await this.page.waitForTimeout(200); // Reduced wait
    if (label) logger.info(`Clicked: ${label}`);
  }

  _normalizeText(s) {
    return (s || '').toString().replace(/\s+/g, ' ').trim();
  }

  async _getPortalContextSnapshot() {
    const url = this.page.url() || '';
    const isAiaDomain = /aiaclinic\.com/i.test(url);
    const isSinglifeDomain = /pcpcare|singlife/i.test(url);
    const isMhcDomain = /\/mhc\//i.test(url);

    const hasAddAiaVisit = await this.page
      .locator('a:has-text("Add AIA Visit"), button:has-text("Add AIA Visit")')
      .first()
      .isVisible()
      .catch(() => false);
    const hasSwitchSystem = await this.page
      .locator('a:has-text("Switch System"), button:has-text("Switch System"), text=/Switch\\s+System/i')
      .first()
      .isVisible()
      .catch(() => false);
    const hasSearchAiaMember = await this.page
      .locator('button:has-text("Search AIA Member"), input[value*="Search AIA Member" i]')
      .first()
      .isVisible()
      .catch(() => false);
    const hasPolicyNoHeader = await this.page
      .locator('th:has-text("Policy No"), td:has-text("Policy No"), text=/\\bPolicy\\s*No\\b/i')
      .first()
      .isVisible()
      .catch(() => false);

    return {
      url,
      isAiaDomain,
      isSinglifeDomain,
      isMhcDomain,
      hasAddAiaVisit,
      hasSwitchSystem,
      hasSearchAiaMember,
      hasPolicyNoHeader,
      looksLikeAiaFlow: isAiaDomain || hasSearchAiaMember || hasPolicyNoHeader || hasAddAiaVisit,
    };
  }

  async _adoptAiaPageFromContext() {
    try {
      const pages = this.page.context().pages();
      for (const p of pages) {
        if (!p || p.isClosed()) continue;
        const u = p.url() || '';
        if (!/aiaclinic\.com/i.test(u)) continue;
        this.page = p;
        this.setupDialogHandler({ reset: false });
        await this.page.bringToFront().catch(() => {});
        await this.page.evaluate(() => window.focus()).catch(() => {});
        return true;
      }
    } catch {
      // ignore
    }
    return false;
  }

  async _waitForAiaSwitch(timeoutMs = 8000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      await this._adoptAiaPageFromContext().catch(() => false);
      const snap = await this._getPortalContextSnapshot();
      if (snap.looksLikeAiaFlow) return { ok: true, snap };
      await this.page.waitForTimeout(250);
    }
    return { ok: false, snap: await this._getPortalContextSnapshot() };
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

  // NOTE: fillMcDays is implemented later in this class with portal-specific safeguards.
  // This placeholder exists only to keep older call sites from failing during incremental refactors.
  // The later definition overrides this one at runtime.

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

      const normalized = String(mcStartDate || '').trim();
      const ddmmyyyy = normalized.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
      const valueToSet = ddmmyyyy
        ? `${ddmmyyyy[1].padStart(2, '0')}/${ddmmyyyy[2].padStart(2, '0')}/${ddmmyyyy[3]}`
        : normalized;

      // Prefer strict row-label targeting to avoid accidentally filling Visit Date or MC Day.
      const rowFilled = await this.page
        .evaluate((val) => {
          const norm = (s) => (s || '').toString().replace(/\s+/g, ' ').trim();
          const isVisible = (el) => {
            if (!el) return false;
            const style = window.getComputedStyle(el);
            if (!style) return false;
            if (style.display === 'none' || style.visibility === 'hidden') return false;
            const rect = el.getBoundingClientRect();
            if (!rect || rect.width <= 0 || rect.height <= 0) return false;
            return true;
          };
          const sameNumeric = (a, b) => {
            const n1 = Number(String(a || '').trim());
            const n2 = Number(String(b || '').trim());
            if (!Number.isFinite(n1) || !Number.isFinite(n2)) return false;
            return Math.abs(n1 - n2) < 1e-9;
          };
          const cells = Array.from(document.querySelectorAll('td, th, label, span, b, strong'));
          const label = cells.find((el) => /^MC\s*Start\s*Date\b/i.test(norm(el.textContent)));
          if (!label) return { ok: false, reason: 'label_not_found' };
          const row = label.closest('tr');
          if (!row) return { ok: false, reason: 'row_not_found' };
          const inputs = Array.from(row.querySelectorAll('input[type="text"], input:not([type])')).filter((x) =>
            isVisible(x)
          );
          if (!inputs.length) return { ok: false, reason: 'input_not_found' };
          // Prefer the widest field (usually the date text input).
          inputs.sort((a, b) => (b.getBoundingClientRect().width || 0) - (a.getBoundingClientRect().width || 0));
          const field = inputs[0];
          try {
            field.value = String(val);
            field.dispatchEvent(new Event('input', { bubbles: true }));
            field.dispatchEvent(new Event('change', { bubbles: true }));
          } catch {
            // ignore
          }
          return { ok: true, value: field.value || '' };
        }, valueToSet)
        .catch(() => ({ ok: false, reason: 'evaluate_failed' }));

      if (rowFilled?.ok) {
        this._logStep('MC start date filled (row label scan)', { value: rowFilled.value || valueToSet });
        return true;
      }

      // Try direct input selectors first (faster)
      const directSelectors = [
        'tr:has-text("MC Start Date") input[type="text"]',
        'tr:has-text("MC Start") input[type="text"]',
        'input[name*="mcStart" i]',
        'input[name*="mc_start" i]',
        'input[name*="mcDate" i]',
        'input[name*="mcFromDate" i]',
        'input[id*="mcStart" i]',
        'input[id*="mcDate" i]',
        'input[placeholder*="dd/mm" i]',
      ];

      for (const selector of directSelectors) {
        try {
          const field = this.page.locator(selector).first();
          if ((await field.count().catch(() => 0)) === 0) continue;
          if (!(await field.isVisible().catch(() => true))) continue;
          await field.fill(valueToSet).catch(async () => {
            await field.evaluate((el, v) => {
              try {
                el.value = v;
                el.dispatchEvent(new Event('input', { bubbles: true }));
                el.dispatchEvent(new Event('change', { bubbles: true }));
              } catch {
                // ignore
              }
            }, valueToSet);
          });
          await this.page.waitForTimeout(100);
          logger.info(`MC start date filled via direct selector: ${valueToSet}`);
          return true;
        } catch {
          continue;
        }
      }

      // Try row-based selectors
      const mcStartDateSelectors = [
        'tr:has-text("MC Start")',
        'tr:has-text("MC From")',
        'tr:has-text("MC Date")',
        'tr:has-text("Start Date")',
      ];

      for (const rowSelector of mcStartDateSelectors) {
        try {
          const row = this.page.locator(rowSelector).first();
          if ((await row.count().catch(() => 0)) === 0) continue;

          const field = row.locator('input').first();
          if ((await field.count().catch(() => 0)) === 0) continue;

          await field.fill(valueToSet);
          await this.page.waitForTimeout(100);
          logger.info(`MC start date filled: ${valueToSet}`);
          return true;
        } catch {
          continue;
        }
      }

      logger.warn('Could not find MC start date field');
      await this.page.screenshot({ path: 'screenshots/mhc-mc-start-date-not-found.png', fullPage: true }).catch(() => {});
      return false;
    } catch (error) {
      logger.warn('Could not fill MC start date:', error.message);
      return false;
    }
  }

  /**
   * If MC Start Date is prefilled with a non-DD/MM/YYYY format (common: M/D/YYYY),
   * normalize it (pad) or clear it to avoid portal validation alerts during other interactions.
   *
   * @param {object} opts
   * @param {boolean} opts.clear - if true, clears the field; otherwise pads M/D/YYYY -> DD/MM/YYYY
   */
  async normalizeMcStartDateIfNeeded({ clear = false } = {}) {
    this._logStep('Normalize MC start date if needed', { clear });
    const result = await this.page
      .evaluate(({ clear }) => {
        const norm = (s) => (s || '').toString().replace(/\s+/g, ' ').trim();
        const isVisible = (el) => {
          if (!el) return false;
          const style = window.getComputedStyle(el);
          if (!style) return false;
          if (style.display === 'none' || style.visibility === 'hidden') return false;
          return true;
        };
        const cells = Array.from(document.querySelectorAll('td, th, label, span, b, strong'));
        const label = cells.find((el) => /^MC\s*Start\s*Date\b/i.test(norm(el.textContent)));
        if (!label) return { ok: false, reason: 'label_not_found' };
        const row = label.closest('tr');
        if (!row) return { ok: false, reason: 'row_not_found' };
        const inputs = Array.from(row.querySelectorAll('input[type="text"], input:not([type])')).filter((x) =>
          isVisible(x)
        );
        if (!inputs.length) return { ok: false, reason: 'input_not_found' };
        inputs.sort((a, b) => (b.getBoundingClientRect().width || 0) - (a.getBoundingClientRect().width || 0));
        const field = inputs[0];
        const v = norm(field.value);
        if (!v) return { ok: true, changed: false, value: '' };
        if (clear) {
          field.value = '';
          // Do not fire change events when clearing; some portals validate on change.
          return { ok: true, changed: true, value: '' };
        }
        const m = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
        if (!m) return { ok: true, changed: false, value: v };
        const padded = `${m[1].padStart(2, '0')}/${m[2].padStart(2, '0')}/${m[3]}`;
        if (padded === v) return { ok: true, changed: false, value: v };
        field.value = padded;
        field.dispatchEvent(new Event('input', { bubbles: true }));
        field.dispatchEvent(new Event('change', { bubbles: true }));
        return { ok: true, changed: true, value: padded };
      }, { clear })
      .catch(() => ({ ok: false, reason: 'evaluate_failed' }));

    if (result?.ok) {
      this._logStep('MC start date normalized', result);
      return true;
    }
    return false;
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
          const isVisible = (el) => {
            if (!el) return false;
            const style = window.getComputedStyle(el);
            if (!style) return false;
            if (style.display === 'none' || style.visibility === 'hidden') return false;
            // In headless or table layouts, getBoundingClientRect can be 0 even for usable fields.
            // We accept these inputs since we are only pre-filling for review.
            return true;
          };
        const textOf = (el) => norm(el?.innerText || el?.textContent || '');

          // Anchor to the *closest* table for the header cell so we don't accidentally pick an outer layout table
          // that contains nested tables (common on MHC/Singlife forms).
          const headerCell = Array.from(document.querySelectorAll('th, td')).find((c) => headerRe.test(textOf(c)));
          if (!headerCell) return { filled: 0 };

          const table = headerCell.closest('table');
          const headerRow = headerCell.closest('tr');
          if (!table || !headerRow) return { filled: 0 };

          const rows = Array.from(table.querySelectorAll('tr')).filter((r) => r.closest('table') === table);
          const startIdx = rows.indexOf(headerRow);
          if (startIdx < 0) return { filled: 0 };

          const rowCellsWithSpan = (row) =>
            Array.from(row.querySelectorAll('th, td')).map((c) => ({
              cell: c,
              span: Number(c.colSpan || 1),
            }));
          const getRange = (row, targetCell) => {
            const cells = rowCellsWithSpan(row);
            let col = 0;
            for (const it of cells) {
              const start = col;
              const end = col + it.span;
              if (it.cell === targetCell) return { start, end };
              col = end;
            }
            return null;
          };
          const headerRange = getRange(headerRow, headerCell);
          if (!headerRange) return { filled: 0 };

          const candidates = [];

          for (let i = startIdx + 1; i < rows.length; i++) {
            const rowText = textOf(rows[i]);
            if (stopRe && stopRe.test(rowText)) break;

            let input = null;

            // With colspans, the header cell can cover multiple "logical columns".
            // Choose an overlapping data-cell that contains a visible input, preferring the widest input.
            const tCells = rowCellsWithSpan(rows[i]);
            let col = 0;
            const overlapping = [];
            for (const it of tCells) {
              const start = col;
              const end = col + it.span;
              if (start < headerRange.end && end > headerRange.start) overlapping.push(it.cell);
              col = end;
            }

            if (overlapping.length) {
              let best = null;
              let bestWidth = 0;
              for (const c of overlapping) {
                const inputs = Array.from(c.querySelectorAll('input[type="text"], input:not([type]), textarea')).filter(
                  (x) => isVisible(x)
                );
                if (!inputs.length) continue;
                inputs.sort((a, b) => b.getBoundingClientRect().width - a.getBoundingClientRect().width);
                const w = inputs[0].getBoundingClientRect().width;
                if (w > bestWidth) {
                  bestWidth = w;
                  best = inputs[0];
                }
              }
              input = best;
            }

            // Fallback: first visible text input in the row.
            if (!input) {
              const rowInputs = Array.from(rows[i].querySelectorAll('input[type="text"], input:not([type]), textarea'));
              input = rowInputs.find((x) => isVisible(x)) || null;
            }

            // Do NOT exclude readOnly: many MHC "selector" inputs are readOnly but still reflect values
            // when set programmatically for review (we are not submitting).
            if (input) candidates.push(input);
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

  async fillServicesAndDrugs(items, options = {}) {
	    this._logStep('Fill services/drugs', { count: (items || []).length });
      const skipProcedures = options?.skipProcedures === true;
	    const isJunkLine = (s) => {
	      const n = String(s || '').trim().replace(/\s+/g, ' ');
	      if (!n) return true;
	      const lower = n.toLowerCase();
	      // Common junk that leaks from Clinic Assist extraction / directions.
	      if (/^[\d.,]+$/.test(lower)) return true;
	      if (/^\$?\s*\d+(?:\.\d+)?\s*(?:sgd)?\s*$/i.test(n)) return true;
	      if (/^\d+(?:\.\d+)?\s*(?:tabs?|tab|caps?|cap|pcs?|pc|sachets?|pkt|packs?)\b/i.test(lower)) return true;
	      if (/^\d+(?:\.\d+)?\s*(?:mg|g|ml|mcg|iu)\b/i.test(lower)) return true;
	      if (lower.startsWith('unfit for ')) return true;
	      if (lower.startsWith('for ')) return true;
	      if (lower.includes('may cause')) return true;
	      if (lower.includes('complete whole course')) return true;
	      if (lower.includes('complete the whole course')) return true;
	      if (lower.includes('course of medicine') || lower.includes('course of med')) return true;
	      if (lower.startsWith('take ') || lower.startsWith('apply ') || lower.startsWith('use ')) return true;
	      if (/^to be taken\b/i.test(lower) || /\bto be taken\b/i.test(lower)) return true;
	      return false;
	    };

	    const list = (items || [])
	      .map((x) => {
	        if (typeof x === 'string') return { name: this._normalizeText(x), quantity: null };
	        const name = this._normalizeText(x?.name || x?.description || '');
	        const quantityRaw =
	          x?.quantity ?? x?.qty ?? x?.qtyValue ?? x?.qtyText ?? x?.amount ?? x?.amountText ?? null;
	        const quantity = quantityRaw === null || quantityRaw === undefined
	          ? null
	          : String(quantityRaw).trim();
	        return { name, quantity };
	      })
	      .map((x) => ({ ...x, name: (x.name || '').toString().trim().replace(/\s+/g, ' ') }))
	      .filter((x) => x.name && !isJunkLine(x.name));
	    if (!list.length) return false;

	    const procedures = [];
	    const drugs = [];
	    for (const it of list) {
	      if (!skipProcedures && /(xray|x-ray|scan|ultrasound|procedure|physio|physiotherapy|ecg|injection|dressing|suturing|vaccine|mri|ct\b|dexa|density|bmd|radiolog|radiology|imaging|consultation|consult\b|medical\s+expenses?)/i.test(it.name)) {
	        procedures.push(it.name);
	      } else {
	        drugs.push(it);
	      }
	    }

      if (skipProcedures) {
        logger.info('[MHC] Procedure fill skipped by policy for this portal/form variant');
      }

    let drugFilled = 0;
    for (let i = 0; i < Math.min(3, drugs.length); i++) {
      if (i > 0) await this.clickMoreDrug().catch(() => {});
      const quantity = drugs[i].quantity ?? '1';
      const ok = await this.fillDrugItem({ name: drugs[i].name, quantity }, i + 1).catch(() => false);
      if (ok) {
        drugFilled += 1;
        // Ensure qty is filled even when the direct fill couldn't locate the qty cell.
        const qtyFallbackOk = await this.fillDrugQuantityFallback(i + 1, quantity).catch(() => false);
        const qtyVerified = await this.verifyDrugQuantity(i + 1, quantity).catch(() => false);
        if (!qtyFallbackOk || !qtyVerified) {
          logger.warn(`Drug qty may be missing for row ${i + 1} (${drugs[i].name})`);
        }
      }
    }
    if (drugs.length && drugFilled === 0) {
      drugFilled = (await this._fillTextInputsInTableSection(/Drug Name/i, /Total Drug Fee/i, drugs.map((d) => d.name))).filled;
      // When the generic table fill is used, the Qty column is not touched. Ensure it is set.
      for (let i = 0; i < Math.min(3, drugs.length); i++) {
        const quantity = drugs[i].quantity ?? '1';
        const qtyFallbackOk = await this.fillDrugQuantityFallback(i + 1, quantity).catch(() => false);
        const qtyVerified = await this.verifyDrugQuantity(i + 1, quantity).catch(() => false);
        if (!qtyFallbackOk || !qtyVerified) {
          logger.warn(`Drug qty may be missing for row ${i + 1} (${drugs[i].name})`);
        }
      }
    }

    let procFilled = (await this._fillTextInputsInTableSection(/Procedure Name/i, /Total Proc Fee/i, procedures)).filled;
    if (procedures.length && procFilled === 0) {
      for (let i = 0; i < Math.min(2, procedures.length); i++) {
        if (i > 0) await this.clickMoreProcedure().catch(() => {});
        const ok = await this.fillProcedureItem({ name: procedures[i] }, i + 1).catch(() => false);
        if (ok) procFilled += 1;
      }
    }
    // Portal validation often requires the procedure claim amount to be numeric.
    // Populate a safe default so Save As Draft does not fail with "valid amount for procedure".
    for (let i = 0; i < Math.min(2, procedures.length); i++) {
      const amountOk = await this.fillProcedureClaimAmountFallback(i + 1, '0', procedures[i]).catch(() => false);
      if (!amountOk) {
        logger.warn(`Procedure claim amount may be missing for row ${i + 1} (${procedures[i]})`);
      }
    }

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
      await this.page.waitForTimeout(500);
      
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
          await this.page.waitForLoadState('domcontentloaded').catch(() => {});
          await this.page.waitForTimeout(500);
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
  async navigateToNormalVisit(opts = {}) {
    try {
      this._logStep('Navigate: Normal Visit');
      logger.info('Navigating to Normal Visit > Search Other Programs...');

      const { skipEnsure = false } = opts;
      // Critical: return to MHC home so we don't accidentally match AIA Clinic
      // sidebar links like "Add AIA Visit" when looking for "Visit".
      if (!skipEnsure) {
        await this.ensureAtMhcHome();
      }
      
      const resetToPortalHome = async () => {
        try {
          await this.page.goto(this.config.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
          await this.page.waitForTimeout(1000);
          const normalVisitVisible = await this.page
            .locator('a:has-text("Normal Visit"), a:has-text("Add Normal Visit")')
            .first()
            .isVisible()
            .catch(() => false);
          if (normalVisitVisible) return;
          // If we got bounced to login, re-login.
          const loginVisible = await this.page
            .locator('input[type="password"], input[name="txtPassword"], input[name*="password" i]')
            .first()
            .isVisible()
            .catch(() => false);
          if (loginVisible) {
            logger.info('Login form visible after reset; re-logging in');
            await this.login();
          }
        } catch {
          // ignore
        }
      };

      // Wait for page to be ready - skip networkidle (MHC keeps connections open)
      await this.page.waitForLoadState('domcontentloaded').catch(() => {});
      await this.page.waitForTimeout(1000); // Brief stabilization

      // If the portal returns a 502, retry a clean portal reload once.
      const bodyText = await this.page.textContent('body').catch(() => '');
      if (/502\s+bad\s+gateway|nginx/i.test(bodyText || '')) {
        logger.warn('MHC portal returned 502; retrying portal home');
        await resetToPortalHome();
        await this.page.waitForLoadState('domcontentloaded').catch(() => {});
        await this.page.waitForTimeout(300);
      }
      
      // Step 1: Click on "Normal Visit" or similar - try multiple selectors
      const normalVisitSelectors = [
        'a:has-text("Normal Visit")',
        'button:has-text("Normal Visit")',
        'a[href*="NormalVisit" i]',
        'a[href*="normalvisit" i]',
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
              // Skip screenshot for speed
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
        // One-time reset: we might be stuck in AIA Clinic or another sub-page without the Normal Visit nav.
        await resetToPortalHome();

        for (const selector of normalVisitSelectors) {
          try {
            const link = this.page.locator(selector).first();
            const count = await link.count().catch(() => 0);
            if (count > 0) {
              const isVisible = await link.isVisible().catch(() => false);
              if (isVisible) {
                this._logStep('Found Normal Visit link after reset', { selector });
                await this._safeClick(link, 'Normal Visit');
                normalVisitClicked = true;
                break;
              }
            }
          } catch {
            continue;
          }
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
      // Skip screenshot for speed
      
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
  async searchPatientByNRIC(nricOrName) {
    try {
      const input = nricOrName;
      const idTermRaw =
        input && typeof input === 'object'
          ? input.nric || input.id || input.term || input.search || ''
          : input || '';
      const visitDateRaw =
        input && typeof input === 'object' ? input.visitDate || input.visit_date || '' : '';

      const idTerm = String(idTermRaw || '')
        .replace(
          /^(?:\s*(?:TAG\s+)?(?:MHC|AVIVA|SINGLIFE|AIA|AIACLIENT|GE|ALLIANZ|FULLERT|IHP)\s*[-:|]+\s*)/i,
          ''
        )
        .trim();
      const visitDate = String(visitDateRaw || '').trim();

      const clickProgramTile = async (kind) => {
        const k = String(kind || '').toLowerCase();
        if (k === 'other') {
          const otherProgramsSelectors = [
            'text=/Search\\s+under\\s+other\\s+programs/i',
            'a:has-text(\"other programs\")',
            'div:has-text(\"other programs\")',
            '[onclick*=\"other\" i]',
          ];
          for (const selector of otherProgramsSelectors) {
            const tile = this.page.locator(selector).first();
            if ((await tile.count().catch(() => 0)) > 0 && (await tile.isVisible().catch(() => false))) {
              await this._safeClick(tile, 'Search under other programs (tile)');
              await this.page.waitForTimeout(400);
              return true;
            }
          }
          return false;
        }

        if (k === 'aia') {
          const aiaSelectors = [
            'text=/Search\\s+under\\s+AIA\\s+Program/i',
            'a:has-text(\"AIA Program\")',
            'div:has-text(\"AIA Program\")',
            'img[alt*=\"AIA\" i]',
          ];
          for (const selector of aiaSelectors) {
            const tile = this.page.locator(selector).first();
            if ((await tile.count().catch(() => 0)) > 0 && (await tile.isVisible().catch(() => false))) {
              await this._safeClick(tile, 'Search under AIA Program (tile)');
              await this.page.waitForTimeout(600);
              return true;
            }
          }
          return false;
        }

        return false;
      };
      
      const searchOne = async (termToSearch) => {
        const term = String(termToSearch || '').trim();
        if (!term) return { nric: '', portal: null, found: false, usedTerm: '' };

        this._logStep('Search patient', { term });
        logger.info(`Searching patient: ${term}`);

        const termCompact = term.replace(/\s+/g, '');
        const termNorm = termCompact.toUpperCase();
        if (termCompact.length < 5) {
          logger.warn('Search term too short; aborting search to avoid portal validation error', { term });
          return { nric: term, portal: null, found: false, memberNotFound: true, _invalidTerm: true };
        }
        if (!/\d/.test(termCompact)) {
          logger.warn('Search term has no digits; MHC requires NRIC/FIN/Member ID', { term });
          return { nric: term, portal: null, found: false, memberNotFound: true, _invalidTerm: true };
        }

        // Ensure we are on the base MHC portal before searching.
        const urlNow = this.page.url() || '';
        if (!/\/mhc\//i.test(urlNow) || /aiaclinic|pcpcare|singlife/i.test(urlNow)) {
          await this.ensureAtMhcHome().catch(() => {});
        }

        const isLikelyId = /^(?:[STFGM]\d{7}[A-Z]|\d{6,}|[A-Z]\d{7}[A-Z])$/i.test(term.replace(/\s+/g, ''));
        const isLikelyName = false; // MHC portal requires NRIC/FIN/Member ID search only.

        // Enter search term. The page has two fields: NRIC/FIN/Member ID and Patient Name.
        const idSelectors = [
          // Robust "label -> input" selectors (works for both MHC and AIA-like layouts)
          'xpath=//td[contains(translate(normalize-space(.), \"abcdefghijklmnopqrstuvwxyz\", \"ABCDEFGHIJKLMNOPQRSTUVWXYZ\"), \"NRIC/FIN/MEMBER ID\")]/ancestor::tr[1]//input[1]',
          'xpath=//th[contains(translate(normalize-space(.), \"abcdefghijklmnopqrstuvwxyz\", \"ABCDEFGHIJKLMNOPQRSTUVWXYZ\"), \"NRIC/FIN/MEMBER ID\")]/ancestor::tr[1]//input[1]',
          'tr:has-text(\"NRIC/FIN/Member ID\") input[type=\"text\"]',
          'tr:has-text(\"NRIC/FIN/Member ID\") input',
          'input[placeholder*=\"NRIC\" i]',
          'input[name*=\"nric\" i]',
          'input[id*=\"nric\" i]',
        ];
        const nameSelectors = [
          // Robust "label -> input" selectors (MHC patient search page uses this table layout)
          'xpath=//td[contains(translate(normalize-space(.), \"abcdefghijklmnopqrstuvwxyz\", \"ABCDEFGHIJKLMNOPQRSTUVWXYZ\"), \"PATIENT NAME\")]/ancestor::tr[1]//input[1]',
          'xpath=//th[contains(translate(normalize-space(.), \"abcdefghijklmnopqrstuvwxyz\", \"ABCDEFGHIJKLMNOPQRSTUVWXYZ\"), \"PATIENT NAME\")]/ancestor::tr[1]//input[1]',
          'tr:has-text(\"Patient Name\") input[type=\"text\"]',
          'tr:has-text(\"Patient Name\") input',
          'input[name*=\"name\" i]',
          'input[id*=\"name\" i]',
        ];
        let searchCtx = this.page;
        const findVisibleEditableField = async (selectors, opts = {}, ctxOverride) => {
          const requireNricHints = opts.requireNricHints !== false;
          const ctx = ctxOverride || searchCtx || this.page;
          for (const selector of selectors) {
            try {
              const field = ctx.locator(selector).first();
              if ((await field.count().catch(() => 0)) === 0) continue;
              const visible = await field.isVisible().catch(() => false);
              if (!visible) continue;
              // Skip date fields that sometimes match the label-based selectors.
              const nameAttr = (await field.getAttribute('name').catch(() => '')) || '';
              const idAttr = (await field.getAttribute('id').catch(() => '')) || '';
              const placeholderAttr = (await field.getAttribute('placeholder').catch(() => '')) || '';
              const ariaLabel = (await field.getAttribute('aria-label').catch(() => '')) || '';
              const attrText = `${nameAttr} ${idAttr} ${placeholderAttr} ${ariaLabel}`.toLowerCase();
              const rowText = await field
                .evaluate((el) => (el.closest('tr')?.innerText || el.closest('tr')?.textContent || ''))
                .catch(() => '');
              const rowLower = String(rowText || '').toLowerCase();
              const valueNow = (await field.inputValue().catch(() => '')) || '';
              const valueLooksDate = /\d{1,2}\/\d{1,2}\/\d{2,4}/.test(valueNow);
              if (
                /asofdate|visitdate|date|dd\s*\/\s*mm|mm\s*\/\s*dd|yyyy/i.test(attrText) ||
                /visit\s*date/i.test(rowLower) ||
                valueLooksDate
              ) {
                continue;
              }
              // Enforce NRIC/FIN/Member context so we don't accidentally select the Visit Date field.
              const hasNricHints = /nric|fin|member/i.test(attrText) || /nric|fin|member/i.test(rowLower);
              if (requireNricHints && !hasNricHints) continue;
              // isEditable() is flaky across some MHC layouts (it may return false even though fill works).
              // Prefer selecting the visible field and handle fill errors with JS fallback later.
              return field;
            } catch {
              continue;
            }
          }
          return null;
        };

        const isNricSearchField = async (field) => {
          if (!field) return false;
          return await field
            .evaluate((el) => {
              const norm = (s) => (s || '').toString().replace(/\s+/g, ' ').trim().toLowerCase();
              const row = el.closest('tr');
              const rowText = norm(row?.innerText || row?.textContent || '');
              const labelText = norm(el.closest('td, th')?.textContent || '');
              const name = `${el.getAttribute('name') || ''} ${el.getAttribute('id') || ''} ${el.getAttribute('placeholder') || ''} ${el.getAttribute('aria-label') || ''}`.toLowerCase();
              const hasNric = /nric|fin|member/.test(name) || /nric|fin|member/.test(rowText) || /nric|fin|member/.test(labelText);
              const isDateLike = /visit\s*date|dd\/mm|mm\/dd|yyyy/.test(rowText) || /date/.test(name);
              return hasNric && !isDateLike;
            })
            .catch(() => false);
        };

        const setInputValue = async (field, value) => {
          try {
            await field.fill(value);
            return true;
          } catch {
            try {
              await field.evaluate((el, v) => {
                try {
                  el.value = v;
                  el.dispatchEvent(new Event('input', { bubbles: true }));
                  el.dispatchEvent(new Event('change', { bubbles: true }));
                } catch {
                  // ignore
                }
              }, value);
              return true;
            } catch {
              return false;
            }
          }
        };

        const isProgramTilesVisible = async () => {
          const tileSelectors = [
            'text=/Search\\s+under\\s+other\\s+programs/i',
            'text=/Search\\s+under\\s+AIA\\s+Program/i',
          ];
          for (const selector of tileSelectors) {
            const tile = this.page.locator(selector).first();
            if ((await tile.count().catch(() => 0)) > 0 && (await tile.isVisible().catch(() => false))) return true;
          }
          return false;
        };

        const ensureProgramTiles = async () => {
          if (await isProgramTilesVisible()) return true;
          try {
            await this.page.goBack({ waitUntil: 'domcontentloaded' }).catch(() => {});
            await this.page.waitForTimeout(300);
            if (await isProgramTilesVisible()) return true;
          } catch {
            // ignore
          }
          try {
            const normalVisitLink = this.page.locator('a:has-text(\"Normal Visit\")').first();
            if ((await normalVisitLink.count().catch(() => 0)) > 0 && (await normalVisitLink.isVisible().catch(() => false))) {
              await normalVisitLink.click();
              await this.page.waitForLoadState('domcontentloaded').catch(() => {});
              await this.page.waitForTimeout(300);
              if (await isProgramTilesVisible()) return true;
            }
          } catch {
            // ignore
          }
          return false;
        };

        const isSearchFormVisible = async () => {
          const urlNow = this.page.url() || '';
          if (/ClinicEmpVisitSelectPatientSubmit\.ec/i.test(urlNow)) {
            // The submit page still renders the search form at the top.
            const labelVisible = await this.page
              .locator('text=/NRIC\\s*\\/\\s*FIN\\s*\\/\\s*Member\\s*ID/i')
              .first()
              .isVisible()
              .catch(() => false);
            if (labelVisible) return true;
          }
          if (/ClinicEmpVisitSelectPatient\.ec/i.test(urlNow)) return true;
          const selectors =
            'input[name*="nric" i], input[id*="nric" i], input[name*="member" i], input[id*="member" i]';
          const idInputVisible = await this.page
            .locator(selectors)
            .first()
            .isVisible()
            .catch(() => false);
          if (idInputVisible) return true;
          const labelVisible = await this.page
            .locator('text=/NRIC\\s*\\/\\s*FIN\\s*\\/\\s*Member\\s*ID/i')
            .first()
            .isVisible()
            .catch(() => false);
          if (labelVisible) return true;
          const rowVisible = await this.page
            .locator('tr:has-text("NRIC/FIN/Member ID")')
            .first()
            .isVisible()
            .catch(() => false);
          if (rowVisible) return true;
          // Some layouts render the search form inside a frame.
          for (const frame of this.page.frames()) {
            if (frame === this.page.mainFrame()) continue;
            const frameHasInput = await frame
              .locator(selectors)
              .first()
              .isVisible()
              .catch(() => false);
            if (frameHasInput) return true;
            const frameHasLabel = await frame
              .locator('text=/NRIC\\s*\\/\\s*FIN\\s*\\/\\s*Member\\s*ID/i')
              .first()
              .isVisible()
              .catch(() => false);
            if (frameHasLabel) return true;
            const frameHasRow = await frame
              .locator('tr:has-text("NRIC/FIN/Member ID")')
              .first()
              .isVisible()
              .catch(() => false);
            if (frameHasRow) return true;
          }
          return false;
        };

        const resolveSearchContext = async () => {
          const selectors =
            'input[name*="nric" i], input[id*="nric" i], input[name*="member" i], input[id*="member" i]';
          for (const frame of this.page.frames()) {
            try {
              const hasLabel = await frame
                .locator('text=/NRIC\\s*\\/\\s*FIN\\s*\\/\\s*Member\\s*ID/i')
                .first()
                .isVisible()
                .catch(() => false);
              const hasInput = await frame.locator(selectors).first().isVisible().catch(() => false);
              if (hasLabel || hasInput) return frame;
            } catch {
              // ignore
            }
          }
          return this.page;
        };

        const runSearchAttempt = async ({ programKind }) => {
          // IMPORTANT: Switching between "other programs" and "AIA Program" only works from the
          // program selection tiles (Normal Visit). Avoid hard re-login between attempts.
          try {
            // Project rule: no direct URL jump inside Clinic/MHC flows.
            // Always use UI navigation (Normal Visit -> program tiles).
            const searchVisible = await isSearchFormVisible();
            let needsTiles = !searchVisible;
            if (needsTiles) {
              await this.navigateToNormalVisit({ skipEnsure: true }).catch(() => {});
              await this.page.waitForTimeout(300);
            }
            if (needsTiles) {
              const tilesReady = await ensureProgramTiles();
              if (!tilesReady) {
                logger.warn('Search attempt: program tiles not found', { programKind });
              } else {
                await clickProgramTile(programKind);
                await this.page.waitForLoadState('domcontentloaded').catch(() => {});
                await this.page.waitForTimeout(200);
              }
            }
            searchCtx = await resolveSearchContext();
            if (!searchVisible) {
              await searchCtx
                .waitForSelector('tr:has-text("NRIC/FIN/Member ID") input, tr:has-text("NRIC/FIN/Member ID") input:not([type])', {
                  timeout: 1500,
                })
                .catch(() => {});
            }
          } catch (e) {
            logger.warn('Search attempt: could not reset to program tiles', {
              programKind,
              err: String(e?.message || e),
            });
            if (!(await isSearchFormVisible())) {
              await this.navigateToNormalVisit({ skipEnsure: true }).catch(() => {});
              await this.page.waitForTimeout(300);
              const tilesReady = await ensureProgramTiles();
              if (tilesReady) {
                await clickProgramTile(programKind).catch(() => {});
                await this.page.waitForLoadState('domcontentloaded').catch(() => {});
                await this.page.waitForTimeout(200);
              }
            }
            searchCtx = await resolveSearchContext();
            await searchCtx
              .waitForSelector('tr:has-text("NRIC/FIN/Member ID") input, tr:has-text("NRIC/FIN/Member ID") input:not([type])', {
                timeout: 1500,
              })
              .catch(() => {});
          }

          // The MHC search page includes a Visit Date field that affects eligibility/results.
          // If we don't set it to the visit's date, valid members can show as "Member not found".
          if (visitDate && /^\d{2}\/\d{2}\/\d{4}$/.test(visitDate)) {
            await this.fillVisitDate(visitDate).catch(() => false);
            await this.page.waitForTimeout(150);
          }

          // Clear the other search field (ID vs Name) before setting the term.
          let idField = null;
          try {
            idField = await findVisibleEditableField(idSelectors, {}, searchCtx);
            const nameField = await findVisibleEditableField(nameSelectors, { requireNricHints: false }, searchCtx);
            if (nameField) await nameField.fill('').catch(() => {});
            if (idField) await idField.fill('').catch(() => {});
          } catch {
            // ignore
          }
          if (!idField) {
            await this.page
              .screenshot({ path: 'screenshots/mhc-asia-missing-nric-field.png', fullPage: true })
              .catch(() => {});
            logger.warn('NRIC search field not found; aborting search to avoid typing into Visit Date');
            return { nric: term, portal: null, found: false, memberNotFound: true, _missingNricField: true };
          }

          let searchTriggered = false;
          const readRowValue = async (ctx) =>
            ctx
              .evaluate(() => {
                const norm = (s) => (s || '').toString().replace(/\s+/g, ' ').trim().toLowerCase();
                const cells = Array.from(document.querySelectorAll('th, td'));
                const labelCell = cells.find((c) => /nric\s*\/\s*fin\s*\/\s*member\s*id/i.test(norm(c.textContent || '')));
                const row = labelCell?.closest('tr') || null;
                if (!row) return '';
                const getAttrText = (el) => {
                  const name = el.getAttribute('name') || '';
                  const id = el.getAttribute('id') || '';
                  const placeholder = el.getAttribute('placeholder') || '';
                  return `${name} ${id} ${placeholder}`.toLowerCase();
                };
                const isDateLike = (el) => {
                  const attrs = getAttrText(el);
                  if (/date|dd\/mm|mm\/dd|yyyy/.test(attrs)) return true;
                  const cellText = norm(el.closest('td, th')?.textContent || '');
                  if (/visit\s*date|dd\/mm|mm\/dd|yyyy/.test(cellText)) return true;
                  const rowText = norm(row.innerText || row.textContent || '');
                  if (/visit\s*date/.test(rowText) && !/nric|fin|member/.test(cellText)) return true;
                  const val = (el.value || '').toString();
                  return /\d{1,2}\/\d{1,2}\/\d{2,4}/.test(val);
                };
                const inputs = Array.from(row.querySelectorAll('input')).filter((el) => {
                  const type = (el.getAttribute('type') || '').toLowerCase();
                  return type !== 'hidden' && type !== 'button' && type !== 'submit' && type !== 'image';
                });
                if (!inputs.length) return '';
                let input = inputs.find((el) => /nric|fin|member/.test(getAttrText(el))) || null;
                if (!input) input = inputs.find((el) => !isDateLike(el)) || null;
                if (!input) return '';
                return (input?.value || '').toString();
              })
              .catch(() => '');

          const fillRowAndClickSearch = async (ctx, value) =>
            ctx
              .evaluate((term) => {
                const norm = (s) => (s || '').toString().replace(/\s+/g, ' ').trim().toLowerCase();
                const cells = Array.from(document.querySelectorAll('th, td'));
                const labelCell = cells.find((c) => /nric\s*\/\s*fin\s*\/\s*member\s*id/i.test(norm(c.textContent || '')));
                const row = labelCell?.closest('tr') || null;
                if (!row) return { ok: false, clicked: false, value: '', reason: 'row_not_found' };
                const inputs = Array.from(row.querySelectorAll('input')).filter((el) => {
                  const type = (el.getAttribute('type') || '').toLowerCase();
                  return type !== 'hidden' && type !== 'button' && type !== 'submit' && type !== 'image';
                });
                if (!inputs.length) return { ok: false, clicked: false, value: '', reason: 'input_not_found' };
                const getAttrText = (el) => {
                  const name = el.getAttribute('name') || '';
                  const id = el.getAttribute('id') || '';
                  const placeholder = el.getAttribute('placeholder') || '';
                  return `${name} ${id} ${placeholder}`.toLowerCase();
                };
                const isDateLike = (el) => {
                  const attrs = getAttrText(el);
                  if (/date|dd\/mm|mm\/dd|yyyy/.test(attrs)) return true;
                  const cellText = norm(el.closest('td, th')?.textContent || '');
                  if (/visit\s*date|dd\/mm|mm\/dd|yyyy/.test(cellText)) return true;
                  const rowText = norm(row.innerText || row.textContent || '');
                  if (/visit\s*date/.test(rowText) && !/nric|fin|member/.test(cellText)) return true;
                  const val = (el.value || '').toString();
                  return /\d{1,2}\/\d{1,2}\/\d{2,4}/.test(val);
                };
                let input = inputs.find((el) => /nric|fin|member/.test(getAttrText(el))) || null;
                if (!input) input = inputs.find((el) => !isDateLike(el)) || null;
                if (!input) return { ok: false, clicked: false, value: '', reason: 'date_only' };
                const rows = Array.from(document.querySelectorAll('tr'));
                const nameRow = rows.find((r) => /patient\s*name/i.test(norm(r.innerText || r.textContent || '')));
                if (nameRow) {
                  const nameInput =
                    nameRow.querySelector('input[type="text"]') ||
                    nameRow.querySelector('input:not([type])') ||
                    nameRow.querySelector('input');
                  if (nameInput) {
                    nameInput.value = '';
                    nameInput.dispatchEvent(new Event('input', { bubbles: true }));
                    nameInput.dispatchEvent(new Event('change', { bubbles: true }));
                  }
                }
                input.value = term;
                input.dispatchEvent(new Event('input', { bubbles: true }));
                input.dispatchEvent(new Event('change', { bubbles: true }));
                const valueNow = (input.value || '').toString();
                const compact = valueNow.replace(/\s+/g, '').toUpperCase();
                const termCompact = String(term || '').replace(/\s+/g, '').toUpperCase();
                const ok = compact.includes(termCompact) && compact.length >= 5;
                let clicked = false;
                if (ok) {
                  const btns = Array.from(row.querySelectorAll('button, input[type="submit"], input[type="button"]'));
                  const searchBtn = btns.find((b) => /search/i.test((b.textContent || b.value || '').toString())) || null;
                  if (searchBtn) {
                    searchBtn.click();
                    clicked = true;
                  }
                }
                return { ok, clicked, value: valueNow, reason: ok ? null : 'value_mismatch' };
              }, value)
              .catch(() => ({ ok: false, clicked: false, value: '', reason: 'evaluate_failed' }));

          const forceFillRow = async (ctx, value) =>
            ctx
              .evaluate((term) => {
                const norm = (s) => (s || '').toString().replace(/\s+/g, ' ').trim().toLowerCase();
                const cells = Array.from(document.querySelectorAll('th, td'));
                const labelCell = cells.find((c) => /nric\s*\/\s*fin\s*\/\s*member\s*id/i.test(norm(c.textContent || '')));
                const row = labelCell?.closest('tr') || null;
                if (!row) return { ok: false, reason: 'row_not_found', value: '' };
                const inputs = Array.from(row.querySelectorAll('input')).filter((el) => {
                  const type = (el.getAttribute('type') || '').toLowerCase();
                  return type !== 'hidden' && type !== 'button' && type !== 'submit' && type !== 'image';
                });
                if (!inputs.length) return { ok: false, reason: 'input_not_found', value: '' };
                const getAttrText = (el) => {
                  const name = el.getAttribute('name') || '';
                  const id = el.getAttribute('id') || '';
                  const placeholder = el.getAttribute('placeholder') || '';
                  return `${name} ${id} ${placeholder}`.toLowerCase();
                };
                const isDateLike = (el) => {
                  const attrs = getAttrText(el);
                  if (/date|dd\/mm|mm\/dd|yyyy/.test(attrs)) return true;
                  const cellText = norm(el.closest('td, th')?.textContent || '');
                  if (/visit\s*date|dd\/mm|mm\/dd|yyyy/.test(cellText)) return true;
                  const rowText = norm(row.innerText || row.textContent || '');
                  if (/visit\s*date/.test(rowText) && !/nric|fin|member/.test(cellText)) return true;
                  const val = (el.value || '').toString();
                  return /\d{1,2}\/\d{1,2}\/\d{2,4}/.test(val);
                };
                let input = inputs.find((el) => /nric|fin|member/.test(getAttrText(el))) || null;
                if (!input) input = inputs.find((el) => !isDateLike(el)) || null;
                if (!input) return { ok: false, reason: 'date_only', value: '' };
                const rows = Array.from(document.querySelectorAll('tr'));
                const nameRow = rows.find((r) => /patient\s*name/i.test(norm(r.innerText || r.textContent || '')));
                if (nameRow) {
                  const nameInput =
                    nameRow.querySelector('input[type="text"]') ||
                    nameRow.querySelector('input:not([type])') ||
                    nameRow.querySelector('input');
                  if (nameInput) {
                    nameInput.value = '';
                    nameInput.dispatchEvent(new Event('input', { bubbles: true }));
                    nameInput.dispatchEvent(new Event('change', { bubbles: true }));
                  }
                }
                input.value = term;
                input.dispatchEvent(new Event('input', { bubbles: true }));
                input.dispatchEvent(new Event('change', { bubbles: true }));
                const valueNow = (input.value || '').toString();
                return { ok: true, value: valueNow };
              }, value)
              .catch(() => ({ ok: false, value: '' }));

          const clickRowSearch = async (ctx) =>
            ctx
              .evaluate(() => {
                const norm = (s) => (s || '').toString().replace(/\s+/g, ' ').trim().toLowerCase();
                const cells = Array.from(document.querySelectorAll('th, td'));
                const labelCell = cells.find((c) => /nric\s*\/\s*fin\s*\/\s*member\s*id/i.test(norm(c.textContent || '')));
                const row = labelCell?.closest('tr') || null;
                if (!row) return false;
                const inputs = Array.from(row.querySelectorAll('input')).filter((el) => {
                  const type = (el.getAttribute('type') || '').toLowerCase();
                  return type !== 'hidden' && type !== 'button' && type !== 'submit' && type !== 'image';
                });
                if (!inputs.length) return false;
                const getAttrText = (el) => {
                  const name = el.getAttribute('name') || '';
                  const id = el.getAttribute('id') || '';
                  const placeholder = el.getAttribute('placeholder') || '';
                  return `${name} ${id} ${placeholder}`.toLowerCase();
                };
                const isDateLike = (el) => {
                  const attrs = getAttrText(el);
                  if (/date|dd\/mm|mm\/dd|yyyy/.test(attrs)) return true;
                  const cellText = norm(el.closest('td, th')?.textContent || '');
                  if (/visit\s*date|dd\/mm|mm\/dd|yyyy/.test(cellText)) return true;
                  const rowText = norm(row.innerText || row.textContent || '');
                  if (/visit\s*date/.test(rowText) && !/nric|fin|member/.test(cellText)) return true;
                  const val = (el.value || '').toString();
                  return /\d{1,2}\/\d{1,2}\/\d{2,4}/.test(val);
                };
                let input = inputs.find((el) => /nric|fin|member/.test(getAttrText(el))) || null;
                if (!input) input = inputs.find((el) => !isDateLike(el)) || null;
                if (!input) return false;
                const val = (input.value || '').toString().replace(/\s+/g, '');
                if (val.length < 5) return false;
                const btns = Array.from(row.querySelectorAll('button, input[type="submit"], input[type="button"]'));
                const searchBtn = btns.find((b) => /search/i.test((b.textContent || b.value || '').toString())) || null;
                if (!searchBtn) return false;
                searchBtn.click();
                return true;
              })
              .catch(() => false);

          const directRowFill = await searchCtx
            .evaluate((term) => {
              const norm = (s) => (s || '').toString().replace(/\s+/g, ' ').trim().toLowerCase();
              const cells = Array.from(document.querySelectorAll('th, td'));
              const labelCell = cells.find((c) => /nric\s*\/\s*fin\s*\/\s*member\s*id/i.test(norm(c.textContent || '')));
              const row = labelCell?.closest('tr') || null;
              if (!row) return { ok: false, clicked: false, value: '', reason: 'row_not_found' };
              const getAttrText = (el) => {
                const name = el.getAttribute('name') || '';
                const id = el.getAttribute('id') || '';
                const placeholder = el.getAttribute('placeholder') || '';
                return `${name} ${id} ${placeholder}`.toLowerCase();
              };
              const isDateLike = (el) => {
                const attrs = getAttrText(el);
                if (/date|dd\/mm|mm\/dd|yyyy/.test(attrs)) return true;
                const cellText = norm(el.closest('td, th')?.textContent || '');
                if (/visit\s*date|dd\/mm|mm\/dd|yyyy/.test(cellText)) return true;
                const rowText = norm(row.innerText || row.textContent || '');
                if (/visit\s*date/.test(rowText) && !/nric|fin|member/.test(cellText)) return true;
                const val = (el.value || '').toString();
                return /\d{1,2}\/\d{1,2}\/\d{2,4}/.test(val);
              };
              const collectInputs = (root) =>
                Array.from(root.querySelectorAll('input'))
                  .filter((el) => {
                    const type = (el.getAttribute('type') || '').toLowerCase();
                    return type !== 'hidden' && type !== 'button' && type !== 'submit' && type !== 'image';
                  });
              let candidates = [];
              const nextCell = labelCell?.nextElementSibling || null;
              if (nextCell) candidates = collectInputs(nextCell);
              if (!candidates.length) candidates = collectInputs(row);
              if (!candidates.length) return { ok: false, clicked: false, value: '', reason: 'input_not_found' };
              let input = candidates.find((el) => /nric|fin|member/.test(getAttrText(el))) || null;
              if (!input) input = candidates.find((el) => !isDateLike(el)) || null;
              if (!input) return { ok: false, clicked: false, value: '', reason: 'date_only' };

              const nameRow = Array.from(document.querySelectorAll('tr')).find((r) =>
                /patient\s*name/i.test(norm(r.innerText || r.textContent || ''))
              );
              if (nameRow) {
                const nameInput =
                  nameRow.querySelector('input[type="text"]') ||
                  nameRow.querySelector('input:not([type])') ||
                  nameRow.querySelector('input');
                if (nameInput) {
                  nameInput.value = '';
                  nameInput.dispatchEvent(new Event('input', { bubbles: true }));
                  nameInput.dispatchEvent(new Event('change', { bubbles: true }));
                }
              }

              input.value = term;
              input.dispatchEvent(new Event('input', { bubbles: true }));
              input.dispatchEvent(new Event('change', { bubbles: true }));
              const valueNow = (input.value || '').toString();
              const compact = valueNow.replace(/\s+/g, '').toUpperCase();
              const termCompact = String(term || '').replace(/\s+/g, '').toUpperCase();
              const ok = compact.includes(termCompact) && compact.length >= 5;
              let clicked = false;
              if (ok) {
                const btns = Array.from(row.querySelectorAll('button, input[type="submit"], input[type="button"]'));
                const searchBtn = btns.find((b) => /search/i.test((b.textContent || b.value || '').toString())) || null;
                if (searchBtn) {
                  searchBtn.click();
                  clicked = true;
                }
              }
              return { ok, clicked, value: valueNow, reason: ok ? null : 'value_mismatch' };
            }, term)
            .catch(() => ({ ok: false, clicked: false, value: '', reason: 'evaluate_failed' }));

          if (directRowFill?.ok && directRowFill?.clicked) {
            searchTriggered = true;
          }

          const rowFill = directRowFill?.ok ? directRowFill : await fillRowAndClickSearch(searchCtx, term);
          if (rowFill?.ok && rowFill?.clicked) {
            searchTriggered = true;
          }

          const fastRow = await forceFillRow(searchCtx, term);
          const fastValue = String(fastRow?.value || '');
          const fastValueNorm = fastValue.replace(/\\s+/g, '').toUpperCase();
          const fastRowOk = fastRow?.ok && fastValueNorm.includes(termNorm) && fastValueNorm.length >= 5;

          // Only proceed when we positively identified the NRIC/FIN row. Never fill generic inputs.
          if (!fastRowOk && !directRowFill?.ok && !rowFill?.ok && !searchTriggered) {
            await this.page
              .screenshot({ path: 'screenshots/mhc-asia-before-search-field.png', fullPage: true })
              .catch(() => {});
            return { nric: term, portal: null, found: false, memberNotFound: false, _noField: true };
          }

          // Safety: NEVER include generic submit selectors here. This flow is for patient search only.
          // Clicking a generic "Submit" can accidentally submit a claim form when page state is wrong.
          const rowBtnSelectors = [
            'button:has-text(\"Search\")',
            'input[type=\"submit\"][value*=\"Search\" i]',
            'input[type=\"button\"][value*=\"Search\" i]',
          ];

          let rowValue = rowFill?.value || (await readRowValue(searchCtx));
          let rowValueNorm = String(rowValue || '').replace(/\\s+/g, '').toUpperCase();
          if (!rowValueNorm || !rowValueNorm.includes(termNorm)) {
            const forced = await forceFillRow(searchCtx, term);
            rowValue = forced?.value || (await readRowValue(searchCtx));
            rowValueNorm = String(rowValue || '').replace(/\\s+/g, '').toUpperCase();
          }
          if (!rowValueNorm || rowValueNorm.length < 5 || !rowValueNorm.includes(termNorm)) {
            logger.warn('NRIC field value mismatch; aborting search click', {
              term,
              programKind,
              rowValue,
            });
            return { nric: term, portal: null, found: false, memberNotFound: false, _noField: true, _valueMismatch: true };
          }
          this._logStep('NRIC search field set', { programKind, value: rowValueNorm });

          let clicked = searchTriggered;
          if (!clicked) {
            const rowClicked = await clickRowSearch(searchCtx);
            if (rowClicked) clicked = true;
          }

          if (!clicked) {
            for (const sel of rowBtnSelectors) {
              const btn = searchCtx.locator(sel).first();
              if ((await btn.count().catch(() => 0)) > 0 && (await btn.isVisible().catch(() => true))) {
                await btn.click();
                clicked = true;
                break;
              }
            }
          }
          if (!clicked && searchCtx !== this.page) {
            for (const sel of rowBtnSelectors) {
              const btn = this.page.locator(sel).first();
              if ((await btn.count().catch(() => 0)) > 0 && (await btn.isVisible().catch(() => true))) {
                await btn.click();
                clicked = true;
                break;
              }
            }
          }
          if (!clicked) throw new Error('Could not find Search button');
          await this.page.waitForTimeout(200);

          await this.page
            .screenshot({ path: `screenshots/mhc-asia-before-search-click-${programKind}.png`, fullPage: true })
            .catch(() => {});

          const valueNow = (await readRowValue(searchCtx)) || '';
          const valueNorm = valueNow.replace(/\\s+/g, '').toUpperCase();
          if (valueNorm.length < 5) {
            logger.warn('Search field value too short; aborting search result scan', {
              term,
              programKind,
              valueNow,
            });
            return { nric: term, portal: null, found: false, memberNotFound: true, _noField: true, _valueMismatch: true };
          }
          const shortMsg = await this.page
            .locator('text=/at least\\s+5\\s+char/i')
            .first()
            .isVisible()
            .catch(() => false);
          if (shortMsg) {
            logger.warn('MHC portal rejected search: minimum 5 characters');
            return { nric: term, portal: null, found: false, memberNotFound: true, _invalidTerm: true };
          }

          const collectResultInfo = async () => {
            const frames = this.page.frames();
            let infoAgg = { linkCount: 0, rowCount: 0, hasTermMatch: false };
            for (const frame of frames) {
              try {
                const info = await frame
                  .evaluate((t) => {
                    const termLower = String(t || '').trim().toLowerCase();
                    const isPatientLink = (a) => {
                      const tt = (a.textContent || '').trim().toLowerCase();
                      if (!tt) return false;
                      if (tt === 'search') return false;
                      if (tt === 'benefit') return false;
                      if (tt === 'subsidiaries') return false;
                      return true;
                    };

                    const tables = Array.from(document.querySelectorAll('table'));
                    let resultTable = null;
                    for (const table of tables) {
                      const header = (table.querySelector('thead') || table).innerText?.toLowerCase?.() || '';
                      if (header.includes('patient id') && header.includes('patient name')) {
                        resultTable = table;
                        break;
                      }
                    }

                    const rows = Array.from(
                      (resultTable || document).querySelectorAll(resultTable ? 'tr' : 'table tr')
                    );
                    let linkCount = 0;
                    let rowCount = 0;
                    let hasTermMatch = false;
                    const useLooseMatch = !resultTable;

                    for (const r of rows) {
                      const text = (r.innerText || '').toLowerCase();
                      if (!text) continue;
                      if (text.includes('visit date') || text.includes('nric/fin/member id')) continue;
                      const cells = Array.from(r.querySelectorAll('td'));
                      if (!cells.length) continue;
                      const links = Array.from(r.querySelectorAll('a')).filter(isPatientLink);
                      const termMatch = termLower && text.includes(termLower);
                      if (useLooseMatch && !termMatch && links.length === 0) continue;
                      rowCount += 1;
                      if (links.length) linkCount += links.length;
                      if (termMatch) hasTermMatch = true;
                    }

                    return { linkCount, rowCount, hasTermMatch };
                  }, term)
                  .catch(() => null);
                if (info) {
                  infoAgg.linkCount += info.linkCount || 0;
                  infoAgg.rowCount += info.rowCount || 0;
                  infoAgg.hasTermMatch = infoAgg.hasTermMatch || !!info.hasTermMatch;
                }
              } catch {
                // ignore frame errors
              }
            }
            return infoAgg;
          };

          const waitForResults = async () => {
            const start = Date.now();
            while (Date.now() - start < 4000) {
              const info = await collectResultInfo();
              const memberNotFoundNow = await this.page
                .locator('text=/Member\\s+not\\s+found/i')
                .first()
                .isVisible()
                .catch(() => false);
              if (info.linkCount > 0 || info.rowCount > 0 || memberNotFoundNow) return info;
              await this.page.waitForTimeout(300);
            }
            return collectResultInfo();
          };

          await this.page
            .screenshot({ path: `screenshots/mhc-asia-search-results-${programKind}.png`, fullPage: true })
            .catch(() => {});

          const aiaInlinePrompt = await this.page
            .locator('text=/submit\\s+this\\s+claim\\s+under\\s+www\\.aiaclinic\\.com/i')
            .first()
            .isVisible()
            .catch(() => false);
          if (aiaInlinePrompt) {
            this.needsAIAClinicSwitch = true;
            logger.warn('AIA Clinic instruction detected in page text (inline)');
            return { nric: term, portal: 'aiaclient', found: false, memberNotFound: false };
          }

          if (this.lastDialogMessage && /please\s+enter\s+at\s+least\s+5/i.test(this.lastDialogMessage)) {
            logger.warn('Search rejected by portal validation', {
              term,
              programKind,
              message: this.lastDialogMessage,
            });
            this.lastDialogMessage = null;
            return { nric: term, portal: null, found: false, memberNotFound: true, _noField: true };
          }
          const minCharsVisible = await this.page
            .locator('text=/Please\\s+enter\\s+at\\s+least\\s+5\\s+chara/i')
            .first()
            .isVisible()
            .catch(() => false);
          if (minCharsVisible) {
            logger.warn('Search rejected by portal validation (inline)', { term, programKind });
            return { nric: term, portal: null, found: false, memberNotFound: true, _noField: true };
          }

          const memberNotFound = await this.page
            .locator('text=/Member\\s+not\\s+found/i')
            .first()
            .isVisible()
            .catch(() => false);

          const resultInfo = await waitForResults();

          const hasPatientRow = (() => {
            // Require a term match for row-count-based detection to avoid counting header-only tables.
            if (isLikelyName) return resultInfo.linkCount === 1 || (resultInfo.rowCount === 1 && resultInfo.hasTermMatch);
            return resultInfo.linkCount >= 1 || (resultInfo.rowCount >= 1 && resultInfo.hasTermMatch);
          })();

          if (memberNotFound && !hasPatientRow) {
            logger.warn('Member not found after search', { term, programKind });
            return { nric: term, portal: null, found: false, memberNotFound: true };
          }

          let portal = null;
          if (hasPatientRow) {
            const resultRowText = await this.page
              .evaluate((term) => {
                const termLower = String(term || '').trim().toLowerCase();
                const tables = Array.from(document.querySelectorAll('table'));
                let resultTable = null;
                for (const table of tables) {
                  const header = (table.querySelector('thead') || table).innerText?.toLowerCase?.() || '';
                  if (header.includes('patient id') && header.includes('patient name')) {
                    resultTable = table;
                    break;
                  }
                }
                const rows = Array.from((resultTable || document).querySelectorAll('tr'));
                const norm = (s) => (s || '').toString().replace(/\s+/g, ' ').trim().toLowerCase();
                if (termLower) {
                  const matched = rows.find((r) => norm(r.innerText || r.textContent || '').includes(termLower));
                  if (matched) return (matched.innerText || matched.textContent || '').trim();
                }
                // Fallback: if only one data row, use it.
                const dataRows = rows.filter((r) => {
                  const text = norm(r.innerText || r.textContent || '');
                  if (!text) return false;
                  if (text.includes('visit date') || text.includes('nric/fin/member id')) return false;
                  return r.querySelectorAll('td').length > 0;
                });
                if (dataRows.length === 1) return (dataRows[0].innerText || dataRows[0].textContent || '').trim();
                return '';
              }, term)
              .catch(() => '');
            const pageText = resultRowText || (await this.page.textContent('body').catch(() => ''));
            const portalPatterns = {
              aiaclient: /aiaclient/i,
              // Avoid false positives from header links; require PCP/Preferred Care context.
              singlife: /(singlife.*(pcp|preferred\\s+care|pcp\\s*sp|pcp\\s*programme|pcp\\s*program))|aviva/i,
              ge: /great\\s+eastern\\b/i,
              prudential: /prudential/i,
              axa: /\\baxa\\b/i,
            };
            for (const [portalName, pattern] of Object.entries(portalPatterns)) {
              if (pattern.test(pageText)) {
                portal = portalName;
                break;
              }
            }
          }

          return { nric: term, portal, found: hasPatientRow, memberNotFound };
        };

        // Try "other programs" first (usual MHC flow). If no result, fall back to AIA Program.
        const attempts = ['other', 'aia'];
        let last = null;
        for (const programKind of attempts) {
          last = await runSearchAttempt({ programKind });
          const hasField = !last?._noField;
          this._logStep('Search attempt result', {
            programKind,
            found: !!last?.found,
            memberNotFound: !!last?.memberNotFound,
            hasField,
          });
          if (last?.found) break;
          if (last?.memberNotFound) {
            // "Member not found" in OTHER programs can still be a valid AIA member.
            // Continue to AIA Program attempt when applicable.
            if (programKind === 'other') continue;
            break;
          }
        }

        logger.info(`Portal determined: ${last?.portal || null}`);
        this._logStep('Search result parsed', {
          portal: last?.portal || null,
          found: !!last?.found,
          memberNotFound: !!last?.memberNotFound,
        });

        return {
          nric: term,
          portal: last?.portal || null,
          found: !!last?.found,
          memberNotFound: !!last?.memberNotFound,
          usedTerm: term
        };
      };

      // Primary: search by ID/NRIC/member id only (MHC portal does not support name search).
      if (!idTerm) {
        return { nric: '', portal: null, found: false, memberNotFound: false, usedTerm: '' };
      }

      const result = await searchOne(idTerm);

      return {
        nric: idTerm,
        portal: result?.portal || null,
        found: !!result?.found,
        memberNotFound: !!result?.memberNotFound,
        usedTerm: result?.usedTerm || idTerm,
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
      const term = String(nric || '').trim();
      this._logStep('Open patient from results', { nric: term });
      logger.info('Opening patient from search results...');
      if (this.needsAIAClinicSwitch) {
        logger.warn('AIA Clinic switch already required; skipping patient open on MHC');
        return false;
      }

      const isLikelyId = /^(?:[STFGM]\d{7}[A-Z]|\d{6,}|[A-Z]\d{7}[A-Z])$/i.test(term.replace(/\s+/g, ''));
      const strictUnique = !isLikelyId; // For name-search, require unique match.

      // Search across frames for a result row/link.
      for (const frame of this.page.frames()) {
        try {
          const handle = await frame.evaluateHandle(
            ({ t, strict }) => {
              const termLower = String(t || '').trim().toLowerCase();
              const isPatientLink = (a) => {
                const tt = (a.textContent || '').trim().toLowerCase();
                if (!tt) return false;
                if (tt === 'search') return false;
                if (tt === 'benefit') return false;
                if (tt === 'subsidiaries') return false;
                return true;
              };

              // Prefer the dedicated result table when present.
              const tables = Array.from(document.querySelectorAll('table'));
              let resultTable = null;
              for (const table of tables) {
                const header = (table.querySelector('thead') || table).innerText?.toLowerCase?.() || '';
                if (header.includes('patient id') && header.includes('patient name')) {
                  resultTable = table;
                  break;
                }
              }

              const root = resultTable || document;
              const rows = Array.from(root.querySelectorAll('tr'));

              const candidates = [];
              const allPatientLinks = [];
              const rowCandidates = [];

              for (const r of rows) {
                const text = (r.innerText || '').toLowerCase();
                if (!text) continue;
                if (text.includes('visit date') || text.includes('nric/fin/member id')) continue;
                const links = Array.from(r.querySelectorAll('a')).filter(isPatientLink);
                const tds = Array.from(r.querySelectorAll('td'));
                if (tds.length) {
                  rowCandidates.push(r);
                }
                if (links.length) {
                  for (const a of links) allPatientLinks.push(a);
                  if (termLower && text.includes(termLower)) {
                    candidates.push(...links);
                  }
                }
              }

              // If no term match, fall back to the first patient link when the result set is unambiguous.
              const usable = candidates.length ? candidates : allPatientLinks;
              if (strict && usable.length !== 1 && rowCandidates.length !== 1) return null;
              if (usable[0]) return usable[0];
              if (rowCandidates.length === 1) return rowCandidates[0];
              if (!strict && rowCandidates.length > 0) return rowCandidates[0];
              return null;
            },
            { t: term, strict: strictUnique }
          );

          const el = handle?.asElement?.() || null;
          if (!el) {
            await handle.dispose().catch(() => {});
            continue;
          }

          const beforeUrl = this.page.url();
          const previousPage = this.page;
          const popupPromise = this.page.context().waitForEvent('page', { timeout: 1500 }).catch(() => null);
          // Clicking the actual patient-name link is more reliable than clicking the whole row.
          await el.click().catch(() => false);
          // Allow the global dialog handler to consume any alerts.
          await this.page.waitForTimeout(200);
          if (this.needsAIAClinicSwitch) {
            logger.warn('AIA Clinic switch required; aborting MHC open');
            await handle.dispose().catch(() => {});
            return false;
          }
          const popup = await popupPromise;
          if (popup) {
            await popup.waitForLoadState('domcontentloaded').catch(() => {});
            this.page = popup;
            // Rebind dialog handler on the new page (AIA dialogs, max amount prompts, etc.).
            this.setupDialogHandler({ reset: false });
            await this.page.bringToFront().catch(() => {});
            await this.page.evaluate(() => window.focus()).catch(() => {});
            if (previousPage && previousPage !== popup) {
              await previousPage.close().catch(() => {});
            }
          }
          await handle.dispose().catch(() => {});
          await this.page.waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => {});
          await this.page.waitForTimeout(300);
          await this.page.bringToFront().catch(() => {});
          if (this.needsAIAClinicSwitch) {
            logger.warn('AIA Clinic dialog detected after patient click; aborting MHC open');
            return false;
          }

          const checkVisitForm = async () => {
            const urlNow = this.page.url() || '';
            const hasEmployeeVisitAddHeader =
              (await this.page.locator('text=/Employee\\s+Visit\\s*-\\s*Add/i').count().catch(() => 0)) > 0;
            const hasChargeType =
              (await this.page.locator('text=/Charge\\s*Type/i').count().catch(() => 0)) > 0;
            const hasConsultFee =
              (await this.page.locator('text=/Consultation\\s+Fee/i').count().catch(() => 0)) > 0;
            const hasSaveDraft =
              (await this.page.locator('button:has-text(\"Save As Draft\"), input[value*=\"Save As Draft\" i]').count().catch(() => 0)) > 0;
            const hasDrugHeader = (await this.page.locator('text=/Drug\\s+Name/i').count().catch(() => 0)) > 0;
            return (
              /EmpVisitAdd|VisitAdd/i.test(urlNow) ||
              hasEmployeeVisitAddHeader ||
              (hasChargeType && (hasConsultFee || hasDrugHeader || hasSaveDraft))
            );
          };
          const isVisitForm = await checkVisitForm();

          await this.page.screenshot({ path: 'screenshots/mhc-asia-patient-opened.png', fullPage: true });
          if (isVisitForm) {
            this._logStep('Patient opened from results');
            return true;
          }

          const afterUrl = this.page.url();
          if (afterUrl === beforeUrl) {
            logger.warn('Patient click did not navigate away; still on search/results page');
          } else {
            logger.warn('Patient click navigated but visit form not detected', { from: beforeUrl, to: afterUrl });
          }

          // Fallback: direct navigation to EmpVisitAdd/VisitAdd link in the results row.
          const directHref = await this.page
            .evaluate((needle) => {
              const lowerNeedle = String(needle || '').trim().toLowerCase();
              const rows = Array.from(document.querySelectorAll('tr'));
              let candidate = null;
              for (const row of rows) {
                const text = (row.innerText || '').toLowerCase();
                if (lowerNeedle && !text.includes(lowerNeedle)) continue;
                const link =
                  row.querySelector('a[href*="EmpVisitAdd" i]') ||
                  row.querySelector('a[href*="VisitAdd" i]') ||
                  row.querySelector('a[href*="EmpVisit" i]');
                if (link) {
                  candidate = link.getAttribute('href') || link.href;
                  break;
                }
              }
              if (!candidate) {
                const any =
                  document.querySelector('a[href*="EmpVisitAdd" i]') ||
                  document.querySelector('a[href*="VisitAdd" i]') ||
                  document.querySelector('a[href*="EmpVisit" i]');
                candidate = any ? any.getAttribute('href') || any.href : null;
              }
              return candidate;
            }, term)
            .catch(() => null);

          if (directHref) {
            const targetUrl = new URL(directHref, this.page.url()).href;
            await this.page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
            await this.page.waitForTimeout(300);
            await this.page.bringToFront().catch(() => {});
            if (await checkVisitForm()) {
              this._logStep('Patient opened via direct link');
              return true;
            }
          }

          return false;
        } catch {
          // ignore frame errors and continue
        }
      }

      await this.page.screenshot({ path: 'screenshots/mhc-asia-patient-open-not-found.png', fullPage: true }).catch(() => {});
      logger.warn('Could not open patient from search results', { term, strictUnique });
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
  async addVisit(portal, nric = null) {
    try {
      const portalNorm = String(portal || '').trim().toLowerCase();
      let effectivePortal = portalNorm;
      const forceAiaByDialog = this.needsAIAClinicSwitch === true;
      if (forceAiaByDialog && !/aia/i.test(effectivePortal || '')) {
        effectivePortal = 'aia';
      }
      const isBaseMhc = !effectivePortal || effectivePortal === 'mhc' || effectivePortal === 'base';
      this._logStep('Add visit', {
        portal: portalNorm || null,
        effectivePortal: effectivePortal || null,
        nric: nric ? nric.substring(0, 4) + '...' : null,
      });
      logger.info(`Adding visit for portal: ${portalNorm || '(base)'} (effective: ${effectivePortal || '(base)'})`);

      // Some portals require switching the system context (top-right "Switch System").
      // Singlife (ex-Aviva) should use the Singlife system; AIA uses AIA Clinic.
      // Base MHC should not switch system here (routing is done by pay_type).
      const forceSinglife = !isBaseMhc && /singlife|aviva/i.test(effectivePortal || '');
      const switchedToSinglife = forceSinglife ? await this.switchToSinglifeIfNeeded({ force: true }) : false;

      // Check if we need to switch to AIA Clinic system (triggered by dialog handler).
      // Do NOT infer this from generic page text here; only switch when the flag is set.
      const allowAiaSwitch = this.needsAIAClinicSwitch === true && /aia/i.test(effectivePortal || '') && !switchedToSinglife;
      // Never carry this flag across patients if the current portal doesn't support it.
      if (!allowAiaSwitch && this.needsAIAClinicSwitch) this.needsAIAClinicSwitch = false;
      const switchedToAIA = switchedToSinglife ? false : (allowAiaSwitch ? await this.switchToAIAClinicIfNeeded() : false);

      // If we switched to AIA Clinic, we need to use the AIA-specific flow:
      // 1. Click "Add AIA Visit"
      // 2. Click search icon (#ctr_block > div:nth-child(2) > img)
      // 3. Enter NRIC and search
      // 4. Click patient name
      if (switchedToAIA && nric) {
        logger.info('Using AIA Clinic visit flow after system switch');
        const aiaResult = await this.navigateToAIAVisitAndSearch(nric);
        if (aiaResult) {
          await this.page.screenshot({ path: 'screenshots/mhc-asia-aia-visit-form.png', fullPage: true }).catch(() => {});
          return true;
        }
        // If AIA flow failed, continue with normal flow as fallback
        logger.warn('AIA visit flow failed, trying normal flow');
      }

      // Many flows start the visit form by clicking the patient in the search results.
      // IMPORTANT: the *search results* page also contains a "Visit Date" field, so only use
      // strong visit-form signals here.
      const alreadyInVisit = (await (async () => {
        const hasEmployeeVisitHeader =
          (await this.page.locator('text=/Employee\\s+Visit\\s*-\\s*Add/i').count().catch(() => 0)) > 0;
        const hasChargeType = (await this.page.locator('text=/Charge\\s*Type/i').count().catch(() => 0)) > 0;
        const hasConsultFee = (await this.page.locator('text=/Consultation\\s+Fee/i').count().catch(() => 0)) > 0;
        const hasSaveDraft =
          (await this.page.locator('button:has-text(\"Save As Draft\"), input[value*=\"Save As Draft\" i]').count().catch(() => 0)) > 0;
        const hasDrugHeader = (await this.page.locator('text=/Drug\\s+Name/i').count().catch(() => 0)) > 0;
        return hasEmployeeVisitHeader || (hasChargeType && (hasConsultFee || hasDrugHeader || hasSaveDraft));
      })());
      if (alreadyInVisit) {
        logger.info('Already on visit form after selecting patient');
        await this.page.screenshot({ path: 'screenshots/mhc-asia-add-visit-form.png', fullPage: true }).catch(() => {});
        this._logStep('Already on visit form');
        return true;
      }

      // Some flows land on a "member card" selection before the actual visit form.
      const memberCardSelection = await this.page
        .locator('text=/member\\s+cards/i')
        .first()
        .isVisible()
        .catch(() => false);
      if (memberCardSelection) {
        this._logStep('Member card selection detected (before visit form)');
        const nricChoiceSelectors = [
          'a:has-text("NRIC")',
          'button:has-text("NRIC")',
          'li:has-text("NRIC")',
          'div:has-text("NRIC")',
          'text=/\\bNRIC\\b/i',
        ];
        for (const selector of nricChoiceSelectors) {
          try {
            const choice = this.page.locator(selector).first();
            if ((await choice.count().catch(() => 0)) > 0 && (await choice.isVisible().catch(() => false))) {
              await this._safeClick(choice, 'Member card: NRIC');
              await this.page.waitForTimeout(800);
              break;
            }
          } catch {
            continue;
          }
        }
      }

      // Click on a portal link only when explicitly needed (avoid misclicks on base MHC pages).
      if (!isBaseMhc && effectivePortal) {
        const portalSelectors = [
          `a:has-text("${effectivePortal}")`,
          `button:has-text("${effectivePortal}")`,
          `a[href*="${effectivePortal}" i]`,
        ];

        for (const selector of portalSelectors) {
          try {
            const link = this.page.locator(selector).first();
            if (await link.count() > 0) {
              await link.click();
              await this.page.waitForLoadState('domcontentloaded').catch(() => {});
              await this.page.waitForTimeout(400);
              logger.info(`Clicked on portal: ${portalNorm}`);
              break;
            }
          } catch {
            continue;
          }
        }
      }
      
      // Click "Add [Portal] Visit" (e.g., "Add AIA Visit")
      const addVisitSelectors = [
        // Base MHC flows sometimes have a left-nav item for this.
        'a:has-text("Add Normal Visit")',
        'button:has-text("Add Normal Visit")',
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
            await this.page.waitForLoadState('domcontentloaded').catch(() => {});
            await this.page.waitForTimeout(400);
            logger.info('Clicked Add Visit');
            await this.page.screenshot({ path: 'screenshots/mhc-asia-add-visit-form.png', fullPage: true }).catch(() => {});
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
   * Check if we need to switch to AIA Clinic system and do it if needed
   * This handles the dialog/message that asks to go to AIA Clinic
   * @returns {boolean} True if switch was performed or not needed
   */
  async switchToAIAClinicIfNeeded() {
    try {
      this._logStep('Check if AIA Clinic switch needed');
      
      // Check if the dialog handler flagged that we need to switch
      // This happens when a dialog says "Please submit this claim under www.aiaclinic.com"
      const flaggedByDialog = this.needsAIAClinicSwitch === true;
      let needsSwitch = flaggedByDialog;
      
      if (needsSwitch) {
        logger.info('AIA Clinic switch needed (flagged by dialog handler)');
      } else {
        // Check for dialog or message about AIA Clinic in page text
        const pageText = await this.page.textContent('body').catch(() => '');
        needsSwitch = /switch.*aia\s*clinic|go.*aia\s*clinic|aia\s*clinic.*system/i.test(pageText);
        
        if (!needsSwitch) {
          // Also check for any visible prompt/message
          const switchPromptSelectors = [
            'text=/switch.*AIA.*Clinic/i',
            'text=/go.*AIA.*Clinic/i',
            '.alert:has-text("AIA Clinic")',
            '.modal:has-text("AIA Clinic")',
          ];
          
          for (const selector of switchPromptSelectors) {
            try {
              if ((await this.page.locator(selector).count().catch(() => 0)) > 0) {
                needsSwitch = true;
                break;
              }
            } catch {
              continue;
            }
          }
        }
      }
      
      if (!needsSwitch) {
        logger.info('No AIA Clinic switch needed');
        return false; // Return false to indicate no switch was performed
      }
      
      logger.info('AIA Clinic switch detected - switching system...');
      this._logStep('Switching to AIA Clinic system');
      
      // Step 1: Find and click "Switch System" in top right corner
      const switchSystemSelectors = [
        'a:has-text("Switch System")',
        'button:has-text("Switch System")',
        'text=/Switch\\s+System/i',
        '[onclick*="switch" i]',
        '.switch-system',
        'a[href*="switch" i]',
      ];
      
      let switchClicked = false;
      for (const selector of switchSystemSelectors) {
        try {
          const switchBtn = this.page.locator(selector).first();
          if ((await switchBtn.count().catch(() => 0)) > 0) {
            await this._safeClick(switchBtn, 'Switch System');
            await this.page.waitForTimeout(500);
            switchClicked = true;
            break;
          }
        } catch {
          continue;
        }
      }
      
      if (!switchClicked) {
        // Try to find it in a dropdown or menu
        const menuSelectors = [
          '.dropdown-toggle',
          '.navbar-right a',
          '.user-menu',
          '[data-toggle="dropdown"]',
        ];
        
        for (const menuSelector of menuSelectors) {
          try {
            const menu = this.page.locator(menuSelector).first();
            if ((await menu.count().catch(() => 0)) > 0) {
              await this._safeClick(menu, 'Open menu');
              await this.page.waitForTimeout(300);
              
              // Now look for Switch System in the opened menu
              for (const selector of switchSystemSelectors) {
                try {
                  const switchBtn = this.page.locator(selector).first();
                  if ((await switchBtn.count().catch(() => 0)) > 0) {
                    await this._safeClick(switchBtn, 'Switch System');
                    await this.page.waitForTimeout(500);
                    switchClicked = true;
                    break;
                  }
                } catch {
                  continue;
                }
              }
              if (switchClicked) break;
            }
          } catch {
            continue;
          }
        }
      }
      
      if (!switchClicked) {
        logger.warn('Could not find Switch System button');
        await this.page.screenshot({ path: 'screenshots/mhc-asia-switch-system-not-found.png' }).catch(() => {});
        return false;
      }
      
      // Step 2: Select "AIA Clinic" from the list
      const aiaClinicSelectors = [
        'a:has-text("AIA Clinic")',
        'button:has-text("AIA Clinic")',
        'option:has-text("AIA Clinic")',
        'li:has-text("AIA Clinic")',
        '[value*="aiaclinic" i]',
      ];
      
      for (const selector of aiaClinicSelectors) {
        try {
          const aiaClinic = this.page.locator(selector).first();
          if ((await aiaClinic.count().catch(() => 0)) > 0) {
            const prevPage = this.page;
            const popupPromise = this.page.context().waitForEvent('page', { timeout: 6000 }).catch(() => null);
            await this._safeClick(aiaClinic, 'AIA Clinic');
            const popup = await popupPromise;
            if (popup) {
              await popup.waitForLoadState('domcontentloaded').catch(() => {});
              this.page = popup;
              this.setupDialogHandler({ reset: false });
              await this.page.bringToFront().catch(() => {});
              await this.page.evaluate(() => window.focus()).catch(() => {});
              if (prevPage && prevPage !== popup) {
                await prevPage.close().catch(() => {});
              }
            }
            const switchResult = await this._waitForAiaSwitch(9000);
            const snap = switchResult.snap;
            this._logStep('AIA switch verification', snap);
            if (switchResult.ok) {
              logger.info('Switched to AIA Clinic system');
              this.isAiaClinicSystem = true;
              this.isSinglifeSystem = false;
              this._logStep('Switched to AIA Clinic');
              await this.page.screenshot({ path: 'screenshots/mhc-asia-switched-to-aia-clinic.png' }).catch(() => {});
              await this.page.bringToFront().catch(() => {});
              if (flaggedByDialog) this.needsAIAClinicSwitch = false;
              return true;
            }
            logger.warn('AIA option clicked but system did not switch context', {
              url: snap.url,
              hasAddAiaVisit: snap.hasAddAiaVisit,
              hasSearchAiaMember: snap.hasSearchAiaMember,
              hasPolicyNoHeader: snap.hasPolicyNoHeader,
            });
          }
        } catch {
          continue;
        }
      }
      
      // Try select dropdown
      const selectSelectors = ['select[name*="system" i]', 'select[id*="system" i]', 'select'];
      for (const selectSel of selectSelectors) {
        try {
          const select = this.page.locator(selectSel).first();
          if ((await select.count().catch(() => 0)) > 0) {
            await select.selectOption({ label: /AIA.*Clinic/i });
            const switchResult = await this._waitForAiaSwitch(9000);
            const snap = switchResult.snap;
            this._logStep('AIA dropdown switch verification', snap);
            if (switchResult.ok) {
              logger.info('Selected AIA Clinic from dropdown');
              this.isAiaClinicSystem = true;
              this.isSinglifeSystem = false;
              return true;
            }
          }
        } catch {
          continue;
        }
      }
      
      logger.warn('Could not select AIA Clinic');
      await this.page.screenshot({ path: 'screenshots/mhc-asia-aia-clinic-not-found.png' }).catch(() => {});
      return false;
    } catch (error) {
      logger.error('Failed to switch to AIA Clinic:', error);
      return false;
    }
  }

  /**
   * Check if we need to switch to Singlife system (Aviva) and do it if needed.
   * User requirement: for "Aviva" patients, switch system to Singlife and then proceed with the same visit flow.
   *
   * @param {{ force?: boolean }} opts
   * @returns {boolean} True if switched to Singlife, false if not switched.
   */
  async switchToSinglifeIfNeeded(opts = {}) {
    try {
      const { force = false } = opts;
      this._logStep('Check if Singlife switch needed', { force });

      // Check if the dialog handler flagged that we need to switch.
      let needsSwitch = force || this.needsSinglifeSwitch === true;

      if (needsSwitch && this.needsSinglifeSwitch === true) {
        // Reset the flag after consuming it.
        this.needsSinglifeSwitch = false;
      }

      if (!needsSwitch) return false;

      this._logStep('Switching to Singlife system');
      // Prefer switching to the Singlife PCP Panel explicitly (this is the Aviva/Singlife workflow).
      // Fallback to any Singlife/Aviva match if the explicit option isn't present in the switch menu.
      let ok = await this._switchSystemTo(/singlife\s*pcp/i, 'Singlife PCP');
      if (!ok) ok = await this._switchSystemTo(/singlife|aviva/i, 'Singlife');
      if (ok) {
        this.isSinglifeSystem = true;
        this.isAiaClinicSystem = false;
        await this.page.screenshot({ path: 'screenshots/mhc-asia-switched-to-singlife.png' }).catch(() => {});
      }
      return ok;
    } catch (error) {
      logger.error('Failed to switch to Singlife:', error);
      return false;
    }
  }

  async _switchSystemTo(targetRegex, labelForLog) {
    // Step 1: Find and click "Switch System" in top right corner
    const switchSystemSelectors = [
      'a:has-text("Switch System")',
      'button:has-text("Switch System")',
      'text=/Switch\\s+System/i',
      '[onclick*="switch" i]',
      '.switch-system',
      'a[href*="switch" i]',
    ];

    let switchClicked = false;
    for (const selector of switchSystemSelectors) {
      try {
        const switchBtn = this.page.locator(selector).first();
        if ((await switchBtn.count().catch(() => 0)) > 0) {
          await this._safeClick(switchBtn, 'Switch System');
          await this.page.waitForTimeout(500);
          switchClicked = true;
          break;
        }
      } catch {
        continue;
      }
    }

    if (!switchClicked) {
      logger.warn('Could not find Switch System button');
      return false;
    }

    // Step 2: Select the target system from the list
    const candidates = ['a', 'button', 'option', 'li', 'div', 'span'];

    for (const tag of candidates) {
      try {
        const loc = this.page
          .locator(tag)
          .filter({ hasText: targetRegex })
          .filter({ hasNotText: /Add\s+AIA\s+Visit|AIA\s+Visit|Visit/i })
          .first();
        if ((await loc.count().catch(() => 0)) > 0 && (await loc.isVisible().catch(() => true))) {
          const prevPage = this.page;
          const popupPromise = this.page.context().waitForEvent('page', { timeout: 6000 }).catch(() => null);
          await this._safeClick(loc, labelForLog);
          const popup = await popupPromise;
          if (popup) {
            await popup.waitForLoadState('domcontentloaded').catch(() => {});
            this.page = popup;
            this.setupDialogHandler({ reset: false });
            await this.page.bringToFront().catch(() => {});
            await this.page.evaluate(() => window.focus()).catch(() => {});
            if (prevPage && prevPage !== popup) {
              await prevPage.close().catch(() => {});
            }
          }
          const snapCheck =
            /aia/i.test(labelForLog) || targetRegex?.test?.('AIA')
              ? await this._waitForAiaSwitch(9000)
              : { ok: true, snap: await this._getPortalContextSnapshot() };
          const snap = snapCheck.snap;
          this._logStep('Switch system verification', { labelForLog, ...snap });
          if (/aia/i.test(labelForLog) || targetRegex?.test?.('AIA')) {
            if (snapCheck.ok && snap.looksLikeAiaFlow) {
              logger.info(`Switched system to: ${labelForLog}`);
              this.isAiaClinicSystem = true;
              this.isSinglifeSystem = false;
              return true;
            }
            continue;
          }
          if (/singlife|aviva|pcp/i.test(labelForLog)) {
            if (snap.isSinglifeDomain || /singlife/i.test(snap.url)) {
              logger.info(`Switched system to: ${labelForLog}`);
              this.isSinglifeSystem = true;
              this.isAiaClinicSystem = false;
              return true;
            }
            continue;
          }
          logger.info(`Switched system to: ${labelForLog}`);
          return true;
        }
      } catch {
        continue;
      }
    }

    // Try dropdown select as a last resort
    const selectSelectors = ['select[name*="system" i]', 'select[id*="system" i]', 'select'];
    for (const selectSel of selectSelectors) {
      try {
        const select = this.page.locator(selectSel).first();
        if ((await select.count().catch(() => 0)) > 0) {
          const options = await select
            .locator('option')
            .evaluateAll((opts) => opts.map((o) => ({ value: o.value, label: (o.textContent || '').trim() })))
            .catch(() => []);
          const match = options.find((o) => targetRegex.test(o.label)) || options.find((o) => targetRegex.test(o.value));
          if (!match) continue;
          await select.selectOption({ value: match.value }).catch(async () => select.selectOption({ label: match.label }));
          await this.page.waitForTimeout(500);
          logger.info(`Switched system to: ${match.label || labelForLog}`);
          if (/aia/i.test(match.label || labelForLog)) {
            this.isAiaClinicSystem = true;
            this.isSinglifeSystem = false;
          } else if (/singlife|aviva|pcp/i.test(match.label || labelForLog)) {
            this.isSinglifeSystem = true;
            this.isAiaClinicSystem = false;
          }
          return true;
        }
      } catch {
        continue;
      }
    }

    logger.warn(`Could not select system: ${labelForLog}`);
    return false;
  }

  /**
   * Navigate to AIA Visit and search for patient by NRIC
   * This is the flow AFTER switching to AIA Clinic system:
   * 1. Click "Add AIA Visit" 
   * 2. Click search icon (#ctr_block > div:nth-child(2) > img)
   * 3. Enter NRIC
   * 4. Click patient name
   * @param {string} nric - Patient NRIC to search
   * @returns {boolean} True if patient found and selected
   */
  async navigateToAIAVisitAndSearch(nric, opts = {}) {
    try {
      this._logStep('Navigate to AIA Visit', { nric });
      const retryCount = Number(opts.retryCount || 0);
      await this.page.waitForLoadState('domcontentloaded').catch(() => {});
      
      // Step 1: Click "Add AIA Visit"
      const aiaVisitSelectors = [
        'a:has-text("Add AIA Visit")',
        'a:has-text("AIA Visit")',
        'button:has-text("Add AIA Visit")',
        'text=/Add.*AIA.*Visit/i',
        'a[href*="aiavisit" i]',
      ];
      
      const clickAiaVisitInFrames = async () => {
        const frames = this.page.frames();
        for (const frame of frames) {
          try {
            const link = frame.locator(aiaVisitSelectors.join(', ')).first();
            if ((await link.count().catch(() => 0)) > 0 && (await link.isVisible().catch(() => false))) {
              await link.click().catch(() => false);
              await this.page.waitForTimeout(500);
              return true;
            }
          } catch {
            continue;
          }
        }
        return false;
      };

      let clickedAIAVisit = false;
      for (const selector of aiaVisitSelectors) {
        try {
          const link = this.page.locator(selector).first();
          if ((await link.count().catch(() => 0)) > 0) {
            await this._safeClick(link, 'Add AIA Visit');
            await this.page.waitForTimeout(500);
            clickedAIAVisit = true;
            break;
          }
        } catch {
          continue;
        }
      }
      if (!clickedAIAVisit) {
        clickedAIAVisit = await clickAiaVisitInFrames();
      }
      
      if (!clickedAIAVisit) {
        logger.warn('Could not find Add AIA Visit link');
        await this.page.screenshot({ path: 'screenshots/mhc-asia-aia-visit-not-found.png' }).catch(() => {});
        const snapBeforeReload = await this._getPortalContextSnapshot();
        if (!snapBeforeReload.looksLikeAiaFlow) {
          logger.warn('Not in AIA context when Add AIA Visit is missing; aborting without MHC reload');
          return false;
        }
        // Try reloading the base page (system switch might require a fresh nav render)
        await this.page.goto(this.config.url, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
        await this.page.waitForTimeout(500);
        for (const selector of aiaVisitSelectors) {
          try {
            const link = this.page.locator(selector).first();
            if ((await link.count().catch(() => 0)) > 0) {
              await this._safeClick(link, 'Add AIA Visit');
              await this.page.waitForTimeout(500);
              clickedAIAVisit = true;
              break;
            }
          } catch {
            continue;
          }
        }
        if (!clickedAIAVisit) {
          clickedAIAVisit = await clickAiaVisitInFrames();
        }
        // Try switching again in case we are not in AIA Clinic yet.
        await this._switchSystemTo(/aia\\s*clinic/i, 'AIA Clinic').catch(() => false);
        for (const selector of aiaVisitSelectors) {
          try {
            const link = this.page.locator(selector).first();
            if ((await link.count().catch(() => 0)) > 0) {
              await this._safeClick(link, 'Add AIA Visit');
              await this.page.waitForTimeout(500);
              clickedAIAVisit = true;
              break;
            }
          } catch {
            continue;
          }
        }
      }

      const isAiaSearchContext = async () => {
        const snap = await this._getPortalContextSnapshot();
        if (snap.isAiaDomain || snap.hasSearchAiaMember || snap.hasPolicyNoHeader) return true;
        const hasAiaSearchHint = await this.page
          .locator('text=/Search\\s+using\\s+full\\s+NRIC\\s*\\/\\s*FIN\\s*\\/\\s*Member\\s*ID/i')
          .first()
          .isVisible()
          .catch(() => false);
        return hasAiaSearchHint;
      };

      // Hard guard: never continue AIA search flow from MHC "other programs" search page.
      if (!(await isAiaSearchContext())) {
        logger.warn('Not on AIA search context after switch/navigation; aborting AIA search flow');
        await this.page.screenshot({ path: 'screenshots/mhc-asia-aia-wrong-context.png', fullPage: true }).catch(() => {});
        return false;
      }
      
      await this.page.waitForTimeout(500);
      
      // Some AIA flows show a "member card" selection screen before the NRIC search form.
      // Pick NRIC to proceed.
      const memberCardScreen = await this.page
        .locator('text=/member\\s+cards/i')
        .first()
        .isVisible()
        .catch(() => false);
      if (memberCardScreen) {
        this._logStep('Member card selection detected');
        // Prefer the red card: Integrated Healthcare Solutions (AIA).
        const redCardSelectors = [
          'text=/Integrated\\s+Healthcare\\s+Solutions/i',
          'text=/AIA\\s+Flexi/i',
          'img[alt*="Integrated" i]',
          'img[alt*="AIA" i]',
          'img[src*="AIA" i]',
        ];
        let cardClicked = false;
        for (const selector of redCardSelectors) {
          try {
            const choice = this.page.locator(selector).first();
            if ((await choice.count().catch(() => 0)) > 0 && (await choice.isVisible().catch(() => false))) {
              await this._safeClick(choice, 'Member card: AIA red card');
              await this.page.waitForTimeout(800);
              cardClicked = true;
              break;
            }
          } catch {
            continue;
          }
        }

        if (!cardClicked) {
          const nricChoiceSelectors = [
            'a:has-text("NRIC")',
            'button:has-text("NRIC")',
            'li:has-text("NRIC")',
            'div:has-text("NRIC")',
            'text=/\\bNRIC\\b/i',
          ];
          for (const selector of nricChoiceSelectors) {
            try {
              const choice = this.page.locator(selector).first();
              if ((await choice.count().catch(() => 0)) > 0 && (await choice.isVisible().catch(() => false))) {
                await this._safeClick(choice, 'Member card: NRIC');
                await this.page.waitForTimeout(800);
                break;
              }
            } catch {
              continue;
            }
          }
        }
      }

      // Check if we're already on the search form (NRIC/FIN/Member ID visible)
      const hasAiaNav =
        (await this.page.locator('text=/Add\\s+AIA\\s+Visit/i').count().catch(() => 0)) > 0 ||
        (await this.page.locator('text=/AIA\\s+Visit/i').count().catch(() => 0)) > 0;
      const alreadyOnSearchForm =
        hasAiaNav &&
        (((await this.page.locator('text=/NRIC.*FIN.*Member/i').count().catch(() => 0)) > 0) ||
          ((await this.page.locator('text=/Search using full NRIC/i').count().catch(() => 0)) > 0));
      
      if (alreadyOnSearchForm) {
        logger.info('Already on AIA search form, skipping search icon click');
      } else {
        // Step 2: Click search icon (#ctr_block > div:nth-child(2) > img) to open search popup
        this._logStep('Click search icon for NRIC lookup');
        const searchIconSelectors = [
          '#ctr_block > div:nth-child(2) > img',
          '#ctr_block img',
          'img[src*="search"]',
          'img[alt*="search" i]',
          'img[onclick*="search" i]',
        ];
        
        let clickedSearchIcon = false;
        for (const selector of searchIconSelectors) {
          try {
            const icon = this.page.locator(selector).first();
            if ((await icon.count().catch(() => 0)) > 0) {
              await this._safeClick(icon, 'Search icon');
              await this.page.waitForTimeout(500);
              clickedSearchIcon = true;
              break;
            }
          } catch {
            continue;
          }
        }
        
        if (!clickedSearchIcon) {
          logger.warn('Could not find search icon, continuing anyway');
        }
      }
      
      // Step 3: Enter NRIC in search field
      // The form shows: "NRIC/FIN/Member ID" label with input field next to it
      this._logStep('Enter NRIC in AIA search', { nric });
      await this.page.waitForTimeout(400);
      await this.page.screenshot({ path: 'screenshots/mhc-asia-aia-before-nric.png' }).catch(() => {});
      
      // The NRIC input is in a form next to the label "NRIC/FIN/Member ID"
      // Try multiple approaches to find it
      const nricInputSelectors = [
        // By label relationship
        'input[name*="nric" i]',
        'input[name*="memberid" i]',
        'input[name*="member" i]',
        'input[id*="nric" i]',
        'input[id*="member" i]',
        // The second text input on the form (after Visit Date)
        'input[type="text"]:nth-of-type(2)',
        // Any visible text input that's not a date
        'td:has-text("NRIC/FIN/Member ID") + td input',
        'tr:has-text("NRIC/FIN/Member") input[type="text"]',
        // Generic visible text inputs (skip the first which is date)
        'input.form-control[type="text"]',
      ];
      const isDateLikeInput = async (input) => {
        try {
          const name = ((await input.getAttribute('name').catch(() => '')) || '').toLowerCase();
          const id = ((await input.getAttribute('id').catch(() => '')) || '').toLowerCase();
          const ph = ((await input.getAttribute('placeholder').catch(() => '')) || '').toLowerCase();
          const aria = ((await input.getAttribute('aria-label').catch(() => '')) || '').toLowerCase();
          const rowText = await input
            .evaluate((el) => (el.closest('tr')?.innerText || el.closest('tr')?.textContent || ''))
            .catch(() => '');
          const rowLower = String(rowText || '').toLowerCase();
          if (/visit\s*date|date|dd\s*\/\s*mm|mm\s*\/\s*dd|yyyy/.test(`${name} ${id} ${ph} ${aria}`)) return true;
          if (/visit\s*date/.test(rowLower)) return true;
          const value = (await input.inputValue().catch(() => '')) || '';
          return /\d{1,2}\/\d{1,2}\/\d{2,4}/.test(value);
        } catch {
          return false;
        }
      };
      
      let nricFilled = false;
      for (const selector of nricInputSelectors) {
        try {
          const input = this.page.locator(selector).first();
          if ((await input.count().catch(() => 0)) > 0 && await input.isVisible().catch(() => false)) {
            if (await isDateLikeInput(input)) continue; // Skip date field
            await input.fill(nric);
            await this.page.waitForTimeout(300);
            nricFilled = true;
            logger.info('NRIC entered in AIA search');
            break;
          }
        } catch {
          continue;
        }
      }
      
      // If still not found, try to find all visible text inputs and pick the right one
      if (!nricFilled) {
        try {
          const allInputs = this.page.locator('input[type="text"]:visible');
          const count = await allInputs.count();
          logger.info(`Found ${count} visible text inputs`);
          for (let i = 0; i < count; i++) {
            const input = allInputs.nth(i);
            if (await isDateLikeInput(input)) continue;
            // This should be the NRIC field
            await input.fill(nric);
            await this.page.waitForTimeout(300);
            nricFilled = true;
            logger.info(`NRIC entered in input #${i}`);
            break;
          }
        } catch (e) {
          logger.warn('Failed to iterate inputs:', e.message);
        }
      }
      
      if (!nricFilled) {
        logger.warn('Could not find NRIC input field');
        await this.page.screenshot({ path: 'screenshots/mhc-asia-aia-nric-input-not-found.png' }).catch(() => {});
        return false;
      }
      
      // Press Enter or click Search button
      const searchBtnSelectors = [
        'input[type="submit"]',
        'button[type="submit"]',
        'input[value*="Search" i]',
        'button:has-text("Search")',
      ];
      
      let searchTriggered = false;
      for (const selector of searchBtnSelectors) {
        try {
          const btn = this.page.locator(selector).first();
          if ((await btn.count().catch(() => 0)) > 0 && await btn.isVisible().catch(() => false)) {
            await this._safeClick(btn, 'Search button');
            searchTriggered = true;
            break;
          }
        } catch {
          continue;
        }
      }
      
      if (!searchTriggered) {
        // Try pressing Enter
        await this.page.keyboard.press('Enter');
      }
      
      await this.page.waitForTimeout(400);
      await this.page.screenshot({ path: 'screenshots/mhc-asia-aia-search-results.png' }).catch(() => {});
      
      // Step 4: Click patient name from results
      this._logStep('Click patient from AIA search results');
      
      // Look for patient link/row in results
      const patientSelectors = [
        // Prefer clickable links inside the matching result row.
        `tr:has-text("${nric}") a`,
        `a:has-text("${nric}")`,
        // Fallback: first result row link.
        'table tr:nth-child(2) a',
        '.search-result a',
        'a[href*="EmpVisitAdd" i]',
        'a[href*="VisitAdd" i]',
        'a[href*="patient" i]',
      ];
      
      for (const selector of patientSelectors) {
        try {
          const patientLink = this.page.locator(selector).first();
          if ((await patientLink.count().catch(() => 0)) > 0) {
            const beforeUrl = this.page.url();
            const popupPromise = this.page.context().waitForEvent('page', { timeout: 1500 }).catch(() => null);
            await this._safeClick(patientLink, 'Patient in AIA results');
            const popup = await popupPromise;
            if (popup) {
              await popup.waitForLoadState('domcontentloaded').catch(() => {});
              this.page = popup;
              this.setupDialogHandler({ reset: false });
              await this.page.bringToFront().catch(() => {});
            }
            // Wait for the visit-add form to appear.
            await Promise.race([
              this.page.waitForURL(/EmpVisitAdd|VisitAdd|Employee.*Visit.*Add/i, { timeout: 8000 }).catch(() => {}),
              this.page.locator('text=/Employee\\s+Visit\\s*-\\s*Add/i').first().waitFor({ timeout: 8000 }).catch(() => {}),
              this.page.locator('tr:has-text("Charge Type")').first().waitFor({ timeout: 8000 }).catch(() => {}),
            ]);
            await this.page.waitForTimeout(300);
            await this.page.bringToFront().catch(() => {});
            logger.info('Selected patient from AIA search results');
            this._logStep('Patient selected from AIA results', { from: beforeUrl, to: this.page.url() });
            await this.page.screenshot({ path: 'screenshots/mhc-asia-aia-patient-selected.png' }).catch(() => {});

            const isVisitForm = await (async () => {
              const urlNow = this.page.url();
              if (/PatientSearch/i.test(urlNow)) return false;
              if (/EmpVisitAdd|VisitAdd/i.test(urlNow)) return true;
              if ((await this.page.locator('text=/Employee\\s+Visit\\s*-\\s*Add/i').count().catch(() => 0)) > 0)
                return true;
              if ((await this.page.locator('text=/Consultation\\s+Fee/i').count().catch(() => 0)) > 0) return true;
              if ((await this.page.locator('text=/Drug\\s+Name/i').count().catch(() => 0)) > 0) return true;
              if ((await this.page.locator('text=/Charge\\s*Type/i').count().catch(() => 0)) > 0) return true;
              return false;
            })();
            if (!isVisitForm) {
              await this.page.screenshot({ path: 'screenshots/mhc-asia-aia-visit-form-missing.png', fullPage: true }).catch(() => {});
              logger.warn('AIA patient selected but visit form not detected');
              // Attempt direct navigation via EmpVisitAdd href in the matching row.
              const directHref = await this.page
                .evaluate((needle) => {
                  const lowerNeedle = String(needle || '').trim().toLowerCase();
                  const rows = Array.from(document.querySelectorAll('tr'));
                  let candidate = null;
                  for (const row of rows) {
                    const text = (row.innerText || '').toLowerCase();
                    if (lowerNeedle && !text.includes(lowerNeedle)) continue;
                    const link =
                      row.querySelector('a[href*="EmpVisitAdd" i]') ||
                      row.querySelector('a[href*="VisitAdd" i]');
                    if (link) {
                      candidate = link.getAttribute('href') || link.href;
                      break;
                    }
                  }
                  if (!candidate) {
                    const any =
                      document.querySelector('a[href*="EmpVisitAdd" i]') ||
                      document.querySelector('a[href*="VisitAdd" i]');
                    candidate = any ? any.getAttribute('href') || any.href : null;
                  }
                  return candidate;
                }, nric)
                .catch(() => null);
              if (directHref) {
                await this.page.goto(directHref, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
                await this.page.waitForTimeout(300);
                const formOk =
                  (await this.page.locator('text=/Consultation\\s+Fee/i').count().catch(() => 0)) > 0 ||
                  (await this.page.locator('text=/Drug\\s+Name/i').count().catch(() => 0)) > 0;
                if (formOk) return true;
              }
              // Occasionally the portal bounces to the AIA home page; retry once.
              const currentUrl = this.page.url();
              if (/aiaclinic\.com\/?$/.test(currentUrl) && retryCount < 1) {
                logger.warn('AIA redirected to home after patient click; retrying Add AIA Visit flow once');
                const retryOk = await this.navigateToAIAVisitAndSearch(nric, { retryCount: retryCount + 1 }).catch(() => false);
                return retryOk;
              }
              return false;
            }

            // If we did not navigate away, try clicking the patient *name* link in the same row explicitly.
            if (this.page.url() === beforeUrl) {
              const rowLink = this.page.locator(`tr:has-text("${nric}") a`).first();
              if ((await rowLink.count().catch(() => 0)) > 0) {
                await this._safeClick(rowLink, 'Patient name link (AIA row)');
                await Promise.race([
                  this.page.waitForURL(/EmpVisitAdd|VisitAdd|Employee.*Visit.*Add/i, { timeout: 8000 }).catch(() => {}),
                  this.page.locator('tr:has-text("Charge Type")').first().waitFor({ timeout: 8000 }).catch(() => {}),
                ]);
                await this.page.waitForTimeout(300);
              }
            }
            return true;
          }
        } catch {
          continue;
        }
      }
      
      logger.warn('Could not find patient in AIA search results');
      return false;
    } catch (error) {
      logger.error('Failed to navigate to AIA Visit:', error);
      return false;
    }
  }

  /**
   * Navigate to Singlife (ex-Aviva) "Add Normal Visit" search and open the visit form by NRIC.
   *
   * Singlife runs under a different UI (pcpcare) where the left-nav contains "Add Normal Visit"
   * that leads to "Singlife IEC Patient Search". From there, you must:
   * 1) set Visit Date
   * 2) search by NRIC
   * 3) open the patient (or the visit form is shown directly)
   *
   * @param {string} nric
   * @param {string|null} visitDateDdMmYyyy e.g. "30/01/2026" (optional; best-effort)
   * @returns {Promise<boolean>}
   */
  async navigateToSinglifeNormalVisitAndSearch(nric, visitDateDdMmYyyy = null) {
    try {
      this._logStep('Navigate: Singlife Add Normal Visit', { nric });

      const isMhcMemberCardsGate = async () => {
        // MHC (not Singlife) sometimes shows a "member cards" selection tile page.
        return this.page
          .locator('text=/member\\s+cards\\s+below\\s+to\\s+proceed/i')
          .first()
          .isVisible()
          .catch(() => false);
      };

      const isVisitDateInvalidError = async () => {
        // Singlife/pcpcare hard-errors when the visit date isn't set before opening the visit form.
        const hasUnexpected = await this.page
          .locator('text=/System\\s+has\\s+encountered\\s+an\\s+unexpected\\s+error/i')
          .first()
          .isVisible()
          .catch(() => false);
        const hasVisitDateInvalid = await this.page.locator('text=/Visit\\s+date\\s+invalid/i').first().isVisible().catch(() => false);
        return hasUnexpected && hasVisitDateInvalid;
      };

      const isInSinglifeContext = async () => {
        const url = this.page.url();
        if (/pcpcare\.com\//i.test(url)) return true;
        // Heuristic signals: Singlife brand and/or left nav items only present in Singlife PCP.
        const hasBrand = await this.page.locator('text=/\\bSinglife\\b/i').first().isVisible().catch(() => false);
        const hasAddNormal = (await this.page.locator('a:has-text("Add Normal Visit")').count().catch(() => 0)) > 0;
        return hasBrand || hasAddNormal;
      };

      const gotoSinglifePatientSearch = async () => {
        // Direct navigation is more reliable than relying on the left-nav being present in every state.
        const url = 'https://www.pcpcare.com/pcpcare/ClinicIECAvivaPatientSearch.ec';
        await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
        await this.page.waitForTimeout(700);
      };

      // Ensure we are in Singlife PCP context (Aviva flow). This is required before we can see "Add Normal Visit".
      if (!(await isInSinglifeContext())) {
        // If we're on the MHC portal, switch system first; otherwise, fall back to direct navigation.
        await this.switchToSinglifeIfNeeded({ force: true }).catch(() => false);
        await this.page.waitForLoadState('domcontentloaded').catch(() => {});
        await this.page.waitForTimeout(800);
        if (!(await isInSinglifeContext())) {
          await gotoSinglifePatientSearch();
        }
      }

      // If Singlife PCP login is required, try to satisfy it first (best-effort).
      const pcpOk = await this.loginSinglifePcpIfNeeded();
      if (!pcpOk) {
        await this.page.screenshot({ path: 'screenshots/mhc-asia-singlife-pcp-login-required.png', fullPage: true }).catch(() => {});
        return false;
      }

      const isAnnouncement = async () => {
        const url = this.page.url();
        if (/ClinicAnnouncement\.ec/i.test(url)) return true;
        // Avoid false positives from left-nav items like "Announcement".
        const hasImportantNotice = await this.page
          .locator('text=/Important\\s+Notice\\s*-/i')
          .first()
          .isVisible()
          .catch(() => false);
        const hasMarkAsRead = await this.page
          .locator('text=/Mark\\s*As\\s*Read/i')
          .first()
          .isVisible()
          .catch(() => false);
        return hasImportantNotice || hasMarkAsRead;
      };

      // Per clinic workflow: no need to acknowledge announcements. Treat it as a normal landing page.
      const handleAnnouncement = async () => {
        if (!(await isAnnouncement())) return false;
        this._logStep('Singlife: announcement page (no action required)');
        await this.page.screenshot({ path: 'screenshots/mhc-asia-singlife-announcement.png', fullPage: true }).catch(() => {});
        return true;
      };

      const isVisitForm = async () => {
        // Strong signals only.
        const hasChargeType = (await this.page.locator('text=/Charge\\s*Type/i').count().catch(() => 0)) > 0;
        const hasCompute = (await this.page.locator('button:has-text("Compute"), button:has-text("Compute claim"), input[value*="Compute" i]').count().catch(() => 0)) > 0;
        const hasSaveDraft = (await this.page.locator('button:has-text("Save As Draft"), input[value*="Save As Draft" i]').count().catch(() => 0)) > 0;
        const hasEmployeeVisitHeader = (await this.page.locator('text=/Employee\\s+Visit\\s*-\\s*Add/i').count().catch(() => 0)) > 0;
        return hasEmployeeVisitHeader || (hasChargeType && (hasCompute || hasSaveDraft));
      };

      // Some sessions bounce you to an Announcement page before continuing. We'll allow a few retries.
      for (let attempt = 1; attempt <= 3; attempt++) {
        this._logStep('Singlife: open patient search (attempt)', { attempt });

        // Guard rails: if we landed in the wrong system, force back into Singlife PCP.
        if (await isMhcMemberCardsGate()) {
          this._logStep('Singlife: detected MHC member-cards gate; switching back to Singlife PCP');
          await this.switchToSinglifeIfNeeded({ force: true }).catch(() => false);
          await this.page.waitForTimeout(800);
          await gotoSinglifePatientSearch();
        }

        // Guard rails: if Singlife threw "Visit date invalid", restart from patient search and set the date again.
        if (await isVisitDateInvalidError()) {
          this._logStep('Singlife: visit date invalid error page; restarting patient search');
          await this.page.screenshot({ path: 'screenshots/mhc-asia-singlife-visit-date-invalid.png', fullPage: true }).catch(() => {});
          await gotoSinglifePatientSearch();
        }

        // Landing page can be announcements; proceed directly via left-nav.
        await handleAnnouncement();

        // If we aren't already on the patient search page, try to reach it via left-nav.
        // Click "Add Normal Visit" in Singlife left-nav.
        const addNormalSelectors = [
          'a:has-text("Add Normal Visit")',
          'text=/Add\\s+Normal\\s+Visit/i',
          'a[href*="ClinicIECAvivaPatientSearch" i]',
        ];

        let clicked = false;
        let addNormalHref = null;
        for (const selector of addNormalSelectors) {
          const loc = this.page.locator(selector).first();
          if ((await loc.count().catch(() => 0)) === 0) continue;
          if (!(await loc.isVisible().catch(() => true))) continue;
          addNormalHref = await loc.getAttribute('href').catch(() => null);
          await this._safeClick(loc, 'Add Normal Visit (Singlife)');
          clicked = true;
          break;
        }

        if (!clicked) {
          // Fallback: direct navigation to the patient search page.
          await this.page
            .screenshot({ path: 'screenshots/mhc-asia-singlife-add-normal-visit-not-found.png', fullPage: true })
            .catch(() => {});
          await gotoSinglifePatientSearch();
        }

        await this.page.waitForLoadState('domcontentloaded').catch(() => {});
        await this.page.waitForTimeout(600);

        // If we somehow got bounced to the pcpcare root, try to navigate via the captured href.
        if (this.page.url() === 'https://www.pcpcare.com/' && addNormalHref) {
          try {
            const nextUrl = new URL(addNormalHref, 'https://www.pcpcare.com/pcpcare/').toString();
            logger.info('Singlife: navigating to Add Normal Visit via href', { nextUrl });
            await this.page.goto(nextUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
            await this.page.waitForTimeout(600);
          } catch {
            // ignore
          }
        }

        // Best-effort: fill visit date on Singlife IEC Patient Search.
        if (visitDateDdMmYyyy && /^\d{2}\/\d{2}\/\d{4}$/.test(visitDateDdMmYyyy)) {
          const dateCandidates = [
            this.page.locator('input[name="visitDateAsString"], #visitDateAsString'),
            this.page.locator('input[name="visitDate"], #visitDate'),
            this.page.locator('tr:has-text("Visit Date") input:not([type="hidden"])'),
          ];
          let dateField = dateCandidates[0].first();
          for (const c of dateCandidates) {
            const f = c.first();
            if ((await f.count().catch(() => 0)) > 0 && (await f.isVisible().catch(() => true))) {
              dateField = f;
              break;
            }
          }
          if ((await dateField.count().catch(() => 0)) > 0) {
            await dateField.fill(visitDateDdMmYyyy).catch(async () => {
              await dateField
                .evaluate((el, v) => {
                  try {
                    el.value = v;
                    el.dispatchEvent(new Event('input', { bubbles: true }));
                    el.dispatchEvent(new Event('change', { bubbles: true }));
                  } catch {
                    // ignore
                  }
                }, visitDateDdMmYyyy)
                .catch(() => {});
            });
            await this.page.waitForTimeout(150);
            const v = await dateField.inputValue().catch(() => '');
            if (v !== visitDateDdMmYyyy) {
              // Last attempt: click + type
              await dateField.click({ force: true }).catch(() => {});
              await this.page.keyboard.press('Control+A').catch(() => {});
              await this.page.keyboard.type(visitDateDdMmYyyy, { delay: 15 }).catch(() => {});
              await this.page.waitForTimeout(150);
            }
          }
        }

        // Fill NRIC and search.
        const pickVisibleNonDateInput = async (loc) => {
          try {
            const count = await loc.count().catch(() => 0);
            for (let i = 0; i < count; i++) {
              const cand = loc.nth(i);
              if (!(await cand.isVisible().catch(() => true))) continue;
              // Skip non-fillable inputs (e.g., calendar "Select" buttons).
              const type = (((await cand.getAttribute('type').catch(() => null)) || 'text') + '').toLowerCase();
              if (['button', 'submit', 'reset', 'image', 'hidden', 'checkbox', 'radio', 'file'].includes(type)) continue;
              const editable = await cand.isEditable().catch(() => true);
              if (!editable) continue;
              const name = ((await cand.getAttribute('name').catch(() => '')) || '').toLowerCase();
              const id = ((await cand.getAttribute('id').catch(() => '')) || '').toLowerCase();
              const ph = ((await cand.getAttribute('placeholder').catch(() => '')) || '').toLowerCase();
              if (name.includes('visit') || id.includes('visit') || ph.includes('dd/mm') || ph.includes('visit')) continue;
              return cand;
            }
          } catch {
            // ignore
          }
          return null;
        };

        // Singlife search page label is typically "NRIC/FIN/Member ID".
        const memberIdCandidates = [
          this.page.locator('tr:has-text("NRIC/FIN/Member ID") input[type="text"], tr:has-text("NRIC/FIN/Member ID") input:not([type])'),
          this.page.locator('tr:has-text("NRIC/FIN/Member") input[type="text"], tr:has-text("NRIC/FIN/Member") input:not([type])'),
          this.page.locator('xpath=//*[self::td or self::th or self::label][contains(normalize-space(.), \"NRIC/FIN/Member ID\")]/following::input[1]'),
          this.page.locator('xpath=//*[self::td or self::th or self::label][contains(normalize-space(.), \"NRIC\") and contains(normalize-space(.), \"Member\")]/following::input[1]'),
          // Last-resort: attribute heuristics (exclude visit-date-ish inputs via pickVisibleNonDateInput)
          this.page.locator(
            'input[name*="nric" i], input[id*="nric" i], input[placeholder*="nric" i], input[name*="member" i], input[id*="member" i], input[placeholder*="member" i]'
          ),
        ];

        let nricField = null;
        for (const loc of memberIdCandidates) {
          nricField = await pickVisibleNonDateInput(loc);
          if (nricField) break;
        }

        if (!nricField) {
          await this.page
            .screenshot({ path: 'screenshots/mhc-asia-singlife-nric-field-not-found.png', fullPage: true })
            .catch(() => {});
          return false;
        }

        // Avoid long auto-waits on flaky fields: bounded fill with JS fallback.
        let nricFilled = false;
        try {
          await nricField.fill(nric, { timeout: 2000 });
          nricFilled = true;
        } catch {
          // fallback below
        }
        if (!nricFilled) {
          await nricField
            .evaluate((el, v) => {
              try {
                el.value = v;
                el.dispatchEvent(new Event('input', { bubbles: true }));
                el.dispatchEvent(new Event('change', { bubbles: true }));
              } catch {
                // ignore
              }
            }, nric)
            .catch(() => {});
          const check = await nricField.inputValue().catch(() => '');
          if (String(check || '').trim().toUpperCase() === String(nric || '').trim().toUpperCase()) {
            nricFilled = true;
          }
        }
        this._logStep('Singlife: NRIC field fill', { ok: nricFilled, nric });
        if (!nricFilled) {
          logger.warn('Singlife: NRIC fill may be incomplete', { nric });
        }
        await this.page.waitForTimeout(100);

        const searchBtn = this.page
          .locator(
            [
              'input[type="submit"][name="SearchMemIdAction"]',
              'input[type="submit"][value*="Search" i]',
              'button:has-text("Search")',
              'a:has-text("Search")',
            ].join(', ')
          )
          .first();
        if ((await searchBtn.count().catch(() => 0)) > 0) {
          await this._safeClick(searchBtn, 'Singlife: Search');
        } else {
          await nricField.press('Enter').catch(() => {});
        }

        await this.page.waitForLoadState('domcontentloaded').catch(() => {});
        await this.page.waitForTimeout(800);
        await this.page
          .screenshot({ path: 'screenshots/mhc-asia-singlife-search-results.png', fullPage: true })
          .catch(() => {});

        // IMPORTANT: the Singlife search page contains "Visit Date", so use strong signals only.
        if (await isVisitForm()) {
          await this.page
            .screenshot({ path: 'screenshots/mhc-asia-singlife-visit-form.png', fullPage: true })
            .catch(() => {});
          return true;
        }

        // Otherwise, click the patient link. The link we want typically targets:
        // - ClinicIECAvivaEmpVisitAdd.ec?...&memberICNo=<NRIC>...
        // Avoid selecting the left-nav "Announcement" link (which can also match broad row filters).
        let patientLink = this.page.locator(`a[href*="ClinicIECAvivaEmpVisitAdd"][href*="memberICNo=${nric}"]`).first();
        let hasPatientLink = (await patientLink.count().catch(() => 0)) > 0;
        if (!hasPatientLink) {
          // Fallback: click the first link in the result row containing the NRIC.
          const row = this.page.locator('tr').filter({ hasText: nric }).first();
          const linkInRow = row.locator('a').first();
          if ((await linkInRow.count().catch(() => 0)) > 0) {
            patientLink = linkInRow;
            hasPatientLink = true;
          }
        }

        if (!hasPatientLink) {
          await this.page
            .screenshot({ path: 'screenshots/mhc-asia-singlife-no-patient-link.png', fullPage: true })
            .catch(() => {});
          if (attempt < 3) continue;
          return false;
        }

        const beforeUrl = this.page.url();
        {
          const href = await patientLink.getAttribute('href').catch(() => null);
          const resolvedHref = href ? new URL(href, beforeUrl).toString() : null;

          // Some Singlife pages open the visit form in a new tab/window. Handle both navigation and popup.
          const popupPromise = this.page.waitForEvent('popup', { timeout: 8000 }).catch(() => null);
          const navPromise = this.page
            .waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 8000 })
            .catch(() => null);

          await this._safeClick(patientLink, 'Singlife: patient link');

          const popup = await popupPromise;
          if (popup) {
            await popup.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => {});
            this.page = popup;
            logger.info('Singlife: visit opened in popup tab', { from: beforeUrl, to: popup.url() });
          } else {
            await navPromise;
            logger.info('Singlife: patient click navigation check', { from: beforeUrl, to: this.page.url() });
          }

          // If the patient click redirects back to ClinicAnnouncement, try a direct navigation to the visit href.
          if (/ClinicAnnouncement\.ec/i.test(this.page.url()) && resolvedHref) {
            this._logStep('Singlife: redirected to announcement after patient click; trying direct visit URL', { resolvedHref });
            await this.page.goto(resolvedHref, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
            await this.page.waitForTimeout(800);
          }
        }

        await this.page.waitForLoadState('domcontentloaded').catch(() => {});
        await this.page.waitForTimeout(800);

        // If we bounced to an announcement after clicking the patient, a common portal behavior is:
        // first click -> Announcement, then going back and clicking the patient again proceeds to the visit form.
        // Try that before retrying the whole flow.
        if (await handleAnnouncement()) {
          try {
            const announcementUrl = this.page.url();
            // Instead of goBack() (which can land on chrome-error://), explicitly return to the
            // previous search results URL.
            await this.page.goto(beforeUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => null);
            await this.page.waitForTimeout(700);
            logger.info('Singlife: returned to search results after announcement', {
              announcementUrl,
              searchResultsUrl: beforeUrl,
              now: this.page.url(),
            });

            // Re-click patient link from the results again.
            const row2 = this.page.locator('tr').filter({ hasText: nric }).first();
            const link2 = row2.locator('a').first();
            if ((await link2.count().catch(() => 0)) > 0) {
              const popupPromise2 = this.page.waitForEvent('popup', { timeout: 8000 }).catch(() => null);
              const navPromise2 = this.page
                .waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 8000 })
                .catch(() => null);
              await this._safeClick(link2, 'Singlife: patient link (retry after announcement)');

              const popup2 = await popupPromise2;
              if (popup2) {
                await popup2.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => {});
                this.page = popup2;
              } else {
                await navPromise2;
              }

              await this.page.waitForTimeout(800);
              if (!(await handleAnnouncement()) && (await isVisitForm())) {
                await this.page
                  .screenshot({ path: 'screenshots/mhc-asia-singlife-visit-form.png', fullPage: true })
                  .catch(() => {});
                return true;
              }
            }
          } catch (e) {
            logger.warn('Singlife: back+retry after announcement failed', { error: e.message });
          }

          if (attempt < 3) continue;
          return false;
        }

        // If we bounced to Singlife PCP login, attempt login and retry once.
        const pcpOkAfter = await this.loginSinglifePcpIfNeeded();
        if (!pcpOkAfter) {
          await this.page
            .screenshot({ path: 'screenshots/mhc-asia-singlife-pcp-login-required-after-click.png', fullPage: true })
            .catch(() => {});
          if (attempt < 3) continue;
          return false;
        }

        const inVisitNow = await isVisitForm();
        await this.page
          .screenshot({
            path: inVisitNow
              ? 'screenshots/mhc-asia-singlife-visit-form.png'
              : 'screenshots/mhc-asia-singlife-after-patient-click.png',
            fullPage: true,
          })
          .catch(() => {});
        if (inVisitNow) return true;
      }

      return false;
    } catch (error) {
      logger.error('Failed Singlife Add Normal Visit search:', error);
      await this.page.screenshot({ path: 'screenshots/mhc-asia-singlife-search-error.png', fullPage: true }).catch(() => {});
      return false;
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
   * Best-effort: tick/untick "Waiver of Referral" style checkbox when present.
   * Some first-consult flows trigger blocking alerts unless waiver is checked.
   */
  async setWaiverOfReferral(checked = true) {
    try {
      this._logStep('Set waiver of referral', { checked });
      const selectors = [
        'input[type="checkbox"][name*="waiver" i]',
        'input[type="checkbox"][id*="waiver" i]',
        'tr:has-text("Waiver") input[type="checkbox"]',
        'tr:has-text("Referral") input[type="checkbox"]',
      ];

      for (const selector of selectors) {
        const box = this.page.locator(selector).first();
        if ((await box.count().catch(() => 0)) === 0) continue;
        const visible = await box.isVisible().catch(() => true);
        if (!visible) continue;
        const isChecked = await box.isChecked().catch(() => false);
        if (checked && !isChecked) {
          await box.check({ force: true }).catch(() => {});
          await this.page.waitForTimeout(200);
          return true;
        }
        if (!checked && isChecked) {
          await box.uncheck({ force: true }).catch(() => {});
          await this.page.waitForTimeout(200);
          return true;
        }
        return true;
      }
      return false;
    } catch (error) {
      logger.warn('Failed to set waiver of referral (non-fatal)', { error: error.message });
      return false;
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
      await this.computeClaim().catch(() => false);

      // Only click buttons that explicitly indicate DRAFT (never generic "Save" to avoid risky actions).
      const saveDraftLocators = [
        // Explicit <input value="Save As Draft"> (common on MHC/Singlife)
        this.page.locator('input[value*="save as draft" i], input[value*="save a draft" i], input[value*="save draft" i]').first(),
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
          const valueAttr = ((await locator.getAttribute('value').catch(() => '')) || '').toLowerCase();
          const combined = `${text} ${ariaLabel} ${valueAttr}`;
          if (
            !combined.includes('draft') ||
            combined.includes('submit')
          ) {
            continue;
          }

          const dialogMsg = await clickWithDialogCapture(locator, 'Save As Draft');
          // Avoid networkidle (MHC keeps background connections open)
          await this.page.waitForLoadState('domcontentloaded').catch(() => {});
          await this.page.waitForTimeout(500);

          await this.page.screenshot({ path: 'screenshots/mhc-asia-draft-saved.png', fullPage: true }).catch(() => {});
          if (dialogMsg && /must\s+compute\s+claim/i.test(dialogMsg)) {
            logger.warn('Draft save blocked: portal requires Compute claim first (already attempted).');
            return false;
          }
          if (dialogMsg && /valid\s+amount\s+for\s+procedure|please\s+select\s+procedure\s+first/i.test(dialogMsg)) {
            logger.warn(`Draft save blocked by procedure validation; clearing procedure rows and retrying once: ${dialogMsg}`);
            await this.clearProcedureRows(3).catch(() => {});
            await this.page.waitForTimeout(300);
            const retryDialog = await clickWithDialogCapture(locator, 'Save As Draft (retry after clearing procedures)');
            await this.page.waitForLoadState('domcontentloaded').catch(() => {});
            await this.page.waitForTimeout(400);
            if (
              retryDialog &&
              /(please\s+enter|valid\s+amount|required|invalid|cannot|failed|error)/i.test(retryDialog) &&
              !/are\s+you\s+sure|confirm/i.test(retryDialog)
            ) {
              logger.warn(`Draft retry still blocked: ${retryDialog}`);
              await this.page
                .screenshot({ path: 'screenshots/mhc-asia-draft-save-validation-error.png', fullPage: true })
                .catch(() => {});
              return false;
            }
            logger.info('Claim saved as draft after clearing invalid procedure rows');
            return true;
          }
          if (
            dialogMsg &&
            /(please\s+enter|valid\s+amount|required|invalid|cannot|failed|error)/i.test(dialogMsg) &&
            !/are\s+you\s+sure|confirm/i.test(dialogMsg)
          ) {
            logger.warn(`Draft save blocked by validation dialog: ${dialogMsg}`);
            await this.page.screenshot({ path: 'screenshots/mhc-asia-draft-save-validation-error.png', fullPage: true }).catch(() => {});
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
   * Clear procedure rows to avoid portal validation when procedure selection is not valid.
   */
  async clearProcedureRows(maxRows = 3) {
    const cleared = await this.page
      .evaluate(({ maxRows }) => {
        const norm = (s) => (s || '').toString().replace(/\s+/g, ' ').trim().toLowerCase();
        const isVisible = (el) => {
          if (!el) return false;
          const style = window.getComputedStyle(el);
          if (!style) return false;
          if (style.display === 'none' || style.visibility === 'hidden') return false;
          const r = el.getBoundingClientRect();
          return !!r && r.width > 0 && r.height > 0;
        };
        const setValue = (el, v) => {
          if (!el) return;
          try {
            el.readOnly = false;
            el.disabled = false;
            el.removeAttribute && el.removeAttribute('readonly');
            el.removeAttribute && el.removeAttribute('disabled');
          } catch {
            // ignore
          }
          const tag = (el.tagName || '').toLowerCase();
          if (tag === 'select') {
            const opts = Array.from(el.querySelectorAll('option'));
            if (opts.length) el.value = opts[0].value;
          } else {
            el.value = v;
          }
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        };
        const isTextLike = (el) => {
          if (!el) return false;
          const tag = (el.tagName || '').toLowerCase();
          if (tag === 'select' || tag === 'textarea') return true;
          const t = String(el.getAttribute('type') || '').toLowerCase();
          return !t || t === 'text' || t === 'number' || t === 'tel';
        };
        const clearRowInputs = (row) => {
          if (!row) return 0;
          const inputs = Array.from(
            row.querySelectorAll('input[type="text"], input[type="number"], input[type="tel"], input:not([type]), select, textarea')
          ).filter((el) => isVisible(el) && isTextLike(el));
          if (!inputs.length) return 0;
          for (const inp of inputs) setValue(inp, '');
          return 1;
        };

        let totalCleared = 0;
        const tables = Array.from(document.querySelectorAll('table')).filter((t) =>
          /procedure\s*name/i.test(norm(t.innerText || t.textContent || ''))
        );
        if (tables.length) {
          const table = tables
            .map((t) => ({ t, score: /total\s+proc\s+fee/i.test(norm(t.innerText || t.textContent || '')) ? 1 : 0 }))
            .sort((a, b) => b.score - a.score)[0].t;
          const rows = Array.from(table.querySelectorAll('tr')).filter((r) => r.closest('table') === table);
          const headerIdx = rows.findIndex((r) => /procedure\s*name/i.test(norm(r.innerText || r.textContent || '')));
          if (headerIdx >= 0) {
            for (let i = headerIdx + 1; i < rows.length && totalCleared < maxRows; i++) {
              const row = rows[i];
              const txt = norm(row.innerText || row.textContent || '');
              if (/total\s+proc\s+fee|total\s+procedure/.test(txt)) break;
              if (/more\s+procedure/.test(txt)) continue;
              totalCleared += clearRowInputs(row);
            }
          }
        }

        // Fallback 1: clear rows where a procedure-like input currently has a value.
        if (totalCleared < maxRows) {
          const allRows = Array.from(document.querySelectorAll('tr'));
          for (const row of allRows) {
            if (totalCleared >= maxRows) break;
            const rowText = norm(row.innerText || row.textContent || '');
            if (!rowText || /total\s+proc\s+fee|total\s+before\s+gst|copayment|cash\s+collected|gst/.test(rowText)) continue;
            const rowInputs = Array.from(
              row.querySelectorAll('input[type="text"], input[type="number"], input[type="tel"], input:not([type]), select, textarea')
            ).filter((el) => isVisible(el) && isTextLike(el));
            if (!rowInputs.length) continue;
            const hasProcedureLikeValue = rowInputs.some((el) => {
              const idn = `${el.getAttribute('name') || ''} ${el.getAttribute('id') || ''} ${el.className || ''}`.toLowerCase();
              if (!/proc|procedure|claim/.test(idn)) return false;
              return !!String(el.value || '').trim();
            });
            if (!hasProcedureLikeValue) continue;
            totalCleared += clearRowInputs(row);
          }
        }

        // Fallback 2: geometry band between "Procedure Name" header and "Total Proc Fee".
        if (totalCleared < maxRows) {
          const labels = Array.from(document.querySelectorAll('th, td, div, span, label, b, strong'));
          const procHeader = labels.find((el) => /procedure\s*name/i.test(norm(el.textContent || ''))) || null;
          const totalProc = labels.find((el) => /total\s+proc\s+fee/i.test(norm(el.textContent || ''))) || null;
          if (procHeader) {
            const top = procHeader.getBoundingClientRect().bottom + 2;
            const bottom = totalProc ? totalProc.getBoundingClientRect().top - 2 : top + 260;

            // First try the portal's native row clear control ("C"), which also clears hidden backing fields.
            const clearButtons = Array.from(
              document.querySelectorAll('button, input[type="button"], input[type="submit"], input[type="reset"]')
            )
              .filter((el) => isVisible(el))
              .filter((el) => /^c$/i.test(norm(el.textContent || el.value || '')))
              .map((el) => ({ el, r: el.getBoundingClientRect() }))
              .filter(({ r }) => r.top >= top && r.bottom <= bottom)
              .sort((a, b) => (a.r.top - b.r.top) || (a.r.left - b.r.left));
            for (const { el } of clearButtons) {
              if (totalCleared >= maxRows) break;
              try {
                el.click();
                totalCleared++;
              } catch {
                // ignore
              }
            }

            const textLikes = Array.from(
              document.querySelectorAll('input[type="text"], input[type="number"], input[type="tel"], input:not([type]), select, textarea')
            )
              .filter((el) => isVisible(el) && isTextLike(el))
              .map((el) => ({ el, r: el.getBoundingClientRect() }))
              .filter(({ r }) => r.top >= top && r.bottom <= bottom)
              .sort((a, b) => (a.r.top - b.r.top) || (a.r.left - b.r.left));
            const rowsByY = [];
            for (const item of textLikes) {
              const bucket = rowsByY.find((g) => Math.abs(g.y - item.r.top) <= 8);
              if (bucket) bucket.items.push(item.el);
              else rowsByY.push({ y: item.r.top, items: [item.el] });
            }
            rowsByY.sort((a, b) => a.y - b.y);
            for (const g of rowsByY) {
              if (totalCleared >= maxRows) break;
              const meaningful = g.items.some((el) => !!String(el.value || '').trim());
              if (!meaningful) continue;
              for (const el of g.items) setValue(el, '');
              totalCleared++;
            }
          }
        }

        return totalCleared;
      }, { maxRows: Math.max(1, Number(maxRows || 3)) })
      .catch(() => 0);
    this._logStep('Procedure rows cleared for draft retry', { cleared });
    return cleared > 0;
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
            await this.page.waitForLoadState('domcontentloaded').catch(() => {});
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

      const normalized = String(date || '').trim();
      const isDdMmYyyy = /^\d{2}\/\d{2}\/\d{4}$/.test(normalized);
      if (!isDdMmYyyy) {
        logger.warn('Visit date not in DD/MM/YYYY format (may be rejected by portal)', { date });
        return false;
      }

      // Fast path: set Visit Date by DOM row scan once (reduces long waits on MHC search page).
      const fastOk = await this.page
        .evaluate((val) => {
          const norm = (s) => (s || '').replace(/\s+/g, ' ').trim().toLowerCase();
          const rows = Array.from(document.querySelectorAll('tr'));
          const row = rows.find((r) => /visit\s*date/i.test(norm(r.innerText || r.textContent || '')));
          if (!row) return false;
          const input =
            row.querySelector('input[type=\"text\"]') ||
            row.querySelector('input:not([type=\"hidden\"])') ||
            row.querySelector('input');
          if (!input) return false;
          input.value = val;
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
          return true;
        }, normalized)
        .catch(() => false);
      if (fastOk) {
        this._logStep('Visit date filled (fast path)', { date: normalized });
        return true;
      }

      // Visit date field selectors
      const dateSelectors = [
        'tr:has-text("Visit Date") input[type="text"]',
        'tr:has-text("Visit Date") input:not([type="hidden"])',
        'input[name*="visitDate" i]',
        'input[id*="visitDate" i]',
        'input[placeholder*="visit" i]',
        'input[placeholder*="dd/mm" i]',
        'input[type="text"][value*="/"]', // Date format
      ];

      for (const selector of dateSelectors) {
        try {
          const field = this.page.locator(selector).first();
          if ((await field.count().catch(() => 0)) === 0) continue;
          if (!(await field.isVisible().catch(() => true))) continue;

          const current = (await field.inputValue().catch(() => '')) || '';
          if (current.trim() === normalized) {
            this._logStep('Visit date already set; skipping fill', { date: normalized, selector });
            return true;
          }

          // Some date fields are readonly. Try normal fill, fall back to JS value set + events.
          await field.fill(normalized).catch(async () => {
            await field.evaluate((el, v) => {
              try {
                el.value = v;
                el.dispatchEvent(new Event('input', { bubbles: true }));
                el.dispatchEvent(new Event('change', { bubbles: true }));
              } catch {
                // ignore
              }
            }, normalized);
          });

          const v = await field.inputValue().catch(() => '');
          if (v) {
            this._logStep('Visit date filled', { date, value: v, selector });
            return true;
          }
        } catch (e) {
          continue;
        }
      }

      // If the portal already redirected to a hard error page, don't keep trying.
      const bodyText = await this.page.textContent('body').catch(() => '');
      if (/visit date invalid/i.test(bodyText) || /unexpected error/i.test(bodyText)) {
        logger.error('Portal rejected visit date and redirected to error page', { date: normalized });
        await this.page.screenshot({ path: 'screenshots/mhc-visit-date-invalid.png', fullPage: true }).catch(() => {});
        return false;
      }

      logger.warn('Visit date field not found');
      await this.page.screenshot({ path: 'screenshots/mhc-visit-date-not-found.png', fullPage: true }).catch(() => {});
      return false;
    } catch (error) {
      logger.error('Failed to fill visit date:', error);
      return false;
    }
  }

  /**
   * Enable scrolling for manual verification (best-effort).
   */
  async enablePageScroll() {
    const apply = async (frame) =>
      frame
        .evaluate(() => {
          try {
            const enable = (el) => {
              if (!el) return;
              el.style.overflow = 'auto';
              el.style.overflowY = 'auto';
              el.style.overflowX = 'auto';
              el.style.maxHeight = 'none';
              el.style.height = 'auto';
              el.style.position = 'static';
              el.style.webkitOverflowScrolling = 'touch';
            };
            enable(document.documentElement);
            enable(document.body);
            document.documentElement.style.height = 'auto';
            document.body.style.height = 'auto';
            document.documentElement.style.maxHeight = 'none';
            document.body.style.maxHeight = 'none';
            document.documentElement.style.minHeight = '100%';
            document.body.style.minHeight = '100%';
            document.documentElement.style.overflowY = 'scroll';
            document.body.style.overflowY = 'scroll';
            document.documentElement.style.scrollBehavior = 'auto';
            document.body.style.scrollBehavior = 'auto';
            document.documentElement.style.touchAction = 'auto';
            document.body.style.touchAction = 'auto';
            document.body.style.pointerEvents = 'auto';
            document.body.style.position = 'relative';
            document.documentElement.style.position = 'relative';
            // Ensure iframe/frame elements allow scrolling when they host the form content.
            const frames = Array.from(document.querySelectorAll('iframe, frame'));
            for (const fr of frames) {
              try {
                fr.setAttribute('scrolling', 'yes');
                fr.style.overflow = 'auto';
                fr.style.maxHeight = 'none';
                fr.style.height = 'auto';
              } catch {
                // ignore
              }
            }
            const commonScrollContainers = Array.from(
              document.querySelectorAll(
                '.content, .main, .container, .page, .page-content, .wrapper, .body, .layout, .panel, .form'
              )
            );
            for (const el of commonScrollContainers) {
              try {
                enable(el);
              } catch {
                // ignore
              }
            }
            const nodes = Array.from(document.querySelectorAll('*'));
            for (const el of nodes) {
              const style = window.getComputedStyle(el);
              if (!style) continue;
              if (style.overflowY === 'hidden' || style.overflowY === 'scroll') {
                if (el.scrollHeight > el.clientHeight + 20) enable(el);
              }
            }
            window.scrollTo(0, 0);
          } catch {
            // ignore
          }
        })
        .catch(() => {});

    for (const frame of this.page.frames()) {
      await apply(frame);
    }
  }

  /**
   * Wait until the visit form is fully visible before filling.
   * Prevents false positives when still on the search/results page.
   */
  async waitForVisitFormReady(opts = {}) {
    const timeoutMs = Number(opts.timeout || 12000);
    const started = Date.now();
    const isReady = async () => {
      const urlNow = this.page.url() || '';
      if (/EmpVisitAdd|VisitAdd/i.test(urlNow)) return true;
      const hasHeader =
        (await this.page.locator('text=/Employee\\s+Visit\\s*-\\s*Add/i').count().catch(() => 0)) > 0;
      const hasConsultFee =
        (await this.page.locator('text=/Consultation\\s+Fee/i').count().catch(() => 0)) > 0;
      const hasDrugHeader = (await this.page.locator('text=/Drug\\s+Name/i').count().catch(() => 0)) > 0;
      const hasSaveDraft =
        (await this.page.locator('button:has-text("Save As Draft"), input[value*="Save As Draft" i]').count().catch(() => 0)) > 0;
      return hasHeader || hasConsultFee || hasDrugHeader || hasSaveDraft;
    };

    while (Date.now() - started < timeoutMs) {
      if (await isReady()) {
        this._logStep('Visit form ready');
        return true;
      }
      await this.page.waitForTimeout(250);
    }

    this._logStep('Visit form not detected within timeout', { timeoutMs });
    await this.page.screenshot({ path: 'screenshots/mhc-visit-form-not-ready.png', fullPage: true }).catch(() => {});
    return false;
  }

  /**
   * Fill Charge Type dropdown
   * Maps Clinic Assist visit types to MHC options
   * @param {string} visitType - Visit type from Clinic Assist: "New", "Follow Up", "Repeat"
   */
  async fillChargeType(visitType) {
    try {
      this._logStep('Fill charge type', { visitType });
      // Ensure the visit form has rendered before scanning.
      await this.waitForVisitFormReady({ timeout: 5000 }).catch(() => {});
      await this.page.waitForTimeout(500);
      
      // Map visit types
      const typeMap = {
        'new': 'First Consult',
        'follow up': 'Follow Up',
        'follow': 'Follow Up',
        'repeat': 'Repeat Medicine',
        'repeat medicine': 'Repeat Medicine',
      };

      const mhcType = typeMap[visitType?.toLowerCase()] || 'Follow Up';

      // Prefer row-based lookup to avoid mis-detecting unrelated selects.
      const rowFilled = await this.page
        .evaluate((label) => {
          const norm = (s) => (s || '').toString().replace(/\\s+/g, ' ').trim().toLowerCase();
          const rows = Array.from(document.querySelectorAll('tr'));
          const row = rows.find((r) => /(charge|visit)\\s*type/i.test(norm(r.textContent || '')));
          if (!row) return false;
          const select =
            row.querySelector('select') ||
            row.querySelector('select[name*="charge" i], select[id*="charge" i], select[name*="visit" i], select[id*="visit" i], select[name*="type" i]');
          if (!select) return false;
          const options = Array.from(select.querySelectorAll('option'));
          const desired = String(label || '').toLowerCase();
          const match =
            options.find((o) => norm(o.textContent || o.value || '') === desired) ||
            options.find((o) => norm(o.textContent || o.value || '').includes(desired)) ||
            options.find((o) => /first\\s*consult/i.test(norm(o.textContent || o.value || '')) && /first/.test(desired)) ||
            options.find((o) => /follow\\s*up/i.test(norm(o.textContent || o.value || '')) && /follow/.test(desired));
          if (!match) return false;
          select.value = match.value;
          select.dispatchEvent(new Event('change', { bubbles: true }));
          return true;
        }, mhcType)
        .catch(() => false);

      if (rowFilled) {
        this._logStep('Charge type filled (row scan)', { visitType, mhcType });
        return true;
      }

      // Retry once after a short wait (some forms render late).
      await this.page.waitForTimeout(800);
      const rowRetry = await this.page
        .evaluate((label) => {
          const norm = (s) => (s || '').toString().replace(/\s+/g, ' ').trim().toLowerCase();
          const rows = Array.from(document.querySelectorAll('tr'));
          const row = rows.find((r) => /(charge|visit)\\s*type/i.test(norm(r.textContent || '')));
          if (!row) return false;
          const select =
            row.querySelector('select') ||
            row.querySelector('select[name*="charge" i], select[id*="charge" i], select[name*="visit" i], select[id*="visit" i], select[name*="type" i]');
          if (!select) return false;
          const options = Array.from(select.querySelectorAll('option'));
          const desired = String(label || '').toLowerCase();
          const match =
            options.find((o) => norm(o.textContent || o.value || '') === desired) ||
            options.find((o) => norm(o.textContent || o.value || '').includes(desired));
          if (!match) return false;
          select.value = match.value;
          select.dispatchEvent(new Event('change', { bubbles: true }));
          return true;
        }, mhcType)
        .catch(() => false);
      if (rowRetry) {
        this._logStep('Charge type filled (row scan retry)', { visitType, mhcType });
        return true;
      }

      const fillByOptions = async (frame) =>
        frame
          .evaluate((label) => {
            const norm = (s) => (s || '').toString().replace(/\s+/g, ' ').trim().toLowerCase();
            const desired = norm(label);
            const selects = Array.from(document.querySelectorAll('select'));
            for (const select of selects) {
              const options = Array.from(select.querySelectorAll('option')).map((o) => ({
                value: o.value,
                label: norm(o.textContent || o.value || ''),
              }));
              const hasChargeOptions = options.some((o) =>
                /(first\\s*consult|follow\\s*up|repeat\\s*medicine)/i.test(o.label)
              );
              if (!hasChargeOptions) continue;
              const match =
                options.find((o) => o.label === desired) ||
                options.find((o) => o.label.includes(desired)) ||
                options.find((o) => /first\\s*consult/i.test(o.label) && /first/.test(desired)) ||
                options.find((o) => /follow\\s*up/i.test(o.label) && /follow/.test(desired)) ||
                options.find((o) => /repeat\\s*medicine/i.test(o.label) && /repeat/.test(desired));
              if (!match) continue;
              select.value = match.value;
              select.dispatchEvent(new Event('change', { bubbles: true }));
              return true;
            }
            return false;
          }, mhcType)
          .catch(() => false);

      let filledByOptions = false;
      for (const frame of this.page.frames()) {
        if (frame === this.page.mainFrame()) {
          filledByOptions = await fillByOptions(this.page);
        } else {
          filledByOptions = await fillByOptions(frame);
        }
        if (filledByOptions) break;
      }

      if (filledByOptions) {
        this._logStep('Charge type filled (options scan)', { visitType, mhcType });
        return true;
      }

      // Find charge type dropdown (generic fallbacks)
      const dropdownSelectors = [
        'select[name*="charge" i]',
        'select[id*="charge" i]',
        'select[name*="visit" i]',
        'select[id*="visit" i]',
        'select[name*="type" i]',
        'tr:has-text("Charge Type") select',
        'tr:has-text("Visit Type") select',
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
	      
	      const days = Number.isFinite(Number(mcDays)) ? Number(mcDays) : 0;
      // AIA Clinic in particular can pop "Invalid MC Day value!" alerts when the MC field
      // transitions away from its default placeholder. We set "0" for no-MC but avoid
      // firing change events for days=0 to keep the UI stable.
      const effectiveValue = days > 0 ? String(days) : '0';
      const toNum = (s) => {
        const t = (s ?? '').toString().replace(/[^\d.]/g, '');
        const n = Number.parseFloat(t);
        return Number.isFinite(n) ? n : null;
      };

	      // Always attempt to set MC Day, even when 0, to avoid leaving '?' placeholders.

	      // Safe path: DOM-scan within the exact "MC Day" row and fill/select within it only.
	      // Avoid geometric selectors (easy to target Visit Date by mistake).
	      const scanned = await this.page
	        .evaluate(({ days }) => {
	          const norm = (s) => (s || '').toString().replace(/\s+/g, ' ').trim();
          const toNum = (s) => {
            const t = (s ?? '').toString().replace(/[^\d.]/g, '');
            const n = Number.parseFloat(t);
            return Number.isFinite(n) ? n : null;
          };
          const isMcDayLabel = (t) => /^MC\s*Day\b/i.test(t) && !/^MC\s*Start/i.test(t);

	          const rowHasField = (row) => row && row.querySelector('select, input:not([type="hidden"])');

	          const cells = Array.from(document.querySelectorAll('td, th, div, span, label, b, strong'));
	          const candidates = cells
	            .map((el) => ({ el, text: norm(el.textContent) }))
	            .filter((x) => isMcDayLabel(x.text))
	            .sort((a, b) => a.text.length - b.text.length);

	          let row = null;
	          for (const c of candidates) {
	            const r = c.el.closest('tr');
	            if (!r) continue;
	            if (!rowHasField(r)) continue;
	            const rowText = norm(r.textContent);
	            if (/^visit\s*date\b/i.test(rowText) || /\bvisit\s*date\b/i.test(rowText)) continue;
	            row = r;
	            break;
	          }

	          // Fallback: scan tables for a row that contains an MC Day label cell plus a field.
	          if (!row) {
	            const tables = Array.from(document.querySelectorAll('table'));
	            for (const t of tables) {
	              const rows = Array.from(t.querySelectorAll('tr'));
	              for (const r of rows) {
	                const labelCells = Array.from(r.querySelectorAll('td, th')).filter((td) =>
	                  isMcDayLabel(norm(td.textContent))
	                );
	                if (!labelCells.length) continue;
	                if (!rowHasField(r)) continue;
	                const rowText = norm(r.textContent);
	                if (/^visit\s*date\b/i.test(rowText) || /\bvisit\s*date\b/i.test(rowText)) continue;
	                row = r;
	                break;
	              }
	              if (row) break;
	            }
	          }

	          if (!row) return { ok: false, reason: 'row_not_found' };

	          const select = row.querySelector('select');
	          if (select) {
	            const opts = Array.from(select.options || []).map((o) => ({
	              value: (o.value || '').trim(),
	              label: norm(o.textContent),
	            }));
            let match = null;
            if (days <= 0) {
              // Most portals treat "0" as the valid "no MC" value; selecting an empty/"?" placeholder
              // can trigger "Invalid MC Day value!" dialogs later.
              match =
                opts.find((o) => toNum(o.value) === 0 || toNum(o.label) === 0) ||
                opts.find((o) => (o.value || '').trim() === '0' || (o.label || '').trim() === '0') ||
                opts.find((o) => (o.value || '').trim() === '') ||
                opts.find((o) => (o.label || '').trim() === '?' || /\bselect\b/i.test(o.label || '')) ||
                opts.find((o) => /^n\/?a$/i.test((o.label || '').trim()));
            }
            if (!match) {
              match =
                opts.find((o) => toNum(o.value) === days) ||
                opts.find((o) => toNum(o.label) === days) ||
                opts.find((o) => o.value === String(days) || o.label === String(days));
            }
            if (!match) return { ok: false, reason: 'no_matching_option', options: opts.slice(0, 30) };

            select.value = match.value;
            select.dispatchEvent(new Event('input', { bubbles: true }));
            select.dispatchEvent(new Event('change', { bubbles: true }));
            return { ok: true, kind: 'select', value: match.value, label: match.label };
          }

	          const input = row.querySelector('input:not([type="hidden"])');
	          if (input) {
	            const v = days > 0 ? String(days) : '0';
	            input.value = v;
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
            // Some portals submit a hidden MC-day field; set it too if present.
            const hidden = Array.from(row.querySelectorAll('input[type="hidden"]')).filter((h) =>
              /mc/i.test(h.name || h.id || '') && /day/i.test(h.name || h.id || '')
            );
            for (const h of hidden) {
              h.value = v;
              h.dispatchEvent(new Event('input', { bubbles: true }));
              h.dispatchEvent(new Event('change', { bubbles: true }));
            }
            return { ok: true, kind: 'input', value: v };
          }

          return { ok: false, reason: 'no_field_in_row' };
        }, { days })
        .catch(() => ({ ok: false, reason: 'evaluate_failed' }));

      let anyOk = false;
      if (scanned?.ok) {
        anyOk = true;
        this._logStep('MC days filled (DOM scan)', { mcDays: days, ...scanned });
        // Return early for days>0 to avoid later fallback selectors accidentally targeting
        // the Visit Date field on nested-table portals (pcpcare/AIA style).
        if (days > 0) return true;
      }

      const mcSelectors = [
        // Attribute-based selectors first (lowest risk).
        'select[name*="mc" i][name*="day" i]',
        'select[id*="mc" i][id*="day" i]',
        'input[name*="mc" i][name*="day" i]',
        'input[id*="mc" i][id*="day" i]',
        // Row-based (text) selectors last (can match outer layout rows and hit Visit Date).
        'tr:has-text("MC Day") select',
        'tr:has-text("MC Day") input:not([type="hidden"])',
      ];

      for (const selector of mcSelectors) {
        try {
          const field = this.page.locator(selector).first();
          if ((await field.count().catch(() => 0)) > 0) {
            const nid = await field
              .evaluate((el) => `${el.getAttribute('name') || ''} ${el.getAttribute('id') || ''}`.toLowerCase())
              .catch(() => '');
            if (nid.includes('visit') || nid.includes('date')) continue;

            const tag = await field.evaluate((el) => el.tagName).catch(() => 'INPUT');
            if (tag === 'SELECT') {
              const options = await field.locator('option').evaluateAll((opts) =>
                opts.map((o) => ({ value: o.value, label: (o.textContent || '').trim() }))
              );
              const match =
                (days === 0
                  ? options.find((o) => toNum(o.value) === 0 || toNum(o.label) === 0) ||
                    options.find((o) => (o.value || '').trim() === '0' || (o.label || '').trim() === '0') ||
                    options.find(
                      (o) =>
                        (o.value || '').trim() === '' ||
                        (o.label || '').trim() === '' ||
                        /^\?$/.test((o.label || '').trim()) ||
                        /\bselect\b/i.test(o.label || '') ||
                        /^n\/?a$/i.test((o.label || '').trim())
                    )
                  : null) ||
                options.find((o) => toNum(o.value) === days) ||
                options.find((o) => toNum(o.label) === days) ||
                options.find((o) => (o.label || '').trim() === String(days) || (o.value || '').trim() === String(days)) ||
                options.find((o) => toNum(o.value) === 0 || toNum(o.label) === 0);
              if (match) {
                await field.selectOption({ value: match.value }).catch(async () =>
                  field.selectOption({ label: match.label })
                );
                this._logStep('MC days selected', { mcDays: days, value: match.value, label: match.label });
                anyOk = true;
                continue;
              }
            } else {
              await field.fill(effectiveValue).catch(async () => {
                await field.evaluate((el, v) => {
                  try {
                    el.value = v;
                    el.dispatchEvent(new Event('input', { bubbles: true }));
                    el.dispatchEvent(new Event('change', { bubbles: true }));
                  } catch {
                    // ignore
                  }
                }, effectiveValue);
              });
              this._logStep('MC days filled', { mcDays: days, selector });
              anyOk = true;
              continue;
            }
          }
        } catch (e) {
          continue;
        }
      }

      if (anyOk) return true;

      // Some AIA/Singlife forms use a placeholder value "?" in a text input. Setting it to "0"
      // can still produce alerts due to attached validation handlers. In our workflow (leave the
      // browser open; no submit) it's safer to leave it as-is.
      if (days === 0) {
        const placeholderPresent = await this.page
          .locator('tr:has-text("MC Day")')
          .first()
          .locator('input:not([type="hidden"])')
          .first()
          .evaluate((el) => String(el.value || '').trim() === '?' || String(el.value || '').trim() === '')
          .catch(() => false);
        if (placeholderPresent) {
          this._logStep('MC days left as placeholder to avoid portal validation', { mcDays: days });
          return true;
        }
      }

      if (scanned?.reason === 'no_matching_option') {
        this._logStep('MC day present but no matching option', { mcDays: days, ...scanned });
        await this.page.screenshot({ path: 'screenshots/mhc-mc-days-option-not-found.png', fullPage: true }).catch(() => {});
        return false;
      }

      logger.warn('MC days field not found');
      await this.page.screenshot({ path: 'screenshots/mhc-mc-days-not-found.png', fullPage: true }).catch(() => {});
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
      
      // Strategy: Enter 99999 to trigger max amount dialog, then accept it.
      // Must be strict about selecting the right input; outer-table selectors can accidentally
      // target MC Day on these forms.
      const highAmount = '99999';

      // Strict first attempt: find the row whose label starts with "Consultation Fee" and fill the best input in that row.
      const strict = await this.page
        .evaluate((value) => {
          const norm = (s) => (s || '').toString().replace(/\s+/g, ' ').trim();
          const isVisible = (el) => {
            if (!el) return false;
            const style = window.getComputedStyle(el);
            if (!style) return false;
            if (style.display === 'none' || style.visibility === 'hidden') return false;
            return true;
          };
          const cells = Array.from(document.querySelectorAll('td, th, label, span, b, strong'));
          const label = cells.find((el) => /^Consultation\s*Fee\b/i.test(norm(el.textContent)));
          if (!label) return { ok: false, reason: 'label_not_found' };
          const row = label.closest('tr');
          if (!row) return { ok: false, reason: 'row_not_found' };
          const inputs = Array.from(
            row.querySelectorAll('input[type="text"], input[type="number"], input:not([type])')
          ).filter((x) => isVisible(x) && !x.disabled);
          if (!inputs.length) return { ok: false, reason: 'input_not_found' };
          const score = (inp) => {
            const idn = `${inp.name || ''} ${inp.id || ''}`.toLowerCase();
            let s = 0;
            if (/consult/.test(idn)) s += 30;
            if (/fee|amt|amount/.test(idn)) s += 15;
            if (/mc|day|start|date|visit/.test(idn)) s -= 40;
            const w = inp.getBoundingClientRect().width || 0;
            if (w) s += Math.min(20, w / 20);
            if (inp.readOnly) s -= 2;
            return s;
          };
          let best = null;
          let bestS = -1e9;
          for (const inp of inputs) {
            const sc = score(inp);
            if (sc > bestS) {
              bestS = sc;
              best = inp;
            }
          }
          if (!best) return { ok: false, reason: 'no_best' };
          best.value = String(value);
          try {
            best.dispatchEvent(new Event('input', { bubbles: true }));
            best.dispatchEvent(new Event('change', { bubbles: true }));
            best.dispatchEvent(new Event('blur', { bubbles: true }));
          } catch {
            // ignore
          }
          return { ok: true, value: best.value || '', name: best.name || '', id: best.id || '' };
        }, highAmount)
        .catch(() => ({ ok: false, reason: 'evaluate_failed' }));

      if (strict?.ok) {
        this._logStep('Consultation fee set to 99999 (strict row scan)', strict);
      }
      
      // Try to find the consultation fee field
      const feeSelectors = [
        // Row-based (works on many AIA/Singlife forms); avoid readonly date inputs in the same table.
        'tr:has-text("Consultation Fee") input[type="text"]:not([readonly]):not([disabled])',
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
          if (strict?.ok) break;
          const field = this.page.locator(selector).first();
          if ((await field.count().catch(() => 0)) > 0) {
            const ro = await field.getAttribute('readonly').catch(() => null);
            const dis = await field.isDisabled().catch(() => false);
            if (ro !== null || dis) continue;
            feeInput = field;
            break;
          }
        } catch (e) {
          continue;
        }
      }

      // Try to find by label text "Consultation Fee"
      if (!feeInput && !strict?.ok) {
        try {
          const feeLabel = this.page.locator('td:has-text("Consultation Fee")').first();
          if (await feeLabel.count() > 0) {
            const row = feeLabel.locator('xpath=ancestor::tr');
            const input = row
              .locator(
                'input[type="text"]:not([readonly]):not([disabled])[name*="fee" i], ' +
                  'input[type="text"]:not([readonly]):not([disabled])[id*="fee" i], ' +
                  'input[type="text"]:not([readonly]):not([disabled])[name*="consult" i], ' +
                  'input[type="text"]:not([readonly]):not([disabled])[id*="consult" i], ' +
                  'input[type="text"]:not([readonly]):not([disabled])'
              )
              .first();
            if (await input.count() > 0) {
              feeInput = input;
            }
          }
        } catch (e) {
          // Continue
        }
      }

      if (!feeInput && !strict?.ok) {
        // Try JavaScript to find the field
        const found = await this.page.evaluate(() => {
          const inputs = document.querySelectorAll('input[type="text"]');
          for (const input of inputs) {
            const row = input.closest('tr');
            if (!row) continue;
            if (!row.textContent.toLowerCase().includes('consultation fee')) continue;
            if (input.readOnly || input.disabled) continue;
            const nid = `${input.name || ''} ${input.id || ''}`.toLowerCase();
            if (nid.includes('date') || nid.includes('visit')) continue;
            return true;
          }
          return false;
        });
        
        if (found) {
          // Use JavaScript to fill
          await this.page.evaluate((value) => {
            const inputs = document.querySelectorAll('input[type="text"]');
            for (const input of inputs) {
              const row = input.closest('tr');
              if (!row) continue;
              if (!row.textContent.toLowerCase().includes('consultation fee')) continue;
              if (input.readOnly || input.disabled) continue;
              const nid = `${input.name || ''} ${input.id || ''}`.toLowerCase();
              if (nid.includes('date') || nid.includes('visit')) continue;
              input.value = value;
              input.dispatchEvent(new Event('change', { bubbles: true }));
              input.dispatchEvent(new Event('blur', { bubbles: true }));
              return;
            }
          }, highAmount);
          
          this._logStep('Consultation fee set to 99999 via JS, waiting for dialog');
        }
      } else if (feeInput) {
        // Fill the input with high amount to trigger max dialog
        await feeInput.clear().catch(() => {});
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
   * Fill Primary Diagnosis using "M" button search modal.
   * Accepts either a string, or an object { code, description }.
   */
  async fillDiagnosisPrimary(diagnosisText) {
    try {
      const code = diagnosisText && typeof diagnosisText === 'object' ? String(diagnosisText.code || '').trim() : '';
      const desc =
        diagnosisText && typeof diagnosisText === 'object' ? String(diagnosisText.description || '').trim() : String(diagnosisText || '').trim();

      const preview = (code || desc).slice(0, 50);
      this._logStep('Fill primary diagnosis via M button', { diagnosis: preview });

      if (!(code || desc) || (code || desc).length < 2) {
        logger.warn('Diagnosis text too short, skipping');
        return false;
      }

      const fillInFormTextFallback = async (why) => {
        const fallbackText = [code, desc].filter(Boolean).join(' - ').slice(0, 80);
        if (!fallbackText) return false;
        // Never write diagnosis into AIA Clinic free-text fields (risk of Special Remarks).
        const urlNow = this.page.url() || '';
        if (this.isAiaClinicSystem || /aiaclinic\.com/i.test(urlNow)) {
          logger.warn('AIA Clinic: skipping in-form diagnosis fallback to avoid Special Remarks');
          return false;
        }
        if (why) this._logStep(why, { url: this.page.url() });

        const filled = await this.page
          .evaluate((val) => {
            const norm = (s) => (s || '').toString().replace(/\s+/g, ' ').trim();
            const isVisible = (el) => {
              if (!el) return false;
              const style = window.getComputedStyle(el);
              if (!style) return false;
              if (style.display === 'none' || style.visibility === 'hidden') return false;
              const rect = el.getBoundingClientRect();
              if (!rect || rect.width <= 0 || rect.height <= 0) return false;
              return true;
            };
            const sameNumeric = (a, b) => {
              const n1 = Number(String(a || '').trim());
              const n2 = Number(String(b || '').trim());
              if (!Number.isFinite(n1) || !Number.isFinite(n2)) return false;
              return Math.abs(n1 - n2) < 1e-9;
            };
            const isAllowed = (el) => {
              if (!el || el.disabled) return false;
              if (!isVisible(el)) return false;
              const tag = el.tagName?.toLowerCase();
              const name = `${el.getAttribute('name') || ''} ${el.id || ''} ${el.getAttribute('aria-label') || ''}`.toLowerCase();
              if (name.includes('remark') || name.includes('special')) return false;
              const cellText = norm(el.closest('td, th')?.textContent || '');
              const rowText = norm(el.closest('tr')?.textContent || '');
              if (/special\s+remarks/i.test(cellText) || /special\s+remarks/i.test(rowText)) return false;
              if (tag === 'textarea' && !/diag|dx|icd/.test(name)) return false;
              return tag === 'input' || tag === 'textarea';
            };
            const score = (el) => {
              const tag = el.tagName?.toLowerCase();
              const name = `${el.getAttribute('name') || ''} ${el.id || ''} ${el.getAttribute('aria-label') || ''}`.toLowerCase();
              let s = 0;
              if (/diag|dx|icd/.test(name)) s += 50;
              if (tag === 'input') s += 10;
              if (tag === 'textarea') s -= 10;
              const w = el.getBoundingClientRect().width || 0;
              return s + w / 10;
            };
            const rows = Array.from(document.querySelectorAll('tr')).filter((r) =>
              /Diagnosis\s*(Pri|Primary|Sec|Secondary)?/i.test(norm(r.textContent || ''))
            );
            if (!rows.length) return false;
            const priRows = rows.filter((r) => /Diagnosis\s+Pri/i.test(norm(r.textContent || '')));
            const targetRows = priRows.length ? priRows : rows;
            for (const row of targetRows) {
              const rowText = norm(row.textContent || '');
              if (/Special\s+Remarks/i.test(rowText)) continue;
              if (!/Diagnosis/i.test(rowText)) continue;
              const cells = Array.from(row.querySelectorAll('th, td'));
              const labelCell = cells.find((c) => /Diagnosis\s+Pri/i.test(norm(c.textContent)));
              const candidates = [];
              const addFrom = (root) => {
                if (!root) return;
                const inputs = Array.from(root.querySelectorAll('input[type="text"], input:not([type]), textarea'));
                for (const el of inputs) {
                  const localCell = norm(el.closest('td, th')?.textContent || '');
                  if (/special\s+remarks/i.test(localCell)) continue;
                  if (isAllowed(el)) candidates.push(el);
                }
              };
              if (!labelCell) continue;
              addFrom(labelCell.nextElementSibling);
              if (!candidates.length) continue;
              candidates.sort((a, b) => score(b) - score(a));
              const target = candidates[0];
              if (!target) continue;
              target.scrollIntoView({ block: 'center' });
              target.value = String(val);
              target.dispatchEvent(new Event('input', { bubbles: true }));
              target.dispatchEvent(new Event('change', { bubbles: true }));
              return true;
            }
            return false;
          }, fallbackText)
          .catch(() => false);

        if (filled) {
          this._logStep('Diagnosis filled in-form via text fallback');
          return true;
        }
        return false;
      };

      // Best-effort: some "First Consult" flows require waiver-of-referral checked before any
      // modal interactions, otherwise a blocking alert appears ("Referring Clinic is required...").
      await this.setWaiverOfReferral(true).catch(() => {});

      // Do not auto-adjust MC Day here. Some portals treat "0" as invalid and show blocking alerts.

      const stop = new Set([
        'sprain',
        'strain',
        'pain',
        'ache',
        'with',
        'without',
        'part',
        'parts',
        'region',
        'other',
        'others',
        'oth',
        'unspecified',
        'unsp',
        'site',
        'body',
      ]);
      const keywords = (desc || '')
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter((w) => w.length >= 4)
        .filter((w) => !stop.has(w));
      const minScore = Number(process.env.MHC_DIAG_MIN_SCORE || '50');
      // Prefer the most specific description keyword over ICD code.
      const keyword = keywords.slice().sort((a, b) => b.length - a.length)[0] || '';
      const searchText = (keyword || desc || code).slice(0, 50);

      // Singlife/Aviva PCP (pcpcare.com) uses a server-postback for the "M" control and can
      // revert the Visit Date if the hidden backing field wasn't updated. Since we don't rely
      // on the modal for our "leave browser open; do not submit" workflow, skip it and just
      // write a readable diagnosis into the in-form free-text field.
      const urlNow = this.page.url();
      if (/pcpcare\.com\/pcpcare/i.test(urlNow)) {
        return await fillInFormTextFallback('PcpCare portal: skipping diagnosis modal and using in-form text fallback');
      }

      const preUrl = this.page.url();

      // Find and click "M" button for Diagnosis Pri - it's an INPUT element, not button.
      // Important: many portals open a popup window for diagnosis search.
      const popupPromise = this.page.waitForEvent('popup', { timeout: 8000 }).catch(() => null);

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

      // Resolve where the diagnosis search UI actually opened.
      // Hard rule: NEVER type into the underlying visit form when we fail to detect the modal/popup/frame.
      const popup = await popupPromise;
      const postUrl = this.page.url();
      const urlChanged = postUrl && preUrl && postUrl !== preUrl;

      // Wait briefly for the search UI to appear.
      if (popup) {
        await popup.waitForLoadState('domcontentloaded', { timeout: 6000 }).catch(() => {});
        await popup.waitForTimeout(300);
      } else {
        await this.page.waitForLoadState('domcontentloaded', { timeout: 6000 }).catch(() => {});
        await this.page.waitForTimeout(300);
      }

      /** @type {{kind:'popup'|'frame'|'modal'|'page', close?: ()=>Promise<void>, locator: (sel: string)=>import('@playwright/test').Locator, waitForTimeout:(ms:number)=>Promise<void>, waitForLoadState:(s:any, o?:any)=>Promise<void>}} */
      let ctx = null;

      if (popup) {
        ctx = {
          kind: 'popup',
          locator: (sel) => popup.locator(sel),
          waitForTimeout: (ms) => popup.waitForTimeout(ms),
          waitForLoadState: (s, o) => popup.waitForLoadState(s, o),
          close: async () => popup.close().catch(() => {}),
        };
      }

      // Non-popup flows: attempt to find a real modal dialog container (NOT inside #visit_form).
      if (!ctx) {
        const modalCandidates = this.page.locator('dialog, [role="dialog"], .ui-dialog, .modal, .popup, .ui-widget-overlay').filter({
          has: this.page.locator('input[type="text"], input[type="search"], input:not([type])'),
        });
        const n = await modalCandidates.count().catch(() => 0);
        for (let i = 0; i < Math.min(10, n); i++) {
          const cand = modalCandidates.nth(i);
          const ok = await cand
            .evaluate((el) => {
              const style = window.getComputedStyle(el);
              if (!style) return false;
              if (style.display === 'none' || style.visibility === 'hidden') return false;
              // Exclude anything embedded in the main visit form: that's where MC Day / Visit Date live.
              if (el.closest('#visit_form')) return false;
              const hasSearchInput = !!el.querySelector('input[type="text"], input[type="search"], input:not([type])');
              const hasSearchButton = !!el.querySelector(
                'button, input[type="submit"], input[type="button"], a'
              );
              return hasSearchInput && hasSearchButton;
            })
            .catch(() => false);
          if (!ok) continue;
          ctx = {
            kind: 'modal',
            locator: (sel) => cand.locator(sel),
            waitForTimeout: (ms) => this.page.waitForTimeout(ms),
            waitForLoadState: (s, o) => this.page.waitForLoadState(s, o),
          };
          this._logStep('Diagnosis modal detected (same tab)', { candidateIndex: i });
          break;
        }
      }

      // Frame-based flows: some portals open diagnosis search inside an iframe.
      if (!ctx) {
        const frames = this.page.frames().filter((f) => f !== this.page.mainFrame());
        for (const frame of frames) {
          const fUrl = frame.url() || '';
          // Ignore about:blank frames; prefer frames that actually have content.
          if (!fUrl || fUrl === 'about:blank') continue;
          const hasInput = (await frame.locator('input[type="text"], input[type="search"], input:not([type])').count().catch(() => 0)) > 0;
          const hasBtn =
            (await frame
              .locator('button:has-text("Search"), button:has-text("Find"), input[type="submit"], input[type="button"][value*="Search" i]')
              .count()
              .catch(() => 0)) > 0;
          if (!hasInput || !hasBtn) continue;
          ctx = {
            kind: 'frame',
            locator: (sel) => frame.locator(sel),
            waitForTimeout: (ms) => this.page.waitForTimeout(ms),
            waitForLoadState: (s, o) => this.page.waitForLoadState(s, o),
          };
          this._logStep('Diagnosis iframe detected', { url: fUrl });
          break;
        }
      }

      // Page-navigation flows: if the main tab navigated away from the visit form and looks like a search page.
      if (!ctx && urlChanged) {
        const stillOnVisitForm = await this.page.locator('#visit_form').count().catch(() => 0);
        if (!stillOnVisitForm) {
          ctx = {
            kind: 'page',
            locator: (sel) => this.page.locator(sel),
            waitForTimeout: (ms) => this.page.waitForTimeout(ms),
            waitForLoadState: (s, o) => this.page.waitForLoadState(s, o),
          };
          this._logStep('Diagnosis search appears to be a full-page navigation', { from: preUrl, to: postUrl });
        }
      }

      if (!ctx) {
        const urlNow = this.page.url();
        this._logStep('Diagnosis search UI not detected; leaving diagnosis blank', { url: urlNow });
        await this.page.screenshot({ path: 'screenshots/mhc-diagnosis-modal-not-detected.png', fullPage: true }).catch(() => {});
        if (this.isAiaClinicSystem || /aiaclinic\.com/i.test(urlNow)) {
          logger.warn('AIA Clinic diagnosis modal not detected; skipping fallback to avoid writing into Special Remarks');
          return false;
        }
        return false;
      }

      // Find search field in modal
      const searchSelectors = [
        // Prefer modal/popup-specific fields first so we never accidentally target underlying form inputs like MC Day or Visit Date.
        'input[name*="search" i]:not([readonly]):not([disabled])',
        'input[placeholder*="search" i]:not([readonly]):not([disabled])',
        'input[type="search"]:not([readonly]):not([disabled])',
        'input[type="text"]:not([readonly]):not([disabled])',
      ];

      let searchField = null;
      for (const selector of searchSelectors) {
        try {
          const field = ctx.locator(selector).first();
          if ((await field.count().catch(() => 0)) > 0 && (await field.isVisible().catch(() => false))) {
            // Avoid read-only fields like Visit Date.
            const ro = await field.getAttribute('readonly').catch(() => null);
            const dis = await field.isDisabled().catch(() => false);
            if (ro !== null || dis) continue;
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

      // Enter diagnosis search text (best-effort, don't hang on non-editable fields)
      try {
        await searchField.fill(searchText, { timeout: 4000 });
      } catch {
        try {
          await searchField.click({ timeout: 2000 });
          await searchField.type(searchText, { timeout: 4000 });
        } catch {
          logger.warn('Could not fill diagnosis search field (modal)');
          return false;
        }
      }
      this._logStep('Entered diagnosis search text');

      // Click search/find button or press Enter
      const searchButtonSelectors = [
        'button:has-text("Search")',
        'button:has-text("Find")',
        'button[type="submit"]',
        'input[type="submit"]',
        'input[type="button"][value*="Search" i]',
      ];

      let searchButtonFound = false;
      for (const selector of searchButtonSelectors) {
        try {
          const button = ctx.locator(selector).first();
          if ((await button.count().catch(() => 0)) > 0 && (await button.isVisible().catch(() => false))) {
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
      await ctx.waitForTimeout(1200);

      // Prefer a best-match row rather than blindly taking the first result.
      // Only do document-level evaluation when the diagnosis search is a dedicated page (popup or full-page nav).
      const canEval = ctx.kind === 'popup' || ctx.kind === 'page';
      const pickedEval = !canEval
        ? { ok: false }
        : await (ctx.kind === 'popup' ? popup : this.page)
            .evaluate(({ code, keywords, minScore }) => {
          const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const isVisible = (el) => {
            if (!el) return false;
            const style = window.getComputedStyle(el);
            if (!style) return false;
            if (style.display === 'none' || style.visibility === 'hidden') return false;
            return true;
          };
          const buildCodeVariants = (c) => {
            const s = String(c || '').replace(/\s+/g, '').toUpperCase();
            if (!s) return [];
            const noDot = s.replace(/\./g, '');
            const noTrailingZeros = noDot.replace(/0+$/g, '');
            const m = s.match(/^([A-Z]\d{2,3})\.?(\d+)?$/);
            const base = m?.[1] || null;
            const suffix = m?.[2] || null;
            const short1 = base && suffix ? `${base}${suffix.slice(0, 1)}` : null;
            const short2 = base && suffix ? `${base}${suffix.slice(0, 2)}` : null;
            return Array.from(new Set([s, noDot, noTrailingZeros, base, short2, short1].filter((x) => x && x.length >= 3)));
          };
          const codeVariants = code ? buildCodeVariants(code) : [];
          const codeRegexes = codeVariants.map((v) => new RegExp(`\\b${esc(v)}\\b`, 'i'));

          const tables = Array.from(document.querySelectorAll('table')).filter((t) => isVisible(t));
          let best = null;
          let bestScore = 0;

          const scoreText = (txt) => {
            const t = String(txt || '').toLowerCase();
            let s = 0;
            for (const r of codeRegexes) if (r.test(txt)) s += 1000;
            for (const k of keywords || []) if (k && t.includes(k)) s += 25;
            return s;
          };

          for (const table of tables) {
            const rows = Array.from(table.querySelectorAll('tr'));
            for (const row of rows) {
              const link = row.querySelector('a, button, input[type="button"], input[type="submit"]');
              if (!link || !isVisible(link)) continue;
              const txt = row.innerText || row.textContent || '';
              const sc = scoreText(txt);
              if (sc > bestScore) {
                bestScore = sc;
                best = { row, link, txt: String(txt).trim().slice(0, 120) };
              }
            }
          }

          if (best && best.link && bestScore >= minScore) {
            (best.link instanceof HTMLElement ? best.link : best.row).click();
            return { ok: true, score: bestScore, text: best.txt };
          }
          return { ok: false };
        }, { code, keywords, minScore })
            .catch(() => ({ ok: false }));

      if (pickedEval?.ok) {
        this._logStep('Selected diagnosis result (best match)', pickedEval);
        await this.page.waitForTimeout(500);
        if (ctx.close) await ctx.close();
        return true;
      }

      // Locator-based best-match for modal/iframe (and as a fallback for popup/page).
        const pickedLocator = await (async () => {
        const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const buildCodeVariants = (c) => {
          const s = String(c || '').replace(/\s+/g, '').toUpperCase();
          if (!s) return [];
          const noDot = s.replace(/\./g, '');
          const noTrailingZeros = noDot.replace(/0+$/g, '');
          const m = s.match(/^([A-Z]\d{2,3})\.?(\d+)?$/);
          const base = m?.[1] || null;
          const suffix = m?.[2] || null;
          const short1 = base && suffix ? `${base}${suffix.slice(0, 1)}` : null;
          const short2 = base && suffix ? `${base}${suffix.slice(0, 2)}` : null;
          return Array.from(new Set([s, noDot, noTrailingZeros, base, short2, short1].filter((x) => x && x.length >= 3)));
        };
        const codeVariants = code ? buildCodeVariants(code) : [];
        const codeRegexes = codeVariants.map((v) => new RegExp(`\\b${esc(v)}\\b`, 'i'));
        const kw = Array.isArray(keywords) ? keywords.filter(Boolean) : [];

        // If no signal at all, avoid selecting a random row.
        if (!codeRegexes.length && !kw.length) return { ok: false };

        const rows = ctx.locator('table tr');
        const rowCount = Math.min(await rows.count().catch(() => 0), 80);
        let bestIdx = -1;
        let bestScore = 0;
        let bestText = '';

        const scoreText = (txt) => {
          const t = String(txt || '').toLowerCase();
          let s = 0;
          for (const r of codeRegexes) if (r.test(txt)) s += 1000;
          for (const k of kw) if (k && t.includes(k)) s += 25;
          return s;
        };

        for (let i = 0; i < rowCount; i++) {
          const row = rows.nth(i);
          const txt = await row.innerText().catch(() => '');
          const sc = scoreText(txt);
          if (sc > bestScore) {
            bestScore = sc;
            bestIdx = i;
            bestText = String(txt || '').trim().slice(0, 120);
          }
        }

        if (bestIdx >= 0 && bestScore >= minScore) {
          const row = rows.nth(bestIdx);
          const link = row.locator('a, button, input[type="button"], input[type="submit"]').first();
          const hasLink = (await link.count().catch(() => 0)) > 0;
          if (hasLink) {
            await link.click().catch(() => row.click());
          } else {
            await row.click().catch(() => {});
          }
          return { ok: true, score: bestScore, text: bestText };
        }
        return { ok: false };
      })();

      if (pickedLocator?.ok) {
        this._logStep('Selected diagnosis result (best match via locator)', pickedLocator);
        await ctx.waitForTimeout(500);
        if (ctx.close) await ctx.close();
        return true;
      }

      this._logStep('Diagnosis search had no confident match; leaving diagnosis blank');
      logger.warn('Could not select diagnosis result');
      if (ctx.close) await ctx.close();
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

      // Prefer direct fill into the visible "Drug Name" cell for the requested row.
      // This is more reliable than modal selection for our "leave browser open" workflow.
      const directFilled = await this.page
        .evaluate(
          ({ rowIndex, name, quantity }) => {
            const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
            const isVisible = (el) => {
              if (!el) return false;
              const style = window.getComputedStyle(el);
              if (!style) return false;
              if (style.display === 'none' || style.visibility === 'hidden') return false;
              return true;
            };

            // Prefer the explicit drug table id when present (common on MHC/Singlife).
            let scopedTable = document.querySelector('#drugTable');
            let headerRow = null;
            let headerCell = null;

            if (scopedTable) {
              const rows = Array.from(scopedTable.querySelectorAll('tr'));
              headerRow = rows.find((r) => /drug\s*name/i.test(norm(r.innerText))) || null;
              if (headerRow) {
                headerCell =
                  Array.from(headerRow.querySelectorAll('th, td')).find((c) => /drug\s*name/i.test(norm(c.innerText))) ||
                  null;
              }
            }

            // Fallback: find a header cell anywhere and anchor to its closest table.
            if (!scopedTable || !headerRow || !headerCell) {
              headerCell =
                Array.from(document.querySelectorAll('th, td')).find((c) => /drug\s*name/i.test(norm(c.innerText))) ||
                null;
              if (!headerCell) return false;
              scopedTable = headerCell.closest('table');
              headerRow = headerCell.closest('tr');
              if (!scopedTable || !headerRow) return false;
            }

            const rows = Array.from(scopedTable.querySelectorAll('tr')).filter((r) => r.closest('table') === scopedTable);
            const headerIdx = rows.indexOf(headerRow);
            if (headerIdx < 0) return false;

            // Compute the column-range covered by the "Procedure Name" header, accounting for colspans.
            const rowCellsWithSpan = (row) =>
              Array.from(row.querySelectorAll('th, td')).map((c) => ({
                cell: c,
                span: Number(c.colSpan || 1),
              }));
            const getRange = (row, targetCell) => {
              const cells = rowCellsWithSpan(row);
              let col = 0;
              for (const it of cells) {
                const start = col;
                const end = col + it.span;
                if (it.cell === targetCell) return { start, end };
                col = end;
              }
              return null;
            };
            const headerRange = getRange(headerRow, headerCell);
            if (!headerRange) return false;

            const dataRows = [];
            for (let i = headerIdx + 1; i < rows.length; i++) {
              const rowText = norm(rows[i].innerText);
              if (/total\s+drug\s+fee/i.test(rowText)) break;
              if (rows[i].querySelector('input[type="text"], input[type="number"], input[type="tel"], input:not([type]), textarea')) dataRows.push(rows[i]);
            }
            if (!dataRows.length) return false;

            const targetRow = dataRows[Math.max(0, rowIndex - 1)];
            if (!targetRow) return false;

            // With colspans, the header range can overlap multiple cells in the data row.
            // Choose an overlapping cell that contains a visible input/textarea (prefer widest).
            const tCells = rowCellsWithSpan(targetRow);
            let col = 0;
            const overlapping = [];
            for (const it of tCells) {
              const start = col;
              const end = col + it.span;
              if (start < headerRange.end && end > headerRange.start) overlapping.push(it.cell);
              col = end;
            }
            if (!overlapping.length) return false;

            let bestCell = null;
            let bestWidth = 0;
            for (const c of overlapping) {
              const inputs = Array.from(c.querySelectorAll('input[type="text"], input:not([type]), textarea')).filter((x) =>
                isVisible(x)
              );
              if (!inputs.length) continue;
              inputs.sort((a, b) => b.getBoundingClientRect().width - a.getBoundingClientRect().width);
              const w = inputs[0].getBoundingClientRect().width;
              if (w > bestWidth) {
                bestWidth = w;
                bestCell = c;
              }
            }
            const cell = bestCell || overlapping[0];

            const inputs = Array.from(cell.querySelectorAll('input[type="text"], input[type="number"], input[type="tel"], input:not([type]), textarea')).filter(
              (x) => isVisible(x)
            );
            // Choose the widest visible field; drug name inputs are usually the widest in the cell.
            inputs.sort((a, b) => b.getBoundingClientRect().width - a.getBoundingClientRect().width);
            const input = inputs[0] || null;
            if (!input) return false;

            input.scrollIntoView({ block: 'center' });
            input.value = String(name).slice(0, 80);
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
            let qtyOk = false;
            const qtyRaw = quantity === null || quantity === undefined ? '' : String(quantity).trim();
            const qtyMatch = qtyRaw.match(/\\d+(?:\\.\\d+)?/);
            let qtyValue = qtyMatch ? qtyMatch[0] : qtyRaw;
            if (qtyValue === '') qtyValue = '1';
            if (qtyValue !== '') {
              // Prefer an explicit qty/quantity input on the same row.
              const rowInputs = Array.from(
                targetRow.querySelectorAll('input[type="text"], input[type="number"], input[type="tel"], input:not([type]), select')
              ).filter((x) => isVisible(x) && x !== input);
              const byAttr = rowInputs.find((x) => /qty|quantity/i.test((x.name || '') + ' ' + (x.id || '')));
              let qtyInput = byAttr || null;

              if (!qtyInput) {
                // Try to map via the qty header within the same table.
                let qtyHeader =
                  Array.from(headerRow.querySelectorAll('th, td')).find((c) =>
                    /qty|quantity/i.test(norm(c.innerText || c.textContent || ''))
                  ) || null;
                if (!qtyHeader) {
                  const headerRows = Array.from(scopedTable.querySelectorAll('tr')).filter(
                    (r) => /drug\\s*name|unit|price|qty|amount/i.test(norm(r.innerText || r.textContent || ''))
                  );
                  for (const r of headerRows) {
                    const cells = Array.from(r.querySelectorAll('th, td'));
                    const found = cells.find((c) => /qty|quantity/i.test(norm(c.innerText || c.textContent || '')));
                    if (found) {
                      qtyHeader = found;
                      break;
                    }
                  }
                }
                if (!qtyHeader) {
                  qtyHeader =
                    Array.from(scopedTable.querySelectorAll('th, td')).find((c) => /qty|quantity/i.test(norm(c.innerText))) ||
                    null;
                }
                if (qtyHeader && rowInputs.length) {
                  try {
                    const headerRect = qtyHeader.getBoundingClientRect();
                    const headerCenter = headerRect.left + headerRect.width / 2;
                    let best = null;
                    let bestDist = Infinity;
                    for (const inp of rowInputs) {
                      const rect = inp.getBoundingClientRect();
                      if (!rect || !rect.width) continue;
                      const center = rect.left + rect.width / 2;
                      const dist = Math.abs(center - headerCenter);
                      if (dist < bestDist) {
                        bestDist = dist;
                        best = inp;
                      }
                    }
                    if (best) qtyInput = best;
                  } catch {
                    // ignore
                  }
                }
                if (qtyHeader) {
                  const qtyRow = qtyHeader.closest('tr');
                  const qtyRange = qtyRow ? getRange(qtyRow, qtyHeader) : null;
                  if (qtyRange) {
                    const tCellsQty = rowCellsWithSpan(targetRow);
                    let colQty = 0;
                    const overlapQty = [];
                    for (const it of tCellsQty) {
                      const start = colQty;
                      const end = colQty + it.span;
                      if (start < qtyRange.end && end > qtyRange.start) overlapQty.push(it.cell);
                      colQty = end;
                    }
                    const qtyCell = overlapQty[0] || null;
                    if (qtyCell) {
                      const qtyInputs = Array.from(
                        qtyCell.querySelectorAll('input[type="text"], input[type="number"], input[type="tel"], input:not([type]), select')
                      ).filter((x) => isVisible(x));
                      // Quantity fields are usually narrow; pick the smallest visible input.
                      qtyInputs.sort((a, b) => (a.getBoundingClientRect().width || 0) - (b.getBoundingClientRect().width || 0));
                      qtyInput = qtyInputs[0] || null;
                    }
                  }
                }
              }

              if (!qtyInput && rowInputs.length) {
                // Heuristic fallback: choose the narrowest visible input in the row.
                const filtered = rowInputs.filter((x) => {
                  const idn = `${x.name || ''} ${x.id || ''}`.toLowerCase();
                  if (/unit|price|amount|amt/.test(idn)) return false;
                  return true;
                });
                const pool = filtered.length ? filtered : rowInputs;
                pool.sort((a, b) => (a.getBoundingClientRect().width || 0) - (b.getBoundingClientRect().width || 0));
                qtyInput = pool[0] || null;
              }

              if (qtyInput) {
                try {
                  qtyInput.readOnly = false;
                  qtyInput.disabled = false;
                  qtyInput.removeAttribute && qtyInput.removeAttribute('readonly');
                  qtyInput.removeAttribute && qtyInput.removeAttribute('disabled');
                } catch {
                  // ignore
                }
                const tag = (qtyInput.tagName || '').toLowerCase();
                if (tag === 'select') {
                  const opts = Array.from(qtyInput.querySelectorAll('option'));
                  const match = opts.find((o) => (o.value || '').toString() === qtyValue) ||
                    opts.find((o) => (o.textContent || '').trim() === qtyValue);
                  if (match) {
                    qtyInput.value = match.value;
                  } else if (opts.length) {
                    qtyInput.value = opts[0].value;
                  }
                  qtyInput.dispatchEvent(new Event('input', { bubbles: true }));
                  const finalValue = String(qtyInput.value || '').trim();
                  qtyOk = finalValue === qtyValue || sameNumeric(finalValue, qtyValue);
                } else {
                  qtyInput.focus();
                  qtyInput.value = qtyValue;
                  qtyInput.dispatchEvent(new Event('input', { bubbles: true }));
                  qtyInput.blur && qtyInput.blur();
                  const finalValue = String(qtyInput.value || '').trim();
                  qtyOk = finalValue === qtyValue || sameNumeric(finalValue, qtyValue);
                }
              }
            }
            return { ok: true, qtyOk };
          },
          { rowIndex, name: drugData.name, quantity: drugData.quantity }
        )
        .catch(() => ({ ok: false, qtyOk: false }));

      if (directFilled?.ok) {
        this._logStep('Drug name filled directly in drug table', { rowIndex, qtyFilled: directFilled.qtyOk });
        return true;
      }

      // Best-effort: modal selection is highly portal-specific; don't risk filling the wrong field.
      logger.warn(`Could not fill Drug Name row ${rowIndex} (direct fill did not locate the drug table)`);
      return false;
    } catch (error) {
      logger.error('Failed to fill drug item:', error);
      return false;
    }
  }

  /**
   * Fallback: ensure Qty is filled for a given drug row when table detection is flaky.
   * @param {number} rowIndex
   * @param {string|number|null} quantity
   */
  async fillDrugQuantityFallback(rowIndex = 1, quantity = null) {
    const qtyRaw = quantity === null || quantity === undefined ? '' : String(quantity).trim();
    if (!qtyRaw) return false;
    const qtyMatch = qtyRaw.match(/\d+(?:\.\d+)?/);
    const qtyValue = qtyMatch ? qtyMatch[0] : qtyRaw;
    if (!qtyValue) return false;

    const ok = await this.page
      .evaluate(
        ({ rowIndex, qtyValue }) => {
          const norm = (s) => (s || '').replace(/\s+/g, ' ').trim().toLowerCase();
          const isVisible = (el) => {
            if (!el) return false;
            const style = window.getComputedStyle(el);
            if (!style) return false;
            if (style.display === 'none' || style.visibility === 'hidden') return false;
            return true;
          };

          let table = document.querySelector('#drugTable');
          let headerRow = null;
          let qtyHeader = null;
          let drugHeader = null;

          const findHeaderRow = (root) => {
            const rows = Array.from(root.querySelectorAll('tr'));
            return rows.find((r) => /drug\s*name/i.test(norm(r.innerText))) || null;
          };

          if (table) {
            headerRow = findHeaderRow(table);
            if (headerRow) {
              const cells = Array.from(headerRow.querySelectorAll('th, td'));
              drugHeader = cells.find((c) => /drug\s*name/i.test(norm(c.innerText))) || null;
              qtyHeader = cells.find((c) => /qty|quantity/i.test(norm(c.innerText))) || null;
            }
          }

          if (!table || !headerRow) {
            const headerCell =
              Array.from(document.querySelectorAll('th, td')).find((c) => /drug\s*name/i.test(norm(c.innerText))) ||
              null;
            if (!headerCell) return false;
            table = headerCell.closest('table');
            headerRow = headerCell.closest('tr');
            if (!table || !headerRow) return false;
            const cells = Array.from(headerRow.querySelectorAll('th, td'));
            drugHeader = headerCell;
            qtyHeader = cells.find((c) => /qty|quantity/i.test(norm(c.innerText))) || null;
          }

          const rows = Array.from(table.querySelectorAll('tr')).filter((r) => r.closest('table') === table);
          const headerIdx = rows.indexOf(headerRow);
          if (headerIdx < 0) return false;

          const dataRows = [];
          for (let i = headerIdx + 1; i < rows.length; i++) {
            const text = norm(rows[i].innerText || '');
            if (/total\s+drug\s+fee/i.test(text)) break;
            if (rows[i].querySelector('input[type="text"], input[type="number"], input[type="tel"], input:not([type]), select')) {
              dataRows.push(rows[i]);
            }
          }
          const targetRow = dataRows[Math.max(0, rowIndex - 1)];
          if (!targetRow) return false;

          let qtyInput = null;
          if (qtyHeader) {
            const headerCells = Array.from(headerRow.querySelectorAll('th, td'));
            let qtyIndex = -1;
            for (let i = 0; i < headerCells.length; i++) {
              if (headerCells[i] === qtyHeader) {
                qtyIndex = i;
                break;
              }
            }
            if (qtyIndex >= 0) {
              const rowCells = Array.from(targetRow.querySelectorAll('td, th'));
              const cell = rowCells[qtyIndex] || null;
              if (cell) {
                const inputs = Array.from(
                  cell.querySelectorAll('input[type="text"], input[type="number"], input[type="tel"], input:not([type]), select')
                ).filter((x) => isVisible(x));
                qtyInput = inputs[0] || null;
              }
            }
          }

          if (!qtyInput) {
            const rowInputs = Array.from(
              targetRow.querySelectorAll('input[type="text"], input[type="number"], input[type="tel"], input:not([type]), select')
            ).filter((x) => isVisible(x));
            const attrFirst = rowInputs.find((x) => /qty|quantity/i.test((x.name || '') + ' ' + (x.id || '')));
            if (attrFirst) {
              qtyInput = attrFirst;
            } else {
              // Last resort: choose a narrow input that does not look like unit/price/amount.
              const filtered = rowInputs.filter((x) => {
                const idn = `${x.name || ''} ${x.id || ''}`.toLowerCase();
                return !/unit|price|amount|amt|claim|code/.test(idn);
              });
              const pool = filtered.length ? filtered : rowInputs;
              pool.sort((a, b) => (a.getBoundingClientRect().width || 0) - (b.getBoundingClientRect().width || 0));
              qtyInput = pool[0] || null;
            }
          }
          if (!qtyInput) {
            const qtyInputs = Array.from(
              document.querySelectorAll('input[name*="qty" i], input[id*="qty" i]')
            ).filter((x) => isVisible(x));
            if (qtyInputs.length) {
              const idx = Math.max(0, rowIndex - 1);
              qtyInput = qtyInputs[idx] || qtyInputs[0];
            }
          }

          if (!qtyInput) return false;
          const tag = (qtyInput.tagName || '').toLowerCase();
          if (tag === 'select') {
            const opts = Array.from(qtyInput.querySelectorAll('option'));
            const match = opts.find((o) => (o.value || '').toString() === qtyValue) ||
              opts.find((o) => (o.textContent || '').trim() === qtyValue);
            if (match) qtyInput.value = match.value;
            else if (opts.length) qtyInput.value = opts[0].value;
            qtyInput.dispatchEvent(new Event('input', { bubbles: true }));
            const finalValue = String(qtyInput.value || '').trim();
            return finalValue === qtyValue || sameNumeric(finalValue, qtyValue);
          }
          try {
            qtyInput.readOnly = false;
            qtyInput.disabled = false;
            qtyInput.removeAttribute && qtyInput.removeAttribute('readonly');
            qtyInput.removeAttribute && qtyInput.removeAttribute('disabled');
          } catch {
            // ignore
          }
          qtyInput.focus();
          qtyInput.value = qtyValue;
          qtyInput.dispatchEvent(new Event('input', { bubbles: true }));
          qtyInput.blur && qtyInput.blur();
          const finalValue = String(qtyInput.value || '').trim();
          return finalValue === qtyValue || sameNumeric(finalValue, qtyValue);
        },
        { rowIndex, qtyValue }
      )
      .catch(() => false);

    if (ok) this._logStep('Drug qty filled (fallback)', { rowIndex, quantity: qtyValue });
    return ok;
  }

  /**
   * Verify (and enforce) that Qty is populated for the given drug row.
   * This is a stronger fallback when portal tables are inconsistent.
   */
  async verifyDrugQuantity(rowIndex = 1, quantity = null) {
    const qtyRaw = quantity === null || quantity === undefined ? '' : String(quantity).trim();
    if (!qtyRaw) return false;
    const qtyMatch = qtyRaw.match(/\d+(?:\.\d+)?/);
    const qtyValue = qtyMatch ? qtyMatch[0] : qtyRaw;
    if (!qtyValue) return false;

    const ok = await this.page
      .evaluate(({ rowIndex, qtyValue }) => {
        const norm = (s) => (s || '').toString().replace(/\s+/g, ' ').trim().toLowerCase();
        const isVisible = (el) => {
          if (!el) return false;
          const style = window.getComputedStyle(el);
          if (!style) return false;
          if (style.display === 'none' || style.visibility === 'hidden') return false;
          const rect = el.getBoundingClientRect();
          if (!rect || rect.width <= 0 || rect.height <= 0) return false;
          return true;
        };
        const sameNumeric = (a, b) => {
          const n1 = Number(String(a || '').trim());
          const n2 = Number(String(b || '').trim());
          if (!Number.isFinite(n1) || !Number.isFinite(n2)) return false;
          return Math.abs(n1 - n2) < 1e-9;
        };
        const rowCellsWithSpan = (row) =>
          Array.from(row.querySelectorAll('th, td')).map((c) => ({
            cell: c,
            span: Number(c.colSpan || 1),
          }));
        const getRange = (row, targetCell) => {
          const cells = rowCellsWithSpan(row);
          let col = 0;
          for (const it of cells) {
            const start = col;
            const end = col + it.span;
            if (it.cell === targetCell) return { start, end };
            col = end;
          }
          return null;
        };

        const tables = [
          document.querySelector('#drugTable'),
          ...Array.from(document.querySelectorAll('table')).filter((t) =>
            /drug\s*name/i.test(norm(t.innerText || ''))
          ),
        ].filter(Boolean);
        const table = tables[0] || null;
        if (!table) return false;

        const rows = Array.from(table.querySelectorAll('tr')).filter((r) => r.closest('table') === table);
        const headerRow = rows.find((r) => /drug\s*name/i.test(norm(r.innerText || ''))) || null;
        if (!headerRow) return false;
        const headerIdx = rows.indexOf(headerRow);
        if (headerIdx < 0) return false;

        const dataRows = [];
        for (let i = headerIdx + 1; i < rows.length; i++) {
          const row = rows[i];
          const text = norm(row.innerText || '');
          if (/total\s+drug\s+fee/i.test(text)) break;
          if (row.querySelector('input[type="text"], input[type="number"], input[type="tel"], input:not([type]), select')) {
            dataRows.push(row);
          }
        }
        const target = dataRows[Math.max(0, rowIndex - 1)];
        if (!target) return false;

        const headerCells = Array.from(headerRow.querySelectorAll('th, td'));
        const qtyHeader = headerCells.find((c) => /qty|quantity/i.test(norm(c.innerText || c.textContent || ''))) || null;
        let qtyInput = null;

        if (qtyHeader) {
          const qtyRange = getRange(headerRow, qtyHeader);
          if (qtyRange) {
            const tCells = rowCellsWithSpan(target);
            let col = 0;
            const overlap = [];
            for (const it of tCells) {
              const start = col;
              const end = col + it.span;
              if (start < qtyRange.end && end > qtyRange.start) overlap.push(it.cell);
              col = end;
            }
            const qtyCell = overlap[0] || null;
            if (qtyCell) {
              const candidates = Array.from(
                qtyCell.querySelectorAll('input[type="text"], input[type="number"], input[type="tel"], input:not([type]), select')
              ).filter((x) => isVisible(x));
              qtyInput = candidates[0] || null;
            }
          }
        }

        if (!qtyInput) {
          const inputs = Array.from(
            target.querySelectorAll('input[type="text"], input[type="number"], input[type="tel"], input:not([type]), select')
          ).filter((x) => isVisible(x));
          if (!inputs.length) return false;
          qtyInput = inputs.find((x) => /qty|quantity/i.test((x.name || '') + ' ' + (x.id || ''))) || null;
          if (!qtyInput) {
            const filtered = inputs.filter((x) => {
              const idn = `${x.name || ''} ${x.id || ''}`.toLowerCase();
              return !/unit|price|amount|amt|claim|code/.test(idn);
            });
            const pool = filtered.length ? filtered : inputs;
            pool.sort((a, b) => (a.getBoundingClientRect().width || 0) - (b.getBoundingClientRect().width || 0));
            qtyInput = pool[0] || null;
          }
        }

        if (!qtyInput) return false;
        const tag = (qtyInput.tagName || '').toLowerCase();
        if (tag === 'select') {
          const opts = Array.from(qtyInput.querySelectorAll('option'));
          const match =
            opts.find((o) => (o.value || '').toString() === qtyValue) ||
            opts.find((o) => (o.textContent || '').trim() === qtyValue);
          if (match) qtyInput.value = match.value;
          else if (opts.length) qtyInput.value = opts[0].value;
          qtyInput.dispatchEvent(new Event('input', { bubbles: true }));
          const finalValue = String(qtyInput.value || '').trim();
          return finalValue === qtyValue || sameNumeric(finalValue, qtyValue);
        }
        try {
          qtyInput.readOnly = false;
          qtyInput.disabled = false;
          qtyInput.removeAttribute && qtyInput.removeAttribute('readonly');
          qtyInput.removeAttribute && qtyInput.removeAttribute('disabled');
        } catch {
          // ignore
        }
        qtyInput.focus();
        qtyInput.value = qtyValue;
        qtyInput.dispatchEvent(new Event('input', { bubbles: true }));
        qtyInput.blur && qtyInput.blur();
        const finalValue = String(qtyInput.value || '').trim();
        return finalValue === qtyValue || sameNumeric(finalValue, qtyValue);
      }, { rowIndex, qtyValue })
      .catch(() => false);

    if (ok) this._logStep('Drug qty verified', { rowIndex, quantity: qtyValue });
    return ok;
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
   * Fill a procedure item by writing directly into the Procedure Name table (best-effort).
   * @param {Object} procData - { name }
   * @param {number} rowIndex - 1-based data row index
   */
  async fillProcedureItem(procData, rowIndex = 1) {
    try {
      const name = String(procData?.name || '').trim();
      this._logStep('Fill procedure item', { name: name.slice(0, 40), rowIndex });
      if (!name || name.length < 2) return false;

      const ok = await this.page
        .evaluate(
          ({ rowIndex, name }) => {
            const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
            const isVisible = (el) => {
              if (!el) return false;
              const style = window.getComputedStyle(el);
              if (!style) return false;
              if (style.display === 'none' || style.visibility === 'hidden') return false;
              return true;
            };

            // Best anchor: the "More Procedure" button; it uniquely identifies the procedure section.
            const moreBtn =
              Array.from(document.querySelectorAll('button, input[type="button"], input[type="submit"]')).find((el) =>
                /more\s+procedure/i.test(norm(el.textContent || el.value || ''))
              ) || null;
            if (moreBtn) {
              const table = moreBtn.closest('table');
              const row = moreBtn.closest('tr');
              if (table && row) {
                const rows = Array.from(table.querySelectorAll('tr')).filter((r) => r.closest('table') === table);
                const idx = rows.indexOf(row);
                // Fill into the nearest prior data row (normally the row directly above the More Procedure button).
                for (let i = idx - 1; i >= 0; i--) {
                  const rt = norm(rows[i].innerText || rows[i].textContent || '');
                  if (!rt) continue;
                  if (/procedure\s*name/i.test(rt) || /total\s+proc\s+fee/i.test(rt)) continue;
                  const inputs = Array.from(rows[i].querySelectorAll('input[type="text"], input:not([type]), textarea')).filter(
                    (x) => isVisible(x)
                  );
                  if (!inputs.length) continue;
                  // Prefer the widest input (usually the "Procedure Name" input).
                  inputs.sort((a, b) => (b.getBoundingClientRect().width || 0) - (a.getBoundingClientRect().width || 0));
                  const target = inputs[0];
                  target.scrollIntoView({ block: 'center' });
                  target.value = String(name).slice(0, 80);
                  target.dispatchEvent(new Event('input', { bubbles: true }));
                  target.dispatchEvent(new Event('change', { bubbles: true }));
                  return true;
                }
              }
            }

            // Choose the best matching table to avoid grabbing an outer layout table.
            const headerCells = Array.from(document.querySelectorAll('th, td')).filter((c) =>
              /procedure\s*name/i.test(norm(c.innerText))
            );
            if (!headerCells.length) return false;

            let best = null;
            let bestScore = -1;
            for (const hc of headerCells) {
              const table = hc.closest('table');
              const headerRow = hc.closest('tr');
              if (!table || !headerRow) continue;
              const tableText = norm(table.innerText || table.textContent || '');
              let score = 0;
              if (/total\s+proc\s+fee/i.test(tableText) || /total\s+procedure/i.test(tableText)) score += 10;
              if (/more\s+procedure/i.test(tableText)) score += 5;
              const rows = Array.from(table.querySelectorAll('tr')).filter((r) => r.closest('table') === table);
              const headerIdx = rows.indexOf(headerRow);
              if (headerIdx < 0) continue;
              let dataRows = 0;
              for (let i = headerIdx + 1; i < rows.length; i++) {
                const rowText = norm(rows[i].innerText);
                if (/total\s+proc\s+fee/i.test(rowText) || /total\s+procedure/i.test(rowText)) break;
                if (rows[i].querySelector('input[type="text"], input:not([type]), textarea')) dataRows += 1;
              }
              score += Math.min(10, dataRows);
              if (score > bestScore) {
                bestScore = score;
                best = { table, headerRow, headerCell: hc };
              }
            }
            if (!best) return false;

            const table = best.table;
            const headerRow = best.headerRow;
            const headerCell = best.headerCell;

            const rows = Array.from(table.querySelectorAll('tr')).filter((r) => r.closest('table') === table);
            const headerIdx = rows.indexOf(headerRow);
            if (headerIdx < 0) return false;

            const rowCellsWithSpan = (row) =>
              Array.from(row.querySelectorAll('th, td')).map((c) => ({
                cell: c,
                span: Number(c.colSpan || 1),
              }));
            const getRange = (row, targetCell) => {
              const cells = rowCellsWithSpan(row);
              let col = 0;
              for (const it of cells) {
                const start = col;
                const end = col + it.span;
                if (it.cell === targetCell) return { start, end };
                col = end;
              }
              return null;
            };
            const headerRange = getRange(headerRow, headerCell);
            if (!headerRange) return false;

            const dataRows = [];
            for (let i = headerIdx + 1; i < rows.length; i++) {
              const rowText = norm(rows[i].innerText);
              if (/total\s+proc\s+fee/i.test(rowText) || /total\s+procedure/i.test(rowText)) break;
              if (rows[i].querySelector('input[type="text"], input:not([type]), textarea')) dataRows.push(rows[i]);
            }
            if (!dataRows.length) return false;

            const targetRow = dataRows[Math.max(0, rowIndex - 1)];
            if (!targetRow) return false;

            // With colspans, choose an overlapping cell that contains a visible input (prefer widest).
            const tCells = rowCellsWithSpan(targetRow);
            let col = 0;
            const overlapping = [];
            for (const it of tCells) {
              const start = col;
              const end = col + it.span;
              if (start < headerRange.end && end > headerRange.start) overlapping.push(it.cell);
              col = end;
            }
            if (!overlapping.length) return false;

            const scoreInput = (inp) => {
              const idn = `${inp.name || ''} ${inp.id || ''}`.toLowerCase();
              let s = 0;
              if (/proc|procedure/.test(idn)) s += 12;
              if (/desc|name/.test(idn)) s += 6;
              if (/code|claim|amt|amount|qty|unit|price|fee|gst/.test(idn)) s -= 6;
              const w = inp.getBoundingClientRect().width || 0;
              if (w) s += Math.min(20, w / 20);
              const size = Number.parseInt(inp.getAttribute('size') || '0', 10);
              if (Number.isFinite(size)) s += Math.min(10, size);
              const ml = Number.parseInt(inp.getAttribute('maxlength') || '0', 10);
              if (Number.isFinite(ml)) s += Math.min(10, ml / 10);
              if (inp.readOnly) s -= 1;
              return s;
            };

            let input = null;
            let bestS = -1e9;
            for (const c of overlapping) {
              const inputs = Array.from(c.querySelectorAll('input[type="text"], input:not([type]), textarea')).filter((x) =>
                isVisible(x)
              );
              for (const inp of inputs) {
                const sc = scoreInput(inp);
                if (sc > bestS) {
                  bestS = sc;
                  input = inp;
                }
              }
            }
            if (!input) return false;

            input.scrollIntoView({ block: 'center' });
            input.value = String(name).slice(0, 80);
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
            return true;
          },
          { rowIndex, name }
        )
        .catch(() => false);

      if (ok) {
        this._logStep('Procedure name filled directly in procedure table', { rowIndex });
        return true;
      }
      logger.warn(`Could not fill Procedure Name row ${rowIndex}`);
      return false;
    } catch (error) {
      logger.error('Failed to fill procedure item:', error);
      return false;
    }
  }

  async clickMoreProcedure() {
    try {
      this._logStep('Click More Procedure button');
      const selectors = [
        'button:has-text("More Procedure")',
        'button:has-text("Add Procedure")',
        'input[value*="More Procedure" i]',
      ];
      for (const selector of selectors) {
        try {
          const button = this.page.locator(selector).first();
          if ((await button.count().catch(() => 0)) > 0) {
            await button.click();
            await this.page.waitForTimeout(500);
            this._logStep('More Procedure button clicked');
            return true;
          }
        } catch {
          // ignore
        }
      }
      logger.warn('More Procedure button not found');
      return false;
    } catch (error) {
      logger.error('Failed to click More Procedure:', error);
      return false;
    }
  }

  /**
   * Fallback: ensure Procedure Claim amount is filled for a given procedure row.
   * @param {number} rowIndex
   * @param {string|number|null} amount
   */
  async fillProcedureClaimAmountFallback(rowIndex = 1, amount = '0', procedureName = '') {
    const raw = amount === null || amount === undefined ? '' : String(amount).trim();
    const match = raw.match(/\d+(?:\.\d+)?/);
    const claimValue = match ? match[0] : raw;
    if (!claimValue) return false;
    const procNameNorm = String(procedureName || '').trim().toLowerCase();

    const ok = await this.page
      .evaluate(
        ({ rowIndex, claimValue, procNameNorm }) => {
          const norm = (s) => (s || '').toString().replace(/\s+/g, ' ').trim().toLowerCase();
          const isVisible = (el) => {
            if (!el) return false;
            const style = window.getComputedStyle(el);
            if (!style) return false;
            if (style.display === 'none' || style.visibility === 'hidden') return false;
            const r = el.getBoundingClientRect();
            if (!r || r.width <= 0 || r.height <= 0) return false;
            return true;
          };
          const isTextLike = (el) => {
            const tag = (el.tagName || '').toLowerCase();
            if (tag === 'select' || tag === 'textarea') return true;
            const t = String(el.type || '').toLowerCase();
            return !t || t === 'text' || t === 'number' || t === 'tel';
          };
          const setValue = (el, v) => {
            if (!el) return false;
            const tag = (el.tagName || '').toLowerCase();
            if (tag === 'select') {
              const opts = Array.from(el.querySelectorAll('option'));
              const match =
                opts.find((o) => (o.value || '').toString().trim() === v) ||
                opts.find((o) => (o.textContent || '').toString().trim() === v);
              if (!match) return false;
              el.value = match.value;
              el.dispatchEvent(new Event('input', { bubbles: true }));
              el.dispatchEvent(new Event('change', { bubbles: true }));
              return true;
            }
            try {
              el.readOnly = false;
              el.disabled = false;
              el.removeAttribute && el.removeAttribute('readonly');
              el.removeAttribute && el.removeAttribute('disabled');
            } catch {
              // ignore
            }
            el.focus && el.focus();
            el.value = v;
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
            el.blur && el.blur();
            return String(el.value || '').trim().length > 0;
          };
          const byRowFromName = () => {
            if (!procNameNorm) return false;
            const textLikes = Array.from(
              document.querySelectorAll('input[type="text"], input[type="number"], input[type="tel"], input:not([type]), textarea')
            ).filter((el) => isVisible(el));
            const nameCandidates = textLikes.filter((el) => {
              const v = norm(el.value || '');
              if (!v) return false;
              if (!v.includes(procNameNorm)) return false;
              const idn = `${el.name || ''} ${el.id || ''}`.toLowerCase();
              // Prefer true procedure-name fields.
              return /proc|procedure|desc|name/.test(idn) || v.length >= Math.min(8, procNameNorm.length);
            });
            for (const nameEl of nameCandidates) {
              const row = nameEl.closest('tr');
              if (row) {
                const rowInputs = Array.from(
                  row.querySelectorAll('input[type="text"], input[type="number"], input[type="tel"], input:not([type]), select, textarea')
                ).filter((el) => isVisible(el) && isTextLike(el));
                if (rowInputs.length) {
                  rowInputs.sort((a, b) => (a.getBoundingClientRect().left || 0) - (b.getBoundingClientRect().left || 0));
                  const nameX = nameEl.getBoundingClientRect().left || 0;
                  const rightCandidates = rowInputs.filter((el) => {
                    if (el === nameEl) return false;
                    const idn = `${el.name || ''} ${el.id || ''}`.toLowerCase();
                    if (/proc|procedure|desc|name/.test(idn)) return false;
                    const x = el.getBoundingClientRect().left || 0;
                    return x > nameX + 20;
                  });
                  const pool = rightCandidates.length ? rightCandidates : rowInputs.filter((el) => el !== nameEl);
                  for (const inp of pool.sort((a, b) => (a.getBoundingClientRect().left || 0) - (b.getBoundingClientRect().left || 0))) {
                    if (setValue(inp, claimValue)) return true;
                  }
                }
              }
              // Non-table fallback: same y-band to the right of procedure name input.
              const nr = nameEl.getBoundingClientRect();
              const band = textLikes
                .filter((el) => {
                  if (el === nameEl) return false;
                  const idn = `${el.name || ''} ${el.id || ''}`.toLowerCase();
                  if (/proc|procedure|desc|name/.test(idn)) return false;
                  const r = el.getBoundingClientRect();
                  return Math.abs((r.top || 0) - (nr.top || 0)) <= 8 && (r.left || 0) > (nr.left || 0) + 20;
                })
                .sort((a, b) => (a.getBoundingClientRect().left || 0) - (b.getBoundingClientRect().left || 0));
              for (const inp of band) {
                if (setValue(inp, claimValue)) return true;
              }
            }
            return false;
          };
          if (byRowFromName()) return true;

          // Fast path: many legacy pages expose procedure claim inputs with claim-like names/ids.
          // Fill those directly first (excluding total claim fields).
          const labels = Array.from(document.querySelectorAll('th, td, div, span, label, b, strong'));
          const procHeaderEl = labels.find((el) => /procedure\s*name/i.test(norm(el.textContent || ''))) || null;
          const totalProcEl = labels.find((el) => /total\s+proc\s+fee/i.test(norm(el.textContent || ''))) || null;
          const claimLikeInputs = Array.from(
            document.querySelectorAll('input[type="text"], input[type="number"], input[type="tel"], input:not([type]), select, textarea')
          )
            .filter((el) => isVisible(el) && isTextLike(el))
            .filter((el) => {
              const idn = `${el.name || ''} ${el.id || ''}`.toLowerCase();
              if (!/claim|clm/.test(idn)) return false;
              if (/total/.test(idn)) return false;
              return true;
            });
          if (claimLikeInputs.length) {
            let scoped = claimLikeInputs;
            if (procHeaderEl) {
              const top = procHeaderEl.getBoundingClientRect().bottom + 2;
              const bottom = totalProcEl
                ? totalProcEl.getBoundingClientRect().top - 2
                : top + 260;
              const inBand = scoped.filter((el) => {
                const r = el.getBoundingClientRect();
                return r.top >= top && r.bottom <= bottom;
              });
              if (inBand.length) scoped = inBand;
            }
            scoped.sort((a, b) => {
              const ra = a.getBoundingClientRect();
              const rb = b.getBoundingClientRect();
              return (ra.top - rb.top) || (ra.left - rb.left);
            });
            const directTarget = scoped[Math.max(0, rowIndex - 1)] || null;
            if (directTarget && setValue(directTarget, claimValue)) return true;
          }
          const rowCellsWithSpan = (row) =>
            Array.from(row.querySelectorAll('th, td')).map((c) => ({
              cell: c,
              span: Number(c.colSpan || 1),
            }));
          const getRange = (row, targetCell) => {
            const cells = rowCellsWithSpan(row);
            let col = 0;
            for (const it of cells) {
              const start = col;
              const end = col + it.span;
              if (it.cell === targetCell) return { start, end };
              col = end;
            }
            return null;
          };

          const tables = Array.from(document.querySelectorAll('table')).filter((t) =>
            /procedure\s*name/i.test(norm(t.innerText || t.textContent || ''))
          );
          if (!tables.length) return false;

          // Prefer the table that has both the procedure and claim headers.
          const sortedTables = tables
            .map((t) => {
              const txt = norm(t.innerText || t.textContent || '');
              let score = 0;
              if (/claim\s*\(?.*sgd.*\)?/i.test(txt)) score += 20;
              if (/total\s+proc\s+fee/i.test(txt)) score += 15;
              if (/more\s+procedure/i.test(txt)) score += 10;
              return { t, score };
            })
            .sort((a, b) => b.score - a.score);
          const chosenTable = sortedTables[0]?.t || tables[0];
          if (!chosenTable) return false;

          const rows = Array.from(chosenTable.querySelectorAll('tr')).filter((r) => r.closest('table') === chosenTable);
          const headerRow =
            rows.find((r) => {
              const rt = norm(r.innerText || r.textContent || '');
              return /procedure\s*name/i.test(rt) && /claim/i.test(rt);
            }) ||
            rows.find((r) => /procedure\s*name/i.test(norm(r.innerText || r.textContent || ''))) ||
            null;
          if (!headerRow) return false;
          const headerIdx = rows.indexOf(headerRow);
          if (headerIdx < 0) return false;

          const headerCells = Array.from(headerRow.querySelectorAll('th, td'));
          const claimHeaderCell =
            headerCells.find((c) => /claim\s*\(?.*sgd.*\)?/i.test(norm(c.innerText || c.textContent || ''))) ||
            headerCells.find((c) => /claim|amt|amount/i.test(norm(c.innerText || c.textContent || ''))) ||
            null;
          if (!claimHeaderCell) return false;
          const claimRange = getRange(headerRow, claimHeaderCell);
          if (!claimRange) return false;

          const dataRows = [];
          for (let i = headerIdx + 1; i < rows.length; i++) {
            const row = rows[i];
            const rowText = norm(row.innerText || row.textContent || '');
            if (/total\s+proc\s+fee|total\s+procedure/.test(rowText)) break;
            if (/more\s+procedure/.test(rowText)) continue;
            if (row.querySelector('input[type="text"], input[type="number"], input[type="tel"], input:not([type]), select')) {
              dataRows.push(row);
            }
          }
          const targetRow = dataRows[Math.max(0, rowIndex - 1)];
          if (!targetRow) return false;

          const tCells = rowCellsWithSpan(targetRow);
          let col = 0;
          const overlapCells = [];
          for (const it of tCells) {
            const start = col;
            const end = col + it.span;
            if (start < claimRange.end && end > claimRange.start) overlapCells.push(it.cell);
            col = end;
          }

          const overlapInputs = overlapCells
            .flatMap((cell) =>
              Array.from(
                cell.querySelectorAll('input[type="text"], input[type="number"], input[type="tel"], input:not([type]), select, textarea')
              )
            )
            .filter((x) => isVisible(x) && isTextLike(x));

          const scoreInput = (el) => {
            const idn = `${el.name || ''} ${el.id || ''}`.toLowerCase();
            const cls = `${el.className || ''}`.toLowerCase();
            const parentText = norm(el.closest('td, th')?.innerText || '');
            let score = 0;
            if (/claim|amt|amount/.test(idn)) score += 20;
            if (/claim|amt|amount/.test(cls)) score += 10;
            if (/claim|amt|amount/.test(parentText)) score += 8;
            if (/proc|procedure|desc|name/.test(idn)) score -= 8;
            const w = el.getBoundingClientRect().width || 0;
            if (w > 20 && w < 220) score += 3;
            return score;
          };

          if (overlapInputs.length) {
            overlapInputs.sort((a, b) => scoreInput(b) - scoreInput(a));
            for (const inp of overlapInputs) {
              if (setValue(inp, claimValue)) return true;
            }
          }

          // Fallback: target rightmost non-name text-like input in row.
          const rowInputs = Array.from(
            targetRow.querySelectorAll('input[type="text"], input[type="number"], input[type="tel"], input:not([type]), select, textarea')
          ).filter((x) => isVisible(x) && isTextLike(x));
          if (!rowInputs.length) return false;
          const fallbackCandidates = rowInputs.filter((x) => {
            const idn = `${x.name || ''} ${x.id || ''}`.toLowerCase();
            return !/proc|procedure|desc|name/.test(idn);
          });
          const pool = fallbackCandidates.length ? fallbackCandidates : rowInputs;
          pool.sort((a, b) => (b.getBoundingClientRect().left || 0) - (a.getBoundingClientRect().left || 0));
          for (const inp of pool) {
            if (setValue(inp, claimValue)) return true;
          }

          // Final fallback for inconsistent legacy DOM: use geometry within Procedure section.
          const allTextLike = Array.from(
            document.querySelectorAll('input[type="text"], input[type="number"], input[type="tel"], input:not([type]), select, textarea')
          ).filter((x) => isVisible(x) && isTextLike(x));
          const labels2 = Array.from(document.querySelectorAll('th, td, div, span, label, b, strong'));
          const procHeaderEl2 = labels2.find((el) => /procedure\s*name/i.test(norm(el.textContent || ''))) || null;
          const moreProcEl = Array.from(document.querySelectorAll('button, input[type="button"], input[type="submit"]')).find((el) =>
            /more\s+procedure/i.test(norm(el.textContent || el.value || ''))
          ) || null;
          const totalProcEl2 = labels2.find((el) => /total\s+proc\s+fee/i.test(norm(el.textContent || ''))) || null;
          if (procHeaderEl2) {
            const top = procHeaderEl2.getBoundingClientRect().bottom + 2;
            let bottom = top + 260;
            if (moreProcEl) bottom = Math.min(bottom, moreProcEl.getBoundingClientRect().top - 2);
            if (totalProcEl2) bottom = Math.min(bottom, totalProcEl2.getBoundingClientRect().top - 2);
            const scoped = allTextLike
              .map((el) => ({ el, r: el.getBoundingClientRect() }))
              .filter(({ r }) => r.top >= top && r.bottom <= bottom && r.left >= 0)
              .sort((a, b) => (a.r.top - b.r.top) || (a.r.left - b.r.left));
            if (scoped.length) {
              const rowsByY = [];
              for (const item of scoped) {
                const row = rowsByY.find((g) => Math.abs(g.y - item.r.top) <= 8);
                if (row) row.items.push(item);
                else rowsByY.push({ y: item.r.top, items: [item] });
              }
              rowsByY.sort((a, b) => a.y - b.y);
              const targetGroup = rowsByY[Math.max(0, rowIndex - 1)] || null;
              if (targetGroup && targetGroup.items.length) {
                const groupItems = targetGroup.items.sort((a, b) => a.r.left - b.r.left).map((x) => x.el);
                const groupCandidates = groupItems.filter((x) => {
                  const idn = `${x.name || ''} ${x.id || ''}`.toLowerCase();
                  return !/proc|procedure|desc|name/.test(idn);
                });
                const pickPool = groupCandidates.length ? groupCandidates : groupItems.slice(1);
                for (const inp of pickPool.sort((a, b) => {
                  const la = a.getBoundingClientRect().left || 0;
                  const lb = b.getBoundingClientRect().left || 0;
                  return lb - la;
                })) {
                  if (setValue(inp, claimValue)) return true;
                }
              }
            }
          }
          return false;
        },
        { rowIndex, claimValue, procNameNorm }
      )
      .catch(() => false);

    if (ok) {
      this._logStep('Procedure claim amount filled (fallback)', { rowIndex, claim: claimValue });
    } else {
      const debug = await this.page
        .evaluate(({ rowIndex }) => {
          const norm = (s) => (s || '').toString().replace(/\s+/g, ' ').trim().toLowerCase();
          const isVisible = (el) => {
            if (!el) return false;
            const style = window.getComputedStyle(el);
            if (!style) return false;
            if (style.display === 'none' || style.visibility === 'hidden') return false;
            const r = el.getBoundingClientRect();
            return !!r && r.width > 0 && r.height > 0;
          };
          const labels = Array.from(document.querySelectorAll('th, td, div, span, label, b, strong'));
          const procHeaderEl = labels.find((el) => /procedure\s*name/i.test(norm(el.textContent || ''))) || null;
          const totalProcEl = labels.find((el) => /total\s+proc\s+fee/i.test(norm(el.textContent || ''))) || null;
          const top = procHeaderEl ? procHeaderEl.getBoundingClientRect().bottom + 2 : 0;
          const bottom = totalProcEl ? totalProcEl.getBoundingClientRect().top - 2 : Number.POSITIVE_INFINITY;
          const inputs = Array.from(
            document.querySelectorAll('input[type="text"], input[type="number"], input[type="tel"], input:not([type]), select, textarea')
          )
            .filter((el) => isVisible(el))
            .map((el) => {
              const r = el.getBoundingClientRect();
              return {
                name: el.getAttribute('name') || '',
                id: el.getAttribute('id') || '',
                type: (el.getAttribute('type') || '').toLowerCase(),
                value: (el.value || '').toString(),
                left: Math.round(r.left),
                top: Math.round(r.top),
                width: Math.round(r.width),
                inProcBand: r.top >= top && r.bottom <= bottom,
              };
            });
          const procInputs = inputs.filter((x) => x.inProcBand).sort((a, b) => (a.top - b.top) || (a.left - b.left));
          return {
            rowIndex,
            procHeaderTop: Math.round(top),
            procBottom: Number.isFinite(bottom) ? Math.round(bottom) : null,
            procInputs: procInputs.slice(0, 20),
            claimLike: procInputs.filter((x) => /claim|clm/i.test(`${x.name} ${x.id}`)).slice(0, 10),
          };
        }, { rowIndex })
        .catch(() => null);
      logger.warn('[MHC] Procedure claim fallback failed', { rowIndex, claimValue, debug });
    }
    return ok;
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
          if ((await button.count().catch(() => 0)) > 0 && (await button.isVisible().catch(() => true))) {
            const beforeUrl = this.page.url();
            const navPromise = this.page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 8000 }).catch(() => null);
            const dialogPromise = this.page.waitForEvent('dialog', { timeout: 2000 }).catch(() => null);
            await this._safeClick(button, 'Compute claim');
            const dialog = await dialogPromise;
            if (dialog) {
              const msg = dialog.message?.() || '';
              logger.warn(`Dialog during Compute claim: ${msg}`);
              await dialog.accept().catch(() => {});
            }
            await navPromise;
            await this.page.waitForLoadState('domcontentloaded', { timeout: 8000 }).catch(() => {});
            await this.page.waitForTimeout(700);
            this._logStep('Compute claim clicked', { urlChanged: beforeUrl !== (this.page.url() || '') });
            return true;
          }
        } catch (e) {
          continue;
        }
      }

      // Fallback: some portals render it as an <input type="button" value="Compute claim"> inside a form table.
      const clicked = await this.page
        .evaluate(() => {
          const candidates = Array.from(document.querySelectorAll('button, input[type="button"], input[type="submit"]'));
          const norm = (s) => (s || '').toString().replace(/\s+/g, ' ').trim().toLowerCase();
          for (const el of candidates) {
            const label = norm(el.textContent || el.value || el.getAttribute('aria-label') || '');
            if (!label) continue;
            if (label === 'compute claim' || label === 'compute') {
              el.click();
              el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
              return true;
            }
          }
          return false;
        })
        .catch(() => false);
      if (clicked) {
        await this.page.waitForLoadState('domcontentloaded', { timeout: 8000 }).catch(() => {});
        await this.page.waitForTimeout(700);
        this._logStep('Compute claim clicked (JS fallback)');
        return true;
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
        'tr:has-text("Charge Type") select',
        'tr:has-text("Charge Type*") select',
        'tr:has-text("Visit Type") select',
        'select[name="subType"]',
        'select[name*="subType" i]',
        'select[name*="charge" i]',
        'select[id*="charge" i]',
        'select[name*="visitType" i]',
        'select[id*="visitType" i]',
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

      // Robust fallback: pick the first select whose options include First/Follow/Repeat.
      const fallback = await this.page
        .evaluate((wantFollow) => {
          const norm = (s) => (s || '').toString().replace(/\s+/g, ' ').trim().toLowerCase();
          const root = document.querySelector('#visit_form') || document;
          const selects = Array.from(root.querySelectorAll('select'));
          const wantRe = wantFollow ? /follow/i : /first/i;
          for (const sel of selects) {
            const opts = Array.from(sel.options || []);
            if (!opts.length) continue;
            const labels = opts.map((o) => norm(o.textContent || o.label || o.value || ''));
            const hasChargeOptions = labels.some((t) => /first|follow|repeat/.test(t));
            if (!hasChargeOptions) continue;
            const idx = labels.findIndex((t) => wantRe.test(t));
            if (idx >= 0) {
              sel.value = opts[idx].value;
              sel.dispatchEvent(new Event('change', { bubbles: true }));
              return { success: true, value: opts[idx].value, label: opts[idx].textContent || opts[idx].label || '' };
            }
          }
          return { success: false };
        }, chargeType.toLowerCase().includes('follow'))
        .catch(() => ({ success: false }));
      
      if (fallback?.success) {
        this._logStep('Charge type set via fallback select scan', fallback);
        return true;
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
      await this.page.screenshot({ path: 'screenshots/mhc-charge-type-not-found.png', fullPage: true }).catch(() => {});
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
  setupDialogHandler(opts = {}) {
    const { reset = true } = opts;
    // Track if AIA Clinic switch is needed (dialog says "submit under www.aiaclinic.com")
    if (reset || typeof this.needsAIAClinicSwitch !== 'boolean') this.needsAIAClinicSwitch = false;
    // Track if Singlife switch is needed (Aviva -> Singlife)
    if (reset || typeof this.needsSinglifeSwitch !== 'boolean') this.needsSinglifeSwitch = false;
    // Keep the last dialog message for better error reporting/routing.
    if (reset || typeof this.lastDialogMessage !== 'string') this.lastDialogMessage = null;
    if (reset || typeof this.lastDialogType !== 'string') this.lastDialogType = null;
    
    // Remove existing dialog handlers to avoid duplicates
    this.page.removeAllListeners('dialog');
    
    this.page.on('dialog', async (dialog) => {
      try {
        const msg = dialog.message();
        this.lastDialogMessage = msg;
        this.lastDialogType = dialog.type();
        logger.info(`Dialog appeared: ${dialog.type()} - ${msg}`);

        // IMPORTANT: accept immediately. Querying DOM while an alert is open can deadlock.
        await dialog.accept();
        logger.info('Dialog accepted');

        // Route flags are message-driven; avoid DOM checks in dialog callback.
        if (/aiaclinic\.com|aia\s*clinic/i.test(msg)) {
          const currentUrl = this.page.url() || '';
          const alreadyOnAia = /aiaclinic\.com/i.test(currentUrl);
          if (!alreadyOnAia) {
            this.needsAIAClinicSwitch = true;
            logger.info('AIA Clinic switch will be needed after dialog dismissal');
          } else {
            logger.info('AIA Clinic dialog ignored (already in AIA Clinic system)');
          }
        }

        if (/singlife|aviva/i.test(msg)) {
          this.needsSinglifeSwitch = true;
          logger.info('Singlife switch will be needed after dialog dismissal');
        }
      } catch (e) {
        // Dialog may already be handled if multiple fire rapidly
        if (!e.message.includes('already handled')) {
          logger.warn('Dialog handling error:', e.message);
        }
      }
    });
    this._logStep('Dialog handler set up');
  }

  /**
   * Select diagnosis from dropdown by searching for a keyword
   * The dropdown name is "diagnosisPriIdTemp" for primary diagnosis
   * @param {string|{code?:string,description?:string}} searchTerm - Term (or diagnosis object) to search for in diagnosis options
   */
  async selectDiagnosis(searchTerm) {
    try {
      this._logStep('Select diagnosis from dropdown', { searchTerm });
      
      const escapeRegExp = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

      const terms = [];
      let codeOnly = null;
      let descOnly = null;
      if (searchTerm && typeof searchTerm === 'object') {
        const code = String(searchTerm.code || '').trim();
        const desc = String(searchTerm.description || '').trim();
        if (code) {
          codeOnly = code;
          terms.push(code);
          if (code.includes('.')) terms.push(code.replace(/\./g, ''));
        }
        if (desc) {
          descOnly = desc;
          terms.push(desc);
        }
      } else if (searchTerm) {
        descOnly = String(searchTerm).trim();
        terms.push(descOnly);
      }

      const primary = terms.find((t) => t && t.length >= 2) || '';
      if (!primary) {
        logger.warn('Search term too short');
        return false;
      }

      // Create multiple search patterns:
      // 1. Description-based patterns (preferred)
      // 2. Individual words
      // 3. Diagnosis code variants (fallback)
      const searchPatterns = [];
      const buildCodeVariants = (code) => {
        const c = String(code || '').replace(/\s+/g, '').toUpperCase();
        if (!c) return [];
        const noDot = c.replace(/\./g, '');
        const noTrailingZeros = noDot.replace(/0+$/g, '');
        const m = c.match(/^([A-Z]\d{2,3})\.?(\d+)?$/);
        const base = m?.[1] || null;
        const suffix = m?.[2] || null;
        const short1 = base && suffix ? `${base}${suffix.slice(0, 1)}` : null;
        const short2 = base && suffix ? `${base}${suffix.slice(0, 2)}` : null;
        return Array.from(
          new Set([c, noDot, noTrailingZeros, base, short2, short1].filter((x) => x && x.length >= 3))
        );
      };

      const codeVariants = codeOnly ? buildCodeVariants(codeOnly) : [];
      for (const v of codeVariants) {
        // Match code at start of option label like "S635 - ..." or "S63.5 - ..."
        searchPatterns.push(new RegExp(`\\b${escapeRegExp(v)}\\b`, 'i'));
        if (/^[A-Z]\d{2,3}\d+$/i.test(v)) {
          // Also allow a dot between base and suffix: S635 -> S63.5
          const base = v.slice(0, 3);
          const rest = v.slice(3);
          searchPatterns.push(new RegExp(`\\b${escapeRegExp(base)}\\.${escapeRegExp(rest)}\\b`, 'i'));
        }
      }

      const normalizeDescKeywords = (desc) => {
        const stop = new Set([
          'sprain',
          'strain',
          'pain',
          'ache',
          'with',
          'without',
          'part',
          'parts',
          'region',
          'other',
          'others',
          'oth',
          'unspecified',
          'unsp',
          'site',
          'body',
        ]);
        return String(desc || '')
          .toLowerCase()
          .replace(/[^a-z0-9\s]/g, ' ')
          .split(/\s+/)
          .filter((w) => w.length >= 4)
          .filter((w) => !stop.has(w));
      };
      const descKeywords = descOnly ? normalizeDescKeywords(descOnly) : [];
      
      // Conservative default: avoid false positives; leave blank if below threshold.
      const dropdownMinScore = Number(process.env.MHC_DIAG_MIN_SCORE_DROPDOWN || '50');
      // Try the diagnosis dropdown
      const diagSelectors = [
        'select[name="diagnosisPriIdTemp"]',
        'select[name*="diagnosisPri" i]',
        'select[name*="diagnosis" i]',
      ];

      let lastOptionsSample = null;
      
      for (const selector of diagSelectors) {
        try {
          const select = this.page.locator(selector).first();
          if ((await select.count().catch(() => 0)) > 0) {
            const options = await select.locator('option').evaluateAll((opts) =>
              opts.map((o) => ({ value: o.value, label: (o.textContent || '').trim() }))
            );
            lastOptionsSample = options.slice(0, 40);
            
            // 1) Prefer description-based matching when we have a description.
            let targetOption = null;
            if (descOnly) {
              const desc = String(descOnly).toLowerCase();
              const keywords = descKeywords;
              const score = (opt) => {
                const l = String((opt?.label || '') + ' ' + (opt?.value || '')).toLowerCase();
                let s = 0;
                for (const k of keywords) if (l.includes(k)) s += 10;
                return s;
              };

              if (keywords.length === 0) {
                this._logStep('Diagnosis scoring skipped (no meaningful keywords)', { desc: desc.slice(0, 120) });
              } else {
                let best = null;
                let bestScore = 0;
                for (const o of options) {
                  const sc = score(o);
                  if (sc > bestScore) {
                    bestScore = sc;
                    best = o;
                  }
                }
              if (best && bestScore >= dropdownMinScore) targetOption = best;
            }
            }

            // 2) If still no match, try code patterns (fallback).
            if (!targetOption && searchPatterns.length) {
              for (const pattern of searchPatterns) {
                targetOption = options.find((o) => pattern.test((o.label || '') + ' ' + (o.value || '')));
                if (targetOption) break;
              }
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

      if (lastOptionsSample && lastOptionsSample.length) {
        this._logStep('Diagnosis dropdown options sample (no match)', {
          sample: lastOptionsSample.map((o) => ({ label: String(o.label || '').slice(0, 60), value: String(o.value || '').slice(0, 60) })),
        });
      }
      
      // Try JavaScript fallback
      const selected = await this.page.evaluate((termSrc) => {
        const escapeRegExp = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const select = document.querySelector('select[name="diagnosisPriIdTemp"]');
        if (select) {
          const regex = new RegExp(escapeRegExp(termSrc), 'i');
          for (const opt of select.options) {
            if (regex.test(opt.text)) {
              select.value = opt.value;
              select.dispatchEvent(new Event('change', { bubbles: true }));
              return { success: true, value: opt.value, text: opt.text };
            }
          }
        }
        return { success: false };
      }, primary);
      
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
