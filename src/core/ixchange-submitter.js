import { PORTALS } from '../config/portals.js';
import { GenericPortalSubmitter, createDefaultSelectors } from './portal-generic-submitter.js';
import { buildIxchangeSubmittedTruthCaptureUnavailable } from './portal-truth/ixchange.js';

function withOverrides(base, overrides) {
  const next = { ...base };
  for (const [key, value] of Object.entries(overrides || {})) {
    if (Array.isArray(value)) {
      next[key] = [...new Set([...(value || []), ...(base[key] || [])])];
      continue;
    }
    next[key] = value;
  }
  return next;
}

function normalizeIdentifier(value) {
  const raw = String(value || '')
    .trim()
    .toUpperCase();
  if (!raw) return '';
  const nric = raw.match(/[STFGM]\d{7}[A-Z]/);
  if (nric) return nric[0];
  return raw.replace(/[^A-Z0-9]/g, '');
}

function extractIxchangeSearchIdentifiers(visit) {
  const md = visit?.extraction_metadata || {};
  const candidates = [
    visit?.nric,
    md?.nric,
    md?.fin,
    md?.idNumber,
    md?.idNo,
    visit?.member_id,
    visit?.memberId,
    md?.member_id,
    md?.memberId,
    md?.healthCardNo,
    md?.healthcardNo,
    md?.externalId,
    md?.staffId,
  ]
    .map(normalizeIdentifier)
    .filter(Boolean);
  return [...new Set(candidates)];
}

const IXCHANGE_PATIENT_ID_SELECTORS = [
  'input#patientId',
  'input[id="patientId"]',
  'input[name*="member" i]',
  'input[id*="member" i]',
  'input[name*="nric" i]',
  'input[id*="nric" i]',
  'input[type="search"]',
];

const IXCHANGE_PATIENT_NAME_SELECTORS = [
  'input#patientName',
  'input[id="patientName"]',
  'input[name="patientName"]',
  'input[name*="patientName" i]',
  'input[id*="patientName" i]',
  'input[placeholder*="Patient Name" i]',
];

