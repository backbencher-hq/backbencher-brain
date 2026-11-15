/**
 * RECEIVER TRUTH — resolves every `uses`/`calls` receiver from the PARSE TREE,
 * and prices each refusal in `zigExternalReceiverPath` separately.
 *
 * ## Why this instrument exists
 *
 * `implicit-std-population.mts` (committed c0df53439, superseded) resolved a
 * receiver by regex over the FLATTENED site text, so `alloc.dupeZ(u8,
 * std.mem.span(...))` counted `calls -> dupeZ` as external on the strength of an
 * argument. This one never reads the edge text. It walks the tree, finds the
 * field_expression / call chain whose LEAF equals the edge target, and reads the
 * receiver off that node.
 *
 * The join is on `(line_number - 1, target)` because a relationship carries a line
 * and no byte range. Where a line holds two chains ending in the same name, the
 * row is counted `joinAmbiguous` and EXCLUDED — never guessed.
 *
 * ## The four refusals, priced separately
 *
 * `zigExternalReceiverPath` bails in exactly four places. Each is measured here
 * against a resolver that differs in ONE respect, so the cost of relaxing each is
 * a number and not an opinion.
 *
 *   A. base is not `identifier` and not `field_expression`  (analyzer:2403)
 *      The dominant case is a TYPE WRAPPER. Zig nests an optional/pointer type
 *      around the whole path:
 *          ?*std.Build.Step.Compile
 *          field(Compile) -> field(Step) -> field(Build) -> nullable_type(...)
 *      so the innermost base is `nullable_type`, never an identifier. My
 *      resolver unwraps those and continues; `wrapped` records that it did.
 *   B. the leaf is not the LAST named child                     (:2396)
 *   C. namedChildCount < 2, an anonymous enum literal           (:2380)
 *   D. root absent from the alias map, or not external          (:2407)
 *      D splits: a root that IS a declared external alias means the marking was
 *      available and something failed; a root DECLARED IN THE FILE as something
 *      else is the shadowing refusal and must stay; a root declared NOWHERE is
 *      the implicit-root case (`std`, `builtin`, `root` are in scope in every
 *      Zig file with no declaration).
 *
 * ## The invariant this checks
 *
 * Where the analyzer's own resolver succeeds, the edge MUST carry
 * `zigExternalRef`. Any row where it succeeded and the marking is absent is a
 * defect in this analyzer, not a corpus fact, and is reported as `SHOULD_BE_MARKED`.
 *
 * Usage: npx tsx validation/m14/fixtures/zig/receiver-truth.mts [maxFiles]
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { Parser, Language, type Node } from "web-tree-sitter"
import { parseFile } from "../../../../src/ast/pool-worker"
import { zigImportAliases } from "../../../../src/ast/real-zig-analyzer"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const ROOT = "/home/ishaq2321/mcp/bb-lanes/zig"
const MAX = Number(process.argv[2] ?? 300)
const REPOS = (process.env.ZIG_REPOS ?? "zig,ghostty,mold,eastwood,duckdb,oven").split(",")

await Parser.init({ locateFile: () => `${ROOT}/node_modules/web-tree-sitter/tree-sitter.wasm` })
const language: any = await Language.load(readFileSync(`${ROOT}/wasm/tree-sitter-zig.wasm`))
const parser = new Parser()
parser.setLanguage(language)

function draw(n: number): string[] {
  const all: string[] = []
  for (const repo of REPOS) {
    const stack = [`${CR}/${repo}`]
    while (stack.length) {
      const d = stack.pop()!
      let ents: string[]
      try { ents = readdirSync(d) } catch { continue }
      for (const e of ents) {
        const p = `${d}/${e}`
        let st
        try { st = statSync(p) } catch { continue }
        if (st.isDirectory()) { if (e !== ".git") stack.push(p) }
        else if (e.endsWith(".zig")) all.push(p.slice(CR.length + 1))
      }
    }
  }
  all.sort()
  const stride = Math.max(1, Math.floor(all.length / n))
  const out: string[] = []
  for (let i = 0; out.length < n && i < all.length; i += stride) out.push(all[i])
  return out
}

/** Zig wraps a whole type path in these. Instrument A asks whether the grammar has
 *  others; this set is what the corpus actually produced, recorded below. */
const TYPE_WRAPPERS = new Set(["nullable_type", "pointer_type", "optional_type", "error_union"])

function text(n: Node | null): string {
  return n ? String(n.text ?? "") : ""
}
function unquote(s: string): string {
  if (s.length >= 2 && s.charCodeAt(0) === 34) {
    try { return JSON.parse(s) as string } catch { /* fall through */ }
  }
  return s
}
function named(n: Node): Node | null {
  for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) return c }
  return null
}

