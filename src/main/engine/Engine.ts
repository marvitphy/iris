import { chromium, type Browser, type Page } from 'playwright-core'
import { READ_MARKER } from '../marker'

const ACTION_TIMEOUT = 8000
/** minimum gap between agent interactions, so we move at a human cadence */
const MIN_ACTION_GAP_MS = 350
/** link-heavy pages produce enormous trees; past this the agent pays for context it will not read */
const SNAPSHOT_MAX_CHARS = 24000

function truncateSnapshot(tree: string, maxChars: number): string {
  if (tree.length <= maxChars) return tree
  return `${tree.slice(0, maxChars)}

[snapshot truncated at ${maxChars} characters. Scroll, or snapshot a smaller region, to see the rest.]`
}

export interface ActionResult {
  ok: boolean
  url: string
  snapshot: string
}

/**
 * Identifies which page to act on. `token` is the per-tab marker SpaceManager stamps into the page
 * , so two tabs on the SAME url are never confused; `url` is the fallback for
 * pages that haven't been stamped yet (mid-navigation, about:blank).
 */
export interface PageTarget {
  token: string
  url: string
}

/**
 * The automation engine. Connects to Iris's OWN Chromium (the Electron process) over CDP and drives
 * Space pages with Playwright: connectOverCDP + ariaSnapshot(mode:'ai') refs resolved via the
 * aria-ref= selector engine. Pages are routed by tab token first, url second.
 */
export class Engine {
  private browser: Browser | null = null
  private lastActionAt = 0
  private pagesByToken = new Map<string, Page>()
  /** A tab keeps its token across navigations, so this is stable and saves re-evaluating pages.
   *  Fewer in-page evaluates also means a smaller automation footprint on strict sites. */
  private tokenCache = new WeakMap<Page, string>()

  constructor(private cdpPort: number) {}

  async connect(): Promise<void> {
    if (this.browser) return
    const endpoint = `http://127.0.0.1:${this.cdpPort}`
    await this.waitForCdp(endpoint)
    this.browser = await chromium.connectOverCDP(endpoint, { noDefaults: true })
  }

