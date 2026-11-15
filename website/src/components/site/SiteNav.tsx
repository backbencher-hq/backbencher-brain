import Link from "next/link"
import { Arrow } from "./Arrow"

const SURFACES = [
  { href: "/docs", label: "Docs" },
  { href: "/tools", label: "Tools" },
  { href: "/languages", label: "Languages" },
  { href: "/editors", label: "Editors" },
] as const

export function SiteNav() {
  return (
    <header className="nav">
      <div className="wrap nav-inner">
        <Link className="brand" href="/" aria-label="Backbencher home">
          <span className="glyph">bb</span>
          <span className="name">backbencher</span>
        </Link>
        <nav className="nav-links" aria-label="Sections">
          {SURFACES.map((surface) => (
            <Link key={surface.href} href={surface.href}>
              {surface.label}
            </Link>
          ))}
        </nav>
        <Link className="btn" href="/install">
          Install bb <Arrow />
        </Link>
        <details className="menu">
          <summary>Menu</summary>
          <nav aria-label="Sections">
            <ul>
              {SURFACES.map((surface) => (
                <li key={surface.href}>
                  <Link href={surface.href}>{surface.label}</Link>
                </li>
              ))}
              <li>
                <Link href="/install">Install bb</Link>
              </li>
            </ul>
          </nav>
        </details>
      </div>
    </header>
  )
}
