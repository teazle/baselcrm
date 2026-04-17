import { logger } from '../utils/logger.js';
import { PORTALS } from '../config/portals.js';
import { resolveDiagnosisAgainstPortalOptions } from '../automations/clinic-assist.js';

/**
 * Dedicated submit service boundary for GE / NTUC IM portal flow.
 * Uses the Alliance Medinet login flow to reach the GE popup when routed.
 */
export class GENtucSubmitter {
  constructor(allianceAutomation, steps = null) {
    this.allianceAutomation = allianceAutomation;
    this.steps = steps;
  }

  _normalizeNricLike(value) {
    const raw = String(value || '')
      .trim()
      .toUpperCase();
    if (!raw) return '';
    const match = raw.match(/[STFGM]\d{7}[A-Z]/);
    if (match) return match[0];
    return raw.replace(/[\s\/-]+/g, '');
  }

  _normalizeDiagnosisCode(value) {
    const raw = String(value || '')
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9.]/g, '');
    if (!raw) return '';
    const m = raw.match(/[A-Z][0-9]{2,3}(?:\.[0-9A-Z]{1,4})?/);
    return m ? m[0] : raw;
  }

  _normalizeDiagnosisText(value) {
    return String(value || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  _tokenizeDiagnosisText(value) {
    return this._normalizeDiagnosisText(value)
      .split(/\s+/)
      .filter(t => t && t.length > 2);
  }

  _softDiagnosisScore(baseText, candidateText) {
    const a = new Set(this._tokenizeDiagnosisText(baseText));
    const b = new Set(this._tokenizeDiagnosisText(candidateText));
    if (!a.size || !b.size) return 0;
    let overlap = 0;
    for (const t of a) if (b.has(t)) overlap += 1;
    if (!overlap) return 0;
    const union = a.size + b.size - overlap;
    return union > 0 ? overlap / union : 0;
  }

  _isTraumaLikeDiagnosis(text) {
    const raw = this._normalizeDiagnosisText(text);
    return /\b(injury|injuries|trauma|traumatic|fracture|wound|amputation|sprain|strain|crushing)\b/.test(
      raw
    );
  }

  _isLikelyDiagnosisConflict(baseText, candidateText) {
    const base = this._normalizeDiagnosisText(baseText);
    const candidate = this._normalizeDiagnosisText(candidateText);
    if (!base || !candidate) return false;
    // Do not map non-trauma complaints to explicitly trauma-like diagnoses.
    if (!this._isTraumaLikeDiagnosis(base) && this._isTraumaLikeDiagnosis(candidate)) return true;
    // Body-part guardrails for common mismatches observed in portal list fallbacks.
    if (/\b(back|lumbar|lumbago)\b/.test(base)) {
      if (/\b(abdominal|pelvic|micturition|genital|menstrual|throat|chest)\b/.test(candidate))
        return true;
    }
    if (
      /\b(throat)\b/.test(base) &&
      /\b(abdominal|pelvic|micturition|genital|menstrual)\b/.test(candidate)
    ) {
      return true;
    }
    return false;
  }

  _pickNricForVisit(visit, metadata = null) {
    const md = metadata || visit?.extraction_metadata || {};
    const candidates = [
      visit?.nric,
      visit?.patient_no,
      visit?.patient_number,
      visit?.patientId,
      md?.nric,
      md?.fin,
      md?.finNumber,
      md?.idNumber,
      md?.idNo,
      md?.patientId,
      md?.patient_id,
      md?.memberId,
      md?.member_id,
      md?.ic,
      md?.icNumber,
      visit?.patient_id,
      visit?.member_id,
    ].filter(Boolean);
    for (const cand of candidates) {
      const cleaned = this._normalizeNricLike(cand);
      if (/^[STFGM]\d{7}[A-Z]$/i.test(cleaned)) return cleaned;
    }
    return '';
  }

  _formatDateForGE(dateStr) {
    if (!dateStr) return '';
    const raw = String(dateStr || '').trim();
    const ymd = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (ymd) return `${ymd[3]}-${ymd[2]}-${ymd[1]}`;
    const dmy = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (dmy) return `${dmy[1]}-${dmy[2]}-${dmy[3]}`;
    return raw;
  }

  _buildAllianceSearchDateCandidates(visitDate) {
    const raw = String(visitDate || '').trim();
    if (!raw) return [null];
    const out = [raw];
    const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return out;
    const base = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
    if (Number.isNaN(base.getTime())) return out;
    const shift = delta => {
      const d = new Date(base);
      d.setUTCDate(d.getUTCDate() + delta);
      const y = d.getUTCFullYear();
      const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
      const dd = String(d.getUTCDate()).padStart(2, '0');
      return `${y}-${mm}-${dd}`;
    };
    out.push(shift(-1), shift(1));
    return [...new Set(out)];
  }

  _deriveMcReason(visit) {
    const raw = String(visit?.diagnosis_description || visit?.diagnosis_desc || '').trim();
    if (!raw) return 'Pain-unspecified';
    if (/fever/i.test(raw)) return 'Fever';
    if (/flu/i.test(raw)) return 'Flu';
    if (/sore throat|throat/i.test(raw)) return 'Sore Throat';
    if (/cough/i.test(raw)) return 'Cough';
    if (/headache/i.test(raw)) return 'Headache';
    if (/back/i.test(raw) || /lumbago|lumbar/i.test(raw)) return 'Backache';
    if (/giddiness|dizzy/i.test(raw)) return 'Giddiness';
    if (/diarr/i.test(raw)) return 'Diarrhoea - Severe';
    if (/vomit/i.test(raw)) return 'Vomiting - Severe';
    if (/pain/i.test(raw)) return 'Pain - Severe';
    return 'Pain-unspecified';
  }

  _deriveDiagnosisText(visit) {
    const raw = String(
      visit?.diagnosis_description ||
        visit?.diagnosis_desc ||
        visit?.extraction_metadata?.diagnosisCanonical?.description_canonical ||
        visit?.extraction_metadata?.diagnosis?.description ||
        ''
    ).trim();
    if (raw) return raw;
    return 'General medical condition';
  }

  _deriveDiagnosisCode(visit) {
    const raw =
      visit?.diagnosis_code ||
      visit?.diagnosisCode ||
      visit?.extraction_metadata?.diagnosisCanonical?.code_normalized ||
      visit?.extraction_metadata?.diagnosisCode ||
      '';
    return this._normalizeDiagnosisCode(raw);
  }

  _deriveFeeAmount(visit) {
    const raw =
      visit?.total_amount ??
      visit?.totalAmount ??
      visit?.consultation_fee ??
      visit?.consultationFee ??
      visit?.charge_amount;
    const num = Number(raw);
    if (!Number.isFinite(num)) return '';
    return num.toFixed(2);
  }

  _deriveFeeType(visit) {
    const chargeType = String(visit?.extraction_metadata?.chargeType || '').toLowerCase();
    if (chargeType === 'first' || chargeType === 'new') return 'consultationfee';
    if (chargeType === 'follow' || chargeType === 'followup') return 'followup_consultationfee';
    return 'followup_consultationfee';
  }

  _deriveDiagnosisSearchTerms(visit, diagnosisText) {
    const canonical = String(
      visit?.extraction_metadata?.diagnosisCanonical?.description_canonical || ''
    ).trim();
    const text = String(diagnosisText || '').trim();
    const firstTwo = text.split(/\s+/).filter(Boolean).slice(0, 2).join(' ');
    const firstThree = text.split(/\s+/).filter(Boolean).slice(0, 3).join(' ');
    const normalized = this._normalizeDiagnosisText(`${text} ${canonical}`);
    const generic = ['pain'];
    if (/back|lumbar|lumbago/.test(normalized))
      generic.push('lower back pain', 'back pain', 'backache');
    if (/headache/.test(normalized)) generic.push('headache');
    if (/fever/.test(normalized)) generic.push('fever');
    if (!/back|lumbar|lumbago|headache|fever|pain/.test(normalized)) {
      generic.push('headache', 'fever', 'back pain');
    }
    return [...new Set([text, canonical, firstThree, firstTwo, ...generic].filter(Boolean))];
  }

  _deriveDiagnosisLetterCandidates(searchTerms = []) {
    const letters = [];
    for (const term of searchTerms || []) {
      const tokens = this._tokenizeDiagnosisText(term);
      for (const token of tokens) {
        const first = String(token || '')
          .charAt(0)
          .toUpperCase();
        if (/^[A-Z]$/.test(first)) letters.push(first);
      }
    }
    // Strong defaults for common clinic complaints.
    letters.push('P', 'B', 'L', 'F', 'H', 'A');
    return [...new Set(letters)];
  }

  async _fillInput(page, selector, value) {
    const loc = page.locator(selector).first();
    const count = await loc.count().catch(() => 0);
    if (!count) return false;
    await loc.click({ timeout: 5000 }).catch(() => {});
    await loc.fill(String(value || ''));
    await loc.dispatchEvent('input').catch(() => {});
    await loc.dispatchEvent('change').catch(() => {});
    return true;
  }

  async _setInputValueNoPostback(page, selector, value) {
    return page
      .evaluate(
        ({ s, v }) => {
          const el = document.querySelector(s);
          if (!el) return false;
          el.value = String(v ?? '');
          return true;
        },
        { s: selector, v: value }
      )
      .catch(() => false);
  }

  async _setSelectValueNoPostback(page, selector, candidates = [], pairedTextSelector = null) {
    const list = [...new Set(candidates.map(v => String(v || '').trim()).filter(Boolean))];
    if (!list.length) return false;
    return page
      .evaluate(
        ({ s, values, paired }) => {
          const el = document.querySelector(s);
          if (!el || !el.options) return false;
          const wants = values.map(v => v.toLowerCase());
          const exact = option => {
            const value = String(option.value || '')
              .trim()
              .toLowerCase();
            const label = String(option.textContent || '')
              .trim()
              .toLowerCase();
            return wants.includes(value) || wants.includes(label);
          };
          const loose = option => {
            const value = String(option.value || '')
              .trim()
              .toLowerCase();
            const label = String(option.textContent || '')
              .trim()
              .toLowerCase();
            return wants.some(w => value.includes(w) || label.includes(w));
          };

          let chosen = Array.from(el.options || []).find(exact);
          if (!chosen) chosen = Array.from(el.options || []).find(loose);
          if (!chosen) return false;

          el.value = chosen.value;
          if (paired) {
            const pairedEl = document.querySelector(paired);
            if (pairedEl) {
              pairedEl.value = String(chosen.textContent || '').trim();
            }
          }
          return true;
        },
        { s: selector, values: list, paired: pairedTextSelector }
      )
      .catch(() => false);
  }

  async _selectByValue(page, selector, value) {
    const loc = page.locator(selector).first();
    const count = await loc.count().catch(() => 0);
    if (!count) return false;
    try {
      await loc.selectOption({ value });
      return true;
    } catch {
      await page.evaluate(
        ({ selector: s, value: v }) => {
          const el = document.querySelector(s);
          if (!el) return false;
          el.value = v;
          el.dispatchEvent(new Event('change', { bubbles: true }));
          return true;
        },
        { selector, value }
      );
      return true;
    }
  }

  async _selectByValueOrLabel(page, selector, candidates = []) {
    const loc = page.locator(selector).first();
    const count = await loc.count().catch(() => 0);
    if (!count) return false;
    const list = [...new Set(candidates.map(v => String(v || '').trim()).filter(Boolean))];
    if (!list.length) return false;
    for (const candidate of list) {
      try {
        await loc.selectOption({ value: candidate });
        return true;
      } catch {}
      try {
        await loc.selectOption({ label: candidate });
        return true;
      } catch {}
    }
    return page
      .evaluate(
        ({ selector: s, values }) => {
          const el = document.querySelector(s);
          if (!el || !el.options) return false;
          const wants = values.map(v =>
            String(v || '')
              .trim()
              .toLowerCase()
          );
          for (const option of Array.from(el.options || [])) {
            const value = String(option.value || '')
              .trim()
              .toLowerCase();
            const label = String(option.textContent || '')
              .trim()
              .toLowerCase();
            if (wants.includes(value) || wants.includes(label)) {
              el.value = option.value;
              el.dispatchEvent(new Event('change', { bubbles: true }));
              return true;
            }
          }
          return false;
        },
        { selector, values: list }
      )
      .catch(() => false);
  }

  async _selectFeeTypeWithFallback(page, feeLabels = []) {
    const selector = '#ctl00_MainContent_uc_MakeClaim_ddlFeeType';
    const selectedByPreferred = await this._selectByValueOrLabel(page, selector, feeLabels);
    if (selectedByPreferred) {
      await page.waitForLoadState('domcontentloaded').catch(() => {});
      await page.waitForTimeout(600);
    }

    const valueAfterPreferred = await page
      .evaluate(sel => {
        const el = document.querySelector(sel);
        return el ? String(el.value || '').trim() : '';
      }, selector)
      .catch(() => '');
    if (valueAfterPreferred) {
      return { selected: true, value: valueAfterPreferred, by: 'preferred' };
    }

    const fallbackOption = await page
      .evaluate(sel => {
        const el = document.querySelector(sel);
        if (!el?.options) return null;
        const options = Array.from(el.options)
          .map(o => ({
            value: String(o.value || '').trim(),
            text: String(o.textContent || '').trim(),
          }))
          .filter(o => o.value && !/^(-+\s*)?select/i.test(o.text));
        if (!options.length) return null;
        const consult = options.find(o => /consult/i.test(o.text));
        return consult || options[0];
      }, selector)
      .catch(() => null);
    if (!fallbackOption?.value) {
      return { selected: false, value: '', by: 'none' };
    }

    const selectedByFallback =
      (await this._selectByValueOrLabel(page, selector, [
        fallbackOption.value,
        fallbackOption.text,
      ])) ||
      (await this._setSelectValueNoPostback(page, selector, [
        fallbackOption.value,
        fallbackOption.text,
      ]));
    if (!selectedByFallback) {
      return { selected: false, value: '', by: 'none' };
    }

    await page.waitForLoadState('domcontentloaded').catch(() => {});
    await page.waitForTimeout(600);
    const valueAfterFallback = await page
      .evaluate(sel => {
        const el = document.querySelector(sel);
        return el ? String(el.value || '').trim() : '';
      }, selector)
      .catch(() => '');
    return {
      selected: Boolean(valueAfterFallback),
      value: valueAfterFallback,
      by: 'fallback',
      fallbackText: fallbackOption.text,
    };
  }

  async _openDiagnosisPopup(page) {
    const diagHref = await page
      .evaluate(() => {
        const link = Array.from(document.querySelectorAll('a')).find(a => {
          const href = a.getAttribute('href') || '';
          const title = a.getAttribute('title') || '';
          return href.includes('SearchDiagnosis.aspx') || /primary diagnosis/i.test(title);
        });
        return link ? link.getAttribute('href') : null;
      })
      .catch(() => null);

    const absoluteHref = diagHref
      ? diagHref.startsWith('http')
        ? diagHref
        : `https://supremecare.greateasternlife.com${diagHref}`
      : null;

    const attemptOpen = async () => {
      await page.evaluate(href => {
        const show = window.tb_show || window.TB_show;
        if (show && href) {
          show('', href);
          return;
        }
        const link = Array.from(document.querySelectorAll('a')).find(a => {
          const rawHref = a.getAttribute('href') || '';
          const title = a.getAttribute('title') || '';
          return rawHref.includes('SearchDiagnosis.aspx') || /primary diagnosis/i.test(title);
        });
        if (link) link.click();
      }, absoluteHref);
    };

    await attemptOpen();
    await page.waitForTimeout(500);
    let frameReady = await page
      .waitForSelector('#TB_iframeContent', { timeout: 5000 })
      .catch(() => null);
    if (!frameReady) {
      await attemptOpen();
      await page.waitForTimeout(800);
      frameReady = await page
        .waitForSelector('#TB_iframeContent', { timeout: 5000 })
        .catch(() => null);
    }
    return Boolean(frameReady);
  }

  async _collectDiagnosisOptionsFromFrame(frame) {
    const rows = frame.locator('tr');
    const rowCount = await rows.count().catch(() => 0);
    const options = [];
    for (let i = 0; i < rowCount; i++) {
      const row = rows.nth(i);
      const link = row.locator('a[href*="lbtnPrimaryDiagnosis"]').first();
      const linkCount = await link.count().catch(() => 0);
      if (!linkCount) continue;

      const desc = String((await link.innerText().catch(() => '')) || '').trim();
      if (!desc) continue;

      const cells = row.locator('td');
      const cellCount = await cells.count().catch(() => 0);
      let code = '';
      for (let c = 0; c < cellCount; c++) {
        const text = String(
          (await cells
            .nth(c)
            .innerText()
            .catch(() => '')) || ''
        ).trim();
        const normalized = this._normalizeDiagnosisCode(text);
        if (normalized) {
          code = normalized;
          break;
        }
      }
      options.push({
        code: code || null,
        text: desc,
        rowIndex: i,
        value: String(i),
      });
    }
    return options;
  }

  async _collectDiagnosisOptionsWithWait(page, frame, waitMs = 6500) {
    const deadline = Date.now() + Math.max(1000, Number(waitMs) || 6500);
    let stableSeen = 0;
    let lastSignature = '';
    while (Date.now() < deadline) {
      const options = await this._collectDiagnosisOptionsFromFrame(frame);
      const signature = options.map(opt => `${opt.code || ''}|${opt.text || ''}`).join('::');
      if (options.length > 0 && signature) {
        if (signature === lastSignature) {
          stableSeen += 1;
          if (stableSeen >= 1) return options;
        } else {
          lastSignature = signature;
          stableSeen = 0;
        }
      }
      await page.waitForTimeout(300);
    }
    return this._collectDiagnosisOptionsFromFrame(frame);
  }

  async _clickDiagnosisLetter(frame, letter) {
    const safeLetter = String(letter || '')
      .trim()
      .toUpperCase();
    if (!/^[A-Z]$/.test(safeLetter)) return false;

    const roleLink = frame.getByRole('link', { name: new RegExp(`^${safeLetter}$`, 'i') }).first();
    if ((await roleLink.count().catch(() => 0)) > 0) {
      await roleLink.click({ timeout: 5000 }).catch(async () => {
        await roleLink.click({ timeout: 5000, force: true });
      });
      return true;
    }

    const cssLink = frame.locator(`a:has-text("${safeLetter}")`).first();
    if ((await cssLink.count().catch(() => 0)) > 0) {
      await cssLink.click({ timeout: 5000 }).catch(async () => {
        await cssLink.click({ timeout: 5000, force: true });
      });
      return true;
    }
    return false;
  }

  async _clickDiagnosisOption(frame, option = {}) {
    const optionText = String(option?.text || '').trim();
    if (!optionText) return false;
    const escaped = optionText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const byText = frame
      .locator('a[href*="lbtnPrimaryDiagnosis"]')
      .filter({ hasText: new RegExp(`^\\s*${escaped}\\s*$`, 'i') })
      .first();
    if ((await byText.count().catch(() => 0)) > 0) {
      await byText.click({ timeout: 5000 }).catch(async () => {
        await byText.click({ timeout: 5000, force: true });
      });
      return true;
    }

    const row = frame.locator('tr').nth(Number(option?.rowIndex || 0));
    const link = row.locator('a[href*="lbtnPrimaryDiagnosis"]').first();
    if ((await link.count().catch(() => 0)) === 0) return false;
    await link
      .click({ timeout: 5000 })
      .catch(async () => link.click({ timeout: 5000, force: true }));
    return true;
  }

  async _readPrimaryDiagnosisState(page) {
    return page
      .evaluate(() => {
        const get = sel => {
          const el = document.querySelector(sel);
          return el ? String(el.value || '').trim() : '';
        };
        return {
          primaryCode: get('#ctl00_MainContent_uc_MakeClaim_txtprimarydiagnosisCode'),
          primaryText: get('#ctl00_MainContent_uc_MakeClaim_txtprimarydiagnosis'),
          primaryId: get('#ctl00_MainContent_uc_MakeClaim_hfPrimaryDiagnosisID'),
          primaryCodeHidden: get('#ctl00_MainContent_uc_MakeClaim_hfPrimaryDiagnosisCode'),
          acuteArray: get('#ctl00_MainContent_uc_MakeClaim_hfAcute1Array'),
        };
      })
      .catch(() => ({
        primaryCode: '',
        primaryText: '',
        primaryId: '',
        primaryCodeHidden: '',
        acuteArray: '',
      }));
  }

  async _forcePrimaryDiagnosisState(page, option = {}, codeHint = '') {
    const primaryCode = this._normalizeDiagnosisCode(option?.code || codeHint || '');
    const primaryText = String(option?.text || '').trim();
    if (!primaryText && !primaryCode) return;

    await page
      .evaluate(
        ({ code, text }) => {
          const setValue = (selector, value) => {
            if (!selector || value === undefined || value === null) return false;
            const el = document.querySelector(selector);
            if (!el) return false;
            el.value = value;
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
            return true;
          };

          const safeCode = String(code || '').trim();
          const safeText = String(text || '').trim();
          if (safeText) {
            setValue('#ctl00_MainContent_uc_MakeClaim_txtprimarydiagnosis', safeText);
          }
          if (safeCode) {
            setValue('#ctl00_MainContent_uc_MakeClaim_txtprimarydiagnosisCode', safeCode);
            setValue('#ctl00_MainContent_uc_MakeClaim_hfPrimaryDiagnosisCode', safeCode);
            setValue(
              '#ctl00_MainContent_uc_MakeClaim_hfAcute1Array',
              JSON.stringify([{ label: safeText || safeCode, val: safeCode }])
            );
          } else if (safeText) {
            setValue(
              '#ctl00_MainContent_uc_MakeClaim_hfAcute1Array',
              JSON.stringify([{ label: safeText, val: '' }])
            );
          }
        },
        { code: primaryCode, text: primaryText }
      )
      .catch(() => {});
  }

  async _setDiagnosisViaPopup(page, visit, diagnosisText, diagnosisCode) {
    const popupOpened = await this._openDiagnosisPopup(page);
    if (!popupOpened) return { success: false, portalMatch: null };

    const frame = page.frameLocator('#TB_iframeContent');
    const searchInput = frame.locator('#ctl00_PopupPageContent_txtSearchContent');
    const searchBtn = frame.locator('#ctl00_PopupPageContent_btnSearch');
    const searchTerms = this._deriveDiagnosisSearchTerms(visit, diagnosisText);
    const letterCandidates = this._deriveDiagnosisLetterCandidates(searchTerms);
    const codeHint = this._normalizeDiagnosisCode(diagnosisCode || '');
    const minScore = Number(process.env.DIAGNOSIS_MATCH_MIN_SCORE || 90);
    const softMin = Number(process.env.DIAGNOSIS_SOFT_MIN_SCORE || 0.12);

    await frame
      .locator('body')
      .first()
      .waitFor({ timeout: 8000 })
      .catch(() => {});

    const maybeTrackSoftFallback = (options, term) => {
      for (const option of options) {
        const optionText = String(option?.text || '').trim();
        if (!optionText) continue;
        if (this._isLikelyDiagnosisConflict(diagnosisText || term, optionText)) continue;
        const scoreFromDiagnosis = this._softDiagnosisScore(diagnosisText || '', optionText);
        const scoreFromSearchTerm = this._softDiagnosisScore(term || '', optionText);
        const score = Math.max(scoreFromDiagnosis, scoreFromSearchTerm);
        if (score < softMin) continue;
        if (!bestFallback || score > bestFallback.score) {
          bestFallback = { option, term, score };
        }
      }
    };

    const pickMatchedOption = (options, match) => {
      if (!Array.isArray(options) || options.length === 0) return null;
      const selectedText = String(match?.selected_text || '').trim();
      const selectedCode = this._normalizeDiagnosisCode(match?.selected_code || '');
      let chosen =
        options.find(
          opt =>
            String(opt.text || '').trim() === selectedText &&
            (!selectedCode || this._normalizeDiagnosisCode(opt.code || '') === selectedCode)
        ) ||
        options.find(
          opt =>
            String(opt.text || '').trim() === selectedText &&
            this._normalizeDiagnosisCode(opt.code || '')
        ) ||
        options.find(opt => String(opt.text || '').trim() === selectedText) ||
        null;
      if (!chosen) return null;
      if (!this._normalizeDiagnosisCode(chosen.code || '') && selectedCode) {
        chosen = { ...chosen, code: selectedCode };
      }
      return chosen;
    };

    let selectedOption = null;
    let portalMatch = null;
    let bestFallback = null;
    for (const term of searchTerms) {
      if ((await searchInput.count().catch(() => 0)) > 0) {
        await searchInput.fill(term).catch(() => {});
      }
      if ((await searchBtn.count().catch(() => 0)) > 0) {
        await searchBtn.click({ timeout: 5000 }).catch(() => {});
      }

      const options = await this._collectDiagnosisOptionsWithWait(page, frame, 6500);
      logger.info('[GE DX] search term results', { term, optionCount: options.length });
      if (!options.length) continue;
      const match = resolveDiagnosisAgainstPortalOptions({
        diagnosis: {
          code: codeHint || null,
          description: diagnosisText || term,
        },
        portalOptions: options,
        minScore,
        codeMode: 'secondary',
      });
      if (!match || match.blocked !== false) {
        maybeTrackSoftFallback(options, term);
        continue;
      }

      selectedOption = pickMatchedOption(options, match);
      if (!selectedOption) continue;
      const clicked = await this._clickDiagnosisOption(frame, selectedOption);
      logger.info('[GE DX] match candidate click', {
        term,
        selectedText: selectedOption?.text || null,
        selectedCode: selectedOption?.code || null,
        clicked,
      });
      if (!clicked) continue;

      portalMatch = {
        portal: 'GE_NTUC',
        match_text: match.selected_text || selectedOption.text || null,
        match_score: match.match_score || 0,
        match_method: 'search',
        matched_by: /code/.test(match.match_reason || '') ? 'icd_hint' : 'token_fuzzy',
      };
      break;
    }

    if (!selectedOption) {
      for (const letter of letterCandidates) {
        const clickedLetter = await this._clickDiagnosisLetter(frame, letter);
        if (!clickedLetter) continue;
        const options = await this._collectDiagnosisOptionsWithWait(page, frame, 6000);
        logger.info('[GE DX] letter results', { letter, optionCount: options.length });
        if (!options.length) continue;

        const match = resolveDiagnosisAgainstPortalOptions({
          diagnosis: {
            code: codeHint || null,
            description: diagnosisText || letter,
          },
          portalOptions: options,
          minScore,
          codeMode: 'secondary',
        });
        if (!match || match.blocked !== false) {
          maybeTrackSoftFallback(options, `letter:${letter}`);
          continue;
        }

        selectedOption = pickMatchedOption(options, match);
        if (!selectedOption) continue;
        const clicked = await this._clickDiagnosisOption(frame, selectedOption);
        logger.info('[GE DX] letter candidate click', {
          letter,
          selectedText: selectedOption?.text || null,
          selectedCode: selectedOption?.code || null,
          clicked,
        });
        if (!clicked) continue;
        portalMatch = {
          portal: 'GE_NTUC',
          match_text: match.selected_text || selectedOption.text || null,
          match_score: match.match_score || 0,
          match_method: 'search',
          matched_by: /code/.test(match.match_reason || '') ? 'icd_hint' : 'token_fuzzy',
          fallback_source: 'alphabet_list',
        };
        break;
      }
    }

    if (!selectedOption && bestFallback?.option) {
      selectedOption = bestFallback.option;
      const fallbackTerm = String(bestFallback?.term || '').trim();
      if (fallbackTerm && !fallbackTerm.startsWith('letter:')) {
        if ((await searchInput.count().catch(() => 0)) > 0) {
          await searchInput.fill(fallbackTerm).catch(() => {});
        }
        if ((await searchBtn.count().catch(() => 0)) > 0) {
          await searchBtn.click({ timeout: 5000 }).catch(() => {});
        }
        const options = await this._collectDiagnosisOptionsWithWait(page, frame, 6000);
        const refreshed = options.find(
          opt =>
            String(opt?.text || '').trim() === String(selectedOption?.text || '').trim() &&
            this._normalizeDiagnosisCode(opt?.code || '') ===
              this._normalizeDiagnosisCode(selectedOption?.code || '')
        );
        if (refreshed) selectedOption = refreshed;
      }

      const clicked = await this._clickDiagnosisOption(frame, selectedOption);
      logger.info('[GE DX] soft fallback click', {
        selectedText: selectedOption?.text || null,
        selectedCode: selectedOption?.code || null,
        fallbackTerm: bestFallback?.term || null,
        score: bestFallback?.score || 0,
        clicked,
      });
      if (!clicked) {
        return { success: false, portalMatch: null };
      }
      portalMatch = {
        portal: 'GE_NTUC',
        match_text: selectedOption.text || null,
        match_score: Math.round((bestFallback.score || 0) * 100),
        match_method: 'search',
        matched_by: 'fallback_soft_text',
        fallback_search_term: bestFallback.term || null,
      };
    }

    if (!selectedOption) {
      const allowGenericFallback = process.env.DIAGNOSIS_ALLOW_GENERIC_FALLBACK !== '0';
      logger.warn('[GE DX] no portal option selected', {
        allowGenericFallback,
        searchTerms,
      });
      if (!allowGenericFallback) return { success: false, portalMatch: null };

      await page
        .locator('#TB_closeAjaxWindow')
        .first()
        .click({ timeout: 2000 })
        .catch(() => {});
      await page.keyboard.press('Escape').catch(() => {});
      await page
        .waitForSelector('#TB_iframeContent', { state: 'detached', timeout: 3000 })
        .catch(() => {});

      const genericOption = {
        code: process.env.GE_GENERIC_DRAFT_DIAGNOSIS_CODE || 'R52',
        text: process.env.GE_GENERIC_DRAFT_DIAGNOSIS_TEXT || 'Pain, not elsewhere classified',
      };
      await this._forcePrimaryDiagnosisState(page, genericOption, diagnosisCode);
      const state = await this._readPrimaryDiagnosisState(page);
      const hasCode = Boolean(state?.primaryCode || state?.primaryCodeHidden);
      const hasText = Boolean(state?.primaryText);
      if (!hasText || !hasCode) return { success: false, portalMatch: null };

      return {
        success: true,
        portalMatch: {
          portal: 'GE_NTUC',
          match_text: genericOption.text,
          match_score: 0,
          match_method: 'generic_fallback',
          matched_by: 'generic_draft_fallback',
        },
        diagnosisState: state,
        selectedOption: genericOption,
      };
    }

    await page.waitForTimeout(1200);
    await page
      .waitForSelector('#TB_iframeContent', { state: 'detached', timeout: 8000 })
      .catch(() => {});
    await page.waitForLoadState('domcontentloaded').catch(() => {});

    let state = await this._readPrimaryDiagnosisState(page);
    for (let attempt = 1; attempt <= 4; attempt++) {
      const hasCodeNow = Boolean(state?.primaryCode || state?.primaryCodeHidden);
      const hasTextNow = Boolean(state?.primaryText);
      const hasIdentityNow = Boolean(state?.primaryId || state?.acuteArray);
      if (hasTextNow && (hasCodeNow || hasIdentityNow)) break;

      await page
        .waitForSelector('#ctl00_MainContent_uc_MakeClaim_txtprimarydiagnosis', { timeout: 2500 })
        .catch(() => {});
      await this._forcePrimaryDiagnosisState(page, selectedOption, codeHint);
      await page.waitForTimeout(250);
      state = await this._readPrimaryDiagnosisState(page);
    }

    const hasCode = Boolean(state?.primaryCode || state?.primaryCodeHidden);
    const hasText = Boolean(state?.primaryText);
    const hasIdentity = Boolean(state?.primaryId || state?.acuteArray);
    return {
      success: hasText && (hasCode || hasIdentity),
      portalMatch,
      diagnosisState: state,
      selectedOption,
    };
  }

  async _readPortalMessage(page) {
    const labelMessage = await page
      .locator('#ctl00_MainContent_uc_MakeClaim_lblMessage')
      .first()
      .innerText()
      .catch(() => '');
    const normalizedLabel = String(labelMessage || '')
      .replace(/\s+/g, ' ')
      .trim();
    if (normalizedLabel) return normalizedLabel;
    const bannerMessage = await page
      .locator(
        'text=/Please\\s+select\\s+valid|select\\s+a\\s+valid\\s+referral\\s+clinic|Please\\s+select\\s+either/i'
      )
      .first()
      .innerText()
      .catch(() => '');
    return String(bannerMessage || '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  async _readReferralState(page) {
    return page
      .evaluate(() => {
        const get = sel => {
          const el = document.querySelector(sel);
          return el ? String(el.value || '').trim() : '';
        };
        const refValue = get('#ctl00_MainContent_uc_MakeClaim_txtSPReferringGPClinic');
        const refType = get('#ctl00_MainContent_uc_MakeClaim_hfReferenceClinicType');
        const oldRefType = get('#ctl00_MainContent_uc_MakeClaim_hfOldReferenceClinicType');
        const clinicId = get('#ctl00_MainContent_uc_MakeClaim_hfClinicID');
        const parentClinicId = get('input[id$="hfParentClinicID"]');
        return {
          refValue,
          refType,
          oldRefType,
          clinicId,
          parentClinicId,
          hasValidIdentity: Boolean(
            refValue && (refType || oldRefType || clinicId || parentClinicId)
          ),
        };
      })
      .catch(() => ({
        refValue: '',
        refType: '',
        oldRefType: '',
        clinicId: '',
        parentClinicId: '',
        hasValidIdentity: false,
      }));
  }

  async _setReferralHiddenFields(page) {
    return page
      .evaluate(() => {
        const get = sel => document.querySelector(sel);
        const ref = get('#ctl00_MainContent_uc_MakeClaim_txtSPReferringGPClinic');
        const refValue = ref ? String(ref.value || '').trim() : '';
        if (!refValue) return false;

        const refType = get('#ctl00_MainContent_uc_MakeClaim_hfReferenceClinicType');
        const oldRefType = get('#ctl00_MainContent_uc_MakeClaim_hfOldReferenceClinicType');
        const clinic = get('#ctl00_MainContent_uc_MakeClaim_hfClinicID');
        const parent = get('input[id$="hfParentClinicID"]');
        const yes = get('#ctl00_MainContent_uc_MakeClaim_chkHasReferringGPClinicYes');

        if (yes) yes.checked = true;
        if (refType) refType.value = 'Clinic';
        if (oldRefType) oldRefType.value = 'Clinic';
        if (parent && !parent.value && clinic?.value) parent.value = clinic.value;
        return true;
      })
      .catch(() => false);
  }

  async _fetchReferralSuggestion(page, query) {
    const prefix = String(query || '').trim();
    if (!prefix) return null;
    return page
      .evaluate(async value => {
        try {
          const hasJquery = typeof window.$ === 'function' && window.$?.ajax;
          if (!hasJquery) return null;
          const response = await new Promise(resolve => {
            window.$.ajax({
              url: '../../../Services/AutoCompletionService.asmx/SuggestPanelGPClinics',
              data: JSON.stringify({
                prefixText: value,
                count: '6',
                contextKey: 'CLINICSEARCH',
                ClinicID: '',
                insurer: '',
              }),
              dataType: 'json',
              type: 'POST',
              contentType: 'application/json; charset=utf-8',
              success: data => resolve(data),
              error: () => resolve(null),
              failure: () => resolve(null),
            });
          });
          const items = Array.isArray(response?.d) ? response.d : [];
          const options = items
            .map(item => String(item || '').split('|'))
            .map(parts => ({
              label: String(parts?.[0] || '').trim(),
              val: String(parts?.[1] || '').trim(),
            }))
            .filter(option => option.label);
          if (!options.length) return null;
          const lower = value.toLowerCase();
          return (
            options.find(option => option.label.toLowerCase() === lower) ||
            options.find(option => option.label.toLowerCase().includes(lower)) ||
            options[0]
          );
        } catch {
          return null;
        }
      }, prefix)
      .catch(() => null);
  }

  async _ensureReferralClinic(page, visit) {
    const field = page.locator('#ctl00_MainContent_uc_MakeClaim_txtSPReferringGPClinic').first();
    if ((await field.count().catch(() => 0)) === 0) return false;
    const existing = String((await field.inputValue().catch(() => '')) || '').trim();
    if (existing) {
      await this._setReferralHiddenFields(page);
      const state = await this._readReferralState(page);
      if (state.hasValidIdentity) return true;
    }

    const candidates = [
      existing,
      visit?.extraction_metadata?.referringProviderEntity,
      visit?.extraction_metadata?.providerEntityName,
      process.env.GE_REFERRING_GP_CLINIC,
      process.env.ALLIANCE_REFERRING_PROVIDER_ENTITY,
      process.env.ALLIANCE_PROVIDER_ENTITY,
      'SINGAPORE SPORTS & ORTHOPAEDIC CLINIC PTE LTD',
      'SINGAPORE SPORTS',
      'SINGAPORE',
    ]
      .map(v => String(v || '').trim())
      .filter(Boolean);

    for (const candidate of candidates) {
      const suggested = await this._fetchReferralSuggestion(page, candidate);
      const resolvedLabel = String(suggested?.label || candidate || '').trim();
      if (!resolvedLabel) continue;

      await field.click({ timeout: 4000 }).catch(() => {});
      await field.fill('').catch(() => {});
      await field.type(resolvedLabel, { delay: 35 }).catch(async () => {
        await field.fill(resolvedLabel).catch(() => {});
      });
      await page.waitForTimeout(900).catch(() => {});

      const suggestion = page
        .locator(
          'ul.ui-autocomplete li:visible, .ui-menu-item:visible, li[id^="ui-id-"]:visible, .ui-autocomplete li:visible'
        )
        .first();
      if ((await suggestion.count().catch(() => 0)) > 0) {
        await suggestion.click({ timeout: 4000 }).catch(async () => {
          await suggestion.click({ timeout: 4000, force: true });
        });
      } else if (suggested?.label) {
        await field.fill(String(suggested.label || '').trim()).catch(() => {});
      }
      await page.keyboard.press('Tab').catch(() => {});
      await page.waitForTimeout(500).catch(() => {});

      await this._setReferralHiddenFields(page);
      const state = await this._readReferralState(page);
      const normalizedValue = String(state?.refValue || '')
        .trim()
        .toLowerCase();
      const normalizedExpected = String(resolvedLabel || '')
        .trim()
        .toLowerCase();
      const looksLikeExactClinic = Boolean(
        normalizedExpected && normalizedValue === normalizedExpected
      );
      if (state.hasValidIdentity && (looksLikeExactClinic || normalizedValue.length >= 12)) {
        return true;
      }
    }
    await this._setReferralHiddenFields(page);
    const finalState = await this._readReferralState(page);
    if (finalState.hasValidIdentity) return true;
    return false;
  }

  async _detectSaveButton(page) {
    const candidates = page.locator(
      'input[type="submit"], input[type="button"], button, input[type="image"]'
    );
    const count = await candidates.count().catch(() => 0);
    if (!count) return null;
    for (let i = 0; i < count; i++) {
      const el = candidates.nth(i);
      const text = (await el.textContent().catch(() => '')) || '';
      const value = (await el.getAttribute('value').catch(() => '')) || '';
      const id = (await el.getAttribute('id').catch(() => '')) || '';
      const blob = `${text} ${value} ${id}`.toLowerCase();
      if (!blob.trim()) continue;
      if (blob.includes('cancel') || blob.includes('reload') || blob.includes('calculate'))
        continue;
      if (blob.includes('save') || blob.includes('draft')) {
        return { locator: el, label: blob };
      }
    }
    return null;
  }

  async _clickCalculateClaim(page, attemptLabel = 'initial') {
    const calcButton = page
      .locator(
        '#ctl00_MainContent_uc_MakeClaim_btncalculateclaim, input[value*="Calculate Claim" i], button:has-text("Calculate Claim")'
      )
      .first();
    const count = await calcButton.count().catch(() => 0);
    if (!count) {
      logger.warn('[SUBMIT] GE calculate button missing', { attemptLabel });
      return false;
    }

    await calcButton
      .click({ timeout: 7000 })
      .catch(async () => calcButton.click({ timeout: 7000, force: true }));
    await page.waitForLoadState('domcontentloaded').catch(() => {});
    await page.waitForTimeout(1000);
    logger.info('[SUBMIT] GE calculate triggered', { attemptLabel });
    return true;
  }

  async _ensureCalculateButtonReady(page) {
    const calcButton = page
      .locator(
        '#ctl00_MainContent_uc_MakeClaim_btncalculateclaim, input[value*="Calculate Claim" i], button:has-text("Calculate Claim")'
      )
      .first();
    if ((await calcButton.count().catch(() => 0)) > 0) return true;

    const reload = page.locator('#ctl00_MainContent_uc_MakeClaim_btnReloadData').first();
    if ((await reload.count().catch(() => 0)) > 0) {
      await reload.click({ timeout: 5000 }).catch(async () => {
        await reload.click({ timeout: 5000, force: true });
      });
      await page.waitForLoadState('domcontentloaded').catch(() => {});
      await page.waitForTimeout(500);
      if ((await calcButton.count().catch(() => 0)) > 0) return true;
    }

    await page
      .evaluate(() => {
        if (typeof window.__doPostBack !== 'function') return false;
        window.__doPostBack('ctl00$MainContent$uc_MakeClaim$ddlFeeType', '');
        return true;
      })
      .catch(() => false);
    await page.waitForLoadState('domcontentloaded').catch(() => {});
    await page.waitForTimeout(500);
    return (await calcButton.count().catch(() => 0)) > 0;
  }

  async _calculateUntilSaveReady(page, visit) {
    for (let attempt = 1; attempt <= 4; attempt++) {
      const clicked = await this._clickCalculateClaim(page, `attempt-${attempt}`);
      if (!clicked) {
        const ready = await this._ensureCalculateButtonReady(page);
        if (!ready) {
          return { saveBtn: null, message: 'Calculate Claim button not available on GE form' };
        }
        continue;
      }
      const saveBtn = await this._detectSaveButton(page);
      if (saveBtn) return { saveBtn, message: null };

      const message = await this._readPortalMessage(page);
      const lower = String(message || '').toLowerCase();
      if (
        lower.includes('referral clinic') ||
        lower.includes('valid referral') ||
        lower.includes('referring gp clinic')
      ) {
        const referralOk = await this._ensureReferralClinic(page, visit);
        if (!referralOk) {
          return { saveBtn: null, message: message || 'Referral clinic required but unresolved' };
        }
        continue;
      }

      if (
        lower.includes('valid diagnosis') ||
        lower.includes('select either a chronic diagnosis')
      ) {
        return { saveBtn: null, message: message || 'Diagnosis not accepted by portal state' };
      }

      if (message) {
        return { saveBtn: null, message };
      }
      await page.waitForTimeout(600);
    }
    return {
      saveBtn: await this._detectSaveButton(page),
      message: 'Calculate Claim did not reach save-ready state',
    };
  }

  async submit(visit, runtimeCredential = null) {
    if (this.steps?.step) {
      this.steps.step(2, 'Submitting to GE / NTUC IM portal service');
    }

    const metadata = visit?.extraction_metadata || {};
    const nric = this._pickNricForVisit(visit, metadata);
    if (!nric) {
      return {
        success: false,
        reason: 'missing_nric',
        error: 'NRIC not found in visit record for GE / NTUC IM',
        portal: 'GE_NTUC',
        portalService: 'GE_NTUC',
        portalUrl: runtimeCredential?.url || PORTALS.GE_NTUC?.url || null,
        savedAsDraft: false,
        submitted: false,
      };
    }

    if (!this.allianceAutomation) {
      return {
        success: false,
        reason: 'missing_alliance_automation',
        error: 'GE / NTUC IM flow requires Alliance Medinet automation context',
        portal: 'GE_NTUC',
        portalService: 'GE_NTUC',
        portalUrl: runtimeCredential?.url || PORTALS.GE_NTUC?.url || null,
        savedAsDraft: false,
        submitted: false,
      };
    }

    const visitDate = visit?.visit_date || visit?.visitDate || null;
    const _formattedDate = this._formatDateForGE(visitDate);
    const mcDays = Number.isFinite(Number(metadata?.mcDays))
      ? String(Number(metadata.mcDays))
      : '0';
    const mcReason = this._deriveMcReason(visit);
    const diagnosisText = this._deriveDiagnosisText(visit);
    const diagnosisCode = this._deriveDiagnosisCode(visit);
    const feeType = this._deriveFeeType(visit);
    const feeAmount = this._deriveFeeAmount(visit);
    const remarks = String(visit?.treatment_detail || visit?.treatmentDetail || '').trim();
    const saveDraftEnabled = process.env.WORKFLOW_SAVE_DRAFT !== '0';

    try {
      // Check if the GE/NTUC panel-claim popup was already captured during a prior
      // Alliance Medinet reroute for THIS visit. If so, skip the redundant
      // login→search→selectMember flow and go straight to the popup. The
      // popup must be tagged with the current NRIC; otherwise it belongs to
      // a previous visit in the batch and must be discarded.
      let popup = this.allianceAutomation.lastGePopupPage;
      const popupNric = this.allianceAutomation.lastGePopupNric || null;
      const popupAlreadyCaptured = popup && !popup.isClosed() && popupNric === nric;
      if (popup && !popup.isClosed() && popupNric && popupNric !== nric) {
        logger.warn('[GE] Discarding stale GE/NTUC popup captured for a different NRIC', {
          capturedFor: popupNric,
          currentNric: nric,
        });
        try {
          await popup.close();
        } catch {
          // ignore
        }
        this.allianceAutomation.lastGePopupPage = null;
        this.allianceAutomation.lastGePopupUrl = null;
        this.allianceAutomation.lastGePopupNric = null;
      }

      if (popupAlreadyCaptured) {
        logger.info(
          '[GE] GE/NTUC popup already captured from prior Alliance Medinet reroute — skipping redundant search',
          { nric }
        );
      } else {
        // Clear stale popup reference
        this.allianceAutomation.lastGePopupPage = null;
        this.allianceAutomation.lastGePopupUrl = null;
        this.allianceAutomation.lastGePopupNric = null;

        await this.allianceAutomation.login();
        const dateCandidates = this._buildAllianceSearchDateCandidates(visitDate);
        let found = null;
        let lastAddError = null;
        for (let i = 0; i < dateCandidates.length; i++) {
          const dateCandidate = dateCandidates[i];
          await this.allianceAutomation.navigateToMedicalTreatmentClaim();
          found = await this.allianceAutomation.searchMemberByNric(nric, dateCandidate || null);
          if (!found?.found) continue;
          try {
            await this.allianceAutomation.selectMemberAndAdd();
            lastAddError = null;
            break;
          } catch (error) {
            const code = error?.allianceError?.code || null;
            if (code === 'ge_popup_redirect') {
              lastAddError = null;
              break;
            }
            lastAddError = error;
            const canRetryAlternateDate =
              /portal runtime state|claim form did not render/i.test(
                String(error?.message || '')
              ) && i < dateCandidates.length - 1;
            if (!canRetryAlternateDate) throw error;
            logger.warn(
              '[GE] Alliance member add failed for date candidate; retrying alternate date',
              {
                nric,
                visitDateCandidate: dateCandidate,
                nextDateCandidate: dateCandidates[i + 1],
                error: error?.message || String(error),
              }
            );
          }
        }

        if (!found?.found) {
          return {
            success: false,
            reason: 'not_found',
            error: `Member not found in Alliance Medinet for GE route: ${nric}`,
            portal: 'GE_NTUC',
            portalService: 'GE_NTUC',
            portalUrl: runtimeCredential?.url || PORTALS.GE_NTUC?.url || null,
            savedAsDraft: false,
            submitted: false,
          };
        }

        popup = this.allianceAutomation.lastGePopupPage;
        if (!popup) {
          if (lastAddError) throw lastAddError;
          throw new Error('GE popup not captured after Alliance Medinet reroute');
        }
      }

      await popup.waitForLoadState('domcontentloaded').catch(() => {});
      await popup.bringToFront().catch(() => {});
      await popup.waitForTimeout(800);

      const diagnosisResult = await this._setDiagnosisViaPopup(
        popup,
        visit,
        diagnosisText,
        diagnosisCode
      );
      const diagnosisPortalMatch = diagnosisResult?.portalMatch || null;
      logger.info('[GE DX] resolved diagnosis state', {
        state: diagnosisResult?.diagnosisState || null,
        portalMatch: diagnosisPortalMatch,
      });
      if (!diagnosisResult?.success) {
        const screenshotPath = `screenshots/ge-ntuc-diagnosis-missing-${visit?.id || nric}-${Date.now()}.png`;
        await popup.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});
        return {
          success: false,
          reason: 'diagnosis_not_selected',
          error: 'GE / NTUC IM diagnosis selection failed in popup.',
          portal: 'GE_NTUC',
          portalService: 'GE_NTUC',
          portalUrl: runtimeCredential?.url || PORTALS.GE_NTUC?.url || null,
          savedAsDraft: false,
          submitted: false,
          screenshot: screenshotPath,
          diagnosisPortalMatch,
          diagnosisState: diagnosisResult?.diagnosisState || null,
        };
      }

      const feeLabels =
        feeType === 'consultationfee'
          ? ['consultationfee', 'First Consultation Fee', 'First Consultation']
          : feeType === 'followup_consultationfee'
            ? [
                'followup_consultationfee',
                'follow_up_consultationfee',
                'Follow-up Consultation',
                'Follow Up',
                'Follow-up',
              ]
            : [feeType];
      const diagnosisState = diagnosisResult?.diagnosisState || {};
      const selectedDiagnosisOption = diagnosisResult?.selectedOption || {};
      const diagnosisOptionForReapply = {
        code:
          diagnosisState?.primaryCode ||
          diagnosisState?.primaryCodeHidden ||
          selectedDiagnosisOption?.code ||
          diagnosisCode ||
          null,
        text: diagnosisState?.primaryText || selectedDiagnosisOption?.text || diagnosisText || null,
      };

      // Important: avoid changing visit date here. It can trigger postback and clear diagnosis state.
      await this._setSelectValueNoPostback(popup, '#ctl00_MainContent_uc_MakeClaim_ddlMcDay', [
        mcDays,
        Number.isFinite(Number(mcDays)) ? Number(mcDays).toFixed(1) : null,
      ]);
      await this._setInputValueNoPostback(
        popup,
        '#ctl00_MainContent_uc_MakeClaim_txtMcDays',
        mcDays
      );
      await this._setSelectValueNoPostback(
        popup,
        '#ctl00_MainContent_uc_MakeClaim_ddlMcReasons',
        [mcReason, 'Pain - Severe', 'Pain-unspecified'],
        '#ctl00_MainContent_uc_MakeClaim_txtmcreasons'
      );

      // Ensure diagnosis identity is set before fee-type postback to avoid portal resetting fee selection.
      await this._forcePrimaryDiagnosisState(popup, diagnosisOptionForReapply, diagnosisCode);
      const feeTypeState = await this._selectFeeTypeWithFallback(popup, feeLabels);
      logger.info('[SUBMIT] GE fee type selection', feeTypeState);

      // Fee-type changes can clear diagnosis hidden state; reapply deterministically.
      await this._forcePrimaryDiagnosisState(popup, diagnosisOptionForReapply, diagnosisCode);
      await this._setSelectValueNoPostback(popup, '#ctl00_MainContent_uc_MakeClaim_ddlMcDay', [
        mcDays,
        Number.isFinite(Number(mcDays)) ? Number(mcDays).toFixed(1) : null,
      ]);
      await this._setInputValueNoPostback(
        popup,
        '#ctl00_MainContent_uc_MakeClaim_txtMcDays',
        mcDays
      );
      await this._setSelectValueNoPostback(
        popup,
        '#ctl00_MainContent_uc_MakeClaim_ddlMcReasons',
        [mcReason, 'Pain - Severe', 'Pain-unspecified'],
        '#ctl00_MainContent_uc_MakeClaim_txtmcreasons'
      );

      if (feeAmount) {
        await this._setInputValueNoPostback(
          popup,
          '#ctl00_MainContent_uc_MakeClaim_txtFeeAmount',
          feeAmount
        );
      }
      if (remarks) {
        await this._setInputValueNoPostback(
          popup,
          '#ctl00_MainContent_uc_MakeClaim_txtClaimRemarks',
          remarks
        );
      }
      await this._ensureReferralClinic(popup, visit).catch(() => false);
      await this._ensureCalculateButtonReady(popup).catch(() => false);
      await popup.waitForTimeout(800);

      const preCalculateScreenshot = `screenshots/ge-ntuc-filled-before-calculate-${visit?.id || nric}-${Date.now()}.png`;
      await popup.screenshot({ path: preCalculateScreenshot, fullPage: true }).catch(() => {});

      if (!saveDraftEnabled) {
        return {
          success: true,
          portal: 'GE_NTUC',
          portalService: 'GE_NTUC',
          portalUrl: runtimeCredential?.url || PORTALS.GE_NTUC?.url || null,
          savedAsDraft: false,
          submitted: false,
          filledOnly: true,
          screenshot: preCalculateScreenshot,
          diagnosisPortalMatch,
        };
      }

      const calc = await this._calculateUntilSaveReady(popup, visit);
      let saveButton = calc?.saveBtn || null;
      if (!saveButton) {
        saveButton = await this._detectSaveButton(popup);
      }

      const summaryScreenshot = `screenshots/ge-ntuc-after-calculate-${visit?.id || nric}-${Date.now()}.png`;
      await popup.screenshot({ path: summaryScreenshot, fullPage: true }).catch(() => {});

      if (!saveButton) {
        return {
          success: false,
          reason: 'save_button_missing',
          error: calc?.message || 'GE / NTUC IM save/draft control not found after calculate',
          portal: 'GE_NTUC',
          portalService: 'GE_NTUC',
          portalUrl: runtimeCredential?.url || PORTALS.GE_NTUC?.url || null,
          savedAsDraft: false,
          submitted: false,
          screenshot: summaryScreenshot,
          screenshotBeforeCalculate: preCalculateScreenshot,
          diagnosisPortalMatch,
        };
      }

      await saveButton.locator.click({ timeout: 8000 }).catch(async () => {
        await saveButton.locator.click({ timeout: 8000, force: true });
      });
      await popup.waitForLoadState('domcontentloaded').catch(() => {});
      await popup.waitForTimeout(1800);

      const postSaveMessage = await this._readPortalMessage(popup);
      const postSaveLower = String(postSaveMessage || '').toLowerCase();
      if (
        postSaveLower.includes('invalid') ||
        postSaveLower.includes('please select') ||
        postSaveLower.includes('required')
      ) {
        return {
          success: false,
          reason: 'save_validation_failed',
          error: postSaveMessage || 'GE / NTUC save validation failed',
          portal: 'GE_NTUC',
          portalService: 'GE_NTUC',
          portalUrl: runtimeCredential?.url || PORTALS.GE_NTUC?.url || null,
          savedAsDraft: false,
          submitted: false,
          screenshot: summaryScreenshot,
          screenshotBeforeCalculate: preCalculateScreenshot,
          diagnosisPortalMatch,
        };
      }

      const savedScreenshot = `screenshots/ge-ntuc-after-save-${visit?.id || nric}-${Date.now()}.png`;
      await popup.screenshot({ path: savedScreenshot, fullPage: true }).catch(() => {});

      return {
        success: true,
        portal: 'GE_NTUC',
        portalService: 'GE_NTUC',
        portalUrl: runtimeCredential?.url || PORTALS.GE_NTUC?.url || null,
        savedAsDraft: true,
        submitted: false,
        screenshot: preCalculateScreenshot,
        screenshotAfterCalculate: summaryScreenshot,
        screenshotAfterSave: savedScreenshot,
        diagnosisPortalMatch,
      };
    } catch (error) {
      const screenshotPath = `screenshots/ge-ntuc-error-${visit?.id || nric}-${Date.now()}.png`;
      try {
        if (this.allianceAutomation?.lastGePopupPage) {
          await this.allianceAutomation.lastGePopupPage
            .screenshot({ path: screenshotPath, fullPage: true })
            .catch(() => {});
        }
      } catch {}

      logger.warn('[SUBMIT] GE / NTUC IM portal automation failed', {
        visitId: visit?.id || null,
        payType: visit?.pay_type || null,
        error: error?.message || String(error),
      });

      return {
        success: false,
        reason: 'submission_failed',
        error: error?.message || String(error),
        portal: 'GE_NTUC',
        portalService: 'GE_NTUC',
        portalUrl: runtimeCredential?.url || PORTALS.GE_NTUC?.url || null,
        savedAsDraft: false,
        submitted: false,
        screenshot: screenshotPath,
      };
    }
  }
}

// Backward-compatible alias while old imports are still used.
export const GESubmitter = GENtucSubmitter;
