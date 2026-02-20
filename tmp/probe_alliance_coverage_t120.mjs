import 'dotenv/config';
import { BrowserManager } from '../src/utils/browser.js';
import { AllianceMedinetAutomation } from '../src/automations/alliance-medinet.js';

const nric = 'T1204303H';
const dates = ['2026-02-13','2026-02-14','2026-02-15'];

const bm = new BrowserManager();
await bm.init();
const page = await bm.newPage();
const auto = new AllianceMedinetAutomation(page);
const out = [];

try {
  await auto.login();
  for (const d of dates) {
    await auto.navigateToMedicalTreatmentClaim();
    const r = await auto.searchMemberByNric(nric, d);
    const dialog = page.locator('[role="dialog"]').filter({ hasText: /Search\s*Member/i }).first();
    const banner = await dialog.locator('text=/no\s+coverage\s+on\s+this\s+visit\s+date/i').count().catch(()=>0);
    const rows = await dialog.locator('tbody tr').count().catch(()=>0);
    out.push({ date: d, found: r?.found, rowCount: r?.rowCount, memberNotFound: r?.memberNotFound, searchKind: r?.searchKind, noCoverageBanner: banner > 0, rows });
  }
  console.log(JSON.stringify(out, null, 2));
} catch (e) {
  console.error(e?.stack || String(e));
} finally {
  await bm.close().catch(() => {});
}
