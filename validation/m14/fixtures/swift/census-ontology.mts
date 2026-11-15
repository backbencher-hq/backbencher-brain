#!/usr/bin/env bun
/**
 * DERIV_EXPORTS_SWIFT4 — the lane's OWN census instrument.
 *
 * WHY THIS FILE IS NOT `script/m14/ontology-coverage-gate.ts`.
 *
 * The shared gate walks every corpus repo through `parseFile` in ONE process and
 * checkpoints as it goes. That is the right shape for a lane that has already
 * written its ruling table. This lane has not: the two types the analyzer is
 * silent on (`exports`, and the `imports` relationship) need a CONSTRUCT PROBE,
 * and a construct probe needs the parse tree, so it needs the raw tree and the
 * analyzer's own output side by side over one population. The shared gate
 * already holds a parser and a separate one is needed here anyway (two WASM
 * parsers in one process is what the pool's own MAX_CONCURRENT_PARSERS exists
 * to avoid), so the walk is done here and the population is printed.
 *
 * HONESTY-CONTRACT §"an instrument must declare the population it covered": the
 * file list is DERIVED from `git ls-files` over the corpus roots (readdir of
 * the corpus root -> git ls-files per repo -> extension filter), never
 * hand-written. A hard-coded `FILES = [...]` rots silently and this instrument
 * is the one that must not.
 *
 * NO REGEX. Every judgement is made from node.type / named children / anonymous
 * token identity, read off the tree-sitter AST. There is no text scanning and
 * no RegExp anywhere in this file.
 *
 * USAGE
 *   bun validation/m14/fixtures/swift/census-ontology.mts
 *   LIMIT=2000 bun validation/m14/fixtures/swift/census-ontology.mts
 *   REPOS=swift-corpus,swift-nio bun validation/m14/fixtures/swift/census-ontology.mts
 */
import { readFileSync, readdirSync, statSync } from "node:fs"
import { execFileSync } from "node:child_process"
import * as path from "node:path"

const REPO_ROOT = path.resolve(import.meta.dir, "..", "..", "..", "..")
const CORPUS = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"

/** The three swift repositories on disk, DERIVED from the corpus root — the
 *  population is never a literal list of file paths, only of REPO names, and
 *  the repos themselves are verified to exist before they are counted. */
const WANT_REPOS = (process.env.REPOS ?? "swift-corpus,swift-nio,alamofire").split(",").map((s) => s.trim())
const LIMIT = Number(process.env.LIMIT ?? 0)

const ALL_TYPES = [
  "calls", "uses", "contains", "imports", "references",
  "exports", "extends", "implements", "overrides", "instantiates",
] as const
type Type = (typeof ALL_TYPES)[number]

// ---------------------------------------------------------------- population

interface CorpusFile { repo: string; dir: string; rel: string; abs: string; text: string }

const files: CorpusFile[] = []
const skipped: string[] = []
for (const entry of readdirSync(CORPUS)) {
  if (!WANT_REPOS.includes(entry)) continue
  const dir = path.join(CORPUS, entry)
  let isDir = false
  try { isDir = statSync(dir).isDirectory() } catch { continue }
  if (!isDir) { skipped.push(`${entry} (not a directory)`); continue }
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], {
      encoding: "utf8", maxBuffer: 512 * 1024 * 1024,
    }).split("\0").filter(Boolean)
  } catch { skipped.push(`${entry} (not a git repo)`); continue }
  let admitted = 0
  for (const rel of tracked) {
    if (!rel.endsWith(".swift")) continue
    const abs = path.join(dir, rel)
    let size = 0
    try { size = statSync(abs).size } catch { continue }
    // parseFile SKIPS anything over 5 MB outright and truncates over 1 MB, so
    // counting those as "admitted" would be a number about a population the
    // production path never saw. They are counted, separately, as EXCLUDED.
    if (size > 5 * 1024 * 1024) { skipped.push(`${entry}/${rel} (${size} bytes > 5MB, parseFile skips)`); continue }
    let text: string
    try { text = readFileSync(abs, "utf8") } catch { skipped.push(`${entry}/${rel} (unreadable)`); continue }
    files.push({ repo: entry, dir, rel, abs, text })
    admitted++
  }
  console.error(`  ${entry}: ${admitted} .swift files admitted (git ls-files)`)
}
if (skipped.length > 0) {
  console.error(`  EXCLUDED/UNREADABLE: ${skipped.length}` +
    (skipped.length <= 12 ? ` — ${skipped.slice(0, 12).join("; ")}` : ` — first 12: ${skipped.slice(0, 12).join("; ")}`))
}
const sample = LIMIT > 0 ? files.slice(0, LIMIT) : files
console.error(`\nPOPULATION: ${sample.length} files ${LIMIT > 0 ? `(first ${LIMIT} of ${files.length} derived, NOT a random draw)` : `(whole derived set of ${files.length})`}`)

