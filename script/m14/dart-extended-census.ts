/**
 * DART EXTENDED CENSUS — THE FOUR EXTENDED VALUES OVER THE WHOLE ADMITTED POPULATION, PLUS THE
 * PER-TYPE EDGE COUNTS THE CELL'S FIRST COLUMN IS MADE OF.
 *
 * ## WHAT THIS IS
 *
 * The lane's `script/m14/spec/dart-completeness.json` declares a coverage block, and the block's
 * denominator is the language's OWN expressible set n over the live FOURTEEN-value vocabulary. Two
 * of the four extended values (`mixes_in`, `part_of`) are ALREADY EMITTED by
 * `src/ast/real-dart-analyzer.ts` and were UNDECLARED — the Lead's fleet state records that as a
 * stale block. Declaring them needs a COUNT, and a count needs a population.
 *
 * So this instrument walks the WHOLE admitted population ONCE and measures, per file:
 *
 *   · THE PER-TYPE EDGE COUNTS — every relationship the PRODUCTION analyzer emits, by type, with
 *     the file and repo it came from. This is the cell's "edges" column, measured, not summed by
 *     hand.
 *   · THE TWO EXTENDED EMISSIONS — `mixes_in` and `part_of`, and for `part_of` the SPLIT the lane
 *     has always owed: the named-library form (`part of my.lib;`) against the path form
 *     (`part 'x.dart';`). The counters `dart.part_of_site_path` / `dart.part_of_site_named` /
 *     `dart.part_site_path` already exist in the fleet's own vocabulary.
 *   · THE NEAR-MISS CENSUS for the two values that are NOT emitted — `renders` and `decorates`.
 *     A near-miss construct must be NAMED AND COUNTED (L-17), and "the grammar has no node type"
 *     is only half of a ruling:
 *       `renders`   — every node type whose name could carry a render/element/template construct
 *                     (`for_element`, `if_element`, `spread_element`, `template_substitution`),
 *                     counted, so the absence of a JSX-style element is a fact about the corpus
 *                     and not only about the grammar's node list.
 *       `decorates` — every `annotation` node, counted, split by the carrier's kind and by whether
 *                     the annotation CARRIES ARGUMENTS (a const constructor invocation) or is a bare
 *                     marker. This is the construct the `decorates` question is about.
 *   · THE ANNOTATION POPULATION in the form the ontology question needs: how many annotation sites
 *     name an annotation class DECLARED IN THE POPULATION (an applied callable a reader can follow)
 *     against how many name an EXTERNAL or CORE marker (`override`, `deprecated`, `pragma`).
 *
 * ## WHAT IT DOES NOT CLAIM
 *
 * It does not RESOLVE anything. Resolution is the arbiter's (`script/m14/incoming-gate.ts`), and a
 * census that resolved edges would be a second, disagreeing arbiter. This instrument counts what
 * the analyzer emits; the closure arithmetic is the gate's.
 *
 * Usage:
 *   BB_CORPUS_ROOT=$PWD/.corpus bun run script/m14/dart-extended-census.ts [--json <out.json>] [--limit N]
 */
import { readFileSync, statSync, existsSync, writeFileSync } from "node:fs"
import { execFileSync } from "node:child_process"
import * as path from "node:path"
import { getParser } from "../../src/ast/engine"
import { RealDartAnalyzer } from "../../src/ast/real-dart-analyzer"

const ROOT = path.resolve(import.meta.dirname ?? ".", "..", "..")
const CR = process.env.BB_CORPUS_ROOT ?? path.join(ROOT, ".corpus")
const argv = process.argv.slice(2)
const argOf = (f: string): string | undefined => {
  const eq = argv.find((a) => a.startsWith(`${f}=`))
  if (eq) return eq.slice(eq.indexOf("=") + 1)
  const i = argv.indexOf(f)
  return i >= 0 ? argv[i + 1] : undefined
}
const JSON_OUT = argOf("--json")
const LIMIT = Number(argOf("--limit") ?? "0")
// // THE CHUNKING FLAGS. THE MECHANISM, MEASURED (the Lead, with a control): the growth is the
// UNFREED TREES, not the parse count — the shared path frees each tree
// (src/ast/engine.ts:2244-2245, inside parseFile) and is safe; THIS INSTRUMENT IS THE
// COUNTEREXAMPLE: it holds every tree it parses and never calls tree.delete(), so its
// module runs out at ~7,600 files and every later `new Parser` ABORTS — a run that
// LOOKS complete and silently measures a fraction of it. So the walk is chunked (this
// lane's own arm cap is 2,000 files), one PROCESS per chunk, and the chunk JSONs are
// merged by script/m14/dart-census-merge.ts. The chunks are DISJOINT, so summing their
// rows and their file counts is exact, not an estimate. Shared probe:
// script/m14/wasm-parse-lifetime.ts (exit 5 on an abort).
const REPO = argOf("--repo") ?? ""
const OFFSET = Number(argOf("--offset") ?? "0")
const SIZE_CAP = 1024 * 1024

