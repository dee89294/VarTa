/**
 * File: src/components/ui/MotionPrimitives.tsx
 * Purpose: Reusable Framer Motion & IntersectionObserver animation building blocks (`PageTransition`,
 *   `ScrollReveal`, `StaggerGrid`, `StaggerItem`, `AnimatedCounter`, `SkeletonCard`).
 * Why required: Centralizes smooth SaaS page transitions, scroll-triggered reveals, staggered grids,
 *   KPI counter animations, and light alabaster loading skeletons.
 * Connected files:
 *   - `src/App.tsx` (wraps routes with `MotionConfig reducedMotion="user"`)
 *   - Consumed by all dashboard, directory, calendar, attendance, and reporting pages.
 * Impact if modified/removed: Pages lose transitions, scroll reveals, and loading skeleton placeholders.
 */
import React, { useEffect, useState } from 'react'
import { motion } from 'framer-motion'

export function PageTransition({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6 }}
      transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
      className={className}
    >
      {children}
    </motion.div>
  )
}

export function ScrollReveal({
  children,
  className = '',
  delay = 0,
}: {
  children: React.ReactNode
  className?: string
  delay?: number
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 18 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.12 }}
      transition={{ duration: 0.45, delay, ease: [0.22, 1, 0.36, 1] }}
      className={className}
    >
      {children}
    </motion.div>
  )
}

export function StaggerGrid({
  children,
  className = '',
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <motion.div
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true, amount: 0.08 }}
      variants={{
        hidden: {},
        visible: {
          transition: {
            staggerChildren: 0.055,
          },
        },
      }}
      className={className}
    >
      {children}
    </motion.div>
  )
}

export function StaggerItem({
  children,
  className = '',
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <motion.div
      variants={{
        hidden: { opacity: 0, y: 16 },
        visible: {
          opacity: 1,
          y: 0,
          transition: { duration: 0.38, ease: [0.22, 1, 0.36, 1] },
        },
      }}
      className={className}
    >
      {children}
    </motion.div>
  )
}

export function AnimatedCounter({ value, suffix = '' }: { value: number; suffix?: string }) {
  const [display, setDisplay] = useState(0)

  useEffect(() => {
    const start = 0
    const duration = 550
    const startTime = performance.now()
    let raf = 0

    const step = (now: number) => {
      const progress = Math.min(1, (now - startTime) / duration)
      const eased = 1 - Math.pow(1 - progress, 3)
      setDisplay(Math.round(start + (value - start) * eased))
      if (progress < 1) {
        raf = requestAnimationFrame(step)
      }
    }

    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [value])

  return (
    <span>
      {display}
      {suffix}
    </span>
  )
}

export function SkeletonCard({ className = '' }: { className?: string }) {
  return (
    <div className={`varta-card rounded-3xl p-5 animate-pulse ${className}`}>
      <div className="h-3 w-24 rounded-full bg-[#E8EBF4] mb-3" />
      <div className="h-8 w-16 rounded-lg bg-[#DFE3F0] mb-2" />
      <div className="h-3 w-32 rounded-full bg-[#EEF0F7]" />
    </div>
  )
}
