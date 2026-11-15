/**
 * TYPESCRIPT LANE — SHAPE CENSUS (pre-fix measurement for the iteration-1 causes).
 *
 * Reads the gate's OWN population list (`BB_LIST_FILES` dump) and prints, from the analyzer's
 * real output only, the size of three candidate causes that the gate's named-cause census
 * buckets by CONSEQUENCE rather than by SHAPE:
 *
 *   1. NON-IDENTIFIER `calls` TARGETS — a target that cannot be a declaration name at all
 *      (`factory()`, `(readNegated)`, `a['b']`, `x as T`). Each is an unresolved edge by
 *      construction, so this sizes the `calls-callee-shape-reduction` fixture class.
 *   2. TEST-FRAMEWORK-IMPORTED CALLEES — a bare callee whose name is bound by an import from a
 *      pinned test-framework package (`import { describe } from "@jest/globals"`). The
 *      `markExternalTargets` pass refuses these today because the file DOES bind the name.
 *   3. DOTTED HERITAGE TARGETS — `extends`/`implements` targets carrying a `.` (the
 *      `heritage-parameterized-leaves` fixture class).
 *
 * CLI: bun validation/m14/fixtures/typescript/tools/shape-census.mts <filelist> [--examples]
 */
import { readFileSync } from "node:fs"
import { parseFile } from "../../../../../src/ast/pool-worker"

const argv = process.argv.slice(2)
const listPath = argv.find((a) => !a.startsWith("--"))
const SHOW = argv.includes("--examples")
if (!listPath) {
  console.error("usage: shape-census.mts <filelist> [--examples]")
  process.exit(2)
}
const files = readFileSync(listPath, "utf8")
  .split("\n")
  .filter((l) => l.startsWith("BB_LIST_FILES_FILE: "))
  .map((l) => l.slice("BB_LIST_FILES_FILE: ".length).trim())
  .filter(Boolean)

/** The same spelling rule the analyzer's `isPlainIdentifier` uses: `$`, `_`, letters, digits after. */
const isPlainIdentifier = (s: string): boolean => {
  if (s.length === 0) return false
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    const ok =
      (c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || c === "_" || c === "$" ||
      (i > 0 && c >= "0" && c <= "9")
    if (!ok) return false
  }
  return true
}

/**
 * The pinned TEST-FRAMEWORK package list. A module specifier matching one of these is a test
 * framework: its exports exist in `node_modules`, not in the project, whatever the file does.
 * Prefix forms (`@testing-library/*`, `@jest/*`) are matched by segment, never substring.
 */
const TEST_PACKAGES = [
  "@jest/globals", "@jest/expect", "@jest/test-globals", "@testing-library/jest-dom",
  "vitest", "jest", "mocha", "chai", "ava", "tap", "uvu", "jasmine", "sinon",
  "node:test", "bun:test", "cypress", "@playwright/test", "playwright", "@vitest/expect",
  "@vitest/spy", "expect", "supertest",
]
const isTestPackage = (m: string): boolean => {
  for (const p of TEST_PACKAGES) if (m === p) return true
  for (const p of TEST_PACKAGES) if (m.startsWith(p + "/")) return true
  return false
}

const stats = {
  calls: 0,
  nonIdentifierCalls: 0,
  frameworkImportedCalls: 0,
  dottedHeritage: 0,
  extendsTotal: 0,
  implementsTotal: 0,
  importsTotal: 0,
}
const ex: Record<string, string[]> = { nonIdentifierCalls: [], frameworkImportedCalls: [], dottedHeritage: [] }

const DIFF = argv.includes("--callee-diff")
/** The OLD reducer's answer, reconstructed exactly: `targetName = callee.text`, replaced by
 *  the property text ONLY for a member expression. The analyzer records `calleeShape` exactly
 *  when the callee was NEITHER an identifier nor a member expression — the shapes the old
 *  rule published as raw text — so this is an exact reconstruction, not a guess. */
const oldTargetOf = (md: any, newTarget: string): string => {
  const shape = String(md?.calleeShape ?? "")
  if (shape.length > 0) return String(md?.calleeExpression ?? newTarget)
  return newTarget
}

/** THE PROJECT a file belongs to, for the gate's per-project scope: the first segment under
 *  the corpus root (`/…/repositories/<repo>/…`). */
const projectOf = (f: string): string => {
  const marker = "/repositories/"
  const at = f.indexOf(marker)
  if (at < 0) return f
  const rest = f.slice(at + marker.length)
  const slash = rest.indexOf("/")
  return slash < 0 ? rest : rest.slice(0, slash)
}

type DeclRec = { name: string; file: string; line: number; kind: string }
const declByName = new Map<string, DeclRec[]>()
const relsByFile: Array<{ file: string; rels: any[] }> = []

for (const f of files) {
  // Only the diff mode needs the key space; the count mode below parses on its own.
  if (!DIFF) break
  const r: any = await parseFile(f, f.slice(0, f.lastIndexOf("/")))
  if (!r?.success) continue
  const rels = (r.relationships ?? []) as any[]
  relsByFile.push({ file: f, rels })
  for (const s of (r.symbols ?? []) as any[]) {
    const rec = (name: string): DeclRec => ({ name, file: f, line: Number(s.startLine ?? 0), kind: String(s.kind ?? "") })
    const n = String(s.name ?? "")
    const q = String(s.qualifiedName ?? "")
    if (n) {
      const list = declByName.get(n) ?? []
      list.push(rec(n))
      declByName.set(n, list)
    }
    if (q && q !== n) {
      const list = declByName.get(q) ?? []
      list.push(rec(q))
      declByName.set(q, list)
    }
  }
}

