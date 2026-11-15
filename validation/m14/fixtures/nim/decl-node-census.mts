/**
 * DECLARATION NODE CENSUS — which node types in `wasm/tree-sitter-nim.wasm`
 * actually CARRY A NAME, measured over the whole corpus.
 *
 * ## Why this instrument exists
 *
 * `resolution-audit.ts` measures DECLARATION RECALL: for each family of
 * declarations, how many the parse tree carries against how many the production
 * run publishes. Recall is the precondition for edge resolution — an edge cannot
 * bind to a symbol that was never published — so a family the recall table cannot
 * see is a family where a recall gap would be invisible.
 *
 * The s19 full-corpus run printed:
 *
 *     family         on the tree   published   recall
 *     callable       46,971        46,967      100.0%
 *     type           0             0           n/a
 *     enum_member    0             0           n/a
 *     object_field   0             0           n/a
 *
 * Read as a measurement that says the analyzer publishes no types, no enum
 * members and no object fields. It is not: those three families hold 0 because
 * `DECL_NODES` names node types this grammar does not produce, so the walk never
 * matched one and the counter stayed at its initial value. A zero that comes
 * from a wrong lookup table is indistinguishable from a zero that comes from the
 * world, and the second one is the finding.
 *
 * That matters downstream, not just to the recall table. The audit's
 * `treeDeclaredIn` map is what separates an unresolved target into
 * `tree-declared-only` (a declaration in the corpus the analyzer failed to
 * publish — this lane's defect) from `nowhere` (declared nowhere — external).
 * With only callables in `treeDeclaredIn`, a `references` edge naming a TYPE
 * that IS declared in the corpus lands in `nowhere` and reads as a third-party
 * package. Cause C's verdict is computed from that bucket, so a wrong lookup
 * table in the instrument produces a wrong EXONERATION of the analyzer.
 *
 * ## What it measures
 *
 * Every node in every corpus tree, tallied two ways:
 *
 *   ALL NODES          the grammar's node-type vocabulary as this corpus uses it,
 *                      with counts — the answer to "what does the grammar produce".
 *   NAME-BEARING       of those, the node types that HAVE a `name` field, with
 *                      counts, the field's node type, and one source line each.
 *                      This is the table `DECL_NODES` has to be built from.
 *
 * Node `type` and field names only. No text pattern, because a string literal
 * can fake a declaration and a comment can fake a keyword.
 *
 * READ-ONLY. Writes nothing.
 */
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { readFileSync, readdirSync, statSync } from "node:fs"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../../../src/ast/language-detection"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const LIMIT = Number(process.env.BB_DECL_CENSUS_LIMIT ?? 0) || 0
const REPO = process.env.BB_DECL_CENSUS_REPO ?? ""

