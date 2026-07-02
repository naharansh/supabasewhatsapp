'use client'

import { useEffect, useRef } from 'react'
import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'

gsap.registerPlugin(ScrollTrigger)

export function GsapAnimations({ children }: { children: React.ReactNode }) {
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = root.current
    if (!el) return

    const ctx = gsap.context(() => {

      /* ── Hero ── */
      const heroEyebrow = el.querySelector('[data-anim="hero-eyebrow"]')
      const heroHeading = el.querySelector('[data-anim="hero-heading"]')
      const heroText = el.querySelector('[data-anim="hero-text"]')
      const heroBubble = el.querySelector('[data-anim="hero-bubble"]')

      const heroTl = gsap.timeline({ defaults: { ease: 'power3.out', duration: 1.0 } })
      heroTl
        .from(heroEyebrow, { y: 24, opacity: 0 })
        .from(heroHeading, { y: 30, opacity: 0 }, '-=0.4')
        .from(heroText, { y: 24, opacity: 0 }, '-=0.35')
        .from(heroBubble, { y: 36, opacity: 0, scale: 0.95 }, '-=0.4')

      /* ── Section reveals ── */
      const sections = el.querySelectorAll<HTMLElement>('[data-anim="section"]')
      sections.forEach((section) => {
        const heading = section.querySelector('h2')
        const paragraph = section.querySelector('p')
        const items = section.querySelectorAll('[data-anim="item"]')

        const cards = section.querySelectorAll('[data-anim="card"]')
        const allItems = [...items, ...cards]

        gsap.set(heading, { y: 28, opacity: 0 })
        gsap.set(paragraph, { y: 20, opacity: 0 })
        if (allItems.length) gsap.set(allItems, { y: 22, opacity: 0 })

        const tl = gsap.timeline({
          scrollTrigger: {
            trigger: section,
            start: 'top 82%',
            toggleActions: 'play reverse play reverse',
          },
          defaults: { ease: 'power2.out', duration: 1.1 },
        })

        if (heading) tl.to(heading, { y: 0, opacity: 1 }, 0)
        if (paragraph) tl.to(paragraph, { y: 0, opacity: 1 }, 0.18)
        if (allItems.length) tl.to(allItems, { y: 0, opacity: 1, stagger: 0.15 }, 0.3)
      })

      /* ── Renewal callout ── */
      const renewal = el.querySelector('[data-anim="renewal"]')
      if (renewal) {
        gsap.from(renewal, {
          scrollTrigger: { trigger: renewal, start: 'top 85%', toggleActions: 'play reverse play reverse' },
          y: 28,
          opacity: 0,
          duration: 0.9,
          ease: 'power2.out',
        })
      }

      /* ── Footer ── */
      const footer = el.querySelector('[data-anim="footer"]')
      if (footer) {
        gsap.from(footer, {
          scrollTrigger: { trigger: footer, start: 'top 88%', toggleActions: 'play reverse play reverse' },
          y: 24,
          opacity: 0,
          duration: 0.9,
          ease: 'power2.out',
        })
      }

      /* ── Card hover ── */
      const cards = el.querySelectorAll<HTMLElement>('[data-anim="card"]')
      cards.forEach((card) => {
        const borderColor = getComputedStyle(card).borderColor
        card.addEventListener('mouseenter', () => {
          gsap.to(card, {
            y: -6,
            boxShadow: '0 20px 48px -14px rgba(0,0,0,0.45)',
            borderColor: 'var(--primary)',
            duration: 0.4,
            ease: 'power2.out',
            overwrite: 'auto',
          })
        })
        card.addEventListener('mouseleave', () => {
          gsap.to(card, {
            y: 0,
            boxShadow: 'none',
            borderColor,
            duration: 0.4,
            ease: 'power2.out',
            overwrite: 'auto',
          })
        })
      })
    }, el)

    ScrollTrigger.refresh()

    return () => {
      ctx.revert()
      ScrollTrigger.getAll().forEach((st) => st.kill())
    }
  }, [])

  return <div ref={root}>{children}</div>
}
