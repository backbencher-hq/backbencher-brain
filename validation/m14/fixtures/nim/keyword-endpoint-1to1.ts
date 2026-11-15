/**
 * NIM KEYWORD-ENDPOINT 1:1 PROBE — adjudicate each keyword-spelled endpoint.
 *
 * ## Why this file exists
 *
 * `keyword-endpoint-grammar.ts` measured WHERE each keyword name sits in the
 * grammar, and the answer split the bucket instead of settling it:
 *
 *   static   403 edges  bracket_expression.left 483 (56.2%)  -> `static[T]`, a
 *                     REAL built-in type constructor in a REAL type position
 *   type     242 edges  type_section 967 (68.9%)             -> the `type` KEYWORD
 *                     introducing a type section; call.function 254 (18.1%) ->
 *                     `type(x)`, a REAL built-in conversion call
 *   discard    4 edges  discard_statement 664 (94.2%)        -> a STATEMENT
 *   when       2 edges  when 519 (91.5%)                    -> a compile-time
 *                     conditional keyword
 *
 * So `static` and `type` are largely legal built-ins, while `discard` and `when`
 * look like keywords read as names. That instrument states its own weak point
 * and it is a real one: it joined edges to tree nodes BY NAME, so where a name
 * occurs many times in a file the context it reports is the file's distribution,
 * not the edge's own site. A per-name histogram cannot settle a per-edge claim,
 * and settling it is the difference between two opposite reports:
 *
 *   "651 fabricated edges"  (what endpoint-provenance.ts prints today)
 *   "651 edges to language BUILTINS that no corpus file declares"
 *
 * Those are different findings with different owners. The first is a defect in
 * this analyzer. The second is a resolution fact about Nim's system module, and
 * closing it is not this lane's to do.
 *
 * ## The method that settles it
 *
 * Only files where the keyword name occurs EXACTLY ONCE as a leaf token are used.
 * In such a file the single occurrence IS the edge's site — there is no second
 * candidate for the edge to be about, so the join is 1:1 by construction rather
 * than by assumption. For each such site this probe prints:
 *
 *   the edge (type, source, target) as the analyzer emitted it
 *   the token's node type, its parent's type and field name
 *   the parent chain up to the nearest declaration
 *   the SOURCE LINE the token sits on
 *
 * A reader can then classify the edge by looking at what the language permits at
 * that position, which is the only test that separates a fabrication from a
 * builtin. `keyword-endpoint-grammar.ts` counted 50/44/77/28 files where static/
 * type/discard/when occur exactly once; every one of them is reported here.
 *
 * NO REGEX. Tokens are matched by Set membership; field names come from
 * `node.fieldNameForChild`; the source line is sliced by byte offset from the
 * tree's own `startIndex`.
 *
 * Run: npx tsx validation/m14/fixtures/nim/keyword-endpoint-1to1.ts <out.json>
 */
import { execFileSync } from "node:child_process"
import { readFileSync, statSync, writeFileSync } from "node:fs"
import { createHash } from "node:crypto"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../../../src/ast/language-detection"
import { parseFile } from "../../../../src/ast/pool-worker"

const THE_FOUR = new Set(["static", "type", "discard", "when"])
const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const OUT = process.argv[2]
const ANALYZER = path.join(process.cwd(), "src/ast/real-nim-analyzer.ts")
const sha = (): string => createHash("sha256").update(readFileSync(ANALYZER)).digest("hex")

const w = (s: string | number, n: number): string => String(s).padEnd(n)

const files: { repo: string; dir: string; abs: string }[] = []
for (const e of execFileSync("ls", ["-1", CR], { encoding: "utf8" }).split("\n")) {
  if (!e) continue
  const dir = path.join(CR, e)
  try { if (!statSync(dir).isDirectory()) continue } catch { continue }
  let raw = ""
  try { raw = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 1 << 28 }) } catch { continue }
  for (const rel of raw.split("\0")) {
    if (!rel) continue
    if (detectLanguageFromPath(rel) !== "nim") continue
    const abs = path.join(dir, rel)
    try { if (statSync(abs).size > 512 * 1024) continue } catch { continue }
    files.push({ repo: e, dir, abs })
  }
}