function normalizeName(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripLeadingTag(value) {
  return String(value || '')
    .replace(
      /^(?:\s*(?:TAG\s+)?(?:AVIVA|SINGLIFE|MHC|MHCAXA|AIA|AIACLIENT|GE|NTUC_IM|ALLIANZ|ALLIANCE|FULLERT|IHP|PARKWAY|ALL|TOKIOM|ALLIANC|ALLSING|AXAMED|PRUDEN)\s*)+(?:[|:/-]+\s*)*/i,
      ''
    )
    .trim();
}

function reorderClinicAssistName(value) {
  const cleaned = normalizeName(stripLeadingTag(value));
  if (!cleaned) return '';
  const commaMatch = cleaned.match(/^([^,]+),\s*(.+)$/);
  if (commaMatch) {
    return normalizeName(`${commaMatch[2]} ${commaMatch[1]}`);
  }
  const tokens = cleaned.split(/\s+/).filter(Boolean);
  if (tokens.length < 2) return cleaned;
  return normalizeName([...tokens.slice(1), tokens[0]].join(' '));
}

function getIxchangeTags(visit) {
  const md = visit?.extraction_metadata || {};
  const rawPieces = [
    visit?.pay_type,
    md?.pay_type,
    md?.payType,
    md?.portalTag,
    md?.insuranceTag,
    md?.flow3PortalHint,
  ];
  if (Array.isArray(md?.tags)) rawPieces.push(...md.tags);
  const tags = new Set();
  for (const piece of rawPieces) {
    const raw = String(piece || '').toUpperCase();
    if (!raw) continue;
    for (const token of raw.split(/[^A-Z0-9_]+/).filter(Boolean)) {
      tags.add(token);
    }
  }
  return [...tags];
}

function resolveIxchangeMode(visit) {
  const tags = getIxchangeTags(visit);
  if (tags.includes('PARKWAY')) return 'PARKWAY';
  if (tags.includes('ALL')) return 'ALL';
  return 'ALL';
}

function extractIxchangeNameCandidates(visit) {
  const md = visit?.extraction_metadata || {};
  const rawNames = [visit?.patient_name, md?.patient_name, md?.patientName, md?.name];
  const names = [];
  for (const raw of rawNames) {
    const cleaned = normalizeName(stripLeadingTag(raw));
    if (cleaned) names.push(cleaned);
  }
  return [...new Set(names)];
}

function buildIxchangeSearchAttempts({ visit, state, selectors }) {
  const mode = resolveIxchangeMode(visit);
  const idCandidates = extractIxchangeSearchIdentifiers(visit);
  const nameCandidates = extractIxchangeNameCandidates(visit);

  state.search_mode = mode;
  state.search_tags = getIxchangeTags(visit);

  const attempts = [];
  if (mode === 'PARKWAY') {
    for (const id of idCandidates) {
      attempts.push({
        value: id,
        inputSelectors: selectors.searchInputPatientId,
        label: 'parkway_nric',
      });
    }
    return attempts;
  }

  const nameVariants = [];
  for (const name of nameCandidates) {
    const reordered = reorderClinicAssistName(name);
    if (reordered) nameVariants.push(reordered);
    nameVariants.push(name);
  }
  for (const name of [...new Set(nameVariants.map(normalizeName).filter(Boolean))]) {
    attempts.push({
      value: name,
      normalize: false,
      inputSelectors: selectors.searchInputPatientName,
      label: 'all_name',
    });
  }
  return attempts;
}

function buildSelectors() {
  return withOverrides(createDefaultSelectors(), {
    loginUsername: ['input[name*="username" i]', 'input[id*="username" i]'],
    loginPassword: ['input[name*="password" i]', 'input[id*="password" i]'],
    otpInputs: ['input[placeholder*="OTP" i]', 'input[name*="otp" i]', 'input[id*="otp" i]'],
    otpSubmit: ['button:has-text("Submit")', 'button:has-text("Verify")'],
    preSearchClicks: [
      'button:has-text("Search Patient")',
      'a:has-text("Search Patient")',
      'button:has-text("+ Search Patient")',
      'a:has-text("+ Search Patient")',
    ],
    preSearchUrls: [],
    requireSearchProgramType: true,
    searchInputPatientId: IXCHANGE_PATIENT_ID_SELECTORS,
    searchInputPatientName: IXCHANGE_PATIENT_NAME_SELECTORS,
    searchInput: IXCHANGE_PATIENT_ID_SELECTORS,
    searchSubmit: [
      'button#filter-apply-button',
      'button:has-text("Retrieve")',
      'button:has-text("Search")',
      'button:has-text("Query")',
      'input[type="submit"]',
    ],
    searchPostSubmitWaitMs: 7000,
    searchNoResultPatterns: [
      'no patient records found',
      'please collect cash',
      'no record',
      'not found',
    ],
    searchPageIndicators: [
      'input#patientId',
      'input#patientName',
      'button#filter-apply-button',
      'text=Search Patient',
    ],
    formPageIndicators: [
      'input[name*="visitDate" i]',
      'input[name*="diagnosis" i]',
      'textarea[name*="diagnosis" i]',
      'input[name*="claim" i]',
      'button:has-text("Save")',
      'button:has-text("Submit")',
    ],
    searchResultRow: [
      'button:has-text("Next")',
      'input[name="companyNo"]',
      'table tbody tr:has(a:has-text("Select")) a:has-text("Select")',
      'table tbody tr:has(button:has-text("Select")) button:has-text("Select")',
      'table tbody tr:has(a:has-text("Create Visit")) a:has-text("Create Visit")',
      'table tbody tr:has(button:has-text("Create Visit")) button:has-text("Create Visit")',
      'table tbody tr:first-child td a',
      'table tbody tr:first-child td button',
    ],
    preFormClicks: [
      'input[name="companyNo"]',
      'button:has-text("Next")',
      'button:has-text("Create Visit Record")',
    ],
    preFormForceClick: true,
    preFormClickTimeoutMs: 5000,
    preFormPostClickWaitMs: 3000,
    formVisitDate: [
      'input[id^="input-date-"]',
      'input[placeholder*="dd/mm/yyyy" i]',
      'input[name*="visit" i]',
      'input[id*="visit" i]',
    ],
    formDiagnosis: [
      'xpath=//*[contains(normalize-space(.), "Diagnosis")]/following::textarea[1]',
      'xpath=//*[contains(normalize-space(.), "Diagnosis")]/following::input[1]',
      'textarea[name*="diag" i]',
      'input[name*="diag" i]',
      'textarea',
    ],
    formAmount: ['input[name*="claim" i]', 'input[name*="amount" i]'],
    requiredFields: ['visitDate', 'diagnosis', 'fee'],
  });
}

function getProgramTypeCandidates() {
  const fromEnv = String(process.env.IXCHANGE_PROGRAM_TYPE_PRIORITY || '')
    .split(',')
    .map(v => v.trim())
    .filter(Boolean);
  if (fromEnv.length > 0) return fromEnv;
  return ['Corporate'];
}

async function ensureIxchangeSearchReady(page, state = null) {
  const hasSearchInputs = async () =>
    page
      .waitForSelector('input#patientId, input#patientName, button#filter-apply-button', {
        timeout: 2500,
      })
      .then(() => true)
      .catch(() => false);

  const isAccessDenied = async () => {
    const url = String(page.url() || '');
    if (/\/access-denied/i.test(url)) return true;
    const body = await page
      .evaluate(() => String(globalThis.document?.body?.innerText || ''))
      .catch(() => '');
    return /access denied|forbidden|you do not have permission/i.test(body);
  };

  const clickSearchPatientNav = async () => {
    const selectors = [
      'a[href*="/spos/search-patient"]',
      'a:has-text("Search Patient")',
      'button:has-text("Search Patient")',
      'a:has-text("+ Search Patient")',
      'button:has-text("+ Search Patient")',
      '[title*="Search Patient" i]',
      '[aria-label*="Search Patient" i]',
    ];
    for (const selector of selectors) {
      const count = await page
        .locator(selector)
        .first()
        .count()
        .catch(() => 0);
      if (!count) continue;
      await page
        .locator(selector)
        .first()
        .click({ force: true, timeout: 2000 })
        .catch(() => null);
      await page.waitForTimeout(800);
      if (await hasSearchInputs()) return true;
    }
    return false;
  };

  const expandSidebarIfCollapsed = async () => {
    const clicked = await page
      .evaluate(() => {
        const selectors = [
          '.sidebar-minimizer',
          '.app-sidebar .sidebar-minimizer',
          '.app-sidebar [class*="minimizer"]',
          '.app-sidebar [class*="toggle"]',
          '.app-sidebar [class*="toggler"]',
        ];
        for (const selector of selectors) {
          const node = globalThis.document?.querySelector?.(selector);
          if (!node) continue;
          const evt = { bubbles: true, cancelable: true, view: globalThis.window };
          node.dispatchEvent(new globalThis.MouseEvent('mousedown', evt));
          node.dispatchEvent(new globalThis.MouseEvent('mouseup', evt));
          node.dispatchEvent(new globalThis.MouseEvent('click', evt));
          return selector;
        }

        // Bottom-left chevron fallback in collapsed sidebar.
        const nodes = Array.from(
          globalThis.document?.querySelectorAll?.('button, a, span, i, div') || []
        );
        for (const node of nodes) {
          const text = String(node.textContent || '')
            .replace(/\s+/g, ' ')
            .trim();
          const classes = String(node.getAttribute?.('class') || '').toLowerCase();
          if (!text && !classes) continue;
          if (
            text === '<' ||
            text === '‹' ||
            text === '«' ||
            classes.includes('minimizer') ||
            classes.includes('toggler')
          ) {
            const rect = node.getBoundingClientRect?.();
            if (rect && rect.left < 120 && rect.top > globalThis.innerHeight - 160) {
              const evt = { bubbles: true, cancelable: true, view: globalThis.window };
              node.dispatchEvent(new globalThis.MouseEvent('mousedown', evt));
              node.dispatchEvent(new globalThis.MouseEvent('mouseup', evt));
              node.dispatchEvent(new globalThis.MouseEvent('click', evt));
              return 'bottom_left_toggle_fallback';
            }
          }
        }
        return null;
      })
      .catch(() => null);
    if (clicked) await page.waitForTimeout(700);
    return clicked;
  };

  for (let attempt = 0; attempt < 5; attempt += 1) {
    if (await hasSearchInputs()) return true;
    await expandSidebarIfCollapsed();

    if (await isAccessDenied()) {
      if (state) state.sessionState = 'access_denied_recovered';
      await page
        .locator('button:has-text("Go Back"), a:has-text("Go Back")')
        .first()
        .click({ force: true, timeout: 2000 })
        .catch(() => null);
      await page.waitForTimeout(1000);
    }

    if (await clickSearchPatientNav()) return true;
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => null);
    await page.waitForTimeout(900);
    if (await clickSearchPatientNav()) return true;

    // Non-search SPOS page: go to SPOS root and retry via in-app menu.
    if (!/\/spos(\/|$)/i.test(String(page.url() || ''))) {
      await page
        .goto('https://spos.o2ixchange.com/spos', { waitUntil: 'domcontentloaded', timeout: 45000 })
        .catch(() => null);
      await page.waitForTimeout(1200);
    }
  }

  const ready = await hasSearchInputs();
  if (!ready && state) {
    const denied = await isAccessDenied();
    state.sessionState = denied ? 'access_denied_unrecovered' : 'poisoned';
  }
  return ready;
}

