import dotenv from 'dotenv';
import { BrowserManager } from '../src/utils/browser.js';
import { AllianceMedinetAutomation } from '../src/automations/alliance-medinet.js';

dotenv.config();

const bm = new BrowserManager();
await bm.init();
const page = await bm.newPage();
const auto = new AllianceMedinetAutomation(page);

try {
  await auto.login();
  await auto.navigateToMedicalTreatmentClaim();
  const search = await auto.searchMemberByNric('S7137124G', '2026-02-12');
  if (search?.found) await auto.selectMemberAndAdd();

  const html = await page.evaluate(() => {
    const label = Array.from(document.querySelectorAll('label, mat-label')).find(el =>
      (el.textContent || '').trim().toLowerCase() === 'doctor'
    );
    if (!label) return null;
    const host = label.closest('mat-form-field, div.col-xl-3, div.col-md-6, div.col-xs-12') || label.parentElement;
    return host ? host.outerHTML : label.outerHTML;
  });

  console.log(html || 'NO_HTML');
} catch (e) {
  console.error(e?.message || String(e));
} finally {
  await bm.close();
}
