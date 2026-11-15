/**
 * SCSS — causes A, B and C for the incoming edges, at the population
 * `diagnose-incoming.mts` uses.
 *
 * ## Why this file exists
 *
 * `diagnose-incoming.mts` (which lives on `origin/main` and NOT on the aggregate branch the
 * round brief ships with) prints the headline counts for A, B and C but not the two facts
 * that decide whether they are actionable:
 *
 *   A  158 ambiguous targets, 100% with no distinct `qualifiedName`. The brief's A fix is
 *      "publish an identifier that includes the owner or module". Whether that is correct
 *      depends entirely on WHAT the colliding names are, and that is not printed. A collision
 *      between two `.btn` rules is not a scoping failure: a selector is a name in CSS's
 *      global namespace and the cascade applies both rules to it. A collision between two
 *      mixins named `clearfix` IS a scoping failure, because a Sass mixin is bound by
 *      lexical scope. The two want opposite repairs, so the kind distribution is the
 *      measurement, not a nicety.
 *
 *   C  609 unresolved, 0 module-wildcard shaped, examples `mixins/banner`, `functions`,
 *      `variables`, `mixins/breakpoints`. The brief's C remedy is an EXTERNAL marker for
 *      stdlib/BCL/catalog references. These are not external: they are relative paths into
 *      the same repository. Marking them external would be a false label, so before
 *      proposing any marker this measures, per target, whether a file that the specifier
 *      could resolve to EXISTS in the corpus at all, and whether it is inside the window.
 *      That splits "wrongly emitted", "outside the window" and "no such file" apart, which
 *      is the same discipline the U1/U2 split used.
 *
 * READ-ONLY. Writes nothing.
 *
 * ## Usage
 *
 *   npx tsx validation/m14/fixtures/scss/scss-bac-split.ts [fileCount]
 *
 * Default 600, which is the file count `incoming-whole.tsv` published for every lane, so the
 * A and B numbers are comparable to it. The population is the supervisor instrument's
 * population — `find <corpus> -name '*.scss' | sort | head -N` — and NOT the coverage gate's
 * (git-tracked, < 512 KB, `detectLanguageFromPath === "scss"`), which is a different set.
 */
import { execFileSync } from "node:child_process"
import { readFileSync, existsSync, statSync } from "node:fs"
import { ASTEngine } from "../../../../src/ast/engine"

const COUNT = Number(process.argv[2] ?? 600)
const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"

const files = execFileSync(
  "bash",
  ["-lc", `find ${CR} -name '*.scss' -type f | sort | head -${COUNT}`],
  { encoding: "utf8", maxBuffer: 1 << 28 },
)
  .trim()
  .split("\n")
  .filter(Boolean)

const inWindow = new Set(files)

// ---------------------------------------------------------------- walk
interface Decl {
  file: string
  kind: string
  qual: string
}
const byName = new Map<string, Decl[]>()
const edges: { t: string; type: string; file: string }[] = []
let parsed = 0
let failed = 0

for (const f of files) {
  let r: any
  try {
    r = await ASTEngine.parseFile(f, readFileSync(f, "utf8"))
    parsed++
  } catch {
    failed++
    continue
  }
  for (const s of r?.symbols ?? []) {
    const name = String(s.name)
    let d = byName.get(name)
    if (!d) byName.set(name, (d = []))
    d.push({ file: f, kind: String(s.kind), qual: String(s.qualifiedName ?? "") })
  }
  for (const e of r?.relationships ?? []) {
    const t = String(e?.target ?? "")
    if (t) edges.push({ t, type: String(e?.type ?? ""), file: f })
  }
}

const distinctTargets = [...new Set(edges.map((e) => e.t))]
const unresolvedT = distinctTargets.filter((t) => !byName.has(t))
const ambiguousT = distinctTargets
  .filter((t) => byName.has(t))
  .filter((t) => new Set(byName.get(t)!.map((d) => d.file)).size > 1)