async function selectProgramType({ page, state, helpers }) {
  const candidates = getProgramTypeCandidates();
  if (!candidates.length) return false;

  for (const candidate of candidates) {
    const nativeSelected = await page
      .evaluate(value => {
        const normalize = input =>
          String(input || '')
            .toLowerCase()
            .replace(/\s+/g, ' ')
            .trim();
        const target = normalize(value);
        const selects = Array.from(globalThis.document?.querySelectorAll?.('select') || []);
        for (const sel of selects) {
          const options = Array.from(sel.options || []);
          const match = options.find(opt => normalize(opt.textContent).includes(target));
          if (!match) continue;
          sel.value = match.value;
          sel.dispatchEvent(new globalThis.Event('input', { bubbles: true }));
          sel.dispatchEvent(new globalThis.Event('change', { bubbles: true }));
          return true;
        }
        return false;
      }, candidate)
      .catch(() => false);
    if (nativeSelected) {
      state.search_program_type = { mode: 'native_select', value: candidate };
      state.search_program_type_verified = true;
      return true;
    }
  }

  const openProgramSelectors = [
    'xpath=//*[contains(normalize-space(.), "Program Type")]/following::*[@role="combobox"][1]',
    'xpath=//*[contains(normalize-space(.), "Program Type")]/following::*[contains(@class, "indicatorContainer")][1]',
    'xpath=//*[contains(normalize-space(.), "Program Type")]/following::input[contains(@id, "react-select")][1]',
    'button[aria-label*="Clear value" i]',
    '[aria-label*="Clear value" i]',
    'input[id*="react-select"][id*="-input"]',
    '[aria-label*="Program Type" i]',
    '[id*="program" i]',
  ];

  const readProgramTypeText = async () =>
    page
      .evaluate(() => {
        const normalize = input =>
          String(input || '')
            .replace(/\s+/g, ' ')
            .trim();
        const roots = Array.from(globalThis.document?.querySelectorAll?.('*') || []);
        for (const root of roots) {
          const text = normalize(root.textContent);
          if (!/program type/i.test(text)) continue;
          const scope = root.closest('div')?.parentElement || root.parentElement || root;
          const valueNode =
            scope.querySelector('[class*="singleValue"]') ||
            scope.querySelector('[role="combobox"]') ||
            scope.querySelector('input[id*="react-select"][id*="-input"]');
          const valueText = normalize(valueNode?.textContent || valueNode?.value || '');
          if (valueText) return valueText;
        }
        return '';
      })
      .catch(() => '');

  for (const candidate of candidates) {
    const scriptedSelection = await page
      .evaluate(value => {
        const normalize = input =>
          String(input || '')
            .toLowerCase()
            .replace(/\s+/g, ' ')
            .trim();
        const want = normalize(value);

        const all = Array.from(globalThis.document?.querySelectorAll?.('*') || []);
        const labelNode = all.find(node => /program type/i.test(normalize(node.textContent)));
        if (!labelNode) return { ok: false, stage: 'label_not_found' };
        const scope =
          labelNode.closest('div')?.parentElement || labelNode.parentElement || labelNode;
        const clickable =
          scope.querySelector('[class*="control"]') ||
          scope.querySelector('[role="combobox"]') ||
          scope.querySelector('[class*="indicatorContainer"]') ||
          scope.querySelector('input[id*="react-select"]') ||
          scope;
        if (!clickable) return { ok: false, stage: 'control_not_found' };

        const click = el => {
          if (!el) return;
          const evt = { bubbles: true, cancelable: true, view: globalThis.window };
          el.dispatchEvent(new globalThis.MouseEvent('mousedown', evt));
          el.dispatchEvent(new globalThis.MouseEvent('mouseup', evt));
          el.dispatchEvent(new globalThis.MouseEvent('click', evt));
        };

        click(clickable);

        const menuCandidates = Array.from(
          globalThis.document.querySelectorAll('[role="option"], div, li, span')
        );
        const option = menuCandidates.find(node => normalize(node.textContent) === want);
        if (option) {
          click(option);
          return { ok: true, stage: 'option_clicked' };
        }

        const active = globalThis.document.activeElement;
        if (active && typeof active.dispatchEvent === 'function') {
          const inputLike = active.tagName === 'INPUT' || active.tagName === 'TEXTAREA';
          if (inputLike && 'value' in active) {
            active.value = '';
            active.dispatchEvent(new globalThis.Event('input', { bubbles: true }));
            active.value = value;
            active.dispatchEvent(new globalThis.Event('input', { bubbles: true }));
            active.dispatchEvent(
              new globalThis.KeyboardEvent('keydown', { key: 'Enter', bubbles: true })
            );
            active.dispatchEvent(
              new globalThis.KeyboardEvent('keyup', { key: 'Enter', bubbles: true })
            );
            return { ok: true, stage: 'typed_enter' };
          }
        }
        return { ok: false, stage: 'option_not_found' };
      }, candidate)
      .catch(() => ({ ok: false, stage: 'script_error' }));
    if (scriptedSelection?.ok) {
      await page.waitForTimeout(300);
      const selected = await readProgramTypeText();
      if (selected.toLowerCase().includes(candidate.toLowerCase())) {
        state.search_program_type = {
          mode: 'scripted',
          value: candidate,
          stage: scriptedSelection.stage,
        };
        state.search_program_type_verified = true;
        return true;
      }
    }

    let opened = false;
    for (const selector of openProgramSelectors) {
      const clickSel = await helpers.clickFirst([selector], {
        timeout: 900,
        clickTimeout: 1200,
        force: true,
        visibleOnly: false,
      });
      if (clickSel) {
        opened = true;
        break;
      }
    }
    if (!opened) {
      const reactInput = await helpers.waitForFirst(
        ['input[id*="react-select"][id*="-input"]', 'input[id*="react-select"]'],
        { timeout: 900, visibleOnly: false }
      );
      if (reactInput?.locator) {
        await reactInput.locator.click({ force: true, timeout: 1200 }).catch(() => null);
        opened = true;
      }
    }
    if (!opened) continue;
    await page.waitForTimeout(250);

    const escaped = candidate.replace(/"/g, '\\"');
    const optionSelectors = [
      `[role="option"]:has-text("${escaped}")`,
      `[class*="option"]:has-text("${escaped}")`,
      `[class*="menu"] div:has-text("${escaped}")`,
      `li:has-text("${escaped}")`,
      `text=/^\\s*${escaped}\\s*$/i`,
    ];
    const picked = await helpers.clickFirst(optionSelectors, {
      timeout: 1200,
      clickTimeout: 1200,
      force: true,
      visibleOnly: false,
    });
    if (picked) {
      state.search_program_type = { mode: 'combobox', value: candidate, selector: picked };
      await page.waitForTimeout(250);
      const selected = await readProgramTypeText();
      if (!selected || selected.toLowerCase().includes(candidate.toLowerCase())) {
        state.search_program_type_verified = true;
        return true;
      }
    }

    // Fallback for react-select style controls: type candidate and press Enter.
    const fallbackInput = await helpers.waitForFirst(
      ['input[id*="react-select"][id*="-input"]', 'input[id*="react-select"]'],
      { timeout: 1000, visibleOnly: false }
    );
    if (fallbackInput?.locator) {
      await fallbackInput.locator.click({ force: true, timeout: 1200 }).catch(() => null);
      await page.keyboard.press('Control+A').catch(() => null);
      await page.keyboard.type(candidate, { delay: 20 }).catch(() => null);
      await page.keyboard.press('Enter').catch(() => null);
      await page.waitForTimeout(350);
      const selected = await readProgramTypeText();
      if (selected.toLowerCase().includes(candidate.toLowerCase())) {
        state.search_program_type = { mode: 'react_type_enter', value: candidate };
        state.search_program_type_verified = true;
        return true;
      }
    }

    // Keyboard fallback: focus Patient ID then move backward into Program Type control.
    const patientIdInput = await helpers.waitForFirst(
      ['input#patientId', 'input[id="patientId"]'],
      {
        timeout: 1000,
        visibleOnly: true,
      }
    );
    if (patientIdInput?.locator) {
      await patientIdInput.locator.click({ force: true, timeout: 1200 }).catch(() => null);
      await page.keyboard.press('Shift+Tab').catch(() => null);
      await page.keyboard.press('Control+A').catch(() => null);
      await page.keyboard.type(candidate, { delay: 25 }).catch(() => null);
      await page.keyboard.press('Enter').catch(() => null);
      await page.waitForTimeout(350);
      const selected = await readProgramTypeText();
      if (selected.toLowerCase().includes(candidate.toLowerCase())) {
        state.search_program_type = { mode: 'shift_tab_type_enter', value: candidate };
        state.search_program_type_verified = true;
        return true;
      }
    }
  }

  const finalValue = await page
    .evaluate(() => {
      const text = String(globalThis.document?.body?.innerText || '');
      const line = text.split(/\n+/).find(v => /program type/i.test(String(v || '')));
      return String(line || '').trim();
    })
    .catch(() => '');
  state.search_program_type = {
    mode: 'unverified',
    expected: candidates[0] || 'Corporate',
    value: finalValue || null,
  };
  state.search_program_type_verified = false;
  return false;
}

async function acknowledgeVisitDateChangePopup(page, state) {
  const popupText = await page
    .evaluate(() =>
      /change visit date confirmation message/i.test(
        String(globalThis.document?.body?.innerText || '')
      )
    )
    .catch(() => false);
  if (!popupText) return false;
  const clicked = await page
    .locator(
      'button:has-text("Yes"), button:has-text("OK"), .modal-dialog button.btn-primary, .modal button:has-text("Yes")'
    )
    .first()
    .click({ force: true, timeout: 2200 })
    .then(() => true)
    .catch(() => false);
  if (clicked && state) state.visit_date_change_popup = 'yes_clicked';
  await page.waitForTimeout(500);
  return clicked;
}

async function extractIxchangeFeeEvidence(page) {
  return page
    .evaluate(() => {
      const norm = value =>
        String(value || '')
          .replace(/\s+/g, ' ')
          .trim();
      const parseAmount = value => {
        const match = norm(value)
          .replace(/,/g, '')
          .match(/\d+(?:\.\d{1,2})?/);
        if (!match) return '';
        const num = Number(match[0]);
        return Number.isFinite(num) ? num.toFixed(2) : '';
      };

      const directInputs = Array.from(
        globalThis.document?.querySelectorAll?.(
          'input[name*="claim" i], input[name*="amount" i], input[name*="consult" i]'
        ) || []
      );
      for (const input of directInputs) {
        const amount = parseAmount(input.value || '');
        if (!amount) continue;
        const id = norm(input.getAttribute?.('id'));
        const name = norm(input.getAttribute?.('name'));
        return { ok: true, value: amount, source: `input:${name || id || 'amount'}` };
      }

      const rows = Array.from(globalThis.document?.querySelectorAll?.('tr, div') || []);
      for (const row of rows) {
        const text = norm(row.textContent || '');
        if (!/consultation/i.test(text)) continue;
        const amount = parseAmount(text);
        if (!amount) continue;
        return { ok: true, value: amount, source: 'summary:consultation' };
      }

      const body = norm(globalThis.document?.body?.innerText || '');
      const bodyMatch = body.match(
        /consultation[^0-9]{0,25}(\d+(?:\.\d{1,2})?)|grand total[^0-9]{0,25}(\d+(?:\.\d{1,2})?)/i
      );
      const raw = bodyMatch?.[1] || bodyMatch?.[2] || '';
      if (raw) return { ok: true, value: Number(raw).toFixed(2), source: 'body:consultation' };
      return { ok: false, value: '', source: null };
    })
    .catch(() => ({ ok: false, value: '', source: null }));
}

async function ensureIxchangeEditVisitForm({ page, state }) {
  const waitForClaimRoute = async timeoutMs => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const url = String(page.url() || '');
      if (
        /\/spos\/claim\/create-success\/\d+/i.test(url) ||
        /\/spos\/claim\/edit\/\d+/i.test(url)
      ) {
        return url;
      }
      await page.waitForTimeout(500);
    }
    return String(page.url() || '');
  };

  const clickCreateVisitRecord = async () => {
    const clickedSelector = await page
      .locator('button:has-text("Create Visit Record"), a:has-text("Create Visit Record")')
      .first()
      .click({ force: true, timeout: 3000 })
      .then(() => 'button:has-text("Create Visit Record"), a:has-text("Create Visit Record")')
      .catch(() => null);
    if (clickedSelector) return clickedSelector;
    return page
      .evaluate(() => {
        const nodes = Array.from(globalThis.document?.querySelectorAll?.('button, a') || []);
        const target = nodes.find(node =>
          /create visit record/i.test(String(node.textContent || ''))
        );
        if (!target) return null;
        const evt = { bubbles: true, cancelable: true, view: globalThis.window };
        target.dispatchEvent(new globalThis.MouseEvent('mousedown', evt));
        target.dispatchEvent(new globalThis.MouseEvent('mouseup', evt));
        target.dispatchEvent(new globalThis.MouseEvent('click', evt));
        return 'eval:create_visit_record';
      })
      .catch(() => null);
  };

  const waitForEditReady = async timeoutMs => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const ready = await page
        .evaluate(() => {
          const doc = globalThis.document;
          const body = String(doc?.body?.innerText || '').toLowerCase();
          const inputCount = doc?.querySelectorAll?.('input, textarea, select')?.length || 0;
          const hasActions =
            /save & close|close form|submit|void|view patient transaction history/i.test(body);
          const hasMedicalFields =
            /diagnosis|illness type|drug name|in-house services|laboratory services|radiology services/i.test(
              body
            );
          const hasSpinner = Boolean(
            doc?.querySelector?.(
              '.spinner-border, .spinner-grow, [class*="spinner"], [class*="loading"]'
            ) || doc?.querySelector?.('img[src*="loading" i], img[src*="loader" i]')
          );
          return (inputCount >= 3 || (hasActions && hasMedicalFields)) && !hasSpinner;
        })
        .catch(() => false);
      if (ready) return true;
      await page.waitForTimeout(1000);
    }
    return false;
  };

  let currentUrl = String(page.url() || '');
  if (/\/spos\/search-patient/i.test(currentUrl)) {
    // Try once without clicking in case preForm click already triggered transition.
    currentUrl = await waitForClaimRoute(5000);
    if (/\/spos\/search-patient/i.test(currentUrl)) {
      const clickOne = await clickCreateVisitRecord();
      if (clickOne) state.create_visit_click_1 = clickOne;
      currentUrl = await waitForClaimRoute(25000);
    }
    if (/\/spos\/search-patient/i.test(currentUrl)) {
      // One guarded retry because this button is occasionally ignored on first click.
      const clickTwo = await clickCreateVisitRecord();
      if (clickTwo) state.create_visit_click_2 = clickTwo;
      currentUrl = await waitForClaimRoute(25000);
    }
  }

  const editDirectMatch = currentUrl.match(/\/spos\/claim\/edit\/(\d+)/i);
  if (editDirectMatch) {
    const editReady = await waitForEditReady(30000);
    await acknowledgeVisitDateChangePopup(page, state);
    state.form_navigation = {
      mode: editReady ? 'already_edit_route' : 'already_edit_route_pending',
      from: currentUrl,
      to: currentUrl,
      visitId: editDirectMatch[1],
      ready: editReady,
    };
    return;
  }

  const match = currentUrl.match(/\/spos\/claim\/create-success\/(\d+)/i);
  if (!match) return;

  const visitId = match[1];
  await page
    .waitForFunction(
      () =>
        /created a new visit record successfully/i.test(
          String(globalThis.document?.body?.innerText || '')
        ),
      null,
      { timeout: 12000 }
    )
    .catch(() => null);
  await page.waitForTimeout(6000);

  const buttonMeta = await page
    .evaluate(() => {
      const candidates = Array.from(globalThis.document?.querySelectorAll?.('button, a') || []);
      const button = candidates.find(el =>
        /edit visit record/i.test(
          String(el.textContent || '')
            .replace(/\s+/g, ' ')
            .trim()
        )
      );
      if (!button) return null;
      const attrs = {};
      for (const attr of Array.from(button.attributes || [])) {
        attrs[attr.name] = attr.value;
      }
      return {
        tag: button.tagName.toLowerCase(),
        text: String(button.textContent || '').trim(),
        href: button.getAttribute('href') || null,
        onclick: button.getAttribute('onclick') || null,
        attrs,
      };
    })
    .catch(() => null);

  const context = page.context();
  const pagesBefore = context.pages();
  const beforeCount = pagesBefore.length;
  const beforeUrls = pagesBefore.map(p => String(p.url() || ''));
  const networkSummary = {
    responses: [],
    failedRequests: [],
    consoleErrors: [],
    pageErrors: [],
  };
  const responseListener = response => {
    try {
      const url = String(response?.url?.() || '');
      if (!/\/spos\/|\/claim|\/api|ixchange/i.test(url)) return;
      networkSummary.responses.push({
        status: response.status(),
        url,
      });
      if (networkSummary.responses.length > 80) {
        networkSummary.responses.splice(0, networkSummary.responses.length - 80);
      }
    } catch {
      // no-op
    }
  };
  const requestFailedListener = request => {
    try {
      const url = String(request?.url?.() || '');
      if (!/\/spos\/|\/claim|\/api|ixchange/i.test(url)) return;
      networkSummary.failedRequests.push({
        method: request.method(),
        url,
        failure: request.failure()?.errorText || 'unknown',
      });
      if (networkSummary.failedRequests.length > 80) {
        networkSummary.failedRequests.splice(0, networkSummary.failedRequests.length - 80);
      }
    } catch {
      // no-op
    }
  };
  const consoleListener = message => {
    try {
      const type = message?.type?.() || '';
      if (type !== 'error' && type !== 'warning') return;
      const text = String(message?.text?.() || '').trim();
      if (!text) return;
      networkSummary.consoleErrors.push({ type, text });
      if (networkSummary.consoleErrors.length > 50) {
        networkSummary.consoleErrors.splice(0, networkSummary.consoleErrors.length - 50);
      }
    } catch {
      // no-op
    }
  };
  const pageErrorListener = error => {
    try {
      const text = String(error?.message || error || '').trim();
      if (!text) return;
      networkSummary.pageErrors.push({ message: text });
      if (networkSummary.pageErrors.length > 50) {
        networkSummary.pageErrors.splice(0, networkSummary.pageErrors.length - 50);
      }
    } catch {
      // no-op
    }
  };
  page.on('response', responseListener);
  page.on('requestfailed', requestFailedListener);
  page.on('console', consoleListener);
  page.on('pageerror', pageErrorListener);
  const captureClientState = async () =>
    page
      .evaluate(() => {
        const resourceNames = (globalThis.performance?.getEntriesByType?.('resource') || [])
          .map(entry => String(entry?.name || ''))
          .filter(Boolean)
          .slice(-60);
        const lsKeys = (() => {
          try {
            return Object.keys(globalThis.localStorage || {}).slice(0, 40);
          } catch {
            return [];
          }
        })();
        const ssKeys = (() => {
          try {
            return Object.keys(globalThis.sessionStorage || {}).slice(0, 40);
          } catch {
            return [];
          }
        })();
        return {
          readyState: globalThis.document?.readyState || '',
          inputCount:
            globalThis.document?.querySelectorAll?.('input, textarea, select')?.length || 0,
          scriptCount: globalThis.document?.querySelectorAll?.('script')?.length || 0,
          title: globalThis.document?.title || '',
          href: globalThis.location?.href || '',
          resourceNames,
          localStorageKeys: lsKeys,
          sessionStorageKeys: ssKeys,
        };
      })
      .catch(() => null);
  const installInPageNetworkLog = async () => {
    const patchNetwork = () => {
      if (globalThis.__ixNetPatched) return true;
      globalThis.__ixNetPatched = true;
      globalThis.__ixNetLog = [];
      const push = payload => {
        try {
          const entry = { t: new Date().toISOString(), ...payload };
          globalThis.__ixNetLog.push(entry);
          if (globalThis.__ixNetLog.length > 250) {
            globalThis.__ixNetLog.splice(0, globalThis.__ixNetLog.length - 250);
          }
        } catch {
          // no-op
        }
      };
      const originalFetch = globalThis.fetch?.bind(globalThis);
      if (originalFetch) {
        globalThis.fetch = async (...args) => {
          const req = args[0];
          const url = typeof req === 'string' ? req : String(req?.url || '');
          try {
            const response = await originalFetch(...args);
            push({ kind: 'fetch', url, status: response?.status ?? 0 });
            return response;
          } catch (error) {
            push({
              kind: 'fetch',
              url,
              status: 0,
              error: String(error?.message || error || 'unknown'),
            });
            throw error;
          }
        };
      }
      const xhrProto = globalThis.XMLHttpRequest?.prototype;
      if (xhrProto && !xhrProto.__ixWrapped) {
        xhrProto.__ixWrapped = true;
        const originalOpen = xhrProto.open;
        const originalSend = xhrProto.send;
        xhrProto.open = function wrappedOpen(method, url, ...rest) {
          this.__ixMethod = method;
          this.__ixUrl = String(url || '');
          return originalOpen.call(this, method, url, ...rest);
        };
        xhrProto.send = function wrappedSend(...args) {
          this.addEventListener(
            'loadend',
            () => {
              push({
                kind: 'xhr',
                method: String(this.__ixMethod || ''),
                url: String(this.responseURL || this.__ixUrl || ''),
                status: Number(this.status || 0),
                responseSnippet: /\/claim-payment\/claim\//i.test(
                  String(this.responseURL || this.__ixUrl || '')
                )
                  ? String(this.responseText || '').slice(0, 1200)
                  : undefined,
              });
            },
            { once: true }
          );
          return originalSend.apply(this, args);
        };
      }
      return true;
    };
    await page.addInitScript(patchNetwork).catch(() => null);
    return page.evaluate(patchNetwork).catch(() => false);
  };
  const readInPageNetworkLog = async () =>
    page
      .evaluate(() => {
        const logs = Array.isArray(globalThis.__ixNetLog) ? globalThis.__ixNetLog : [];
        return logs.slice(-120);
      })
      .catch(() => []);

  await installInPageNetworkLog();

  const editLocator = page
    .locator('button:has-text("Edit Visit Record"), a:has-text("Edit Visit Record")')
    .first();
  const hasEditLocator = (await editLocator.count().catch(() => 0)) > 0;
  if (hasEditLocator) {
    await editLocator.click({ force: true, timeout: 4000 }).catch(() => null);
    await page.waitForTimeout(3500);
  }

  const afterUrl = String(page.url() || '');
  if (afterUrl && !/\/spos\/claim\/create-success\//i.test(afterUrl)) {
    await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => null);
    let ready = await waitForEditReady(25000);
    if (!ready) {
      // UI-safe recovery: reload current route and wait for form readiness.
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => null);
      await page.waitForTimeout(2200);
      ready = await waitForEditReady(22000);
    }

    const allowDirectUrlRecovery =
      String(process.env.IXCHANGE_ENABLE_DIRECT_URL_RECOVERY || '')
        .trim()
        .toLowerCase() === '1' ||
      String(process.env.IXCHANGE_ENABLE_DIRECT_URL_RECOVERY || '')
        .trim()
        .toLowerCase() === 'true';
    if (!ready && allowDirectUrlRecovery) {
      await page
        .goto(`https://spos.o2ixchange.com/spos/claim/create-success/${visitId}`, {
          waitUntil: 'domcontentloaded',
          timeout: 45000,
        })
        .catch(() => null);
      await page.waitForTimeout(1700);
      const retryEdit = page
        .locator('button:has-text("Edit Visit Record"), a:has-text("Edit Visit Record")')
        .first();
      if ((await retryEdit.count().catch(() => 0)) > 0) {
        await retryEdit.click({ force: true, timeout: 3500 }).catch(() => null);
      }
      await page.waitForTimeout(2500);
      ready = await waitForEditReady(20000);
    }

    await acknowledgeVisitDateChangePopup(page, state);
    state.form_navigation = {
      mode: ready
        ? 'edit_click_navigated'
        : allowDirectUrlRecovery
          ? 'edit_click_navigated_pending_with_direct_recovery'
          : 'edit_click_navigated_pending',
      from: currentUrl,
      to: afterUrl,
      visitId,
      buttonMeta,
      networkSummary,
      clientState: await captureClientState(),
      inPageNetworkLog: await readInPageNetworkLog(),
    };
    page.off('response', responseListener);
    page.off('requestfailed', requestFailedListener);
    page.off('console', consoleListener);
    page.off('pageerror', pageErrorListener);
    return;
  }

  const pagesAfter = context.pages();
  if (pagesAfter.length > beforeCount) {
    const popup = pagesAfter[pagesAfter.length - 1];
    const popupUrl = String(popup?.url?.() || '');
    if (popupUrl && !beforeUrls.includes(popupUrl)) {
      await page
        .goto(popupUrl, { waitUntil: 'domcontentloaded', timeout: 45000 })
        .catch(() => null);
      await page.waitForTimeout(1200);
      await popup.close().catch(() => null);
      await acknowledgeVisitDateChangePopup(page, state);
      state.form_navigation = {
        mode: 'edit_popup_url',
        from: currentUrl,
        to: popupUrl,
        visitId,
        buttonMeta,
        networkSummary,
        clientState: await captureClientState(),
        inPageNetworkLog: await readInPageNetworkLog(),
      };
      page.off('response', responseListener);
      page.off('requestfailed', requestFailedListener);
      page.off('console', consoleListener);
      page.off('pageerror', pageErrorListener);
      return;
    }
  }

  await acknowledgeVisitDateChangePopup(page, state);
  state.form_navigation = {
    mode: 'edit_click_no_navigation',
    from: currentUrl,
    to: String(page.url() || ''),
    visitId,
    buttonMeta,
    networkSummary,
    clientState: await captureClientState(),
    inPageNetworkLog: await readInPageNetworkLog(),
  };
  page.off('response', responseListener);
  page.off('requestfailed', requestFailedListener);
  page.off('console', consoleListener);
  page.off('pageerror', pageErrorListener);
}

