import Link from "next/link"
import { TRUTH } from "@/data/truth.generated"

export function AtlasClose() {
  return (
    <section className="close">
      <div className="container close-grid">
        <div>
          <h2>Ask your codebase. Get <i>evidence</i> back.</h2>
          <p className="close-note">{TRUTH.tools.length} MCP tools read the same local index — search, graph, impact, docs, patterns, guarded edits — and every answer states its bounds.</p>
        </div>
        <div className="right">
          <Link className="btn" href="/install">Install bb <span aria-hidden>→</span></Link>
          <p>local-first · no cloud · no upload</p>
        </div>
      </div>
    </section>
  )
}
