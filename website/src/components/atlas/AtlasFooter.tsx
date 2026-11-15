import Link from "next/link"

export function AtlasFooter() {
  return (
    <footer className="foot">
      <div className="container foot-row">
        <span>© 2026 Backbencher · local-first code intelligence</span>
        <nav>
          <Link href="/docs">Docs</Link>
          <Link href="/tools">Tools</Link>
          <Link href="/languages">Languages</Link>
          <Link href="/editors">Editors</Link>
          <Link href="/install">Install</Link>
          <Link href="/support">Support</Link>
          <Link href="https://github.com/ishaq2321/bb">GitHub</Link>
          <Link href="/privacy">Privacy</Link>
        </nav>
      </div>
    </footer>
  )
}
