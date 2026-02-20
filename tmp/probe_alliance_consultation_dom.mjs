import { BrowserManager } from '../src/utils/browser.js';
import { AllianceMedinetAutomation } from '../src/automations/alliance-medinet.js';

const bm = new BrowserManager();
await bm.init();
const page = await bm.newPage();
const auto = new AllianceMedinetAutomation(page);

const visit = {
  id: 'probe-consult',
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
    const asInfo = el => ({
      tag: el.tagName,
      id: el.id || null,
      name: el.getAttribute('name'),
      formcontrolname: el.getAttribute('formcontrolname'),
      placeholder: el.getAttribute('placeholder'),
      ariaLabel: el.getAttribute('aria-label'),
      cls: el.className,
      text: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 160),
      value: 'value' in el ? String(el.value || '') : null,
    });

    return {
      nativeSelects: Array.from(document.querySelectorAll('select')).map(asInfo),
      consultationCandidates: Array.from(document.querySelectorAll('*')).filter(el => {
        const txt = (el.textContent || '').toLowerCase();
        return txt.includes('consultation fee type') || txt.includes('consultation fee');
      }).slice(0, 50).map(asInfo),
      consultationInputs: Array.from(document.querySelectorAll('input,textarea,mat-select,[role="combobox"],select')).filter(el => {
        const attrs = [el.getAttribute('name'), el.getAttribute('id'), el.getAttribute('placeholder'), el.getAttribute('aria-label'), el.getAttribute('formcontrolname')]
          .map(v => String(v || '').toLowerCase())
          .join(' ');
        return attrs.includes('consult');
      }).map(asInfo),
    };
  });

  console.log(JSON.stringify(dom, null, 2));
  await page.screenshot({ path: 'screenshots/alliance-consultation-dom-probe.png', fullPage: true });
} catch (error) {
  console.error(error?.stack || String(error));
  await page.screenshot({ path: 'screenshots/alliance-consultation-dom-probe-error.png', fullPage: true }).catch(() => {});
} finally {
  await bm.close();
}
