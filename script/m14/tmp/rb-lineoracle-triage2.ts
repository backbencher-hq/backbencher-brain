// script/m14/tmp/rb-lineoracle-triage2.ts
//
// After the fixes: (a) does `metadata.resolvedTarget` survive to what the M59
// oracle reads (the oracle keys its narrow third-state class on it), and
// (b) is the fabricated `instantiates QueryParser` for `@params_class.new` gone?
//
// Run: bun script/m14/tmp/rb-lineoracle-triage2.ts
import * as fs from "node:fs"
import * as path from "node:path"
import { ASTEngine } from "../../../src/ast/engine"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../../..")
const CORPUS = "/home/ishaq2321/bb_tests/repositories"

const TARGETS: Array<[string, number[]]> = [
  ["rack/lib/rack/builder.rb", [103, 137, 289]],
  ["rack/lib/rack/directory.rb", [58, 78]],
  ["rack/lib/rack/query_parser.rb", [41, 203, 207]],
  ["rake/lib/rake/file_list.rb", [197, 243]],
]

for (const [rel, lines] of TARGETS) {
  const abs = path.join(CORPUS, rel)
  const src = fs.readFileSync(abs, "utf8")
  const parsed: any = await (ASTEngine as any).parseFile(abs, src, { language: "ruby" })
  const rels: any[] = parsed?.relationships ?? []
  const srcLines = src.split("\n")
  console.log(`\n===== ${rel}`)
  for (const r of rels) {
    const ln = r.line_number ?? r.metadata?.line
    if (ln === undefined || !lines.includes(ln)) continue
    const meta = JSON.stringify(r.metadata ?? {})
    if (String(r.type) === "instantiates" || String(r.type) === "overrides" || String(r.type) === "calls") {
      console.log(`  L${ln} ${String(r.type).padEnd(13)} ${String(r.source).padEnd(24)} -> ${String(r.target).padEnd(22)} meta=${meta}`)
      console.log(`        ${JSON.stringify((srcLines[ln - 1] ?? "").trim())}`)
    }
  }
}
