// Headless visual check for agents (no GUI needed). Uses the system Chromium (/usr/bin/chromium) through the
// server's Playwright. Screenshots every main view in light, dark and mobile; prints console errors.
//
//   node scripts/ui-screenshots.mjs --base http://127.0.0.1:3104 --project <projectId> --out /tmp/shots [--views leads,deals]
//
// Run the server against a COPY of the DB (see AGENTS.md §6), never against live data you mind changing.
import { chromium } from '../server/node_modules/playwright/index.mjs';
import fs from 'fs';

const arg = (name, def) => { const i = process.argv.indexOf('--' + name); return i > -1 ? process.argv[i + 1] : def; };
const BASE = arg('base', 'http://127.0.0.1:3101');
const PID = arg('project');
const OUT = arg('out', './ui-shots');
const VIEWS = arg('views', 'dashboard,leads,deals,campaigns,dead,scraper,settings,import').split(',');
const USER = arg('user', 'admin'), PASS = arg('pass', 'admin');
if (!PID) { console.error('--project <projectId> is required'); process.exit(1); }
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/usr/bin/chromium', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const errors = [];
const modes = [
  { name: 'desktop', width: 1440, height: 900, dark: false },
  { name: 'dark', width: 1440, height: 900, dark: true },
  { name: 'mobile', width: 400, height: 860, dark: false },
];
for (const m of modes) {
  const ctx = await browser.newContext({ viewport: { width: m.width, height: m.height } });
  await ctx.addInitScript((d) => { try { localStorage.setItem('darkMode', String(d)); localStorage.setItem('leaddesk_tour_done', '1') } catch {} }, m.dark);
  const page = await ctx.newPage();
  page.on('console', msg => { if (msg.type() === 'error' && !msg.text().includes('401')) errors.push(`[${m.name}] ${page.url()}: ${msg.text()}`); });
  page.on('pageerror', e => errors.push(`[${m.name}] ${page.url()}: ${e.message}`));
  await page.goto(BASE + '/');
  await page.fill('input[type="text"]', USER);
  await page.fill('input[type="password"]', PASS);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1200);
  for (const v of VIEWS) {
    await page.goto(`${BASE}/p/${PID}/${v}`);
    await page.waitForTimeout(1000);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    if (overflow > 0) errors.push(`[${m.name}] ${v}: page scrolls horizontally by ${overflow}px`);
    await page.screenshot({ path: `${OUT}/${v}-${m.name}.png` });
  }
  await ctx.close();
}
await browser.close();
console.log(`Screenshots in ${OUT}`);
console.log(errors.length ? 'Problems:\n' + errors.join('\n') : 'No console errors or horizontal overflow.');