/** edge count attributed to a set of targets, per relationship type */
function edgeCost(pred: (t: string) => boolean): { total: number; byType: Map<string, number> } {
  const byType = new Map<string, number>()
  let total = 0
  for (const e of edges) {
    if (!pred(e.t)) continue
    total++
    byType.set(e.type, (byType.get(e.type) ?? 0) + 1)
  }
  return { total, byType }
}

console.log(`scss A/B/C split — population: find *.scss | sort | head -${COUNT}`)
console.log(`corpus root ${CR}`)
console.log(`files walked ${files.length} (parsed ${parsed}, failed ${failed})`)
console.log(`published names ${byName.size}   edges ${edges.length}   distinct targets ${distinctTargets.length}`)
console.log(`A ambiguous targets ${ambiguousT.length}   B/C unresolved targets ${unresolvedT.length}\n`)

// ---------------------------------------------------------------- A
/**
 * CSS splits its declarations into two populations with OPPOSITE collision semantics, and
 * the split is by kind:
 *
 *   GLOBAL NAMESPACE — a `.btn` rule or a `--brand` custom property is a NAME THAT EXISTS
 *     ONCE for the whole document set. Two files writing `.btn` are not two declarations
 *     that collided; they are two rules that both match the same class, and the cascade
 *     orders them. Publishing a file-scoped identifier for these would make each rule
 *     resolve uniquely and would also make every `references` edge to that class resolve to
 *     exactly one of them, which is a claim the stylesheet does not make.
 *
 *   LEXICAL SCOPE — a Sass mixin, function or variable is bound where it is defined and is
 *     only reachable through the file's own bindings. Two files each defining `clearfix`
 *     really are two distinct things, and an edge meant for one of them is genuinely wrong
 *     if it resolves to both.
 */
const GLOBAL_KINDS = new Set(["class", "variable"])
console.log("A  NAME IS NOT AN IDENTIFIER — ambiguous targets by the kind that collides")
const aByKind = new Map<string, { targets: number; edges: number }>()
for (const t of ambiguousT) {
  // a colliding name has >1 declaration; report the kinds it collides across
  const kinds = [...new Set(byName.get(t)!.map((d) => d.kind))].sort().join("|")
  let e = aByKind.get(kinds)
  if (!e) aByKind.set(kinds, (e = { targets: 0, edges: 0 }))
  e.targets++
}
const aCost = edgeCost((t) => ambiguousT.includes(t))
for (const t of ambiguousT) {
  const kinds = [...new Set(byName.get(t)!.map((d) => d.kind))].sort().join("|")
  aByKind.get(kinds)!.edges += edges.filter((e) => e.t === t).length
}
const aRows = [...aByKind.entries()].sort((x, y) => y[1].targets - x[1].targets)
console.log("   colliding-kinds                  targets   edges")
for (const [k, v] of aRows) {
  const lex = k.split("|").some((x) => !GLOBAL_KINDS.has(x))
  console.log(`   ${k.padEnd(30)} ${String(v.targets).padStart(7)} ${String(v.edges).padStart(6)}  ${lex ? "LEXICAL — a real scoping failure" : "global — the cascade, not a collision"}`)
}
console.log(`   ${"TOTAL".padEnd(30)} ${String(ambiguousT.length).padStart(7)} ${String(aCost.total).padStart(6)}`)
const aLexTargets = aRows.filter(([k]) => k.split("|").some((x) => !GLOBAL_KINDS.has(x))).reduce((n, [, v]) => n + v.targets, 0)
const aLexEdges = aRows.filter(([k]) => k.split("|").some((x) => !GLOBAL_KINDS.has(x))).reduce((n, [, v]) => n + v.edges, 0)
console.log(`   lexical-scope collisions (A is repairable for these): targets ${aLexTargets}, edges ${aLexEdges}`)
console.log(`   global-namespace collisions: targets ${ambiguousT.length - aLexTargets}, edges ${aCost.total - aLexEdges}\n`)