  async snapshot(target: PageTarget, maxChars = SNAPSHOT_MAX_CHARS): Promise<string> {
    const page = await this.requirePage(target)
    await page.waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => {})
    const tree = await page.locator('body').ariaSnapshot({ mode: 'ai' })
    return truncateSnapshot(tree, maxChars)
  }

  async click(target: PageTarget, ref: string): Promise<ActionResult> {
    const page = await this.requirePage(target)
    await this.pace()
    const loc = page.locator(`aria-ref=${ref}`)
    try {
      await loc.click({ timeout: ACTION_TIMEOUT })
    } catch (e) {
      // Playwright waits for the element to stop moving; pages that animate forever (or re-render on
      // a timer) never satisfy that, so retry once ignoring actionability rather than failing.
      if (!/Timeout|not stable|intercepts pointer/i.test(String(e))) throw e
      await loc.click({ timeout: ACTION_TIMEOUT, force: true })
    }
    return this.settle(page)
  }

  /**
   * Keep a human cadence between interactions. Firing clicks milliseconds apart is both the clearest
   * signal that nobody is really there and a good way to race a page that hasn't finished reacting.
   */
  private async pace(): Promise<void> {
    const since = Date.now() - this.lastActionAt
    const wait = MIN_ACTION_GAP_MS - since
    if (wait > 0) await new Promise((r) => setTimeout(r, wait))
    this.lastActionAt = Date.now()
  }

  /**
   * Fill an element. Rich-text editors (contenteditable: Slate, Quill, X's composer) often ignore a
   * programmatic value set, so we verify the text actually landed and fall back to real keystrokes.
   */
  async type(target: PageTarget, ref: string, text: string, submit = false): Promise<ActionResult> {
    const page = await this.requirePage(target)
    await this.pace()
    const loc = page.locator(`aria-ref=${ref}`)
    await loc.fill(text, { timeout: ACTION_TIMEOUT }).catch(() => {})
    const landed = await loc
      .evaluate((el: { value?: string; textContent?: string | null }) => (el.value ?? el.textContent ?? '').trim())
      .catch(() => '')
    if (!landed.includes(text.trim().slice(0, 24))) {
      await loc.click({ timeout: ACTION_TIMEOUT }).catch(() => {})
      await page.keyboard.type(text, { delay: 8 })
    }
    if (submit) await page.keyboard.press('Enter')
    return this.settle(page)
  }

  async pressKey(target: PageTarget, key: string): Promise<ActionResult> {
    const page = await this.requirePage(target)
    await this.pace()
    await page.keyboard.press(key)
    return this.settle(page)
  }

  async selectOption(target: PageTarget, ref: string, value: string): Promise<ActionResult> {
    const page = await this.requirePage(target)
    const loc = page.locator(`aria-ref=${ref}`)
    await loc.selectOption({ label: value }, { timeout: ACTION_TIMEOUT }).catch(async () => {
      await loc.selectOption(value, { timeout: ACTION_TIMEOUT })
    })
    return this.settle(page)
  }

  async uploadFile(target: PageTarget, ref: string, paths: string[]): Promise<ActionResult> {
    const page = await this.requirePage(target)
    await page.locator(`aria-ref=${ref}`).setInputFiles(paths, { timeout: ACTION_TIMEOUT })
    return this.settle(page)
  }

  /** Run agent JS in the page and return the serializable result — dense extraction in one call. */
  async evaluate(target: PageTarget, expression: string): Promise<unknown> {
    const page = await this.requirePage(target)
    return page.evaluate(expression)
  }

  /** PNG screenshot of the page as base64 — gives the agent vision on canvas/visual pages. */
  async screenshot(target: PageTarget, fullPage = false): Promise<string> {
    const page = await this.requirePage(target)
    const buf = await page.screenshot({ fullPage, type: 'png' })
    return buf.toString('base64')
  }

  /** Bring an element into the user's view: scroll it into view and flash a purple highlight over it
   *  (via the CDP inspector overlay — no page injection, so it works even under strict CSP like X). */
  async reveal(target: PageTarget, ref: string): Promise<ActionResult> {
    const page = await this.requirePage(target)
    const loc = page.locator(`aria-ref=${ref}`)
    // smooth-scroll so the element lands ~160px from the top — breathing room above, easy to read
    const pre = await loc.boundingBox().catch(() => null)
    if (pre) {
      await page.evaluate(`window.scrollBy({top:${Math.round(pre.y - 160)},left:0,behavior:'smooth'})`).catch(() => {})
      await page.waitForTimeout(550)
    }
    const box = await loc.boundingBox().catch(() => null)
    if (box) await this.flashHighlight(page, box)
    return this.settle(page)
  }

  async scroll(target: PageTarget, dy: number): Promise<ActionResult> {
    const page = await this.requirePage(target)
    await page.evaluate(`window.scrollBy({top:${Math.round(dy)},left:0,behavior:'smooth'})`)
    await page.waitForTimeout(500)
    return this.settle(page)
  }

  async readText(target: PageTarget, ref?: string): Promise<string> {
    const page = await this.requirePage(target)
    const loc = ref ? page.locator(`aria-ref=${ref}`) : page.locator('body')
    return (await loc.innerText({ timeout: ACTION_TIMEOUT })).trim()
  }

  /** Readable main content as markdown: the article body, headings and links kept, chrome dropped.
   *  Far fewer tokens than raw page text, and keeps the structure the agent reasons about. */
  async scrape(target: PageTarget): Promise<string> {
    const page = await this.requirePage(target)
    return page.evaluate<string>(SCRAPE_SCRIPT).catch(() => '')
  }

  /** Read the text currently visible in the viewport — i.e. what the user is looking at right now. */
  async readViewport(target: PageTarget): Promise<string> {
    const page = await this.requirePage(target)
    return page.evaluate<string>(VIEWPORT_SCRIPT).catch(() => '')
  }

  /** Heuristic check for a wall the human must clear (captcha / OTP / login). Returns a reason or null. */
  async detectHandoff(target: PageTarget): Promise<string | null> {
    const page = await this.find(target)
    if (!page) return null
    return page.evaluate<string | null>(HANDOFF_SCRIPT).catch(() => null)
  }

  /**
   * Make a Space present a different location to the sites in it: geolocation, timezone and language
   * together, because a coordinate that disagrees with the clock and the Accept-Language reads as
   * nonsense to any site that checks. Applied per page over CDP.
   */
  async applyLocation(
    target: PageTarget,
    loc: { latitude: number; longitude: number; timezone: string; locale: string } | null,
  ): Promise<void> {
    const page = await this.find(target)
    if (!page) return
    try {
      const client = await page.context().newCDPSession(page)
      if (!loc) {
        await client.send('Emulation.clearGeolocationOverride')
        await client.detach()
        return
      }
      await client.send('Emulation.setGeolocationOverride', {
        latitude: loc.latitude,
        longitude: loc.longitude,
        accuracy: 40,
      })
      await client.send('Emulation.setTimezoneOverride', { timezoneId: loc.timezone }).catch(() => {})
      await client.send('Emulation.setLocaleOverride', { locale: loc.locale }).catch(() => {})
      await client.detach()
    } catch {
      // emulation unavailable on this target: leave the real location in place
    }
  }

  private async flashHighlight(page: Page, box: { x: number; y: number; width: number; height: number }): Promise<void> {
    try {
      const client = await page.context().newCDPSession(page)
      await client.send('Overlay.enable')
      await client.send('Overlay.highlightRect', {
        x: Math.round(box.x),
        y: Math.round(box.y),
        width: Math.round(box.width),
        height: Math.round(box.height),
        color: { r: 176, g: 107, b: 255, a: 0.22 },
        outlineColor: { r: 176, g: 107, b: 255, a: 0.9 },
      })
      setTimeout(() => {
        client.send('Overlay.hideHighlight').catch(() => {})
        client.detach().catch(() => {})
      }, 2800)
    } catch {
      // overlay unavailable — the scroll already brought it into view
    }
  }

  private async settle(page: Page): Promise<ActionResult> {
    await page.waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => {})
    const tree = await page.locator('body').ariaSnapshot({ mode: 'ai' })
    return { ok: true, url: page.url(), snapshot: truncateSnapshot(tree, SNAPSHOT_MAX_CHARS) }
  }

  private async tokenOf(page: Page): Promise<string> {
    const cached = this.tokenCache.get(page)
    if (cached) return cached
    const token = await page.evaluate<string>(READ_MARKER).catch(() => '')
    if (token) this.tokenCache.set(page, token)
    return token
  }

  /** Resolve the page for a target: cached token match, then a full scan, then url fallback. */
  private async find(target: PageTarget): Promise<Page | null> {
    if (!this.browser) return null
    const cached = this.pagesByToken.get(target.token)
    if (cached && !cached.isClosed() && (await this.tokenOf(cached)) === target.token) return cached

    let urlMatch: Page | null = null
    for (const ctx of this.browser.contexts()) {
      for (const page of ctx.pages()) {
        if (page.isClosed()) continue
        const token = await this.tokenOf(page)
        if (token) this.pagesByToken.set(token, page)
        if (token && token === target.token) return page
        if (!urlMatch && page.url() === target.url) urlMatch = page
      }
    }
    return urlMatch
  }

  private async reconnect(): Promise<void> {
    try {
      await this.browser?.close()
    } catch {
      // disconnecting a CDP attach can throw; ignore
    }
    this.browser = null
    this.pagesByToken.clear()
    await this.connect()
  }

  /**
   * Resolve the page for a target. Pages created by Electron after the initial CDP attach aren't in
   * the cached context tree, so on a miss we reconnect (re-enumerating targets) and retry once.
   */
  private async requirePage(target: PageTarget): Promise<Page> {
    const hit = await this.find(target)
    if (hit) return hit
    await this.reconnect()
    const retry = await this.find(target)
    if (retry) return retry
    throw new Error(`no page found for tab ${target.token} (${target.url})`)
  }

  private async waitForCdp(endpoint: string, timeoutMs = 15000): Promise<void> {
    const start = Date.now()
    while (Date.now() - start < timeoutMs) {
      try {
        const r = await fetch(`${endpoint}/json/version`)
        if (r.ok) return
      } catch {
        // not up yet
      }
      await new Promise((res) => setTimeout(res, 150))
    }
    throw new Error('Iris CDP endpoint never came up')
  }
}

