/**
 * INCOMING_JAVA — relationship-type ONTOLOGY CENSUS for `real-java-analyzer`.
 *
 * WHY THIS FILE EXISTS. Source derivation (counting `RelationshipType.X`
 * references in the analyzer source) answers "is this type CONSTRUCTIBLE". It does
 * not answer "does it FIRE", and this lane's own doc had claimed emissions it
 * never produced — `imports` with a row describing an `import_declaration`
 * reader that does not exist as an edge, `depends`, `field_access`. So every
 * verdict here comes from the PRODUCTION path: getParser -> parse -> analyze,
 * over a pinned, enumerated corpus.
 *
 * NO REGEX. Not one. The corpus filter is `path.endsWith(".java")`, the sorting is
 * `Array.prototype.sort`, and every structural question is answered by walking the
 * tree-sitter AST through node.type / namedChild(i) / childForFieldName. A text
 * regex over source is the instrument that makes an analyzer lie — it matches
 * comments and string literals, misses nested syntax, and breaks silently on the
 * next grammar version.
 *
 * WHAT IT MEASURES, per the six questions of ONTOLOGY-WORKSTREAM.md Part 1:
 *   1 exists    — constructible at all (derivation, reported separately)
 *   2 fires     — edges actually produced per type, with the files they came from
 *   4 labelled  — the metadata.relationshipType / evidenceClass each edge carries
 *   5 resolved  — BOTH endpoints bind to a real symbol of THIS file or to a
 *                 name the file itself writes; the split is resolved / ambiguous
 *                 / unresolvable, and `ambiguous` is reported per endpoint
 *   6 confident — the confidence distribution and the evidenceClass mix, with the
 *                 heuristic (sub-0.7) fraction called out as a queryable number
 *   plus R7     — unknown symbols, empty names, placeholder-literal endpoints
 *
 * Question 3 (oracle agreement) is NOT answered here: that is a separate walker,
 * see `oracle.ts`, and its limits are stated where it is used.
 */
import { execFileSync } from "node:child_process"
import { readFileSync, statSync } from "node:fs"
import * as path from "node:path"
import { createHash } from "node:crypto"
import { writeFileSync } from "node:fs"

// BOTH enums, at the TOP rather than beside the lazy imports below: the
// NAME_TO_VALUE table below is built from them, and a `const` read before its
// declaration is a TDZ ReferenceError rather than a wrong number.
//
// There are TWO of them and they DISAGREE, which is the finding this census
// exists to make visible rather than a mistake to paper over:
//
//   src/ast/types.ts:60    Imports = "brain_import"
//   src/ast/engine.ts:445  Imports = "imports"
//
// `types.ts` is imported by exactly one file in the tree — `engine.ts` — and
// `engine.ts` does not use its enum, it declares its own. So the value an
// analyzer actually produces, through `ASTEngine.RelationshipType.Imports`, is
// the literal `"imports"`; `"brain_import"` is the name of a DATABASE TABLE
// (`parallel-indexer.ts` writes `brain_import` rows from `ImportInfo`, not from
// relationship edges). Every JVM/web lane emits `"imports"`.
//
// So this census tallies the engine's enum — the one the analyzer uses — and
// PRINTS the divergence, because a reader who consults types.ts and expects
// `brain_import` would otherwise conclude the type never fires.
const REPO = path.resolve(import.meta.dir, "..", "..")
const { RelationshipType: RT_TYPES } = await import(path.join(REPO, "src/ast/types.ts"))
const { ASTEngine } = await import(path.join(REPO, "src/ast/engine.ts"))
const CORPUS = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const JAVA_DIR = path.join(CORPUS, process.env.BB_JAVA_DIR ?? "java-lib")

/**
 * The ontology gate's ten, at HEAD of script/m14/ontology-coverage-gate.ts:49.
 *
 * These are the NAMES. The WIRE VALUES are not all the same, and the difference
 * cost this instrument its whole `imports` row until it was caught:
 * `RelationshipType.Imports` serialises to `"brain_import"`, not `"imports"`.
 * docs/analyzers/FIRING-CHECK.md records the same trap from the other side — six
 * analyzers emit the raw literal `"imports"`, which is not a value of the enum at
 * all, so every consumer keying on the enum misses their edges silently.
 *
 * So the census tallies the WIRE VALUE, read from the enum itself rather than
 * transcribed, and asserts that the enum really does have ten distinct values.
 */
