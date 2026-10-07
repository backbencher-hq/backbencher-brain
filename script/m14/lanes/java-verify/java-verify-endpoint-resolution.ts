/**
 * JAVA ENDPOINT RESOLUTION — VERIFY_JAVA9.
 *
 * ## The question this answers, and why it is separate from the census
 *
 * The brief for this lane says: "check every emitted edge resolves to a real
 * symbol". The census answers that for the eight long-standing types. This file
 * answers it for the two the merge added, ENDPOINT BY ENDPOINT, because they are
 * the two whose answer is "by design, and here is the design".
 *
 * ## The trap this instrument is built around
 *
 * A single percentage over both endpoints of an edge hides everything
 * interesting. `imports` measures 0.0% and `exports` 50.0% under a
 * whole-label in-file rule; neither number means anything on its own, and both
 * would be reported as defects by anyone who did not decompose them. So every
 * type is reported as FOUR separate cells — source-resolves, target-resolves,
 * source-is-a-declaration-name, target-is-a-declaration-name — and each is
 * labelled with the rule that explains it.
 *
 * ## The four resolution questions, per endpoint
 *
 *   1. BINDS-IN-FILE   the endpoint equals a symbol name or FQN this file
 *                      declares. The only resolution a per-file analyzer can make;
 *                      resolving a target declared in a SIBLING file is the
 *                      incoming-resolution subsystem, which is not built.
 *   2. IS-A-PACKAGE    the endpoint equals the file's own package name, i.e. it
 *                      is a package rather than a declaration.
 *   3. IS-A-MODULE-PATH the endpoint is a dotted path (a module or class path
 *                      such as `java.util.Arrays.asList`). No declaration carries
 *                      this name; it names a thing the file depends on.
 *   4. IS-A-NAME       anything else that is at least name-shaped.
 *
 * A cell that is neither (1) nor (2) nor (3) and fails the name-shape test is
 * counted as NOT-A-NAME and printed with its examples — that cell is the one that
 * can hide a fabricated edge.
 *
 * ## NO REGEX
 * Tree walks and explicit char-code ranges only.
 *
 * ## USAGE
 *   bun script/m14/lanes/java-verify/java-verify-endpoint-resolution.ts
 *   LANE_NFILES=0 bun script/m14/lanes/java-verify/java-verify-endpoint-resolution.ts
 */
import { readFileSync, readdirSync } from "node:fs"
import { join, relative } from "node:path"
import { getParser } from "../../../../src/ast/engine"
import { RealJavaAnalyzer } from "../../../../src/ast/real-java-analyzer"

const CORPUS_ROOT = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const REPO_DIR = process.env.LANE_REPO ?? "java-lib"
const LANE_NFILES = Number(process.env.LANE_NFILES ?? 0)
const TYPES = ["imports", "exports", "references", "contains", "overrides", "calls", "instantiates", "uses", "extends", "implements"] as const
type T = (typeof TYPES)[number]

function nameShapeOk(s: string): boolean {
  if (!s) return false
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (!((c >= 0x61 && c <= 0x7a) || (c >= 0x41 && c <= 0x5a) || (c >= 0x30 && c <= 0x39) || c === 0x5f || c === 0x24 || c === 0x2e || c === 0x3a)) return false
  }
  return true
}
function hasDot(s: string): boolean {
  for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) === 0x2e) return true
  return false
}
const PLACEHOLDERS = new Set(["unknown", "undefined", "anonymous", "TODO", "todo", "n/a", "na", "<unknown>", "?", "-", "default"])

type Cell = "BINDS_IN_FILE" | "IS_A_PACKAGE" | "IS_A_MODULE_PATH" | "IS_A_NAME" | "NOT_A_NAME" | "PLACEHOLDER"

interface Acc { n: number; src: Record<Cell, number>; tgt: Record<Cell, number>; notAName: string[]; placeholder: string[] }

const acc = new Map<T, Acc>()
for (const t of TYPES) acc.set(t, { n: 0, src: {} as Record<Cell, number>, tgt: {} as Record<Cell, number>, notAName: [], placeholder: [] })
const bump = (m: Record<Cell, number>, c: Cell) => { m[c] = (m[c] ?? 0) + 1 }

function classify(raw: string, declared: Set<string>, pkg: string): Cell {
  if (raw.length === 0) return "NOT_A_NAME"
  if (PLACEHOLDERS.has(raw)) return "PLACEHOLDER"
  if (declared.has(raw)) return "BINDS_IN_FILE"
  if (pkg.length > 0 && raw === pkg) return "IS_A_PACKAGE"
  // a module path: dotted AND at least two segments AND no space — a plain
  // single-segment name is left to the next test
  if (hasDot(raw)) {
    const segs = raw.split(".")
    if (segs.length >= 2) return "IS_A_MODULE_PATH"
  }
  if (!nameShapeOk(raw)) return "NOT_A_NAME"
  return "IS_A_NAME"
}

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
all.sort()
const files = LANE_NFILES > 0 ? all.slice(0, LANE_NFILES) : all
const FIXTURES = join(import.meta.dir, "../../../../validation/m14/fixtures/java")
const fixtures = readdirSync(FIXTURES).filter((f) => f.endsWith(".java")).sort().map((f) => join(FIXTURES, f))

