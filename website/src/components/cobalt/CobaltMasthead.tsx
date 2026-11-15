import Link from "next/link"

const SURFACES = [
  { href: "/tools", label: "Tools" },
  { href: "/languages", label: "Languages" },
  { href: "/editors", label: "Editors" },
  { href: "/docs", label: "Docs" },
] as const

export function CobaltMasthead() {
  return (
    <header className="masthead">
      <div className="container masthead-inner">
        <Link className="wordmark" href="/" aria-label="Backbencher home">
          bb <small>backbencher</small>
        </Link>
        <nav aria-label="Sections">
          {SURFACES.map((surface) => (
            <Link key={surface.href} href={surface.href}>
              {surface.label}
            </Link>
          ))}
          <Link className="key key--primary key--sm" href="/install">
            Install bb
          </Link>
        </nav>
        <details className="masthead-menu">
          <summary>Menu</summary>
          <nav aria-label="Sections">
            {SURFACES.map((surface) => (
              <Link key={surface.href} href={surface.href}>
                {surface.label}
              </Link>
            ))}
            <Link href="/install">Install</Link>
          </nav>
        </details>
      </div>
    </header>
  )
}
