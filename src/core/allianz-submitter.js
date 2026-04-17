import { PORTALS } from '../config/portals.js';
import { GenericPortalSubmitter, createDefaultSelectors } from './portal-generic-submitter.js';
import { logger } from '../utils/logger.js';

function withOverrides(base, overrides) {
  const next = { ...base };
  for (const [key, list] of Object.entries(overrides || {})) {
    next[key] = [...new Set([...(list || []), ...(base[key] || [])])];
  }
  return next;
}

function buildSelectors() {
  const selectors = withOverrides(createDefaultSelectors(), {
    loginUsername: [
      'input[name="userName"]',
      'input[id="username"]',
      'input[name*="user" i]',
      'input[id*="user" i]',
      // Allianz login page uses table layout — the first text input is Username
      'table input[type="text"]:first-of-type',
      'input[type="text"]',
    ],
    loginPassword: [
      'input[name="password"]',
      'input[id="password"]',
      'input[name*="pass" i]',
      'input[type="password"]',
    ],
    loginSubmit: [
      // Allianz AMOS portal uses <input type="submit" value="LOGIN">
      'input[type="submit"][value*="LOGIN" i]',
      'input[type="submit"]',
      'button:has-text("LOGIN")',
      'button:has-text("Login")',
      // Allianz may also use link-styled login buttons inside the login form table
      'a[href*="weoButtonHrefUid"]',
      'td a[onclick]',
      // Broad link matches LAST to avoid clicking sidebar "here" links
      'td:has-text("LOGIN") a',
      'td:has-text("Login") a',
    ],
    otpInputs: ['input[name="otp"]', 'input[id="otp"]'],
    searchInput: [
      'input[name*="policy" i]',
      'input[id*="policy" i]',
      'input[name*="surname" i]',
      'input[id*="surname" i]',
      'input[name*="memberId" i]',
      'input[id*="memberId" i]',
      'input[name*="memberNo" i]',
      'input[name*="nric" i]',
      'input[id*="nric" i]',
      'input[name*="dob" i]',
      'input[id*="dob" i]',
      'input[type="text"]',
    ],
    searchSubmit: [
      // AMOS portal: SEARCH button is rendered as:
      //   <td id="Searchbutton_TD" class="Disabled" onclick="weoButtonOnClickUid(...)">Search</td>
      //   <a id="Searchbutton_A" href="javascript:weoButtonHrefUid('WeoButtonPane_0_0')">Search</a>
      // The nav tab "Search" has different IDs (_WEOMENUITEM_tpaSearchMenu_*).
      // The CSS visual makes "Search" appear as "SEARCH" in screenshots.
      'a#Searchbutton_A',
      'td#Searchbutton_TD',
      'a[href*="weoButtonHrefUid(\'WeoButtonPane_0"]',
      // Generic fallbacks
      'input[type="button"][value="SEARCH" i]',
      'input[type="submit"][value="SEARCH" i]',
    ],
    // searchResultRow is set after withOverrides — see below
    // Detect search failures / required field errors from AMOS
    searchNoResultPatterns: [
      // NOTE: intentionally NOT matching the baseline "to search, please fill in
      // policy number..." instruction text — it is always present on the search
      // page, even when our own SEARCH click was a no-op (disabled button), and
      // would cause a silent false "not_found" that skips to the next attempt.
      /date of birth.*required/i,
      /please enter.*date of birth/i,
      /no matching.*found/i,
      /no policies? found/i,
      /no member/i,
      /invalid search/i,
    ],
    // Detect if we're still on the search page (not a result/form page)
    searchPageIndicators: ['input[name*="surname" i]', 'input[name*="policyNumber" i]'],
    formPageIndicators: [
      'textarea[name*="diagnosisDescription" i]',
      'input[name*="diagnosisCode" i]',
      'input[name*="claimAmount" i]',
      'textarea[name*="diagnosis" i]',
      'input[name*="diagnosis" i]',
      'button:has-text("Submit")',
      'button:has-text("Save")',
    ],
    formDiagnosis: [
      'textarea[name*="diagnosisDescription" i]',
      'input[name*="diagnosisCode" i]',
      'textarea[name*="diagnosis" i]',
      'input[name*="diagnosis" i]',
    ],
    formAmount: [
      'input[name*="claimAmount" i]',
      'input[id*="claimAmount" i]',
      'input[name*="amount" i]',
      'input[id*="amount" i]',
    ],
    formVisitDate: [
      'input[name*="treatmentDate" i]',
      'input[id*="treatmentDate" i]',
      'input[name*="visitDate" i]',
      'input[id*="visitDate" i]',
      'input[name*="dateOfVisit" i]',
    ],
    requiredFields: ['diagnosis'],
  });
  // REPLACE (not merge) searchResultRow — AMOS layout tables create false positives
  // with the broad default selectors. The real AMOS search-results page renders
  // rows as <tr onclick="rowSelectToView(this)"> containing a Status cell
  // ("In Force" / "Out of Force") and policy number. Clicking only SELECTS the
  // row — ensureAllianzClaimForm() then has to click the "View Policy" button.
  // Prefer In-Force rows so we don't pick a stale/unrelated Out-of-Force match.
  selectors.searchResultRow = [
    // AMOS policy search results render as <tr id="policies_tr_N" onclick="rowSelectToView(this)">.
    // policies_tr_1 is the first row in result order; the server can return an
    // Out-of-Force match first, so we prefer the 2nd-onward rows. In practice
    // the AMOS backend returns In-Force policies after any Out-of-Force ones.
    // The more specific In-Force filter is applied via pickSearchResult() below
    // (the portal-generic runner's CSS layer uses plain attribute selectors).
    '#policies_tr_2',
    '#policies_tr_3',
    '#policies_tr_4',
    '#policies_tr_5',
    '#policies_tr_6',
    'tr[id^="policies_tr_"]',
    // Legacy AMOS variants that expose per-row "Select"/"View" anchor
    'table tbody tr:has(a:text-is("Select")) a:text-is("Select")',
    'table tbody tr:has(a:text-is("View")) a:text-is("View")',
  ];
  // Numeric config values — set directly (withOverrides only handles arrays)
  // AMOS is slow: the SEARCH click returns before navigation commits, then the
  // results page takes up to 30–60 seconds to render (AMOS backend is slow,
  // and Akamai edge can further delay). Post-submit wait is small so we don't
  // burn time on the old page; the navigate-poll (below) waits up to 60s for
  // policy rows to actually appear in the DOM (it short-circuits as soon as
  // any searchResultRow selector matches).
  selectors.searchPostSubmitWaitMs = 2000;
  // AMOS server is genuinely slow — 90–120 seconds from POST to results
  // render is normal. Navigate-poll is cheap (400ms intervals + locator.count)
  // so a 150s budget doesn't burn time when rows appear earlier.
  selectors.searchNavigateTimeoutMs = 150000;
  selectors.searchResultUrlPattern = '/forms/tpa/search\\.do';
  selectors.searchResultPresenceTimeoutMs = 15000;
  selectors.searchResultTimeoutMs = 10000;
  return selectors;
}

