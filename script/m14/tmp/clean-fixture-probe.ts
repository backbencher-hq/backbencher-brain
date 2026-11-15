// script/m14/tmp/clean-fixture-probe.ts
//
// Fixture-authoring instrument: analyze ONE Clean source file and print exactly
// the surfaces a fixture can pin — whether the tree carries errors, every
// symbol (name, kind, owner, whether it is a bare declaration), the export
// list, and every relationship as `type source -> target`.
//
// The point is to draft a fixture from the CONTRACT (what the ruling requires
// to be true) and then check the claim against the analyzer, rather than
// copying the analyzer's output into the expectation file, which would make the
// fixture unfalsifiable.
//
// Run: bun script/m14/tmp/clean-fixture-probe.ts <path/to/file.icl|.dcl>
import { readFileSync } from "node:fs"
import path from "node:path"
import * as WTS from "web-tree-sitter"
import { RealCleanAnalyzer } from "../../../src/ast/real-clean-analyzer"

const ROOT = process.cwd()
const target = process.argv[2]
if (!target) {
  console.error("usage: bun script/m14/tmp/clean-fixture-probe.ts <file.icl|file.dcl>")
  process.exit(2)
}
const full = path.isAbsolute(target) ? target : path.join(ROOT, target)

const wts: any = WTS
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const lang = await L.load(readFileSync(path.join(ROOT, "wasm/tree-sitter-clean.wasm")))
const parser = new P()
parser.setLanguage(lang)

const src = readFileSync(full, "utf8")
const tree = parser.parse(src)
const root = tree.rootNode
console.log(`file: ${path.relative(ROOT, full)}`)
console.log(`hasError: ${root.hasError}`)

// `--sexp` dumps the tree (the whole thing, or every node that is an ERROR /
// isMissing together with its ancestry) — a fixture draft that does not parse is
// debugged from the tree, never guessed at.
if (process.argv.includes("--sexp") || process.argv.includes("--errors")) {
  const errors: any[] = []
  const walk = (n: any) => {
    if (n.type === "ERROR" || n.isMissing) errors.push(n)
    for (let i = 0; i < n.childCount; i++) { const c = n.child(i); if (c) walk(c) }
  }
  walk(root)
  if (process.argv.includes("--errors")) {
    console.log(`\n${errors.length} ERROR/MISSING node(s):`)
    for (const e of errors.slice(0, 40)) {
      const chain: string[] = []
      let cur = e.parent
      while (cur && chain.length < 6) { chain.push(cur.type); cur = cur.parent }
      console.log(`  L${e.startPosition.row + 1}-${e.endPosition.row + 1} ${e.isMissing ? `MISSING ${e.type}` : "ERROR"} text=<${String(e.text).replace(/\s+/g, " ").slice(0, 60)}>  under ${chain.join(" < ")}`)
    }
  } else {
    console.log(`\n--- tree ---\n${root.toString().slice(0, 6000)}`)
  }
}

const res = new RealCleanAnalyzer().analyze(root as any, src, full)
console.log(`\nsymbols (${(res.symbols as any[]).length}):`)
for (const s of res.symbols as any[]) {
  console.log(
    `  ${String(s.kind).padEnd(12)} ${s.name.padEnd(28)} owner=${s.ownerName ?? "-"} decl=${s.metadata?.isDeclaration ? "yes" : "no"}` +
    `  L${s.range?.startLine}-${s.range?.endLine}`,
  )
}
console.log(`\nexports (${(res.exports as any[]).length}):`)
for (const e of res.exports as any[]) console.log(`  ${String(e.kind).padEnd(12)} ${e.name}`)
console.log(`\nrelationships (${(res.relationships as any[]).length}):`)
for (const r of res.relationships as any[]) {
  // The site line is printed as `L<n>` or `L-` (absent) so a fixture can pin it: dimension 8
  // requires every edge to name its site, and an absent line is a fact to see, not to hide.
  console.log(
    `  ${String(r.type).padEnd(14)} ${String(r.source).padEnd(20)} -> ${String(r.target).padEnd(24)}` +
    ` L${typeof r.line_number === "number" ? r.line_number : "-"}`,
  )
}
console.log(`\npatterns: ${(res.patterns ?? []).join(", ") || "(none)"}`)
