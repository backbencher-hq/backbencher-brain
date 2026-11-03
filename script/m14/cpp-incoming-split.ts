#!/usr/bin/env bun
/**
 * THE CPP INCOMING SPLIT — what the gate's UNRESOLVED edges actually NAME.
 *
 * ## THE QUESTION
 *
 * `incoming-gate.ts cpp cpp,hpp,cc,cxx,hpp,hxx` reads FAIL: 267 ambiguous + 8,720 unresolved of
 * 13,825 edges. That number is a RESOLUTION fact, not a diagnosis: "unresolved" says the arbiter
 * found no declaration for the target string in the file's project, and says nothing about WHY.
 *
 * ## THE METHOD, AND WHY IT NEEDS BOTH SIDES
 *
 * The gate's dump publishes `(type, state, target, file:line)` for every edge — everything the
 * arbiter saw. It does NOT publish `toSymbol`, the QUALIFIED path the analyzer also emits on the
 * same edge (`real-cpp-analyzer.ts:4864`: "The FULL qualified path stays in `qualifiedName` (qc
 * payload) — only the edge target is the leaf").
 *
 * So this script runs the analyzer over exactly the files the gate's dump names, indexes its edges
 * by `(type, target, file:line)` — the same triple the dump carries — and reports, for each
 * unresolved edge, what the analyzer ALSO published. That is the difference between "the analyzer
 * knew nothing more" and "the analyzer published a name the arbiter never tried", and it is the
 * difference that decides whose fix this is.
 *
 * ## RUN
 *
 *   bun run script/m14/cpp-incoming-split.ts --dump=<gate --dump log> [--json=<out>]
 *
 * The dump is produced by the Lead's gate; this script never edits or re-derives the gate's verdict.
 */
import { readFileSync, writeFileSync, statSync } from "node:fs"
import * as path from "node:path"

const ROOT = process.cwd()
const arg = (n: string): string | null => {
  const hit = process.argv.find((a) => a.startsWith(`--${n}=`))
  return hit ? hit.slice(n.length + 3) : null
}
const dumpPath = arg("dump")
if (!dumpPath) { console.error("usage: --dump=<gate --dump log> [--json=<out>]"); process.exit(2) }

/** Every edge row the gate dumped, in dump order. Columns: DUMP type state target loc - - - reason. */
type DumpRow = { type: string; state: string; target: string; loc: string; reason: string }
const rows: DumpRow[] = []
for (const line of readFileSync(dumpPath, "utf8").split("\n")) {
  const f = line.split("\t")
  if (f[0] !== "DUMP" || f.length < 9) continue
  rows.push({ type: f[1], state: f[2], target: f[3], loc: f[4], reason: f[8] })
}
const unresolved = rows.filter((r) => r.state === "unresolved")
const files = [...new Set(unresolved.map((r) => r.loc.slice(0, r.loc.lastIndexOf(":"))))].sort()

/** The analyzer's own view of the same edges, keyed by the triple the dump carries. */
const { getParser } = await import(path.join(ROOT, "script/m14/run-fixtures.ts"))
const parser: any = await getParser("cpp")
const mod: any = await import(path.join(ROOT, "src/ast/real-cpp-analyzer.ts"))
const Ctor = mod.RealCppAnalyzer ?? mod.CppAnalyzer ?? mod.default
const known = new Map<string, any>()
let analyzed = 0, failed = 0
for (const f of files) {
  let src = ""
  try { src = readFileSync(f, "utf8") } catch { failed++; continue }
  let tree: any
  try { tree = parser.parse(src) } catch { failed++; continue }
  try {
    const a = new Ctor()
    const r = await a.analyze(tree.rootNode, src, f, {})
    for (const rel of r.relationships ?? []) {
      // the dump's loc is `<file>:<line>`; the analyzer's line is `line_number` (1-based)
      const line = rel.line_number ?? rel.lineNumber ?? rel.metadata?.line
      if (line == null) continue
      known.set(`${rel.type}|${rel.target}|${f}:${line}`, rel)
    }
    analyzed++
  } catch {
    failed++
  } finally {
    tree.delete()
  }
}

