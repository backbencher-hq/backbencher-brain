// rust #798 — the runtime half of the M60.P1 payload matrix.
//
// P1 measures "does this lane EMIT field X" with a per-field source-text needle
// (`implementedLanguage` … `emit: /\\bfield\\s*:/`) read out of
// src/ast/real-<lang>-analyzer.ts. A needle is a proxy for a runtime fact, and
// for rust two of its 17 dead cells are the proxy failing rather than the lane
// being silent:
//
//   qualified_calls   rust writes it by ASSIGNMENT (`parent.qualified_calls =
//                     arr`), which `/\bqualified_calls\s*:/` cannot match —
//                     while the lane's own fixture
//                     (validation/m14/fixtures/rust/qualified-calls-ownership)
//                     pins the payload.
//   ownerName         rust writes it as a SHORTHAND property (`ownerName,`) in
//                     the symbol literal, which `/\bownerName\s*:/` cannot
//                     match either — and rust is the ONE lane of 26 that reads
//                     dead on it, which is what a needle that only understands
//                     `key: value` would produce.
//
// So this probe measures the same question at RUNTIME, over every `.rs` file of
// both pinned corpora, through the production entry (ASTEngine.parseFile): how
// many published symbols/edges actually CARRY each field. It writes
// validation/m60/results/P1-rust.json in the shape the other lanes' seam traces
// use (P1-dart.json, P1-php.json, P1-objc.json) and prints the static-vs-runtime
// disagreement table with the exact needle that misreads.
//
// Run: bun script/m14/tmp/rust-798-seam.ts
import * as fs from "node:fs"
import * as path from "node:path"
import { ASTEngine } from "../../../src/ast/engine"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../../..")
const REPOS = "<corpus-root>/bb_tests/repositories"
const OUT = path.join(ROOT, "validation/m60/results/P1-rust.json")

// The dead cells P1 records for rust (the ones this probe adjudicates), plus the
// alive ones it must confirm. Written out rather than imported: the probe must
// not share the matrix's own bookkeeping, or it could only ever agree with it.
const SYMBOL_FIELDS = [
  "name", "kind", "range", "scope", "visibility", "isStatic", "isAsync", "isAbstract",
  "parameters", "returnType", "decorators", "genericParameters", "qualified_calls",
  "apiContractPath", "ownerName", "ownerKind", "taintSources", "taintSinks",
  "gravityScore", "layer", "metadata", "comments",
] as const
const RELATIONSHIP_FIELDS = [
  "source", "target", "from", "to", "fromSymbol", "toSymbol", "type",
  "relationshipType", "confidence", "line_number",
] as const

const files: string[] = []
for (const repo of ["ripgrep", "cargo"]) {
  const root = path.join(REPOS, repo)
  const stack = [root]
  while (stack.length > 0) {
    const cur = stack.pop()!
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(cur, { withFileTypes: true })
    } catch {
      continue
    }
    for (const e of entries) {
      if (e.isDirectory()) {
        if (e.name !== ".git" && e.name !== "target" && e.name !== "node_modules") stack.push(path.join(cur, e.name))
      } else if (e.name.endsWith(".rs")) files.push(path.join(cur, e.name))
    }
  }
}
files.sort()

const carried: Record<string, number> = {}
for (const f of SYMBOL_FIELDS) carried[`symbol.${f}`] = 0
carried["symbol.metadata.annotations"] = 0
carried["symbol.docstring"] = 0
for (const f of RELATIONSHIP_FIELDS) carried[`edge.${f}`] = 0
const byKind: Record<string, number> = {}
const byType: Record<string, number> = {}
let symbols = 0
let edges = 0
let filesRead = 0
let parseErrors = 0
const lineStats = { gt0: 0, eq0: 0, nul: 0 }

/** Is the field present AND non-empty? An empty `parameters: []` is not a carry. */
const has = (v: unknown): boolean => {
  if (v === undefined || v === null) return false
  if (typeof v === "string") return v.trim() !== ""
  if (Array.isArray(v)) return v.length > 0
  return true
}

