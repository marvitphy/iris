import { chromium, type Browser, type Page } from 'playwright-core'
import { AURA_SHOW, AURA_HIDE, auraRipple } from './aura'

const AURA_IDLE_MS = 4000

export interface ActionResult {
  ok: boolean
  url: string
  snapshot: string
}

/**
 * The automation engine. Connects to Iris's OWN Chromium (the Electron process) over
 * CDP and drives Space pages with Playwright — the loop proven in Phase 0:
 * connectOverCDP + ariaSnapshot(mode:'ai') refs resolved via the aria-ref= engine.
 * Pages are routed by the Space's current URL (main supplies it). Known MVP limitation:
 * two Spaces on the exact same URL are ambiguous — tracked for targetId-based routing later.
 */
export class Engine {
  private browser: Browser | null = null
  private auraTimers = new Map<string, ReturnType<typeof setTimeout>>()

  constructor(private cdpPort: number) {}

  /** Show the agent-activity aura on a Space page and refresh its idle auto-hide timer. */
  async pulse(url: string): Promise<void> {
    const page = this.find(url)
    if (!page) return
    await page.evaluate(AURA_SHOW).catch(() => {})
    const prev = this.auraTimers.get(url)
    if (prev) clearTimeout(prev)
    this.auraTimers.set(
      url,
      setTimeout(() => {
        this.auraTimers.delete(url)
        void page.evaluate(AURA_HIDE).catch(() => {})
      }, AURA_IDLE_MS),
    )
  }

  async connect(): Promise<void> {
    if (this.browser) return
    const endpoint = `http://127.0.0.1:${this.cdpPort}`
    await this.waitForCdp(endpoint)
    this.browser = await chromium.connectOverCDP(endpoint, { noDefaults: true })
  }

  async snapshot(url: string): Promise<string> {
    const page = await this.requirePage(url)
    await page.waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => {})
    return page.locator('body').ariaSnapshot({ mode: 'ai' })
  }

  async click(url: string, ref: string): Promise<ActionResult> {
    const page = await this.requirePage(url)
    const loc = page.locator(`aria-ref=${ref}`)
    const box = await loc.boundingBox().catch(() => null)
    if (box) await page.evaluate(auraRipple(box.x + box.width / 2, box.y + box.height / 2)).catch(() => {})
    await loc.click({ timeout: 8000 })
    return this.settle(page)
  }

  async type(url: string, ref: string, text: string, submit = false): Promise<ActionResult> {
    const page = await this.requirePage(url)
    const loc = page.locator(`aria-ref=${ref}`)
    await loc.fill(text, { timeout: 8000 })
    if (submit) await page.keyboard.press('Enter')
    return this.settle(page)
  }

  /** Run agent JS in the page and return the serializable result — dense extraction in one call. */
  async evaluate(url: string, expression: string): Promise<unknown> {
    const page = await this.requirePage(url)
    return page.evaluate(expression)
  }

  /** PNG screenshot of the page as base64 — gives the agent vision on canvas/visual pages. */
  async screenshot(url: string, fullPage = false): Promise<string> {
    const page = await this.requirePage(url)
    const buf = await page.screenshot({ fullPage, type: 'png' })
    return buf.toString('base64')
  }

  /** Bring an element into the user's view: scroll it into view and flash a purple highlight over it
   *  (via the CDP inspector overlay — no page injection, so it works even under strict CSP like X). */
  async reveal(url: string, ref: string): Promise<ActionResult> {
    const page = await this.requirePage(url)
    const loc = page.locator(`aria-ref=${ref}`)
    // smooth-scroll so the element lands ~160px from the top — breathing room above, easy to read
    const pre = await loc.boundingBox().catch(() => null)
    if (pre) {
      const delta = Math.round(pre.y - 160)
      await page.evaluate(`window.scrollBy({top:${delta},left:0,behavior:'smooth'})`).catch(() => {})
      await page.waitForTimeout(550)
    }
    const box = await loc.boundingBox().catch(() => null)
    if (box) {
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
        // overlay unavailable — scroll already brought it into view
      }
    }
    return this.settle(page)
  }

  async scroll(url: string, dy: number): Promise<ActionResult> {
    const page = await this.requirePage(url)
    await page.evaluate(`window.scrollBy({top:${Math.round(dy)},left:0,behavior:'smooth'})`)
    await page.waitForTimeout(500)
    return this.settle(page)
  }

  async readText(url: string, ref?: string): Promise<string> {
    const page = await this.requirePage(url)
    const loc = ref ? page.locator(`aria-ref=${ref}`) : page.locator('body')
    return (await loc.innerText({ timeout: 8000 })).trim()
  }

  /** Read the text currently visible in the viewport — i.e. what the user is looking at right now. */
  async readViewport(url: string): Promise<string> {
    const page = await this.requirePage(url)
    const script = `(() => {
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
    const text = await page.evaluate<string>(script).catch(() => '')
    return text
  }

  /** Heuristic check for a wall the human must clear (captcha / OTP / login). Returns a reason or null. */
  async detectHandoff(url: string): Promise<string | null> {
    const page = this.find(url)
    if (!page) return null
    const script = `(() => {
      const q = (s) => document.querySelector(s);
      const txt = (document.body && document.body.innerText || '').slice(0, 6000).toLowerCase();
      if (q('iframe[src*="recaptcha"]') || q('iframe[src*="hcaptcha"]') || q('iframe[src*="challenges.cloudflare"]')
          || q('.g-recaptcha') || q('.h-captcha') || /verify you are human|are you a robot|n[aã]o sou um rob[oô]|sou humano|prove you'?re human/.test(txt))
        return 'captcha';
      if (q('input[autocomplete="one-time-code"]') || /verification code|one-time code|c[oó]digo de verifica|two-factor|autentica[cç][aã]o de dois fatores|enter the code|c[oó]digo enviado/.test(txt))
        return 'código de verificação (OTP)';
      const pw = q('input[type=password]');
      if (pw && pw.offsetParent !== null) return 'login necessário';
      return null;
    })()`
    return page.evaluate<string | null>(script).catch(() => null)
  }

  private async settle(page: Page): Promise<ActionResult> {
    await page.waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => {})
    return { ok: true, url: page.url(), snapshot: await page.locator('body').ariaSnapshot({ mode: 'ai' }) }
  }

  private find(url: string): Page | null {
    if (!this.browser) return null
    for (const ctx of this.browser.contexts()) {
      for (const page of ctx.pages()) {
        if (page.url() === url) return page
      }
    }
    return null
  }

  private async reconnect(): Promise<void> {
    try {
      await this.browser?.close()
    } catch {
      // disconnecting a CDP attach can throw; ignore
    }
    this.browser = null
    await this.connect()
  }

  /**
   * Resolve the Playwright page for a Space URL. Pages created by Electron after the
   * initial CDP attach aren't in the cached context tree, so on a miss we reconnect
   * (re-enumerating all current targets) and retry once.
   */
  private async requirePage(url: string): Promise<Page> {
    const hit = this.find(url)
    if (hit) return hit
    await this.reconnect()
    const retry = this.find(url)
    if (retry) return retry
    throw new Error(`no page found for url ${url}`)
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