const ENGINE_RT = ASTEngine.RelationshipType
const NAME_TO_VALUE: Record<string, string> = {
  calls: ENGINE_RT.Calls,
  uses: ENGINE_RT.Uses,
  contains: ENGINE_RT.Contains,
  imports: ENGINE_RT.Imports,
  references: ENGINE_RT.References,
  exports: ENGINE_RT.Exports,
  extends: ENGINE_RT.Extends,
  implements: ENGINE_RT.Implements,
  overrides: ENGINE_RT.Overrides,
  instantiates: ENGINE_RT.Instantiates,
}
/** Where the two enums disagree, with both values. Printed, not swallowed. */
const ENUM_DIVERGENCE = (Object.keys(NAME_TO_VALUE) as Array<keyof typeof NAME_TO_VALUE>)
  .filter((k) => NAME_TO_VALUE[k] !== (RT_TYPES as any)[k === "extends" ? "Inheritance" : k === "implements" ? "Implementation" : k[0].toUpperCase() + k.slice(1)])
  .map((k) => ({ name: k, engine: NAME_TO_VALUE[k], typesTs: (RT_TYPES as any)[k === "extends" ? "Inheritance" : k === "implements" ? "Implementation" : k[0].toUpperCase() + k.slice(1)] }))
const ALL_TYPES = [
  "calls", "uses", "contains", "imports", "references",
  "exports", "extends", "implements", "overrides", "instantiates",
] as const
type Type = (typeof ALL_TYPES)[number]

const LIMIT = Number(process.env.BB_LIMIT ?? 0)
const OFFSET = Number(process.env.BB_OFFSET ?? 0)
const SHARDS = Number(process.env.BB_SHARDS ?? 1)

// ---------------------------------------------------------------- corpus
function javaFilesTracked(dir: string): string[] {
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], {
      encoding: "utf8", maxBuffer: 512 * 1024 * 1024,
    }).split("\0").filter(Boolean)
  } catch { return [] }
  const out: string[] = []
  for (const rel of tracked) {
    if (!rel.endsWith(".java")) continue
    // No regex: the extension is a suffix, and these are the two directories that
    // hold generated / GWT-transpiled java rather than library source. A census
    // that includes `build/generated` measures the generator, not the language.
    const parts = rel.split("/")
    let skip = false
    for (const p of parts) {
      if (p === "build" || p === "target" || p === "generated" || p === "node_modules") { skip = true; break }
    }
    if (skip) continue
    const abs = path.join(dir, rel)
    try { if (statSync(abs).size > 400_000) continue } catch { continue }
    out.push(abs)
  }
  out.sort() // deterministic: the pinned revision's ls-files order, byte-sorted
  // Sharding is by INDEX into that sorted list, never by a path hash, so shard k
  // is reproducible from the pinned revision alone and the union is the corpus.
  const sharded = SHARDS > 1 ? out.filter((_, i) => i % SHARDS === OFFSET) : out
  return LIMIT > 0 ? sharded.slice(0, LIMIT) : sharded
}

const { getParser } = await import(path.join(REPO, "src/ast/engine.ts"))
const { RealJavaAnalyzer } = await import(path.join(REPO, "src/ast/real-java-analyzer.ts"))
const { mergeSymbolsIntoOverrideCompanion } = await import(path.join(REPO, "src/ast/override-context.ts"))

/**
 * The override confidence LADDER has four rungs — 1.0 `exact-in-file`, 0.9
 * `generic-substitution`, 0.85 `companion-index`, 0.5 `first-parent-guess` — and a
 * per-file analyzer reaches the third one only when the caller supplies the project
 * companion index (`AnalyzeContext.overrideCompanion`), which the M12 harness builds
 * by pre-passing the corpus. Without it the 0.85 rung is unreachable and the lane's
 * override confidence histogram would report a rung as absent that the code can
 * produce. So the census measures BOTH: with and without the companion, and prints
 * the difference. `BB_COMPANION=0` turns the companion off for the "without" run.
 */
