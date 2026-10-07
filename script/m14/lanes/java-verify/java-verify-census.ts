/**
 * JAVA ONTOLOGY CENSUS — the VERIFY_JAVA9 lane instrument.
 *
 * WHY THIS FILE EXISTS, AND WHY IT IS SEPARATE FROM script/m14/firing-check-v2.mjs
 *
 * firing-check-v2 answers one question: does type T appear on the RELATIONSHIP
 * channel for a sample of N files. That is the right question and it is not a
 * verdict, for three reasons measured on this lane:
 *
 *   1. SAMPLE. `pickFiles` takes the first N files in directory-walk order.
 *      REVIEW-2026-10-04 §2 measured an eight-point swing from that knob on
 *      another lane (Ruby 1/10 at NFILES=25, 8/10 at NFILES=200). A verdict
 *      that only holds at one file count is not a verdict, so this instrument
 *      measures the WHOLE corpus by default and prints the population it
 *      counted over (honesty contract, "Rule: an instrument must declare the
 *      population it covered").
 *
 *   2. THREE CHANNELS, ONE TALLIED. `ParseResult`
 *      (src/ast/types.ts:214-220) carries `relationships[]`, `imports[]` and
 *      `exports[]` as SEPARATE arrays. firing-check tallies only the first and
 *      grades against the production enum, which names all ten. A type absent
 *      from the relationship tally while `imports[]` is non-zero is NOT a
 *      defect — it is the denominator asking the wrong channel.
 *
 *   3. DERIVATION IS INVISIBLE HERE. `exports` is constructible in this
 *      analyzer (one emission site, the Spring-MVC route branch) and fires zero
 *      times on Guava. A constructible-but-dead type scores identically to a
 *      type the analyzer cannot build at all, and only the GRAMMAR separates
 *      them. So this instrument also runs the gate's instrument A (enumerate
 *      every node type the grammar produces) and instrument B (count a
 *      construct on the parse tree, where a string literal or a comment cannot
 *      fake it).
 *
 * WHAT IT MEASURES, all on the PRODUCTION path (getParser -> parse ->
 * RealJavaAnalyzer.analyze — the same three calls `parseFile` makes):
 *
 *   1. per-type counts and the FILES they came from, on all three channels
 *   2. confidence and evidenceClass distributions per type   (Part 1 q6)
 *   3. endpoint classification per type, three ways (Part 1 q5 + rule R7):
 *        RESOLVES             binds to a symbol THIS file declares
 *        NOT_AN_IDENTIFIER    cannot be a Java name at all
 *        PLACEHOLDER_LITERAL  a valid identifier standing in for an absent name
 *   4. grammar inventory (instrument A) over every node type the corpus yields
 *   5. parse-tree construct counts (instrument B) for each silent type
 *   6. the export set's visibility distribution, because an `exports` edge
 *      asserts importability and JLS 6.5.5.1/7.6 makes that `public` at top level
 *
 * NO REGEX. Not one regular expression in this file. Every programmatic step is
 * a tree walk over node.type / namedChildren / field names, or a character walk
 * with explicit char-code ranges. See script/m14/no-regex-gate.sh.
 *
 * USAGE (from the lane worktree root, so it measures THIS lane's analyzer):
 *   bun script/m14/lanes/java-verify/java-verify-census.ts             # whole corpus
 *   LANE_NFILES=200 bun script/m14/lanes/java-verify/java-verify-census.ts
 *   LANE_REPO=java-sample bun script/m14/lanes/java-verify/java-verify-census.ts
 */
import { readFileSync, readdirSync } from "node:fs"
import { join, relative } from "node:path"
import { getParser } from "../../../../src/ast/engine"
import { RealJavaAnalyzer } from "../../../../src/ast/real-java-analyzer"

// ------------------------------------------------------------------ config
const CORPUS_ROOT = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const REPO_DIR = process.env.LANE_REPO ?? "java-lib"
const LANE_NFILES = Number(process.env.LANE_NFILES ?? 0) // 0 = every .java file on disk
const LANE_CONC = Number(process.env.LANE_CONC ?? 8)

// The ten relationship types, named by the value production emits. engine.ts's
// enum is the production vocabulary (analyzers reach it as
// ASTEngine.RelationshipType); types.ts carries the same ten. Spelled out here
// so this instrument's denominator cannot drift from either enum.
const TEN = ["calls", "extends", "implements", "uses", "imports", "exports", "contains", "references", "overrides", "instantiates"] as const
type Type = (typeof TEN)[number]

