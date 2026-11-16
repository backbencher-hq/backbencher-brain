// script/m14/tmp/rb-lineoracle-triage.ts
//
// The M59 line oracle reports 23 INCONSISTENT claims on the 200-file ruby draw.
// This probe dumps the ACTUAL emitted relationships at those sites, so the
// classification (analyzer defect vs oracle limitation) is decided from
// evidence instead of from reading the analyzer's control flow.
//
// Run: bun script/m14/tmp/rb-lineoracle-triage.ts
import * as fs from "node:fs"
import * as path from "node:path"
import { RealRubyAnalyzer } from "../../../src/ast/real-ruby-analyzer"
import { ASTEngine } from "../../../src/ast/engine"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../../..")
const CORPUS = "<corpus-root>/bb_tests/repositories"

const TARGETS: Array<[string, number[]]> = [
  ["rack/lib/rack/builder.rb", [103, 137, 289]],
  ["rack/lib/rack/directory.rb", [58, 78]],
  ["rack/lib/rack/headers.rb", [152, 203, 213]],
  ["rack/lib/rack/query_parser.rb", [41, 203, 207]],
  ["rake/lib/rake/file_list.rb", [197, 243, 338, 339]],
  ["rake/lib/rake/linked_list.rb", [74]],
  ["rake/lib/rake/task_arguments.rb", [40]],
]

for (const [rel, lines] of TARGETS) {
  const abs = path.join(CORPUS, rel)
  if (!fs.existsSync(abs)) { console.log(`!! missing ${rel}`); continue }
  const src = fs.readFileSync(abs, "utf8")
  const analyzer = new RealRubyAnalyzer()
  const parsed = await (ASTEngine as any).parseFile(abs, src, { language: "ruby" })
  const rels: any[] = (parsed as any)?.relationships ?? []
  console.log(`\n===== ${rel} (${src.split("\n").length} lines, ${rels.length} rels)`)
  const srcLines = src.split("\n")
  for (const r of rels) {
    const ln = r.line_number ?? r.metadata?.line
    if (ln === undefined || !lines.includes(ln)) continue
    console.log(`  L${ln} ${String(r.type).padEnd(13)} ${String(r.source).padEnd(28)} -> ${String(r.target).padEnd(22)} conf=${r.confidence} meta=${JSON.stringify(r.metadata ?? {})}`)
    console.log(`        line: ${JSON.stringify((srcLines[ln - 1] ?? "").trim())}`)
  }
}