const wasm = readFileSync(path.join(process.cwd(), "wasm", "tree-sitter-nim.wasm"))
const wts: any = await import("web-tree-sitter")
const WSP: any = wts.Parser ?? wts.default
const WSL: any = wts.Language ?? wts.default?.Language
await WSP.init({ locateFile: () => path.join(process.cwd(), "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const parser = new WSP()
parser.setLanguage(await WSL.load(wasm))

// ─── discovery: the same admission rule resolution-audit.ts uses
const files: { repo: string; rel: string; text: string }[] = []
for (const e of readdirSync(CR)) {
  const dir = path.join(CR, e)
  try {
    if (!statSync(dir).isDirectory()) continue
    execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
  } catch { continue }
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean)
  } catch { continue }
  for (const rel of tracked) {
    const abs = path.join(dir, rel)
    let text: string
    try { if (statSync(abs).size > 512 * 1024) continue; text = readFileSync(abs, "utf8") } catch { continue }
    if (detectLanguageFromPath(abs, text) !== "nim") continue
    files.push({ repo: e, rel, text })
  }
}
const population = REPO ? files.filter((f) => f.repo === REPO) : LIMIT > 0 ? files.slice(0, LIMIT) : files

// ─── the census
/** node type -> occurrences, over every node in every tree */
const allNodes = new Map<string, number>()
/** node type -> { count, nameFieldType, parents, examples[] } */
const named = new Map<string, { count: number; fieldType: Map<string, number>; parents: Map<string, number>; examples: string[] }>()
/** `type < parent < grandparent` for every name-bearing node — the chain, because
 *  `symbol_declaration` is one node type for a field, a `var` and an enum member
 *  and only the ancestors say which. */
const chains = new Map<string, number>()
let parseFailures = 0
let nodeTotal = 0

const nameFieldTypes = (n: any): string[] => {
  const out: string[] = []
  for (let i = 0; i < n.childCount; i++) {
    const c = n.child(i)
    if (n.fieldNameForChild(i as any)) out.push(c.type)
  }
  return out
}

for (const f of population) {
  let t: any
  try { t = parser.parse(f.text) } catch { parseFailures++; continue }
  if (!t) { parseFailures++; continue }
  const lines = f.text.split("\n")
  const walk = (n: any): void => {
    nodeTotal++
    allNodes.set(n.type, (allNodes.get(n.type) ?? 0) + 1)
    const nm = n.childForFieldName?.("name")
    if (nm) {
      let e = named.get(n.type)
      if (!e) named.set(n.type, (e = { count: 0, fieldType: new Map(), parents: new Map(), examples: [] }))
      e.count++
      for (const ft of nameFieldTypes(n)) e.fieldType.set(ft, (e.fieldType.get(ft) ?? 0) + 1)
      // The PARENT matters as much as the type: in this grammar a field, a `var`
      // and an enum member are all `symbol_declaration`, and the only thing that
      // tells them apart is whether the parent is `enum_field_declaration`,
      // `field_declaration` or `variable_declaration`. A family table keyed on
      // node type alone cannot separate them.
      const p = n.parent?.type ?? "(root)"
      e.parents.set(p, (e.parents.get(p) ?? 0) + 1)
      const chain = `${n.type} < ${p} < ${n.parent?.parent?.type ?? "(root)"}`
      chains.set(chain, (chains.get(chain) ?? 0) + 1)
      if (e.examples.length < 3) {
        const ln = n.startPosition.row + 1
        e.examples.push(`${f.repo}/${f.rel}:${ln}  ${JSON.stringify(String(nm.text).slice(0, 40))}  |${(lines[ln - 1] ?? "").trim().slice(0, 70)}|`)
      }
    }
    for (let k = 0; k < n.childCount; k++) walk(n.child(k))
  }
  walk(t.rootNode)
  t.delete?.()
}

const w = (s: string, n: number): string => (s + " ".repeat(n)).slice(0, n)
console.log(`nim declaration-node census — wasm/tree-sitter-nim.wasm, whole corpus`)
console.log(`wasm sha256 ${createHash("sha256").update(wasm).digest("hex").slice(0, 16)}  bytes ${wasm.length}`)
console.log(`corpus ${population.length} nim files${REPO ? ` (repo ${REPO} only)` : ""}${LIMIT > 0 ? ` (LIMIT ${LIMIT}, a PREFIX — not a corpus statement)` : ` in ${new Set(population.map((f) => f.repo)).size} repos`}`)
console.log(`parse failures ${parseFailures}   nodes visited ${nodeTotal.toLocaleString()}   distinct node types ${allNodes.size}`)
console.log(`node types CARRYING a name field: ${named.size}`)

console.log(`\n${w("node type", 30)}${w("count", 9)}${w("% nodes", 9)}${w("name-field node type(s)", 44)}parent node type(s)`)
console.log("-".repeat(150))
const rows = [...named].sort((a, b) => b[1].count - a[1].count)
const topOf = (m: Map<string, number>): string =>
  [...m].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k}${m.size > 1 ? ` x${n}` : ""}`).join(" ")
for (const [type, e] of rows) {
  console.log(`${w(type, 30)}${w(e.count.toLocaleString(), 9)}${w(((e.count / nodeTotal) * 100).toFixed(3) + "%", 9)}${w(topOf(e.fieldType), 44)}${topOf(e.parents)}`)
  for (const ex of e.examples) console.log(`${" ".repeat(55)}${ex}`)
}

console.log(`\nTHE WHOLE NODE-TYPE VOCABULARY this corpus produces (count desc)`)
console.log(`-`.repeat(60))
const vocab = [...allNodes].sort((a, b) => b[1] - a[1])
let line = ""
for (const [t, n] of vocab) {
  const piece = `${t}:${n}`
  if (line.length + piece.length > 150) { console.log(`  ${line}`); line = "" }
  line += (line ? "  " : "") + piece
}
if (line) console.log(`  ${line}`)

console.log(`\nDECLARATION NODE TYPES — every named node type whose name is an IDENTIFIER`)
// is one that carries a `name` field, and its name is an identifier when the
// field's own node type is the identifier type. `exported_symbol` wraps an
// identifier with a `*` and is unwrapped by nameOfIdentifier below.
const IDENTIFIER_LIKE = new Set(["identifier", "operator"])
const declShape = rows.filter(([type, e]) => {
  const dominant = [...e.fieldType].sort((a, b) => b[1] - a[1])[0]
  if (!dominant) return false
  return IDENTIFIER_LIKE.has(dominant[0]) || dominant[0] === "exported_symbol"
})
console.log(`  ${declShape.length} node types: ${declShape.map(([t, e]) => `${t}(${e.count})`).join(" ")}`)
console.log(`\nEVERY NAME-BEARING SHAPE, AS AN ANCESTOR CHAIN — this is the table a family rule must be built from`)
console.log(`  ${chains.size} distinct chains`)
let cline = ""
for (const [c, n] of [...chains].sort((a, b) => b[1] - a[1])) {
  const piece = `${c}  x${n}`
  if (cline.length + piece.length > 148) { console.log(`    ${cline}`); cline = "" }
  cline += (cline ? "   " : "") + piece
}
if (cline) console.log(`    ${cline}`)
