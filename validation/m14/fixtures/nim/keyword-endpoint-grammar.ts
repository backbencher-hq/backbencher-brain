/**
 * NIM KEYWORD-ENDPOINT GRAMMAR — what IS a keyword-spelled edge endpoint?
 *
 * ## The question this answers, and why a count could not
 *
 * `endpoint-provenance.ts` counts endpoints spelled as one of Nim's reserved
 * words and labels the bucket FABRICATIONS, on the grounds that Nim cannot
 * DECLARE a symbol named `static`. `keyword-endpoint-hunt.ts` then named them —
 * `static` 403, `type` 242, `discard` 4, `when` 2, 651 total, every one BARE and
 * none dotted — which eliminated the alternative that a dotted `Node.keyword` was
 * a variant field being mistaken for a type.
 *
 * What neither instrument established is whether the edge is FALSE. "The corpus
 * declares no symbol by this name" is not the same claim as "the language cannot
 * express this at this position", and the workstream's own instruction is to keep
 * those apart: an external package, a path, a builtin, and a declaration that was
 * never indexed are four different findings that share one appearance.
 *
 * Nim has BUILT-IN type constructors that are spelled as keywords and are
 * perfectly legal in exactly the positions this collector reads:
 *
 *   `var T: static[int]`      — `static` is a built-in type constructor
 *   `proc f(): discard`       — `discard` is a built-in type
 *   `when defined(debug):`    — `when` is a compile-time conditional
 *
 * If the 651 endpoints sit in those positions, the edges are TRUE edges to
 * symbols no corpus file can declare, and the bucket is a RESOLUTION finding
 * (external/builtin), not a FABRICATION. If instead they sit where no such
 * construct is legal — an identifier position, a callee — then the analyzer read
 * a keyword as a name and the bucket really is a fabrication.
 *
 * So this instrument reports, for each keyword-spelled endpoint, the GRAMMAR
 * CONTEXT it was read from: the node type of the endpoint itself, its named
 * parent's field name, and the nearest enclosing declaration. Those three decide
 * the question per name, and they are read off the parse tree rather than
 * inferred from the text.
 *
 * ## Method
 *
 * ONE walk over the arbiter's file set (`git ls-files` + `detectLanguageFromPath
 * === "nim"` + 512 KB cap), production `parseFile` from `src/ast/pool-worker.ts`
 * to decide which edges the analyzer actually emits, and the pinned
 * `wasm/tree-sitter-nim.wasm` to recover the tree those edges came from.
 *
 * NO REGEX. Reserved words are compared against a `Set`. Parent field names come
 * from `node.fieldNameForChild`. The endpoint's own span is located by matching
 * the tree's `identifier` nodes to the edge endpoint string, which is a Set
 * membership test per node.
 *
 * The join between edge and node is the honest weak point and is stated rather
 * than hidden: an edge carries a target STRING and the tree carries SPANS, so
 * where one keyword name occurs many times in a file the context reported is the
 * context of the occurrences in that file, not a proven one-to-one binding to the
 * edge's own site. The per-file occurrence count is printed beside the histogram
 * so a reader can see when the join is 1:1 (a name appearing once) and when it is
 * not. A file where the name appears once gives an unambiguous answer.
 *
 * Writes JSON to argv[2], a report to stdout.
 * Run: BB_NIM_WORKERS=1 npx tsx validation/m14/fixtures/nim/keyword-endpoint-grammar.ts <out.json>
 */
import { execFileSync } from "node:child_process"
import { readFileSync, statSync, writeFileSync } from "node:fs"
import { createHash } from "node:crypto"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../../../src/ast/language-detection"
import { parseFile } from "../../../../src/ast/pool-worker"

/** Nim's reserved words. A `Set`, compared by value — never a pattern. */
const NIM_KEYWORDS = new Set([
  "addr", "and", "as", "asm", "bind", "block", "break", "case", "cast", "concept",
  "const", "continue", "converter", "defer", "discard", "distinct", "div", "do",
  "elif", "else", "end", "enum", "except", "export", "finally", "for", "func",
  "generic", "if", "import", "in", "include", "interface", "is", "isnot", "iterator",
  "let", "macro", "method", "mixin", "mod", "nil", "not", "notin", "object", "of",
  "or", "out", "proc", "ptr", "raise", "ref", "return", "shared", "shl", "shr",
  "static", "template", "try", "tuple", "type", "using", "var", "when", "while",
  "xor", "yield",
])

/** The four names `keyword-endpoint-hunt.ts` measured. Narrowed to those so the
 *  report answers THE question that is open rather than every keyword in the
 *  language. A name outside this set that shows up is still counted, under
 *  `otherKeywords`, because a filter that hides what it did not expect is a
 *  filter that can lie. */