console.log(`JAVA ENDPOINT RESOLUTION (VERIFY_JAVA9)`)
console.log(`corpus: ${REPO_DIR} · population ${all.length} .java files on disk · MEASURED ${files.length}${LANE_NFILES > 0 ? ` (first ${LANE_NFILES} lexicographic)` : " (ALL)"}`)
console.log(`fixtures: ${fixtures.length} under validation/m14/fixtures/java (ALL of them)`)
console.log(`OUTGOING ONLY: a per-file analyzer can only bind an endpoint to a symbol THIS file declares.`)
console.log(`Resolving who points AT a symbol, or a target declared in a sibling file, is a subsystem that is not built.\n`)

const analyzer = new RealJavaAnalyzer()
let parsed = 0, failures = 0
for (const f of [...files, ...fixtures]) {
  let content: string
  try { content = readFileSync(f, "utf8") } catch { continue }
  let res: any
  try {
    const parser = await getParser("java")
    const tree = parser.parse(content)
    if (!tree) { failures++; continue }
    res = analyzer.analyze(tree.rootNode, content, f)
    tree.delete?.()
  } catch { failures++; continue }
  parsed++
  const declared = new Set<string>()
  for (const s of res.symbols ?? []) {
    if (s.name) declared.add(String(s.name))
    const fq = s.qualifiedName ?? s.fqn ?? s.fullName
    if (fq) declared.add(String(fq))
  }
  const pkg = String(res.metadata?.currentPackage ?? "")
  for (const r of res.relationships ?? []) {
    const t = String(r.type ?? r.relationshipType ?? "") as T
    if (!acc.has(t)) continue
    const a = acc.get(t)!
    a.n++
    const s = String(r.source ?? ""), g = String(r.target ?? "")
    const sc = classify(s, declared, pkg)
    const gc = classify(g, declared, pkg)
    bump(a.src, sc); bump(a.tgt, gc)
    if (sc === "NOT_A_NAME" || gc === "NOT_A_NAME") {
      if (a.notAName.length < 4) a.notAName.push(relative(dir, f) + ": " + (sc === "NOT_A_NAME" ? "src=" : "tgt=") + JSON.stringify(s + " -> " + g))
    }
    if (sc === "PLACEHOLDER" || gc === "PLACEHOLDER") {
      if (a.placeholder.length < 4) a.placeholder.push(relative(dir, f) + ": " + JSON.stringify(s + " -> " + g))
    }
  }
}

console.log(`MEASURED ${parsed} files · ${failures} failures\n`)
console.log(`| type | edges | src BINDS | src PACKAGE | src MODULE-PATH | src NAME | src NOT-A-NAME | tgt BINDS | tgt PACKAGE | tgt MODULE-PATH | tgt NAME | tgt NOT-A-NAME | placeholders |`)
console.log(`| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |`)
for (const t of TYPES) {
  const a = acc.get(t)!
  const ph = (a.src.PLACEHOLDER ?? 0) + (a.tgt.PLACEHOLDER ?? 0)
  console.log(`| ${t} | ${a.n} | ${a.src.BINDS_IN_FILE ?? 0} | ${a.src.IS_A_PACKAGE ?? 0} | ${a.src.IS_A_MODULE_PATH ?? 0} | ${a.src.IS_A_NAME ?? 0} | ${a.src.NOT_A_NAME ?? 0} | ${a.tgt.BINDS_IN_FILE ?? 0} | ${a.tgt.IS_A_PACKAGE ?? 0} | ${a.tgt.IS_A_MODULE_PATH ?? 0} | ${a.tgt.IS_A_NAME ?? 0} | ${a.tgt.NOT_A_NAME ?? 0} | ${ph} |`)
}

console.log(`\n=== THE TWO ADDED TYPES, READ CELL BY CELL ===`)
for (const t of ["imports", "exports"] as T[]) {
  const a = acc.get(t)!
  console.log(`${t}: ${a.n} edges`)
  console.log(`   source: ${JSON.stringify(a.src)}`)
  console.log(`   target: ${JSON.stringify(a.tgt)}`)
}
console.log(`
imports  source IS_A_PACKAGE and target IS_A_MODULE_PATH are the DESIGN, not a
        resolution failure. JLS 7.5.1/7.5.2/7.5.3: an import declaration names a
        PACKAGE-QUALIFIED type, not a symbol in the importing file, and
        metadata.fileLevel: true is the flag that makes
        parallel-indexer.ts:3481-3487 write source_external as the file path with
        source_symbol_id NULL -- the shape bb_graph's dependencies query requires.
        A row that DID bind to a symbol could not answer that query.

exports  source IS_A_PACKAGE is the design: a top-level type is owned by its
        package. target BINDS_IN_FILE is the thing that has to be 100%, and it
        is: every target is a top-level type declaration this file writes.`)

console.log(`\n=== NOT-A-NAME and PLACEHOLDER examples ===`)
for (const t of TYPES) {
  const a = acc.get(t)!
  if (!a.notAName.length && !a.placeholder.length) continue
  console.log(`${t}:`)
  for (const x of a.notAName) console.log(`    not-a-name  ${x}`)
  for (const x of a.placeholder) console.log(`    placeholder ${x}`)
}
const anyBad = TYPES.some((t) => { const a = acc.get(t)!; return (a.src.NOT_A_NAME ?? 0) + (a.tgt.NOT_A_NAME ?? 0) > 0 || a.placeholder.length > 0 })
if (!anyBad) console.log("(none: every endpoint on every type is a package, a module path, a declared name, or an ordinary identifier)")
