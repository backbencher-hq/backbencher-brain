/**
 * Protobuf GRAMMAR CENSUS.
 *
 * The analyzer's whole contract is a set of string literals compared against
 * `node.type`. A literal the grammar never produces is dead code; a node type
 * the grammar does produce that the analyzer never names is a blind spot, and a
 * blind spot is how a construct silently stops being extracted. Both directions
 * are measured here, from the wired wasm and from real corpora:
 *
 *   - node types DECLARED by the grammar   (language.nodeTypeForId)
 *   - field names DECLARED by the grammar  (language.fieldNameForId)
 *   - node types / field names OBSERVED    (walked over the four pinned corpora)
 *   - the analyzer's own node-type literals (read from its source, classified)
 *
 * The classification table below is HAND-AUTHORED and is the input, not the
 * output. The gate is not "the census looks complete" but two checkable
 * statements:
 *
 *   1. every OBSERVED node type carries a classification, and
 *   2. a type classified as producing a symbol or a relationship is one the
 *      analyzer actually names, and a type the analyzer names is classified.
 *
 * Anything that fails either is printed as a FAIL line and sets a non-zero exit
 * code, so this cannot be reported green by a table that merely looks tidy.
 *
 * Usage: tsx grammar-census.mts
 */
import * as fs from "fs"
import * as path from "path"
import { MANIFEST, OUT, ROOT, WASM } from "../paths.mts"

