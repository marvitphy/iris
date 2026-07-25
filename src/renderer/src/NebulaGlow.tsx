import { useEffect, useRef } from 'react'
import { Motion } from 'ai-motion'

/**
 * The agent-activity halo around the site card, using ai-motion (MIT, WebGL2 border glow) rendered
 * at the shell level — our own renderer, so no page CSP to fight (page-agent injects the same effect
 * in-page, which strict sites like X block). The canvas sits in a frame that overhangs the card into
 * the acrylic margin, so the glow reads as a halo. Fades in while the agent works.
 */
export function NebulaGlow({ active }: { active: boolean }): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null)
  const motionRef = useRef<Motion | null>(null)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    let motion: Motion
    try {
      motion = new Motion({
        mode: 'dark',
        borderWidth: 3,
        glowWidth: 44,
        borderRadius: 11,
        colors: ['rgb(176,107,255)', 'rgb(124,107,255)', 'rgb(224,107,208)', 'rgb(90,139,255)'],
        styles: { position: 'absolute', inset: '0' },
      })
    } catch {
      return // no WebGL2 — skip the halo, the app still works
    }
    motionRef.current = motion
    host.appendChild(motion.element)
    motion.autoResize(host)
    return () => {
      motionRef.current = null
      try {
        motion.dispose()
      } catch {
        // already gone
      }
    }
  }, [])

  useEffect(() => {
    const motion = motionRef.current
    if (!motion) return
    if (active) {
      motion.start()
      void motion.fadeIn()
    } else {
      void motion.fadeOut().then(() => motion.pause())
    }
  }, [active])

  return <div ref={hostRef} className="nebula" aria-hidden="true" />
}
