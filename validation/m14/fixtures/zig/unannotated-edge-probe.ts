/**
 * ZIG — THE UNANNOTATED EDGES. Attributes the residue pass 24 declined to spend a walk on.
 *
 * ## The question
 *
 * Pass 24 (`docs/analyzers/zig.md` §E, §H.3) counted, over 432,468 edges from
 * production `parseFile` at 3,848 corpus files:
 *
 *     targetScope  file-local 255,260 | file-external 177,193 | ABSENT 15
 *
 * 15 edges of 432,468 (0.0035%) carry no `targetScope`. `annotateTargetScope`
 * (`src/ast/real-zig-analyzer.ts:2894`) is unconditional over the `relationships` array — it
 * iterates every element and skips only on `if (md.targetScope) continue`. So an unannotated
 * edge is one of exactly three things, and the three cost different amounts to be right about:
 *
 *   1. it was NOT IN THE ARRAY when the annotation ran (`:1240`) — an edge added later, which
 *      means this analyzer's call ORDER is wrong;
 *   2. its marker was present and then REMOVED — a mutation after `:1240`;
 *   3. it carries a `targetScope` value outside the three this analyzer writes
 *      (`file-local`, `file-external`, `scope-marker`) — i.e. a CONTRACT drift, where the
 *      field exists and the value came from somewhere else entirely.
 *
 * Pass 24 named two candidate mechanisms and could not separate them:
 *   (a) `canonicalizePublishedNames` (`:1253`, runs AFTER the annotation at `:1240`) mutates
 *       relationships IN PLACE — but it rewrites strings only and adds no edge;
 *   (b) the Z52 `uses` dedup at `:1215-1224` rebuilds the array — but it runs BEFORE `:1240`.
 *
 * Neither candidate survives the code, which is why this probe reports SITES rather than
 * testing a hypothesis: the mechanism is whatever produced them, and the sites name it. Each
 * residue edge is dumped with its FULL metadata, because the metadata keys are the
 * fingerprint — a key this analyzer writes proves the edge is this analyzer's, and a key that
 * appears on no code path in `real-zig-analyzer.ts` points at shared pool-worker machinery.
 *
 * Class 3 is counted SEPARATELY from class 1+2 and never pooled with it, because a consumer
 * reading `targetScope` sees both as "annotated" and the difference is the whole finding.
 *
 * ## What is deliberately NOT concluded here
 *
 * This probe REPORTS. It does not repair. Whether a late edge should be annotated or dropped
 * is a design decision, and §3 of the workstream prices a fabricated edge above every other
 * defect — so the instrument's job is to make the sites reviewable, not to guess at them.
 *
 * ## Instrument
 *
 * Production `parseFile` from `src/ast/pool-worker` — not `analyze()`. Files:
 * `find <root> -name '*.zig' -type f | sort | head -N`, the same deterministic draw
 * `absent-class.ts` and `file-local-resolution.ts` use, so all three are comparable.
 *
 * Usage: npx tsx validation/m14/fixtures/zig/unannotated-edge-probe.ts <root> [N] [--out path]
 */
import { execFileSync } from "node:child_process"
import { readFileSync, writeFileSync } from "node:fs"
import { parseFile } from "../../../../src/ast/pool-worker"

const argv = process.argv.slice(2)
const positional = argv.filter((a) => !a.startsWith("--"))
const flag = (k: string, d: string) => {
  const hit = argv.find((a) => a === `--${k}` || a.startsWith(`--${k}=`))
  if (hit === undefined) return d
  const eq = hit.indexOf("=")
  return eq === -1 ? (argv[argv.indexOf(hit) + 1] ?? d) : hit.slice(eq + 1)
}
const root = positional[0] ?? "/home/ishaq2321/bb_tests/repositories"
const N = Number(positional[1] ?? 3848)

const files = execFileSync("bash", ["-lc", `find ${root} -name '*.zig' -type f | sort | head -${N}`], {
  encoding: "utf8",
  maxBuffer: 256 * 1024 * 1024,
})
  .split("\n")
  .filter(Boolean)

/** The only three values `annotateTargetScope` writes. */
const CONTRACT = new Set(["file-local", "file-external", "scope-marker"])

const relType = (r: any): string => String(r?.type ?? r?.relationshipType ?? "(none)")
const relReason = (r: any): string => String(r?.metadata?.relationshipType ?? "(none)")