// ------------------------------------------------- endpoint classification
/**
 * nameShapeOk — can this string be a Java identifier, a dotted name, or this
 * lane's `A.b` / `A:b` qualified-reference spelling? Anything carrying
 * whitespace, brackets, angle brackets, a question mark, a semicolon, a
 * paren, an equals or a plus is not a name any Java declaration can carry.
 * Character walk with explicit code ranges — no regex.
 */
function nameShapeOk(s: string): boolean {
  if (!s) return false
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    const ok =
      (c >= 0x61 && c <= 0x7a) || // a-z
      (c >= 0x41 && c <= 0x5a) || // A-Z
      (c >= 0x30 && c <= 0x39) || // 0-9
      c === 0x5f || c === 0x24 || // _ $
      c === 0x2e || c === 0x3a    // . :
    if (!ok) return false
  }
  return true
}

/**
 * PLACEHOLDER_LITERAL — a syntactically valid identifier that is nonetheless a
 * stand-in for a name nobody wrote. Standing rule R7
 * (validation/m60/ledger.json). An EXACT list, and exactness matters: `value`,
 * `constructor`, `self`, `Object` and `String` are ordinary Java names, and a
 * list that convicts them reports noise as debt. `unknown` is the literal R7
 * names for an edge endpoint.
 */
const PLACEHOLDER_LITERALS = new Set<string>(["unknown", "undefined", "anonymous", "TODO", "todo", "n/a", "na", "<unknown>", "?", "-", "default"])

type EndpointClass = "RESOLVES" | "NOT_AN_IDENTIFIER" | "PLACEHOLDER_LITERAL" | "NAME"

function classifyEndpoint(name: unknown): EndpointClass {
  const s = name === undefined || name === null ? "" : String(name)
  if (s.length === 0) return "NOT_AN_IDENTIFIER"
  if (!nameShapeOk(s)) return "NOT_AN_IDENTIFIER"
  if (PLACEHOLDER_LITERALS.has(s)) return "PLACEHOLDER_LITERAL"
  return "NAME"
}

// ------------------------------------------------------------------ corpus
// DERIVED, never a hand-written FILES array: a hard-coded list rots silently
// the moment a file is added beside it, and the instrument keeps reporting 0
// with total confidence (honesty contract, consequence 2).
const dir = join(CORPUS_ROOT, REPO_DIR)
const all: string[] = []
function walk(d: string) {
  let ents
  try { ents = readdirSync(d, { withFileTypes: true }) } catch { return }
  for (const e of ents) {
    if (e.name === ".git" || e.name === "node_modules") continue
    const p = join(d, e.name)
    if (e.isDirectory()) walk(p)
    else if (e.name.endsWith(".java")) all.push(p)
  }
}
walk(dir)
all.sort() // deterministic: lexicographic, independent of readdir order
const files = LANE_NFILES > 0 ? all.slice(0, LANE_NFILES) : all
const label = (p: string) => relative(dir, p)

console.log(`JAVA ONTOLOGY CENSUS (VERIFY_JAVA9)`)
console.log(`corpus repo: ${REPO_DIR}`)
console.log(`population: ${all.length} .java files on disk · MEASURED ${files.length} · sampling: ${LANE_NFILES > 0 ? `first ${LANE_NFILES} lexicographic` : "ALL (lexicographic)"}`)
console.log(`denominator (10, engine.ts RelationshipType): ${TEN.join(" ")}\n`)

// ------------------------------------------------------------------ accumulators
interface Acc {
  n: number
  files: Set<string>
  examples: string[]
  conf: Map<string, number>
  ev: Map<string, number>
  /** per endpoint class */
  cls: Map<EndpointClass, number>
  /** of the plain-NAME endpoints, how many bind to a symbol this file declares */
  nameEnds: number
  nameRes: number
  /** R7: an endpoint equal to the placeholder literal `unknown` */
  r7: number
  r7Examples: string[]
  /** sub-1.0 edges with no machine-readable reasonCode (honesty contract §4) */
  subOneNoReason: number
  subOneNoReasonExamples: string[]
}

function newAcc(): Acc {
  return {
    n: 0, files: new Set(), examples: [],
    conf: new Map(), ev: new Map(), cls: new Map(),
    nameEnds: 0, nameRes: 0, r7: 0, r7Examples: [],
    subOneNoReason: 0, subOneNoReasonExamples: [],
  }
}

const rel = new Map<Type, Acc>()
for (const t of TEN) rel.set(t, newAcc())

