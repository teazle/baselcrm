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
  await page.waitForTimeout(1500);

  const patientSnapshot = await page.evaluate(() => {
    const text = (document.body?.innerText || '').replace(/\s+/g, ' ').trim();
    const lower = text.toLowerCase();
    const snippets = [];
    for (const kw of ['diagnosis', 'diag', 'heel', 'foot', 'pain', 'left', 'm79', 'visit notes', 'past notes']) {
      const i = lower.indexOf(kw);
      if (i >= 0) snippets.push({ kw, snippet: text.slice(Math.max(0, i - 120), i + 220) });
    }
    const labels = Array.from(document.querySelectorAll('label,th,td,span,b,strong,h1,h2,h3,h4'))
      .map((el) => (el.textContent || '').trim())
      .filter(Boolean)
      .filter((t) => /diagnosis|diag|notes|history|tx|visit|past|foot|heel|pain/i.test(t))
      .slice(0, 120);
    return { url: location.href, snippets, labels };
  });

  await ca.navigateToTXHistory().catch(() => {});
  await page.waitForTimeout(1500);

  const txSnapshot = await page.evaluate(() => {
    const text = (document.body?.innerText || '').replace(/\s+/g, ' ').trim();
    const lower = text.toLowerCase();
    const snippets = [];
    for (const kw of ['diagnosis', 'diag', 'heel', 'foot', 'pain', 'left', 'm79', 'visit notes', 'past notes', 'append']) {
      const i = lower.indexOf(kw);
      if (i >= 0) snippets.push({ kw, snippet: text.slice(Math.max(0, i - 180), i + 280) });
    }
    const tabCandidates = Array.from(document.querySelectorAll('a,button,li,[role="tab"],.tab,[class*="tab"]'))
      .map((el) => (el.textContent || '').trim())
      .filter(Boolean)
      .filter((t) => /all|diagnosis|visit|past|notes|medicine|mc|history/i.test(t))
      .slice(0, 200);
    return { url: location.href, snippets, tabCandidates };
  });

  console.log(JSON.stringify({ patientSnapshot, txSnapshot }, null, 2));
} finally {
  await browser.close();
}
