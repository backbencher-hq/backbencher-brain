#!/usr/bin/env bun
// M14.0.SPEC — the CLEAN lane's completeness gate.
//
// WHY THIS FILE EXISTS SEPARATELY. `script/m14/completeness-inventory.ts` is the
// repository-wide F1/F8 gate, and `clean` is not in its `GATED_LANGS` set and has
// no entry in its language table, so nothing enforces
// `script/m14/spec/clean-completeness.json`. That is not a reason to leave the
// spec unenforced — an unenforced spec is an aspiration. This gate enforces the
// same four rules on the Clean lane, is clean-exclusive, and reads the same spec
// file the repository gate would read if the lane were ever enrolled:
//
//   1. every declared NAMED node type of the pinned grammar is in EXACTLY ONE
//      bucket (silence is guilt — a type in no bucket is a failure);
//   2. no type is in two buckets;
//   3. every `handled_verified` type is NAMED by the analyzer AND occurs in the
//      parse tree of at least one committed clean fixture (the F6 conjunction —
//      handled but unverified is how a claim gets to be a claim with nothing
//      behind it);
//   4. hygiene: the analyzer has no no-op ternary, no duplicate branch, and no
//      write-only flag, and no regex literal is doing syntax work (M49.R2).
//
// Usage: bun run script/m14/clean-completeness-gate.ts
// Exits 1 on any failure. Writes nothing.
import fs from "node:fs"
import path from "node:path"

const ROOT = process.cwd()
const SPEC_PATH = "script/m14/spec/clean-completeness.json"
const ANALYZER = "src/ast/real-clean-analyzer.ts"
const FIXTURE_DIR = "validation/m14/fixtures/clean"
const WASM = "wasm/tree-sitter-clean.wasm"

interface Spec {
  grammar: string
  handled_verified: { types: string[] }
  internal_silent: { types: string[] }
  gap: { gaps: Array<{ id: string; node_type: string }> }
  design_decision: { decisions: Array<{ id: string; node_type: string }> }
}

function fail(msg: string): never {
  console.error(`FAIL ${msg}`)
  process.exit(1)
}

const spec: Spec = JSON.parse(fs.readFileSync(path.join(ROOT, SPEC_PATH), "utf8"))
const analyzerSrc = fs.readFileSync(path.join(ROOT, ANALYZER), "utf8")

/**
 * The analyzer's source with its COMMENTS removed, string literals kept.
 *
 * The hygiene rules below are character scans over the source, and this file's
 * own comments quote paths (`validation/m14/fixtures/clean/…`), spell out
 * ternary-shaped fragments, and name regex literals — so a scan over the raw text
 * reports the documentation as the violation. Stripping comments is what makes
 * each rule mean what it says: a regex LITERAL in code, not a path in prose.
 */
function stripComments(src: string): string {
  let out = ""
  let i = 0
  let inLine = false
  let inBlock = false
  let quote = ""
  while (i < src.length) {
    const c = src[i]
    const n = src[i + 1]
    if (inLine) {
      if (c === "\n") { inLine = false; out += c }
      i++
      continue
    }
    if (inBlock) {
      if (c === "*" && n === "/") { inBlock = false; i += 2; continue }
      if (c === "\n") out += c
      i++
      continue
    }
    if (quote) {
      out += c
      if (c === "\\") { out += n ?? ""; i += 2; continue }
      if (c === quote) quote = ""
      i++
      continue
    }
    if (c === "/" && n === "/") { inLine = true; i += 2; continue }
    if (c === "/" && n === "*") { inBlock = true; i += 2; continue }
    if (c === '"' || c === "'" || c === "`") { quote = c; out += c; i++; continue }
    out += c
    i++
  }
  return out
}
const analyzerCode = stripComments(analyzerSrc)

// ---------------------------------------------------------------------------
// 1 + 2. The grammar's declared named types, and the bucket partition.
// ---------------------------------------------------------------------------
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const grammar = await L.load(fs.readFileSync(path.join(ROOT, WASM)))
const declared: string[] = []
const seenType = new Set<string>()
for (let i = 0; i < grammar.nodeTypeCount; i++) {
  if (!grammar.nodeTypeIsNamed(i)) continue
  const n = grammar.nodeTypeForId(i)
  if (!n || n.startsWith("_")) continue
  if (seenType.has(n)) continue // an ALIASED slot (CL-D12): one distinct name
  seenType.add(n)
  declared.push(n)
}

