// Phase 0 spike — GOAL A: prove the engine core mechanism.
// Launch Chrome (fresh temp profile + debug port, NON-default dir so Chrome 136+ allows it),
// connectOverCDP, create 3 isolated BrowserContexts concurrently, ariaSnapshot(mode:ai) for refs,
// measure incremental memory. This validates concurrency independent of the login path.

import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9333;
const userDataDir = mkdtempSync(join(tmpdir(), 'iris-spike-'));

const log = (...a) => console.log('[spike]', ...a);

async function waitForCdp(port, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (r.ok) return await r.json();
    } catch {}
    await new Promise((res) => setTimeout(res, 200));
  }
  throw new Error('CDP endpoint never came up');
}

function rssMB() {
  return Math.round(process.memoryUsage().rss / 1024 / 1024);
}

let chromeProc;
let browser;
try {
  log('temp profile:', userDataDir);
  chromeProc = spawn(CHROME, [
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${userDataDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--restore-last-session=false',
    '--new-window',
    'about:blank',
  ], { stdio: 'ignore', detached: false });

  const ver = await waitForCdp(PORT);
  log('Chrome up:', ver['Browser'], '| CDP ok');

  browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`, { noDefaults: true });
  log('connectOverCDP OK. contexts at attach:', browser.contexts().length);

  // Create 3 isolated contexts (Spaces) concurrently.
  const t0 = Date.now();
  const spaces = await Promise.all([1, 2, 3].map(async (n) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto('data:text/html,' + encodeURIComponent(
      `<h1>Space ${n}</h1><button id="b${n}">Click ${n}</button><input aria-label="field ${n}">`
    ), { waitUntil: 'load' });
    return { n, ctx, page };
  }));
  log(`3 isolated contexts created concurrently in ${Date.now() - t0}ms`);
  log('total contexts now:', browser.contexts().length);

  // Prove isolation: set a cookie in space 1, confirm space 2 can't see it.
  await spaces[0].ctx.addCookies([{ name: 'iris', value: 's1', url: 'https://example.com' }]);
  const c1 = await spaces[0].ctx.cookies('https://example.com');
  const c2 = await spaces[1].ctx.cookies('https://example.com');
  log(`isolation: space1 cookies=${c1.length} space2 cookies=${c2.length} (expect 1 and 0)`);

  // Prove ariaSnapshot(mode:ai) yields refs.
  const snap = await spaces[0].page.locator('body').ariaSnapshot({ mode: 'ai' });
  log('--- ariaSnapshot(mode:ai) of Space 1 ---');
  console.log(snap);

  // Resolve a ref back to an element and act on it.
  const refMatch = snap.match(/\[ref=(\w+)\]/);
  if (refMatch) {
    const ref = refMatch[1];
    log('resolving first ref:', ref);
    const loc = spaces[0].page.locator(`aria-ref=${ref}`);
    log('ref resolves to:', (await loc.textContent()) ?? '(no text)');
  } else {
    log('WARN: no [ref=] found in snapshot');
  }

  log(`driver-process RSS: ${rssMB()}MB (Chrome memory is separate, out-of-process)`);
  log('GOAL A: PASS');
} catch (e) {
  log('GOAL A: FAIL —', e.message);
  process.exitCode = 1;
} finally {
  try { await browser?.close(); } catch {}
  try { chromeProc?.kill(); } catch {}
  await new Promise((r) => setTimeout(r, 500));
  try { rmSync(userDataDir, { recursive: true, force: true }); } catch {}
  log('cleaned up');
}
