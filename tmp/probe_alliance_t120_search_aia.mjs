import 'dotenv/config';
import { BrowserManager } from '../src/utils/browser.js';

const nric = 'T1204303H';
const visitDate = '14/2/2026';

const bm = new BrowserManager();
await bm.init();
const page = await bm.newPage();

const click = async sel => {
  const el = page.locator(sel).first();
  const count = await el.count().catch(() => 0);
  if (!count) return false;
  await el.click({ timeout: 8000 }).catch(async () => el.click({ timeout: 8000, force: true }));
  return true;
};

try {
  await page.goto(process.env.ALLIANCE_MEDINET_URL || 'https://connect.alliancemedinet.com/login', {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });
  await page.waitForTimeout(2000);
  if (await page.locator('input[placeholder*="Login" i], input[name*="login" i]').first().isVisible().catch(() => false)) {
    await page.fill('input[placeholder*="Login" i], input[name*="login" i]', process.env.ALLIANCE_MEDINET_USERNAME || '');
    await page.fill('input[type="password"], input[placeholder*="Password" i]', process.env.ALLIANCE_MEDINET_PASSWORD || '');
    await click('button:has-text("Login"), button[type="submit"]');
    await page.waitForTimeout(4000);
  }

  await click('text=Panel Services');
  await page.waitForTimeout(600);
  await click('text=Create Panel Claim');
  await page.waitForTimeout(1200);
  await click('button:has-text("Medical Treatment")');
  await page.waitForTimeout(1200);

  const dialog = page.locator('[role="dialog"]').filter({ hasText: /Search\s*Member/i }).first();
  await dialog.waitFor({ state: 'visible', timeout: 15000 });

  await dialog.locator('input[placeholder*="Membership" i]').first().fill(nric);
  await dialog.locator('input[placeholder*="Date of Visit" i]').first().fill(visitDate);
  await page.keyboard.press('Escape').catch(()=>{});
  await page.waitForTimeout(150);

  await dialog.locator('button:has-text("Search AIA Member")').first().click({ timeout: 8000 }).catch(async()=>{
    await dialog.locator('button:has-text("Search Others")').first().click({ timeout: 8000 });
  });
  await page.waitForTimeout(6000);

  const row = dialog.locator('.mat-mdc-row, .mat-row, .cdk-row').first();
  const rowText = await row.innerText().catch(() => '');
  const rowCb = row.locator('input[type="checkbox"]').first();
  const cbVisible = await rowCb.isVisible().catch(() => false);
  if (cbVisible) {
    await rowCb.click({ timeout: 5000 }).catch(async()=> rowCb.click({ timeout: 5000, force: true }));
  }
  await page.waitForTimeout(500);

  const addBtn = dialog.locator('button:has-text("Add")').first();
  const addEnabled = await addBtn.isEnabled().catch(() => false);
  if (addEnabled) {
    await addBtn.click({ timeout: 8000 }).catch(async()=> addBtn.click({ timeout: 8000, force: true }));
  }
  await page.waitForTimeout(6000);

  const claimInfo = await page.locator('text=/Claim\s+Information/i').first().isVisible().catch(() => false);
  const searchStill = await dialog.isVisible().catch(() => false);
  const banner = await page.locator('text=/unable\s+to\s+retrieve\s+data|cannot\s+read\s+properties|no\s+coverage/i').count().catch(()=>0);
  const url = page.url();

  await page.screenshot({ path: '/Users/vincent/Baselrpacrm/screenshots/probe-t120-search-aia.png', fullPage: true });
  console.log(JSON.stringify({ rowText, cbVisible, addEnabled, claimInfo, searchStill, banner, url }, null, 2));
} catch (e) {
  console.error(e?.stack || String(e));
} finally {
  await bm.close().catch(() => {});
}
