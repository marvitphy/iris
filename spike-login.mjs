// Phase 0 spike — GOAL B: does real login survive a profile COPY under Chrome 150 App-Bound Encryption?
// Selectively copy the login-bearing files from the real profile to a temp dir, launch Chrome on the
// COPY with a debug port (allowed: non-default dir), connectOverCDP, and count cookies that decrypt.
// PRIVACY: we only COUNT cookies and count how many decrypt to non-empty values. We never print
// cookie names, values, domains, or visit any of the user's logged-in accounts.

import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, cpSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const SRC = 'C:\\Users\\Usuario\\AppData\\Local\\Google\\Chrome\\User Data';
const PORT = 9334;
const dst = mkdtempSync(join(tmpdir(), 'iris-login-'));
const log = (...a) => console.log('[login]', ...a);

const copy = (rel) => {
  const from = join(SRC, rel);
  const to = join(dst, rel);
  if (!existsSync(from)) return log('skip (missing):', rel);
  try {
    mkdirSync(join(to, '..'), { recursive: true });
    cpSync(from, to, { recursive: true, force: true });
    log('copied:', rel);
  } catch (e) {
    log('copy FAILED (source likely locked):', rel, '-', e.code || e.message);
  }
};

async function waitForCdp(port, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try { const r = await fetch(`http://127.0.0.1:${port}/json/version`); if (r.ok) return await r.json(); } catch {}
    await new Promise((res) => setTimeout(res, 200));
  }
  throw new Error('CDP endpoint never came up');
}

let chromeProc, browser;
try {
  log('copy target:', dst);
  copy('Local State');
  copy('Default/Network/Cookies');
  copy('Default/Network/Cookies-journal');
  copy('Default/Preferences');
  copy('Default/Secure Preferences');
  copy('Default/Login Data');
  copy('Default/Web Data');

  chromeProc = spawn(CHROME, [
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${dst}`,
    '--no-first-run', '--no-default-browser-check', '--restore-last-session=false',
    '--new-window', 'about:blank',
  ], { stdio: 'ignore' });

  const ver = await waitForCdp(PORT);
  log('Chrome up on COPY:', ver['Browser']);

  browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`, { noDefaults: true });
  const ctx = browser.contexts()[0];
  const cookies = await ctx.cookies();
  const decrypted = cookies.filter((c) => typeof c.value === 'string' && c.value.length > 0);
  log(`cookies present in copied profile: ${cookies.length}`);
  log(`cookies that DECRYPTED to a non-empty value: ${decrypted.length}`);
  if (cookies.length > 0 && decrypted.length === 0) {
    log('VERDICT: cookies copied but did NOT decrypt -> App-Bound Encryption defeats naive copy.');
  } else if (decrypted.length > 0) {
    log('VERDICT: login state SURVIVES a profile copy. Copy-and-attach is viable.');
  } else {
    log('VERDICT: no cookies carried (copy likely blocked by source lock). Inconclusive.');
  }
  log('GOAL B: done');
} catch (e) {
  log('GOAL B: ERROR —', e.message);
  process.exitCode = 1;
} finally {
  try { await browser?.close(); } catch {}
  try { chromeProc?.kill(); } catch {}
  await new Promise((r) => setTimeout(r, 500));
  try { rmSync(dst, { recursive: true, force: true }); } catch {}
  log('cleaned up');
}