const VIEWPORT_SCRIPT = `(() => {
  const vh = window.innerHeight, vw = window.innerWidth;
  const out = []; const seen = new Set();
  const els = document.body.querySelectorAll('h1,h2,h3,h4,h5,p,li,a,button,article,td,th,blockquote,[role=heading],[role=button],[role=link],[role=article]');
  for (const el of els) {
    const r = el.getBoundingClientRect();
    if (r.bottom < 0 || r.top > vh || r.right < 0 || r.left > vw) continue;
    if (r.width < 6 || r.height < 6) continue;
    let t = (el.innerText || el.textContent || '').trim().replace(/\\s+/g, ' ');
    if (!t || t.length < 2) continue;
    t = t.slice(0, 280);
    if (seen.has(t)) continue; seen.add(t);
    out.push(t);
    if (out.join('\\n').length > 7000) break;
  }
  return out.join('\\n');
})()`

const HANDOFF_SCRIPT = `(() => {
  const q = (s) => document.querySelector(s);
  const txt = (document.body && document.body.innerText || '').slice(0, 6000).toLowerCase();
  if (q('iframe[src*="recaptcha"]') || q('iframe[src*="hcaptcha"]') || q('iframe[src*="challenges.cloudflare"]')
      || q('.g-recaptcha') || q('.h-captcha') || /verify you are human|are you a robot|prove you'?re human/.test(txt))
    return 'captcha';
  if (q('input[autocomplete="one-time-code"]') || /verification code|one-time code|two-factor|enter the code/.test(txt))
    return 'verification code (OTP)';
  const pw = q('input[type=password]');
  if (pw && pw.offsetParent !== null) return 'login required';
  return null;
})()`

