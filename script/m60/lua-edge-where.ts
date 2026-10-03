/**
 * M14 ONTOLOGY — LUA. Attribute ONE edge to the node that produced it.
 *
 * The corpus counters say an edge exists; this says WHICH SOURCE SPAN produced
 * it, by re-deriving the edge from the analyzer's own public output and locating
 * the text. Used to settle reserved-word and literal endpoints, where a count
 * cannot distinguish a real member name from a fabricated one.
 *
 * USAGE: npx tsx script/m60/lua-edge-where.ts <file> [type] [target]
 */
import { readFileSync } from "node:fs"
import * as path from "node:path"
import { parseFile } from "../../src/ast/pool-worker"

const file = process.argv[2]
const wantType = process.argv[3]
const wantTarget = process.argv[4]
if (!file) { console.error("usage: lua-edge-where.ts <file> [type] [target]"); process.exit(2) }

const src = readFileSync(file, "utf8")
const lines = src.split("\n")
const r: any = await parseFile(file, path.dirname(path.dirname(file)))
const label = path.basename(file)

console.log(`# ${label}  symbols=${(r.symbols ?? []).length} rels=${(r.relationships ?? []).length} fallback=${r.fallback === true}`)
if (r.errors?.length) console.log(`# errors: ${JSON.stringify(r.errors).slice(0, 300)}`)

const rels: any[] = r.relationships ?? []
const hits = rels.filter((x) =>
  (!wantType || String(x.type).toLowerCase() === wantType.toLowerCase()) &&
  (wantTarget === undefined || x.target === wantTarget))

console.log(`# ${hits.length} matching edges of ${rels.length}`)
for (const h of hits.slice(0, 40)) {
  const ln = typeof h.line_number === "number" ? h.line_number : 0
  const text = lines[ln - 1] ?? ""
  console.log(`${String(h.type).padEnd(12)} ${String(h.source).padEnd(28)} -> ${String(h.target).padEnd(24)} L${ln}  conf=${h.confidence} ev=${h.metadata?.evidenceClass ?? "-"}`)
  console.log(`     | ${text.trim().slice(0, 110)}`)
}

// Every endpoint that is a reserved word or a literal, with its line, so the
// span that produced it is visible without a second tool call.
const RESERVED = new Set(["and","break","do","else","elseif","end","false","for","function","goto","if","in","local","nil","not","or","repeat","return","then","true","until","while"])
const LITERALS = new Set(["nil","true","false","...","self","_ENV","_G"])
const odd = rels.filter((x) => RESERVED.has(String(x.target)) || LITERALS.has(String(x.target)) || RESERVED.has(String(x.source)) || LITERALS.has(String(x.source)))
if (odd.length) {
  console.log(`\n# ${odd.length} edges with a reserved-word or literal endpoint`)
  const seen = new Set<string>()
  for (const h of odd) {
    const k = `${h.type}|${h.source}|${h.target}`
    if (seen.has(k)) continue
    seen.add(k)
    const ln = typeof h.line_number === "number" ? h.line_number : 0
    console.log(`${String(h.type).padEnd(12)} ${String(h.source).padEnd(26)} -> ${String(h.target).padEnd(22)} L${ln} | ${(lines[ln - 1] ?? "").trim().slice(0, 90)}`)
  }
}