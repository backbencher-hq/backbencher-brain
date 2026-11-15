"use client"

import { useEffect, useRef } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"

// The mobile nav is a native <details> disclosure, so it works with no JS at
// all. This wrapper adds the three behaviours a disclosure on a website should
// also honour: Escape closes it and returns focus to the summary, a pointer
// outside closes it, and a client-side route change starts with it closed.
export function AtlasMobileMenu({ surfaces }: { surfaces: { href: string; label: string }[] }) {
  const ref = useRef<HTMLDetailsElement>(null)
  const pathname = usePathname()

  useEffect(() => {
    const details = ref.current
    if (details) details.open = false
  }, [pathname])

  useEffect(() => {
    const details = ref.current
    if (!details) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !details.open) return
      details.open = false
      details.querySelector("summary")?.focus()
    }
    const onPointer = (event: PointerEvent) => {
      if (details.open && event.target instanceof Node && !details.contains(event.target)) details.open = false
    }
    document.addEventListener("keydown", onKey)
    document.addEventListener("pointerdown", onPointer)
    return () => {
      document.removeEventListener("keydown", onKey)
      document.removeEventListener("pointerdown", onPointer)
    }
  }, [])

  return (
    <details className="menu" ref={ref}>
      <summary>Menu</summary>
      <nav aria-label="Sections">
        <ul>
          {surfaces.map((surface) => (
            <li key={surface.href}>
              <Link href={surface.href}>{surface.label}</Link>
            </li>
          ))}
        </ul>
      </nav>
    </details>
  )
}
