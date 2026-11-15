/**
 * R LANE — DRAFT AN EXPECTATION FILE FROM WHAT PRODUCTION EMITS.
 *
 * ## Why this file exists
 *
 * The dual-lens acceptance regime (`docs/M14-HONESTY-CONTRACT.md` §"Dual-lens",
 * item 4) asks for "fixture pins/forbids authored from re-probed emission". This
 * is the re-probe: it prints, for one fixture, the symbols and relationships
 * production `parseFile` publishes, already shaped as an expectation file. An
 * author edits the result — deleting what should not be there and adding the
 * `forbid` entries a print cannot express.
 *
 * It prints a DRAFT and never writes one. A file that can overwrite an
 * expectation is a file that can make a fixture agree with a regression, which
 * is the defect the honesty contract calls a lie catcher.
 *
 * The `forbid` half is the half that gives a fixture teeth, and no program can
 * derive it: "this must publish NOTHING" is a claim about R's semantics, and the
 * fixtures state it in their own comments, each verified by running R 4.4.3.
 * A draft with zero forbids is a tautology.
 *
 * USAGE
 *   npx tsx validation/m14/fixtures/r/draft-expectation.ts F01-assignments [...]
 */
import * as fs from "node:fs"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import { parseFile } from "../../../../src/ast/pool-worker"

const DIR = path.dirname(fileURLToPath(import.meta.url))
const want = process.argv.slice(2).filter((a) => !a.startsWith("--"))
const bases = want.length
  ? want
  : fs.readdirSync(DIR).filter((f) => f.endsWith(".R") && !f.endsWith(".expectation.json")).map((f) => f.slice(0, f.length - 3)).sort()

for (const base of bases) {
  const abs = path.join(DIR, `${base}.R`)
  if (!fs.existsSync(abs)) { console.log(`no such fixture: ${abs}`); continue }
  const r: any = await parseFile(abs, DIR)
  const syms = [...(r.symbols ?? [])].sort((a: any, b: any) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  const rels = [...(r.relationships ?? [])].sort((a: any, b: any) =>
    `${a.source}|${a.type}|${a.target}` < `${b.source}|${b.type}|${b.target}` ? -1 : 1,
  )
  console.log(`\n===== ${base} =====`)
  console.log(`symbols (${syms.length})`)
  for (const s of syms) console.log(`  { "name": ${JSON.stringify(s.name)}, "kind": ${JSON.stringify(s.kind)}${s.ownerName ? `, "ownerName": ${JSON.stringify(s.ownerName)}` : ""} },`)
  console.log(`relationships (${rels.length})`)
  for (const e of rels) {
    console.log(`  { "type": ${JSON.stringify(e.type)}, "from": ${JSON.stringify(e.source)}, "target": ${JSON.stringify(e.target)}, "confidence": ${e.confidence} },`)
  }
  const meta: any = r.metadata ?? {}
  if (Object.keys(meta).length) console.log(`metadata: ${JSON.stringify(meta)}`)
}