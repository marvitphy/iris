/**
 * Injected page overlays that visualize agent activity. Rendered inside a shadow root
 * with pointer-events:none so they never block the human's own interaction — the opposite
 * of a blocking mask. Purple = the agent Space color. Evaluated in the page context.
 */

const HOST_ID = '__iris_aura__'

export const AURA_SHOW = `(() => {
  const ID = '${HOST_ID}';
  let host = document.getElementById(ID);
  if (!host) {
    host = document.createElement('div');
    host.id = ID;
    host.setAttribute('aria-hidden', 'true');
    host.setAttribute('data-page-agent-ignore', 'true');
    host.style.cssText = 'position:fixed;inset:0;z-index:2147483646;pointer-events:none;opacity:0;transition:opacity .5s ease';
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = \`
      <style>
        @keyframes irisBreath { 0%,100% { opacity:.5 } 50% { opacity:1 } }
        @keyframes irisSpin { to { transform: rotate(360deg) } }
        .neb {
          position: fixed; inset: -45%; pointer-events: none;
          background: conic-gradient(from 0deg,
            rgba(168,85,247,0), rgba(168,85,247,.55), rgba(59,130,246,.4),
            rgba(217,70,239,.55), rgba(139,92,246,.4), rgba(168,85,247,0));
          filter: blur(46px); opacity: .7;
          -webkit-mask: radial-gradient(ellipse 60% 60% at center, transparent 58%, #000 80%);
          mask: radial-gradient(ellipse 60% 60% at center, transparent 58%, #000 80%);
          animation: irisSpin 16s linear infinite;
        }
        .frame {
          position: fixed; inset: 0; pointer-events: none;
          box-shadow: inset 0 0 20px 2px rgba(168,85,247,.55), inset 0 0 64px 14px rgba(139,92,246,.32);
          animation: irisBreath 3.2s ease-in-out infinite;
        }
      </style>
      <div class="neb"></div>
      <div class="frame"></div>\`;
    (document.documentElement || document.body).appendChild(host);
  }
  requestAnimationFrame(() => { host.style.opacity = '1'; });
})()`

export const AURA_HIDE = `(() => {
  const host = document.getElementById('${HOST_ID}');
  if (!host) return;
  host.style.opacity = '0';
  setTimeout(() => host.remove(), 600);
})()`

/** A purple ripple at viewport coords — call with the click point. Returns a JS expression. */
export function auraRipple(x: number, y: number): string {
  return `(() => {
    const r = document.createElement('div');
    r.setAttribute('data-page-agent-ignore', 'true');
    r.style.cssText = 'position:fixed;left:${x}px;top:${y}px;width:14px;height:14px;margin:-7px 0 0 -7px;' +
      'border-radius:50%;pointer-events:none;z-index:2147483647;' +
      'background:radial-gradient(circle, rgba(168,85,247,.9), rgba(168,85,247,0) 70%);' +
      'box-shadow:0 0 12px 4px rgba(168,85,247,.6);transition:transform .5s ease-out, opacity .5s ease-out;';
    document.documentElement.appendChild(r);
    requestAnimationFrame(() => { r.style.transform = 'scale(5)'; r.style.opacity = '0'; });
    setTimeout(() => r.remove(), 550);
  })()`
}
