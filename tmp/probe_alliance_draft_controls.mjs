import dotenv from 'dotenv';
import { BrowserManager } from '../src/utils/browser.js';
import { AllianceMedinetAutomation } from '../src/automations/alliance-medinet.js';

dotenv.config();

const bm = new BrowserManager();
await bm.init();
const page = await bm.newPage();
const auto = new AllianceMedinetAutomation(page);

const visit = {
  id: 'manual-s7137124g',
  visit_date: '2026-02-12',
  nric: 'S7137124G',
  diagnosis_description: 'Fever',
  treatment_detail: 'Medication and rest',
  total_amount: 38,
  extraction_metadata: { chargeType: 'follow', mcDays: 0 },
};

try {
  await auto.login();
  await auto.navigateToMedicalTreatmentClaim();
  const s = await auto.searchMemberByNric(visit.nric, visit.visit_date);
  if (!s?.found) throw new Error('member not found');
  await auto.selectMemberAndAdd();
  await auto.fillClaimForm(visit, 'Yip Man Hing Kevin');

  const probe = await page.evaluate(() => {
    const all = Array.from(document.querySelectorAll('button, a, [role="menuitem"], [role="button"], span, div'));
    const hits = all
      .map(el => {
        const txt = (el.textContent || '').replace(/\s+/g, ' ').trim();
        if (!txt) return null;
        if (!/draft|save|calculate claim/i.test(txt)) return null;
        const style = window.getComputedStyle(el);
        return {
          tag: el.tagName,
          text: txt.slice(0, 120),
          role: el.getAttribute('role'),
          id: el.id || null,
          cls: el.className || null,
          visible: style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0',
        };
      })
      .filter(Boolean)
      .slice(0, 120);
    return hits;
  });

  console.log(JSON.stringify(probe, null, 2));
  await page.screenshot({ path: 'screenshots/alliance-draft-controls-probe.png', fullPage: true }).catch(() => {});
} catch (e) {
  console.error(e?.message || String(e));
} finally {
  await bm.close();
}