/**
 * Navigate from member profile / dashboard to the claim submission form.
 * Allianz portals typically require clicking "New Claim" or "Submit Claim"
 * after member search lands on a profile/coverage page.
 */
async function ensureAllianzClaimForm({ page, state, helpers }) {
  const isClaimFormVisible = async () => {
    const found = await helpers.waitForFirst(
      [
        'textarea[name*="diagnosisDescription" i]',
        'input[name*="diagnosisCode" i]',
        'textarea[name*="diagnosis" i]',
        'input[name*="diagnosis" i]',
        'input[name*="claimAmount" i]',
      ],
      { timeout: 2000 }
    );
    return Boolean(found);
  };

  // Entry snapshot — AMOS's row onclick=rowSelectToView may trigger an
  // async navigation that takes 60–120 seconds to settle (same slow-POST
  // pattern as search). Log the URL now so we can tell whether we're still
  // on the search results page or already mid-redirect.
  state.claim_form_entry_url = page.url();
  logger.info('[ALLIANZ] ensureAllianzClaimForm entry', {
    url: state.claim_form_entry_url,
  });
  // Give the row-select onclick a chance to settle — AMOS sometimes fires
  // a POST after the row click that takes ~60s to commit a new page state.
  // Poll until URL stabilizes or until we see a View Policy button or the
  // claim form directly. Cap at 90s.
  const settleDeadline = Date.now() + 90000;
  let lastSettleUrl = page.url();
  let settleIters = 0;
  while (Date.now() < settleDeadline) {
    await page.waitForTimeout(500).catch(() => null);
    settleIters += 1;
    const curUrl = page.url();
    const viewBtnCount = await page
      .locator('a#BnView_A')
      .count()
      .catch(() => 0);
    // IMPORTANT: form-input selectors are intentionally narrower than before —
    // the earlier generic `input[name*="diagnosis" i]` also matched inputs that
    // happen to share substrings on the search-results page, causing a false
    // early break. Require a true claim-form marker.
    const formInputCount = await page
      .locator(
        'input[name*="claimAmount" i], input[name*="treatmentDate" i], textarea[name*="diagnosisDescription" i]'
      )
      .count()
      .catch(() => 0);
    if (settleIters === 1 || settleIters % 6 === 0) {
      logger.info('[ALLIANZ] settle iter', {
        iter: settleIters,
        url: curUrl,
        viewBtnCount,
        formInputCount,
      });
    }
    if (viewBtnCount > 0 || formInputCount > 0) break;
    if (curUrl !== lastSettleUrl) lastSettleUrl = curUrl;
    if (/\/login\.do/i.test(curUrl)) break; // session died — bail fast
  }
  state.claim_form_settled_url = page.url();
  state.claim_form_settle_iters = settleIters;
  logger.info('[ALLIANZ] ensureAllianzClaimForm settled', {
    url: state.claim_form_settled_url,
    iters: settleIters,
  });

  // Session conflict detection — Allianz kicks out when another tab/session is open
  const bodyText = await page
    .evaluate(() => String(globalThis.document?.body?.innerText || ''))
    .catch(() => '');
  const sessionConflict =
    /only one browser window.*can be open|click here to login again|session has expired|your session.*expired|you have been logged out/i.test(
      bodyText
    );
  if (sessionConflict) {
    state.claim_form_navigation = 'session_conflict_relogin';
    // Click "here" link to go back to login page — the generic submitter will re-authenticate
    await helpers.clickFirst(
      ['a:has-text("here")', 'a:has-text("login again")', 'a:has-text("Login")'],
      { timeout: 3000 }
    );
    await page.waitForTimeout(2000);
    // Navigate to the login URL so the login flow can re-run
    const loginUrl = PORTALS.ALLIANZ?.url || 'https://my.allianzworldwidecare.com/sol/login.do';
    await page.goto(loginUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => null);
    await page.waitForTimeout(1500);
    throw new Error(
      'Allianz session conflict detected — portal allows only one browser window. Re-login required.'
    );
  }

  if (await isClaimFormVisible()) {
    state.claim_form_navigation = 'already_on_form';
    return;
  }

  // AMOS-specific: after the Surname+DOB search, the user lands on a policy
  // search-results page with selectable rows. Clicking a row only SELECTS it
  // (onclick="rowSelectToView(this)"); we still need to press VIEW POLICY to
  // navigate into the policy + claim flow. The search-row click already fired,
  // so the In-Force row should be selected; click View Policy now.
  const onSearchResultsPage = await page
    .locator('a#BnView_A')
    .count()
    .catch(() => 0);
  if (onSearchResultsPage > 0) {
    // DEFENSIVE: re-fire rowSelectToView via JS to make sure AMOS has the
    // selected-policy state it expects. Playwright's row click may not
    // guarantee the onclick handler fully ran. Pick the first In-Force row
    // (or fall back to the 2nd row).
    const selectedRow = await page
      .evaluate(() => {
        const rows = Array.from(
          globalThis.document?.querySelectorAll?.('tr[id^="policies_tr_"]') || []
        );
        // Prefer an In-Force row over Out-of-Force
        const inForce = rows.find(r => /in\s*force/i.test(r.textContent || ''));
        const pick = inForce || rows[1] || rows[0];
        if (!pick) return null;
        try {
          if (typeof globalThis.rowSelectToView === 'function') {
            globalThis.rowSelectToView(pick);
          } else {
            pick.click();
          }
        } catch (e) {
          return { err: String(e?.message || e) };
        }
        return { id: pick.id, text: (pick.textContent || '').trim().slice(0, 100) };
      })
      .catch(e => ({ err: String(e?.message || e) }));
    logger.info('[ALLIANZ] re-fired rowSelectToView', { selectedRow });
    state.claim_form_row_reselected = selectedRow;
    await page.waitForTimeout(500).catch(() => null);

    // Capture pre-click state
    const preClickUrl = page.url();
    const preClickBody = await page
      .evaluate(() => String(globalThis.document?.body?.innerText || '').slice(0, 300))
      .catch(() => '');
    logger.info('[ALLIANZ] pre View-Policy click', {
      url: preClickUrl,
      bodyHead: preClickBody.slice(0, 150),
    });

    const viewClicked = await helpers.clickFirst(['a#BnView_A'], {
      timeout: 3500,
      clickTimeout: 3000,
      force: true,
    });
    state.claim_form_click = viewClicked
      ? `view_policy:${viewClicked}`
      : 'view_policy:click_failed';
    logger.info('[ALLIANZ] View-Policy click result', { viewClicked });

    if (viewClicked) {
      // AMOS does an async nav after BnView_A; poll URL+body every 1.5s for up
      // to 45s (AMOS post-view nav can be as slow as search itself). Log each
      // iteration so a session-kill to login.do is visible in real time.
      const deadline = Date.now() + 45000;
      let iter = 0;
      let lastUrl = preClickUrl;
      while (Date.now() < deadline) {
        await page.waitForTimeout(1500).catch(() => null);
        iter += 1;
        const curUrl = page.url();
        const bodyHead = await page
          .evaluate(() => String(globalThis.document?.body?.innerText || '').slice(0, 300))
          .catch(e => `[eval-err: ${e?.message}]`);
        const urlChanged = curUrl !== lastUrl;
        const onLogin = /\/login\.do/i.test(curUrl) || /please enter your username/i.test(bodyHead);
        const onClaimForm = /treatment date|diagnosis description|claim amount/i.test(bodyHead);
        const onPolicyPage = /policy details|coverage|member details/i.test(bodyHead);
        if (iter === 1 || urlChanged || onLogin || onClaimForm || iter % 4 === 0) {
          logger.info('[ALLIANZ] post View-Policy poll', {
            iter,
            url: curUrl,
            urlChanged,
            onLogin,
            onClaimForm,
            onPolicyPage,
            bodyHead: bodyHead.slice(0, 120),
          });
        }
        state.claim_form_post_view_last_url = curUrl;
        if (onLogin) {
          state.claim_form_navigation = 'session_killed_after_view_policy';
          await page
            .screenshot({
              path: `screenshots/allianz-session-killed-${Date.now()}.png`,
              fullPage: true,
            })
            .catch(() => {});
          throw new Error(
            'Allianz session killed after View Policy click — returned to login page'
          );
        }
        if (onClaimForm) break;
        if (onPolicyPage) break; // may need another click, but we've made progress
        lastUrl = curUrl;
      }
    }

    // ARCHITECTURAL FINDING (confirmed via DOM + Email_us probe on 2026-04-17):
    //
    // The AMOS TPA portal for user "Bone" (Third Party Provider) is READ-ONLY
    // for claim submission. The Policy Details page exposes only:
    //   - Account details / Table of Benefits / Benefit Guide (read-only)
    //   - "Email us" tab → generic support email form (fields: name/email/
    //     subject/body/language); NOT a claim form
    //   - BACK / LOGOUT
    //
    // No "New Claim", "Submit Claim", "Outpatient", or any claim-entry control
    // exists in this portal. Therefore fill_evidence cannot complete a
    // structured form-fill for Allianz via this portal/credential. The
    // appropriate outcome is to treat member-coverage verification as the
    // terminal success for this portal, capture policy details as evidence,
    // and surface a clear diagnosis to the caller.
    //
    // Extract policy details so downstream consumers get something useful.
    const policyDetails = await page
      .evaluate(() => {
        const body = String(globalThis.document?.body?.innerText || '');
        // Policy numbers: e.g. P005351032 (01/01/26 - 31/12/26)
        const policyMatches = [...body.matchAll(/(P\d{9})\s*\(([^)]+)\)/g)].map(m => ({
          policyNumber: m[1],
          coverageWindow: m[2].trim(),
        }));
        // Group contract e.g. "(46947) Mastercard Asia / Pacific Pte. Ltd"
        const groupMatch = body.match(/Group contract:\s*([^\n]+)/i);
        // Policy member / DOB
        const memberMatch = body.match(/Policy member:\s*([^\t\n]+)/i);
        const dobMatch = body.match(/Date of birth:\s*(\d{2}\/\d{2}\/\d{4})/i);
        const statusMatch = body.match(/Policy status:\s*([^\t\n]+)/i);
        const plansMatch = [...body.matchAll(/(MasterCard [A-Za-z ]+Plan)/g)].map(m => m[1].trim());
        return {
          policyNumbers: policyMatches,
          groupContract: groupMatch ? groupMatch[1].trim() : null,
          policyMember: memberMatch ? memberMatch[1].trim() : null,
          dob: dobMatch ? dobMatch[1] : null,
          policyStatus: statusMatch ? statusMatch[1].trim() : null,
          healthcarePlans: plansMatch,
        };
      })
      .catch(() => null);
    logger.info('[ALLIANZ] extracted policy details (read-only portal)', {
      policyDetails,
    });
    state.allianz_policy_details = policyDetails;
    state.claim_form_navigation = 'policy_verified_no_claim_form';

    // Capture the Policy Details screen as evidence
    const stamp = Date.now();
    await page
      .screenshot({
        path: `screenshots/allianz-policy-verified-${stamp}.png`,
        fullPage: true,
      })
      .catch(() => null);
    state.allianz_policy_evidence_screenshot = `screenshots/allianz-policy-verified-${stamp}.png`;

    // Signal the generic submitter that we are DONE and the form-fill step
    // should be skipped gracefully. The generic submitter recognizes the
    // special form state via state.form_state, and the caller interprets
    // 'portal_read_only' as "policy verified, manual submission required".
    state.form_state = 'portal_read_only';
    state.portal_submission_mode = 'policy_verification_only';
    state.detailReason = 'allianz_portal_read_only';
    state.portal_capability_note =
      'AMOS TPA portal (user Bone) provides only Policy Search + Policy Details + Email Us. No electronic claim form is available; claim submission for Allianz must go via an alternative channel (email/fax/direct). Member coverage has been verified as evidence.';
    return; // SKIP the form-fill — there is no form to fill.
  }

  if (await isClaimFormVisible()) {
    state.claim_form_navigation = 'navigated_after_view_policy';
    return;
  }

  // Try clicking common "New Claim" / "Submit Claim" / "Add Claim" links/buttons
  const claimNavSelectors = [
    'a:has-text("New Claim")',
    'button:has-text("New Claim")',
    'a:has-text("Submit Claim")',
    'button:has-text("Submit Claim")',
    'a:has-text("Add Claim")',
    'button:has-text("Add Claim")',
    'a:has-text("Create Claim")',
    'button:has-text("Create Claim")',
    'a:has-text("Outpatient")',
    'button:has-text("Outpatient")',
    'a[href*="claim" i]',
    'a[href*="submit" i]',
  ];

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const clicked = await helpers.clickFirst(claimNavSelectors, {
      timeout: 3000,
      clickTimeout: 2000,
      force: true,
    });
    if (clicked) {
      state.claim_form_click = clicked;
      await page.waitForTimeout(3000);
      if (await isClaimFormVisible()) {
        state.claim_form_navigation = 'navigated_to_form';
        return;
      }
    }

    // Try selecting claim type if a dropdown/radio is present
    const claimTypeSelected = await page
      .evaluate(() => {
        const normalize = v =>
          String(v || '')
            .toLowerCase()
            .replace(/\s+/g, ' ')
            .trim();
        // Look for claim type radios (Outpatient, GP, General)
        const radios = Array.from(
          globalThis.document?.querySelectorAll?.('input[type="radio"]') || []
        );
        for (const radio of radios) {
          const label =
            radio.closest('label')?.textContent ||
            globalThis.document?.querySelector?.(`label[for="${radio.id}"]`)?.textContent ||
            '';
          if (/outpatient|general|gp visit|consultation/i.test(normalize(label))) {
            radio.checked = true;
            radio.dispatchEvent(new globalThis.Event('change', { bubbles: true }));
            radio.dispatchEvent(new globalThis.Event('click', { bubbles: true }));
            return normalize(label);
          }
        }
        // Look for claim type select dropdown
        const selects = Array.from(globalThis.document?.querySelectorAll?.('select') || []);
        for (const sel of selects) {
          const options = Array.from(sel.options || []);
          const match = options.find(opt =>
            /outpatient|general|gp|consultation/i.test(normalize(opt.textContent))
          );
          if (match) {
            sel.value = match.value;
            sel.dispatchEvent(new globalThis.Event('change', { bubbles: true }));
            return normalize(match.textContent);
          }
        }
        return null;
      })
      .catch(() => null);

    if (claimTypeSelected) {
      state.claim_type_selected = claimTypeSelected;
      await page.waitForTimeout(2000);
      // After selecting claim type, may need to click a Continue/Next button
      await helpers.clickFirst(
        [
          'button:has-text("Continue")',
          'button:has-text("Next")',
          'button:has-text("Proceed")',
          'input[type="submit"]',
        ],
        { timeout: 2000 }
      );
      await page.waitForTimeout(2000);
      if (await isClaimFormVisible()) {
        state.claim_form_navigation = 'navigated_via_claim_type';
        return;
      }
    }

    await page.waitForTimeout(1500);
  }

  state.claim_form_navigation = 'form_not_found';
  // Capture screenshot for debugging before failing
  await page
    .screenshot({
      path: `screenshots/allianz-claim-form-not-found-${Date.now()}.png`,
      fullPage: true,
    })
    .catch(() => {});
  throw new Error(
    'Allianz claim form not found after navigation attempts — page may require OTP, different claim type, or portal UI changed'
  );
}

