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

export function CobaltColophon() {
  return (
    <footer className="colophon" aria-label="Colophon">
      <div className="container">
        <div className="colophon-brand">
          <Link className="wordmark" href="/" aria-label="Backbencher home">
            bb <small>backbencher</small>
          </Link>
          <p>Local-first code intelligence. The index lives on the machine that holds the code.</p>
        </div>
        <nav aria-label="Footer">
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
        </nav>
        <div className="colophon-mark">
          <span>bb {TRUTH.version}</span>
          <span>local-first code intelligence</span>
          <span>© 2026 Backbencher</span>
        </div>
      </div>
    </footer>
  )
}