if (DIFF) {
  // THE NEW TYPE-POSITION REFERENCES, classified by the gate's own intent test. Used to
  // hand-read the ONE references edge that moved `arbitraryTwin` 89 -> 90.
  let shown = 0
  const tally = { total: 0, own: 0, other: 0, none: 0 }
  const allRefs = { intended: 0, sameFile: 0, other: 0, none: 0 }
  for (const { file, rels } of relsByFile) {
    const project = projectOf(file)
    // Every references edge, for a same-population reproduction of the gate's intent split.
    for (const x of rels) {
      if (String(x.type) !== "references") continue
      const t = String(x.target ?? "")
      const recs = (declByName.get(t) ?? []).filter((r) => projectOf(r.file) === project)
      const cls = recs.length === 0 ? "none" : recs.some((r) => r.file === file) ? "same" : "other"
      if (cls === "none") allRefs.none++
      else if (cls === "same") allRefs.sameFile++
      else allRefs.other++
    }
    for (const x of rels) {
      if (String(x.type) !== "references") continue
      const label = String(x.metadata?.relationshipType ?? "")
      if (label !== "type_predicate_target" && label !== "type_parameter_constraint") continue
      tally.total++
      const t = String(x.target ?? "")
      const recs = (declByName.get(t) ?? []).filter((r) => projectOf(r.file) === project)
      const cls = recs.length === 0 ? "none" : recs.some((r) => r.file === file) ? "own" : "other"
      tally[cls]++
      const where = recs.slice(0, 4).map((r) => `${r.file.replace(/^.*repositories\//, "")}:${r.line}(${r.kind})`).join(" · ")
      if (shown < 80 && cls === "other") {
        console.log(`  OTHER ${file.replace(/^.*repositories\//, "")}:${x.line_number ?? "-"} -> "${t}"  [${label}]  ${where}`)
        shown++
      }
    }
  }
  console.log(`\ntype-position reference rows: ${tally.total} (own ${tally.own} · other ${tally.other} · none ${tally.none})`)
  console.log(`ALL references intent (my reproduction): sameFile ${allRefs.sameFile} · other ${allRefs.other} · none ${allRefs.none}`)
  process.exit(0)
}

for (const f of files) {
  const r: any = await parseFile(f, f.slice(0, f.lastIndexOf("/")))
  if (!r?.success) continue
  const rels = (r.relationships ?? []) as any[]
  const pkgOfLocal = new Map<string, string>()
  for (const x of rels) {
    if (String(x.type) !== "imports") continue
    const m = String(x.metadata?.module ?? "")
    const alias = String(x.metadata?.alias ?? "")
    const tgt = String(x.target ?? "")
    const local = alias && alias !== "*" ? alias : tgt.includes(":") ? tgt.slice(tgt.lastIndexOf(":") + 1) : tgt
    if (local && local !== "*") pkgOfLocal.set(local, m)
  }
  const decls = new Set<string>()
  for (const s of (r.symbols ?? []) as any[]) {
    if (s.name) decls.add(String(s.name))
    if (s.qualifiedName) decls.add(String(s.qualifiedName))
  }
  for (const x of rels) {
    const t = String(x.type)
    const tgt = String(x.target ?? "")
    if (t === "calls") {
      stats.calls++
      if (!isPlainIdentifier(tgt)) {
        stats.nonIdentifierCalls++
        if (ex.nonIdentifierCalls.length < 25) ex.nonIdentifierCalls.push(`${f}:${x.line_number ?? "-"} -> "${tgt}" [callee "${x.metadata?.calleeExpression ?? ""}"]`)
        continue
      }
      const callee = String(x.metadata?.calleeExpression ?? "")
      if (callee === tgt && pkgOfLocal.has(tgt) && isTestPackage(String(pkgOfLocal.get(tgt)))) {
        stats.frameworkImportedCalls++
        if (ex.frameworkImportedCalls.length < 25) ex.frameworkImportedCalls.push(`${f}:${x.line_number ?? "-"} -> "${tgt}" from "${pkgOfLocal.get(tgt)}"`)
      }
    } else if (t === "extends" || t === "implements") {
      if (t === "extends") stats.extendsTotal++
      else stats.implementsTotal++
      if (tgt.includes(".") && !decls.has(tgt)) {
        stats.dottedHeritage++
        if (ex.dottedHeritage.length < 25) ex.dottedHeritage.push(`${f}:${x.line_number ?? "-"} ${t} -> "${tgt}"`)
      }
    } else if (t === "imports") stats.importsTotal++
  }
}

console.log(`population: ${files.length} files`)
console.log(`calls edges: ${stats.calls}`)
console.log(`  non-identifier target:        ${stats.nonIdentifierCalls}`)
console.log(`  test-framework imported callee: ${stats.frameworkImportedCalls}`)
console.log(`heritage edges: extends ${stats.extendsTotal} · implements ${stats.implementsTotal}`)
console.log(`  dotted target not declared in file: ${stats.dottedHeritage}`)
console.log(`imports edges: ${stats.importsTotal}`)
if (SHOW) {
  for (const [k, list] of Object.entries(ex)) {
    console.log(`\nEXAMPLES ${k} (${list.length}):`)
    for (const l of list) console.log(`  ${l}`)
  }
}
process.exit(0)
