import { logger } from '../utils/logger.js';
import { PORTALS } from '../config/portals.js';
import { resolveDiagnosisAgainstPortalOptions } from './clinic-assist.js';

export class AllianceMedinetAutomation {
  constructor(page) {
    this.page = page;
    this.config = PORTALS.ALLIANCE_MEDINET;
    this.loggedIn = false;
    this.lastAction = 'init';
    this.lastGePopupPage = null;
    this.lastGePopupUrl = null;
    this.lastDiagnosisPortalMatch = null;
  }

  _setLastAction(action) {
    this.lastAction = String(action || '').trim() || this.lastAction;
  }

  _normalizeNric(value) {
    const raw = String(value || '')
      .trim()
      .toUpperCase();
    if (!raw) return '';
    const match = raw.match(/[STFGM]\d{7}[A-Z]/);
    if (match) return match[0];
    return raw.replace(/[\s\/\-]+/g, '');
  }

  _formatVisitDateForSearch(value) {
    const raw = String(value || '').trim();
    if (!raw) return null;
    const ddmmyyyy = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (ddmmyyyy) return `${Number(ddmmyyyy[1])}/${Number(ddmmyyyy[2])}/${ddmmyyyy[3]}`;
    const yyyymmdd = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (yyyymmdd) return `${Number(yyyymmdd[3])}/${Number(yyyymmdd[2])}/${yyyymmdd[1]}`;
    return raw;
  }

  async _clickFirstVisible(selectors, label) {
    for (const selector of selectors) {
      const el = this.page.locator(selector).first();
      const count = await el.count().catch(() => 0);
      if (!count) continue;
      const visible = await el.isVisible().catch(() => false);
      if (!visible) continue;
      await el.click({ timeout: 5000 }).catch(async () => {
        await el.click({ timeout: 5000, force: true });
      });
      logger.info(`[ALLIANCE] Clicked ${label}`, { selector });
      return true;
    }
    return false;
  }

  async _fillFirstVisible(selectors, value, label) {
    for (const selector of selectors) {
      const el = this.page.locator(selector).first();
      const count = await el.count().catch(() => 0);
      if (!count) continue;
      const visible = await el.isVisible().catch(() => false);
      if (!visible) continue;
      await el.click({ timeout: 3000 }).catch(() => {});
      await el.fill(String(value ?? ''), { timeout: 5000 });
      logger.info(`[ALLIANCE] Filled ${label}`, { selector });
      return true;
    }
    return false;
  }

  async _setInputValueIfEmpty(selectors, value) {
    if (!value) return false;
    for (const selector of selectors) {
      const el = this.page.locator(selector).first();
      const count = await el.count().catch(() => 0);
      if (!count) continue;
      const visible = await el.isVisible().catch(() => false);
      if (!visible) continue;
      const current = await el.inputValue().catch(() => '');
      if (String(current || '').trim()) return false;
      await el.fill(String(value), { timeout: 5000 });
      return true;
    }
    return false;
  }

  async _setInputValue(selectors, value, label = 'field') {
    if (value === null || value === undefined || value === '') return false;
    for (const selector of selectors) {
      const el = this.page.locator(selector).first();
      const count = await el.count().catch(() => 0);
      if (!count) continue;
      const visible = await el.isVisible().catch(() => false);
      if (!visible) continue;
      await el.click({ timeout: 3000 }).catch(() => {});
      await el.fill(String(value), { timeout: 5000 });
      await el.dispatchEvent('input').catch(() => {});
      await el.dispatchEvent('change').catch(() => {});
      logger.info(`[ALLIANCE] Set ${label}`, { selector });
      return true;
    }
    return false;
  }

  async _extractTraceId() {
    const bodyText = await this.page.locator('body').innerText().catch(() => '');
    const match = String(bodyText || '').match(/Trace\s*Id\s*:\s*([a-z0-9-]{8,})/i);
    return match ? match[1] : null;
  }

  async _hasUnexpectedPortalError() {
    const count = await this.page
      .locator('text=/unexpected\\s+error\\s+occurred|provide\\s+the\\s+trace\\s+id|trace\\s*id/i')
      .count()
      .catch(() => 0);
    return count > 0;
  }

  _buildAllianceError(code, message, extra = {}) {
    const err = new Error(message);
    err.allianceError = {
      code,
      lastAction: this.lastAction || null,
      ...extra,
    };
    return err;
  }