/**
 * Dedicated submit service boundary for Allianz Worldwide Care portal flow.
 */
export class AllianzSubmitter {
  constructor(page, steps = null) {
    this.steps = steps;
    this.runtime = new GenericPortalSubmitter({
      page,
      steps,
      portalTarget: 'ALLIANZ',
      portalName: 'Allianz Worldwide Care',
      defaultUrl: PORTALS.ALLIANZ?.url || 'https://my.allianzworldwidecare.com/sol/login.do',
      defaultUsername: PORTALS.ALLIANZ?.username || '',
      defaultPassword: PORTALS.ALLIANZ?.password || '',
      supportsOtp: true,
      selectors: buildSelectors(),
      beforeSearch: async ({ page: searchPage, state }) => {
        // Log page state before search to diagnose session loss
        const url = searchPage.url();
        const bodySnippet = await searchPage
          .evaluate(() => {
            const text = String(globalThis.document?.body?.innerText || '');
            return text.substring(0, 300);
          })
          .catch(() => '');
        const hasSearchForm = /policy search|surname|date of birth/i.test(bodySnippet);
        const hasLoginForm = /username|password|please enter your/i.test(bodySnippet);

        // Discover clickable elements near "SEARCH" for selector debugging
        const searchButtons = await searchPage
          .evaluate(() => {
            const all = Array.from(
              globalThis.document?.querySelectorAll?.('a, input, button, td') || []
            );
            return all
              .filter(el => {
                const txt = (el.textContent || el.value || '').trim();
                return /^SEARCH$/i.test(txt) || /^search$/i.test(txt.replace(/\s+/g, ''));
              })
              .slice(0, 8)
              .map(el => ({
                tag: el.tagName.toLowerCase(),
                text: (el.textContent || '').trim().substring(0, 30),
                value: el.value || null,
                type: el.type || null,
                id: el.id || null,
                name: el.name || null,
                href: el.href ? el.href.substring(0, 80) : null,
                onclick: el.getAttribute?.('onclick')?.substring(0, 80) || null,
                className: (el.className || '').substring(0, 60),
              }));
          })
          .catch(() => []);

        logger.info('[ALLIANZ] Pre-search page state', {
          url,
          hasSearchForm,
          hasLoginForm,
          bodySnippet: bodySnippet.substring(0, 150),
          searchButtons,
        });
        state.allianz_pre_search_state = hasSearchForm
          ? 'on_search_page'
          : hasLoginForm
            ? 'on_login_page'
            : 'unknown';
        if (hasLoginForm && !hasSearchForm) {
          logger.warn('[ALLIANZ] Session lost before search — page shows login form');
        }

        // Check if the SEARCH button is disabled — AMOS disables it until
        // required fields (Surname + DOB, or Policy Number + DOB) are filled.
        const searchButtonState = await searchPage
          .evaluate(() => {
            const td = globalThis.document?.querySelector?.('#Searchbutton_TD');
            return td
              ? { className: td.className || '', disabled: /disabled/i.test(td.className || '') }
              : null;
          })
          .catch(() => null);
        if (searchButtonState?.disabled) {
          logger.warn('[ALLIANZ] SEARCH button is disabled — AMOS portal requires Date of Birth', {
            buttonClass: searchButtonState.className,
          });
          state.allianz_search_blocked = 'dob_required';
        }
      },
      searchAttemptBuilder: ({ visit }) => {
        const attempts = [];
        // Allianz AMOS portal "Policy search" accepts:
        //   Option A: Policy Number + Date of Birth
        //   Option B: Surname + Date of Birth (or sometimes just Surname)
        //
        // NRIC ≠ Policy Number — never put NRIC into the Policy Number field.
        //
        // visit.dob arrives as ISO YYYY-MM-DD (set by claim-submitter._pickDobForVisit).
        // AMOS date input typically wants DD/MM/YYYY; convert here.
        const fullName = String(visit?.patient_name || '').trim();
        const dobIso = String(visit?.dob || '').trim();
        let dobAmos = '';
        const isoMatch = dobIso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (isoMatch) {
          dobAmos = `${isoMatch[3]}/${isoMatch[2]}/${isoMatch[1]}`;
        }

        let surname = '';
        if (fullName) {
          // For Western names "FIRST LAST" → last part is the surname.
          // For Asian/SG names "SURNAME GIVEN" → first part is the surname.
          // ClinicAssist typically stores names as "SURNAME, GIVEN" or "SURNAME GIVEN".
          // Heuristic: prefer the first whitespace-separated token (SG convention).
          const parts = fullName.split(/\s+/);
          surname = parts.length > 1 ? parts[0].replace(/,$/, '') : fullName;
        }

        const dobInputSelectors = [
          'input[name*="dob" i]',
          'input[id*="dob" i]',
          'input[name*="dateOfBirth" i]',
          'input[id*="dateOfBirth" i]',
          'input[name*="birth" i]',
          'input[id*="birth" i]',
        ];

        // Attempt 1 (preferred): Surname + DOB
        if (surname && dobAmos) {
          attempts.push({
            label: 'surname_and_dob',
            normalize: false,
            value: surname,
            inputSelectors: ['input[name*="surname" i]', 'input[id*="surname" i]'],
            extraInputs: [
              {
                value: dobAmos,
                inputSelectors: dobInputSelectors,
                label: 'dob',
                // AMOS: displaySearchButtonForTPA() only runs on blur/keyup/change
                // of the dob input — Playwright .fill() doesn't trigger it, so the
                // SEARCH button stays .Disabled and the click is a no-op. Press Tab
                // after filling so the onblur handler enables SEARCH.
                blurAfterFill: true,
              },
            ],
          });
        }

        // Attempt 2: Surname only (some AMOS instances allow surname-only search)
        if (surname) {
          attempts.push({
            value: surname,
            inputSelectors: ['input[name*="surname" i]', 'input[id*="surname" i]'],
            label: 'surname_only',
            normalize: false,
          });
        }

        // Attempt 3: NRIC/member ID in NRIC-specific fields only (NOT policy).
        // AMOS typically has no NRIC field, so this is a safety fallback that
        // the continue-on-missing logic will skip cleanly.
        const nric = String(visit?.nric || '')
          .trim()
          .toUpperCase();
        if (nric) {
          attempts.push({
            value: nric,
            inputSelectors: [
              'input[name*="nric" i]',
              'input[id*="nric" i]',
              'input[name*="memberId" i]',
              'input[id*="memberId" i]',
              'input[name*="memberNo" i]',
              // IMPORTANT: Do NOT include policy fields — NRIC ≠ Policy Number
            ],
            label: 'nric_only',
            normalize: false,
          });
        }
        return attempts;
      },
      beforeForm: async ({ page: runPage, state, helpers, visit }) => {
        // The dob_required block is set in beforeSearch when AMOS shows a disabled
        // SEARCH button. Only treat it as a hard failure when we ALSO have no DOB to fill.
        // When visit.dob is present, the search attempt will have filled DOB and the
        // block is stale — clear it and proceed.
        const haveDob = Boolean(String(visit?.dob || '').trim());
        if (state.allianz_search_blocked === 'dob_required' && !haveDob) {
          state.form_detail_reason = 'allianz_dob_required';
          throw new Error(
            'Allianz AMOS portal requires patient Date of Birth to search; ' +
              'DOB is not available in the visit data (extraction_metadata.flow1.dob is empty). ' +
              'Re-run Flow 1 extraction so ClinicAssist DOB is captured for this patient.'
          );
        }
        if (state.allianz_search_blocked === 'dob_required' && haveDob) {
          state.allianz_search_blocked = null;
          state.allianz_dob_supplied = true;
        }
        await ensureAllianzClaimForm({ page: runPage, state, helpers });
      },
    });
  }

  async submit(visit, runtimeCredential = null) {
    if (this.steps?.step) {
      this.steps.step(2, 'Submitting to Allianz portal service');
    }
    return this.runtime.submit(visit, runtimeCredential);
  }
}
