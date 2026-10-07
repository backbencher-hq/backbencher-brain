/**
 * JAVA ONTOLOGY CENSUS — the EXPORTS_JAVA2 lane instrument.
 *
 * WHY THIS FILE EXISTS AND WHY IT IS SEPARATE FROM script/m14/firing-check-v2.mjs
 *
 * firing-check-v2 answers one question: does the analyzer put type T on the
 * RELATIONSHIP channel for a sample of N files. That is the right question and
 * it is not enough for this lane, because ParseResult carries THREE channels:
 *
 *     relationships: UniversalRelationship[]   <- firing-check tallies this
 *     imports:       ImportInfo[]              <- persisted to the brain_import TABLE
 *     exports:       ExportInfo[]              <- persisted by NOTHING
 *
 * MEASURED, not inferred: `grep -rn "result\.exports\|res\.exports" src/` finds
 * exactly one writer-side read (engine.ts:1801, a pass-through into ParseResult)
 * and NO read in parallel-indexer.ts, which is the only thing that writes
 * brain_relationship. So a lane can hold a perfectly good export surface, in the
 * channel no consumer reads, and still score "silent" on the relationship
 * channel. That is what java does (measured below), and a verdict built on
 * firing-check alone would call it RULED with the construct sitting right there.
 *
 * WHAT IT MEASURES, all on the PRODUCTION path (getParser -> parse -> analyze):
 *   1. per-type counts + the files they came from, for all three channels
 *   2. confidence and evidenceClass distributions per type   (Part 1 q6)
 *   3. endpoint classification per type, three ways (Part 1 q5 + R7):
 *        RESOLVES            the endpoint binds to a symbol THIS file declares
 *        NOT_AN_IDENTIFIER   the endpoint cannot be a Java name at all
 *        PLACEHOLDER_LITERAL a syntactically valid identifier that is a
 *                            stand-in for an absent name (`unknown`, `TODO`)
 *      The three are reported separately because they call for different
 *      repairs, and because a curated literal list that convicts `value` or
 *      `constructor` — ordinary Java names, and `constructor` is this lane's own
 *      documented constructor spelling (JD24) — reports noise as debt.
 *   4. the EXPORT SET's visibility distribution, because an `exports` edge at
 *      confidence 1.0 asserts importability and Java's importability rule is
 *      `public` at top level (JLS 6.5.5.1, 7.6): a package-private top-level
 *      type is bindable only inside its own package. If the corpus has none of
 *      those, a confidence tier for them would be dead code and must not ship.
 *   5. a CONSTRUCT CENSUS on the parse tree for every type the analyzer does
 *      NOT emit, so a RULED verdict rests on a count and not on prose. Two
 *      instruments, the gate's own taxonomy:
 *        A: grammar inventory  — every node type the grammar produces. Positive
 *           evidence of ABSENCE for a type needing a node type java has not got.
 *        B: parse-tree count    — for a construct java CAN express, no grammar
 *           inventory finds it; it has to be counted on the tree, where a string
 *           literal or a comment cannot fake it.
 *
 * NO REGEX. Not one regular expression anywhere in this file. Every
 * programmatic step is a tree walk over node.type / namedChildren / field names,
 * or a character walk. See script/m14/no-regex-gate.sh for the family rule.
 *
 * USAGE (from the lane worktree root, so it measures THIS lane's analyzer):
 *   bun script/m14/lanes/java-ontology-census.ts                  # all files
 *   LANE_NFILES=200 bun script/m14/lanes/java-ontology-census.ts
 */
import { readFileSync, readdirSync } from "node:fs"
import { join, relative } from "node:path"
import { getParser } from "../../../src/ast/engine"
import { RealJavaAnalyzer } from "../../../src/ast/real-java-analyzer"

// ------------------------------------------------------------------ config
const CORPUS_ROOT = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const REPO_DIR = process.env.BB_REPO ?? "java-lib"
const LANE_NFILES = Number(process.env.LANE_NFILES ?? 0) // 0 = every .java file on disk
const CONCURRENCY = Number(process.env.LANE_CONC ?? 8)

// The ten relationship types, named by the value production emits. engine.ts's
// enum is the production vocabulary (analyzers reach it as
// ASTEngine.RelationshipType); types.ts carries the same ten after 87dc4ef92.
// Denominator spelled out here so the script cannot drift from either enum.
const TEN = ["calls", "extends", "implements", "uses", "imports", "exports", "contains", "references", "overrides", "instantiates"] as const
type Type = (typeof TEN)[number]