/** Readability-lite: pick the densest content container, serialize it to markdown. */
const SCRAPE_SCRIPT = `(() => {
  const strip = 'script,style,noscript,svg,nav,footer,header,aside,form,iframe,[aria-hidden="true"]';
  const scoreOf = (el) => {
    const text = el.innerText || '';
    if (text.length < 140) return -1;
    const links = el.querySelectorAll('a').length;
    const density = links / Math.max(1, text.length / 100);
    return text.length * (density > 1.2 ? 0.25 : 1);
  };
  let best = document.body, bestScore = -1;
  const candidates = document.querySelectorAll('article,main,[role=main],.content,.post,.article,#content,section,div');
  for (const el of candidates) {
    const s = scoreOf(el);
    if (s > bestScore) { bestScore = s; best = el; }
  }
  const root = best.cloneNode(true);
  root.querySelectorAll(strip).forEach((n) => n.remove());
  const lines = [];
  const walk = (node) => {
    for (const el of node.children) {
      const tag = el.tagName.toLowerCase();
      const text = (el.innerText || '').trim().replace(/\\s+\\n/g, '\\n');
      if (!text) continue;
      if (/^h[1-6]$/.test(tag)) { lines.push('\\n' + '#'.repeat(+tag[1]) + ' ' + text.replace(/\\s+/g, ' ')); continue; }
      if (tag === 'li') { lines.push('- ' + text.replace(/\\s+/g, ' ')); continue; }
      if (tag === 'blockquote') { lines.push('> ' + text.replace(/\\s+/g, ' ')); continue; }
      if (tag === 'pre') { lines.push('\\n\`\`\`\\n' + text + '\\n\`\`\`'); continue; }
      if (tag === 'a' && el.href) { lines.push('[' + text.replace(/\\s+/g, ' ') + '](' + el.href + ')'); continue; }
      if (tag === 'p') { lines.push(text.replace(/\\s+/g, ' ')); continue; }
      if (el.children.length) { walk(el); continue; }
      lines.push(text.replace(/\\s+/g, ' '));
    }
  };
  walk(root);
  const title = (document.title || '').trim();
  const body = lines.filter(Boolean).join('\\n').replace(/\\n{3,}/g, '\\n\\n').slice(0, 12000);
  return (title ? '# ' + title + '\\n\\n' : '') + body;
})()`
