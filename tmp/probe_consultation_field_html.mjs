import dotenv from 'dotenv';
import { BrowserManager } from '../src/utils/browser.js';
import { AllianceMedinetAutomation } from '../src/automations/alliance-medinet.js';

dotenv.config();

const bm = new BrowserManager();
await bm.init();
const page = await bm.newPage();
const auto = new AllianceMedinetAutomation(page);

const visit = {
  visit_date: '2026-02-12', nric: 'S7137124G', diagnosis_description: 'Fever', extraction_metadata:{mcDays:0,chargeType:'follow'}, treatment_detail:'Medication and rest'
};

try {
  await auto.login();
  await auto.navigateToMedicalTreatmentClaim();
  const s=await auto.searchMemberByNric(visit.nric,visit.visit_date); if(!s?.found) throw new Error('member not found');
  await auto.selectMemberAndAdd();
  await auto._selectDoctorByName('Yip Man Hing Kevin');
  await auto._fillMcDetails(visit);
  await auto._addDiagnosis(visit);

  const html = await page.evaluate(() => {
    const label = Array.from(document.querySelectorAll('label, mat-label, span, div')).find(el =>
      /consultation fee type/i.test((el.textContent || '').trim())
    );
    if (!label) return null;
    const host = label.closest('mat-form-field, .mat-mdc-form-field, .col-xl-3, .col-md-6, .col-xs-12') || label.parentElement;
    return host ? host.outerHTML : label.outerHTML;
  });
  console.log(html || 'NO_HTML');

  const comboDump = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('[role="combobox"], mat-select'))
      .map(el => ({
        tag: el.tagName,
        id: el.id || null,
        role: el.getAttribute('role'),
        placeholder: el.getAttribute('placeholder'),
        formcontrolname: el.getAttribute('formcontrolname'),
        ariaLabel: el.getAttribute('aria-label'),
        ariaLabelledby: el.getAttribute('aria-labelledby'),
        className: el.className,
        text: (el.textContent || '').replace(/\s+/g,' ').trim().slice(0,120),
      }))
      .slice(0,60);
  });
  console.log(JSON.stringify(comboDump,null,2));

  await page.screenshot({path:'screenshots/alliance-consultation-field-probe.png',fullPage:true}).catch(()=>{});
} catch(e){
  console.error(e?.message || String(e));
} finally {
  await bm.close();
}