type Res = {
  root: string | null
  wrapped: boolean
  refusal: string | null
  path: string
  /** the chain node this resolution came from, for the annotation ancestry test */
  node: Node | null
}

/** Zig's own set, mirrored from real-zig-analyzer.ts:1553 so this instrument does
 *  not drift from the rule it is measuring. */
const VALUE_BOUNDARY = new Set([
  "call_expression", "block", "block_expression", "arguments",
  "assignment_expression", "assignment_statement",
  "compound_assignment_statement", "struct_initializer",
  "anonymous_struct_initializer", "initializer_list",
  "composite_literal", "variable_declaration", "return_expression",
  "if_expression", "switch_expression", "while_expression", "for_expression",
])

/** Did the chain at `n` reach a `variable_declaration` through its type
 *  ANNOTATION? It asks the SAME question as `zigArrivedAtTypeAnnotation`, on the
 *  same grammar `type` field, so this instrument and the analyzer cannot disagree
 *  by construction.
 *
 *  It did disagree at first, and the disagreement was the instrument's. An
 *  earlier version inferred the annotation from the `=` token, which is wrong for
 *  a COMPOUND assignment: `total_bytes += arg.len + 1` carries `+=`, not `=`, so
 *  the fallback read the right-hand side as an annotation and counted 20 rows
 *  that the analyzer correctly publishes as value reads. Measured on the same 300
 *  stride-sampled files: 442 -> 20 after the analyzer fix, 20 -> 0 once this was
 *  keyed on the same field. The 20 were this probe's bug; `+=` is a
 *  read-modify-write and Z15 already says so. */
function variableAnnotationOwner(n: Node): Node | null {
  let cur: Node | null = n
  let arrivedFrom: Node | null = null
  let hops = 0
  while (cur && hops++ < 8) {
    if (cur.type === "variable_declaration") {
      const annotation: Node | null = (cur as any).childForFieldName?.("type") ?? null
      if (!annotation || !arrivedFrom) return null
      let c: Node | null = arrivedFrom
      let h2 = 0
      while (c && h2++ < 8) {
        if (c.id === annotation.id) return cur
        const up: Node | null = c.parent
        if (!up || up.id === cur.id) return null
        c = up
      }
      return null
    }
    if (VALUE_BOUNDARY.has(cur.type)) return null
    arrivedFrom = cur
    cur = cur.parent
  }
  return null
}

/** The ANALYZER's rule, transcribed from zigExternalReceiverPath:2373-2411. */
function resolveAsAnalyzer(expr: Node): Res {
  if (expr.type !== "field_expression") return { root: null, wrapped: false, node: expr, refusal: "NOT_A_FIELD_EXPRESSION", path: "" }
  if (expr.namedChildCount < 2) return { root: null, wrapped: false, node: expr, refusal: "ENUM_LITERAL_NO_BASE", path: "" }
  const segs: string[] = []
  let node: Node = expr
  let root = ""
  let depth = 0
  while (depth++ < 64) {
    const fieldNode = node.namedChild(node.namedChildCount - 1)
    if (!fieldNode || fieldNode.type !== "identifier") return { root: null, wrapped: false, node: expr, refusal: "LEAF_NOT_IDENTIFIER", path: "" }
    segs.push(unquote(text(fieldNode)))
    const base = node.namedChild(0)
    if (!base) return { root: null, wrapped: false, node: expr, refusal: "NO_BASE", path: "" }
    if (base.type === "identifier") { root = unquote(text(base)); break }
    if (base.type !== "field_expression") return { root: null, wrapped: false, node: expr, refusal: `NON_NAME_BASE:${base.type}`, path: "" }
    node = base
  }
  if (root === "") return { root: null, wrapped: false, node: expr, refusal: "EMPTY_ROOT", path: "" }
  segs.reverse()
  return { root, wrapped: false, node: expr, refusal: null, path: `${root}.${segs.join(".")}` }
}

/** The SAME walk, differing in exactly one respect: type wrappers around the base
 *  are unwrapped instead of refused. */
