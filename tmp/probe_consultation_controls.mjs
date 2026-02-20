import dotenv from 'dotenv';
import { BrowserManager } from '../src/utils/browser.js';
import { AllianceMedinetAutomation } from '../src/automations/alliance-medinet.js';

dotenv.config();

const bm = new BrowserManager();
await bm.init();
const page = await bm.newPage();
const auto = new AllianceMedinetAutomation(page);

const visit = { visit_date:'2026-02-12', nric:'S7137124G', diagnosis_description:'Fever', extraction_metadata:{mcDays:0}, treatment_detail:'Medication' };

try {
  await auto.login();
  await auto.navigateToMedicalTreatmentClaim();
  const s=await auto.searchMemberByNric(visit.nric, visit.visit_date); if(!s?.found) throw new Error('member not found');
  await auto.selectMemberAndAdd();
  await auto._selectDoctorByName('Yip Man Hing Kevin');
  await auto._fillMcDetails(visit);
  await auto._addDiagnosis(visit);

  const dump = await page.evaluate(() => {
    const nodes = Array.from(document.querySelectorAll('input, select, mat-select, [role="combobox"], button, div, span'));
    return nodes
      .map(el => {
        const txt = (el.textContent || '').replace(/\s+/g,' ').trim();
        const ph = el.getAttribute('placeholder') || '';
        const name = el.getAttribute('name') || '';
        const id = el.getAttribute('id') || '';
        const formcontrolname = el.getAttribute('formcontrolname') || '';
        const aria = el.getAttribute('aria-label') || '';
        const joined = `${txt} ${ph} ${name} ${id} ${formcontrolname} ${aria}`.toLowerCase();
        if (!joined.includes('consultation')) return null;
        return {
          tag: el.tagName,
          text: txt.slice(0,120),
          placeholder: ph,
          name,
          id,
          formcontrolname,
          role: el.getAttribute('role'),
          className: el.className,
        };
      })
      .filter(Boolean)
      .slice(0,120);
  });
  console.log(JSON.stringify(dump,null,2));
  await page.screenshot({path:'screenshots/alliance-consultation-controls-probe.png', fullPage:true}).catch(()=>{});
} catch (e) {
  console.error(e?.message || String(e));
} finally {
  await bm.close();
}
