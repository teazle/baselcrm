import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { logger } from '../utils/logger.js';
import { PORTALS } from '../config/portals.js';
import { resolveDiagnosisAgainstPortalOptions } from './clinic-assist.js';

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
    this.lastDiagnosisSelection = null;
    this.lastDiagnosisResolutionCheck = null;
    this.lastWaiverReferralState = null;
    this.lastSaveDraftResult = null;
    this.lastDiagnosisPrefetch = null;
    this.lastDrugSelectionByRow = {};
    this.lastPortalGateState = null;
    this._lastLoginSubmitAt = 0;
    const baseUserDataDir = String(process.env.PLAYWRIGHT_USER_DATA_DIR || '').trim()
      ? path.resolve(String(process.env.PLAYWRIGHT_USER_DATA_DIR || '').trim())
      : path.join(os.homedir(), '.playwright-browser-data');
    this.loginThrottleStatePath = String(process.env.MHC_LOGIN_STATE_PATH || '').trim()
      ? path.resolve(String(process.env.MHC_LOGIN_STATE_PATH || '').trim())
      : path.join(baseUserDataDir, 'mhc-login-state.json');
    this.authStatePath = String(process.env.MHC_AUTH_STATE_PATH || '').trim()
      ? path.resolve(String(process.env.MHC_AUTH_STATE_PATH || '').trim())
      : path.join(baseUserDataDir, 'mhc-auth-state.json');
  }

  /**
   * Ensure we're at the main MHC portal home (not inside AIA Clinic pages).
   * This is important between patients: after switching system to AIA Clinic,
   * the left-nav contains "AIA Visit" links that can confuse generic selectors.
   */
  async _readPersistedAuthState() {
    try {
      const raw = await fs.readFile(this.authStatePath, 'utf8');
      const parsed = JSON.parse(raw || '{}');
      return {
        lastAuthenticatedUrl: String(parsed?.lastAuthenticatedUrl || '').trim() || null,
        savedAt: String(parsed?.savedAt || '').trim() || null,
      };
    } catch {
      return {
        lastAuthenticatedUrl: null,
        savedAt: null,
      };
    }
  }

  async _writePersistedAuthState(url = null) {
    const value = String(url || '').trim();
    if (!value) return;
    try {
      await fs.mkdir(path.dirname(this.authStatePath), { recursive: true });
      await fs.writeFile(
        this.authStatePath,
        `${JSON.stringify(
          {
            lastAuthenticatedUrl: value,
            savedAt: new Date().toISOString(),
          },
          null,
          2
        )}\n`,
        'utf8'
      );
    } catch (error) {
      logger.warn('[MHC] Failed to persist authenticated portal URL', {
        error: error?.message || String(error),
      });
    }
  }

  async _tryResumePersistedAuthenticatedPage() {
    const authState = await this._readPersistedAuthState();
    const resumeUrl = authState?.lastAuthenticatedUrl || null;
    if (!resumeUrl) return false;
    this._logStep('Try resume persisted authenticated page', {
      resumeUrl,
      savedAt: authState?.savedAt || null,
    });
    try {
      await this.page.goto(resumeUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await this.page.waitForTimeout(800);
      const normalVisitVisible = await this.page
        .locator('a:has-text("Normal Visit"), a:has-text("Add Normal Visit")')
        .first()
        .isVisible()
        .catch(() => false);
      const logoutVisible = await this.page
        .locator('text=/Log\\s*Out/i')
        .first()
        .isVisible()
        .catch(() => false);
      const passwordVisible = await this.page
        .locator('input[type="password"], input[name="txtPassword"], input[name*="password" i]')
        .first()
        .isVisible()
        .catch(() => false);
      if ((normalVisitVisible || logoutVisible) && !passwordVisible) {
        this.isAiaClinicSystem = false;
        this.isSinglifeSystem = false;
        await this._writePersistedAuthState(this.page.url() || resumeUrl);
        return true;
      }
    } catch (error) {
      logger.warn('[MHC] Failed to resume persisted authenticated page', {
        error: error?.message || String(error),
      });
    }
    return false;
  }

  async ensureAtMhcHome() {
    this._logStep('Ensure at MHC home');

    const currentUrl = this.page.url() || '';
    const onMhc = /\/mhc\//i.test(currentUrl) && !/aiaclinic|pcpcare|singlife/i.test(currentUrl);
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
      .locator(
        'button:has-text("SIGN IN"), input[type="submit"][value*="SIGN" i], button:has-text("LOGIN")'
      )
      .first()
      .isVisible()
      .catch(() => false);
    const loginVisibleNow = passwordVisibleNow && (userVisibleNow || loginBtnVisibleNow);
    const navVisibleNow = await this.page
      .locator(
        'a:has-text("Normal Visit"), a:has-text("Add Normal Visit"), a:has-text("Add AIA Visit")'
      )
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
        await this._writePersistedAuthState(this.page.url() || currentUrl);
        return true;
      }
    }

    const resumed = await this._tryResumePersistedAuthenticatedPage();
    if (resumed) {
      return true;
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
      await this._writePersistedAuthState(this.page.url() || this.config.url);
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
      await this._writePersistedAuthState(this.page.url() || this.config.url);
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
      .locator(
        'button:has-text("SIGN IN"), input[type="submit"][value*="SIGN" i], button:has-text("LOGIN")'
      )
      .first()
      .isVisible()
      .catch(() => false);
    const loginVisible = passwordVisible && (userVisible || loginBtnVisible);
    const gateState = await this._detectPortalGateState();
    if (gateState?.captchaBlocked) {
      await this.page
        .screenshot({ path: 'screenshots/mhc-asia-home-captcha-blocked.png', fullPage: true })
        .catch(() => {});
      throw this._buildPortalBlockedError('portal_captcha_blocked', {
        gateState,
      });
    }
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

  async _detectPortalGateState() {
    const state = await this.page
      .evaluate(() => {
        const clean = value =>
          String(value || '')
            .replace(/\s+/g, ' ')
            .trim();
        const bodyText = clean(document.body?.innerText || '');
        const _lower = bodyText.toLowerCase();
        return {
          url: location.href,
          title: document.title,
          bodyText,
          csrfDetected: /csrf\s+detected/i.test(bodyText),
          captchaBlocked:
            /invalid\s+captcha/i.test(bodyText) ||
            /captcha/i.test(bodyText) ||
            /please\s+verify\s+you\s+are\s+human/i.test(bodyText),
          authFailure:
            /not\s+able\s+to\s+authenticate/i.test(bodyText) ||
            /authentication\s+failed/i.test(bodyText) ||
            /oops,\s*we\s+are\s+not\s+able\s+to\s+authenticate/i.test(bodyText),
          logoutVisible: /log\s*out/i.test(bodyText),
        };
      })
      .catch(() => ({
        url: this.page.url() || '',
        title: '',
        bodyText: '',
        csrfDetected: false,
        captchaBlocked: false,
        authFailure: false,
        logoutVisible: false,
      }));
    this.lastPortalGateState = {
      ...state,
      checkedAt: new Date().toISOString(),
    };
    return this.lastPortalGateState;
  }

  _buildPortalBlockedError(reason, meta = {}) {
    const err = new Error(reason);
    err.code = reason;
    err.portalBlocked = true;
    err.submissionMetadata = {
      success: false,
      portal: 'MHC Asia',
      reason,
      blocked_reason: reason,
      sessionState: reason === 'portal_captcha_blocked' ? 'captcha_blocked' : 'blocked',
      checkedAt: new Date().toISOString(),
      ...(meta || {}),
    };
    return err;
  }

  async _readLoginThrottleState() {
    try {
      const raw = await fs.readFile(this.loginThrottleStatePath, 'utf8');
      const parsed = JSON.parse(raw || '{}');
      return {
        lastLoginSubmitAt: Number(parsed?.lastLoginSubmitAt || 0) || 0,
      };
    } catch {
      return { lastLoginSubmitAt: 0 };
    }
  }

  async _writeLoginThrottleState(lastLoginSubmitAt) {
    try {
      await fs.mkdir(path.dirname(this.loginThrottleStatePath), { recursive: true });
      await fs.writeFile(
        this.loginThrottleStatePath,
        `${JSON.stringify({ lastLoginSubmitAt }, null, 2)}\n`,
        'utf8'
      );
    } catch (error) {
      logger.warn('[MHC] Failed to persist shared login throttle state', {
        error: error?.message || String(error),
      });
    }
  }

  async _waitForLoginThrottle(attempt = 1) {
    const minGapMs = Number.parseInt(process.env.MHC_LOGIN_MIN_GAP_MS || '8000', 10);
    const sharedState = await this._readLoginThrottleState();
    const lastSeenSubmitAt = Math.max(
      this._lastLoginSubmitAt || 0,
      sharedState?.lastLoginSubmitAt || 0
    );
    const now = Date.now();
    const elapsed = now - lastSeenSubmitAt;
    if (lastSeenSubmitAt && elapsed < minGapMs) {
      const waitMs = minGapMs - elapsed;
      this._logStep('Login throttle wait', { waitMs, attempt });
      await this.page.waitForTimeout(waitMs).catch(() => {});
    } else if (attempt > 1) {
      const retryBackoffMs = Number.parseInt(process.env.MHC_LOGIN_RETRY_BACKOFF_MS || '6000', 10);
      this._logStep('Login retry backoff', { waitMs: retryBackoffMs, attempt });
      await this.page.waitForTimeout(retryBackoffMs).catch(() => {});
    }
  }

  _shouldRetryLoginError(error, attempt, maxAttempts) {
    if (!error || attempt >= maxAttempts) return false;
    if (error.portalBlocked === true) return false;
    const code = String(error.code || '')
      .trim()
      .toLowerCase();
    if (code === 'csrf_detected') return true;
    if (code === 'login_navigation_timeout') return true;
    return false;
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

        await this._waitForLoginThrottle(attempt);

        // Avoid 'networkidle' here; MHC pages can keep long-polling connections open.
        await this.page.goto(this.config.url, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await this.page.waitForTimeout(800);

        const preLoginState = await this._detectPortalGateState();
        if (preLoginState?.captchaBlocked) {
          await this.page
            .screenshot({ path: 'screenshots/mhc-asia-login-captcha-blocked.png', fullPage: true })
            .catch(() => {});
          throw this._buildPortalBlockedError('portal_captcha_blocked', {
            gateState: preLoginState,
          });
        }
        if (preLoginState?.csrfDetected) {
          logger.warn('[MHC] CSRF detected before login attempt; resetting session');
          await this._resetMhcSession('csrf-pre-login').catch(() => {});
          const csrfError = new Error('csrf_detected');
          csrfError.code = 'csrf_detected';
          throw csrfError;
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
          await this._writePersistedAuthState(this.page.url() || this.config.url);
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
              .evaluateAll(opts =>
                opts.map(o => ({ value: o.value, label: (o.textContent || '').trim() }))
              )
              .catch(() => []);
            const match = options.find(o => /singapore/i.test(o.label));
            if (!match) continue;
            await sel
              .selectOption({ value: match.value })
              .catch(async () => sel.selectOption({ label: match.label }));
            await this.page.waitForTimeout(250);
            this._logStep('Country selected (best-effort)', { label: match.label });
            break;
          }
        } catch {
          // ignore
        }

        // Wait for login form
        await this.page.waitForSelector(
          'input[type="text"], input[name*="username"], input[id*="username"]',
          {
            timeout: 10000,
          }
        );

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
          await this.page.screenshot({
            path: 'screenshots/mhc-asia-login-page.png',
            fullPage: true,
          });
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
          this._lastLoginSubmitAt = Date.now();
          await this._writeLoginThrottleState(this._lastLoginSubmitAt);
          await passwordField.press('Enter');
          logger.info('Pressed Enter to submit');
        } else {
          this._lastLoginSubmitAt = Date.now();
          await this._writeLoginThrottleState(this._lastLoginSubmitAt);
          await loginButton.click();
          logger.info('Login button clicked');
        }

        // Wait for navigation - ultra minimal wait times
        await this.page.waitForLoadState('domcontentloaded').catch(() => {});
        await this.page
          .locator('text=/Log\\s*Out/i')
          .first()
          .waitFor({ state: 'attached', timeout: 1500 })
          .catch(() => {});

        const postLoginState = await this._detectPortalGateState();
        if (postLoginState?.captchaBlocked) {
          logger.error(`Login challenge detected: ${postLoginState.bodyText}`);
          await this.page
            .screenshot({ path: 'screenshots/mhc-asia-login-captcha-blocked.png', fullPage: true })
            .catch(() => {});
          throw this._buildPortalBlockedError('portal_captcha_blocked', {
            gateState: postLoginState,
          });
        }
        if (postLoginState?.csrfDetected) {
          logger.warn('[MHC] CSRF detected after login submit');
          await this.page
            .screenshot({ path: 'screenshots/mhc-asia-login-csrf.png', fullPage: true })
            .catch(() => {});
          await this._resetMhcSession('csrf-after-login').catch(() => {});
          const csrfError = new Error('csrf_detected');
          csrfError.code = 'csrf_detected';
          throw csrfError;
        }

        if (postLoginState?.authFailure && !postLoginState?.logoutVisible) {
          logger.error(`Login error detected: ${postLoginState.bodyText}`);
          await this.page
            .screenshot({ path: 'screenshots/mhc-asia-login-error.png', fullPage: true })
            .catch(() => {});
          const authError = new Error('Authentication failed');
          authError.code = 'auth_failed';
          throw authError;
        }

        await this.page.waitForLoadState('domcontentloaded').catch(() => {});
        logger.info(`Successfully logged into ${this.config.name}`);
        this._logStep('Login ok');
        this._lastLoginAt = Date.now();
        await this._writePersistedAuthState(this.page.url() || this.config.url);
        return true;
      } catch (error) {
        logger.error(`Login failed for ${this.config.name}:`, error);
        await this.page
          .screenshot({ path: 'screenshots/mhc-asia-login-error.png', fullPage: true })
          .catch(() => {});
        if (!this._shouldRetryLoginError(error, attempt, maxAttempts)) throw error;
      } finally {
        this._loginInProgress = false;
      }
    }

    throw new Error('Login failed');
  }

  async _resetMhcSession(reason = 'unknown') {
    this._logStep('Reset MHC session', { reason });
    await this.page
      .context()
      .clearCookies()
      .catch(() => {});
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
    await this.page
      .goto(this.config.url, { waitUntil: 'domcontentloaded', timeout: 60000 })
      .catch(() => {});
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
    await this.page
      .screenshot({ path: 'screenshots/singlife-pcp-login.png', fullPage: true })
      .catch(() => {});

    if (!username || !password) {
      logger.warn(
        'Singlife PCP login required but credentials not set (SINGLIFE_PCP_* or MHC_ASIA_*)'
      );
      return false;
    }

    // Best-effort: fill USER ID + PASSWORD and click SIGN IN.
    const userIdField = this.page
      .locator('input[name="username"], input[name="userId"], input[type="text"]')
      .first();
    const passField = this.page.locator('input[type="password"]').first();
    const signInBtn = this.page
      .locator('button:has-text("SIGN IN"), input[type="submit"], button[type="submit"]')
      .first();

    if (
      (await userIdField.count().catch(() => 0)) === 0 ||
      (await passField.count().catch(() => 0)) === 0
    ) {
      logger.warn('Singlife PCP login: could not locate credential fields');
      await this.page
        .screenshot({ path: 'screenshots/singlife-pcp-login-fields-not-found.png', fullPage: true })
        .catch(() => {});
      return false;
    }

    await userIdField.fill(username).catch(() => {});
    await passField.fill(password).catch(() => {});
    if ((await signInBtn.count().catch(() => 0)) > 0)
      await this._safeClick(signInBtn, 'Singlife PCP: Sign in');
    else await passField.press('Enter').catch(() => {});

    await this.page.waitForLoadState('domcontentloaded').catch(() => {});
    await this.page.waitForTimeout(800);

    const stillOnLogin = await this.page
      .locator('text=/Singlife\\s+Preferred\\s+Care\\s+Plus/i')
      .first()
      .isVisible()
      .catch(() => false);
    await this.page
      .screenshot({ path: 'screenshots/singlife-pcp-after-login.png', fullPage: true })
      .catch(() => {});
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
      .locator(
        'button:has-text("Save As Draft"), input[value*="Save As Draft" i], input[value*="Save Draft" i]'
      )
      .first()
      .isVisible()
      .catch(() => false);
    if (onClaimForm) {
      const targetMeta = await locator
        .first()
        .evaluate(el => {
          const text = (el.textContent || '').trim();
          const value = (el.getAttribute('value') || '').trim();
          const aria = (el.getAttribute('aria-label') || '').trim();
          const type = (el.getAttribute('type') || '').trim().toLowerCase();
          return { text, value, aria, type };
        })
        .catch(() => null);
      const combined =
        `${targetMeta?.text || ''} ${targetMeta?.value || ''} ${targetMeta?.aria || ''}`.toLowerCase();
      const safeLabel = String(label || '').toLowerCase();
      const isSubmitLike =
        /\bsubmit\b/.test(combined) ||
        (targetMeta?.type === 'submit' && !/search|find/.test(combined));
      const isDraftAction =
        /save\s+as\s+draft|save\s+draft/.test(combined) ||
        /save\s+as\s+draft|save\s+draft/.test(safeLabel);
      const isComputeAction =
        /compute\s*claim|\bcompute\b/.test(combined) ||
        /compute\s*claim|\bcompute\b/.test(safeLabel);
      if (isSubmitLike && !isDraftAction && !isComputeAction) {
        logger.error('[MHC] Blocked unsafe submit click on claim form', {
          label,
          target: targetMeta,
          url: this.page.url(),
        });
        await this.page
          .screenshot({ path: 'screenshots/mhc-asia-blocked-submit-click.png', fullPage: true })
          .catch(() => {});
        throw new Error('Blocked unsafe submit click on claim form');
      }
    }
    let clicked = false;
    let clickError = null;
    try {
      await locator.click({ timeout: timeoutMs });
      clicked = true;
    } catch (error) {
      clickError = error;
      try {
        await locator.click({ timeout: timeoutMs, force: true });
        clicked = true;
      } catch (forcedError) {
        clickError = forcedError;
      }
    }
    // Avoid waiting for networkidle (many portals keep connections open)
    await this.page.waitForLoadState('domcontentloaded', { timeout: 3000 }).catch(() => {});
    await this.page.waitForTimeout(200); // Reduced wait
    if (clicked && label) logger.info(`Clicked: ${label}`);
    if (!clicked) {
      logger.warn('[MHC] Click failed', {
        label: label || null,
        error: clickError?.message || null,
        url: this.page.url(),
      });
    }
    return clicked;
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
      .locator(
        'a:has-text("Switch System"), button:has-text("Switch System"), text=/Switch\\s+System/i'
      )
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

  _extractSwitchSystemHref(rawValue) {
    const raw = String(rawValue || '').trim();
    if (!raw) return null;
    if (/switchsystem\.ec/i.test(raw)) {
      try {
        return new URL(raw, this.page.url()).toString();
      } catch {
        return raw;
      }
    }
    const fromQuery = raw.match(/[?&]url=([^&]+)/i)?.[1] || null;
    if (fromQuery) {
      try {
        return decodeURIComponent(fromQuery);
      } catch {
        return fromQuery;
      }
    }
    if (/^https?:\/\//i.test(raw)) return raw;
    return null;
  }

  async _collectVisibleSystemSwitchOptions(targetRegex, opts = {}) {
    const includeHidden = opts?.includeHidden === true;
    return this.page
      .evaluate(
        (regexSource, regexFlags, includeHiddenOptions) => {
          const rx = new RegExp(regexSource, regexFlags);
          const norm = s =>
            String(s || '')
              .replace(/\s+/g, ' ')
              .trim();
          const isVisible = el => {
            if (!el) return false;
            const style = window.getComputedStyle(el);
            if (!style) return false;
            if (style.display === 'none' || style.visibility === 'hidden') return false;
            const r = el.getBoundingClientRect();
            return !!r && r.width > 0 && r.height > 0;
          };
          const options = [];
          for (const a of Array.from(document.querySelectorAll('a[href]'))) {
            const text = norm(a.textContent || a.getAttribute('title') || '');
            if (!text || !rx.test(text)) continue;
            if (!includeHiddenOptions && !isVisible(a)) continue;
            options.push({
              kind: 'anchor',
              text,
              href: String(a.getAttribute('href') || '').trim(),
              selectorHint: String(a.id || '').trim() || null,
            });
          }
          for (const sel of Array.from(document.querySelectorAll('select'))) {
            if (!includeHiddenOptions && !isVisible(sel)) continue;
            for (const opt of Array.from(sel.options || [])) {
              const text = norm(opt.textContent || opt.label || '');
              if (!text || !rx.test(text)) continue;
              options.push({
                kind: 'option',
                text,
                value: String(opt.value || '').trim(),
                selectName: String(sel.getAttribute('name') || '').trim() || null,
                selectId: String(sel.id || '').trim() || null,
              });
            }
          }
          return options;
        },
        targetRegex.source,
        targetRegex.flags,
        includeHidden
      )
      .catch(() => []);
  }

  async _collectSwitchSystemDebugTargets(targetRegex) {
    return this.page
      .evaluate(
        (regexSource, regexFlags) => {
          const rx = new RegExp(regexSource, regexFlags);
          const norm = s =>
            String(s || '')
              .replace(/\s+/g, ' ')
              .trim();
          const isVisible = el => {
            if (!el) return false;
            const style = window.getComputedStyle(el);
            if (!style) return false;
            if (style.display === 'none' || style.visibility === 'hidden') return false;
            const r = el.getBoundingClientRect();
            return !!r && r.width > 0 && r.height > 0;
          };

          const out = [];
          const nodes = Array.from(
            document.querySelectorAll('a, option, li, div, span, td, button')
          );
          for (const el of nodes) {
            const text = norm(el.textContent || el.getAttribute('title') || '');
            const href = String(el.getAttribute('href') || '').trim();
            const onclick = String(el.getAttribute('onclick') || '').trim();
            const interesting =
              rx.test(text) ||
              /switchsystem\.ec/i.test(href) ||
              /switchsystem\.ec/i.test(onclick) ||
              /aia\s*clinic/i.test(text);
            if (!interesting) continue;
            out.push({
              tag: (el.tagName || '').toLowerCase(),
              text,
              href: href || null,
              onclick: onclick || null,
              id: String(el.id || '').trim() || null,
              className: String(el.className || '').trim() || null,
              visible: isVisible(el),
            });
            if (out.length >= 40) break;
          }
          return out;
        },
        targetRegex.source,
        targetRegex.flags
      )
      .catch(() => []);
  }

  async _collectSwitchSystemHrefCandidatesAcrossFrames(targetRegex) {
    const collectFromRoot = async (root, source) => {
      const rows = await root
        .evaluate(
          (regexSource, regexFlags) => {
            const rx = new RegExp(regexSource, regexFlags);
            const norm = s =>
              String(s || '')
                .replace(/\s+/g, ' ')
                .trim();
            const out = [];
            for (const a of Array.from(document.querySelectorAll('a[href], area[href]'))) {
              const text = norm(a.textContent || a.getAttribute('title') || '');
              const href = String(a.getAttribute('href') || '').trim();
              if (!href) continue;
              const interesting =
                rx.test(text) ||
                rx.test(href) ||
                /switchsystem\.ec/i.test(href) ||
                /aiaclinic\.com/i.test(href) ||
                /pcpcare|singlife|myglobalbenefit/i.test(href);
              if (!interesting) continue;
              out.push({ text, href });
              if (out.length >= 80) break;
            }
            return out;
          },
          targetRegex.source,
          targetRegex.flags
        )
        .catch(() => []);
      return (rows || []).map(r => ({ ...r, source }));
    };

    const all = [];
    all.push(...(await collectFromRoot(this.page, 'page')));
    for (const frame of this.page.frames()) {
      if (frame === this.page.mainFrame()) continue;
      const frameLabel = frame.url() ? `frame:${frame.url()}` : 'frame';
      all.push(...(await collectFromRoot(frame, frameLabel)));
    }

    const seen = new Set();
    const filtered = [];
    for (const row of all) {
      const key = `${row.href}::${row.source}`;
      if (!row.href || seen.has(key)) continue;
      seen.add(key);
      filtered.push(row);
    }
    return filtered;
  }

  _getDefaultSwitchSystemUrl(targetRegex, labelForLog = '') {
    const source = String(targetRegex?.source || '').toLowerCase();
    const label = String(labelForLog || '').toLowerCase();
    if (/aia/.test(source) || /aia/.test(label)) {
      return 'SwitchSystem.ec?url=https://www.aiaclinic.com';
    }
    if (/singlife|aviva|pcp/.test(source) || /singlife|aviva|pcp/.test(label)) {
      return 'SwitchSystem.ec?url=https://www.pcpcare.com';
    }
    return null;
  }

  _parseDiagnosisCandidate(text) {
    const t = this._normalizeText(text);
    if (!t) return null;
    const m =
      t.match(
        /(?:\bDx\b|\bDiagnosis\b|\bImpression\b|\bAssessment\b)\s*[:\-]\s*([^\n\r;.]{3,80})/i
      ) || t.match(/(?:\bDx\b|\bDiagnosis\b)\s+([^\n\r;.]{3,80})/i);
    if (m?.[1]) return this._normalizeText(m[1]);
    const head = t
      .split(/[.\n\r]/)
      .map(x => this._normalizeText(x))
      .find(x => x.length >= 4);
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
        const options = await select
          .locator('option')
          .evaluateAll(opts =>
            opts.map(o => ({ value: o.value, label: (o.textContent || '').trim() }))
          );
        const match =
          options.find(o => desired.test(o.label)) || options.find(o => desired.test(o.value));
        if (!match) continue;
        await select
          .selectOption({ value: match.value })
          .catch(async () => select.selectOption({ label: match.label }));
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
        .evaluate(val => {
          const norm = s => (s || '').toString().replace(/\s+/g, ' ').trim();
          const isVisible = el => {
            if (!el) return false;
            const style = window.getComputedStyle(el);
            if (!style) return false;
            if (style.display === 'none' || style.visibility === 'hidden') return false;
            const rect = el.getBoundingClientRect();
            if (!rect || rect.width <= 0 || rect.height <= 0) return false;
            return true;
          };
          const _sameNumeric = (a, b) => {
            const n1 = Number(String(a || '').trim());
            const n2 = Number(String(b || '').trim());
            if (!Number.isFinite(n1) || !Number.isFinite(n2)) return false;
            return Math.abs(n1 - n2) < 1e-9;
          };
          const cells = Array.from(document.querySelectorAll('td, th, label, span, b, strong'));
          const label = cells.find(el => /^MC\s*Start\s*Date\b/i.test(norm(el.textContent)));
          if (!label) return { ok: false, reason: 'label_not_found' };
          const row = label.closest('tr');
          if (!row) return { ok: false, reason: 'row_not_found' };
          const inputs = Array.from(
            row.querySelectorAll('input[type="text"], input:not([type])')
          ).filter(x => isVisible(x));
          if (!inputs.length) return { ok: false, reason: 'input_not_found' };
          // Prefer the widest field (usually the date text input).
          inputs.sort(
            (a, b) =>
              (b.getBoundingClientRect().width || 0) - (a.getBoundingClientRect().width || 0)
          );
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
        this._logStep('MC start date filled (row label scan)', {
          value: rowFilled.value || valueToSet,
        });
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
      await this.page
        .screenshot({ path: 'screenshots/mhc-mc-start-date-not-found.png', fullPage: true })
        .catch(() => {});
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
      .evaluate(
        ({ clear }) => {
          const norm = s => (s || '').toString().replace(/\s+/g, ' ').trim();
          const isVisible = el => {
            if (!el) return false;
            const style = window.getComputedStyle(el);
            if (!style) return false;
            if (style.display === 'none' || style.visibility === 'hidden') return false;
            return true;
          };
          const cells = Array.from(document.querySelectorAll('td, th, label, span, b, strong'));
          const label = cells.find(el => /^MC\s*Start\s*Date\b/i.test(norm(el.textContent)));
          if (!label) return { ok: false, reason: 'label_not_found' };
          const row = label.closest('tr');
          if (!row) return { ok: false, reason: 'row_not_found' };
          const inputs = Array.from(
            row.querySelectorAll('input[type="text"], input:not([type])')
          ).filter(x => isVisible(x));
          if (!inputs.length) return { ok: false, reason: 'input_not_found' };
          inputs.sort(
            (a, b) =>
              (b.getBoundingClientRect().width || 0) - (a.getBoundingClientRect().width || 0)
          );
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
        },
        { clear }
      )
      .catch(() => ({ ok: false, reason: 'evaluate_failed' }));

    if (result?.ok) {
      this._logStep('MC start date normalized', result);
      return true;
    }
    return false;
  }

  async fillDiagnosisFromText(diagnosisText) {
    this._logStep('Fill diagnosis (best-effort)', {
      sample: (diagnosisText || '').toString().slice(0, 80) || null,
    });
    const candidate = this._parseDiagnosisCandidate(diagnosisText);
    if (!candidate) {
      logger.warn('No diagnosis text found to map into MHC diagnosis fields');
      return false;
    }

    const words = candidate
      .split(/\s+/)
      .map(w => w.replace(/[^\w]/g, ''))
      .filter(w => w.length >= 4)
      .slice(0, 3);
    const rx = words.length
      ? new RegExp(words.join('|'), 'i')
      : new RegExp(candidate.slice(0, 10), 'i');

    const tryRow = async rowText => {
      const row = this.page.locator(`tr:has-text("${rowText}")`).first();
      if ((await row.count().catch(() => 0)) === 0) return false;
      const select = row.locator('select').first();
      if ((await select.count().catch(() => 0)) === 0) return false;
      const options = await select
        .locator('option')
        .evaluateAll(opts =>
          opts.map(o => ({ value: o.value, label: (o.textContent || '').trim() }))
        );
      const match = options.find(o => rx.test(o.label)) || options.find(o => rx.test(o.value));
      if (!match) return false;
      await select
        .selectOption({ value: match.value })
        .catch(async () => select.selectOption({ label: match.label }));
      return true;
    };

    const ok =
      (await tryRow('Diagnosis Pri')) ||
      (await tryRow('Diagnosis Primary')) ||
      (await tryRow('Diagnosis'));
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
          const norm = s => (s || '').replace(/\s+/g, ' ').trim();
          const isVisible = el => {
            if (!el) return false;
            const style = window.getComputedStyle(el);
            if (!style) return false;
            if (style.display === 'none' || style.visibility === 'hidden') return false;
            // In headless or table layouts, getBoundingClientRect can be 0 even for usable fields.
            // We accept these inputs since we are only pre-filling for review.
            return true;
          };
          const textOf = el => norm(el?.innerText || el?.textContent || '');

          // Anchor to the *closest* table for the header cell so we don't accidentally pick an outer layout table
          // that contains nested tables (common on MHC/Singlife forms).
          const headerCell = Array.from(document.querySelectorAll('th, td')).find(c =>
            headerRe.test(textOf(c))
          );
          if (!headerCell) return { filled: 0 };

          const table = headerCell.closest('table');
          const headerRow = headerCell.closest('tr');
          if (!table || !headerRow) return { filled: 0 };

          const rows = Array.from(table.querySelectorAll('tr')).filter(
            r => r.closest('table') === table
          );
          const startIdx = rows.indexOf(headerRow);
          if (startIdx < 0) return { filled: 0 };

          const rowCellsWithSpan = row =>
            Array.from(row.querySelectorAll('th, td')).map(c => ({
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
                const inputs = Array.from(
                  c.querySelectorAll('input[type="text"], input:not([type]), textarea')
                ).filter(x => isVisible(x));
                if (!inputs.length) continue;
                inputs.sort(
                  (a, b) => b.getBoundingClientRect().width - a.getBoundingClientRect().width
                );
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
              const rowInputs = Array.from(
                rows[i].querySelectorAll('input[type="text"], input:not([type]), textarea')
              );
              input = rowInputs.find(x => isVisible(x)) || null;
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
    this.lastDrugSelectionByRow = {};
    const skipProcedures = options?.skipProcedures === true;
    const isJunkLine = s => {
      const n = String(s || '')
        .trim()
        .replace(/\s+/g, ' ');
      if (!n) return true;
      const lower = n.toLowerCase();
      // Common junk that leaks from Clinic Assist extraction / directions.
      if (/^[\d.,]+$/.test(lower)) return true;
      if (/^\$?\s*\d+(?:\.\d+)?\s*(?:sgd)?\s*$/i.test(n)) return true;
      if (/^\d+(?:\.\d+)?\s*(?:tabs?|tab|caps?|cap|pcs?|pc|sachets?|pkt|packs?)\b/i.test(lower))
        return true;
      if (/^\d+(?:\.\d+)?\s*(?:mg|g|ml|mcg|iu)\b/i.test(lower)) return true;
      if (lower.startsWith('unfit for ')) return true;
      if (lower.startsWith('for ')) return true;
      if (lower.includes('may cause')) return true;
      if (lower.includes('complete whole course')) return true;
      if (lower.includes('complete the whole course')) return true;
      if (lower.includes('course of medicine') || lower.includes('course of med')) return true;
      if (lower.startsWith('take ') || lower.startsWith('apply ') || lower.startsWith('use '))
        return true;
      if (/^to be taken\b/i.test(lower) || /\bto be taken\b/i.test(lower)) return true;
      return false;
    };

    const list = (items || [])
      .map(x => {
        if (typeof x === 'string')
          return {
            name: this._normalizeText(x),
            quantity: null,
            unit: null,
            unitPrice: null,
            amount: null,
          };
        const name = this._normalizeText(x?.name || x?.description || '');
        const quantityRaw = x?.quantity ?? x?.qty ?? x?.qtyValue ?? x?.qtyText ?? null;
        const quantity =
          quantityRaw === null || quantityRaw === undefined ? null : String(quantityRaw).trim();
        const unit = x?.unit ?? x?.uom ?? x?.unitCode ?? null;
        const unitPriceRaw = x?.unitPrice ?? x?.unit_price ?? x?.price ?? null;
        const amountRaw = x?.amount ?? x?.lineAmount ?? x?.total ?? null;
        const unitPrice =
          unitPriceRaw === null || unitPriceRaw === undefined ? null : String(unitPriceRaw).trim();
        const amount =
          amountRaw === null || amountRaw === undefined ? null : String(amountRaw).trim();
        return { name, quantity, unit, unitPrice, amount };
      })
      .map(x => ({ ...x, name: (x.name || '').toString().trim().replace(/\s+/g, ' ') }))
      .filter(x => x.name && !isJunkLine(x.name));
    if (!list.length) return false;

    const procedures = [];
    const drugs = [];
    const skippedProcedureLikes = [];
    const procedureLikeRe =
      /(xray|x-ray|scan|ultrasound|procedure|physio|physiotherapy|ecg|injection|dressing|suturing|vaccine|mri|ct\b|dexa|density|bmd|radiolog|radiology|imaging|consultation|consult\b|medical\s+expenses?)/i;
    for (const it of list) {
      const isProcedureLike = procedureLikeRe.test(it.name);
      if (isProcedureLike) {
        if (skipProcedures) {
          skippedProcedureLikes.push(it.name);
          continue;
        }
        procedures.push(it.name);
        continue;
      }
      drugs.push(it);
    }

    if (skipProcedures) {
      logger.info('[MHC] Procedure fill skipped by policy for this run', {
        skippedCount: skippedProcedureLikes.length,
        skippedSample: skippedProcedureLikes.slice(0, 5),
      });
    }

    let drugFilled = 0;
    for (let i = 0; i < Math.min(3, drugs.length); i++) {
      if (i > 0) await this.clickMoreDrug().catch(() => {});
      const quantity = drugs[i].quantity ?? '1';
      const unit = drugs[i].unit ?? null;
      const amountRaw = String(drugs[i].amount ?? '').trim();
      const unitPriceRaw = String(drugs[i].unitPrice ?? '').trim();
      const qn = Number.parseFloat(String(quantity).replace(/[^\d.]/g, ''));
      const amountNum = Number.parseFloat(amountRaw.replace(/[^\d.]/g, ''));
      const priceNum = Number.parseFloat(unitPriceRaw.replace(/[^\d.]/g, ''));
      const amount =
        Number.isFinite(amountNum) && amountNum > 0 ? String(Number(amountNum.toFixed(4))) : null;
      const unitPriceDerived =
        Number.isFinite(priceNum) && priceNum > 0
          ? String(Number(priceNum.toFixed(4)))
          : Number.isFinite(amountNum) && amountNum > 0 && Number.isFinite(qn) && qn > 0
            ? String(Number((amountNum / qn).toFixed(4)))
            : null;
      const ok = await this.fillDrugItem(
        { name: drugs[i].name, quantity, unit, unitPrice: unitPriceDerived, amount },
        i + 1
      ).catch(() => false);
      if (ok) {
        drugFilled += 1;
        // Ensure qty is filled even when the direct fill couldn't locate the qty cell.
        const qtyFallbackOk = await this.fillDrugQuantityFallback(i + 1, quantity).catch(
          () => false
        );
        const qtyVerified = await this.verifyDrugQuantity(i + 1, quantity).catch(() => false);
        if (!qtyFallbackOk || !qtyVerified) {
          logger.warn(`Drug qty may be missing for row ${i + 1} (${drugs[i].name})`);
        }
        const masterResolved = this.lastDrugSelectionByRow?.[i + 1]?.fromMaster === true;
        const portalContext = this._inferPortalContext();
        if ((unitPriceDerived || amount) && !masterResolved && portalContext === 'aia') {
          this._logStep('Skip AIA drug pricing fallback without resolved drug master code', {
            rowIndex: i + 1,
            drug: drugs[i].name,
            unitPrice: unitPriceDerived,
            amount,
          });
        } else if (unitPriceDerived || amount) {
          const pricingOk = await this.fillDrugPricingFallback(i + 1, {
            unit,
            quantity,
            unitPrice: unitPriceDerived,
            amount,
          }).catch(() => false);
          const pricingVerified = await this.verifyDrugPricing(i + 1, {
            unitPrice: unitPriceDerived,
            amount,
          }).catch(() => false);
          if (!pricingOk || !pricingVerified) {
            logger.warn(`Drug pricing may be missing for row ${i + 1} (${drugs[i].name})`, {
              unitPrice: unitPriceDerived,
              amount,
            });
          }
        }
      }
    }
    if (drugs.length && drugFilled === 0) {
      drugFilled = (
        await this._fillTextInputsInTableSection(
          /Drug Name/i,
          /Total Drug Fee/i,
          drugs.map(d => d.name)
        )
      ).filled;
      // When the generic table fill is used, the Qty column is not touched. Ensure it is set.
      for (let i = 0; i < Math.min(3, drugs.length); i++) {
        const quantity = drugs[i].quantity ?? '1';
        const qtyFallbackOk = await this.fillDrugQuantityFallback(i + 1, quantity).catch(
          () => false
        );
        const qtyVerified = await this.verifyDrugQuantity(i + 1, quantity).catch(() => false);
        if (!qtyFallbackOk || !qtyVerified) {
          logger.warn(`Drug qty may be missing for row ${i + 1} (${drugs[i].name})`);
        }
      }
    }

    let procFilled = (
      await this._fillTextInputsInTableSection(/Procedure Name/i, /Total Proc Fee/i, procedures)
    ).filled;
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
      const amountOk = await this.fillProcedureClaimAmountFallback(i + 1, '0', procedures[i]).catch(
        () => false
      );
      if (!amountOk) {
        logger.warn(`Procedure claim amount may be missing for row ${i + 1} (${procedures[i]})`);
      }
    }

    logger.info(`Filled services/drugs into MHC: drugs=${drugFilled}, procedures=${procFilled}`);
    await this.page
      .screenshot({ path: 'screenshots/mhc-asia-after-items.png', fullPage: true })
      .catch(() => {});
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
      const has2FA =
        pageText.includes('Verification Code') ||
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
        const submitButton = await this.page.$(
          'button[type="submit"], button:has-text("Submit"), button:has-text("Verify")'
        );
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
        await this.page.screenshot({
          path: 'screenshots/mhc-asia-normal-visit-not-found.png',
          fullPage: true,
        });
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

      await this.page.screenshot({
        path: 'screenshots/mhc-asia-patient-search.png',
        fullPage: true,
      });
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

      const clickProgramTile = async kind => {
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
            if (
              (await tile.count().catch(() => 0)) > 0 &&
              (await tile.isVisible().catch(() => false))
            ) {
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
            if (
              (await tile.count().catch(() => 0)) > 0 &&
              (await tile.isVisible().catch(() => false))
            ) {
              await this._safeClick(tile, 'Search under AIA Program (tile)');
              await this.page.waitForTimeout(600);
              return true;
            }
          }
          return false;
        }

        return false;
      };

      const searchOne = async termToSearch => {
        const term = String(termToSearch || '').trim();
        if (!term) return { nric: '', portal: null, found: false, usedTerm: '' };

        this._logStep('Search patient', { term });
        logger.info(`Searching patient: ${term}`);

        const termCompact = term.replace(/\s+/g, '');
        const termNorm = termCompact.toUpperCase();
        if (termCompact.length < 5) {
          logger.warn('Search term too short; aborting search to avoid portal validation error', {
            term,
          });
          return {
            nric: term,
            portal: null,
            found: false,
            memberNotFound: true,
            _invalidTerm: true,
          };
        }
        if (!/\d/.test(termCompact)) {
          logger.warn('Search term has no digits; MHC requires NRIC/FIN/Member ID', { term });
          return {
            nric: term,
            portal: null,
            found: false,
            memberNotFound: true,
            _invalidTerm: true,
          };
        }

        // Ensure we are on the base MHC portal before searching.
        const urlNow = this.page.url() || '';
        if (!/\/mhc\//i.test(urlNow) || /aiaclinic|pcpcare|singlife/i.test(urlNow)) {
          await this.ensureAtMhcHome().catch(() => {});
        }

        const _isLikelyId = /^(?:[STFGM]\d{7}[A-Z]|\d{6,}|[A-Z]\d{7}[A-Z])$/i.test(
          term.replace(/\s+/g, '')
        );
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
              const placeholderAttr =
                (await field.getAttribute('placeholder').catch(() => '')) || '';
              const ariaLabel = (await field.getAttribute('aria-label').catch(() => '')) || '';
              const attrText =
                `${nameAttr} ${idAttr} ${placeholderAttr} ${ariaLabel}`.toLowerCase();
              const rowText = await field
                .evaluate(el => el.closest('tr')?.innerText || el.closest('tr')?.textContent || '')
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
              const hasNricHints =
                /nric|fin|member/i.test(attrText) || /nric|fin|member/i.test(rowLower);
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

        const _isNricSearchField = async field => {
          if (!field) return false;
          return await field
            .evaluate(el => {
              const norm = s => (s || '').toString().replace(/\s+/g, ' ').trim().toLowerCase();
              const row = el.closest('tr');
              const rowText = norm(row?.innerText || row?.textContent || '');
              const labelText = norm(el.closest('td, th')?.textContent || '');
              const name =
                `${el.getAttribute('name') || ''} ${el.getAttribute('id') || ''} ${el.getAttribute('placeholder') || ''} ${el.getAttribute('aria-label') || ''}`.toLowerCase();
              const hasNric =
                /nric|fin|member/.test(name) ||
                /nric|fin|member/.test(rowText) ||
                /nric|fin|member/.test(labelText);
              const isDateLike =
                /visit\s*date|dd\/mm|mm\/dd|yyyy/.test(rowText) || /date/.test(name);
              return hasNric && !isDateLike;
            })
            .catch(() => false);
        };

        const _setInputValue = async (field, value) => {
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
            if (
              (await tile.count().catch(() => 0)) > 0 &&
              (await tile.isVisible().catch(() => false))
            )
              return true;
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
            if (
              (await normalVisitLink.count().catch(() => 0)) > 0 &&
              (await normalVisitLink.isVisible().catch(() => false))
            ) {
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
              const hasInput = await frame
                .locator(selectors)
                .first()
                .isVisible()
                .catch(() => false);
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
            const needsTiles = !searchVisible;
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
                .waitForSelector(
                  'tr:has-text("NRIC/FIN/Member ID") input, tr:has-text("NRIC/FIN/Member ID") input:not([type])',
                  {
                    timeout: 1500,
                  }
                )
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
              .waitForSelector(
                'tr:has-text("NRIC/FIN/Member ID") input, tr:has-text("NRIC/FIN/Member ID") input:not([type])',
                {
                  timeout: 1500,
                }
              )
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
            const nameField = await findVisibleEditableField(
              nameSelectors,
              { requireNricHints: false },
              searchCtx
            );
            if (nameField) await nameField.fill('').catch(() => {});
            if (idField) await idField.fill('').catch(() => {});
          } catch {
            // ignore
          }
          if (!idField) {
            await this.page
              .screenshot({ path: 'screenshots/mhc-asia-missing-nric-field.png', fullPage: true })
              .catch(() => {});
            logger.warn(
              'NRIC search field not found; aborting search to avoid typing into Visit Date'
            );
            return {
              nric: term,
              portal: null,
              found: false,
              memberNotFound: true,
              _missingNricField: true,
            };
          }

          let searchTriggered = false;
          const readRowValue = async ctx =>
            ctx
              .evaluate(() => {
                const norm = s => (s || '').toString().replace(/\s+/g, ' ').trim().toLowerCase();
                const cells = Array.from(document.querySelectorAll('th, td'));
                const labelCell = cells.find(c =>
                  /nric\s*\/\s*fin\s*\/\s*member\s*id/i.test(norm(c.textContent || ''))
                );
                const row = labelCell?.closest('tr') || null;
                if (!row) return '';
                const getAttrText = el => {
                  const name = el.getAttribute('name') || '';
                  const id = el.getAttribute('id') || '';
                  const placeholder = el.getAttribute('placeholder') || '';
                  return `${name} ${id} ${placeholder}`.toLowerCase();
                };
                const isDateLike = el => {
                  const attrs = getAttrText(el);
                  if (/date|dd\/mm|mm\/dd|yyyy/.test(attrs)) return true;
                  const cellText = norm(el.closest('td, th')?.textContent || '');
                  if (/visit\s*date|dd\/mm|mm\/dd|yyyy/.test(cellText)) return true;
                  const rowText = norm(row.innerText || row.textContent || '');
                  if (/visit\s*date/.test(rowText) && !/nric|fin|member/.test(cellText))
                    return true;
                  const val = (el.value || '').toString();
                  return /\d{1,2}\/\d{1,2}\/\d{2,4}/.test(val);
                };
                const inputs = Array.from(row.querySelectorAll('input')).filter(el => {
                  const type = (el.getAttribute('type') || '').toLowerCase();
                  return (
                    type !== 'hidden' && type !== 'button' && type !== 'submit' && type !== 'image'
                  );
                });
                if (!inputs.length) return '';
                let input = inputs.find(el => /nric|fin|member/.test(getAttrText(el))) || null;
                if (!input) input = inputs.find(el => !isDateLike(el)) || null;
                if (!input) return '';
                return (input?.value || '').toString();
              })
              .catch(() => '');

          const fillRowAndClickSearch = async (ctx, value) =>
            ctx
              .evaluate(term => {
                const norm = s => (s || '').toString().replace(/\s+/g, ' ').trim().toLowerCase();
                const cells = Array.from(document.querySelectorAll('th, td'));
                const labelCell = cells.find(c =>
                  /nric\s*\/\s*fin\s*\/\s*member\s*id/i.test(norm(c.textContent || ''))
                );
                const row = labelCell?.closest('tr') || null;
                if (!row) return { ok: false, clicked: false, value: '', reason: 'row_not_found' };
                const inputs = Array.from(row.querySelectorAll('input')).filter(el => {
                  const type = (el.getAttribute('type') || '').toLowerCase();
                  return (
                    type !== 'hidden' && type !== 'button' && type !== 'submit' && type !== 'image'
                  );
                });
                if (!inputs.length)
                  return { ok: false, clicked: false, value: '', reason: 'input_not_found' };
                const getAttrText = el => {
                  const name = el.getAttribute('name') || '';
                  const id = el.getAttribute('id') || '';
                  const placeholder = el.getAttribute('placeholder') || '';
                  return `${name} ${id} ${placeholder}`.toLowerCase();
                };
                const isDateLike = el => {
                  const attrs = getAttrText(el);
                  if (/date|dd\/mm|mm\/dd|yyyy/.test(attrs)) return true;
                  const cellText = norm(el.closest('td, th')?.textContent || '');
                  if (/visit\s*date|dd\/mm|mm\/dd|yyyy/.test(cellText)) return true;
                  const rowText = norm(row.innerText || row.textContent || '');
                  if (/visit\s*date/.test(rowText) && !/nric|fin|member/.test(cellText))
                    return true;
                  const val = (el.value || '').toString();
                  return /\d{1,2}\/\d{1,2}\/\d{2,4}/.test(val);
                };
                let input = inputs.find(el => /nric|fin|member/.test(getAttrText(el))) || null;
                if (!input) input = inputs.find(el => !isDateLike(el)) || null;
                if (!input) return { ok: false, clicked: false, value: '', reason: 'date_only' };
                const rows = Array.from(document.querySelectorAll('tr'));
                const nameRow = rows.find(r =>
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
                const termCompact = String(term || '')
                  .replace(/\s+/g, '')
                  .toUpperCase();
                const ok = compact.includes(termCompact) && compact.length >= 5;
                let clicked = false;
                if (ok) {
                  const btns = Array.from(
                    row.querySelectorAll('button, input[type="submit"], input[type="button"]')
                  );
                  const searchBtn =
                    btns.find(b => /search/i.test((b.textContent || b.value || '').toString())) ||
                    null;
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
              .evaluate(term => {
                const norm = s => (s || '').toString().replace(/\s+/g, ' ').trim().toLowerCase();
                const cells = Array.from(document.querySelectorAll('th, td'));
                const labelCell = cells.find(c =>
                  /nric\s*\/\s*fin\s*\/\s*member\s*id/i.test(norm(c.textContent || ''))
                );
                const row = labelCell?.closest('tr') || null;
                if (!row) return { ok: false, reason: 'row_not_found', value: '' };
                const inputs = Array.from(row.querySelectorAll('input')).filter(el => {
                  const type = (el.getAttribute('type') || '').toLowerCase();
                  return (
                    type !== 'hidden' && type !== 'button' && type !== 'submit' && type !== 'image'
                  );
                });
                if (!inputs.length) return { ok: false, reason: 'input_not_found', value: '' };
                const getAttrText = el => {
                  const name = el.getAttribute('name') || '';
                  const id = el.getAttribute('id') || '';
                  const placeholder = el.getAttribute('placeholder') || '';
                  return `${name} ${id} ${placeholder}`.toLowerCase();
                };
                const isDateLike = el => {
                  const attrs = getAttrText(el);
                  if (/date|dd\/mm|mm\/dd|yyyy/.test(attrs)) return true;
                  const cellText = norm(el.closest('td, th')?.textContent || '');
                  if (/visit\s*date|dd\/mm|mm\/dd|yyyy/.test(cellText)) return true;
                  const rowText = norm(row.innerText || row.textContent || '');
                  if (/visit\s*date/.test(rowText) && !/nric|fin|member/.test(cellText))
                    return true;
                  const val = (el.value || '').toString();
                  return /\d{1,2}\/\d{1,2}\/\d{2,4}/.test(val);
                };
                let input = inputs.find(el => /nric|fin|member/.test(getAttrText(el))) || null;
                if (!input) input = inputs.find(el => !isDateLike(el)) || null;
                if (!input) return { ok: false, reason: 'date_only', value: '' };
                const rows = Array.from(document.querySelectorAll('tr'));
                const nameRow = rows.find(r =>
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
                return { ok: true, value: valueNow };
              }, value)
              .catch(() => ({ ok: false, value: '' }));

          const clickRowSearch = async ctx =>
            ctx
              .evaluate(() => {
                const norm = s => (s || '').toString().replace(/\s+/g, ' ').trim().toLowerCase();
                const cells = Array.from(document.querySelectorAll('th, td'));
                const labelCell = cells.find(c =>
                  /nric\s*\/\s*fin\s*\/\s*member\s*id/i.test(norm(c.textContent || ''))
                );
                const row = labelCell?.closest('tr') || null;
                if (!row) return false;
                const inputs = Array.from(row.querySelectorAll('input')).filter(el => {
                  const type = (el.getAttribute('type') || '').toLowerCase();
                  return (
                    type !== 'hidden' && type !== 'button' && type !== 'submit' && type !== 'image'
                  );
                });
                if (!inputs.length) return false;
                const getAttrText = el => {
                  const name = el.getAttribute('name') || '';
                  const id = el.getAttribute('id') || '';
                  const placeholder = el.getAttribute('placeholder') || '';
                  return `${name} ${id} ${placeholder}`.toLowerCase();
                };
                const isDateLike = el => {
                  const attrs = getAttrText(el);
                  if (/date|dd\/mm|mm\/dd|yyyy/.test(attrs)) return true;
                  const cellText = norm(el.closest('td, th')?.textContent || '');
                  if (/visit\s*date|dd\/mm|mm\/dd|yyyy/.test(cellText)) return true;
                  const rowText = norm(row.innerText || row.textContent || '');
                  if (/visit\s*date/.test(rowText) && !/nric|fin|member/.test(cellText))
                    return true;
                  const val = (el.value || '').toString();
                  return /\d{1,2}\/\d{1,2}\/\d{2,4}/.test(val);
                };
                let input = inputs.find(el => /nric|fin|member/.test(getAttrText(el))) || null;
                if (!input) input = inputs.find(el => !isDateLike(el)) || null;
                if (!input) return false;
                const val = (input.value || '').toString().replace(/\s+/g, '');
                if (val.length < 5) return false;
                const btns = Array.from(
                  row.querySelectorAll('button, input[type="submit"], input[type="button"]')
                );
                const searchBtn =
                  btns.find(b => /search/i.test((b.textContent || b.value || '').toString())) ||
                  null;
                if (!searchBtn) return false;
                searchBtn.click();
                return true;
              })
              .catch(() => false);

          const directRowFill = await searchCtx
            .evaluate(term => {
              const norm = s => (s || '').toString().replace(/\s+/g, ' ').trim().toLowerCase();
              const cells = Array.from(document.querySelectorAll('th, td'));
              const labelCell = cells.find(c =>
                /nric\s*\/\s*fin\s*\/\s*member\s*id/i.test(norm(c.textContent || ''))
              );
              const row = labelCell?.closest('tr') || null;
              if (!row) return { ok: false, clicked: false, value: '', reason: 'row_not_found' };
              const getAttrText = el => {
                const name = el.getAttribute('name') || '';
                const id = el.getAttribute('id') || '';
                const placeholder = el.getAttribute('placeholder') || '';
                return `${name} ${id} ${placeholder}`.toLowerCase();
              };
              const isDateLike = el => {
                const attrs = getAttrText(el);
                if (/date|dd\/mm|mm\/dd|yyyy/.test(attrs)) return true;
                const cellText = norm(el.closest('td, th')?.textContent || '');
                if (/visit\s*date|dd\/mm|mm\/dd|yyyy/.test(cellText)) return true;
                const rowText = norm(row.innerText || row.textContent || '');
                if (/visit\s*date/.test(rowText) && !/nric|fin|member/.test(cellText)) return true;
                const val = (el.value || '').toString();
                return /\d{1,2}\/\d{1,2}\/\d{2,4}/.test(val);
              };
              const collectInputs = root =>
                Array.from(root.querySelectorAll('input')).filter(el => {
                  const type = (el.getAttribute('type') || '').toLowerCase();
                  return (
                    type !== 'hidden' && type !== 'button' && type !== 'submit' && type !== 'image'
                  );
                });
              let candidates = [];
              const nextCell = labelCell?.nextElementSibling || null;
              if (nextCell) candidates = collectInputs(nextCell);
              if (!candidates.length) candidates = collectInputs(row);
              if (!candidates.length)
                return { ok: false, clicked: false, value: '', reason: 'input_not_found' };
              let input = candidates.find(el => /nric|fin|member/.test(getAttrText(el))) || null;
              if (!input) input = candidates.find(el => !isDateLike(el)) || null;
              if (!input) return { ok: false, clicked: false, value: '', reason: 'date_only' };

              const nameRow = Array.from(document.querySelectorAll('tr')).find(r =>
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
              const termCompact = String(term || '')
                .replace(/\s+/g, '')
                .toUpperCase();
              const ok = compact.includes(termCompact) && compact.length >= 5;
              let clicked = false;
              if (ok) {
                const btns = Array.from(
                  row.querySelectorAll('button, input[type="submit"], input[type="button"]')
                );
                const searchBtn =
                  btns.find(b => /search/i.test((b.textContent || b.value || '').toString())) ||
                  null;
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

          const rowFill = directRowFill?.ok
            ? directRowFill
            : await fillRowAndClickSearch(searchCtx, term);
          if (rowFill?.ok && rowFill?.clicked) {
            searchTriggered = true;
          }

          const fastRow = await forceFillRow(searchCtx, term);
          const fastValue = String(fastRow?.value || '');
          const fastValueNorm = fastValue.replace(/\\s+/g, '').toUpperCase();
          const fastRowOk =
            fastRow?.ok && fastValueNorm.includes(termNorm) && fastValueNorm.length >= 5;

          // Only proceed when we positively identified the NRIC/FIN row. Never fill generic inputs.
          if (!fastRowOk && !directRowFill?.ok && !rowFill?.ok && !searchTriggered) {
            await this.page
              .screenshot({ path: 'screenshots/mhc-asia-before-search-field.png', fullPage: true })
              .catch(() => {});
            return {
              nric: term,
              portal: null,
              found: false,
              memberNotFound: false,
              _noField: true,
            };
          }

          // Safety: NEVER include generic submit selectors here. This flow is for patient search only.
          // Clicking a generic "Submit" can accidentally submit a claim form when page state is wrong.
          const rowBtnSelectors = [
            'button:has-text(\"Search\")',
            'input[type=\"submit\"][value*=\"Search\" i]',
            'input[type=\"button\"][value*=\"Search\" i]',
          ];

          let rowValue = rowFill?.value || (await readRowValue(searchCtx));
          let rowValueNorm = String(rowValue || '')
            .replace(/\\s+/g, '')
            .toUpperCase();
          if (!rowValueNorm || !rowValueNorm.includes(termNorm)) {
            const forced = await forceFillRow(searchCtx, term);
            rowValue = forced?.value || (await readRowValue(searchCtx));
            rowValueNorm = String(rowValue || '')
              .replace(/\\s+/g, '')
              .toUpperCase();
          }
          if (!rowValueNorm || rowValueNorm.length < 5 || !rowValueNorm.includes(termNorm)) {
            logger.warn('NRIC field value mismatch; aborting search click', {
              term,
              programKind,
              rowValue,
            });
            return {
              nric: term,
              portal: null,
              found: false,
              memberNotFound: false,
              _noField: true,
              _valueMismatch: true,
            };
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
              if (
                (await btn.count().catch(() => 0)) > 0 &&
                (await btn.isVisible().catch(() => true))
              ) {
                await btn.click();
                clicked = true;
                break;
              }
            }
          }
          if (!clicked && searchCtx !== this.page) {
            for (const sel of rowBtnSelectors) {
              const btn = this.page.locator(sel).first();
              if (
                (await btn.count().catch(() => 0)) > 0 &&
                (await btn.isVisible().catch(() => true))
              ) {
                await btn.click();
                clicked = true;
                break;
              }
            }
          }
          if (!clicked) throw new Error('Could not find Search button');
          await this.page.waitForTimeout(200);

          await this.page
            .screenshot({
              path: `screenshots/mhc-asia-before-search-click-${programKind}.png`,
              fullPage: true,
            })
            .catch(() => {});

          const valueNow = (await readRowValue(searchCtx)) || '';
          const valueNorm = valueNow.replace(/\\s+/g, '').toUpperCase();
          if (valueNorm.length < 5) {
            logger.warn('Search field value too short; aborting search result scan', {
              term,
              programKind,
              valueNow,
            });
            return {
              nric: term,
              portal: null,
              found: false,
              memberNotFound: true,
              _noField: true,
              _valueMismatch: true,
            };
          }
          const shortMsg = await this.page
            .locator('text=/at least\\s+5\\s+char/i')
            .first()
            .isVisible()
            .catch(() => false);
          if (shortMsg) {
            logger.warn('MHC portal rejected search: minimum 5 characters');
            return {
              nric: term,
              portal: null,
              found: false,
              memberNotFound: true,
              _invalidTerm: true,
            };
          }

          const collectResultInfo = async () => {
            const frames = this.page.frames();
            const infoAgg = { linkCount: 0, rowCount: 0, hasTermMatch: false };
            for (const frame of frames) {
              try {
                const info = await frame
                  .evaluate(t => {
                    const termLower = String(t || '')
                      .trim()
                      .toLowerCase();
                    const isPatientLink = a => {
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
                      const header =
                        (table.querySelector('thead') || table).innerText?.toLowerCase?.() || '';
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
                      if (text.includes('visit date') || text.includes('nric/fin/member id'))
                        continue;
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
            .screenshot({
              path: `screenshots/mhc-asia-search-results-${programKind}.png`,
              fullPage: true,
            })
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

          if (
            this.lastDialogMessage &&
            /please\s+enter\s+at\s+least\s+5/i.test(this.lastDialogMessage)
          ) {
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
            if (isLikelyName)
              return (
                resultInfo.linkCount === 1 || (resultInfo.rowCount === 1 && resultInfo.hasTermMatch)
              );
            return (
              resultInfo.linkCount >= 1 || (resultInfo.rowCount >= 1 && resultInfo.hasTermMatch)
            );
          })();

          if (memberNotFound && !hasPatientRow) {
            logger.warn('Member not found after search', { term, programKind });
            return { nric: term, portal: null, found: false, memberNotFound: true };
          }

          let portal = null;
          if (hasPatientRow) {
            const resultRowText = await this.page
              .evaluate(term => {
                const termLower = String(term || '')
                  .trim()
                  .toLowerCase();
                const tables = Array.from(document.querySelectorAll('table'));
                let resultTable = null;
                for (const table of tables) {
                  const header =
                    (table.querySelector('thead') || table).innerText?.toLowerCase?.() || '';
                  if (header.includes('patient id') && header.includes('patient name')) {
                    resultTable = table;
                    break;
                  }
                }
                const rows = Array.from((resultTable || document).querySelectorAll('tr'));
                const norm = s => (s || '').toString().replace(/\s+/g, ' ').trim().toLowerCase();
                if (termLower) {
                  const matched = rows.find(r =>
                    norm(r.innerText || r.textContent || '').includes(termLower)
                  );
                  if (matched) return (matched.innerText || matched.textContent || '').trim();
                }
                // Fallback: if only one data row, use it.
                const dataRows = rows.filter(r => {
                  const text = norm(r.innerText || r.textContent || '');
                  if (!text) return false;
                  if (text.includes('visit date') || text.includes('nric/fin/member id'))
                    return false;
                  return r.querySelectorAll('td').length > 0;
                });
                if (dataRows.length === 1)
                  return (dataRows[0].innerText || dataRows[0].textContent || '').trim();
                return '';
              }, term)
              .catch(() => '');
            const pageText = resultRowText || (await this.page.textContent('body').catch(() => ''));
            const portalPatterns = {
              aiaclient: /aiaclient/i,
              // Avoid false positives from header links; require PCP/Preferred Care context.
              singlife:
                /(singlife.*(pcp|preferred\\s+care|pcp\\s*sp|pcp\\s*programme|pcp\\s*program))|aviva/i,
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
          usedTerm: term,
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
  async openPatientFromSearchResults(nric, opts = {}) {
    try {
      const term = String(nric || '').trim();
      const preferredContext =
        String(opts?.preferredContext || '')
          .trim()
          .toLowerCase() || null;
      this._logStep('Open patient from results', { nric: term, preferredContext });
      logger.info('Opening patient from search results...');
      if (this.needsAIAClinicSwitch) {
        logger.warn('AIA Clinic switch already required; skipping patient open on MHC');
        return false;
      }

      const isLikelyId = /^(?:[STFGM]\d{7}[A-Z]|\d{6,}|[A-Z]\d{7}[A-Z])$/i.test(
        term.replace(/\s+/g, '')
      );
      const strictUnique = !isLikelyId; // For name-search, require unique match.

      // Search across frames for a result row/link.
      for (const frame of this.page.frames()) {
        try {
          const handle = await frame.evaluateHandle(
            ({ t, strict, preferred }) => {
              const termLower = String(t || '')
                .trim()
                .toLowerCase();
              const preferredContext = String(preferred || '')
                .trim()
                .toLowerCase();
              const isPatientLink = a => {
                const tt = (a.textContent || '').trim().toLowerCase();
                if (!tt) return false;
                if (tt === 'search') return false;
                if (tt === 'benefit') return false;
                if (tt === 'subsidiaries') return false;
                return true;
              };
              const contextScore = text => {
                const s = String(text || '').toLowerCase();
                if (!preferredContext) return 0;
                if (preferredContext === 'aia') {
                  let score = 0;
                  if (/aia\s*clinic|aiaclinic|cliniciecaia/i.test(s)) score += 240;
                  if (/singlife|pcpcare|aviva/i.test(s)) score -= 220;
                  return score;
                }
                if (preferredContext === 'singlife') {
                  let score = 0;
                  if (/singlife|pcpcare|aviva/i.test(s)) score += 240;
                  if (/aia\s*clinic|aiaclinic|cliniciecaia/i.test(s)) score -= 220;
                  return score;
                }
                if (preferredContext === 'mhc') {
                  let score = 0;
                  if (/mhc|medical\s*network|make\s*health\s*connect/i.test(s)) score += 40;
                  if (/aia\s*clinic|aiaclinic|singlife|pcpcare|aviva/i.test(s)) score -= 80;
                  return score;
                }
                return 0;
              };
              const hrefScore = href => {
                const s = String(href || '').toLowerCase();
                let score = 0;
                if (/empvisitadd|visitadd|empvisit/i.test(s)) score += 30;
                score += contextScore(s);
                return score;
              };

              // Prefer the dedicated result table when present.
              const tables = Array.from(document.querySelectorAll('table'));
              let resultTable = null;
              for (const table of tables) {
                const header =
                  (table.querySelector('thead') || table).innerText?.toLowerCase?.() || '';
                if (header.includes('patient id') && header.includes('patient name')) {
                  resultTable = table;
                  break;
                }
              }

              const root = resultTable || document;
              const rows = Array.from(root.querySelectorAll('tr'));

              const scoredCandidates = [];
              const rowCandidates = [];
              let rowIndex = 0;

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
                  for (const a of links) {
                    const linkText = (a.textContent || '').toLowerCase();
                    const href = String(a.getAttribute('href') || a.href || '').trim();
                    let score = 0;
                    const blob = `${text} ${linkText} ${href}`.toLowerCase();
                    if (termLower && blob.includes(termLower)) score += 140;
                    else if (termLower) score -= 60;
                    score += contextScore(blob);
                    score += hrefScore(href);
                    score += Math.max(0, 20 - rowIndex); // keep upper rows preferred when tied
                    scoredCandidates.push({ element: a, score, rowIndex });
                  }
                }
                rowIndex += 1;
              }

              const sortable = scoredCandidates.sort((a, b) => b.score - a.score);
              if (strict && sortable.length !== 1 && rowCandidates.length !== 1) return null;
              if (sortable[0]?.element) return sortable[0].element;
              if (rowCandidates.length === 1) return rowCandidates[0];
              if (!strict && rowCandidates.length > 0) return rowCandidates[0];
              return null;
            },
            { t: term, strict: strictUnique, preferred: preferredContext }
          );

          const el = handle?.asElement?.() || null;
          if (!el) {
            await handle.dispose().catch(() => {});
            continue;
          }

          const beforeUrl = this.page.url();
          const previousPage = this.page;
          const popupPromise = this.page
            .context()
            .waitForEvent('page', { timeout: 1500 })
            .catch(() => null);
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
          if (
            preferredContext &&
            preferredContext !== this._inferPortalContext() &&
            !this.needsAIAClinicSwitch
          ) {
            this._logStep('Patient row context mismatch after click', {
              expected: preferredContext,
              actual: this._inferPortalContext(),
              url: this.page.url(),
            });
            return false;
          }

          const checkVisitForm = async () => {
            const urlNow = this.page.url() || '';
            const hasEmployeeVisitAddHeader =
              (await this.page
                .locator('text=/Employee\\s+Visit\\s*-\\s*Add/i')
                .count()
                .catch(() => 0)) > 0;
            const hasChargeType =
              (await this.page
                .locator('text=/Charge\\s*Type/i')
                .count()
                .catch(() => 0)) > 0;
            const hasConsultFee =
              (await this.page
                .locator('text=/Consultation\\s+Fee/i')
                .count()
                .catch(() => 0)) > 0;
            const hasSaveDraft =
              (await this.page
                .locator('button:has-text(\"Save As Draft\"), input[value*=\"Save As Draft\" i]')
                .count()
                .catch(() => 0)) > 0;
            const hasDrugHeader =
              (await this.page
                .locator('text=/Drug\\s+Name/i')
                .count()
                .catch(() => 0)) > 0;
            return (
              /EmpVisitAdd|VisitAdd/i.test(urlNow) ||
              hasEmployeeVisitAddHeader ||
              (hasChargeType && (hasConsultFee || hasDrugHeader || hasSaveDraft))
            );
          };
          const isVisitForm = await checkVisitForm();

          await this.page.screenshot({
            path: 'screenshots/mhc-asia-patient-opened.png',
            fullPage: true,
          });
          if (isVisitForm) {
            this._logStep('Patient opened from results');
            return true;
          }

          const afterUrl = this.page.url();
          if (afterUrl === beforeUrl) {
            logger.warn('Patient click did not navigate away; still on search/results page');
          } else {
            logger.warn('Patient click navigated but visit form not detected', {
              from: beforeUrl,
              to: afterUrl,
            });
          }

          // Fallback: direct navigation to EmpVisitAdd/VisitAdd link in the results row.
          const directHref = await this.page
            .evaluate(needle => {
              const lowerNeedle = String(needle || '')
                .trim()
                .toLowerCase();
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
            await this.page
              .goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 15000 })
              .catch(() => {});
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

      await this.page
        .screenshot({ path: 'screenshots/mhc-asia-patient-open-not-found.png', fullPage: true })
        .catch(() => {});
      logger.warn('Could not open patient from search results', {
        term,
        strictUnique,
        preferredContext,
      });
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
      const portalNorm = String(portal || '')
        .trim()
        .toLowerCase();
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
      logger.info(
        `Adding visit for portal: ${portalNorm || '(base)'} (effective: ${effectivePortal || '(base)'})`
      );

      // Some portals require switching the system context (top-right "Switch System").
      // Singlife (ex-Aviva) should use the Singlife system; AIA uses AIA Clinic.
      // Base MHC should not switch system here (routing is done by pay_type).
      const forceSinglife = !isBaseMhc && /singlife|aviva/i.test(effectivePortal || '');
      const switchedToSinglife = forceSinglife
        ? await this.switchToSinglifeIfNeeded({ force: true })
        : false;

      // Check if we need to switch to AIA Clinic system (triggered by dialog handler).
      // Do NOT infer this from generic page text here; only switch when the flag is set.
      const allowAiaSwitch =
        this.needsAIAClinicSwitch === true &&
        /aia/i.test(effectivePortal || '') &&
        !switchedToSinglife;
      // Never carry this flag across patients if the current portal doesn't support it.
      if (!allowAiaSwitch && this.needsAIAClinicSwitch) this.needsAIAClinicSwitch = false;
      const switchedToAIA = switchedToSinglife
        ? false
        : allowAiaSwitch
          ? await this.switchToAIAClinicIfNeeded()
          : false;

      // If we switched to AIA Clinic, we need to use the AIA-specific flow:
      // 1. Click "Add AIA Visit"
      // 2. Click search icon (#ctr_block > div:nth-child(2) > img)
      // 3. Enter NRIC and search
      // 4. Click patient name
      if (switchedToAIA && nric) {
        logger.info('Using AIA Clinic visit flow after system switch');
        const aiaResult = await this.navigateToAIAVisitAndSearch(nric);
        if (aiaResult) {
          await this.page
            .screenshot({ path: 'screenshots/mhc-asia-aia-visit-form.png', fullPage: true })
            .catch(() => {});
          return true;
        }
        // If AIA flow failed, continue with normal flow as fallback
        logger.warn('AIA visit flow failed, trying normal flow');
      }

      // Many flows start the visit form by clicking the patient in the search results.
      // IMPORTANT: the *search results* page also contains a "Visit Date" field, so only use
      // strong visit-form signals here.
      const alreadyInVisit = await (async () => {
        const hasEmployeeVisitHeader =
          (await this.page
            .locator('text=/Employee\\s+Visit\\s*-\\s*Add/i')
            .count()
            .catch(() => 0)) > 0;
        const hasChargeType =
          (await this.page
            .locator('text=/Charge\\s*Type/i')
            .count()
            .catch(() => 0)) > 0;
        const hasConsultFee =
          (await this.page
            .locator('text=/Consultation\\s+Fee/i')
            .count()
            .catch(() => 0)) > 0;
        const hasSaveDraft =
          (await this.page
            .locator('button:has-text(\"Save As Draft\"), input[value*=\"Save As Draft\" i]')
            .count()
            .catch(() => 0)) > 0;
        const hasDrugHeader =
          (await this.page
            .locator('text=/Drug\\s+Name/i')
            .count()
            .catch(() => 0)) > 0;
        return (
          hasEmployeeVisitHeader ||
          (hasChargeType && (hasConsultFee || hasDrugHeader || hasSaveDraft))
        );
      })();
      if (alreadyInVisit) {
        logger.info('Already on visit form after selecting patient');
        await this.page
          .screenshot({ path: 'screenshots/mhc-asia-add-visit-form.png', fullPage: true })
          .catch(() => {});
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
            if (
              (await choice.count().catch(() => 0)) > 0 &&
              (await choice.isVisible().catch(() => false))
            ) {
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
            if ((await link.count()) > 0) {
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
          if ((await button.count()) > 0) {
            await button.click();
            await this.page.waitForLoadState('domcontentloaded').catch(() => {});
            await this.page.waitForTimeout(400);
            logger.info('Clicked Add Visit');
            await this.page
              .screenshot({ path: 'screenshots/mhc-asia-add-visit-form.png', fullPage: true })
              .catch(() => {});
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
              if (
                (await this.page
                  .locator(selector)
                  .count()
                  .catch(() => 0)) > 0
              ) {
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
        'select[name*="system" i]',
        'select[id*="system" i]',
      ];

      let switchClicked = false;
      for (const selector of switchSystemSelectors) {
        try {
          const switchBtn = this.page.locator(selector).first();
          if ((await switchBtn.count().catch(() => 0)) === 0) continue;
          const visible = await switchBtn.isVisible().catch(() => false);
          if (!visible) continue;
          switchClicked = await this._safeClick(switchBtn, 'Switch System');
          await this.page.waitForTimeout(500);
          if (switchClicked) break;
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
        await this.page
          .screenshot({ path: 'screenshots/mhc-asia-switch-system-not-found.png' })
          .catch(() => {});
        return false;
      }

      // Step 2: Select "AIA Clinic" from actionable controls.
      // Prime hover menus first (some deployments require hover to reveal switch links).
      await this.page
        .locator(
          'a:has-text("Switch System"), button:has-text("Switch System"), text=/Switch\\s+System/i'
        )
        .first()
        .hover()
        .catch(() => {});
      await this.page.waitForTimeout(250);

      let options = await this._collectVisibleSystemSwitchOptions(/aia\s*clinic/i);
      if (!options.length) {
        this._logStep('No visible AIA switch options; trying hidden switch links');
        options = await this._collectVisibleSystemSwitchOptions(/aia\s*clinic/i, {
          includeHidden: true,
        });
      }
      if (!options.length) {
        const debugTargets = await this._collectSwitchSystemDebugTargets(/aia\s*clinic/i);
        this._logStep('AIA switch debug targets', {
          count: debugTargets.length,
          sample: debugTargets.slice(0, 12),
        });
        const hrefFallbackCandidates =
          await this._collectSwitchSystemHrefCandidatesAcrossFrames(/aia\s*clinic|aiaclinic/i);
        this._logStep('AIA switch href fallback candidates', {
          count: hrefFallbackCandidates.length,
          sample: hrefFallbackCandidates.slice(0, 8),
        });
        for (const candidate of hrefFallbackCandidates) {
          const switchHref = this._extractSwitchSystemHref(candidate.href);
          if (!switchHref) continue;
          const nextUrl = /^https?:\/\//i.test(switchHref)
            ? switchHref
            : new URL(switchHref, this.page.url()).toString();
          await this.page
            .goto(nextUrl, { waitUntil: 'domcontentloaded', timeout: 15000 })
            .catch(() => {});
          const fallbackSwitch = await this._waitForAiaSwitch(9000);
          this._logStep('AIA switch verification via href fallback', {
            candidate,
            ...fallbackSwitch.snap,
          });
          if (fallbackSwitch.ok) {
            this.isAiaClinicSystem = true;
            this.isSinglifeSystem = false;
            if (flaggedByDialog) this.needsAIAClinicSwitch = false;
            await this.page
              .screenshot({ path: 'screenshots/mhc-asia-switched-to-aia-clinic.png' })
              .catch(() => {});
            return true;
          }
        }

        const defaultSwitchUrl = this._getDefaultSwitchSystemUrl(
          /aia\s*clinic|aiaclinic/i,
          'AIA Clinic'
        );
        if (defaultSwitchUrl) {
          const nextUrl = new URL(defaultSwitchUrl, this.page.url()).toString();
          this._logStep('AIA switch deterministic default fallback', { nextUrl });
          await this.page
            .goto(nextUrl, { waitUntil: 'domcontentloaded', timeout: 15000 })
            .catch(() => {});
          const defaultFallback = await this._waitForAiaSwitch(9000);
          this._logStep('AIA switch verification via default fallback', {
            nextUrl,
            ...defaultFallback.snap,
          });
          if (defaultFallback.ok) {
            this.isAiaClinicSystem = true;
            this.isSinglifeSystem = false;
            if (flaggedByDialog) this.needsAIAClinicSwitch = false;
            await this.page
              .screenshot({ path: 'screenshots/mhc-asia-switched-to-aia-clinic.png' })
              .catch(() => {});
            return true;
          }
        }
      }
      for (const option of options) {
        try {
          this._logStep('AIA switch option candidate', option);
          if (option.kind === 'option') {
            const selLocator = option.selectName
              ? this.page.locator(`select[name="${option.selectName}"]`).first()
              : option.selectId
                ? this.page.locator(`#${option.selectId}`).first()
                : this.page.locator('select').first();
            if ((await selLocator.count().catch(() => 0)) === 0) continue;
            await selLocator.selectOption({ value: option.value }).catch(async () => {
              await selLocator.selectOption({ label: option.text });
            });
          } else {
            const prevPage = this.page;
            const popupPromise = this.page
              .context()
              .waitForEvent('page', { timeout: 6000 })
              .catch(() => null);
            const link = this.page
              .locator('a[href]')
              .filter({
                hasText: new RegExp(
                  `^\\s*${option.text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`,
                  'i'
                ),
              })
              .first();
            const linkCount = await link.count().catch(() => 0);
            const linkVisible = linkCount > 0 && (await link.isVisible().catch(() => false));
            if (linkVisible) {
              const clicked = await this._safeClick(link, 'AIA Clinic');
              if (!clicked) continue;
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
            }
          }

          const switchResult = await this._waitForAiaSwitch(9000);
          const snap = switchResult.snap;
          this._logStep('AIA switch verification', { option, ...snap });
          if (switchResult.ok) {
            logger.info('Switched to AIA Clinic system');
            this.isAiaClinicSystem = true;
            this.isSinglifeSystem = false;
            this._logStep('Switched to AIA Clinic');
            await this.page
              .screenshot({ path: 'screenshots/mhc-asia-switched-to-aia-clinic.png' })
              .catch(() => {});
            await this.page.bringToFront().catch(() => {});
            if (flaggedByDialog) this.needsAIAClinicSwitch = false;
            return true;
          }

          const switchHref =
            this._extractSwitchSystemHref(option.href) ||
            this._extractSwitchSystemHref(option.value);
          if (switchHref) {
            const nextUrl = /^https?:\/\//i.test(switchHref)
              ? switchHref
              : new URL(switchHref, this.page.url()).toString();
            this._logStep('AIA switch deterministic fallback via URL', {
              option,
              switchHref,
              nextUrl,
            });
            await this.page
              .goto(nextUrl, { waitUntil: 'domcontentloaded', timeout: 15000 })
              .catch(() => {});
            const fallbackSwitch = await this._waitForAiaSwitch(9000);
            this._logStep('AIA switch verification after URL fallback', {
              option,
              ...fallbackSwitch.snap,
            });
            if (fallbackSwitch.ok) {
              this.isAiaClinicSystem = true;
              this.isSinglifeSystem = false;
              if (flaggedByDialog) this.needsAIAClinicSwitch = false;
              await this.page
                .screenshot({ path: 'screenshots/mhc-asia-switched-to-aia-clinic.png' })
                .catch(() => {});
              return true;
            }
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
            this._logStep('AIA dropdown switch verification', { selectSel, ...snap });
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
      await this.page
        .screenshot({ path: 'screenshots/mhc-asia-aia-clinic-not-found.png' })
        .catch(() => {});
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
      const needsSwitch = force || this.needsSinglifeSwitch === true;

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
        await this.page
          .screenshot({ path: 'screenshots/mhc-asia-switched-to-singlife.png' })
          .catch(() => {});
      }
      return ok;
    } catch (error) {
      logger.error('Failed to switch to Singlife:', error);
      return false;
    }
  }

  async _switchSystemTo(targetRegex, labelForLog) {
    const isAiaTarget = /aia/i.test(labelForLog) || targetRegex?.test?.('AIA');
    const isSinglifeTarget = /singlife|aviva|pcp/i.test(
      `${labelForLog || ''} ${targetRegex?.source || ''}`
    );
    const preSnap = await this._getPortalContextSnapshot().catch(() => null);
    if (isAiaTarget && preSnap?.looksLikeAiaFlow) {
      this.isAiaClinicSystem = true;
      this.isSinglifeSystem = false;
      return true;
    }
    if (
      isSinglifeTarget &&
      (preSnap?.isSinglifeDomain || /singlife|pcpcare/i.test(String(preSnap?.url || '')))
    ) {
      this.isSinglifeSystem = true;
      this.isAiaClinicSystem = false;
      return true;
    }

    // Step 1: Find and click "Switch System" in top right corner
    const switchSystemSelectors = [
      'a:has-text("Switch System")',
      'button:has-text("Switch System")',
      'select[name*="system" i]',
      'select[id*="system" i]',
    ];

    let switchClicked = false;
    for (const selector of switchSystemSelectors) {
      try {
        const switchBtn = this.page.locator(selector).first();
        if ((await switchBtn.count().catch(() => 0)) === 0) continue;
        const visible = await switchBtn.isVisible().catch(() => false);
        if (!visible) continue;
        switchClicked = await this._safeClick(switchBtn, 'Switch System');
        await this.page.waitForTimeout(500);
        if (switchClicked) break;
      } catch {
        continue;
      }
    }

    if (!switchClicked) {
      const directSwitchUrl = this._getDefaultSwitchSystemUrl(targetRegex, labelForLog);
      if (directSwitchUrl) {
        const nextUrl = new URL(directSwitchUrl, this.page.url()).toString();
        this._logStep('Switch system direct fallback without menu', { labelForLog, nextUrl });
        await this.page
          .goto(nextUrl, { waitUntil: 'domcontentloaded', timeout: 15000 })
          .catch(() => {});
        const directSnapCheck = isAiaTarget
          ? await this._waitForAiaSwitch(9000)
          : { ok: true, snap: await this._getPortalContextSnapshot() };
        const directSnap = directSnapCheck.snap;
        this._logStep('Switch system direct fallback verification', {
          labelForLog,
          nextUrl,
          ...directSnap,
        });
        if (isAiaTarget && directSnapCheck.ok && directSnap.looksLikeAiaFlow) {
          this.isAiaClinicSystem = true;
          this.isSinglifeSystem = false;
          return true;
        }
        if (
          isSinglifeTarget &&
          (directSnap.isSinglifeDomain || /singlife|pcpcare/i.test(directSnap.url))
        ) {
          this.isSinglifeSystem = true;
          this.isAiaClinicSystem = false;
          return true;
        }
      }
      logger.warn('Could not find Switch System button');
      return false;
    }

    // Step 2: Select the target system from actionable controls.
    await this.page
      .locator(
        'a:has-text("Switch System"), button:has-text("Switch System"), text=/Switch\\s+System/i'
      )
      .first()
      .hover()
      .catch(() => {});
    await this.page.waitForTimeout(250);

    let options = await this._collectVisibleSystemSwitchOptions(targetRegex);
    if (!options.length) {
      this._logStep('No visible switch options; trying hidden switch links', { labelForLog });
      options = await this._collectVisibleSystemSwitchOptions(targetRegex, { includeHidden: true });
    }
    if (!options.length) {
      const debugTargets = await this._collectSwitchSystemDebugTargets(targetRegex);
      this._logStep('Switch system debug targets', {
        labelForLog,
        count: debugTargets.length,
        sample: debugTargets.slice(0, 12),
      });
      const hrefFallbackCandidates =
        await this._collectSwitchSystemHrefCandidatesAcrossFrames(targetRegex);
      this._logStep('Switch system href fallback candidates', {
        labelForLog,
        count: hrefFallbackCandidates.length,
        sample: hrefFallbackCandidates.slice(0, 8),
      });
      for (const candidate of hrefFallbackCandidates) {
        const switchHref = this._extractSwitchSystemHref(candidate.href);
        if (!switchHref) continue;
        const nextUrl = /^https?:\/\//i.test(switchHref)
          ? switchHref
          : new URL(switchHref, this.page.url()).toString();
        await this.page
          .goto(nextUrl, { waitUntil: 'domcontentloaded', timeout: 15000 })
          .catch(() => {});
        const fallbackSnapCheck = isAiaTarget
          ? await this._waitForAiaSwitch(9000)
          : { ok: true, snap: await this._getPortalContextSnapshot() };
        const fallbackSnap = fallbackSnapCheck.snap;
        this._logStep('Switch system verification via href fallback', {
          labelForLog,
          candidate,
          ...fallbackSnap,
        });
        if (isAiaTarget && fallbackSnapCheck.ok && fallbackSnap.looksLikeAiaFlow) {
          this.isAiaClinicSystem = true;
          this.isSinglifeSystem = false;
          return true;
        }
        if (
          isSinglifeTarget &&
          (fallbackSnap.isSinglifeDomain || /singlife|pcpcare/i.test(fallbackSnap.url))
        ) {
          this.isSinglifeSystem = true;
          this.isAiaClinicSystem = false;
          return true;
        }
      }

      const defaultSwitchUrl = this._getDefaultSwitchSystemUrl(targetRegex, labelForLog);
      if (defaultSwitchUrl) {
        const nextUrl = new URL(defaultSwitchUrl, this.page.url()).toString();
        await this.page
          .goto(nextUrl, { waitUntil: 'domcontentloaded', timeout: 15000 })
          .catch(() => {});
        const defaultSnapCheck = isAiaTarget
          ? await this._waitForAiaSwitch(9000)
          : { ok: true, snap: await this._getPortalContextSnapshot() };
        const defaultSnap = defaultSnapCheck.snap;
        this._logStep('Switch system verification via default fallback', {
          labelForLog,
          nextUrl,
          ...defaultSnap,
        });
        if (isAiaTarget && defaultSnapCheck.ok && defaultSnap.looksLikeAiaFlow) {
          this.isAiaClinicSystem = true;
          this.isSinglifeSystem = false;
          return true;
        }
        if (
          isSinglifeTarget &&
          (defaultSnap.isSinglifeDomain || /singlife|pcpcare/i.test(defaultSnap.url))
        ) {
          this.isSinglifeSystem = true;
          this.isAiaClinicSystem = false;
          return true;
        }
      }
    }
    for (const option of options) {
      try {
        this._logStep('Switch system option candidate', { labelForLog, option });
        if (option.kind === 'option') {
          const selectLocator = option.selectName
            ? this.page.locator(`select[name="${option.selectName}"]`).first()
            : option.selectId
              ? this.page.locator(`#${option.selectId}`).first()
              : this.page.locator('select').first();
          if ((await selectLocator.count().catch(() => 0)) === 0) continue;
          await selectLocator.selectOption({ value: option.value }).catch(async () => {
            await selectLocator.selectOption({ label: option.text });
          });
        } else {
          const prevPage = this.page;
          const popupPromise = this.page
            .context()
            .waitForEvent('page', { timeout: 6000 })
            .catch(() => null);
          const link = this.page
            .locator('a[href]')
            .filter({
              hasText: new RegExp(
                `^\\s*${option.text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`,
                'i'
              ),
            })
            .first();
          const linkCount = await link.count().catch(() => 0);
          const linkVisible = linkCount > 0 && (await link.isVisible().catch(() => false));
          if (linkVisible) {
            const clicked = await this._safeClick(link, labelForLog);
            if (!clicked) continue;
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
          }
        }

        const snapCheck = isAiaTarget
          ? await this._waitForAiaSwitch(9000)
          : { ok: true, snap: await this._getPortalContextSnapshot() };
        const snap = snapCheck.snap;
        this._logStep('Switch system verification', { labelForLog, option, ...snap });
        if (isAiaTarget) {
          if (snapCheck.ok && snap.looksLikeAiaFlow) {
            logger.info(`Switched system to: ${labelForLog}`);
            this.isAiaClinicSystem = true;
            this.isSinglifeSystem = false;
            return true;
          }
        } else if (isSinglifeTarget) {
          if (snap.isSinglifeDomain || /singlife|pcpcare/i.test(snap.url)) {
            logger.info(`Switched system to: ${labelForLog}`);
            this.isSinglifeSystem = true;
            this.isAiaClinicSystem = false;
            return true;
          }
        } else {
          logger.info(`Switched system to: ${labelForLog}`);
          return true;
        }

        const switchHref =
          this._extractSwitchSystemHref(option.href) || this._extractSwitchSystemHref(option.value);
        if (switchHref) {
          const nextUrl = /^https?:\/\//i.test(switchHref)
            ? switchHref
            : new URL(switchHref, this.page.url()).toString();
          this._logStep('Switch system deterministic fallback via URL', {
            labelForLog,
            option,
            switchHref,
            nextUrl,
          });
          await this.page
            .goto(nextUrl, { waitUntil: 'domcontentloaded', timeout: 15000 })
            .catch(() => {});
          const fallbackSnapCheck = isAiaTarget
            ? await this._waitForAiaSwitch(9000)
            : { ok: true, snap: await this._getPortalContextSnapshot() };
          const fallbackSnap = fallbackSnapCheck.snap;
          this._logStep('Switch system verification after URL fallback', {
            labelForLog,
            option,
            ...fallbackSnap,
          });
          if (isAiaTarget && fallbackSnapCheck.ok && fallbackSnap.looksLikeAiaFlow) {
            this.isAiaClinicSystem = true;
            this.isSinglifeSystem = false;
            return true;
          }
          if (
            isSinglifeTarget &&
            (fallbackSnap.isSinglifeDomain || /singlife|pcpcare/i.test(fallbackSnap.url))
          ) {
            this.isSinglifeSystem = true;
            this.isAiaClinicSystem = false;
            return true;
          }
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
            .evaluateAll(opts =>
              opts.map(o => ({ value: o.value, label: (o.textContent || '').trim() }))
            )
            .catch(() => []);
          const match =
            options.find(o => targetRegex.test(o.label)) ||
            options.find(o => targetRegex.test(o.value));
          if (!match) continue;
          await select
            .selectOption({ value: match.value })
            .catch(async () => select.selectOption({ label: match.label }));
          await this.page.waitForTimeout(500);
          const snapCheck = isAiaTarget
            ? await this._waitForAiaSwitch(9000)
            : { ok: true, snap: await this._getPortalContextSnapshot() };
          const snap = snapCheck.snap;
          this._logStep('Switch system dropdown verification', {
            labelForLog,
            selectSel,
            selected: match.label || match.value,
            ...snap,
          });
          if (isAiaTarget) {
            if (snapCheck.ok && snap.looksLikeAiaFlow) {
              this.isAiaClinicSystem = true;
              this.isSinglifeSystem = false;
              logger.info(`Switched system to: ${match.label || labelForLog}`);
              return true;
            }
            continue;
          }
          if (isSinglifeTarget) {
            if (snap.isSinglifeDomain || /singlife|pcpcare/i.test(snap.url)) {
              this.isSinglifeSystem = true;
              this.isAiaClinicSystem = false;
              logger.info(`Switched system to: ${match.label || labelForLog}`);
              return true;
            }
            continue;
          }
          logger.info(`Switched system to: ${match.label || labelForLog}`);
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
      const visitDateDdMmYyyy = String(opts.visitDate || opts.visitDateDdMmYyyy || '').trim();
      const hasTargetVisitDate = /^\d{2}\/\d{2}\/\d{4}$/.test(visitDateDdMmYyyy);
      this._logStep('Navigate to AIA Visit', {
        nric,
        visitDate: hasTargetVisitDate ? visitDateDdMmYyyy : null,
      });
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
            if (
              (await link.count().catch(() => 0)) > 0 &&
              (await link.isVisible().catch(() => false))
            ) {
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
        await this.page
          .screenshot({ path: 'screenshots/mhc-asia-aia-visit-not-found.png' })
          .catch(() => {});
        const snapBeforeReload = await this._getPortalContextSnapshot();
        if (!snapBeforeReload.looksLikeAiaFlow) {
          logger.warn(
            'Not in AIA context when Add AIA Visit is missing; aborting without MHC reload'
          );
          return false;
        }
        // Try reloading the base page (system switch might require a fresh nav render)
        await this.page
          .goto(this.config.url, { waitUntil: 'domcontentloaded', timeout: 30000 })
          .catch(() => {});
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
        await this.page
          .screenshot({ path: 'screenshots/mhc-asia-aia-wrong-context.png', fullPage: true })
          .catch(() => {});
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
            if (
              (await choice.count().catch(() => 0)) > 0 &&
              (await choice.isVisible().catch(() => false))
            ) {
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
              if (
                (await choice.count().catch(() => 0)) > 0 &&
                (await choice.isVisible().catch(() => false))
              ) {
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
        (await this.page
          .locator('text=/Add\\s+AIA\\s+Visit/i')
          .count()
          .catch(() => 0)) > 0 ||
        (await this.page
          .locator('text=/AIA\\s+Visit/i')
          .count()
          .catch(() => 0)) > 0;
      const alreadyOnSearchForm =
        hasAiaNav &&
        ((await this.page
          .locator('text=/NRIC.*FIN.*Member/i')
          .count()
          .catch(() => 0)) > 0 ||
          (await this.page
            .locator('text=/Search using full NRIC/i')
            .count()
            .catch(() => 0)) > 0);

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

      if (hasTargetVisitDate) {
        this._logStep('Set AIA search visit date', { visitDate: visitDateDdMmYyyy });
        const dateSelectors = [
          'input[name="visitDateAsString"]',
          '#visitDateAsString',
          'tr:has-text("Visit Date") input[type="text"]',
          'tr:has-text("Visit Date") input:not([type="hidden"])',
          'input[name*="visitDate" i]',
          'input[id*="visitDate" i]',
        ];
        let dateFilled = false;
        for (const selector of dateSelectors) {
          try {
            const field = this.page.locator(selector).first();
            if ((await field.count().catch(() => 0)) === 0) continue;
            if (!(await field.isVisible().catch(() => false))) continue;
            await field.fill(visitDateDdMmYyyy).catch(async () => {
              await field.evaluate((el, value) => {
                el.value = value;
                el.dispatchEvent(new Event('input', { bubbles: true }));
                el.dispatchEvent(new Event('change', { bubbles: true }));
                el.dispatchEvent(new Event('blur', { bubbles: true }));
              }, visitDateDdMmYyyy);
            });
            let valueNow = (await field.inputValue().catch(() => '')).trim();
            if (valueNow !== visitDateDdMmYyyy) {
              await field.click({ clickCount: 3 }).catch(() => {});
              await this.page.keyboard.press('Meta+A').catch(() => {});
              await this.page.keyboard.press('Control+A').catch(() => {});
              await this.page.keyboard.type(visitDateDdMmYyyy, { delay: 15 }).catch(() => {});
              await field.dispatchEvent('change').catch(() => {});
              await field.dispatchEvent('blur').catch(() => {});
              valueNow = (await field.inputValue().catch(() => '')).trim();
            }
            if (valueNow === visitDateDdMmYyyy) {
              dateFilled = true;
              this._logStep('AIA search visit date set', { selector, valueNow });
              break;
            }
          } catch {
            continue;
          }
        }
        if (!dateFilled) {
          logger.warn('Unable to confirm AIA search visit date field value', {
            visitDate: visitDateDdMmYyyy,
          });
        }
      }

      // Step 3: Enter NRIC in search field
      // The form shows: "NRIC/FIN/Member ID" label with input field next to it
      this._logStep('Enter NRIC in AIA search', { nric });
      await this.page.waitForTimeout(400);
      await this.page
        .screenshot({ path: 'screenshots/mhc-asia-aia-before-nric.png' })
        .catch(() => {});

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
      const isDateLikeInput = async input => {
        try {
          const name = ((await input.getAttribute('name').catch(() => '')) || '').toLowerCase();
          const id = ((await input.getAttribute('id').catch(() => '')) || '').toLowerCase();
          const ph = (
            (await input.getAttribute('placeholder').catch(() => '')) || ''
          ).toLowerCase();
          const aria = (
            (await input.getAttribute('aria-label').catch(() => '')) || ''
          ).toLowerCase();
          const rowText = await input
            .evaluate(el => el.closest('tr')?.innerText || el.closest('tr')?.textContent || '')
            .catch(() => '');
          const rowLower = String(rowText || '').toLowerCase();
          if (
            /visit\s*date|date|dd\s*\/\s*mm|mm\s*\/\s*dd|yyyy/.test(`${name} ${id} ${ph} ${aria}`)
          )
            return true;
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
          if (
            (await input.count().catch(() => 0)) > 0 &&
            (await input.isVisible().catch(() => false))
          ) {
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
        await this.page
          .screenshot({ path: 'screenshots/mhc-asia-aia-nric-input-not-found.png' })
          .catch(() => {});
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
          if (
            (await btn.count().catch(() => 0)) > 0 &&
            (await btn.isVisible().catch(() => false))
          ) {
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
      await this.page
        .screenshot({ path: 'screenshots/mhc-asia-aia-search-results.png' })
        .catch(() => {});

      // Step 4: Click patient name from results
      this._logStep('Click patient from AIA search results');
      const withVisitDateParam = href => {
        if (!hasTargetVisitDate || !href) return null;
        try {
          const u = new URL(href, this.page.url());
          u.searchParams.set('visitDateAsString', visitDateDdMmYyyy);
          return u.toString();
        } catch {
          return null;
        }
      };

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
            const originalHref = await patientLink.getAttribute('href').catch(() => '');
            const patchedHref = withVisitDateParam(originalHref);
            if (patchedHref) {
              this._logStep('AIA patient link patched with visit date', {
                originalHref,
                patchedHref,
                visitDate: visitDateDdMmYyyy,
              });
              await this.page
                .goto(patchedHref, { waitUntil: 'domcontentloaded', timeout: 15000 })
                .catch(() => {});
            } else {
              const popupPromise = this.page
                .context()
                .waitForEvent('page', { timeout: 1500 })
                .catch(() => null);
              await this._safeClick(patientLink, 'Patient in AIA results');
              const popup = await popupPromise;
              if (popup) {
                await popup.waitForLoadState('domcontentloaded').catch(() => {});
                this.page = popup;
                this.setupDialogHandler({ reset: false });
                await this.page.bringToFront().catch(() => {});
              }
            }
            // Wait for the visit-add form to appear.
            await Promise.race([
              this.page
                .waitForURL(/EmpVisitAdd|VisitAdd|Employee.*Visit.*Add/i, { timeout: 8000 })
                .catch(() => {}),
              this.page
                .locator('text=/Employee\\s+Visit\\s*-\\s*Add/i')
                .first()
                .waitFor({ timeout: 8000 })
                .catch(() => {}),
              this.page
                .locator('tr:has-text("Charge Type")')
                .first()
                .waitFor({ timeout: 8000 })
                .catch(() => {}),
            ]);
            await this.page.waitForTimeout(300);
            await this.page.bringToFront().catch(() => {});
            logger.info('Selected patient from AIA search results');
            this._logStep('Patient selected from AIA results', {
              from: beforeUrl,
              to: this.page.url(),
            });
            await this.page
              .screenshot({ path: 'screenshots/mhc-asia-aia-patient-selected.png' })
              .catch(() => {});

            const isVisitForm = await (async () => {
              const urlNow = this.page.url();
              if (/PatientSearch/i.test(urlNow)) return false;
              if (/EmpVisitAdd|VisitAdd/i.test(urlNow)) return true;
              if (
                (await this.page
                  .locator('text=/Employee\\s+Visit\\s*-\\s*Add/i')
                  .count()
                  .catch(() => 0)) > 0
              )
                return true;
              if (
                (await this.page
                  .locator('text=/Consultation\\s+Fee/i')
                  .count()
                  .catch(() => 0)) > 0
              )
                return true;
              if (
                (await this.page
                  .locator('text=/Drug\\s+Name/i')
                  .count()
                  .catch(() => 0)) > 0
              )
                return true;
              if (
                (await this.page
                  .locator('text=/Charge\\s*Type/i')
                  .count()
                  .catch(() => 0)) > 0
              )
                return true;
              return false;
            })();
            if (!isVisitForm) {
              await this.page
                .screenshot({
                  path: 'screenshots/mhc-asia-aia-visit-form-missing.png',
                  fullPage: true,
                })
                .catch(() => {});
              logger.warn('AIA patient selected but visit form not detected');
              // Attempt direct navigation via EmpVisitAdd href in the matching row.
              const directHref = await this.page
                .evaluate(needle => {
                  const lowerNeedle = String(needle || '')
                    .trim()
                    .toLowerCase();
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
                const patchedDirectHref = withVisitDateParam(directHref) || directHref;
                await this.page
                  .goto(patchedDirectHref, { waitUntil: 'domcontentloaded', timeout: 15000 })
                  .catch(() => {});
                await this.page.waitForTimeout(300);
                const formOk =
                  (await this.page
                    .locator('text=/Consultation\\s+Fee/i')
                    .count()
                    .catch(() => 0)) > 0 ||
                  (await this.page
                    .locator('text=/Drug\\s+Name/i')
                    .count()
                    .catch(() => 0)) > 0;
                if (formOk) return true;
              }
              // Occasionally the portal bounces to the AIA home page; retry once.
              const currentUrl = this.page.url();
              if (/aiaclinic\.com\/?$/.test(currentUrl) && retryCount < 1) {
                logger.warn(
                  'AIA redirected to home after patient click; retrying Add AIA Visit flow once'
                );
                const retryOk = await this.navigateToAIAVisitAndSearch(nric, {
                  retryCount: retryCount + 1,
                  visitDate: hasTargetVisitDate ? visitDateDdMmYyyy : undefined,
                }).catch(() => false);
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
                  this.page
                    .waitForURL(/EmpVisitAdd|VisitAdd|Employee.*Visit.*Add/i, { timeout: 8000 })
                    .catch(() => {}),
                  this.page
                    .locator('tr:has-text("Charge Type")')
                    .first()
                    .waitFor({ timeout: 8000 })
                    .catch(() => {}),
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
        const hasVisitDateInvalid = await this.page
          .locator('text=/Visit\\s+date\\s+invalid/i')
          .first()
          .isVisible()
          .catch(() => false);
        return hasUnexpected && hasVisitDateInvalid;
      };

      const isInSinglifeContext = async () => {
        const url = this.page.url();
        if (/pcpcare\.com\//i.test(url)) return true;
        // Heuristic signals: Singlife brand and/or left nav items only present in Singlife PCP.
        const hasBrand = await this.page
          .locator('text=/\\bSinglife\\b/i')
          .first()
          .isVisible()
          .catch(() => false);
        const hasAddNormal =
          (await this.page
            .locator('a:has-text("Add Normal Visit")')
            .count()
            .catch(() => 0)) > 0;
        return hasBrand || hasAddNormal;
      };

      const gotoSinglifePatientSearch = async () => {
        // Direct navigation is more reliable than relying on the left-nav being present in every state.
        const url = 'https://www.pcpcare.com/pcpcare/ClinicIECAvivaPatientSearch.ec';
        await this.page
          .goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 })
          .catch(() => {});
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
        await this.page
          .screenshot({
            path: 'screenshots/mhc-asia-singlife-pcp-login-required.png',
            fullPage: true,
          })
          .catch(() => {});
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
        await this.page
          .screenshot({ path: 'screenshots/mhc-asia-singlife-announcement.png', fullPage: true })
          .catch(() => {});
        return true;
      };

      const isVisitForm = async () => {
        // Strong signals only.
        const hasChargeType =
          (await this.page
            .locator('text=/Charge\\s*Type/i')
            .count()
            .catch(() => 0)) > 0;
        const hasCompute =
          (await this.page
            .locator(
              'button:has-text("Compute"), button:has-text("Compute claim"), input[value*="Compute" i]'
            )
            .count()
            .catch(() => 0)) > 0;
        const hasSaveDraft =
          (await this.page
            .locator('button:has-text("Save As Draft"), input[value*="Save As Draft" i]')
            .count()
            .catch(() => 0)) > 0;
        const hasEmployeeVisitHeader =
          (await this.page
            .locator('text=/Employee\\s+Visit\\s*-\\s*Add/i')
            .count()
            .catch(() => 0)) > 0;
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
          await this.page
            .screenshot({
              path: 'screenshots/mhc-asia-singlife-visit-date-invalid.png',
              fullPage: true,
            })
            .catch(() => {});
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
            .screenshot({
              path: 'screenshots/mhc-asia-singlife-add-normal-visit-not-found.png',
              fullPage: true,
            })
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
            await this.page
              .goto(nextUrl, { waitUntil: 'domcontentloaded', timeout: 30000 })
              .catch(() => {});
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
        const pickVisibleNonDateInput = async loc => {
          try {
            const count = await loc.count().catch(() => 0);
            for (let i = 0; i < count; i++) {
              const cand = loc.nth(i);
              if (!(await cand.isVisible().catch(() => true))) continue;
              // Skip non-fillable inputs (e.g., calendar "Select" buttons).
              const type = (
                ((await cand.getAttribute('type').catch(() => null)) || 'text') + ''
              ).toLowerCase();
              if (
                [
                  'button',
                  'submit',
                  'reset',
                  'image',
                  'hidden',
                  'checkbox',
                  'radio',
                  'file',
                ].includes(type)
              )
                continue;
              const editable = await cand.isEditable().catch(() => true);
              if (!editable) continue;
              const name = ((await cand.getAttribute('name').catch(() => '')) || '').toLowerCase();
              const id = ((await cand.getAttribute('id').catch(() => '')) || '').toLowerCase();
              const ph = (
                (await cand.getAttribute('placeholder').catch(() => '')) || ''
              ).toLowerCase();
              if (
                name.includes('visit') ||
                id.includes('visit') ||
                ph.includes('dd/mm') ||
                ph.includes('visit')
              )
                continue;
              return cand;
            }
          } catch {
            // ignore
          }
          return null;
        };

        // Singlife search page label is typically "NRIC/FIN/Member ID".
        const memberIdCandidates = [
          this.page.locator(
            'tr:has-text("NRIC/FIN/Member ID") input[type="text"], tr:has-text("NRIC/FIN/Member ID") input:not([type])'
          ),
          this.page.locator(
            'tr:has-text("NRIC/FIN/Member") input[type="text"], tr:has-text("NRIC/FIN/Member") input:not([type])'
          ),
          this.page.locator(
            'xpath=//*[self::td or self::th or self::label][contains(normalize-space(.), \"NRIC/FIN/Member ID\")]/following::input[1]'
          ),
          this.page.locator(
            'xpath=//*[self::td or self::th or self::label][contains(normalize-space(.), \"NRIC\") and contains(normalize-space(.), \"Member\")]/following::input[1]'
          ),
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
            .screenshot({
              path: 'screenshots/mhc-asia-singlife-nric-field-not-found.png',
              fullPage: true,
            })
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
          if (
            String(check || '')
              .trim()
              .toUpperCase() ===
            String(nric || '')
              .trim()
              .toUpperCase()
          ) {
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
        let patientLink = this.page
          .locator(`a[href*="ClinicIECAvivaEmpVisitAdd"][href*="memberICNo=${nric}"]`)
          .first();
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
            .screenshot({
              path: 'screenshots/mhc-asia-singlife-no-patient-link.png',
              fullPage: true,
            })
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
            logger.info('Singlife: visit opened in popup tab', {
              from: beforeUrl,
              to: popup.url(),
            });
          } else {
            await navPromise;
            logger.info('Singlife: patient click navigation check', {
              from: beforeUrl,
              to: this.page.url(),
            });
          }

          // If the patient click redirects back to ClinicAnnouncement, try a direct navigation to the visit href.
          if (/ClinicAnnouncement\.ec/i.test(this.page.url()) && resolvedHref) {
            this._logStep(
              'Singlife: redirected to announcement after patient click; trying direct visit URL',
              { resolvedHref }
            );
            await this.page
              .goto(resolvedHref, { waitUntil: 'domcontentloaded', timeout: 30000 })
              .catch(() => {});
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
            await this.page
              .goto(beforeUrl, { waitUntil: 'domcontentloaded', timeout: 30000 })
              .catch(() => null);
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
              const popupPromise2 = this.page
                .waitForEvent('popup', { timeout: 8000 })
                .catch(() => null);
              const navPromise2 = this.page
                .waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 8000 })
                .catch(() => null);
              await this._safeClick(link2, 'Singlife: patient link (retry after announcement)');

              const popup2 = await popupPromise2;
              if (popup2) {
                await popup2
                  .waitForLoadState('domcontentloaded', { timeout: 15000 })
                  .catch(() => {});
                this.page = popup2;
              } else {
                await navPromise2;
              }

              await this.page.waitForTimeout(800);
              if (!(await handleAnnouncement()) && (await isVisitForm())) {
                await this.page
                  .screenshot({
                    path: 'screenshots/mhc-asia-singlife-visit-form.png',
                    fullPage: true,
                  })
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
            .screenshot({
              path: 'screenshots/mhc-asia-singlife-pcp-login-required-after-click.png',
              fullPage: true,
            })
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
      await this.page
        .screenshot({ path: 'screenshots/mhc-asia-singlife-search-error.png', fullPage: true })
        .catch(() => {});
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
          if ((await select.count()) > 0) {
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
          if ((await select.count()) > 0) {
            if (!patientName || patientName === '__FIRST__') {
              const options = await select
                .locator('option')
                .evaluateAll(opts =>
                  opts.map(o => ({ value: o.value, label: (o.textContent || '').trim() }))
                );
              const candidate =
                options.find(o => o.value && o.value.trim().length > 0) ||
                options.find(o => o.label && o.label.trim().length > 0);
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
          if ((await field.count()) > 0) {
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
            if ((await select.count()) > 0) {
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
            if ((await checkbox.count()) > 0) {
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
      const candidates = [
        {
          locator: this.page
            .locator(
              'tr:has-text("Waiver Of Referral") input[type="checkbox"], tr:has-text("Waiver of Referral") input[type="checkbox"]'
            )
            .first(),
          reason: 'waiver_row',
        },
        {
          locator: this.page
            .locator(
              'tr:has-text("Waiver") input[type="checkbox"], tr:has-text("Referral") input[type="checkbox"]'
            )
            .first(),
          reason: 'waiver_or_referral_row',
        },
        {
          locator: this.page
            .locator(
              'input[type="checkbox"][name*="waiver" i], input[type="checkbox"][id*="waiver" i], input[type="checkbox"][name*="referral" i], input[type="checkbox"][id*="referral" i]'
            )
            .first(),
          reason: 'name_or_id_fallback',
        },
      ];

      for (const candidate of candidates) {
        const box = candidate.locator;
        if ((await box.count().catch(() => 0)) === 0) continue;
        const visible = await box.isVisible().catch(() => false);
        if (!visible) continue;

        const before = await box.isChecked().catch(() => false);
        if (checked && !before) {
          await box.check({ force: true }).catch(() => {});
        } else if (!checked && before) {
          await box.uncheck({ force: true }).catch(() => {});
        }
        await this.page.waitForTimeout(200);
        const after = await box.isChecked().catch(() => false);
        const ok = checked ? after : !after;
        this.lastWaiverReferralState = {
          success: ok,
          checkedRequested: checked,
          checkedBefore: before,
          checkedAfter: after,
          strategy: candidate.reason,
          checkedAt: new Date().toISOString(),
          url: this.page.url(),
        };
        this._logStep('Waiver of referral set result', this.lastWaiverReferralState);
        return ok;
      }

      this.lastWaiverReferralState = {
        success: false,
        checkedRequested: checked,
        reason: 'waiver_checkbox_not_found',
        checkedAt: new Date().toISOString(),
        url: this.page.url(),
      };
      this._logStep('Waiver of referral not found', this.lastWaiverReferralState);
      return false;
    } catch (error) {
      logger.warn('Failed to set waiver of referral (non-fatal)', { error: error.message });
      this.lastWaiverReferralState = {
        success: false,
        checkedRequested: checked,
        reason: `waiver_checkbox_error:${error?.message || 'unknown'}`,
        checkedAt: new Date().toISOString(),
        url: this.page.url(),
      };
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
          if ((await field.count()) > 0) {
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
            if ((await button.count()) > 0) {
              await button.click();
              await this.page.waitForTimeout(1000);

              // Fill the medicine name in the newly added field
              const medicineField = this.page
                .locator('input[type="text"]:last-of-type, textarea:last-of-type')
                .first();
              if ((await medicineField.count()) > 0) {
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
              if ((await field.count()) > 0) {
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
      this.lastSaveDraftResult = {
        success: false,
        reason: 'not_attempted',
        checkedAt: new Date().toISOString(),
      };

      // Safety: never click submit-like buttons
      if (!this.draftOnly) {
        throw new Error('Draft-only mode disabled unexpectedly; refusing to proceed.');
      }

      // Lightweight screenshot for debugging (visit form shows buttons at bottom)
      await this.page
        .screenshot({ path: 'screenshots/mhc-asia-before-save-draft.png', fullPage: true })
        .catch(() => {});

      // Helper: click and capture any blocking dialog message.
      const clickWithDialogCapture = async (locator, label) => {
        const dialogPromise = this.page.waitForEvent('dialog', { timeout: 4000 }).catch(() => null);
        await this._safeClick(locator, label);
        const dialog = await dialogPromise;
        if (!dialog) return null;
        const msg = dialog.message?.() || '';
        logger.warn(`Dialog during draft save: ${msg}`);
        await dialog.accept().catch(() => {});
        return msg;
      };
      const mapDialogToSaveReason = msg => {
        const text = String(msg || '').toLowerCase();
        if (!text) return null;
        if (/must\s+compute\s+claim/.test(text)) return 'compute_claim_required';
        if (
          /referring\s+clinic\s+is\s+required|referral\s+letter\s+is\s+required|waiver\s+of\s+referral/.test(
            text
          )
        ) {
          return 'referral_required_or_waiver_missing';
        }
        if (/valid\s+amount\s+for\s+procedure|please\s+select\s+procedure\s+first/.test(text)) {
          return 'procedure_amount_invalid';
        }
        if (
          /(please\s+enter|valid\s+amount|required|invalid|can\s*not|cannot|failed|error)/.test(
            text
          )
        ) {
          return 'validation_error';
        }
        return 'portal_dialog';
      };
      const captureInlineSaveValidation = async () => {
        const payload = await this.page
          .evaluate(() => {
            const clean = s =>
              String(s || '')
                .replace(/\s+/g, ' ')
                .trim();
            const texts = [];
            const pushIfInteresting = raw => {
              const text = clean(raw);
              if (!text) return;
              if (text.length > 280) return;
              const lower = text.toLowerCase();
              if (
                !/(remark|error|required|invalid|duplicate|failed|not allowed|cannot|can not)/i.test(
                  lower
                )
              )
                return;
              texts.push(text);
            };
            for (const node of Array.from(
              document.querySelectorAll('font, span, div, p, li, label, b, strong')
            )) {
              const style = window.getComputedStyle(node);
              const color = String(style?.color || '').toLowerCase();
              const isRed = /rgb\(\s*255\s*,\s*0\s*,\s*0\s*\)|#f00|red/.test(color);
              const text = clean(node.textContent || '');
              if (!text) continue;
              if (isRed || /remark/i.test(text) || /error/i.test(text)) pushIfInteresting(text);
            }
            return Array.from(new Set(texts)).slice(0, 20);
          })
          .catch(() => []);
        const joined = (payload || []).join(' | ').toLowerCase();
        if (!joined) return { reason: null, messages: [] };
        if (/same\s+day\s+duplicate\s+visit/i.test(joined)) {
          return { reason: 'duplicate_visit_same_day', messages: payload };
        }
        if (/diagnosis.*required/i.test(joined)) {
          return { reason: 'diagnosis_required', messages: payload };
        }
        if (/referr(al|ing).*required|waiver.*referr/i.test(joined)) {
          return { reason: 'referral_required_or_waiver_missing', messages: payload };
        }
        if (/(required|invalid|cannot|can not|failed|error)/i.test(joined)) {
          return { reason: 'validation_error', messages: payload };
        }
        return { reason: null, messages: payload };
      };
      const shouldRetryAfterDisclaimer = async dialogMsg => {
        const msg = String(dialogMsg || '').toLowerCase();
        if (!/draft\s+claims\s+will\s+be\s+deleted|billing\s+cycle\s+cut-?off/i.test(msg))
          return false;
        const stillHasDraftButton = await this.page
          .locator(
            'input[value*="save as draft" i], input[value*="save a draft" i], input[value*="save draft" i], button:has-text("Save As Draft")'
          )
          .first()
          .isVisible()
          .catch(() => false);
        const stillOnVisitForm =
          (await this.page
            .locator('text=/Employee\\s+Visit\\s*-\\s*(Add|Edit)/i')
            .first()
            .isVisible()
            .catch(() => false)) ||
          (await this.page
            .locator('text=/Charge\\s*Type/i')
            .first()
            .isVisible()
            .catch(() => false));
        return stillHasDraftButton && stillOnVisitForm;
      };

      const captureDraftFieldState = async phase => {
        const state = await this.page
          .evaluate(() => {
            const pick = name => {
              const el = document.querySelector(`[name="${name}"]`);
              if (!el) return null;
              return String(el.value || '').trim();
            };
            return {
              visitNo: pick('visitNo'),
              visitDateAsString: pick('visitDateAsString'),
              visitDate: pick('visitDate'),
              claimStatus: pick('claimStatus'),
              drug_drugName: pick('drug_drugName'),
              drug_drugCode: pick('drug_drugCode'),
              drug_unit: pick('drug_unit'),
              drug_unitPrice: pick('drug_unitPrice'),
              drug_quantity: pick('drug_quantity'),
              drug_amount: pick('drug_amount'),
              drugFee: pick('drugFee'),
              totalB4Gst: pick('totalB4Gst'),
              gst: pick('gst'),
              totalFee: pick('totalFee'),
              totalClaim: pick('totalClaim'),
              totalClaimInitial: pick('totalClaimInitial'),
              totalClaimRevised: pick('totalClaimRevised'),
              empVisitDetail_totalClaim: pick('empVisitDetail_totalClaim'),
              empVisitDetail_totalFee: pick('empVisitDetail_totalFee'),
              empVisitDetail_totalUnitClaim: pick('empVisitDetail_totalUnitClaim'),
              empVisitDetail_totalUnitFee: pick('empVisitDetail_totalUnitFee'),
            };
          })
          .catch(() => null);
        this._logStep(`Draft field state (${phase})`, state || {});
        return state;
      };

      await captureDraftFieldState('pre_compute');

      // Step 0: Click "Compute claim" if available (portal may require it before saving/submitting).
      const computeDone = await this.computeClaim().catch(() => false);
      // Portal postbacks can settle slowly; wait before attempting Save As Draft.
      if (computeDone) await this.page.waitForTimeout(2000);
      await captureDraftFieldState('post_compute');
      await this.page
        .screenshot({ path: 'screenshots/mhc-asia-after-compute-before-save.png', fullPage: true })
        .catch(() => {});

      // Fast-fail on known inline portal validations (for example same-day duplicate visit)
      // so Flow 3 gets a deterministic reason without a misleading save click.
      const preSaveInlineValidation = await captureInlineSaveValidation();
      if (preSaveInlineValidation?.reason) {
        logger.warn('Draft save blocked by pre-save inline validation', preSaveInlineValidation);
        await this.page
          .screenshot({
            path: 'screenshots/mhc-asia-draft-save-inline-validation-precheck.png',
            fullPage: true,
          })
          .catch(() => {});
        this.lastSaveDraftResult = {
          success: false,
          reason: preSaveInlineValidation.reason,
          inlineMessages: preSaveInlineValidation.messages || [],
          checkedAt: new Date().toISOString(),
        };
        return false;
      }

      // Only click buttons that explicitly indicate DRAFT (never generic "Save" to avoid risky actions).
      const saveDraftLocators = [
        // Explicit <input value="Save As Draft"> (common on MHC/Singlife)
        this.page
          .locator(
            'input[value*="save as draft" i], input[value*="save a draft" i], input[value*="save draft" i]'
          )
          .first(),
        // Accessible name based (covers <button>, <input type=button|submit|reset>, etc.)
        this.page.getByRole('button', { name: /save\s+as\s+draft/i }).first(),
        this.page.getByRole('button', { name: /save\s+(?:a\s+)?draft/i }).first(),
        // Fallbacks for older markup
        this.page
          .locator('button, input, a')
          .filter({ hasText: /save\s+as\s+draft/i })
          .first(),
        this.page
          .locator('button, input, a')
          .filter({ hasText: /save\s+(?:a\s+)?draft/i })
          .first(),
      ];

      // Prefer robust explicit matches first
      for (let i = 0; i < saveDraftLocators.length; i++) {
        const locator = saveDraftLocators[i];
        try {
          if ((await locator.count().catch(() => 0)) === 0) continue;

          // Extra safety: ensure the visible text/value contains "draft" and NOT "submit"
          const text = ((await locator.textContent().catch(() => '')) || '').toLowerCase();
          const ariaLabel = (
            (await locator.getAttribute('aria-label').catch(() => '')) || ''
          ).toLowerCase();
          const valueAttr = (
            (await locator.getAttribute('value').catch(() => '')) || ''
          ).toLowerCase();
          const combined = `${text} ${ariaLabel} ${valueAttr}`;
          if (!combined.includes('draft') || combined.includes('submit')) {
            continue;
          }

          const dialogMsg = await clickWithDialogCapture(locator, 'Save As Draft');
          // Avoid networkidle (MHC keeps background connections open)
          await this.page.waitForLoadState('domcontentloaded').catch(() => {});
          await this.page.waitForTimeout(500);

          await this.page
            .screenshot({ path: 'screenshots/mhc-asia-draft-saved.png', fullPage: true })
            .catch(() => {});
          if (dialogMsg && /must\s+compute\s+claim/i.test(dialogMsg)) {
            logger.warn(
              'Draft save blocked: portal requires Compute claim first (already attempted).'
            );
            this.lastSaveDraftResult = {
              success: false,
              reason: mapDialogToSaveReason(dialogMsg) || 'compute_claim_required',
              dialogMessage: dialogMsg,
              checkedAt: new Date().toISOString(),
            };
            return false;
          }
          if (
            dialogMsg &&
            /valid\s+amount\s+for\s+procedure|please\s+select\s+procedure\s+first/i.test(dialogMsg)
          ) {
            logger.warn(
              `Draft save blocked by procedure validation; clearing procedure rows and retrying once: ${dialogMsg}`
            );
            await this.clearProcedureRows(3).catch(() => {});
            await this.page.waitForTimeout(300);
            const retryDialog = await clickWithDialogCapture(
              locator,
              'Save As Draft (retry after clearing procedures)'
            );
            await this.page.waitForLoadState('domcontentloaded').catch(() => {});
            await this.page.waitForTimeout(400);
            if (
              retryDialog &&
              /(please\s+enter|valid\s+amount|required|invalid|can\s*not|cannot|failed|error)/i.test(
                retryDialog
              ) &&
              !/are\s+you\s+sure|confirm/i.test(retryDialog)
            ) {
              logger.warn(`Draft retry still blocked: ${retryDialog}`);
              await this.page
                .screenshot({
                  path: 'screenshots/mhc-asia-draft-save-validation-error.png',
                  fullPage: true,
                })
                .catch(() => {});
              this.lastSaveDraftResult = {
                success: false,
                reason: mapDialogToSaveReason(retryDialog) || 'validation_error',
                dialogMessage: retryDialog,
                checkedAt: new Date().toISOString(),
              };
              return false;
            }
            logger.info('Claim saved as draft after clearing invalid procedure rows');
            this.lastSaveDraftResult = {
              success: true,
              reason: 'saved_after_procedure_clear',
              checkedAt: new Date().toISOString(),
            };
            return true;
          }
          if (
            dialogMsg &&
            /(please\s+enter|valid\s+amount|required|invalid|can\s*not|cannot|failed|error)/i.test(
              dialogMsg
            ) &&
            !/are\s+you\s+sure|confirm/i.test(dialogMsg)
          ) {
            logger.warn(`Draft save blocked by validation dialog: ${dialogMsg}`);
            await this.page
              .screenshot({
                path: 'screenshots/mhc-asia-draft-save-validation-error.png',
                fullPage: true,
              })
              .catch(() => {});
            this.lastSaveDraftResult = {
              success: false,
              reason: mapDialogToSaveReason(dialogMsg) || 'validation_error',
              dialogMessage: dialogMsg,
              checkedAt: new Date().toISOString(),
            };
            return false;
          }
          const inlineValidation = await captureInlineSaveValidation();
          if (inlineValidation?.reason) {
            logger.warn('Draft save blocked by inline validation', inlineValidation);
            await this.page
              .screenshot({
                path: 'screenshots/mhc-asia-draft-save-inline-validation-error.png',
                fullPage: true,
              })
              .catch(() => {});
            this.lastSaveDraftResult = {
              success: false,
              reason: inlineValidation.reason,
              inlineMessages: inlineValidation.messages || [],
              checkedAt: new Date().toISOString(),
            };
            return false;
          }
          let usedSecondClick = false;
          let secondDialogMsg = null;
          if (await shouldRetryAfterDisclaimer(dialogMsg)) {
            this._logStep('Draft save retry after disclaimer', {
              visitNo: this._lastSavedDraftVisitNo || null,
            });
            secondDialogMsg = await clickWithDialogCapture(
              locator,
              'Save As Draft (retry after disclaimer)'
            );
            await this.page.waitForLoadState('domcontentloaded').catch(() => {});
            await this.page.waitForTimeout(500);
            if (
              secondDialogMsg &&
              /(please\s+enter|valid\s+amount|required|invalid|can\s*not|cannot|failed|error)/i.test(
                secondDialogMsg
              ) &&
              !/are\s+you\s+sure|confirm|draft\s+claims\s+will\s+be\s+deleted/i.test(
                secondDialogMsg
              )
            ) {
              logger.warn(`Draft retry blocked by validation dialog: ${secondDialogMsg}`);
              await this.page
                .screenshot({
                  path: 'screenshots/mhc-asia-draft-save-validation-error-retry.png',
                  fullPage: true,
                })
                .catch(() => {});
              this.lastSaveDraftResult = {
                success: false,
                reason: mapDialogToSaveReason(secondDialogMsg) || 'validation_error',
                dialogMessage: secondDialogMsg,
                checkedAt: new Date().toISOString(),
              };
              return false;
            }
            usedSecondClick = true;
            const inlineValidationAfterRetry = await captureInlineSaveValidation();
            if (inlineValidationAfterRetry?.reason) {
              logger.warn('Draft retry blocked by inline validation', inlineValidationAfterRetry);
              await this.page
                .screenshot({
                  path: 'screenshots/mhc-asia-draft-save-inline-validation-error-retry.png',
                  fullPage: true,
                })
                .catch(() => {});
              this.lastSaveDraftResult = {
                success: false,
                reason: inlineValidationAfterRetry.reason,
                inlineMessages: inlineValidationAfterRetry.messages || [],
                checkedAt: new Date().toISOString(),
              };
              return false;
            }
          }

          const postSaveState = await captureDraftFieldState('post_save');
          this._lastSavedDraftVisitNo = String(postSaveState?.visitNo || '').trim() || null;
          await this.page
            .screenshot({ path: 'screenshots/mhc-asia-after-save-draft-state.png', fullPage: true })
            .catch(() => {});
          logger.info('Claim saved as draft (clicked Save As Draft)');
          this.lastSaveDraftResult = {
            success: true,
            reason: usedSecondClick ? 'saved_after_second_click' : 'saved',
            visitNo: this._lastSavedDraftVisitNo || null,
            dialogMessage: secondDialogMsg || dialogMsg || null,
            fieldState: postSaveState || null,
            checkedAt: new Date().toISOString(),
          };
          return true;
        } catch {
          continue;
        }
      }

      logger.warn('Could not find Save As Draft button');
      await this.page
        .screenshot({ path: 'screenshots/mhc-asia-save-draft-not-found.png', fullPage: true })
        .catch(() => {});
      this.lastSaveDraftResult = {
        success: false,
        reason: 'save_draft_button_not_found',
        checkedAt: new Date().toISOString(),
      };
      return false;
    } catch (error) {
      logger.error('Failed to save as draft:', error);
      this.lastSaveDraftResult = {
        success: false,
        reason: `save_draft_error:${error?.message || 'unknown'}`,
        checkedAt: new Date().toISOString(),
      };
      throw error;
    }
  }

  _normalizeDraftDate(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    const ymd = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (ymd) return `${ymd[3]}/${ymd[2]}/${ymd[1]}`;
    const dmy = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (dmy) return `${dmy[1]}/${dmy[2]}/${dmy[3]}`;
    return raw;
  }

  _normalizeDraftName(value) {
    return String(value || '')
      .toUpperCase()
      .replace(/^(MHC|AVIVA|SINGLIFE|AIA|AIACLIENT)\s*[-:|]+\s*/i, '')
      .replace(/[^A-Z0-9]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  _draftVisitNoRank(visitNo) {
    const raw = String(visitNo || '')
      .trim()
      .toUpperCase();
    const m = raw.match(/^EV(\d+)$/i);
    if (!m) return -1;
    const n = Number.parseInt(m[1], 10);
    return Number.isFinite(n) ? n : -1;
  }

  _inferPortalContext() {
    const url = this.page.url() || '';
    if (this.isSinglifeSystem || /pcpcare|singlife/i.test(url)) return 'singlife';
    if (this.isAiaClinicSystem || /aiaclinic\.com/i.test(url)) return 'aia';
    return 'mhc';
  }

  async _switchToPortalContext(context) {
    const snap = await this._getPortalContextSnapshot().catch(() => null);
    if (context === 'aia' && snap?.looksLikeAiaFlow) {
      this.isAiaClinicSystem = true;
      this.isSinglifeSystem = false;
      return true;
    }
    if (
      context === 'singlife' &&
      (snap?.isSinglifeDomain || /singlife|pcpcare/i.test(String(snap?.url || '')))
    ) {
      this.isSinglifeSystem = true;
      this.isAiaClinicSystem = false;
      return true;
    }
    if (context === 'mhc' && snap?.isMhcDomain && !snap?.isAiaDomain && !snap?.isSinglifeDomain) {
      this.isAiaClinicSystem = false;
      this.isSinglifeSystem = false;
      return true;
    }

    if (context === 'mhc') {
      await this.ensureAtMhcHome();
      return true;
    }

    if (context === 'singlife') {
      await this.ensureAtMhcHome();
      const switched = await this.switchToSinglifeIfNeeded({ force: true }).catch(() => false);
      if (switched) return true;
      const fallbackUrl = this._getDefaultSwitchSystemUrl(/singlife|aviva|pcp/i, 'Singlife');
      if (fallbackUrl) {
        const nextUrl = new URL(fallbackUrl, this.page.url()).toString();
        await this.page
          .goto(nextUrl, { waitUntil: 'domcontentloaded', timeout: 15000 })
          .catch(() => {});
        const fallbackSnap = await this._getPortalContextSnapshot().catch(() => null);
        if (
          fallbackSnap &&
          (fallbackSnap.isSinglifeDomain ||
            /singlife|pcpcare/i.test(String(fallbackSnap.url || '')))
        ) {
          this.isSinglifeSystem = true;
          this.isAiaClinicSystem = false;
          return true;
        }
      }
      return false;
    }

    if (context === 'aia') {
      await this.ensureAtMhcHome();
      const switched = await this._switchSystemTo(/aia\s*clinic/i, 'AIA Clinic').catch(() => false);
      if (switched) return true;
      const fallbackUrl = this._getDefaultSwitchSystemUrl(/aia\s*clinic|aiaclinic/i, 'AIA Clinic');
      if (fallbackUrl) {
        const nextUrl = new URL(fallbackUrl, this.page.url()).toString();
        await this.page
          .goto(nextUrl, { waitUntil: 'domcontentloaded', timeout: 15000 })
          .catch(() => {});
        const fallbackSwitch = await this._waitForAiaSwitch(9000).catch(() => ({
          ok: false,
          snap: null,
        }));
        if (fallbackSwitch.ok) {
          this.isAiaClinicSystem = true;
          this.isSinglifeSystem = false;
          return true;
        }
      }
      return false;
    }

    return false;
  }

  async _openEditDraftVisits() {
    const selectors = [
      'a:has-text("Edit/Draft Visits")',
      'button:has-text("Edit/Draft Visits")',
      'a[href*="ClinicEmpVisitDraftList"]',
      'a[href*="DraftList"]',
      'text=/Edit\\s*\\/\\s*Draft\\s+Visits/i',
    ];
    for (const selector of selectors) {
      const loc = this.page.locator(selector).first();
      if ((await loc.count().catch(() => 0)) === 0) continue;
      const visible = await loc.isVisible().catch(() => true);
      if (!visible) continue;
      await this._safeClick(loc, 'Edit/Draft Visits');
      await this.page.waitForLoadState('domcontentloaded').catch(() => {});
      await this.page.waitForTimeout(700);
      return true;
    }
    return false;
  }

  async _searchDraftByNric(nric) {
    const normalized = String(nric || '')
      .toUpperCase()
      .trim();
    if (!normalized) return false;

    await this.page
      .evaluate(value => {
        const pickOption = (sel, matcher) => {
          if (!sel) return false;
          const opts = Array.from(sel.options || []);
          const hit = opts.find(matcher);
          if (!hit) return false;
          sel.value = hit.value;
          sel.dispatchEvent(new Event('change', { bubbles: true }));
          return true;
        };

        const keySel = document.querySelector('select[name="key"]');
        pickOption(
          keySel,
          opt =>
            /patient\s*nric|nric/i.test(String(opt.textContent || '')) ||
            /patientnric|nric/i.test(String(opt.value || ''))
        );

        const keyTypeSel = document.querySelector('select[name="keyType"]');
        pickOption(
          keyTypeSel,
          opt => /equals/i.test(String(opt.textContent || '')) || String(opt.value || '') === 'E'
        );

        const input = document.querySelector('input[name="keyValue"]');
        if (input) {
          input.focus();
          input.value = value;
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }, normalized)
      .catch(() => {});

    const searchBtn = this.page
      .locator('input[name="SearchAction"], button:has-text("Search")')
      .first();
    if ((await searchBtn.count().catch(() => 0)) > 0) {
      await Promise.all([
        this.page.waitForLoadState('domcontentloaded').catch(() => {}),
        this._safeClick(searchBtn, 'Search Draft Visits').catch(() => {}),
      ]);
    } else {
      await this.page.keyboard.press('Enter').catch(() => {});
      await this.page.waitForLoadState('domcontentloaded').catch(() => {});
    }

    await this.page.waitForTimeout(700);
    return true;
  }

  async _extractDraftRows() {
    return this.page
      .evaluate(() => {
        const clean = s =>
          String(s || '')
            .replace(/\s+/g, ' ')
            .trim();
        const rows = [];
        for (const tr of Array.from(document.querySelectorAll('table tr'))) {
          const cells = Array.from(tr.querySelectorAll('th,td')).map(td => clean(td.textContent));
          if (cells.length < 5) continue;
          if (!/^\d{2}\/\d{2}\/\d{4}$/.test(cells[0])) continue;
          if (!/^EV/i.test(cells[1] || '')) continue;
          if (!/^[A-Z]\d{7}[A-Z]$/i.test(cells[3] || '')) continue;
          rows.push({
            visitDate: cells[0] || '',
            visitNo: cells[1] || '',
            type: cells[2] || '',
            patientNric: cells[3] || '',
            patientName: cells[4] || '',
            totalFee: cells[5] || '',
            totalClaim: cells[6] || '',
            mcDays: cells[7] || '',
            remarks: cells[8] || '',
          });
        }
        return { rows, url: location.href, title: document.title };
      })
      .catch(() => ({ rows: [], url: this.page.url() || '', title: '' }));
  }

  async openExistingDraftVisit({
    nric,
    visitDate = null,
    patientName = '',
    contextHint = null,
    allowCrossContext = false,
    expectedVisitNo = null,
  } = {}) {
    const normalizedNric = String(nric || '')
      .toUpperCase()
      .trim();
    if (!normalizedNric) return { found: false, reason: 'missing_nric' };

    const hint = String(contextHint || this._inferPortalContext() || 'mhc').toLowerCase();
    const normalizedExpectedVisitNo = String(expectedVisitNo || '')
      .toUpperCase()
      .trim();
    const contextOrder = [];
    const addCtx = ctx => {
      if (!ctx || contextOrder.includes(ctx)) return;
      contextOrder.push(ctx);
    };

    addCtx(hint);
    if (allowCrossContext && hint === 'aia') addCtx('mhc');
    if (allowCrossContext && hint === 'mhc') addCtx('aia');
    if (allowCrossContext && hint === 'singlife') addCtx('mhc');
    if (!contextOrder.length) addCtx('mhc');

    const attempts = [];
    for (const context of contextOrder) {
      const switched = await this._switchToPortalContext(context).catch(() => false);
      if (!switched) {
        attempts.push({ context, opened: false, rowsSeen: 0, reason: 'context_switch_failed' });
        continue;
      }

      const opened = await this._openEditDraftVisits();
      if (!opened) {
        attempts.push({ context, opened: false, rowsSeen: 0, reason: 'edit_draft_link_not_found' });
        continue;
      }

      await this._searchDraftByNric(normalizedNric);
      const extracted = await this._extractDraftRows();
      const matchPick = this._pickDraftRowWithReason(extracted.rows, {
        nric: normalizedNric,
        visitDate,
        patientName,
        expectedVisitNo: normalizedExpectedVisitNo || null,
      });
      const row = matchPick?.row || null;
      if (!row) {
        attempts.push({
          context,
          opened: true,
          rowsSeen: extracted.rows.length,
          reason: matchPick?.reason || 'draft_not_found',
          url: extracted.url,
        });
        continue;
      }

      const visitNo = String(row.visitNo || '').trim();
      if (!visitNo) {
        attempts.push({
          context,
          opened: true,
          rowsSeen: extracted.rows.length,
          reason: 'draft_row_missing_visit_no',
          row,
          url: extracted.url,
        });
        continue;
      }

      const link = this.page.locator('a', { hasText: visitNo }).first();
      let openTarget = link;
      if ((await openTarget.count().catch(() => 0)) === 0) {
        openTarget = this.page
          .locator(
            `tr:has-text("${visitNo}") a, tr:has-text("${visitNo}") button, tr:has-text("${visitNo}") input[type="button"], tr:has-text("${visitNo}") input[type="submit"]`
          )
          .first();
      }
      if ((await openTarget.count().catch(() => 0)) === 0) {
        attempts.push({
          context,
          opened: true,
          rowsSeen: extracted.rows.length,
          reason: 'draft_link_not_found',
          row,
          url: extracted.url,
        });
        continue;
      }

      await this._safeClick(openTarget, `Open Draft ${visitNo}`).catch(async () => {
        await openTarget.click({ timeout: 10000 }).catch(() => {});
      });
      await this.page.waitForLoadState('domcontentloaded').catch(() => {});
      await this.page.waitForTimeout(900);

      this._lastSavedDraftVisitNo = visitNo;
      return {
        found: true,
        context,
        row,
        rowsSeen: extracted.rows.length,
        url: extracted.url,
        attempts,
      };
    }

    return {
      found: false,
      reason: 'draft_not_found',
      attempts,
    };
  }

  _pickDraftRow(rows, { nric, visitDate, patientName, expectedVisitNo = null }) {
    const picked = this._pickDraftRowWithReason(rows, {
      nric,
      visitDate,
      patientName,
      expectedVisitNo,
    });
    return picked?.row || null;
  }

  _pickDraftRowWithReason(rows, { nric, visitDate, patientName, expectedVisitNo = null }) {
    const normalizedNric = String(nric || '')
      .toUpperCase()
      .trim();
    const normalizedDate = this._normalizeDraftDate(visitDate);
    const normalizedName = this._normalizeDraftName(patientName);
    const normalizedVisitNo = String(expectedVisitNo || '')
      .toUpperCase()
      .trim();

    const byNric = (rows || []).filter(
      row =>
        String(row?.patientNric || '')
          .toUpperCase()
          .trim() === normalizedNric
    );
    if (!byNric.length) return { row: null, reason: 'nric_no_match' };

    const byDate = normalizedDate
      ? byNric.filter(row => String(row?.visitDate || '').trim() === normalizedDate)
      : byNric;
    if (normalizedDate && !byDate.length) {
      return { row: null, reason: 'date_mismatch_no_match', byNricCount: byNric.length };
    }

    const candidates = normalizedDate ? byDate : byNric;
    const sorted = [...candidates].sort(
      (a, b) => this._draftVisitNoRank(b?.visitNo) - this._draftVisitNoRank(a?.visitNo)
    );

    if (normalizedVisitNo) {
      const byVisitNo = sorted.find(
        row =>
          String(row?.visitNo || '')
            .toUpperCase()
            .trim() === normalizedVisitNo
      );
      return byVisitNo
        ? { row: byVisitNo, reason: 'expected_visit_no_match' }
        : { row: null, reason: 'expected_visit_no_not_found', byNricCount: byNric.length };
    }

    if (!normalizedName) {
      return sorted[0]
        ? { row: sorted[0], reason: normalizedDate ? 'nric_date_match' : 'nric_match_latest' }
        : { row: null, reason: normalizedDate ? 'date_mismatch_no_match' : 'nric_no_match' };
    }

    const byName = sorted.find(row => {
      const rowName = this._normalizeDraftName(row?.patientName || '');
      return rowName && (rowName.includes(normalizedName) || normalizedName.includes(rowName));
    });
    if (byName)
      return { row: byName, reason: normalizedDate ? 'nric_date_name_match' : 'nric_name_match' };
    if (normalizedDate) {
      return sorted[0]
        ? { row: sorted[0], reason: 'nric_date_match_name_relaxed' }
        : { row: null, reason: 'date_mismatch_no_match' };
    }
    return sorted[0]
      ? { row: sorted[0], reason: 'nric_match_latest' }
      : { row: null, reason: 'nric_no_match' };
  }

  async verifyDraftSavedInPortal({
    nric,
    visitDate,
    patientName = '',
    contextHint = null,
    allowCrossContext = true,
    expectedVisitNo = null,
  } = {}) {
    const hint = String(contextHint || this._inferPortalContext()).toLowerCase();
    const normalizedExpectedVisitNo = String(expectedVisitNo || this._lastSavedDraftVisitNo || '')
      .toUpperCase()
      .trim();
    const contextOrder = [];
    const addCtx = ctx => {
      if (!ctx || contextOrder.includes(ctx)) return;
      contextOrder.push(ctx);
    };

    addCtx(hint);
    if (allowCrossContext && hint === 'aia') addCtx('mhc');
    if (allowCrossContext && hint === 'mhc') addCtx('aia');
    if (!contextOrder.includes('singlife') && hint === 'singlife') addCtx('singlife');

    const attempts = [];
    for (const context of contextOrder) {
      try {
        const switched = await this._switchToPortalContext(context);
        if (!switched) {
          attempts.push({ context, opened: false, rowsSeen: 0, reason: 'context_switch_failed' });
          continue;
        }

        for (let attemptNo = 1; attemptNo <= 3; attemptNo++) {
          const opened = await this._openEditDraftVisits();
          if (!opened) {
            attempts.push({
              context,
              attemptNo,
              opened: false,
              rowsSeen: 0,
              reason: 'edit_draft_link_not_found',
            });
            break;
          }

          await this._searchDraftByNric(nric);
          const extracted = await this._extractDraftRows();
          const matchPick = this._pickDraftRowWithReason(extracted.rows, {
            nric,
            visitDate,
            patientName,
            expectedVisitNo: normalizedExpectedVisitNo || null,
          });
          const match = matchPick?.row || null;
          attempts.push({
            context,
            attemptNo,
            opened: true,
            rowsSeen: extracted.rows.length,
            url: extracted.url,
            matched: Boolean(match),
            reason: match ? null : matchPick?.reason || 'draft_not_found',
            expectedVisitNo: normalizedExpectedVisitNo || null,
            match: match || null,
          });
          if (match) {
            return {
              found: true,
              context,
              row: match,
              rowsSeen: extracted.rows.length,
              url: extracted.url,
              attempts,
            };
          }

          if (attemptNo < 3) {
            // Some rows appear a few seconds after save due backend postback latency.
            await this.page.waitForTimeout(2500 * attemptNo);
          }
        }
      } catch (error) {
        attempts.push({
          context,
          opened: false,
          rowsSeen: 0,
          reason: error?.message || 'unknown_error',
        });
      }
    }

    return {
      found: false,
      contextTried: contextOrder,
      attempts,
    };
  }

  async _openClaimsHistoryPage() {
    const selectors = [
      'a:has-text("Claims History")',
      'button:has-text("Claims History")',
      'a:has-text("View Submitted Visits")',
      'button:has-text("View Submitted Visits")',
      'a:has-text("View Submitted Visit")',
      'button:has-text("View Submitted Visit")',
      'a[href="visit_list"]',
      'a[href*="visit_list"]',
      'text=/Claims\\s+History/i',
      'text=/View\\s+Submitted\\s+Visits?/i',
    ];
    for (const selector of selectors) {
      const loc = this.page.locator(selector).first();
      if ((await loc.count().catch(() => 0)) === 0) continue;
      const visible = await loc.isVisible().catch(() => true);
      if (!visible) continue;
      await this._safeClick(loc, 'Open Submitted Visits');
      await this.page.waitForLoadState('domcontentloaded').catch(() => {});
      await this.page.waitForTimeout(900);
      return true;
    }

    const fallbackHref = await this.page
      .evaluate(() => {
        const anchors = Array.from(document.querySelectorAll('a[href]'));
        const hit = anchors.find(anchor => {
          const text = String(anchor.textContent || '')
            .replace(/\s+/g, ' ')
            .trim();
          const href = String(anchor.getAttribute('href') || '').trim();
          return (
            /claims\s+history/i.test(text) ||
            /view\s+submitted\s+visits?/i.test(text) ||
            /^visit_list$/i.test(href) ||
            /visit_list/i.test(href)
          );
        });
        return hit ? String(hit.getAttribute('href') || '').trim() : '';
      })
      .catch(() => '');
    if (!fallbackHref) return false;
    await this.page
      .goto(new URL(fallbackHref, this.page.url()).toString(), {
        waitUntil: 'domcontentloaded',
        timeout: 15000,
      })
      .catch(() => {});
    await this.page.waitForTimeout(900);
    return true;
  }

  async _searchSubmittedClaims({
    expectedVisitNo = null,
    nric = null,
    visitDate = null,
    patientName = null,
  } = {}) {
    const normalizedVisitNo = String(expectedVisitNo || '')
      .trim()
      .toUpperCase();
    const normalizedNric = String(nric || '')
      .trim()
      .toUpperCase();
    const normalizedVisitDate = this._normalizeDraftDate(visitDate);
    const normalizedPatientName = String(patientName || '').trim();

    const searchPayload = await this.page
      .evaluate(
        ({ normalizedVisitNo, normalizedNric, normalizedVisitDate, normalizedPatientName }) => {
          const clean = value =>
            String(value || '')
              .replace(/\s+/g, ' ')
              .trim();
          const lower = value => clean(value).toLowerCase();
          const setValue = (el, value) => {
            if (!el) return false;
            const tag = String(el.tagName || '').toLowerCase();
            try {
              el.removeAttribute?.('readonly');
              el.removeAttribute?.('disabled');
              el.readOnly = false;
              el.disabled = false;
            } catch {
              // ignore
            }
            if (tag === 'select') {
              const options = Array.from(el.options || []);
              const match = options.find(option => {
                const text = lower(option.textContent || '');
                const val = lower(option.value || '');
                if (value.kind === 'visitNo')
                  return /visit\s*no|reference|claim/i.test(text) || /visit|claim/i.test(val);
                if (value.kind === 'nric')
                  return (
                    /nric|national id|member id|id no/i.test(text) || /nric|member|id/i.test(val)
                  );
                if (value.kind === 'name') return /name|member/i.test(text) || /name/i.test(val);
                if (value.kind === 'status')
                  return (
                    /submitted|completed|approved/i.test(text) ||
                    /submitted|completed|approved/i.test(val)
                  );
                return false;
              });
              if (!match) return false;
              el.value = match.value;
            } else {
              el.value = value.value;
            }
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
            return true;
          };

          const controls = Array.from(document.querySelectorAll('input, select, textarea'));
          const summaries = controls.map(control => {
            const tag = String(control.tagName || '').toLowerCase();
            const type = String(control.getAttribute('type') || '').toLowerCase();
            const name = clean(control.getAttribute('name') || control.getAttribute('id') || '');
            const label = clean(control.closest('td,th,label,div')?.textContent || '');
            return { control, tag, type, name, label };
          });

          const preferredTokens = normalizedVisitNo
            ? [{ kind: 'visitNo', value: normalizedVisitNo }]
            : normalizedNric
              ? [{ kind: 'nric', value: normalizedNric }]
              : normalizedPatientName
                ? [{ kind: 'name', value: normalizedPatientName }]
                : [];

          const findDateControl = which =>
            summaries.find(item => {
              if (!['input', 'textarea'].includes(item.tag)) return false;
              const hay = `${lower(item.name)} ${lower(item.label)}`;
              return which === 'from'
                ? /\bfrom\b/.test(hay) || /\bvisit\s*date\b/.test(hay)
                : /\bto\b/.test(hay) || /\bend\b/.test(hay);
            });
          const findNamedControl = pattern =>
            summaries.find(item => {
              if (!['input', 'textarea'].includes(item.tag)) return false;
              return pattern.test(lower(item.name));
            });

          let searchFieldFilled = false;
          for (const token of preferredTokens) {
            const textInput = summaries.find(item => {
              if (item.tag !== 'input' && item.tag !== 'textarea') return false;
              if (item.type && !['text', 'search', ''].includes(item.type)) return false;
              const hay = `${lower(item.name)} ${lower(item.label)}`;
              if (token.kind === 'visitNo') return /visit\s*no|claim|reference|search/i.test(hay);
              if (token.kind === 'nric')
                return /nric|national id|member id|id no|search/i.test(hay);
              if (token.kind === 'name') return /name|member|patient|search/i.test(hay);
              return false;
            });
            if (textInput && setValue(textInput.control, token)) {
              searchFieldFilled = true;
              break;
            }
          }

          const keySelect = summaries.find(
            item => item.tag === 'select' && /key|search/i.test(lower(item.name))
          );
          const valueInput = summaries.find(
            item =>
              item.tag === 'input' &&
              (!item.type || ['text', 'search', ''].includes(item.type)) &&
              /keyvalue|search|keyword|value/.test(lower(item.name) + ' ' + lower(item.label))
          );
          if (!searchFieldFilled && keySelect && valueInput && preferredTokens.length > 0) {
            const token = preferredTokens[0];
            searchFieldFilled =
              setValue(keySelect.control, token) && setValue(valueInput.control, token);
          }

          if (normalizedVisitDate) {
            const parts = normalizedVisitDate.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
            if (parts) {
              const [, day, month, year] = parts;
              const fromDay = findNamedControl(/^fromdateday$/);
              const fromMonth = findNamedControl(/^fromdatemonth$/);
              const fromYear = findNamedControl(/^fromdateyear$/);
              const toDay = findNamedControl(/^todateday$/);
              const toMonth = findNamedControl(/^todatemonth$/);
              const toYear = findNamedControl(/^todateyear$/);
              if (fromDay) setValue(fromDay.control, { kind: 'date_day', value: day });
              if (fromMonth) setValue(fromMonth.control, { kind: 'date_month', value: month });
              if (fromYear) setValue(fromYear.control, { kind: 'date_year', value: year });
              if (toDay) setValue(toDay.control, { kind: 'date_day', value: day });
              if (toMonth) setValue(toMonth.control, { kind: 'date_month', value: month });
              if (toYear) setValue(toYear.control, { kind: 'date_year', value: year });
            } else if (!normalizedVisitNo) {
              const fromControl = findDateControl('from');
              const toControl = findDateControl('to');
              if (fromControl)
                setValue(fromControl.control, { kind: 'date', value: normalizedVisitDate });
              if (toControl)
                setValue(toControl.control, { kind: 'date', value: normalizedVisitDate });
            }
          }

          const statusSelect = summaries.find(
            item =>
              item.tag === 'select' && /status/i.test(lower(item.name) + ' ' + lower(item.label))
          );
          if (statusSelect) setValue(statusSelect.control, { kind: 'status', value: 'submitted' });
          const keyTypeSelect = summaries.find(
            item =>
              item.tag === 'select' &&
              /keytype|match/i.test(lower(item.name) + ' ' + lower(item.label))
          );
          if (keyTypeSelect && preferredTokens.length > 0) {
            const token = preferredTokens[0];
            if (token.kind === 'visitNo' || token.kind === 'nric') {
              const options = Array.from(keyTypeSelect.control.options || []);
              const exact = options.find(
                option =>
                  /equals\s*to/i.test(clean(option.textContent || '')) ||
                  /^=$/.test(clean(option.value || ''))
              );
              if (exact) {
                keyTypeSelect.control.value = exact.value;
                keyTypeSelect.control.dispatchEvent(new Event('input', { bubbles: true }));
                keyTypeSelect.control.dispatchEvent(new Event('change', { bubbles: true }));
              }
            }
          }

          return {
            searchFieldFilled,
            controls: summaries.slice(0, 40).map(item => ({
              tag: item.tag,
              type: item.type,
              name: item.name,
              label: item.label,
            })),
          };
        },
        {
          normalizedVisitNo,
          normalizedNric,
          normalizedVisitDate,
          normalizedPatientName,
        }
      )
      .catch(() => ({ searchFieldFilled: false, controls: [] }));

    const searchButton = this.page
      .locator(
        'input[name="SearchAction"], button:has-text("Search"), button:has-text("Retrieve"), input[value*="Search" i], input[value*="Retrieve" i]'
      )
      .first();
    if ((await searchButton.count().catch(() => 0)) > 0) {
      await Promise.all([
        this.page.waitForLoadState('domcontentloaded').catch(() => {}),
        this._safeClick(searchButton, 'Search Submitted Claims').catch(() => {}),
      ]);
    } else {
      await this.page.keyboard.press('Enter').catch(() => {});
      await this.page.waitForLoadState('domcontentloaded').catch(() => {});
    }
    await this.page.waitForTimeout(1000);
    return searchPayload;
  }

  async _extractSubmittedRows() {
    return this.page
      .evaluate(() => {
        const clean = value =>
          String(value || '')
            .replace(/\s+/g, ' ')
            .trim();
        const rows = [];
        for (const tr of Array.from(document.querySelectorAll('table tr'))) {
          const cells = Array.from(tr.querySelectorAll('th,td')).map(td => clean(td.textContent));
          if (cells.length < 3) continue;
          const text = clean(tr.textContent);
          const visitNo = cells.find(cell => /^(EV\d+|CL\d+)/i.test(cell)) || '';
          const visitDate =
            cells.find(cell => /^\d{2}\/\d{2}\/\d{4}$/.test(cell)) ||
            cells.find(cell => /^\d{4}-\d{2}-\d{2}$/.test(cell)) ||
            '';
          const patientNric = cells.find(cell => /^[A-Z]\d{7}[A-Z]$/i.test(cell)) || '';
          const patientName =
            cells.find(
              cell =>
                !!cell &&
                !/^(EV\d+|CL\d+)/i.test(cell) &&
                !/^\d{2}\/\d{2}\/\d{4}$/.test(cell) &&
                !/^[A-Z]\d{7}[A-Z]$/i.test(cell) &&
                !/submitted|completed|approved|rejected|view|detail|edit/i.test(cell.toLowerCase())
            ) || '';
          const status =
            cells.find(cell =>
              /submitted|completed|approved|rejected|draft/i.test(cell.toLowerCase())
            ) || '';
          const totalClaim =
            [...cells].reverse().find(cell => /\$?\d+(?:,\d{3})*(?:\.\d{2})/.test(cell)) || '';

          const actions = Array.from(
            tr.querySelectorAll('a, button, input[type="button"], input[type="submit"]')
          )
            .map(el => ({
              text: clean(el.textContent || el.value || ''),
              href: clean(el.getAttribute?.('href') || ''),
            }))
            .filter(action => action.text || action.href);

          if (!visitNo && !visitDate && !patientNric && !patientName) continue;
          rows.push({
            visitNo,
            visitDate,
            patientNric,
            patientName,
            status,
            totalClaim,
            text,
            cells,
            actions,
          });
        }
        return { rows, url: location.href, title: document.title };
      })
      .catch(() => ({ rows: [], url: this.page.url() || '', title: '' }));
  }

  _pickSubmittedRowWithReason(
    rows,
    { nric, visitDate, patientName = '', expectedVisitNo = null } = {}
  ) {
    const normalizedVisitNo = String(expectedVisitNo || '')
      .trim()
      .toUpperCase();
    const normalizedNric = String(nric || '')
      .trim()
      .toUpperCase();
    const normalizedDate = this._normalizeDraftDate(visitDate);
    const normalizedName = this._normalizeDraftName(patientName);

    const submittedRows = (rows || []).filter(
      row => !row?.status || /submitted|completed|approved/i.test(String(row.status || ''))
    );
    const pool = submittedRows.length ? submittedRows : rows || [];

    if (normalizedVisitNo) {
      const byVisitNo = pool.find(
        row =>
          String(row?.visitNo || '')
            .trim()
            .toUpperCase() === normalizedVisitNo
      );
      if (byVisitNo) return { row: byVisitNo, reason: 'visit_no_match' };
    }

    const byNric = normalizedNric
      ? pool.filter(
          row =>
            String(row?.patientNric || '')
              .trim()
              .toUpperCase() === normalizedNric
        )
      : pool;
    if (normalizedNric && !byNric.length) return { row: null, reason: 'nric_no_match' };

    const byDate = normalizedDate
      ? byNric.filter(row => this._normalizeDraftDate(row?.visitDate || '') === normalizedDate)
      : byNric;
    if (normalizedDate && !byDate.length) {
      return { row: null, reason: 'date_mismatch_no_match' };
    }

    if (normalizedName) {
      const byName = byDate.find(row => {
        const rowName = this._normalizeDraftName(row?.patientName || '');
        return rowName && (rowName.includes(normalizedName) || normalizedName.includes(rowName));
      });
      if (byName) return { row: byName, reason: 'nric_date_name_match' };
    }

    return byDate[0]
      ? { row: byDate[0], reason: 'best_available_match' }
      : { row: null, reason: 'submitted_detail_not_found' };
  }

  async openSubmittedClaimDetail({
    nric,
    visitDate = null,
    patientName = '',
    contextHint = null,
    allowCrossContext = true,
    expectedVisitNo = null,
  } = {}) {
    const normalizedNric = String(nric || '')
      .toUpperCase()
      .trim();
    if (!normalizedNric && !expectedVisitNo && !patientName) {
      return { found: false, reason: 'missing_identifiers' };
    }

    const hint = String(contextHint || this._inferPortalContext() || 'mhc').toLowerCase();
    const contextOrder = [];
    const addCtx = ctx => {
      if (!ctx || contextOrder.includes(ctx)) return;
      contextOrder.push(ctx);
    };
    addCtx(hint);
    if (allowCrossContext && hint === 'aia') addCtx('mhc');
    if (allowCrossContext && hint === 'mhc') addCtx('aia');
    if (!contextOrder.length) addCtx('mhc');

    const attempts = [];
    for (const context of contextOrder) {
      try {
        const switched = await this._switchToPortalContext(context);
        if (!switched) {
          attempts.push({ context, opened: false, reason: 'context_switch_failed' });
          continue;
        }

        const opened = await this._openClaimsHistoryPage();
        if (!opened) {
          attempts.push({ context, opened: false, reason: 'claims_history_link_not_found' });
          continue;
        }

        const searchPayload = await this._searchSubmittedClaims({
          expectedVisitNo,
          nric: normalizedNric,
          visitDate,
          patientName,
        }).catch(() => ({ searchFieldFilled: false, controls: [] }));
        const extracted = await this._extractSubmittedRows();
        const matchPick = this._pickSubmittedRowWithReason(extracted.rows, {
          nric: normalizedNric,
          visitDate,
          patientName,
          expectedVisitNo,
        });
        const row = matchPick?.row || null;
        if (!row) {
          attempts.push({
            context,
            opened: true,
            reason: matchPick?.reason || 'submitted_detail_not_found',
            rowsSeen: extracted.rows.length,
            url: extracted.url,
            searchPayload,
          });
          continue;
        }

        const rowKey = row.visitNo || row.patientNric || row.patientName || row.visitDate || '';
        const detailTarget = this.page
          .locator(
            `tr:has-text("${rowKey}") a, tr:has-text("${rowKey}") button, tr:has-text("${rowKey}") input[type="button"], tr:has-text("${rowKey}") input[type="submit"]`
          )
          .filter({ hasText: /view|detail|open|edit/i })
          .first();
        const fallbackTarget = this.page
          .locator(
            `tr:has-text("${rowKey}") a, tr:has-text("${rowKey}") button, tr:has-text("${rowKey}") input[type="button"], tr:has-text("${rowKey}") input[type="submit"]`
          )
          .first();
        const openTarget =
          (await detailTarget.count().catch(() => 0)) > 0 ? detailTarget : fallbackTarget;

        if ((await openTarget.count().catch(() => 0)) === 0) {
          attempts.push({
            context,
            opened: true,
            reason: 'submitted_detail_action_not_found',
            rowsSeen: extracted.rows.length,
            url: extracted.url,
            row,
          });
          continue;
        }

        await this._safeClick(openTarget, `Open Submitted Claim ${rowKey}`).catch(async () => {
          await openTarget.click({ timeout: 10000 }).catch(() => {});
        });
        await this.page.waitForLoadState('domcontentloaded').catch(() => {});
        await this.page.waitForTimeout(1000);

        return {
          found: true,
          context,
          row,
          rowsSeen: extracted.rows.length,
          url: extracted.url,
          attempts,
          searchPayload,
        };
      } catch (error) {
        attempts.push({
          context,
          opened: false,
          reason: error?.code || error?.message || 'unknown_error',
        });
        if (error?.portalBlocked === true) throw error;
      }
    }

    return {
      found: false,
      reason: 'submitted_detail_not_found',
      attempts,
    };
  }

  async captureSubmittedTruthSnapshot({
    visit = null,
    nric,
    visitDate = null,
    patientName = '',
    contextHint = null,
    allowCrossContext = true,
    expectedVisitNo = null,
  } = {}) {
    const opened = await this.openSubmittedClaimDetail({
      nric,
      visitDate,
      patientName,
      contextHint,
      allowCrossContext,
      expectedVisitNo,
    });
    if (!opened?.found) {
      return {
        found: false,
        reason: opened?.reason || 'submitted_detail_not_found',
        attempts: opened?.attempts || [],
      };
    }
    const snapshot = await this.captureCurrentVisitFormSnapshot({
      visit,
      phase: 'submitted_truth',
      portalTarget: 'MHC',
      includeScreenshot: true,
    });
    const hasComparableTruth = Boolean(
      snapshot?.patientName ||
      snapshot?.patientNric ||
      snapshot?.visitDate ||
      snapshot?.diagnosisText ||
      snapshot?.totalFee ||
      snapshot?.totalClaim
    );
    if (!hasComparableTruth) {
      return {
        found: false,
        reason: 'submitted_detail_navigation_failed',
        attempts: opened?.attempts || [],
      };
    }
    return {
      ...opened,
      found: true,
      snapshot: {
        ...snapshot,
        source: 'mhc_submitted_detail',
      },
    };
  }

  /**
   * Clear procedure rows to avoid portal validation when procedure selection is not valid.
   */
  async clearProcedureRows(maxRows = 3) {
    const cleared = await this.page
      .evaluate(
        ({ maxRows }) => {
          const norm = s => (s || '').toString().replace(/\s+/g, ' ').trim().toLowerCase();
          const isVisible = el => {
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
          const isTextLike = el => {
            if (!el) return false;
            const tag = (el.tagName || '').toLowerCase();
            if (tag === 'select' || tag === 'textarea') return true;
            const t = String(el.getAttribute('type') || '').toLowerCase();
            return !t || t === 'text' || t === 'number' || t === 'tel';
          };
          const clearRowInputs = row => {
            if (!row) return 0;
            const inputs = Array.from(
              row.querySelectorAll(
                'input[type="text"], input[type="number"], input[type="tel"], input:not([type]), select, textarea'
              )
            ).filter(el => isVisible(el) && isTextLike(el));
            if (!inputs.length) return 0;
            for (const inp of inputs) setValue(inp, '');
            return 1;
          };

          let totalCleared = 0;
          const tables = Array.from(document.querySelectorAll('table')).filter(t =>
            /procedure\s*name/i.test(norm(t.innerText || t.textContent || ''))
          );
          if (tables.length) {
            const table = tables
              .map(t => ({
                t,
                score: /total\s+proc\s+fee/i.test(norm(t.innerText || t.textContent || '')) ? 1 : 0,
              }))
              .sort((a, b) => b.score - a.score)[0].t;
            const rows = Array.from(table.querySelectorAll('tr')).filter(
              r => r.closest('table') === table
            );
            const headerIdx = rows.findIndex(r =>
              /procedure\s*name/i.test(norm(r.innerText || r.textContent || ''))
            );
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
              if (
                !rowText ||
                /total\s+proc\s+fee|total\s+before\s+gst|copayment|cash\s+collected|gst/.test(
                  rowText
                )
              )
                continue;
              const rowInputs = Array.from(
                row.querySelectorAll(
                  'input[type="text"], input[type="number"], input[type="tel"], input:not([type]), select, textarea'
                )
              ).filter(el => isVisible(el) && isTextLike(el));
              if (!rowInputs.length) continue;
              const hasProcedureLikeValue = rowInputs.some(el => {
                const idn =
                  `${el.getAttribute('name') || ''} ${el.getAttribute('id') || ''} ${el.className || ''}`.toLowerCase();
                if (!/proc|procedure|claim/.test(idn)) return false;
                return !!String(el.value || '').trim();
              });
              if (!hasProcedureLikeValue) continue;
              totalCleared += clearRowInputs(row);
            }
          }

          // Fallback 2: geometry band between "Procedure Name" header and "Total Proc Fee".
          if (totalCleared < maxRows) {
            const labels = Array.from(
              document.querySelectorAll('th, td, div, span, label, b, strong')
            );
            const procHeader =
              labels.find(el => /procedure\s*name/i.test(norm(el.textContent || ''))) || null;
            const totalProc =
              labels.find(el => /total\s+proc\s+fee/i.test(norm(el.textContent || ''))) || null;
            if (procHeader) {
              const top = procHeader.getBoundingClientRect().bottom + 2;
              const bottom = totalProc ? totalProc.getBoundingClientRect().top - 2 : top + 260;

              // First try the portal's native row clear control ("C"), which also clears hidden backing fields.
              const clearButtons = Array.from(
                document.querySelectorAll(
                  'button, input[type="button"], input[type="submit"], input[type="reset"]'
                )
              )
                .filter(el => isVisible(el))
                .filter(el => /^c$/i.test(norm(el.textContent || el.value || '')))
                .map(el => ({ el, r: el.getBoundingClientRect() }))
                .filter(({ r }) => r.top >= top && r.bottom <= bottom)
                .sort((a, b) => a.r.top - b.r.top || a.r.left - b.r.left);
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
                document.querySelectorAll(
                  'input[type="text"], input[type="number"], input[type="tel"], input:not([type]), select, textarea'
                )
              )
                .filter(el => isVisible(el) && isTextLike(el))
                .map(el => ({ el, r: el.getBoundingClientRect() }))
                .filter(({ r }) => r.top >= top && r.bottom <= bottom)
                .sort((a, b) => a.r.top - b.r.top || a.r.left - b.r.left);
              const rowsByY = [];
              for (const item of textLikes) {
                const bucket = rowsByY.find(g => Math.abs(g.y - item.r.top) <= 8);
                if (bucket) bucket.items.push(item.el);
                else rowsByY.push({ y: item.r.top, items: [item.el] });
              }
              rowsByY.sort((a, b) => a.y - b.y);
              for (const g of rowsByY) {
                if (totalCleared >= maxRows) break;
                const meaningful = g.items.some(el => !!String(el.value || '').trim());
                if (!meaningful) continue;
                for (const el of g.items) setValue(el, '');
                totalCleared++;
              }
            }
          }

          return totalCleared;
        },
        { maxRows: Math.max(1, Number(maxRows || 3)) }
      )
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
          if (element && (await element.isVisible())) {
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
        .evaluate(val => {
          const norm = s => (s || '').replace(/\s+/g, ' ').trim().toLowerCase();
          const rows = Array.from(document.querySelectorAll('tr'));
          const row = rows.find(r =>
            /visit\s*date/i.test(norm(r.innerText || r.textContent || ''))
          );
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
        logger.error('Portal rejected visit date and redirected to error page', {
          date: normalized,
        });
        await this.page
          .screenshot({ path: 'screenshots/mhc-visit-date-invalid.png', fullPage: true })
          .catch(() => {});
        return false;
      }

      logger.warn('Visit date field not found');
      await this.page
        .screenshot({ path: 'screenshots/mhc-visit-date-not-found.png', fullPage: true })
        .catch(() => {});
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
    const apply = async frame =>
      frame
        .evaluate(() => {
          try {
            const enable = el => {
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
        (await this.page
          .locator('text=/Employee\\s+Visit\\s*-\\s*Add/i')
          .count()
          .catch(() => 0)) > 0;
      const hasConsultFee =
        (await this.page
          .locator('text=/Consultation\\s+Fee/i')
          .count()
          .catch(() => 0)) > 0;
      const hasDrugHeader =
        (await this.page
          .locator('text=/Drug\\s+Name/i')
          .count()
          .catch(() => 0)) > 0;
      const hasSaveDraft =
        (await this.page
          .locator('button:has-text("Save As Draft"), input[value*="Save As Draft" i]')
          .count()
          .catch(() => 0)) > 0;
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
    await this.page
      .screenshot({ path: 'screenshots/mhc-visit-form-not-ready.png', fullPage: true })
      .catch(() => {});
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
        new: 'First Consult',
        'follow up': 'Follow Up',
        follow: 'Follow Up',
        repeat: 'Repeat Medicine',
        'repeat medicine': 'Repeat Medicine',
      };

      const mhcType = typeMap[visitType?.toLowerCase()] || 'Follow Up';

      // Prefer row-based lookup to avoid mis-detecting unrelated selects.
      const rowFilled = await this.page
        .evaluate(label => {
          const norm = s => (s || '').toString().replace(/\\s+/g, ' ').trim().toLowerCase();
          const rows = Array.from(document.querySelectorAll('tr'));
          const row = rows.find(r => /(charge|visit)\\s*type/i.test(norm(r.textContent || '')));
          if (!row) return false;
          const select =
            row.querySelector('select') ||
            row.querySelector(
              'select[name*="charge" i], select[id*="charge" i], select[name*="visit" i], select[id*="visit" i], select[name*="type" i]'
            );
          if (!select) return false;
          const options = Array.from(select.querySelectorAll('option'));
          const desired = String(label || '').toLowerCase();
          const match =
            options.find(o => norm(o.textContent || o.value || '') === desired) ||
            options.find(o => norm(o.textContent || o.value || '').includes(desired)) ||
            options.find(
              o =>
                /first\\s*consult/i.test(norm(o.textContent || o.value || '')) &&
                /first/.test(desired)
            ) ||
            options.find(
              o =>
                /follow\\s*up/i.test(norm(o.textContent || o.value || '')) && /follow/.test(desired)
            );
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
        .evaluate(label => {
          const norm = s => (s || '').toString().replace(/\s+/g, ' ').trim().toLowerCase();
          const rows = Array.from(document.querySelectorAll('tr'));
          const row = rows.find(r => /(charge|visit)\\s*type/i.test(norm(r.textContent || '')));
          if (!row) return false;
          const select =
            row.querySelector('select') ||
            row.querySelector(
              'select[name*="charge" i], select[id*="charge" i], select[name*="visit" i], select[id*="visit" i], select[name*="type" i]'
            );
          if (!select) return false;
          const options = Array.from(select.querySelectorAll('option'));
          const desired = String(label || '').toLowerCase();
          const match =
            options.find(o => norm(o.textContent || o.value || '') === desired) ||
            options.find(o => norm(o.textContent || o.value || '').includes(desired));
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

      const fillByOptions = async frame =>
        frame
          .evaluate(label => {
            const norm = s => (s || '').toString().replace(/\s+/g, ' ').trim().toLowerCase();
            const desired = norm(label);
            const selects = Array.from(document.querySelectorAll('select'));
            for (const select of selects) {
              const options = Array.from(select.querySelectorAll('option')).map(o => ({
                value: o.value,
                label: norm(o.textContent || o.value || ''),
              }));
              const hasChargeOptions = options.some(o =>
                /(first\\s*consult|follow\\s*up|repeat\\s*medicine)/i.test(o.label)
              );
              if (!hasChargeOptions) continue;
              const match =
                options.find(o => o.label === desired) ||
                options.find(o => o.label.includes(desired)) ||
                options.find(o => /first\\s*consult/i.test(o.label) && /first/.test(desired)) ||
                options.find(o => /follow\\s*up/i.test(o.label) && /follow/.test(desired)) ||
                options.find(o => /repeat\\s*medicine/i.test(o.label) && /repeat/.test(desired));
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
      const toNum = s => {
        const t = (s ?? '').toString().replace(/[^\d.]/g, '');
        const n = Number.parseFloat(t);
        return Number.isFinite(n) ? n : null;
      };

      // Always attempt to set MC Day, even when 0, to avoid leaving '?' placeholders.

      // Safe path: DOM-scan within the exact "MC Day" row and fill/select within it only.
      // Avoid geometric selectors (easy to target Visit Date by mistake).
      const scanned = await this.page
        .evaluate(
          ({ days }) => {
            const norm = s => (s || '').toString().replace(/\s+/g, ' ').trim();
            const toNum = s => {
              const t = (s ?? '').toString().replace(/[^\d.]/g, '');
              const n = Number.parseFloat(t);
              return Number.isFinite(n) ? n : null;
            };
            const isMcDayLabel = t => /^MC\s*Day\b/i.test(t) && !/^MC\s*Start/i.test(t);

            const rowHasField = row =>
              row && row.querySelector('select, input:not([type="hidden"])');

            const cells = Array.from(
              document.querySelectorAll('td, th, div, span, label, b, strong')
            );
            const candidates = cells
              .map(el => ({ el, text: norm(el.textContent) }))
              .filter(x => isMcDayLabel(x.text))
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
                  const labelCells = Array.from(r.querySelectorAll('td, th')).filter(td =>
                    isMcDayLabel(norm(td.textContent))
                  );
                  if (!labelCells.length) continue;
                  if (!rowHasField(r)) continue;
                  const rowText = norm(r.textContent);
                  if (/^visit\s*date\b/i.test(rowText) || /\bvisit\s*date\b/i.test(rowText))
                    continue;
                  row = r;
                  break;
                }
                if (row) break;
              }
            }

            if (!row) return { ok: false, reason: 'row_not_found' };

            const select = row.querySelector('select');
            if (select) {
              const opts = Array.from(select.options || []).map(o => ({
                value: (o.value || '').trim(),
                label: norm(o.textContent),
              }));
              let match = null;
              if (days <= 0) {
                // Most portals treat "0" as the valid "no MC" value; selecting an empty/"?" placeholder
                // can trigger "Invalid MC Day value!" dialogs later.
                match =
                  opts.find(o => toNum(o.value) === 0 || toNum(o.label) === 0) ||
                  opts.find(
                    o => (o.value || '').trim() === '0' || (o.label || '').trim() === '0'
                  ) ||
                  opts.find(o => (o.value || '').trim() === '') ||
                  opts.find(
                    o => (o.label || '').trim() === '?' || /\bselect\b/i.test(o.label || '')
                  ) ||
                  opts.find(o => /^n\/?a$/i.test((o.label || '').trim()));
              }
              if (!match) {
                match =
                  opts.find(o => toNum(o.value) === days) ||
                  opts.find(o => toNum(o.label) === days) ||
                  opts.find(o => o.value === String(days) || o.label === String(days));
              }
              if (!match)
                return { ok: false, reason: 'no_matching_option', options: opts.slice(0, 30) };

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
              const hidden = Array.from(row.querySelectorAll('input[type="hidden"]')).filter(
                h => /mc/i.test(h.name || h.id || '') && /day/i.test(h.name || h.id || '')
              );
              for (const h of hidden) {
                h.value = v;
                h.dispatchEvent(new Event('input', { bubbles: true }));
                h.dispatchEvent(new Event('change', { bubbles: true }));
              }
              return { ok: true, kind: 'input', value: v };
            }

            return { ok: false, reason: 'no_field_in_row' };
          },
          { days }
        )
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
              .evaluate(el =>
                `${el.getAttribute('name') || ''} ${el.getAttribute('id') || ''}`.toLowerCase()
              )
              .catch(() => '');
            if (nid.includes('visit') || nid.includes('date')) continue;

            const tag = await field.evaluate(el => el.tagName).catch(() => 'INPUT');
            if (tag === 'SELECT') {
              const options = await field
                .locator('option')
                .evaluateAll(opts =>
                  opts.map(o => ({ value: o.value, label: (o.textContent || '').trim() }))
                );
              const match =
                (days === 0
                  ? options.find(o => toNum(o.value) === 0 || toNum(o.label) === 0) ||
                    options.find(
                      o => (o.value || '').trim() === '0' || (o.label || '').trim() === '0'
                    ) ||
                    options.find(
                      o =>
                        (o.value || '').trim() === '' ||
                        (o.label || '').trim() === '' ||
                        /^\?$/.test((o.label || '').trim()) ||
                        /\bselect\b/i.test(o.label || '') ||
                        /^n\/?a$/i.test((o.label || '').trim())
                    )
                  : null) ||
                options.find(o => toNum(o.value) === days) ||
                options.find(o => toNum(o.label) === days) ||
                options.find(
                  o =>
                    (o.label || '').trim() === String(days) ||
                    (o.value || '').trim() === String(days)
                ) ||
                options.find(o => toNum(o.value) === 0 || toNum(o.label) === 0);
              if (match) {
                await field
                  .selectOption({ value: match.value })
                  .catch(async () => field.selectOption({ label: match.label }));
                this._logStep('MC days selected', {
                  mcDays: days,
                  value: match.value,
                  label: match.label,
                });
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
          .evaluate(
            el => String(el.value || '').trim() === '?' || String(el.value || '').trim() === ''
          )
          .catch(() => false);
        if (placeholderPresent) {
          this._logStep('MC days left as placeholder to avoid portal validation', { mcDays: days });
          return true;
        }
      }

      if (scanned?.reason === 'no_matching_option') {
        this._logStep('MC day present but no matching option', { mcDays: days, ...scanned });
        await this.page
          .screenshot({ path: 'screenshots/mhc-mc-days-option-not-found.png', fullPage: true })
          .catch(() => {});
        return false;
      }

      logger.warn('MC days field not found');
      await this.page
        .screenshot({ path: 'screenshots/mhc-mc-days-not-found.png', fullPage: true })
        .catch(() => {});
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
        .evaluate(value => {
          const norm = s => (s || '').toString().replace(/\s+/g, ' ').trim();
          const isVisible = el => {
            if (!el) return false;
            const style = window.getComputedStyle(el);
            if (!style) return false;
            if (style.display === 'none' || style.visibility === 'hidden') return false;
            return true;
          };
          const _sameNumeric = (a, b) => {
            const n1 = Number(String(a || '').trim());
            const n2 = Number(String(b || '').trim());
            if (!Number.isFinite(n1) || !Number.isFinite(n2)) return false;
            return Math.abs(n1 - n2) < 1e-9;
          };
          const cells = Array.from(document.querySelectorAll('td, th, label, span, b, strong'));
          const label = cells.find(el => /^Consultation\s*Fee\b/i.test(norm(el.textContent)));
          if (!label) return { ok: false, reason: 'label_not_found' };
          const row = label.closest('tr');
          if (!row) return { ok: false, reason: 'row_not_found' };
          const inputs = Array.from(
            row.querySelectorAll('input[type="text"], input[type="number"], input:not([type])')
          ).filter(x => isVisible(x) && !x.disabled);
          if (!inputs.length) return { ok: false, reason: 'input_not_found' };
          const score = inp => {
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
          if ((await feeLabel.count()) > 0) {
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
            if ((await input.count()) > 0) {
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
          await this.page.evaluate(value => {
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
        const okButton = this.page
          .locator('button:has-text("OK"), input[value="OK"], button:has-text("Yes")')
          .first();
        if ((await okButton.count()) > 0 && (await okButton.isVisible())) {
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

  getLastDiagnosisSelectionState() {
    return this.lastDiagnosisSelection || null;
  }

  getLastWaiverReferralState() {
    return this.lastWaiverReferralState || null;
  }

  getLastSaveDraftResult() {
    return this.lastSaveDraftResult || null;
  }

  async _extractCurrentVisitFormSnapshot() {
    const snapshot = await this.page
      .evaluate(() => {
        const clean = value =>
          String(value || '')
            .replace(/\s+/g, ' ')
            .trim();
        const toKey = value =>
          clean(value)
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '_')
            .replace(/^_+|_+$/g, '');
        const readValue = el => {
          if (!el) return '';
          const tag = String(el.tagName || '').toLowerCase();
          const type = String(el.getAttribute?.('type') || '').toLowerCase();
          if (type === 'checkbox') return el.checked ? 'true' : 'false';
          if (type === 'radio')
            return el.checked ? clean(el.value || el.getAttribute?.('value') || 'true') : '';
          if (tag === 'select') {
            const selected = el.options?.[el.selectedIndex];
            return clean(selected?.textContent || el.value || '');
          }
          return clean(el.value ?? el.textContent ?? '');
        };
        const isUsefulField = el => {
          const tag = String(el.tagName || '').toLowerCase();
          if (!['input', 'select', 'textarea'].includes(tag)) return false;
          const type = String(el.getAttribute?.('type') || '').toLowerCase();
          if (type === 'hidden' || type === 'button' || type === 'submit' || type === 'reset')
            return false;
          return true;
        };
        const formFields = Array.from(document.querySelectorAll('input, select, textarea')).filter(
          isUsefulField
        );
        const namedValues = {};
        for (const field of formFields) {
          const key = clean(field.getAttribute('name') || field.getAttribute('id') || '');
          if (!key) continue;
          const value = readValue(field);
          if (!value) continue;
          namedValues[key] = value;
        }

        const rows = Array.from(document.querySelectorAll('tr'));
        const rowEntries = rows
          .map(row => {
            const cells = Array.from(row.querySelectorAll('th,td'));
            if (!cells.length) return null;
            const cellTexts = cells.map(cell => clean(cell.textContent));
            const fields = Array.from(row.querySelectorAll('input, select, textarea'))
              .filter(isUsefulField)
              .map(field => {
                const value = readValue(field);
                const name = clean(field.getAttribute('name') || field.getAttribute('id') || '');
                const label =
                  clean(
                    field.getAttribute('aria-label') ||
                      field.getAttribute('placeholder') ||
                      field.closest('td,th,label')?.textContent ||
                      ''
                  ) || null;
                return {
                  name: name || null,
                  label,
                  value: value || '',
                  tag: String(field.tagName || '').toLowerCase(),
                };
              })
              .filter(entry => entry.value || entry.name || entry.label);
            if (!fields.length && cellTexts.length < 2) return null;
            return {
              label: cellTexts[0] || '',
              text: clean(row.textContent),
              cellTexts,
              fields,
            };
          })
          .filter(Boolean);

        const findByNames = (...names) => {
          for (const name of names) {
            if (namedValues[name]) return namedValues[name];
            const hit = Object.entries(namedValues).find(
              ([key]) => key.toLowerCase() === String(name).toLowerCase()
            );
            if (hit?.[1]) return hit[1];
          }
          return '';
        };

        const findRowValue = (matcher, excludeMatcher = null) => {
          for (const row of rowEntries) {
            const label = clean(row.label || row.cellTexts?.[0] || '');
            const text = clean(row.text || '');
            if (!matcher(label) && !matcher(text)) continue;
            if (excludeMatcher && (excludeMatcher(label) || excludeMatcher(text))) continue;
            const fieldValue = row.fields.map(field => field.value).find(Boolean);
            if (fieldValue) {
              return {
                value: fieldValue,
                label: label || null,
              };
            }
            const fallback = row.cellTexts.slice(1).find(Boolean);
            if (fallback) {
              return {
                value: fallback,
                label: label || null,
              };
            }
          }
          return null;
        };
        const findLabeledText = matcher => {
          const candidates = rowEntries
            .map(row => {
              const label = clean(row.label || row.cellTexts?.[0] || '');
              const text = clean(row.text || '');
              return { row, label, text };
            })
            .filter(entry => matcher(entry.label) || matcher(entry.text))
            .sort((left, right) => {
              const leftExact = matcher(left.label) ? 1 : 0;
              const rightExact = matcher(right.label) ? 1 : 0;
              if (leftExact !== rightExact) return rightExact - leftExact;
              return left.text.length - right.text.length;
            });
          for (const entry of candidates) {
            const { row, label, text } = entry;
            const compactCells = Array.isArray(row.cellTexts) ? row.cellTexts.filter(Boolean) : [];
            if (compactCells.length >= 2 && matcher(compactCells[0])) {
              return clean(compactCells.slice(1).join(' '));
            }
            if (label && text.startsWith(label)) {
              const stripped = clean(text.slice(label.length));
              if (stripped) return stripped;
            }
          }
          return '';
        };

        const collectLineItems = () => {
          const items = [];
          const pushItem = (kind, name, meta = {}) => {
            const cleanName = clean(name);
            if (!cleanName) return;
            if (/^(drug name|procedure name|unit|qty|claim|amount|medicine)$/i.test(cleanName))
              return;
            const normalizedKind = clean(kind) || 'item';
            const dupeKey = `${normalizedKind}|${cleanName}|${clean(meta.quantity || '')}|${clean(meta.amount || '')}`;
            if (items.some(item => item._dupeKey === dupeKey)) return;
            items.push({
              kind: normalizedKind,
              name: cleanName,
              quantity: clean(meta.quantity || '') || null,
              unitPrice: clean(meta.unitPrice || '') || null,
              amount: clean(meta.amount || '') || null,
              raw: clean(meta.raw || '') || null,
              _dupeKey: dupeKey,
            });
          };

          for (const [key, value] of Object.entries(namedValues)) {
            const lower = key.toLowerCase();
            if (/drug[_-]?drugname|medicine|medication/i.test(lower) && clean(value)) {
              pushItem('drug', value, {
                quantity: namedValues.drug_quantity || namedValues.quantity || '',
                unitPrice: namedValues.drug_unitPrice || namedValues.unitPrice || '',
                amount: namedValues.drug_amount || namedValues.drugFee || '',
              });
            }
            if (/procedure[_-]?procedurename|procedure_name/i.test(lower) && clean(value)) {
              pushItem('procedure', value, {
                amount: namedValues.proc_amount || namedValues.procedure_amount || '',
              });
            }
          }

          for (const row of rowEntries) {
            const label = clean(row.label || row.cellTexts?.[0] || '');
            const text = clean(row.text || '');
            if (text.length > 220) continue;
            if (
              !/\b(drug|medicine|medication|procedure|service)\b/i.test(label) &&
              !/\b(drug|medicine|medication|procedure|service)\b/i.test(text)
            ) {
              continue;
            }
            const valueCells = row.cellTexts.slice(1).filter(Boolean);
            if (!valueCells.length) continue;
            if (
              valueCells.every(
                cell => !/\d/.test(cell) && /unit|qty|claim|amount|price|sgd/i.test(cell)
              )
            ) {
              continue;
            }
            if (/first consult|follow up|repeat medicine/i.test(valueCells[0])) {
              continue;
            }
            pushItem(
              /\bprocedure\b/i.test(label) || /\bprocedure\b/i.test(text) ? 'procedure' : 'item',
              valueCells[0],
              {
                quantity: valueCells[1] || '',
                amount: valueCells[valueCells.length - 1] || '',
                raw: text,
              }
            );
          }

          return items.map(item => ({
            kind: item.kind,
            name: item.name,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            amount: item.amount,
            raw: item.raw,
          }));
        };

        const diagnosisRow = findRowValue(
          text => /\bdiagnosis\b/i.test(text),
          text => /\bdiagnosis\s+history\b/i.test(text)
        );
        const diagnosisDesc = findByNames('diagnosisPriDesc') || diagnosisRow?.value || '';
        const diagnosisCodeCandidate =
          findByNames('diagnosisPriId') ||
          findByNames('diagnosisPriIdTemp') ||
          clean(diagnosisRow?.value || '').match(/[A-Z]\d{2,3}(?:\.\d+)?[A-Z]?/i)?.[0] ||
          clean(diagnosisDesc).match(/[A-Z]\d{2,3}(?:\.\d+)?[A-Z]?/i)?.[0] ||
          '';
        const diagnosisCode = /^(NA|N\/A|NONE)$/i.test(diagnosisCodeCandidate)
          ? clean(diagnosisDesc).match(/[A-Z]\d{2,3}(?:\.\d+)?[A-Z]?/i)?.[0] || ''
          : diagnosisCodeCandidate;
        const patientNameRow = findRowValue(
          text => /\b(employee|member|patient)\s+name\b/i.test(text),
          text => /\bdoctor\b/i.test(text)
        );
        const patientNricRow = findRowValue(text =>
          /\b(nric|fin|member\s*id|employee\s*id|id\s*no)\b/i.test(text)
        );
        const chargeTypeRow = findRowValue(text => /\bcharge\s*type\b/i.test(text));
        const mcDaysRow = findRowValue(
          text => /^mc\s*day\b/i.test(text) || /\bmc\s*day\b/i.test(text),
          text => /\bmc\s*start/i.test(text)
        );
        const mcStartRow = findRowValue(text => /\bmc\s*start\b/i.test(text));
        const visitDateRow = findRowValue(text => /\bvisit\s*date\b/i.test(text));
        const consultFeeRow = findRowValue(text => /\bconsultation\s*fee\b/i.test(text));
        const totalFeeRow = findRowValue(
          text => /^total\s*fee\b/i.test(text) || /\btotal\s*fee\b/i.test(text)
        );
        const totalClaimRow = findRowValue(
          text => /^total\s*claim\b/i.test(text) || /\btotal\s*claim\b/i.test(text)
        );
        const remarksRow = findRowValue(text => /\bremarks?\b/i.test(text));
        const claimStatusRow = findRowValue(text => /\bclaim\s*status\b/i.test(text));
        const lineItems = collectLineItems();
        const patientNameText = findLabeledText(text =>
          /\b(employee|member|patient)\s+name\b/i.test(text)
        );
        const patientIdText = findLabeledText(text =>
          /\b(patient|member|employee)\s+id\b/i.test(text)
        );
        const visitNoText = findLabeledText(text => /\bvisit\s+no\b/i.test(text));
        const visitNoFromText =
          clean(visitNoText).match(/\b(?:EV|CL)\d+\b/i)?.[0] ||
          rowEntries
            .map(row => clean(row.text || ''))
            .map(text => text.match(/\b(?:EV|CL)\d+\b/i)?.[0] || '')
            .find(Boolean) ||
          '';
        const specialRemarksText = findLabeledText(text => /\bspecial\s+remarks?\b/i.test(text));
        const safeRowValue = row => {
          const value = clean(row?.value || '');
          return value.length > 120 ? '' : value;
        };
        const normalizedRemarks = (() => {
          const fieldRemark =
            findByNames('remarks', 'remark', 'specialRemarks', 'specialRemark') || '';
          if (clean(fieldRemark)) return clean(fieldRemark);
          const shortSpecialRemarks = clean(specialRemarksText);
          if (shortSpecialRemarks && shortSpecialRemarks.length <= 160) return shortSpecialRemarks;
          return '';
        })();

        const canonical = {
          visitNo:
            findByNames('visitNo') ||
            visitNoFromText ||
            clean(visitNoText).match(/\b(?:EV|CL)\d+\b/i)?.[0] ||
            '',
          visitDate: findByNames('visitDateAsString', 'visitDate') || visitDateRow?.value || '',
          claimStatus: findByNames('claimStatus') || claimStatusRow?.value || '',
          patientName:
            findByNames('patientName', 'memberName', 'employeeName') ||
            patientNameText ||
            safeRowValue(patientNameRow) ||
            '',
          patientNric:
            findByNames('nric', 'icNo', 'memberId', 'employeeId', 'patientId') ||
            patientIdText ||
            safeRowValue(patientNricRow) ||
            '',
          chargeType:
            findByNames('chargeType', 'visitType') ||
            findByNames('subType') ||
            safeRowValue(chargeTypeRow) ||
            '',
          mcDays: findByNames('mcDay', 'mcDays', 'medicalLeaveDay') || mcDaysRow?.value || '',
          mcStartDate:
            findByNames('mcStartDateAsString', 'mcStartDate', 'mcDate', 'medicalLeaveDate') ||
            safeRowValue(mcStartRow) ||
            '',
          diagnosisCode,
          diagnosisText: diagnosisDesc,
          consultationFee:
            findByNames('consultFee', 'consultationFee') || consultFeeRow?.value || '',
          totalFee:
            findByNames('totalUnitFee', 'totalFee', 'empVisitDetail_totalFee') ||
            totalFeeRow?.value ||
            '',
          totalClaim:
            findByNames(
              'totalUnitClaim',
              'totalClaim',
              'totalClaimInitial',
              'totalClaimRevised',
              'empVisitDetail_totalClaim'
            ) ||
            totalClaimRow?.value ||
            '',
          remarks: normalizedRemarks || safeRowValue(remarksRow) || '',
          lineItems,
        };

        return {
          url: location.href,
          title: document.title,
          context: /aiaclinic/i.test(location.href)
            ? 'aia'
            : /pcpcare|singlife/i.test(location.href)
              ? 'singlife'
              : 'mhc',
          canonical,
          fieldState: {
            ...namedValues,
          },
          lineItems,
          rowHints: rowEntries.slice(0, 80).map(row => ({
            key: toKey(row.label || row.cellTexts?.[0] || row.text || ''),
            label: row.label || null,
            text: row.text || null,
            values: row.fields.map(field => ({
              name: field.name,
              value: field.value,
            })),
          })),
        };
      })
      .catch(error => ({
        url: this.page.url() || '',
        title: '',
        context: this._inferPortalContext(),
        canonical: {},
        fieldState: {},
        rowHints: [],
        error: error?.message || String(error),
      }));

    return {
      capturedAt: new Date().toISOString(),
      source: 'mhc_current_form',
      portalContext: snapshot?.context || this._inferPortalContext(),
      url: snapshot?.url || this.page.url() || '',
      title: snapshot?.title || '',
      ...(snapshot?.canonical || {}),
      fieldState: snapshot?.fieldState || {},
      rowHints: snapshot?.rowHints || [],
      error: snapshot?.error || null,
    };
  }

  async captureCurrentVisitFormSnapshot({
    visit = null,
    phase = 'current_form',
    portalTarget = 'MHC',
    includeScreenshot = true,
  } = {}) {
    const snapshot = await this._extractCurrentVisitFormSnapshot();
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const safeId = String(visit?.id || 'unknown').replace(/[^A-Za-z0-9_-]/g, '_');
    const safePhase = String(phase || 'current_form').replace(/[^A-Za-z0-9_-]/g, '_');
    const baseDir = path.resolve(process.cwd(), 'output', 'playwright');
    const screenshotPath = path.join(baseDir, `flow3-${safePhase}-${safeId}-${stamp}.png`);
    const jsonPath = path.join(baseDir, `flow3-${safePhase}-${safeId}-${stamp}.json`);
    const payload = {
      generatedAt: new Date().toISOString(),
      phase: safePhase,
      portalTarget,
      visit: visit
        ? {
            id: visit.id || null,
            patient_name: visit.patient_name || null,
            visit_date: visit.visit_date || null,
            pay_type: visit.pay_type || null,
            nric: visit.nric || null,
          }
        : null,
      snapshot,
    };

    await fs.mkdir(baseDir, { recursive: true });
    await fs.writeFile(jsonPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');

    let savedScreenshotPath = null;
    if (includeScreenshot) {
      try {
        await this.page.screenshot({ path: screenshotPath, fullPage: true });
        savedScreenshotPath = screenshotPath;
      } catch (error) {
        logger.warn('[MHC] Failed to capture form snapshot screenshot', {
          phase: safePhase,
          visitId: visit?.id || null,
          error: error?.message || String(error),
        });
      }
    }

    return {
      ...snapshot,
      phase: safePhase,
      artifacts: {
        json: jsonPath,
        screenshot: savedScreenshotPath,
      },
    };
  }

  async captureDraftTruthSnapshot({
    visit = null,
    nric,
    visitDate = null,
    patientName = '',
    contextHint = null,
    allowCrossContext = true,
    expectedVisitNo = null,
  } = {}) {
    const opened = await this.openExistingDraftVisit({
      nric,
      visitDate,
      patientName,
      contextHint,
      allowCrossContext,
      expectedVisitNo,
    });
    if (!opened?.found) {
      return {
        found: false,
        reason: opened?.reason || 'draft_not_found',
        attempts: opened?.attempts || [],
      };
    }
    const snapshot = await this.captureCurrentVisitFormSnapshot({
      visit,
      phase: 'draft_truth',
      portalTarget: 'MHC',
      includeScreenshot: true,
    });
    return {
      ...opened,
      found: true,
      snapshot: {
        ...snapshot,
        source: 'mhc_draft_form',
      },
    };
  }

  getLastDiagnosisPrefetchState() {
    return this.lastDiagnosisPrefetch || null;
  }

  _extractDiagnosisCodeToken(value) {
    const raw = String(value || '')
      .toUpperCase()
      .replace(/[^A-Z0-9.]/g, ' ');
    const m = raw.match(/\b[A-Z][0-9]{2,3}(?:\.[0-9A-Z]{1,4})?\b/);
    return m ? m[0] : null;
  }

  _buildDiagnosisSearchTermsFromHint(diagnosisHint) {
    const code = String(diagnosisHint?.code || '').trim();
    const desc = String(diagnosisHint?.description || '').trim();
    const descNorm = desc
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const side = descNorm.match(/\b(left|right|bilateral)\b/)?.[1] || '';
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
      'left',
      'right',
      'bilateral',
      'of',
      'the',
      'in',
    ]);
    const tokens = descNorm.split(/\s+/).filter(w => w.length >= 3 && !stop.has(w));
    const bodyPart = tokens[0] || '';
    const sideBody = side && bodyPart ? `${side} ${bodyPart}` : '';
    const noDot = code ? code.replace(/\./g, '') : '';
    const candidates = [
      sideBody,
      bodyPart,
      tokens.slice(0, 2).join(' '),
      descNorm.split(' ').slice(0, 5).join(' '),
      descNorm,
      code,
      noDot,
    ]
      .map(v => String(v || '').trim())
      .filter(v => v.length >= 2);
    return Array.from(new Set(candidates));
  }

  async prefetchDiagnosisOptions(opts = {}) {
    const { diagnosisHint = null, maxRows = 100, maxTerms = 6, contextHint = null } = opts || {};

    const fetchedAt = new Date().toISOString();
    const context = String(contextHint || this._inferPortalContext() || 'mhc').toLowerCase();
    const options = [];
    const seen = new Set();
    const searchTerms = this._buildDiagnosisSearchTermsFromHint(diagnosisHint).slice(0, maxTerms);
    const addOption = row => {
      const text = String(row?.text || '')
        .replace(/\s+/g, ' ')
        .trim();
      if (!text) return;
      if (/^\s*na\s*$/i.test(text)) return;
      const code = this._extractDiagnosisCodeToken(row?.code || text) || null;
      const key = `${code || ''}|${text.toLowerCase()}`;
      if (seen.has(key)) return;
      seen.add(key);
      options.push({
        code,
        text,
        value: String(row?.value || '').trim() || null,
        source: row?.source || 'unknown',
        context,
        fetched_at: fetchedAt,
      });
    };

    try {
      // 1) Fast path: collect from diagnosis dropdown options on the form.
      const dropdown = this.page
        .locator('select[name="diagnosisPriIdTemp"], select[id*="diagnosisPriIdTemp" i]')
        .first();
      if (
        (await dropdown.count().catch(() => 0)) > 0 &&
        (await dropdown.isVisible().catch(() => false))
      ) {
        const dropdownOptions = await dropdown
          .locator('option')
          .evaluateAll(opts =>
            opts.map(o => ({
              text: String(o.textContent || '').trim(),
              value: String(o.value || '').trim(),
            }))
          )
          .catch(() => []);
        for (const opt of dropdownOptions) {
          addOption({
            code: this._extractDiagnosisCodeToken(opt.text || opt.value || ''),
            text: opt.text,
            value: opt.value,
            source: 'dropdown',
          });
        }
      }

      // 2) Modal search path: gather selectable diagnosis rows.
      const mButtonSelectors = [
        'input[name="SelectDiagnosisFromMaster"][onclick*="diagnosisPriId"]',
        'input[onclick*="doSelectMasterDiagnosis"][onclick*="diagnosisPriId"]',
        'tr:has-text("Diagnosis Pri") input[name="SelectDiagnosisFromMaster"]',
        'tr:has-text("Diagnosis Pri") input[value*="M"]',
        'tr:has-text("Diagnosis Pri") input[type="button"][value*="M"]',
      ];

      const popupPromise = this.page.waitForEvent('popup', { timeout: 5000 }).catch(() => null);
      let mClicked = false;
      for (const selector of mButtonSelectors) {
        const btn = this.page.locator(selector).first();
        if ((await btn.count().catch(() => 0)) === 0) continue;
        if (!(await btn.isVisible().catch(() => false))) continue;
        await btn.click({ timeout: 2000 }).catch(async () => {
          await btn.click({ force: true, timeout: 2000 }).catch(() => {});
        });
        mClicked = true;
        break;
      }

      if (mClicked) {
        const popup = await popupPromise;
        if (popup) {
          await popup.waitForLoadState('domcontentloaded').catch(() => {});
          await popup.waitForTimeout(250);
        } else {
          await this.page.waitForTimeout(350);
        }

        let ctx = null;
        if (popup) {
          ctx = {
            kind: 'popup',
            locator: sel => popup.locator(sel),
            waitForTimeout: ms => popup.waitForTimeout(ms),
            close: async () => popup.close().catch(() => {}),
          };
        } else {
          const modal = this.page
            .locator('dialog, [role="dialog"], .ui-dialog, .modal, .popup')
            .filter({
              has: this.page.locator('input[type="text"], input[type="search"], input:not([type])'),
            })
            .first();
          if (
            (await modal.count().catch(() => 0)) > 0 &&
            (await modal.isVisible().catch(() => false))
          ) {
            ctx = {
              kind: 'modal',
              locator: sel => modal.locator(sel),
              waitForTimeout: ms => this.page.waitForTimeout(ms),
              close: async () => {
                const closeBtn = modal
                  .locator(
                    'button:has-text("Close"), button.close, [data-dismiss="modal"], a:has-text("Close")'
                  )
                  .first();
                if ((await closeBtn.count().catch(() => 0)) > 0) {
                  await closeBtn.click().catch(() => {});
                }
                await this.page.keyboard.press('Escape').catch(() => {});
              },
            };
          }
        }

        if (ctx) {
          const searchField = ctx
            .locator(
              [
                'input[name="keyValue"]:not([readonly]):not([disabled])',
                'input[name*="search" i]:not([readonly]):not([disabled])',
                'input[type="search"]:not([readonly]):not([disabled])',
                'input[type="text"]:not([readonly]):not([disabled])',
              ].join(', ')
            )
            .first();
          const hasSearchField = (await searchField.count().catch(() => 0)) > 0;
          if (hasSearchField && searchTerms.length) {
            const searchBtn = ctx
              .locator(
                [
                  'input[name="SearchAction"]',
                  'input[value*="Search" i]',
                  'button:has-text("Search")',
                  'button:has-text("Find")',
                  'input[type="submit"]',
                  'input[type="button"][value*="Search" i]',
                ].join(', ')
              )
              .first();

            for (const term of searchTerms) {
              await searchField.fill(term).catch(async () => {
                await searchField.click().catch(() => {});
                await searchField.press('Control+A').catch(() => {});
                await searchField.type(term).catch(() => {});
              });
              if (
                (await searchBtn.count().catch(() => 0)) > 0 &&
                (await searchBtn.isVisible().catch(() => false))
              ) {
                await searchBtn.click().catch(() => {});
              } else {
                await searchField.press('Enter').catch(() => {});
              }
              await ctx.waitForTimeout(650);

              const rows = ctx.locator('table tr');
              const rowCount = Math.min(await rows.count().catch(() => 0), maxRows);
              for (let i = 0; i < rowCount; i++) {
                const row = rows.nth(i);
                const rowText = String((await row.innerText().catch(() => '')) || '')
                  .replace(/\s+/g, ' ')
                  .trim();
                if (!rowText) continue;
                if (
                  /click on the diagnosis|starts with|equals to|next|prev|sort/i.test(
                    rowText.toLowerCase()
                  )
                ) {
                  continue;
                }
                const hasSelectable =
                  (await row
                    .locator('a, button, input[type="button"], input[type="submit"]')
                    .count()
                    .catch(() => 0)) > 0;
                if (!hasSelectable) continue;
                const code = this._extractDiagnosisCodeToken(rowText);
                if (!code && !/[a-z]{3,}/i.test(rowText)) continue;
                addOption({
                  code,
                  text: rowText,
                  source: `modal:${term.slice(0, 32)}`,
                });
              }
            }
          }
          await ctx.close?.().catch(() => {});
        }
      }

      const result = {
        fetched_at: fetchedAt,
        context,
        searchTerms,
        options,
        total: options.length,
      };
      this.lastDiagnosisPrefetch = result;
      this._logStep('Prefetched portal diagnosis options', {
        context,
        total: options.length,
        searchTerms: searchTerms.slice(0, 6),
      });
      return result;
    } catch (error) {
      const result = {
        fetched_at: fetchedAt,
        context,
        searchTerms,
        options,
        total: options.length,
        error: error?.message || String(error),
      };
      this.lastDiagnosisPrefetch = result;
      logger.warn('[MHC] Failed to prefetch diagnosis options', {
        context,
        error: error?.message || String(error),
      });
      return result;
    }
  }

  async getDiagnosisResolutionState(opts = {}) {
    const { waitMs = 0 } = opts || {};
    if (waitMs > 0) {
      await this.page.waitForTimeout(waitMs).catch(() => {});
    }

    const state = await this.page
      .evaluate(() => {
        const readInputValue = selector => {
          const el = document.querySelector(selector);
          if (!el) return '';
          return String(el.value || '').trim();
        };
        const readSelectLabel = selector => {
          const el = document.querySelector(selector);
          if (!el || el.tagName?.toLowerCase() !== 'select') return '';
          const selected = el.options?.[el.selectedIndex];
          return String(selected?.textContent || el.value || '').trim();
        };

        const diagnosisPriId = readInputValue(
          'input[name="diagnosisPriId"], input[id*="diagnosisPriId" i]'
        );
        const diagnosisPriDesc = readInputValue(
          'input[name="diagnosisPriDesc"], input[id*="diagnosisPriDesc" i], input[name*="diagnosisPriDesc" i]'
        );
        const diagnosisPriIdTemp = readSelectLabel(
          'select[name="diagnosisPriIdTemp"], select[id*="diagnosisPriIdTemp" i]'
        );

        const bodyText = String(document.body?.innerText || '');
        const hasPrimaryRequiredError = /Diagnosis\s+Primary\s+is\s+required/i.test(bodyText);

        const descNorm = diagnosisPriDesc.toLowerCase();
        const hasValidDesc =
          !!diagnosisPriDesc &&
          !/^\s*na\s*$/i.test(diagnosisPriDesc) &&
          !/^\s*missing diagnosis\s*$/i.test(descNorm);
        const hasValidId = !!diagnosisPriId;
        const dropdownStillNa = /^\s*na\s*$/i.test(diagnosisPriIdTemp || '');
        // Some portal contexts accept a filled primary diagnosis description even when
        // the dropdown text remains "NA" after modal interactions.
        let resolved = hasValidId || hasValidDesc;
        if (hasPrimaryRequiredError) resolved = false;

        const reasons = [];
        if (!hasValidId) reasons.push('missing_diagnosis_pri_id');
        if (!hasValidDesc) reasons.push('missing_or_invalid_diagnosis_pri_desc');
        if (hasPrimaryRequiredError) reasons.push('portal_error_diagnosis_primary_required');
        if (dropdownStillNa) reasons.push('diagnosis_dropdown_still_na');

        return {
          resolved,
          diagnosisPriId,
          diagnosisPriDesc,
          diagnosisPriIdTemp,
          hasPrimaryRequiredError,
          reasons,
        };
      })
      .catch(error => ({
        resolved: false,
        diagnosisPriId: '',
        diagnosisPriDesc: '',
        diagnosisPriIdTemp: '',
        hasPrimaryRequiredError: false,
        reasons: [`diagnosis_state_eval_failed:${error?.message || 'unknown'}`],
      }));

    const out = {
      ...state,
      checkedAt: new Date().toISOString(),
      url: this.page.url(),
    };
    this.lastDiagnosisResolutionCheck = out;
    this._logStep('Diagnosis resolution check', {
      resolved: out.resolved,
      diagnosisPriId: out.diagnosisPriId ? '[set]' : '',
      diagnosisPriDesc: out.diagnosisPriDesc ? out.diagnosisPriDesc.slice(0, 80) : '',
      reasons: out.reasons,
    });
    return out;
  }

  /**
   * Fill Primary Diagnosis using "M" button search modal.
   * Accepts either a string, or an object { code, description }.
   */
  async fillDiagnosisPrimary(diagnosisText, options = {}) {
    try {
      const allowTextFallback =
        options?.allowTextFallback === true || process.env.MHC_ALLOW_DIAG_TEXT_FALLBACK === '1';
      // When the extractor said `missing_in_source` we MUST NOT let the modal's
      // first-ICD-row-wins picker fire — that is how visit 3fb132fc ended up
      // submitted as "S83.411A - Sprain of the knee" against an admin truth of
      // "Cough" (the picker grabbed a leftover row from the prior patient's
      // session). Caller passes `disableGenericRowPick: true` for this case.
      const disableGenericRowPick = options?.disableGenericRowPick === true;
      const code =
        diagnosisText && typeof diagnosisText === 'object'
          ? String(diagnosisText.code || '').trim()
          : '';
      const desc =
        diagnosisText && typeof diagnosisText === 'object'
          ? String(diagnosisText.description || '').trim()
          : String(diagnosisText || '').trim();

      const preview = (code || desc).slice(0, 50);
      this._logStep('Fill primary diagnosis via M button', { diagnosis: preview });
      this.lastDiagnosisSelection = {
        ok: false,
        method: 'modal',
        diagnosis: { code: code || null, description: desc || null },
        reason: 'not_attempted',
        checkedAt: new Date().toISOString(),
      };

      const finalizeDiagnosisResult = async (meta = {}) => {
        const resolution = await this.getDiagnosisResolutionState({ waitMs: 350 }).catch(() => ({
          resolved: false,
          reasons: ['diagnosis_state_check_failed'],
        }));
        const ok = !!resolution?.resolved;
        const selection = {
          ok,
          method: meta.method || 'modal',
          diagnosis: { code: code || null, description: desc || null },
          reason: ok ? null : 'diagnosis_mapping_failed',
          resolution,
          ...meta,
          checkedAt: new Date().toISOString(),
        };
        this.lastDiagnosisSelection = selection;
        return ok;
      };

      if (!(code || desc) || (code || desc).length < 2) {
        logger.warn('Diagnosis text too short, skipping');
        this.lastDiagnosisSelection = {
          ok: false,
          method: 'modal',
          diagnosis: { code: code || null, description: desc || null },
          reason: 'search_term_too_short',
          checkedAt: new Date().toISOString(),
        };
        return false;
      }

      const fillInFormTextFallback = async why => {
        const fallbackText = [code, desc].filter(Boolean).join(' - ').slice(0, 80);
        if (!fallbackText) return false;
        // In AIA Clinic pages, only write to explicit diagnosis primary description inputs.
        // Avoid generic fallback that could spill into Special Remarks.
        const urlNow = this.page.url() || '';
        if (this.isAiaClinicSystem || /aiaclinic\.com/i.test(urlNow)) {
          const safeFilled = await this.page
            .evaluate(value => {
              const isVisible = el => {
                if (!el) return false;
                const style = window.getComputedStyle(el);
                if (!style) return false;
                if (style.display === 'none' || style.visibility === 'hidden') return false;
                const rect = el.getBoundingClientRect();
                if (!rect || rect.width <= 0 || rect.height <= 0) return false;
                return true;
              };
              const candidates = Array.from(
                document.querySelectorAll(
                  'input[name="diagnosisPriDesc"], input[id*="diagnosisPriDesc" i], input[name*="diagnosisPriDesc" i]'
                )
              ).filter(el => {
                const name = `${el.getAttribute('name') || ''} ${el.id || ''}`.toLowerCase();
                if (name.includes('sec') || name.includes('secondary')) return false;
                if (el.disabled) return false;
                return isVisible(el);
              });
              if (!candidates.length) return false;
              const target = candidates[0];
              target.readOnly = false;
              target.removeAttribute && target.removeAttribute('readonly');
              target.value = String(value || '');
              target.dispatchEvent(new Event('input', { bubbles: true }));
              target.dispatchEvent(new Event('change', { bubbles: true }));
              return String(target.value || '').trim().length > 0;
            }, fallbackText)
            .catch(() => false);
          if (safeFilled) {
            this._logStep('AIA Clinic: diagnosisPriDesc filled via explicit safe fallback');
            return true;
          }
          logger.warn(
            'AIA Clinic: explicit diagnosisPriDesc fallback failed; skipping generic in-form fallback to avoid Special Remarks'
          );
          return false;
        }
        if (why) this._logStep(why, { url: this.page.url() });

        const filled = await this.page
          .evaluate(val => {
            const norm = s => (s || '').toString().replace(/\s+/g, ' ').trim();
            const isVisible = el => {
              if (!el) return false;
              const style = window.getComputedStyle(el);
              if (!style) return false;
              if (style.display === 'none' || style.visibility === 'hidden') return false;
              const rect = el.getBoundingClientRect();
              if (!rect || rect.width <= 0 || rect.height <= 0) return false;
              return true;
            };
            const _sameNumeric = (a, b) => {
              const n1 = Number(String(a || '').trim());
              const n2 = Number(String(b || '').trim());
              if (!Number.isFinite(n1) || !Number.isFinite(n2)) return false;
              return Math.abs(n1 - n2) < 1e-9;
            };
            const isAllowed = el => {
              if (!el || el.disabled) return false;
              if (!isVisible(el)) return false;
              const tag = el.tagName?.toLowerCase();
              const name =
                `${el.getAttribute('name') || ''} ${el.id || ''} ${el.getAttribute('aria-label') || ''}`.toLowerCase();
              if (name.includes('remark') || name.includes('special')) return false;
              const cellText = norm(el.closest('td, th')?.textContent || '');
              const rowText = norm(el.closest('tr')?.textContent || '');
              if (/special\s+remarks/i.test(cellText) || /special\s+remarks/i.test(rowText))
                return false;
              if (tag === 'textarea' && !/diag|dx|icd/.test(name)) return false;
              return tag === 'input' || tag === 'textarea';
            };
            const setField = (el, value) => {
              if (!el) return false;
              try {
                el.readOnly = false;
                el.disabled = false;
                el.removeAttribute && el.removeAttribute('readonly');
                el.removeAttribute && el.removeAttribute('disabled');
              } catch {
                // ignore
              }
              el.scrollIntoView && el.scrollIntoView({ block: 'center' });
              el.value = String(value || '');
              el.dispatchEvent(new Event('input', { bubbles: true }));
              el.dispatchEvent(new Event('change', { bubbles: true }));
              return String(el.value || '').trim().length > 0;
            };

            // Fast path: explicit primary diagnosis text field (common on MHC).
            const explicit = Array.from(
              document.querySelectorAll(
                'input[name="diagnosisPriDesc"], input[id*="diagnosisPriDesc" i], input[name*="diagnosisPriDesc" i]'
              )
            ).filter(el => {
              const name = `${el.getAttribute('name') || ''} ${el.id || ''}`.toLowerCase();
              if (name.includes('sec') || name.includes('secondary')) return false;
              return true;
            });
            for (const el of explicit) {
              if (setField(el, val)) return true;
            }

            const score = el => {
              const tag = el.tagName?.toLowerCase();
              const name =
                `${el.getAttribute('name') || ''} ${el.id || ''} ${el.getAttribute('aria-label') || ''}`.toLowerCase();
              let s = 0;
              if (/diag|dx|icd/.test(name)) s += 50;
              if (tag === 'input') s += 10;
              if (tag === 'textarea') s -= 10;
              const w = el.getBoundingClientRect().width || 0;
              return s + w / 10;
            };
            const rows = Array.from(document.querySelectorAll('tr')).filter(r =>
              /Diagnosis\s*(Pri|Primary|Sec|Secondary)?/i.test(norm(r.textContent || ''))
            );
            if (!rows.length) return false;
            const priRows = rows.filter(r => /Diagnosis\s+Pri/i.test(norm(r.textContent || '')));
            const targetRows = priRows.length ? priRows : rows;
            for (const row of targetRows) {
              const rowText = norm(row.textContent || '');
              if (/Special\s+Remarks/i.test(rowText)) continue;
              if (!/Diagnosis/i.test(rowText)) continue;
              const cells = Array.from(row.querySelectorAll('th, td'));
              const labelCell = cells.find(c => /Diagnosis\s+Pri/i.test(norm(c.textContent)));
              const candidates = [];
              const addFrom = root => {
                if (!root) return;
                const inputs = Array.from(
                  root.querySelectorAll('input[type="text"], input:not([type]), textarea')
                );
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
              if (setField(target, val)) return true;
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
        'the',
        'and',
        'for',
        'of',
        'in',
        'on',
        'to',
        'at',
        'from',
        'due',
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
        'left',
        'right',
        'bilateral',
      ]);
      const descClean = String(desc || '')
        .replace(/^[A-Z]\d{2,3}(?:\.[0-9A-Z]{1,4})?\s*[-: ]\s*/i, '')
        .trim();
      const keywords = descClean
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter(w => w.length >= 3)
        .filter(w => !/\d/.test(w))
        .filter(w => !stop.has(w));
      // Practical default: many valid diagnosis rows only match one strong keyword
      // (e.g., "shoulder"), so 50 is too strict and leaves Diagnosis Pri as NA.
      const minScore = Number(process.env.MHC_DIAG_MIN_SCORE || '25');
      // Prefer a concrete body-part phrase over ICD code; this popup often indexes by description.
      const keyword = keywords.slice().sort((a, b) => b.length - a.length)[0] || '';
      const descNorm = String(descClean || desc || '')
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      const sideToken = descNorm.match(/\b(left|right|bilateral)\b/i)?.[1]?.toLowerCase() || '';
      const shoulderPhrase = /\bshoulder\b/i.test(descNorm)
        ? `${sideToken ? `${sideToken} ` : ''}shoulder`.trim()
        : '';
      const sideWordSet = new Set(['left', 'right', 'bilateral']);
      const weakBodyTokens = new Set(['acute', 'chronic', 'joint', 'region', 'unspecified']);
      const knownBodyParts = [
        'shoulder',
        'knee',
        'ankle',
        'wrist',
        'elbow',
        'hip',
        'back',
        'neck',
        'foot',
        'heel',
        'hand',
      ];
      const descWords = descNorm.split(' ').filter(Boolean);
      const bodyPartKeywordPool = keywords.filter(
        w => !weakBodyTokens.has(w) && !sideWordSet.has(w) && /^[a-z]+$/.test(w)
      );
      const bodyPartToken =
        knownBodyParts.find(k => descWords.includes(k) || descNorm.includes(k)) ||
        bodyPartKeywordPool.find(k => knownBodyParts.includes(k)) ||
        '';
      const sideBodyPhrase = sideToken && bodyPartToken ? `${sideToken} ${bodyPartToken}` : '';
      const descPhrase = String(descNorm || '')
        .split(' ')
        .filter(Boolean)
        .slice(0, 6)
        .join(' ');
      const codeRaw = String(code || '').trim();
      const codeNoDot = codeRaw.replace(/\./g, '');
      const rankedSearchTerms = [
        sideBodyPhrase,
        shoulderPhrase,
        bodyPartToken,
        keyword,
        descPhrase,
        descNorm,
        codeRaw,
        codeNoDot,
      ];
      const searchCandidates = Array.from(
        new Set(
          rankedSearchTerms
            .map(v => String(v || '').trim())
            .filter(v => v.length >= 2)
            .filter(v => !sideWordSet.has(String(v).toLowerCase()))
            .filter((v, idx, arr) => arr.indexOf(v) === idx)
            .filter((v, idx, arr) => !(idx > 0 && v.toLowerCase() === arr[idx - 1].toLowerCase()))
            .map(v => v.slice(0, 50))
        )
      );
      let searchText = (searchCandidates[0] || code || keyword || desc).slice(0, 50);
      this._logStep('Diagnosis search seed prepared', {
        code: code || null,
        keyword: keyword || null,
        searchText,
        searchCandidates: searchCandidates.slice(0, 5),
      });

      // Singlife/Aviva PCP (pcpcare.com) uses a server-postback for the "M" control and can
      // revert the Visit Date if the hidden backing field wasn't updated. Since we don't rely
      // on the modal for our "leave browser open; do not submit" workflow, skip it and just
      // write a readable diagnosis into the in-form free-text field.
      const urlNow = this.page.url();
      if (/pcpcare\.com\/pcpcare/i.test(urlNow)) {
        if (allowTextFallback) {
          const fallbackOk = await fillInFormTextFallback(
            'PcpCare portal: skipping diagnosis modal and using in-form text fallback'
          );
          if (!fallbackOk) {
            this.lastDiagnosisSelection = {
              ok: false,
              method: 'in_form_text_fallback',
              diagnosis: { code: code || null, description: desc || null },
              reason: 'pcpcare_fallback_failed',
              checkedAt: new Date().toISOString(),
            };
            return false;
          }
          return await finalizeDiagnosisResult({
            method: 'in_form_text_fallback',
            mode: 'pcpcare',
          });
        }
        this.lastDiagnosisSelection = {
          ok: false,
          method: 'modal',
          diagnosis: { code: code || null, description: desc || null },
          reason: 'pcpcare_modal_required',
          checkedAt: new Date().toISOString(),
        };
        return false;
      }

      const preUrl = this.page.url();

      // Find and click "M" button for Diagnosis Pri - it's an INPUT element, not button.
      // Important: many portals open a popup window for diagnosis search.
      const popupPromise = this.page.waitForEvent('popup', { timeout: 8000 }).catch(() => null);

      // Exact selector: #visit_form > table > tbody > tr:nth-child(2) > td > table > tbody > tr:nth-child(14) > td:nth-child(2) > input
      // Important: keep this click as a real Playwright user action. JS-only clicks can be treated as
      // non-user gestures and block popup creation in some portal states.
      const mButtonSelectors = [
        'input[name="SelectDiagnosisFromMaster"][onclick*="diagnosisPriId"]',
        'input[onclick*="doSelectMasterDiagnosis"][onclick*="diagnosisPriId"]',
        'tr:has-text("Diagnosis Pri") input[name="SelectDiagnosisFromMaster"]',
        '#visit_form > table > tbody > tr:nth-child(2) > td > table > tbody > tr:nth-child(14) > td:nth-child(2) > input',
        'tr:has-text("Diagnosis Pri") input[value*="M"]',
        'tr:has-text("Diagnosis Pri") input[type="button"][value*="M"]',
        'tr:has-text("Diagnosis Pri") input[type="submit"][value*="M"]',
        'input[name="SelectDiagnosisFromMaster"][value*="M"]',
        'input[value*="M"]:near(text="Diagnosis Pri", 200)',
      ];

      const clickMButtonByLocator = async (locator, meta = {}) => {
        if (!locator) return false;
        const count = await locator.count().catch(() => 0);
        if (!count) return false;
        const btn = locator.first();
        const isVisible = await btn.isVisible().catch(() => false);
        if (!isVisible) return false;
        await btn.scrollIntoViewIfNeeded().catch(() => {});
        await btn.click({ timeout: 2500 }).catch(async () => {
          await btn.click({ force: true, timeout: 2500 }).catch(() => {});
        });
        this._logStep('Clicked M button for diagnosis search', meta);
        return true;
      };

      let mButtonFound = false;

      // Selector-first path with explicit Diagnosis Pri control targeting.
      for (const selector of mButtonSelectors) {
        try {
          const mButton = this.page.locator(selector);
          mButtonFound = await clickMButtonByLocator(mButton, { strategy: 'selector', selector });
          if (mButtonFound) break;
        } catch {
          continue;
        }
      }

      // Scan fallback: inspect all "M"-like controls and choose one in Diagnosis Pri row.
      if (!mButtonFound) {
        try {
          const allButtons = this.page.locator(
            '#visit_form input[type="button"], #visit_form input[type="submit"], #visit_form button'
          );
          const total = await allButtons.count().catch(() => 0);
          for (let i = 0; i < Math.min(total, 220); i++) {
            const candidate = allButtons.nth(i);
            const matches = await candidate
              .evaluate(el => {
                const norm = s =>
                  String(s || '')
                    .replace(/\s+/g, ' ')
                    .trim()
                    .toLowerCase();
                const style = window.getComputedStyle(el);
                if (!style || style.display === 'none' || style.visibility === 'hidden')
                  return false;
                const rect = el.getBoundingClientRect();
                if (!rect || rect.width <= 0 || rect.height <= 0) return false;
                const value = norm(
                  el.getAttribute('value') || el.textContent || el.getAttribute('aria-label') || ''
                );
                const onclick = norm(el.getAttribute('onclick') || '');
                // Strong match: explicit primary diagnosis master selector.
                if (
                  onclick.includes('doselectmasterdiagnosis') &&
                  onclick.includes('diagnosispriid')
                )
                  return true;
                if (value !== 'm') return false;
                const rowText = norm(el.closest('tr')?.textContent || '');
                if (!/diagnosis\s*pri/.test(rowText)) return false;
                if (/diagnosis\s*sec/.test(rowText)) return false;
                return true;
              })
              .catch(() => false);
            if (!matches) continue;
            mButtonFound = await clickMButtonByLocator(candidate, {
              strategy: 'scan',
              index: i,
              total,
            });
            if (mButtonFound) break;
          }
        } catch {
          // ignore and continue
        }
      }

      if (!mButtonFound) {
        logger.warn('M button for diagnosis not found');
        this.lastDiagnosisSelection = {
          ok: false,
          method: 'modal',
          diagnosis: { code: code || null, description: desc || null },
          reason: 'diagnosis_m_button_not_found',
          checkedAt: new Date().toISOString(),
        };
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
          locator: sel => popup.locator(sel),
          waitForTimeout: ms => popup.waitForTimeout(ms),
          waitForLoadState: (s, o) => popup.waitForLoadState(s, o),
          close: async () => popup.close().catch(() => {}),
        };
      }

      // Non-popup flows: attempt to find a real modal dialog container (NOT inside #visit_form).
      if (!ctx) {
        const modalCandidates = this.page
          .locator('dialog, [role="dialog"], .ui-dialog, .modal, .popup, .ui-widget-overlay')
          .filter({
            has: this.page.locator('input[type="text"], input[type="search"], input:not([type])'),
          });
        const n = await modalCandidates.count().catch(() => 0);
        for (let i = 0; i < Math.min(10, n); i++) {
          const cand = modalCandidates.nth(i);
          const ok = await cand
            .evaluate(el => {
              const style = window.getComputedStyle(el);
              if (!style) return false;
              if (style.display === 'none' || style.visibility === 'hidden') return false;
              // Exclude anything embedded in the main visit form: that's where MC Day / Visit Date live.
              if (el.closest('#visit_form')) return false;
              const hasSearchInput = !!el.querySelector(
                'input[type="text"], input[type="search"], input:not([type])'
              );
              const hasSearchButton = !!el.querySelector(
                'button, input[type="submit"], input[type="button"], a'
              );
              return hasSearchInput && hasSearchButton;
            })
            .catch(() => false);
          if (!ok) continue;
          ctx = {
            kind: 'modal',
            locator: sel => cand.locator(sel),
            waitForTimeout: ms => this.page.waitForTimeout(ms),
            waitForLoadState: (s, o) => this.page.waitForLoadState(s, o),
          };
          this._logStep('Diagnosis modal detected (same tab)', { candidateIndex: i });
          break;
        }
      }

      // Frame-based flows: some portals open diagnosis search inside an iframe.
      if (!ctx) {
        const frames = this.page.frames().filter(f => f !== this.page.mainFrame());
        for (const frame of frames) {
          const fUrl = frame.url() || '';
          // Ignore about:blank frames; prefer frames that actually have content.
          if (!fUrl || fUrl === 'about:blank') continue;
          const hasInput =
            (await frame
              .locator('input[type="text"], input[type="search"], input:not([type])')
              .count()
              .catch(() => 0)) > 0;
          const hasBtn =
            (await frame
              .locator(
                'button:has-text("Search"), button:has-text("Find"), input[type="submit"], input[type="button"][value*="Search" i]'
              )
              .count()
              .catch(() => 0)) > 0;
          if (!hasInput || !hasBtn) continue;
          ctx = {
            kind: 'frame',
            locator: sel => frame.locator(sel),
            waitForTimeout: ms => this.page.waitForTimeout(ms),
            waitForLoadState: (s, o) => this.page.waitForLoadState(s, o),
          };
          this._logStep('Diagnosis iframe detected', { url: fUrl });
          break;
        }
      }

      // Page-navigation flows: if the main tab navigated away from the visit form and looks like a search page.
      if (!ctx && urlChanged) {
        const stillOnVisitForm = await this.page
          .locator('#visit_form')
          .count()
          .catch(() => 0);
        if (!stillOnVisitForm) {
          ctx = {
            kind: 'page',
            locator: sel => this.page.locator(sel),
            waitForTimeout: ms => this.page.waitForTimeout(ms),
            waitForLoadState: (s, o) => this.page.waitForLoadState(s, o),
          };
          this._logStep('Diagnosis search appears to be a full-page navigation', {
            from: preUrl,
            to: postUrl,
          });
        }
      }

      if (!ctx) {
        const urlNow = this.page.url();
        this._logStep('Diagnosis search UI not detected; leaving diagnosis blank', { url: urlNow });
        await this.page
          .screenshot({ path: 'screenshots/mhc-diagnosis-modal-not-detected.png', fullPage: true })
          .catch(() => {});
        if (this.isAiaClinicSystem || /aiaclinic\.com/i.test(urlNow)) {
          if (allowTextFallback) {
            const fallbackOk = await fillInFormTextFallback(
              'AIA Clinic diagnosis modal not detected; attempting explicit diagnosisPriDesc fallback'
            );
            if (fallbackOk) {
              return await finalizeDiagnosisResult({
                method: 'in_form_text_fallback',
                mode: 'aia_no_search_ui',
                attemptedSelectors: mButtonSelectors,
              });
            }
          }
          logger.warn(
            'AIA Clinic diagnosis modal not detected; strict mode requires modal selection'
          );
          this.lastDiagnosisSelection = {
            ok: false,
            method: 'modal',
            diagnosis: { code: code || null, description: desc || null },
            reason: 'diagnosis_search_ui_not_detected_aia',
            checkedAt: new Date().toISOString(),
          };
          return false;
        }
        if (allowTextFallback) {
          const fallbackOk = await fillInFormTextFallback(
            'Diagnosis search UI not detected; using in-form diagnosis fallback'
          );
          if (fallbackOk) {
            return await finalizeDiagnosisResult({
              method: 'in_form_text_fallback',
              mode: 'no_search_ui',
            });
          }
        }
        this.lastDiagnosisSelection = {
          ok: false,
          method: 'in_form_text_fallback',
          diagnosis: { code: code || null, description: desc || null },
          reason: 'diagnosis_search_ui_not_detected',
          checkedAt: new Date().toISOString(),
        };
        return false;
      }

      // Find search field in modal
      const searchSelectors = [
        // Prefer modal/popup-specific fields first so we never accidentally target underlying form inputs like MC Day or Visit Date.
        'input[name="keyValue"]:not([readonly]):not([disabled])',
        'input[name*="search" i]:not([readonly]):not([disabled])',
        'input[placeholder*="search" i]:not([readonly]):not([disabled])',
        'input[type="search"]:not([readonly]):not([disabled])',
        'input[type="text"]:not([readonly]):not([disabled])',
      ];

      let searchField = null;
      for (const selector of searchSelectors) {
        try {
          const field = ctx.locator(selector).first();
          if (
            (await field.count().catch(() => 0)) > 0 &&
            (await field.isVisible().catch(() => false))
          ) {
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
        this.lastDiagnosisSelection = {
          ok: false,
          method: 'modal',
          diagnosis: { code: code || null, description: desc || null },
          reason: 'diagnosis_search_field_not_found',
          checkedAt: new Date().toISOString(),
        };
        return false;
      }

      const enterSearchTerm = async term => {
        try {
          await searchField.fill(term, { timeout: 4000 });
          return true;
        } catch {
          try {
            await searchField.click({ timeout: 2000 });
            await searchField.press('Control+A').catch(() => {});
            await searchField.type(term, { timeout: 4000 });
            return true;
          } catch {
            return false;
          }
        }
      };

      // Click search/find button or press Enter
      const searchButtonSelectors = [
        'input[name="SearchAction"]',
        'input[value*="Search" i]',
        'button:has-text("Search")',
        'button:has-text("Find")',
        'button[type="submit"]',
        'input[type="submit"]',
        'input[type="button"][value*="Search" i]',
      ];

      const triggerDiagnosisSearch = async () => {
        for (const selector of searchButtonSelectors) {
          try {
            const button = ctx.locator(selector).first();
            if (
              (await button.count().catch(() => 0)) > 0 &&
              (await button.isVisible().catch(() => false))
            ) {
              await button.click();
              return true;
            }
          } catch {
            continue;
          }
        }
        await searchField.press('Enter').catch(() => {});
        return false;
      };

      const setDiagnosisSearchModeContains = async () => {
        const modeSelectors = [
          'select[name*="contains" i]',
          'select[name*="search" i]',
          'select[name*="match" i]',
          'select:has(option:text-matches("contains","i"))',
        ];
        for (const selector of modeSelectors) {
          try {
            const sel = ctx.locator(selector).first();
            if ((await sel.count().catch(() => 0)) === 0) continue;
            const options = await sel
              .locator('option')
              .evaluateAll(opts =>
                opts.map(o => ({
                  value: o.value,
                  label: (o.textContent || '').trim(),
                }))
              )
              .catch(() => []);
            const containsOpt = options.find(o =>
              /\bcontains\b/i.test(`${o.label || ''} ${o.value || ''}`)
            );
            if (!containsOpt) continue;
            const selected = await sel
              .selectOption({ value: containsOpt.value })
              .then(() => true)
              .catch(async () => {
                if (containsOpt.label) {
                  return sel
                    .selectOption({ label: containsOpt.label })
                    .then(() => true)
                    .catch(() => false);
                }
                return false;
              });
            if (selected) {
              this._logStep('Diagnosis search mode set', {
                selector,
                mode: containsOpt.label || containsOpt.value || 'contains',
              });
              return true;
            }
          } catch {
            continue;
          }
        }
        return false;
      };

      const hasSelectableDiagnosisRows = async () => {
        try {
          const rows = ctx.locator('table tr');
          const rowCount = Math.min(await rows.count().catch(() => 0), 40);
          const forbidden =
            /(click on the diagnosis|that contains|starts with|equals to|sort code|next|prev|page|\d+\s*-\s*\d+\s+of\s+\d+)/i;
          for (let i = 0; i < rowCount; i++) {
            const row = rows.nth(i);
            const text = String((await row.innerText().catch(() => '')) || '')
              .replace(/\s+/g, ' ')
              .trim();
            if (!text) continue;
            if (forbidden.test(text)) continue;
            if (!/\b[A-Z][0-9]{2,3}(?:\.[0-9A-Z]+)?\b/.test(text.toUpperCase())) continue;
            const link = row
              .locator('a, button, input[type="button"], input[type="submit"]')
              .first();
            const hasLink = (await link.count().catch(() => 0)) > 0;
            if (hasLink) return true;
          }
        } catch {
          return false;
        }
        return false;
      };

      const entered = await enterSearchTerm(searchText);
      if (!entered) {
        logger.warn('Could not fill diagnosis search field (modal)');
        this.lastDiagnosisSelection = {
          ok: false,
          method: 'modal',
          diagnosis: { code: code || null, description: desc || null },
          reason: 'diagnosis_search_input_fill_failed',
          checkedAt: new Date().toISOString(),
        };
        return false;
      }
      await setDiagnosisSearchModeContains();
      this._logStep('Entered diagnosis search text', { searchText });
      await triggerDiagnosisSearch();
      this._logStep('Triggered diagnosis search', { searchText });
      await ctx.waitForTimeout(1200);

      // Retry with alternative search terms before scoring/selecting a row.
      if (!(await hasSelectableDiagnosisRows())) {
        for (const candidate of searchCandidates.slice(1, 7)) {
          const term = String(candidate || '').trim();
          if (!term || term === searchText) continue;
          const ok = await enterSearchTerm(term);
          if (!ok) continue;
          await triggerDiagnosisSearch();
          await ctx.waitForTimeout(1000);
          const rowsReady = await hasSelectableDiagnosisRows();
          this._logStep('Retried diagnosis search term', {
            previousSearchText: searchText,
            searchText: term,
            rowsReady,
          });
          searchText = term;
          if (rowsReady) break;
        }
      }

      // Popup/same-page diagnosis lists often use doSelect(...) anchors rather than clean row structures.
      // Match selectable anchors directly before row-based scoring.
      const pickedAnchor = await (async () => {
        const normalizeCode = value =>
          String(value || '')
            .toUpperCase()
            .replace(/[^A-Z0-9.]/g, '');
        const extractCode = value => {
          const m = normalizeCode(value).match(/[A-Z]\d{2,3}(?:\.[0-9A-Z]+)?/);
          return m ? m[0] : '';
        };
        const requestedCode = extractCode(code || '');
        const requestedCodePlain = requestedCode.replace(/\./g, '');
        const kw = Array.isArray(keywords)
          ? keywords.filter(Boolean).map(k => String(k).toLowerCase())
          : [];

        const links = ctx.locator('a[onclick*="doSelect"], a[href="#"]');
        const count = Math.min(await links.count().catch(() => 0), 220);

        // Gather all viable rows BEFORE clicking, so a deterministic
        // canonical resolver can choose. The legacy keyword scorer remains
        // as a controlled fallback when the resolver finds no match (rare,
        // and gated by env to keep current behaviour available).
        const candidates = [];
        let legacyBestIdx = -1;
        let legacyBestScore = 0;
        let legacyBestText = '';

        for (let i = 0; i < count; i++) {
          const link = links.nth(i);
          const onclick = String((await link.getAttribute('onclick').catch(() => '')) || '');
          const href = String((await link.getAttribute('href').catch(() => '')) || '');
          const text = String((await link.innerText().catch(() => '')) || '')
            .replace(/\s+/g, ' ')
            .trim();
          if (!text) continue;
          if (!/doSelect/i.test(onclick) && href !== '#') continue;
          if (/^(next|prev|previous|sort|code|description)$/i.test(text)) continue;
          if (/click on the diagnosis/i.test(text)) continue;

          const rowText = await link
            .evaluate(el =>
              String(el.closest('tr')?.innerText || '')
                .replace(/\s+/g, ' ')
                .trim()
            )
            .catch(() => '');
          const combined = `${text} ${rowText}`.trim();
          const lower = combined.toLowerCase();
          const optionCode = extractCode(combined);
          const optionCodePlain = optionCode.replace(/\./g, '');

          // Build the option text we hand to the canonical resolver. Strip
          // the leading ICD code so the resolver scores body-part / condition
          // / side against just the description (which is what it expects).
          const descriptionOnly = combined
            .replace(/\b[A-Z]\d{2,3}(?:\.[0-9A-Z]+)?\b\s*[-:]?\s*/, '')
            .replace(/\s+/g, ' ')
            .trim();
          candidates.push({
            idx: i,
            text: text.slice(0, 120),
            rowText: rowText.slice(0, 220),
            optionCode,
            descriptionOnly: descriptionOnly || combined,
          });

          // Legacy keyword/code scorer kept only as a fallback signal; do
          // NOT click anything here.
          let score = 0;
          let codeHits = 0;
          let keywordHits = 0;
          if (requestedCodePlain && optionCodePlain) {
            if (optionCodePlain === requestedCodePlain) {
              score += 1000;
              codeHits += 1;
            } else if (optionCodePlain.startsWith(requestedCodePlain)) {
              score += 900;
              codeHits += 1;
            } else if (requestedCodePlain.startsWith(optionCodePlain)) {
              score += 700;
              codeHits += 1;
            } else if (
              requestedCodePlain.slice(0, 3) &&
              optionCodePlain.startsWith(requestedCodePlain.slice(0, 3))
            ) {
              score += 200;
              codeHits += 1;
            }
          }
          for (const k of kw) {
            if (!k) continue;
            if (lower.includes(k)) {
              score += 40;
              keywordHits += 1;
            }
          }
          if (codeHits === 0 && keywordHits < 2) continue;
          if (score < minScore) continue;
          if (score > legacyBestScore) {
            legacyBestScore = score;
            legacyBestIdx = i;
            legacyBestText = text.slice(0, 120);
          }
        }

        // Deterministic canonical resolver (mirrors GE/NTUC and clinic-assist).
        // Refuses ambiguous matches like "Pain in left wrist" → "Injury of
        // wrist and hand" because the resolver penalises condition_mismatch
        // (-140) and body_part_mismatch (-180), then enforces a min score.
        const canonicalMinScore = Number(process.env.MHC_DIAG_CANONICAL_MIN_SCORE || '150');
        const canonicalFallback = String(process.env.MHC_DIAG_CANONICAL_FALLBACK || 'refuse')
          .trim()
          .toLowerCase();

        let canonicalDecision = null;
        if (candidates.length > 0) {
          canonicalDecision = resolveDiagnosisAgainstPortalOptions({
            diagnosis: {
              code: code || null,
              description: descClean || desc || null,
            },
            portalOptions: candidates.map(c => ({
              text: c.descriptionOnly,
              code: c.optionCode || null,
            })),
            minScore: canonicalMinScore,
            codeMode: code ? 'primary' : 'secondary',
          });
        }

        let chosenIdx = -1;
        let chosenSource = '';
        let chosenScore = 0;
        if (canonicalDecision && canonicalDecision.blocked === false) {
          const wantText = String(canonicalDecision.selected_text || '')
            .trim()
            .toLowerCase();
          const wantCode = String(canonicalDecision.selected_code || '')
            .toUpperCase()
            .replace(/[^A-Z0-9.]/g, '');
          const found = candidates.find(c => {
            const cText = String(c.descriptionOnly || '')
              .trim()
              .toLowerCase();
            const cCode = String(c.optionCode || '')
              .toUpperCase()
              .replace(/[^A-Z0-9.]/g, '');
            if (wantText && cText && wantText === cText) {
              if (!wantCode || !cCode) return true;
              return wantCode === cCode;
            }
            return false;
          });
          if (found) {
            chosenIdx = found.idx;
            chosenSource = 'canonical_resolver';
            chosenScore = canonicalDecision.match_score || 0;
          }
        }

        if (chosenIdx < 0) {
          const blockedReason =
            (canonicalDecision && canonicalDecision.blocked_reason) || 'no_candidates';
          if (canonicalFallback === 'keyword' && legacyBestIdx >= 0) {
            chosenIdx = legacyBestIdx;
            chosenSource = 'legacy_keyword_fallback';
            chosenScore = legacyBestScore;
            this._logStep('Diagnosis canonical resolver blocked; falling back to keyword scorer', {
              blockedReason,
              canonicalScore: canonicalDecision?.match_score || 0,
              canonicalConsidered: (canonicalDecision?.considered || []).slice(0, 5),
              legacyBestText,
            });
          } else {
            this._logStep('Diagnosis canonical resolver refused selection', {
              blockedReason,
              canonicalScore: canonicalDecision?.match_score || 0,
              canonicalConsidered: (canonicalDecision?.considered || []).slice(0, 5),
              candidatesCount: candidates.length,
              legacyBestText: legacyBestText || null,
              legacyBestScore: legacyBestScore || 0,
              minScoreRequired: canonicalMinScore,
            });
            return {
              ok: false,
              reason: `canonical_${blockedReason}`,
              canonicalDecision,
              candidatesCount: candidates.length,
            };
          }
        }

        const chosenCandidate = candidates.find(c => c.idx === chosenIdx);
        if (!chosenCandidate) return { ok: false, reason: 'chosen_candidate_lost' };
        const target = links.nth(chosenIdx);
        await target.click().catch(() => {});
        return {
          ok: true,
          score: chosenScore,
          text: chosenCandidate.text,
          row: chosenCandidate.rowText,
          optionCode: chosenCandidate.optionCode,
          source: chosenSource,
          canonicalReason: canonicalDecision?.match_reason || null,
        };
      })();

      if (pickedAnchor?.ok) {
        this._logStep('Selected diagnosis result (anchor match)', pickedAnchor);
        await ctx.waitForTimeout(500).catch(() => {});
        if (ctx.close) await ctx.close().catch(() => {});
        return await finalizeDiagnosisResult({
          method: 'modal',
          mode: 'anchor_match',
          selection: pickedAnchor,
          attemptedSelectors: mButtonSelectors,
          searchText,
        });
      }

      // Hard stop: if the anchor scan found candidates but the canonical
      // resolver explicitly refused them, do NOT fall through to the legacy
      // pickedEval / pickedLocator / pickedFallback scorers. Those use the
      // same naive keyword+code scoring that produced the DYLAN AUSTIN TARIN
      // failure ("Pain in left wrist" → "Injury of wrist and hand") and
      // would silently bypass the canonical gate we just added.
      if (
        pickedAnchor &&
        pickedAnchor.ok === false &&
        typeof pickedAnchor.reason === 'string' &&
        pickedAnchor.reason.startsWith('canonical_') &&
        Number(pickedAnchor.candidatesCount || 0) > 0
      ) {
        this.lastDiagnosisSelection = {
          ok: false,
          method: 'modal',
          diagnosis: { code: code || null, description: desc || null },
          reason: pickedAnchor.reason,
          canonicalDecision: pickedAnchor.canonicalDecision || null,
          candidatesCount: pickedAnchor.candidatesCount || 0,
          checkedAt: new Date().toISOString(),
        };
        if (ctx.close) await ctx.close().catch(() => {});
        return false;
      }

      // Prefer a best-match row rather than blindly taking the first result.
      // Only do document-level evaluation when the diagnosis search is a dedicated page (popup or full-page nav).
      const canEval = ctx.kind === 'popup' || ctx.kind === 'page';
      const pickedEval = !canEval
        ? { ok: false }
        : await (ctx.kind === 'popup' ? popup : this.page)
            .evaluate(
              ({ code, keywords, minScore }) => {
                const esc = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                const isVisible = el => {
                  if (!el) return false;
                  const style = window.getComputedStyle(el);
                  if (!style) return false;
                  if (style.display === 'none' || style.visibility === 'hidden') return false;
                  return true;
                };
                const buildCodeVariants = c => {
                  const s = String(c || '')
                    .replace(/\s+/g, '')
                    .toUpperCase();
                  if (!s) return [];
                  const noDot = s.replace(/\./g, '');
                  const noTrailingZeros = noDot.replace(/0+$/g, '');
                  const m = s.match(/^([A-Z]\d{2,3})\.?(\d+)?$/);
                  const base = m?.[1] || null;
                  const suffix = m?.[2] || null;
                  const short1 = base && suffix ? `${base}${suffix.slice(0, 1)}` : null;
                  const short2 = base && suffix ? `${base}${suffix.slice(0, 2)}` : null;
                  return Array.from(
                    new Set(
                      [s, noDot, noTrailingZeros, base, short2, short1].filter(
                        x => x && x.length >= 3
                      )
                    )
                  );
                };
                const codeVariants = code ? buildCodeVariants(code) : [];
                const codeRegexes = codeVariants.map(v => new RegExp(`\\b${esc(v)}\\b`, 'i'));
                const forbidden =
                  /(click on the diagnosis|that contains|starts with|equals to|sort code|next|prev|page|\d+\s*-\s*\d+\s+of\s+\d+)/i;
                const hasIcdLikeCode = txt =>
                  /\b[A-Z][0-9]{2,3}(?:\.[0-9A-Z]+)?\b/.test(String(txt || '').toUpperCase());
                const isHeaderLike = txt =>
                  /^\s*(code|description|diagnosis|icd)\b/i.test(String(txt || '').trim());

                const tables = Array.from(document.querySelectorAll('table')).filter(t =>
                  isVisible(t)
                );
                let best = null;
                let bestScore = 0;

                const scoreText = txt => {
                  const t = String(txt || '').toLowerCase();
                  if (!t) return null;
                  if (forbidden.test(t) || isHeaderLike(t) || !hasIcdLikeCode(t)) return null;
                  let codeHits = 0;
                  for (const r of codeRegexes) if (r.test(txt)) codeHits += 1;
                  let keywordHits = 0;
                  for (const k of keywords || []) if (k && t.includes(k)) keywordHits += 1;
                  if (codeHits === 0 && keywordHits < 2) return null;
                  return {
                    score: codeHits * 1000 + keywordHits * 40,
                    codeHits,
                    keywordHits,
                  };
                };

                for (const table of tables) {
                  const rows = Array.from(table.querySelectorAll('tr'));
                  for (const row of rows) {
                    const link = row.querySelector(
                      'a, button, input[type="button"], input[type="submit"]'
                    );
                    if (!link || !isVisible(link)) continue;
                    const txt = row.innerText || row.textContent || '';
                    const scored = scoreText(txt);
                    if (!scored || scored.score < minScore) continue;
                    if (scored.score > bestScore) {
                      bestScore = scored.score;
                      best = {
                        row,
                        link,
                        txt: String(txt).trim().slice(0, 120),
                        codeHits: scored.codeHits,
                        keywordHits: scored.keywordHits,
                      };
                    }
                  }
                }

                if (best && best.link && bestScore >= minScore) {
                  (best.link instanceof HTMLElement ? best.link : best.row).click();
                  return {
                    ok: true,
                    score: bestScore,
                    text: best.txt,
                    codeHits: best.codeHits,
                    keywordHits: best.keywordHits,
                  };
                }
                return { ok: false };
              },
              { code, keywords, minScore }
            )
            .catch(() => ({ ok: false }));

      if (pickedEval?.ok) {
        this._logStep('Selected diagnosis result (best match)', pickedEval);
        await this.page.waitForTimeout(500).catch(() => {});
        if (ctx.close) await ctx.close().catch(() => {});
        return await finalizeDiagnosisResult({
          method: 'modal',
          mode: 'best_match_eval',
          selection: pickedEval,
          attemptedSelectors: mButtonSelectors,
        });
      }

      // Locator-based best-match for modal/iframe (and as a fallback for popup/page).
      const pickedLocator = await (async () => {
        const esc = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const buildCodeVariants = c => {
          const s = String(c || '')
            .replace(/\s+/g, '')
            .toUpperCase();
          if (!s) return [];
          const noDot = s.replace(/\./g, '');
          const noTrailingZeros = noDot.replace(/0+$/g, '');
          const m = s.match(/^([A-Z]\d{2,3})\.?(\d+)?$/);
          const base = m?.[1] || null;
          const suffix = m?.[2] || null;
          const short1 = base && suffix ? `${base}${suffix.slice(0, 1)}` : null;
          const short2 = base && suffix ? `${base}${suffix.slice(0, 2)}` : null;
          return Array.from(
            new Set(
              [s, noDot, noTrailingZeros, base, short2, short1].filter(x => x && x.length >= 3)
            )
          );
        };
        const codeVariants = code ? buildCodeVariants(code) : [];
        const codeRegexes = codeVariants.map(v => new RegExp(`\\b${esc(v)}\\b`, 'i'));
        const kw = Array.isArray(keywords) ? keywords.filter(Boolean) : [];

        // If no signal at all, avoid selecting a random row.
        if (!codeRegexes.length && !kw.length) return { ok: false };

        const forbidden =
          /(click on the diagnosis|that contains|starts with|equals to|sort code|next|prev|page|\d+\s*-\s*\d+\s+of\s+\d+)/i;
        const rows = ctx.locator('table tr');
        const rowCount = Math.min(await rows.count().catch(() => 0), 80);
        let bestIdx = -1;
        let bestScore = 0;
        let bestText = '';
        let bestSignals = null;

        const scoreText = txt => {
          const t = String(txt || '').toLowerCase();
          if (!t) return null;
          if (forbidden.test(t)) return null;
          if (/^\s*(code|description|diagnosis|icd)\b/i.test(t)) return null;
          if (!/\b[A-Z][0-9]{2,3}(?:\.[0-9A-Z]+)?\b/.test(String(txt || '').toUpperCase()))
            return null;
          let codeHits = 0;
          for (const r of codeRegexes) if (r.test(txt)) codeHits += 1;
          let keywordHits = 0;
          for (const k of kw) if (k && t.includes(k)) keywordHits += 1;
          if (codeHits === 0 && keywordHits < 2) return null;
          return {
            score: codeHits * 1000 + keywordHits * 40,
            codeHits,
            keywordHits,
          };
        };

        for (let i = 0; i < rowCount; i++) {
          const row = rows.nth(i);
          const txt = await row.innerText().catch(() => '');
          const scored = scoreText(txt);
          if (!scored || scored.score < minScore) continue;
          if (scored.score > bestScore) {
            bestScore = scored.score;
            bestIdx = i;
            bestText = String(txt || '')
              .trim()
              .slice(0, 120);
            bestSignals = {
              codeHits: scored.codeHits,
              keywordHits: scored.keywordHits,
            };
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
          return {
            ok: true,
            score: bestScore,
            text: bestText,
            codeHits: bestSignals?.codeHits || 0,
            keywordHits: bestSignals?.keywordHits || 0,
          };
        }
        return { ok: false };
      })();

      if (pickedLocator?.ok) {
        this._logStep('Selected diagnosis result (best match via locator)', pickedLocator);
        await ctx.waitForTimeout(500).catch(() => {});
        if (ctx.close) await ctx.close().catch(() => {});
        return await finalizeDiagnosisResult({
          method: 'modal',
          mode: 'best_match_locator',
          selection: pickedLocator,
          attemptedSelectors: mButtonSelectors,
        });
      }

      // Strict fallback: select only when the row itself looks like a diagnosis and score is meaningful.
      const pickedFallback = await (async () => {
        const codeTokens = [code, code?.replace(/\./g, '')]
          .map(x =>
            String(x || '')
              .toLowerCase()
              .trim()
          )
          .filter(Boolean);
        const kw = Array.isArray(keywords)
          ? keywords.filter(Boolean).map(k => String(k).toLowerCase())
          : [];
        const rows = ctx.locator('table tr');
        const rowCount = Math.min(await rows.count().catch(() => 0), 120);
        let bestIdx = -1;
        let bestScore = 0;
        let bestText = '';
        const forbidden =
          /(click on the diagnosis|that contains|starts with|equals to|sort code|next|prev|page|\d+\s*-\s*\d+\s+of\s+\d+)/i;
        for (let i = 0; i < rowCount; i++) {
          const row = rows.nth(i);
          const link = row.locator('a, button, input[type="button"], input[type="submit"]').first();
          const hasLink = (await link.count().catch(() => 0)) > 0;
          const rowCanClick = hasLink || (await row.getAttribute('onclick').catch(() => null));
          if (!rowCanClick) continue;
          const txt = String((await row.innerText().catch(() => '')) || '')
            .replace(/\s+/g, ' ')
            .trim();
          if (!txt) continue;
          if (forbidden.test(txt)) continue;
          const lower = txt.toLowerCase();
          const upper = txt.toUpperCase();
          if (/^\s*(code|description|diagnosis|icd)\b/.test(lower)) continue;
          const hasIcdCode = /\b[A-Z][0-9]{2,3}(?:\.[0-9A-Z]+)?\b/.test(upper);
          if (!hasIcdCode) continue;
          let score = 0;
          let codeHits = 0;
          for (const t of codeTokens) {
            if (!t) continue;
            if (lower.includes(t)) {
              score += 200;
              codeHits += 1;
            }
          }
          let keywordHits = 0;
          for (const k of kw) {
            if (!k) continue;
            if (lower.includes(k)) {
              score += 40;
              keywordHits += 1;
            }
          }
          if (codeHits === 0 && keywordHits < 2) continue;
          if (score < minScore) continue;
          if (score > bestScore) {
            bestScore = score;
            bestIdx = i;
            bestText = txt.slice(0, 140);
          }
        }

        if (bestIdx < 0) return { ok: false };
        const row = rows.nth(bestIdx);
        const link = row.locator('a, button, input[type="button"], input[type="submit"]').first();
        await link.click().catch(() => row.click({ force: true }));
        return {
          ok: true,
          mode: 'best_available_strict',
          score: bestScore,
          text: bestText,
        };
      })();
      if (pickedFallback?.ok) {
        this._logStep('Selected diagnosis result (fallback)', pickedFallback);
        await ctx.waitForTimeout(500).catch(() => {});
        if (ctx.close) await ctx.close().catch(() => {});
        return await finalizeDiagnosisResult({
          method: 'modal',
          mode: 'strict_fallback',
          selection: pickedFallback,
          attemptedSelectors: mButtonSelectors,
        });
      }

      const noMatchSample = await (async () => {
        try {
          const rows = ctx.locator('table tr');
          const rowCount = Math.min(await rows.count().catch(() => 0), 40);
          const sample = [];
          for (let i = 0; i < rowCount; i++) {
            const row = rows.nth(i);
            const text = String((await row.innerText().catch(() => '')) || '')
              .replace(/\s+/g, ' ')
              .trim();
            if (!text) continue;
            const link = row
              .locator('a, button, input[type="button"], input[type="submit"]')
              .first();
            const hasLink = (await link.count().catch(() => 0)) > 0;
            const hasIcdLikeCode = /\b[A-Z][0-9]{2,3}(?:\.[0-9A-Z]+)?\b/.test(text.toUpperCase());
            sample.push({
              idx: i,
              hasLink,
              hasIcdLikeCode,
              text: text.slice(0, 180),
            });
          }
          return sample;
        } catch {
          return [];
        }
      })();

      if (noMatchSample.length) {
        this._logStep('Diagnosis search sample (no confident match)', {
          searchText,
          sample: noMatchSample.slice(0, 25),
        });
      }

      this._logStep('Diagnosis search had no confident match');
      logger.warn('Could not select diagnosis result');
      const genericSafePick = disableGenericRowPick
        ? { ok: false, skipped: 'disabled_for_missing_in_source' }
        : await (async () => {
            const forbidden =
              /(click on the diagnosis|that contains|starts with|equals to|sort code|next|prev|page|\d+\s*-\s*\d+\s+of\s+\d+)/i;
            try {
              const rows = ctx.locator('table tr');
              const rowCount = Math.min(await rows.count().catch(() => 0), 80);
              for (let i = 0; i < rowCount; i++) {
                const row = rows.nth(i);
                const text = String((await row.innerText().catch(() => '')) || '')
                  .replace(/\s+/g, ' ')
                  .trim();
                if (!text) continue;
                if (forbidden.test(text)) continue;
                if (/^\s*(code|description|diagnosis|icd)\b/i.test(text)) continue;
                if (!/\b[A-Z][0-9]{2,3}(?:\.[0-9A-Z]+)?\b/.test(text.toUpperCase())) continue;
                const action = row
                  .locator('a, button, input[type="button"], input[type="submit"]')
                  .first();
                const hasAction = (await action.count().catch(() => 0)) > 0;
                if (!hasAction) continue;
                await action.click().catch(async () => {
                  await row.click({ force: true }).catch(() => {});
                });
                return { ok: true, idx: i, text: text.slice(0, 180) };
              }
            } catch {
              // ignore
            }
            return { ok: false };
          })();
      if (genericSafePick?.ok) {
        this._logStep('Selected diagnosis result (generic safe fallback)', genericSafePick);
        await ctx.waitForTimeout(500).catch(() => {});
        if (ctx.close) await ctx.close().catch(() => {});
        const genericOk = await finalizeDiagnosisResult({
          method: 'modal',
          mode: 'generic_safe_fallback',
          selection: genericSafePick,
          attemptedSelectors: mButtonSelectors,
        });
        if (genericOk) return true;
      }
      if (ctx.close) await ctx.close().catch(() => {});
      if (!allowTextFallback) {
        this.lastDiagnosisSelection = {
          ok: false,
          method: 'modal',
          diagnosis: { code: code || null, description: desc || null },
          reason: 'diagnosis_mapping_failed',
          attemptedSelectors: mButtonSelectors,
          checkedAt: new Date().toISOString(),
        };
        return false;
      }
      const fallbackOk = await fillInFormTextFallback(
        'Diagnosis search had no confident match; using in-form diagnosis fallback'
      );
      if (!fallbackOk) {
        this.lastDiagnosisSelection = {
          ok: false,
          method: 'modal',
          diagnosis: { code: code || null, description: desc || null },
          reason: 'diagnosis_mapping_failed',
          attemptedSelectors: mButtonSelectors,
          checkedAt: new Date().toISOString(),
        };
        return false;
      }
      return await finalizeDiagnosisResult({
        method: 'in_form_text_fallback',
        mode: 'no_confident_match',
        attemptedSelectors: mButtonSelectors,
        searchText,
        searchSample: noMatchSample.slice(0, 25),
      });
    } catch (error) {
      logger.error('Failed to fill primary diagnosis:', error);
      this.lastDiagnosisSelection = {
        ok: false,
        method: 'modal',
        diagnosis: {
          code:
            diagnosisText && typeof diagnosisText === 'object' ? diagnosisText.code || null : null,
          description:
            diagnosisText && typeof diagnosisText === 'object'
              ? diagnosisText.description || null
              : String(diagnosisText || '').trim() || null,
        },
        reason: `error:${error?.message || 'unknown'}`,
        checkedAt: new Date().toISOString(),
      };
      return false;
    }
  }

  /**
   * Try selecting a drug from the portal master popup via the row "M" button.
   * This is required to populate hidden drug code/price fields used in claim totals.
   */
  async selectDrugFromMaster(drugName, rowIndex = 1) {
    try {
      const rawName = String(drugName || '').trim();
      if (!rawName) return false;

      const cleaned = rawName
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (!cleaned) return false;

      const stop = new Set(['mg', 'ml', 'tab', 'tabs', 'cap', 'caps', 'tablet', 'capsule']);
      const tokens = cleaned
        .split(/\s+/)
        .map(w => w.trim())
        .filter(w => w.length >= 3 && !stop.has(w));
      const primary = tokens[0] || cleaned.split(/\s+/)[0] || cleaned;
      const searchTerms = Array.from(
        new Set(
          [primary, tokens.slice(0, 2).join(' ').trim(), cleaned]
            .map(s => String(s || '').trim())
            .filter(Boolean)
        )
      );

      const popupPromise = this.page.waitForEvent('popup', { timeout: 6000 }).catch(() => null);
      let clicked = false;

      // Fast path: MHC drug rows expose a dedicated SelectMasterDrug button.
      const masterButtons = this.page.locator(
        'input[name="SelectMasterDrug"], input[name*="SelectMasterDrug" i]'
      );
      const masterButtonCount = await masterButtons.count().catch(() => 0);
      if (masterButtonCount > 0) {
        const idx = Math.min(Math.max(0, rowIndex - 1), masterButtonCount - 1);
        const btn = masterButtons.nth(idx);
        if (await btn.isVisible().catch(() => false)) {
          await btn.click().catch(() => {});
          clicked = true;
        }
      }

      if (!clicked) {
        clicked = await this.page
          .evaluate(targetRowIndex => {
            const norm = s =>
              String(s || '')
                .replace(/\s+/g, ' ')
                .trim()
                .toLowerCase();
            const isVisible = el => {
              if (!el) return false;
              const style = window.getComputedStyle(el);
              if (!style) return false;
              if (style.display === 'none' || style.visibility === 'hidden') return false;
              const rect = el.getBoundingClientRect();
              return !!rect && rect.width > 0 && rect.height > 0;
            };

            const tables = Array.from(document.querySelectorAll('table')).filter(t =>
              /drug\s*name/i.test(norm(t.innerText || ''))
            );
            const table = tables[0] || null;
            if (!table) return false;

            const rows = Array.from(table.querySelectorAll('tr')).filter(
              r => r.closest('table') === table
            );
            const headerIdx = rows.findIndex(r => /drug\s*name/i.test(norm(r.innerText || '')));
            if (headerIdx < 0) return false;

            const dataRows = [];
            for (let i = headerIdx + 1; i < rows.length; i++) {
              const rowText = norm(rows[i].innerText || '');
              if (/total\s+drug\s+fee/.test(rowText)) break;
              if (rows[i].querySelector('input[type="text"], input:not([type]), textarea'))
                dataRows.push(rows[i]);
            }
            const target = dataRows[Math.max(0, Number(targetRowIndex || 1) - 1)];
            if (!target) return false;

            const pickMasterButton = root => {
              const controls = Array.from(
                root.querySelectorAll('input[type="button"], input[type="submit"], button')
              );
              return (
                controls.find(el => {
                  const name = String(el.getAttribute('name') || '').toLowerCase();
                  if (/selectmasterdrug/.test(name)) return true;
                  const value = String(el.getAttribute('value') || el.textContent || '')
                    .replace(/\s+/g, '')
                    .toUpperCase();
                  return value === 'M';
                }) || null
              );
            };

            let btn = pickMasterButton(target);
            if (!btn) {
              const global = Array.from(
                document.querySelectorAll('input[name*="SelectMasterDrug" i]')
              );
              const idx = Math.max(0, Number(targetRowIndex || 1) - 1);
              btn = global[idx] || global[0] || null;
            }
            if (!btn || !isVisible(btn)) return false;
            btn.click();
            return true;
          }, rowIndex)
          .catch(() => false);
      }

      if (!clicked) return false;

      const popup = await popupPromise;
      /** @type {{locator:(sel:string)=>import('@playwright/test').Locator, waitForTimeout:(ms:number)=>Promise<void>, close?:()=>Promise<void>}} */
      let ctx = null;
      if (popup) {
        await popup.waitForLoadState('domcontentloaded', { timeout: 6000 }).catch(() => {});
        await popup.waitForTimeout(250).catch(() => {});
        ctx = {
          locator: sel => popup.locator(sel),
          waitForTimeout: ms => popup.waitForTimeout(ms),
          close: async () => popup.close().catch(() => {}),
        };
      } else {
        await this.page.waitForLoadState('domcontentloaded', { timeout: 4000 }).catch(() => {});
        await this.page.waitForTimeout(250);
        ctx = {
          locator: sel => this.page.locator(sel),
          waitForTimeout: ms => this.page.waitForTimeout(ms),
        };
      }

      const searchInput = ctx
        .locator('input[name="keyValue"], input[name*="search" i], input[type="text"]')
        .first();
      if ((await searchInput.count().catch(() => 0)) === 0) {
        if (ctx.close) await ctx.close().catch(() => {});
        return false;
      }

      const clickSearch = async () => {
        const btn = ctx
          .locator(
            'input[name="SearchAction"], input[value*="Search" i], button:has-text("Search"), input[type="submit"]'
          )
          .first();
        if ((await btn.count().catch(() => 0)) > 0 && (await btn.isVisible().catch(() => false))) {
          await btn.click().catch(() => {});
          return;
        }
        await searchInput.press('Enter').catch(() => {});
      };

      const pickResult = async term => {
        const termLower = String(term || '').toLowerCase();
        const kws = termLower.split(/\s+/).filter(w => w.length >= 3);
        const links = ctx.locator('a[onclick*="doSelect"], a[href="#"]');
        const count = Math.min(await links.count().catch(() => 0), 250);
        let bestIdx = -1;
        let bestScore = 0;
        for (let i = 0; i < count; i++) {
          const link = links.nth(i);
          const text = String((await link.innerText().catch(() => '')) || '')
            .replace(/\s+/g, ' ')
            .trim();
          if (!text) continue;
          if (/^(next|prev|previous|sort|code|description)$/i.test(text)) continue;
          if (/click on the drug|click on the medicine|click on the diagnosis/i.test(text))
            continue;
          const rowText = await link
            .evaluate(el =>
              String(el.closest('tr')?.innerText || '')
                .replace(/\s+/g, ' ')
                .trim()
            )
            .catch(() => '');
          const combined = `${text} ${rowText}`.toLowerCase();
          let score = 0;
          for (const kw of kws) if (combined.includes(kw)) score += 40;
          if (combined.includes(primary)) score += 120;
          if (score > bestScore) {
            bestScore = score;
            bestIdx = i;
          }
        }
        if (bestIdx < 0 || bestScore <= 0) return false;
        await links
          .nth(bestIdx)
          .click()
          .catch(() => {});
        return true;
      };

      for (const term of searchTerms) {
        await searchInput.fill(term, { timeout: 4000 }).catch(async () => {
          await searchInput.click({ timeout: 2000 }).catch(() => {});
          await searchInput.type(term, { timeout: 4000 }).catch(() => {});
        });
        await clickSearch();
        await ctx.waitForTimeout(900).catch(() => {});
        const picked = await pickResult(term);
        if (picked) {
          await ctx.waitForTimeout(300).catch(() => {});
          if (ctx.close) await ctx.close().catch(() => {});
          this._logStep('Drug selected from master popup', {
            rowIndex,
            term,
            drug: rawName.slice(0, 80),
          });
          return true;
        }
      }

      if (ctx.close) await ctx.close().catch(() => {});
      return false;
    } catch (error) {
      logger.warn('Drug master selection failed', { error: error?.message || String(error) });
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
      this._logStep('Fill drug item', {
        drug: drugData.name?.substring(0, 30),
        quantity: drugData.quantity,
        rowIndex,
      });

      if (!drugData.name || drugData.name.length < 2) {
        logger.warn('Drug name too short, skipping');
        return false;
      }

      const useMasterFirst = process.env.MHC_DRUG_MASTER_FIRST !== '0';
      if (useMasterFirst) {
        const selectedFromMaster = await this.selectDrugFromMaster(drugData.name, rowIndex).catch(
          () => false
        );
        if (selectedFromMaster) {
          this.lastDrugSelectionByRow[rowIndex] = {
            fromMaster: true,
            name: String(drugData.name || '').trim(),
            checkedAt: new Date().toISOString(),
          };
          return true;
        }
      }

      // Prefer direct fill into the visible "Drug Name" cell for the requested row.
      // This is more reliable than modal selection for our "leave browser open" workflow.
      const directFilled = await this.page
        .evaluate(
          ({ rowIndex, name, quantity }) => {
            const norm = s => (s || '').replace(/\s+/g, ' ').trim();
            const isVisible = el => {
              if (!el) return false;
              const style = window.getComputedStyle(el);
              if (!style) return false;
              if (style.display === 'none' || style.visibility === 'hidden') return false;
              return true;
            };
            const sameNumeric = (a, b) => {
              const n1 = Number(String(a || '').trim());
              const n2 = Number(String(b || '').trim());
              if (!Number.isFinite(n1) || !Number.isFinite(n2)) return false;
              return Math.abs(n1 - n2) < 1e-9;
            };

            // Prefer the explicit drug table id when present (common on MHC/Singlife).
            let scopedTable = document.querySelector('#drugTable');
            let headerRow = null;
            let headerCell = null;

            if (scopedTable) {
              const rows = Array.from(scopedTable.querySelectorAll('tr'));
              headerRow = rows.find(r => /drug\s*name/i.test(norm(r.innerText))) || null;
              if (headerRow) {
                headerCell =
                  Array.from(headerRow.querySelectorAll('th, td')).find(c =>
                    /drug\s*name/i.test(norm(c.innerText))
                  ) || null;
              }
            }

            // Fallback: find a header cell anywhere and anchor to its closest table.
            if (!scopedTable || !headerRow || !headerCell) {
              headerCell =
                Array.from(document.querySelectorAll('th, td')).find(c =>
                  /drug\s*name/i.test(norm(c.innerText))
                ) || null;
              if (!headerCell) return false;
              scopedTable = headerCell.closest('table');
              headerRow = headerCell.closest('tr');
              if (!scopedTable || !headerRow) return false;
            }

            const rows = Array.from(scopedTable.querySelectorAll('tr')).filter(
              r => r.closest('table') === scopedTable
            );
            const headerIdx = rows.indexOf(headerRow);
            if (headerIdx < 0) return false;

            // Compute the column-range covered by the "Procedure Name" header, accounting for colspans.
            const rowCellsWithSpan = row =>
              Array.from(row.querySelectorAll('th, td')).map(c => ({
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
              if (
                rows[i].querySelector(
                  'input[type="text"], input[type="number"], input[type="tel"], input:not([type]), textarea'
                )
              )
                dataRows.push(rows[i]);
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
              const inputs = Array.from(
                c.querySelectorAll('input[type="text"], input:not([type]), textarea')
              ).filter(x => isVisible(x));
              if (!inputs.length) continue;
              inputs.sort(
                (a, b) => b.getBoundingClientRect().width - a.getBoundingClientRect().width
              );
              const w = inputs[0].getBoundingClientRect().width;
              if (w > bestWidth) {
                bestWidth = w;
                bestCell = c;
              }
            }
            const cell = bestCell || overlapping[0];

            const inputs = Array.from(
              cell.querySelectorAll(
                'input[type="text"], input[type="number"], input[type="tel"], input:not([type]), textarea'
              )
            ).filter(x => isVisible(x));
            // Choose the widest visible field; drug name inputs are usually the widest in the cell.
            inputs.sort(
              (a, b) => b.getBoundingClientRect().width - a.getBoundingClientRect().width
            );
            const input = inputs[0] || null;
            if (!input) return false;

            input.scrollIntoView({ block: 'center' });
            input.value = String(name).slice(0, 80);
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
            let qtyOk = false;
            const qtyRaw =
              quantity === null || quantity === undefined ? '' : String(quantity).trim();
            const qtyMatch = qtyRaw.match(/\\d+(?:\\.\\d+)?/);
            let qtyValue = qtyMatch ? qtyMatch[0] : qtyRaw;
            if (qtyValue === '') qtyValue = '1';
            if (qtyValue !== '') {
              // Prefer an explicit qty/quantity input on the same row.
              const rowInputs = Array.from(
                targetRow.querySelectorAll(
                  'input[type="text"], input[type="number"], input[type="tel"], input:not([type]), select'
                )
              ).filter(x => isVisible(x) && x !== input);
              const byAttr = rowInputs.find(x =>
                /qty|quantity/i.test((x.name || '') + ' ' + (x.id || ''))
              );
              let qtyInput = byAttr || null;

              if (!qtyInput) {
                // Try to map via the qty header within the same table.
                let qtyHeader =
                  Array.from(headerRow.querySelectorAll('th, td')).find(c =>
                    /qty|quantity/i.test(norm(c.innerText || c.textContent || ''))
                  ) || null;
                if (!qtyHeader) {
                  const headerRows = Array.from(scopedTable.querySelectorAll('tr')).filter(r =>
                    /drug\\s*name|unit|price|qty|amount/i.test(
                      norm(r.innerText || r.textContent || '')
                    )
                  );
                  for (const r of headerRows) {
                    const cells = Array.from(r.querySelectorAll('th, td'));
                    const found = cells.find(c =>
                      /qty|quantity/i.test(norm(c.innerText || c.textContent || ''))
                    );
                    if (found) {
                      qtyHeader = found;
                      break;
                    }
                  }
                }
                if (!qtyHeader) {
                  qtyHeader =
                    Array.from(scopedTable.querySelectorAll('th, td')).find(c =>
                      /qty|quantity/i.test(norm(c.innerText))
                    ) || null;
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
                        qtyCell.querySelectorAll(
                          'input[type="text"], input[type="number"], input[type="tel"], input:not([type]), select'
                        )
                      ).filter(x => isVisible(x));
                      // Quantity fields are usually narrow; pick the smallest visible input.
                      qtyInputs.sort(
                        (a, b) =>
                          (a.getBoundingClientRect().width || 0) -
                          (b.getBoundingClientRect().width || 0)
                      );
                      qtyInput = qtyInputs[0] || null;
                    }
                  }
                }
              }

              if (!qtyInput && rowInputs.length) {
                // Heuristic fallback: choose the narrowest visible input in the row.
                const filtered = rowInputs.filter(x => {
                  const idn = `${x.name || ''} ${x.id || ''}`.toLowerCase();
                  if (/unit|price|amount|amt/.test(idn)) return false;
                  return true;
                });
                const pool = filtered.length ? filtered : rowInputs;
                pool.sort(
                  (a, b) =>
                    (a.getBoundingClientRect().width || 0) - (b.getBoundingClientRect().width || 0)
                );
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
                  const match =
                    opts.find(o => (o.value || '').toString() === qtyValue) ||
                    opts.find(o => (o.textContent || '').trim() === qtyValue);
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
        this._logStep('Drug name filled directly in drug table', {
          rowIndex,
          qtyFilled: directFilled.qtyOk,
        });
        this.lastDrugSelectionByRow[rowIndex] = {
          fromMaster: false,
          name: String(drugData.name || '').trim(),
          checkedAt: new Date().toISOString(),
        };
        return true;
      }

      // Best-effort: modal selection is highly portal-specific; don't risk filling the wrong field.
      logger.warn(
        `Could not fill Drug Name row ${rowIndex} (direct fill did not locate the drug table)`
      );
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
          const norm = s => (s || '').replace(/\s+/g, ' ').trim().toLowerCase();
          const isVisible = el => {
            if (!el) return false;
            const style = window.getComputedStyle(el);
            if (!style) return false;
            if (style.display === 'none' || style.visibility === 'hidden') return false;
            return true;
          };
          const sameNumeric = (a, b) => {
            const n1 = Number(String(a || '').trim());
            const n2 = Number(String(b || '').trim());
            if (!Number.isFinite(n1) || !Number.isFinite(n2)) return false;
            return Math.abs(n1 - n2) < 1e-9;
          };

          let table = document.querySelector('#drugTable');
          let headerRow = null;
          let qtyHeader = null;
          let _drugHeader = null;

          const findHeaderRow = root => {
            const rows = Array.from(root.querySelectorAll('tr'));
            return rows.find(r => /drug\s*name/i.test(norm(r.innerText))) || null;
          };

          if (table) {
            headerRow = findHeaderRow(table);
            if (headerRow) {
              const cells = Array.from(headerRow.querySelectorAll('th, td'));
              _drugHeader = cells.find(c => /drug\s*name/i.test(norm(c.innerText))) || null;
              qtyHeader = cells.find(c => /qty|quantity/i.test(norm(c.innerText))) || null;
            }
          }

          if (!table || !headerRow) {
            const headerCell =
              Array.from(document.querySelectorAll('th, td')).find(c =>
                /drug\s*name/i.test(norm(c.innerText))
              ) || null;
            if (!headerCell) return false;
            table = headerCell.closest('table');
            headerRow = headerCell.closest('tr');
            if (!table || !headerRow) return false;
            const cells = Array.from(headerRow.querySelectorAll('th, td'));
            _drugHeader = headerCell;
            qtyHeader = cells.find(c => /qty|quantity/i.test(norm(c.innerText))) || null;
          }

          const rows = Array.from(table.querySelectorAll('tr')).filter(
            r => r.closest('table') === table
          );
          const headerIdx = rows.indexOf(headerRow);
          if (headerIdx < 0) return false;

          const dataRows = [];
          for (let i = headerIdx + 1; i < rows.length; i++) {
            const text = norm(rows[i].innerText || '');
            if (/total\s+drug\s+fee/i.test(text)) break;
            if (
              rows[i].querySelector(
                'input[type="text"], input[type="number"], input[type="tel"], input:not([type]), select'
              )
            ) {
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
                  cell.querySelectorAll(
                    'input[type="text"], input[type="number"], input[type="tel"], input:not([type]), select'
                  )
                ).filter(x => isVisible(x));
                qtyInput = inputs[0] || null;
              }
            }
          }

          if (!qtyInput) {
            const rowInputs = Array.from(
              targetRow.querySelectorAll(
                'input[type="text"], input[type="number"], input[type="tel"], input:not([type]), select'
              )
            ).filter(x => isVisible(x));
            const attrFirst = rowInputs.find(x =>
              /qty|quantity/i.test((x.name || '') + ' ' + (x.id || ''))
            );
            if (attrFirst) {
              qtyInput = attrFirst;
            } else {
              // Last resort: choose a narrow input that does not look like unit/price/amount.
              const filtered = rowInputs.filter(x => {
                const idn = `${x.name || ''} ${x.id || ''}`.toLowerCase();
                return !/unit|price|amount|amt|claim|code/.test(idn);
              });
              const pool = filtered.length ? filtered : rowInputs;
              pool.sort(
                (a, b) =>
                  (a.getBoundingClientRect().width || 0) - (b.getBoundingClientRect().width || 0)
              );
              qtyInput = pool[0] || null;
            }
          }
          if (!qtyInput) {
            const qtyInputs = Array.from(
              document.querySelectorAll('input[name*="qty" i], input[id*="qty" i]')
            ).filter(x => isVisible(x));
            if (qtyInputs.length) {
              const idx = Math.max(0, rowIndex - 1);
              qtyInput = qtyInputs[idx] || qtyInputs[0];
            }
          }

          if (!qtyInput) return false;
          const tag = (qtyInput.tagName || '').toLowerCase();
          if (tag === 'select') {
            const opts = Array.from(qtyInput.querySelectorAll('option'));
            const match =
              opts.find(o => (o.value || '').toString() === qtyValue) ||
              opts.find(o => (o.textContent || '').trim() === qtyValue);
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
      .evaluate(
        ({ rowIndex, qtyValue }) => {
          const norm = s => (s || '').toString().replace(/\s+/g, ' ').trim().toLowerCase();
          const isVisible = el => {
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
          const rowCellsWithSpan = row =>
            Array.from(row.querySelectorAll('th, td')).map(c => ({
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
            ...Array.from(document.querySelectorAll('table')).filter(t =>
              /drug\s*name/i.test(norm(t.innerText || ''))
            ),
          ].filter(Boolean);
          const table = tables[0] || null;
          if (!table) return false;

          const rows = Array.from(table.querySelectorAll('tr')).filter(
            r => r.closest('table') === table
          );
          const headerRow = rows.find(r => /drug\s*name/i.test(norm(r.innerText || ''))) || null;
          if (!headerRow) return false;
          const headerIdx = rows.indexOf(headerRow);
          if (headerIdx < 0) return false;

          const dataRows = [];
          for (let i = headerIdx + 1; i < rows.length; i++) {
            const row = rows[i];
            const text = norm(row.innerText || '');
            if (/total\s+drug\s+fee/i.test(text)) break;
            if (
              row.querySelector(
                'input[type="text"], input[type="number"], input[type="tel"], input:not([type]), select'
              )
            ) {
              dataRows.push(row);
            }
          }
          const target = dataRows[Math.max(0, rowIndex - 1)];
          if (!target) return false;

          const headerCells = Array.from(headerRow.querySelectorAll('th, td'));
          const qtyHeader =
            headerCells.find(c => /qty|quantity/i.test(norm(c.innerText || c.textContent || ''))) ||
            null;
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
                  qtyCell.querySelectorAll(
                    'input[type="text"], input[type="number"], input[type="tel"], input:not([type]), select'
                  )
                ).filter(x => isVisible(x));
                qtyInput = candidates[0] || null;
              }
            }
          }

          if (!qtyInput) {
            const inputs = Array.from(
              target.querySelectorAll(
                'input[type="text"], input[type="number"], input[type="tel"], input:not([type]), select'
              )
            ).filter(x => isVisible(x));
            if (!inputs.length) return false;
            qtyInput =
              inputs.find(x => /qty|quantity/i.test((x.name || '') + ' ' + (x.id || ''))) || null;
            if (!qtyInput) {
              const filtered = inputs.filter(x => {
                const idn = `${x.name || ''} ${x.id || ''}`.toLowerCase();
                return !/unit|price|amount|amt|claim|code/.test(idn);
              });
              const pool = filtered.length ? filtered : inputs;
              pool.sort(
                (a, b) =>
                  (a.getBoundingClientRect().width || 0) - (b.getBoundingClientRect().width || 0)
              );
              qtyInput = pool[0] || null;
            }
          }

          if (!qtyInput) return false;
          const tag = (qtyInput.tagName || '').toLowerCase();
          if (tag === 'select') {
            const opts = Array.from(qtyInput.querySelectorAll('option'));
            const match =
              opts.find(o => (o.value || '').toString() === qtyValue) ||
              opts.find(o => (o.textContent || '').trim() === qtyValue);
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

    if (ok) this._logStep('Drug qty verified', { rowIndex, quantity: qtyValue });
    return ok;
  }

  /**
   * Fill drug pricing fields (unit/unit price/amount) on a specific drug row.
   * @param {number} rowIndex
   * @param {{unit?: string|null, quantity?: string|number|null, unitPrice?: string|number|null, amount?: string|number|null}} pricing
   */
  async fillDrugPricingFallback(rowIndex = 1, pricing = {}) {
    const normalizeNumber = (v, decimals = 4) => {
      if (v === null || v === undefined) return null;
      const s = String(v).replace(/,/g, '').trim();
      if (!s) return null;
      const m = s.match(/-?\d+(?:\.\d+)?/);
      if (!m) return null;
      const n = Number.parseFloat(m[0]);
      if (!Number.isFinite(n)) return null;
      return String(Number(n.toFixed(decimals)));
    };
    const unit =
      String(pricing?.unit || '')
        .trim()
        .toUpperCase() || null;
    const qtyValue = normalizeNumber(pricing?.quantity, 4);
    let unitPriceValue = normalizeNumber(pricing?.unitPrice, 4);
    let amountValue = normalizeNumber(pricing?.amount, 4);
    const qtyNum = qtyValue === null ? NaN : Number.parseFloat(qtyValue);
    const amountNum = amountValue === null ? NaN : Number.parseFloat(amountValue);
    if (
      (!unitPriceValue || Number.parseFloat(unitPriceValue) <= 0) &&
      Number.isFinite(amountNum) &&
      amountNum > 0 &&
      Number.isFinite(qtyNum) &&
      qtyNum > 0
    ) {
      unitPriceValue = String(Number((amountNum / qtyNum).toFixed(4)));
    }
    const priceNum = unitPriceValue === null ? NaN : Number.parseFloat(unitPriceValue);
    if (
      (!amountValue || Number.parseFloat(amountValue) <= 0) &&
      Number.isFinite(priceNum) &&
      priceNum > 0 &&
      Number.isFinite(qtyNum) &&
      qtyNum > 0
    ) {
      amountValue = String(Number((priceNum * qtyNum).toFixed(4)));
    }
    if (!unit && !unitPriceValue && !amountValue) return false;

    const result = await this.page
      .evaluate(
        ({ rowIndex, unit, unitPriceValue, amountValue }) => {
          const norm = s => (s || '').toString().replace(/\s+/g, ' ').trim().toLowerCase();
          const isVisible = el => {
            if (!el) return false;
            const style = window.getComputedStyle(el);
            if (!style) return false;
            if (style.display === 'none' || style.visibility === 'hidden') return false;
            const r = el.getBoundingClientRect();
            if (!r || r.width <= 0 || r.height <= 0) return false;
            return true;
          };
          const setValue = (el, value) => {
            if (!el) return false;
            const val = String(value ?? '').trim();
            if (!val) return false;
            const tag = (el.tagName || '').toLowerCase();
            if (tag === 'select') {
              const options = Array.from(el.querySelectorAll('option'));
              const exact = options.find(
                o => norm(o.value) === norm(val) || norm(o.textContent) === norm(val)
              );
              const partial =
                exact ||
                options.find(
                  o => norm(o.value).includes(norm(val)) || norm(o.textContent).includes(norm(val))
                );
              if (!partial) return false;
              el.value = partial.value;
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
            el.value = val;
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
            el.blur && el.blur();
            return String(el.value || '').trim().length > 0;
          };

          const table =
            document.querySelector('#drugTable') ||
            Array.from(document.querySelectorAll('table')).find(t =>
              /drug\s*name/i.test(norm(t.innerText || t.textContent || ''))
            ) ||
            null;
          if (!table) return { unitSet: false, priceSet: false, amountSet: false };
          const rows = Array.from(table.querySelectorAll('tr')).filter(
            r => r.closest('table') === table
          );
          const headerRow =
            rows.find(r => /drug\s*name/i.test(norm(r.innerText || r.textContent || ''))) || null;
          if (!headerRow) return { unitSet: false, priceSet: false, amountSet: false };
          const headerIdx = rows.indexOf(headerRow);
          if (headerIdx < 0) return { unitSet: false, priceSet: false, amountSet: false };

          const dataRows = [];
          for (let i = headerIdx + 1; i < rows.length; i++) {
            const text = norm(rows[i].innerText || '');
            if (/total\s+drug\s+fee/.test(text)) break;
            if (
              rows[i].querySelector(
                'input[type="text"], input[type="number"], input[type="tel"], input:not([type]), select'
              )
            ) {
              dataRows.push(rows[i]);
            }
          }
          const row = dataRows[Math.max(0, rowIndex - 1)];
          if (!row) return { unitSet: false, priceSet: false, amountSet: false };

          const rowInputs = Array.from(
            row.querySelectorAll(
              'input[type="text"], input[type="number"], input[type="tel"], input:not([type]), select, textarea'
            )
          ).filter(el => isVisible(el));
          if (!rowInputs.length) return { unitSet: false, priceSet: false, amountSet: false };

          const idn = el => `${el.name || ''} ${el.id || ''}`.toLowerCase();
          const unitInput =
            rowInputs.find(el => {
              const s = idn(el);
              return /unit/.test(s) && !/price|qty|quantity|amount|amt|code|claim|total/.test(s);
            }) || null;
          const priceInput =
            rowInputs.find(el => {
              const s = idn(el);
              return (
                /unit\s*price|unitprice|price/.test(s) &&
                !/amount|amt|qty|quantity|claim|total|gst/.test(s)
              );
            }) || null;
          const amountInput =
            rowInputs.find(el => {
              const s = idn(el);
              return /amount|amt/.test(s) && !/claim|total|gst/.test(s);
            }) || null;

          let unitSet = false;
          let priceSet = false;
          let amountSet = false;
          if (unit && unitInput) unitSet = setValue(unitInput, unit);
          if (unitPriceValue && priceInput) priceSet = setValue(priceInput, unitPriceValue);
          if (amountValue && amountInput) amountSet = setValue(amountInput, amountValue);

          const priceFinal = priceInput ? String(priceInput.value || '').trim() : '';
          const amountFinal = amountInput ? String(amountInput.value || '').trim() : '';
          return {
            unitSet,
            priceSet,
            amountSet,
            priceFinal,
            amountFinal,
            unitField: unitInput ? { name: unitInput.name || '', id: unitInput.id || '' } : null,
            priceField: priceInput
              ? { name: priceInput.name || '', id: priceInput.id || '' }
              : null,
            amountField: amountInput
              ? { name: amountInput.name || '', id: amountInput.id || '' }
              : null,
          };
        },
        { rowIndex, unit, unitPriceValue, amountValue }
      )
      .catch(() => ({ unitSet: false, priceSet: false, amountSet: false }));

    if (result?.priceSet || result?.amountSet || result?.unitSet) {
      this._logStep('Drug pricing filled (fallback)', {
        rowIndex,
        unit: unit || null,
        unitPrice: unitPriceValue || null,
        amount: amountValue || null,
        result,
      });
      return true;
    }
    return false;
  }

  /**
   * Verify unit price/amount fields on a drug row.
   * @param {number} rowIndex
   * @param {{unitPrice?: string|number|null, amount?: string|number|null}} pricing
   */
  async verifyDrugPricing(rowIndex = 1, pricing = {}) {
    const normalizeNumber = v => {
      if (v === null || v === undefined) return null;
      const s = String(v).replace(/,/g, '').trim();
      if (!s) return null;
      const m = s.match(/-?\d+(?:\.\d+)?/);
      if (!m) return null;
      const n = Number.parseFloat(m[0]);
      if (!Number.isFinite(n)) return null;
      return n;
    };
    const expectedPrice = normalizeNumber(pricing?.unitPrice);
    const expectedAmount = normalizeNumber(pricing?.amount);
    if (!Number.isFinite(expectedPrice) && !Number.isFinite(expectedAmount)) return false;

    const ok = await this.page
      .evaluate(
        ({ rowIndex, expectedPrice, expectedAmount }) => {
          const norm = s => (s || '').toString().replace(/\s+/g, ' ').trim().toLowerCase();
          const isVisible = el => {
            if (!el) return false;
            const style = window.getComputedStyle(el);
            if (!style) return false;
            if (style.display === 'none' || style.visibility === 'hidden') return false;
            const r = el.getBoundingClientRect();
            return !!r && r.width > 0 && r.height > 0;
          };
          const asNumber = v => {
            const s = String(v || '')
              .replace(/,/g, '')
              .trim();
            const m = s.match(/-?\d+(?:\.\d+)?/);
            if (!m) return NaN;
            return Number.parseFloat(m[0]);
          };
          const same = (a, b) =>
            Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= 0.05;

          const table =
            document.querySelector('#drugTable') ||
            Array.from(document.querySelectorAll('table')).find(t =>
              /drug\s*name/i.test(norm(t.innerText || t.textContent || ''))
            ) ||
            null;
          if (!table) return false;
          const rows = Array.from(table.querySelectorAll('tr')).filter(
            r => r.closest('table') === table
          );
          const headerRow =
            rows.find(r => /drug\s*name/i.test(norm(r.innerText || r.textContent || ''))) || null;
          if (!headerRow) return false;
          const headerIdx = rows.indexOf(headerRow);
          if (headerIdx < 0) return false;

          const dataRows = [];
          for (let i = headerIdx + 1; i < rows.length; i++) {
            const text = norm(rows[i].innerText || '');
            if (/total\s+drug\s+fee/.test(text)) break;
            if (
              rows[i].querySelector(
                'input[type="text"], input[type="number"], input[type="tel"], input:not([type]), select'
              )
            ) {
              dataRows.push(rows[i]);
            }
          }
          const row = dataRows[Math.max(0, rowIndex - 1)];
          if (!row) return false;

          const rowInputs = Array.from(
            row.querySelectorAll(
              'input[type="text"], input[type="number"], input[type="tel"], input:not([type]), select, textarea'
            )
          ).filter(el => isVisible(el));
          const idn = el => `${el.name || ''} ${el.id || ''}`.toLowerCase();
          const priceInput =
            rowInputs.find(el => {
              const s = idn(el);
              return (
                /unit\s*price|unitprice|price/.test(s) &&
                !/amount|amt|qty|quantity|claim|total|gst/.test(s)
              );
            }) || null;
          const amountInput =
            rowInputs.find(el => {
              const s = idn(el);
              return /amount|amt/.test(s) && !/claim|total|gst/.test(s);
            }) || null;

          const actualPrice = priceInput ? asNumber(priceInput.value) : NaN;
          const actualAmount = amountInput ? asNumber(amountInput.value) : NaN;

          if (Number.isFinite(expectedPrice) && !same(actualPrice, expectedPrice)) return false;
          if (Number.isFinite(expectedAmount) && !same(actualAmount, expectedAmount)) return false;
          return true;
        },
        { rowIndex, expectedPrice, expectedAmount }
      )
      .catch(() => false);

    if (ok)
      this._logStep('Drug pricing verified', {
        rowIndex,
        unitPrice: expectedPrice ?? null,
        amount: expectedAmount ?? null,
      });
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
            const norm = s => (s || '').replace(/\s+/g, ' ').trim();
            const isVisible = el => {
              if (!el) return false;
              const style = window.getComputedStyle(el);
              if (!style) return false;
              if (style.display === 'none' || style.visibility === 'hidden') return false;
              return true;
            };

            // Best anchor: the "More Procedure" button; it uniquely identifies the procedure section.
            const moreBtn =
              Array.from(
                document.querySelectorAll('button, input[type="button"], input[type="submit"]')
              ).find(el => /more\s+procedure/i.test(norm(el.textContent || el.value || ''))) ||
              null;
            if (moreBtn) {
              const table = moreBtn.closest('table');
              const row = moreBtn.closest('tr');
              if (table && row) {
                const rows = Array.from(table.querySelectorAll('tr')).filter(
                  r => r.closest('table') === table
                );
                const idx = rows.indexOf(row);
                // Fill into the nearest prior data row (normally the row directly above the More Procedure button).
                for (let i = idx - 1; i >= 0; i--) {
                  const rt = norm(rows[i].innerText || rows[i].textContent || '');
                  if (!rt) continue;
                  if (/procedure\s*name/i.test(rt) || /total\s+proc\s+fee/i.test(rt)) continue;
                  const inputs = Array.from(
                    rows[i].querySelectorAll('input[type="text"], input:not([type]), textarea')
                  ).filter(x => isVisible(x));
                  if (!inputs.length) continue;
                  // Prefer the widest input (usually the "Procedure Name" input).
                  inputs.sort(
                    (a, b) =>
                      (b.getBoundingClientRect().width || 0) -
                      (a.getBoundingClientRect().width || 0)
                  );
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
            const headerCells = Array.from(document.querySelectorAll('th, td')).filter(c =>
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
              if (/total\s+proc\s+fee/i.test(tableText) || /total\s+procedure/i.test(tableText))
                score += 10;
              if (/more\s+procedure/i.test(tableText)) score += 5;
              const rows = Array.from(table.querySelectorAll('tr')).filter(
                r => r.closest('table') === table
              );
              const headerIdx = rows.indexOf(headerRow);
              if (headerIdx < 0) continue;
              let dataRows = 0;
              for (let i = headerIdx + 1; i < rows.length; i++) {
                const rowText = norm(rows[i].innerText);
                if (/total\s+proc\s+fee/i.test(rowText) || /total\s+procedure/i.test(rowText))
                  break;
                if (rows[i].querySelector('input[type="text"], input:not([type]), textarea'))
                  dataRows += 1;
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

            const rows = Array.from(table.querySelectorAll('tr')).filter(
              r => r.closest('table') === table
            );
            const headerIdx = rows.indexOf(headerRow);
            if (headerIdx < 0) return false;

            const rowCellsWithSpan = row =>
              Array.from(row.querySelectorAll('th, td')).map(c => ({
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
              if (rows[i].querySelector('input[type="text"], input:not([type]), textarea'))
                dataRows.push(rows[i]);
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

            const scoreInput = inp => {
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
              const inputs = Array.from(
                c.querySelectorAll('input[type="text"], input:not([type]), textarea')
              ).filter(x => isVisible(x));
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
    const procNameNorm = String(procedureName || '')
      .trim()
      .toLowerCase();

    const ok = await this.page
      .evaluate(
        ({ rowIndex, claimValue, procNameNorm }) => {
          const norm = s => (s || '').toString().replace(/\s+/g, ' ').trim().toLowerCase();
          const isVisible = el => {
            if (!el) return false;
            const style = window.getComputedStyle(el);
            if (!style) return false;
            if (style.display === 'none' || style.visibility === 'hidden') return false;
            const r = el.getBoundingClientRect();
            if (!r || r.width <= 0 || r.height <= 0) return false;
            return true;
          };
          const isTextLike = el => {
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
                opts.find(o => (o.value || '').toString().trim() === v) ||
                opts.find(o => (o.textContent || '').toString().trim() === v);
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
              document.querySelectorAll(
                'input[type="text"], input[type="number"], input[type="tel"], input:not([type]), textarea'
              )
            ).filter(el => isVisible(el));
            const nameCandidates = textLikes.filter(el => {
              const v = norm(el.value || '');
              if (!v) return false;
              if (!v.includes(procNameNorm)) return false;
              const idn = `${el.name || ''} ${el.id || ''}`.toLowerCase();
              // Prefer true procedure-name fields.
              return (
                /proc|procedure|desc|name/.test(idn) || v.length >= Math.min(8, procNameNorm.length)
              );
            });
            for (const nameEl of nameCandidates) {
              const row = nameEl.closest('tr');
              if (row) {
                const rowInputs = Array.from(
                  row.querySelectorAll(
                    'input[type="text"], input[type="number"], input[type="tel"], input:not([type]), select, textarea'
                  )
                ).filter(el => isVisible(el) && isTextLike(el));
                if (rowInputs.length) {
                  rowInputs.sort(
                    (a, b) =>
                      (a.getBoundingClientRect().left || 0) - (b.getBoundingClientRect().left || 0)
                  );
                  const nameX = nameEl.getBoundingClientRect().left || 0;
                  const rightCandidates = rowInputs.filter(el => {
                    if (el === nameEl) return false;
                    const idn = `${el.name || ''} ${el.id || ''}`.toLowerCase();
                    if (/proc|procedure|desc|name/.test(idn)) return false;
                    const x = el.getBoundingClientRect().left || 0;
                    return x > nameX + 20;
                  });
                  const pool = rightCandidates.length
                    ? rightCandidates
                    : rowInputs.filter(el => el !== nameEl);
                  for (const inp of pool.sort(
                    (a, b) =>
                      (a.getBoundingClientRect().left || 0) - (b.getBoundingClientRect().left || 0)
                  )) {
                    if (setValue(inp, claimValue)) return true;
                  }
                }
              }
              // Non-table fallback: same y-band to the right of procedure name input.
              const nr = nameEl.getBoundingClientRect();
              const band = textLikes
                .filter(el => {
                  if (el === nameEl) return false;
                  const idn = `${el.name || ''} ${el.id || ''}`.toLowerCase();
                  if (/proc|procedure|desc|name/.test(idn)) return false;
                  const r = el.getBoundingClientRect();
                  return (
                    Math.abs((r.top || 0) - (nr.top || 0)) <= 8 &&
                    (r.left || 0) > (nr.left || 0) + 20
                  );
                })
                .sort(
                  (a, b) =>
                    (a.getBoundingClientRect().left || 0) - (b.getBoundingClientRect().left || 0)
                );
              for (const inp of band) {
                if (setValue(inp, claimValue)) return true;
              }
            }
            return false;
          };
          if (byRowFromName()) return true;

          // Fast path: many legacy pages expose procedure claim inputs with claim-like names/ids.
          // Fill those directly first (excluding total claim fields).
          const labels = Array.from(
            document.querySelectorAll('th, td, div, span, label, b, strong')
          );
          const procHeaderEl =
            labels.find(el => /procedure\s*name/i.test(norm(el.textContent || ''))) || null;
          const totalProcEl =
            labels.find(el => /total\s+proc\s+fee/i.test(norm(el.textContent || ''))) || null;
          const claimLikeInputs = Array.from(
            document.querySelectorAll(
              'input[type="text"], input[type="number"], input[type="tel"], input:not([type]), select, textarea'
            )
          )
            .filter(el => isVisible(el) && isTextLike(el))
            .filter(el => {
              const idn = `${el.name || ''} ${el.id || ''}`.toLowerCase();
              if (!/claim|clm/.test(idn)) return false;
              if (/total/.test(idn)) return false;
              return true;
            });
          if (claimLikeInputs.length) {
            let scoped = claimLikeInputs;
            if (procHeaderEl) {
              const top = procHeaderEl.getBoundingClientRect().bottom + 2;
              const bottom = totalProcEl ? totalProcEl.getBoundingClientRect().top - 2 : top + 260;
              const inBand = scoped.filter(el => {
                const r = el.getBoundingClientRect();
                return r.top >= top && r.bottom <= bottom;
              });
              if (inBand.length) scoped = inBand;
            }
            scoped.sort((a, b) => {
              const ra = a.getBoundingClientRect();
              const rb = b.getBoundingClientRect();
              return ra.top - rb.top || ra.left - rb.left;
            });
            const directTarget = scoped[Math.max(0, rowIndex - 1)] || null;
            if (directTarget && setValue(directTarget, claimValue)) return true;
          }
          const rowCellsWithSpan = row =>
            Array.from(row.querySelectorAll('th, td')).map(c => ({
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

          const tables = Array.from(document.querySelectorAll('table')).filter(t =>
            /procedure\s*name/i.test(norm(t.innerText || t.textContent || ''))
          );
          if (!tables.length) return false;

          // Prefer the table that has both the procedure and claim headers.
          const sortedTables = tables
            .map(t => {
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

          const rows = Array.from(chosenTable.querySelectorAll('tr')).filter(
            r => r.closest('table') === chosenTable
          );
          const headerRow =
            rows.find(r => {
              const rt = norm(r.innerText || r.textContent || '');
              return /procedure\s*name/i.test(rt) && /claim/i.test(rt);
            }) ||
            rows.find(r => /procedure\s*name/i.test(norm(r.innerText || r.textContent || ''))) ||
            null;
          if (!headerRow) return false;
          const headerIdx = rows.indexOf(headerRow);
          if (headerIdx < 0) return false;

          const headerCells = Array.from(headerRow.querySelectorAll('th, td'));
          const claimHeaderCell =
            headerCells.find(c =>
              /claim\s*\(?.*sgd.*\)?/i.test(norm(c.innerText || c.textContent || ''))
            ) ||
            headerCells.find(c =>
              /claim|amt|amount/i.test(norm(c.innerText || c.textContent || ''))
            ) ||
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
            if (
              row.querySelector(
                'input[type="text"], input[type="number"], input[type="tel"], input:not([type]), select'
              )
            ) {
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
            .flatMap(cell =>
              Array.from(
                cell.querySelectorAll(
                  'input[type="text"], input[type="number"], input[type="tel"], input:not([type]), select, textarea'
                )
              )
            )
            .filter(x => isVisible(x) && isTextLike(x));

          const scoreInput = el => {
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
            targetRow.querySelectorAll(
              'input[type="text"], input[type="number"], input[type="tel"], input:not([type]), select, textarea'
            )
          ).filter(x => isVisible(x) && isTextLike(x));
          if (!rowInputs.length) return false;
          const fallbackCandidates = rowInputs.filter(x => {
            const idn = `${x.name || ''} ${x.id || ''}`.toLowerCase();
            return !/proc|procedure|desc|name/.test(idn);
          });
          const pool = fallbackCandidates.length ? fallbackCandidates : rowInputs;
          pool.sort(
            (a, b) => (b.getBoundingClientRect().left || 0) - (a.getBoundingClientRect().left || 0)
          );
          for (const inp of pool) {
            if (setValue(inp, claimValue)) return true;
          }

          // Final fallback for inconsistent legacy DOM: use geometry within Procedure section.
          const allTextLike = Array.from(
            document.querySelectorAll(
              'input[type="text"], input[type="number"], input[type="tel"], input:not([type]), select, textarea'
            )
          ).filter(x => isVisible(x) && isTextLike(x));
          const labels2 = Array.from(
            document.querySelectorAll('th, td, div, span, label, b, strong')
          );
          const procHeaderEl2 =
            labels2.find(el => /procedure\s*name/i.test(norm(el.textContent || ''))) || null;
          const moreProcEl =
            Array.from(
              document.querySelectorAll('button, input[type="button"], input[type="submit"]')
            ).find(el => /more\s+procedure/i.test(norm(el.textContent || el.value || ''))) || null;
          const totalProcEl2 =
            labels2.find(el => /total\s+proc\s+fee/i.test(norm(el.textContent || ''))) || null;
          if (procHeaderEl2) {
            const top = procHeaderEl2.getBoundingClientRect().bottom + 2;
            let bottom = top + 260;
            if (moreProcEl) bottom = Math.min(bottom, moreProcEl.getBoundingClientRect().top - 2);
            if (totalProcEl2)
              bottom = Math.min(bottom, totalProcEl2.getBoundingClientRect().top - 2);
            const scoped = allTextLike
              .map(el => ({ el, r: el.getBoundingClientRect() }))
              .filter(({ r }) => r.top >= top && r.bottom <= bottom && r.left >= 0)
              .sort((a, b) => a.r.top - b.r.top || a.r.left - b.r.left);
            if (scoped.length) {
              const rowsByY = [];
              for (const item of scoped) {
                const row = rowsByY.find(g => Math.abs(g.y - item.r.top) <= 8);
                if (row) row.items.push(item);
                else rowsByY.push({ y: item.r.top, items: [item] });
              }
              rowsByY.sort((a, b) => a.y - b.y);
              const targetGroup = rowsByY[Math.max(0, rowIndex - 1)] || null;
              if (targetGroup && targetGroup.items.length) {
                const groupItems = targetGroup.items
                  .sort((a, b) => a.r.left - b.r.left)
                  .map(x => x.el);
                const groupCandidates = groupItems.filter(x => {
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
        .evaluate(
          ({ rowIndex }) => {
            const norm = s => (s || '').toString().replace(/\s+/g, ' ').trim().toLowerCase();
            const isVisible = el => {
              if (!el) return false;
              const style = window.getComputedStyle(el);
              if (!style) return false;
              if (style.display === 'none' || style.visibility === 'hidden') return false;
              const r = el.getBoundingClientRect();
              return !!r && r.width > 0 && r.height > 0;
            };
            const labels = Array.from(
              document.querySelectorAll('th, td, div, span, label, b, strong')
            );
            const procHeaderEl =
              labels.find(el => /procedure\s*name/i.test(norm(el.textContent || ''))) || null;
            const totalProcEl =
              labels.find(el => /total\s+proc\s+fee/i.test(norm(el.textContent || ''))) || null;
            const top = procHeaderEl ? procHeaderEl.getBoundingClientRect().bottom + 2 : 0;
            const bottom = totalProcEl
              ? totalProcEl.getBoundingClientRect().top - 2
              : Number.POSITIVE_INFINITY;
            const inputs = Array.from(
              document.querySelectorAll(
                'input[type="text"], input[type="number"], input[type="tel"], input:not([type]), select, textarea'
              )
            )
              .filter(el => isVisible(el))
              .map(el => {
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
            const procInputs = inputs
              .filter(x => x.inProcBand)
              .sort((a, b) => a.top - b.top || a.left - b.left);
            return {
              rowIndex,
              procHeaderTop: Math.round(top),
              procBottom: Number.isFinite(bottom) ? Math.round(bottom) : null,
              procInputs: procInputs.slice(0, 20),
              claimLike: procInputs
                .filter(x => /claim|clm/i.test(`${x.name} ${x.id}`))
                .slice(0, 10),
            };
          },
          { rowIndex }
        )
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
          if (
            (await button.count().catch(() => 0)) > 0 &&
            (await button.isVisible().catch(() => true))
          ) {
            const beforeUrl = this.page.url();
            const navPromise = this.page
              .waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 8000 })
              .catch(() => null);
            const dialogPromise = this.page
              .waitForEvent('dialog', { timeout: 2000 })
              .catch(() => null);
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
            this._logStep('Compute claim clicked', {
              urlChanged: beforeUrl !== (this.page.url() || ''),
            });
            return true;
          }
        } catch (e) {
          continue;
        }
      }

      // Fallback: some portals render it as an <input type="button" value="Compute claim"> inside a form table.
      const clicked = await this.page
        .evaluate(() => {
          const candidates = Array.from(
            document.querySelectorAll('button, input[type="button"], input[type="submit"]')
          );
          const norm = s => (s || '').toString().replace(/\s+/g, ' ').trim().toLowerCase();
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

      const drugSelector =
        '#drugTable > tbody > tr:nth-child(2) > td:nth-child(2) > input:nth-child(3)';

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
      const filled = await this.page.evaluate(name => {
        const input = document.querySelector(
          '#drugTable > tbody > tr:nth-child(2) > td:nth-child(2) > input:nth-child(3)'
        );
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
            const options = await select
              .locator('option')
              .evaluateAll(opts =>
                opts.map(o => ({ value: o.value, label: (o.textContent || '').trim() }))
              );

            const targetOption = options.find(o => searchPattern.test(o.label));

            if (targetOption) {
              await select.selectOption({ value: targetOption.value });
              this._logStep('Charge type set', {
                value: targetOption.value,
                label: targetOption.label,
              });
              return true;
            }
          }
        } catch (e) {
          continue;
        }
      }

      // Robust fallback: pick the first select whose options include First/Follow/Repeat.
      const fallback = await this.page
        .evaluate(wantFollow => {
          const norm = s => (s || '').toString().replace(/\s+/g, ' ').trim().toLowerCase();
          const root = document.querySelector('#visit_form') || document;
          const selects = Array.from(root.querySelectorAll('select'));
          const wantRe = wantFollow ? /follow/i : /first/i;
          for (const sel of selects) {
            const opts = Array.from(sel.options || []);
            if (!opts.length) continue;
            const labels = opts.map(o => norm(o.textContent || o.label || o.value || ''));
            const hasChargeOptions = labels.some(t => /first|follow|repeat/.test(t));
            if (!hasChargeOptions) continue;
            const idx = labels.findIndex(t => wantRe.test(t));
            if (idx >= 0) {
              sel.value = opts[idx].value;
              sel.dispatchEvent(new Event('change', { bubbles: true }));
              return {
                success: true,
                value: opts[idx].value,
                label: opts[idx].textContent || opts[idx].label || '',
              };
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
      const selected = await this.page.evaluate(
        pattern => {
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
        },
        chargeType.toLowerCase().includes('follow') ? 'follow' : 'first'
      );

      if (selected.success) {
        this._logStep('Charge type set via JavaScript', selected);
        return true;
      }

      logger.warn('Charge type field not found');
      await this.page
        .screenshot({ path: 'screenshots/mhc-charge-type-not-found.png', fullPage: true })
        .catch(() => {});
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

    this.page.on('dialog', async dialog => {
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
      this.lastDiagnosisSelection = {
        ok: false,
        method: 'dropdown',
        searchTerm,
        reason: 'not_attempted',
        checkedAt: new Date().toISOString(),
      };

      const escapeRegExp = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

      const terms = [];
      let codeOnly = null;
      let descOnly = null;
      let preferredValue = null;
      if (searchTerm && typeof searchTerm === 'object') {
        const code = String(searchTerm.code || '').trim();
        const desc = String(searchTerm.description || '').trim();
        const valueRaw = String(searchTerm.value || searchTerm.selectedValue || '').trim();
        if (valueRaw) preferredValue = valueRaw;
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

      const primary = terms.find(t => t && t.length >= 2) || '';
      if (!primary) {
        logger.warn('Search term too short');
        this.lastDiagnosisSelection = {
          ok: false,
          method: 'dropdown',
          searchTerm,
          reason: 'search_term_too_short',
          checkedAt: new Date().toISOString(),
        };
        return false;
      }

      // Create multiple search patterns:
      // 1. Description-based patterns (preferred)
      // 2. Individual words
      // 3. Diagnosis code variants (fallback)
      const searchPatterns = [];
      const buildCodeVariants = code => {
        const c = String(code || '')
          .replace(/\s+/g, '')
          .toUpperCase();
        if (!c) return [];
        const noDot = c.replace(/\./g, '');
        const noTrailingZeros = noDot.replace(/0+$/g, '');
        const m = c.match(/^([A-Z]\d{2,3})\.?(\d+)?$/);
        const base = m?.[1] || null;
        const suffix = m?.[2] || null;
        const short1 = base && suffix ? `${base}${suffix.slice(0, 1)}` : null;
        const short2 = base && suffix ? `${base}${suffix.slice(0, 2)}` : null;
        return Array.from(
          new Set([c, noDot, noTrailingZeros, base, short2, short1].filter(x => x && x.length >= 3))
        );
      };

      const codeVariants = codeOnly ? buildCodeVariants(codeOnly) : [];
      const normalizeCode = value =>
        String(value || '')
          .toUpperCase()
          .replace(/[^A-Z0-9.]/g, '');
      const extractCode = value => {
        const m = normalizeCode(value).match(/[A-Z]\d{2,3}(?:\.[0-9A-Z]{1,4})?/);
        return m ? m[0] : '';
      };
      const requestedCode = extractCode(codeOnly || '');
      const requestedCodePlain = requestedCode.replace(/\./g, '');
      for (const v of codeVariants) {
        // Match code at start of option label like "S635 - ..." or "S63.5 - ..."
        searchPatterns.push(new RegExp(`\\b${escapeRegExp(v)}\\b`, 'i'));
        // Also accept more specific descendants (e.g. M25.51 should match M25.511).
        searchPatterns.push(new RegExp(`\\b${escapeRegExp(v)}\\d*\\b`, 'i'));
        if (/^[A-Z]\d{2,3}\d+$/i.test(v)) {
          // Also allow a dot between base and suffix: S635 -> S63.5
          const base = v.slice(0, 3);
          const rest = v.slice(3);
          searchPatterns.push(
            new RegExp(`\\b${escapeRegExp(base)}\\.${escapeRegExp(rest)}\\b`, 'i')
          );
          searchPatterns.push(
            new RegExp(`\\b${escapeRegExp(base)}\\.${escapeRegExp(rest)}\\d*\\b`, 'i')
          );
        }
      }

      const normalizeDescKeywords = desc => {
        const stop = new Set([
          'the',
          'and',
          'for',
          'of',
          'in',
          'on',
          'to',
          'at',
          'from',
          'due',
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
          'left',
          'right',
          'bilateral',
        ]);
        return String(desc || '')
          .toLowerCase()
          .replace(/[^a-z0-9\s]/g, ' ')
          .split(/\s+/)
          .filter(w => w.length >= 3)
          .filter(w => !/\d/.test(w))
          .filter(w => !stop.has(w));
      };
      const descForScoring = String(descOnly || '')
        .replace(/^[A-Z]\d{2,3}(?:\.[0-9A-Z]{1,4})?\s*[-: ]\s*/i, '')
        .trim();
      const descKeywords = descForScoring ? normalizeDescKeywords(descForScoring) : [];
      const descNorm = String(descForScoring || '')
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      const sideToken = descNorm.match(/\b(left|right|bilateral)\b/)?.[1] || '';
      const sideWordSet = new Set(['left', 'right', 'bilateral']);
      const weakBodyTokens = new Set([
        'joint',
        'region',
        'site',
        'part',
        'acute',
        'chronic',
        'unspecified',
      ]);
      const knownBodyParts = [
        'shoulder',
        'knee',
        'ankle',
        'wrist',
        'elbow',
        'hip',
        'back',
        'neck',
        'foot',
        'heel',
        'hand',
      ];
      const descWords = descNorm.split(' ').filter(Boolean);
      const lexicalKeywords = descKeywords.filter(
        k => !weakBodyTokens.has(k) && /^[a-z]+$/.test(k) && !sideWordSet.has(k)
      );
      const bodyPartToken =
        knownBodyParts.find(k => descWords.includes(k) || descNorm.includes(k)) ||
        lexicalKeywords.find(k => knownBodyParts.includes(k)) ||
        '';
      const bodyPhrase =
        sideToken && bodyPartToken ? `${sideToken} ${bodyPartToken}` : bodyPartToken;

      // Conservative default: avoid false positives; leave blank if below threshold.
      const dropdownMinScore = Number(process.env.MHC_DIAG_MIN_SCORE_DROPDOWN || '25');
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
            const options = await select
              .locator('option')
              .evaluateAll(opts =>
                opts.map(o => ({ value: o.value, label: (o.textContent || '').trim() }))
              );
            lastOptionsSample = options.slice(0, 40);

            // 1) Prefer description-based matching when we have a description.
            let targetOption = null;
            if (preferredValue) {
              targetOption =
                options.find(o => String(o?.value || '').trim() === preferredValue) || null;
              if (targetOption) {
                this._logStep('Diagnosis selected by exact option value hint', {
                  value: preferredValue,
                  label: String(targetOption?.label || '').slice(0, 80),
                });
              }
            }
            if (!targetOption && descOnly) {
              const desc = descNorm;
              const keywords = descKeywords;
              const score = opt => {
                const l = String((opt?.label || '') + ' ' + (opt?.value || '')).toLowerCase();
                const optionCode = extractCode(`${opt?.label || ''} ${opt?.value || ''}`);
                const optionCodePlain = optionCode.replace(/\./g, '');
                let s = 0;
                if (desc && l.includes(desc)) s += 260;
                if (bodyPhrase && l.includes(bodyPhrase)) s += 180;
                if (bodyPartToken && l.includes(bodyPartToken)) s += 120;
                if (requestedCodePlain && optionCodePlain) {
                  if (optionCodePlain === requestedCodePlain) s += 100;
                  else if (optionCodePlain.startsWith(requestedCodePlain)) s += 70;
                  else if (requestedCodePlain.startsWith(optionCodePlain)) s += 50;
                  else if (
                    requestedCodePlain.slice(0, 3) &&
                    optionCodePlain.startsWith(requestedCodePlain.slice(0, 3))
                  )
                    s += 20;
                }
                for (const k of keywords) if (l.includes(k)) s += 30;
                return s;
              };

              let best = null;
              let bestScore = 0;
              for (const o of options) {
                const sc = score(o);
                if (sc > bestScore) {
                  bestScore = sc;
                  best = o;
                }
              }
              // Canonical resolver gate: even if the legacy keyword scorer
              // picked a winner, run all options through the deterministic
              // resolver (same one GE/NTUC uses) and require it to agree.
              // This blocks the DYLAN AUSTIN TARIN-style failure where
              // "Pain in left wrist" could otherwise snap to the dropdown
              // entry "Injury of wrist and hand".
              const canonicalMin = Number(process.env.MHC_DIAG_CANONICAL_MIN_SCORE || '150');
              const canonicalFallback = String(process.env.MHC_DIAG_CANONICAL_FALLBACK || 'refuse')
                .trim()
                .toLowerCase();
              const portalOptionsForResolver = options
                .filter(o => String(o?.label || '').trim())
                .map(o => {
                  const labelText = String(o?.label || '').trim();
                  const optCode = extractCode(`${labelText} ${o?.value || ''}`);
                  const labelDescOnly = labelText
                    .replace(/\b[A-Z]\d{2,3}(?:\.[0-9A-Z]+)?\b\s*[-:]?\s*/, '')
                    .replace(/\s+/g, ' ')
                    .trim();
                  return {
                    text: labelDescOnly || labelText,
                    code: optCode || null,
                    value: String(o?.value || '').trim() || null,
                  };
                });
              const canonical = resolveDiagnosisAgainstPortalOptions({
                diagnosis: {
                  code: codeOnly || null,
                  description: descForScoring || descOnly || null,
                },
                portalOptions: portalOptionsForResolver,
                minScore: canonicalMin,
                codeMode: codeOnly ? 'primary' : 'secondary',
              });
              const canonicalAccepted = canonical && canonical.blocked === false ? canonical : null;
              const canonicalAgreesWithLegacy = (() => {
                if (!canonicalAccepted || !best) return false;
                const wantText = String(canonicalAccepted.selected_text || '')
                  .trim()
                  .toLowerCase();
                const bestLabelDesc = String(best?.label || '')
                  .replace(/\b[A-Z]\d{2,3}(?:\.[0-9A-Z]+)?\b\s*[-:]?\s*/, '')
                  .replace(/\s+/g, ' ')
                  .trim()
                  .toLowerCase();
                return wantText && wantText === bestLabelDesc;
              })();

              if (best && bestScore >= dropdownMinScore) {
                const bestCode = extractCode(`${best?.label || ''} ${best?.value || ''}`);
                const bestCodePlain = String(bestCode || '').replace(/\./g, '');
                const requestedPrefix = requestedCodePlain ? requestedCodePlain.slice(0, 3) : '';
                const bestPrefix = bestCodePlain ? bestCodePlain.slice(0, 3) : '';
                const prefixCompatible =
                  !requestedCodePlain ||
                  (!!bestCodePlain &&
                    ((requestedPrefix && bestCodePlain.startsWith(requestedPrefix)) ||
                      (bestPrefix && requestedCodePlain.startsWith(bestPrefix))));
                const bodyCompatible =
                  !bodyPartToken ||
                  String(best?.label || '')
                    .toLowerCase()
                    .includes(bodyPartToken);

                if (canonicalAccepted) {
                  if (canonicalAgreesWithLegacy && (prefixCompatible || bodyCompatible)) {
                    targetOption = best;
                  } else {
                    // Canonical resolver picked something different — trust
                    // the resolver, not the legacy scorer.
                    const resolverOption = options.find(o => {
                      const labelDescOnly = String(o?.label || '')
                        .replace(/\b[A-Z]\d{2,3}(?:\.[0-9A-Z]+)?\b\s*[-:]?\s*/, '')
                        .replace(/\s+/g, ' ')
                        .trim()
                        .toLowerCase();
                      return (
                        labelDescOnly ===
                        String(canonicalAccepted.selected_text || '')
                          .trim()
                          .toLowerCase()
                      );
                    });
                    if (resolverOption) {
                      targetOption = resolverOption;
                      this._logStep('Diagnosis dropdown: canonical resolver overrode legacy pick', {
                        legacyLabel: String(best?.label || '').slice(0, 80),
                        canonicalLabel: String(canonicalAccepted.selected_text || '').slice(0, 80),
                        canonicalScore: canonicalAccepted.match_score || 0,
                      });
                    }
                  }
                } else if (canonicalFallback === 'keyword') {
                  // Explicit opt-in: trust the legacy scorer when canonical refused.
                  if (prefixCompatible || bodyCompatible) {
                    targetOption = best;
                    this._logStep(
                      'Diagnosis dropdown: canonical refused; using legacy keyword pick',
                      {
                        bestLabel: String(best?.label || '').slice(0, 80),
                        bestScore,
                      }
                    );
                  }
                } else {
                  // Default: refuse rather than risk a wrong canonical write.
                  this._logStep('Diagnosis dropdown: canonical resolver refused, no fallback', {
                    blockedReason: canonical?.blocked_reason || 'unknown',
                    canonicalScore: canonical?.match_score || 0,
                    minScoreRequired: canonicalMin,
                    legacyBestLabel: String(best?.label || '').slice(0, 80),
                    legacyBestScore: bestScore,
                  });
                }
              } else if (canonicalAccepted) {
                // Legacy scorer found nothing above threshold but canonical did.
                const resolverOption = options.find(o => {
                  const labelDescOnly = String(o?.label || '')
                    .replace(/\b[A-Z]\d{2,3}(?:\.[0-9A-Z]+)?\b\s*[-:]?\s*/, '')
                    .replace(/\s+/g, ' ')
                    .trim()
                    .toLowerCase();
                  return (
                    labelDescOnly ===
                    String(canonicalAccepted.selected_text || '')
                      .trim()
                      .toLowerCase()
                  );
                });
                if (resolverOption) {
                  targetOption = resolverOption;
                  this._logStep(
                    'Diagnosis dropdown: canonical-only pick (legacy below threshold)',
                    {
                      canonicalLabel: String(canonicalAccepted.selected_text || '').slice(0, 80),
                      canonicalScore: canonicalAccepted.match_score || 0,
                    }
                  );
                }
              }
              if (!targetOption && keywords.length === 0 && desc) {
                this._logStep(
                  'Diagnosis scoring had no keyword hits; relying on phrase/code weights',
                  {
                    desc: desc.slice(0, 120),
                    bestScore,
                  }
                );
              }
            }

            // 1.5) If description scoring didn't produce a match, perform a code-only closest match.
            if (!targetOption && requestedCodePlain) {
              let best = null;
              let bestScore = 0;
              for (const o of options) {
                const optionCode = extractCode(`${o?.label || ''} ${o?.value || ''}`);
                const optionCodePlain = optionCode.replace(/\./g, '');
                if (!optionCodePlain) continue;
                let score = 0;
                if (optionCodePlain === requestedCodePlain) score = 1000;
                else if (optionCodePlain.startsWith(requestedCodePlain)) score = 900;
                else if (requestedCodePlain.startsWith(optionCodePlain)) score = 700;
                else if (
                  requestedCodePlain.slice(0, 3) &&
                  optionCodePlain.startsWith(requestedCodePlain.slice(0, 3))
                )
                  score = 200;
                if (score > bestScore) {
                  bestScore = score;
                  best = o;
                }
              }
              if (best && bestScore >= 700) {
                targetOption = best;
                this._logStep('Diagnosis selected by code-prefix match', {
                  requestedCode,
                  selected: String(best.label || '').slice(0, 80),
                  score: bestScore,
                });
              }
            }

            // 2) If still no match, try code patterns (fallback).
            if (!targetOption && searchPatterns.length) {
              for (const pattern of searchPatterns) {
                targetOption = options.find(o =>
                  pattern.test((o.label || '') + ' ' + (o.value || ''))
                );
                if (targetOption) break;
              }
            }

            if (targetOption) {
              const candidateLabel = String(targetOption?.label || '');
              const candidateValue = String(targetOption?.value || '');
              const candidateCode = extractCode(`${candidateLabel} ${candidateValue}`);
              const candidateCodePlain = candidateCode.replace(/\./g, '');
              const requestedPrefix = requestedCodePlain ? requestedCodePlain.slice(0, 3) : '';
              const candidatePrefix = candidateCodePlain ? candidateCodePlain.slice(0, 3) : '';
              const candidatePrefixMismatch =
                !!requestedCodePlain &&
                !!candidateCodePlain &&
                ((requestedPrefix && !candidateCodePlain.startsWith(requestedPrefix)) ||
                  (candidatePrefix && !requestedCodePlain.startsWith(candidatePrefix)));
              if (candidatePrefixMismatch && bodyPartToken) {
                const candidateHasBody = candidateLabel.toLowerCase().includes(bodyPartToken);
                if (!candidateHasBody) {
                  this._logStep('Rejected dropdown selection (code/body mismatch)', {
                    requestedCode,
                    requestedBodyPart: bodyPartToken,
                    selectedLabel: candidateLabel.slice(0, 80),
                    selectedCode: candidateCode,
                  });
                  targetOption = null;
                }
              }
            }

            if (targetOption) {
              await select.selectOption({ value: targetOption.value });
              this._logStep('Diagnosis selected', {
                value: targetOption.value,
                label: targetOption.label,
              });
              const resolution = await this.getDiagnosisResolutionState({ waitMs: 300 });
              this.lastDiagnosisSelection = {
                ok: !!resolution?.resolved,
                method: 'dropdown',
                searchTerm,
                selected: { value: targetOption.value, label: targetOption.label },
                reason: resolution?.resolved ? null : 'diagnosis_mapping_failed',
                resolution,
                checkedAt: new Date().toISOString(),
              };
              return !!resolution?.resolved;
            }
          }
        } catch (e) {
          continue;
        }
      }

      if (lastOptionsSample && lastOptionsSample.length) {
        this._logStep('Diagnosis dropdown options sample (no match)', {
          sample: lastOptionsSample.map(o => ({
            label: String(o.label || '').slice(0, 60),
            value: String(o.value || '').slice(0, 60),
          })),
        });
      }

      // Try JavaScript fallback
      const selected = await this.page.evaluate(termSrc => {
        const escapeRegExp = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
        const resolution = await this.getDiagnosisResolutionState({ waitMs: 300 });
        this.lastDiagnosisSelection = {
          ok: !!resolution?.resolved,
          method: 'dropdown_js',
          searchTerm,
          selected,
          reason: resolution?.resolved ? null : 'diagnosis_mapping_failed',
          resolution,
          checkedAt: new Date().toISOString(),
        };
        return !!resolution?.resolved;
      }

      logger.warn('Diagnosis not found matching:', searchTerm);
      this.lastDiagnosisSelection = {
        ok: false,
        method: 'dropdown',
        searchTerm,
        reason: 'no_dropdown_match',
        optionsSample: lastOptionsSample || [],
        checkedAt: new Date().toISOString(),
      };
      return false;
    } catch (error) {
      logger.error('Failed to select diagnosis:', error);
      this.lastDiagnosisSelection = {
        ok: false,
        method: 'dropdown',
        searchTerm,
        reason: `error:${error?.message || 'unknown'}`,
        checkedAt: new Date().toISOString(),
      };
      return false;
    }
  }
}
