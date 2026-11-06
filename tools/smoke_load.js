// Smoke-load the three pages headless and report page errors.
//
//     node tools/smoke_load.js
//
// Opens AVILA_Roll.html, AVILA_Mills.html and AVILA_Sales.html from disk in headless
// Chromium (Playwright) and prints the uncaught exceptions and console errors each one
// raises while booting with no scenario open. Expected: 0 errors on the Roll and Sales
// pages; the Mills page reports one ERR_FILE_NOT_FOUND when no AVILA_Mills_data.js sits
// beside it, which is normal in the repository (that file is plant data, never committed).
// Exit code 1 when anything else shows up. Run it before every push.
const { chromium } = require('playwright');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PAGES = ['AVILA_Roll.html', 'AVILA_Mills.html', 'AVILA_Sales.html'];
const EXPECTED = /AVILA_Mills_data\.js|ERR_FILE_NOT_FOUND/;   // the Mills data file is not in the repo

(async () => {
  const browser = await chromium.launch();
  let bad = 0;
  for (const f of PAGES) {
    const page = await browser.newPage();
    const errs = [];
    page.on('pageerror', e => errs.push('pageerror: ' + e.message));
    page.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
    await page.goto('file://' + path.join(ROOT, f));
    await page.waitForTimeout(2500);
    const real = errs.filter(e => !(f === 'AVILA_Mills.html' && EXPECTED.test(e)));
    bad += real.length;
    console.log(`${f} -> "${await page.title()}" | ${real.length} error(s)`);
    real.slice(0, 10).forEach(e => console.log('    ' + e.slice(0, 240)));
    await page.close();
  }
  await browser.close();
  process.exit(bad ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
