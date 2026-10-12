/**
 * SWIFT ORACLE FOR THE FOUR UNCOVERED TYPES — the lane's answer to question 3
 * for the relationship types the m14 differential never audits.
 *
 * WHY THIS EXISTS (docs/analyzers/ONTOLOGY-WORKSTREAM.md, Part 1).
 * `validation/m60/rel-type-coverage-baseline.json` records swift carrying four
 * DERIVATION findings — types the analyzer EMITS that the differential compares
 * against nothing:
 *
 *     contains · overrides · imports · exports
 *
 * The differential's swift compared-label allowlist (differential.ts, the
 * `deriveSwiftEdges` / compared-label expressions) is
 * `["extends","implements","instantiates","calls","uses","references"]`, so all
 * four are dropped from the analyzer side before comparison. Wiring them into
 * the differential is a MASTER-owned change (script/m14/differential.ts +
 * validation/m14/differential-baseline.json). Until that happens, "the
 * differential is green" says nothing at all about these four types — an
 * unverified edge ships a bug invisibly, which is the failure this instrument
 * exists to make visible.
 *
 * WHAT IT DOES. For every corpus file it derives the expected edge set for
 * `contains`, `exports` and `imports` from the PARSE TREE with a second walker
 * that shares no code with the analyzer (it imports no analyzer module and
 * calls none of its helpers), then compares that set against what the PRODUCTION
 * entry point emitted. Two directions, because they fail differently:
 *
 *   MISSING — the tree says the edge exists and the analyzer did not emit it
 *             (an omission: a member with no owner edge, a public declaration
 *             missing from the module interface, an import missing its
 *             module-dependency edge).
 *   EXTRA   — the analyzer emitted an edge the tree does not support. This is
 *             the direction that catches FABRICATION, which the workstream
 *             names as the thing that poisons bb_graph / bb_impact / bb_migrate:
 *             a `contains` edge to a member the file never declares, an
 *             `exports` edge for something not public, an `imports` target that
 *             is not a module.
 *
 * THE LIMIT, STATED RATHER THAN HIDDEN. This is a second walker over the SAME
 * pinned tree-sitter-swift grammar, so a grammar bug present in both paths is
 * invisible to it — exactly the limit the workstream names for the differential's
 * own oracle. What it does establish is narrower and still worth having: the
 * analyzer's post-loop edge construction agrees, edge for edge, with an
 * independent reading of the tree, over a corpus draw. It does NOT establish that
 * the tree read the construct correctly.
 *
 * `overrides` is NOT here and the reason is structural, not laziness: its target
 * is resolved across files through a companion index this single-file oracle does
 * not have. script/m14/swift-overrides-premise-probe.ts measures that type's
 * premise corpus-wide instead, which is the only question worth asking of a
 * guess.
 *
 * WRITES validation/m14/tmp/swift-uncovered-oracle.json. Nothing else.
 *
 * Usage: bun script/m14/swift-uncovered-oracle.ts
 */
import { execFileSync } from "node:child_process"
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs"
import * as path from "node:path"
import { parseFile } from "../../src/ast/pool-worker"

const CR = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const OUT = "validation/m14/tmp/swift-uncovered-oracle.json"

// The SAME draw the lane's census uses, so the two instruments' numbers are
// comparable: swift-nio and alamofire at full extent, plus a deterministic
// first-600 slice of apple/swift. `--repo-cap=N` widens the slice.
const REPOS = [
  { repo: "swift-nio", cap: Number.POSITIVE_INFINITY },
  { repo: "alamofire", cap: Number.POSITIVE_INFINITY },
  { repo: "swift-corpus", cap: 600 },
]