/** THE ADMITTED SET — the same rule `script/m14/dart-population.ts` and `incoming-gate.ts` use:
 *  git-tracked, `.dart`, present in the working tree, at most the engine's 1 MB full-AST cap. */
function admittedFiles(): Map<string, string[]> {
  const out = new Map<string, string[]>()
  for (const e of require("node:fs").readdirSync(CR, { withFileTypes: true }) as any[]) {
    const dir = path.join(CR, e.name)
    try {
      if (!statSync(dir).isDirectory()) continue
      execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
    } catch {
      continue
    }
    let tracked: string[] = []
    try {
      tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], {
        encoding: "utf8", maxBuffer: 512 * 1024 * 1024,
      }).split("\0").filter(Boolean)
    } catch {
      continue
    }
    const files: string[] = []
    for (const rel of tracked) {
      if (!rel.toLowerCase().endsWith(".dart")) continue
      const abs = path.join(dir, rel)
      try {
        if (statSync(abs).size > SIZE_CAP) continue
      } catch {
        continue
      }
      files.push(abs)
    }
    if (files.length) out.set(e.name, files.sort())
  }
  return out
}

/** THE COUNTERS — a count is a count, and the shapes are named. */
type Bucket = { rows: number; files: Set<string> }
const bucket = (): Bucket => ({ rows: 0, files: new Set() })
const bump = (b: Bucket, file: string): void => { b.rows++; b.files.add(file) }

const TYPE_ORDER = [
  "calls", "extends", "implements", "uses", "imports", "exports", "contains", "references",
  "overrides", "instantiates", "decorates", "renders", "mixes_in", "part_of",
]

