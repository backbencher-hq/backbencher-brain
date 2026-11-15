/**
 * M14 ONTOLOGY ADVERSARIAL PROBES — powershell (pass 3).
 *
 * ## Why this file exists, given `adversarial-probes.ts` already exists
 *
 * Pass 1 established that all ten types are EMITTED. Pass 2 attacked the LABEL of every
 * emitted type and found four defects. Pass 3 is the third half, and it exists because
 * of two specific things pass 2 left behind:
 *
 * 1. **A declared-UNSETTLED item on the lane's most trusted type.** Pass 2's P10 wrote
 *    down the strongest argument against `contains` — "lexical nesting is not ownership:
 *    a local declared inside a nested script block is lexically inside the function but
 *    is not owned by it" — measured only the structural half (0 self-edges), and
 *    **declared the nesting-depth half UNSETTLED rather than claiming it**. A declared
 *    open question is an unfinished measurement, so P12 below is that measurement.
 *
 * 2. **Arguments pass 2 did not make.** Pass 2 wrote the strongest argument it could
 *    find per type and stopped. Pass 3 asks a different question of each type: not "is
 *    the label right for the shape I picked" but "what OTHER shape does this code path
 *    accept, and what does the lane do with it". Each probe below names the shape, the
 *    code path that accepts it, and the count.
 *
 * ## The instrument discipline is unchanged from pass 2
 *
 *   · EDGE probes read PRODUCTION output — `parseFile` from `src/ast/pool-worker.ts`,
 *     never `analyze()`, because `analyze()` is a per-file unit that skips the pool, the
 *     size gates, the structural fallback and the enhancements.
 *   · TREE probes read the PARSE TREE through the same pinned wasm the engine loads
 *     (`getParser("powershell")` from `src/ast/engine.ts`).
 *
 * Corpus admission is byte-identical to `census.ts`, to `adversarial-probes.ts` and to
 * `script/m14/ontology-coverage-gate.ts`: `git ls-files` over every repo under
 * `BB_CORPUS_ROOT`, gated on `detectLanguageFromPath(abs, text) === "powershell"`, with
 * the same 512 KB size cap. One population, four instruments.
 *
 * Both halves shard across child processes, and shard failures are PRINTED. A zero from
 * a shard that died is not a measurement — it is the "empty result over a non-empty
 * corpus" shape honesty contract §5.4 refuses — so the shard-failure count is asserted
 * against the shard count before any probe verdict is trusted.
 *
 * Usage:
 *   npx tsx validation/m14/fixtures/powershell/pass3-probes.ts [--out path.json]
 *   npx tsx validation/m14/fixtures/powershell/pass3-probes.ts --only P12,P14
 */