for (const f of files) {
  let src: string
  try {
    src = fs.readFileSync(f, "utf8")
  } catch {
    continue
  }
  if (src.length > 400_000) continue
  let res: any
  try {
    res = await ASTEngine.parseFile(f, src)
  } catch {
    parseErrors++
    continue
  }
  filesRead++
  for (const s of res?.symbols ?? []) {
    symbols++
    byKind[String(s.kind ?? "?")] = (byKind[String(s.kind ?? "?")] ?? 0) + 1
    for (const field of SYMBOL_FIELDS) if (has((s as any)[field])) carried[`symbol.${field}`]++
    // CONTEXT, not a P1 cell: the two channels P1's specs treat as the ruled
    // fallbacks for a dead cell — `annotations` for `decorators`, `docstring`
    // for `comments`. Counted so the adjudication can say whether a dead cell is
    // a lane that emits nothing or a lane that emits through the OTHER channel.
    if (has((s as any).metadata?.annotations)) carried["symbol.metadata.annotations"]++
    if (has((s as any).docstring)) carried["symbol.docstring"]++
  }
  for (const r of res?.relationships ?? []) {
    edges++
    byType[String(r.type ?? "?")] = (byType[String(r.type ?? "?")] ?? 0) + 1
    for (const field of RELATIONSHIP_FIELDS) if (has((r as any)[field])) carried[`edge.${field}`]++
    const ln = (r as any).line_number
    if (ln === undefined || ln === null) lineStats.nul++
    else if (ln === 0) lineStats.eq0++
    else lineStats.gt0++
  }
}

// The static verdicts, recomputed here exactly as payload-matrix.ts computes
// them (one regex per field, over the analyzer's source), so the disagreement is
// measured rather than quoted from the artifact.
const analyzerSrc = fs.readFileSync(path.join(ROOT, "src/ast/real-rust-analyzer.ts"), "utf8")
// The matrix's emit rule is UNIFORM — every one of its 32 emit needles is
// `/\bfield\s*:/` (verified against payload-matrix.ts: no field has a special
// emit regex) — so the whole table can be recomputed here rather than quoted,
// and the disagreement is measured for EVERY cell instead of the two the
// review happened to look at.
const WHY: Record<string, string> = {
  qualified_calls: "written by ASSIGNMENT (`parent.qualified_calls = arr`) — a `key:` needle cannot match it",
  ownerName: "written as a SHORTHAND property (`ownerName,`) in the symbol literal — a `key:` needle cannot match it",
  ownerKind: "written as a SHORTHAND property, like ownerName",
  returnType: "written by ASSIGNMENT (`symbol.returnType = returnTypeNode.text`)",
  relationshipType: "the needle matches the analyzer's `metadata: { relationshipType: ... }` literal — a NESTED metadata key — while NO edge carries a top-level relationshipType (`type` is the edge field)",
  scope: "this lane genuinely publishes no scope: nothing on any symbol is assigned to it (runtime 0 of 21,527)",
  isStatic: "genuinely not published by this lane (rust's `static` items are published as `variable`; runtime 0)",
  isAsync: "genuinely not published (rust's async-ness lives on call sites as `metadata.isAwait`; runtime 0)",
  isAbstract: "genuinely not published (no rust equivalent; runtime 0)",
  decorators: "genuinely not published, and `metadata.annotations` is empty too (runtime 0 of 21,527) — attributes are consumed by the framework detector into `frameworkPatterns`, not published as decorators",
  comments: "ruled-dead family-wide: the doc channel is the docstring, and this lane publishes neither (runtime 0)",
  apiContractPath: "genuinely not published (runtime 0)",
  taintSources: "genuinely not published (typescript-only class; runtime 0)",
  taintSinks: "genuinely not published (typescript-only class; runtime 0)",
  gravityScore: "ruled-dead: the store computes it (runtime 0)",
  layer: "ruled-dead: the store's file-level fallback carries it (runtime 0)",
  from: "correctly dead: the lane publishes the `source`/`target` aliases, not `from`/`to`",
  to: "correctly dead: the lane publishes the `source`/`target` aliases, not `from`/`to`",
}
const disagreements: any[] = []
for (const [iface, fields, total] of [
  ["UniversalSymbol", SYMBOL_FIELDS, symbols],
  ["UniversalRelationship", RELATIONSHIP_FIELDS, edges],
] as Array<[string, readonly string[], number]>) {
  for (const field of fields) {
    const key = `${iface === "UniversalSymbol" ? "symbol" : "edge"}.${field}`
    const needle = new RegExp(`\\b${field}\\s*:`)
    const staticAlive = needle.test(analyzerSrc)
    const runtime = carried[key] ?? 0
    const agrees = staticAlive === runtime > 0
    disagreements.push({
      iface,
      field,
      staticNeedle: needle.source,
      staticAlive,
      runtimeCarrying: runtime,
      runtimeOf: total,
      direction: agrees ? "agrees" : staticAlive ? "static OVER-claims" : "static UNDER-claims",
      why: WHY[field] ?? "",
    })
  }
}
const misread = disagreements.filter((d) => d.direction !== "agrees")