  _normalizeText(value) {
    return String(value || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  _normalizeDoctorNameForMatch(value) {
    const text = this._normalizeText(value);
    return text.replace(/\b(kee|yee)\b/g, 'yuee');
  }

  _resolveConsultationFeeType(chargeTypeRaw) {
    const type = this._normalizeText(chargeTypeRaw);
    if (type.includes('first') || type.includes('new')) return 'First Consultation';
    if (type.includes('no consultation') || type === 'none') return 'No Consultation';
    return 'Follow Up';
  }

  async _dismissUnsavedChangesDialog(preferLeave = true) {
    const dialog = this.page.locator('[role="dialog"]:has-text("Unsaved changes")').first();
    const isVisible = await dialog.isVisible().catch(() => false);
    if (!isVisible) return false;
    const preferred = preferLeave ? 'Leave' : 'Stay';
    const clicked = await this._clickFirstVisible(
      [
        `[role="dialog"] button:has-text("${preferred}")`,
        '[role="dialog"] button:has-text("Leave")',
        '[role="dialog"] button:has-text("Stay")',
      ],
      `Unsaved changes (${preferred})`
    );
    if (clicked) {
      await this.page.waitForTimeout(400);
    }
    return clicked;
  }

  async _closeDatePickerOverlay() {
    // Angular datepicker overlay can block Search Others clicks.
    const backdrop = this.page.locator('.cdk-overlay-backdrop.cdk-overlay-backdrop-showing').first();
    const hasBackdrop = (await backdrop.count().catch(() => 0)) > 0;
    if (!hasBackdrop) return false;
    await this.page.keyboard.press('Escape').catch(() => {});
    await this.page.waitForTimeout(100).catch(() => {});
    const stillOpen = await backdrop.isVisible().catch(() => false);
    if (stillOpen) {
      await this.page.mouse.click(20, 20).catch(() => {});
      await this.page.waitForTimeout(100).catch(() => {});
    }
    return true;
  }

  async _hasAnyFilledPasswordField() {
    const selectors = [
      'input[name*="pass" i]',
      'input[id*="pass" i]',
      'input[placeholder*="pass" i]',
      'input[type="password"]',
      'input[type="text"][placeholder*="pass" i]',
    ];
    const locator = this.page.locator(selectors.join(', '));
    const count = await locator.count().catch(() => 0);
    if (!count) return false;
    for (let i = 0; i < count; i++) {
      const field = locator.nth(i);
      const visible = await field.isVisible().catch(() => false);
      if (!visible) continue;
      const value = await field.inputValue().catch(() => '');
      if (String(value || '').trim()) return true;
    }
    return false;
  }

  _getSearchMemberDialog() {
    return this.page
      .locator(
        [
          '[role="dialog"]:has-text("Search Member")',
          'mat-dialog-container:has-text("Search Member")',
          '.cdk-overlay-pane:has-text("Search Member")',
        ].join(', ')
      )
      .first();
  }

  async _getSearchRecordCount(dialogScope) {
    const text = await dialogScope.innerText().catch(() => '');
    const match = String(text || '').match(/Showing\s+(\d+)\s*-\s*(\d+)\s*of\s*(\d+)\s*records/i);
    if (!match) return null;
    const total = Number(match[3]);
    return Number.isFinite(total) ? total : null;
  }

  async _findSelectableMemberRowCheckbox(dialogScope) {
    const rows = dialogScope.locator('.mat-mdc-row, .mat-row, .cdk-row, tbody tr');
    const totalRows = await rows.count().catch(() => 0);
    for (let i = 0; i < totalRows; i++) {
      const row = rows.nth(i);
      const rowText = String((await row.innerText().catch(() => '')) || '')
        .replace(/\s+/g, ' ')
        .trim();
      if (!rowText) continue;
      if (/member\s+name\s+member\s+uin\s+member\s+type/i.test(rowText)) continue;

      const rowCheckbox = row.locator('input[type="checkbox"]:not([disabled])').first();
      const count = await rowCheckbox.count().catch(() => 0);
      if (!count) continue;
      const visible = await rowCheckbox.isVisible().catch(() => false);
      if (!visible) continue;
      return rowCheckbox;
    }
    return null;
  }

  async _clickSidebarLink(label) {
    const escaped = String(label || '').replace(/"/g, '\\"');
    const selectors = [
      `div.sidebar a.nav-link:has-text("${escaped}")`,
      `div.sidebar [role="button"]:has-text("${escaped}")`,
      `div.sidebar button:has-text("${escaped}")`,
      `div.sidebar p:has-text("${escaped}")`,
      `div.sidebar li:has-text("${escaped}")`,
      `div.sidebar div:has-text("${escaped}")`,
      `a.nav-link:has-text("${escaped}")`,
    ];
    for (const selector of selectors) {
      const el = this.page.locator(selector).first();
      const count = await el.count().catch(() => 0);
      if (!count) continue;
      const visible = await el.isVisible().catch(() => false);
      if (!visible) continue;
      await el.click({ timeout: 5000 }).catch(async () => {
        await el.click({ timeout: 5000, force: true });
      });
      logger.info(`[ALLIANCE] Clicked sidebar ${label}`, { selector });
      return true;
    }
    return false;
  }

  async _isCreatePanelClaimVisible() {
    const selectors = [
      'div.sidebar:has-text("Create Panel Claim")',
      'div.sidebar li:has-text("Create Panel Claim")',
      'div.sidebar a:has-text("Create Panel Claim")',
      'div.sidebar [role="button"]:has-text("Create Panel Claim")',
      'div.sidebar div:has-text("Create Panel Claim")',
      'div.sidebar p:has-text("Create Panel Claim")',
    ];
    for (const selector of selectors) {
      const locator = this.page.locator(selector).first();
      const count = await locator.count().catch(() => 0);
      if (!count) continue;
      const visible = await locator.isVisible().catch(() => false);
      if (visible) return true;
    }
    return false;
  }

  async _ensurePanelServicesExpanded() {
    if (await this._isCreatePanelClaimVisible()) return true;
    this._setLastAction('nav.expand-panel-services');
    const clicked = await this._clickFirstVisible(
      [
        'div.sidebar [role="button"]:has-text("Panel Services")',
        'div.sidebar [role="button"]:has-text("Panel Service")',
        'div.sidebar p:has-text("Panel Services")',
        'div.sidebar p:has-text("Panel Service")',
        'div.sidebar li:has-text("Panel Services")',
        'div.sidebar li:has-text("Panel Service")',
        'div.sidebar div:has-text("Panel Services")',
        'div.sidebar div:has-text("Panel Service")',
      ],
      'Panel Services'
    );
    if (!clicked) return false;
    await this.page.waitForTimeout(500);
    return this._isCreatePanelClaimVisible();
  }

  async _navigateToCreatePanelClaimDirect() {
    const currentUrl = this.page.url() || this.config?.url || '';
    let target = null;
    try {
      const origin = new URL(currentUrl).origin;
      target = `${origin}/claim/panel-create`;
    } catch {
      try {
        const origin = new URL(String(this.config?.url || '')).origin;
        target = `${origin}/claim/panel-create`;
      } catch {
        target = 'https://connect.alliancemedinet.com/claim/panel-create';
      }
    }
    this._setLastAction('nav.create-panel-claim.direct');
    await this.page.goto(target, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await this.page.waitForTimeout(600);
    logger.info('[ALLIANCE] Navigated directly to Create Panel Claim', { target });
  }

  async _isCreatePanelClaimPageVisible() {
    const url = String(this.page.url() || '');
    if (/\/claim\/panel-create/i.test(url)) return true;
    const hasHeading = await this.page
      .locator('h1:has-text("Create Panel Claim"), text=/Create\\s+Panel\\s+Claim/i')
      .first()
      .isVisible()
      .catch(() => false);
    if (hasHeading) return true;
    const hasMemberDetails = await this.page
      .locator('text=/Member\\s+Details/i')
      .first()
      .isVisible()
      .catch(() => false);
    const hasMedicalTreatmentButton = await this.page
      .locator('button:has-text("Medical Treatment"), [role="tab"]:has-text("Medical Treatment")')
      .first()
      .isVisible()
      .catch(() => false);
    return hasMemberDetails && hasMedicalTreatmentButton;
  }

  async _hasCreatePanelDataError() {
    return this.page
      .locator('text=/Unable\\s+to\\s+retrieve\\s+data/i')
      .first()
      .isVisible()
      .catch(() => false);
  }

  async _isMedicalTreatmentControlVisible() {
    const selectors = [
      'div.main-panel button.action-btn:has-text("Medical Treatment")',
      'button.action-btn:has-text("Medical Treatment")',
      'div.action-btn:has-text("Medical Treatment")',
      'button:has-text("Medical Treatment")',
      '[role="tab"]:has-text("Medical Treatment")',
      '[role="button"]:has-text("Medical Treatment")',
      'a:has-text("Medical Treatment")',
      '.main-panel *:has-text("Medical Treatment")',
    ];
    for (const selector of selectors) {
      const el = this.page.locator(selector).first();
      const count = await el.count().catch(() => 0);
      if (!count) continue;
      const visible = await el.isVisible().catch(() => false);
      if (visible) return true;
    }
    return false;
  }

  async _openMedicalTreatmentAndWaitSearchMemberDialog() {
    const dialog = this._getSearchMemberDialog();
    if (await dialog.isVisible().catch(() => false)) return true;
    const clicked = await this._clickFirstVisible(
      [
        'div.main-panel button.action-btn:has-text("Medical Treatment")',
        'button.action-btn:has-text("Medical Treatment")',
        'div.action-btn:has-text("Medical Treatment")',
        'button:has-text("Medical Treatment")',
        '[role="tab"]:has-text("Medical Treatment")',
        '[role="button"]:has-text("Medical Treatment")',
        'a:has-text("Medical Treatment")',
        '.main-panel *:has-text("Medical Treatment")',
      ],
      'Medical Treatment'
    );
    if (!clicked) return false;

    for (let i = 0; i < 25; i++) {
      if (await dialog.isVisible().catch(() => false)) return true;
      await this.page.waitForTimeout(200);
    }
    return false;
  }

  async login() {
    try {
      this._setLastAction('login.open');
      const username = String(this.config?.username || '').trim();
      const password = String(this.config?.password || '').trim();
      if (!username || !password) {
        throw new Error('ALLIANCE_MEDINET_USERNAME / ALLIANCE_MEDINET_PASSWORD must be set');
      }

      await this.page.goto(this.config.url, {
        waitUntil: 'domcontentloaded',
        timeout: this.config.timeout || 30000,
      });
      await this.page.waitForTimeout(1000);

      const hasPanelServiceBeforeLogin =
        (await this.page
          .locator('text=/Panel\\s*Service/i')
          .count()
          .catch(() => 0)) > 0;
      const hasCreatePanelClaimBeforeLogin = await this._isCreatePanelClaimPageVisible().catch(() => false);
      const hasLoginInputBeforeLogin =
        (await this.page
          .locator('input[placeholder*="login id" i], input[name*="user" i], input[id*="user" i]')
          .count()
          .catch(() => 0)) > 0;
      if ((hasPanelServiceBeforeLogin || hasCreatePanelClaimBeforeLogin) && !hasLoginInputBeforeLogin) {
        this._setLastAction('login.already-authenticated');
        this.loggedIn = true;
        logger.info('[ALLIANCE] Already logged in (active session detected)');
        return;
      }

      const usernameFilled = await this._fillFirstVisible(
        [
          'input[name*="user" i]',
          'input[id*="user" i]',
          'input[placeholder*="login id" i]',
          'input[placeholder*="login" i]',
          'input[placeholder*="user" i]',
          'input:not([type])',
          'input[type="text"]',
        ],
        username,
        'username'
      );
      const passwordFilled = await this._fillFirstVisible(
        [
          'input[name*="pass" i]',
          'input[id*="pass" i]',
          'input[placeholder*="pass" i]',
          'input[type="password"]',
          'input[type="text"][placeholder*="pass" i]',
        ],
        password,
        'password'
      );
      if (!usernameFilled || !passwordFilled) {
        // Session can already be authenticated on a non-login page where no login fields exist.
        const hasPanelServiceWithoutInputs =
          (await this.page
            .locator('text=/Panel\\s*Service/i')
            .count()
            .catch(() => 0)) > 0;
        const hasCreatePanelClaimWithoutInputs = await this._isCreatePanelClaimPageVisible().catch(() => false);
        if (hasPanelServiceWithoutInputs || hasCreatePanelClaimWithoutInputs) {
          this._setLastAction('login.already-authenticated-no-inputs');
          this.loggedIn = true;
          logger.info('[ALLIANCE] Active session detected without login inputs');
          return;
        }
        throw new Error('Could not locate Alliance Medinet login fields');
      }

      // Rarely the password field is wiped by client-side validation/render timing.
      const hasPasswordValue = await this._hasAnyFilledPasswordField();
      if (!hasPasswordValue) {
        this._setLastAction('login.password-refill');
        await this._fillFirstVisible(
          [
            'input[name*="pass" i]',
            'input[id*="pass" i]',
            'input[placeholder*="pass" i]',
            'input[type="password"]',
            'input[type="text"][placeholder*="pass" i]',
          ],
          password,
          'password(retry)'
        );
      }

      const clicked = await this._clickFirstVisible(
        [
          'button:has-text("Login")',
          'button[type="submit"]',
          'input[type="submit"]',
          'input[value*="Login" i]',
        ],
        'login'
      );
      if (!clicked) throw new Error('Could not find Login button');
      this._setLastAction('login.submit');

      await this.page.waitForLoadState('domcontentloaded').catch(() => {});
      await this.page.waitForTimeout(2000);

      let stillOnLogin = /\/login/i.test(this.page.url());
      let hasPanelService =
        (await this.page
          .locator('text=/Panel\\s*Service/i')
          .count()
          .catch(() => 0)) > 0;

      // Transient server-side error occasionally appears with trace id; one retry usually succeeds.
      const hasUnexpectedError =
        (await this.page
          .locator('text=/unexpected\\s+error\\s+occurred|trace\\s*id/i')
          .count()
          .catch(() => 0)) > 0;
      if (stillOnLogin && !hasPanelService && hasUnexpectedError) {
        this._setLastAction('login.retry-after-trace-error');
        logger.warn('[ALLIANCE] Login hit transient server error, retrying once');
        await this._fillFirstVisible(
          [
            'input[name*="user" i]',
            'input[id*="user" i]',
            'input[placeholder*="login id" i]',
            'input[placeholder*="login" i]',
            'input[placeholder*="user" i]',
            'input:not([type])',
            'input[type="text"]',
          ],
          username,
          'username(retry)'
        ).catch(() => false);
        await this._fillFirstVisible(
          [
            'input[name*="pass" i]',
            'input[id*="pass" i]',
            'input[placeholder*="pass" i]',
            'input[type="password"]',
            'input[type="text"][placeholder*="pass" i]',
          ],
          password,
          'password(retry)'
        ).catch(() => false);
        await this._clickFirstVisible(
          [
            'button:has-text("Login")',
            'button[type="submit"]',
            'input[type="submit"]',
            'input[value*="Login" i]',
          ],
          'login(retry)'
        ).catch(() => false);
        await this.page.waitForLoadState('domcontentloaded').catch(() => {});
        await this.page.waitForTimeout(2500);
        stillOnLogin = /\/login/i.test(this.page.url());
        hasPanelService =
          (await this.page
            .locator('text=/Panel\\s*Service/i')
            .count()
            .catch(() => 0)) > 0;
      }
      if (stillOnLogin && !hasPanelService) {
        const traceId = await this._extractTraceId();
        const hasTraceError = await this._hasUnexpectedPortalError();
        if (hasTraceError) {
          throw this._buildAllianceError(
            'login_trace_error',
            'Alliance Medinet transient login error (trace-id page)',
            { traceId, url: this.page.url() || null }
          );
        }
        throw new Error('Alliance Medinet login did not complete');
      }

      this._setLastAction('login.success');
      this.loggedIn = true;
      logger.info('[ALLIANCE] Login successful');
    } catch (error) {
      await this.page
        .screenshot({ path: 'screenshots/alliance-medinet-login-error.png', fullPage: true })
        .catch(() => {});
      logger.error('[ALLIANCE] Login failed', { error: error.message });
      throw error;
    }
  }

  async navigateToMedicalTreatmentClaim() {
    try {
      if (!this.loggedIn) await this.login();

      await this._dismissUnsavedChangesDialog(true).catch(() => false);

      this._setLastAction('nav.panel-services');
      const panelReady = await this._ensurePanelServicesExpanded();
      if (!panelReady) {
        await this._dismissUnsavedChangesDialog(true).catch(() => false);
      }
      const panelReadyRetry = panelReady || (await this._ensurePanelServicesExpanded());
      if (!panelReadyRetry) throw new Error('Could not expand Panel Services menu');
      await this.page.waitForTimeout(400);

      this._setLastAction('nav.create-panel-claim');
      const createPanelClaimClicked = await this._clickSidebarLink('Create Panel Claim');
      if (!createPanelClaimClicked) {
        await this._dismissUnsavedChangesDialog(true).catch(() => false);
      }
      const createPanelClaimClickedRetry =
        createPanelClaimClicked || (await this._clickSidebarLink('Create Panel Claim'));
      if (!createPanelClaimClickedRetry) throw new Error('Could not find Create Panel Claim menu');
      await this.page.waitForLoadState('domcontentloaded').catch(() => {});
      await this.page.waitForTimeout(600);
      const onCreatePanelClaim = await this._isCreatePanelClaimPageVisible();
      if (!onCreatePanelClaim) {
        await this._navigateToCreatePanelClaimDirect();
      }

      let openedSearchMemberDialog = false;
      for (let attempt = 1; attempt <= 4; attempt++) {
        const hasDataError = await this._hasCreatePanelDataError();
        const hasMedicalTreatmentControl = await this._isMedicalTreatmentControlVisible();
        if (!hasDataError && hasMedicalTreatmentControl) break;
        this._setLastAction(`nav.create-panel-claim.recover-${attempt}`);
        await this._dismissUnsavedChangesDialog(true).catch(() => false);
        const clicked = await this._clickSidebarLink('Create Panel Claim');
        if (!clicked) {
          await this._navigateToCreatePanelClaimDirect();
        }
        await this.page.waitForLoadState('domcontentloaded').catch(() => {});
        await this.page.waitForTimeout(900);
        if (attempt === 4) {
          // Final fallback: control visibility can lag while click still works.
          openedSearchMemberDialog = await this._openMedicalTreatmentAndWaitSearchMemberDialog();
          if (openedSearchMemberDialog) break;

          const finalHasError = await this._hasCreatePanelDataError();
          if (finalHasError) {
            throw new Error('Create Panel Claim page shows "Unable to retrieve data" and cannot continue');
          }
          throw new Error('Create Panel Claim did not render Medical Treatment controls');
        }
      }

      this._setLastAction('nav.medical-treatment');
      for (let attempt = 1; attempt <= 3 && !openedSearchMemberDialog; attempt++) {
        openedSearchMemberDialog = await this._openMedicalTreatmentAndWaitSearchMemberDialog();
        if (openedSearchMemberDialog) break;
        await this._dismissUnsavedChangesDialog(true).catch(() => false);
        await this._navigateToCreatePanelClaimDirect();
        await this.page.waitForLoadState('domcontentloaded').catch(() => {});
        await this.page.waitForTimeout(500);
      }
      if (!openedSearchMemberDialog) {
        throw new Error(`Could not open Search Member after Medical Treatment click (url=${this.page.url()})`);
      }

      await this.page.waitForTimeout(1500);
      this._setLastAction('nav.medical-treatment.ready');
      logger.info('[ALLIANCE] Navigated to Medical Treatment claim flow');
    } catch (error) {
      await this.page
        .screenshot({ path: 'screenshots/alliance-medinet-nav-error.png', fullPage: true })
        .catch(() => {});
      throw error;
    }
  }

  async searchMemberByNric(nric, visitDate = null) {
    try {
      this._setLastAction('search.prepare');
      const normalizedNric = this._normalizeNric(nric);
      if (!normalizedNric) {
        throw new Error(`Invalid NRIC/Member ID for Alliance Medinet search: "${nric}"`);
      }

      const nricFilled = await this._fillFirstVisible(
        [
          'input[name*="member" i]',
          'input[id*="member" i]',
          'input[placeholder*="Membership" i]',
          'input[placeholder*="Member UIN" i]',
          'input[aria-label*="Member UIN" i]',
        ],
        normalizedNric,
        'Member UIN/Membership ID'
      );
      if (!nricFilled) {
        throw new Error('Could not locate Member UIN/Membership ID field');
      }

      // Ensure claim type is explicitly SP (Panel) before searching.
      await this._clickFirstVisible(
        [
          '[role="dialog"] [role="combobox"][aria-label*="Claim Type" i]',
          '[role="dialog"] mat-select[formcontrolname*="claim" i]',
          '[role="dialog"] div:has-text("Claim Type"):has([role="combobox"])',
        ],
        'Claim Type'
      ).catch(() => false);
      const spPanelOption = this.page
        .locator('[role="option"], mat-option, .mat-mdc-option')
        .filter({ hasText: /SP\s*\(Panel\)/i })
        .first();
      if ((await spPanelOption.count().catch(() => 0)) > 0) {
        await spPanelOption.click({ timeout: 5000 }).catch(async () => {
          await spPanelOption.click({ timeout: 5000, force: true });
        });
      } else {
        await this.page.keyboard.press('Escape').catch(() => {});
      }

      const runSearchAttempt = async ({ visitDateValue = null, attemptLabel = 'with-date' } = {}) => {
        if (visitDateValue) {
          await this._setInputValue(
            [
              'input[name*="visit" i]',
              'input[id*="visit" i]',
              'input[placeholder*="Date of Visit" i]',
              'input[aria-label*="Date of Visit" i]',
            ],
            visitDateValue,
            `Date of Visit (${attemptLabel})`
          );
        } else {
          await this._fillFirstVisible(
            [
              'input[name*="visit" i]',
              'input[id*="visit" i]',
              'input[placeholder*="Date of Visit" i]',
              'input[aria-label*="Date of Visit" i]',
            ],
            '',
            `Date of Visit clear (${attemptLabel})`
          ).catch(() => false);
        }

        // Ensure date picker popup is closed before clicking search.
        await this._closeDatePickerOverlay().catch(() => false);

        const dialog = this._getSearchMemberDialog();
        await dialog.waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});

        const searchTimeoutMs = Number(process.env.ALLIANCE_SEARCH_TIMEOUT_MS || 120000);
        const pollMs = 500;
        const maxPolls = Math.max(1, Math.ceil(searchTimeoutMs / pollMs));

        const pollResults = async searchKind => {
          let rowCount = 0;
          let noResult = false;
          for (let i = 0; i < maxPolls; i++) {
            const url = this.page.url() || '';
            const traceError = await this._hasUnexpectedPortalError();
            if (/\/login/i.test(url) && traceError) {
              const traceId = await this._extractTraceId();
              throw this._buildAllianceError(
                'search_trace_error',
                `Alliance Medinet transient error occurred after ${searchKind}`,
                { traceId, url, elapsedMs: i * pollMs }
              );
            }

            const records = await this._getSearchRecordCount(dialog);
            if (typeof records === 'number') {
              rowCount = records;
              noResult = records <= 0;
              break;
            }

            const maskedUinCount = await dialog
              .locator('text=/[STFGM]\\*{3,}\\d{3}[A-Z]/i')
              .count()
              .catch(() => 0);
            if (maskedUinCount > 0) {
              rowCount = maskedUinCount;
              noResult = false;
              break;
            }

            const selectableRowCheckbox = await this._findSelectableMemberRowCheckbox(dialog);
            if (selectableRowCheckbox) {
              rowCount = 1;
              noResult = false;
              break;
            }

            const noResultText = await dialog
              .locator('text=/no\\s*records|0\\s*-\\s*0\\s*of\\s*0\\s*records|member\\s+not\\s+found/i')
              .count()
              .catch(() => 0);
            if (noResultText > 0) {
              rowCount = 0;
              noResult = true;
              break;
            }

            const noCoverageText = await dialog
              .locator('text=/member\\s+has\\s+no\\s+coverage\\s+on\\s+this\\s+visit\\s+date/i')
              .count()
              .catch(() => 0);
            if (noCoverageText > 0) {
              return {
                found: false,
                rowCount: 0,
                memberNotFound: true,
                noCoverageOnVisitDate: true,
                searchKind,
              };
            }

            const requiredDateText = await dialog
              .locator('text=/Date\\s+of\\s+Visit\\s+is\\s+a\\s+required\\s+field/i')
              .count()
              .catch(() => 0);
            if (requiredDateText > 0) {
              rowCount = 0;
              noResult = true;
              break;
            }

            if (i > 0 && i % 20 === 0) {
              logger.info('[ALLIANCE] Waiting for search result table to load', {
                elapsedMs: i * pollMs,
                attempt: attemptLabel,
                searchKind,
              });
            }
            await this.page.waitForTimeout(pollMs).catch(error => {
              throw this._buildAllianceError(
                'search_wait_interrupted',
                error?.message || 'Search wait interrupted unexpectedly',
                { url: this.page.url() || null, elapsedMs: i * pollMs, searchKind }
              );
            });
          }

          return {
            found: rowCount > 0 && !noResult,
            rowCount,
            memberNotFound: rowCount === 0 || noResult,
            noCoverageOnVisitDate: false,
            searchKind,
          };
        };

        let lastResult = {
          found: false,
          rowCount: 0,
          memberNotFound: true,
          noCoverageOnVisitDate: false,
          searchKind: null,
        };
        const searchButtons = [
          {
            kind: 'search_others',
            selectors: [
              'button:has-text("Search Others")',
              'input[value*="Search Others" i]',
              'a:has-text("Search Others")',
            ],
            label: `Search Others (${attemptLabel})`,
          },
          {
            kind: 'search_aia_member',
            selectors: [
              'button:has-text("Search AIA Member")',
              'input[value*="Search AIA Member" i]',
              'a:has-text("Search AIA Member")',
            ],
            label: `Search AIA Member (${attemptLabel})`,
          },
        ];

        for (const searchButton of searchButtons) {
          const clicked = await this._clickFirstVisible(searchButton.selectors, searchButton.label);
          if (!clicked) continue;
          this._setLastAction(`search.clicked-${searchButton.kind}.${attemptLabel}`);
          const result = await pollResults(searchButton.kind);
          lastResult = result;
          if (result.found) return result;
        }

        if (!lastResult.searchKind) {
          throw new Error('Could not find Search Others / Search AIA Member button');
        }
        return lastResult;
      };

      const formattedVisitDate = this._formatVisitDateForSearch(visitDate);
      const candidateDates = [];
      if (formattedVisitDate) {
        candidateDates.push(formattedVisitDate);
        const match = formattedVisitDate.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
        if (match) {
          const day = Number(match[1]);
          const month = Number(match[2]);
          const year = Number(match[3]);
          const baseDate = new Date(Date.UTC(year, month - 1, day));
          if (!Number.isNaN(baseDate.getTime())) {
            const shift = delta => {
              const d = new Date(baseDate);
              d.setUTCDate(d.getUTCDate() + delta);
              return `${d.getUTCDate()}/${d.getUTCMonth() + 1}/${d.getUTCFullYear()}`;
            };
            candidateDates.push(shift(-1));
            candidateDates.push(shift(1));
          }
        }
      }
      if (process.env.ALLIANCE_ALLOW_EMPTY_VISIT_DATE_SEARCH === '1') {
        candidateDates.push(null);
      }

      const deduped = [];
      for (const cand of candidateDates) {
        if (!deduped.includes(cand)) deduped.push(cand);
      }

      let fallback = { found: false, rowCount: 0, memberNotFound: true, noCoverageOnVisitDate: false };
      for (let i = 0; i < deduped.length; i++) {
        const candidate = deduped[i];
        if (i > 0) {
          logger.info('[ALLIANCE] Retrying search with alternate date candidate', {
            nric: normalizedNric,
            candidateVisitDate: candidate,
            attemptIndex: i + 1,
            totalAttempts: deduped.length,
          });
        }
        const attemptResult = await runSearchAttempt({
          visitDateValue: candidate,
          attemptLabel: candidate ? `candidate-${candidate}` : 'fallback-no-date',
        });
        fallback = attemptResult;
        if (attemptResult.found) {
          this._setLastAction('search.completed');
          return attemptResult;
        }
      }

      this._setLastAction('search.completed');
      return fallback;
    } catch (error) {
      await this.page
        .screenshot({ path: 'screenshots/alliance-medinet-search-error.png', fullPage: true })
        .catch(() => {});
      throw error;
    }
  }

  async selectMemberAndAdd() {
    let onConsole = null;
    try {
      this._setLastAction('select-member.start');
      const dialog = this._getSearchMemberDialog();
      await dialog.waitFor({ state: 'visible', timeout: 10000 }).catch(() => {});
      const runtimeErrors = [];
      onConsole = msg => {
        const type = msg.type();
        if (type !== 'error') return;
        runtimeErrors.push(msg.text());
      };
      this.page.on('console', onConsole);

      const isClaimFormReady = async () => {
        const readySelectors = [
          'text=/Claim\\s+Information/i',
          'text=/Visit\\s+Details/i',
          'button:has-text("Add Diagnosis")',
          'text=/Consultation\\s+Fee/i',
          'input[placeholder*="MC Days" i]',
          'input[placeholder*="Consultation Fee" i]',
        ];
        for (const selector of readySelectors) {
          const loc = this.page.locator(selector).first();
          const visible = await loc.isVisible().catch(() => false);
          if (visible) return true;
        }
        return false;
      };

      const addButton = dialog
        .locator('button:has-text("Add"), input[value="Add"], a:has-text("Add")')
        .first();
      const addCount = await addButton.count().catch(() => 0);
      if (!addCount) throw new Error('Could not find Add button after selecting member');

      const hasEnabledAdd = async () => {
        const visible = await addButton.isVisible().catch(() => false);
        if (!visible) return false;
        return addButton.isEnabled().catch(() => false);
      };

      let rowCheckbox = null;
      for (let i = 0; i < 60 && !rowCheckbox; i++) {
        rowCheckbox = await this._findSelectableMemberRowCheckbox(dialog);
        if (rowCheckbox) break;
        await this.page.waitForTimeout(500);
      }
      if (!rowCheckbox) throw new Error('No selectable member row checkbox found');

      const row = rowCheckbox
        .locator(
          'xpath=ancestor::*[contains(@class,"mat-mdc-row") or contains(@class,"mat-row") or contains(@class,"cdk-row") or @role="row"][1]'
        )
        .first();
      const rowCells = await row
        .locator('[role="cell"], td')
        .allTextContents()
        .catch(() => []);
      const networkCode = String(rowCells[rowCells.length - 1] || '')
        .replace(/\s+/g, ' ')
        .trim()
        .toUpperCase();

      const clickTargets = [
        rowCheckbox,
        rowCheckbox
          .locator(
            'xpath=ancestor::*[contains(@class,"mdc-checkbox")][1]//*[contains(@class,"mat-mdc-checkbox-touch-target")]'
          )
          .first(),
        rowCheckbox
          .locator('xpath=ancestor::*[contains(@class,"mdc-checkbox")][1]//*[contains(@class,"mdc-checkbox__ripple")]')
          .first(),
        row.locator('[role="cell"], td').first(),
      ];
      let selected = false;
      for (let attempt = 1; attempt <= 5; attempt++) {
        await row.scrollIntoViewIfNeeded().catch(() => {});
        for (const target of clickTargets) {
          const count = await target.count().catch(() => 0);
          if (!count) continue;
          await target.click({ timeout: 4000 }).catch(async () => {
            await target.click({ timeout: 4000, force: true });
          });
          await this.page.waitForTimeout(250);
          if (await hasEnabledAdd()) {
            selected = true;
            break;
          }
        }
        if (!selected) {
          await row.click({ timeout: 4000, force: true }).catch(() => {});
          await this.page.waitForTimeout(250);
          selected = await hasEnabledAdd();
        }
        if (selected) break;
      }
      this._setLastAction('select-member.checked-row');

      if (!(await hasEnabledAdd())) {
        throw new Error('Member row could not be selected (Add button remained disabled)');
      }

      const popupPromise = this.page.context().waitForEvent('page', { timeout: 6000 }).catch(() => null);
      await addButton.click({ timeout: 8000 }).catch(async () => {
        await addButton.click({ timeout: 8000, force: true });
      });
      this._setLastAction('select-member.clicked-add');
      const popupPage = await popupPromise;
      if (popupPage) {
        await popupPage.waitForLoadState('domcontentloaded').catch(() => {});
        const popupUrl = popupPage.url() || null;
        const isGePopup = /greateasternlife\.com/i.test(String(popupUrl || ''));
        if (isGePopup) {
          this.lastGePopupPage = popupPage;
          this.lastGePopupUrl = popupUrl;
          this.page.off('console', onConsole);
          throw this._buildAllianceError(
            'ge_popup_redirect',
            'Alliance Medinet redirected this member to GE portal popup',
            {
              networkCode: networkCode || null,
              gePopupUrl: popupUrl,
              suggestedPortal: 'GE_NTUC',
            }
          );
        }
      }

      let formOpened = false;
      for (let i = 0; i < 40; i++) {
        if (await isClaimFormReady()) {
          formOpened = true;
          break;
        }
        await this.page.waitForTimeout(400);
      }
      this.page.off('console', onConsole);
      if (!formOpened) {
        const portalRuntimeError = runtimeErrors.find(text =>
          /cannot\s+read\s+properties\s+of\s+undefined\s*\(reading\s*'res'\)/i.test(String(text || ''))
        );
        const blankCreateShell =
          (await this.page
            .locator('text=/Member\\s+Details/i')
            .first()
            .isVisible()
            .catch(() => false)) &&
          (await this.page
            .locator('button:has-text("Medical Treatment")')
            .first()
            .isVisible()
            .catch(() => false));

        if (portalRuntimeError || blankCreateShell) {
          throw this._buildAllianceError(
            'add_claim_form_runtime_error',
            `Add closed Search Member but claim form did not render (portal runtime state${
              portalRuntimeError ? `: ${portalRuntimeError}` : ''
            })`,
            {
              networkCode: networkCode || null,
              suggestedPortal: networkCode === 'GE' ? 'GE_NTUC' : null,
            }
          );
        }
        throw new Error('Add clicked but claim form did not load');
      }

      this._setLastAction('select-member.added');
      logger.info('[ALLIANCE] Selected member and opened claim form');
      return true;
    } catch (error) {
      if (onConsole) {
        this.page.off('console', onConsole);
      }
      await this.page
        .screenshot({ path: 'screenshots/alliance-medinet-add-member-error.png', fullPage: true })
        .catch(() => {});
      throw error;
    }
  }

  async _selectDoctorByName(doctorName) {
    const normalized = String(doctorName || '').trim();
    if (!normalized) return false;
    const normalizedDoctor = this._normalizeDoctorNameForMatch(normalized);
    const aliases = [
      normalized,
      normalized.replace(/\bKee\b/i, 'Yee'),
      normalized.replace(/\bYee\b/i, 'Kee'),
      normalized.replace(/\bGuoping\b/i, 'Guo Ping'),
      normalized.replace(/\bGuo\s+Ping\b/i, 'Guoping'),
    ]
      .map(v => String(v || '').trim())
      .filter(Boolean);
    const aliasSet = [...new Set(aliases)];

    const nativeSelect = this.page
      .locator('select[name*="doctor" i], select[id*="doctor" i], select[aria-label*="doctor" i]')
      .first();
    if (
      (await nativeSelect.count().catch(() => 0)) > 0 &&
      (await nativeSelect.isVisible().catch(() => false))
    ) {
      await nativeSelect.selectOption({ label: normalized }).catch(async () => {
        const options = await nativeSelect
          .locator('option')
          .allTextContents()
          .catch(() => []);
        const hit = options.find(optionValue => {
          const candidate = this._normalizeDoctorNameForMatch(optionValue);
          return candidate === normalizedDoctor;
        });
        if (hit) await nativeSelect.selectOption({ label: hit });
      });
      return true;
    }

    const doctorCombobox = this.page
      .locator(
        [
          'mat-form-field:has(mat-label:has-text("Doctor")) [role="combobox"]',
          'mat-form-field:has-text("Doctor") [role="combobox"]',
          'mat-form-field:has-text("Doctor") mat-select',
        ].join(', ')
      )
      .first();
    let opened = false;
    if (
      (await doctorCombobox.count().catch(() => 0)) > 0 &&
      (await doctorCombobox.isVisible().catch(() => false))
    ) {
      await doctorCombobox.click({ timeout: 5000 }).catch(async () => {
        await doctorCombobox.click({ timeout: 5000, force: true });
      });
      opened = true;
    }
    if (!opened) {
      opened = await this._clickFirstVisible(
      [
        '[role="combobox"][aria-label*="Doctor" i]',
        '[role="combobox"][aria-labelledby*="doctor" i]',
        '[role="combobox"][name*="doctor" i]',
        '[role="combobox"][id*="doctor" i]',
        'mat-select[formcontrolname*="doctor" i]',
        'mat-select[formcontrolname*="provider" i]',
        'input[name*="doctor" i]',
        'input[id*="doctor" i]',
      ],
      'Doctor dropdown'
      );
    }
    if (!opened) return false;

    const options = this.page.locator(
      ['[role="option"]', 'mat-option', 'li[role="option"]', '.mat-option'].join(', ')
    );
    const optionCount = await options.count().catch(() => 0);
    for (let i = 0; i < optionCount; i++) {
      const option = options.nth(i);
      const optionText = await option.innerText().catch(() => '');
      const candidate = this._normalizeDoctorNameForMatch(optionText);
      const isMatch =
        candidate === normalizedDoctor ||
        aliasSet.some(alias => candidate === this._normalizeDoctorNameForMatch(alias));
      if (!isMatch) continue;
      await option
        .click({ timeout: 5000 })
        .catch(async () => option.click({ timeout: 5000, force: true }));
      return true;
    }

    const fallbackOption = options.filter({ hasText: normalized }).first();
    if ((await fallbackOption.count().catch(() => 0)) > 0) {
      await fallbackOption
        .click({ timeout: 5000 })
        .catch(async () => fallbackOption.click({ timeout: 5000, force: true }));
      return true;
    }

    return false;
  }

  async _addDiagnosis(visit) {
    this.lastDiagnosisPortalMatch = null;
    const diagnosisName = String(
      visit?.diagnosis_description ||
        visit?.diagnosis ||
        visit?.extraction_metadata?.diagnosisCanonical?.description_raw ||
        visit?.extraction_metadata?.diagnosisCanonical?.description_canonical ||
        visit?.extraction_metadata?.diagnosis ||
        ''
    ).trim();
    const diagnosisCode = String(
      visit?.diagnosis_code ||
        visit?.extraction_metadata?.diagnosisCanonical?.code_normalized ||
        visit?.extraction_metadata?.diagnosisCode ||
        ''
    ).trim();

    this._setLastAction('fill.diagnosis.open');
    const openDialog = await this._clickFirstVisible(
      ['button:has-text("Add Diagnosis")', 'a:has-text("Add Diagnosis")'],
      'Add Diagnosis'
    );
    if (!openDialog) {
      throw new Error('Could not open diagnosis picker');
    }

    const dialog = this.page
      .locator('[role="dialog"]:has-text("Search Diagnosis"), mat-dialog-container:has-text("Search Diagnosis")')
      .first();
    await dialog.waitFor({ state: 'visible', timeout: 10000 });

    const draftMode = process.env.WORKFLOW_SAVE_DRAFT !== '0';
    const allowGenericFallback = process.env.ALLIANCE_DIAG_ALLOW_GENERIC_FALLBACK !== '0';
    const baseTokens = [
      diagnosisName,
      visit?.extraction_metadata?.diagnosisCanonical?.description_canonical,
      visit?.extraction_metadata?.diagnosisCanonical?.description_raw,
      diagnosisName.split(/\s+/).filter(Boolean)[0],
      diagnosisCode,
    ]
      .map(v => String(v || '').trim())
      .filter(Boolean);
    const genericTokens = [
      'pain in limb',
      'foot pain',
      'lower back pain',
      'back pain',
      'pain',
      'fever',
      'headache',
    ];
    const searchTokens = [...baseTokens, ...genericTokens].filter(Boolean);

    const collectOptions = async () => {
      const rows = dialog.locator('tbody tr, mat-row, .mat-mdc-row, .mat-row');
      const rowCount = await rows.count().catch(() => 0);
      const options = [];
      for (let i = 0; i < rowCount; i++) {
        const row = rows.nth(i);
        const rowText = String((await row.innerText().catch(() => '')) || '').trim();
        if (!rowText || /diagnosis\\s+name/i.test(rowText)) continue;
        const cells = row.locator('td, mat-cell, .mat-cell, .mat-mdc-cell');
        const cellCount = await cells.count().catch(() => 0);
        let code = null;
        let desc = null;
        if (cellCount >= 2) {
          code = String((await cells.nth(0).innerText().catch(() => '')) || '').trim();
          desc = String((await cells.nth(1).innerText().catch(() => '')) || '').trim();
        }
        const optionText = desc || rowText;
        options.push({
          text: optionText,
          code: code || null,
          value: rowText,
          rowIndex: i,
        });
      }
      return options;
    };

    let selected = false;
    let portalMatch = null;
    let bestFallback = null;
    for (const token of searchTokens) {
      if (selected) break;
      await this._fillFirstVisible(
        [
          '[role="dialog"] input[aria-label*="Diagnosis Name" i]',
          '[role="dialog"] input[placeholder*="Diagnosis Name" i]',
        ],
        token,
        `Diagnosis Name (${token})`
      ).catch(() => false);

      await this._clickFirstVisible(
        ['[role="dialog"] button:has-text("Search")', 'button:has-text("Search")'],
        `Diagnosis Search (${token})`
      );

      await this.page.waitForTimeout(500);
      const options = await collectOptions();
      if (!options.length) continue;
      const match = resolveDiagnosisAgainstPortalOptions({
        diagnosis: {
          code: diagnosisCode || null,
          description: diagnosisName || null,
        },
        portalOptions: options,
        minScore: Number(process.env.DIAGNOSIS_MATCH_MIN_SCORE || 90),
        codeMode: 'secondary',
      });

      if (!match || match.blocked !== false) {
        if (draftMode && allowGenericFallback) {
          const bestCandidate = match?.considered?.[0] || null;
          let fallback = null;
          if (bestCandidate?.text) {
            const idx = options.findIndex(
              opt =>
                String(opt?.text || '').toLowerCase().trim() ===
                String(bestCandidate.text || '').toLowerCase().trim()
            );
            if (idx >= 0) {
              fallback = {
                ...options[idx],
                score: Number(bestCandidate.score || 0),
                reason: bestCandidate.reason || match?.blocked_reason || 'low_confidence',
              };
            }
          }
          if (!fallback) {
            fallback = {
              ...options[0],
              score: Number(match?.match_score || 0),
              reason: match?.blocked_reason || 'low_confidence',
            };
          }
          if (!bestFallback || Number(fallback.score || 0) > Number(bestFallback.score || 0)) {
            bestFallback = fallback;
          }
        }
        continue;
      }

      const selectedIdx = options.findIndex(opt => opt.text === match.selected_text);
      const rowIndex = selectedIdx >= 0 ? options[selectedIdx].rowIndex : options[0]?.rowIndex;
      if (rowIndex === undefined || rowIndex === null) continue;

      const row = dialog.locator('tbody tr, mat-row, .mat-mdc-row, .mat-row').nth(rowIndex);
      const checkbox = row
        .locator(
          [
            'input[type="checkbox"]:not([disabled])',
            'mat-checkbox:not(.mat-mdc-checkbox-disabled)',
            '[role="checkbox"]',
            '.mdc-checkbox',
          ].join(', ')
        )
        .first();
      if ((await checkbox.count().catch(() => 0)) > 0) {
        await checkbox
          .check({ timeout: 5000 })
          .catch(async () => checkbox.click({ timeout: 5000, force: true }));
      } else {
        await row.click({ timeout: 5000, force: true }).catch(() => {});
      }
      selected = true;
      portalMatch = {
        portal: 'Alliance Medinet',
        match_text: match.selected_text || null,
        match_score: match.match_score || 0,
        match_method: 'search',
        matched_by: /code/.test(match.match_reason || '') ? 'icd_hint' : 'token_fuzzy',
      };
      break;
    }
    if (!selected && draftMode && allowGenericFallback && bestFallback) {
      const fallbackRows = dialog.locator('tbody tr, mat-row, .mat-mdc-row, .mat-row');
      const row = fallbackRows.nth(Number(bestFallback.rowIndex || 0));
      const checkbox = row
        .locator(
          [
            'input[type="checkbox"]:not([disabled])',
            'mat-checkbox:not(.mat-mdc-checkbox-disabled)',
            '[role="checkbox"]',
            '.mdc-checkbox',
          ].join(', ')
        )
        .first();
      if ((await checkbox.count().catch(() => 0)) > 0) {
        await checkbox
          .check({ timeout: 5000 })
          .catch(async () => checkbox.click({ timeout: 5000, force: true }));
      } else {
        await row.click({ timeout: 5000, force: true }).catch(() => {});
      }
      selected = true;
      portalMatch = {
        portal: 'Alliance Medinet',
        match_text: bestFallback.text || null,
        match_score: Number(bestFallback.score || 0),
        match_method: 'search',
        matched_by: 'token_fuzzy',
        fallback: true,
        fallback_reason: bestFallback.reason || 'low_confidence',
      };
      logger.warn('[ALLIANCE] Using low-confidence diagnosis fallback in draft mode', {
        diagnosisName: diagnosisName || null,
        diagnosisCode: diagnosisCode || null,
        fallbackText: bestFallback.text || null,
        fallbackScore: Number(bestFallback.score || 0),
        fallbackReason: bestFallback.reason || null,
      });
    }
    if (!selected) {
      throw new Error('No diagnosis search results available to select');
    }

    this.lastDiagnosisPortalMatch = portalMatch;

    this._setLastAction('fill.diagnosis.add');
    const addButton = dialog.locator('button:has-text("Add"), input[value="Add"]').first();
    const addCount = await addButton.count().catch(() => 0);
    if (!addCount) throw new Error('Diagnosis Add button not found');
    await addButton.click({ timeout: 7000 }).catch(async () => {
      await addButton.click({ timeout: 7000, force: true });
    });

    await dialog.waitFor({ state: 'hidden', timeout: 10000 }).catch(async () => {
      await this._clickFirstVisible(['[role="dialog"] button:has-text("Close")'], 'Diagnosis Close');
      await dialog.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
    });

    const notAdded = await this.page.locator('text=/Diagnosis\\s+not\\s+added/i').count().catch(() => 0);
    if (notAdded > 0) {
      throw new Error('Diagnosis was not added to claim form');
    }
  }

  async _setConsultationFeeType(chargeTypeRaw) {
    const targetType = this._resolveConsultationFeeType(chargeTypeRaw);
    this._setLastAction('fill.consultation-type.open');
    await this.page.locator('text=/Consultation\\s+Fee/i').first().scrollIntoViewIfNeeded().catch(() => {});
    await this.page.waitForTimeout(200).catch(() => {});

    const primary = this.page
      .locator(
        [
          'mat-select[formcontrolname*="consultationFeeGroupItem" i]',
          'mat-form-field:has-text("Consultation Fee Type") [role="combobox"]',
        ].join(', ')
      )
      .first();
    let opened = false;
    let primaryCount = 0;
    for (let i = 0; i < 20; i++) {
      primaryCount = await primary.count().catch(() => 0);
      if (primaryCount > 0) break;
      await this.page.waitForTimeout(200).catch(() => {});
    }
    if (primaryCount > 0) {
      await primary.scrollIntoViewIfNeeded().catch(() => {});
      await primary.click({ timeout: 5000 }).catch(async () => {
        await primary.click({ timeout: 5000, force: true });
      });
      opened = true;
    }
    if (!opened) {
      opened = await this._clickFirstVisible(
        [
          '[role="combobox"][aria-label*="Consultation Fee Type" i]',
          '[role="combobox"][aria-labelledby*="consultation" i]',
          '[role="combobox"][placeholder*="Consultation Fee" i]',
          'mat-select[placeholder*="Consultation Fee" i]',
          'mat-select[formcontrolname*="consultationFeeGroupItem" i]',
          'div:has-text("Consultation Fee Type"):has([role="combobox"])',
        ],
        'Consultation Fee Type'
      );
    }
    if (!opened) {
      logger.warn('[ALLIANCE] Consultation Fee Type dropdown not found; continuing');
      return false;
    }

    const options = this.page.locator('[role="option"], mat-option, .mat-mdc-option');
    let selected = false;
    const preferredOption = options.filter({ hasText: new RegExp(targetType, 'i') }).first();
    if ((await preferredOption.count().catch(() => 0)) > 0) {
      await preferredOption.click({ timeout: 5000 }).catch(async () => {
        await preferredOption.click({ timeout: 5000, force: true });
      });
      selected = true;
    }

    if (!selected) {
      const firstOption = options.first();
      if ((await firstOption.count().catch(() => 0)) > 0) {
        await firstOption.click({ timeout: 5000 }).catch(async () => {
          await firstOption.click({ timeout: 5000, force: true });
        });
        selected = true;
      }
    }
    if (!selected) {
      logger.warn('[ALLIANCE] Consultation Fee Type option not found; continuing', { targetType });
      return false;
    }

    await this.page.waitForTimeout(200).catch(() => {});
    const selectedValue = await this.page
      .locator('mat-select[formcontrolname*="consultationFeeGroupItem" i]')
      .first()
      .innerText()
      .catch(() => '');
    const normalizedSelected = String(selectedValue || '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
    const looksUnselected =
      !normalizedSelected ||
      normalizedSelected.includes('consultation fee type') ||
      normalizedSelected.includes('select');
    if (looksUnselected) {
      logger.warn('[ALLIANCE] Consultation Fee Type still unresolved after selection attempt');
      return false;
    }
    return true;
  }

  async _fillConsultationFeeAmount(amount) {
    const numeric = Number(amount);
    if (!Number.isFinite(numeric) || numeric <= 0) return false;
    let effectiveAmount = numeric;
    const selectedType = await this.page
      .locator('mat-select[formcontrolname*="consultationFeeGroupItem" i]')
      .first()
      .innerText()
      .catch(() => '');
    if (/follow/i.test(String(selectedType || '')) && effectiveAmount >= 70) {
      effectiveAmount = 69;
      logger.warn('[ALLIANCE] Consultation Fee capped for Follow Up type', {
        originalAmount: numeric,
        cappedAmount: effectiveAmount,
      });
    }
    return this._setInputValue(
      [
        'input[aria-label*="Consultation Fee" i]',
        'input[placeholder*="Consultation Fee" i]',
        'input[formcontrolname*="consultationFee" i]',
      ],
      effectiveAmount.toFixed(2),
      'Consultation Fee'
    );
  }

  async _fillMcDetails(visit) {
    const rawMcDays = visit?.extraction_metadata?.mcDays ?? visit?.mc_days ?? visit?.mcDays ?? 0;
    const mcDays = Number.isFinite(Number(rawMcDays)) ? Number(rawMcDays) : 0;
    await this._setInputValue(
      [
        'input[aria-label*="MC Days" i]',
        'input[placeholder*="MC Days" i]',
        'input[name*="mc" i][name*="day" i]',
        'input[id*="mc" i][id*="day" i]',
      ],
      String(Math.max(0, mcDays)),
      'MC Days'
    ).catch(() => false);

    const mcStartRaw =
      visit?.extraction_metadata?.mcStartDate ||
      visit?.mc_start_date ||
      visit?.mcStartDate ||
      visit?.mc_start ||
      null;
    const formattedMcStart = this._formatVisitDateForSearch(mcStartRaw);
    if (formattedMcStart) {
      await this._setInputValue(
        [
          'input[aria-label*="MC Start Date" i]',
          'input[placeholder*="MC Start Date" i]',
          'input[name*="mc" i][name*="start" i]',
          'input[id*="mc" i][id*="start" i]',
        ],
        formattedMcStart,
        'MC Start Date'
      ).catch(() => false);
      await this._closeDatePickerOverlay().catch(() => false);
    }
  }

  async _fillReferralDetails(visit) {
    const typeSelect = this.page
      .locator('mat-select[formcontrolname="referringProviderEntityType"]')
      .first();
    if (
      (await typeSelect.count().catch(() => 0)) > 0 &&
      (await typeSelect.isVisible().catch(() => false))
    ) {
      const typeText = await typeSelect.innerText().catch(() => '');
      const needsType =
        !String(typeText || '').trim() ||
        /provider\s+entity\s+type|select/i.test(String(typeText || ''));
      if (needsType) {
        this._setLastAction('fill.referral.type');
        await typeSelect.click({ timeout: 5000 }).catch(async () => {
          await typeSelect.click({ timeout: 5000, force: true });
        });
        const preferredType = this.page
          .locator('[role="option"], mat-option, .mat-mdc-option')
          .filter({ hasText: /Clinic/i })
          .first();
        if ((await preferredType.count().catch(() => 0)) > 0) {
          await preferredType.click({ timeout: 5000 }).catch(async () => {
            await preferredType.click({ timeout: 5000, force: true });
          });
        } else {
          const fallbackType = this.page.locator('[role="option"], mat-option, .mat-mdc-option').first();
          if ((await fallbackType.count().catch(() => 0)) > 0) {
            await fallbackType.click({ timeout: 5000 }).catch(async () => {
              await fallbackType.click({ timeout: 5000, force: true });
            });
          }
        }
      }
    }

    const referralInput = this.page
      .locator(
        [
          'input#referringProviderEntity',
          'app-autocomplete-local#referringProviderEntity input',
          'input[placeholder*="Type To Search" i][role="combobox"]',
        ].join(', ')
      )
      .first();
    if ((await referralInput.count().catch(() => 0)) === 0) return false;
    const visible = await referralInput.isVisible().catch(() => false);
    if (!visible) return false;
    const existing = await referralInput.inputValue().catch(() => '');
    if (String(existing || '').trim()) return true;

    const candidates = [
      visit?.extraction_metadata?.referringProviderEntity,
      visit?.extraction_metadata?.providerEntityName,
      process.env.ALLIANCE_REFERRING_PROVIDER_ENTITY,
      process.env.ALLIANCE_PROVIDER_ENTITY,
      'SINGAPORE SPORTS',
      'SINGAPORE',
    ]
      .map(v => String(v || '').trim())
      .filter(Boolean);

    const clickSuggestion = async candidate => {
      const options = this.page.locator('[role="option"], mat-option, .mat-mdc-option');
      const normalized = String(candidate || '')
        .trim()
        .toLowerCase();
      const escaped = normalized
        .slice(0, 18)
        .replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      let option = options.filter({ hasText: new RegExp(escaped, 'i') }).first();
      if ((await option.count().catch(() => 0)) === 0) {
        option = options.first();
      }
      if ((await option.count().catch(() => 0)) === 0) return false;
      await option.click({ timeout: 5000 }).catch(async () => {
        await option.click({ timeout: 5000, force: true });
      });
      await this.page.waitForTimeout(200).catch(() => {});
      const value = await referralInput.inputValue().catch(() => '');
      return !!String(value || '').trim();
    };

    this._setLastAction('fill.referral.entity');
    for (const candidate of candidates) {
      await referralInput.click({ timeout: 5000 }).catch(() => {});
      await referralInput.fill(candidate, { timeout: 5000 }).catch(() => {});
      await this.page.waitForTimeout(600).catch(() => {});
      if (await clickSuggestion(candidate)) return true;
    }
    return false;
  }

  async _calculateClaimAndValidate() {
    this._setLastAction('fill.calculate-claim');
    const clicked = await this._clickFirstVisible(
      ['button:has-text("Calculate Claim")', 'input[value*="Calculate Claim" i]'],
      'Calculate Claim'
    );
    if (!clicked) {
      throw new Error('Could not trigger Calculate Claim');
    }

    let retriedConsultationType = false;
    let adjustedConsultationFee = false;
    const start = Date.now();
    const timeoutMs = 15000;
    while (Date.now() - start < timeoutMs) {
      const saveVisible =
        (await this.page
          .locator('button:has-text("Save")')
          .count()
          .catch(() => 0)) > 0;
      if (saveVisible) return true;

      const invalidMsg = await this.page
        .locator('text=/Invalid\\s+field:/i')
        .first()
        .innerText()
        .catch(() => '');
      if (invalidMsg) {
        const bodyText = await this.page.locator('body').innerText().catch(() => '');
        const combined = `${invalidMsg}\n${bodyText}`;
        if (!retriedConsultationType && /claimPanelOutpatientConsultations|consultation\s+fee\s+type/i.test(combined)) {
          retriedConsultationType = true;
          await this._setConsultationFeeType('follow').catch(() => false);
          await this._clickFirstVisible(
            ['button:has-text("Calculate Claim")', 'input[value*="Calculate Claim" i]'],
            'Calculate Claim (consultation-type retry)'
          ).catch(() => false);
          await this.page.waitForTimeout(500).catch(() => {});
          continue;
        }

        if (!adjustedConsultationFee) {
          const feeLimitMatch = String(bodyText || '').match(
            /Consultation\\s*Fee\\s*should\\s*be\\s*below[^0-9]*(\\d+)/i
          );
          const feeLimit = feeLimitMatch ? Number(feeLimitMatch[1]) : null;
          if (Number.isFinite(feeLimit) && feeLimit > 1) {
            adjustedConsultationFee = true;
            const adjusted = Math.max(1, Number(feeLimit) - 1);
            await this._fillConsultationFeeAmount(adjusted).catch(() => false);
            await this._clickFirstVisible(
              ['button:has-text("Calculate Claim")', 'input[value*="Calculate Claim" i]'],
              'Calculate Claim (consultation-fee retry)'
            ).catch(() => false);
            await this.page.waitForTimeout(500).catch(() => {});
            continue;
          }
        }

        throw new Error(`Calculate Claim validation failed: ${invalidMsg}`);
      }
      await this.page.waitForTimeout(250);
    }

    throw new Error('Calculate Claim did not reach summary state');
  }

  async _fillOptionalTextField(label, value, selectors = []) {
    const text = String(value || '').trim();
    if (!text) return false;
    const preferred = [
      ...selectors,
      `textarea[name*="${label}" i]`,
      `input[name*="${label}" i]`,
      `textarea[id*="${label}" i]`,
      `input[id*="${label}" i]`,
      `textarea[aria-label*="${label}" i]`,
      `input[aria-label*="${label}" i]`,
      `textarea[placeholder*="${label}" i]`,
      `input[placeholder*="${label}" i]`,
    ];
    return this._fillFirstVisible(preferred, text, label);
  }

  async validateRequiredFields({ nric, doctorName }) {
    const missingCore = [];
    if (!String(nric || '').trim()) missingCore.push('NRIC/Member UIN');
    if (!String(doctorName || '').trim()) missingCore.push('Doctor');

    const unresolvedRequired = [];
    const requiredFields = this.page.locator(
      'input[required], textarea[required], select[required]'
    );
    const requiredCount = await requiredFields.count().catch(() => 0);
    for (let i = 0; i < requiredCount; i++) {
      const field = requiredFields.nth(i);
      const visible = await field.isVisible().catch(() => false);
      if (!visible) continue;
      const value = await field.inputValue().catch(async () => {
        return field.evaluate(el => {
          if (el.tagName.toLowerCase() === 'select') {
            return el.value || '';
          }
          return el.value || '';
        });
      });
      if (String(value || '').trim()) continue;
      const label = await field.evaluate(el => {
        const id = el.getAttribute('id');
        const ownerDoc = el.ownerDocument;
        if (id) {
          const linked = ownerDoc ? ownerDoc.querySelector(`label[for="${id}"]`) : null;
          if (linked && linked.textContent) return linked.textContent.trim();
        }
        const aria = el.getAttribute('aria-label');
        if (aria) return aria.trim();
        const placeholder = el.getAttribute('placeholder');
        if (placeholder) return placeholder.trim();
        return el.getAttribute('name') || el.getAttribute('id') || 'required-field';
      });
      unresolvedRequired.push(label);
    }

    const missing = [...missingCore, ...unresolvedRequired].filter(Boolean);
    if (missing.length > 0) {
      throw new Error(`Required fields unresolved for Allianz Medinet: ${missing.join(', ')}`);
    }
  }

  async fillClaimForm(visit, mappedDoctorName) {
    try {
      const draftMode = process.env.WORKFLOW_SAVE_DRAFT !== '0';
      const doctorSelected = await this._selectDoctorByName(mappedDoctorName);
      if (!doctorSelected) {
        throw new Error(`Could not select doctor "${mappedDoctorName}" in Allianz Medinet form`);
      }

      await this._fillMcDetails(visit);
      await this._addDiagnosis(visit);
      await this._fillReferralDetails(visit).catch(() => false);
      await this._setConsultationFeeType(visit?.extraction_metadata?.chargeType || visit?.charge_type || null);
      await this._fillConsultationFeeAmount(visit?.total_amount).catch(() => false);
      await this._fillOptionalTextField('treatment', visit?.treatment_detail, [
        'textarea[name*="treatment" i]',
        'textarea[name*="remark" i]',
      ]);
      await this._fillOptionalTextField('remark', visit?.treatment_detail, [
        'textarea[name*="remark" i]',
      ]);

      if (!draftMode) {
        await this.validateRequiredFields({
          nric: visit?.nric || visit?.extraction_metadata?.nric || null,
          doctorName: mappedDoctorName,
        });
        await this._calculateClaimAndValidate();
      } else {
        logger.info('[ALLIANCE] Draft mode enabled: skipping strict calculate/validation gate');
      }

      await this.page.waitForTimeout(600);
      await this.page
        .screenshot({
          path: `screenshots/alliance-medinet-final-form-${visit?.id || 'unknown'}.png`,
          fullPage: true,
        })
        .catch(() => {});
      return { doctorName: mappedDoctorName, diagnosisPortalMatch: this.lastDiagnosisPortalMatch || null };
    } catch (error) {
      await this.page
        .screenshot({ path: 'screenshots/alliance-medinet-fill-error.png', fullPage: true })
        .catch(() => {});
      throw error;
    }
  }

  async saveAsDraft() {
    this._setLastAction('save.draft-only');

    const clickDraft = async scopeLabel => {
      const direct = await this._clickFirstVisible(
        [
          'button:has-text("Save as Draft")',
          'button:has-text("Save Draft")',
          'input[value*="Save as Draft" i]',
          'input[value*="Save Draft" i]',
        ],
        `Save as Draft${scopeLabel ? ` (${scopeLabel})` : ''}`
      );
      if (direct) return true;

      await this._clickFirstVisible(
        [
          'button:has-text("more_vert")',
          'button[aria-label*="more" i]',
          '.mat-mdc-menu-trigger:has-text("more_vert")',
        ],
        `Overflow Menu${scopeLabel ? ` (${scopeLabel})` : ''}`
      ).catch(() => false);

      return this._clickFirstVisible(
        [
          '[role="menuitem"]:has-text("Save as Draft")',
          '[role="menuitem"]:has-text("Save Draft")',
          'button:has-text("Save as Draft")',
          'button:has-text("Save Draft")',
        ],
        `Save as Draft (menu${scopeLabel ? `/${scopeLabel}` : ''})`
      );
    };

    let clickedDraft = await clickDraft('initial');
    if (!clickedDraft) {
      // Some forms only reveal draft actions after calculation.
      const calcClicked = await this._clickFirstVisible(
        ['button:has-text("Calculate Claim")', 'input[value*="Calculate Claim" i]'],
        'Calculate Claim (pre-draft)'
      );
      if (calcClicked) {
        await this.page.waitForTimeout(1200);
        await this._calculateClaimAndValidate().catch(error => {
          logger.warn('[ALLIANCE] Calculate before draft save did not reach summary', {
            error: error?.message || String(error),
          });
        });
        clickedDraft = await clickDraft('post-calculate');
      }
    }

    if (!clickedDraft) {
      // Alliance Claim Summary screen exposes only "Save" for draft persistence.
      let claimSummaryVisible = false;
      for (let i = 0; i < 20; i++) {
        claimSummaryVisible = await this.page
          .locator('text=/Claim\\s+Summary/i')
          .first()
          .isVisible()
          .catch(() => false);
        if (claimSummaryVisible) break;
        await this.page.waitForTimeout(400).catch(() => {});
      }
      if (claimSummaryVisible) {
        await this.page
          .screenshot({
            path: `screenshots/alliance-medinet-claim-summary-before-save-${Date.now()}.png`,
            fullPage: true,
          })
          .catch(() => {});
        const saveButtons = this.page.locator('button, input[type="button"], input[type="submit"]');
        const saveCount = await saveButtons.count().catch(() => 0);
        for (let i = 0; i < saveCount; i++) {
          const candidate = saveButtons.nth(i);
          const visible = await candidate.isVisible().catch(() => false);
          if (!visible) continue;
          const rawText =
            (await candidate.innerText().catch(() => null)) ??
            (await candidate.getAttribute('value').catch(() => null)) ??
            '';
          const text = String(rawText)
            .replace(/\s+/g, ' ')
            .trim()
            .toLowerCase();
          if (!text.includes('save') || text.includes('draft')) continue;
          await candidate.click({ timeout: 7000 }).catch(async () => {
            await candidate.click({ timeout: 7000, force: true });
          });
          this._setLastAction('save.summary-save');
          logger.info('[ALLIANCE] Clicked Save on Claim Summary for draft persistence');
          clickedDraft = true;
          break;
        }
      }
      if (!clickedDraft) return false;
    }

    await this.page.waitForTimeout(400);
    await this._clickFirstVisible(
      ['[role="dialog"] button:has-text("Confirm")', 'button:has-text("Confirm")'],
      'Confirm Save as Draft'
    ).catch(() => false);
    await this.page.waitForTimeout(1200);
    return true;
  }
}
