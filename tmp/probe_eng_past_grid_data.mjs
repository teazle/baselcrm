import dotenv from 'dotenv';
import { BrowserManager } from '../src/utils/browser.js';
import { ClinicAssistAutomation } from '../src/automations/clinic-assist.js';

dotenv.config();
const browser = new BrowserManager();
const page = await browser.newPage();
const ca = new ClinicAssistAutomation(page);

try {
  await ca.login();
  await ca.navigateToPatientPage();
  await ca.searchPatientByNumber('78160');
  await ca.openPatientFromSearchResultsByNumber('78160');
  await page.waitForTimeout(1000);
  await ca.navigateToTXHistory().catch(()=>{});
  await page.waitForTimeout(1000);
  await page.locator('a[href="#tabPastNotes"]').first().click({timeout:5000}).catch(()=>{});
  await page.waitForTimeout(800);
  await page.locator('#tabPastNotes a[href="#tabPastCaseNote"]').first().click({timeout:5000}).catch(()=>{});
  await page.waitForTimeout(500);
  await page.locator('#tabPastNotes a[href="#tab_Past"]').first().click({timeout:5000}).catch(()=>{});
  await page.waitForTimeout(1200);

  const data = await page.evaluate(() => {
    const out = {};
    out.url = location.href;
    out.gridIds = Array.from(document.querySelectorAll('[id]'))
      .map((el) => el.id)
      .filter((id) => /grid|jqg|case|note|past/i.test(id))
      .slice(0, 300);

    out.tableRows = Array.from(document.querySelectorAll('#tabPastNotes table tr')).slice(0, 80).map((tr) => {
      const cells = Array.from(tr.querySelectorAll('th,td')).map((td) => (td.textContent || '').replace(/\s+/g, ' ').trim());
      return cells.filter(Boolean);
    }).filter((r) => r.length);

    const jq = [];
    try {
      const $ = window.jQuery || window.$;
      if ($ && $.fn && $.fn.jqGrid) {
        const cand = Array.from(document.querySelectorAll('table[id],div[id]'))
          .map((el) => el.id)
          .filter((id) => /grid|case|note|past/i.test(id));
        for (const id of cand) {
          try {
            const ids = $(`#${id}`).jqGrid('getDataIDs');
            if (!Array.isArray(ids) || !ids.length) continue;
            const rows = ids.slice(0, 10).map((rid) => {
              try {
                return { rid, data: $(`#${id}`).jqGrid('getRowData', rid) };
              } catch {
                return { rid, data: null };
              }
            });
            jq.push({ id, rowCount: ids.length, rows });
          } catch {
            // ignore
          }
        }
      }
    } catch {
      // ignore
    }
    out.jq = jq;

    const text = (document.querySelector('#tabPastNotes')?.innerText || '').replace(/\s+/g, ' ').trim();
    out.keywordHits = {};
    for (const kw of ['foot', 'heel', 'pain', 'diagnosis', 'left', '03/02/2026', 'M79', 'CaseNote']) {
      const idx = text.toLowerCase().indexOf(kw.toLowerCase());
      out.keywordHits[kw] = idx >= 0 ? text.slice(Math.max(0, idx - 80), idx + 180) : null;
    }
    return out;
  });

  console.log(JSON.stringify(data, null, 2));
} finally {
  await browser.close();
}