// every declaration of a lexical colliding name, so the finding can be checked by hand
const lexNames = ambiguousT.filter((t) => [...new Set(byName.get(t)!.map((d) => d.kind))].some((k) => !GLOBAL_KINDS.has(k)))
if (lexNames.length) {
  console.log("   lexical colliding names, with every declaration (hand-checkable):")
  for (const t of lexNames.slice(0, 12)) {
    const ds = byName.get(t)!
    console.log(`     ${JSON.stringify(t)}  [${[...new Set(ds.map((d) => d.kind))].join("|")}] x${new Set(ds.map((d) => d.file)).size} files`)
    for (const d of [...new Set(ds.map((d) => d.file))].slice(0, 4)) console.log(`        ${d}`)
  }
  if (lexNames.length > 12) console.log(`     ... ${lexNames.length - 12} more`)
  console.log("")
}

// ---------------------------------------------------------------- B
console.log("B  EMITTER/PUBLISHER FORMAT MISMATCH — target string != published name, final segment matches")
const dotted = unresolvedT.filter((t) => t.includes("."))
const lastSegHits = dotted.filter((t) => byName.has(t.split(".").pop()!))
console.log(`   unresolved targets ${unresolvedT.length}`)
console.log(`   containing '.' ${dotted.length}`)
console.log(`   final segment IS a published name ${lastSegHits.length}`)
console.log(`   EDGES recoverable by unifying the name function: ${edgeCost((t) => lastSegHits.includes(t)).total}`)
console.log(`   examples ${lastSegHits.slice(0, 8).map((s) => JSON.stringify(s)).join(" ")}`)
console.log(`   CONTROL — targets that are dotted AND fully published (must be 0 for the probe to be live):`)
const dottedResolved = distinctTargets.filter((t) => t.includes(".") && byName.has(t))
console.log(`     ${dottedResolved.length} ${dottedResolved.slice(0, 5).map((s) => JSON.stringify(s)).join(" ")}`)
console.log("")

// ---------------------------------------------------------------- C
/**
 * A Sass specifier is a FILE PATH, resolved by the compiler against the load path and the
 * partial rules: `mixins/banner` names `_banner.scss`, `banner.scss` or `banner/_index.scss`,
 * and an extensionless specifier is the norm (`@use "mixins/banner"`). So "does this target
 * have a referent" is a question about FILES, and the honest answer needs the whole corpus,
 * not the window.
 */