function admittedFiles(repo: string, cap: number): string[] {
  const dir = path.join(CR, repo)
  try { execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" }) } catch { return [] }
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], {
      encoding: "utf8", maxBuffer: 512 * 1024 * 1024,
    }).split("\0").filter(Boolean)
  } catch { return [] }
  const out: string[] = []
  for (const rel of tracked) {
    if (!rel.endsWith(".swift")) continue
    const abs = path.join(dir, rel)
    try {
      const st = statSync(abs)
      if (!st.isFile() || st.size === 0) continue
      out.push(rel)
    } catch { continue }
  }
  return out.slice(0, cap)
}

interface FileRef { repo: string; rel: string; abs: string; dir: string }
const files: FileRef[] = []
const pins: Record<string, string> = {}
for (const { repo, cap } of REPOS) {
  const rels = admittedFiles(repo, cap)
  if (rels.length === 0) { console.error(`! corpus missing or empty: ${repo}`); process.exit(2) }
  try { pins[repo] = execFileSync("git", ["-C", path.join(CR, repo), "rev-parse", "HEAD"], { encoding: "utf8" }).trim() } catch { pins[repo] = "unknown" }
  for (const rel of rels) files.push({ repo, rel, abs: path.join(CR, repo, rel), dir: path.join(CR, repo) })
}
console.log(`swift uncovered-type oracle — ${files.length} files across ${REPOS.map((r) => r.repo).join(", ")}`)
for (const [repo, pin] of Object.entries(pins)) console.log(`  ${repo} @ ${pin}`)

