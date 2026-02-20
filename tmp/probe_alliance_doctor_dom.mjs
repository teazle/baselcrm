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
  console.log('search', search);
  await auto.selectMemberAndAdd();

  const data = await page.evaluate(() => {
    const nodes = Array.from(document.querySelectorAll('mat-select, [role="combobox"], input, select'))
      .filter(el => {
        const txt = ((el.getAttribute('aria-label') || '') + ' ' + (el.getAttribute('placeholder') || '') + ' ' + (el.getAttribute('name') || '') + ' ' + (el.getAttribute('id') || '')).toLowerCase();
        const parentText = (el.closest('div,mat-form-field')?.textContent || '').toLowerCase();
        return txt.includes('doctor') || parentText.includes('doctor');
      })
      .slice(0, 20)
      .map(el => ({
        tag: el.tagName,
        role: el.getAttribute('role'),
        ariaLabel: el.getAttribute('aria-label'),
        name: el.getAttribute('name'),
        id: el.getAttribute('id'),
        placeholder: el.getAttribute('placeholder'),
        className: el.className,
        text: (el.textContent || '').trim().slice(0, 80),
        outer: el.outerHTML.slice(0, 280),
      }));
    const doctorLabel = Array.from(document.querySelectorAll('label, span, div, mat-label'))
      .filter(el => (el.textContent || '').toLowerCase().includes('doctor'))
      .slice(0, 20)
      .map(el => ({ tag: el.tagName, text: (el.textContent || '').trim(), outer: el.outerHTML.slice(0, 280) }));
    return { nodes, doctorLabel };
  });

  console.log(JSON.stringify(data, null, 2));
  await page.screenshot({ path: 'screenshots/alliance-doctor-dom-probe.png', fullPage: true }).catch(() => {});
} catch (error) {
  console.error(error?.message || String(error));
} finally {
  await bm.close();
}