function resolveUnwrapping(expr: Node): Res {
  if (expr.type !== "field_expression") return { root: null, wrapped: false, node: expr, refusal: "NOT_A_FIELD_EXPRESSION", path: "" }
  if (expr.namedChildCount < 2) return { root: null, wrapped: false, node: expr, refusal: "ENUM_LITERAL_NO_BASE", path: "" }
  const segs: string[] = []
  let node: Node = expr
  let root = ""
  let wrapped = false
  let depth = 0
  while (depth++ < 64) {
    const fieldNode = node.namedChild(node.namedChildCount - 1)
    if (!fieldNode || fieldNode.type !== "identifier") return { root: null, wrapped, node: expr, refusal: "LEAF_NOT_IDENTIFIER", path: "" }
    segs.push(unquote(text(fieldNode)))
    let base: Node | null = node.namedChild(0)
    while (base && TYPE_WRAPPERS.has(base.type)) { wrapped = true; base = named(base) }
    if (!base) return { root: null, wrapped, node: expr, refusal: "NO_BASE", path: "" }
    if (base.type === "identifier") { root = unquote(text(base)); break }
    if (base.type !== "field_expression") return { root: null, wrapped, node: expr, refusal: `NON_NAME_BASE:${base.type}`, path: "" }
    node = base
  }
  if (root === "") return { root: null, wrapped, node: expr, refusal: "EMPTY_ROOT", path: "" }
  segs.reverse()
  return { root, wrapped, node: expr, refusal: null, path: `${root}.${segs.join(".")}` }
}

const nodeTypes = new Map<string, number>()

const files = draw(MAX)
let parseFail = 0, noChainOnLine = 0, joinAmbiguous = 0

// bucket name -> count, per edge type
const buckets: Record<string, Record<string, number>> = { uses: {}, calls: {} }
const reasonsSeen = new Map<string, number>()
/** rows where the analyzer COULD have marked and did not */
let shouldBeMarked = 0
const shouldBeMarkedRows: any[] = []
/** the population a type-wrapper unwrap would newly qualify */
let newlyQualifiedByUnwrap = 0
const unwrapExamples: any[] = []
/** the population an implicit-root seed would newly qualify */
let newlyQualifiedByImplicitRoot = 0
const implicitRootExamples: any[] = []
/** rows that are a variable's TYPE ANNOTATION, resolved structurally */
let onAVariableAnnotation = 0
const annotationExamples: any[] = []

const filesTouched: Record<string, number> = { unwrap: {}, implicitRoot: {}, annotation: {} }

for (const rel of files) {
  const f = `${CR}/${rel}`
  const tree = parser.parse(readFileSync(f, "utf8"))
  if (!tree) { parseFail++; continue }

  // --- walk once: node-type inventory + chain index + declarations
  const chains = new Map<string, Res[]>()      // `${row}\0${leaf}` -> resolutions
  const declaredHere = new Set<string>()
  const stack: Node[] = [tree.rootNode]
  let guard = 0
  while (stack.length && guard++ < 500000) {
    const n = stack.pop()!
    nodeTypes.set(n.type, (nodeTypes.get(n.type) ?? 0) + 1)
    if (n.type === "variable_declaration" || n.type === "container_field" ||
        n.type === "parameter" || n.type === "function_declaration") {
      const k0 = n.namedChild(0)
      if (k0 && k0.type === "identifier") declaredHere.add(unquote(text(k0)))
    }
    if (n.type === "field_expression") {
      const leaf = n.namedChild(n.namedChildCount - 1)
      if (leaf && leaf.type === "identifier") {
        const key = `${n.startPosition.row}\u0000${unquote(text(leaf))}`
        const list = chains.get(key) ?? []
        list.push(resolveAsAnalyzer(n), resolveUnwrapping(n))
        chains.set(key, list)
      }
    }
    for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) stack.push(c) }
  }

  const aliases = zigImportAliases(tree.rootNode)

  const r: any = await parseFile(f, "zig")
  if (!r) continue

  for (const e of (r.relationships ?? []) as any[]) {
    const t = String(e.type)
    if (t !== "uses" && t !== "calls") continue
    const tgt = unquote(String(e.target ?? ""))
    if (!tgt || tgt.includes(".")) continue          // already qualified by the analyzer
    const line = (e.line_number ?? e.metadata?.line) as number | undefined
    if (typeof line !== "number") continue
    const key = `${line - 1}\u0000${tgt}`
    const cands = chains.get(key)
    if (!cands) { noChainOnLine++; continue }
    // pair up the two resolutions per chain; distinct shapes = unjoinable
    const shapes = new Set(cands.map((c) => `${c.root}\u0001${c.path}`))
    if (shapes.size > 1) { joinAmbiguous++; continue }
    const ana = cands[0]!
    const mine = cands[1]!
    const marked = !!e.metadata?.zigExternalRef
    const hit = aliases.get(ana.root ?? "")
    const aliasExternal = !!hit && hit.external

    let bucket: string
    if (aliasExternal) bucket = marked ? "MARKED_OK" : "SHOULD_BE_MARKED"
    else if (ana.refusal) bucket = `REFUSED_${ana.refusal.replace("NON_NAME_BASE:", "NON_NAME_BASE_")}`
    else if (!hit) bucket = declaredHere.has(ana.root!) ? "ROOT_NOT_AN_ALIAS" : "ROOT_UNDECLARED_IN_FILE"
    else bucket = "ROOT_ALIAS_BUT_LOCAL"

    buckets[t]![bucket] = (buckets[t]![bucket] ?? 0) + 1
    if (ana.refusal) reasonsSeen.set(ana.refusal, (reasonsSeen.get(ana.refusal) ?? 0) + 1)

    if (bucket === "SHOULD_BE_MARKED") {
      shouldBeMarked++
      if (shouldBeMarkedRows.length < 20) shouldBeMarkedRows.push({ file: rel, type: t, target: tgt, path: ana.path })
    }
    if (!marked && ana.refusal === "NON_NAME_BASE:nullable_type" && mine.root && aliases.get(mine.root)?.external) {
      newlyQualifiedByUnwrap++
      const repo = rel.split("/")[0]!
      filesTouched.unwrap[repo] = (filesTouched.unwrap[repo] ?? 0) + 1
      if (unwrapExamples.length < 20) unwrapExamples.push({ file: rel, type: t, leaf: tgt, wouldPublish: mine.path })
    }
    if (!marked && ana.refusal === "NON_NAME_BASE:pointer_type" && mine.root && aliases.get(mine.root)?.external) {
      newlyQualifiedByUnwrap++
      const repo = rel.split("/")[0]!
      filesTouched.unwrap[repo] = (filesTouched.unwrap[repo] ?? 0) + 1
    }
    if (bucket === "ROOT_UNDECLARED_IN_FILE") {
      newlyQualifiedByImplicitRoot++
      const repo = rel.split("/")[0]!
      filesTouched.implicitRoot[repo] = (filesTouched.implicitRoot[repo] ?? 0) + 1
      if (implicitRootExamples.length < 20) implicitRootExamples.push({ file: rel, type: t, leaf: tgt, root: ana.root })
    }
    // The mislabelling question, decided by ANCESTRY rather than by line: did this
    // chain arrive at a variable_declaration through its type annotation?
    if (variableAnnotationOwner(ana.node!) && !marked) {
      onAVariableAnnotation++
      const repo = rel.split("/")[0]!
      filesTouched.annotation[repo] = (filesTouched.annotation[repo] ?? 0) + 1
      if (annotationExamples.length < 20) {
        annotationExamples.push({ file: rel, type: t, leaf: tgt, line, refusal: ana.refusal, wouldPublish: mine.path })
      }
    }
  }
}

