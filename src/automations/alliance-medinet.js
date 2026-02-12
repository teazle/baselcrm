import { logger } from '../utils/logger.js';
import { PORTALS } from '../config/portals.js';

export class AllianceMedinetAutomation {
  constructor(page) {
    this.page = page;
    this.config = PORTALS.ALLIANCE_MEDINET;
    this.loggedIn = false;
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

  async login() {
    try {
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

      const usernameFilled = await this._fillFirstVisible(
        [
          'input[name*="user" i]',
          'input[id*="user" i]',
          'input[placeholder*="user" i]',
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
        ],
        password,
        'password'
      );
      if (!usernameFilled || !passwordFilled) {
        throw new Error('Could not locate Alliance Medinet login fields');
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

      await this.page.waitForLoadState('domcontentloaded').catch(() => {});
      await this.page.waitForTimeout(2000);

      const stillOnLogin = /\/login/i.test(this.page.url());
      const hasPanelService =
        (await this.page
          .locator('text=/Panel\\s*Service/i')
          .count()
          .catch(() => 0)) > 0;
      if (stillOnLogin && !hasPanelService) {
        throw new Error('Alliance Medinet login did not complete');
      }

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

      const panelMenuClicked = await this._clickFirstVisible(
        [
          'a:has-text("Panel Service")',
          'button:has-text("Panel Service")',
          '[role="button"]:has-text("Panel Service")',
          'li:has-text("Panel Service")',
        ],
        'Panel Service'
      );
      if (!panelMenuClicked) throw new Error('Could not find Panel Service menu');
      await this.page.waitForTimeout(600);

      const createPanelClaimClicked = await this._clickFirstVisible(
        [
          'a:has-text("Create Panel Claim")',
          'button:has-text("Create Panel Claim")',
          '[role="menuitem"]:has-text("Create Panel Claim")',
          'li:has-text("Create Panel Claim")',
        ],
        'Create Panel Claim'
      );
      if (!createPanelClaimClicked) throw new Error('Could not find Create Panel Claim menu');
      await this.page.waitForTimeout(600);

      const medicalTreatmentClicked = await this._clickFirstVisible(
        [
          'a:has-text("Medical Treatment")',
          'button:has-text("Medical Treatment")',
          '[role="menuitem"]:has-text("Medical Treatment")',
          'li:has-text("Medical Treatment")',
        ],
        'Medical Treatment'
      );
      if (!medicalTreatmentClicked) throw new Error('Could not find Medical Treatment menu');

      await this.page.waitForTimeout(1500);
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

      const formattedVisitDate = this._formatVisitDateForSearch(visitDate);
      await this._setInputValueIfEmpty(
        [
          'input[name*="visit" i]',
          'input[id*="visit" i]',
          'input[placeholder*="Date of Visit" i]',
          'input[aria-label*="Date of Visit" i]',
        ],
        formattedVisitDate
      );

      const searchClicked = await this._clickFirstVisible(
        [
          'button:has-text("Search Others")',
          'input[value*="Search Others" i]',
          'a:has-text("Search Others")',
        ],
        'Search Others'
      );
      if (!searchClicked) throw new Error('Could not find Search Others button');

      await this.page.waitForTimeout(2500);

      const memberRows = this.page.locator('tbody tr, [role="rowgroup"] [role="row"]');
      const rowCount = await memberRows.count().catch(() => 0);
      const noResultText = await this.page
        .locator('text=/no\\s+records|0\\s+records|member\\s+not\\s+found/i')
        .count()
        .catch(() => 0);

      return {
        found: rowCount > 0 && noResultText === 0,
        rowCount,
        memberNotFound: rowCount === 0 || noResultText > 0,
      };
    } catch (error) {
      await this.page
        .screenshot({ path: 'screenshots/alliance-medinet-search-error.png', fullPage: true })
        .catch(() => {});
      throw error;
    }
  }

  async selectMemberAndAdd() {
    try {
      const checkbox = this.page
        .locator('tbody tr td input[type="checkbox"], [role="row"] input[type="checkbox"]')
        .first();
      const checkboxCount = await checkbox.count().catch(() => 0);
      if (!checkboxCount) throw new Error('No member result row checkbox found');
      await checkbox.check({ timeout: 5000 }).catch(async () => {
        await checkbox.click({ timeout: 5000, force: true });
      });

      const addClicked = await this._clickFirstVisible(
        ['button:has-text("Add")', 'input[value="Add"]', 'a:has-text("Add")'],
        'Add'
      );
      if (!addClicked) throw new Error('Could not find Add button after selecting member');

      await this.page.waitForTimeout(2000);
      logger.info('[ALLIANCE] Selected member and opened claim form');
      return true;
    } catch (error) {
      await this.page
        .screenshot({ path: 'screenshots/alliance-medinet-add-member-error.png', fullPage: true })
        .catch(() => {});
      throw error;
    }
  }

  async _selectDoctorByName(doctorName) {
    const normalized = String(doctorName || '').trim();
    if (!normalized) return false;

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
        const hit = options.find(
          o =>
            String(o || '')
              .trim()
              .toLowerCase() === normalized.toLowerCase()
        );
        if (hit) await nativeSelect.selectOption({ label: hit });
      });
      return true;
    }

