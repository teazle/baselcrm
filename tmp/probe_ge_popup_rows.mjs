import 'dotenv/config';
import { BrowserManager } from '../src/utils/browser.js';
import { AllianceMedinetAutomation } from '../src/automations/alliance-medinet.js';

const bm = new BrowserManager();
await bm.init();
const page = await bm.newPage();
const auto = new AllianceMedinetAutomation(page);
const popups = [];
page.context().on('page', p => popups.push(p));

const nric = process.env.GE_PROBE_NRIC || 'T0801699I';
const date = process.env.GE_PROBE_VISIT_DATE || '2026-02-13';

try {
  await auto.login();
  await auto.navigateToMedicalTreatmentClaim();
  const found = await auto.searchMemberByNric(nric, date);
  if (!found?.found) throw new Error('member_not_found');
  try { await auto.selectMemberAndAdd(); } catch {}
  const popup = popups[popups.length - 1];
  if (!popup) throw new Error('popup_missing');

  await popup.waitForLoadState('domcontentloaded').catch(() => {});
  await popup.bringToFront().catch(() => {});
  await popup.waitForTimeout(800);

  await popup.evaluate(() => {
    const a = Array.from(document.querySelectorAll('a')).find(x => {
      const href = x.getAttribute('href') || '';
      const title = x.getAttribute('title') || '';
      return href.includes('SearchDiagnosis.aspx') || /primary diagnosis/i.test(title);
    });
    if (a) a.click();
  });

  await popup.waitForSelector('#TB_iframeContent', { timeout: 8000 });
  const frame = await (await popup.$('#TB_iframeContent')).contentFrame();
  if (!frame) throw new Error('frame_missing');

  await frame.fill('#ctl00_PopupPageContent_txtSearchContent', 'pain').catch(() => {});
  await frame.click('#ctl00_PopupPageContent_btnSearch').catch(() => {});
  await popup.waitForTimeout(1200);

  const data = await frame.evaluate(() => {
    const links = Array.from(document.querySelectorAll('a')).map(a => ({
      text: (a.textContent || '').trim(),
      href: a.getAttribute('href') || '',
      id: a.id || '',
      title: a.getAttribute('title') || '',
    }));

    const rows = Array.from(document.querySelectorAll('tr')).map((tr, i) => ({
      i,
      text: (tr.textContent || '').replace(/\s+/g, ' ').trim(),
      html: tr.innerHTML,
    }));

    const table = document.querySelector('#ctl00_PopupPageContent_gdvDiagnosis')?.outerHTML || '';
    return {
      location: location.href,
      links: links.filter(l => /Diagnosis|lbtn|Select|__doPostBack|lnk/i.test(`${l.text} ${l.href} ${l.id}`)).slice(0, 30),
      rows: rows.filter(r => /pain|diagnosis|R52/i.test(r.text)).slice(0, 20),
      tableSnippet: table.slice(0, 8000),
    };
  });

  console.log(JSON.stringify(data, null, 2));
  await frame.screenshot({ path: '/Users/vincent/Baselrpacrm/screenshots/ge-popup-pain-results.png' }).catch(() => {});
} catch (error) {
  console.error('[probe] fatal', error?.stack || String(error));
} finally {
  await bm.close().catch(() => {});
}
