import { BrowserManager } from '../src/utils/browser.js';
import { AllianceMedinetAutomation } from '../src/automations/alliance-medinet.js';

const bm = new BrowserManager();
await bm.init();
const page = await bm.newPage();
const auto = new AllianceMedinetAutomation(page);

const visit = {
  visit_date: '2026-02-14',
  nric: 'T1722895H',
  diagnosis_description: 'Contusion of throat',
  diagnosis_code: 'S10',
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

  const typeSelect = page.locator('mat-select[formcontrolname="referringProviderEntityType"]').first();
  if (await typeSelect.count().catch(() => 0)) {
    await typeSelect.click({ timeout: 5000 }).catch(async () => typeSelect.click({ force: true }));
    await page.waitForTimeout(500);
    const typeOptions = await page.locator('[role="option"], mat-option').allTextContents().catch(() => []);
    console.log('TYPE_OPTIONS', JSON.stringify(typeOptions.map(v => String(v).replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 30), null, 2));
    await page.keyboard.press('Escape').catch(() => {});
  } else {
    console.log('TYPE_OPTIONS []');
  }

  const entityInput = page.locator('input#referringProviderEntity, input[placeholder*="Type To Search" i]').first();
  if (await entityInput.count().catch(() => 0)) {
    await entityInput.click({ timeout: 5000 }).catch(() => {});
    await entityInput.fill('S').catch(() => {});
    await page.waitForTimeout(800);
    const entityOptions = await page.locator('[role="option"], mat-option').allTextContents().catch(() => []);
    console.log('ENTITY_OPTIONS_S', JSON.stringify(entityOptions.map(v => String(v).replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 30), null, 2));
    await page.keyboard.press('Escape').catch(() => {});

    await entityInput.fill('C').catch(() => {});
    await page.waitForTimeout(800);
    const entityOptionsC = await page.locator('[role="option"], mat-option').allTextContents().catch(() => []);
    console.log('ENTITY_OPTIONS_C', JSON.stringify(entityOptionsC.map(v => String(v).replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 30), null, 2));
  } else {
    console.log('ENTITY_OPTIONS []');
  }

  await page.screenshot({ path: 'screenshots/alliance-referral-options-probe.png', fullPage: true });
} catch (error) {
  console.error(error?.stack || String(error));
  await page.screenshot({ path: 'screenshots/alliance-referral-options-probe-error.png', fullPage: true }).catch(() => {});
} finally {
  await bm.close();
}