// ------------------------------------------------------------------ endpoint classification
/** A Java identifier, a dotted name, or a `A.b` / `A:b` compound endpoint
 *  (this lane's spelling for a qualified reference). Anything carrying
 *  whitespace, brackets, angle brackets, a question mark, a semicolon, a
 *  bracket pair or a space-colon is not a name any Java declaration can carry.
 *  Character walk, no regex. */
function nameShapeOk(s: string): boolean {
  if (!s) return false
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    const ok =
      (c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || (c >= "0" && c <= "9") ||
      c === "_" || c === "$" || c === "." || c === ":"
    if (!ok) return false
  }
  return true
}
/** PLACEHOLDER_LITERAL: a syntactically valid identifier that is nonetheless a
 *  stand-in for a name nobody wrote. Standing rule R7
 *  (validation/m60/ledger.json). An exact list, because `value`, `constructor`,
 *  `self`, `Object` and `String` are ORDINARY Java names — a list that convicts
 *  them is a list that reports noise as debt. */
const PLACEHOLDER_LITERALS = new Set<string>(["unknown", "undefined", "anonymous", "TODO", "todo", "n/a", "na", "<unknown>", "?", "-", "default"])
function classifyEndpoint(name: unknown): "RESOLVES" | "NOT_AN_IDENTIFIER" | "PLACEHOLDER_LITERAL" | "NAME" {
  const s = name === undefined || name === null ? "" : String(name)
  if (s.length === 0) return "NOT_AN_IDENTIFIER"
  if (!nameShapeOk(s)) return "NOT_AN_IDENTIFIER"
  if (PLACEHOLDER_LITERALS.has(s)) return "PLACEHOLDER_LITERAL"
  return "NAME"
}

// ------------------------------------------------------------------ corpus
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
all.sort() // deterministic: lexicographic, independent of readdir order
const files = LANE_NFILES > 0 ? all.slice(0, LANE_NFILES) : all
const label = (p: string) => relative(dir, p)

console.log(`JAVA ONTOLOGY CENSUS (EXPORTS_JAVA2)`)
console.log(`corpus: ${REPO_DIR}   .java files on disk: ${all.length}   measured: ${files.length}   sampling: ${LANE_NFILES > 0 ? `first ${LANE_NFILES} lexicographic` : "ALL (lexicographic)"}`)
console.log(`production vocabulary (${TEN.length}): ${TEN.join(" ")}\n`)

// ------------------------------------------------------------------ accumulators
type Acc = {
  n: number
  files: Set<string>
  examples: string[]
  conf: Map<string, number>
  ev: Map<string, number>
  /** per type: how many endpoints fall in each class */
  cls: Map<string, number>
  /** how many of the plain-NAME endpoints resolved to a symbol this file declares */
  nameEnds: number
  nameRes: number
  r7: Map<string, number>
  r7Examples: string[]
  shapeExamples: string[]
}
const acc: Map<Type, Acc> = new Map()
function slot(t: Type): Acc {
  let a = acc.get(t)
  if (!a) {
    a = { n: 0, files: new Set(), examples: [], conf: new Map(), ev: new Map(), cls: new Map(), nameEnds: 0, nameRes: 0, r7: new Map(), r7Examples: [], shapeExamples: [] }
    acc.set(t, a)
  }
  return a
}

let importsTotal = 0
const importsFiles = new Set<string>()
let exportsTotal = 0
const exportsFiles = new Set<string>()
const offEnum = new Map<string, number>()
let filesWithNoSymbols = 0
let parseFailures = 0
let totalRelationships = 0
let totalSymbols = 0
let filesWithErrors = 0
let ownerlessNonType = 0
const ownerlessNonTypeFiles = new Set<string>()
const ownerlessNonTypeExamples: string[] = []
// export-set visibility: does the importable-unit set hold only PUBLIC types?
const exportVis = new Map<string, number>()
let exportSetNoPackage = 0
// symbol-level R7 at runtime
let symNameUnknown = 0
let symEmptyName = 0
let paramTypeUnknown = 0
const symUnknownExamples: string[] = []

// instrument A: grammar inventory, shared across every probe
const grammarTypes = new Map<string, number>()
// instrument B: semantic construct counts
type Probe = { name: string; count: number; files: Set<string>; examples: string[] }
const probes: Probe[] = []
function probe(name: string): Probe {
  let p = probes.find((x) => x.name === name)
  if (!p) { p = { name, count: 0, files: new Set<string>(), examples: [] }; probes.push(p) }
  return p
}

