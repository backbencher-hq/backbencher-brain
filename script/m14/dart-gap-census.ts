/**
 * dart-gap-census — the WHOLE-POPULATION emission counts that close DARTGAP1/2 and give the
 * new-surface numbers (annotations, mixes_in, part_of, pattern tests, receiver owners) at the
 * SAME unit the gaps were originally measured in.
 *
 * WHY THIS INSTRUMENT EXISTS. `script/m14/spec/dart-completeness.json` measured its gaps over
 * `$HOME/ProxiCall/lib` — 1,294 files, with per-form occurrence counts (pattern bindings
 * 353 occurrences/110 files, constant patterns 103/50, record types 219/38, record literals 249/54).
 * A fixture proves a construct EMITS; it cannot prove the emission is present across the population
 * the gap was counted on. So closing a gap "with a counted corpus measurement" means re-counting the
 * SAME files after the implementation and showing the owed rows exist across them — this file does
 * that, and its repo/prefix are printed with every number so the unit is never implied.
 *
 * WHAT IT COUNTS, in one walk:
 *   AST OCCURRENCES (from the parse tree, so the population is what the gap counted):
 *     variable_pattern, constant_pattern, rest_pattern, record_type, record_type_field,
 *     record_type_named_field, record_literal, record_field, library_name, annotation,
 *     constructor_tearoff, for_loop_parts (untyped)
 *   EMISSIONS (from the production analyzer on the same files, metadata flags only):
 *     uses{isPatternTest}            DARTGAP2 pattern-test reads
 *     uses/other{localBinding}       the binding-spelling convention (DARTGAP1's answer)
 *     references{isAnnotation}       annotation type mentions (the new surface)
 *     references{isMixinOn}          mixin on-constraint
 *     mixes_in rows, part_of rows (split by partRole), part_of named-library rows
 *     calls/uses with metadata.owner  the store owner channel (by ownerEvidence, and non-class-like
 *                                    kinds CANNOT appear — counted to confirm)
 *     receiverCause families        the analyzer's cut, so the residual debt is measured, not asserted
 *
 * It uses the PRODUCTION analyzer directly (same entry as fixtures/census; no parseFile worker pool
 * so it can run on a scoped corpus without touching production scope), and it is REGEX-FREE: node
 * types and metadata flags only.
 *
 * Usage:
 *   BB_CORPUS_ROOT=$PWD/.corpus bun run script/m14/dart-gap-census.ts --repo=proxicall --prefix=lib
 *   (defaults: --repo=proxicall --prefix=lib, matching the completeness spec's measurement unit)
 *   --limit=N   stop after N files (declared triage, printed)
 *
 * Exit: 0 counts printed · 2 environment (no repo/files).
 */
import { execFileSync } from "node:child_process"
import { readFileSync, statSync } from "node:fs"
import * as path from "node:path"
import { getParser } from "../../src/ast/engine"
import { RealDartAnalyzer } from "../../src/ast/real-dart-analyzer"

const ROOT = path.resolve(import.meta.dirname ?? ".", "..", "..")
const CR = process.env.BB_CORPUS_ROOT ?? path.join(ROOT, ".corpus")
const argv = process.argv.slice(2)
const argOf = (name: string): string | undefined => {
  const eq = argv.find((a) => a.startsWith(`${name}=`))
  if (eq) return eq.slice(name.length + 1)
  const i = argv.indexOf(name)
  return i >= 0 ? argv[i + 1] : undefined
}
const REPO = argOf("--repo") ?? "proxicall"
const PREFIX = argOf("--prefix") ?? "lib"
const LIMIT = Number(argOf("--limit") ?? 0)
const SIZE_CAP = 1024 * 1024

const NODE_TYPES = [
  "variable_pattern", "constant_pattern", "rest_pattern", "record_type", "record_type_field",
  "record_type_named_field", "record_literal", "record_field", "library_name", "annotation",
  "constructor_tearoff",
] as const

