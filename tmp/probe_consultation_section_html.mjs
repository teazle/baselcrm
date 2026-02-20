import dotenv from 'dotenv';
import { BrowserManager } from '../src/utils/browser.js';
import { AllianceMedinetAutomation } from '../src/automations/alliance-medinet.js';

dotenv.config();

const bm = new BrowserManager();
await bm.init();
const page = await bm.newPage();
const auto = new AllianceMedinetAutomation(page);

const visit = {
  visit_date: '2026-02-12',
  nric: 'S7137124G',
  diagnosis_description: 'Fever',
  extraction_metadata: { mcDays: 0 },
  treatment_detail: 'Medication and rest',
};

try {
  await auto.login();
  await auto.navigateToMedicalTreatmentClaim();
  const found = await auto.searchMemberByNric(visit.nric, visit.visit_date);
  if (!found?.found) throw new Error('member not found');
  await auto.selectMemberAndAdd();
  await auto._selectDoctorByName('Yip Man Hing Kevin');
  await auto._fillMcDetails(visit);
  await auto._addDiagnosis(visit);

  // Scroll to consultation section to ensure lazy-rendered controls are mounted.
  await page.locator('text=/Consultation\s+Fee/i').first().scrollIntoViewIfNeeded().catch(() => {});
  await page.waitForTimeout(400);

  const dump = await page.evaluate(() => {
    const findLabel = () => {
      const all = Array.from(document.querySelectorAll('*'));
      return all.find(el => {
        const txt = (el.textContent || '').replace(/\s+/g, ' ').trim();
        return txt === 'Consultation Fee' || txt.startsWith('Consultation Fee');
      });
    };

    const label = findLabel();
    if (!label) {
      return { found: false, reason: 'label_not_found' };
    }

    const section =
      label.closest('.card, .card-body, .row, .container-fluid, form, [formgroupname], [formarrayname]') ||
      label.parentElement;

    const controls = Array.from((section || document).querySelectorAll('input, select, mat-select, [role="combobox"], button, [formcontrolname]'))
      .map(el => ({
        tag: el.tagName,
        text: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 120),
        placeholder: el.getAttribute('placeholder'),
        formcontrolname: el.getAttribute('formcontrolname'),
        id: el.getAttribute('id'),
        role: el.getAttribute('role'),
        cls: el.className,
      }))
      .slice(0, 160);

    return {
      found: true,
      sectionHtml: section ? section.outerHTML.slice(0, 4000) : null,
      controls,
    };
  });

  console.log(JSON.stringify(dump, null, 2));
  await page.screenshot({ path: 'screenshots/alliance-consultation-section-html-probe.png', fullPage: true }).catch(() => {});
} catch (error) {
  console.error(error?.message || String(error));
  await page.screenshot({ path: 'screenshots/alliance-consultation-section-html-probe-error.png', fullPage: true }).catch(() => {});
} finally {
  await bm.close();
}
