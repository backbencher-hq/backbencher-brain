import Link from "next/link"
import { AtlasMobileMenu } from "./AtlasMobileMenu"

const SURFACES = [
  { href: "/install", label: "Install" },
  { href: "/docs", label: "Docs" },
  { href: "/tools", label: "Tools" },
  { href: "/languages", label: "Languages" },
  { href: "/editors", label: "Editors" },
  { href: "/support", label: "Support" },
]

export function AtlasNav() {
  return (
    <header className="nav container">
      <Link className="brand" href="/">
        <b>bb</b>
        <span>backbencher</span>
      </Link>
      <ul>
        {SURFACES.map((surface) => (
          <li key={surface.href}>
            <Link href={surface.href}>{surface.label}</Link>
          </li>
        ))}
      </ul>
      <Link className="install" href="/install">Install bb →</Link>
      <AtlasMobileMenu surfaces={SURFACES} />
    </header>
  )
}
