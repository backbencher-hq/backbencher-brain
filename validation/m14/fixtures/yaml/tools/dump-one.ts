/**
 * Dump what the REAL analyzer emits for one fixture, through the production entry
 * point. Fixture expectations are authored from the language and the probe, and this
 * is how a MISMATCH between the two is diagnosed — never how an expectation is
 * written. An expectation that is a copy of this output asserts nothing.
 *
 *   npx tsx script/m14/tmp/yaml-dump-one.ts validation/m14/fixtures/yaml/<name>.yaml
 */
import * as path from "node:path"
import { parseFile } from "../../../../../src/ast/pool-worker"

const target = process.argv[2]
if (!target) {
  console.error("usage: yaml-dump-one.ts <file>")
  process.exit(2)
}
const abs = path.resolve(target)
const dir = path.dirname(abs)
const r: any = await parseFile(abs, dir)
console.log(`# ${path.basename(abs)}  success=${r?.success}  symbols=${r?.symbols?.length ?? 0}  rels=${r?.relationships?.length ?? 0}\n`)
console.log("## SYMBOLS")
for (const s of r?.symbols ?? []) {
  console.log(`  ${String(s.kind).padEnd(9)} ${s.name.padEnd(28)} qn=${s.qualifiedName}`)
}
console.log("\n## RELATIONSHIPS")
for (const e of r?.relationships ?? []) {
  const md = e.metadata ?? {}
  console.log(
    `  ${String(e.type).padEnd(11)} ${String(e.source).padEnd(52)} -> ${String(e.target).padEnd(44)}` +
    ` conf=${e.confidence} ev=${md.evidenceClass ?? "-"} rt=${md.relationshipType ?? "-"}` +
    (md.unresolvedReason ? ` why=${md.unresolvedReason}` : ""),
  )
}