const t0 = Date.now()
let cursor = 0
async function worker() {
  while (true) {
    const i = cursor++
    if (i >= files.length) return
    const p = files[i]
    const L = label(p)
    let content: string
    let rootNode: any
    try {
      content = readFileSync(p, "utf8")
      const parser = await getParser("java")
      const pr = await parser.parse(content, p)
      rootNode = pr.rootNode
    } catch {
      parseFailures++
      continue
    }
    if (rootNode?.hasError) filesWithErrors++

    // ---- instrument A, one walk, shared with every probe
    {
      const stack = [rootNode]
      while (stack.length) {
        const n = stack.pop()
        grammarTypes.set(n.type, (grammarTypes.get(n.type) ?? 0) + 1)
        for (let k = 0; k < n.childCount; k++) stack.push(n.child(k))
      }
    }

    // ---- instrument B: JPMS / module-info constructs, counted SEMANTICALLY
    // (the directive node's own package/name field), never by text match.
    {
      const stack = [rootNode]
      const isModuleInfo = L.endsWith("module-info.java")
      if (isModuleInfo) probe("module-info.java file").count++, probe("module-info.java file").files.add(L)
      while (stack.length) {
        const n = stack.pop()
        if (n.type === "module_declaration") {
          const pr2 = probe("module_declaration")
          pr2.count++
          pr2.files.add(L)
          if (pr2.examples.length < 5) {
            const nameNode = n.namedChildren?.find((c: any) => c.type === "identifier")
            pr2.examples.push(`${L}: module ${nameNode?.text ?? "(unnamed)"}`)
          }
        }
        if (n.type === "exports_module_directive") {
          const pr2 = probe("exports_module_directive")
          pr2.count++
          pr2.files.add(L)
          if (pr2.examples.length < 5) {
            const mods = n.children?.filter((c: any) => c.type === "identifier").map((c: any) => c.text) ?? []
            const pkg = n.namedChildren?.find((c: any) => c.type === "identifier" || c.type === "scoped_identifier")
            pr2.examples.push(`${L}: exports ${pkg?.text ?? "?"}${mods.length ? " to " + mods.join(" ") : ""}`)
          }
        }
        if (n.type === "opens_module_directive") { const q = probe("opens_module_directive"); q.count++; q.files.add(L) }
        if (n.type === "requires_module_directive") { const q = probe("requires_module_directive"); q.count++; q.files.add(L) }
        if (n.type === "uses_module_directive") { const q = probe("uses_module_directive"); q.count++; q.files.add(L) }
        if (n.type === "provides_module_directive") { const q = probe("provides_module_directive"); q.count++; q.files.add(L) }
        for (let k = 0; k < n.childCount; k++) stack.push(n.child(k))
      }
    }

    // ---- production analysis
    let res: any
    try {
      res = new RealJavaAnalyzer().analyze(rootNode, content, p)
    } catch {
      parseFailures++
      continue
    }
    const syms: any[] = res.symbols ?? []
    totalSymbols += syms.length
    if (syms.length === 0) filesWithNoSymbols++

    // symbol-level R7 runtime half
    for (const s of syms) {
      if (!s.name) { symEmptyName++; if (symUnknownExamples.length < 5) symUnknownExamples.push(`${L}: EMPTY name kind=${s.kind}`) }
      else if (PLACEHOLDER_LITERALS.has(String(s.name))) {
        symNameUnknown++
        if (symUnknownExamples.length < 5) symUnknownExamples.push(`${L}: symbol named "${s.name}" kind=${s.kind}`)
      }
      for (const prm of s.parameters ?? []) {
        if (String(prm.type) === "unknown") paramTypeUnknown++
      }
    }

    const names = new Set<string>()
    for (const s of syms) {
      if (s.name) names.add(String(s.name))
      if (s.qualifiedName) names.add(String(s.qualifiedName))
    }

    // OWNER-LESS NON-TYPE SYMBOLS — a counted, still-open defect.
    //
    // The export set used to be `!s.ownerName` alone, which assumes "no owner"
    // means "top-level type". Both halves are false: a symbol can lose its owner
    // without being a type. Measured over java-lib's 3,275 files, 60 symbols
    // carry no ownerName while not being a top-level type declaration — every one
    // a `method_declaration`, in 2 files — and the export surface published 14 of
    // them (deduped by name) as importable units. The surface no longer reads the
    // attribute, but the underlying loss still reaches `contains` and `overrides`
    // attribution, so it is reported on EVERY run rather than filed and forgotten:
    // a defect that is only in a commit message is a defect that comes back.
    //
    // The five top-level type declarations are named by node type, not by a
    // curated list of SymbolKinds, because `record` and `@interface` both map to
    // `class` in this lane and a kind-based list would call them non-types.
    for (const s of syms) {
      const nt = String(s.metadata?.nodeType ?? "")
      const isTopLevelTypeDecl =
        nt === "class_declaration" || nt === "interface_declaration" || nt === "enum_declaration" ||
        nt === "record_declaration" || nt === "annotation_type_declaration"
      if (s.ownerName || isTopLevelTypeDecl) continue
      ownerlessNonType++
      ownerlessNonTypeFiles.add(L)
      if (ownerlessNonTypeExamples.length < 6) {
        ownerlessNonTypeExamples.push(`${L}: ${String(s.name)} nodeType=${nt || "(none)"} line=${s.range?.startLine ?? 0}`)
      }
    }
    const leafOf = (t: string) => {
      let s = t
      for (let k = s.length - 1; k >= 0; k--) {
        const c = s[k]
        if (c === ":" || c === ".") { if (k + 1 < s.length) return s.slice(k + 1) }
      }
      return s
    }

    const imps: any[] = res.imports ?? []
    importsTotal += imps.length
    if (imps.length) importsFiles.add(L)
    const exps: any[] = res.exports ?? []
    exportsTotal += exps.length
    if (exps.length) exportsFiles.add(L)
    if (exps.length && !String(res.metadata?.currentPackage ?? "")) exportSetNoPackage++

    const rels: any[] = res.relationships ?? []
    totalRelationships += rels.length
    for (const r of rels) {
      const t = String(r.type ?? r.relationshipType ?? "") as Type
      if (!(TEN as readonly string[]).includes(t)) {
        if (t) offEnum.set(t, (offEnum.get(t) ?? 0) + 1)
        continue
      }
      const a = slot(t)
      a.n++
      if (a.files.size < 4) a.files.add(L)
      if (a.examples.length < 3) a.examples.push(`${r.source} -> ${r.target}`)
      const c = typeof r.confidence === "number" ? r.confidence : 1
      a.conf.set(String(c), (a.conf.get(String(c)) ?? 0) + 1)
      const ev = String(r.metadata?.evidenceClass ?? "(none)")
      a.ev.set(ev, (a.ev.get(ev) ?? 0) + 1)
      for (const ep of [r.source, r.target]) {
        const k = classifyEndpoint(ep)
        a.cls.set(k, (a.cls.get(k) ?? 0) + 1)
        if (k === "PLACEHOLDER_LITERAL") {
          a.r7.set(String(ep), (a.r7.get(String(ep)) ?? 0) + 1)
          if (a.r7Examples.length < 5) a.r7Examples.push(`${L}: "${ep}" in ${r.source} -> ${r.target}`)
        } else if (k === "NOT_AN_IDENTIFIER") {
          if (a.shapeExamples.length < 5) a.shapeExamples.push(`${L}: "${ep}" in ${r.source} -> ${r.target}`)
        } else {
          a.nameEnds++
          const s = String(ep)
          if (names.has(s) || names.has(leafOf(s))) a.nameRes++
        }
      }
    }

    // export-set visibility: importability of a top-level type is `public`
    // (JLS 7.6). Recorded because an `exports` edge at 1.0 asserts it.
    if (exps.length) {
      const byName = new Map<string, any>()
      for (const s of syms) if (s.name) byName.set(String(s.name), s)
      for (const e of exps) {
        const s: any = byName.get(String(e.name))
        const v = String(s?.visibility ?? (s ? "(none)" : "(no symbol)"))
        exportVis.set(v, (exportVis.get(v) ?? 0) + 1)
      }
    }
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()))
const ms = Date.now() - t0