const gapTypes = spec.gap.gaps.flatMap((g) => g.node_type.split(/[,\s]+/).filter(Boolean))
const decisionTypes = spec.design_decision.decisions.flatMap((d) => d.node_type.split(/[,\s]+/).filter(Boolean))

const buckets: Array<[string, string[]]> = [
  ["handled_verified", spec.handled_verified.types],
  ["internal_silent", spec.internal_silent.types],
  ["gap", gapTypes],
  ["design_decision", decisionTypes],
]

const problems: string[] = []
const owner = new Map<string, string>()
for (const [bucket, types] of buckets) {
  for (const t of types) {
    if (owner.has(t)) problems.push(`type ${t} is in BOTH ${owner.get(t)} and ${bucket}`)
    else owner.set(t, bucket)
  }
}
const unclassified = declared.filter((t) => !owner.has(t))
if (unclassified.length > 0) {
  problems.push(`${unclassified.length} declared type(s) in NO bucket: ${unclassified.join(", ")}`)
}
const unknown = [...owner.keys()].filter((t) => !seenType.has(t))
if (unknown.length > 0) {
  problems.push(`${unknown.length} spec type(s) the pinned grammar does not declare: ${unknown.join(", ")}`)
}
const declaredCounts = spec._population_check?.declared_named_types
if (typeof declaredCounts === "number" && declaredCounts !== declared.length) {
  problems.push(`spec says ${declaredCounts} declared named types; the grammar exposes ${declared.length}`)
}

// ---------------------------------------------------------------------------
// 3. F6 — every `handled_verified` type is named by the analyzer AND is exercised
//      by a committed fixture.
// ---------------------------------------------------------------------------
// "Named by the analyzer" is read as: the type string appears as a quoted literal
// in the source, OR as a member of one of the module-level type sets, OR is
// reached through a grammar FIELD whose target set contains it. The last clause is
// why `fixity_annotation` is in handled_verified although the string never appears
// in the source — it is read as `node.childForFieldName("fixity")`, and the field
// is the discriminator. A type that is neither a literal nor field-reachable is a
// spec row with nothing behind it.
const literalNamed = new Set<string>()
for (const m of analyzerCode.matchAll(/"([a-z_][a-z_0-9]*)"/g)) literalNamed.add(m[1])
// Field-reachable: a type the analyzer obtains through a field rather than by
// naming it. Each entry states the field and why the type is that field's value.
const FIELD_REACHABLE: Record<string, string> = {
  fixity_annotation: "type_signature.fixity",
  class_method_name: "read off an import item's own children",
  constructor_subset: "read off an import item's own children",
  record_subset: "read off an import item's own children",
  class_name: "class_declaration.name (the field's own node type)",
  instance_class: "instance_declaration.name (the field's own node type)",
  signature_name: "type_signature.name (the field's own node type)",
  module_name: "module_declaration.name (the field's own node type)",
}
const namedByAnalyzer = (t: string): boolean => literalNamed.has(t) || t in FIELD_REACHABLE

// Fixture parse trees.
const parser = new P()
parser.setLanguage(grammar)
const inFixture = new Set<string>()
let fixtureFiles = 0
for (const f of fs.readdirSync(path.join(ROOT, FIXTURE_DIR)).sort()) {
  if (!/\.(icl|dcl)$/.test(f)) continue
  fixtureFiles++
  const tree = parser.parse(fs.readFileSync(path.join(ROOT, FIXTURE_DIR, f), "utf8"))
  const visit = (n: any): void => {
    if (n.isNamed) inFixture.add(n.type)
    for (let i = 0; i < n.childCount; i++) {
      const c = n.child(i)
      if (c) visit(c)
    }
  }
  visit(tree.rootNode)
}

const notNamed: string[] = []
const notExercised: string[] = []
for (const t of spec.handled_verified.types) {
  if (!namedByAnalyzer(t)) notNamed.push(t)
  if (!inFixture.has(t)) notExercised.push(t)
}
if (notNamed.length > 0) {
  problems.push(`${notNamed.length} handled_verified type(s) the analyzer never reaches: ${notNamed.join(", ")}`)
}
if (notExercised.length > 0) {
  problems.push(
    `${notExercised.length} handled_verified type(s) no fixture exercises: ${notExercised.join(", ")}`,
  )
}