function candidatePaths(spec: string): string[] {
  const base = spec.replace(/^\.\//, "").replace(/\.(scss|sass)$/, "")
  const out: string[] = []
  // a specifier may be relative to the importing file's directory, the load path, or the root
  for (const dir of [".", ...(CR.split("/").length ? [] : [])]) void dir
  out.push(`${base}.scss`, `${base}/_index.scss`, `${base}/index.scss`, `_${base.split("/").pop()}.scss`)
  return out
}

/** does any repo in the corpus hold a file this specifier could resolve to? */
function corpusHas(spec: string, fromFile: string): { found: boolean; path?: string; inWindow: boolean } {
  const rel = fromFile.slice(CR.length + 1)
  const dir = rel.slice(0, rel.lastIndexOf("/"))
  const bases = [dir, ".", ...dir.split("/").slice(0, -1)]
  const seen = new Set<string>()
  for (const b of bases) {
    for (const c of candidatePaths(spec)) {
      const p = `${b === "." ? "" : b + "/"}${c}`
      if (seen.has(p)) continue
      seen.add(p)
      // search every repo for this repo-relative path
      for (const repo of REPOS) {
        const abs = `${CR}/${repo}/${p}`
        if (existsSync(abs) && statSync(abs).isFile()) {
          return { found: true, path: `${repo}/${p}`, inWindow: inWindow.has(abs) }
        }
      }
    }
  }
  return { found: false }
}

const REPOS = execFileSync("bash", ["-lc", `ls -1 ${CR}`], { encoding: "utf8" }).trim().split("\n").filter(Boolean)

/** the shape of an unresolved target, which decides whether C is even the right bucket */
function shapeOf(t: string): string {
  if (t.startsWith("--")) return "CUSTOM-PROP"
  if (t.startsWith("$")) return "SCSS-VARIABLE"
  if (t.includes("/") || t.startsWith(".")) return "MODULE-SPECIFIER"
  if (/^[a-zA-Z][\w-]*(\.[\w-]+)*$/.test(t)) return "BARE-IDENT"
  return "OTHER"
}

console.log("C  EXTERNAL / GENUINELY ABSENT — unresolved targets by shape, and whether a file exists")
const cByShape = new Map<string, { targets: number; edges: number }>()
for (const t of unresolvedT) {
  const s = shapeOf(t)
  let e = cByShape.get(s)
  if (!e) cByShape.set(s, (e = { targets: 0, edges: 0 }))
  e.targets++
  e.edges += edges.filter((x) => x.t === t).length
}
console.log("   shape                targets   edges")
for (const [s, v] of [...cByShape.entries()].sort((x, y) => y[1].targets - x[1].targets)) {
  console.log(`   ${s.padEnd(20)} ${String(v.targets).padStart(7)} ${String(v.edges).padStart(6)}`)
}

// per-shape: is there a file the specifier could name, anywhere in the corpus?
console.log("\n   MODULE-SPECIFIER referent test — searched every repo for the partial forms")
const specT = unresolvedT.filter((t) => shapeOf(t) === "MODULE-SPECIFIER")
const specFoundIn: string[] = []
const specFoundOut: string[] = []
const specAbsent: string[] = []
for (const t of specT) {
  const srcFile = edges.find((e) => e.t === t)!.file
  const r = corpusHas(t, srcFile)
  if (r.found && r.inWindow) specFoundIn.push(t)
  else if (r.found) specFoundOut.push(t)
  else specAbsent.push(t)
}
console.log(`   specifier targets ${specT.length}`)
console.log(`     a matching file exists IN the window  : ${specFoundIn.length}`)
console.log(`     a matching file exists OUTSIDE window: ${specFoundOut.length}  <- resolvable by widening, not a defect`)
console.log(`     NO matching file in the corpus       : ${specAbsent.length}`)
console.log(`     examples present ${specFoundIn.slice(0, 4).map((s) => JSON.stringify(s)).join(" ")}`)
console.log(`     examples outside ${specFoundOut.slice(0, 4).map((s) => JSON.stringify(s)).join(" ")}`)
console.log(`     examples absent  ${specAbsent.slice(0, 4).map((s) => JSON.stringify(s)).join(" ")}`)

const customT = unresolvedT.filter((t) => shapeOf(t) === "CUSTOM-PROP")
console.log(`\n   CUSTOM-PROP targets ${customT.length} — example ${customT.slice(0, 4).map((s) => JSON.stringify(s)).join(" ")}`)
const bareT = unresolvedT.filter((t) => shapeOf(t) === "BARE-IDENT")
console.log(`   BARE-IDENT targets ${bareT.length} — example ${bareT.slice(0, 6).map((s) => JSON.stringify(s)).join(" ")}`)
const otherT = unresolvedT.filter((t) => shapeOf(t) === "OTHER")
console.log(`   OTHER targets ${otherT.length} — example ${otherT.slice(0, 8).map((s) => JSON.stringify(s)).join(" ")}`)
console.log("\nPer-edge relationship type for the unresolved set:")
console.log(`   ${JSON.stringify(Object.fromEntries([...edgeCost((t) => unresolvedT.includes(t)).byType].sort((a, b) => b[1] - a[1])))}`)