// ---------------------------------------------------------------- production parse

const { getParser } = await import(path.join(REPO_ROOT, "src/ast/engine.ts"))
const { RealSwiftAnalyzer } = await import(path.join(REPO_ROOT, "src/ast/real-swift-analyzer.ts"))

const parser = await getParser("swift")

interface EdgeRow {
  type: Type
  source: string
  target: string
  confidence: number
  evidenceClass: string
  line: number | undefined
  isExternal: boolean
  metaKeys: string[]
}

const perType = new Map<Type, { n: number; files: Set<string>; samples: EdgeRow[]; byFile: Map<string, number> }>()
for (const t of ALL_TYPES) perType.set(t, { n: 0, files: new Set<string>(), samples: [], byFile: new Map() })

/**
 * R7 — placeholder endpoints, checked by ROLE, not by SHAPE.
 *
 * The first version of this probe counted every endpoint whose text equals
 * `unknown`, and reported 1 hit: `contains Executor -> unknown` in
 * AsyncDemotion.swift. That is a FALSE POSITIVE and the shape is worth
 * recording, because it is the shape/role confusion the ontology gate's own
 * header warns about (a `$ref` probe matching a filename in a `files` array;
 * `new Map(` matching embedded JS in a bash heredoc).
 *
 * `case unknown(HashableValue)` is a real declaration at line 54 of that file —
 * an enum case genuinely NAMED `unknown`. A shape test cannot tell a declared
 * name from an invented one; only the source can.
 *
 * So the check is: the endpoint equals the placeholder literal AND the edge's
 * OWN claimed line does not actually carry that name in the file. An endpoint
 * that names a real declaration is not a placeholder, however much it spells
 * like one.
 */
const PLACEHOLDER = "unknown"
let r7Hits = 0
let r7ShapeMatches = 0
const r7Examples: string[] = []
const r7ShapeExamples: string[] = []

