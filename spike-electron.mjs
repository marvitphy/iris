// Phase 0.5 spike — prove the driving model against Iris's OWN Electron/Chromium.
// Launch Electron with a CDP port, create a persistent partitioned Space (WebContentsView),
// connectOverCDP from inside the main process, ariaSnapshot the Space's page, resolve a ref.
// This is the exact production pattern: engine lives in main, connects to self, drives Spaces.

import { app, BaseWindow, WebContentsView, session } from 'electron';
import { chromium } from 'playwright-core';

const PORT = 9335;
app.commandLine.appendSwitch('remote-debugging-port', String(PORT));
app.commandLine.appendSwitch('remote-allow-origins', '*'); // Chromium M111+ needs this for external CDP ws
const log = (...a) => console.log('[electron-spike]', ...a);

async function waitForCdp(port, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try { const r = await fetch(`http://127.0.0.1:${port}/json/version`); if (r.ok) return await r.json(); } catch {}
    await new Promise((res) => setTimeout(res, 150));
  }
  throw new Error('CDP endpoint never came up');
}

app.whenReady().then(async () => {
  let ok = false;
  try {
    // A "Space" = a persistent, isolated session partition. Login persists here across restarts.
    const spaceSession = session.fromPartition('persist:space-1');
    log('created persistent partition: persist:space-1');

    const win = new BaseWindow({ width: 900, height: 640, title: 'Iris — Space 1' });
    const view = new WebContentsView({ webPreferences: { session: spaceSession } });
    win.contentView.addChildView(view);
    view.setBounds({ x: 0, y: 0, width: 900, height: 640 });

    const html = '<h1>Iris Space 1</h1><button id="go">Do the thing</button>'
      + '<input aria-label="search box"><a href="https://example.com">a link</a>';
    await view.webContents.loadURL('data:text/html,' + encodeURIComponent(html));
    log('Space page loaded. webContents id:', view.webContents.id);

    const ver = await waitForCdp(PORT);
    log('Iris Chromium CDP up:', ver['Browser']);

    const browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`, { noDefaults: true });
    log('engine connectOverCDP -> self OK. contexts:', browser.contexts().length);

    // Find the page corresponding to our Space's WebContentsView.
    let target = null;
    for (const ctx of browser.contexts()) {
      for (const p of ctx.pages()) {
        const t = await p.title().catch(() => '');
        const u = p.url();
        if (u.startsWith('data:text/html')) { target = p; break; }
      }
      if (target) break;
    }
    if (!target) throw new Error('could not find Space page via CDP');
    log('located Space page via CDP. url starts:', target.url().slice(0, 24));

    const snap = await target.locator('body').ariaSnapshot({ mode: 'ai' });
    log('--- ariaSnapshot(mode:ai) of Iris Space ---');
    console.log(snap);

    const m = snap.match(/button "Do the thing" \[ref=(\w+)\]/);
    if (m) {
      const ref = m[1];
      const text = await target.locator(`aria-ref=${ref}`).textContent();
      log(`ref ${ref} resolves to button text: "${text}"`);
      ok = true;
    } else {
      log('WARN: expected button ref not found');
    }

    await browser.close().catch(() => {});
    log(ok ? 'PHASE 0.5: PASS' : 'PHASE 0.5: PARTIAL');
  } catch (e) {
    log('PHASE 0.5: FAIL —', e.message);
    app.exit(1);
    return;
  }
  app.exit(ok ? 0 : 2);
});