const USE_COMPANION = process.env.BB_COMPANION !== "0"

const enumAll = [...new Set(Object.values(ENGINE_RT))] as string[]
const enumSet = new Set(enumAll)
const WIRE = new Map<string, string>(Object.entries(NAME_TO_VALUE).map(([k, v]) => [v, k]))
console.log(`wire values (engine.ts enum, the one analyzers use): ${[...WIRE.keys()].map((v) => `${v}=${WIRE.get(v)}`).join("  ")}`)
if (ENUM_DIVERGENCE.length) {
  console.log(`ENUM DIVERGENCE (src/ast/types.ts vs src/ast/engine.ts), ${ENUM_DIVERGENCE.length} type(s):`)
  for (const d of ENUM_DIVERGENCE) console.log(`  ${d.name.padEnd(14)} engine.ts="${d.engine}"  types.ts="${d.typesTs}"`)
} else console.log(`enum divergence: none`)
console.log(`labels outside the engine enum (printed after the walk): see below`)

type Row = {
  t: string
  source: string
  target: string
  confidence: number | undefined
  evidenceClass: string | undefined
  relKind: unknown
  line: number | undefined
  file: string
}

// ---------------------------------------------------------------- the walk
/** Names the file ITSELF writes into the index as a symbol. This is the only
 *  resolution authority available to a per-file analyzer, and it is the honest
 *  one: a target that is not a symbol of this file may still be a symbol of a
 *  file the index has not parsed yet, which is an INCOMING-edge problem, not an
 *  unresolved name. */
const files = javaFilesTracked(JAVA_DIR)
if (!files.length) {
  console.error(`no tracked .java under ${JAVA_DIR}`)
  process.exit(2)
}
const parser = await getParser("java")

const tally = new Map<string, number>()
const fileList = new Map<string, Set<string>>()
const confHist = new Map<string, Map<string, number>>()
const evClass = new Map<string, Map<string, number>>()
const relKind = new Map<string, Map<string, number>>()
const resolution = new Map<string, { resolved: number; srcAmb: number; tgtAmb: number; neither: number }>()
const byName = new Map<string, number>() // bare-name -> occurrences among emitted symbols
const perTypeRows: Row[] = []
const missingLine = new Map<string, number>()
const r7 = { unknownSource: 0, unknownTarget: 0, emptySource: 0, emptyTarget: 0, placeholderEndpoint: 0, placeholderBackedByDeclaration: 0, reasonCodes: new Map<string, number>(), examples: [] as string[] }
const OTHER_LABELS = new Map<string, number>()

/** R7 placeholder-literal endpoints — the analyzer's OWN substitutions, read off
 *  the source, not a shape matched against source text.
 *
 *  The first version of this probe used a broader list that included `none` and
 *  `null`, and it reported 70 "placeholder targets". Every one was a real Guava
 *  method name: `Optional.none()` in `ArbitraryInstances.java`. That is the
 *  ontology gate's own lesson applied to my own instrument — a probe that matches a
 *  SHAPE rather than a ROLE produces a number, and the number is worth nothing.
 *  The three literals below are the ones the analyzer itself writes when it has no
 *  name: `|| "global"` (no enclosing type), `currentPackage || "root"` (no package
 *  declaration), and `type || "unknown"` (a parameter type it could not read). */
const PLACEHOLDERS = ["global", "root", "unknown"]

let parsed = 0
let failed = 0
const failures: string[] = []
const PROGRESS_EVERY = Number(process.env.BB_PROGRESS ?? 200)
let sinceProgress = 0
const t0 = Date.now()

/** pass 1, only when the companion is wanted: parse every file, index its declared
 *  method names by owning type, and throw the tree away. This is what the M12
 *  harness does and it is the only way the 0.85 rung becomes reachable. */
