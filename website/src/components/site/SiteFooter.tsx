import Link from "next/link"
import { TRUTH } from "@/data/truth.generated"

const PRODUCT = [
  { href: "/install", label: "Install" },
  { href: "/tools", label: "Tools" },
  { href: "/languages", label: "Languages" },
  { href: "/editors", label: "Editors" },
] as const
const REFERENCE = [
  { href: "/docs", label: "Documentation" },
  { href: "/support", label: "Support" },
  { href: "/privacy", label: "Privacy" },
  { href: "/terms", label: "Terms" },
] as const

export function SiteFooter() {
  return (
    <footer className="footer">
      <div className="wrap">
        <div className="footer-top">
          <div>
            <p className="brand">
              <span className="glyph">bb</span> <span className="name">backbencher</span>
            </p>
            <p className="tagline">Local-first code intelligence. Your code never leaves the machine.</p>
          </div>
          <div>
            <h3>Product</h3>
            <ul>
              {PRODUCT.map((item) => (
                <li key={item.href}>
                  <Link href={item.href}>{item.label}</Link>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h3>Reference</h3>
            <ul>
              {REFERENCE.map((item) => (
                <li key={item.href}>
                  <Link href={item.href}>{item.label}</Link>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h3>Elsewhere</h3>
            <ul>
              <li>
                <a href="https://github.com/ishaq2321/bb" rel="noreferrer">
                  GitHub
                </a>
              </li>
            </ul>
          </div>
        </div>
        <div className="footer-bottom">
          <span>© 2026 Backbencher</span>
          <span>bb {TRUTH.version}</span>
          <span>local-first code intelligence</span>
        </div>
      </div>
    </footer>
  )
}