    const opened = await this._clickFirstVisible(
      [
        '[role="combobox"][aria-label*="Doctor" i]',
        '[role="combobox"][name*="doctor" i]',
        '[role="combobox"][id*="doctor" i]',
        'mat-select[formcontrolname*="doctor" i]',
        'input[name*="doctor" i]',
        'input[id*="doctor" i]',
      ],
      'Doctor dropdown'
    );
    if (!opened) return false;

    const option = this.page
      .locator(['[role="option"]', 'mat-option', 'li[role="option"]', '.mat-option'].join(', '))
      .filter({
        hasText: new RegExp(`^\\s*${normalized.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'i'),
      })
      .first();
    const fallbackOption = this.page
      .locator(['[role="option"]', 'mat-option', 'li[role="option"]', '.mat-option'].join(', '))
      .filter({ hasText: normalized })
      .first();

    if ((await option.count().catch(() => 0)) > 0) {
      await option
        .click({ timeout: 5000 })
        .catch(async () => option.click({ timeout: 5000, force: true }));
      return true;
    }
    if ((await fallbackOption.count().catch(() => 0)) > 0) {
      await fallbackOption
        .click({ timeout: 5000 })
        .catch(async () => fallbackOption.click({ timeout: 5000, force: true }));
      return true;
    }
    return false;
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
      await this.validateRequiredFields({
        nric: visit?.nric || visit?.extraction_metadata?.nric || null,
        doctorName: mappedDoctorName,
      });

      const doctorSelected = await this._selectDoctorByName(mappedDoctorName);
      if (!doctorSelected) {
        throw new Error(`Could not select doctor "${mappedDoctorName}" in Allianz Medinet form`);
      }

      await this._fillOptionalTextField('diagnosis', visit?.diagnosis_description, [
        'textarea[name*="diagnosis" i]',
        'input[name*="diagnosis" i]',
      ]);
      await this._fillOptionalTextField('treatment', visit?.treatment_detail, [
        'textarea[name*="treatment" i]',
        'textarea[name*="remark" i]',
      ]);
      await this._fillOptionalTextField('remark', visit?.treatment_detail, [
        'textarea[name*="remark" i]',
      ]);

      const amount = Number(visit?.total_amount || 0);
      if (Number.isFinite(amount) && amount > 0) {
        await this._fillFirstVisible(
          [
            'input[name*="amount" i]',
            'input[id*="amount" i]',
            'input[aria-label*="amount" i]',
            'input[placeholder*="amount" i]',
            'input[name*="consult" i]',
          ],
          amount.toFixed(2),
          'amount'
        ).catch(() => false);
      }

      await this.validateRequiredFields({
        nric: visit?.nric || visit?.extraction_metadata?.nric || null,
        doctorName: mappedDoctorName,
      });

      await this.page.waitForTimeout(600);
      await this.page
        .screenshot({
          path: `screenshots/alliance-medinet-final-form-${visit?.id || 'unknown'}.png`,
          fullPage: true,
        })
        .catch(() => {});
      return { doctorName: mappedDoctorName };
    } catch (error) {
      await this.page
        .screenshot({ path: 'screenshots/alliance-medinet-fill-error.png', fullPage: true })
        .catch(() => {});
      throw error;
    }
  }

  async saveAsDraft() {
    const clicked = await this._clickFirstVisible(
      [
        'button:has-text("Save as Draft")',
        'button:has-text("Save Draft")',
        'input[value*="Save as Draft" i]',
        'input[value*="Save Draft" i]',
      ],
      'Save as Draft'
    );
    if (!clicked) return false;
    await this.page.waitForTimeout(2000);
    return true;
  }
}