// ------------------------------------------------------------------ the oracle
const wts: any = await import("web-tree-sitter")
const WSP = wts.Parser ?? wts.default
const WSL = wts.Language ?? wts.default?.Language
await WSP.init({ locateFile: () => path.join(process.cwd(), "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const parser = new WSP()
parser.setLanguage(await WSL.load(readFileSync(path.join(process.cwd(), "wasm", "tree-sitter-swift.wasm"))))

/** Access levels that put a declaration in its module's interface. */
import { deriveSwiftTruth, moduleLeaf, type SwiftTruth } from "./oracles/swift-contains-exports-imports"

/** `${from}\u0000${target}` — the comparison half's key shape. The walker that
 *  produces the truth lives in `oracles/swift-contains-exports-imports.ts`; the
 *  differential consumes the same module, so the two audit one rule set. */
type Edge = `${string}\u0000${string}`

// ------------------------------------------------------------------ comparison
/**
 * Compare the DECLARATION, not the label the analyzer chose for it. Two naming
 * conventions differ between the analyzer and this oracle and neither is a
 * disagreement about the graph:
 *
 *   `operator ==`  the analyzer's label for an operator overload (a `func ==`
 *                  declaration has no simple_identifier, so the name comes from
 *                  the anonymous operator token and is prefixed). The oracle
 *                  reads the bare token. Same declaration.
 *   `` `default` `` a backtick-quoted identifier is legal Swift and common in
 *                  the standard library (`case \`default\``). The analyzer strips
 *                  the backticks (`stripNameQuoting`); the oracle reads the node
 *                  text verbatim. Same declaration.
 *
 * Without this the comparison reports hundreds of phantom MISSING/EXTRA pairs in
 * both directions on a file that is fine — the first version of this oracle did
 * exactly that, which is why the count is only meaningful once the two
 * conventions are reconciled. The RAW counts are kept alongside the normalised
 * ones so the size of the reconciliation is itself visible.
 */
function normalize(v: string): string {
  if (v.startsWith("operator ")) return v.slice("operator ".length).trim()
  return v.replace(/`/g, "")
}
const stats: Record<string, {
  truth: number; analyzer: number; missing: number; extra: number; agreed: number
  truthRawSpellingChanged: number
  missingExamples: string[]; extraExamples: string[]
  byRepo: Record<string, { analyzer: number; missing: number; extra: number }>
}> = {
  contains: { truth: 0, analyzer: 0, missing: 0, extra: 0, agreed: 0, truthRawSpellingChanged: 0, missingExamples: [], extraExamples: [], byRepo: {} },
  exports: { truth: 0, analyzer: 0, missing: 0, extra: 0, agreed: 0, truthRawSpellingChanged: 0, missingExamples: [], extraExamples: [], byRepo: {} },
  imports: { truth: 0, analyzer: 0, missing: 0, extra: 0, agreed: 0, truthRawSpellingChanged: 0, missingExamples: [], extraExamples: [], byRepo: {} },
}
// Clean files and ERROR-RECOVERED files are counted SEPARATELY, and that split
// is the difference between a number about the analyzer and a number about two
// different readers of a damaged tree. The analyzer models ERROR recovery
// (`isNominalRecovery` mints a container from a header the grammar could not
// reduce); this oracle does not, so on a file with `rootNode.hasError` the two
// sides are not reading the same tree and a disagreement there says nothing
// about either rule. The error population is reported, not discarded.
const errorFileBucket = () => ({
  truth: 0, analyzer: 0, missing: 0, extra: 0, agreed: 0, truthRawSpellingChanged: 0,
  byRepo: {} as Record<string, { analyzer: number; missing: number; extra: number }>,
  missingExamples: [] as string[], extraExamples: [] as string[],
})
const errorFiles = {
  contains: errorFileBucket(),
  exports: errorFileBucket(),
  imports: errorFileBucket(),
} as Record<string, ReturnType<typeof errorFileBucket>>
let filesWithDiff = 0
let filesWithDiffClean = 0
let filesWithDiffError = 0
let extraTargetNotDeclared = 0
let extraTargetNotDeclaredError = 0
const extraTargetExamples: string[] = []
const extraTargetErrorExamples: string[] = []
let filesCompared = 0
let filesWithGrammarErrors = 0
let functionOwnedContainsExcluded = 0
let crashFiles = 0

let idx = 0
async function worker(): Promise<void> {
  while (true) {
    const i = idx++
    if (i >= files.length) return
    const f = files[i]
    const label = `${f.repo}/${f.rel}`
    let text: string
    try { text = readFileSync(f.abs, "utf8") } catch { continue }
    const tree = parser.parse(text)
    if (!tree) continue
    const hasError = tree.rootNode.hasError
    const truth = deriveSwiftTruth(tree.rootNode, moduleLeaf(f.abs))
    tree.delete?.()

    let r: any
    try { r = await parseFile(f.abs, f.dir) } catch { crashFiles++; continue }
    if (r.fallback) continue
    filesCompared++
    if (hasError) filesWithGrammarErrors++
    functionOwnedContainsExcluded += truth.functionOwnedContainsExcluded

    const got: Record<string, Set<Edge>> = { contains: new Set(), exports: new Set(), imports: new Set() }
    const exportRows = new Set<string>()
    for (const rel of r.relationships ?? []) {
      const ty = String(rel.type ?? rel.relationshipType ?? "").toLowerCase()
      if (ty === "contains" || ty === "exports" || ty === "imports") {
        got[ty].add(`${normalize(String(rel.source ?? ""))}\u0000${normalize(String(rel.target ?? ""))}`)
      }
    }
    for (const e of r.exports ?? []) exportRows.add(normalize(String(e.name ?? "")))

    // TWO-SIDED normalisation. `normalize` reconciles two naming conventions
    // (see its header); the first version applied it to the ANALYZER side only,
    // so every truth-side edge whose raw spelling differed — a backtick-quoted
    // enum case against its stripped form, `operator ==` against `==` — landed
    // in BOTH columns as a phantom pair even though the two sides agreed about
    // the declaration. `truthRawSpellingChanged` reports the size of that
    // reconciliation, so the normalisation can never silently absorb a real
    // disagreement.
    const truthNorm: Record<string, Set<Edge>> = { contains: new Set(), exports: new Set(), imports: new Set() }
    const truthRawSpellingChanged: Record<string, number> = { contains: 0, exports: 0, imports: 0 }
    for (const ty of ["contains", "exports", "imports"] as const) {
      for (const e of truth[ty]) {
        const i = e.indexOf("\u0000")
        const ne = `${normalize(e.slice(0, i))}\u0000${normalize(e.slice(i + 1))}` as Edge
        if (ne !== e) truthRawSpellingChanged[ty]++
        truthNorm[ty].add(ne)
      }
    }

    let fileDiff = false
    for (const ty of ["contains", "exports", "imports"] as const) {
      const s = hasError ? errorFiles[ty] : stats[ty]
      s.truth += truth[ty].size
      s.truthRawSpellingChanged += truthRawSpellingChanged[ty]
      s.analyzer += got[ty].size
      s.byRepo[f.repo] ??= { analyzer: 0, missing: 0, extra: 0 }
      s.byRepo[f.repo].analyzer += got[ty].size
      for (const e of truthNorm[ty]) {
        if (got[ty].has(e)) { s.agreed++; continue }
        s.missing++
        s.byRepo[f.repo].missing++
        fileDiff = true
        if (s.missingExamples.length < 20) s.missingExamples.push(`${label}: ${e.replace("\u0000", " -> ")}`)
      }
      for (const e of got[ty]) {
        if (truthNorm[ty].has(e)) continue
        s.extra++
        s.byRepo[f.repo].extra++
        fileDiff = true
        if (s.extraExamples.length < 20) s.extraExamples.push(`${label}: ${e.replace("\u0000", " -> ")}`)
        // The fabrication check: does the analyzer name something the tree does
        // not declare in this file at all?
        const target = e.slice(e.indexOf("\u0000") + 1)
        if (target !== "root" && !truth.declaredNames.has(target) && truth[ty] !== undefined) {
          if (ty !== "imports") {
            // Split by population: a hit on a CLEAN file is an analyzer
            // fabrication candidate; a hit on a grammar-error file is the
            // recovery model the note above declares non-comparable.
            if (hasError) {
              extraTargetNotDeclaredError++
              if (extraTargetErrorExamples.length < 20) extraTargetErrorExamples.push(`${label}: ${ty} -> '${target}' is not declared in this file`)
            } else {
              extraTargetNotDeclared++
              if (extraTargetExamples.length < 20) extraTargetExamples.push(`${label}: ${ty} -> '${target}' is not declared in this file`)
            }
          }
        }
      }
    }
    // The exports/ExportInfo cross-check: every published export row must be an
    // exports edge target, and every exports edge target must have a row. The
    // harness reads BOTH (run-fixtures' top-level-symbol invariant reads the
    // rows; bb_graph reads the edges), so a divergence between them is a
    // consumer-visible inconsistency the differential cannot see.
    const edgeTargets = new Set([...got.exports].map((e) => e.slice(e.indexOf("\u0000") + 1)))
    for (const n of exportRows) if (!edgeTargets.has(n)) fileDiff = true
    for (const n of edgeTargets) if (!exportRows.has(n)) fileDiff = true
    if (fileDiff) {
      filesWithDiff++
      if (hasError) filesWithDiffError++
      else filesWithDiffClean++
    }
  }
}

const t0 = Date.now()
await Promise.all(Array.from({ length: 8 }, () => worker()))
console.log(`compared ${filesCompared} files in ${((Date.now() - t0) / 1000).toFixed(1)}s (${crashFiles} crashes)`)

const out = {
  at: new Date().toISOString(),
  instrument: "script/m14/swift-uncovered-oracle.ts",
  what: "an independent tree walker vs the production parseFile, for the four types the m14 differential never audits (three of them here; overrides has its own premise probe)",
  sharedLimit: "second walker over the SAME pinned tree-sitter-swift grammar — a grammar bug present in both paths is invisible to this comparison, exactly as for the differential's own oracle",
  corpus: { root: CR, repos: REPOS.map((r) => ({ repo: r.repo, cap: r.cap, pin: pins[r.repo] })), files: files.length, compared: filesCompared, crashes: crashFiles },
  filesWithGrammarErrors,
  grammarErrorFilesNote: "files whose tree rootNode.hasError are counted in `grammarErrorTypes` instead of `types`: the analyzer models ERROR recovery and this oracle does not, so the two sides are not reading the same tree there. `types` is therefore the agreement figure over files both readers saw identically.",
  types: stats,
  truthRawSpellingReconciled: "per-type `truthRawSpellingChanged` inside `types`: truth edges whose raw spelling (operator prefix, backtick quotes) differed from the normalised comparison form — the size of the reconciliation, kept so normalisation cannot hide a disagreement",
  grammarErrorTypes: errorFiles,
  functionOwnedContainsExcluded,
  filesWithAnyDifference: filesWithDiff,
  filesWithAnyDifferenceSplit: {
    clean: filesWithDiffClean,
    grammarError: filesWithDiffError,
    note: "`clean` is the comparable population (0 is the gate); `grammarError` is the population the note above declares non-comparable — the analyzer's ERROR recovery pairs a container from a header the plain oracle cannot read.",
  },
  extraEdgeTargetsNotDeclaredInFile: extraTargetNotDeclared,
  extraEdgeTargetsNotDeclaredInErrorFiles: extraTargetNotDeclaredError,
  extraEdgeTargetExamples: extraTargetExamples,
  extraEdgeTargetErrorExamples: extraTargetErrorExamples,
  notCoveredHere: {
    overrides: "its target is resolved across files through a companion index this single-file oracle does not have; measured instead by script/m14/swift-overrides-premise-probe.ts",
  },
}
writeFileSync(OUT, JSON.stringify(out, null, 2))
console.log(`wrote ${OUT}\n`)
console.log(`type        truth     analyzer  agreed    MISSING  EXTRA`)
console.log("-".repeat(66))
for (const ty of ["contains", "exports", "imports"] as const) {
  const s = stats[ty]
  console.log(`${ty.padEnd(11)}${String(s.truth).padEnd(9)}${String(s.analyzer).padEnd(10)}${String(s.agreed).padEnd(9)}${String(s.missing).padEnd(9)}${s.extra}`)
}
console.log(`normalisation reconciled truth spellings — contains ${stats.contains.truthRawSpellingChanged}, exports ${stats.exports.truthRawSpellingChanged}, imports ${stats.imports.truthRawSpellingChanged}`)
console.log(`\nclean files compared (no ERROR node): ${filesCompared - filesWithGrammarErrors}; files with a grammar error, counted separately: ${filesWithGrammarErrors}`)
console.log(`declarations excluded from \`contains\` because their lexical owner is a BODY (function, init, deinit, subscript, accessor or closure) rather than a type — JOB 2: a body is not a container: ${functionOwnedContainsExcluded}`)
console.log(`files with at least one difference: clean ${filesWithDiffClean}, grammar-error ${filesWithDiffError}`)
console.log(`EXTRA edge targets not declared anywhere in their own file: clean ${extraTargetNotDeclared}, grammar-error ${extraTargetNotDeclaredError}`)
const bad = Object.entries(stats).filter(([, s]) => s.missing > 0 || s.extra > 0)
if (bad.length === 0) {
  console.log(`\nORACLE AGREES on all three types, both directions, over ${filesCompared} files.`)
  const errMissing = errorFiles.contains.missing + errorFiles.exports.missing + errorFiles.imports.missing
  const errExtra = errorFiles.contains.extra + errorFiles.exports.extra + errorFiles.imports.extra
  console.log(`The grammar-error population is NOT part of that claim (the analyzer models ERROR recovery, this oracle does not): ${errMissing} MISSING / ${errExtra} EXTRA, counted separately in \`grammarErrorTypes\`.`)
} else {
  console.log(`\nDISAGREEMENT — see ${OUT}`)
  process.exitCode = 1
}