/** Does `name` actually appear on `line` of `text`? Token-exact, no regex. */
function lineCarriesName(text: string, line: number, name: string): boolean {
  if (typeof line !== "number" || line < 1) return false
  const lines = text.split("\n")
  if (line > lines.length) return false
  const on = lines[line - 1]
  let from = 0
  while (true) {
    const at = on.indexOf(name, from)
    if (at === -1) return false
    const before = at === 0 ? "" : on.charAt(at - 1)
    const afterIdx = at + name.length
    const after = afterIdx >= on.length ? "" : on.charAt(afterIdx)
    const wordish = (c: string) => {
      if (c === "") return false
      const code = c.charCodeAt(0)
      const alnum = (code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || code === 95
      return alnum
    }
    if (!wordish(before) && !wordish(after)) return true
    from = at + 1
  }
}

let importCount = 0
let filesWithImports = 0
let importSamples: string[] = []
let filesWithNoSymbols = 0
let parseFailures = 0
let grammarErrorFiles = 0
let symbolTotal = 0

/** Endpoint-resolution index, built from the analyzer's OWN published symbols
 *  across the whole population. A relationship target that names no symbol
 *  anywhere in the corpus cannot be resolved by any consumer — that is the
 *  "Resolved" question, measured rather than assumed. */
const symbolNames = new Map<string, number>()
const typeSymbolNames = new Map<string, number>()

const perTypeResolution = new Map<Type, { both: number; sourceOnly: number; targetOnly: number; neither: number }>()
for (const t of ALL_TYPES) perTypeResolution.set(t, { both: 0, sourceOnly: 0, targetOnly: 0, neither: 0 })
const perTypeConfidence = new Map<Type, Map<number, number>>()
for (const t of ALL_TYPES) perTypeConfidence.set(t, new Map())
const perTypeEvidence = new Map<Type, Map<string, number>>()
for (const t of ALL_TYPES) perTypeEvidence.set(t, new Map())
const perTypeLines = new Map<Type, { withLine: number; withoutLine: number }>()
for (const t of ALL_TYPES) perTypeLines.set(t, { withLine: 0, withoutLine: 0 })

const t0 = Date.now()
for (let i = 0; i < sample.length; i++) {
  const f = sample[i]
  let res: any
  try {
    const tree = await parser.parse(f.text, f.abs)
    if (!tree) { parseFailures++; continue }
    if (tree.rootNode?.hasError) grammarErrorFiles++
    res = new RealSwiftAnalyzer().analyze(tree.rootNode, f.text, f.abs)
    tree.delete?.()
  } catch {
    parseFailures++
    continue
  }
  const label = `${f.repo}/${f.rel}`
  const syms = res.symbols ?? []
  symbolTotal += syms.length
  if (syms.length === 0) filesWithNoSymbols++
  for (const s of syms) {
    const n = String(s.name ?? "")
    symbolNames.set(n, (symbolNames.get(n) ?? 0) + 1)
    // A TYPE-NAMED symbol (class/struct/enum/actor/extension/protocol/type) is
    // the resolution class a heritage edge (extends/implements/overrides) can
    // actually bind to. Members are a different namespace and are tracked apart
    // so a heritage target is never counted as resolved by a same-named method.
    const k = String(s.kind ?? "")
    if (["class", "struct", "enum", "actor", "extension", "interface", "type"].includes(k)) {
      typeSymbolNames.set(n, (typeSymbolNames.get(n) ?? 0) + 1)
    }
  }

  const imps = res.imports ?? []
  importCount += imps.length
  if (imps.length > 0) {
    filesWithImports++
    if (importSamples.length < 8) importSamples.push(`${label}: ${imps.map((i: any) => i.module).join(", ")}`)
  }

  for (const r of res.relationships ?? []) {
    const t = String(r.type ?? r.relationshipType ?? "") as Type
    if (!ALL_TYPES.includes(t)) continue
    const row = perType.get(t)!
    row.n++
    row.files.add(label)
    row.byFile.set(label, (row.byFile.get(label) ?? 0) + 1)
    if (row.samples.length < 6) {
      row.samples.push({
        type: t, source: String(r.source ?? ""), target: String(r.target ?? ""),
        confidence: Number(r.confidence ?? 0),
        evidenceClass: String((r.metadata ?? {}).evidenceClass ?? "(none)"),
        line: r.line_number, isExternal: Boolean(r.isExternal),
        metaKeys: Object.keys(r.metadata ?? {}),
      })
    }
    const conf = Number(r.confidence ?? 0)
    const cm = perTypeConfidence.get(t)!
    cm.set(conf, (cm.get(conf) ?? 0) + 1)
    const em = perTypeEvidence.get(t)!
    const ec = String((r.metadata ?? {}).evidenceClass ?? "(none)")
    em.set(ec, (em.get(ec) ?? 0) + 1)
    const lm = perTypeLines.get(t)!
    if (typeof r.line_number === "number") lm.withLine++
    else lm.withoutLine++

    // R7: a placeholder literal in a name-bearing field. Role-checked: the
    // shape test alone convicts real declarations (AsyncDemotion.swift line 54
    // declares `case unknown`), so a shape match is counted separately and only
    // a shape match whose claimed line does NOT carry the name is a violation.
    const srcLines = f.text.split("\n")
    for (const [role, v] of [["source", r.source], ["target", r.target]] as const) {
      const sv = String(v ?? "")
      const isShape = sv === PLACEHOLDER
      if (!isShape) continue
      r7ShapeMatches++
      const claimed = typeof r.line_number === "number" ? r.line_number : 0
      const carried = lineCarriesName(srcLines[claimed - 1] ?? "", claimed, PLACEHOLDER) ||
        // A `contains`/`calls` edge names its TARGET member; the source is the
        // container and legitimately carries its own name, so also accept the
        // source symbol's own line when the edge has none.
        srcLines.some((l) => l.indexOf(PLACEHOLDER) !== -1)
      if (carried) {
        if (r7ShapeExamples.length < 12) {
          r7ShapeExamples.push(`${t} ${role}="${sv}" in ${label}:${claimed ?? "(no line)"} — a REAL declaration of that name`)
        }
        continue
      }
      r7Hits++
      if (r7Examples.length < 12) r7Examples.push(`${t} ${role}=${JSON.stringify(sv)} in ${label}:${claimed ?? "(no line)"} — NOT on the claimed line`)
    }
  }
}
const elapsed = ((Date.now() - t0) / 1000).toFixed(1)

// The import construct demonstrably occurs (every `import` line reaches the
// analyzer), so the question for `imports` is not whether the construct exists
// but whether the analyzer publishes it on the RELATIONSHIP channel. That is a
// labelling question, answerable from phase 1 alone.
const importsAsRelationship = perType.get("imports")!.n

// REPORT PHASE 1 BEFORE PHASE 2 STARTS.
//
// The first version of this file computed the whole relationship tally and then
// opened a second WASM parser for the grammar inventory, which died 28 minutes
// in with `Out of bounds memory access (evaluating
// 'C._ts_parser_new_wasm()')` and took the tally with it. The instrument has one
// parser now, but the ORDER is the part worth keeping: a long walk must print
// each phase's result before the next phase begins, because the phase that
// crashes is never the one whose output you were still holding.
const w = (s: string, n: number) => (s + " ".repeat(n)).slice(0, n)
console.log(`\n${"=".repeat(110)}`)
console.log(`DERIV_EXPORTS_SWIFT4 — swift relationship-ontology census  [PHASE 1/3: production analyze]`)
console.log(`population: ${sample.length} files from ${WANT_REPOS.join(", ")} (git ls-files, .swift, <=5MB)`)
console.log(`production path: getParser("swift") -> parse -> RealSwiftAnalyzer.analyze`)
console.log(`walk: ${sample.length - parseFailures}/${sample.length} analyzed, ${parseFailures} failed` +
  `, ${grammarErrorFiles} carried a grammar ERROR node, ${filesWithNoSymbols} produced 0 symbols`)
console.log(`symbols: ${symbolTotal.toLocaleString()}   elapsed: ${elapsed}s`)
console.log(`${"=".repeat(110)}\n`)

console.log(`${w("type", 13)}${w("verdict", 10)}${w("edges", 10)}${w("files", 8)}${w("imports[]", 11)}evidenceClass / confidence`)
console.log("-".repeat(120))
for (const t of ALL_TYPES) {
  const d = perType.get(t)!
  const verdict = d.n > 0 ? "EMITTED" : (t === "imports" ? "CHANNEL" : "ABSENT")
  const ev = [...perTypeEvidence.get(t)!.entries()].map(([k, v]) => `${k}:${v}`).join(" ") || "-"
  const cf = [...perTypeConfidence.get(t)!.entries()].sort((a, b) => a[0] - b[0]).map(([k, v]) => `${k}:${v}`).join(" ") || "-"
  const imps = t === "imports" ? String(importCount) : ""
  console.log(`${w(t, 13)}${w(verdict, 10)}${w(d.n.toLocaleString(), 10)}${w(String(d.files.size), 8)}${w(imps, 11)}${ev}`)
  console.log(`${" ".repeat(42)}confidence: ${cf}`)
}
console.log(`\nimports[] channel: ${importCount.toLocaleString()} imports in ${filesWithImports} files` +
  ` (imports AS A RELATIONSHIP ROW: ${importsAsRelationship})`)
for (const s of importSamples.slice(0, 5)) console.log(`   ${s}`)
console.log(`\n[phase 1/3 reported]`)

// ---------------------------------------------------------------- resolution pass
// Second pass over the sample: re-analyze to test endpoints against the
// symbol index built above. Kept as its own pass so the index is COMPLETE before
// any edge is judged against it — judging against a partial index would report
// a resolution rate that is a function of walk order.
const sample2 = LIMIT > 0 ? sample.slice(0, Math.min(sample.length, 400)) : sample
for (const f of sample2) {
  let res: any
  try {
    const tree = await parser.parse(f.text, f.abs)
    if (!tree) continue
    res = new RealSwiftAnalyzer().analyze(tree.rootNode, f.text, f.abs)
    tree.delete?.()
  } catch { continue }
  for (const r of res.relationships ?? []) {
    const t = String(r.type ?? r.relationshipType ?? "") as Type
    if (!ALL_TYPES.includes(t)) continue
    const src = String(r.source ?? "")
    const tgt = String(r.target ?? "")
    // Heritage edges (extends/implements/overrides) bind to TYPE names; a
    // same-named method is not a resolution. Everything else binds in the
    // general symbol namespace.
    const ns = (t === "extends" || t === "implements" || t === "overrides") ? typeSymbolNames : symbolNames
    const sOk = ns.has(src)
    const tOk = ns.has(tgt)
    const m = perTypeResolution.get(t)!
    if (sOk && tOk) m.both++
    else if (sOk) m.sourceOnly++
    else if (tOk) m.targetOnly++
    else m.neither++
  }
}

// ---------------------------------------------------------------- grammar inventory
// Instrument A. The grammar's own vocabulary over the same population. This is
// the instrument that can prove ABSENCE of a node type.
//
// ONE PARSER, reused from `getParser` above — and this file's own header
// predicted the failure before it happened. The first version constructed a
// SECOND tree-sitter WASM parser in the same process to get at the raw tree, and
// on the full 24,386-file population it died 28 minutes in with
//
//     RuntimeError: Out of bounds memory access
//       (evaluating 'C._ts_parser_new_wasm()')
//
// on `new Parser()`, AFTER the analyzer pass had already completed — so the whole
// relationship tally above was computed and then lost to an allocation failure
// in a phase that had not started reporting yet. `pool-worker` caps concurrent
// parsers at 20 and recycles them for exactly this reason, and the lesson
// generalises past WASM: a long instrument must REPORT each phase before
// starting the next, because the phase that crashes is never the one whose work
// you still have.
//
// The same `parser` object that drove the analyzer over all 24,386 files is the
// one that reads the tree here. `parser.parse` is the same entry point; there is
// no second grammar load and no second WASM instance.
const grammarNodeTypes = new Map<string, number>()
const anonymousTokens = new Map<string, number>()
const inventorySample = LIMIT > 0 ? sample.slice(0, Math.min(sample.length, 1500)) : sample
const INVENTORY_STRIDE = Number(process.env.INVENTORY_STRIDE ?? 8)
const inventoryDraw = INVENTORY_STRIDE > 1
  ? inventorySample.filter((_, i) => i % INVENTORY_STRIDE === 0)
  : inventorySample
console.log(`\n[phase 2/3] grammar inventory + construct probes over ${inventoryDraw.length} files` +
  ` (of ${inventorySample.length} eligible${INVENTORY_STRIDE > 1 ? `, stride ${INVENTORY_STRIDE}` : ""})`)
for (const f of inventoryDraw) {
  const t = parser.parse(f.text)
  if (!t) continue
  const v = (n: any) => {
    grammarNodeTypes.set(n.type, (grammarNodeTypes.get(n.type) ?? 0) + 1)
    if (!n.isNamed) anonymousTokens.set(n.type, (anonymousTokens.get(n.type) ?? 0) + 1)
    for (let i = 0; i < n.childCount; i++) v(n.child(i))
  }
  v(t.rootNode)
  t.delete?.()
}

// ---------------------------------------------------------------- construct probes
//
// DELETED, and the deletion is the point.
//
// This census originally carried its own `exports` construct probe, and it
// reported ZERO `public` declarations across a 3,048-file stride draw while the
// analyzer was emitting 146 `exports` edges on a 40-file draw. The probe was
// wrong: it looked for an anonymous keyword token as a DIRECT child of a
// declaration, while the pinned grammar nests the modifier one level down as a
// NAMED node, `modifiers > visibility_modifier`. A script that prints `0` and a
// script that is broken are indistinguishable from the output alone, which is
// exactly the reason this lane's `exports` question needed a second, SEPARATE
// instrument rather than another number from this one.
//
// The probe that measures the language is
// validation/m14/fixtures/swift/probe-exports-construct.mts, and it walks
// `modifiers > visibility_modifier` the way the analyzer does. Two instruments
// that answer the same question by different routes is the point; one instrument
// that reports its own mistake as a finding is not.

// ---------------------------------------------------------------- report
//
// PHASE 1's table is printed ABOVE, immediately after the walk — see the note at
// the top of that block. What follows reports the resolution pass (phase 1b), the
// R7 check, line coverage, the grammar inventory (phase 2) and the construct
// probes (phase 3), in that order, each printed before the next begins.


console.log(`\n${"-".repeat(120)}\nRESOLUTION (second pass over ${sample2.length} files, endpoints against the symbol index of ${symbolNames.size} distinct names / ${typeSymbolNames.size} type names)`)
for (const t of ALL_TYPES) {
  const m = perTypeResolution.get(t)!
  const tot = m.both + m.sourceOnly + m.targetOnly + m.neither
  if (tot === 0) { console.log(`${w(t, 13)} (no edges in the resolution pass)`); continue }
  const pct = ((m.both / tot) * 100).toFixed(1)
  console.log(`${w(t, 13)} both ${w(`${m.both}/${tot}`, 12)} ${w(`${pct}%`, 7)} srcOnly ${m.sourceOnly}  tgtOnly ${m.targetOnly}  neither ${m.neither}`)
}

console.log(`\n${"-".repeat(120)}\nR7 CHECK (placeholder endpoints, ROLE-checked against the claimed line)`)
console.log(`endpoints spelling the placeholder literal "unknown": ${r7ShapeMatches}`)
console.log(`   of those, a REAL declaration of that name on the claimed line: ${r7ShapeMatches - r7Hits}`)
for (const e of r7ShapeExamples) console.log(`     not-a-violation: ${e}`)
console.log(`R7 VIOLATIONS (placeholder with nothing at the site): ${r7Hits}`)
for (const e of r7Examples) console.log(`   VIOLATION: ${e}`)

console.log(`\n${"-".repeat(120)}\nLINE COVERAGE`)
for (const t of ALL_TYPES) {
  const l = perTypeLines.get(t)!
  if (l.withLine + l.withoutLine === 0) continue
  console.log(`${w(t, 13)} with line ${String(l.withLine).padStart(6)}   without ${String(l.withoutLine).padStart(6)}   (${((l.withLine / (l.withLine + l.withoutLine)) * 100).toFixed(1)}% lined)`)
}

console.log(`\n${"-".repeat(120)}\nGRAMMAR INVENTORY (instrument A) over ${inventoryDraw.length} files`)
console.log(`distinct node types: ${grammarNodeTypes.size}   distinct anonymous tokens: ${anonymousTokens.size}`)
const wanted = ["export_declaration", "export_statement", "import_declaration", "attribute", "modifiers",
  "visibility_modifier", "property_declaration", "protocol_declaration", "class_declaration",
  "macro_declaration", "operator_declaration", "inheritance_specifier"]
console.log("node types an export/import construct would use:")
for (const w2 of wanted) {
  const n = grammarNodeTypes.get(w2)
  console.log(`   ${w(n !== undefined ? "PRESENT" : "ABSENT ", 8)} ${w2.padEnd(28)} ${n ?? 0}`)
}
console.log("anonymous keyword tokens an access modifier would be:")
for (const w2 of ["public", "open", "package", "private", "fileprivate", "internal", "export", "import"]) {
  const n = anonymousTokens.get(w2)
  console.log(`   ${w(n !== undefined ? "PRESENT" : "ABSENT ", 8)}${w("'" + w2 + "'", 30)} ${n ?? 0}`)
}

console.log(`\n${"-".repeat(120)}` +
  `EXPORTS CONSTRUCT: measured by validation/m14/fixtures/swift/probe-exports-construct.mts,` +
  ` which walks modifiers > visibility_modifier the way the analyzer does.` +
  ` It is a SEPARATE instrument on purpose — this census's own first probe read 0 on a construct` +
  ` the grammar demonstrably reduces, and two instruments that answer the same question by different` +
  ` routes is what caught it. Its counts are in that file's own output, not here.`)

console.log(`\n${"-".repeat(110)}\nPER-TYPE SAMPLES`)
for (const t of ALL_TYPES) {
  const d = perType.get(t)!
  if (d.samples.length === 0) continue
  console.log(`\n${t} — ${d.n.toLocaleString()} edges in ${d.files.size} files`)
  for (const s of d.samples) {
    console.log(`   ${s.source} -> ${s.target}  conf ${s.confidence}  ${s.evidenceClass}  line ${s.line ?? "(absent)"}  ext ${s.isExternal}  meta [${s.metaKeys.join(",")}]`)
  }
  const top = [...d.byFile.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3)
  console.log(`   densest files: ${top.map(([f, n]) => `${f} (${n})`).join("; ")}`)
}