const THE_FOUR = new Set(["static", "type", "discard", "when"])

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const OUT = process.argv[2]
const ANALYZER = path.join(process.cwd(), "src/ast/real-nim-analyzer.ts")
const sha = (): string => createHash("sha256").update(readFileSync(ANALYZER)).digest("hex")

const w = (s: string | number, n: number): string => String(s).padEnd(n)
const wp = (s: string | number, n: number): string => String(s).padStart(n)

// ─────────────────────────────────────────────────────────────── corpus walk
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

// ───────────────────────────────────────────────────────── tree access
const wts: any = await import("web-tree-sitter")
const WSP: any = wts.Parser ?? wts.default
const WSL: any = wts.Language ?? wts.default?.Language
await WSP.init({ locateFile: () => path.join(process.cwd(), "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const parser = new WSP()
parser.setLanguage(await WSL.load(readFileSync(path.join(process.cwd(), "wasm", "tree-sitter-nim.wasm"))))

type Ctx = { nodeType: string; parentType: string; field: string; enclosing: string; text: string }
const contexts = new Map<string, Map<string, number>>()   // name -> "parentType.field" -> count
const nodeTypes = new Map<string, Map<string, number>>()   // name -> nodeType -> count
const enclosing = new Map<string, Map<string, number>>()   // name -> enclosing decl kind -> count
const edgeCounts = new Map<string, number>()                // name -> edges the analyzer emitted
const occurrenceHistogram = new Map<string, number>()       // name -> files where it occurs exactly once
const perFileDetail: { file: string; name: string; contexts: Record<string, number> }[] = []
let otherKeywords = new Map<string, number>()
let filesWithEdge = 0
let symbolsTotal = 0

const shaBefore = sha()
for (const f of files) {
  // 1. which keyword-spelled endpoints does the analyzer actually emit here?
  let emitted: { type: string; src: string; tgt: string }[] = []
  try {
    const r: any = await parseFile(f.abs, f.dir)
    symbolsTotal += (r.symbols ?? []).length
    for (const x of r.relationships ?? []) {
      const s = String(x.source ?? x.from ?? "")
      const t = String(x.target ?? x.to ?? "")
      for (const ep of [s, t]) {
        if (NIM_KEYWORDS.has(ep)) edgeCounts.set(ep, (edgeCounts.get(ep) ?? 0) + 1)
      }
      if (THE_FOUR.has(s) || THE_FOUR.has(t)) {
        emitted.push({ type: String(x.type ?? x.relationshipType ?? ""), src: s, tgt: t })
      }
    }
  } catch { continue }
  if (emitted.length === 0) continue
  filesWithEdge++

  // 2. recover the tree and record where each of the four names sits
  let tree: any = null
  try { tree = parser.parse(readFileSync(f.abs, "utf8")) } catch { continue }

  const perName = new Map<string, Map<string, number>>()
  const perNameCtx = new Map<string, Map<string, number>>()
  const seenOnce = new Set<string>()
  const countInFile = new Map<string, number>()

  const stack: any[] = [tree.rootNode]
  while (stack.length) {
    const node = stack.pop()
    for (let i = node.childCount - 1; i >= 0; i--) stack.push(node.child(i))
    // Leaf nodes only: a keyword-spelled endpoint is a name, so it must be a
    // token. `node.type === "identifier"` would miss a grammar that spells a
    // built-in type as its own node kind, so the test is "has no children AND
    // its text is one of the four names", which is a shape test and not a
    // pattern on the source.
    if (node.childCount !== 0) continue
    const text = node.text
    if (!THE_FOUR.has(text)) continue
    countInFile.set(text, (countInFile.get(text) ?? 0) + 1)

    const parent = node.parent
    const field = parent ? String(parent.fieldNameForChild(node.index) ?? "") : ""
    const parentType = parent ? String(parent.type) : "(root)"
    const key = `${parentType}${field ? "." + field : ""}`
    contexts.set(text, bump(contexts.get(text), key))
    nodeTypes.set(text, bump(nodeTypes.get(text), String(node.type)))
    perName.set(text, bump(perName.get(text), key))
    perNameCtx.set(text, bump(perNameCtx.get(text), `${parentType}.${field || "-"}`))

    // Nearest enclosing declaration: walk up until a node type that declares.
    let up = parent
    let encl = "(none)"
    while (up) {
      const t = String(up.type)
      if (t === "object_declaration" || t === "type_declaration" || t === "proc_declaration" ||
          t === "func_declaration" || t === "method_declaration" || t === "iterator_declaration" ||
          t === "macro_declaration" || t === "template_declaration" || t === "const_declaration" ||
          t === "var_declaration" || t === "let_declaration" || t === "concept_declaration" ||
          t === "enum_declaration" || t === "object_variant_declaration" || t === "when_statement") {
        encl = t
        break
      }
      up = up.parent
    }
    enclosing.set(text, bump(enclosing.get(text), encl))
  }

  for (const [name, c] of countInFile) if (c === 1) seenOnce.add(name)
  for (const name of seenOnce) occurrenceHistogram.set(name, (occurrenceHistogram.get(name) ?? 0) + 1)
  for (const [name, m] of perName) {
    const rec: Record<string, number> = {}
    for (const [k, v] of m) rec[k] = v
    perFileDetail.push({ file: `${f.repo}/${path.relative(f.dir, f.abs)}`, name, contexts: rec })
  }
}

function bump(m: Map<string, number> | undefined, k: string): Map<string, number> {
  const out = m ?? new Map<string, number>()
  out.set(k, (out.get(k) ?? 0) + 1)
  return out
}

// every keyword endpoint seen, not only the four
for (const [k, v] of edgeCounts) if (!THE_FOUR.has(k)) otherKeywords.set(k, (otherKeywords.get(k) ?? 0) + v)

console.log(`nim keyword-endpoint grammar — what IS a keyword-spelled endpoint?`)
console.log(`analyzer    : sha256 ${shaBefore}`)
console.log(`corpus root : ${CR}`)
console.log(`files       : ${files.length}   files emitting a keyword-spelled endpoint: ${filesWithEdge}`)
console.log(`symbols     : ${symbolsTotal}`)
console.log(`wasm        : wasm/tree-sitter-nim.wasm   parser: pinned to the same blob the census used`)

console.log(`\nEDGES the analyzer emitted, by keyword-spelled endpoint (both positions):`)
const names = [...edgeCounts].sort((a, b) => b[1] - a[1])
for (const [k, v] of names) console.log(`  ${w(k, 14)}${wp(v.toLocaleString(), 7)}`)
console.log(`  ${w("TOTAL", 14)}${wp([...edgeCounts.values()].reduce((a, b) => a + b, 0).toLocaleString(), 7)}`)

console.log(`\nTHE FOUR, and the grammar context each was read from (node.parent.type + field):`)
for (const name of ["static", "type", "discard", "when"]) {
  const c = contexts.get(name)
  console.log(`\n  ${w(name, 10)} ${wp(edgeCounts.get(name) ?? 0, 6)} edges   node kinds: ${JSON.stringify(Object.fromEntries(nodeTypes.get(name) ?? new Map()))}`)
  if (!c || c.size === 0) { console.log(`           (no leaf occurrence in the corpus)`); continue }
  const tot = [...c.values()].reduce((a, b) => a + b, 0)
  for (const [k, v] of [...c].sort((a, b) => b[1] - a[1]).slice(0, 8)) {
    console.log(`           ${w(k, 44)}${wp(v.toLocaleString(), 7)}  ${((100 * v) / tot).toFixed(1)}%`)
  }
  if (c.size > 8) console.log(`           … and ${c.size - 8} more parent shapes`)
  console.log(`           nearest enclosing declaration: ${JSON.stringify(Object.fromEntries(enclosing.get(name) ?? new Map()))}`)
  console.log(`           files where the name occurs EXACTLY ONCE (1:1 join, unambiguous): ${occurrenceHistogram.get(name) ?? 0}`)
}

if (otherKeywords.size) {
  console.log(`\nOTHER keyword-spelled endpoints, outside the four (counted, not hidden):`)
  for (const [k, v] of [...otherKeywords].sort((a, b) => b[1] - a[1])) console.log(`  ${w(k, 14)}${wp(v.toLocaleString(), 7)}`)
}

console.log(`\nanalyzer sha256 after the walk: ${sha()}  (${sha() === shaBefore ? "unchanged" : "CHANGED — every number above straddles an edit"})`)

if (OUT) {
  writeFileSync(OUT, JSON.stringify({
    instrument: "keyword-endpoint-grammar",
    analyzerSha256Before: shaBefore, analyzerSha256After: sha(), analyzerStable: sha() === shaBefore,
    corpusRoot: CR, files: files.length, filesWithEdge, symbolsTotal,
    edgeCounts: Object.fromEntries(edgeCounts),
    theFour: Object.fromEntries(["static", "type", "discard", "when"].map((n) => [n, {
      edges: edgeCounts.get(n) ?? 0,
      nodeKinds: Object.fromEntries(nodeTypes.get(n) ?? new Map()),
      parentShapes: Object.fromEntries(contexts.get(n) ?? new Map()),
      enclosingDeclaration: Object.fromEntries(enclosing.get(n) ?? new Map()),
      filesOccurringExactlyOnce: occurrenceHistogram.get(n) ?? 0,
    }])),
    otherKeywords: Object.fromEntries(otherKeywords),
    perFile: perFileDetail,
  }, null, 2))
  console.log(`wrote ${OUT}`)
}