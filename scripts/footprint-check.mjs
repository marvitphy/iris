/**
 * Measure Iris's automation footprint: the signals a site can read to decide "nobody is really here".
 * Reducing these is about not being a FALSE POSITIVE while a real person drives their own session.
 *
 * Usage: start Iris, then `node scripts/footprint-check.mjs`
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const handshakePath = join(process.env.LOCALAPPDATA ?? '.', 'Iris', 'runtime.json')
const { controlPort } = JSON.parse(readFileSync(handshakePath, 'utf8'))
const base = `http://127.0.0.1:${controlPort}`

const call = async (path, method = 'GET', body) => {
  const res = await fetch(base + path, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  return res.json()
}

const { spaces } = await call('/spaces')
const space = spaces.find((s) => s.active) ?? spaces[0]
if (!space) throw new Error('no Space open in Iris')

console.log(`checking in Space "${space.label}"\n`)
await call(`/spaces/${space.id}/navigate`, 'POST', { url: 'https://example.com' })

const PROBE = `(() => {
  const out = {};
  out.userAgent = navigator.userAgent;
  out.webdriver = navigator.webdriver;
  out.platform = navigator.platform;
  out.languages = navigator.languages.join(',');
  out.hardwareConcurrency = navigator.hardwareConcurrency;
  out.deviceMemory = navigator.deviceMemory ?? null;
  out.plugins = navigator.plugins.length;
  out.chromeObject = typeof window.chrome;
  out.chromeRuntime = !!(window.chrome && window.chrome.runtime);
  out.permissionsQuery = typeof navigator.permissions?.query;
  out.screen = screen.width + 'x' + screen.height + ' avail ' + screen.availWidth + 'x' + screen.availHeight;
  out.windowSize = window.outerWidth + 'x' + window.outerHeight;
  out.touch = navigator.maxTouchPoints;
  out.webglVendor = (() => {
    try {
      const gl = document.createElement('canvas').getContext('webgl');
      const dbg = gl.getExtension('WEBGL_debug_renderer_info');
      return gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) + ' / ' + gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL);
    } catch { return 'unavailable'; }
  })();
  out.irisMarkerEnumerable = Object.keys(window).some((k) => /^__[0-9a-f]{12}$/.test(k));
  out.cdpArtifacts = Object.keys(window).filter((k) => /cdc_|__playwright|__puppeteer|_selenium|callSelenium/.test(k));
  return out;
})()`

const { value } = await call(`/spaces/${space.id}/evaluate`, 'POST', { expression: PROBE })

const verdicts = {
  userAgent: (v) => (/Electron|Iris\//.test(v) ? 'LEAK: announces Electron/Iris' : 'ok: plain Chromium'),
  webdriver: (v) => (v ? 'LEAK: navigator.webdriver is true' : 'ok: false/undefined'),
  plugins: (v) => (v === 0 ? 'weak: zero plugins (common on automation)' : 'ok'),
  chromeObject: (v) => (v === 'undefined' ? 'weak: window.chrome missing' : 'ok'),
  irisMarkerEnumerable: (v) => (v ? 'LEAK: our tab marker is enumerable on window' : 'ok: marker not enumerable'),
  windowSize: (v) => (v === '0x0' ? 'known signal: WebContentsView reports no outer window size' : 'ok'),
  cdpArtifacts: (v) => (v.length ? `LEAK: ${v.join(', ')}` : 'ok: none'),
}

for (const [key, val] of Object.entries(value)) {
  const verdict = verdicts[key] ? `  -> ${verdicts[key](val)}` : ''
  console.log(`${key.padEnd(20)} ${JSON.stringify(val)}${verdict}`)
}