/**
 * Replays the ONE pool-worker regex that could have produced this edge, and reports whether the
 * claimed call exists. Replaying rather than re-deriving is the point: a second opinion from a
 * different grammar would only prove that two wrong readings can disagree. This one asks whether
 * the edge's own claim survives its own extraction, on the bytes it names.
 *
 * The regex is chosen by `source`, because that is what pool-worker does — `:317` writes
 * `source: match[1]` (the receiver) from `methodCallPattern`, and `:301`/`:343` write the literal
 * `"this"` from `newPattern`/`callPattern`. Running both regexes and taking whichever matched
 * would relabel a `this` edge as a receiver edge, which is precisely the confusion this probe
 * exists to catch.
 *
 * The two "this does not exist" verdicts are decided on the characters BEFORE the match, so they
 * are mechanical and not a judgement about intent:
 *   - `/:\s*$/` on the prefix  -> the match was preceded by `:`  -> a Zig block label
 *   - `/\bfn\s+$/` on the prefix -> the match was preceded by `fn ` -> a declaration
 */
function classify(line: string, source: string, target: string, shadow: boolean): {
  matchedBy: Site["matchedBy"]
  classification: Classification
} {
  if (source !== "this") {
    const method = /(\w+)\.(\w+)\s*\(/g
    let m: RegExpExecArray | null
    while ((m = method.exec(line)) !== null) {
      if (m[2] === target) return { matchedBy: "method-call", classification: "receiver-call" }
    }
    return { matchedBy: "not-found-in-line", classification: "untraceable" }
  }
  const call = /(\w+)\s*\(/g
  let m: RegExpExecArray | null
  while ((m = call.exec(line)) !== null) {
    if (m[1] !== target) continue
    const before = line.slice(0, m.index)
    if (/:\s*$/.test(before)) return { matchedBy: "call", classification: "block-label-not-call" }
    if (/\bfn\s+$/.test(before)) return { matchedBy: "call", classification: "declaration-not-call" }
    return {
      matchedBy: "call",
      classification: shadow ? "shadow-duplicate" : "bare-call-fabricated-source",
    }
  }
  return { matchedBy: "not-found-in-line", classification: "untraceable" }
}

type Site = {
  file: string
  source: string
  target: string
  type: string
  reason: string
  confidence: number | null
  /** the three contract values, or null when absent/empty */
  contractScope: string | null
  /** every other truthy value the field carries — class 3, contract drift */
  foreignScope: string | null
  metadata: Record<string, unknown>
  /** which of the two pool-worker regexes produced this edge */
  matchedBy: "method-call" | "call" | "not-found-in-line"
  /** mechanical verdict on whether the claimed call exists in the source */
  classification: Classification
  /** the source line the edge names, trimmed */
  line: string
}

type Classification =
  /** `.name(` with a receiver that is a real binding site — the edge's core claim holds */
  | "receiver-call"
  /** `name(` appears, but as a `fn name(` DECLARATION. The call does not exist. */
  | "declaration-not-call"
  /** `:label (` — a Zig block label, read as a call. The call does not exist. */
  | "block-label-not-call"
  /** `this -> name` shadowing a receiver-call edge for the same name on the same line */
  | "shadow-duplicate"
  /** a real call, but `source: "this"` names nothing — Zig has no `this` */
  | "bare-call-fabricated-source"
  /** the line does not contain the claim at all — the edge cannot be traced to its own metadata */
  | "untraceable"

const sites: Site[] = []
const byType = new Map<string, number>()
const byReason = new Map<string, number>()
const byClassification = new Map<string, number>()
const foreignValues = new Map<string, number>()
const residueFiles = new Set<string>()
let parsed = 0
let failed = 0
let edges = 0
let contractAnnotated = 0

for (const f of files) {
  let pf: any
  try {
    pf = await parseFile(f, root)
    parsed++
  } catch {
    failed++
    continue
  }
  const rels: any[] = Array.isArray(pf?.relationships) ? pf.relationships : []
  const staged: Site[] = []
  for (const r of rels) {
    edges++
    const raw = r?.metadata?.targetScope
    const val = raw === undefined || raw === null ? null : String(raw)
    if (val !== null && CONTRACT.has(val)) {
      contractAnnotated++
      continue
    }
    if (val !== null && val !== "") {
      // class 3 — the field is populated, by a writer that is not annotateTargetScope
      foreignValues.set(val, (foreignValues.get(val) ?? 0) + 1)
      continue
    }
    // class 1/2 — absent or empty
    residueFiles.add(f)
    staged.push({
      file: f,
      source: String(r?.source ?? ""),
      target: String(r?.target ?? ""),
      type: relType(r),
      reason: relReason(r),
      confidence: typeof r?.confidence === "number" ? r.confidence : null,
      contractScope: CONTRACT.has(val ?? "") ? val : null,
      foreignScope: null,
      metadata: (r?.metadata ?? {}) as Record<string, unknown>,
      matchedBy: "not-found-in-line",
      classification: "untraceable",
      line: "",
    })
  }

  // A `(line, target)` seen on BOTH a `this` edge and a receiver edge is one call site counted
  // twice: `methodCallPattern` reads `obj.name(` and `callPattern` reads the same `name(`.
  const byLineTarget = new Map<string, string[]>()
  for (const s of staged) {
    const ln = Number(s.metadata.line)
    if (!Number.isFinite(ln)) continue
    const key = `${ln} ${s.target}`
    byLineTarget.set(key, [...(byLineTarget.get(key) ?? []), s.source])
  }

  if (staged.length > 0) {
    // Read the file only when it actually carried residue — 3,848 reads is not the cost.
    let srcLines: string[] = []
    try {
      srcLines = readFileSync(f, "utf8").split("\n")
    } catch {
      /* left empty; every site then classifies `untraceable`, which is the honest verdict */
    }
    for (const s of staged) {
      const ln = Number(s.metadata.line)
      s.line = (srcLines[ln - 1] ?? "").trim()
      const siblings = byLineTarget.get(`${ln} ${s.target}`) ?? []
      const shadow = s.source === "this" && siblings.some((o) => o !== "this")
      const c = classify(s.line, s.source, s.target, shadow)
      s.matchedBy = c.matchedBy
      s.classification = c.classification
      byClassification.set(s.classification, (byClassification.get(s.classification) ?? 0) + 1)
      sites.push(s)
      byType.set(s.type, (byType.get(s.type) ?? 0) + 1)
      byReason.set(s.reason, (byReason.get(s.reason) ?? 0) + 1)
    }
  }
}

const report = {
  instrument: "validation/m14/fixtures/zig/unannotated-edge-probe.ts",
  population: { root, requestedFiles: N, filesDrawn: files.length, parsed, failed },
  edges: {
    total: edges,
    contractAnnotated,
    unannotatedResidue: sites.length,
    residuePct: edges > 0 ? +((sites.length / edges) * 100).toFixed(5) : 0,
  },
  residueByType: Object.fromEntries(byType),
  residueByReason: Object.fromEntries(byReason),
  /**
   * Mechanical verdict per residue edge, decided by replaying pool-worker's own regexes on the
   * line the edge names. `fabricatedCall` is the count whose claimed call does not exist at all.
   */
  residueByClassification: Object.fromEntries(byClassification),
  fabricatedCalls: (byClassification.get("declaration-not-call") ?? 0) +
    (byClassification.get("block-label-not-call") ?? 0),
  fabricatedSources: (byClassification.get("bare-call-fabricated-source") ?? 0) +
    (byClassification.get("shadow-duplicate") ?? 0),
  /** class 3, kept apart from the residue on purpose */
  foreignScopeValues: Object.fromEntries(foreignValues),
  filesWithResidue: residueFiles.size,
  sites,
}

const outPath = flag("out", "")
if (outPath) writeFileSync(outPath, JSON.stringify(report, null, 2))

console.log(`population            ${files.length} files drawn, ${parsed} parsed, ${failed} failed`)
console.log(`edges                 ${edges}`)
console.log(`contract-annotated    ${contractAnnotated}`)
console.log(`UNANNOTATED RESIDUE   ${sites.length}  (${report.edges.residuePct}%)`)
console.log(`  by type             ${JSON.stringify(report.residueByType)}`)
console.log(`  by reason           ${JSON.stringify(report.residueByReason)}`)
console.log(`  files with residue  ${residueFiles.size}`)
console.log(`  by classification   ${JSON.stringify(report.residueByClassification)}`)
console.log(`  FABRICATED CALLS    ${report.fabricatedCalls}  (claimed call does not exist in source)`)
console.log(`  fabricated source   ${report.fabricatedSources}  (real call, source names nothing)`)
console.log(`  foreign scope vals  ${JSON.stringify(report.foreignScopeValues)}`)
for (const s of sites.slice(0, 30)) {
  console.log("")
  console.log(`  ${s.type} / ${s.reason}  conf=${s.confidence}  [${s.matchedBy}] ${s.classification}`)
  console.log(`    ${s.source} -> ${s.target}`)
  console.log(`    ${s.file}:${s.metadata.line}`)
  console.log(`    src:   ${s.line}`)
  console.log(`    metadata: ${JSON.stringify(s.metadata)}`)
}
if (sites.length > 30) console.log(`\n  ... ${sites.length - 30} more in the --out json`)

// It must not pass by measuring nothing. An empty draw makes every number above meaningless,
// so that is the only failure this instrument declares — a residue of 0 over a real population
// is a RESULT, not a pass-by-absence.
if (files.length === 0) {
  console.error("FAIL: the walk drew 0 files — the numbers above mean nothing")
  process.exit(2)
}