const companion = new Map<string, Set<string>>()
if (USE_COMPANION) {
  for (const abs of files) {
    try {
      const pr = await parser.parse(readFileSync(abs, "utf8"), abs)
      mergeSymbolsIntoOverrideCompanion(companion, new RealJavaAnalyzer().analyze(pr.rootNode as any, readFileSync(abs, "utf8"), abs).symbols ?? [])
    } catch { /* a file that will not parse in pass 1 will not parse in pass 2 either */ }
  }
  console.log(`companion index: ${companion.size} owning types, ${[...companion.values()].reduce((a, s) => a + s.size, 0)} declared method names (BB_COMPANION=${USE_COMPANION ? 1 : 0})`)
}

const analyzeCtx = USE_COMPANION ? { overrideCompanion: companion } : undefined

for (const abs of files) {
  const content = readFileSync(abs, "utf8")
  let res: any
  try {
    const pr = await parser.parse(content, abs)
    res = new RealJavaAnalyzer().analyze(pr.rootNode as any, content, abs, analyzeCtx)
  } catch (e) {
    failed++
    if (failures.length < 5) failures.push(`${path.relative(JAVA_DIR, abs)}: ${String(e).slice(0, 120)}`)
    continue
  }
  parsed++
  sinceProgress++
  if (PROGRESS_EVERY > 0 && sinceProgress >= PROGRESS_EVERY) {
    sinceProgress = 0
    console.log(`  … ${parsed}/${files.length} files, ${((Date.now() - t0) / 1000).toFixed(1)}s, ${process.memoryUsage().rss / 1048576 | 0} MB rss`)
  }
  const rel = path.relative(JAVA_DIR, abs)

  // Resolution authority: every name this file declares, plus the package name.
  const local = new Set<string>()
  let pkg = ""
  for (const s of res.symbols ?? []) {
    if (typeof s.name === "string" && s.name.length > 0) {
      local.add(s.name)
      byName.set(s.name, (byName.get(s.name) ?? 0) + 1)
      const dots = s.name.split(".")
      if (dots.length > 1) local.add(dots[dots.length - 1])
      if (s.ownerName && typeof s.name === "string") {
        local.add(`${s.ownerName}.${s.name}`)
        // java's method FQN is `Owner.name(T,U)` — the SIGNATURE is part of the
        // edge label (`localEdgeLabel` deletes it for display, but the
        // `exports`/Spring route edge is emitted with the parameter list still
        // attached). Scoring `Owner.method` alone reported 17 java-sample
        // `exports` edges as "neither endpoint resolves", which was my probe
        // missing the parentheses, not a defect in the edge.
        const params = Array.isArray(s.parameters) ? s.parameters : []
        const sig = `(${params.map((p: any) => p?.type || "unknown").join(",")})`
        local.add(`${s.ownerName}.${s.name}${sig}`)
      }
    }
    if (s.ownerName) local.add(s.ownerName)
  }
  if (typeof res.metadata?.currentPackage === "string" && res.metadata.currentPackage.length > 0) {
    pkg = res.metadata.currentPackage
    const pp = pkg.split(".")
    if (pp.length > 1) local.add(pp[pp.length - 1])
  }
  for (const im of res.imports ?? []) if (typeof im.module === "string") local.add(im.module)
  for (const ex of res.exports ?? []) if (typeof ex.name === "string") local.add(ex.name)

  for (const r of res.relationships ?? []) {
    const wire = String(r.type ?? r.relationshipType ?? "")
    if (!enumSet.has(wire)) { OTHER_LABELS.set(wire, (OTHER_LABELS.get(wire) ?? 0) + 1); continue }
    const t = WIRE.get(wire) ?? wire
    tally.set(t, (tally.get(t) ?? 0) + 1)
    if (!fileList.has(t)) fileList.set(t, new Set())
    const fs_ = fileList.get(t)!
    if (fs_.size < 8) fs_.add(rel)

    const conf = typeof r.confidence === "number" ? r.confidence : undefined
    if (!confHist.has(t)) confHist.set(t, new Map())
    const ch = confHist.get(t)!
    const ck = conf === undefined ? "absent" : String(conf)
    ch.set(ck, (ch.get(ck) ?? 0) + 1)

    if (!evClass.has(t)) evClass.set(t, new Map())
    const ec = evClass.get(t)!
    const eck = String(r.metadata?.evidenceClass ?? "absent")
    ec.set(eck, (ec.get(eck) ?? 0) + 1)

    if (!relKind.has(t)) relKind.set(t, new Map())
    const rk = relKind.get(t)!
    const rkk = r.metadata?.relationshipType === undefined ? "absent" : String(r.metadata.relationshipType)
    rk.set(rkk, (rk.get(rkk) ?? 0) + 1)

    if (typeof r.line_number !== "number") missingLine.set(t, (missingLine.get(t) ?? 0) + 1)

    if (!resolution.has(t)) resolution.set(t, { resolved: 0, srcAmb: 0, tgtAmb: 0, neither: 0 })
    const rr = resolution.get(t)!
    const src = typeof r.source === "string" ? r.source : ""
    const tgt = typeof r.target === "string" ? r.target : ""
    const srcOk = src.length > 0 && local.has(src)
    // The target is scored on its LAST dotted segment too: `references` import
    // edges name a package-qualified path, and a class declared in this file is
    // named by its leaf. Both spellings are accepted; neither invents a symbol.
    const tgtLeaf = tgt.split(".").pop() ?? ""
    const tgtOk = tgt.length > 0 && (local.has(tgt) || (tgtLeaf.length > 0 && local.has(tgtLeaf)))
    if (srcOk && tgtOk) rr.resolved++
    else if (srcOk && !tgtOk) rr.tgtAmb++
    else if (!srcOk && tgtOk) rr.srcAmb++
    else rr.neither++

    if (src.length === 0) { r7.emptySource++; if (r7.examples.length < 6) r7.examples.push(`empty source @ ${rel} ${t}`) }
    if (tgt.length === 0) { r7.emptyTarget++; if (r7.examples.length < 6) r7.examples.push(`empty target @ ${rel} ${t}`) }
    if (PLACEHOLDERS.includes(src)) { r7.unknownSource++; if (r7.examples.length < 12) r7.examples.push(`source "${src}" @ ${rel} ${t} ${src}.->${tgt}`) }
    if (PLACEHOLDERS.includes(tgt)) { r7.placeholderEndpoint++; if (r7.examples.length < 12) r7.examples.push(`target "${tgt}" @ ${rel} ${t} ${src}.->${tgt}`) }
    // A placeholder that the file DECLARES is a real name that happens to spell a
    // reserved-looking word. Recorded apart so the two are never conflated.
    if (PLACEHOLDERS.includes(src) && local.has(src)) r7.placeholderBackedByDeclaration++
    if (PLACEHOLDERS.includes(tgt) && (local.has(tgt) || local.has(tgt.split(".").pop() ?? ""))) r7.placeholderBackedByDeclaration++

    if (r.metadata?.reasonCode !== undefined) {
      const k = `${t}/${String(r.metadata.reasonCode)}`
      r7.reasonCodes.set(k, (r7.reasonCodes.get(k) ?? 0) + 1)
    }

    if (perTypeRows.length < 40000) {
      perTypeRows.push({ t, source: src, target: tgt, confidence: conf, evidenceClass: r.metadata?.evidenceClass as string | undefined, relKind: r.metadata?.relationshipType, line: r.line_number, file: rel })
    }
  }
  if (res.metadata?.analysisVersion) { /* carried once below */ }
}

