/**
 * What the analyzer ACTUALLY publishes for one file, in a form a reviewer can
 * read: every symbol with its owner/kind/flags, and every relationship with the
 * evidence that justifies it (line, confidence, relationshipType, reasonCode).
 *
 *   bun run script/cpp-review/explain.ts <file> [--rel contains,extends] [--owner X] [--target X]
 */
import { readFileSync } from "node:fs"
import { parseFile } from "../../src/ast/engine"

const args = process.argv.slice(2)
const file = args[0]
const flag = (name: string, dflt = ""): string => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : dflt
}
const relTypes = flag("rel")
const onlyOwner = flag("owner")
const onlyTarget = flag("target")

const r: any = await parseFile(file, readFileSync(file, "utf8"))

console.log(`FILE ${file}`)
console.log(`symbols=${r.symbols.length} relationships=${r.relationships.length} imports=${r.imports.length} exports=${r.exports.length} errors=${r.errors.length}`)

const fl = (n: any) => (n ? (n.line_number === undefined ? "line=—" : `line=${n.line_number}`) : "")
console.log("\n--- SYMBOLS ---")
for (const s of r.symbols) {
  if (onlyOwner && String(s.ownerName ?? "") !== onlyOwner) continue
  const md = s.metadata ?? {}
  const flags = Object.entries(md).filter(([, v]) => v === true).map(([k]) => k).join(",")
  console.log(
    `  ${String(s.kind).padEnd(11)} ${JSON.stringify(s.name).padEnd(34)} owner=${String(s.ownerName ?? "-").padEnd(26)} ` +
      `vis=${String(s.visibility).padEnd(8)} @${s.range.startLine} nameLine=${md.nameLine ?? "-"} ${flags ? "[" + flags + "]" : ""}`,
  )
}

const rels = (r.relationships ?? []).filter((x: any) => {
  if (relTypes && !relTypes.split(",").includes(x.type)) return false
  if (onlyTarget && String(x.target) !== onlyTarget) return false
  return true
})
console.log(`\n--- RELATIONSHIPS (${rels.length}${relTypes ? ` of type ${relTypes}` : ""}${onlyTarget ? ` target=${onlyTarget}` : ""}) ---`)
const seen = new Map<string, number>()
for (const x of rels) {
  const k = `${x.source} ${x.type} ${x.target}`
  const n = (seen.get(k) ?? 0) + 1
  seen.set(k, n)
  const md = x.metadata ?? {}
  const ev = [md.relationshipType, md.reasonCode, md.nodeType, md.evidenceClass, md.expandedFrom].filter(Boolean).join(" ")
  console.log(`  ${String(x.type).padEnd(13)} ${JSON.stringify(x.source).padEnd(30)} -> ${JSON.stringify(x.target).padEnd(30)} ${String(fl(x) || fl(x.metadata)).padEnd(11)} conf=${x.confidence ?? "-"} ${ev}${n > 1 ? `   *** DUP x${n}` : ""}`)
}
const dups = [...seen].filter(([, n]) => n > 1)
if (dups.length) {
  console.log(`\n--- DUPLICATE (source,type,target) PAIRS: ${dups.length} ---`)
  for (const [k, n] of dups) console.log(`  x${n}  ${k}`)
}
