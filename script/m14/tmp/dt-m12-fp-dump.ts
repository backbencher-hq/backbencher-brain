// script/m14/tmp/dt-m12-fp-dump.ts — dump the analyzer's OWN view of the facts
// M12 compares, with confidence, line and metadata.
//
// Used for the #933 dart triage: every fact M12 reports as a false positive or
// as `unknown` is read here WITH its provenance, so it can be checked against
// the fixture SOURCE TEXT (the only authority the M12 rules accept) instead of
// against the analyzer's claim about itself. Writes nothing.
import { readdirSync } from "node:fs"
import { join, resolve } from "node:path"
import { parseFile } from "../../../src/ast/pool-worker"

const ROOT = "<corpus-root>/mcp/backbencher-brain"
const DIR = join(ROOT, "validation/m12/fixtures/dart")

async function main() {
  const files = readdirSync(DIR).filter((f) => f.endsWith(".dart")).sort()
  for (const f of files) {
    const p: any = await parseFile(resolve(DIR, f), ROOT)
    console.log(`\n=== ${f}`)
    const rels = (p.relationships ?? []).map((r: any) => ({ ...r, _c: r.confidence ?? 1 }))
    rels.sort((a: any, b: any) => (a.source ?? "").localeCompare(b.source ?? "") || (a.type ?? "").localeCompare(b.type ?? "") || (a.target ?? "").localeCompare(b.target ?? ""))
    for (const r of rels) {
      console.log(`  ${r.type} ${r.source} -> ${r.target} conf=${r._c} line=${r.line_number} ${JSON.stringify(r.metadata ?? {})}`)
    }
  }
}
main().then(() => process.exit(0))