const out = {
  tool: "zig-receiver-truth",
  population: `${files.length} stride-sampled .zig files`,
  files: files.length,
  parseFailures: parseFail,
  joinMisses_noChainOnThatLine: noChainOnLine,
  joinAmbiguous_excluded: joinAmbiguous,
  distinctNodeTypesInCorpus: nodeTypes.size,
  wrapperNodeTypesSeen: [...nodeTypes.entries()].filter(([k]) => TYPE_WRAPPERS.has(k)).sort((a, b) => b[1] - a[1]),
  buckets,
  refusalReasons: [...reasonsSeen.entries()].sort((a, b) => b[1] - a[1]),
  SHOULD_BE_MARKED: { count: shouldBeMarked, rows: shouldBeMarkedRows },
  newlyQualifiedByUnwrappingATypeWrapper: { count: newlyQualifiedByUnwrap, byRepo: filesTouched.unwrap, examples: unwrapExamples },
  newlyQualifiedBySeedingAnImplicitRoot: { count: newlyQualifiedByImplicitRoot, byRepo: filesTouched.implicitRoot, examples: implicitRootExamples },
  onAVariableTypeAnnotation: { count: onAVariableAnnotation, byRepo: filesTouched.annotation, examples: annotationExamples },
}
writeFileSync("validation/m14/fixtures/zig/measurements/receiver-truth.json", JSON.stringify(out, null, 2))
console.log(JSON.stringify({
  population: out.population,
  joinMisses: out.joinMisses_noChainOnThatLine,
  joinAmbiguous: out.joinAmbiguous_excluded,
  nodeTypes: out.distinctNodeTypesInCorpus,
  buckets: out.buckets,
  refusalReasons: out.refusalReasons.slice(0, 10),
  SHOULD_BE_MARKED: out.SHOULD_BE_MARKED.count,
  newlyQualifiedByUnwrap: out.newlyQualifiedByUnwrappingATypeWrapper.count,
  newlyQualifiedByImplicitRoot: out.newlyQualifiedBySeedingAnImplicitRoot.count,
  onAVariableTypeAnnotation: out.onAVariableTypeAnnotation.count,
}, null, 2))