let importsTotal = 0, filesWithImports = 0
let exportsTotal = 0, filesWithExports = 0
const exportVisibility = new Map<string, number>()
const exportKinds = new Map<string, number>()
let symbolsTotal = 0
const failures: Array<{ file: string; why: string }> = []

// instrument A: the grammar's own vocabulary, observed across the whole corpus
const grammarNodeTypes = new Map<string, number>()
// instrument B: construct counts for each silent type
const treeConstructs = new Map<string, number>()
const treeConstructFiles = new Map<string, Set<string>>()
const treeConstructExamples = new Map<string, string[]>()
function bumpConstruct(k: string, fileLabel: string, example: string) {
  treeConstructs.set(k, (treeConstructs.get(k) ?? 0) + 1)
  if (!treeConstructFiles.has(k)) treeConstructFiles.set(k, new Set())
  treeConstructFiles.get(k)!.add(fileLabel)
  if (!treeConstructExamples.has(k)) treeConstructExamples.set(k, [])
  const ex = treeConstructExamples.get(k)!
  if (ex.length < 3) ex.push(example)
}

/** Does this node carry the field `name` with a non-empty identifier value? */
function fieldText(n: any, field: string): string {
  const c = n.childForFieldName?.(field)
  return c ? String(c.text ?? "") : ""
}

const TYPE_DECLS = new Set(["class_declaration", "interface_declaration", "enum_declaration", "record_declaration", "annotation_type_declaration"])

function inventoryGrammar(n: any) {
  grammarNodeTypes.set(n.type, (grammarNodeTypes.get(n.type) ?? 0) + 1)
  for (let i = 0; i < n.childCount; i++) inventoryGrammar(n.child(i))
}

/** instrument B: a top-level TYPE declaration the grammar produces. */
function countConstructs(n: any, fileLabel: string) {
  if (n.type === "module_declaration") bumpConstruct("module_declaration", fileLabel, `${fileLabel}: module`)
  if (n.type === "exports_module_directive") bumpConstruct("exports_module_directive", fileLabel, `${fileLabel}: ${n.text}`)
  if (n.type === "requires_module_directive") bumpConstruct("requires_module_directive", fileLabel, `${fileLabel}: ${n.text}`)
  if (n.type === "opens_module_directive") bumpConstruct("opens_module_directive", fileLabel, `${fileLabel}: ${n.text}`)
  if (n.type === "uses_module_directive") bumpConstruct("uses_module_directive", fileLabel, `${fileLabel}: ${n.text}`)
  if (n.type === "provides_module_directive") bumpConstruct("provides_module_directive", fileLabel, `${fileLabel}: ${n.text}`)
  if (n.type === "package_declaration") bumpConstruct("package_declaration", fileLabel, `${fileLabel}: ${n.text}`)
  if (n.type === "import_declaration") {
    const st = n.children?.find((c: any) => c.type === "static") ? " static" : ""
    const ast = n.children?.find((c: any) => c.type === "asterisk") ? ".*" : ""
    bumpConstruct("import_declaration", fileLabel, `${fileLabel}:${st}${ast} ${n.text}`)
  }
  // The public top-level-type surface an `exports` edge would assert. Counted
  // on the TREE, at top level only (a declaration with no class_body ancestor),
  // and split by whether the declaration carries a `public` modifier — JLS 6.5.5.1
  // makes importability a function of that modifier, so the two tiers have to be
  // measured separately before either can ship at a fixed confidence.
  if (TYPE_DECLS.has(n.type) && fieldText(n, "name")) {
    const mods = n.children?.find((c: any) => c.type === "modifiers")
    let isPublic = false
    if (mods) for (let i = 0; i < mods.childCount; i++) if (mods.child(i).type === "public") isPublic = true
    // top level = no enclosing class/interface/enum/record/annotation body
    let top = true
    let p = n.parent
    while (p) { if (TYPE_DECLS.has(p.type) || p.type === "class_body" || p.type === "interface_body" || p.type === "enum_body") { top = false; break } p = p.parent }
    const key = top ? (isPublic ? "top_level_type_public" : "top_level_type_not_public") : "nested_type"
    bumpConstruct(key, fileLabel, `${fileLabel}:${n.type} ${fieldText(n, "name")}`)
  }
  for (let i = 0; i < n.childCount; i++) countConstructs(n.child(i), fileLabel)
}

// ------------------------------------------------------------------ walk
const t0 = Date.now()
const analyzer = new RealJavaAnalyzer()
let parsedFiles = 0

