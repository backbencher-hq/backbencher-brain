/**
 * JULIA ONTOLOGY CENSUS — the measurement half of the M14 ontology lane.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * `script/m14/ontology-coverage-gate.ts` is the arbiter, and it answers the question for the two
 * languages whose ruling tables it carries (`bash`, `json`). It has no table for `julia` and
 * REFUSES to report without one (exit 2, `script/m14/ontology-coverage-gate.ts:289`) — a gate with
 * an empty table would call every un-emitted type RULED-UNJUSTIFIED, and that is a verdict about
 * the table rather than about the lane. Adding the table is a shared-file change owned by the
 * supervisor (§8 of the lane brief), so it is REPORTED here, not made.
 *
 * What this file does instead is the thing the gate's two instruments were designed to do, applied
 * to julia, and it does it through the PRODUCTION entry point:
 *
 *   - `parseFile` from `src/ast/pool-worker.ts`, NOT `RealJuliaAnalyzer.analyze()`. `analyze()` is a
 *     per-file unit that skips the pipeline stages (pool-worker, per-language timeouts, truncation,
 *     enhancements), and every count the lane reports has to come off the path a consumer takes.
 *
 *   - INSTRUMENT A, grammar-inventory: enumerate every node type the PRODUCTION grammar actually
 *     produces across the whole admitted corpus. `wasm/tree-sitter-julia.wasm` is the PATCHED
 *     rebuild `ASTEngine` loads for julia (engine.ts:869-875), byte-identical to the copy the
 *     engine materialises under /tmp — verified below, not assumed — so the inventory is the
 *     grammar the analyzer walks and not the upstream prebuilt that fails to parse real julia.
 *
 *   - INSTRUMENT B, parse-tree semantic count: for the constructs the language CAN express, count
 *     them on the tree. A string literal cannot fake a node, which is the whole point: the gate's
 *     own header records two false positives caused by a text regex.
 *
 *   - The six questions per emitted type: EXISTS (constructible, counted from source), FIRES (a
 *     non-zero count on real corpus through `parseFile`), CORRECT (an independent oracle in
 *     `script/m14/oracles/julia-*.ts`, whose DECLARED limitation is that it is a second walker over
 *     ONE grammar, so a grammar bug shared by both paths is invisible to it), LABELLED (the edge
 *     carries the right type and not a neighbour), RESOLVED (both endpoints bind to a real symbol),
 *     CONFIDENT (`evidenceClass` and `confidence`; anything under 0.7 is a heuristic and is counted
 *     as one, per honesty contract §4).
 *
 * SAMPLING
 * ---------
 * The whole admitted corpus, not a sample of it. `detectLanguageFromPath` admits the `.jl` files
 * across the corpus repos and the brief's floor is 200+ per family, so a census of the population
 * is both available and the stronger claim. Files over 512 KB are excluded here for the same reason
 * the gate excludes them — the grammar inventory holds every tree alive at once — and that
 * exclusion is COUNTED and reported rather than left silent.
 *
 * USAGE
 * -----
 *   npx tsx validation/m14/fixtures/julia/census.ts
 *   npx tsx validation/m14/fixtures/julia/census.ts --json /tmp/census.json
 *   BB_CORPUS_ROOT=/path/to/corpus npx tsx validation/m14/fixtures/julia/census.ts
 *
 * READ-ONLY. Writes only to the path given by `--json`.
 */
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../../../src/ast/language-detection"
import { parseFile } from "../../../../src/ast/pool-worker"
import { collapseSpace, pathSegments, scanNodeTypeClaims } from "./text-util"

const ALL_TYPES = ["calls", "uses", "contains", "imports", "references", "exports", "extends", "implements", "overrides", "instantiates"] as const
type Type = (typeof ALL_TYPES)[number]

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const LANG = "julia"
const jsonOut = (() => {
  const i = process.argv.indexOf("--json")
  return i >= 0 ? process.argv[i + 1] : null
})()
/** Smoke-test escape hatch. `BB_CENSUS_LIMIT` truncates the walk; a truncated census is REFUSED to
 *  report as a census, and the truncation is printed in the header so a number can never be read as
 *  the population figure by accident. The committed numbers are all from an untruncated run. */
const LIMIT = Number(process.env.BB_CENSUS_LIMIT ?? 0) || 0
/**
 * Worker count. `parseFile` materialises a web-tree-sitter parser per worker and holds a whole
 * file's tree while walking it, so the width is a MEMORY decision, not a speed one: at 8 the first
 * run of this census was killed by the OOM reaper on a 15 GB host with six other agents resident.
 * Four is the width that completes, and it is a constant rather than a flag so the committed
 * numbers are the ones a re-run reproduces.
 */
const WORKERS = Number(process.env.BB_JULIA_WORKERS ?? 4)

/**
 * ORPHANED-BOMB SURVIVAL. `src/ast/engine.ts:1441-1447` arms a 120 s `process.exit(1)` self-destruct
 * BEFORE `parser.parse(content)` and clears it AFTER, so a parse that THROWS leaves its bomb armed.
 * `parseFile` catches the throw, logs `[BB-PARSE-ERR]` and returns `extractFallback`, and the orphaned
 * timer then kills the process 120 s later — naming whichever file armed the OLDEST surviving bomb, not
 * the file that threw.
 *
 * This census runs at width 4, and `engine-concurrency-probe.ts` has now measured width 4 degrading on
 * this corpus in two independent full-population runs (2 in 3,970 parses each). So this run is EXPOSED
 * to the trap by construction, and the consequence was that a degraded file took the entire census
 * with it: the totals, the degraded-file list and the JSON were all printed AFTER the walk, and the
 * bomb fires during it. Measured on 2026-10-04 — a census at width 4 printed a `[BB-PARSE-ERR]` for
 * `Graphs.jl/test/community/louvain.jl` and then died to `[BB-HANG]` 120 s later with NO totals at all.
 *
 * So the census observes the bomb instead of dying of it, exactly as the probe does: the exit is
 * stubbed for the duration of the callback, the fire is recorded, and the run continues to its report.
 * Nothing is hidden — a fire is printed with its count beside the degraded count, because a fire is
 * the SIGNAL that some file degraded and the degraded list is what names it. Installed before
 * `parseFile` is imported so there is no module-init ordering question.
 */
const BOMB_MS = 120000
const bombFires: { at: number; named: string; exitCode: number | null }[] = []
{
  const realSetTimeout = globalThis.setTimeout
  const realWrite = process.stderr.write.bind(process.stderr)
  let lastHangName = "<none>"
  ;(process.stderr as any).write = function (chunk: any, ...rest: any[]): boolean {
    const text = typeof chunk === "string" ? chunk : String(chunk)
    if (text.includes("[BB-HANG]")) lastHangName = text.split("on ")[1]?.split(" —")[0] ?? "<unparsed>"
    return realWrite(chunk, ...rest) as unknown as boolean
  }
  ;(globalThis as any).setTimeout = function (fn: any, ms?: number, ...rest: any[]) {
    if (ms !== BOMB_MS) return realSetTimeout(fn, ms, ...rest)
    lastHangName = "<none>"
    return realSetTimeout(
      () => {
        const realExit = process.exit
        const record = { code: null as number | null }
        ;(process as any).exit = function (code?: number): never {
          record.code = typeof code === "number" ? code : 0
          return undefined as never
        }
        try {
          fn()
        } catch {
          /* the real exit is stubbed; anything it throws is the stub, not a finding */
        } finally {
          ;(process as any).exit = realExit
        }
        bombFires.push({ at: Date.now(), named: lastHangName, exitCode: record.code })
      },
      ms,
      ...rest,
    )
  }
}

// ---------------------------------------------------------------- corpus
const files: { repo: string; rel: string; abs: string; text: string; bytes: number }[] = []
let skippedLarge = 0
let skippedLargeJulia = 0
for (const e of readdirSync(CR)) {
  const dir = path.join(CR, e)
  try {
    if (!statSync(dir).isDirectory()) continue
    execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
  } catch {
    continue
  }
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 })
      .split("\0")
      .filter(Boolean)
  } catch {
    continue
  }
  for (const rel of tracked) {
    const abs = path.join(dir, rel)
    let text: string
    try {
      if (statSync(abs).size > 512 * 1024) {
        // Counted in TWO buckets, because the single number this line used to
        // print was misleading: it tallies every large tracked file in the
        // corpus root, and the root is SHARED with six other language lanes, so
        // it was dominated by other lanes' PNG/.po/.so binaries. Printed next to
        // `admitted files: N` it read as "N julia files were dropped for size".
        // Measured on this corpus root: 932 tracked files over 512 KB, of which
        // 0 are .jl — the julia population was never cut by this rule at all.
        // The other bucket is what the number actually means and it moves when
        // another agent clones, which is why the doc recorded it moving.
        skippedLarge++
        if (path.extname(rel).toLowerCase() === ".jl") skippedLargeJulia++
        continue
      }
      text = readFileSync(abs, "utf8")
    } catch {
      continue
    }
    if (detectLanguageFromPath(abs, text) !== LANG) continue
    files.push({ repo: e, rel, abs, text, bytes: Buffer.byteLength(text, "utf8") })
  }
}

const perRepo = new Map<string, number>()
for (const f of files) perRepo.set(f.repo, (perRepo.get(f.repo) ?? 0) + 1)

const admitted = files.length
if (LIMIT > 0) files.length = Math.min(files.length, LIMIT)
const truncated = files.length < admitted

console.log(`julia ontology census`)
console.log(`corpus root: ${CR}`)
console.log(`admitted files: ${admitted}${truncated ? `  *** TRUNCATED to ${files.length} by BB_CENSUS_LIMIT — NOT a census ***` : ""}`)
console.log(`excluded over 512 KB: ${skippedLargeJulia} .jl file(s) — THIS is the cut to the julia population`)
console.log(`                 ${skippedLarge - skippedLargeJulia} non-.jl tracked file(s) in the SHARED corpus root (other lanes' repos), which is why this number moves when another agent clones`)
console.log(`per repo: ${[...perRepo].map(([r, n]) => `${r}=${n}`).join(", ")}\n`)

