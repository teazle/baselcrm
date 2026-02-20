import { BrowserManager } from '../src/utils/browser.js';
import { AllianceMedinetAutomation } from '../src/automations/alliance-medinet.js';

const bm = new BrowserManager();
await bm.init();
const page = await bm.newPage();
const auto = new AllianceMedinetAutomation(page);

const visit = {
  id: 'probe-referral',
  visit_date: '2026-02-14',
  nric: 'T1722895H',
  diagnosis_description: 'Contusion of throat',
  diagnosis_code: 'S10',
  treatment_detail: 'SPECIALIST CONSULTATION x1',
  total_amount: 76.3,
  extraction_metadata: { chargeType: 'follow', mcDays: 0 },
};

try {
  await auto.login();
  await auto.navigateToMedicalTreatmentClaim();
  const search = await auto.searchMemberByNric(visit.nric, visit.visit_date);
  if (!search?.found) throw new Error('member not found');
  await auto.selectMemberAndAdd();
  await auto._selectDoctorByName('Palanisamy Arul Murugan');
  await auto._fillMcDetails(visit);
  await auto._addDiagnosis(visit);

  const dom = await page.evaluate(() => {
    const toInfo = el => ({
      tag: el.tagName,
      cls: el.className,
      id: el.id || null,
      name: el.getAttribute('name'),
      formcontrolname: el.getAttribute('formcontrolname'),
      placeholder: el.getAttribute('placeholder'),
      ariaLabel: el.getAttribute('aria-label'),
      text: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 120),
      required: el.hasAttribute('required') || el.getAttribute('aria-required') === 'true',
      value: 'value' in el ? String(el.value || '') : null,
    });

    const query = sel => Array.from(document.querySelectorAll(sel)).map(toInfo);

    const requireds = Array.from(
      document.querySelectorAll('input[required],select[required],textarea[required],[aria-required="true"]')
    ).map(toInfo);

    return {
      referralInputs: query('input[placeholder*="Referring" i],input[aria-label*="Referring" i]'),
      referralCombos: query('[role="combobox"][aria-label*="Referring" i],[role="combobox"][aria-label*="Provider" i],mat-select[formcontrolname*="provider" i],mat-select[formcontrolname*="refer" i]'),
      consultCombos: query('[role="combobox"][aria-label*="Consultation" i],mat-select[formcontrolname*="consultation" i],mat-select[formcontrolname*="outpatient" i]'),
      requireds,
      allComboboxes: query('[role="combobox"], mat-select'),
    };
  });

  console.log(JSON.stringify(dom, null, 2));
  await page.screenshot({ path: 'screenshots/alliance-referral-dom-probe.png', fullPage: true });
} catch (error) {
  console.error(error?.stack || String(error));
  await page.screenshot({ path: 'screenshots/alliance-referral-dom-probe-error.png', fullPage: true }).catch(() => {});
} finally {
  await bm.close();
}