for (const f of files) {
  let content: string
  try { content = readFileSync(f, "utf8") } catch { failures.push({ file: label(f), why: "unreadable" }); continue }
  const fl = label(f)
  let res: any
  try {
    const parser = await getParser("java")
    const tree = parser.parse(content)
    if (!tree) { failures.push({ file: fl, why: "parse returned null" }); continue }
    res = analyzer.analyze(tree.rootNode as any, content, f) as any
    inventoryGrammar(tree.rootNode as any)
    countConstructs(tree.rootNode as any, fl)
    tree.delete?.()
  } catch (e) {
    failures.push({ file: fl, why: String(e).slice(0, 90) })
    continue
  }
  parsedFiles++

  symbolsTotal += (res.symbols ?? []).length

  // The names this file declares, in the two forms an endpoint can bind to:
  // the symbol's own name and its FQN. in-file resolution is the only
  // resolution an analyzer can make — see the report's OUTGOING-ONLY note.
  const declared = new Set<string>()
  const declaredFqn = new Set<string>()
  for (const s of res.symbols ?? []) {
    if (s.name) declared.add(String(s.name))
    const fq = s.qualifiedName ?? s.fqn ?? s.fullName
    if (fq) declaredFqn.add(String(fq))
  }

  for (const r of res.relationships ?? []) {
    const t = String(r.type ?? r.relationshipType ?? "")
    const a = rel.get(t as Type)
    if (!a) continue
    a.n++
    if (a.files.size < 6) a.files.add(fl)
    if (a.examples.length < 3) a.examples.push(`${fl}: ${a.n}`)
    const conf = typeof r.confidence === "number" ? r.confidence : 1
    a.conf.set(String(conf), (a.conf.get(String(conf)) ?? 0) + 1)
    const ev = String(r.metadata?.evidenceClass ?? "(none)")
    a.ev.set(ev, (a.ev.get(ev) ?? 0) + 1)

    if (conf < 1 && !r.metadata?.reasonCode) {
      a.subOneNoReason++
      if (a.subOneNoReasonExamples.length < 3) a.subOneNoReasonExamples.push(`${fl}: ${t} ${r.source}->${r.target} conf=${conf}`)
    }

    for (const ep of [r.source, r.target]) {
      const cls = classifyEndpoint(ep)
      a.cls.set(cls, (a.cls.get(cls) ?? 0) + 1)
      const raw = ep === undefined || ep === null ? "" : String(ep)
      if (raw === "unknown") { a.r7++; if (a.r7Examples.length < 3) a.r7Examples.push(`${fl}: ${t} endpoint=${raw}`) }
      if (cls === "NAME") {
        a.nameEnds++
        if (declared.has(raw) || declaredFqn.has(raw)) a.nameRes++
      }
    }
  }

  const imps = res.imports ?? []
  importsTotal += imps.length
  if (imps.length) filesWithImports++

  const exps = res.exports ?? []
  exportsTotal += exps.length
  if (exps.length) filesWithExports++
  for (const e of exps) {
    const v = String(e.visibility ?? "(none)")
    exportVisibility.set(v, (exportVisibility.get(v) ?? 0) + 1)
    const k = String(e.kind ?? "(none)")
    exportKinds.set(k, (exportKinds.get(k) ?? 0) + 1)
  }
}

const wallMs = Date.now() - t0

// ------------------------------------------------------------------ report
console.log(`MEASURED ${parsedFiles}/${files.length} files · ${wallMs} ms · ${symbolsTotal} symbols · ${failures.length} failures`)
if (failures.length) {
  console.log(`failures (first 10):`)
  for (const x of failures.slice(0, 10)) console.log(`  ${x.file}  ${x.why}`)
}
console.log(`\n=== CHANNEL TALLY (all three, separately) ===`)
console.log(`relationships[] : ${[...rel.values()].reduce((a, b) => a + b.n, 0)} edges over ${new Set([...rel.values()].flatMap((a) => [...a.files])).size} files`)
console.log(`imports[]       : ${importsTotal} in ${filesWithImports} files`)
console.log(`exports[]       : ${exportsTotal} in ${filesWithExports} files`)

const firedRel = TEN.filter((t) => (rel.get(t)?.n ?? 0) > 0)
const silentRel = TEN.filter((t) => (rel.get(t)?.n ?? 0) === 0)
console.log(`\n=== PER-TYPE (relationship channel) ===`)
console.log(`fired  (${firedRel.length}/10): ${firedRel.join(" ")}`)
console.log(`silent      : ${silentRel.join(" ") || "(none)"}`)
console.log(`imports verdict uses the imports[] channel: ${importsTotal > 0 ? `EMITTED (${importsTotal})` : "ABSENT"}`)
console.log(`exports  verdict: relationship ${rel.get("exports")!.n}, exports[] ${exportsTotal}`)