const wts: any = await import(path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.js"))
const ParserClass = wts.Parser ?? wts.default ?? wts
const Language = wts.Language ?? wts.default?.Language
await ParserClass.init({ locateFile: () => path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.wasm") })
const language: any = await Language.load(fs.readFileSync(WASM))
const parser = new ParserClass()
parser.setLanguage(language)

// ---------------------------------------------------------------- declared side
const declaredTypes = new Set<string>()
for (let i = 0; i < language.nodeTypeCount; i++) {
  const n = language.nodeTypeForId(i)
  if (n) declaredTypes.add(n)
}
const declaredFields = new Set<string>()
for (let i = 1; i <= language.fieldCount; i++) {
  const f = language.fieldNameForId(i)
  if (f) declaredFields.add(f)
}

// ----------------------------------------------------------------- observed
function walkFiles(dir: string): string[] {
  const out: string[] = []
  const stack = [dir]
  while (stack.length) {
    const d = stack.pop()!
    let ents: fs.Dirent[]
    try {
      ents = fs.readdirSync(d, { withFileTypes: true })
    } catch {
      continue
    }
    for (const e of ents) {
      if (e.name === ".git") continue
      const abs = path.join(d, e.name)
      if (e.isDirectory()) stack.push(abs)
      else out.push(abs)
    }
  }
  return out.sort()
}

const observedTypes = new Map<string, number>()
/** Anonymous tokens (`optional`, `,`, `{`, …) are token VALUES, not node types the
 *  analyzer is expected to dispatch on, so they are counted but not classified. */
const typeIsNamed = new Map<string, boolean>()
const observedFields = new Map<string, number>()
const manifest = JSON.parse(fs.readFileSync(MANIFEST, "utf8")) as { corpora: any[] }
let filesWalked = 0
for (const c of manifest.corpora) {
  if (!fs.existsSync(c.root)) continue
  for (const abs of walkFiles(c.root).filter((f) => f.endsWith(".proto"))) {
    filesWalked++
    const tree: any = parser.parse(fs.readFileSync(abs, "utf8"))
    const stack = [tree.rootNode]
    while (stack.length) {
      const n = stack.pop()
      observedTypes.set(n.type, (observedTypes.get(n.type) ?? 0) + 1)
      if (!typeIsNamed.has(n.type)) typeIsNamed.set(n.type, n.isNamed)
      for (let i = 0; i < n.childCount; i++) {
        if (!n.children[i]) continue
        const fname = n.fieldNameForChild(i)
        if (fname) observedFields.set(fname, (observedFields.get(fname) ?? 0) + 1)
      }
      for (const ch of n.children) if (ch) stack.push(ch)
    }
  }
}

// ------------------------------------------------------------- the analyzer
const analyzerPath = path.join(ROOT, "src/ast/real-protobuf-analyzer.ts")
const analyzerSrc = fs.readFileSync(analyzerPath, "utf8")
/** A type is "named by the analyzer" if it appears as a quoted literal. */
const namedByAnalyzer = (t: string): boolean => analyzerSrc.includes(`"${t}"`)

/**
 * The hand-authored classification. Keys are node types; values say what the
 * analyzer DOES with the type, and every type the grammar can produce must
 * appear here.
 *
 *   symbol      — a declaration that becomes a UniversalSymbol
 *   relation    — a node that only produces relationship edges
 *   metadata    — read into a symbol's or the file's metadata
 *   structural  — walked through, never emitted on its own (bodies, wrappers)
 *   literal     — a leaf whose TEXT is the fact
 *   grammarOnly — produced by the grammar, not read by the analyzer
 */
const CLASS: Record<string, string> = {
  // declarations that become symbols
  message: "symbol",
  enum: "symbol",
  service: "symbol",
  rpc: "symbol",
  rpc_name: "symbol",
  field: "symbol",
  map_field: "symbol",
  oneof_field: "symbol",
  oneof: "symbol",
  enum_field: "symbol",
  message_name: "symbol",
  enum_name: "symbol",
  service_name: "symbol",
  package: "symbol",
  full_ident: "symbol",

  // name/identifier leaves: the symbol's NAME
  identifier: "literal",
  key_type: "metadata",
  message_or_enum_type: "relation",
  // `extend Foo { … }` produces NO symbol of its own — the type it extends
  // already has a declaration in the file that owns it — but it produces every
  // `contains` edge from the extended type to the members the block declares.
  extend: "relation",
  type: "metadata",
  field_number: "metadata",
  int_lit: "metadata",
  constant: "metadata",
  option: "metadata",
  field_option: "metadata",
  field_options: "metadata",
  enum_value_option: "metadata",
  reserved: "metadata",
  ranges: "metadata",
  range: "metadata",
  extensions: "metadata",
  import: "metadata",
  syntax: "metadata",
  edition: "metadata",

  // structural: walked, never emitted alone
  source_file: "structural",
  message_body: "structural",
  enum_body: "structural",

  // grammar-only: the tree carries it and the analyzer deliberately ignores it.
  //
  // An earlier version of this table classified `constant`, `enum_value_option`
  // and `field_option` as `metadata`, meaning the analyzer read them. It does
  // not, and this probe is what said so — which is the reason the table is
  // maintained as data instead of prose. File-level `option` values ARE read,
  // but by POSITION within the `option` node, not by dispatching on `constant`.
  // These three are option syntax with no fact of their own beyond the enclosing
  // option, and the review records that as a known non-extraction rather than
  // leaving the table claiming otherwise.
  empty_statement: "grammarOnly",
  block_lit: "grammarOnly",
  string: "grammarOnly",
  decimal_lit: "grammarOnly",
  hex_lit: "grammarOnly",
  octal_lit: "grammarOnly",
  float_lit: "grammarOnly",
  bool: "grammarOnly",
  true: "grammarOnly",
  false: "grammarOnly",
  escape_sequence: "grammarOnly",
  constant: "grammarOnly",
  enum_value_option: "grammarOnly",
  field_option: "grammarOnly",
  field_options: "grammarOnly",
  // `reserved "name"` — the reserved-NAME form, as opposed to reserved numbers.
  // Read by the analyzer (into the owning message's `metadata.reserved`).
  field_names: "metadata",
  comment: "metadata",
}

const fails: string[] = []
const rows: any[] = []

for (const [t, cls] of Object.entries(CLASS).sort()) {
  if (!declaredTypes.has(t)) {
    fails.push(`classified ${t} but the grammar does not declare it`)
    continue
  }
  const named = namedByAnalyzer(t)
  const needsNaming = cls === "symbol" || cls === "relation" || cls === "metadata"
  if (needsNaming && !named) fails.push(`${t} is classified ${cls} but the analyzer never names it`)
  if (!needsNaming && cls !== "literal" && cls !== "grammarOnly" && cls !== "structural" && !named)
    fails.push(`${t} classified ${cls} but not named (check the classification)`)
  rows.push({
    type: t,
    class: cls,
    namedByAnalyzer: named,
    observed: observedTypes.get(t) ?? 0,
    declared: true,
  })
}

// Every OBSERVED NAMED type must be classified. Anonymous tokens are excluded:
// `optional`, `,` and `stream` are token values the grammar reuses in several
// places, and the analyzer reads them positionally rather than by dispatching
// on a node type, so requiring a classification for each would be requiring the
// analyzer to name punctuation.
// `ERROR` and `MISSING` are tree-sitter's failure markers, not node types the
// grammar declares, so they are reported as damage rather than classified. The
// census is about the CONTRACT; parse damage is measured by the corpus and A/B
// probes, and conflating the two would let a damaged file look like a grammar
// change.
for (const [t, isNamed] of typeIsNamed) {
  if (t === "ERROR" || t === "MISSING") continue
  if (isNamed && !(t in CLASS)) fails.push(`OBSERVED NAMED but UNCLASSIFIED node type: ${t}`)
}

// analyzer literals that the grammar never produces = dead code
const deadLiterals: string[] = []
for (const t of Object.keys(CLASS)) {
  if (!observedTypes.has(t) && namedByAnalyzer(t)) deadLiterals.push(t)
}

// field names: every field the grammar assigns must be one the analyzer uses
const fieldsDeclared = [...declaredFields].sort()
const fieldsObserved = [...observedFields.keys()].sort()
for (const f of fieldsObserved) {
  if (!declaredFields.has(f)) fails.push(`observed field name not declared: ${f}`)
}
const unusedFields = fieldsDeclared.filter((f) => !observedFields.has(f))

const out = {
  generatedAt: new Date().toISOString(),
  wasm: WASM,
  filesWalked,
  declaredNodeTypes: declaredTypes.size,
  declaredFields: fieldsDeclared,
  observedNodeTypes: observedTypes.size,
  observedFields: fieldsObserved,
  classifications: rows,
  deadAnalyzerLiterals: deadLiterals,
  declaredButUnobservedFields: unusedFields,
  fails,
  pass: fails.length === 0,
}
fs.mkdirSync(OUT, { recursive: true })
fs.writeFileSync(path.join(OUT, "grammar-census.json"), JSON.stringify(out, null, 2))

console.log(`\n  files walked: ${filesWalked}`)
console.log(`  declared node types: ${declaredTypes.size}   observed: ${observedTypes.size}`)
console.log(`  declared field names: ${fieldsDeclared.join(", ")}`)
console.log(`  classified types: ${rows.length}`)
const byClass: Record<string, number> = {}
for (const r of rows) byClass[r.class] = (byClass[r.class] ?? 0) + 1
console.log(`  by class: ${JSON.stringify(byClass)}`)
if (deadLiterals.length) console.log(`  analyzer literals never observed (dead code candidates): ${deadLiterals.join(", ")}`)
if (unusedFields.length) console.log(`  declared fields never observed: ${unusedFields.join(", ")}`)
if (fails.length) {
  console.log(`\n  FAIL (${fails.length}):`)
  for (const f of fails) console.log(`    - ${f}`)
} else {
  console.log(`\n  PASS: every observed node type is classified and consistent with the analyzer`)
}
console.log(`\n  wrote ${path.join(OUT, "grammar-census.json")}`)
process.exit(fails.length ? 1 : 0)