type Emit = { rows: number; files: Set<string>; byEvidence: Map<string, number>; byCause: Map<string, number> }
const mkEmit = (): Emit => ({ rows: 0, files: new Set(), byEvidence: new Map(), byCause: new Map() })

async function main(): Promise<void> {
  const repoDir = path.join(CR, REPO)
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", repoDir, "ls-files", "-z", "--", "*.dart"], {
      encoding: "utf8", maxBuffer: 512 * 1024 * 1024,
    }).split("\0").filter(Boolean)
  } catch {
    console.error(`FATAL: ${repoDir} is not a git checkout or has no tracked .dart files`)
    process.exit(2)
  }
  const files = tracked
    .filter((rel) => PREFIX === "" || rel.startsWith(`${PREFIX}/`))
    .map((rel) => path.join(repoDir, rel))
    .filter((abs) => {
      try { return statSync(abs).size <= SIZE_CAP } catch { return false }
    })
    .sort()
  const capped = LIMIT > 0 && files.length > LIMIT
  const walked = capped
    ? files.filter((_, i) => i % Math.max(1, Math.floor(files.length / LIMIT)) === 0).slice(0, LIMIT)
    : files
  if (walked.length === 0) {
    console.error(`FATAL: no files under ${repoDir}/${PREFIX}`)
    process.exit(2)
  }

  const parser = await getParser("dart")
  const analyzer = new RealDartAnalyzer()
  const nodeHits = new Map<string, Emit>()
  for (const t of NODE_TYPES) nodeHits.set(t, mkEmit())
  const emits = {
    patternTestReads: mkEmit(),
    bindingSpelled: mkEmit(),
    qualifiedConstantReads: mkEmit(),
    annotationRefs: mkEmit(),
    mixinOnRefs: mkEmit(),
    mixesIn: mkEmit(),
    partOfPart: mkEmit(),
    partOfLibrary: mkEmit(),
    partOfNamed: mkEmit(),
    ownerRows: mkEmit(),
  }
  const receiverCauses = new Map<string, Emit>()
  const patternShapes = new Map<string, Emit>()
  const patternShape = (shape: string): Emit => {
    let e = patternShapes.get(shape)
    if (!e) patternShapes.set(shape, (e = mkEmit()))
    return e
  }
  /**
   * WHICH PATTERN CONTEXT a `constant_pattern` sits in — the classification that answers whether
   * DARTGAP2's remaining forms OCCUR on this population or merely exist in the language:
   *   qualified   `case Mode.off` (already read before DARTGAP2; not the gap)
   *   binding     inside a destructuring declaration / for-in head (a BINDING, not a test)
   *   null_check / null_assert / collection   the forms DARTGAP2 implemented
   *   test_bare   `case kOne` + relational operands (implemented by DARTGAP2)
   * A shape with zero occurrences is a MEASURED verdict for that population, not an absence.
   */
  const classifyConstantPattern = (n: any): string => {
    const kids: any[] = n.namedChildren ?? []
    if (kids.some((c) => c && c.type === "qualified")) return "qualified"
    const inBinding = (() => {
      let p = n.parent
      let g = 0
      while (p && g++ < 8) {
        if (p.type === "pattern_variable_declaration" || p.type === "for_loop_parts") return true
        if (p.type !== "record_pattern" && p.type !== "list_pattern" && p.type !== "map_pattern" &&
            p.type !== "constant_pattern" && p.type !== "variable_pattern" && p.type !== "rest_pattern") return false
        p = p.parent
      }
      return false
    })()
    if (inBinding) return "binding"
    if (n.parent?.type === "null_check_pattern") return "null_check"
    if (n.parent?.type === "null_assert_pattern") return "null_assert"
    const pp = n.parent?.type
    if (pp === "list_pattern" || pp === "map_pattern" || pp === "record_pattern") return "collection"
    // A LITERAL or the `_` WILDCARD is not an identifier TEST: `_ => value` parses as a
    // constant_pattern holding the wildcard identifier, and `case 'x':` holds a string literal.
    // Counting those as "bare identifier tests" inflated the DARTGAP2 remainder from a real
    // number to 1,273 on ProxiCall/lib while the emission it described was a different shape —
    // the classifier now separates what the implementation claims to read from what the grammar
    // merely wraps in a constant_pattern.
    const ids = kids.filter((c) => c && c.type === "identifier")
    if (ids.some((c) => c.text === "_")) return "wildcard"
    const literal = kids.some((c) => c && (
      c.type === "decimal_integer_literal" || c.type === "hex_integer_literal" ||
      c.type === "decimal_floating_point_literal" || c.type === "string_literal" ||
      c.type === "true" || c.type === "false" || c.type === "null_literal"))
    if (literal) return "literal"
    if (ids.length > 0) return "test_bare"
    return "other_shape"
  }
  const typeKinds = new Map<string, number>()
  const start = Date.now()
  let analyzeMs = 0
  let parsed = 0
  let failed = 0

  for (const abs of walked) {
    const rel = path.relative(repoDir, abs).split(path.sep).join("/")
    let src: string
    try { src = readFileSync(abs, "utf8") } catch { failed++; continue }
    let tree: any
    try { tree = parser.parse(src) } catch { failed++; continue }
    if (!tree) { failed++; continue }
    const root = tree.rootNode
    // AST OCCURRENCES — an iterative walk (the corpus has 20,004-deep trees).
    const stack: any[] = [root]
    while (stack.length > 0) {
      const n = stack.pop()
      if (!n) continue
      const hit = nodeHits.get(n.type)
      if (hit) {
        hit.rows++
        hit.files.add(rel)
        if (n.type === "constant_pattern") {
          const e = patternShape(classifyConstantPattern(n))
          e.rows++
          e.files.add(rel)
        }
        if (n.type === "annotation") {
          const nameNode = n.childForFieldName?.("name") ?? null
          const kind = nameNode
            ? (nameNode.type === "scoped_identifier" ? "scoped" : "bare")
            : "unresolved"
          hit.byEvidence.set(kind, (hit.byEvidence.get(kind) ?? 0) + 1)
        }
      }
      for (const c of n.namedChildren ?? []) if (c) stack.push(c)
    }
    let r: any
    const a0 = Date.now()
    try { r = await analyzer.analyze(root, src, abs) } catch { failed++; continue }
    analyzeMs += Date.now() - a0
    parsed++
    const bump = (e: Emit, key?: string, ev?: string, cause?: string) => {
      e.rows++
      e.files.add(rel)
      if (ev) e.byEvidence.set(ev, (e.byEvidence.get(ev) ?? 0) + 1)
      if (cause) e.byCause.set(cause, (e.byCause.get(cause) ?? 0) + 1)
    }
    for (const s of r.symbols ?? []) {
      const k = String(s.kind ?? "")
      if (k === "class" || k === "enum" || k === "mixin" || k === "extension" ||
          k === "extension_type" || k === "type_alias" || k === "type") {
        typeKinds.set(k, (typeKinds.get(k) ?? 0) + 1)
      }
    }
    for (const rel of r.relationships ?? []) {
      const md: any = rel.metadata ?? {}
      const type = String(rel.type ?? "")
      if (md.isPatternTest === true) bump(emits.patternTestReads)
      // The QUALIFIED arm's read (3d4d7fa4, the pre-DARTGAP2 half) carries isConstantPattern
      // without isPatternTest; counted separately so the two halves are never merged.
      else if (md.isConstantPattern === true) bump(emits.qualifiedConstantReads)
      if (md.localBinding === true) bump(emits.bindingSpelled)
      if (md.isAnnotation === true) bump(emits.annotationRefs, undefined, String(md.annotatedKind ?? "unknown"))
      if (md.isMixinOn === true) bump(emits.mixinOnRefs)
      if (type === "mixes_in") bump(emits.mixesIn)
      if (type === "part_of") {
        if (md.partRole === "part") bump(emits.partOfPart)
        else bump(emits.partOfLibrary)
        if (md.isNamedLibrary === true) bump(emits.partOfNamed)
      }
      if (typeof md.owner === "string" && md.owner.length > 0 && (type === "calls" || type === "uses")) {
        bump(emits.ownerRows, undefined, String(md.ownerEvidence ?? "unknown"))
        emits.ownerRows.byCause.set(md.owner, (emits.ownerRows.byCause.get(md.owner) ?? 0) + 1)
      }
      if (typeof md.receiverCause === "string") {
        let e = receiverCauses.get(md.receiverCause)
        if (!e) receiverCauses.set(md.receiverCause, (e = mkEmit()))
        bump(e, undefined, String(md.receiverType ?? ""))
      }
    }
  }

  const ms = Date.now() - start
  const w = (x: string | number, n: number) => String(x).padEnd(n)
  console.log(`dart gap census — repo=${REPO} prefix=${PREFIX === "" ? "(all)" : PREFIX + "/"}`)
  console.log(`population: ${walked.length} file(s) walked (admitted ${files.length}${capped ? `, LIMIT ${LIMIT} stride-capped` : ", NO cap"}), ${parsed} analyzed, ${failed} failed`)
  console.log(`perf: ${ms} ms total · ANALYZER-ONLY ${(analyzeMs / Math.max(1, parsed)).toFixed(1)} ms/file (production analyzer, one process, no parse-tree walk; the tree walk + timing of it is excluded so this is comparable to a harness perf row)`)
  console.log()
  console.log("AST OCCURRENCES (what the completeness gaps counted)")
  for (const t of NODE_TYPES) {
    const e = nodeHits.get(t)!
    const sub = e.byEvidence.size > 0
      ? " · " + [...e.byEvidence.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(" / ")
      : ""
    console.log(`  ${w(t, 26)} ${w(e.rows, 8)} row(s) in ${e.files.size} file(s)${e.rows === 0 ? " · ZERO on this population (measured, not assumed absent)" : ""}${sub}`)
  }
  console.log("  pattern-TEST shapes (the DARTGAP2 remainder, classified by the grammar context)")
  for (const [shape, e] of [...patternShapes.entries()].sort((a, b) => b[1].rows - a[1].rows)) {
    console.log(`    ${w(shape, 24)} ${w(e.rows, 8)} row(s) in ${e.files.size} file(s)`)
  }
  console.log()
  console.log("EMISSIONS (production analyzer, same files)")
  const line = (name: string, e: Emit, extra = "") => {
    const byEv = e.byEvidence.size > 0
      ? " · " + [...e.byEvidence.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => `${k} ${v}`).join(" / ")
      : ""
    console.log(`  ${w(name, 26)} ${w(e.rows, 8)} row(s) in ${e.files.size} file(s)${byEv}${extra}`)
  }
  line("uses{isPatternTest}", emits.patternTestReads)
  line("uses{isConstantPattern,qualified}", emits.qualifiedConstantReads)
  line("localBinding spelling", emits.bindingSpelled)
  line("references{isAnnotation}", emits.annotationRefs)
  line("references{isMixinOn}", emits.mixinOnRefs)
  line("mixes_in", emits.mixesIn)
  line("part_of (role=part)", emits.partOfPart)
  line("part_of (role=library)", emits.partOfLibrary)
  line("part_of (named library)", emits.partOfNamed)
  line("rows with metadata.owner", emits.ownerRows)
  console.log(`  owner rows' top owner names: ${[...emits.ownerRows.byCause.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, v]) => `${k} ${v}`).join(" · ")}`)
  console.log()
  console.log("RECEIVER-CUT RESIDUAL (the analyzer's own debt, by cause)")
  for (const [cause, e] of [...receiverCauses.entries()].sort((a, b) => b[1].rows - a[1].rows)) {
    const top = [...e.byCause.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => `${k || "(none)"} ${v}`).join(" · ")
    console.log(`  ${w(cause, 26)} ${w(e.rows, 8)} row(s) · types: ${top}`)
  }
  console.log()
  console.log(`type symbols: ${[...typeKinds.entries()].sort().map(([k, v]) => `${k} ${v}`).join(" · ")}`)
  process.exit(0)
}

await main()