console.log(`\n| type | edges | files | confidence | evidenceClass | in-file resolve | not-a-name | placeholder | R7 unknown | sub-1.0 no reasonCode |`)
console.log(`| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |`)
for (const t of TEN) {
  const a = rel.get(t)!
  const conf = [...a.conf.entries()].sort().map(([k, n]) => `${k}:${n}`).join(" ") || "-"
  const ev = [...a.ev.entries()].sort().map(([k, n]) => `${k}:${n}`).join(" ") || "-"
  const pct = a.nameEnds > 0 ? ((a.nameRes / a.nameEnds) * 100).toFixed(1) + "%" : "-"
  console.log(`| ${t} | ${a.n} | ${a.files.size}${a.files.size >= 6 ? "+" : ""} | ${conf} | ${ev} | ${pct} (${a.nameRes}/${a.nameEnds}) | ${a.cls.get("NOT_AN_IDENTIFIER") ?? 0} | ${a.cls.get("PLACEHOLDER_LITERAL") ?? 0} | ${a.r7} | ${a.subOneNoReason} |`)
}

console.log(`\n=== FILES per type (first 6) ===`)
for (const t of TEN) {
  const a = rel.get(t)!
  if (!a.n) continue
  console.log(`${t.padEnd(12)} ${[...a.files].join("  ")}`)
}

console.log(`\n=== R7 / hygiene detail ===`)
for (const t of TEN) {
  const a = rel.get(t)!
  if (!a.r7 && !a.subOneNoReason && !a.cls.get("NOT_AN_IDENTIFIER")) continue
  if (a.r7) console.log(`${t}: R7 endpoint 'unknown' x${a.r7}  e.g. ${a.r7Examples.join(" | ")}`)
  const ni = a.cls.get("NOT_AN_IDENTIFIER") ?? 0
  if (ni) console.log(`${t}: ${ni} endpoint(s) that cannot be a Java name`)
  if (a.subOneNoReason) console.log(`${t}: ${a.subOneNoReason} sub-1.0 edges with NO metadata.reasonCode (honesty contract §4)  e.g. ${a.subOneNoReasonExamples.join(" | ")}`)
}

console.log(`\n=== exports[] channel, visibility distribution (JLS 6.5.5.1 / 7.6) ===`)
console.log([...exportVisibility.entries()].sort().map(([k, n]) => `${k}:${n}`).join("  ") || "(none)")
console.log(`export-set kinds: ${[...exportKinds.entries()].sort().map(([k, n]) => `${k}:${n}`).join("  ")}`)

console.log(`\n=== INSTRUMENT A — grammar inventory over the measured corpus ===`)
console.log(`distinct node types the grammar produced: ${grammarNodeTypes.size}`)
const interesting = ["class_declaration", "interface_declaration", "enum_declaration", "record_declaration", "annotation_type_declaration",
  "import_declaration", "package_declaration", "module_declaration", "module_directive", "exports_module_directive",
  "requires_module_directive", "opens_module_directive", "uses_module_directive", "provides_module_directive",
  "superclass", "super_interfaces", "extends_interfaces", "object_creation_expression", "method_invocation",
  "super_constructor_invocation", "explicit_constructor_invocation", "lambda_expression", "method_reference",
  "marker_annotation", "annotation"]
for (const k of interesting) console.log(`  ${k.padEnd(36)} ${grammarNodeTypes.get(k) ?? 0}`)
const absent = interesting.filter((k) => !grammarNodeTypes.has(k))
console.log(`  absent from this corpus: ${absent.join(", ") || "(none of the list)"}`)

console.log(`\n=== INSTRUMENT B — parse-tree construct counts (silent types) ===`)
const bKeys = ["package_declaration", "import_declaration", "module_declaration", "exports_module_directive", "requires_module_directive", "opens_module_directive", "uses_module_directive", "provides_module_directive", "top_level_type_public", "top_level_type_not_public", "nested_type"]
for (const k of bKeys) {
  const n = treeConstructs.get(k) ?? 0
  const f = treeConstructFiles.get(k)?.size ?? 0
  console.log(`  ${k.padEnd(30)} ${String(n).padStart(7)} occurrences in ${f} files   ${n === 0 ? "ABSENT" : "PRESENT"}`)
  if (n > 0) console.log(`      e.g. ${treeConstructExamples.get(k)!.join("  ")}`)
}