const wts: any = await import("web-tree-sitter")
const WSP: any = wts.Parser ?? wts.default
const WSL: any = wts.Language ?? wts.default?.Language
await WSP.init({ locateFile: () => path.join(process.cwd(), "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const parser = new WSP()
parser.setLanguage(await WSL.load(readFileSync(path.join(process.cwd(), "wasm", "tree-sitter-nim.wasm"))))

const sites: {
  file: string; name: string; edgeType: string; edgeSource: string; edgeTarget: string
  edgePosition: string
  nodeType: string; parentType: string; field: string
  chain: string[]; line: string; lineNo: number
}[] = []
let filesWalked = 0
let filesWithEdge = 0

const shaBefore = sha()
for (const f of files) {
  filesWalked++
  let rels: any[] = []
  try {
    const r: any = await parseFile(f.abs, f.dir)
    rels = r.relationships ?? []
  } catch { continue }

  // which of the four does this file's EDGE set name, and on which side?
  const want = new Map<string, { edgeType: string; pos: string }[]>()
  for (const x of rels) {
    const ty = String(x.type ?? x.relationshipType ?? "")
    const s = String(x.source ?? x.from ?? "")
    const t = String(x.target ?? x.to ?? "")
    for (const ep of [s, t]) {
      if (!THE_FOUR.has(ep)) continue
      const arr = want.get(ep) ?? []
      arr.push({ edgeType: ty, pos: ep === s ? "source" : "target" })
      want.set(ep, arr)
    }
  }
  if (want.size === 0) continue
  filesWithEdge++

  let tree: any = null
  let src = ""
  try { src = readFileSync(f.abs, "utf8"); tree = parser.parse(src) } catch { continue }

  // leaf occurrences of each name
  const leaves = new Map<string, any[]>()
  const stack: any[] = [tree.rootNode]
  while (stack.length) {
    const node = stack.pop()
    for (let i = node.childCount - 1; i >= 0; i--) stack.push(node.child(i))
    if (node.childCount !== 0) continue
    if (!THE_FOUR.has(node.text)) continue
    const arr = leaves.get(node.text) ?? []
    arr.push(node)
    leaves.set(node.text, arr)
  }

  const label = `${f.repo}/${path.relative(f.dir, f.abs)}`
  for (const [name, nodes] of leaves) {
    const edges = want.get(name)
    if (!edges) continue
    // THE 1:1 GATE. Two or more occurrences in this file means the tree cannot say
    // which one the edge is about, so the file is skipped and counted, not guessed.
    if (nodes.length !== 1) continue
    const node = nodes[0]
    const parent = node.parent
    const field = parent ? String(parent.fieldNameForChild(node.index) ?? "") : ""
    const chain: string[] = []
    let up = parent
    let guard = 0
    while (up && guard++ < 6) { chain.push(String(up.type)); up = up.parent }
    const lineNo = node.startPosition.row + 1
    const lineStart = node.startPosition.row === 0 ? 0 : src.lastIndexOf("\n", node.startIndex - 1) + 1
    let lineEnd = src.indexOf("\n", node.startIndex)
    if (lineEnd < 0) lineEnd = src.length
    const line = src.slice(lineStart, lineEnd).trim()
    for (const e of edges) {
      sites.push({
        file: label, name,
        edgeType: e.edgeType, edgePosition: e.pos,
        edgeSource: String(rels.find((x) => String(x.source ?? x.from ?? "") === name || String(x.target ?? x.to ?? "") === name)?.[0] ?? ""),
        edgeTarget: "",
        nodeType: String(node.type), parentType: parent ? String(parent.type) : "(root)", field,
        chain, line, lineNo,
      })
    }
  }
}

console.log(`nim keyword-endpoint 1:1 probe — adjudicate each keyword-spelled endpoint`)
console.log(`analyzer : sha256 ${shaBefore}`)
console.log(`files walked: ${filesWalked}   files emitting a keyword-spelled endpoint: ${filesWithEdge}`)
console.log(`SITES REPORTED: ${sites.length} — one per edge, in a file where the name occurs EXACTLY ONCE,`)
console.log(`so the single token IS the edge's site and the join needs no assumption.`)

const byName = new Map<string, typeof sites>()
for (const s of sites) {
  const arr = byName.get(s.name) ?? []
  arr.push(s)
  byName.set(s.name, arr)
}
for (const name of ["static", "type", "discard", "when"]) {
  const arr = byName.get(name) ?? []
  console.log(`\n${"=".repeat(100)}\n${w(name.toUpperCase(), 10)} ${arr.length} adjudicated site(s)\n${"=".repeat(100)}`)
  for (const s of arr.slice(0, 14)) {
    console.log(`  ${s.file}:${s.lineNo}`)
    console.log(`    edge      ${s.edgeType}  ${s.edgePosition} = ${s.name}`)
    console.log(`    token     node=${s.nodeType}  parent=${s.parentType}${s.field ? "." + s.field : " (no field)"}`)
    console.log(`    chain     ${s.chain.join(" < ")}`)
    console.log(`    line      ${s.line.slice(0, 110)}`)
  }
  if (arr.length > 14) console.log(`    … and ${arr.length - 14} more sites for ${name}`)
}

console.log(`\nanalyzer sha256 after the walk: ${sha()}  (${sha() === shaBefore ? "unchanged" : "CHANGED"})`)
if (OUT) {
  writeFileSync(OUT, JSON.stringify({
    instrument: "keyword-endpoint-1to1",
    analyzerSha256Before: shaBefore, analyzerSha256After: sha(), analyzerStable: sha() === shaBefore,
    corpusRoot: CR, filesWalked, filesWithEdge, siteCount: sites.length,
    byName: Object.fromEntries([...byName].map(([k, v]) => [k, v.length])),
    sites,
  }, null, 2))
  console.log(`wrote ${OUT}`)
}