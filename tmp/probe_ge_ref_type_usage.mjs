import 'dotenv/config';
import { BrowserManager } from '../src/utils/browser.js';
import { AllianceMedinetAutomation } from '../src/automations/alliance-medinet.js';

const bm = new BrowserManager();
await bm.init();
const page = await bm.newPage();
const auto = new AllianceMedinetAutomation(page);
const nric = process.env.GE_PROBE_NRIC || 'T0801699I';
const date = process.env.GE_PROBE_VISIT_DATE || '2026-02-13';

try {
  await auto.login();
  await auto.navigateToMedicalTreatmentClaim();
  const found = await auto.searchMemberByNric(nric, date);
  if (!found?.found) throw new Error('not found');
  try { await auto.selectMemberAndAdd(); } catch (e) { if ((e?.allianceError?.code || '') !== 'ge_popup_redirect') throw e; }
  const popup = auto.lastGePopupPage;
  await popup.waitForLoadState('domcontentloaded');
  await popup.waitForTimeout(1200);

  const data = await popup.evaluate(() => {
    const scripts = Array.from(document.querySelectorAll('script')).map(s => s.textContent || '').join('\n');
    const lines = scripts.split(/\n/);
    const matches = lines
      .map((line, i) => ({ i: i + 1, line: line.trim() }))
      .filter(x => /hfReferenceClinicType|hfOldReferenceClinicType|hfParentClinicID|txtSPReferringGPClinic|HasReferringGPClinic/i.test(x.line));

    const queryExists = selector => !!document.querySelector(selector);
    return {
      selectors: {
        parent: queryExists('input[id$="hfParentClinicID"]'),
        insurer: queryExists('input[id$="hfInsurer"]'),
        refType: queryExists('#ctl00_MainContent_uc_MakeClaim_hfReferenceClinicType'),
        oldRefType: queryExists('#ctl00_MainContent_uc_MakeClaim_hfOldReferenceClinicType'),
        refInput: queryExists('#ctl00_MainContent_uc_MakeClaim_txtSPReferringGPClinic'),
      },
      matchedLines: matches.slice(0, 250),
    };
  });
  console.log(JSON.stringify(data, null, 2));
} catch (e) {
  console.error(e?.stack || String(e));
} finally {
  await bm.close().catch(() => {});
}