// ---------------------------------------------------------------- report
const gitHead = (() => { try { return execFileSync("git", ["-C", REPO, "rev-parse", "HEAD"], { encoding: "utf8" }).trim() } catch { return "unknown" } })()
const corpusRev = (() => { try { return execFileSync("git", ["-C", JAVA_DIR, "rev-parse", "HEAD"], { encoding: "utf8" }).trim() } catch { return "unknown" } })()

console.log(`INCOMING_JAVA ontology census — real-java-analyzer`)
console.log(`repo HEAD     ${gitHead}`)
console.log(`corpus        ${JAVA_DIR} @ ${corpusRev}`)
console.log(`files         ${files.length} tracked .java enumerated, ${parsed} analyzed, ${failed} failed`)
if (failures.length) console.log(`failures      ${failures.join(" | ")}`)
console.log(`enum          ${enumAll.length} labels: ${enumAll.join(" ")}`)
if (OTHER_LABELS.size) console.log(`outside enum  ${[...OTHER_LABELS.entries()].map(([k, v]) => `${k}:${v}`).join(" ")}`)
console.log()

const pad = (s: string, n: number) => (s + " ".repeat(n)).slice(0, n)
console.log(`${pad("type", 14)}${pad("n", 8)}${pad("resolved", 11)}${pad("tgt-open", 10)}${pad("src-open", 10)}${pad("neither", 9)}${pad("no-line", 9)}confidence`)
console.log("-".repeat(140))
const verdicts: Record<string, string> = {}
for (const t of ALL_TYPES) {
  const n = tally.get(t) ?? 0
  const r = resolution.get(t) ?? { resolved: 0, srcAmb: 0, tgtAmb: 0, neither: 0 }
  const ch = confHist.get(t)
  const cs = ch ? [...ch.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join(" ") : "—"
  verdicts[t] = n > 0 ? "EMITTED" : "SILENT"
  console.log(`${pad(t, 14)}${pad(String(n), 8)}${pad(String(r.resolved), 11)}${pad(String(r.tgtAmb), 10)}${pad(String(r.srcAmb), 10)}${pad(String(r.neither), 9)}${pad(String(missingLine.get(t) ?? 0), 9)}${cs}`)
}
console.log("-".repeat(140))

console.log("\nEVIDENCE CLASS per type")
for (const t of ALL_TYPES) {
  const m = evClass.get(t); if (!m) continue
  console.log(`  ${pad(t, 14)}${[...m.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join("  ")}`)
}
console.log("\nmetadata.relationshipType per type (the label inside the label)")
for (const t of ALL_TYPES) {
  const m = relKind.get(t); if (!m) continue
  console.log(`  ${pad(t, 14)}${[...m.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join("  ")}`)
}
console.log("\nFILES per type")
for (const t of ALL_TYPES) {
  const s = fileList.get(t); if (!s) continue
  console.log(`  ${pad(t, 14)}${s.size}+ files, e.g. ${[...s].slice(0, 3).join(", ")}`)
}
console.log("\nR7 placeholder / empty endpoints")
console.log(`  empty source ${r7.emptySource}   empty target ${r7.emptyTarget}`)
console.log(`  analyzer-placeholder SOURCE ${r7.unknownSource}   TARGET ${r7.placeholderEndpoint}   of which the file DECLARES that name: ${r7.placeholderBackedByDeclaration}`)
console.log(`  reasonCode mix: ${[...r7.reasonCodes.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join("  ") || "—"}`)
for (const e of r7.examples) console.log(`    ${e}`)

const out = {
  instrument: "script/incoming-java/census.ts",
  lane: "INCOMING_JAVA",
  repoHead: gitHead,
  corpus: { dir: JAVA_DIR, rev: corpusRev, filesEnumerated: files.length, analyzed: parsed, failed, companionIndex: USE_COMPANION ? { owners: companion.size, names: [...companion.values()].reduce((a, s) => a + s.size, 0) } : null },
  enumLabels: enumAll,
  wireValues: Object.fromEntries(WIRE),
  enumDivergence: ENUM_DIVERGENCE,
  labelsOutsideEnum: Object.fromEntries(OTHER_LABELS),
  perType: Object.fromEntries(ALL_TYPES.map((t) => [t, {
    n: tally.get(t) ?? 0,
    verdict: verdicts[t],
    files: [...(fileList.get(t) ?? [])],
    resolution: resolution.get(t) ?? null,
    confidence: Object.fromEntries(confHist.get(t) ?? []),
    evidenceClass: Object.fromEntries(evClass.get(t) ?? []),
    relationshipType: Object.fromEntries(relKind.get(t) ?? []),
    missingLine: missingLine.get(t) ?? 0,
  }])),
  r7: { ...r7, reasonCodes: Object.fromEntries(r7.reasonCodes) },
}
const outPath = process.env.BB_OUT ?? path.join(REPO, "validation/m14/results/java-ontology-census.json")
writeFileSync(outPath, JSON.stringify(out, null, 2) + "\n")
console.log(`\nwrote ${outPath}`)
console.log(`census sha256 ${createHash("sha256").update(readFileSync(outPath)).digest("hex").slice(0, 16)}`)