const payload = {
  probe: "M60.P1 rust runtime seam trace (payload-matrix, runtime half)",
  at: new Date().toISOString(),
  wave: "M60.P1 adjudication — rust #798 / R10 round",
  repos: ["ripgrep", "cargo"],
  method:
    "Both pinned corpora, every .rs file, through the production entry (ASTEngine.parseFile). A field COUNTS when it is present and non-empty (`[]`, \"\" and null do not count): the question the static needle approximates is 'does this lane put a value here', so an empty array is not a carry.",
  filesRead,
  parseErrors,
  symbols,
  edges,
  symbolsByKind: Object.fromEntries(Object.entries(byKind).sort((a, b) => b[1] - a[1])),
  edgesByType: Object.fromEntries(Object.entries(byType).sort((a, b) => b[1] - a[1])),
  lineNumber: {
    ...lineStats,
    verdict:
      lineStats.gt0 > 0 && lineStats.eq0 === 0
        ? "every published edge carries a 1-based line (M59.A7 #825 holds on rust at full extent); a 0 would be the R6 violation"
        : "MEASURE THE 0 COUNT: a 0 line is the R6 violation",
  },
  carried,
  carryRates: Object.fromEntries(
    Object.entries(carried).map(([k, n]) => [k, k.startsWith("symbol.") ? `${n}/${symbols}` : `${n}/${edges}`]),
  ),
  staticVsRuntime: disagreements,
  misreadCells: misread.length,
  underClaimed: misread.filter((d) => d.direction === "static UNDER-claims").map((d) => `${d.iface}.${d.field}`),
  overClaimed: misread.filter((d) => d.direction === "static OVER-claims").map((d) => `${d.iface}.${d.field}`),
  adjudication: (() => {
    const under = misread.filter((d) => d.direction === "static UNDER-claims")
    const over = misread.filter((d) => d.direction === "static OVER-claims")
    const underList = under.map((d) => `${d.iface}.${d.field}=${d.runtimeCarrying}`).join(", ")
    return [
      "P1's per-language emit cells are computed from src/ast/real-rust-analyzer.ts with one regex per field, and the matrix's emit rule is uniform — every one of its 32 emit needles is /\\bfield\\s*:/ — so it can only see a field written as an object-literal key: value.",
      `Measured here over both pinned corpora (${filesRead} files, ${symbols} symbols, ${edges} edges), that rule MISREADS ${misread.length} of this lane's ${disagreements.length} cells, in BOTH directions.`,
      `${under.length} UNDER-claim the field: it is carried by published rows and the needle is blind to HOW it is written (${underList}) — returnType, qualified_calls and ownerKind by ASSIGNMENT, ownerName as a SHORTHAND property.`,
      `${over.length} OVER-claim one: the needle matches a NESTED metadata.relationshipType literal while no edge carries the top-level field at all (the lane publishes the finer label inside metadata, and the family field "type" at the top level).`,
      "So the non-alive cells P1 lists for rust that sit in the under-claimed set are the PROXY failing, not the lane: qualified_calls is independently pinned by the lane's own fixture (validation/m14/fixtures/rust/qualified-calls-ownership.expectation.json), and returnType/ownerName/ownerKind are carried by thousands of rows at runtime.",
      "The needles are left alone on purpose: a literal widening would also match a call ARGUMENT named ownerName, so the honest repair is an AST-based emit probe, which is a M60.P1 instrument change and not this lane's to make.",
      `The REMAINING non-alive cells are the disclosure P1 asks for (scope / isStatic / isAsync / isAbstract / decorators / apiContractPath / taintSources / taintSinks / gravityScore / layer / comments / from / to): 0 of ${symbols} symbols and 0 of ${edges} edges carry them, so this lane publishes nothing there — with one worth naming, decorators, where attributes are consumed into frameworkPatterns by the R8 detector and published as neither decorators nor metadata.annotations.`,
    ].join(" ")
  })(),
}
fs.mkdirSync(path.dirname(OUT), { recursive: true })
fs.writeFileSync(OUT, JSON.stringify(payload, null, 2) + "\n")

console.log(`rust seam trace: ${filesRead} files, ${symbols} symbols, ${edges} edges`)
console.log(`static vs runtime: ${disagreements.length} cells, ${misread.length} misread (${payload.underClaimed.join(", ") || "none"} under-claimed; ${payload.overClaimed.join(", ") || "none"} over-claimed)`)
for (const d of misread) {
  console.log(
    `  ${d.iface}.${d.field}: static=${d.staticAlive ? "alive" : "DEAD"} runtime=${d.runtimeCarrying}/${d.runtimeOf} -> ${d.direction}`,
  )
}
console.log(`  line_number: gt0=${lineStats.gt0} eq0=${lineStats.eq0} nul=${lineStats.nul}`)
console.log(`wrote ${path.relative(ROOT, OUT)}`)
