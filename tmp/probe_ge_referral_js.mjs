import 'dotenv/config';
import { BrowserManager } from '../src/utils/browser.js';
import { AllianceMedinetAutomation } from '../src/automations/alliance-medinet.js';

const bm = new BrowserManager();
await bm.init();
const page = await bm.newPage();
const alliance = new AllianceMedinetAutomation(page);

const visitDate = process.env.GE_PROBE_VISIT_DATE || '2026-02-13';
const nric = process.env.GE_PROBE_NRIC || 'T0801699I';

try {
  await alliance.login();
  await alliance.navigateToMedicalTreatmentClaim();
  const found = await alliance.searchMemberByNric(nric, visitDate);
  if (!found?.found) throw new Error('member_not_found');
  try { await alliance.selectMemberAndAdd(); } catch (error) { if ((error?.allianceError?.code || '') !== 'ge_popup_redirect') throw error; }
  const popup = alliance.lastGePopupPage;
  if (!popup) throw new Error('popup_missing');

  await popup.waitForLoadState('domcontentloaded');
  await popup.waitForTimeout(1500);

  const data = await popup.evaluate(() => {
    const html = document.documentElement.outerHTML;
    const find = (needle) => {
      const idx = html.indexOf(needle);
      if (idx < 0) return null;
      const s = Math.max(0, idx - 400);
      const e = Math.min(html.length, idx + 1400);
      return html.slice(s, e);
    };

    const scriptBlocks = Array.from(document.querySelectorAll('script'))
      .map(s => s.textContent || '')
      .filter(Boolean);

    const matches = [];
    const terms = ['txtSPReferringGPClinic', 'SuggestPanelGPClinics', 'hfReferenceClinicType', 'reloadPageOnItemSelected', 'AutoCompletionService'];
    for (const block of scriptBlocks) {
      const compact = block.replace(/\s+/g, ' ');
      for (const t of terms) {
        if (compact.includes(t)) {
          matches.push({ term: t, snippet: compact.slice(Math.max(0, compact.indexOf(t) - 250), Math.min(compact.length, compact.indexOf(t) + 800)) });
        }
      }
    }

    const globals = Object.keys(window)
      .filter(k => /refer|clinic|reload|diagnosis|autocomplete|suggest/i.test(k))
      .slice(0, 120);

    const referralInput = document.querySelector('#ctl00_MainContent_uc_MakeClaim_txtSPReferringGPClinic');
    const acData = referralInput ? (window.jQuery ? window.jQuery(referralInput).data() : null) : null;

    return {
      url: location.href,
      hasJquery: Boolean(window.jQuery),
      htmlFind_refInput: find('txtSPReferringGPClinic'),
      htmlFind_suggestSvc: find('SuggestPanelGPClinics'),
      htmlFind_refType: find('hfReferenceClinicType'),
      scriptMatches: matches.slice(0, 20),
      globals,
      jqDataKeys: acData ? Object.keys(acData) : [],
      jqData: acData || null,
    };
  });

  console.log(JSON.stringify(data, null, 2));
} catch (e) {
  console.error(e?.stack || String(e));
} finally {
  await bm.close().catch(() => {});
}