/**
 * WHAT A NAME IS. The buckets are ordered so the MOST SPECIFIC evidentiary claim wins: a target
 * that the analyzer itself qualified is a different fact from a bare leaf that it did not.
 */
const EXTERNAL_ROOTS = new Set([
  "std", "__gnu_cxx", "__cxxabiv1", "boost", "testing", "testing::internal", "absl", "llvm",
  "nlohmann", "fmt", "google", "duckdb", "re2", "ska_sort", "skiplist",
])
function classify(r: DumpRow): string {
  const edge = known.get(`${r.type}|${r.target}|${r.loc}`)
  const toSymbol: string | undefined = edge?.toSymbol
  const md: any = edge?.metadata ?? {}
  const t = r.target
  // 1. The analyzer PUBLISHED A QUALIFIER the arbiter never tried.
  if (toSymbol && toSymbol.includes("::")) {
    const root = toSymbol.split("::")[0]
    if (EXTERNAL_ROOTS.has(root)) return `qualified-external-root (${root}::)`
    return "qualified-project-or-unknown (x::)"
  }
  // 2. A macro invoked in call position: the grammar sees a call, the language sees an expansion.
  if (/^[A-Z_][A-Z0-9_]*$/.test(t) && t.length >= 2) return "macro-invocation (ALL_CAPS)"
  // 3. A file name: a header that names no symbol (part_of/imports only).
  if (/\.(h|hpp|hh|hxx|ipp|inl|cc|cpp|cxx|cu|c\+\+)$/i.test(t)) return "header-file-name"
  // 4. A name the analyzer carried with no qualifier at all.
  if (md.isSystem || md.isSystemInclude) return "system-header"
  return "bare-name-no-qualifier"
}

const buckets = new Map<string, number>()
const byType = new Map<string, Map<string, number>>()
for (const r of unresolved) {
  const b = classify(r)
  buckets.set(b, (buckets.get(b) ?? 0) + 1)
  if (!byType.has(r.type)) byType.set(r.type, new Map())
  const m = byType.get(r.type)!
  m.set(b, (m.get(b) ?? 0) + 1)
}
const matched = unresolved.filter((r) => known.has(`${r.type}|${r.target}|${r.loc}`)).length

const out = {
  instrument: "script/m14/cpp-incoming-split.ts",
  dump: dumpPath,
  dumpRows: rows.length,
  unresolved: unresolved.length,
  filesNamedByDump: files.length,
  filesAnalyzed: analyzed,
  filesFailed: failed,
  /** How many unresolved edges this script could join to the analyzer's own edge. A bucket count is
   *  only as good as this ratio, so it is a FIRST-CLASS field, not a footnote. */
  joined: matched,
  joinRatio: Number((matched / Math.max(1, unresolved.length)).toFixed(4)),
  buckets: Object.fromEntries([...buckets.entries()].sort((a, b) => b[1] - a[1])),
  byType: Object.fromEntries([...byType.entries()].map(([k, m]) => [k, Object.fromEntries([...m.entries()].sort((a, b) => b[1] - a[1]))])),
  reading:
    "`qualified-*` means the ANALYZER published a `toSymbol` containing `::` and the ARBITER resolved the bare leaf instead — a name it never tried. `macro-invocation` means the grammar produced a call node for a MACRO, which names no function. `header-file-name` and `system-header` are include-family targets that name no indexed symbol by construction. `bare-name-no-qualifier` is the class that is genuinely the analyzer's: a leaf with nothing behind it.",
}
console.log(JSON.stringify(out, null, 2))
const js = arg("json")
if (js) writeFileSync(js, JSON.stringify(out, null, 2) + "\n")