async function main(): Promise<void> {
  const repos = admittedFiles()
  if (repos.size === 0) {
    console.error("FATAL: no admitted dart files under " + CR)
    process.exit(2)
  }
  // THE PARSER IS FETCHED PER FILE, NOT ONCE. A tree-sitter WASM parse of a deeply-nested file
  // can ABORT the module, and an aborted parser fails every later parse instantly: with one
  // cached parser for the whole walk, dart-sdk (25,727 files) was measured in 1 SECOND because
  // every parse after the first abort threw at once. The engine recreates the parser every 500
  // calls (src/ast/engine.ts:901), so fetching per file is what makes the walk SURVIVE an abort —
  // and the failure count is printed, because a number that hides a lost population is not a
  // number.
  const parserFor = async (): Promise<any> => await getParser("dart")
  const analyzer = new RealDartAnalyzer()

  // THE PER-TYPE EDGE COUNTS.
  const edgesByType = new Map<string, Bucket>()
  for (const t of TYPE_ORDER) edgesByType.set(t, bucket())
  // THE TWO EXTENDED EMISSIONS, split the way the lane owes them.
  const partOfSiteNamed = bucket()   // `part of my.lib;` — the NAMED-LIBRARY form
  const partOfSitePath = bucket()     // `part of 'x.dart';` — the path form of `part of`
  const partSitePath = bucket()       // `part 'x.dart';` — the path form of `part`
  const partOfRows = bucket()
  const mixesInRows = bucket()
  const annotationRefs = bucket()
  const annotationRefsByKind = new Map<string, Bucket>()
  const mixinOnRefs = bucket()
  // THE NEAR-MISS CENSUS.
  const nodeCensus = new Map<string, Bucket>()
  const annotationNodes = bucket()
  const annotationNodesWithArgs = bucket()
  const annotationNodesBare = bucket()
  const annotationNames = new Map<string, number>()
  const RENDER_NEAR_MISS = ["for_element", "if_element", "spread_element", "template_substitution"]
  const DECORATE_NEAR_MISS = ["annotation"]
  for (const n of [...RENDER_NEAR_MISS, ...DECORATE_NEAR_MISS]) nodeCensus.set(n, bucket())

  let parsed = 0, failed = 0, files = 0
  const perRepo: any[] = []
  const start = Date.now()

  for (const [repo, list] of repos) {
    const repoEdges = new Map<string, number>()
    const repoStart = Date.now()
    if (REPO && repo !== REPO) continue
    // THE CHUNK WINDOW — the offset is applied to the FULL list, never to the limited slice:
    // `list.slice(0, LIMIT).slice(OFFSET)` is EMPTY for every offset >= LIMIT, which is how a
    // chunked walk silently measures only the first chunk of every repository.
    const walked = OFFSET > 0 ? list.slice(OFFSET, LIMIT > 0 ? OFFSET + LIMIT : undefined) : (LIMIT > 0 ? list.slice(0, LIMIT) : list)
    for (const abs of walked) {
      files++
      const rel = path.relative(path.join(CR, repo), abs).split(path.sep).join("/")
      let src: string
      try { src = readFileSync(abs, "utf8") } catch { failed++; continue }
      let tree: any
      const parser = await parserFor()
      try { tree = parser.parse(src) } catch { failed++; continue }
      if (!tree) { failed++; continue }
      const root = tree.rootNode
      // THE NODE CENSUS — an iterative walk (the corpus has 20,000-deep trees).
      const stack: any[] = [root]
      while (stack.length > 0) {
        const n = stack.pop()
        if (!n) continue
        const c = nodeCensus.get(n.type)
        if (c) {
          bump(c, rel)
          if (n.type === "annotation") {
            bump(annotationNodes, rel)
            const hasArgs = (n.namedChildren ?? []).some((k: any) => k && k.type === "arguments")
            if (hasArgs) bump(annotationNodesWithArgs, rel)
            else bump(annotationNodesBare, rel)
            const nameNode = n.childForFieldName?.("name")
            const spelled = nameNode ? nameNode.text : "(unresolved)"
            annotationNames.set(spelled, (annotationNames.get(spelled) ?? 0) + 1)
          }
        }
        for (const k of n.namedChildren ?? []) if (k) stack.push(k)
      }
      let r: any
      try { r = await analyzer.analyze(root, src, abs) } catch { failed++; continue }
      parsed++
      for (const row of r.relationships ?? []) {
        const t = String(row.type ?? "")
        const e = edgesByType.get(t)
        if (e) bump(e, rel)
        repoEdges.set(t, (repoEdges.get(t) ?? 0) + 1)
        const md: any = row.metadata ?? {}
        if (t === "mixes_in") bump(mixesInRows, rel)
        if (t === "part_of") {
          bump(partOfRows, rel)
          if (md.partRole === "part") bump(partSitePath, rel)
          else if (md.partRole === "library" && md.isNamedLibrary === true) bump(partOfSiteNamed, rel)
          else if (md.partRole === "library") bump(partOfSitePath, rel)
        }
        if (md.isAnnotation === true) {
          bump(annotationRefs, rel)
          const kind = String(md.annotatedKind ?? "unknown")
          let k = annotationRefsByKind.get(kind)
          if (!k) annotationRefsByKind.set(kind, (k = bucket()))
          bump(k, rel)
        }
        if (md.isMixinOn === true) bump(mixinOnRefs, rel)
      }
    }
    perRepo.push({
      repo,
      files: walked.length,
      seconds: Math.round((Date.now() - repoStart) / 1000),
      edges: Object.fromEntries([...repoEdges.entries()].sort((a, b) => b[1] - a[1])),
    })
    console.error(`  repo ${repo}: ${walked.length} files, ${Math.round((Date.now() - repoStart) / 1000)}s`)
  }

  const L: string[] = []
  const say = (s = "") => L.push(s)
  say("DART EXTENDED CENSUS — the four extended values over the WHOLE admitted population")
  say()
  say(`  corpus root     ${CR}`)
  say(`  population      ${files} files over ${repos.size} repos (git-tracked .dart, <= ${SIZE_CAP} bytes)`)
  say(`  parsed          ${parsed}   failed ${failed}`)
  say(`  wall clock      ${Math.round((Date.now() - start) / 1000)} s`)
  say()
  say("== THE PER-TYPE EDGE COUNTS (the analyzer's own emissions, over the whole population) ==")
  for (const t of TYPE_ORDER) {
    const b = edgesByType.get(t)!
    say(`  ${t.padEnd(14)} ${String(b.rows).padStart(9)} rows   ${String(b.files.size).padStart(6)} files`)
  }
  say()
  say("== THE TWO EXTENDED EMISSIONS (the values the lane emits and had not declared) ==")
  say(`  mixes_in            ${String(mixesInRows.rows).padStart(9)} rows   ${String(mixesInRows.files.size).padStart(6)} files`)
  say(`  part_of             ${String(partOfRows.rows).padStart(9)} rows   ${String(partOfRows.files.size).padStart(6)} files`)
  say(`    named-library form  'part of my.lib;'      ${String(partOfSiteNamed.rows).padStart(9)} rows   ${String(partOfSiteNamed.files.size).padStart(6)} files`)
  say(`    path form of 'part of'                     ${String(partOfSitePath.rows).padStart(9)} rows   ${String(partOfSitePath.files.size).padStart(6)} files`)
  say(`    path form of 'part'  'part 'x.dart';'      ${String(partSitePath.rows).padStart(9)} rows   ${String(partSitePath.files.size).padStart(6)} files`)
  say()
  say("== THE ANNOTATION POPULATION (the `decorates` near-miss census) ==")
  say(`  annotation NODES (the tree's own count)   ${String(annotationNodes.rows).padStart(9)}   ${String(annotationNodes.files.size)} files`)
  say(`    carrying ARGUMENTS (a const constructor invocation)  ${String(annotationNodesWithArgs.rows).padStart(9)}   ${String(annotationNodesWithArgs.files.size)} files`)
  say(`    bare marker (no arguments)                          ${String(annotationNodesBare.rows).padStart(9)}   ${String(annotationNodesBare.files.size)} files`)
  say(`  references{isAnnotation} ROWS (the emitted relation)   ${String(annotationRefs.rows).padStart(9)}   ${String(annotationRefs.files.size)} files`)
  for (const [kind, b] of [...annotationRefsByKind.entries()].sort((a, b) => b[1].rows - a[1].rows)) {
    say(`    ${kind.padEnd(28)} ${String(b.rows).padStart(9)}   ${String(b.files.size)} files`)
  }
  say(`  references{isMixinOn} ROWS                ${String(mixinOnRefs.rows).padStart(9)}   ${String(mixinOnRefs.files.size)} files`)
  say(`  THE MOST-USED ANNOTATION NAMES (top 25):`)
  for (const [name, n] of [...annotationNames.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25)) {
    say(`    ${String(n).padStart(8)}  ${name}`)
  }
  say()
  say("== THE NEAR-MISS NODE CENSUS (the constructs a ruling must NAME and COUNT) ==")
  for (const n of [...RENDER_NEAR_MISS, ...DECORATE_NEAR_MISS]) {
    const b = nodeCensus.get(n)!
    say(`  ${n.padEnd(24)} ${String(b.rows).padStart(9)} nodes   ${String(b.files.size).padStart(6)} files`)
  }
  say()
  say("== PER REPO (the edge counts the cell is derived from) ==")
  for (const r of perRepo) {
    say(`  ${r.repo}  (${r.files} files, ${r.seconds}s)`)
    for (const [t, n] of Object.entries(r.edges)) say(`     ${t.padEnd(14)} ${String(n).padStart(9)}`)
  }
  console.log(L.join("\n"))

  if (JSON_OUT) {
    writeFileSync(
      JSON_OUT,
      JSON.stringify(
        {
          instrument: "dart-extended-census",
          corpusRoot: CR,
          command: `BB_CORPUS_ROOT=${CR} bun run script/m14/dart-extended-census.ts --json ${JSON_OUT}`,
          population: { files, repos: repos.size, parsed, failed, sizeCap: SIZE_CAP },
          wallClockSeconds: Math.round((Date.now() - start) / 1000),
          edgesByType: Object.fromEntries([...edgesByType.entries()].map(([t, b]) => [t, { rows: b.rows, files: b.files.size }])),
          extended: {
            mixes_in: { rows: mixesInRows.rows, files: mixesInRows.files.size },
            part_of: {
              rows: partOfRows.rows,
              files: partOfRows.files.size,
              namedLibraryForm: { rows: partOfSiteNamed.rows, files: partOfSiteNamed.files.size },
              partOfPathForm: { rows: partOfSitePath.rows, files: partOfSitePath.files.size },
              partPathForm: { rows: partSitePath.rows, files: partSitePath.files.size },
            },
          },
          annotations: {
            nodes: annotationNodes.rows,
            nodeFiles: annotationNodes.files.size,
            withArguments: annotationNodesWithArgs.rows,
            bare: annotationNodesBare.rows,
            referencesRows: annotationRefs.rows,
            referencesFiles: annotationRefs.files.size,
            byAnnotatedKind: Object.fromEntries([...annotationRefsByKind.entries()].map(([k, b]) => [k, { rows: b.rows, files: b.files.size }])),
            topNames: [...annotationNames.entries()].sort((a, b) => b[1] - a[1]).slice(0, 50),
          },
          mixinOn: { rows: mixinOnRefs.rows, files: mixinOnRefs.files.size },
          nearMissNodes: Object.fromEntries([...nodeCensus.entries()].map(([n, b]) => [n, { rows: b.rows, files: b.files.size }])),
          perRepo,
        },
        null,
        2,
      ),
    )
    console.log(`WROTE ${JSON_OUT}`)
  }
}

await main()
