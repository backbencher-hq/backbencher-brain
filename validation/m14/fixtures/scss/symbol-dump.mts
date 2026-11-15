/**
 * SCSS SYMBOL DUMP — what does the lane actually PUBLISH for a file?
 *
 * Prints every symbol (name, kind, line, qualifiedName) and every relationship
 * (type, source, target, line, metadata keys/values) for one project-relative file.
 * The point is to answer questions a residual count cannot: is a `%placeholder`
 * declaration published at all? Is a comma-separated selector list published as one
 * name or several?
 *
 * USAGE  bun validation/m14/fixtures/scss/symbol-dump.mts <repo> <rel-path> [...more]
 */
import path from "node:path"
import { parseFile } from "../../../../src/ast/pool-worker"

const CR = "/home/ishaq2321/bb_tests/repositories"
for (const spec of process.argv.slice(2)) {
  const i = spec.indexOf("/")
  const repo = spec.slice(0, i)
  const rel = spec.slice(i + 1)
  const abs = path.join(CR, repo, rel)
  const r: any = await parseFile(abs, path.join(CR, repo), { projectRoot: path.join(CR, repo) } as any)
  console.log(`\n=== ${repo}/${rel} — ${r.symbols.length} symbols, ${r.relationships.length} relationships ===`)
  for (const s of r.symbols) {
    console.log(`  SYM  ${String(s.kind).padEnd(12)} ${String(s.name).padEnd(40)} line ${s.range?.startLine ?? s.line ?? "?"}  q=${s.qualifiedName ?? "-"}`)
  }
  for (const e of r.relationships) {
    const md = e.metadata ?? {}
    const mdText = Object.entries(md).filter(([, v]) => v !== false && v !== undefined).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(" ")
    console.log(`  REL  ${String(e.type).padEnd(12)} ${String(e.source ?? "").padEnd(24)} -> ${String(e.target).padEnd(40)} line ${e.line_number ?? "?"}  ${mdText}`)
  }
}
