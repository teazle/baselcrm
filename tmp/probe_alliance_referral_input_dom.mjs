import { BrowserManager } from '../src/utils/browser.js';
import { AllianceMedinetAutomation } from '../src/automations/alliance-medinet.js';

const bm = new BrowserManager();
await bm.init();
const page = await bm.newPage();
const auto = new AllianceMedinetAutomation(page);

try {
  await auto.login();
  await auto.navigateToMedicalTreatmentClaim();
  const search = await auto.searchMemberByNric('T1722895H', '2026-02-14');
  if (!search?.found) throw new Error('member not found');
  await auto.selectMemberAndAdd();

  const dom = await page.evaluate(() => {
    const container = document.querySelector('app-autocomplete-local#referringProviderEntity');
    if (!container) return { found: false };
    const inputs = Array.from(container.querySelectorAll('input')).map(el => ({
      id: el.id || null,
      name: el.getAttribute('name'),
      placeholder: el.getAttribute('placeholder'),
      ariaLabel: el.getAttribute('aria-label'),
      cls: el.className,
      value: el.value,
    }));
    const controls = Array.from(container.querySelectorAll('*')).slice(0, 80).map(el => ({
      tag: el.tagName,
      id: el.id || null,
      role: el.getAttribute('role'),
      cls: el.className,
      text: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 100),
      placeholder: el.getAttribute('placeholder'),
      ariaLabel: el.getAttribute('aria-label'),
    }));
    return { found: true, inputs, controls };
  });

  console.log(JSON.stringify(dom, null, 2));
  await page.screenshot({ path: 'screenshots/alliance-referral-input-dom-probe.png', fullPage: true });
} catch (error) {
  console.error(error?.stack || String(error));
} finally {
  await bm.close();
}