// ---------------------------------------------------------------- instrument A: grammar inventory
const wts: any = await import("web-tree-sitter")
const WSP = wts.Parser ?? wts.default
const WSL = wts.Language ?? wts.default?.Language
await WSP.init({ locateFile: () => path.join(process.cwd(), "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const wasmFile = path.join(process.cwd(), "wasm", "tree-sitter-julia.wasm")
if (!existsSync(wasmFile)) throw new Error(`production grammar missing: ${wasmFile}`)
const wasmMd5 = createHash("md5").update(readFileSync(wasmFile)).digest("hex")
const parser = new WSP()
/** The WIRED language object is KEPT, because instrument A's second half enumerates its own
 *  declared surface (`nodeTypeCount` / `nodeTypeForId` / `nodeTypeIsNamed`) rather than re-reading
 *  a generated JSON file: the question is what the bytes this repo ships can express. */
const wiredLang: any = await WSL.load(readFileSync(wasmFile))
parser.setLanguage(wiredLang)

const nodeTypes = new Map<string, number>()
/**
 * Files CONTAINING each construct, as opposed to how many statements or names they hold.
 *
 * The distinction is the point. An edge count answers "how many edges", and a file count answers
 * "how many files", and neither can tell you whether a file that HAS the construct produced any
 * edge at all. Reconciling the two is what exposed `selected_import`: 1,675 import statements
 * across 504 files, 399 files' worth of edges, and 623 statements contributing nothing.
 */
const stmtFiles = { imports: new Set<string>(), exports: new Set<string>() }
const nodeTypeExamples = new Map<string, string>()
/**
 * Files the PRODUCTION GRAMMAR cannot read at all — `parser.parse` returned null or trapped.
 *
 * This exists because the two runs disagreed. `script/m14/ontology-coverage-gate.ts` printed
 * `[BB-PARSE-ERR] … memory access out of bounds` for two `stdlib/LibGit2` files, while this census
 * reported `parseFile threw: 0` for the same corpus — and both were true, because `parseFile` CATCHES
 * the wasm trap and returns a result rather than rethrowing. So "0 crashes" was measuring the wrong
 * thing: a file the parser cannot read leaves no trace in a counter that only counts throws. The
 * honest instrument is the parse itself, and the count belongs next to the production totals.
 */
const unreadableByGrammar: string[] = []
for (const f of files) {
  let t: any = null
  try {
    t = parser.parse(f.text)
  } catch {
    t = null
  }
  if (!t) { unreadableByGrammar.push(`${f.repo}/${f.rel}`); continue }
  const visit = (n: any) => {
    nodeTypes.set(n.type, (nodeTypes.get(n.type) ?? 0) + 1)
    if (!nodeTypeExamples.has(n.type)) nodeTypeExamples.set(n.type, `${f.repo}/${f.rel}`)
    // Per-file PRESENCE of the two constructs whose edge count must reconcile against their
    // statement count. This is the reconciliation that found the `selected_import` defect:
    // instrument B counts STATEMENTS (1,675 `import`/`using` across 504 files) while the
    // relationship table counts EDGES, and the two disagreed by 623 statements because
    // `importTargets` had no branch for `selected_import` — julia's `using Base: isexpr` form.
    // Nothing else in this census could see it: the statements parse without an ERROR node,
    // `parseFile` throws nothing, and each affected file still publishes hundreds of symbols.
    // Two numbers that should be equal and are not is the whole signal.
    if (n.type === "import_statement" || n.type === "using_statement") stmtFiles.imports.add(`${f.repo}/${f.rel}`)
    if (n.type === "export_statement" || n.type === "public_statement") stmtFiles.exports.add(`${f.repo}/${f.rel}`)
    for (let i = 0; i < n.childCount; i++) visit(n.child(i))
  }
  visit(t.rootNode)
  t.delete?.()
}
console.log(`files the production grammar could not read at all: ${unreadableByGrammar.length}${unreadableByGrammar.length ? ` — ${unreadableByGrammar.join(", ")}` : ""}`)

console.log(`INSTRUMENT A — grammar inventory`)
console.log(`production grammar: wasm/tree-sitter-julia.wasm  md5 ${wasmMd5}`)
console.log(`distinct node types produced over ${files.length} files: ${nodeTypes.size}`)
console.log(`total nodes visited: ${[...nodeTypes.values()].reduce((a, b) => a + b, 0).toLocaleString()}`)

// A node type that would EXPRESS a protocol/interface conformance relation distinct from a subtype
// relation. Named from the ontology, not from another language's grammar: if julia had such a
// construct, the grammar would have a node for it, and this is the check that says it does not.
const WOULD_MEAN_IMPLEMENTS = [
  "implements_clause", "interface_implementation", "class_implements", "protocol_conformance",
  "trait_implementation", "object_declaration", "protocol_declaration", "interface_declaration",
  "trait_declaration", "class_declaration", "mixin_clause", "conform_clause",
]
const implementsInventory = WOULD_MEAN_IMPLEMENTS.filter((n) => nodeTypes.has(n))
console.log(`node types that would express a protocol/interface conformance clause: ${WOULD_MEAN_IMPLEMENTS.length} named`)
console.log(`  present in the grammar's observed output: ${implementsInventory.length ? implementsInventory.join(", ") : "NONE — instrument A returns zero"}\n`)

// ---------------------------------------------------------------- instrument A, THE LANGUAGE HALF
/**
 * THE DECLARED VOCABULARY OF THE WIRED BYTES — the half the `implements` verdict actually needs.
 *
 * `implementsInventory` above is a statement about the FILES BELOW: "no file in this corpus ever
 * produces a node type that would express conformance". The coverage block needs the stronger
 * claim — the LANGUAGE cannot express it — and that is a statement about the grammar, not about a
 * corpus, so it is measured on the grammar: every symbol the wired wasm declares is enumerated and
 * scanned for a conformance vocabulary.
 *
 * The word list is not invented here. The identical scan over `wasm/tree-sitter-typescript.wasm`
 * returns `implements_clause`, `interface_declaration`, `implements`, `interface`; over java it
 * returns `super_interfaces`, `interface_declaration`, `extends_interfaces`, `@interface`. So the
 * predicate IS this repo's working definition of "a grammar that can express this relation", and
 * julia returning 0 while those return 6 and 8 is the measurement rather than the assertion.
 *
 * RULE 3 — THE CONTROLS, AND THEY ARE NOT DECORATIVE. A scan that returns 0 proves nothing unless
 * it can return non-zero, so two controls run through the SAME code path before the zero is printed:
 *   CONTROL 1  the identical scan over the wired TypeScript grammar, which MUST return > 0;
 *   CONTROL 2  the identical scan over words julia MUST have (`struct`, `abstract`, `where`,
 *              `function`), which MUST return > 0.
 * Either failing THROWS, so the zero cannot be printed by a scanner that could not have found a hit.
 */
const CONFORMANCE_WORDS = ["interface", "implements", "implement", "protocol", "trait", "conform", "contract", "mixin"]
function vocabularyOf(language: any): string[] {
  const out: string[] = []
  for (let i = 0; i < language.nodeTypeCount; i++) out.push(String(language.nodeTypeForId(i) ?? ""))
  return [...new Set(out)]
}
const conformanceHits = (vocab: string[]): string[] =>
  vocab.filter((n) => CONFORMANCE_WORDS.some((w) => n.toLowerCase().includes(w))).sort()
const juliaVocab = vocabularyOf(wiredLang)
const juliaConformance = conformanceHits(juliaVocab)
const MUST_BE_PRESENT = ["struct", "abstract", "where", "function"]
const mustHits = MUST_BE_PRESENT.map((w) => `${w}=${juliaVocab.filter((n) => n.toLowerCase().includes(w)).length}`)
const mustMissing = MUST_BE_PRESENT.filter((w) => !juliaVocab.some((n) => n.toLowerCase().includes(w)))
const controlWasm = path.join(process.cwd(), "wasm", "tree-sitter-typescript.wasm")
const controlHits = conformanceHits(vocabularyOf(await WSL.load(readFileSync(controlWasm))))
if (mustMissing.length) throw new Error(`instrument A CONTROL 2 FAILED: the vocabulary scan cannot see ${mustMissing.join(", ")} in the wired julia grammar, so a 0 for the conformance words is void`)
if (controlHits.length === 0) throw new Error(`instrument A CONTROL 1 FAILED: the same scan over wasm/tree-sitter-typescript.wasm returned 0, so the scan cannot detect a conformance construct at all and the julia 0 is void`)

console.log(`THE LANGUAGE HALF — declared vocabulary of the WIRED bytes, not of the corpus`)
console.log(`  wasm/tree-sitter-julia.wasm declares ${wiredLang.nodeTypeCount} symbol ids = ${juliaVocab.length} unique names (named and anonymous both scanned)`)
console.log(`  of those, expressing a protocol/interface conformance relation: ${juliaConformance.length}${juliaConformance.length ? ` — ${juliaConformance.join(", ")}` : " — NOT ONE"}`)
console.log(`    scanned for: ${CONFORMANCE_WORDS.join(", ")}`)
console.log(`  CONTROL 1 (same code path, grammar that HAS the construct) wasm/tree-sitter-typescript.wasm: ${controlHits.length} — ${controlHits.slice(0, 6).join(", ")}`)
console.log(`  CONTROL 2 (the scanner must see words julia HAS): ${mustHits.join("  ")}`)
console.log()

// The FULL list, so the zero above is auditable rather than asserted.
console.log(`observed node types (type=count, most frequent first):`)
const sortedTypes = [...nodeTypes].sort((a, b) => b[1] - a[1])
for (let i = 0; i < sortedTypes.length; i += 6) {
  console.log(`  ` + sortedTypes.slice(i, i + 6).map(([t, n]) => `${t}=${n.toLocaleString()}`).join("  ").padEnd(100))
}
console.log()

// ---------------------------------------------------------------- instrument A': L2, lane-owned
//
// `script/m14/audit-analyzer-grammar.ts` is the L2 gate — it validates an analyzer's node-type
// references against the grammar's own `node-types.json` and is what honesty contract §2 calls the
// precondition for claiming L2. julia is NOT in its language list (a full run prints 48 rows and no
// `julia` line), so the gate cannot make any statement about this lane at all. That script is shared
// machinery and is therefore reported rather than edited; this block is the lane-owned substitute,
// and it is STRICTER in one respect and WEAKER in another, both stated:
//
//   STRICTER — the reference set is the node types the PRODUCTION grammar actually PRODUCES over
//   971 real files, not the types the grammar's manifest declares. A name in `node-types.json` that
//   no corpus file reaches is exactly the "declared-but-never-produced" case, and matching against
//   observed output catches it.
//   WEAKER — it does not check FIELD names and it does not detect a DEAD BRANCH (a predicate that
//   the grammar can never satisfy). The dead-branch half is not skipped: it is measured separately
//   below, on the one branch this lane added that was at risk of being dead.
//
// Comments and template literals are stripped before extraction, so a node type named only in prose
// is not accused — which is the same rule the shared audit applies, and the reason a comment naming
// a node type cannot silently make the gate look greener or redder.
const analyzerPath = path.join(process.cwd(), "src", "ast", "real-julia-analyzer.ts")
const analyzerSrc = readFileSync(analyzerPath, "utf8")

// A NODE-TYPE CLAIM, and nothing else — see `scanNodeTypeClaims` in ./text-util for the three
// shapes and for why the extraction has to be positional rather than lexical. The three
// `replace(/…/)` calls that used to strip comments and templates from the analyzer's own TypeScript
// are gone; that is a lexical SCANNER now, and its declared limitation is printed in its header.
//
// The `Set` names are named here, not discovered: a general "every Set of strings" rule sweeps up
// `IMPLICIT_OR_CONSTANT` and the evidence-class lists, which is exactly the false accusation an
// earlier version of this census made (32 names accused, 30 of them not node types).
const NODE_TYPE_SETS = ["TYPE_DECLARATIONS", "CONDITIONAL_OR_GENERATED", "LOCAL_BINDING_SCOPE"]
const claimScan = scanNodeTypeClaims(analyzerSrc, NODE_TYPE_SETS)
for (const w of claimScan.warnings) console.log(`  [warn] ${w}`)
const nodeTypeClaims = new Map<string, number>() // node type -> first line it was claimed on
for (const c of claimScan.claims) if (!nodeTypeClaims.has(c.name)) nodeTypeClaims.set(c.name, c.line)
const observed = new Set(nodeTypes.keys())
const unknownRefs = [...nodeTypeClaims.keys()].filter((n) => !observed.has(n)).sort()
console.log(`INSTRUMENT A' — L2 reference audit (lane-owned substitute; julia is absent from`)
console.log(`script/m14/audit-analyzer-grammar.ts's language list, so the shared gate cannot speak here)`)
console.log(`  node-type CLAIMS in ${path.relative(process.cwd(), analyzerPath)}: ${nodeTypeClaims.size}`)
console.log(`  of those, NOT produced by the production grammar on any of ${files.length} corpus files: ${unknownRefs.length}`)
if (unknownRefs.length) console.log(`    ${unknownRefs.join(", ")}`)
console.log()

// ---------------------------------------------------------------- instrument B: semantic probes
type Probe = { name: string; types: Type[]; hits: string[]; occurrences: number; files: Set<string>;
  /** `file:line` of every occurrence that matched the probe's SECOND clause, when the probe counts a
   *  subset rather than a whole node class. Without it the aggregate is unpublishable: the per-file
   *  `hits` below only sample the first 40 files, so a doc cannot cite a corpus-wide count it cannot
   *  reproduce. Set only by the probes that have a subset. */
  subsetHits?: string[] }
const probes: Probe[] = []
/** file label -> every name the file declares a dependency on, read off the tree (see phase one). */
const importNamesByFile = new Map<string, Set<string>>()
/**
 * file label -> the names the file BINDS LOCALLY, read off the tree.
 *
 * This is what separates "an endpoint that names nothing because the binding is deliberately not a
 * symbol" from "an endpoint that names nothing because a declaration was lost". They are opposite
 * findings and they look identical in a count: a function PARAMETER is bound in the file, read by
 * `x::T` and by every use inside the body, and published as no symbol at all — because
 * `SymbolKind` has no `Parameter` member and the repo's standing negative contract says parameters
 * are not symbols (csharp M12.07 `ParamsAreNotSymbols`). Those edges are true and unresolvable BY
 * DESIGN, and the report has to say so with a number rather than fold them in with defects.
 *
 * Read from four node types, all of them measured present in the grammar's output over this corpus:
 * `for_binding`, `let_binding`, `catch_clause`, and the argument list of every declaration `signature`
 * (including the `parameters` keyword-argument block and a `splat_expression`'s `...`).
 */
const localBindingsByFile = new Map<string, Set<string>>()
function probe(name: string, types: Type[]): Probe {
  const p: Probe = { name, types, hits: [], occurrences: 0, files: new Set() }
  probes.push(p)
  return p
}

const kids = (n: any): any[] => {
  const out: any[] = []
  for (let i = 0; i < n.namedChildCount; i++) {
    const c = n.namedChild(i)
    if (c) out.push(c)
  }
  return out
}
const pos = (n: any, i: number): any | null => n.namedChild(i) ?? null
/** The operator token of a `binary_expression`. In this grammar the operator is a NAMED child of type `operator`. */
const binOp = (n: any): string => {
  for (let i = 0; i < n.childCount; i++) {
    const c = n.child(i)
    if (c && c.type === "operator") return c.text.trim()
  }
  return ""
}
/** left/right operands of a `binary_expression`: the operator is child index 1 and IS named, so the
 *  operands are the first and last named children that are not the operator. */
const operands = (n: any): { left: any | null; right: any | null } => {
  const named = kids(n).filter((c) => c.type !== "operator")
  return { left: named[0] ?? null, right: named.length > 1 ? named[named.length - 1] : null }
}

const pSupertype = probe("B: every `<:` / `>:` clause (julia's ONLY supertype construct)", ["extends", "implements"])
const pTypeHeadSup = probe("B: `<:` / `>:` in a `type_head` — a declared type's supertype", ["extends"])
const pWhereBound = probe("B: `<:` / `>:` in a `where`/curly — a type PARAMETER's bound", ["extends"])
const pImport = probe("B: `import_statement` / `using_statement` — a file-to-module dependency", ["imports"])
const pExport = probe("B: `export_statement` / `public_statement` — a module publishing a binding", ["exports"])
const pOverride = probe("B: method redefinition — same name AND same signature declared twice in one file", ["overrides"])
const pOverrideUncond = probe("B: …and the replacement is UNCONDITIONAL (not in an if/else/try/catch/ternary/&& or generated)", ["overrides"])
const pOverrideAdmitted = probe("B: …and inside a DECLARED module (the analyzer's edge source must be a real symbol)", ["overrides"])
const pInstantiate = probe("B: a call of a type name declared in the same file (julia has no `new`)", ["instantiates"])
const pSuperToAbstract = probe("B: a supertype clause naming an `abstract type` declared in the same file", ["implements"])
const pAndGuard = probe("B: `&&` binary_expressions / of those with a DECLARATION node on the right (the `&&` branch of isUnconditionalPosition)", ["overrides"])
const pOrGuard = probe("B: `||` binary_expressions / of those with a DECLARATION node on the right (the SAME branch with the other operator)", ["overrides"])
// Both guards get an EMPTY subset list up front. Created lazily on the first hit instead, a probe
// whose subset count is 0 would have `subsetHits === undefined`, the reporting block would be
// skipped, and the run would print nothing at all for that clause — a measurement that vanishes
// rather than reading zero. `||` is exactly that case: 5,145 occurrences, 0 with a declaration.
pAndGuard.subsetHits = []
pOrGuard.subsetHits = []
const pOverrideUnlocal = probe("B: …and NOT a local binding (no enclosing function body / do / let / ->; inside those, `f(x) = …` binds a closure and enters no method table)", ["overrides"])
const pOverrideUncollided = probe("B: …and the enclosing scope differs from the earlier declaration's (the pre-fix key omitted scope, so two closures in different functions collided)", ["overrides"])

/** The signature that decides whether two declarations are the SAME method, by julia's own rule. */
function signatureKey(sig: any): string {
  const call = sig.type === "call_expression" ? sig : kids(sig).find((c) => c.type === "call_expression")
  if (!call) return ""
  const args = kids(call).find((c) => c.type === "argument_list")
  const whereNode = sig.type === "where_expression" ? sig : kids(sig).find((c) => c.type === "where_expression")
  return `${args ? collapseSpace(args.text) : ""}${whereNode ? `|where ${collapseSpace(whereNode.text)}` : ""}`
}
/** The left-most name of a `type_head` — the DECLARED name, not the supertype. */
function headName(x: any): string {
  if (!x) return ""
  if (x.type === "identifier") return x.text.trim()
  if (x.type === "binary_expression") return headName(operands(x).left)
  const c0 = pos(x, 0)
  return c0 ? headName(c0) : ""
}

/**
 * The same `CONDITIONAL_OR_GENERATED` set and the same ancestor test the analyzer uses, restated
 * here so the census measures the analyzer's ADMITTED set rather than reading the analyzer's own
 * number back and calling it a measurement. Written out twice on purpose: a census that imported
 * the analyzer's constant could only ever confirm that the constant equals itself.
 */
const CONDITIONAL_OR_GENERATED = new Set([
  "if_statement", "else_clause", "elseif_clause",
  "while_statement", "for_statement",
  "try_statement", "catch_clause", "finally_clause",
  "ternary_expression",
  "macrocall_expression",
  "quote_expression", "quote_statement",
])
/**
 * The local-binding half, restated for the same reason. Measured ancestor counts over the 417
 * redefinition declarations in the admitted corpus: 41 `let_statement`, 29 `function_definition`,
 * 3 `macro_definition`, 3 `do_clause` — every member fires, so none of them is a dead predicate.
 * `compound_statement` is deliberately ABSENT: it is the node for both a function body and a top-level
 * `begin … end` inside a module, and the second is a legitimate method-table position.
 */
const LOCAL_BINDING_SCOPE_ANY = ["function_definition", "macro_definition", "do_clause", "let_statement", "arrow_function_expression"]
function unconditional(n: any): boolean {
  let cur: any = n
  for (let i = 0; i < 24 && cur; i++) {
    if (CONDITIONAL_OR_GENERATED.has(cur.type)) return false
    if (cur.type === "binary_expression") {
      let op = ""
      for (let k = 0; k < cur.childCount; k++) { const c = cur.child(k); if (c && c.type === "operator") { op = c.text.trim(); break } }
      if (op === "&&") {
        // The operator is a NAMED child here, so the operand list is [left, operator, right] and
        // the right operand is the LAST non-operator named child — not index 1.
        const named = kids(cur).filter((c: any) => c.type !== "operator")
        const right = named.length > 1 ? named[named.length - 1] : null
        if (right && right.id === n.id) return false
      }
    }
    cur = cur.parent ?? null
  }
  return true
}
/** The nearest enclosing `module`'s declared name, or "" — the analyzer's only admissible edge source. */
function declaredModuleScope(n: any): string {
  let cur: any = n.parent ?? null
  for (let i = 0; i < 24 && cur; i++) {
    if (cur.type === "module_definition") {
      const nm = pos(cur, 0)
      return nm && nm.type === "identifier" ? nm.text.trim() : ""
    }
    cur = cur.parent ?? null
  }
  return ""
}

for (const f of files) {
  const label = `${f.repo}/${f.rel}`
  const before = probes.map((p) => p.occurrences)
  const t = parser.parse(f.text)
  if (!t) continue
  const root = t.rootNode
  const declaredTypes = new Map<string, string>() // name -> abstract|primitive|struct
  // `name|signature` -> declaration SITES (line + node), because the three override probes below
  // differ only by how many guards are applied and a line number cannot carry a position test.
  const declNodes = new Map<string, { name: string; line: number; node: any }[]>()
  // Every name this file imports, collected HERE because this is where the tree is walked and the
  // incoming classification (phase two) needs it. It is the only evidence available for "external
  // by the file's own declaration" — nothing else in the pipeline records it.
  const importedHere = importNamesByFile.get(label) ?? new Set<string>()
  importNamesByFile.set(label, importedHere)
  const localHere = localBindingsByFile.get(label) ?? new Set<string>()
  localBindingsByFile.set(label, localHere)

  /** The name a binding NODE introduces: an identifier, or the leftmost identifier of an annotated
   *  or splatted one (`x::Int`, `xs...`, `kw::Int=1`). A parameter is not a symbol — the repo's
   *  standing negative contract — but it IS a binding, and this is how the census says so. */
  const bindingName = (b: any): string => {
    if (!b) return ""
    if (b.type === "identifier") return b.text.trim()
    if (b.type === "typed_expression" || b.type === "unary_typed_expression" || b.type === "splat_expression" || b.type === "parameters") {
      const inner = kids(b)[0]
      return inner ? bindingName(inner) : ""
    }
    if (b.type === "juxtaposition_expression" || b.type === "parenthesized_expression") {
      const inner = kids(b)[0]
      return inner ? bindingName(inner) : ""
    }
    return ""
  }
  const collectBindings = (b: any) => {
    const nm = bindingName(b)
    if (nm) localHere.add(nm)
  }
  /** The parameters of a callable node, from its `argument_list`. */
  const collectParams = (call: any) => {
    const args = call ? kids(call).find((c: any) => c.type === "argument_list") : null
    if (args) for (const a of kids(args)) collectBindings(a)
  }

  const visit = (n: any) => {
    switch (n.type) {
      case "for_binding":
      case "let_binding": {
        for (const b of kids(n)) collectBindings(b)
        break
      }
      case "catch_clause": {
        for (const b of kids(n)) collectBindings(b)
        break
      }
      case "signature": {
        // A `signature` does NOT always hold the callable directly. `function f(x)` gives
        // `signature > call_expression`, but `Object{K,V}() where {K,V}` gives
        // `signature > where_expression > call_expression` — and looking only for a DIRECT
        // `call_expression` child found 14 signatures in one file and 0 parameters in it. This is
        // the same wrapper this lane's own header calls out as the grammar's most repeated trap, and
        // it bit the census the same way it would bite an analyzer: a shape read positionally.
        const call = ((): any => {
          let cur: any = n
          for (let i = 0; i < 4 && cur; i++) {
            if (cur.type === "call_expression") return cur
            cur = kids(cur).find(
              (c: any) => c.type === "call_expression" || c.type === "where_expression" || c.type === "parenthesized_expression",
            )
            if (cur && cur.type === "call_expression") return cur
          }
          return null
        })()
        collectParams(call)
        break
      }
      case "abstract_definition":
      case "primitive_definition":
      case "struct_definition": {
        const head = kids(n).find((c: any) => c.type === "type_head")
        if (head) {
          const nm = headName(head)
          if (nm) declaredTypes.set(nm, n.type)
        }
        break
      }
      case "import_statement":
      case "using_statement": {
        pImport.occurrences++
        pImport.hits.push(`${label}:${n.startPosition.row + 1} ${collapseSpace(n.text).slice(0, 64)}`)
        // `using Foo.Bar: baz` — every `identifier` in the statement is a name the file declares a
        // dependency on: the module path segments AND the names pulled in by `:`. Collected from the
        // SUBTREE, so it costs one walk of a node that is already being visited.
        const collect = (m: any) => {
          if (m.type === "identifier") importedHere.add(m.text.trim())
          for (let k = 0; k < m.childCount; k++) collect(m.child(k))
        }
        collect(n)
        break
      }
      case "export_statement":
      case "public_statement": {
        pExport.occurrences++
        pExport.hits.push(`${label}:${n.startPosition.row + 1} ${collapseSpace(n.text).slice(0, 64)}`)
        break
      }
      case "function_definition":
      case "macro_definition": {
        const sig = kids(n).find((c) => c.type === "signature")
        const call = sig ? (sig.type === "call_expression" ? sig : kids(sig).find((c) => c.type === "call_expression")) : null
        const callee = call ? pos(call, 0) : null
        const nm = callee && callee.type === "identifier" ? callee.text.trim() : ""
        const key = signatureKey(sig ?? call ?? null)
        if (nm && key) {
          const arr = declNodes.get(`${nm}|${key}`) ?? []
          arr.push({ name: nm, line: n.startPosition.row + 1, node: n })
          declNodes.set(`${nm}|${key}`, arr)
        }
        break
      }
      case "assignment": {
        let lhs = pos(n, 0)
        for (let g = 0; g < 8 && lhs && (lhs.type === "where_expression" || lhs.type === "curly_expression" || lhs.type === "typed_expression" || lhs.type === "parenthesized_expression"); g++) {
          const f2 = pos(lhs, 0)
          if (!f2) break
          lhs = f2
        }
        if (lhs && lhs.type === "call_expression") {
          // THE SHORT FORM IS THE COMMON FORM. `f(x) = expr` — and `A.B(x) = expr`, and
          // `f(x) where {T} = expr` — is an `assignment`, not a `function_definition`, so it has no
          // `signature` node at all. Collecting parameters only from `signature` found 13 local
          // bindings in 1,543 call targets, which is not a property of julia; it is a property of
          // the census having looked at the minority spelling.
          collectParams(lhs)
          const callee = pos(lhs, 0)
          const nm = callee && callee.type === "identifier" ? callee.text.trim() : ""
          const key = signatureKey(lhs)
          if (nm && key) {
            const arr = declNodes.get(`${nm}|${key}`) ?? []
            arr.push({ name: nm, line: n.startPosition.row + 1, node: n })
            declNodes.set(`${nm}|${key}`, arr)
          }
        }
        break
      }
    }
    for (let i = 0; i < n.childCount; i++) visit(n.child(i))
  }
  visit(root)

  // Supertype clauses. Counted at EVERY position, and separately by the position that decides what
  // the clause means: on a `type_head` it is the declared type's supertype, inside a `where` or a
  // curly it is a type parameter's bound. Julia has no third position and no other operator.
  const sup = (n: any) => {
    if (n.type === "binary_expression" && (binOp(n) === "<:" || binOp(n) === ">:") ) {
      const { left, right } = operands(n)
      if (left && right) {
        pSupertype.occurrences++
        pSupertype.hits.push(`${label}:${n.startPosition.row + 1} \`${left.text.trim().slice(0, 30)}\` ${binOp(n)} \`${right.text.trim().slice(0, 30)}\``)
        const inHead = (() => { let c: any = n; for (let i = 0; i < 6 && c; i++) { if (c.type === "type_head") return true; c = c.parent ?? null } return false })()
        if (inHead) pTypeHeadSup.occurrences++
        else pWhereBound.occurrences++
        const target = declaredTypes.get(right.text.trim())
        if (target === "abstract_definition" || target === "primitive_definition") {
          pSuperToAbstract.occurrences++
          pSuperToAbstract.hits.push(`${label}:${n.startPosition.row + 1} \`${left.text.trim().slice(0, 24)}\` <: abstract \`${right.text.trim()}\``)
        }
      }
    }
    for (const c of kids(n)) sup(c)
  }
  sup(root)

  // Method redefinition — the bash precedent's probe, tightened. Julia's method table holds ONE
  // entry per (name, signature) tuple, so a second declaration of the SAME pair REPLACES the first
  // (`--warn-overwrite=yes` prints "Method definition ... overwritten"). A second declaration of
  // the same name with a DIFFERENT signature is a new method and replaces nothing, so the signature
  // is part of the key rather than the name alone.
  //
  // The redefinition DECLARATION SITES are kept as nodes, not just lines, because the three probes
  // below differ only in HOW MANY GUARDS are applied and a line number cannot carry a position test.
  for (const arr of declNodes.values()) {
    if (arr.length < 2) continue
    const name = arr[0].name
    const admitted = arr.filter((d) => unconditional(d.node))
    // The LOCAL-BINDING half. `f(x) = …` inside a function body, a `do`, a `let` or a `->` binds a
    // LOCAL variable holding a closure: it adds no method and displaces nothing. Restated here rather
    // than imported, for the reason the `&&` test is restated — a census that read the analyzer's own
    // set could only confirm the set equals itself.
    const notLocal = (d: { node: any }) => !LOCAL_BINDING_SCOPE_ANY.some((t) => {
      let c: any = d.node.parent
      for (let i = 0; i < 24 && c; i++) { if (c.type === t) return true; c = c.parent ?? null }
      return false
    })
    const unlocal = admitted.filter(notLocal)
    // The SCOPE half. The pre-fix key was `name|signature`; two declarations of the same method in
    // two DIFFERENT modules or types are two methods, and counting the second as a replacement of the
    // first is a fabrication. Measured shape: `desugaring.jl` (lines 153 and 324) and `range.jl`
    // (488 and 496), both inside function bodies.
    const scopeOf = (d: { node: any }) => {
      let c: any = d.node.parent
      for (let i = 0; i < 24 && c; i++) {
        if (c.type === "module_definition" || c.type === "struct_definition" || c.type === "abstract_definition" || c.type === "primitive_definition") {
          const nm = pos(c, 0)
          return nm && nm.type === "identifier" ? nm.text.trim() : c.type
        }
        c = c.parent ?? null
      }
      return "<file-scope>"
    }
    const withScope = unlocal.filter((d) => declaredModuleScope(d.node) !== "")
    const uncollided = unlocal.filter((d) => scopeOf(d) === scopeOf(arr[0]) || scopeOf(d) === "<file-scope>")
    const replacements = (xs: typeof arr) => Math.max(0, xs.length - 1)
    pOverride.occurrences += replacements(arr)
    pOverride.hits.push(`${label}: \`${name}\` with an identical signature declared at lines ${arr.map((d) => d.line).join(", ")}`)
    pOverrideUncond.occurrences += replacements(admitted)
    if (admitted.length >= 2) pOverrideUncond.hits.push(`${label}: \`${name}\` at lines ${admitted.map((d) => d.line).join(", ")}`)
    pOverrideAdmitted.occurrences += replacements(withScope)
    if (withScope.length >= 2) pOverrideAdmitted.hits.push(`${label}: \`${name}\` at lines ${withScope.map((d) => d.line).join(", ")} in scope \`${declaredModuleScope(withScope[withScope.length - 1].node)}\``)
    pOverrideUnlocal.occurrences += replacements(unlocal)
    if (unlocal.length >= 2) pOverrideUnlocal.hits.push(`${label}: \`${name}\` at lines ${unlocal.map((d) => d.line).join(", ")}`)
    pOverrideUncollided.occurrences += replacements(uncollided)
    if (uncollided.length >= 2) pOverrideUncollided.hits.push(`${label}: \`${name}\` at lines ${uncollided.map((d) => d.line).join(", ")} all in scope \`${scopeOf(uncollided[0])}\``)
  }

  // The `&&` / `||` guard, counted rather than assumed. `isUnconditionalPosition` refuses a
  // declaration that is the right operand of `&&`, because the right operand of `&&` runs only when
  // the left one holds. The L2 requirement is "zero dead branches — branches whose predicate can
  // never match per the grammar", so this branch's REACHABILITY is the thing that has to be
  // measured, and the answer is not obvious in either direction: `cond && f(x) = v` does NOT parse
  // the way the guard assumes (the grammar binds `&&` tighter and yields `(cond && f(x)) = v`, so
  // the call never sits alone on the right), while `cond && function f() … end` does.
  //
  // So `||` is measured alongside it and is reported as a DELIBERATE OMISSION, because it came back
  // 0. A branch that cannot match is not a safety net; it is an unmeasured claim about the grammar.
  {
    let and = 0
    let andDecl = 0
    let or = 0
    let orDecl = 0
    const sc = (n: any): void => {
      if (n.type === "binary_expression") {
        const op = binOp(n)
        if (op === "&&" || op === "||") {
          const named = kids(n).filter((c) => c.type !== "operator")
          const right = named.length > 1 ? named[named.length - 1] : null
          const rightIsDecl = !!right && (right.type === "function_definition" || right.type === "macro_definition" || right.type === "assignment")
          if (op === "&&") {
            and++
            if (rightIsDecl) { andDecl++; (pAndGuard.subsetHits ??= []).push(`${label}:${right.startPosition.row + 1} \`${right.text.split("\n")[0].trim().slice(0, 70)}\``) }
          } else {
            or++
            if (rightIsDecl) { orDecl++; (pOrGuard.subsetHits ??= []).push(`${label}:${right.startPosition.row + 1} \`${right.text.split("\n")[0].trim().slice(0, 70)}\``) }
          }
        }
      }
      for (const c of kids(n)) sc(c)
    }
    sc(root)
    pAndGuard.occurrences += and
    pAndGuard.files.add(label)
    pOrGuard.occurrences += or
    pOrGuard.files.add(label)
    pAndGuard.hits.push(`${label}: ${and} \`&&\`, ${andDecl} with a declaration on the right`)
    pOrGuard.hits.push(`${label}: ${or} \`||\`, ${orDecl} with a declaration on the right`)
  }

  // Construction: julia has no `new`; calling a type name IS the constructor.
  const inst = (n: any) => {
    if (n.type === "call_expression") {
      const callee = pos(n, 0)
      const nm = callee && callee.type === "identifier" ? callee.text.trim() : ""
      if (nm && declaredTypes.has(nm)) {
        pInstantiate.occurrences++
        pInstantiate.hits.push(`${label}:${n.startPosition.row + 1} ${nm}(...)`)
      }
    }
    for (const c of kids(n)) inst(c)
  }
  inst(root)
  t.delete?.()

  probes.forEach((p, i) => {
    if (p.occurrences > before[i]) p.files.add(label)
  })
}

console.log(`INSTRUMENT B — parse-tree semantic counts (a string literal cannot fake a node)\n`)
for (const p of probes) {
  console.log(`  ${p.name}`)
  console.log(`    ontology types: ${p.types.join(", ")}`)
  console.log(`    occurrences: ${p.occurrences.toLocaleString()}   files: ${p.files.size}`)
  if (p.subsetHits) {
    console.log(`    of those, matching the probe's second clause: ${p.subsetHits.length} (ALL of them, not a sample)`)
    for (const h of p.subsetHits.slice(0, 8)) console.log(`      > ${h}`)
    if (p.subsetHits.length === 0) console.log(`      none — this branch is UNREACHABLE over the corpus`)
  }
  for (const h of p.hits.slice(0, 4)) console.log(`      e.g. ${h}`)
  console.log()
}

// ---------------------------------------------------------------- what the production path emits
type RelRow = { n: number; files: Set<string>; conf: Map<number, number>; evidence: Map<string, number> }
const rel = new Map<string, RelRow>()
/**
 * THE PROJECT-SCOPE KEY SPACE — the space the incoming gate resolves an edge in, and therefore the
 * space a `calls` residual has to be explained against.
 *
 * One map per repository, because production's rule is `WHERE s.project_id = ?`: a name that
 * collides with a declaration in ANOTHER project is not ambiguous. Each declaration contributes its
 * NAME and, when it has one, its QUALIFIED name (`owner.name`, published since 2026-10-09); the
 * gate counts an alias as the SAME declaration, so it adds a key and never a duplicate.
 *
 * This exists because the fleet's `calls` question cannot be answered from a bare-name census:
 * "how much of the ambiguity has a receiver the analyzer could publish" is a question about whether
 * a DIFFERENT key exists in this map, not about how many declarations share the bare name.
 */
const projKeys = new Map<string, Map<string, number>>()
/**
 * WHY an edge is ambiguous, which the count alone cannot say. Two indexes, because the question has
 * two readings and only one of them is production's:
 *   perProject  key -> [ {file, scope} ] within ONE project (the gate's scope; a project IS a path,
 *               `src/util/project-id.ts:29`, and the corpus root holds no project)
 *   pooled      key -> { repo -> declarations }, the SAME key across every repo at once
 * An edge whose candidates live in different REPOS is ambiguous only to a POOLED instrument: in
 * production each repo is its own project, so those candidates cannot collide. The split is printed
 * for both spaces so the pooled ratio is never subtracted from a per-project number.
 */
const pkCands = new Map<string, Map<string, { file: string; scope: string }[]>>()
const pooledCands = new Map<string, Map<string, number>>()
/** key -> the BINDING keys it answers to (a declaration's own qualifiedName, else its name). */
const pkBindings = new Map<string, Map<string, Set<string>>>()
/** repo -> file (repo-relative) -> the `module` names that file declares. */
const fileModules = new Map<string, Map<string, Set<string>>>()
/**
 * THE COLON-NAMED CONTAINMENT AUDIT — is julia inside the blast radius of `140be2f01`?
 *
 * That defect made the indexer's own `contains` dedup guard miss for any child symbol whose NAME
 * carries a colon: the guard's key was built leaf-reduced and probed RAW, so the two keys differed by
 * construction and the containment row was written TWICE. The expected answer for julia is "not
 * affected — its qualified names are dotted", and julia ALSO publishes `Base.:(==)`, `Base.:(+)` and
 * friends, whose names do carry a colon. So it is counted rather than assumed: the population that
 * received a duplicate row is every symbol with a colon in its name AND an owner to synthesize the
 * owner→owned row from.
 */
const colonAudit = { symbols: 0, colonNamed: 0, colonNamedOwned: 0, examples: [] as string[], containsTargetsWithColon: 0 }
/**
 * THE UNRESOLVED SPLIT — "is there a candidate AT ALL?", which is a different question from "which
 * candidate", and the one that decides whether clause 1's remainder is a RESOLUTION problem or a
 * CLAIM problem.
 *
 * `unresolved` in the gate is defined against the EDGE'S OWN PROJECT, so by construction nothing in
 * that project answers. What it does not say is whether the name exists anywhere else:
 *   another project   declared in one of the corpus's other repositories — a cross-project name,
 *                     and for a dependency-shaped target the difference between "we missed a
 *                     declaration" and "this belongs to someone else";
 *   stdlib surface    declared in the corpus's `julia` repository, which IS Base plus the standard
 *                     library — the natural ground truth for "this is a Julia stdlib name", and the
 *                     basis JUL-D8 says a CHECKABLE external claim would need;
 *   nowhere           nothing in any of the 14 projects declares it.
 * The split is per TYPE, because `calls` and `uses` do not fail the same way.
 */
type UnresAudit = { bare: number; dotted: number; anotherProject: number; rootInStdlib: number; rootElsewhere: number; targetElsewhereOnly: number; nowhere: number; names: Map<string, number>;
  /** the stdlib-root class split by the YAML REVERSE CHECK: does the edge's OWN project declare
   *  ANY key whose leaf equals this target's leaf? A project that declares `Other.show` and is
   *  handed a claim that bare `show` is external is exactly where a verified column hides a false
   *  claim — so this class is counted and EXCLUDED from what a basis may confirm. */
  stdlibSafe: number; stdlibLeafRisk: number; stdlibRootRisk: number; roots: Set<string>;
  /** THE NOWHERE CLASS, SUB-CLASSIFIED — the largest unresolved class gets a cause rather than a
   *  label. A name can be absent from every project's key space and still be perfectly explicable:
   *  it is called through a LOCAL BINDING (a parameter or local callable — the repo's standing
   *  negative contract says a binding is not a declaration), or it is a name the stdlib repo
   *  CALLS without DECLARING (Julia's Core builtins, which live in C and the bootstrap rather
   *  than in any .jl file the corpus contains). */
  nowhereLocalBinding: number; nowhereBindingSameFile: number; nowhereCalledInStdlib: number; nowhereDotted: number; nowhereOther: number;
  /** the case that would have made the SAME-FILE count non-zero, printed as examples — §6.11 asks
   *  for the input that would fire the check, not for a zero that reads as a property. */
  bindingSameFileExamples: string[];
  nowhereNames: Map<string, number> }
const unresolvedAudit: Record<string, UnresAudit> = {}
const unresOf = (ty: string): UnresAudit => {
  let a = unresolvedAudit[ty]
  if (!a) { a = { bare: 0, dotted: 0, anotherProject: 0, rootInStdlib: 0, rootElsewhere: 0, targetElsewhereOnly: 0, nowhere: 0, names: new Map(), stdlibSafe: 0, stdlibLeafRisk: 0, stdlibRootRisk: 0, roots: new Set<string>(), nowhereLocalBinding: 0, nowhereBindingSameFile: 0, nowhereCalledInStdlib: 0, nowhereDotted: 0, nowhereOther: 0, bindingSameFileExamples: [], nowhereNames: new Map() }; unresolvedAudit[ty] = a }
  return a
}
const symKinds = new Map<string, number>()
const badKind: { name: string; file: string }[] = []
const emptyNames: { name: string; file: string }[] = []
const resolvedUnknown: { name: string; file: string }[] = []
const unresolvedUnknown: { name: string; file: string }[] = []
const syntheticSrc = new Map<string, number>()
const resolveStats = new Map<string, { edges: number; both: number; srcOnly: number; tgtOnly: number; neither: number }>()
/**
 * PER FILE, name -> the kinds published under it.
 *
 * This is the table the incoming-edge question is actually about, and the first version of this
 * census did not have it: it kept ONE union `Set` of every name in the corpus and asked "is this
 * endpoint in the set". That answers a question nobody asked — it is not the per-file resolution a
 * consumer of one file's graph sees, and it silently hides the case that matters, which is a name
 * published TWICE in one file under two kinds. `bb_impact` reaches a declaration by matching an edge
 * target against the symbol table, so "which of these two" is a real question with a real answer
 * cost. The per-file map is what answers it.
 */
const fileSyms = new Map<string, Map<string, string[]>>()
const corpusNames = new Set<string>()
/** Every endpoint classification, per type. See `EndpointClass` for what each bucket claims. */
type EndpointClass = "in-file-unique" | "in-file-ambiguous-disambiguated" | "in-file-ambiguous-residual" | "foreign-ccall" | "external-by-import" | "corpus-only" | "local-binding" | "unresolvable" | "synthetic-scope"

/**
 * The kind a relationship's TARGET must have, decided by the relationship's OWN metadata.
 *
 * This is the disambiguator for julia's dominant ambiguity, and it is not a heuristic — it falls out
 * of what the node kinds MEAN and out of facts the analyzer already asserts on the edge. In julia
 * `struct Object … end` plus `Object() = …` is ONE binding: the type name IS the constructor, so the
 * analyzer publishes `class:Object` and `function:Object` side by side and an edge whose target is
 * that bare name names two symbols. But the edge knows which one it means, and it says so:
 *
 *   `isTypeConstruction` on an `instantiates`  -> the TYPE      -> `class`
 *   `isTypeReference`  on a `references`        -> the TYPE      -> `class`
 *   `isFieldRead`      on a `uses`              -> the FIELD     -> `property`
 *   `isMacroCall`      on a `calls`             -> the MACRO     -> `macro`, else `function`
 *   `isSubtype`        on an `extends`          -> `class` or `interface` (an `abstract type` is
 *                                                 published as `interface`, not `class`)
 *
 * So the edge ALREADY carries enough to disambiguate, in `metadata`, and the count of edges where it
 * does not is the number worth publishing. A `calls` edge with no `isMacroCall` implies `function`
 * alone, which is why `lock` (function + macro in `julia/base/lock.jl`) is disambiguated while the
 * first version of this table — which keyed `calls -> [function, macro]` — called it residual.
 *
 * `contains` has no implied kind and is NOT a defect: its SOURCE is the owning declaration, so
 * `Owner -contains-> field` names exactly one member and both-ends resolution for `contains` is 99.9%.
 * `overrides` points at a name that may have several METHODS of it; `metadata.signature` and
 * `metadata.replacesLine` identify which, and the same-kind-multiplicity case is counted separately
 * below rather than folded into the cross-kind one.
 */
function impliedTargetKinds(type: string, md: Record<string, unknown>): string[] {
  switch (type) {
    case "instantiates": return ["class"]
    case "extends": return ["class", "interface"]
    case "calls": return md.isMacroCall === true ? ["macro"] : ["function"]
    case "references": return md.isTypeReference === true ? ["class"] : []
    case "uses": return md.isFieldRead === true ? ["property"] : []
    case "overrides": return ["function", "macro"]
    default: return []
  }
}
const incoming = new Map<string, { tgt: Map<EndpointClass, number>; src: Map<EndpointClass, number> }>()
/** Ambiguous target names, per type: name -> how many edges point at it, and the kinds behind it. */
const ambiguous = new Map<string, Map<string, { edges: number; kinds: Set<string>; where: Set<string>; symbols: number; sameKind: boolean }>>()
/** How many of a multi-symbol edge's targets the edge's OWN metadata picks out, per bucket. */
const ambVerdict = new Map<string, number>()
/** How many edges target a name published under more than one kind, per type — the DENOMINATOR. */
const multiTotal = new Map<string, number>()
/** Same question asked CORPUS-WIDE rather than in-file: an edge whose target name is published
 *  more than once anywhere in the corpus. A superset of `multiTotal`, and the difference between
 *  them is the count of edges whose target is ambiguous somewhere but not in this file. */
const multiTotalCorpusWide = new Map<string, number>()
/** The kinds the edge type implies, recorded so the number above is auditable and not a verdict. */
const ambImplied = new Map<string, string>()
let totalSymbols = 0
let totalRels = 0
let filesWithZeroSymbols = 0
const zeroSymbolFiles: string[] = []
const parseFailures: string[] = []

/**
 * DEGRADED FILES, BY NAME AND BY CAUSE.
 *
 * `parseFile` returns `fallback: true` from FOUR different places (`src/ast/pool-worker.ts`:
 * `:390` is `extractFallback`'s own return, reached from the >5 MB skip at `:792`, from the
 * 1–5 MB structural read at `:811`, and from BOTH branches of the wasm-parse catch at
 * `:1234`/`:1236`). The previous version of this census counted them in one integer and printed
 * the label "files routed to the >1 MB structural fallback", which is wrong for three of the four:
 * a file that is 15 KB and whose wasm parse threw `memory access out of bounds` is not a size
 * case, and on 2026-10-04 that is exactly what the count contained —
 * `julia/stdlib/LibGit2/src/remote.jl`, 15,857 bytes.
 *
 * A count that cannot be attributed is not evidence, and this lane quotes file paths. So each
 * degraded file is now named and bucketed by the cause that is decidable from what `parseFile`
 * returned plus the file's own size, and the buckets are printed. `wasmParseThrew` is the bucket
 * that matters: it is the one whose file ALSO arms the orphaned self-destruct timer in
 * `src/ast/engine.ts:1441-1447`, so it is the bucket that kills a gate 120 s later naming a file
 * that had already finished failing (§8 rows 1 and 7).
 *
 * It is also the bucket that makes this census's totals a MOVING population: the loop below
 * `continue`s on a degraded file, so its symbols and edges are absent from every total while
 * `admitted files` still prints 1,985. `analysedFiles` is now printed next to it so the two can
 * never be read as one number.
 */
type Degraded = { file: string; bytes: number; cause: "over-5MB-skipped" | "size-1-to-5MB-structural" | "wasmParseThrew" }
const degradedFiles: Degraded[] = []
const fallbackFiles = () => degradedFiles.length
const causeOf = (bytes: number): Degraded["cause"] =>
  bytes > 5 * 1024 * 1024 ? "over-5MB-skipped" : bytes > 1024 * 1024 ? "size-1-to-5MB-structural" : "wasmParseThrew"

const get = (t: string): RelRow => {
  let r = rel.get(t)
  if (!r) {
    r = { n: 0, files: new Set<string>(), conf: new Map(), evidence: new Map() }
    rel.set(t, r)
  }
  return r
}

/**
 * PHASE ONE — parse, and record each file's OWN symbol table plus its raw relationship rows.
 *
 * Two phases, and the reason is determinism. Classifying an endpoint needs to know whether the name
 * is declared ANYWHERE in the corpus, and the first version of this census answered that from a set
 * filled in as four workers happened to walk past it — so the same file could classify as
 * `corpus-only` on one run and `unresolvable` on another depending on scheduling. A number that
 * moves with the scheduler is not a measurement. So phase one collects and phase two, single
 * threaded, classifies with the corpus table already complete.
 */
type FileResult = { label: string; local: Map<string, string[]>; qual: Map<string, string[]>; rows: any[] }
const results: (FileResult | null)[] = new Array(files.length).fill(null)

async function censusWorker() {
  while (true) {
    const i = censusIdx++
    if (i >= files.length) return
    const f = files[i]
    const label = `${f.repo}/${f.rel}`
    let r: any
    try {
      r = await parseFile(f.abs, f.dir)
    } catch {
      parseFailures.push(label)
      continue
    }
    if (r?.fallback) {
      degradedFiles.push({ file: label, bytes: f.bytes, cause: causeOf(f.bytes) })
      continue
    }
    const syms = r?.symbols ?? []
    totalSymbols += syms.length
    if (syms.length === 0) {
      filesWithZeroSymbols++
      if (zeroSymbolFiles.length < 12) zeroSymbolFiles.push(label)
    }
    // The file's OWN symbol table, name -> every kind published under it. Built before any
    // relationship is classified, because an endpoint has to be resolved against the file that
    // declares it — that is the resolution a per-file analyzer can actually promise, and it is also
    // where a name published twice under two kinds becomes visible instead of being merged.
    const local = new Map<string, string[]>()
    for (const s of syms) {
      const k = String((s as any).kind ?? "")
      const nm = String((s as any).name ?? "")
      symKinds.set(k, (symKinds.get(k) ?? 0) + 1)
      if (!k || k === "unknown" || k === "undefined") badKind.push({ name: nm, file: label })
      if (!nm.trim()) emptyNames.push({ name: nm, file: label })
      const kinds = local.get(nm) ?? []
      kinds.push(k || "<empty>")
      local.set(nm, kinds)
      // `140be2f01` audit: a colon in a symbol NAME is what made the indexer's contains dedup guard
      // miss, so the population at risk is counted here rather than assumed away.
      colonAudit.symbols++
      if (nm.includes(":")) {
        colonAudit.colonNamed++
        const owns = String((s as any).ownerName ?? "")
        if (owns) {
          colonAudit.colonNamedOwned++
          if (colonAudit.examples.length < 6) colonAudit.examples.push(`${label}: ${owns} -> ${nm}`)
        }
      }
    }
    fileSyms.set(label, local)
    // name -> the qualifiedNames this file publishes for it (`owner.name`), which is what the
    // own-key ceiling below needs: "the file declares this name, and the key it published is unique
    // in the project" is a per-file fact, unlike the project-wide question it is standing in for.
    const qual = new Map<string, string[]>()
    let pk = projKeys.get(f.repo)
    if (!pk) { pk = new Map<string, number>(); projKeys.set(f.repo, pk) }
    for (const s of syms) {
      const nm = String((s as any).name ?? "")
      if (nm) pk.set(nm, (pk.get(nm) ?? 0) + 1)
      // THE `module` BLOCKS THIS FILE DECLARES, for the one-region falsifier: a file that opens
      // `module A … end` means its file-scope declarations may belong to A rather than to the package.
      if (String((s as any).kind ?? "") === "module" && nm) {
        const fm = fileModules.get(f.repo) ?? new Map<string, Set<string>>()
        const set = fm.get(String(f.rel ?? "")) ?? new Set<string>()
        set.add(nm)
        fm.set(String(f.rel ?? ""), set)
        fileModules.set(f.repo, fm)
      }
      const q = String((s as any).qualifiedName ?? "")
      if (q && q !== nm) {
        pk.set(q, (pk.get(q) ?? 0) + 1)
        const qs = qual.get(nm) ?? []
        qs.push(q)
        qual.set(nm, qs)
      }
      // THE BINDING KEY — what julia's method table is keyed by: one entry per (name, signature),
      // and a declaration written `Base.show` and one written `show` inside `module Base` are the
      // SAME binding. A KEY therefore answers to one or more BINDING keys, and the method-table
      // ceiling is the set of ambiguous edges whose key answers to exactly ONE of them.
      // candidate indexes (see pkCands/pooledCands)
      {
        const fileOf = String(f.rel ?? f.path ?? "")
        let pc = pkCands.get(f.repo)
        if (!pc) { pc = new Map(); pkCands.set(f.repo, pc) }
        const scopeOf = q && q.endsWith(`.${nm}`) ? q.slice(0, q.length - nm.length - 1) : ""
        for (const k of [nm, q]) {
          if (!k) continue
          const list = pc.get(k) ?? []
          list.push({ file: fileOf, scope: scopeOf })
          pc.set(k, list)
          let pm = pooledCands.get(k)
          if (!pm) { pm = new Map(); pooledCands.set(k, pm) }
          pm.set(f.repo, (pm.get(f.repo) ?? 0) + 1)
        }
      }
      const bindKey = q || nm
      let pb = pkBindings.get(f.repo)
      if (!pb) { pb = new Map<string, Set<string>>(); pkBindings.set(f.repo, pb) }
      for (const k of [nm, q]) {
        if (!k) continue
        const set = pb.get(k) ?? new Set<string>()
        set.add(bindKey)
        pb.set(k, set)
      }
    }
    for (const nm of local.keys()) corpusNames.add(nm)
    results[i] = { label, local, qual, rows: (r?.relationships ?? []) as any[] }
  }
}
let censusIdx = 0
await Promise.all(Array.from({ length: WORKERS }, () => censusWorker()))
/**
 * CORPUS-WIDE AND STDLIB KEY SPACES, built after phase one so the unresolved split can ask about
 * every project at once. `juliaKeys` is the corpus's `julia` repository — Base plus the standard
 * library — which is what makes "this name is a Julia stdlib name" a CHECKABLE statement rather
 * than an assertion by the lane that wants the claim.
 */
const corpusKeys = new Map<string, Set<string>>()
for (const [repo, m] of projKeys) for (const k of m.keys()) {
  const set = corpusKeys.get(k) ?? new Set<string>()
  set.add(repo)
  corpusKeys.set(k, set)
}
const juliaKeys = projKeys.get("julia") ?? new Map<string, number>()
/**
 * LEAF-REDUCED KEY SPACES — the arbiter's own inputs, for two questions at once.
 *
 * `leafOf` strips a qualifier, so `Base.show` reduces to `show`. That is what makes the STDlib
 * SURFACE re-derivable by the arbiter: the surface is "every name the corpus's `julia` repository
 * declares", a fact about the corpus rather than a list the claimant supplies. And it is what makes
 * the YAML REVERSE CHECK possible: a project that declares `Other.show` and is handed a claim that
 * bare `show` is external is a FALSE claim in a verified column — `extFAIL` cannot see it, because
 * the gate only reads a claim where the target is already absent.
 */
const leafOf = (k: string): string => (k.includes(".") ? k.slice(k.lastIndexOf(".") + 1) : k)
const leafKeysByRepo = new Map<string, Set<string>>()
for (const [repo, m] of projKeys) {
  const set = new Set<string>()
  for (const k of m.keys()) set.add(leafOf(k))
  leafKeysByRepo.set(repo, set)
}
/** the stdlib surface as the ARBITER derives it: the corpus's julia repository, leaf-reduced */
const stdlibSurface = leafKeysByRepo.get("julia") ?? new Set<string>()
/**
 * THE TWO EVIDENCE SETS THE `nowhere` CLASS IS JUDGED AGAINST — both derived from the same walk, so
 * neither is an assumption about the language:
 *   localBindingNames  every name introduced as a PARAMETER, loop, let, catch or destructuring
 *                      binding anywhere in the corpus. A call through one of these is a call through
 *                      a VALUE, and no name-keyed graph can resolve it — that is a property of the
 *                      resolution model, not a defect, and it has to be counted to say so.
 *   calledInStdlib     every name the corpus's `julia` repository CALLS. A name that the stdlib CALLS
 *                      but never DECLARES is a Core builtin or bootstrap name (`isa`, `throw`,
 *                      `Type`), which is why deriving the stdlib surface from `.jl` declarations
 *                      alone can miss it — the bound on JUL-D13's price, measured rather than
 *                      assumed.
 */
const localBindingNames = new Set<string>()
for (const set of localBindingsByFile.values()) for (const n of set) localBindingNames.add(n)
const calledInStdlib = new Set<string>()
for (const res of results) {
  if (!res || res.label.slice(0, res.label.indexOf("/")) !== "julia") continue
  for (const x of res.rows as any[]) {
    if (String(x?.type ?? x?.relationshipType ?? "").toLowerCase() !== "calls") continue
    const t = String(x?.target ?? "")
    if (t) calledInStdlib.add(t)
  }
}

/**
 * PHASE TWO — classify every endpoint, single threaded, against the completed corpus table.
 */
const order: EndpointClass[] = ["in-file-unique", "in-file-ambiguous-disambiguated", "in-file-ambiguous-residual", "foreign-ccall", "external-by-import", "corpus-only", "local-binding", "unresolvable", "synthetic-scope"]
/**
 * THE `calls` SPLIT — the question the fleet's next `calls` step turns on, measured on this same
 * walk instead of guessed from a sample. `calls` is 51.8% of every edge this lane emits, so its
 * residual is the largest single bucket, and the fix depends entirely on WHICH of three shapes the
 * ambiguous edges are:
 *
 *   shape            the callee as WRITTEN — a bare identifier, or a dotted path (`Base.show`).
 *                    A dotted callee carries a receiver the analyzer already resolves through
 *                    `fieldPath`, so its shape is not the question; a BARE one is the shape an
 *                    owner-qualification fix could act on.
 *   own file         whether the target is declared in the edge's OWN file. An edge whose target is
 *                    declared nowhere in its file cannot be a lexical choice inside that file —
 *                    the lua lane measured 70% of its `calls` ambiguity on exactly this shape, and
 *                    the fix for it is not the same as for a same-file collision.
 *   scope key        whether the project publishes `enclosing scope + "." + target` as a UNIQUE key.
 *                    That is the ceiling of an owner-qualification fix — the edge's own source is
 *                    the scope, so the key is derivable per-file — and a ceiling is what has to be
 *                    measured BEFORE the fix is written, not after.
 *
 * Buckets use the gate's own rule: a target is RESOLVED at exactly one project-scope declaration,
 * AMBIGUOUS at more than one, UNRESOLVED at none. If this table's totals disagree with the gate's
 * TABLE 1, that disagreement is itself a finding and is printed beside them.
 */
type CallsBucket = { resolved: number; amb: number; unres: number }
const callsShape: Record<string, CallsBucket> = {
  bare: { resolved: 0, amb: 0, unres: 0 },
  dotted: { resolved: 0, amb: 0, unres: 0 },
}
const callsSplit = {
  bindingCollapsible: 0,
  ambOwnFile: 0, ambOtherFile: 0, ambScopeKeyUnique: 0,
  ambDottedRootInProject: 0, ambDottedRootAbsent: 0,
  unresOwnFile: 0, unresDottedRootInProject: 0, unresDottedRootAbsent: 0,
}
const repoOfLabel = (l: string): string => { const i = l.indexOf("/"); return i < 0 ? l : l.slice(0, i) }
/**
 * THE METHOD-TABLE TEST, in the gate's own columns: an AMBIGUOUS edge is collapsible when every
 * declaration its key answers to belongs to ONE binding (`Base.show` written that way and `show`
 * written inside `module Base` are one entry in julia's method table). Those edges would move
 * `amb(decl)` -> `resolved` under a project-scoped method-table pass; an edge whose candidates span
 * two bindings would not, and neither would any UNRESOLVED edge, whose target names nothing.
 */
/**
 * B1 one FILE, more than one scope — the model HAD the enclosing declaration and threw it away.
 * B2 more than one file, all inside the edge's own PROJECT — repair needs a project-scoped pass.
 * B3b one file, ONE scope: the same spelling declared twice with nothing to tell them apart.
 * "?" no candidates found in the project (the edge is ambiguous for a reason this index lost).
 */
const ambClass = (repo: string, key: string, edgeFile: string): "B1" | "B2" | "B3b" | "?" => {
  const cands = pkCands.get(repo)?.get(key)
  if (!cands || cands.length === 0) return "?"
  const files = new Set(cands.map((c) => c.file))
  if (files.size === 1) return new Set(cands.map((c) => c.scope)).size > 1 ? "B1" : "B3b"
  void edgeFile
  return "B2"
}
/** Does the SAME key also exist in ANOTHER project? Then a pooled instrument calls the edge
 *  ambiguous where production resolves it — the pooled-only class, counted so it can be excluded. */
const crossProjectKey = (repo: string, key: string): boolean => {
  const m = pooledCands.get(key)
  return !!m && m.size > 1 && m.has(repo)
}
const ambClassCounts: Record<string, Record<string, number>> = {}
const ambCrossProject: Record<string, number> = {}
const collClassCounts: Record<string, Record<string, number>> = {}
const collCrossProject: Record<string, number> = {}
const collKindCounts: Record<string, Record<string, number>> = {}
const bump = (tbl: Record<string, Record<string, number>>, t: string, k: string) => {
  const row = tbl[t] ?? (tbl[t] = {})
  row[k] = (row[k] ?? 0) + 1
}
/** One call per ambiguous edge: its class, whether it is cross-project at all, and the same two
 *  facts restricted to the METHOD-TABLE-COLLAPSIBLE subset (the lever this lane priced). */
const noteAmb = (t: string, repo: string, key: string, file: string, collapsible: boolean): void => {
  bump(ambClassCounts, t, ambClass(repo, key, file))
  if (crossProjectKey(repo, key)) ambCrossProject[t] = (ambCrossProject[t] ?? 0) + 1
  if (collapsible) {
    bump(collClassCounts, t, ambClass(repo, key, file))
    if (crossProjectKey(repo, key)) collCrossProject[t] = (collCrossProject[t] ?? 0) + 1
    const k = collapseKind(repo, key)
    bump(collKindCounts, t, k === "qualified" ? "QUALIFIED" : k === "bareOnly" ? "BARE-ONLY" : k === "mixed" ? "MIXED" : "NONE")
    // THE NEXT DISCRIMINATOR for the BARE-ONLY class: file-scope declarations in a julia package
    // are `include`d into ONE module (the package), so several files under one region can be one
    // binding while files under different regions (`src/` vs `test/`) cannot be assumed to be.
    // Region = the first path segment of each candidate's file, relative to its repo.
    if (k === "bareOnly" || k === "mixed") {
      const cands = pkCands.get(repo)?.get(key) ?? []
      const regions = new Set(cands.map((c) => c.file.split("/")[0] ?? ""))
      bump(collKindCounts, t, regions.size <= 1 ? "BARE-ONE-REGION" : "BARE-MULTI-REGION")
      if (regions.size <= 1) {
        // THE FALSIFIER THE LEAD ASKED TO MEASURE FIRST. If a candidate FILE declares a `module`
        // block, its file-scope declarations may belong to THAT module rather than to the package, so
        // qualifying by the package would merge two bindings. Two counts: files carrying a module,
        // and candidate sets whose module names CONFLICT (more than one distinct name).
        const fm = fileModules.get(repo)
        let anyModule = false
        const names = new Set<string>()
        for (const c of cands) {
          const set = fm?.get(c.file)
          if (set && set.size) { anyModule = true; for (const n of set) names.add(n) }
        }
        if (anyModule) bump(collKindCounts, t, "ONE-REGION-FILE-HAS-MODULE")
        else {
          bump(collKindCounts, t, "ONE-REGION-NO-MODULE-ANYWHERE")
          // THE BUILDABLE SUBSET: a julia package `include`s its files into ONE module and the module
          // is named by the repo's root `Project.toml` — which is the `projectRoot` the harness hands
          // the analyzer. A repo with no root Project.toml has no package module to publish, so the
          // rule cannot reach its edges and they must be pre-registered OUT rather than discovered
          // missing afterwards.
          bump(collKindCounts, t, repoHasPackage(repo) ? "ONE-REGION-PKG" : "ONE-REGION-NO-PKG")
        }
        if (names.size > 1) bump(collKindCounts, t, "ONE-REGION-MODULE-NAMES-CONFLICT")
      }
    }
  } else {
    // THE CONTROL: of the ambiguous edges that are NOT collapsible, how many WOULD have been
    // collapsible by name alone? If this is 0 the BARE-ONLY row is a reading, not an absence.
    const set = pkBindings.get(repo)?.get(key)
    if (set && set.size > 1) bump(collKindCounts, t, "CONTROL-multi-binding")
    else if (!set) bump(collKindCounts, t, "CONTROL-no-candidates")
  }
}
/** Does the repo carry a root `Project.toml`? That file's `name` IS the package module a julia
 *  package includes its files into, and it is what the analyzer can read from `projectRoot`. */
const pkgCache = new Map<string, boolean>()
const repoHasPackage = (repo: string): boolean => {
  let v = pkgCache.get(repo)
  if (v === undefined) { v = existsSync(path.join(CR, repo, "Project.toml")); pkgCache.set(repo, v) }
  return v
}
const bindingCollapsible = (repo: string, key: string): boolean => {
  const set = pkBindings.get(repo)?.get(key)
  return !!set && set.size === 1
}
/**
 * THE SOUNDNESS SPLIT OF THE COLLAPSE, because "one binding" has two very different proofs:
 *   QUALIFIED  every candidate answers to ONE NON-EMPTY qualifiedName (`Base.getindex`, `M.f`) —
 *              julia's method table: one generic function, declared in several files. THE LEVER.
 *   BARE-ONLY  every candidate has NO qualifiedName, so the collapse is by NAME ALONE — two
 *              top-level functions that merely share a spelling. NOT a method table, and a fix built
 *              on it would merge two bindings.
 * A control is printed beside them so a zero in either column is readable.
 */
const collapseKind = (repo: string, key: string): "qualified" | "bareOnly" | "mixed" | "none" => {
  const set = pkBindings.get(repo)?.get(key)
  if (!set || set.size !== 1) return "none"
  const bk = [...set][0]!
  if (!bk) return "none"
  // `bindKey = qualifiedName || name`, so a key equal to the bare name means at least one candidate
  // published no qualified name; a key that differs from it is a real scope-qualified binding.
  if (bk !== key) return "qualified"
  const cands = pkCands.get(repo)?.get(key) ?? []
  const scoped = cands.filter((c) => c.scope !== "").length
  if (scoped === 0) return "bareOnly"
  return "mixed"
}
/**
 * THE `references` SPLIT — the same instrument as `calls`, because the type's SHAPE decides whether
 * an in-lane fix exists at all, and the two types look identical until it is measured.
 *
 * `references` is three populations wearing one label, and the marker set separates them:
 * `isTypeReference` (a type named in an annotation or expression), `isQualifiedReference` (a dotted
 * path), and `importForm+isImport` (a name named by an import statement). A fix for one is not a fix
 * for the others, so the split is per MARKER first and per SHAPE second.
 *
 * THREE CEILINGS, each the reach of one candidate rule, and each measured BEFORE the rule is
 * written — the `calls` result was that the programme's most-repeated fix topped out at 0.6% there:
 *   scope key   target the edge's own scope + name (`<source>.<target>` unique in the project)
 *   leaf key    target the last segment of a dotted target (the leaf unique in the project)
 *   own key     target the qualifiedName of the file's OWN declaration of that name
 * The last one is the only rule that can move an edge the WRONG way (a currently-unique bare target
 * replaced by a qualified key that collides), so its table prints both directions: how many
 * ambiguous edges it would resolve, and how many RESOLVED edges it would break.
 */
type RefBucket = { resolved: number; amb: number; unres: number }
const refShape: Record<string, RefBucket> = {
  bare: { resolved: 0, amb: 0, unres: 0 },
  dotted: { resolved: 0, amb: 0, unres: 0 },
}
const refMarker: Record<string, RefBucket> = {}
const refSplit = {
  bindingCollapsible: 0, narrowLeafReach: 0, narrowLeafRepoint: 0,
  ambScopeKeyUnique: 0, ambLeafKeyUnique: 0, ambOwnKeyUnique: 0,
  unresScopeKeyUnique: 0, unresLeafKeyUnique: 0, unresOwnKeyUnique: 0,
  unresDottedRootInProject: 0, unresDottedRootAbsent: 0, unresDottedLeafInProject: 0,
  resolvedWouldBreakUnderOwnRule: 0, resolvedWouldBreakUnderLeafRule: 0,
  ambOwnKeyUniqueStrict: 0, resolvedWouldBreakUnderOwnStrict: 0,
  ambOwnFile: 0, ambOtherFile: 0,
}
const refMarkerOf = (md: Record<string, unknown>): string =>
  md.isQualifiedReference === true ? "isQualifiedReference"
    : md.isTypeReference === true ? "isTypeReference"
      : md.isImport === true ? "isImport"
        : "other"
/**
 * THE `uses` SPLIT — a field-read type with a RECEIVER, which makes it the one type where the
 * `references` own-key rule is NOT automatically transferable.
 *
 * `uses` targets the MEMBER of a `field_expression` — a bare field name — while the declaration it
 * might name belongs to whatever type the receiver holds, and this analyzer does not infer receiver
 * types. So "the file declares `radius` exactly once" does NOT make every `.radius` read in that
 * file a read of it: the same file can read `other.radius` off a foreign struct. That is the reason
 * the ceilings below are measured per MARKER and the silent re-point count is printed beside every
 * candidate rule, on the same principle as `references`' refused leaf key.
 */
type UsesBucket = { resolved: number; amb: number; unres: number }
const usesShape: Record<string, UsesBucket> = {
  bare: { resolved: 0, amb: 0, unres: 0 },
  dotted: { resolved: 0, amb: 0, unres: 0 },
}
const usesMarker: Record<string, UsesBucket> = {}
const usesSplit = {
  bindingCollapsible: 0,
  ambOwnFile: 0, ambOtherFile: 0,
  ambScopeKeyUnique: 0, ambLeafKeyUnique: 0, ambOwnKeyUnique: 0, ambOwnKeyUniqueStrict: 0,
  unresScopeKeyUnique: 0, unresLeafKeyUnique: 0, unresOwnKeyUnique: 0,
  unresolvedBareDeclaredNowhere: 0, unresolvedDottedRootInProject: 0, unresolvedDottedRootAbsent: 0,
  resolvedWouldBreakUnderOwnRule: 0, resolvedWouldBreakUnderOwnStrict: 0, resolvedWouldBreakUnderLeafRule: 0,
  /** how many DISTINCT field names carry a `uses` edge at all — the population a schema-level rule
   *  would have to cover, and the number that says whether this type is name-collision-shaped or
   *  receiver-shaped. */
  distinctTargets: 0,
}
const usesTargets = new Set<string>()
const usesMarkerOf = (md: Record<string, unknown>): string =>
  md.isFieldRead === true ? (md.isOperatorMember === true ? "isFieldRead+isOperatorMember" : "isFieldRead")
    : "other"
/**
 * THE FOUR SMALL TYPES — `instantiates`, `exports`, `extends`, `overrides` — split with the same
 * instrument and the same three ceilings, so clause 2 covers every emitted type rather than every
 * LARGE one. Together they are 8,806 edges. A low ceiling here is a ruling, not a failure: the point
 * is to STATE each candidate rule's reach before writing it, which is what killed the php-shaped fix
 * on three types in a row (`calls` 0.6%, `references` 1.0%, `uses` 1.7%).
 */
type SmallBucket = { resolved: number; amb: number; unres: number }
const SMALL_TYPES = ["instantiates", "exports", "extends", "overrides"] as const
const smallShape: Record<string, Record<string, SmallBucket>> = {}
const smallMarker: Record<string, Record<string, SmallBucket>> = {}
const smallSplit: Record<string, {
  bindingCollapsible: number; narrowLeafReach: number; narrowLeafRepoint: number
  ambOwnFile: number; ambOtherFile: number
  ambScopeKeyUnique: number; ambLeafKeyUnique: number; ambOwnKeyUnique: number; ambOwnKeyUniqueStrict: number
  unresScopeKeyUnique: number; unresLeafKeyUnique: number; unresOwnKeyUnique: number
  unresolvedNothingDeclares: number
  resolvedWouldBreakUnderOwnRule: number; resolvedWouldBreakUnderOwnStrict: number; resolvedWouldBreakUnderLeafRule: number
}> = {}
for (const ty of SMALL_TYPES) {
  smallShape[ty] = { bare: { resolved: 0, amb: 0, unres: 0 }, dotted: { resolved: 0, amb: 0, unres: 0 } }
  smallMarker[ty] = {}
  smallSplit[ty] = {
    ambOwnFile: 0, ambOtherFile: 0,
    ambScopeKeyUnique: 0, ambLeafKeyUnique: 0, ambOwnKeyUnique: 0, ambOwnKeyUniqueStrict: 0,
    unresScopeKeyUnique: 0, unresLeafKeyUnique: 0, unresOwnKeyUnique: 0,
    unresolvedNothingDeclares: 0,
    resolvedWouldBreakUnderOwnRule: 0, resolvedWouldBreakUnderOwnStrict: 0, resolvedWouldBreakUnderLeafRule: 0,
  }
}
const smallMarkerOf = (ty: string, md: Record<string, unknown>): string => {
  if (ty === "instantiates") return md.isTypeConstruction === true ? "isTypeConstruction" : "other"
  if (ty === "exports") return md.exportForm ? "exportForm" : md.declaresNothing === true ? "declaresNothing" : "other"
  if (ty === "extends") return md.isSubtype === true ? (md.isWhereBound === true ? "isSubtype+isWhereBound" : "isSubtype") : "other"
  return md.isMethodRedefinition === true ? "isMethodRedefinition" : "other"
}
/**
 * THE `imports` EXTERNAL CLAIMS — the must-be-zero column, audited edge by edge.
 *
 * `isExternal` is attached to an import as `!name.startsWith(".")`: a claim about the PROJECT read
 * off one target's spelling, by an analyzer that sees one file. The gate reads that claim only where
 * the target names nothing in the project, and then refutes it when the target's OWNER is a project
 * declaration. This block reproduces that classification against the same project key space, so the
 * count it prints as REFUTED must equal the gate's extFAIL column — a cross-check — and then splits
 * it by what an in-lane rule can actually reach.
 */
const importsAudit = {
  total: 0, claimed: 0, claimedBare: 0, claimedDotted: 0, unclaimed: 0,
  handledByDecls: 0, verified: 0, verifiedBare: 0, verifiedDotted: 0,
  refuted: 0, refutedBare: 0, refutedRootOwnFile: 0,
}
for (const res of results) {
  if (!res) continue
  const { label, local, qual, rows } = res
  // The names this file itself imports, read off the TREE (an `identifier` inside an
  // `import_statement`/`using_statement`), not off the text. That is what lets the report separate
  // "external by the file's own declaration" from "we simply never indexed it".
  const imported = importNamesByFile.get(label) ?? new Set<string>()
  const localBound = localBindingsByFile.get(label) ?? new Set<string>()
  for (const x of rows) {
    const t = String(x.type ?? x.relationshipType ?? "").toLowerCase()
    if (!ALL_TYPES.includes(t as Type)) continue
    totalRels++
    const row = get(t)
    row.n++
    row.files.add(label)
    const c = Number(x.confidence ?? 0)
    row.conf.set(c, (row.conf.get(c) ?? 0) + 1)
    const md = (x.metadata ?? {}) as Record<string, unknown>
    const ev = String(md.evidenceClass ?? "<none>")
    row.evidence.set(ev, (row.evidence.get(ev) ?? 0) + 1)
    const src = String(x.source ?? "")
    const tgt = String(x.target ?? "")
    const line = Number(x.line_number ?? 0)
    if (t === "contains" && tgt.includes(":")) colonAudit.containsTargetsWithColon++
    // ---- THE UNRESOLVED SPLIT: is there a candidate anywhere?
    if (tgt) {
      const ownRepo = repoOfLabel(label)
      const pkOwn = projKeys.get(ownRepo)
      if ((pkOwn?.get(tgt) ?? 0) === 0) {
        const a = unresOf(t)
        const dotted = tgt.includes(".")
        if (dotted) a.dotted++; else a.bare++
        const repos = corpusKeys.get(tgt)
        const elsewhere = repos ? [...repos].some((r) => r !== ownRepo) : false
        if (elsewhere) a.anotherProject++
        const root = dotted ? tgt.slice(0, tgt.indexOf(".")) : tgt
        const rootStdlib = juliaKeys.has(root) && !(pkOwn?.has(root))
        const rootElsewhere = !rootStdlib && (corpusKeys.get(root) ?? new Set<string>()).size > 0 && !(pkOwn?.has(root))
        // THE PARTITION MUST CLOSE, and the first version did not: an edge whose FULL target is
        // declared in another project while its ROOT is not (a dotted path like `A.B` where `B` is
        // somebody else's) fell through every branch — 102 edges, found by the instrument's own
        // arithmetic (total minus the printed buckets) rather than by reading it. It has its own
        // bucket now, so the four add up to the total.
        if (rootStdlib) {
          a.rootInStdlib++
          a.roots.add(root)
          // THE REVERSE CHECK, asked of the claim a basis would produce
          const ownLeaves = leafKeysByRepo.get(ownRepo)
          const leaf = leafOf(tgt)
          if (ownLeaves?.has(leaf)) a.stdlibLeafRisk++
          else if (ownLeaves?.has(leafOf(root))) a.stdlibRootRisk++
          else a.stdlibSafe++
        }
        else if (rootElsewhere) a.rootElsewhere++
        else if (elsewhere) a.targetElsewhereOnly++
        else {
          a.nowhere++
          a.nowhereNames.set(tgt, (a.nowhereNames.get(tgt) ?? 0) + 1)
          const leaf = dotted ? tgt.slice(tgt.lastIndexOf(".") + 1) : tgt
          const rootT = dotted ? tgt.slice(0, tgt.indexOf(".")) : tgt
          if (localBindingNames.has(tgt) || localBindingNames.has(leaf)) {
            a.nowhereLocalBinding++
            // THE IMPLEMENTABLE SLICE: the binding is in the EDGE'S OWN FILE, which is the only place
            // a per-file analyzer can prove it. The corpus-wide class is 8,779; this is its ceiling.
            const ownBindings = localBindingsByFile.get(label)
            if (ownBindings?.has(tgt) || ownBindings?.has(leaf)) {
              a.nowhereBindingSameFile++
              if (a.bindingSameFileExamples.length < 6) a.bindingSameFileExamples.push(`${label}: ${t} ${src} -> ${tgt}`)
            }
          }
          else if (calledInStdlib.has(tgt) || calledInStdlib.has(leaf) || calledInStdlib.has(root)) a.nowhereCalledInStdlib++
          else if (dotted) a.nowhereDotted++
          else a.nowhereOther++
        }
        a.names.set(tgt, (a.names.get(tgt) ?? 0) + 1)
      }
    }
    // ---- the `imports` claim audit, classified against the same project key space
    if (t === "imports" && tgt) {
      const pk = projKeys.get(repoOfLabel(label))
      const decls = pk?.get(tgt) ?? 0
      const dotted = tgt.includes(".")
      const owner = dotted ? tgt.slice(0, tgt.lastIndexOf(".")) : ""
      const ownerDecls = owner ? (pk?.get(owner) ?? 0) : 0
      const claimed = (md as any).isExternal === true
      importsAudit.total++
      if (claimed) {
        importsAudit.claimed++
        if (dotted) importsAudit.claimedDotted++; else importsAudit.claimedBare++
      } else importsAudit.unclaimed++
      if (decls > 0) {
        // the claim is NEVER READ here: the edge resolves or is ambiguous
        importsAudit.handledByDecls++
      } else if (claimed) {
        if (dotted && ownerDecls > 0) {
          importsAudit.refuted++
          if (local.has(owner)) importsAudit.refutedRootOwnFile++
        } else {
          importsAudit.verified++
          if (dotted) importsAudit.verifiedDotted++; else importsAudit.verifiedBare++
        }
      }
    }
    // ---- the `uses` split: shape, marker, and the same three candidate-rule ceilings
    if (t === "uses" && tgt) {
      const pk = projKeys.get(repoOfLabel(label))
      const decls = pk?.get(tgt) ?? 0
      const dotted = tgt.includes(".")
      const shape = dotted ? "dotted" : "bare"
      const bucket = decls === 0 ? "unres" : decls === 1 ? "resolved" : "amb"
      usesShape[shape][bucket]++
      usesTargets.add(tgt)
      const mk = usesMarkerOf(md)
      if (!usesMarker[mk]) usesMarker[mk] = { resolved: 0, amb: 0, unres: 0 }
      usesMarker[mk][bucket]++
      const leaf = dotted ? tgt.slice(tgt.lastIndexOf(".") + 1) : tgt
      const rootT = dotted ? tgt.slice(0, tgt.indexOf(".")) : tgt
      const leafUnique = (pk?.get(leaf) ?? 0) === 1
      const scopeUnique = (pk?.get(src ? `${src}.${tgt}` : tgt) ?? 0) === 1
      const ownQuals = qual.get(tgt) ?? []
      const ownUnique = ownQuals.length === 1 && (pk?.get(ownQuals[0]!) ?? 0) === 1
      const ownStrict = (local.get(tgt)?.length ?? 0) === 1 && ownQuals.length === 1 && (pk?.get(ownQuals[0]!) ?? 0) === 1
      if (bucket === "amb") {
        if (local.has(tgt)) usesSplit.ambOwnFile++; else usesSplit.ambOtherFile++
        { const rp = repoOfLabel(label); const cb = bindingCollapsible(rp, tgt); if (cb) usesSplit.bindingCollapsible++; noteAmb("uses", rp, tgt, label, cb) }
        if (scopeUnique) usesSplit.ambScopeKeyUnique++
        if (dotted && leafUnique) usesSplit.ambLeafKeyUnique++
        if (ownUnique) usesSplit.ambOwnKeyUnique++
        if (ownStrict) usesSplit.ambOwnKeyUniqueStrict++
      } else if (bucket === "unres") {
        if (scopeUnique) usesSplit.unresScopeKeyUnique++
        if (dotted && leafUnique) usesSplit.unresLeafKeyUnique++
        if (ownUnique) usesSplit.unresOwnKeyUnique++
        if (dotted) {
          const root = tgt.slice(0, tgt.indexOf("."))
          if ((pk?.get(root) ?? 0) > 0) usesSplit.unresolvedDottedRootInProject++
          else usesSplit.unresolvedDottedRootAbsent++
        } else usesSplit.unresolvedBareDeclaredNowhere++
      } else {
        if (ownUnique) usesSplit.resolvedWouldBreakUnderOwnRule++
        if (ownStrict) usesSplit.resolvedWouldBreakUnderOwnStrict++
        if (dotted && leafUnique) usesSplit.resolvedWouldBreakUnderLeafRule++
      }
    }
    // ---- the `references` split: shape, marker, and the three candidate-rule ceilings
    if (t === "references" && tgt) {
      const pk = projKeys.get(repoOfLabel(label))
      const decls = pk?.get(tgt) ?? 0
      const dotted = tgt.includes(".")
      const shape = dotted ? "dotted" : "bare"
      const bucket = decls === 0 ? "unres" : decls === 1 ? "resolved" : "amb"
      refShape[shape][bucket]++
      const mk = refMarkerOf(md)
      if (!refMarker[mk]) refMarker[mk] = { resolved: 0, amb: 0, unres: 0 }
      refMarker[mk][bucket]++
      const leaf = dotted ? tgt.slice(tgt.lastIndexOf(".") + 1) : tgt
      const rootT = dotted ? tgt.slice(0, tgt.indexOf(".")) : tgt
      const leafUnique = (pk?.get(leaf) ?? 0) === 1
      const scopeUnique = (pk?.get(src ? `${src}.${tgt}` : tgt) ?? 0) === 1
      const ownQuals = qual.get(tgt) ?? []
      const ownUnique = ownQuals.length === 1 && (pk?.get(ownQuals[0]!) ?? 0) === 1
      // THE STRICT CEILING — the analyzer's own guard, which is narrower than the key-space one:
      // it stands down unless the FILE declares the name exactly once, so a struct beside its
      // constructor (two symbols, one alias) is excluded. Measured rather than argued, because the
      // distance between the loose ceiling and what a rule actually reaches is the whole lesson.
      const ownStrict = (local.get(tgt)?.length ?? 0) === 1 && ownQuals.length === 1 && (pk?.get(ownQuals[0]!) ?? 0) === 1
      if (bucket === "amb") {
        if (local.has(tgt)) refSplit.ambOwnFile++; else refSplit.ambOtherFile++
        { const rp = repoOfLabel(label); const cb = bindingCollapsible(rp, tgt); if (cb) refSplit.bindingCollapsible++; noteAmb("references", rp, tgt, label, cb) }
        if (scopeUnique) refSplit.ambScopeKeyUnique++
        if (dotted && leafUnique) refSplit.ambLeafKeyUnique++
        if (ownUnique) refSplit.ambOwnKeyUnique++
        if (ownStrict) refSplit.ambOwnKeyUniqueStrict++
      } else if (bucket === "unres") {
        if (scopeUnique) refSplit.unresScopeKeyUnique++
        if (dotted && leafUnique) {
          refSplit.unresLeafKeyUnique++
          // THE NARROWER RULE: reach the leaf ONLY when a PER-FILE fact supports it — the file
          // declares the leaf, or declares the root. Priced against the same guard on the re-point
          // side, so "does it reach without the 836" becomes a number rather than a hope.
          if (local.has(leaf) || (qual.get(leaf)?.length ?? 0) > 0 || local.has(rootT) || (qual.get(rootT)?.length ?? 0) > 0) refSplit.narrowLeafReach++
        }
        if (ownUnique) refSplit.unresOwnKeyUnique++
        if (dotted) {
          const root = tgt.slice(0, tgt.indexOf("."))
          if ((pk?.get(root) ?? 0) > 0) refSplit.unresDottedRootInProject++
          else refSplit.unresDottedRootAbsent++
          if ((pk?.get(leaf) ?? 0) > 0) refSplit.unresDottedLeafInProject++
        }
      } else {
        // a RESOLVED edge is the one a retargeting rule can BREAK
        if (ownUnique) refSplit.resolvedWouldBreakUnderOwnRule++
        if (ownStrict) refSplit.resolvedWouldBreakUnderOwnStrict++
        if (dotted && leafUnique) {
          refSplit.resolvedWouldBreakUnderLeafRule++
          if (local.has(leaf) || (qual.get(leaf)?.length ?? 0) > 0 || local.has(rootT) || (qual.get(rootT)?.length ?? 0) > 0) refSplit.narrowLeafRepoint++
        }
      }
    }
    // ---- the FOUR SMALL TYPES, same instrument, same three ceilings
    if ((SMALL_TYPES as readonly string[]).includes(t) && tgt) {
      const ty = t as SmallType
      const pk = projKeys.get(repoOfLabel(label))
      const decls = pk?.get(tgt) ?? 0
      const dotted = tgt.includes(".")
      const shape = dotted ? "dotted" : "bare"
      const bucket = decls === 0 ? "unres" : decls === 1 ? "resolved" : "amb"
      smallShape[ty]![shape]![bucket]++
      const mk = smallMarkerOf(ty, md)
      if (!smallMarker[ty]![mk]) smallMarker[ty]![mk] = { resolved: 0, amb: 0, unres: 0 }
      smallMarker[ty]![mk]![bucket]++
      const sp = smallSplit[ty]!
      const leaf = dotted ? tgt.slice(tgt.lastIndexOf(".") + 1) : tgt
      const rootT = dotted ? tgt.slice(0, tgt.indexOf(".")) : tgt
      const leafUnique = (pk?.get(leaf) ?? 0) === 1
      const scopeUnique = (pk?.get(src ? `${src}.${tgt}` : tgt) ?? 0) === 1
      const ownQuals = qual.get(tgt) ?? []
      const ownUnique = ownQuals.length === 1 && (pk?.get(ownQuals[0]!) ?? 0) === 1
      const ownStrict = (local.get(tgt)?.length ?? 0) === 1 && ownQuals.length === 1 && (pk?.get(ownQuals[0]!) ?? 0) === 1
      if (bucket === "amb") {
        if (local.has(tgt)) sp.ambOwnFile++; else sp.ambOtherFile++
        if (scopeUnique) sp.ambScopeKeyUnique++
        if (dotted && leafUnique) sp.ambLeafKeyUnique++
        if (ownUnique) sp.ambOwnKeyUnique++
        if (ownStrict) sp.ambOwnKeyUniqueStrict++
      } else if (bucket === "unres") {
        if (scopeUnique) sp.unresScopeKeyUnique++
        if (dotted && leafUnique) sp.unresLeafKeyUnique++
        if (ownUnique) sp.unresOwnKeyUnique++
        sp.unresolvedNothingDeclares++
      } else {
        if (ownUnique) sp.resolvedWouldBreakUnderOwnRule++
        if (ownStrict) sp.resolvedWouldBreakUnderOwnStrict++
        if (dotted && leafUnique) sp.resolvedWouldBreakUnderLeafRule++
      }
    }
    // ---- the `calls` split, classified against the project key space built in phase one
    if (t === "calls" && tgt) {
      const pk = projKeys.get(repoOfLabel(label))
      const decls = pk?.get(tgt) ?? 0
      const shape = tgt.includes(".") ? "dotted" : "bare"
      const bucket = decls === 0 ? "unres" : decls === 1 ? "resolved" : "amb"
      callsShape[shape][bucket]++
      const ownFile = local.has(tgt)
      const root = shape === "dotted" ? tgt.slice(0, tgt.indexOf(".")) : ""
      const rootInProject = root !== "" && (pk?.get(root) ?? 0) > 0
      if (bucket === "amb") {
        if (ownFile) callsSplit.ambOwnFile++
        else callsSplit.ambOtherFile++
        // the ceiling of an owner-qualification fix: `source.target` is a key the project publishes
        // exactly once, so an edge targeting it would resolve instead of choosing between namesakes
        { const rp = repoOfLabel(label); const cb = bindingCollapsible(rp, tgt); if (cb) callsSplit.bindingCollapsible++; noteAmb("calls", rp, tgt, label, cb) }
        if ((pk?.get(src ? `${src}.${tgt}` : tgt) ?? 0) === 1) callsSplit.ambScopeKeyUnique++
        if (shape === "dotted") { if (rootInProject) callsSplit.ambDottedRootInProject++; else callsSplit.ambDottedRootAbsent++ }
      } else if (bucket === "unres") {
        if (ownFile) callsSplit.unresOwnFile++
        if (shape === "dotted") { if (rootInProject) callsSplit.unresDottedRootInProject++; else callsSplit.unresDottedRootAbsent++ }
      }
    }
    // An endpoint equal to the literal `unknown` is counted in TWO buckets, because in julia it
    // is not necessarily a sentinel at all. `julia/JuliaLowering/src/validation.jl:22` declares
    // `unknown() = ValidationResult(false, nothing)` — a real zero-argument function whose name
    // collides with the placeholder this codebase uses — and it is called 10 times in that file.
    // A single bucket would report 11 defects where there are 0, so the split is: does a symbol
    // of that name EXIST in this file's production output. The reason it does not resolve is a
    // SHARED-file defect, not a julia one: `keepSymbol`'s UNIVERSAL denylist
    // (`src/ast/pool-worker.ts:452`) carries "unknown" and drops the declaration for every
    // language, while `analyze()` publishes it (93 symbols vs the 90 that survive `parseFile`).
    // The `unresolvedUnknown` column is that defect, counted; it is not this lane's to fix (§8).
    for (const ep of [src, tgt]) {
      if (ep !== "unknown") continue
      ;(local.has(ep) ? resolvedUnknown : unresolvedUnknown).push({ name: ep, file: label })
    }
    // `global` and `root` are this repo's documented synthetic scope names (GLOBAL_SCOPE in
    // real-julia-analyzer.ts, and the literal the import case writes). Neither is a declared symbol
    // in any file, so both are dangling endpoints and are counted as such — a resolution rate that
    // excluded them would not be the number a consumer sees.
    if (src === "global" || src === "root") syntheticSrc.set(`${t}|${src}`, (syntheticSrc.get(`${t}|${src}`) ?? 0) + 1)

    // ---- the incoming-edge question: can the graph WALK TO this edge's other end?
    //
    // Seven buckets, and the split between the last four is the whole deliverable. An endpoint that
    // resolves to nothing is, to a reverse walk, indistinguishable from a declaration that was never
    // indexed; those are opposite findings and this table refuses to merge them.
    const classify = (ep: string): EndpointClass => {
      if (ep === "global" || ep === "root") return "synthetic-scope"
      const kinds = local.get(ep)
      if (kinds) {
        if (kinds.length === 1) return "in-file-unique"
        const implied = impliedTargetKinds(t, md)
        // Count CANDIDATE SYMBOLS, not distinct kinds. `uses -> val` where five structs each declare
        // a field `val` gives five `property` candidates; a filter on kinds keeps one distinct kind
        // and calls it disambiguated, which is exactly backwards — knowing the edge is a field read
        // does not say WHICH field. Counting the array rather than its distinct set is what makes
        // "the metadata picks it out" mean the metadata identifies ONE declaration.
        const matching = kinds.filter((k) => implied.includes(k))
        return matching.length === 1 ? "in-file-ambiguous-disambiguated" : "in-file-ambiguous-residual"
      }
      // A `ccall` target is a C symbol by the file's OWN declaration: the analyzer marks the edge
      // `isForeignCall` and names the symbol and library, so this is asserted, not inferred.
      if (md.isForeignCall === true && ep === String(md.foreignSymbol ?? ep)) return "foreign-ccall"
      // A QUALIFIED path whose root segment is named by an `import`/`using` in THIS file is external
      // by declaration: `Base.println` in a file that says `using Base` is a dependency on another
      // module, not a declaration this index lost. An UNQUALIFIED name is deliberately NOT given
      // this bucket — `using Base` makes every bare call in the file a Base call, and reading it
      // that way would relabel the whole file's callees as external and hide the ones that are not.
      const segs = pathSegments(ep)
      if (segs && imported.has(segs[0]!)) return "external-by-import"
      // Bound in THIS file and deliberately not published: a parameter, a loop variable, a `let`
      // binding, a catch variable. Unresolvable by design, not a lost declaration.
      //
      // This test comes BEFORE the corpus-wide one, and the order is load-bearing rather than
      // arbitrary. `obj` is a field name in some struct somewhere in this corpus, so a first
      // version that asked "is `obj` declared anywhere?" first reported 2 local bindings out of
      // 1,543 call targets — the corpus-wide table swallowed almost every one of them and the
      // bucket read as empty. An edge that reads THIS file's parameter is a fact about this file,
      // and a declaration in another file is not a better answer to it.
      if (localBound.has(ep)) return "local-binding"
      if (corpusNames.has(ep)) return "corpus-only"
      return "unresolvable"
    }
    const slot = incoming.get(t) ?? { tgt: new Map(), src: new Map() }
    incoming.set(t, slot)
    const tc = classify(tgt)
    slot.tgt.set(tc, (slot.tgt.get(tc) ?? 0) + 1)
    const sc = classify(src)
    slot.src.set(sc, (slot.src.get(sc) ?? 0) + 1)
    const candKinds = local.get(tgt)
    if (candKinds && candKinds.length > 1) {
      const implied = impliedTargetKinds(t, md)
      const matching = candKinds.filter((k) => implied.includes(k))
      // The DENOMINATOR is counted here, separately. A first version reused the "picked out" counter
      // as the total, and `contains` — whose implied kind is empty, so nothing is ever picked out —
      // reported 0 multi-symbol edges while the INCOMING table above it reported 2,687. Two tables,
      // one run, different answers, and the one that read as a clean bill of health was the wrong
      // one: a type with NO disambiguator scored better than a type with a partial one.
      //
      // THE THIRD VERSION OF THIS DEFECT, and the one the corpus growth exposed. `candKinds` is the
      // number of published symbols for that name CORPUS-WIDE, while `tc` — the bucket — is decided
      // IN THIS FILE. An edge whose target is published in two different files is corpus-wide
      // multi-symbol but in-file unique, so it landed in `corpus-only` and was counted by the
      // denominator and by neither ambiguous bucket. The table then had a denominator and a
      // numerator drawn from two different populations and its rate was not a rate: over 1,985
      // files `uses` read 2,244/334 where the buckets said 2,240 and `contains` read 3,683 where the
      // buckets said 3,681 — the table's own rows exceeded the INCOMING table's rows by 6 while both
      // were described as the same edges. The denominator is now taken from the SAME classifier as
      // the numerator, and the corpus-wide count is kept as its own column rather than dropped,
      // because it is a true number about a different question and the gap between them is what
      // makes the difference legible.
      if (tc === "in-file-ambiguous-disambiguated" || tc === "in-file-ambiguous-residual") {
        multiTotal.set(t, (multiTotal.get(t) ?? 0) + 1)
      }
      multiTotalCorpusWide.set(t, (multiTotalCorpusWide.get(t) ?? 0) + 1)
      if (tc === "in-file-ambiguous-disambiguated" || tc === "in-file-ambiguous-residual") {
        const matching = candKinds.filter((k) => implied.includes(k))
        ambVerdict.set(`${t}|${tc}`, (ambVerdict.get(`${t}|${tc}`) ?? 0) + (matching.length === 1 ? 1 : 0))
        ambImplied.set(`${t}|${tc}`, implied.join("|") || "<none>")
      }
    }
    if (tc === "in-file-ambiguous-disambiguated" || tc === "in-file-ambiguous-residual") {
      const byType = ambiguous.get(t) ?? new Map()
      ambiguous.set(t, byType)
      const rec = byType.get(tgt) ?? {
        edges: 0, kinds: new Set<string>(), where: new Set<string>(), symbols: 0, sameKind: true,
      }
      rec.edges++
      rec.symbols = local.get(tgt)!.length
      for (const k of new Set(local.get(tgt)!)) rec.kinds.add(k)
      if (rec.kinds.size > 1) rec.sameKind = false
      if (rec.where.size < 3) rec.where.add(`${label}:${line}`)
      byType.set(tgt, rec)
    }

    const st = resolveStats.get(t) ?? { edges: 0, both: 0, srcOnly: 0, tgtOnly: 0, neither: 0 }
    st.edges++
    const so = local.has(src)
    const to = local.has(tgt)
    if (so && to) st.both++
    else if (so) st.srcOnly++
    else if (to) st.tgtOnly++
    else st.neither++
    resolveStats.set(t, st)
  }
}


console.log(`PRODUCTION PATH — parseFile() from src/ast/pool-worker.ts over ${files.length} files`)
console.log(`symbols: ${totalSymbols.toLocaleString()}   relationships in the 10 ontology types: ${totalRels.toLocaleString()}`)
console.log(
  `files ANALYSED: ${files.length - degradedFiles.length} of ${files.length} admitted   ` +
    `files yielding ZERO symbols: ${filesWithZeroSymbols}   parseFile threw: ${parseFailures.length}`,
)
console.log(`DEGRADED (parseFile returned fallback:true — its symbols and edges are in NEITHER total above): ${degradedFiles.length}`)
if (degradedFiles.length === 0) {
  console.log(`  none. Every one of the ${files.length} admitted files produced a real tree, so the totals above are a whole-population measurement.`)
} else {
  const byCause = new Map<string, string[]>()
  for (const d of degradedFiles) {
    const arr = byCause.get(d.cause) ?? []
    arr.push(`${d.file} (${d.bytes.toLocaleString()}B)`)
    byCause.set(d.cause, arr)
  }
  for (const [cause, list] of byCause) {
    console.log(`  ${cause}: ${list.length}`)
    for (const f of list.slice(0, 12)) console.log(`      ${f}`)
    if (list.length > 12) console.log(`      …and ${list.length - 12} more`)
  }
  console.log(
    `  READ THIS BEFORE QUOTING THE TOTALS: they are measured over ${files.length - degradedFiles.length} files, not ${files.length}. ` +
      `A file whose wasm parse threw is absent from every per-type row above while \`admitted files\` still prints ${files.length}. ` +
      `The old label for this counter said ">1 MB structural fallback", which is wrong for a \`wasmParseThrew\` file: ` +
      `pool-worker.ts sets fallback:true from :390 (extractFallback), reached at :792 (>5MB), :811 (1-5MB) and :1234/:1236 (the wasm catch).`,
  )
}
if (zeroSymbolFiles.length) console.log(`  zero-symbol examples: ${zeroSymbolFiles.join(", ")}`)
console.log(
  `ORPHANED BOMBS that fired during this run: ${bombFires.length} ` +
    `(engine.ts:1441-1447 arms a 120s exit(1) before parser.parse and clears it after, so a THROW leaves it armed; this census observed them rather than dying of them)`,
)
if (bombFires.length > 0) {
  console.log(`  Each fire is the SIGNAL that some file degraded. The file it NAMES is the oldest surviving bomb, NOT the file that threw:`)
  for (const f of bombFires.slice(0, 12)) console.log(`      named ${f.named}   attempted exit(${f.exitCode ?? 0})`)
  if (bombFires.length > 12) console.log(`      …and ${bombFires.length - 12} more`)
  console.log(`  A fire count ABOVE the degraded count cannot happen; equal counts are the expected shape.`)
}

console.log(`\nPER-TYPE — EXISTS/FIRES (production parseFile), LABELLED (evidenceClass), CONFIDENT (confidence)\n`)
console.log(`  "files" is the TRUE count of distinct files the type appeared in. An earlier version of this`)
console.log(`  table capped the set at 6 to keep the output short, which made every large type print "6" — a`)
console.log(`  number that reads as a measurement and is a display limit.\n`)
console.log(["type", "edges", "conf<0.7", "heur%", "files", "evidenceClass"].map((h, i) => h.padEnd([10, 10, 9, 8, 7, 34][i])).join(""))
console.log("-".repeat(78))
const perType: Record<string, any> = {}
for (const t of ALL_TYPES) {
  const row = rel.get(t)
  if (!row || row.n === 0) {
    console.log(`${t.padEnd(10)}${"0".padEnd(10)}${"—".padEnd(9)}${"—".padEnd(8)}${"—".padEnd(7)}NOT EMITTED`.padEnd(78))
    perType[t] = { emitted: 0 }
    continue
  }
  const heur = [...row.conf.entries()].filter(([c]) => c < 0.7).reduce((a, [, n]) => a + n, 0)
  const confDesc = [...row.conf.entries()].sort((a, b) => b[0] - a[0]).map(([c, n]) => `${c}:${n}`).join(" ")
  const evDesc = [...row.evidence.entries()].sort((a, b) => b[1] - a[1]).map(([e, n]) => `${e}:${n}`).join(" ")
  console.log(
    `${t.padEnd(10)}${row.n.toLocaleString().padEnd(10)}${heur.toLocaleString().padEnd(9)}${((100 * heur) / row.n).toFixed(1).padEnd(8)}${row.files.size.toString().padEnd(7)}${confDesc}  ${evDesc}`.padEnd(160),
  )
  perType[t] = {
    emitted: row.n,
    files: [...row.files],
    confidence: Object.fromEntries(row.conf),
    evidenceClass: Object.fromEntries(row.evidence),
    heuristicUnder07: heur,
    heuristicPct: +((100 * heur) / row.n).toFixed(2),
  }
}

// ---------------------------------------------------------------- construct-vs-edge reconciliation
/**
 * For each construct whose edge count must reconcile against the tree: files CONTAINING the
 * construct, against files in which the relationship actually fired.
 *
 * A shortfall is not automatically a defect and is never automatically fine — it is a number that
 * has to be explained by a probe. `exports` is short by exactly one file, and the reason is a
 * deliberate refusal: `julia/test/precompile.jl:15` is `export $Foo_module, $FooBase_module`, whose
 * names are `interpolation_expression` nodes and so are computed at macro-expansion time. There is
 * no name to publish, and emitting the literal `$Foo_module` would assert a binding that exists
 * nowhere in the file. That is the one acceptable shape of shortfall: a construct the analyzer can
 * see and declines to name, with the node type that says why.
 */
console.log(`\nRECONCILIATION — files CONTAINING the construct vs files where the edge fired\n`)
console.log(`  Two numbers that should agree and do not are the only signal that finds a silent`)
console.log(`  omission: a dropped construct parses without an ERROR node and its file still`)
console.log(`  publishes symbols, so nothing else here would notice.\n`)
const reconcile: Record<string, any> = {}
for (const [t, stmts] of [["imports", stmtFiles.imports], ["exports", stmtFiles.exports]] as const) {
  const fired = perType[t]?.files as string[] | undefined
  const firedSet = new Set(fired ?? [])
  const silent = [...stmts].filter((r) => !firedSet.has(r)).sort()
  console.log(`  ${t.padEnd(9)} files with the construct: ${stmts.size}   files with >=1 edge: ${firedSet.size}   silent: ${silent.length}`)
  for (const s of silent.slice(0, 6)) console.log(`      ${s}`)
  reconcile[t] = { constructFiles: stmts.size, firedFiles: firedSet.size, silentFiles: silent }
}

console.log(`\nSYMBOL KINDS\n`)
for (const [k, n] of [...symKinds].sort((a, b) => b[1] - a[1])) console.log(`  ${String(k).padEnd(14)} ${n.toLocaleString()}`)
console.log(`  empty/unknown kind: ${badKind.length}   empty name: ${emptyNames.length}`)
console.log(`  endpoint === "unknown" that DOES resolve to a declared symbol: ${resolvedUnknown.length}`)
console.log(`  endpoint === "unknown" that does NOT resolve: ${unresolvedUnknown.length}  (${[...new Set(unresolvedUnknown.map((u) => u.file))].join(", ") || "none"})`)

console.log(`\nSYNTHETIC SOURCES — a relationship source that is not a declared symbol in any file\n`)
if (syntheticSrc.size === 0) console.log(`  none`)
for (const [k, n] of [...syntheticSrc].sort((a, b) => b[1] - a[1])) {
  const [t, s] = k.split("|")
  console.log(`  type=${t.padEnd(11)} source=${JSON.stringify(s).padEnd(9)} ${n.toLocaleString()} edges`)
}

console.log(`\nRESOLVED — both endpoints bind to a symbol declared in the SAME file (the analyzer is per-file)\n`)
console.log(`  Measured against the FILE's own symbol table. An earlier version of this census kept one`)
console.log(`  union set of every name in the corpus and asked "is this endpoint in the set", which is`)
console.log(`  neither this number nor the project-wide one below, and which cannot see a name published`)
console.log(`  twice in one file — the case the incoming table exists to count.\n`)
console.log(["type", "edges", "both%", "src%", "tgt%", "neither%"].map((h, i) => h.padEnd([10, 10, 8, 8, 8, 9][i])).join(""))
console.log("-".repeat(53))
for (const t of ALL_TYPES) {
  const s = resolveStats.get(t)
  if (!s) {
    console.log(`${t.padEnd(10)}0`)
    perType[t] = { ...(perType[t] ?? {}), resolution: null }
    continue
  }
  const pct = (x: number) => (s.edges ? ((100 * x) / s.edges).toFixed(1) : "0.0")
  console.log(`${t.padEnd(10)}${s.edges.toLocaleString().padEnd(10)}${pct(s.both).padEnd(8)}${pct(s.srcOnly + s.both).padEnd(8)}${pct(s.tgtOnly + s.both).padEnd(8)}${pct(s.neither).padEnd(9)}`)
  perType[t] = { ...(perType[t] ?? {}), resolution: s, resolutionBothPct: Number(pct(s.both)) }
}

// ---------------------------------------------------------------- incoming edges
//
// `src/lsp/impact.ts` walks the graph BACKWARDS by scanning outgoing edges and matching TARGETS,
// because the schema stores no inbound edge. So the quality of a reverse walk is exactly the quality
// of the target table below, and two failure modes follow from it that are this lane's problem:
//
//   1. a target that names MORE THAN ONE published symbol — `bb_impact` picks one by a rule nobody
//      chose, and an edge attributed to the wrong declaration is wrong refactoring advice;
//   2. a target that names NOTHING — indistinguishable from a declaration that was never indexed.
//      `external-by-import` and `foreign-ccall` are the cases the FILE ITSELF declares as external;
//      `corpus-only` is a declaration this corpus does hold but in another file; `unresolvable` is
//      the remainder and is where "external" and "never indexed" genuinely cannot be told apart
//      without the Julia runtime, which this census does not start.
const CLASS_LABEL: Record<EndpointClass, string> = {
  "in-file-unique": "resolves in this file, one symbol",
  "in-file-ambiguous-disambiguated": ">1 symbol, but exactly ONE matches the kind the relationship type implies",
  "in-file-ambiguous-residual": ">1 symbol and NOT disambiguated by kind — a genuine collision",
  "foreign-ccall": "a C symbol, so by the file's own declaration (isForeignCall)",
  "external-by-import": "qualified root is imported by THIS file (tree-read import path)",
  "corpus-only": "declared in another file of this corpus",
  "local-binding": "bound in this file and NOT published — a parameter/loop/let/catch binding",
  unresolvable: "resolves to nothing — external package, dynamic dispatch, or a lost declaration",
  "synthetic-scope": "synthetic scope name (global/root), not a symbol",
}
console.log(`\nINCOMING — can the graph WALK TO the other end of each edge? (per-file, single-threaded)\n`)
const BUCKET_W = 22
console.log(`${["type", "edges", ...order].map((h, i) => h.padEnd(i === 0 ? 11 : i === 1 ? 9 : BUCKET_W)).join("")}`)
console.log("-".repeat(11 + 9 + BUCKET_W * order.length))
for (const t of ALL_TYPES) {
  const slot = incoming.get(t)
  if (!slot) {
    console.log(`${t.padEnd(11)}${"0".padEnd(9)}${order.map(() => "—".padEnd(BUCKET_W)).join("")}`)
    continue
  }
  const total = [...slot.tgt.values()].reduce((a, b) => a + b, 0)
  const cells = order.map((c) => (slot.tgt.get(c) ?? 0).toLocaleString().padEnd(BUCKET_W))
  console.log(`${t.padEnd(11)}${total.toLocaleString().padEnd(9)}${cells.join("")}`)
  perType[t] = {
    ...(perType[t] ?? {}),
    incomingTarget: Object.fromEntries(order.map((c) => [c, slot.tgt.get(c) ?? 0])),
    incomingSource: Object.fromEntries(order.map((c) => [c, slot.src.get(c) ?? 0])),
  }
}
console.log(`\n  TARGET buckets, and what each one CLAIMS:`)
for (const c of order) console.log(`    ${c.padEnd(18)} ${CLASS_LABEL[c]}`)
console.log(`\n  SOURCE buckets are the same seven classes, measured the same way and printed in the JSON as`)
console.log(`  \`incomingSource\`; \`global\` and \`root\` are this repo's synthetic scopes and appear there`)
console.log(`  as \`synthetic-scope\`, which is the count the SYNTHETIC SOURCES table above itemises.`)

console.log(`\nAMBIGUOUS TARGETS — a name this file publishes under MORE THAN ONE kind\n`)
let ambTotal = 0
for (const t of ALL_TYPES) {
  const byType = ambiguous.get(t)
  if (!byType || byType.size === 0) continue
  const edges = [...byType.values()].reduce((a, r) => a + r.edges, 0)
  ambTotal += edges
  console.log(`  ${t}: ${byType.size} distinct names across ${edges} edges`)
  for (const [name, rec] of [...byType].sort((a, b) => b[1].edges - a[1].edges).slice(0, 6)) {
    const implied = impliedTargetKinds(t, {})
    const kinds = [...rec.kinds]
    const shape = rec.sameKind
      ? `${rec.symbols} symbols, ALL kind ${kinds[0]} (several methods of one name, or one field name in several structs)`
      : `${rec.symbols} symbols across kinds ${kinds.join(",")}`
    console.log(`    ${name.padEnd(26)} ${String(rec.edges).padStart(5)} edges  ${shape}`)
    void implied
    console.log(`      at ${[...rec.where].join("  |  ")}`)
  }
  if (byType.size > 6) console.log(`    …and ${byType.size - 6} more names, all in the JSON's \`incoming.ambiguousTargets\``)
}
if (ambTotal === 0) console.log(`  none — every endpoint names at most one published symbol in its file`)
console.log(`\n  TOTAL ambiguous-target edges: ${ambTotal.toLocaleString()}`)
console.log(`\n  RESIDUAL AMBIGUITY — of the edges whose target names MORE THAN ONE published symbol, how`)
console.log(`  many the edge's OWN metadata picks out. This is the number that says whether an ambiguous`)
console.log(`  endpoint is a defect or a fact the consumer has to read, and it is computed per edge from`)
console.log(`  that edge's metadata, not from the type alone.\n`)
console.log(["type", "multi-sym edges", "picked out", "rate", "implied kinds", "corpus-wide"].map((h, i) => h.padEnd([12, 15, 12, 8, 26, 13][i]!)).join(""))
console.log("-".repeat(86))
for (const t of ALL_TYPES) {
  const dis = ambVerdict.get(`${t}|in-file-ambiguous-disambiguated`) ?? 0
  const res = ambVerdict.get(`${t}|in-file-ambiguous-residual`) ?? 0
  const total = multiTotal.get(t) ?? 0
  if (!total) { console.log(`${t.padEnd(12)}${"0".padEnd(15)}${"—".padEnd(12)}${"—".padEnd(8)}${"—".padEnd(13)}`); continue }
  const implied = [...ambImplied.entries()].filter(([k]) => k.startsWith(`${t}|`)).map(([, v]) => v)
  const cw = multiTotalCorpusWide.get(t) ?? 0
  console.log(`${t.padEnd(12)}${total.toLocaleString().padEnd(15)}${dis.toLocaleString().padEnd(12)}${((100 * dis) / total).toFixed(1).padEnd(8)}${[...new Set(implied)].join(" ").padEnd(26)}${cw.toLocaleString().padEnd(13)}`)
  // `residualAmbiguity` is total MINUS disambiguated, not the residual bucket's own picked-out count.
  // The second is zero by construction — a residual edge is one the metadata did NOT pick out — so
  // reading it as the residual count prints 0 for a type with 2,687 un-disambiguated edges, which is
  // the same numerator-for-denominator substitution that made the table itself wrong.
  perType[t] = { ...(perType[t] ?? {}), multiSymbolTargets: total, multiSymbolTargetsCorpusWide: cw, disambiguatedByMetadata: dis, residualAmbiguity: total - dis }
  void res
}
// The table above and the INCOMING buckets must count the same edges. They did not, once, and the
// disagreement was 6 edges wide with both tables describing the same population — see the note at the
// denominator. This asserts it rather than trusting it: a census that prints two disagreeing views of
// one number is worse than a census that prints one, because a reader has no way to tell which is the
// measurement.
{
  let inFileSum = 0
  let tableSum = 0
  const bad: string[] = []
  for (const t of ALL_TYPES) {
    const tg = (incoming.get(t) ?? { tgt: new Map<string, number>() }).tgt
    const buckets =
      (tg.get("in-file-ambiguous-disambiguated") ?? 0) + (tg.get("in-file-ambiguous-residual") ?? 0)
    const table = multiTotal.get(t) ?? 0
    inFileSum += buckets
    tableSum += table
    if (buckets !== table) bad.push(`${t}: buckets ${buckets} vs table ${table}`)
  }
  if (bad.length === 0) {
    console.log(`\n  CROSS-CHECK: the residual table and the INCOMING buckets count the same edges — ${tableSum.toLocaleString()} in both.`)
  } else {
    console.error(`\n  CROSS-CHECK FAILED — the residual table and the INCOMING buckets disagree:\n    ${bad.join("\n    ")}\n    buckets total ${inFileSum}, table total ${tableSum}`)
    process.exitCode = 1
  }
}
console.log(`\n  \`contains\` reads 0% picked out and that is NOT a defect: its SOURCE is the owning`)
console.log(`  declaration, so \`Owner -contains-> field\` already names exactly one member, and \`contains\``)
console.log(`  both-ends resolution is 99.9%. A bare field NAME colliding across structs is not something`)
console.log(`  the reverse walk has to choose between.`)
console.log(`  \`overrides\` reads 0% for a different reason: \`julia/test/reflection.jl\` declares FOUR`)
console.log(`  methods named \`foo\`, all of kind \`function\`, so the edge's kind narrows nothing. It is`)
console.log(`  disambiguated by \`metadata.signature\` and \`metadata.replacesLine\`, which the edge carries`)
console.log(`  and this table does not read.`)

console.log(`\nTHE \`calls\` SPLIT — 122k edges, the largest bucket, classified by what the fix would act on\n`)
{
  const b = callsShape.bare!
  const d = callsShape.dotted!
  const tot = (x: CallsBucket) => x.resolved + x.amb + x.unres
  const pct = (n: number, of: number) => (of ? `${((100 * n) / of).toFixed(1)}%` : "n/a")
  console.log(`  shape      edges     resolved   ambiguous  unresolved`)
  console.log(`  bare       ${String(tot(b)).padEnd(10)}${String(b.resolved).padEnd(11)}${String(b.amb).padEnd(11)}${b.unres}`)
  console.log(`  dotted     ${String(tot(d)).padEnd(10)}${String(d.resolved).padEnd(11)}${String(d.amb).padEnd(11)}${d.unres}`)
  const amb = b.amb + d.amb
  const unres = b.unres + d.unres
  console.log(`\n  OF THE ${amb.toLocaleString()} AMBIGUOUS \`calls\` EDGES:`)
  console.log(`    target declared in the edge's OWN file:   ${callsSplit.ambOwnFile.toLocaleString()}  (${pct(callsSplit.ambOwnFile, amb)})`)
  console.log(`    target declared in ANOTHER file only:     ${callsSplit.ambOtherFile.toLocaleString()}  (${pct(callsSplit.ambOtherFile, amb)})  <- the lua B2b shape`)
  console.log(`    dotted callee whose ROOT the project declares:   ${callsSplit.ambDottedRootInProject.toLocaleString()}`)
  console.log(`    dotted callee whose ROOT the project does NOT:   ${callsSplit.ambDottedRootAbsent.toLocaleString()}`)
  console.log(`    CEILING of an owner-qualification fix — the project publishes \`<edge source>.<target>\``)
  console.log(`    as a UNIQUE key, so targeting it resolves the edge:  ${callsSplit.ambScopeKeyUnique.toLocaleString()}  (${pct(callsSplit.ambScopeKeyUnique, amb)} of ambiguous)`)
  console.log(`\n  OF THE ${unres.toLocaleString()} UNRESOLVED \`calls\` EDGES:`)
  console.log(`    target declared in the edge's own file:   ${callsSplit.unresOwnFile.toLocaleString()}`)
  console.log(`    dotted, root IS a project declaration:    ${callsSplit.unresDottedRootInProject.toLocaleString()}`)
  console.log(`    dotted, root is NOT a project declaration:${callsSplit.unresDottedRootAbsent.toLocaleString()}  <- external by the project's own key space`)
  console.log(`    bare (a bare name the project does not declare anywhere): ${(unres - callsSplit.unresDottedRootInProject - callsSplit.unresDottedRootAbsent).toLocaleString()}`)
  console.log(`\n  Cross-check against the gate's TABLE 1, same population: calls resolved ${(b.resolved + d.resolved).toLocaleString()} ·`)
  console.log(`  ambiguous ${amb.toLocaleString()} · unresolved ${unres.toLocaleString()}. A disagreement here is a finding, not a rounding.`)
}

console.log(`\nTHE \`imports\` EXTERNAL CLAIMS — the must-be-zero column, audited edge by edge\n`)
{
  const a = importsAudit
  console.log(`  imports edges: ${a.total.toLocaleString()}   claimed external: ${a.claimed.toLocaleString()} (bare ${a.claimedBare.toLocaleString()} / dotted ${a.claimedDotted.toLocaleString()})   unclaimed: ${a.unclaimed.toLocaleString()}`)
  console.log(`  claim never read (target resolves or is ambiguous in the project): ${a.handledByDecls.toLocaleString()}`)
  console.log(`  claim read:  verified ${a.verified.toLocaleString()} (bare ${a.verifiedBare.toLocaleString()} / dotted ${a.verifiedDotted.toLocaleString()})   REFUTED ${a.refuted.toLocaleString()}`)
  console.log(`    of the refuted, the root IS declared in the importing file: ${a.refutedRootOwnFile.toLocaleString()}  <- all an in-lane same-file basis can reach`)
  console.log(`  Cross-check: REFUTED here is the incoming gate's extFAIL PLUS its \`ext?\` count, because a`)
  console.log(`  path-like or punctuation-bearing spelling is UNVERIFIABLE to the gate and this audit does not`)
  console.log(`  model that third outcome. Measured 2026-10-10: 208 here against 205 extFAIL + 3 ext? there.`)
  console.log(`  The gate reads a BARE-target claim only where the target is already absent, so it verifies BY`)
  console.log(`  CONSTRUCTION and cannot fail — the fleet ruled on 2026-10-10 that such a claim means "the`)
  console.log(`  analyzer said so", not "the project confirmed it", and this lane reports its bare claims as such.`)
  console.log(`  The trade a wholesale drop of DOTTED claims makes: extFAIL ${a.refuted.toLocaleString()} -> 0 at the cost of ${a.verifiedDotted.toLocaleString()} verified dotted claims -> unresolved.`)
}

console.log(`\nTHE \`references\` SPLIT — three populations wearing one label, and what each rule could reach\n`)
{
  const tot = (x: RefBucket) => x.resolved + x.amb + x.unres
  const row = (name: string, x: RefBucket) =>
    `  ${name.padEnd(22)}${String(tot(x)).padEnd(10)}${String(x.resolved).padEnd(11)}${String(x.amb).padEnd(11)}${x.unres}`
  console.log(`  ${"".padEnd(22)}edges     resolved   ambiguous  unresolved`)
  console.log(row("bare", refShape.bare!))
  console.log(row("dotted", refShape.dotted!))
  console.log(`\n  BY MARKER (the marker set is what separates three different causes):`)
  for (const [k, v] of Object.entries(refMarker).sort((a, b) => (b[1].amb + b[1].unres) - (a[1].amb + a[1].unres))) console.log(row(k, v))
  const amb = refShape.bare!.amb + refShape.dotted!.amb
  const unres = refShape.bare!.unres + refShape.dotted!.unres
  console.log(`\n  OF THE ${amb.toLocaleString()} AMBIGUOUS: own file ${refSplit.ambOwnFile.toLocaleString()} · another file only ${refSplit.ambOtherFile.toLocaleString()}`)
  console.log(`  OF THE ${unres.toLocaleString()} UNRESOLVED: dotted with an in-project ROOT ${refSplit.unresDottedRootInProject.toLocaleString()} · root absent ${refSplit.unresDottedRootAbsent.toLocaleString()} · dotted whose LEAF is in the project ${refSplit.unresDottedLeafInProject.toLocaleString()}`)
  console.log(`\n  CEILINGS OF THE THREE CANDIDATE RULES (what each could RESOLVE):`)
  console.log(`    scope key <source>.<target> unique:  ambiguous ${refSplit.ambScopeKeyUnique.toLocaleString()} · unresolved ${refSplit.unresScopeKeyUnique.toLocaleString()}`)
  console.log(`    leaf key  (dotted -> last segment):  ambiguous ${refSplit.ambLeafKeyUnique.toLocaleString()} · unresolved ${refSplit.unresLeafKeyUnique.toLocaleString()}`)
  console.log(`    own key   (the file's own declaration's qualifiedName): ambiguous ${refSplit.ambOwnKeyUnique.toLocaleString()} · unresolved ${refSplit.unresOwnKeyUnique.toLocaleString()}`)
  console.log(`    own key, STRICT (the analyzer's guard: the file declares the name exactly once): ambiguous ${refSplit.ambOwnKeyUniqueStrict.toLocaleString()} · resolved it would re-point ${refSplit.resolvedWouldBreakUnderOwnStrict.toLocaleString()}`)
  console.log(`    …and the BREAKAGE each retargeting rule would cause, counted rather than argued:`)
  console.log(`    own key would move a RESOLVED edge:  ${refSplit.resolvedWouldBreakUnderOwnRule.toLocaleString()}`)
  console.log(`    leaf key would move a RESOLVED edge: ${refSplit.resolvedWouldBreakUnderLeafRule.toLocaleString()}`)
  console.log(`\n  Cross-check against the gate's TABLE 1: references resolved ${(refShape.bare!.resolved + refShape.dotted!.resolved).toLocaleString()} ·`)
  console.log(`  ambiguous ${amb.toLocaleString()} · unresolved ${unres.toLocaleString()}.`)
}

console.log(`\nTHE \`uses\` SPLIT — a field-read type with a RECEIVER, where the own-key rule is not transferable\n`)
{
  const tot = (x: UsesBucket) => x.resolved + x.amb + x.unres
  const row = (name: string, x: UsesBucket) =>
    `  ${name.padEnd(30)}${String(tot(x)).padEnd(10)}${String(x.resolved).padEnd(11)}${String(x.amb).padEnd(11)}${x.unres}`
  console.log(`  ${"".padEnd(30)}edges     resolved   ambiguous  unresolved`)
  console.log(row("bare", usesShape.bare!))
  console.log(row("dotted", usesShape.dotted!))
  console.log(`\n  BY MARKER:`)
  for (const [k, v] of Object.entries(usesMarker).sort((a, b) => (b[1].amb + b[1].unres) - (a[1].amb + a[1].unres))) console.log(row(k, v))
  const amb = usesShape.bare!.amb + usesShape.dotted!.amb
  const unres = usesShape.bare!.unres + usesShape.dotted!.unres
  console.log(`\n  DISTINCT member names carrying a \`uses\` edge: ${usesTargets.size.toLocaleString()} — the population a schema-level rule would have to cover`)
  console.log(`  OF THE ${amb.toLocaleString()} AMBIGUOUS: own file ${usesSplit.ambOwnFile.toLocaleString()} · another file only ${usesSplit.ambOtherFile.toLocaleString()}`)
  console.log(`  OF THE ${unres.toLocaleString()} UNRESOLVED: bare and declared nowhere ${usesSplit.unresolvedBareDeclaredNowhere.toLocaleString()} · dotted root in project ${usesSplit.unresolvedDottedRootInProject.toLocaleString()} · dotted root absent ${usesSplit.unresolvedDottedRootAbsent.toLocaleString()}`)
  console.log(`\n  CEILINGS OF THE THREE CANDIDATE RULES (what each could RESOLVE):`)
  console.log(`    scope key <source>.<target> unique:  ambiguous ${usesSplit.ambScopeKeyUnique.toLocaleString()} · unresolved ${usesSplit.unresScopeKeyUnique.toLocaleString()}`)
  console.log(`    leaf key  (dotted -> last segment):  ambiguous ${usesSplit.ambLeafKeyUnique.toLocaleString()} · unresolved ${usesSplit.unresLeafKeyUnique.toLocaleString()}`)
  console.log(`    own key   (the file's own declaration's qualifiedName): ambiguous ${usesSplit.ambOwnKeyUnique.toLocaleString()} · unresolved ${usesSplit.unresOwnKeyUnique.toLocaleString()}`)
  console.log(`    own key, STRICT (the analyzer's guard: the file declares the name exactly once): ambiguous ${usesSplit.ambOwnKeyUniqueStrict.toLocaleString()}`)
  console.log(`    …and the SILENT RE-POINT each retargeting rule would cause, counted rather than argued:`)
  console.log(`    own key would move a RESOLVED edge:  ${usesSplit.resolvedWouldBreakUnderOwnRule.toLocaleString()} (strict guard: ${usesSplit.resolvedWouldBreakUnderOwnStrict.toLocaleString()})`)
  console.log(`    leaf key would move a RESOLVED edge: ${usesSplit.resolvedWouldBreakUnderLeafRule.toLocaleString()}`)
  console.log(`  NOTE the receiver: a \`uses\` target is the MEMBER of \`x.field\`, and the declaration it names`)
  console.log(`  belongs to whatever type \`x\` holds — which this analyzer does not infer. A re-point count`)
  console.log(`  above zero is therefore a WRONG-TARGET count, not a bucket count.`)
  console.log(`  Cross-check against the gate's TABLE 1: uses resolved ${(usesShape.bare!.resolved + usesShape.dotted!.resolved).toLocaleString()} ·`)
  console.log(`  ambiguous ${amb.toLocaleString()} · unresolved ${unres.toLocaleString()}.`)
}

console.log(`\nTHE UNRESOLVED SPLIT — "is there a candidate AT ALL?", per type\n`)
{
  const rows = Object.entries(unresolvedAudit)
    .map(([ty, a]) => ({ ty, a, tot: a.bare + a.dotted }))
    .filter((r) => r.tot > 0)
    .sort((x, y) => y.tot - x.tot)
  console.log(`  ${"type".padEnd(14)}${"unresolved".padEnd(12)}${"bare".padEnd(9)}${"dotted".padEnd(9)}${"another-proj".padEnd(14)}${"stdlib-root".padEnd(13)}${"other-root".padEnd(12)}${"tgt-elsewhere".padEnd(14)}nowhere`)
  for (const { ty, a, tot } of rows) {
    console.log(`  ${ty.padEnd(14)}${String(tot).padEnd(12)}${String(a.bare).padEnd(9)}${String(a.dotted).padEnd(9)}${String(a.anotherProject).padEnd(14)}${String(a.rootInStdlib).padEnd(13)}${String(a.rootElsewhere).padEnd(12)}${String(a.targetElsewhereOnly).padEnd(14)}${a.nowhere}`)
  }
  const sum = (f: (a: UnresAudit) => number) => rows.reduce((n, r) => n + f(r.a), 0)
  const tot = rows.reduce((n, r) => n + r.tot, 0)
  console.log(`  ${"TOTAL".padEnd(14)}${String(tot).padEnd(12)}${String(sum((a) => a.bare)).padEnd(9)}${String(sum((a) => a.dotted)).padEnd(9)}${String(sum((a) => a.anotherProject)).padEnd(14)}${String(sum((a) => a.rootInStdlib)).padEnd(13)}${String(sum((a) => a.rootElsewhere)).padEnd(12)}${String(sum((a) => a.targetElsewhereOnly)).padEnd(14)}${sum((a) => a.nowhere)}`)
  console.log(`\n  THE STDLIB SURFACE as the ARBITER derives it — every name the corpus's \`julia\` repository`)
  console.log(`  declares, leaf-reduced, a fact about the corpus rather than a list the claimant supplies:`)
  console.log(`    names in the surface: ${stdlibSurface.size.toLocaleString()}  ·  distinct ROOTS the ${sum((a) => a.rootInStdlib).toLocaleString()} stdlib-root edges name: ${new Set(rows.flatMap((r) => [...r.a.roots])).size.toLocaleString()}`)
  console.log(`  THE YAML REVERSE CHECK — of those ${sum((a) => a.rootInStdlib).toLocaleString()} edges, does the edge's OWN project declare ANY key whose leaf`)
  console.log(`  equals the target's leaf? A yes is a claim that must NOT be made (extFAIL cannot see it):`)
  console.log(`    safe to confirm: ${sum((a) => a.stdlibSafe).toLocaleString()}   leaf-collision risk: ${sum((a) => a.stdlibLeafRisk).toLocaleString()}   root-leaf risk: ${sum((a) => a.stdlibRootRisk).toLocaleString()}`)
  for (const { ty, a } of rows) if (a.rootInStdlib > 0) console.log(`      ${ty.padEnd(14)} stdlib-root ${String(a.rootInStdlib).padEnd(7)} safe ${String(a.stdlibSafe).padEnd(7)} leaf-risk ${String(a.stdlibLeafRisk).padEnd(7)} root-risk ${a.stdlibRootRisk}`)
  console.log(`\n  THE NOWHERE CLASS SUB-CLASSIFIED — the largest unresolved class gets a cause, not a label:`)
  console.log(`    local binding (a call through a VALUE: param/loop/let/catch/destructuring — unresolvable in`)
  console.log(`    any name-keyed graph, and the repo's standing contract says a binding is not a declaration):`)
  console.log(`      ${sum((a) => a.nowhereLocalBinding).toLocaleString()}  of which SAME FILE (the implementable slice): ${sum((a) => a.nowhereBindingSameFile).toLocaleString()}`)
  for (const { ty, a } of rows) if (a.nowhereBindingSameFile > 0) console.log(`        ${ty.padEnd(14)} same-file ${a.nowhereBindingSameFile}  of ${a.nowhereLocalBinding} binding edges`)
  for (const { a } of rows) for (const e of a.bindingSameFileExamples.slice(0, 8)) console.log(`        e.g. ${e}`)
  console.log(`    called by the stdlib repo but never DECLARED in it (Core builtins / bootstrap names — the`)
  console.log(`    bound on JUL-D13's surface: .jl declarations cannot list what C defines):`)
  console.log(`      ${sum((a) => a.nowhereCalledInStdlib).toLocaleString()}`)
  console.log(`    dotted into a namespace nothing declares: ${sum((a) => a.nowhereDotted).toLocaleString()}`)
  console.log(`    OTHER (bare, not a binding anywhere, never called by the stdlib): ${sum((a) => a.nowhereOther).toLocaleString()}`)
  const nw = sum((a) => a.nowhere)
  console.log(`    closure check: ${(sum((a) => a.nowhereLocalBinding) + sum((a) => a.nowhereCalledInStdlib) + sum((a) => a.nowhereDotted) + sum((a) => a.nowhereOther)).toLocaleString()} = ${nw.toLocaleString()} ${sum((a) => a.nowhereLocalBinding) + sum((a) => a.nowhereCalledInStdlib) + sum((a) => a.nowhereDotted) + sum((a) => a.nowhereOther) === nw ? "CLOSED" : "OPEN — A DEFECT IN THIS TABLE"}`)
  console.log(`\n  §6.11 CONTROL, stated before the class is called unreachable: the SAME lookup that produced the`)
  console.log(`  ${nw.toLocaleString()} nowhere edges found a candidate for ${(sum((a) => a.rootInStdlib) + sum((a) => a.rootElsewhere) + sum((a) => a.targetElsewhereOnly)).toLocaleString()} others in the same run, so the bucket is a`)
  console.log(`  COMPLEMENT of a working lookup rather than a broken one. Per type, the candidate-carrying half:`)
  for (const { ty, a } of rows) console.log(`      ${ty.padEnd(14)} candidates ${String(a.rootInStdlib + a.rootElsewhere + a.targetElsewhereOnly).padEnd(8)} nowhere ${String(a.nowhere).padEnd(8)} of which binding ${String(a.nowhereLocalBinding).padEnd(8)} stdlib-called ${String(a.nowhereCalledInStdlib).padEnd(8)} other ${a.nowhereOther}`)
  console.log(`\n  TOP NOWHERE NAMES PER TYPE (exact counts for the names listed):`)
  for (const { ty, a } of rows) {
    const top = [...a.nowhereNames.entries()].sort((x, y) => y[1] - x[1]).slice(0, 10)
    if (top.length) console.log(`    ${ty.padEnd(14)}${top.map(([n, c]) => `${n}(${c})`).join(" · ")}`)
  }

  console.log(`\n  THE CLAIM PRICE: ${sum((a) => a.rootInStdlib).toLocaleString()} unresolved edges name a ROOT that the corpus's`)
  console.log(`  \`julia\` repository declares (Base + stdlib) and that the edge's OWN project does not — the`)
  console.log(`  checkable basis JUL-D8 asks for: the gate can verify "absent from the project AND present in`)
  console.log(`  another project" without trusting the analyzer. ${sum((a) => a.nowhere).toLocaleString()} name nothing anywhere.`)
  console.log(`\n  TOP UNRESOLVED NAMES PER TYPE (worklist, counts exact for the names listed):`)
  for (const { ty, a } of rows) {
    const top = [...a.names.entries()].sort((x, y) => y[1] - x[1]).slice(0, 6)
    console.log(`    ${ty.padEnd(14)}${top.map(([n, c]) => `${n}(${c})`).join(" · ")}`)
  }
}

console.log(`\nTHE FOUR SMALL TYPES — clause 2 coverage for every emitted type, not every large one\n`)
{
  const tot = (x: SmallBucket) => x.resolved + x.amb + x.unres
  for (const ty of SMALL_TYPES) {
    const sh = smallShape[ty]!
    const sp = smallSplit[ty]!
    console.log(`  ${ty.toUpperCase()}`)
    console.log(`    ${"shape".padEnd(10)}${"edges".padEnd(9)}${"resolved".padEnd(11)}${"ambiguous".padEnd(11)}unresolved`)
    for (const k of ["bare", "dotted"]) {
      const v = sh[k]!
      if (tot(v) === 0) continue
      console.log(`    ${k.padEnd(10)}${String(tot(v)).padEnd(9)}${String(v.resolved).padEnd(11)}${String(v.amb).padEnd(11)}${v.unres}`)
    }
    for (const [k, v] of Object.entries(smallMarker[ty]!).sort((a, b) => (b[1].amb + b[1].unres) - (a[1].amb + a[1].unres)))
      console.log(`      by marker ${k.padEnd(22)} edges ${String(tot(v)).padEnd(8)} res ${String(v.resolved).padEnd(8)} amb ${String(v.amb).padEnd(8)} unres ${v.unres}`)
    console.log(`    ambiguity: own file ${sp.ambOwnFile} · another file only ${sp.ambOtherFile}`)
    console.log(`    CEILINGS: scope key amb ${sp.ambScopeKeyUnique} / unres ${sp.unresScopeKeyUnique} · leaf key amb ${sp.ambLeafKeyUnique} / unres ${sp.unresLeafKeyUnique} · own key amb ${sp.ambOwnKeyUnique} (strict ${sp.ambOwnKeyUniqueStrict}) / unres ${sp.unresOwnKeyUnique}`)
    console.log(`    SILENT RE-POINTS: own key ${sp.resolvedWouldBreakUnderOwnRule} (strict ${sp.resolvedWouldBreakUnderOwnStrict}) · leaf key ${sp.resolvedWouldBreakUnderLeafRule}`)
    console.log()
  }
}

console.log(`\nTHE COLON-NAMED CONTAINMENT AUDIT — is julia inside the blast radius of 140be2f01?\n`)
{
  const a = colonAudit
  console.log(`  symbols published over the population: ${a.symbols.toLocaleString()}`)
  console.log(`  symbol NAMES carrying a colon:          ${a.colonNamed.toLocaleString()}`)
  console.log(`  …AND carrying an owner (the indexer synthesizes an owner->owned contains row for these,`)
  console.log(`  which is the row the defect duplicated): ${a.colonNamedOwned.toLocaleString()}`)
  for (const e of a.examples) console.log(`      ${e}`)
  console.log(`  contains EDGE TARGETS carrying a colon: ${a.containsTargetsWithColon.toLocaleString()}`)
  console.log(`  The expectation was "julia is dotted, so unaffected". This is the count, not the expectation.`)
}

console.log(`\nLEVER PRICING — two candidate levers, each stated in the gate's own columns\n`)
{
  const ambOf = (sh: Record<string, { resolved: number; amb: number; unres: number }>) =>
    (sh.bare?.amb ?? 0) + (sh.dotted?.amb ?? 0)
  console.log(`  (a) METHOD-TABLE COLLAPSE — an ambiguous edge whose every candidate declaration belongs`)
  console.log(`      to ONE binding (julia's method table is one entry per (name, signature)) would land in`)
  console.log(`      RESOLVED under a project-scoped method-table pass:`)
  console.log(`        calls       ${callsSplit.bindingCollapsible.toLocaleString()} of ${ambOf(callsShape).toLocaleString()} ambiguous`)
  console.log(`        references  ${refSplit.bindingCollapsible.toLocaleString()} of ${ambOf(refShape).toLocaleString()} ambiguous`)
  console.log(`        uses        ${usesSplit.bindingCollapsible.toLocaleString()} of ${ambOf(usesShape).toLocaleString()} ambiguous`)
  const smallCollapse = Object.entries(smallSplit).map(([ty, sp]: [string, any]) =>
    `${ty} ${(sp.bindingCollapsible ?? 0).toLocaleString()}`).join(" · ")
  console.log(`        four small types: ${smallCollapse}`)
  console.log(`      An edge whose candidates span TWO bindings would NOT move, and no UNRESOLVED edge can`)
  console.log(`      be reached this way: its target names nothing to collapse.`)
  console.log(`\n  (b) NARROWER LEAF RULE for references — retarget a dotted target to its leaf ONLY when a`)
  console.log(`      PER-FILE fact supports it (this file declares the leaf, or declares the root):`)
  console.log(`        reach  (unresolved -> resolved): ${refSplit.narrowLeafReach.toLocaleString()} of ${refSplit.unresLeafKeyUnique.toLocaleString()} leaf-unique unresolved`)
  console.log(`        re-points inside RESOLVED that the same guard still touches: ${refSplit.narrowLeafRepoint.toLocaleString()} of ${refSplit.resolvedWouldBreakUnderLeafRule.toLocaleString()} without the guard`)
}

console.log(`\nWHY EACH AMBIGUOUS EDGE IS AMBIGUOUS — the B-split, ON THE GATE'S OWN amb(decl) PREDICATE\n`)
{
  const types = ["calls", "uses", "references"]
  console.log(`  type          amb(decl)   B1 one file,  B2 one project  B3b one file,  cross-project`)
  console.log(`                            two scopes    several files    one scope      key exists too`)
  let t1 = 0, t2 = 0, t3 = 0, tx = 0, tAll = 0
  for (const ty of types) {
    const row = ambClassCounts[ty] ?? {}
    const b1 = row.B1 ?? 0, b2 = row.B2 ?? 0, b3 = row.B3b ?? 0, un = row["?"] ?? 0
    const all = b1 + b2 + b3 + un
    t1 += b1; t2 += b2; t3 += b3; tx += ambCrossProject[ty] ?? 0; tAll += all
    const pc = (n: number) => all ? ((100 * n) / all).toFixed(1) + "%" : "-"
    console.log(`  ${ty.padEnd(13)} ${String(all).padStart(8)}   ${String(b1).padStart(6)} ${pc(b1).padStart(6)} ${String(b2).padStart(8)} ${pc(b2).padStart(6)} ${String(b3).padStart(7)} ${String(ambCrossProject[ty] ?? 0).padStart(9)}`)
    if (un) console.log(`      (${un} ambiguous edge(s) had NO candidate in the project index — reported, not folded in)`)
  }
  const pcT = (n: number) => tAll ? ((100 * n) / tAll).toFixed(1) + "%" : "-"
  console.log(`  ${"TOTAL".padEnd(13)} ${String(tAll).padStart(8)}   ${String(t1).padStart(6)} ${pcT(t1).padStart(6)} ${String(t2).padStart(8)} ${pcT(t2).padStart(6)} ${String(t3).padStart(7)} ${String(tx).padStart(9)}`)
  console.log(`  THE POOLED-ONLY COLUMN IS THE ONE THAT MUST NOT BE SUBTRACTED FROM A PER-PROJECT NUMBER:`)
  console.log(`  it counts edges whose key ALSO exists in another project — in production a project IS a path`)
  console.log(`  (\`src/util/project-id.ts:29\`) and the corpus root holds no project at all, so those candidates`)
  console.log(`  cannot collide there. A pooled instrument calls such an edge ambiguous where the gate RESOLVES it.`)
  console.log(`\n  IS THE COLLAPSE A METHOD TABLE OR A NAME COINCIDENCE? (this decides whether it is buildable)`)
  for (const ty of types) {
    const row = collKindCounts[ty] ?? {}
    const q = row.QUALIFIED ?? 0, b = row["BARE-ONLY"] ?? 0, m = row.MIXED ?? 0
    const all = q + b + m
    if (!all) continue
    console.log(`    ${ty.padEnd(12)} collapsible ${all}: QUALIFIED ${q}${all ? " (" + ((100 * q) / all).toFixed(1) + "%)" : ""} · BARE-ONLY ${b}${all ? " (" + ((100 * b) / all).toFixed(1) + "%)" : ""} · MIXED ${m}`)
  }
  console.log(`\n  AND WHAT THE BARE-ONLY CLASS IS, by where its candidate FILES live (a julia package includes`)
  console.log(`  its src/ files into ONE module, so one region CAN be one binding while src/ vs test/ cannot):`)
  for (const ty of types) {
    const row = collKindCounts[ty] ?? {}
    console.log(`    ${ty.padEnd(12)} one region ${row["BARE-ONE-REGION"] ?? 0} · several regions ${row["BARE-MULTI-REGION"] ?? 0}`)
  }
  console.log(`\n  THE FALSIFIER FOR THE ONE-REGION BUILD, measured BEFORE it is built — a candidate FILE that`)
  console.log(`  opens a \`module\` block means its file-scope declarations may belong to THAT module, so`)
  console.log(`  qualifying them by the package would MERGE two bindings:`)
  let totalOne = 0, totalClean = 0, totalDirty = 0, totalConflict = 0
  for (const ty of types) {
    const row = collKindCounts[ty] ?? {}
    const one = row["BARE-ONE-REGION"] ?? 0, dirty = row["ONE-REGION-FILE-HAS-MODULE"] ?? 0
    const clean = row["ONE-REGION-NO-MODULE-ANYWHERE"] ?? 0
    const conflict = row["ONE-REGION-MODULE-NAMES-CONFLICT"] ?? 0
    totalOne += one; totalDirty += dirty; totalClean += clean; totalConflict += conflict
    console.log(`    ${ty.padEnd(12)} one-region ${one}: NO module block anywhere ${clean} · at least one file has one ${dirty} · module names CONFLICT ${conflict}`)
  }
  console.log(`    ${"TOTAL".padEnd(12)} one-region ${totalOne}: clean ${totalClean} · dirty ${totalDirty} · conflicting ${totalConflict}`)
  {
    let pk = 0, np = 0
    for (const ty of types) {
      const row = collKindCounts[ty] ?? {}
      const k = row["ONE-REGION-PKG"] ?? 0, n = row["ONE-REGION-NO-PKG"] ?? 0
      pk += k; np += n
      if (k || n) console.log(`      ${ty.padEnd(12)} clean-and-PACKAGE ${k} · clean-but-NO root Project.toml ${n}`)
    }
    console.log(`      ${"TOTAL".padEnd(12)} clean-and-PACKAGE ${pk}  <- THE REACHABLE SUBSET for (b) · clean-but-no-package ${np} (pre-registered OUT)`)
  }
  console.log(`    VERDICT: ${totalDirty === 0 ? "0 files carry a module block -> the one-region assumption is SAFE to build on" : "NON-ZERO -> the one-region assumption is NOT safe; STOP and report this count"}`)
  for (const ty of types) {
    const row = collKindCounts[ty] ?? {}
    console.log(`    ${ty.padEnd(12)} control (NOT collapsible): multi-binding ${row["CONTROL-multi-binding"] ?? 0} · no-candidates ${row["CONTROL-no-candidates"] ?? 0}`)
  }
  console.log(`\n  THE SAME SPLIT FOR THE METHOD-TABLE-COLLAPSIBLE SUBSET (the lever this lane priced):`)
  for (const ty of types) {
    const row = collClassCounts[ty] ?? {}
    const all = (row.B1 ?? 0) + (row.B2 ?? 0) + (row.B3b ?? 0) + (row["?"] ?? 0)
    if (!all) continue
    console.log(`    ${ty.padEnd(12)} ${all}  B1 ${row.B1 ?? 0} · B2 ${row.B2 ?? 0} · B3b ${row.B3b ?? 0} · cross-project ${collCrossProject[ty] ?? 0}`)
  }
}

const report = {
  generatedFor: "M14 ontology lane — julia",
  corpusRoot: CR,
  admittedFiles: files.length,
  excludedOver512KB: skippedLargeJulia,
  excludedOver512KBNonJuliaSharedRoot: skippedLarge - skippedLargeJulia,
  perRepo: Object.fromEntries(perRepo),
  productionGrammar: { file: "wasm/tree-sitter-julia.wasm", md5: wasmMd5 },
  instrumentA: {
    distinctNodeTypes: nodeTypes.size,
    totalNodes: [...nodeTypes.values()].reduce((a, b) => a + b, 0),
    nodeTypes: Object.fromEntries(sortedTypes),
    nodeTypeExamples: Object.fromEntries(nodeTypeExamples),
    wouldMeanImplements: WOULD_MEAN_IMPLEMENTS,
    implementsPresent: implementsInventory,
    unreadableByGrammar,
  },
  instrumentAprime: {
    // The claims the analyzer makes about the grammar, each with the line it is made on, and the
    // ones the production grammar never produced. julia is absent from the shared L2 gate's language
    // list, so this is the only statement about node-type references this lane can make.
    analyzer: path.relative(process.cwd(), analyzerPath),
    claims: Object.fromEntries(nodeTypeClaims),
    claimCount: nodeTypeClaims.size,
    notProduced: unknownRefs,
    scannerWarnings: claimScan.warnings,
    sharedGateHasJulia: false,
  },
  instrumentB: probes.map((p) => ({
    name: p.name, types: p.types, occurrences: p.occurrences, files: p.files.size, examples: p.hits.slice(0, 40),
    ...(p.subsetHits ? { subsetHits: p.subsetHits } : {}),
  })),
  production: {
    symbols: totalSymbols, relationships: totalRels,
    filesToFallback: fallbackFiles(),
    degradedFiles,
    analysedFiles: files.length - degradedFiles.length, filesWithZeroSymbols: filesWithZeroSymbols, parseFileThrows: parseFailures.length,
    symbolKinds: Object.fromEntries(symKinds),
    emptyOrUnknownKind: badKind.length, emptyName: emptyNames.length,
    unknownEndpoint: resolvedUnknown.length, unknownEndpointUnresolved: unresolvedUnknown.length,
    unknownEndpointUnresolvedFiles: [...new Set(unresolvedUnknown.map((u) => u.file))],
    syntheticSources: Object.fromEntries(syntheticSrc),
    perType,
    reconciliation: reconcile,
  },
  localBindings: {
    // The size of the "bound here, deliberately not published" evidence base: how many distinct
    // names the corpus binds as parameters, loop variables, `let` bindings and catch variables.
    // Printed because the `local-binding` bucket is only as good as this set, and a bucket whose
    // evidence base is small should not be read as a small finding.
    perFile: Object.fromEntries([...localBindingsByFile].map(([k, v]) => [k, v.size])),
    totalDistinctPerFileSum: [...localBindingsByFile.values()].reduce((a, s) => a + s.size, 0),
  },
  incoming: {
    // Two facts that are independent and both worth having: the per-file table a single file's graph
    // sees, and the per-file count of names this file publishes under more than one kind, which is
    // the case a target-matching reverse walk cannot choose between.
    distinctNamesPerCorpus: corpusNames.size,
    bucketMeaning: CLASS_LABEL,
    perType: Object.fromEntries([...incoming].map(([t, slot]) => [t, { target: Object.fromEntries(slot.tgt), source: Object.fromEntries(slot.src) }])),
    ambiguousTargets: Object.fromEntries(
      [...ambiguous].map(([t, byType]) => [
        t,
        [...byType]
          .sort((a, b) => b[1].edges - a[1].edges)
          .map(([name, rec]) => ({
            name, edges: rec.edges, symbols: rec.symbols, sameKindOnly: rec.sameKind,
            kinds: [...rec.kinds], where: [...rec.where],
          })),
      ]),
    ),
  },
}
if (jsonOut) {
  writeFileSync(jsonOut, JSON.stringify(report, null, 2))
  console.log(`\nwrote ${jsonOut}`)
}