// ------------------------------------------------------------------ report
function top(m: Map<string, number>, n: number): string {
  return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => `${k}:${v}`).join(" ") || "-"
}
function pct(a: number, b: number): string {
  if (b === 0) return "n/a"
  return ((100 * a) / b).toFixed(1) + "%"
}

console.log(`measured ${files.length} files in ${ms} ms   parse/analyze failures ${parseFailures}   symbols ${totalSymbols}   relationships ${totalRelationships}`)
console.log(`files with zero symbols: ${filesWithNoSymbols}   files with an ERROR node: ${filesWithErrors}`)
console.log(`imports[] channel: ${importsTotal} entries in ${importsFiles.size} files`)
console.log(`exports[]  channel: ${exportsTotal} entries in ${exportsFiles.size} files   (of those files, ${exportSetNoPackage} declare no package)`)
console.log(`symbol-level R7 runtime: empty names ${symEmptyName}   placeholder names ${symNameUnknown}   parameter type "unknown" ${paramTypeUnknown}`)
for (const x of symUnknownExamples) console.log(`   ${x}`)
console.log(`export-set visibility: ${top(exportVis, 8)}`)
console.log(`OPEN DEFECT owner-less NON-TYPE symbols: ${ownerlessNonType} in ${ownerlessNonTypeFiles.size} files  (export surface no longer reads this attribute; contains/overrides attribution still does)`)
for (const x of ownerlessNonTypeExamples) console.log(`   ${x}`)
console.log(`off-enum relationship types observed: ${offEnum.size === 0 ? "(none)" : top(offEnum, 10)}\n`)

