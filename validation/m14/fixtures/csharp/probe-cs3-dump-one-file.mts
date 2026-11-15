/**
 * CS3 / csharp — per-file dump of ONE file's symbols, contains and exports.
 *
 * Usage:  BB_FILE=<abs path to .cs> npx tsx validation/m14/fixtures/csharp/tmp-dump-one.mts
 *
 * Adjudicates two rows the aggregate census could only name:
 *   1. roslyn MISSING 1 — `public sealed class ...CodeFixProviderTests` in a
 *      FILE-SCOPED namespace, ~80 characters. Is the type missing from the
 *      SYMBOL table too (a pre-existing defect), or present and only the new
 *      `exports` edge absent (mine)?
 *   2. aspnetcore 275 emitted vs 274 distinct — one duplicate (source,target).
 *
 * Tree walk only; no regular expression.
 */
import { readFileSync } from "node:fs"

const FILE = process.env.BB_FILE
if (!FILE) {
  console.error("set BB_FILE=<abs path to a .cs file>")
  process.exit(2)
}
const ROOTW = process.env.BB_ROOT || "/tmp/opencode/wt/CORPUS_CS3"
const { parseFile } = await import(`${ROOTW}/src/ast/pool-worker.ts`)
const text = readFileSync(FILE, "utf8")
// No regex: the file's own directory is its own parent, so `lastIndexOf` is the
// whole of what a `\/?[^/]+$` pattern would have done here.
const slash = FILE.lastIndexOf("/")
const r: any = await parseFile(FILE, slash > 0 ? FILE.slice(0, slash) : FILE)
console.log(`file ${FILE}`)
console.log(`symbols ${(r.symbols ?? []).length}`)
for (const s of r.symbols ?? []) {
  console.log(`  SYM kind=${s.kind} name=${JSON.stringify(s.name)} vis=${JSON.stringify(s.visibility)} owner=${JSON.stringify(s.ownerName)} ownerKind=${s.ownerKind} line=${s.range?.start?.line}`)
}
const rels = r.relationships ?? []
console.log(`relationships ${rels.length}`)
const dup = new Map<string, number>()
for (const x of rels) {
  const k = `${x.type}|${x.source}|${x.target}`
  dup.set(k, (dup.get(k) ?? 0) + 1)
  if (x.type === "contains" || x.type === "exports") console.log(`  REL ${x.type} ${JSON.stringify(x.source)} -> ${JSON.stringify(x.target)} line=${x.line_number} md=${JSON.stringify(x.metadata)}`)
}
console.log(`duplicate (type,source,target) rows:`)
let any = false
for (const [k, n] of dup) if (n > 1) { console.log(`  ${k} x${n}`); any = true }
if (!any) console.log("  (none)")
console.log(`imports ${(r.imports ?? []).length}  exports[] ${(r.exports ?? []).length}`)
for (const e of r.exports ?? []) console.log(`  EXPORTCHAN ${JSON.stringify(e.name)} vis=${JSON.stringify(e.visibility)}`)