import { execFileSync, spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../../../src/ast/language-detection"
import { parseFile } from "../../../../src/ast/pool-worker"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const LANG = "powershell"

const argv = process.argv.slice(2)
const outIdx = argv.indexOf("--out")
const OUT = outIdx >= 0 ? argv[outIdx + 1] : null
const onlyIdx = argv.indexOf("--only")
// No `onlyIdx >= 1` guard here: the first version of this file had one, on the theory
// that a flag in position 0 has no value. `--only P14` IS position 0 followed by its
// value, so the guard made an EMPTY selector — `want()` returned false for every probe,
// the run reported `0 probes recorded`, and wrote a JSON with an empty `results` array
// that reads exactly like a clean sweep. Absence of findings and absence of probes are
// the same file on disk, which is why this is fixed rather than noted.
const ONLY = onlyIdx >= 0
  ? new Set((argv[onlyIdx + 1] ?? "").split(",").map((s) => s.trim()).filter(Boolean))
  : null
const cacheIdx = argv.indexOf("--cache")
const CACHE = cacheIdx >= 0 ? argv[cacheIdx + 1] : null

// ---------------------------------------------------------------------------
// corpus admission — byte-identical to census.ts / adversarial-probes.ts
// ---------------------------------------------------------------------------
const admitted = (): string[] => {
  const out: string[] = []
  for (const repo of readdirSync(CR)) {
    const abs = path.join(CR, repo)
    let st
    try { st = statSync(abs) } catch { continue }
    if (!st.isDirectory()) continue
    let files: string[]
    try {
      files = execFileSync("git", ["-C", abs, "ls-files"], {
        encoding: "utf8", maxBuffer: 256 * 1024 * 1024,
      }).split("\n").filter(Boolean)
    } catch { continue }
    for (const rel of files) {
      const p = path.join(abs, rel)
      let text: string
      try {
        const s = statSync(p)
        if (!s.isFile() || s.size > 512 * 1024) continue
        text = readFileSync(p, "utf8")
      } catch { continue }
      if (detectLanguageFromPath(p, text) === LANG) out.push(p)
    }
  }
  return out.sort()
}

const REPOS = readdirSync(CR)
/** repo-relative label, so every printed path is findable in the corpus. */
const label = (p: string): string => {
  for (const repo of REPOS) {
    const abs = path.join(CR, repo)
    if (p.startsWith(abs + path.sep)) return repo + "/" + path.relative(abs, p)
  }
  return p
}

/** Strip ONE leading dash. `via` on an `exports` row is a flag (`-Function`), while on an
 *  `imports` row it is a form name (`Import-Module`, `requires_list`), so the two channels
 *  are compared the same way here without assuming a spelling. */
const stripLeadingDashText = (t: string): string =>
  t.length > 0 && t.charCodeAt(0) === 45 /* - */ ? t.slice(1) : t

// ---------------------------------------------------------------------------
// types
// ---------------------------------------------------------------------------
type Edge = {
  file: string
  source: string
  target: string
  type: string
  line: number
  confidence: number
  meta: Record<string, unknown>
}
type FileFacts = {
  file: string
  decls: {
    name: string
    line: number
    via: string
    analyzerOwner: string
    namedBlock: string
    childScopeInvoke: number
    sameScopeInvoke: number
  }[]
  blockNames: Record<string, number>
  namedBlockNodes: number
  errorNodes: number
  errorsMentioningClean: number
  classes: { name: string; base: string; line: number; chainDepth: number; members: { name: string; line: number }[] }[]
  transitiveOverridePairs: { derived: string; base: string; member: string; hops: number; line: number }[]
  directPairs: { derived: string; base: string; member: string; hops: number; line: number }[]
}
type Finding = {
  probe: string
  type: string
  argument: string
  instrument: string
  measurement: unknown
  verdict: string
  overturn: string
}

const results: Finding[] = []
const record = (f: Finding) => {
  results.push(f)
  console.log(`\n=== ${f.probe} — ${f.type} ===`)
  console.log(`ARGUMENT   ${f.argument}`)
  console.log(`INSTRUMENT ${f.instrument}`)
  console.log(`MEASURED   ${typeof f.measurement === "string" ? f.measurement : JSON.stringify(f.measurement, null, 1)}`)
  console.log(`VERDICT    ${f.verdict}`)
  console.log(`OVERTURN   ${f.overturn}`)
}

const files = admitted()
console.log(`admitted ${files.length} powershell files`)
const L = label

// ---------------------------------------------------------------------------
// P12  contains — lexical nesting vs PowerShell's OWN scope rule.
//
// This is the item pass 2 declared UNSETTLED. The argument, in the form that can fail:
//
//   `addContains` reads `top().owner`, and `top().owner` is pushed at exactly four
//   node types (frames.push: function_statement, class_statement, enum_statement,
//   class_method_definition, plus three DSC/interface sites). `named_block` is NOT one of
//   them. `named_block` is how the grammar spells `begin` / `process` / `end` /
//   `dynamicparam`, and PowerShell runs each of those in its OWN scope — a variable
//   assigned in `process` is not visible in `end` without `$script:`. So
//   `contains fn -> x` where `$x` is assigned inside `process` asserts that the function
//   OWNS `$x`, and the language says the binding died with the block.
//
//   The same argument applies to `& { … }`: the call operator invokes in a CHILD scope,
//   so a variable assigned inside it does not outlive it. `. { … }` does NOT — a
//   dot-invoked script block runs in the current scope — so the control is measured too.
//
//   The instrument is B: for every declaration site on the parse tree, find the nearest
//   ancestor in the ANALYZER's owner set and the nearest `named_block`, and count the
//   declarations where a `named_block` sits BETWEEN the declaration and the owner. A text
//   probe cannot do this: `begin` inside a string literal is a string.
// ---------------------------------------------------------------------------
const p12 = (tree: FileFacts[]) => {
  const totalDecls = tree.reduce((a, f) => a + f.decls.length, 0)
  const byVia: Record<string, number> = Object.create(null)
  const blockNames: Record<string, number> = Object.create(null)
  let namedBlockNodes = 0
  let filesWithNamedBlocks = 0
  for (const f of tree) {
    for (const d of f.decls) byVia[d.via] = (byVia[d.via] ?? 0) + 1
    for (const [k, v] of Object.entries(f.blockNames)) blockNames[k] = (blockNames[k] ?? 0) + v
    namedBlockNodes += f.namedBlockNodes
    if (f.namedBlockNodes > 0) filesWithNamedBlocks++
  }

  // The divergence: a declaration whose nearest enclosing `named_block` is INSIDE the
  // owner the analyzer will attribute it to. `namedBlock` is "" for the overwhelming
  // majority, and those are the control.
  const inNamedBlock = tree.flatMap((f) =>
    f.decls.filter((d) => d.namedBlock !== "").map((d) => ({ file: L(f.file), ...d })),
  )
  // The control that makes the count mean something: declarations that sit in the
  // owner's OWN body, where lexical nesting and ownership agree.
  const inOwnerBody = tree.reduce(
    (a, f) => a + f.decls.filter((d) => d.namedBlock === "" && d.via !== "property").length, 0)

  // `& { … }` — a CHILD scope. `. { … }` — the SAME scope, so an edge there is right.
  // Both carry the file, because a finding that names no file cannot be acted on.
  const childScope = tree.flatMap((f) => f.decls.filter((d) => d.childScopeInvoke === 1).map((d) => ({ file: L(f.file), ...d })))
  const sameScope = tree.flatMap((f) => f.decls.filter((d) => d.sameScopeInvoke === 1).map((d) => ({ file: L(f.file), ...d })))
  // The control for the child-scope test: the SAME declarations in the same files, minus
  // the ones inside an invocation, so a positive count cannot be an artifact of the
  // corpus simply containing advanced functions.
  const advancedFunctions = tree.flatMap((f) =>
    f.classes.length === 0 && f.namedBlockNodes > 0 ? [L(f.file)] : [],
  )

  record({
    probe: "P12",
    type: "contains",
    argument:
      "`addContains` reads `top().owner`, and the owner frame is pushed at exactly four node types — " +
      "`function_statement`, `class_statement`, `enum_statement`, `class_method_definition` " +
      "(real-powershell-analyzer.ts:1544, :1627, :1639, :1697) plus three DSC/interface sites. `named_block` is NOT one of them, and `named_block` is how the grammar spells `begin` / `process` / `end` / `dynamicparam`. PowerShell runs each of those in its OWN scope, so a variable assigned in `process` is not visible in `end` without `$script:`. The `contains` edge therefore asserts the function OWNS the variable, and the language says the binding ended with the block. The same argument applies to `& { … }`, which invokes in a child scope, and NOT to `. { … }`, which runs in the current scope — so both are measured.",
    instrument:
      "B:parse-tree-count. Every declaration site on the pinned wasm is located (assignment LHS, `foreach` iteration variable, `script_parameter`, class property) and its nearest ancestor in the ANALYZER's own four-node owner set is compared with its nearest ancestor in the ANALYZER'S SET PLUS `named_block`. The two rules are named in `_p3-tree-worker.ts` and the analyzer's rule is derived from the seven `frames.push` sites, not assumed. A text probe cannot do this: `begin` inside a string literal is a string.",
    measurement: {
      declarationSitesFound: totalDecls,
      declarationSitesByKind: byVia,
      namedBlockNodesOnCorpus: namedBlockNodes,
      filesCarryingNamedBlocks: filesWithNamedBlocks,
      blockNameInventory: blockNames,
      filesWhoseOnlyDeclarationsAreClassScopedAndNamedBlockBearing: advancedFunctions.length,
      // THE ANSWER TO THE DECLARED-UNSETTLED QUESTION.
      declarationsInsideANamedBlock_whereContainsCrossesAPowerShellScopeBoundary: inNamedBlock.length,
      declarationsInTheOwnersOwnBody_theControl: inOwnerBody,
      divergenceRateAgainstTheControl: inOwnerBody === 0 ? "n/a" : `${((inNamedBlock.length / inOwnerBody) * 100).toFixed(2)}%`,
      inNamedBlockByBlockName: inNamedBlock.reduce<Record<string, number>>((a, d) => { a[d.namedBlock] = (a[d.namedBlock] ?? 0) + 1; return a }, {}),
      inNamedBlockByVia: inNamedBlock.reduce<Record<string, number>>((a, d) => { a[d.via] = (a[d.via] ?? 0) + 1; return a }, {}),
      inNamedBlockSamples: inNamedBlock.slice(0, 20).map((d) => ({ file: d.file, line: d.line, name: d.name, block: d.namedBlock, owner: d.analyzerOwner, via: d.via })),
      declarationsInsideAnAmpersandChildScopeInvocation: childScope.length,
      declarationsInsideADotSameScopeInvocation_theControl: sameScope.length,
      childScopeSamples: childScope.slice(0, 20).map((d) => ({ file: d.file, line: d.line, name: d.name, owner: d.analyzerOwner })),
    },
    verdict:
      inNamedBlock.length === 0 && childScope.length === 0
        ? "SETTLED-HOLDS — no declaration on the corpus sits inside a construct PowerShell gives a separate scope, so `contains` and PowerShell's own scoping agree on every edge the corpus carries"
        : `MEASURED, AND NOT ZERO — ${inNamedBlock.length} declaration(s) sit inside a \`named_block\` and ${childScope.length} inside a \`&\` child-scope invocation, so the UNSETTLED half is now a NUMBER rather than an omission`,
    overturn:
      "a declaration site whose nearest `named_block` ancestor lies between it and the owner frame would mean `contains` crosses a PowerShell scope boundary. The measurement counts exactly that, so the count IS the finding: 0 makes `contains` correct on this corpus, and any non-zero count makes it a quantified over-claim on the lane's most trusted type rather than an unknown one.",
  })
}

// ---------------------------------------------------------------------------
// P13  calls — the invocation operator, and the file-level seam it cannot reach.
//
// ARGUMENT: `. ./lib.ps1` and `& ./run.ps1` publish ONE `calls` edge carrying
// `metadata.invokationOperator` and NOTHING ELSE (real-powershell-analyzer.ts:2252).
// The store decides an edge is a FILE-LEVEL dependency from one key —
// `rel.metadata?.fileLevel === true` at src/ast/parallel-indexer.ts:3481 — and when it
// is, `source_external` becomes the PROJECT-RELATIVE PATH. So a dot-sourced file
// dependency in PowerShell is stored with `source_id = null` and the analyzer's own bare
// file-name spelling, and no file-level surface can answer "what does this file
// include". The lane sets `fileLevel` on its OTHER file-level edges (imports at :1367,
// exports at :1436, #requires at :2431), so this is an asymmetry INSIDE the lane rather
// than a project-wide convention nobody adopted.
//
// The dot-source is also the same construct as bash's `source ./x.sh`, which the lane's
// own PS23 section cites as the precedent for emitting BOTH `imports` and `references`.
// The difference between `.` and `&` is real and is the reason a fix is not simply "emit
// both": `.` executes in the CURRENT scope, which is a dependency; `&` executes in a
// child scope, which is a script INVOCATION and belongs where it is.
//
// INSTRUMENT: edge reading on production output, plus the store's own source line.
// ---------------------------------------------------------------------------
const p13 = (edges: Edge[]) => {
  const inv = edges.filter((e) => e.meta.invokationOperator !== undefined)
  const dot = inv.filter((e) => String(e.meta.invokationOperator) === ".")
  const amp = inv.filter((e) => String(e.meta.invokationOperator) === "&")
  const withFileLevel = inv.filter((e) => e.meta.fileLevel === true)
  // The control: the lane's OTHER file-level edges, which DO carry the key. If these are
  // also 0 then `fileLevel` is dead project-wide and the finding is not the lane's.
  const otherFileLevel = edges.filter((e) => e.meta.fileLevel === true)
  const otherByType: Record<string, number> = Object.create(null)
  for (const e of otherFileLevel) otherByType[e.type] = (otherByType[e.type] ?? 0) + 1

  record({
    probe: "P13",
    type: "calls",
    argument:
      "`. ./lib.ps1` publishes one `calls` edge carrying `metadata.invokationOperator` and nothing else. The store recognises a FILE-LEVEL dependency from exactly one key — `rel.metadata?.fileLevel === true` (src/ast/parallel-indexer.ts:3481) — and only then sets `source_external` to the project-relative path. So a PowerShell dot-source is a file dependency the file-level surfaces cannot see, while the lane's imports, exports and #requires edges all carry the key. `.` executes in the CURRENT scope (a dependency); `&` executes in a child scope (a script invocation), so the two are counted separately rather than lumped.",
    instrument:
      "production `parseFile` edge reading, classified by `metadata.invokationOperator`, cross-read against the store's own predicate at src/ast/parallel-indexer.ts:3481 and against the lane's other `fileLevel` emitters (real-powershell-analyzer.ts:1367, :1436, :2431)",
    measurement: {
      callsEdgesWithAnInvocationOperator: inv.length,
      dotSourceOperator: dot.length,
      ampersandOperator: amp.length,
      ofWhichCarryFileLevel: withFileLevel.length,
      dotSourceTargetsSample: dot.slice(0, 20).map((e) => ({ target: e.target, source: e.source, line: e.line, file: L(e.file) })),
      ampersandTargetsSample: amp.slice(0, 20).map((e) => ({ target: e.target, source: e.source, line: e.line, file: L(e.file) })),
      dotSourceDistinctTargets: [...new Set(dot.map((e) => e.target))].slice(0, 30),
      ampersandDistinctTargets: [...new Set(amp.map((e) => e.target))].slice(0, 30),
      // THE CONTROL: is `fileLevel` dead project-wide, or live everywhere but here?
      edgesCarryingFileLevelAnywhereInTheLane: otherFileLevel.length,
      fileLevelByRelationshipType: otherByType,
      storePredicate: "src/ast/parallel-indexer.ts:3481 — `if (!sourceSymbol && rel.metadata?.fileLevel === true)`",
    },
    verdict:
      withFileLevel.length > 0
        ? "HOLDS — at least one invocation-operator edge already reaches the file-level seam"
        : otherFileLevel.length === 0
          ? "NOT-THE-LANE'S — `fileLevel` is 0 on every edge in the lane, so the seam is unreachable from PowerShell for a reason that is not this code path"
          : `MEASURED — ${dot.length} dot-source and ${amp.length} call-operator edges reach the store with no \`fileLevel\`, while ${otherFileLevel.length} other edges in the same lane carry it. The lane knows the key and this path does not set it.`,
    overturn:
      "an invocation-operator edge carrying `metadata.fileLevel === true` would mean the seam already sees it; 0 of N against a non-zero control elsewhere in the lane makes the asymmetry the finding. If the CONTROL were also 0 the finding would move to the project, not to this lane.",
  })
}

// ---------------------------------------------------------------------------
// P14  instantiates — the target can be a VARIABLE holding a type name.
//
// ARGUMENT: `New-Object`'s constructed name is `comObject ?? typeName ?? positional`
// (real-powershell-analyzer.ts:2317). `parameterValue` only accepts a
// `generic_token` / `string_literal` / `expandable_string_literal` (":2610"), so a
// `-TypeName $t` is refused — but `commandArgs` DOES return a variable for the
// positional form, `stripDollar`'d (":1291-1293"). So `New-Object $type` publishes
// `instantiates -> type`, and `type` is a VARIABLE the same file declares. The edge says
// "constructs a type named `type`"; the source says "constructs whatever that variable
// holds". This is the SAME defect class the lane already declares fixed for `calls` —
// F9 changed `$type::$method()` from `calls -> $method` to `uses -> method` precisely
// because a `$`-prefixed member is a variable, not a name — so `instantiates` is the
// channel that did not get the same treatment.
//
// INSTRUMENT: edge reading PLUS the same file's symbol table, which is what makes this
// decisive: if the target names a `variable` symbol in the SAME file, it is provably not
// a type name, whatever the string looks like.
// ---------------------------------------------------------------------------
const p14 = async (perFile: { file: string; symbols: { name: string; kind: string }[]; edges: Record<string, unknown>[] }[]) => {
  const inst: Edge[] = []
  for (const g of perFile) {
    for (const x of g.edges) {
      if (String(x.type) !== "instantiates") continue
      inst.push({ file: g.file, source: String(x.source), target: String(x.target), type: "instantiates", line: Number(x.line), confidence: Number(x.confidence), meta: (x.meta ?? {}) as Record<string, unknown> })
    }
  }
  // Index each file's own symbol table, so "is the target a variable" is answerable
  // from THIS file rather than from a corpus-wide name collision.
  const byFileSyms = new Map<string, Map<string, string>>()
  for (const g of perFile) {
    const m = new Map<string, string>()
    for (const s of g.symbols) m.set(s.name.toLowerCase(), s.kind)
    byFileSyms.set(g.file, m)
  }
  const rows = inst.map((e) => {
    const kind = byFileSyms.get(e.file)?.get(e.target.toLowerCase())
    return { ...e, fileLabel: L(e.file), ownKind: kind ?? "(not declared in this file)" }
  })

  // ARRIVAL ROUTE, and this partition is the whole correction. The first version of this
  // probe joined every `instantiates` target against the publishing file's variable table
  // and reported 123 offenders — 9.70% of the type — which would have been reported as the
  // size of the defect. It is not. The two routes that reach `instantiates` are:
  //
  //   `viaNewObject` — `New-Object X`, where X is a command ARGUMENT and can be a
  //                    variable. This is the only route that can be wrong.
  //   `dotNetNew`    — `[T]::new()`, where T is read off a `type_literal` / `type_spec`
  //                    node. A type name here is a TYPE by construction, and it can
  //                    coincide with a variable declared in the same file:
  //                    `powershell/build.psm1:4053` is `$assemblies = [assemblies]::new()`,
  //                    which declares a variable whose name IS the type it constructs. The
  //                    join cannot tell that from a defect, and 82 of the 123 were exactly
  //                    this — `assemblies`, `test`, `GZipStream`, `Version`.
  //
  // So the honest count is over ONE route, and the other route's collisions are reported
  // as the measurement that explains the over-count. A name join across both routes
  // cannot separate "a variable used as a type name" from "a type that shares a variable's
  // name", and reporting the sum as a defect size is the fabrication rule running
  // backwards — in the direction of accusing correct code.
  const newObjectRoute = rows.filter((r) => r.meta.viaNewObject === true)
  const dotNetRoute = rows.filter((r) => r.meta.dotNetNew === true)
  const noRoute = rows.filter((r) => r.meta.viaNewObject !== true && r.meta.dotNetNew !== true)
  const newObjectNamingAVariable = newObjectRoute.filter((r) => r.ownKind === "variable")
  const dotNetNamingAVariable = dotNetRoute.filter((r) => r.ownKind === "variable")
  const noRouteNamingAVariable = noRoute.filter((r) => r.ownKind === "variable")
  const suspect = [...newObjectNamingAVariable, ...noRouteNamingAVariable]
  // A name join cannot separate "a variable used as a type name" from "a TYPE whose name
  // coincides with a variable's name", and the second case is not rare in PowerShell,
  // because a class and a variable of the same name coexist happily:
  // `New-Object Point 100,200` at
  // powershell/test/powershell/Language/Classes/Scripting.Classes.BasicParsing.Tests.ps1:563
  // constructs `class Point` (declared at :541) and assigns the result to `$point`, so the
  // target `Point` names a class AND, case-insensitively, a variable. The edge is correct
  // and the join cannot tell. So every suspect row below carries its file and line for a
  // reader to adjudicate, and the authoritative defect count is the SOURCE-NODE one the
  // census delta measures — not this join.
  const targetIsOwnFunctionOrClass = rows.filter((r) => r.ownKind === "function" || r.ownKind === "class" || r.ownKind === "enum")
  const sigilTargets = rows.filter((r) => r.target.startsWith("$"))
  const undeclared = rows.filter((r) => r.ownKind === "(not declared in this file)")

  // A controlled probe through PRODUCTION parseFile, so the reading is not asserted.
  const probeSource = [
    "$type = 'System.Version'",
    "$t = 'System.Text.StringBuilder'",
    "function New-Thing {",
    "  $a = New-Object $type",
    "  $b = New-Object -TypeName $t",
    "  $c = New-Object -ComObject $progId",
    "  $d = New-Object \"$type\"",
    "  $e = New-Object System.Collections.ArrayList",
    "  $f = [System.Text.StringBuilder]::new()",
    "}",
  ].join("\n") + "\n"
  const probeFile = path.join(os.tmpdir(), `ps-p3-p14-${process.pid}.ps1`)
  writeFileSync(probeFile, probeSource, "utf8")
  let probeOut: unknown = null
  try {
    const r = await parseFile(probeFile, path.dirname(probeFile))
    const syms = new Map<string, string>()
    for (const s of (r.symbols ?? []) as { name: string; kind: string }[]) syms.set(String(s.name).toLowerCase(), String(s.kind))
    probeOut = (r.relationships ?? [])
      .filter((x: { type: string }) => String(x.type) === "instantiates")
      .map((x: { source: string; target: string; line_number: number }) => ({
        target: String(x.target),
        line: Number(x.line_number),
        targetIsDeclaredVariableInThisFile: syms.get(String(x.target).toLowerCase()) === "variable",
      }))
  } catch (e) {
    probeOut = { error: String(e) }
  } finally {
    rmSync(probeFile, { force: true })
  }

  record({
    probe: "P14",
    type: "instantiates",
    argument:
      "`New-Object`'s constructed name is `comObject ?? typeName ?? positional` (real-powershell-analyzer.ts:2317). `parameterValue` accepts only a generic_token / string_literal / expandable_string_literal (:2610), so a flagged `-TypeName $t` is refused — but `commandArgs` returns a VARIABLE for the positional form, `stripDollar`'d (:1291-1293). So `New-Object $type` publishes `instantiates -> type` where `type` is a variable the same file declares: the edge says \"constructs a type named type\" and the source says \"constructs whatever that variable holds\". This is the class the lane already declares fixed for `calls` — F9 turned `$type::$method()` from `calls -> $method` into `uses -> method` because a `$`-prefixed member is a variable, not a name — so `instantiates` is the channel that did not get the same treatment.",
    instrument:
      "production `parseFile` edge reading CROSS-REFERENCED AGAINST THE SAME FILE'S SYMBOL TABLE. That cross-reference is what makes the reading decisive: a target that names a `variable` symbol in the file that published it is provably not a type name, whatever the string looks like. Plus a controlled 11-line probe file through parseFile, because the corpus may not exercise the shape and an unexercised shape is not a clean one.",
    measurement: {
      instantiatesEdges: inst.length,
      byArrivalRoute: {
        NewObject_viaNewObject: newObjectRoute.length,
        DotNetNew_dotNetNew: dotNetRoute.length,
        neitherKey: noRoute.length,
      },
      // THE DEFECT COUNT — over the one route whose target is a command ARGUMENT.
      newObjectTargetsThatAreAVariableDeclaredInTheSameFile: newObjectNamingAVariable.length,
      newObjectSuspectSamples: newObjectNamingAVariable.slice(0, 10).map((r) => ({
        target: r.target, line: r.line, file: r.fileLabel,
        readsAs: "adjudicate at the source line — a name join cannot separate a variable used as a type name from a TYPE that shares a variable's name (`New-Object Point` constructing `class Point` is the corpus example)",
      })),
      targetsWithNoRouteKeyThatAreAVariableInTheSameFile: noRouteNamingAVariable.length,
      defectEdges_total: suspect.length,
      // THE EXPLANATION FOR A 2-3x OVER-COUNT, and the reason the routes are separated.
      dotNetNewTargetsThatShareANameWithAVariableInTheSameFile_NOT_DEFECTS: dotNetNamingAVariable.length,
      dotNetCollisionSamples: dotNetNamingAVariable.slice(0, 12).map((r) => ({
        target: r.target, line: r.line, file: r.fileLabel,
      })),
      targetsThatAreAFunctionClassOrEnumInTheSameFile: targetIsOwnFunctionOrClass.length,
      targetsBeginningWithADollarSigil: sigilTargets.length,
      sigilSamples: sigilTargets.slice(0, 15).map((r) => ({ target: r.target, line: r.line, file: r.fileLabel })),
      targetsNotDeclaredInTheirOwnFile_the_normalCase: undeclared.length,
      ownVariableSamples: suspect.slice(0, 20).map((r) => ({ target: r.target, source: r.source, line: r.line, file: r.fileLabel, route: r.meta.viaNewObject === true ? "New-Object" : r.meta.dotNetNew === true ? "[T]::new" : "(none)", meta: r.meta })),
      ownFunctionOrClassSamples: targetIsOwnFunctionOrClass.slice(0, 10).map((r) => ({ target: r.target, line: r.line, file: r.fileLabel })),
      controlledProbeInstantiatesTargets: probeOut,
    },
    verdict:
      suspect.length > 0
        ? `${suspect.length} \`New-Object\` target(s) name a variable their own file declares — ADJUDICATE at the source lines listed. A name join cannot separate a variable used as a type name from a TYPE sharing a variable's name, so this probe reports the count and the lines rather than a verdict it cannot support. The authoritative number is the census delta, which counts the SOURCE NODE and is not subject to this ambiguity.`
        : sigilTargets.length > 0
          ? `WRONG on ${sigilTargets.length} edge(s) — the sigil reached the target, which is the residue class F9 fixed for \`calls\``
          : "HOLDS — no `New-Object` target names a variable its own file declares, on either the flagged or the positional route. The `[T]::new()` route is excluded from the count BY MEASUREMENT rather than by assumption: it contributes " +
            `${dotNetNamingAVariable.length} name collisions, every one of them a type that shares a variable's name (\`$assemblies = [assemblies]::new()\`), which is a correct edge.`,
    overturn:
      "an `instantiates` edge ARRIVING BY `New-Object` whose target resolves to a `variable` symbol in the publishing file is a variable used as a type name. An edge arriving by `[T]::new()` cannot be one — its target is read off a type node — so the routes are counted separately and the second route's name collisions are reported as collisions. Adding them together is how the first version of this probe reported 123 defects where there were 41, and accusing 82 correct edges is the fabrication rule running backwards.",
  })
}

// ---------------------------------------------------------------------------
// P15  overrides — the resolution loop walks the chain; does the corpus exercise it?
//
// ARGUMENT (for the LABEL being right, not wrong): `overrides` matches a subclass member
// against its base's members and `break`s at the first hit (real-powershell-analyzer.ts:
// :2452-2485). The loop walks `baseClassByClass` up to 8 hops, so a member inherited
// through an INTERMEDIATE class that does not redeclare it is still matched. Reading the
// source cannot say whether any corpus file is three levels deep, and a type that fires
// only on two-level chains is untested on the third. This probe counts the
// transitive pairs the TREE holds and compares them with the edges the analyzer emits.
//
// INSTRUMENT B for the population, production edges for the comparison.
// ---------------------------------------------------------------------------
const p15 = (tree: FileFacts[], edges: Edge[]) => {
  const ov = edges.filter((e) => e.type === "overrides")
  const key = (file: string, d: string, b: string, m: string) => `${file}\u0000${d}\u0000${b}\u0000${m.toLowerCase()}`
  const ovByFileMember = new Set(ov.map((e) => key(L(e.file), e.source, e.target, String(e.meta.overridesMember ?? ""))))
  // FIRST-MATCH-WINS, because that is what the analyzer does: `break` at the first hop
  // that declares the member (real-powershell-analyzer.ts:2482). The first version of
  // this probe walked the whole chain and recorded a pair at EVERY matching hop, so
  // `class D : C : A` with `GetName` on both C and A produced `D -> A`, the join found no
  // such edge, and the probe printed `WRONG (under-firing) — 1 of 1 transitive pairs are
  // in the tree and not in the output`. The analyzer had published `D -> C` and was
  // RIGHT — PowerShell resolves `D.GetName` to the NEAREST declaration in the chain.
  // A probe that does not model the rule it audits manufactures a defect; that is the
  // failure mode honesty contract §5.4 refuses, and it is recorded here rather than
  // quietly corrected because the false reading was produced and then withdrawn.
  const pairs = tree.flatMap((f) => f.transitiveOverridePairs.map((p) => ({ file: L(f.file), ...p })))
  const direct = tree.flatMap((f) => f.directPairs.map((p) => ({ file: L(f.file), ...p })))
  const emitted = pairs.filter((p) => ovByFileMember.has(key(p.file, p.derived, p.base, p.member)))
  const missed = pairs.filter((p) => !ovByFileMember.has(key(p.file, p.derived, p.base, p.member)))
  const directEmitted = direct.filter((p) => ovByFileMember.has(key(p.file, p.derived, p.base, p.member)))
  const depthHistogram: Record<string, number> = Object.create(null)
  for (const c of tree.flatMap((f) => f.classes)) depthHistogram[String(c.chainDepth)] = (depthHistogram[String(c.chainDepth)] ?? 0) + 1

  record({
    probe: "P15",
    type: "overrides",
    argument:
      "The `overrides` resolution loop walks `baseClassByClass` up to 8 hops and `break`s at the FIRST hop that declares the member (:2452-2485), so a member inherited through an INTERMEDIATE class that does not redeclare it is matched at hop 2+. Source derivation cannot say whether any corpus file is deep enough to exercise that, and a chain-walk verified only on two-level chains is a chain-walk nobody ran. The probe counts the transitive pairs the TREE holds and asks whether the analyzer publishes each one.",
    instrument:
      "B:parse-tree-count for the population (class headers walked to their base, member names compared case-insensitively as PS28 requires), under FIRST-MATCH-WINS so the population is the one the analyzer can publish, then an exact join against the production `overrides` edges on (file, derived, base, member). The hop-1 population is reported as the control, because a probe that finds no transitive pair and no control cannot tell 'correct' from 'never ran'.",
    measurement: {
      analyzerOverridesEdges: ov.length,
      classChainDepthHistogram_0meansNoBaseDeclaredInTheSameFile: depthHistogram,
      classesAtDepth3OrMore: tree.flatMap((f) => f.classes).filter((c) => c.chainDepth >= 3).length,
      hop1Pairs_theControl: direct.length,
      hop1PairsTheAnalyzerPublishes: directEmitted.length,
      transitivePairsTheTreeHolds: pairs.length,
      transitivePairsTheAnalyzerPublishes: emitted.length,
      transitivePairsItMisses: missed.length,
      missedSamples: missed.slice(0, 20),
      transitiveSamples: pairs.slice(0, 20),
    },
    verdict:
      missed.length > 0
        ? `WRONG (under-firing) — ${missed.length} of ${pairs.length} transitive pairs are in the tree and not in the output`
        : pairs.length === 0
          ? direct.length === 0
            ? "UNTESTED — no same-name pair survives in the corpus at any hop, so the matcher is unexercised here and the claim rests on reading the loop, not on a measurement"
            : `UNTESTED AT DEPTH — ${direct.length} hop-1 pair(s) exist and ${directEmitted.length} of them are published, so the matcher is exercised and correct at hop 1; the hop-2+ branch is UNEXERCISED because the corpus has 0 transitive pairs. That is a different finding from "correct" and is reported as it.`
          : "HOLDS — every transitive pair the tree holds is published",
    overturn:
      "a derived/base member pair whose matching base member is 2+ hops up AND whose chain declares the member nowhere nearer is a pair the loop is supposed to publish. 0 such pairs in the corpus means the shape is untested rather than correct, and the two are different findings. A nonzero MISSED count against this first-match-wins population would be a real under-emission.",
  })
}

// ---------------------------------------------------------------------------
// P16  uses — does it ever name something the same file DECLARES as callable?
//
// ARGUMENT: `uses` is the lane's largest type at 64k edges and its rule is "a name READ
// rather than invoked". The strongest available counter-example is a `uses` edge whose
// target is a name the SAME FILE declares as a function, class or enum — because a
// consumer reading `uses` would conclude the file merely reads a name that is in fact a
// declaration, or worse, that the edge and a `calls` edge describe the same
// construction twice. Cross-referencing the edge against the file's own symbol table
// answers it without a judgement call about intent.
//
// INSTRUMENT: production edges against the same file's symbols.
// ---------------------------------------------------------------------------
const p16 = (perFile: { file: string; symbols: { name: string; kind: string }[]; edges: Record<string, unknown>[] }[]) => {
  const rows: Edge[] = []
  for (const g of perFile) {
    const syms = new Map<string, string>()
    for (const s of g.symbols) syms.set(s.name.toLowerCase(), s.kind)
    for (const x of g.edges) {
      if (String(x.type) !== "uses") continue
      const target = String(x.target)
      const kind = syms.get(target.toLowerCase())
      if (kind === undefined) continue
      rows.push({
        file: g.file, source: String(x.source), target, type: "uses",
        line: Number(x.line), confidence: Number(x.confidence),
        meta: { ...(x.meta as Record<string, unknown>), ownKind: kind },
      })
    }
  }
  const DECLARABLE = new Set(["function", "class", "enum", "method", "constructor", "interface"])
  const namingADeclaration = rows.filter((r) => DECLARABLE.has(String(r.meta.ownKind)))
  // The control: how many `uses` edges name a variable or property the same file declares.
  // Without it, "naming a declaration" could just reflect the corpus's shape.
  const namingALocal = rows.filter((r) => r.meta.ownKind === "variable" || r.meta.ownKind === "property")
  const byKind: Record<string, number> = Object.create(null)
  for (const r of namingADeclaration) byKind[String(r.meta.ownKind)] = (byKind[String(r.meta.ownKind)] ?? 0) + 1

  record({
    probe: "P16",
    type: "uses",
    argument:
      "`uses` is the lane's rule \"a name READ rather than invoked\" and it is the largest type in the lane. The strongest available counter-example is a `uses` edge whose target the SAME FILE declares as a function, class or enum: a consumer reading the edge would conclude the file reads a name, when the name is a declaration in that very file. Cross-referencing the edge against the file's own symbol table settles it without a judgement call about author intent.",
    instrument:
      "production `parseFile` edge reading joined against the SAME FILE's symbol table by lowercased name (PowerShell identifiers are case-insensitive, which PS28 established for `overrides` and `pushSymbol` states in so many words). The join is deliberately within-file: a corpus-wide name match would report pairs of unrelated files, which is a different question.",
    measurement: {
      usesEdgesNamingASymbolDeclaredInTheirOwnFile: rows.length,
      ofWhichTheTargetIsADECLARATION_function_class_enum_method_constructor_interface: namingADeclaration.length,
      byDeclarationKind: byKind,
      namingALocal_variable_or_property_THE_CONTROL: namingALocal.length,
      samples: namingADeclaration.slice(0, 25).map((r) => ({
        target: r.target, ownKind: r.meta.ownKind, source: r.source, line: r.line,
        file: L(r.file), isMemberAccess: r.meta.isMemberAccess === true,
      })),
    },
    verdict:
      namingADeclaration.length === 0
        ? "HOLDS — no `uses` edge in the corpus names a declaration its own file makes"
        : namingALocal.length > 0
          ? "QUALIFIED — some `uses` edges name a declaration in their own file, and the control shows the same join fires on locals, so the reading needs the source line per case rather than a count"
          : "WRONG — `uses` names a declaration in its own file and the control is empty",
    overturn:
      "a `uses` edge whose target is a `function`/`class`/`enum`/`method`/`constructor` symbol declared in the PUBLISHING file. The control (`uses` edges naming a local in the same file) is what separates \"this shape is rare\" from \"this shape is wrong\", so it is reported beside the count and a large count with a large control is a different finding from a large count with an empty one.",
  })
}

// ---------------------------------------------------------------------------
// P17  contains / symbols — `clean { }` is a PowerShell block the grammar does not have.
//
// ARGUMENT: the doc's declared-limitations table lists 6 grammar limits and none of them
// is `clean`. `begin`, `process`, `end` and `dynamicparam` all parse as
// `named_block`/`block_name`; `clean` does not, and the ERROR it leaves is not local —
// on a controlled probe it consumed the NEXT function declaration, so a symbol the file
// really declares is absent from the graph. This is a property of the pinned wasm, so it
// is a finding for the grammar owner, and what the probe measures is how much of it the
// CORPUS carries, which is what decides whether it is a limit or a non-issue.
//
// INSTRUMENT B.
// ---------------------------------------------------------------------------
const p17 = (tree: FileFacts[]) => {
  const inventory: Record<string, number> = Object.create(null)
  for (const f of tree) for (const [k, v] of Object.entries(f.blockNames)) inventory[k] = (inventory[k] ?? 0) + v
  const withCleanError = tree.filter((f) => f.errorsMentioningClean > 0)
  const cleanErrors = tree.reduce((a, f) => a + f.errorsMentioningClean, 0)
  const filesWithAnyError = tree.filter((f) => f.errorNodes > 0).length
  const totalErrors = tree.reduce((a, f) => a + f.errorNodes, 0)

  // A controlled reproduction is run separately through the pinned wasm; the corpus
  // counts here are what decide whether the limit costs this corpus anything.
  const controlledShapes = [
    "function A {\n  begin { $a = 1 }\n  process { $b = 2 }\n  end { $c = 3 }\n  dynamicparam { $p = 4 }\n}",
    "function A {\n  begin { $a = 1 }\n  clean { $z = 5 }\n}\nfunction B { $kept = 9 }",
  ]

  record({
    probe: "P17",
    type: "contains (and every type: the loss is upstream of the analyzer)",
    argument:
      "`begin`, `process`, `end` and `dynamicparam` all parse as `named_block` + `block_name`. `clean` does not, and the ERROR it leaves is not local: on a controlled probe it consumed the FOLLOWING `function` declaration, so a symbol the file really declares is absent from every channel. The declared-limitations table lists 6 grammar limits and this is not one of them.",
    instrument:
      "B:grammar-inventory — every `block_name` text the pinned wasm produces across the whole corpus, plus every ERROR node whose text carries `clean`. A text probe cannot count this: `clean` inside a string literal is a string, and the inventory is a property of the TREE.",
    measurement: {
      blockNameInventoryAcrossCorpus: inventory,
      blockNamesTheGrammarKnows: Object.keys(inventory).sort(),
      corpusFilesParsed: tree.length,
      corpusFilesCarryingAnyErrorNode: filesWithAnyError,
      corpusErrorNodesTotal: totalErrors,
      corpusErrorNodesMentioningClean: cleanErrors,
      corpusFilesWithAnErrorMentioningClean: withCleanError.length,
      samples: withCleanError.slice(0, 20).map((f) => ({ file: L(f.file), errorsMentioningClean: f.errorsMentioningClean, errorNodes: f.errorNodes, namedBlockNodes: f.namedBlockNodes })),
      controlledReproductionInputs: controlledShapes,
      controlledReproductionReading:
        "begin/process/end/dynamicparam parse with 0 ERROR nodes; the same function with a `clean` block leaves 1 ERROR node, and on a 2-function input the ERROR consumes the SECOND function's declaration — so the loss is not local to the block",
    },
    verdict:
      "clean" in inventory
        ? "NOT A LIMIT — the grammar has a `clean` block_name on this corpus"
        : cleanErrors > 0
          ? `LIVE ON CORPUS — the grammar has no \`clean\` block_name and ${cleanErrors} ERROR node(s) across ${withCleanError.length} file(s) carry it, so symbols after a \`clean\` block are missing from the graph`
          : "NOT ON CORPUS — the grammar has no `clean` block_name and the corpus carries 0 instances, so the limit is reproducible on a controlled input and costs this corpus nothing",
    overturn:
      "a `block_name` whose text is `clean` would mean the pinned wasm supports the block and the limitation row is wrong. A corpus count above 0 for ERROR nodes mentioning `clean` would move it from a latent limit to a live one, and the sample list names the files.",
  })
}

// ---------------------------------------------------------------------------
// P18  exports — the targets that name nothing, and what `-Cmdlet` can name.
//
// ARGUMENT: `exports` resolves at both ends on 98.11% of edges, which is the highest of
// any type in the lane except `contains`. The residual is the question: `Export-ModuleMember
// -Cmdlet X` publishes a CMDLET, which a PowerShell script cannot declare, so an `-Cmdlet`
// target is by construction a name this file does not own; and `-Alias a` publishes an
// ALIAS, which likewise cannot be declared. Publishing them is defensible — they ARE
// published names — but the doc's row calls the type "what the module publishes", and a
// consumer resolving the target against the file's own symbols will never find a cmdlet.
// This probe classifies the unresolved residual instead of leaving it as a percentage.
//
// INSTRUMENT: production edges against the same file's symbols, plus the `via` flag.
// ---------------------------------------------------------------------------
const p18 = (perFile: { file: string; symbols: { name: string; kind: string }[]; edges: Record<string, unknown>[] }[]) => {
  const rows: Edge[] = []
  for (const g of perFile) {
    const syms = new Set(g.symbols.map((s) => s.name.toLowerCase()))
    for (const x of g.edges) {
      if (String(x.type) !== "exports") continue
      const target = String(x.target)
      rows.push({
        file: g.file, source: String(x.source), target, type: "exports",
        line: Number(x.line), confidence: Number(x.confidence),
        meta: { ...(x.meta as Record<string, unknown>), resolvesInOwnFile: syms.has(target.toLowerCase()) },
      })
    }
  }
  const unresolved = rows.filter((r) => r.meta.resolvesInOwnFile !== true)
  const byVia: Record<string, number> = Object.create(null)
  for (const r of unresolved) byVia[String(r.meta.via)] = (byVia[String(r.meta.via)] ?? 0) + 1
  // PS30 made `via` the FLAG (`-Function`, `-Variable`, `-Alias`, `-Cmdlet`) rather
  // than the command name, so the comparison strips a leading dash. The first version
  // compared against `"alias"` bare and reported `aliasFlagEdges: 0` while the same
  // probe's `unresolvedByViaFlag` printed `-alias: 2` two lines above — two numbers from
  // one probe disagreeing, which is the only reason it was noticed.
  const flagOf = (r: Edge): string => stripLeadingDashText(String(r.meta.via ?? "")).toLowerCase()
  const cmdletFlag = rows.filter((r) => flagOf(r) === "cmdlet")
  const aliasFlag = rows.filter((r) => flagOf(r) === "alias")

  record({
    probe: "P18",
    type: "exports",
    argument:
      "`exports` resolves at both ends on 98.11% of edges, the highest in the lane except `contains`. The residual is unnamed in the doc, and it has a shape: `Export-ModuleMember -Cmdlet X` publishes a CMDLET and `-Alias a` publishes an ALIAS, neither of which a PowerShell script can declare, so those targets can never resolve against the file's own symbols however many there are. Publishing them is defensible — they ARE published names — but the row's noun is 'what the module publishes' and a consumer resolving the target will never find them. Classifying the residual is more useful than reporting the percentage.",
    instrument:
      "production `parseFile` edge reading joined against the SAME FILE's symbol table by lowercased name, then classified by the `via` argument the PS20 reader records (`-Function` / `-Variable` / `-Alias` / `-Cmdlet`)",
    measurement: {
      exportsEdges: rows.length,
      resolvingInTheirOwnFile: rows.length - unresolved.length,
      notResolvingInTheirOwnFile: unresolved.length,
      unresolvedByViaFlag: byVia,
      cmdletFlagEdges: cmdletFlag.length,
      aliasFlagEdges: aliasFlag.length,
      cmdletFlagResolving: cmdletFlag.filter((r) => r.meta.resolvesInOwnFile === true).length,
      aliasFlagResolving: aliasFlag.filter((r) => r.meta.resolvesInOwnFile === true).length,
      unresolvedSamples: unresolved.slice(0, 25).map((r) => ({ target: r.target, via: r.meta.via, line: r.line, file: L(r.file) })),
    },
    verdict:
      cmdletFlag.length === 0 && aliasFlag.length === 0
        ? "HOLDS — the corpus publishes no cmdlet and no alias, so every `exports` target is a name the file can declare and the residual is cross-file by construction"
        : `QUALIFIED — ${aliasFlag.length} \`-Alias\` target(s) are names no script can declare (an alias is made by \`New-Alias\` at run time) and ${cmdletFlag.length} \`-Cmdlet\` target(s) come from a module, so for those rows the resolution rate is not a defect rate. PS30 is what made this measurable: before it, \`via\` was the command name on every row and this probe could not tell the four flags apart at all.`,
    overturn:
      "a `-Cmdlet` or `-Alias` target that DOES resolve to a symbol in the publishing file would mean the file declares a cmdlet or an alias as a symbol, which changes what the residual means. Counts above 0 for either flag make the resolution rate a mixed measure and the row's noun a partial description.",
  })
}

// ---------------------------------------------------------------------------
// driver
// ---------------------------------------------------------------------------
type FileEdgeFacts = { file: string; symbols: { name: string; kind: string }[]; edges: Record<string, unknown>[] }

const shardRun = (
  worker: string,
  tmp: string,
  shards: string[][],
  tag: string,
): { ok: number; failed: number; cached: number; notes: string[] } => {
  let ok = 0
  let failed = 0
  let cached = 0
  const notes: string[] = []
  shards.forEach((shard, si) => {
    // A cache hit is only a cache hit if the SHARD ITSELF is unchanged, so the shard's
    // file list is hashed into the name. A corpus that grew produces a different name and
    // is re-read, which is the whole point: a cached population from a different file set
    // is exactly the "number copied from a previous wave" failure this project records.
    const key = cacheIdx >= 0
      ? createHash("sha256").update(shard.join("\n")).digest("hex").slice(0, 16)
      : null
    const outPath = key && CACHE ? path.join(CACHE, `${tag}-out-${si}-${key}.json`) : null
    if (outPath && existsSync(outPath)) { ok++; cached++; return }
    const listFile = path.join(tmp, `${tag}-list-${si}.txt`)
    writeFileSync(listFile, shard.join("\n"), "utf8")
    const res = spawnSync(
      process.execPath,
      [path.join(process.cwd(), "node_modules", ".bin", "tsx"),
        path.join(import.meta.dirname, worker), listFile, path.join(tmp, `${tag}-out-${si}.json`)],
      { encoding: "utf8", maxBuffer: 512 * 1024 * 1024, timeout: 900_000 },
    )
    if (res.status !== 0) {
      failed++
      notes.push(`${tag} shard ${si}: status=${res.status} ${(res.stderr ?? "").slice(0, 300)}`)
      return
    }
    if (outPath) {
      try {
        writeFileSync(outPath, readFileSync(path.join(tmp, `${tag}-out-${si}.json`), "utf8"), "utf8")
      } catch (e) {
        notes.push(`${tag} shard ${si}: cache write failed, the shard is still counted: ${String(e).slice(0, 200)}`)
      }
    }
    const se = (res.stderr ?? "").trim()
    // The engine logs its parser init to stderr on every load. That is not a shard
    // warning and printing 20 of them buries a real one, so INFO lines are dropped and
    // anything else is kept verbatim.
    const real = se.split("\n").filter((l) => l.trim().length > 0 && !l.includes("[INFO]")).join("\n")
    if (real.length > 0) notes.push(`${tag} shard ${si} stderr: ${real.slice(0, 600)}`)
    ok++
  })
  return { ok, failed, cached, notes }
}

const main = async () => {
  const want = (id: string) => !ONLY || ONLY.has(id)
  const shardSize = Number(process.env.PS_P3_SHARD ?? "120")
  const shards: string[][] = []
  for (let i = 0; i < files.length; i += shardSize) shards.push(files.slice(i, i + shardSize))
  const tmp = mkdtempSync(path.join(os.tmpdir(), "ps-p3-"))
  if (CACHE) mkdirSync(CACHE, { recursive: true })
  /** The file a shard's output is in, whether it was just written or read from cache. */
  const shardOut = (tag: string, si: number): string => {
    if (cacheIdx < 0) return path.join(tmp, `${tag}-out-${si}.json`)
    const shard = shards[si]
    const key = createHash("sha256").update(shard.join("\n")).digest("hex").slice(0, 16)
    return path.join(CACHE!, `${tag}-out-${si}-${key}.json`)
  }

  const tree: FileFacts[] = []
  const treeNotes: string[] = []
  let treeFailed = 0
  let treeCached = 0
  if (want("P12") || want("P15") || want("P17")) {
    const r = shardRun("_p3-tree-worker.ts", tmp, shards, "tree")
    treeFailed = r.failed
    treeCached = r.cached
    treeNotes.push(...r.notes)
    shards.forEach((_, si) => {
      const p = shardOut("tree", si)
      if (!existsSync(p)) return
      tree.push(...(JSON.parse(readFileSync(p, "utf8")) as FileFacts[]))
    })
    console.log(`tree population: ${tree.length} files parsed across ${shards.length} shards (${treeFailed} shard failures, ${treeCached} from cache)`)
  }

  const edges: Edge[] = []
  const perFile: FileEdgeFacts[] = []
  const edgeNotes: string[] = []
  let edgeFailed = 0
  let edgeCached = 0
  if (want("P13") || want("P14") || want("P15") || want("P16") || want("P18")) {
    const r = shardRun("_p3-edge-worker.ts", tmp, shards, "edge")
    edgeFailed = r.failed
    edgeCached = r.cached
    edgeNotes.push(...r.notes)
    shards.forEach((_, si) => {
      const p = shardOut("edge", si)
      if (!existsSync(p)) return
      for (const g of JSON.parse(readFileSync(p, "utf8")) as FileEdgeFacts[]) {
        perFile.push(g)
        for (const x of g.edges) {
          edges.push({
            file: g.file, source: String(x.source), target: String(x.target), type: String(x.type),
            line: Number(x.line), confidence: Number(x.confidence),
            meta: (x.meta ?? {}) as Record<string, unknown>,
          })
        }
      }
    })
    console.log(`edge population: ${edges.length} relationships from ${files.length} files across ${shards.length} shards (${edgeFailed} shard failures, ${edgeCached} from cache)`)
  }

  rmSync(tmp, { recursive: true, force: true })

  // Honesty contract §5.4: a zero from a shard that died is not a measurement. Assert
  // the population BEFORE any verdict is trusted, and say so in the output either way.
  const shardReport = {
    shardSize, shards: shards.length,
    treeShardFailures: treeFailed, edgeShardFailures: edgeFailed,
    treeShardsFromCache: treeCached, edgeShardsFromCache: edgeCached,
    treePopulationIsWholeAdmittedSet: tree.length === files.length,
    edgePopulationIsWholeAdmittedSet: want("P13") || want("P14") || want("P15") || want("P16") || want("P18")
      ? perFile.length === files.length : null,
    notes: [...edgeNotes, ...treeNotes],
  }
  console.log(`\nshard report: ${JSON.stringify(shardReport)}`)
  if (!shardReport.treePopulationIsWholeAdmittedSet) {
    console.log("WARNING: the tree population is smaller than the admitted set — every tree number below is a LOWER BOUND, not a measurement of the whole corpus")
  }
  if (shardReport.edgePopulationIsWholeAdmittedSet === false) {
    console.log("WARNING: the edge population is smaller than the admitted set — every edge number below is a LOWER BOUND, not a measurement of the whole corpus")
  }

  if (want("P12")) p12(tree)
  if (want("P13")) p13(edges)
  if (want("P14")) await p14(perFile)
  if (want("P15")) p15(tree, edges)
  if (want("P16")) p16(perFile)
  if (want("P17")) p17(tree)
  if (want("P18")) p18(perFile)

  if (OUT) {
    writeFileSync(OUT, JSON.stringify({
      admittedFiles: files.length,
      treeFilesParsed: tree.length,
      edgeFilesParsed: perFile.length,
      relationships: edges.length,
      shardReport,
      results,
    }, null, 2), "utf8")
    console.log(`\nwrote ${OUT}`)
  }
  console.log(`${results.length} probes recorded`)
  // Honesty contract §5.4 in its purest form: a run that selected probes and recorded
  // none has measured nothing, and saying so is the only difference between this and a
  // silent empty result.
  if (results.length === 0) {
    console.error("WARNING: 0 probes recorded — if --only was given, the selector matched nothing and this run measured NOTHING")
    process.exitCode = 7
  }
}

void main()