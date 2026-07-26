import { randomBytes } from 'node:crypto'

/**
 * The property name Iris stamps into a page to identify which tab it is.
 *
 * It is randomised per run and defined non-enumerably, so it neither shows up in `Object.keys(window)`
 * nor gives a site a fixed name to test for. Without this, our own marker would be the single easiest
 * way for a page to detect Iris: a self-inflicted fingerprint.
 */
export const TAB_MARKER = `__${randomBytes(6).toString('hex')}`

/** JS that stamps the marker into a page's main world without making it enumerable. */
export function stampScript(tabId: string): string {
  return `Object.defineProperty(window,${JSON.stringify(TAB_MARKER)},{value:${JSON.stringify(tabId)},enumerable:false,configurable:true,writable:true});0`
}

/** JS that reads the marker back (empty string when absent). */
export const READ_MARKER = `window[${JSON.stringify(TAB_MARKER)}] || ""`
