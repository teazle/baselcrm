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
  await popup.waitForTimeout(1200);

  const info = await popup.evaluate(() => {
    const inputs = Array.from(document.querySelectorAll('input,select,textarea'))
      .map(el => ({
        tag: el.tagName.toLowerCase(),
        id: el.id || '',
        name: el.name || '',
        type: el.type || '',
        value: String(el.value || ''),
      }))
      .filter(x => /ref|clinic|insurer|parent/i.test(`${x.id} ${x.name}`));

    const referralLabel = Array.from(document.querySelectorAll('td,span,label'))
      .map(el => (el.textContent || '').replace(/\s+/g, ' ').trim())
      .filter(t => /referring gp clinic|referral/i.test(t))
      .slice(0, 30);

    return { inputs, referralLabel };
  });

  console.log(JSON.stringify(info, null, 2));
} catch (e) {
  console.error(e?.stack || String(e));
} finally {
  await bm.close().catch(() => {});
}