console.log("=== RELATIONSHIP CHANNEL — per type ===")
console.log("type            count     NAME ends  resolved   badShape  placeholder   confidence                     evidenceClass")
console.log("-".repeat(140))
let fired = 0
for (const t of TEN) {
  const a = acc.get(t)
  if (!a || a.n === 0) {
    console.log(`${t.padEnd(14)} ${"0".padStart(6)}        --        --       --         --   ${"(NEVER EMITTED on this corpus)".padEnd(30)}`)
    continue
  }
  fired++
  console.log(
    `${t.padEnd(14)} ${String(a.n).padStart(6)} ${String(a.nameEnds).padStart(10)}  ${(pct(a.nameRes, a.nameEnds) + ` (${a.nameRes})`).padEnd(9)} ${String(a.cls.get("NOT_AN_IDENTIFIER") ?? 0).padStart(8)} ${String(a.cls.get("PLACEHOLDER_LITERAL") ?? 0).padStart(11)}   ${top(a.conf, 6).padEnd(30)} ${top(a.ev, 4)}`,
  )
}
console.log("-".repeat(140))
console.log(`fired on the RELATIONSHIP channel: ${fired}/10   silent: ${TEN.filter((t) => !acc.has(t)).join(" ") || "(none)"}\n`)

console.log("=== per-type detail (files, examples, hygiene) ===")
for (const t of TEN) {
  const a = acc.get(t)
  if (!a) continue
  console.log(`\n${t}: ${a.n} edges in ${a.files.size}+ files`)
  console.log(`  files: ${[...a.files].join(", ")}`)
  console.log(`  e.g.:  ${a.examples.join("   |   ")}`)
  console.log(`  endpoint classes: ${top(a.cls, 6)}`)
  if (a.r7.size) {
    console.log(`  R7 placeholder literals: ${[...a.r7.entries()].map(([k, v]) => `"${k}"×${v}`).join(", ")}`)
    for (const x of a.r7Examples.slice(0, 3)) console.log(`     ${x}`)
  }
  if (a.shapeExamples.length) {
    console.log(`  endpoints that are not Java names:`)
    for (const x of a.shapeExamples.slice(0, 3)) console.log(`     ${x}`)
  }
}

// ------------------------------------------------------------------ construct census
console.log(`\n=== INSTRUMENT A: grammar inventory over ${files.length} files ===`)
console.log(`distinct node types produced: ${grammarTypes.size}`)
const JPMS = ["module_declaration", "requires_module_directive", "requires_transitive_module_directive", "exports_module_directive", "opens_module_directive", "uses_module_directive", "provides_module_directive", "to_module", "from_module"]
console.log(`JPMS node types — the constructs decision G5 declared out of scope:`)
for (const nt of JPMS) {
  const c = grammarTypes.get(nt) ?? 0
  console.log(`  ${nt.padEnd(38)} ${String(c).padStart(6)}  ${c === 0 ? "ABSENT from every tree" : "PRESENT"}`)
}

console.log(`\n=== INSTRUMENT B: parse-tree construct counts ===`)
for (const q of probes) {
  console.log(`${q.name.padEnd(30)} occurrences ${String(q.count).padStart(5)}   files ${q.files.size}`)
  for (const e of q.examples) console.log(`     ${e}`)
}
if (probes.length === 0) console.log("(no probe fired — the constructs are absent from every tree)")

console.log(`\n=== full node-type inventory (sorted by count) ===`)
console.log([...grammarTypes.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join("  "))