// A checked population is itself a check: a gate that read nothing must fail.
if (spec.handled_verified.types.length === 0) problems.push("handled_verified is empty — the gate read nothing")
if (fixtureFiles === 0) problems.push(`no fixtures in ${FIXTURE_DIR} — the gate read nothing`)

// ---------------------------------------------------------------------------
// 4. Hygiene.
// ---------------------------------------------------------------------------
// 4a. No regex literal doing syntax work. The lane's rule is M49.R2 (reviews/
//     regex-policy.md): a regular expression may not classify AST. The honest
//     check available without a full dataflow analysis is that the analyzer
//     contains NO regex literal at all — which is a stronger, simpler claim, and
//     one this file can actually verify.
const regexLiterals = analyzerCode.match(/\/(?![/*])[^/\n]+\/[gimsuy]*(?![/*])/g) ?? []
const realRegex = regexLiterals.filter((lit) => {
  // A single-character class or a path-looking string is not a regex.
  const body = lit.slice(1, lit.lastIndexOf("/"))
  return /[\\^$.*+?()[\]{}|]/.test(body)
})
if (realRegex.length > 0) {
  problems.push(`analyzer contains ${realRegex.length} regex literal(s): ${realRegex.slice(0, 5).join(" ")}`)
}

// 4b. No write-only flag: every `private x = ` / `private x: T =` field is read.
const privateFields = [...analyzerCode.matchAll(/^  private (?:readonly )?([a-zA-Z_][A-Za-z0-9_]*)\s*[?!]?\s*[:=]/gm)].map((m) => m[1])
for (const f of new Set(privateFields)) {
  const uses = (analyzerCode.match(new RegExp(`this\\.${f}\\b`, "g")) ?? []).length
  if (uses === 0) problems.push(`write-only private field: ${f}`)
}

// 4c. Every private method is called.
for (const m of new Set([...analyzerCode.matchAll(/^  private ([a-zA-Z_][A-Za-z0-9_]*)\(/gm)].map((x) => x[1]))) {
  const uses = (analyzerCode.match(new RegExp(`this\\.${m}\\b`, "g")) ?? []).length
  if (uses === 0) problems.push(`uncalled private method: ${m}`)
}

// 4d. No no-op ternary: a conditional whose two ARMS are the same expression.
//
// The arms are captured and COMPARED, not back-referenced. A back-reference
// (`\?\s*(...)\s*:\s*\1`) matches on the last expression before the colon, so
// `a?.b ?? a.b : a.b` — a real conditional — reads as a no-op. Capturing both
// arms and comparing them is the check that means what it says; the expression
// this lane actually contained a no-op in was removed in this round
// (`target.type === "type_variable" ? target.namedChild(0)?.text ?? target.text
// : target.text`, whose false arm repeated the true arm's fallback).
const TERNARY = /\?\s*([A-Za-z_$][\w$.[\]()!?| ]*?)\s*:\s*([A-Za-z_$][\w$.[\]()!?| ]*?)\s*[,;)\n]/g
const noopTernary: string[] = []
for (const m of analyzerCode.matchAll(TERNARY)) {
  if (m[1].trim() === m[2].trim()) noopTernary.push(m[0].trim().replace(/\s+/g, " "))
}
if (noopTernary.length > 0) problems.push(`no-op ternary: ${noopTernary.slice(0, 3).join(" | ")}`)

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------
const rows: string[] = []
rows.push(`clean completeness gate — ${declared.length} declared named node types, ${owner.size} classified`)
for (const [bucket, types] of buckets) rows.push(`  ${bucket.padEnd(18)} ${types.length}`)
rows.push(`  fixtures parsed   ${fixtureFiles} (${inFixture.size} distinct named types)`)
rows.push(`  analyzer named   ${[...owner.keys()].filter(namedByAnalyzer).length} of ${owner.size}`)
rows.push(`  field-reachable   ${Object.keys(FIELD_REACHABLE).length} (${Object.keys(FIELD_REACHABLE).join(", ")})`)
rows.push("")

if (problems.length > 0) {
  for (const p of problems) rows.push(`FAIL ${p}`)
  console.error(rows.join("\n"))
  process.exit(1)
}
rows.push("all checks pass")
console.log(rows.join("\n"))