/**
 * Dedicated submit service boundary for IXCHANGE portal flow.
 */
export class IXChangeSubmitter {
  constructor(page, steps = null) {
    this.steps = steps;
    this.runtime = new GenericPortalSubmitter({
      page,
      steps,
      portalTarget: 'IXCHANGE',
      portalName: 'IXCHANGE SPOS',
      defaultUrl: PORTALS.IXCHANGE?.url || 'https://spos.o2ixchange.com/login',
      defaultUsername: PORTALS.IXCHANGE?.username || '',
      defaultPassword: PORTALS.IXCHANGE?.password || '',
      supportsOtp: true,
      selectors: buildSelectors(),
      disableDefaultSearchFallback: true,
      searchAttemptBuilder: buildIxchangeSearchAttempts,
      beforeSearch: async ({ page: runPage, state, helpers }) => {
        state.search_page_ready = await ensureIxchangeSearchReady(runPage, state);
        const programSelected = await selectProgramType({ page: runPage, state, helpers });
        if (!programSelected) {
          state.search_program_type_verified = false;
        }
      },
      beforeForm: async ({ page: runPage, state }) => {
        await ensureIxchangeEditVisitForm({ page: runPage, state });
      },
      adjustFillVerification: async ({ page: runPage, fillVerification, state }) => {
        const feeStatus = String(fillVerification?.fee?.status || '');
        if (feeStatus !== 'verified' && feeStatus !== 'readonly') {
          const feeEvidence = await extractIxchangeFeeEvidence(runPage);
          if (feeEvidence?.ok && feeEvidence?.value) {
            fillVerification.fee = {
              ...(fillVerification?.fee || {}),
              status: 'readonly',
              observed: feeEvidence.value,
              selector: `eval:${feeEvidence.source || 'consultation'}`,
              error: fillVerification?.fee?.error || null,
            };
          }
        }
        await acknowledgeVisitDateChangePopup(runPage, state);
        return fillVerification;
      },
    });
  }

  async submit(visit, runtimeCredential = null) {
    if (this.steps?.step) {
      this.steps.step(2, 'Submitting to IXCHANGE portal service');
    }
    return this.runtime.submit(visit, runtimeCredential);
  }

  async captureSubmittedTruthSnapshot({
    visit = null,
    sessionState = 'unknown',
    auditedAt = new Date().toISOString(),
  } = {}) {
    return buildIxchangeSubmittedTruthCaptureUnavailable({
      visit,
      sessionState,
      auditedAt,
    });
  }
}
