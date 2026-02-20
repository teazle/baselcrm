import dotenv from 'dotenv';
import { BrowserManager } from '../src/utils/browser.js';
import { ClinicAssistAutomation } from '../src/automations/clinic-assist.js';

dotenv.config();

const browser = new BrowserManager();
const page = await browser.newPage();
const ca = new ClinicAssistAutomation(page);

async function openPatient() {
  const patientNumber = '78160';
  const patientName = 'ENG CHAI PIN ELYNE XANDRIA';

  for (let attempt = 1; attempt <= 2; attempt++) {
    await ca.navigateToPatientPage();
    await ca.searchPatientByNumber(patientNumber);
    try {
      await ca.openPatientFromSearchResultsByNumber(patientNumber);
      return { method: 'number', attempt };
    } catch (_) {
      // fallback below
    }

    await ca.navigateToPatientPage();
    await ca.searchPatientByName(patientName);
    try {
      await ca.openPatientFromSearchResults(patientName);
      return { method: 'name', attempt };
    } catch (_) {
      // retry outer loop
    }
  }

  throw new Error('Unable to open patient by number or name after retries');
}

try {
  await ca.login();
  const opened = await openPatient();
  await page.waitForTimeout(1500);

  const visitNotes = await ca._extractDiagnosisWithValidation('visit_notes').catch((e) => ({ error: e.message }));

  const navDispense = await ca._navigateToDispenseAndPayment().catch(() => false);
  await page.waitForTimeout(1500);
  const dispenseNotes = navDispense
    ? await ca._extractDiagnosisWithValidation('dispense_payment').catch((e) => ({ error: e.message }))
    : { skipped: 'dispense_navigation_failed' };

  const pageSnapshot = await page.evaluate(() => {
    const text = (document.body?.innerText || '').replace(/\s+/g, ' ').trim();
    const idx = text.toLowerCase().indexOf('diagnosis');
    return {
      url: location.href,
      diagnosisSnippet: idx >= 0 ? text.slice(Math.max(0, idx - 200), idx + 350) : null,
      hasHeel: /heel/i.test(text),
      hasFoot: /foot/i.test(text),
      hasPain: /pain/i.test(text),
      hasM79: /m79/i.test(text)
    };
  });

  console.log(JSON.stringify({ opened, navDispense, visitNotes, dispenseNotes, pageSnapshot }, null, 2));
} finally {
  await browser.close();
}
