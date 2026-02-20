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

  const typeSel = page.locator('mat-select[formcontrolname="referringProviderEntityType"]').first();
  await typeSel.click({ timeout: 5000 }).catch(async () => typeSel.click({ force: true }));
  const clinicOpt = page.locator('[role="option"],mat-option').filter({ hasText: /Clinic/i }).first();
  await clinicOpt.click({ timeout: 5000 }).catch(async () => clinicOpt.click({ force: true }));

  const refInput = page.locator('#referringProviderEntity').first();
  await refInput.click({ timeout: 5000 }).catch(() => {});
  await refInput.fill('SINGAPORE SPORTS');
  await page.waitForTimeout(800);
  const refOpt = page.locator('[role="option"],mat-option').filter({ hasText: /SINGAPORE SPORTS/i }).first();
  if (await refOpt.count().catch(() => 0)) {
    await refOpt.click({ timeout: 5000 }).catch(async () => refOpt.click({ force: true }));
  } else {
    const firstOpt = page.locator('[role="option"],mat-option').first();
    await firstOpt.click({ timeout: 5000 }).catch(async () => firstOpt.click({ force: true }));
  }

  await auto._setConsultationFeeType('follow');
  await auto._fillConsultationFeeAmount(visit.total_amount);

  await page.locator('button:has-text("Calculate Claim")').first().click({ timeout: 5000 }).catch(async () => {
    await page.locator('button:has-text("Calculate Claim")').first().click({ force: true });
  });
  await page.waitForTimeout(1500);
  const invalid = await page.locator('text=/Invalid\\s+field:/i').first().innerText().catch(() => '');
  const body = await page.locator('body').innerText().catch(() => '');
  const feeWarn = (body.match(/Consultation Fee should be below\s*\d+/i) || [null])[0];
  const hasSummary = await page.locator('text=/Claim\\s+Summary/i').first().isVisible().catch(() => false);
  console.log(JSON.stringify({ invalid, feeWarn, hasSummary }, null, 2));

  await page.screenshot({ path: 'screenshots/alliance-calc-kiara-probe.png', fullPage: true });
} catch (error) {
  console.error(error?.stack || String(error));
  await page.screenshot({ path: 'screenshots/alliance-calc-kiara-probe-error.png', fullPage: true }).catch(() => {});
} finally {
  await bm.close();
}
